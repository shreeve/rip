/**
 * Rip Manager (server1 variant): spawns and supervises worker processes.
 */

import { watch } from 'fs'
import { join } from 'path'
import { fileMtimeMs, getWorkerSocketPath, nowMs, ParsedFlags } from './utils'

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
  private watcher: any | null = null
  private reloadTimer: NodeJS.Timeout | null = null

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
    if (this.flags.hotReload !== 'none') this.setupWatcher()
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = null
    }
    for (const w of this.workers) {
      try {
        w.process.kill()
        await w.process.exited
      } catch {}
      try {
        await Bun.spawn(['rm', '-f', w.socketPath]).exited
      } catch {}
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
        RIP_VARIANT: this.flags.variant,
        RIP_LOG_JSON: this.flags.jsonLogging ? '1' : '0',
        RIP_HOT_RELOAD: this.flags.hotReload,
      },
    })

    const tracked: TrackedWorker = {
      id: workerId,
      process: proc,
      socketPath,
      restartCount: 0,
      backoffMs: 1000,
      startedAt: nowMs(),
    }
    void this.monitor(tracked)
    return tracked
  }

  private async monitor(w: TrackedWorker): Promise<void> {
    const code = await w.process.exited
    if (this.shuttingDown) return
    // exponential backoff with cap
    w.restartCount++
    w.backoffMs = Math.min(w.backoffMs * 2, 30000)
    if (w.restartCount > 10) return
    await new Promise(r => setTimeout(r, w.backoffMs))
    // respawn in place
    const idx = this.workers.findIndex(x => x.id === w.id)
    if (idx >= 0) this.workers[idx] = await this.spawnWorker(w.id)
  }

  private setupWatcher(): void {
    const debounceMs = 150
    this.watcher = watch(this.flags.appBaseDir, { recursive: true }, (_e, file) => {
      if (!file) return
      if (!file.endsWith('.rip') && !file.endsWith('.ts')) return
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        if (this.flags.hotReload === 'process') this.reloadProcess()
        // module mode is handled inside workers on next request
      }, debounceMs)
    })
  }

  private async reloadProcess(): Promise<void> {
    const count = this.workers.length
    await this.stop()
    for (let i = 0; i < count; i++) this.workers.push(await this.spawnWorker(i))
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    await this.stop()
    process.exit(0)
  }
}
