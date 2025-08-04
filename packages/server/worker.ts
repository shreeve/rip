/**
 * 🔥 Rip Worker - Sequential Request Handler
 *
 * Handles HTTP requests with perfect isolation:
 * - One request at a time per worker (sequential processing)
 * - Full .rip language support via transpilation
 * - Unix socket communication for performance
 * - Graceful shutdown on request limits or SIGTERM
 * - Perfect request isolation and predictable resource usage
 * - Auto-restart capability
 *
 * Usage: bun worker.ts [workerId] [maxRequests] [appDirectory]
 */

/// <reference types="bun-types" />

// Make this a module to allow top-level await
export {}

// Configuration
const workerId = parseInt(process.argv[2] ?? '0')
const workerNum = workerId + 1 // Human-friendly worker number (1-indexed)

// Set process title for better visibility
process.title = `rip-worker-${workerNum}`
const baseMaxRequests = parseInt(process.argv[3] ?? '100')

// 🎯 Rolling restart strategy: Stagger request limits to prevent simultaneous shutdowns
// Worker 0: 90-110% of base limit, Worker 1: 95-105%, Worker 2: 100-120%, etc.
const requestVariance = Math.floor(baseMaxRequests * 0.1) // 10% variance
const workerOffset = workerId * 0.05 - 0.05 // -5%, 0%, +5%, +10%, etc.
const maxRequests = Math.max(
  1,
  baseMaxRequests +
    Math.floor(baseMaxRequests * workerOffset) +
    Math.floor(Math.random() * requestVariance),
)

const appDirectory = process.argv[4] ?? process.cwd()

let requestsHandled = 0
let isShuttingDown = false
let requestInProgress = false

const socketPath = `/tmp/rip_worker_${workerId}.sock`

// Clean up any existing socket file
try {
  await Bun.unlink(socketPath)
} catch (_) {
  // Socket didn't exist, that's fine
}

/**
 * Load the user's Rip application
 * This is where we import their actual .rip application code
 */
const loadRipApplication = async () => {
  try {
    // Try to load the main application file
    // This could be index.rip, app.rip, or server.rip
    const possibleFiles = ['index.rip', 'app.rip', 'server.rip', 'main.rip']

    for (const file of possibleFiles) {
      try {
        const appPath = `${appDirectory}/${file}`

        // Import the .rip file (will be transpiled by bunfig.toml)
        const app = await import(appPath)

        return app.default || app
      } catch (_error) {}
    }

    // Fallback: create a simple default handler

    return {
      fetch: (_req: Request) => {
        return new Response(
          `Hello from Rip Worker ${workerNum}! (request #${requestsHandled + 1})\n\nNo .rip application found. Create index.rip, app.rip, or server.rip in ${appDirectory}`,
          {
            headers: { 'Content-Type': 'text/plain' },
          },
        )
      },
    }
  } catch (error) {
    console.error(
      `[${getTimestamp()}              ] ❌ W${workerNum} app load error:`,
      error,
    )

    // Return error handler
    return {
      fetch: (_req: Request) => {
        return new Response(
          `Error in Rip Worker ${workerNum}: ${error.message}`,
          {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          },
        )
      },
    }
  }
}

/**
 * Main worker logic
 */
const main = async () => {
  // Shared timestamp function
  const getTimestamp = () => {
    const now = new Date()
    return (
      now.toISOString().slice(0, 23).replace('T', ' ') +
      (now.getTimezoneOffset() <= 0 ? '+' : '-') +
      String(Math.abs(Math.floor(now.getTimezoneOffset() / 60))).padStart(
        2,
        '0',
      ) +
      ':' +
      String(Math.abs(now.getTimezoneOffset() % 60)).padStart(2, '0')
    )
  }

  // Load the user's Rip application
  const ripApp = await loadRipApplication()

  // Create the Unix socket server
  const server = Bun.serve({
    unix: socketPath,
    async fetch(req) {
      // Check if shutting down
      if (isShuttingDown) {
        return new Response('Server shutting down', { status: 503 })
      }

      // 🎯 Sequential Processing: Only handle one request at a time
      if (requestInProgress) {
        console.log(
          `[${getTimestamp()}              ] W${workerNum} busy - request queued`,
        )
        return new Response('Worker busy - perfect isolation in progress', {
          status: 503,
          headers: {
            'Content-Type': 'text/plain',
            'Retry-After': '1',
          },
        })
      }

      // Mark request as in progress for perfect isolation
      requestInProgress = true
      requestsHandled++

      try {
        // Call the user's application
        let response

        if (typeof ripApp === 'function') {
          // Direct function export
          response = await ripApp(req)
        } else if (ripApp && typeof ripApp.fetch === 'function') {
          // Hono-style app with fetch method

          response = await ripApp.fetch(req)
        } else if (ripApp && typeof ripApp.handler === 'function') {
          // Custom handler function
          response = await ripApp.handler(req)
        } else {
          // Fallback
          response = new Response(
            `Rip Worker ${workerNum} - Request #${requestsHandled} (Sequential Mode)`,
            {
              headers: { 'Content-Type': 'text/plain' },
            },
          )
        }

        // Check if worker should shut down (after completing this request)
        if (requestsHandled >= maxRequests) {
          console.log(
            `[${getTimestamp()}              ] W${workerNum} reached ${maxRequests} requests - shutting down`,
          )

          // Schedule shutdown after this request completes
          setTimeout(() => {
            gracefulShutdown('Request limit reached')
          }, 0)
        }

        return response
      } catch (error) {
        console.error(
          `[${getTimestamp()}              ] ❌ W${workerNum} request error:`,
          error,
        )

        return new Response(`Rip Worker ${workerNum} Error: ${error.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        })
      } finally {
        // 🎯 Release the worker for the next request
        requestInProgress = false
      }
    },
  })

  /**
   * Graceful shutdown handler
   */
  const gracefulShutdown = (_reason: string) => {
    if (isShuttingDown) return

    isShuttingDown = true
    // Stop accepting new requests
    server.stop(false) // false = don't force, wait for current requests

    // Exit after a delay to ensure cleanup
    setTimeout(() => {
      process.exit(0)
    }, 100)
  }

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM received'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT received'))

  console.log(`[${getTimestamp()}              ] W${workerNum} ready`)
}

// Start the worker
main().catch(console.error)
