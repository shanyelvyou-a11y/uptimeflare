import { Env } from '.'
import {
  IncidentRecord,
  LatencyRecord,
  MonitorState,
  MonitorStateCompacted,
} from '../../types/config'

const HEX_TABLE: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function uint8ToHex(bytes: Uint8Array): string {
  // @ts-expect-error Native fast path in modern Workers runtime
  if (typeof bytes.toHex === 'function') {
    // @ts-expect-error
    return bytes.toHex()
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += HEX_TABLE[bytes[i]]
  }
  return out
}

export function hexToUint8(hex: string): Uint8Array {
  if (!hex) return new Uint8Array(0)
  // @ts-expect-error Native fast path in modern Workers and modern browsers
  if (typeof Uint8Array.fromHex === 'function') {
    // @ts-expect-error
    return Uint8Array.fromHex(hex)
  }
  const len = hex.length >>> 1
  const ret = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    ret[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return ret
}

export async function getFromStore(env: Env, key: string): Promise<string | null> {
  if (!env?.UPTIMEFLARE_D1) {
    console.warn('UPTIMEFLARE_D1 binding is not available in current environment.')
    return null
  }
  try {
    const stmt = env.UPTIMEFLARE_D1.prepare('SELECT value FROM uptimeflare WHERE key = ?')
    const result = await stmt.bind(key).first<{ value: string }>()
    return result?.value || null
  } catch (err) {
    console.error('Failed to read state from D1:', err)
    return null
  }
}

export async function setToStore(env: Env, key: string, value: string): Promise<void> {
  if (!env?.UPTIMEFLARE_D1) {
    throw new Error('UPTIMEFLARE_D1 binding is missing')
  }
  const stmt = env.UPTIMEFLARE_D1.prepare(
    'INSERT INTO uptimeflare (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;'
  )
  await stmt.bind(key, value).run()
}

export class CompactedMonitorStateWrapper {
  data: MonitorStateCompacted

  constructor(compactedStateStr: string | null) {
    if (!compactedStateStr) {
      this.data = {
        lastUpdate: 0,
        overallUp: 0,
        overallDown: 0,
        incident: {},
        latency: {},
      }
      return
    }
    try {
      const parsed = JSON.parse(compactedStateStr)
      this.data = {
        lastUpdate: parsed?.lastUpdate ?? 0,
        overallUp: parsed?.overallUp ?? 0,
        overallDown: parsed?.overallDown ?? 0,
        incident: parsed?.incident ?? {},
        latency: parsed?.latency ?? {},
      }
    } catch (err) {
      console.error('Failed to parse compacted state JSON, falling back to empty state:', err)
      this.data = {
        lastUpdate: 0,
        overallUp: 0,
        overallDown: 0,
        incident: {},
        latency: {},
      }
    }
  }

  getCompactedStateStr(): string {
    return JSON.stringify(this.data)
  }

  uncompact(): MonitorState {
    const state: MonitorState = {
      lastUpdate: this.data.lastUpdate,
      overallUp: this.data.overallUp,
      overallDown: this.data.overallDown,
      incident: {},
      latency: {},
    }

    Object.keys(this.data.incident).forEach((monitorId) => {
      state.incident[monitorId] = []
      const incidents = this.data.incident[monitorId]
      if (!incidents || !Array.isArray(incidents.start)) return

      const safeLen = Math.min(
        incidents.start.length,
        incidents.end?.length ?? 0,
        incidents.error?.length ?? 0
      )

      for (let i = 0; i < safeLen; i++) {
        state.incident[monitorId].push({
          start: incidents.start[i],
          end: incidents.end[i],
          error: incidents.error[i],
        })
      }
    })

    Object.keys(this.data.latency).forEach((monitorId) => {
      state.latency[monitorId] = []
      const latencies = this.data.latency[monitorId]
      if (!latencies || !latencies.loc) return

      const locUncompacted: string[] = []
      latencies.loc.c.forEach((count, index) => {
        const val = latencies.loc.v[index] ?? 'CF'
        for (let i = 0; i < count; i++) {
          locUncompacted.push(val)
        }
      })

      const timeBytes = hexToUint8(latencies.time)
      const pingBytes = hexToUint8(latencies.ping)
      const timeArr = new Uint32Array(
        timeBytes.buffer,
        timeBytes.byteOffset,
        Math.floor(timeBytes.byteLength / 4)
      )
      const pingArr = new Uint16Array(
        pingBytes.buffer,
        pingBytes.byteOffset,
        Math.floor(pingBytes.byteLength / 2)
      )

      const safeLen = Math.min(timeArr.length, pingArr.length, locUncompacted.length)

      for (let i = 0; i < safeLen; i++) {
        state.latency[monitorId].push({
          time: timeArr[i],
          ping: pingArr[i],
          loc: locUncompacted[i],
        })
      }
    })

    return state
  }

  incidentLen(monitorId: string): number {
    const incidents = this.data.incident[monitorId]
    if (!incidents || !incidents.start) return 0
    return incidents.start.length
  }

  getIncident(monitorId: string, index: number): IncidentRecord {
    const incidents = this.data.incident[monitorId]
    if (!incidents || index < 0 || index >= incidents.start.length) {
      return null as unknown as IncidentRecord
    }
    return {
      start: incidents.start[index],
      end: incidents.end[index],
      error: incidents.error[index],
    }
  }

  setIncident(monitorId: string, index: number, incident: IncidentRecord) {
    const incidents = this.data.incident[monitorId]
    if (!incidents || index < 0 || index >= incidents.start.length) {
      return
    }
    incidents.start[index] = incident.start
    incidents.end[index] = incident.end
    incidents.error[index] = incident.error
  }

  appendIncident(monitorId: string, incident: IncidentRecord) {
    let incidents = this.data.incident[monitorId]
    if (!incidents) {
      this.data.incident[monitorId] = {
        start: [],
        end: [],
        error: [],
      }
      incidents = this.data.incident[monitorId]
    }
    incidents.start.push(incident.start)
    incidents.end.push(incident.end)
    incidents.error.push(incident.error)
  }

  shiftIncident(monitorId: string) {
    const incidents = this.data.incident[monitorId]
    if (!incidents) return
    incidents.start.shift()
    incidents.end.shift()
    incidents.error.shift()
  }

  unshiftIncident(monitorId: string, incident: IncidentRecord) {
    let incidents = this.data.incident[monitorId]
    if (!incidents) {
      this.data.incident[monitorId] = {
        start: [],
        end: [],
        error: [],
      }
      incidents = this.data.incident[monitorId]
    }
    incidents.start.unshift(incident.start)
    incidents.end.unshift(incident.end)
    incidents.error.unshift(incident.error)
  }

  latencyLen(monitorId: string): number {
    const latencies = this.data.latency[monitorId]
    if (!latencies || !latencies.ping) return 0
    return latencies.ping.length / 4 // Uint16Array, 4 hex chars per entry
  }

  appendLatency(monitorId: string, record: LatencyRecord) {
    let latencies = this.data.latency[monitorId]
    if (!latencies) {
      this.data.latency[monitorId] = {
        time: '',
        ping: '',
        loc: {
          c: [],
          v: [],
        },
      }
      latencies = this.data.latency[monitorId]
    }

    const clampedPing = Math.max(0, Math.min(65535, Math.round(record.ping || 0)))
    latencies.time += uint8ToHex(new Uint8Array(new Uint32Array([record.time]).buffer))
    latencies.ping += uint8ToHex(new Uint8Array(new Uint16Array([clampedPing]).buffer))

    if (latencies.loc.v[latencies.loc.v.length - 1] !== record.loc) {
      latencies.loc.c.push(1)
      latencies.loc.v.push(record.loc)
    } else {
      latencies.loc.c[latencies.loc.c.length - 1] += 1
    }
  }

  getFirstLatency(monitorId: string): LatencyRecord {
    const latencies = this.data.latency[monitorId]
    if (!latencies || latencies.time.length < 8 || latencies.ping.length < 4) {
      return { time: Infinity, ping: 0, loc: 'N/A' }
    }
    const timeBytes = hexToUint8(latencies.time.slice(0, 8))
    const pingBytes = hexToUint8(latencies.ping.slice(0, 4))
    return {
      time: new Uint32Array(timeBytes.buffer, timeBytes.byteOffset, 1)[0],
      ping: new Uint16Array(pingBytes.buffer, pingBytes.byteOffset, 1)[0],
      loc: latencies.loc.v[0] ?? 'CF',
    }
  }

  getLastLatency(monitorId: string): LatencyRecord {
    const latencies = this.data.latency[monitorId]
    if (!latencies || latencies.time.length < 8 || latencies.ping.length < 4) {
      return { time: 0, ping: 0, loc: 'N/A' }
    }
    const timeBytes = hexToUint8(latencies.time.slice(-8))
    const pingBytes = hexToUint8(latencies.ping.slice(-4))
    return {
      time: new Uint32Array(timeBytes.buffer, timeBytes.byteOffset, 1)[0],
      ping: new Uint16Array(pingBytes.buffer, pingBytes.byteOffset, 1)[0],
      loc: latencies.loc.v[latencies.loc.v.length - 1] ?? 'CF',
    }
  }

  unshiftLatency(monitorId: string) {
    const latencies = this.data.latency[monitorId]
    if (!latencies || latencies.time.length < 8) return

    latencies.time = latencies.time.slice(8)
    latencies.ping = latencies.ping.slice(4)

    if (latencies.loc.c.length > 0) {
      latencies.loc.c[0] -= 1
      if (latencies.loc.c[0] <= 0) {
        latencies.loc.c.shift()
        latencies.loc.v.shift()
      }
    }
  }
}
