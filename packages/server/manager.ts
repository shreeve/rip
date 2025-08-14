/**
 * 🚀 Rip Manager - Multi-Process Manager for Platform Apps
 *
 * Manages worker processes for deployed platform applications.
 * Integrates with our Platform Controller for dynamic app management.
 */

import { watch } from 'fs'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { getSharedSocketPath, logWithDurations, scale } from './utils'

// Worker tracking
interface Worker {
  process: any // Bun.Subprocess type
  id: number
  restartCount: number
  socketPath: string
  startedAt: number
  backoffMs: number
  appName: string
}

export class RipManager {
  private workers: Map<string, Worker[]> = new Map() // appName -> workers
  private appDirectories: Map<string, string> = new Map() // appName -> directory
  private appMaxRequests: Map<string, number> = new Map() // appName -> maxRequestsPerWorker
  private appJsonLogging: Map<string, boolean> = new Map() // appName -> json logging flag
  private isShuttingDown = false
  private fileWatchingEnabled = true
  private watchers: Map<string, any> = new Map() // appName -> file watcher
  private reloadTimers: Map<string, NodeJS.Timeout> = new Map() // appName -> debounce timer
  private hotReloading: Set<string> = new Set() // Track apps currently hot reloading

  constructor() {
    this.setupGracefulShutdown()
  }

  /**
   * Start workers for a specific app
   */
  async startApp(
    appName: string,
    appDirectory: string,
    numWorkers = 3,
    maxRequestsPerWorker = 1000,
    jsonLogging = false,
  ): Promise<void> {
    // Auto-detect optimal worker count (nginx worker_processes auto)
    const optimalWorkers = this.getOptimalWorkerCount(numWorkers)
    if (optimalWorkers !== numWorkers) {
      console.log(
        `📊 [Manager] Auto-scaling workers: ${numWorkers} → ${optimalWorkers} (based on CPU cores)`,
      )
      numWorkers = optimalWorkers
    }

    // Simplified startup logging

    // Resolve absolute path
    const absolutePath = resolve(appDirectory)

    if (!existsSync(absolutePath)) {
      throw new Error(`App directory not found: ${appDirectory}`)
    }

    // Stop existing workers if any
    await this.stopApp(appName)

    // Store app directory for hot reload restarts
    this.appDirectories.set(appName, absolutePath)
    this.appMaxRequests.set(appName, maxRequestsPerWorker)
    this.appJsonLogging.set(appName, jsonLogging)

    // Create worker array for this app
    this.workers.set(appName, [])

    // Start workers
    const workers: Worker[] = []
    for (let i = 0; i < numWorkers; i++) {
      const worker = await this.spawnWorker(
        appName,
        i,
        maxRequestsPerWorker,
        absolutePath,
        jsonLogging,
      )
      workers.push(worker)
    }

    this.workers.set(appName, workers)

    console.log(
      `🚀 Started ${numWorkers} workers for '${appName}' (${maxRequestsPerWorker} req/worker)`,
    )

    // Setup file watching for hot reload
    if (this.fileWatchingEnabled) {
      this.setupFileWatching(appName, absolutePath)
    }
  }

  /**
   * Stop workers for a specific app
   */
  async stopApp(appName: string): Promise<void> {
    const workers = this.workers.get(appName)
    if (!workers || workers.length === 0) {
      return
    }

    // Stopping workers silently

    // Stop file watching
    const watcher = this.watchers.get(appName)
    if (watcher) {
      watcher.close()
      this.watchers.delete(appName)
    }

    // Clear any pending reload timers
    const timer = this.reloadTimers.get(appName)
    if (timer) {
      clearTimeout(timer)
      this.reloadTimers.delete(appName)
    }

    // Terminate workers
    for (const worker of workers) {
      try {
        worker.process.kill()
        await worker.process.exited
      } catch (error) {
        console.error(`❌ [Manager] Error stopping worker ${worker.id}:`, error)
      }
    }

    // Clean up shared socket (only once per app)
    const sharedSocketPath = getSharedSocketPath(appName)
    try {
      await Bun.spawn(['rm', '-f', sharedSocketPath]).exited
    } catch (_) {
      // Socket cleanup failed, continue
    }

    this.workers.delete(appName)
    this.appDirectories.delete(appName)
  }

  // getStatus() removed - was never called

  /**
   * Spawn a single worker process
   */
  private async spawnWorker(
    appName: string,
    workerId: number,
    maxRequestsPerWorker: number,
    appDirectory: string,
    jsonLogging: boolean,
  ): Promise<Worker> {
    // All workers share the same socket (nginx + unicorn pattern)
    const socketPath = getSharedSocketPath(appName)

    // Only clean up shared socket if this is the first worker (workerId === 0)
    if (workerId === 0) {
      try {
        await Bun.spawn(['rm', '-f', socketPath]).exited
      } catch (_) {
        // Socket didn't exist, that's fine
      }
    }

    // Spawn worker process
    const workerProcess = Bun.spawn(
      [
        'bun',
        '--preload',
        './packages/bun/rip-bun.ts', // Ensure Rip transpiler is loaded
        join(__dirname, 'worker.ts'),
        workerId.toString(),
        maxRequestsPerWorker.toString(),
        appDirectory,
        appName,
      ],
      {
        stdout: 'inherit', // Let worker output go to main terminal
        stderr: 'inherit', // Let worker errors go to main terminal
        stdin: 'ignore',
        cwd: process.cwd(), // Keep in monorepo root for proper path resolution
        env: {
          ...process.env,
          WORKER_ID: workerId.toString(),
          APP_NAME: appName,
          SOCKET_PATH: socketPath,
          RIP_LOG_JSON: jsonLogging ? '1' : '0',
        },
      },
    )

    const worker: Worker = {
      process: workerProcess,
      id: workerId,
      restartCount: 0,
      socketPath,
      startedAt: Date.now(),
      backoffMs: 1000, // Start with 1 second backoff
      appName,
    }

    // Monitor worker process
    this.monitorWorker(worker)

    return worker
  }

  /**
   * Monitor worker process for crashes and restarts
   */
  private monitorWorker(worker: Worker): void {
    worker.process.exited.then(async (exitCode: number) => {
      if (this.isShuttingDown || this.hotReloading.has(worker.appName)) return

      const workers = this.workers.get(worker.appName)
      if (!workers) return

      console.log(
        `⚠️ [Manager] Worker ${worker.id} for app '${worker.appName}' exited with code ${exitCode}`,
      )

      // Implement exponential backoff for restarts
      worker.restartCount++
      worker.backoffMs = Math.min(worker.backoffMs * 2, 30000) // Cap at 30 seconds

      if (worker.restartCount > 10) {
        console.error(
          `❌ [Manager] Worker ${worker.id} for app '${worker.appName}' has crashed too many times, not restarting`,
        )
        return
      }

      // Wait for backoff period
      setTimeout(async () => {
        try {
          console.log(
            `🔄 [Manager] Restarting worker ${worker.id} for app '${worker.appName}' (attempt ${worker.restartCount})`,
          )

          // Find the worker in the array and replace it
          const workerIndex = workers.findIndex(w => w.id === worker.id)
          if (workerIndex >= 0) {
            // Get the app directory from the appDirectories map
            const appDirectory =
              this.appDirectories.get(worker.appName) || worker.appName
            const maxReq = this.appMaxRequests.get(worker.appName) ?? 100
            const json = this.appJsonLogging.get(worker.appName) ?? false
            const newWorker = await this.spawnWorker(
              worker.appName,
              worker.id,
              maxReq,
              appDirectory,
              json,
            )
            workers[workerIndex] = newWorker
          }
        } catch (error) {
          console.error(
            `❌ [Manager] Failed to restart worker ${worker.id}:`,
            error,
          )
        }
      }, worker.backoffMs)
    })
  }

  /**
   * Setup file watching for hot reload
   */
  private setupFileWatching(appName: string, appDirectory: string): void {
    try {
      const watcher = watch(
        appDirectory,
        { recursive: true },
        (eventType, filename) => {
          if (!filename || !filename.endsWith('.rip')) return

          // Debounce rapid file changes (e.g., editor saves)
          const existingTimer = this.reloadTimers.get(appName)
          if (existingTimer) {
            clearTimeout(existingTimer)
          }

          const timer = setTimeout(() => {
            this.restartAppWorkers(appName)
            this.reloadTimers.delete(appName)
          }, 500) // 500ms debounce

          this.reloadTimers.set(appName, timer)
        },
      )

      this.watchers.set(appName, watcher)
    } catch (error) {
      console.error(
        `❌ [Manager] Failed to setup file watching for app '${appName}':`,
        error,
      )
    }
  }

  /**
   * Restart all workers for an app (hot reload) - Simple Unicorn style
   */
  private async restartAppWorkers(appName: string): Promise<void> {
    const workers = this.workers.get(appName)
    if (!workers || workers.length === 0) return

    const startTime = performance.now()

    // Mark app as hot reloading to prevent individual worker restarts
    this.hotReloading.add(appName)

    // Stop all workers
    for (const worker of workers) {
      try {
        worker.process.kill('SIGTERM')
        await worker.process.exited
      } catch (error) {
        console.error(`❌ [Manager] Error stopping worker ${worker.id}:`, error)
      }
    }

    // Clean up shared socket (only once)
    const sharedSocketPath = getSharedSocketPath(appName)
    try {
      await Bun.spawn(['rm', '-f', sharedSocketPath]).exited
    } catch (_) {
      // Socket cleanup failed, continue
    }

    // Brief pause for cleanup
    await new Promise(resolve => setTimeout(resolve, 100))

    // Start fresh workers
    const maxReq = this.appMaxRequests.get(appName) ?? 100
    const json = this.appJsonLogging.get(appName) ?? false
    const dir = this.appDirectories.get(appName) || appName
    const newWorkers: Worker[] = []

    for (let i = 0; i < workers.length; i++) {
      try {
        const newWorker = await this.spawnWorker(appName, i, maxReq, dir, json)
        newWorkers.push(newWorker)
      } catch (error) {
        console.error(
          `❌ [Manager] Failed to start worker ${i} for app '${appName}':`,
          error,
        )
      }
    }

    this.workers.set(appName, newWorkers)

    // Clear hot reload flag - individual worker monitoring can resume
    this.hotReloading.delete(appName)

    // Log in same format as request logs
    const totalMs = performance.now() - startTime
    this.logHotReload(totalMs, newWorkers.length)
  }

  /**
   * Log hot reload in same format as request logs
   */
  private logHotReload(totalMs: number, workerCount: number): void {
    const durationSeconds = totalMs / 1000
    logWithDurations(
      `🔥 Hot reload → ${workerCount} workers restarted`,
      durationSeconds,
    )
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return
      this.isShuttingDown = true

      // Stop all apps
      const appNames = Array.from(this.workers.keys())
      for (const appName of appNames) {
        await this.stopApp(appName)
      }
      process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  }

  /**
   * Get optimal worker count based on CPU cores (nginx worker_processes auto)
   */
  private getOptimalWorkerCount(requestedWorkers: number): number {
    const cpuCores = require('os').cpus().length

    // Auto mode (w:auto sets requestedWorkers = 0)
    if (requestedWorkers === 0) {
      // Auto-detect: 1 worker per CPU core for I/O bound workloads
      return Math.max(1, cpuCores)
    }

    // User explicitly set a number, respect it
    return requestedWorkers
  }
}
