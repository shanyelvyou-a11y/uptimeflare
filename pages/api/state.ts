import { NextRequest } from 'next/server'
import { getFromStore } from '@/worker/src/store'

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
  try {
    const compactedStateStr = await getFromStore(process.env as any, 'state')
    return new Response(JSON.stringify({ compactedStateStr }), {
      status: 200,
      headers,
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ compactedStateStr: null, error: err?.message || 'Failed to read state' }),
      { status: 500, headers }
    )
  }
}
