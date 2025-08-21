/**
 * Rip Manager (server2 variant): spawns and supervises worker processes.
 *
 * Features:
 * - Workers self-register to LB control socket (no directory scans)
 * - Exponential backoff restart logic with attempt limits
 * - Rolling restart support for graceful deployments
 * - Passes maxReloads parameter to workers for memory management
 * - Clean socket management and process supervision
 */

import { join } from 'path'
import { getWorkerSocketPath, nowMs, ParsedFlags } from './utils'

interface TrackedWorker {
  id: number
  process: Bun.Subprocess
  socketPath: string
  restartCount: number
  backoffMs: number
  startedAt: number
}

export class Manager {
  private flags: ParsedFlags
  private workers: TrackedWorker[] = []
  private shuttingDown = false

  constructor(flags: ParsedFlags) {
    this.flags = flags
    process.on('SIGTERM', () => this.shutdown())
    process.on('SIGINT', () => this.shutdown())
  }

  async start(): Promise<void> {
    await this.stop()
    this.workers = []
    for (let i = 0; i < this.flags.workers; i++) {
      const w = await this.spawnWorker(i)
      this.workers.push(w)
    }
  }

  async stop(): Promise<void> {
    for (const w of this.workers) {
      try { w.process.kill() } catch {}
      try { await w.process.exited } catch {}
      try { await Bun.spawn(['rm', '-f', w.socketPath]).exited } catch {}
    }
    this.workers = []
  }

  private async spawnWorker(workerId: number): Promise<TrackedWorker> {
    const socketPath = getWorkerSocketPath(this.flags.socketPrefix, workerId)
    try { await Bun.spawn(['rm', '-f', socketPath]).exited } catch {}

    const proc = Bun.spawn([
      'bun',
      '--preload',
      './packages/bun/rip-bun.ts',
      join(__dirname, 'worker.ts'),
      workerId.toString(),
      this.flags.maxRequestsPerWorker.toString(),
      this.flags.maxReloadsPerWorker.toString(),
      this.flags.appBaseDir,
      this.flags.appEntry,
      this.flags.appName,
    ], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'ignore',
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKER_ID: String(workerId),
        APP_NAME: this.flags.appName,
        SOCKET_PATH: socketPath,
        SOCKET_PREFIX: this.flags.socketPrefix,
        RIP_VARIANT: this.flags.variant,
        RIP_LOG_JSON: this.flags.jsonLogging ? '1' : '0',
        RIP_HOT_RELOAD: this.flags.hotReload,
      },
    })

    const tracked: TrackedWorker = { id: workerId, process: proc, socketPath, restartCount: 0, backoffMs: 1000, startedAt: nowMs() }
    void this.monitor(tracked)
    return tracked
  }

  private async monitor(w: TrackedWorker): Promise<void> {
    await w.process.exited
    if (this.shuttingDown) return
    w.restartCount++
    w.backoffMs = Math.min(w.backoffMs * 2, 30000)
    if (w.restartCount > 10) return
    await new Promise(r => setTimeout(r, w.backoffMs))
    const idx = this.workers.findIndex(x => x.id === w.id)
    if (idx >= 0) this.workers[idx] = await this.spawnWorker(w.id)
  }

  async rollingRestart(): Promise<void> {
    for (const w of [...this.workers]) {
      try { w.process.kill() } catch {}
      try { await w.process.exited } catch {}
      const idx = this.workers.findIndex(x => x.id === w.id)
      if (idx >= 0) this.workers[idx] = await this.spawnWorker(w.id)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    await this.stop()
    process.exit(0)
  }
}
