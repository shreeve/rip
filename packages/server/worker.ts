import { existsSync } from 'fs'
import { join } from 'path'
import {
  formatTimestamp,
  getSharedSocketPath,
  parseEnvInt,
  scale,
} from './utils'

// Configuration
const workerId = Number.parseInt(process.argv[2] ?? '0')
const workerNum = workerId + 1 // Human-friendly worker number (1-indexed)

// Set process title for better visibility
const appName = process.argv[5] || 'unknown'
process.title = `rip-worker-${appName}-${workerNum}`

const baseMaxRequests = Number.parseInt(process.argv[3] ?? '10000') // Much higher for load testing
const appDirectory = process.argv[4] ?? process.cwd()

const maxRequests = baseMaxRequests

// Worker timeout protection (30 seconds per request)
const WORKER_TIMEOUT = 30000

// Worker state tracking
let requestsHandled = 0
let isShuttingDown = false
let requestInProgress = false
const startTime = performance.now() // Track worker lifetime

/**
 * Log worker exit with standardized format
 */
function logWorkerExit(reason: string, details: string): void {
  const { timestamp, timezone } = formatTimestamp()
  const uptimeSeconds = (performance.now() - startTime) / 1000
  const uptimeFormatted = scale(uptimeSeconds, 's')
  const requestsFormatted = scale(requestsHandled, 'r')

  console.log(
    `[${timestamp} ${timezone} ${uptimeFormatted} ${requestsFormatted}] 🔄 Worker ${workerNum} exit → ${reason} (${details})`,
  )
}

// All workers listen on the same shared socket (nginx + unicorn pattern)
const socketPath = process.env.SOCKET_PATH || getSharedSocketPath(appName)

// Note: Socket cleanup is handled by the manager, not individual workers

/**
 * Load the user's Rip application
 */
let ripApp: any = null
let appReady = false

async function loadRipApp(): Promise<void> {
  // Discover entry point (multiple candidates for POLS)
  const candidates = [
    'index.rip',
    'app.rip',
    'server.rip',
    'main.rip',
    'index.ts', // allow TS entry if user prefers
  ]
  let entryPath: string | null = null
  for (const file of candidates) {
    const abs = appDirectory.startsWith('/')
      ? join(appDirectory, file)
      : join(process.cwd(), appDirectory, file)
    if (existsSync(abs)) {
      entryPath = abs
      break
    }
  }
  const indexPath =
    entryPath ||
    (appDirectory.startsWith('/')
      ? join(appDirectory, 'index.rip')
      : join(process.cwd(), appDirectory, 'index.rip'))

  try {
    // Dynamic import to load the .rip application
    // The Rip transpiler should already be loaded via --preload
    const module = await import(indexPath)
    ripApp = module.default || module

    if (!ripApp) {
      throw new Error('No default export found in Rip app')
    }

    appReady = true
  } catch (error) {
    console.error(`❌ [Worker ${workerNum}] Failed to load Rip app:`, error)
    console.error(`   Path: ${indexPath}`)
    console.error(`   CWD: ${process.cwd()}`)
    process.exit(1)
  }
}

/**
 * Handle a single HTTP request
 */
async function handleRequest(req: Request): Promise<Response> {
  if (!ripApp) {
    return new Response('Worker not ready', { status: 503 })
  }

  requestInProgress = true
  let timeoutId: Timer | undefined
  const start = Date.now()

  try {
    // Set up request timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Request timeout'))
      }, WORKER_TIMEOUT)
    })

    // Handle the request
    const requestPromise = (async () => {
      if (typeof ripApp === 'function') {
        return await ripApp(req)
      } else if (ripApp && typeof ripApp.fetch === 'function') {
        return await ripApp.fetch(req)
      } else {
        return new Response('Invalid Rip app', { status: 500 })
      }
    })()

    // Race between request and timeout
    const response = await Promise.race([requestPromise, timeoutPromise])

    if (timeoutId) clearTimeout(timeoutId)
    requestsHandled++

    // Check if we should shutdown after this request
    if (requestsHandled >= maxRequests) {
      logWorkerExit(
        'max_requests_reached',
        `Reached max requests (${maxRequests})`,
      )
      setTimeout(() => process.exit(0), 100)
    }

    return response
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    console.error(`❌ [Worker ${workerNum}] Request error:`, error)
    return new Response('Internal Server Error', { status: 500 })
  } finally {
    requestInProgress = false
  }
}

/**
 * Start the worker server
 */
async function startWorker(): Promise<void> {
  // Load the Rip application first
  await loadRipApp()

  // Create Unix socket server with nginx-style limits
  const server = Bun.serve({
    unix: socketPath,
    // Nginx-style connection limits
    maxRequestBodySize: 100 * 1024 * 1024, // 100MB max request body
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (url.pathname === '/__ready') {
        return new Response(appReady ? 'ok' : 'not-ready')
      }
      if (isShuttingDown) {
        return new Response('Worker shutting down', { status: 503 })
      }

      // Sequential processing - reject if worker is busy
      if (requestInProgress) {
        return new Response('Worker busy - try another worker', {
          status: 503,
          headers: {
            'Retry-After': '0.1',
            Connection: 'close',
          },
        })
      }

      const res = await handleRequest(req)
      // Disable browser/proxy caching by default to avoid old responses after reload
      const headers = new Headers(res.headers)
      headers.set('Cache-Control', 'no-store')
      headers.set('Pragma', 'no-cache')
      headers.set('Expires', '0')
      headers.set('X-Worker-Id', workerNum.toString())
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    },
  })

  // Worker ready - manager will show summary

  // Graceful shutdown handling
  const shutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true

    // Wait for current request to finish
    while (requestInProgress) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    server.stop()

    // Note: Shared socket cleanup is handled by the manager
    // Shutdown complete
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Handle uncaught errors
  process.on('uncaughtException', error => {
    logWorkerExit('uncaught_exception', `Uncaught exception: ${error.message}`)
    shutdown()
  })

  process.on('unhandledRejection', reason => {
    logWorkerExit('unhandled_rejection', `Unhandled rejection: ${reason}`)
    shutdown()
  })
}

// Start the worker
startWorker().catch(error => {
  console.error(`💥 [Worker ${workerNum}] Failed to start:`, error)
  process.exit(1)
})
