import { Env } from '.'
import { MonitorTarget } from '../../types/config'
import { withTimeout, fetchTimeout } from './util'

function isIpAddress(hostname: string): boolean {
  if (hostname.includes(':')) return true

  const parts = hostname.split('.')
  if (parts.length !== 4) return false

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function getDomainOnlyIpVersionOption(hostname: string, gpUrl: URL): { ipVersion?: number } {
  if (isIpAddress(hostname)) return {}
  return { ipVersion: Number(gpUrl.searchParams.get('ipVersion') || 4) }
}

async function httpResponseBasicCheck(
  monitor: MonitorTarget,
  code: number,
  bodyReader: () => Promise<string>
): Promise<string | null> {
  if (monitor.expectedCodes) {
    if (!monitor.expectedCodes.includes(code)) {
      return `Expected codes: ${JSON.stringify(monitor.expectedCodes)}, Got: ${code}`
    }
  } else {
    if (code < 200 || code > 299) {
      return `Expected codes: 2xx, Got: ${code}`
    }
  }

  if (monitor.responseKeyword || monitor.responseForbiddenKeyword) {
    const responseBody = await bodyReader()

    if (monitor.responseKeyword && !responseBody.includes(monitor.responseKeyword)) {
      console.log(
        `${monitor.name} expected keyword ${
          monitor.responseKeyword
        }, not found in response (truncated to 100 chars): ${responseBody.slice(0, 100)}`
      )
      return "HTTP response doesn't contain the configured keyword"
    }

    if (
      monitor.responseForbiddenKeyword &&
      responseBody.includes(monitor.responseForbiddenKeyword)
    ) {
      console.log(
        `${monitor.name} forbidden keyword ${
          monitor.responseForbiddenKeyword
        }, found in response (truncated to 100 chars): ${responseBody.slice(0, 100)}`
      )
      return 'HTTP response contains the configured forbidden keyword'
    }
  }

  return null
}

export async function getStatusWithGlobalPing(
  monitor: MonitorTarget
): Promise<{ location: string; status: { ping: number; up: boolean; err: string } }> {
  try {
    if (monitor.checkProxy === undefined) {
      throw "empty check proxy for globalping, shouldn't call this method"
    }

    const gpUrl = new URL(monitor.checkProxy)
    if (gpUrl.protocol !== 'globalping:') {
      throw 'incorrect check proxy protocol for globalping, got: ' + gpUrl.protocol
    }

    const token = gpUrl.hostname
    let globalPingRequest = {}

    if (monitor.method === 'TCP_PING') {
      const targetUrl = new URL('https://' + monitor.target)
      const ipVersionOption = getDomainOnlyIpVersionOption(targetUrl.hostname, gpUrl)
      globalPingRequest = {
        type: 'ping',
        target: targetUrl.hostname,
        locations:
          gpUrl.searchParams.get('magic') !== null
            ? [
                {
                  magic: gpUrl.searchParams.get('magic'),
                },
              ]
            : undefined,
        measurementOptions: {
          port: targetUrl.port,
          packets: 1,
          protocol: 'tcp',
          ...ipVersionOption,
        },
      }
    } else {
      const targetUrl = new URL(monitor.target)
      const ipVersionOption = getDomainOnlyIpVersionOption(targetUrl.hostname, gpUrl)
      if (monitor.body !== undefined) {
        throw 'custom body not supported'
      }
      if (monitor.method && !['GET', 'HEAD', 'OPTIONS'].includes(monitor.method.toUpperCase())) {
        throw 'only GET, HEAD, OPTIONS methods are supported'
      }
      globalPingRequest = {
        type: 'http',
        target: targetUrl.hostname,
        locations:
          gpUrl.searchParams.get('magic') !== null
            ? [
                {
                  magic: gpUrl.searchParams.get('magic'),
                },
              ]
            : undefined,
        measurementOptions: {
          request: {
            method: monitor.method,
            path: targetUrl.pathname,
            query: targetUrl.search === '' ? undefined : targetUrl.search,
            headers: Object.fromEntries(
              Object.entries(monitor.headers ?? {}).map(([key, value]) => [key, String(value)])
            ),
          },
          port:
            targetUrl.port === ''
              ? targetUrl.protocol === 'http:'
                ? 80
                : 443
              : Number(targetUrl.port),
          protocol: targetUrl.protocol.replace(':', ''),
          ...ipVersionOption,
        },
      }
    }

    const startTime = Date.now()
    const measurement = await fetchTimeout('https://api.globalping.io/v1/measurements', 5000, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(globalPingRequest),
    })
    const measurementResponse = (await measurement.json()) as any

    if (measurement.status !== 202) {
      throw measurementResponse.error.message
    }

    const measurementId = measurementResponse.id
    console.log(
      `Measurement created successfully, id: ${measurementId}, time elapsed: ${
        Date.now() - startTime
      }ms`
    )

    const pollStart = Date.now()
    let measurementResult: any
    while (true) {
      if (Date.now() - pollStart > (monitor.timeout ?? 10000) + 2000) {
        throw 'api polling timeout'
      }

      measurementResult = (await (
        await fetchTimeout(`https://api.globalping.io/v1/measurements/${measurementId}`, 5000)
      ).json()) as any
      if (measurementResult.status !== 'in-progress') {
        break
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    if (
      measurementResult.status !== 'finished' ||
      measurementResult.results[0].result.status !== 'finished'
    ) {
      throw `status [${measurementResult.status}|${
        measurementResult.results[0].result.status
      }]: ${measurementResult.results?.[0].result?.rawOutput?.slice(0, 64)}`
    }

    const country = measurementResult.results[0].probe.country
    const city = measurementResult.results[0].probe.city

    if (monitor.method === 'TCP_PING') {
      const time = Math.round(measurementResult.results[0].result.stats.avg)
      return {
        location: country + '/' + city,
        status: {
          ping: time,
          up: true,
          err: '',
        },
      }
    } else {
      const time = measurementResult.results[0].result.timings.total
      const code = measurementResult.results[0].result.statusCode
      const body = measurementResult.results[0].result.rawBody

      let err = await httpResponseBasicCheck(monitor, code, () => body)
      if (
        monitor.target.toLowerCase().startsWith('https') &&
        !measurementResult.results[0].result.tls.authorized
      ) {
        err = 'TLS certificate not trusted: ' + measurementResult.results[0].result.tls.error
      }

      return {
        location: country + '/' + city,
        status: {
          ping: time,
          up: err === null,
          err: err ?? '',
        },
      }
    }
  } catch (e: any) {
    console.log(`Globalping ${monitor.name} errored with ${e}`)
    return {
      location: 'ERROR',
      status: {
        ping: e.toString().toLowerCase().includes('timeout') ? monitor.timeout ?? 10000 : 0,
        up: false,
        err: 'Globalping error: ' + e.toString(),
      },
    }
  }
}

async function getStatusSingleAttempt(
  monitor: MonitorTarget
): Promise<{ ping: number; up: boolean; err: string }> {
  let status = {
    ping: 0,
    up: false,
    err: 'Unknown',
  }

  const startTime = Date.now()

  if (monitor.method === 'TCP_PING') {
    try {
      const connect = await import(/* webpackIgnore: true */ 'cloudflare:sockets').then(
        (sockets) => sockets.connect
      )
      const parsed = new URL('https://' + monitor.target)
      const socket = connect({ hostname: parsed.hostname, port: Number(parsed.port) })

      await withTimeout(monitor.timeout || 10000, socket.opened)
      await socket.close()

      status.ping = Date.now() - startTime
      status.up = true
      status.err = ''
    } catch (e: Error | any) {
      if (e.message?.includes('timed out')) {
        status.ping = monitor.timeout || 10000
      }
      status.up = false
      status.err = e.name + ': ' + e.message
    }
  } else {
    try {
      const headers = new Headers(monitor.headers as any)
      if (!headers.has('user-agent')) {
        headers.set('user-agent', 'UptimeFlare-Pro/2.0 (+https://github.com/shanyelvyou-a11y)')
      }
      if (!headers.has('cache-control')) {
        headers.set('cache-control', 'no-cache, no-store, must-revalidate')
      }

      const response = await fetchTimeout(monitor.target, monitor.timeout || 10000, {
        method: monitor.method,
        headers: headers,
        body: monitor.body,
        redirect: 'follow',
        cf: {
          cacheTtl: -1,
          cacheEverything: false,
          cacheTtlByStatus: {
            '100-599': -1,
          },
        },
      })

      status.ping = Date.now() - startTime

      const err = await httpResponseBasicCheck(
        monitor,
        response.status,
        response.text.bind(response)
      )
      try {
        await response.body?.cancel()
      } catch (e) {}

      status.up = err === null
      status.err = err ?? ''
    } catch (e: any) {
      if (e.name === 'AbortError') {
        status.ping = monitor.timeout || 10000
        status.up = false
        status.err = `Timeout after ${status.ping}ms`
      } else {
        status.up = false
        status.err = e.name + ': ' + e.message
      }
    }
  }

  return status
}

export async function getStatus(
  monitor: MonitorTarget
): Promise<{ ping: number; up: boolean; err: string }> {
  const maxRetries = monitor.retries ?? 1
  const retryDelayMs = monitor.retryDelayMs ?? 600

  let lastStatus = await getStatusSingleAttempt(monitor)
  if (lastStatus.up || maxRetries <= 0) {
    return lastStatus
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[${monitor.id}] Initial check failed (${lastStatus.err}), retrying (${attempt}/${maxRetries}) after ${retryDelayMs}ms...`
    )
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    lastStatus = await getStatusSingleAttempt(monitor)
    if (lastStatus.up) {
      console.log(`[${monitor.id}] Recovered on retry #${attempt} (${lastStatus.ping}ms)`)
      return lastStatus
    }
  }

  return lastStatus
}

export async function doMonitor(monitor: MonitorTarget, defaultLocation: string, env: Env) {
  let checkLocation = defaultLocation
  let status

  if (monitor.checkProxy) {
    try {
      console.log(`[${monitor.id}] Calling check proxy: ${monitor.checkProxy}`)
      let resp
      if (monitor.checkProxy.startsWith('worker://')) {
        const doLoc = monitor.checkProxy.replace('worker://', '')
        const doId = env.REMOTE_CHECKER_DO.idFromName(`${doLoc}:${monitor.id}`)
        const doStub = env.REMOTE_CHECKER_DO.get(doId, {
          locationHint: doLoc as DurableObjectLocationHint,
        })
        resp = await doStub.getLocationAndStatus(monitor)
        try {
          await doStub.kill()
        } catch (err) {}
      } else if (monitor.checkProxy.startsWith('globalping://')) {
        resp = await getStatusWithGlobalPing(monitor)
      } else {
        resp = await (
          await fetch(monitor.checkProxy, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(monitor),
          })
        ).json<{ location: string; status: { ping: number; up: boolean; err: string } }>()
      }
      checkLocation = resp.location
      status = resp.status
    } catch (err) {
      console.log(`[${monitor.id}] Error calling proxy: ${err}`)
      if (monitor.checkProxyFallback) {
        console.log('Falling back to local check...')
        status = await getStatus(monitor)
      } else {
        status = { ping: 0, up: false, err: 'Unknown check proxy error' }
      }
    }
  } else {
    status = await getStatus(monitor)
  }

  console.log(
    `[${monitor.id}] Check result from ${checkLocation}: up=${status.up}, ping=${status.ping}, err=${status.err}`
  )

  return {
    location: checkLocation,
    status,
    id: monitor.id,
  }
}
