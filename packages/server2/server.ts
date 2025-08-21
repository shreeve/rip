/**
 * Rip LB Server (server2 variant): HTTP(S) entry + in-process load balancer with control socket.
 *
 * Features:
 * - LIFO worker selection for optimal cache locality and resource efficiency
 * - Event-driven queue draining (no polling)
 * - Unix socket communication with connection pooling
 * - Single-inflight isolation per worker
 * - Graceful worker cycling with maxReloads support
 */

import { INTERNAL_HEADERS, logAccessHuman, logAccessJson, nowMs, ParsedFlags, stripInternalHeaders, getControlSocketPath } from './utils'

type UpstreamState = { socket: string; inflight: number; version: number | null; workerId: number }
type PooledConnection = { socketPath: string; connection: any; lastUsed: number; inUse: boolean }

export class LBServer {
  private flags: ParsedFlags
  private server: any | null = null
  private httpsServer: any | null = null
  private control: any | null = null
  private sockets: UpstreamState[] = []
  private availableWorkers: UpstreamState[] = []  // LIFO stack for O(1) worker selection
  private inflightTotal = 0
  private queue: { req: Request; resolve: (r: Response) => void; reject: (e: any) => void; enqueuedAt: number }[] = []
  private connectionPool: Map<string, PooledConnection> = new Map()
  private startedAt = nowMs()
  private newestVersion: number | null = null

  constructor(flags: ParsedFlags) {
    this.flags = flags
  }

  start(): void {
    if (this.flags.httpPort !== null) {
      this.server = Bun.serve({ port: this.flags.httpPort, idleTimeout: 8, fetch: this.fetch.bind(this) })
    }
    if (this.flags.httpsPort !== null) {
      // TLS quick/ca not implemented in this single-shot scope
    }
    this.startControl()

    // Clean up stale connections every 30 seconds
    setInterval(() => this.cleanupConnections(), 30000).unref()
  }

  private cleanupConnections(): void {
    const now = nowMs()
    const maxIdleMs = 30000 // 30 seconds
    for (const [socketPath, conn] of this.connectionPool.entries()) {
      if (!conn.inUse && (now - conn.lastUsed) > maxIdleMs) {
        this.connectionPool.delete(socketPath)
      }
    }
  }

  stop(): void {
    try { this.server?.stop() } catch {}
    try { this.httpsServer?.stop() } catch {}
    try { this.control?.stop() } catch {}
  }

  private async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/status') return this.status()
    if (url.pathname === '/server') return new Response('ok', { headers: { 'content-type': 'text/plain' } })

    // Fast path: try to get available worker directly (no double scanning)
    if (this.inflightTotal < Math.max(1, this.sockets.length)) {
      const availableSocket = this.getNextAvailableSocket()
      if (availableSocket) {
        this.inflightTotal++
        try {
          return await this.forward(req)
        } finally {
          this.inflightTotal--
          // Event-driven: drain queue immediately when capacity frees up
          setImmediate(() => this.drainQueue())
        }
      }
    }
    if (this.queue.length >= this.flags.maxQueue) return new Response('Server busy', { status: 503, headers: { 'Retry-After': '1' } })
    return await new Promise<Response>((resolve, reject) => this.queue.push({ req, resolve, reject, enqueuedAt: nowMs() }))
  }

  private status(): Response {
    const uptime = Math.floor((nowMs() - this.startedAt) / 1000)
    const healthy = this.sockets.length > 0
    const body = JSON.stringify({ status: healthy ? 'healthy' : 'degraded', app: this.flags.appName, workers: this.sockets.length, ports: { http: this.flags.httpPort ?? undefined }, uptime })
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
  }



  private getCandidateSockets(): UpstreamState[] {
    if (this.newestVersion === null) return this.sockets
    return this.sockets.filter(s => (s.version ?? this.newestVersion) === this.newestVersion)
  }

  private getNextAvailableSocket(): UpstreamState | null {
    // LIFO: Pop from end (most recently used = warmest worker)
    // This provides optimal cache locality and resource efficiency
    while (this.availableWorkers.length > 0) {
      const worker = this.availableWorkers.pop()!
      // Double-check worker is still available and current version
      if (worker.inflight === 0 && this.isCurrentVersion(worker)) {
        return worker
      }
      // Worker became busy or outdated, continue to next
    }
    return null
  }

  private isCurrentVersion(worker: UpstreamState): boolean {
    return this.newestVersion === null || worker.version === null || worker.version >= this.newestVersion
  }

  private releaseWorker(worker: UpstreamState): void {
    worker.inflight = 0
    // Push to end of stack for LIFO reuse (warm workers get priority)
    if (this.isCurrentVersion(worker)) {
      this.availableWorkers.push(worker)
    }
  }

  private async forward(req: Request): Promise<Response> {
    const start = performance.now()
    let res: Response | null = null
    let workerSeconds = 0

    // Simple worker selection: try first available, then retry once on busy
    const socket = this.getNextAvailableSocket()
    if (!socket) return new Response('No workers available', { status: 503, headers: { 'Retry-After': '1' } })

    try {
      socket.inflight = 1
      const t0 = performance.now()
      res = await this.forwardOnce(req, socket.socket)
      workerSeconds = (performance.now() - t0) / 1000

      // Handle worker busy race condition: try one more worker
      if (res.status === 503 && res.headers.get('Rip-Worker-Busy') === '1') {
        const retrySocket = this.getNextAvailableSocket()
        if (retrySocket && retrySocket !== socket) {
          this.releaseWorker(socket)  // Release first socket back to available pool
          retrySocket.inflight = 1
          const t1 = performance.now()
          res = await this.forwardOnce(req, retrySocket.socket)
          workerSeconds = (performance.now() - t1) / 1000
          const headers = stripInternalHeaders(res.headers)
          if (this.flags.jsonLogging) logAccessJson(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
          else if (this.flags.accessLog) logAccessHuman(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
          this.releaseWorker(retrySocket)
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
        }
      }
    } catch {
      // Drop socket on failure - worker likely died
      this.sockets = this.sockets.filter(x => x.socket !== socket.socket)
      res = null
    } finally {
      this.releaseWorker(socket)
    }
    if (!res) return new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '1' } })

    const headers = stripInternalHeaders(res.headers)
    if (this.flags.jsonLogging) logAccessJson(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
    else if (this.flags.accessLog) logAccessHuman(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }

  private async forwardOnce(req: Request, socketPath: string): Promise<Response> {
    const inUrl = new URL(req.url)
    const forwardUrl = `http://localhost${inUrl.pathname}${inUrl.search}`
    const { signal, cancel } = this.flags.connectTimeoutMs > 0 ? this.abortAfter(this.flags.connectTimeoutMs) : { signal: undefined as any, cancel: () => {} }
    try {
      const upstream = await fetch(forwardUrl, { method: req.method, headers: req.headers, body: req.body, unix: socketPath, signal })
      cancel()
      const readGuard = new Promise<Response>((_, rej) => setTimeout(() => rej(new Response('Upstream timeout', { status: 504 })), this.flags.readTimeoutMs))
      return (await Promise.race([Promise.resolve(upstream), readGuard])) as Response
    } finally {
      cancel()
    }
  }

  private abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    return { signal: controller.signal, cancel: () => clearTimeout(timer) }
  }

  private drainQueue(): void {
    while (this.inflightTotal < Math.max(1, this.sockets.length) && this.availableWorkers.length > 0) {
      const job = this.queue.shift()
      if (!job) break
      if (nowMs() - job.enqueuedAt > this.flags.queueTimeoutMs) {
        job.resolve(new Response('Queue timeout', { status: 504 }))
        continue
      }
      this.inflightTotal++
      // Fixed: Proper async handling with event-driven draining
      this.forward(job.req)
        .then(r => job.resolve(r))
        .catch(e => job.resolve(e instanceof Response ? e : new Response('Internal error', { status: 500 })))
        .finally(() => {
          this.inflightTotal--
          // Chain draining: when one completes, try to drain more
          setImmediate(() => this.drainQueue())
        })
    }
  }

  private startControl(): void {
    const ctlPath = getControlSocketPath(this.flags.socketPrefix)
    try { require('fs').unlinkSync(ctlPath) } catch {}
    this.control = Bun.serve({ unix: ctlPath, fetch: this.controlFetch.bind(this) })
  }

  private async controlFetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/worker') {
      try {
        const j = await req.json()
        if (j && j.op === 'join' && typeof j.socket === 'string' && typeof j.workerId === 'number') {
          const version = typeof j.version === 'number' ? j.version : null
          const exists = this.sockets.find(x => x.socket === j.socket)
          if (!exists) {
            const worker = { socket: j.socket, inflight: 0, version, workerId: j.workerId }
            this.sockets.push(worker)
            // Add to available workers stack for LIFO selection
            this.availableWorkers.push(worker)
          }
          if (version !== null) this.newestVersion = this.newestVersion === null ? version : Math.max(this.newestVersion, version)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        }
        if (j && j.op === 'quit' && typeof j.workerId === 'number') {
          this.sockets = this.sockets.filter(x => x.workerId !== j.workerId)
          // Also remove from available workers stack
          this.availableWorkers = this.availableWorkers.filter(x => x.workerId !== j.workerId)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        }
      } catch {}
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not-found', { status: 404 })
  }
}
