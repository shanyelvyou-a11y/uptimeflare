import { DurableObject } from 'cloudflare:workers'
import { MonitorTarget } from '../../types/config'
import { workerConfig } from '../../uptime.config'
import { doMonitor, getStatus } from './monitor'
import { formatAndNotify, getWorkerLocation } from './util'
import { CompactedMonitorStateWrapper, getFromStore, setToStore } from './store'
import pLimit from 'p-limit'

export interface Env {
  REMOTE_CHECKER_DO: DurableObjectNamespace<RemoteChecker>
  UPTIMEFLARE_D1: D1Database
  BRIDGE_SECRET?: string
}

const DEFAULT_BRIDGE_SECRET = ''

const corsHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, max-age=0',
}

async function runMonitorCycle(env: Env): Promise<{
  location: string
  overallUp: number
  overallDown: number
  lastUpdate: number
  statusChanged: boolean
  durationMs: number
}> {
  const cycleStart = Date.now()
  const workerLocation = (await getWorkerLocation()) || 'CF-EDGE'
  console.log(`Running scheduled monitor cycle on ${workerLocation}...`)

  const state = new CompactedMonitorStateWrapper(await getFromStore(env, 'state'))
  state.data.overallDown = 0
  state.data.overallUp = 0

  let statusChanged = false
  const currentTimeSecond = Math.round(Date.now() / 1000)

  type CheckResult = {
    id: string
    location: string
    status: { ping: number; up: boolean; err: string }
  }
  const checkQueue: Promise<CheckResult>[] = []
  const checkResult: Record<string, CheckResult> = {}
  const limit = pLimit(5)

  for (const monitor of workerConfig.monitors) {
    checkQueue.push(limit(() => doMonitor(monitor, workerLocation, env)))
  }
  for (const result of await Promise.all(checkQueue)) {
    checkResult[result.id] = result
  }

  for (const monitor of workerConfig.monitors) {
    console.log(`Processing monitor result: ${monitor.name} (${monitor.id})`)

    let monitorStatusChanged = false
    const { location: checkLocation, status } = checkResult[monitor.id]

    status.up ? state.data.overallUp++ : state.data.overallDown++

    if (state.incidentLen(monitor.id) === 0) {
      state.appendIncident(monitor.id, {
        start: [currentTimeSecond],
        end: currentTimeSecond,
        error: ['dummy'],
      })
    }

    const lastIncident = state.getIncident(monitor.id, state.incidentLen(monitor.id) - 1)

    if (status.up) {
      if (lastIncident && lastIncident.end === null) {
        lastIncident.end = currentTimeSecond
        state.setIncident(monitor.id, state.incidentLen(monitor.id) - 1, lastIncident)

        monitorStatusChanged = true
        try {
          if (
            workerConfig.notification?.gracePeriod === undefined ||
            currentTimeSecond - lastIncident.start[0] >=
              (workerConfig.notification.gracePeriod + 1) * 60 - 30
          ) {
            await formatAndNotify(monitor, true, lastIncident.start[0], currentTimeSecond, 'OK')
          }

          await workerConfig.callbacks?.onStatusChange?.(
            env,
            monitor,
            true,
            lastIncident.start[0],
            currentTimeSecond,
            'OK'
          )
        } catch (e) {
          console.log('Error calling recovery callback:', e)
        }
      }
    } else {
      if (!lastIncident || lastIncident.end !== null) {
        state.appendIncident(monitor.id, {
          start: [currentTimeSecond],
          end: null,
          error: [status.err],
        })
        monitorStatusChanged = true
      } else if (lastIncident.end === null && lastIncident.error.slice(-1)[0] !== status.err) {
        lastIncident.start.push(currentTimeSecond)
        lastIncident.error.push(status.err)
        state.setIncident(monitor.id, state.incidentLen(monitor.id) - 1, lastIncident)
        monitorStatusChanged = true
      }

      const currentIncident = state.getIncident(monitor.id, state.incidentLen(monitor.id) - 1)
      try {
        if (
          (monitorStatusChanged &&
            (workerConfig.notification?.gracePeriod === undefined ||
              currentTimeSecond - currentIncident.start[0] >=
                (workerConfig.notification.gracePeriod + 1) * 60 - 30)) ||
          (workerConfig.notification?.gracePeriod !== undefined &&
            currentTimeSecond - currentIncident.start[0] >=
              workerConfig.notification.gracePeriod * 60 - 30 &&
            currentTimeSecond - currentIncident.start[0] <
              workerConfig.notification.gracePeriod * 60 + 30)
        ) {
          if (
            currentIncident.start[0] !== currentTimeSecond &&
            workerConfig.notification?.skipErrorChangeNotification
          ) {
            console.log('Skipping notification for error reason change due to config')
          } else {
            await formatAndNotify(
              monitor,
              false,
              currentIncident.start[0],
              currentTimeSecond,
              status.err
            )
          }
        }

        if (monitorStatusChanged) {
          await workerConfig.callbacks?.onStatusChange?.(
            env,
            monitor,
            false,
            currentIncident.start[0],
            currentTimeSecond,
            status.err
          )
        }
      } catch (e) {
        console.log('Error calling status change callback:', e)
      }

      try {
        await workerConfig.callbacks?.onIncident?.(
          env,
          monitor,
          currentIncident.start[0],
          currentTimeSecond,
          status.err
        )
      } catch (e) {
        console.log('Error calling incident callback:', e)
      }
    }

    state.appendLatency(monitor.id, {
      loc: checkLocation,
      ping: status.ping,
      time: currentTimeSecond,
    })

    while (
      state.latencyLen(monitor.id) > 0 &&
      state.getFirstLatency(monitor.id).time < currentTimeSecond - 12 * 60 * 60
    ) {
      state.unshiftLatency(monitor.id)
    }

    while (
      state.incidentLen(monitor.id) > 0 &&
      state.getIncident(monitor.id, 0)?.end &&
      state.getIncident(monitor.id, 0).end! < currentTimeSecond - 90 * 24 * 60 * 60
    ) {
      state.shiftIncident(monitor.id)
    }

    if (
      state.incidentLen(monitor.id) === 0 ||
      (state.getIncident(monitor.id, 0).start[0] > currentTimeSecond - 90 * 24 * 60 * 60 &&
        state.getIncident(monitor.id, 0).error[0] !== 'dummy')
    ) {
      state.unshiftIncident(monitor.id, {
        start: [currentTimeSecond - 90 * 24 * 60 * 60],
        end: currentTimeSecond - 90 * 24 * 60 * 60,
        error: ['dummy'],
      })
    }

    statusChanged ||= monitorStatusChanged
  }

  if (
    statusChanged ||
    currentTimeSecond - state.data.lastUpdate >=
      (workerConfig.kvWriteCooldownMinutes ?? 3) * 60 - 10
  ) {
    console.log('Writing updated compacted state to D1...')
    state.data.lastUpdate = currentTimeSecond
    await setToStore(env, 'state', state.getCompactedStateStr())
  } else {
    console.log('Skipping state write due to cooldown period.')
  }

  return {
    location: workerLocation,
    overallUp: state.data.overallUp,
    overallDown: state.data.overallDown,
    lastUpdate: state.data.lastUpdate,
    statusChanged,
    durationMs: Date.now() - cycleStart,
  }
}

const Worker = {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await runMonitorCycle(env)
  },
}

export default {
  ...Worker,
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)
    const secret = env.BRIDGE_SECRET || DEFAULT_BRIDGE_SECRET

    // 1. Bridge trigger endpoint (supports both async background trigger and ?sync=1 awaited JSON response)
    if (url.pathname === '/__trigger') {
      if (url.searchParams.get('key') !== secret) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized trigger key' }), {
          status: 401,
          headers: corsHeaders,
        })
      }
      if (url.searchParams.get('sync') === '1') {
        const summary = await runMonitorCycle(env)
        return new Response(JSON.stringify({ ok: true, mode: 'sync', ...summary }), {
          status: 200,
          headers: corsHeaders,
        })
      }
      ctx.waitUntil(runMonitorCycle(env))
      return new Response('triggered', { status: 200 })
    }

    // 2. Worker health & D1 state summary endpoint
    if (url.pathname === '/__health' || url.pathname === '/api/health') {
      const state = new CompactedMonitorStateWrapper(await getFromStore(env, 'state'))
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'UptimeFlare Worker Pro 2.0',
          monitorsConfigured: workerConfig.monitors.length,
          overallUp: state.data.overallUp,
          overallDown: state.data.overallDown,
          lastUpdate: state.data.lastUpdate,
          lastUpdateIso:
            state.data.lastUpdate > 0 ? new Date(state.data.lastUpdate * 1000).toISOString() : null,
        }),
        { status: 200, headers: corsHeaders }
      )
    }

    return new Response('UptimeFlare Monitor Worker Pro 2.0', { status: 200 })
  },
}

export class RemoteChecker extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  async getLocationAndStatus(
    monitor: MonitorTarget
  ): Promise<{ location: string; status: { ping: number; up: boolean; err: string } }> {
    const colo = (await getWorkerLocation()) as string
    console.log(`Running remote checker (DurableObject) at ${colo}...`)
    const status = await getStatus(monitor)
    return {
      location: colo,
      status: status,
    }
  }

  async kill() {
    this.ctx.blockConcurrencyWhile(async () => {
      throw 'killed'
    })
  }
}
