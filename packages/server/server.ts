/**
 * 🌐 Rip Server - HTTP Server and Load Balancer
 *
 * High-performance HTTP server that load balances requests across Rip workers.
 * Features intelligent 503 failover for perfect sequential processing.
 *
 * Key Features:
 * - Round-robin load balancing with automatic worker failover
 * - Intelligent 503 handling: busy worker → try next worker
 * - Unix sockets for maximum performance
 * - Health checks and metrics endpoints
 * - Perfect isolation support for sequential processing
 *
 * This is the FRONT-END of the architecture - clients connect here.
 *
 * Usage: bun server.ts [serverId] [port] [numWorkers] [httpsPort] [certPath] [keyPath]
 */

// Configuration
const serverId = Number.parseInt(process.argv[2] ?? '0')
const serverNum = serverId + 1 // Human-friendly server number (1-indexed)

// Set process title for better visibility
process.title = `rip-server-${serverNum}`
const port = Number.parseInt(process.argv[3]) || 3000
const numWorkers = Number.parseInt(process.argv[4]) || 3
const httpsPort = Number.parseInt(process.argv[5]) || 3443
const certPath = process.argv[6] // Optional: path to SSL certificate
const keyPath = process.argv[7] // Optional: path to SSL private key

// HTTPS Configuration
const httpsEnabled = certPath && keyPath
let cert: string | undefined
let key: string | undefined

if (httpsEnabled) {
  try {
    cert = await Bun.file(certPath).text()
    key = await Bun.file(keyPath).text()
    // HTTPS cert loaded silently - details shown in start.sh
  } catch (error) {
    console.error(`❌ [Server] Failed to load HTTPS certificates: ${error}`)
    console.error(`   Cert path: ${certPath}`)
    console.error(`   Key path: ${keyPath}`)
    process.exit(1)
  }
}

// Generate worker socket paths
const workerSocketPaths = Array.from(
  { length: numWorkers },
  (_, i) => `/tmp/rip_worker_${i}.sock`,
)

let currentWorker = 0
let totalRequests = 0
const workerStats = new Map<string, { requests: number; errors: number }>()

// Initialize worker stats
workerSocketPaths.forEach(path => {
  workerStats.set(path, { requests: 0, errors: 0 })
})

/**
 * Wait for at least one worker to become ready (basic gating to reduce cold-start 503s)
 */
async function isWorkerReady(socketPath: string): Promise<boolean> {
  try {
    // Any successful fetch over the unix socket indicates the worker is up
    // Use a short timeout to keep polling responsive
    const res = await fetch('http://localhost/', {
      unix: socketPath,
      signal: AbortSignal.timeout(300),
    })
    // If we got a response at all, the worker is reachable
    return !!res
  } catch {
    return false
  }
}

async function waitForAnyWorkerReady(
  paths: string[],
  maxWaitMs = 5000,
  intervalMs = 150,
): Promise<boolean> {
  const start = Date.now()
  let announced = false
  while (Date.now() - start < maxWaitMs) {
    for (const p of paths) {
      if (await isWorkerReady(p)) {
        if (announced) {
          const ts = new Date()
          const t = `${ts.toISOString().slice(0, 23).replace('T', ' ')}${ts.getTimezoneOffset() <= 0 ? '+' : '-'}${String(Math.abs(Math.floor(ts.getTimezoneOffset() / 60))).padStart(2, '0')}:${String(Math.abs(ts.getTimezoneOffset() % 60)).padStart(2, '0')}`
          console.log(`[${t}              ] Worker ready detected on ${p}`)
        }
        return true
      }
    }
    if (!announced) {
      const ts = new Date()
      const t = `${ts.toISOString().slice(0, 23).replace('T', ' ')}${ts.getTimezoneOffset() <= 0 ? '+' : '-'}${String(Math.abs(Math.floor(ts.getTimezoneOffset() / 60))).padStart(2, '0')}:${String(Math.abs(ts.getTimezoneOffset() % 60)).padStart(2, '0')}`
      console.log(`[${t}              ] Waiting for worker readiness (up to ${maxWaitMs}ms)...`)
      announced = true
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  const ts = new Date()
  const t = `${ts.toISOString().slice(0, 23).replace('T', ' ')}${ts.getTimezoneOffset() <= 0 ? '+' : '-'}${String(Math.abs(Math.floor(ts.getTimezoneOffset() / 60))).padStart(2, '0')}:${String(Math.abs(ts.getTimezoneOffset() % 60)).padStart(2, '0')}`
  console.warn(`[${t}              ] No workers ready after ${maxWaitMs}ms; starting front-end anyway`)
  return false
}

/**
 * 🎯 Canonical timing formatter (shared across endpoints)
 */
const scale = (value: number, unit: string, base = 1000): string => {
  if (value === 0) return `  - ${unit}`

  const prefixes = ['G', 'M', 'K', '', 'm', 'µ', 'n']
  let slot = 5 // Start at "µ" (microseconds)
  let show = value // Value is already in microseconds

  // Scale down to smaller units (ms, µs, ns)
  while (show > 0 && show < 1.0 && slot < 6) {
    show *= base
    slot += 1
  }

  // Scale up to larger units (Ks, Ms, Gs)
  while (show >= base && slot > 0) {
    show /= base
    slot -= 1
  }

  if (slot < 0 || slot > 6) return '(ovflow)'

  let digits
  if (show < 10) {
    digits = show.toFixed(1)
  } else if (show < 100) {
    digits = ` ${Math.round(show).toString()}`
  } else {
    digits = Math.round(show).toString()
  }

  const prefix = prefixes[slot]
  const separator = prefix === '' ? ' ' : ''

  return `${digits}${separator}${prefix}${unit}`
}

/**
 * Health check endpoint (with logging)
 */
const handleHealthCheck = (req: Request) => {
  const url = new URL(req.url)
  const startDate = new Date()
  const startTime = performance.now()

  if (url.pathname === '/health') {
    const stats = {
      status: 'healthy',
      totalRequests,
      workers: numWorkers,
      workerStats: Object.fromEntries(workerStats),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }

    const response = new Response(JSON.stringify(stats, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })

    // Log the health check request with consistent timing format
    const processingEnd = performance.now()
    const processingTime = (processingEnd - startTime) * 1000 // Convert to microseconds

    // Measure response transmission (minimal for direct responses, but consistent)
    const _responseStart = performance.now()
    const responseTime = 50 // Estimate ~50µs for direct response (minimal transmission)

    const timestamp = `${
      startDate.toISOString().slice(0, 23).replace('T', ' ') +
      (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
      String(Math.abs(Math.floor(startDate.getTimezoneOffset() / 60))).padStart(
        2,
        '0',
      )
    }:${String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0')}`

    // Use shared timing formatter

    const processingFormatted = scale(processingTime, 's').padStart(6)
    const responseFormatted = scale(responseTime, 's').padStart(6)

    console.log(
      `[${timestamp} ${processingFormatted} ${responseFormatted}] S${serverNum}.1 ${req.method} /health → 200 json ${JSON.stringify(stats).length}B`,
    )

    return response
  }

  if (url.pathname === '/metrics') {
    const metrics = [
      '# Rip Server Metrics',
      `rip_total_requests ${totalRequests}`,
      `rip_workers_total ${numWorkers}`,
      `rip_uptime_seconds ${process.uptime()}`,
      ...Array.from(workerStats.entries()).map(
        ([path, stats]) =>
          `rip_worker_requests{worker="${path}"} ${stats.requests}`,
      ),
      ...Array.from(workerStats.entries()).map(
        ([path, stats]) =>
          `rip_worker_errors{worker="${path}"} ${stats.errors}`,
      ),
    ].join('\n')

    const response = new Response(metrics, {
      headers: { 'Content-Type': 'text/plain' },
    })

    // Log the metrics request with consistent timing format
    const processingEnd = performance.now()
    const processingTime = (processingEnd - startTime) * 1000 // Convert to microseconds

    // Measure response transmission (minimal for direct responses, but consistent)
    const responseTime = 40 // Estimate ~40µs for direct response (minimal transmission)

    const timestamp = `${
      startDate.toISOString().slice(0, 23).replace('T', ' ') +
      (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
      String(Math.abs(Math.floor(startDate.getTimezoneOffset() / 60))).padStart(
        2,
        '0',
      )
    }:${String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0')}`

    // Use shared timing formatter
    const processingFormatted = scale(processingTime, 's').padStart(6)
    const responseFormatted = scale(responseTime, 's').padStart(6)

    console.log(
      `[${timestamp} ${processingFormatted} ${responseFormatted}] S${serverNum}.1 ${req.method} /metrics → 200 plain ${metrics.length}B`,
    )

    return response
  }

  return null // Not a health/metrics request
}

/**
 * Shared request handler for both HTTP and HTTPS
 */
const handleRequest = async (req: Request) => {
  totalRequests++

  // Handle health check and metrics endpoints
  const healthResponse = handleHealthCheck(req)
  if (healthResponse) return healthResponse

  const url = new URL(req.url)
  const _requestStart = performance.now()
  const startDate = new Date()

  // Round-robin load balancing with automatic failover
  for (let attempts = 0; attempts < workerSocketPaths.length; attempts++) {
    const socketPath = workerSocketPaths[currentWorker]
    const nextWorker = (currentWorker + 1) % workerSocketPaths.length
    currentWorker = nextWorker

    const stats = workerStats.get(socketPath)!

    try {
      // Forward request to worker via Unix socket
      const workerStart = performance.now()
      const workerResponse = await fetch(
        `http://localhost${url.pathname}${url.search}`,
        {
          method: req.method,
          headers: req.headers,
          body: req.body,
          unix: socketPath,
        },
      )
      const workerEnd = performance.now()

      // Update stats
      stats.requests++
      const workerRequestNum = stats.requests // Current request number for this worker

      // 🎯 Intelligent 503 Failover: If worker is busy, try next worker
      if (workerResponse.status === 503) {
        const timestamp = `${
          startDate.toISOString().slice(0, 23).replace('T', ' ') +
          (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
          String(
            Math.abs(Math.floor(startDate.getTimezoneOffset() / 60)),
          ).padStart(2, '0')
        }:${String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0')}`
        console.log(
          `[${timestamp}              ] ⏸️  Worker ${socketPath} busy (503) - trying next worker...`,
        )

        // Don't return yet, let the loop try the next worker
        continue
      }

      // Clone response to return to client while we handle logging
      const responseToReturn = workerResponse.clone()

      // Start response transmission timing
      const responseStart = performance.now()

      // Schedule detailed logging after response is fully sent
      setImmediate(() => {
        const responseEnd = performance.now()

        // 📊 Meaningful timing breakdown (in microseconds)
        const workerTime = (workerEnd - workerStart) * 1000 // Worker processing time in µs
        const transmissionTime = (responseEnd - responseStart) * 1000 // Response transmission time in µs

        // 🎯 Canonical timing formatter (inspired by your Ruby scale function!)
        const scale = (value: number, unit: string, base = 1000): string => {
          if (value === 0) {
            // Dash in rightmost position of 3-char format + separator space for seconds + unit
            return `  - ${unit}` // 2 spaces + dash + space + unit (assuming seconds)
          }

          const prefixes = ['G', 'M', 'K', '', 'm', 'µ', 'n']
          let slot = 5 // Start at "µ" (microseconds)
          let show = value // Value is already in microseconds

          // Scale down to smaller units (ms, µs, ns)
          while (show > 0 && show < 1.0 && slot < 6) {
            show *= base
            slot += 1
          }

          // Scale up to larger units (Ks, Ms, Gs)
          while (show >= base && slot > 0) {
            show /= base
            slot -= 1
          }

          if (slot < 0 || slot > 6) return '(ovflow)'

          // 3-character digit formatting
          let digits
          if (show < 10) {
            digits = show.toFixed(1) // "3.2"
          } else if (show < 100) {
            digits = ` ${Math.round(show).toString()}` // " 27"
          } else {
            digits = Math.round(show).toString() // "320"
          }

          const prefix = prefixes[slot]
          const separator = prefix === '' ? ' ' : '' // Space separator only for seconds (empty prefix)

          return `${digits}${separator}${prefix}${unit}`
        }

        const timestamp = `${
          startDate.toISOString().slice(0, 23).replace('T', ' ') +
          (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
          String(
            Math.abs(Math.floor(startDate.getTimezoneOffset() / 60)),
          ).padStart(2, '0')
        }:${String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0')}`

        // Clean 2-duration timing display with microsecond precision
        const workerFormatted = scale(workerTime, 's') // Worker processing time
        const transmissionFormatted = scale(transmissionTime, 's') // Response transmission time

        const workerNum =
          Number.parseInt(socketPath.match(/worker_(\d+)\.sock$/)?.[1] || '0') +
          1
        const method = req.method
        const path = url.pathname
        const status = workerResponse.status
        const contentType =
          workerResponse.headers.get('content-type') || 'unknown'
        const contentLength =
          workerResponse.headers.get('content-length') || '?'

        // Format content type (shorten common ones)
        const shortType = contentType
          .split(';')[0]
          .replace('application/', '')
          .replace('text/', '')
          .replace('image/', 'img/')
          .substring(0, 8)

        // Pad timing info for consistent bracket alignment (timing inside brackets)
        const paddedWorker = workerFormatted.padStart(6) // "  2.2ms" or " 1.5ms"
        const paddedTransmission = transmissionFormatted.padStart(6) // "  40µs" or " 120µs"

        console.log(
          `[${timestamp} ${paddedWorker} ${paddedTransmission}] W${workerNum}.${workerRequestNum} ${method} ${path} → ${status} ${shortType} ${contentLength}B`,
        )
      })

      // Worker available - return the response immediately
      return responseToReturn
    } catch (error) {
      // Update error stats
      stats.errors++

      const timestamp = `${
        startDate.toISOString().slice(0, 23).replace('T', ' ') +
        (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
        String(
          Math.abs(Math.floor(startDate.getTimezoneOffset() / 60)),
        ).padStart(2, '0')
      }:${String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0')}`
      console.error(
        `[${timestamp}              ] ⚠️  Worker ${socketPath} failed: ${error.message}`,
      )

      // Try next worker (automatic failover)
      if (attempts === workerSocketPaths.length - 1) {
        // All workers failed
        const timestamp = `${
          startDate.toISOString().slice(0, 23).replace('T', ' ') +
          (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
          String(
            Math.abs(Math.floor(startDate.getTimezoneOffset() / 60)),
          ).padStart(2, '0')
        }:${String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0')}`
        console.error(
          `[${timestamp}              ] 🚨 All ${workerSocketPaths.length} workers unavailable!`,
        )

        return new Response(
          `🚨 Rip Server Error: All workers unavailable\n\nTried ${workerSocketPaths.length} workers, all failed.\nLast error: ${error.message}\n\nIs the manager running? (bun manager.ts)`,
          {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          },
        )
      }
    }
  }

  // 🚨 All workers are busy - return 503 to client
  const now = new Date()
  const timestamp = `${
    now.toISOString().slice(0, 23).replace('T', ' ') +
    (now.getTimezoneOffset() <= 0 ? '+' : '-') +
    String(Math.abs(Math.floor(now.getTimezoneOffset() / 60))).padStart(2, '0')
  }:${String(Math.abs(now.getTimezoneOffset() % 60)).padStart(2, '0')}`
  console.warn(
    `[${timestamp}              ] 🚨 All ${workerSocketPaths.length} workers are busy - returning 503 to client`,
  )
  return new Response(
    `🚨 All Workers Busy\n\nAll ${workerSocketPaths.length} workers are currently processing requests.\nThis ensures perfect isolation - please retry in a moment.\n\nTip: Each worker processes one request at a time for maximum reliability.`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/plain',
        'Retry-After': '1',
      },
    },
  )
}

/**
 * HTTP redirect handler (when HTTPS is primary)
 */
const handleHttpRedirect = (req: Request) => {
  const url = new URL(req.url)
  const httpsUrl = `https://localhost:${httpsPort}${url.pathname}${url.search}`

  return new Response(null, {
    status: 302,
    headers: {
      Location: httpsUrl,
      'Cache-Control': 'no-cache',
    },
  })
}

/**
 * Create servers
 */
const servers: any[] = []

// Basic readiness gating: wait briefly for a worker to be reachable to reduce initial 503s
await waitForAnyWorkerReady(workerSocketPaths)

if (httpsEnabled && cert && key) {
  // HTTPS mode: Primary HTTPS server + HTTP redirect server

  // Primary HTTPS server (full functionality)
  const httpsServer = Bun.serve({
    port: httpsPort,
    fetch: handleRequest,
    tls: {
      cert,
      key,
    },
  })
  servers.push(httpsServer)

  // HTTP redirect server (302 redirects to HTTPS)
  const httpRedirectServer = Bun.serve({
    port,
    fetch: handleHttpRedirect,
  })
  servers.push(httpRedirectServer)
} else {
  // HTTP-only mode (full functionality)
  const httpServer = Bun.serve({
    port,
    fetch: handleRequest,
  })
  servers.push(httpServer)
}

import { formatTimestamp as formatTs } from './time'
// Add proper server startup logging (real timezone)
const getTimestamp = () => formatTs()

// Announce when server is actually ready (after port binds)
setTimeout(() => {
  console.log(`[${getTimestamp()}              ] S${serverNum} ready`)
}, 100)

/**
 * Graceful shutdown
 */
const gracefulShutdown = (_signal: string) => {
  // Stop all servers
  servers.forEach(server => {
    if (server) {
      server.stop()
    }
  })

  setTimeout(() => {
    process.exit(0)
  }, 1000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Server startup (no console output - handled by start.sh)
