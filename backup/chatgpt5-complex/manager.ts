/// <reference types="bun-types" />

/**
 * 🚀 Rip Manager - Process Manager + Hot Reload
 *
 * This is where the MAGIC happens! Combines:
 * - Multi-process worker management (like Unicorn)
 * - File watching for hot reload (like our rip-server.js)
 * - Graceful worker restarts (production-safe)
 * - Emergency production hot-fixes
 *
 * Usage: bun manager.ts [numWorkers] [maxRequestsPerWorker]
 */

import { watch } from 'fs'
import { join } from 'path'

// Using Bun.spawn instead of Node.js child_process

// Configuration
const managerId = Number.parseInt(process.argv[2] ?? '0')
const managerNum = managerId + 1 // Human-friendly manager number (1-indexed)

// Set process title for better visibility
process.title = `rip-manager-${managerNum}`
const numWorkers = Number.parseInt(process.argv[3]) || 3
const maxRequestsPerWorker =
  Number.parseInt(process.argv[4]) ||
  (process.env.NODE_ENV === 'production' ? 1000 : 10)
const appDirectory = process.argv[5] || process.cwd()

// Worker tracking
interface Worker {
  process: any // Bun.Subprocess type
  id: number
  restartCount: number
  socketPath: string
  startedAt: number
  backoffMs: number
}

const workers: Worker[] = []
let isShuttingDown = false
let fileWatchingEnabled = true

/**
 * Spawn a single worker process
 */
const spawnWorker = async (workerId: number): Promise<Worker> => {
  const socketPath = `/tmp/rip_worker_${workerId}.sock`

  // Start worker silently

  // Clean up any existing socket
  try {
    await Bun.unlink(socketPath)
  } catch (_) {
    // Socket didn't exist, that's fine
  }

  // Use Bun's subprocess API with explicit stdio configuration
  const workerProcess = Bun.spawn(
    [
      'bun',
      join(__dirname, 'worker.ts'),
      workerId.toString(),
      maxRequestsPerWorker.toString(),
      appDirectory,
    ],
    {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
      cwd: appDirectory,
      env: process.env,
    },
  )

  const previous = workers[workerId]
  const worker: Worker = {
    process: workerProcess,
    id: workerId,
    restartCount: (previous?.restartCount || 0) + 1,
    socketPath,
    startedAt: Date.now(),
    backoffMs: previous?.backoffMs || 0,
  }

  // Handle worker exit (Bun.spawn API)
  workerProcess.exited.then(({ code }) => {
    if (!isShuttingDown) {
      const exitCode = code !== undefined ? code : 0
      console.log(
        `[${getTimestamp()}              ] W${workerId + 1} exited (code ${exitCode}) - respawning...`,
      )

      // Exponential backoff on rapid restarts
      const uptimeMs = Date.now() - worker.startedAt
      let nextBackoff = worker.backoffMs || 0
      if (uptimeMs < 2000) {
        // Crashed quickly → increase backoff (250ms → 500ms → 1s → 2s → 4s; capped at 5s)
        nextBackoff = Math.min(nextBackoff > 0 ? nextBackoff * 2 : 250, 5000)
      } else {
        // Ran stably → reset backoff
        nextBackoff = 0
      }

      // Staggered base delay so not all workers restart together
      const baseDelay = 100 + workerId * 50 // 100ms, 150ms, 200ms
      const restartDelay = baseDelay + nextBackoff
      if (nextBackoff > 0) {
        console.log(
          `[${getTimestamp()}              ] M${managerNum} backoff for W${workerId + 1}: ${nextBackoff}ms (uptime ${uptimeMs}ms)`,
        )
      }
      setTimeout(() => {
        if (!isShuttingDown) {
          spawnWorker(workerId).then(newWorker => {
            // Carry forward computed backoff
            newWorker.backoffMs = nextBackoff
            workers[workerId] = newWorker
          })
        }
      }, restartDelay)
    }
  })

  return worker
}

/**
 * Gracefully restart a specific worker
 */
const gracefulRestartWorker = async (workerId: number) => {
  const worker = workers[workerId]
  if (!worker) return

  console.log(
    `[${getTimestamp()}              ] M${managerNum} graceful restart W${workerId + 1}...`,
  )

  // Send SIGTERM for graceful shutdown (Bun.spawn API)
  worker.process.kill('SIGTERM')

  // Wait for exit, then spawn will handle restart automatically
  // The worker will finish current requests before shutting down
}

/**
 * Gracefully restart all workers (rolling restart)
 */
import { formatTimestamp as formatTs } from './time'
// Shared timestamp function
const getTimestamp = () => formatTs()

const gracefulRestartAllWorkers = async (reason: string) => {
  console.log(
    `[${getTimestamp()}              ] M${managerNum} ${reason} - restarting all workers`,
  )

  // Restart workers one by one to maintain availability
  for (let i = 0; i < workers.length; i++) {
    if (!isShuttingDown) {
      await gracefulRestartWorker(i)

      // Small delay between restarts to ensure availability
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  console.log(
    `[${getTimestamp()}              ] M${managerNum} all workers restarted`,
  )
}

/**
 * Initialize all workers
 */
const initializeWorkers = async () => {
  for (let i = 0; i < numWorkers; i++) {
    const worker = await spawnWorker(i)
    workers[i] = worker

    // Small delay between worker starts
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

/**
 * File watcher for hot reload
 */
const setupFileWatcher = () => {
  if (!fileWatchingEnabled) return

  const watcher = watch(
    appDirectory,
    { recursive: true },
    (eventType, filename) => {
      if (filename?.endsWith('.rip') && eventType === 'change') {
        console.log(
          `[${getTimestamp()}              ] M${managerNum} file changed: ${filename}`,
        )

        // Graceful rolling restart of all workers
        gracefulRestartAllWorkers(`File change: ${filename}`)
      }
    },
  )

  // Handle cleanup
  process.on('SIGINT', () => {
    watcher.close()
  })

  process.on('SIGTERM', () => {
    watcher.close()
  })
}

/**
 * Handle graceful shutdown
 */
const setupGracefulShutdown = () => {
  const shutdown = (_signal: string) => {
    isShuttingDown = true
    fileWatchingEnabled = false

    // Send SIGTERM to all workers quietly
    workers.forEach((worker, _id) => {
      if (worker?.process) {
        worker.process.kill('SIGTERM')
      }
    })

    // Force exit after timeout
    setTimeout(() => {
      console.log(
        `[${getTimestamp()}              ] M${managerNum} force exit after timeout`,
      )
      process.exit(1)
    }, 10000)

    // Wait for all workers to exit (or timeout)
    setTimeout(() => {
      process.exit(0)
    }, 2000)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

/**
 * Main initialization
 */
const main = async () => {
  console.log(
    `[${getTimestamp()}              ] M${managerNum} ready (${numWorkers} workers, ${maxRequestsPerWorker} requests each)`,
  )

  // Setup graceful shutdown first
  setupGracefulShutdown()

  // Initialize workers
  await initializeWorkers()

  // Setup file watching for hot reload
  setupFileWatcher()

  // Hot reload is active (shown in endpoint summary)
}

// Fire it up!
main().catch(console.error)
