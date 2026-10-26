import { maintenances, workerConfig } from '@/uptime.config'
import { NextRequest } from 'next/server'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'

export const runtime = 'edge'

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
}

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  const compactedState = new CompactedMonitorStateWrapper(
    await getFromStore(process.env as any, 'state')
  )

  if (compactedState.data.lastUpdate === 0) {
    return new Response(JSON.stringify({ error: 'No data available' }), {
      status: 500,
      headers,
    })
  }

  const monitors: Record<string, any> = {}

  for (const monitor of workerConfig.monitors) {
    const len = compactedState.incidentLen(monitor.id)
    const lastIncident = len > 0 ? compactedState.getIncident(monitor.id, len - 1) : null

    const isUp = !lastIncident || lastIncident.end !== null
    const latency = compactedState.getLastLatency(monitor.id)
    monitors[monitor.id] = {
      name: monitor.name,
      up: isUp,
      latency: latency.ping,
      location: latency.loc,
      message: isUp ? 'OK' : lastIncident?.error?.[lastIncident.error.length - 1] ?? 'DOWN',
    }
  }

  const ret = {
    up: compactedState.data.overallUp,
    down: compactedState.data.overallDown,
    updatedAt: compactedState.data.lastUpdate,
    monitors,
    maintenances,
  }

  return new Response(JSON.stringify(ret), {
    headers,
  })
}
