/**
 * Rip LB Server: HTTP entry + per-worker socket load balancer with control socket.
 */

import { INTERNAL_HEADERS, logAccessHuman, logAccessJson, nowMs, ParsedFlags, stripInternalHeaders, getControlSocketPath } from './utils'

type UpstreamState = { socket: string; inflight: number; version: number | null; workerId: number }

export class Server {
  private flags: ParsedFlags
  private server: any | null = null
  private httpsServer: any | null = null
  private control: any | null = null
  private sockets: UpstreamState[] = []
  private availableWorkers: UpstreamState[] = []
  private inflightTotal = 0
  private queue: { req: Request; resolve: (r: Response) => void; reject: (e: any) => void; enqueuedAt: number }[] = []
  private startedAt = nowMs()
  private newestVersion: number | null = null

  constructor(flags: ParsedFlags) {
    this.flags = flags
  }

  start(): void {
    if (this.flags.httpPort !== null) {
      this.server = Bun.serve({ port: this.flags.httpPort, idleTimeout: 8, fetch: this.fetch.bind(this) })
    }
    this.startControl()
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

    // Fast path: try to get available worker directly
    if (this.inflightTotal < Math.max(1, this.sockets.length)) {
      const sock = this.getNextAvailableSocket()
      if (sock) {
        this.inflightTotal++
        try {
          return await this.forwardToWorker(req, sock)
        } finally {
          this.inflightTotal--
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

  private getNextAvailableSocket(): UpstreamState | null {
    while (this.availableWorkers.length > 0) {
      const worker = this.availableWorkers.pop()!
      if (worker.inflight === 0 && this.isCurrentVersion(worker)) return worker
    }
    return null
  }

  private isCurrentVersion(worker: UpstreamState): boolean {
    return this.newestVersion === null || worker.version === null || worker.version >= this.newestVersion
  }

  private releaseWorker(worker: UpstreamState): void {
    worker.inflight = 0
    if (this.isCurrentVersion(worker)) this.availableWorkers.push(worker)
  }

  private async forwardToWorker(req: Request, socket: UpstreamState): Promise<Response> {
    const start = performance.now()
    let res: Response | null = null
    let workerSeconds = 0
    let released = false
    try {
      socket.inflight = 1
      const t0 = performance.now()
      res = await this.forwardOnce(req, socket.socket)
      workerSeconds = (performance.now() - t0) / 1000
      if (res.status === 503 && res.headers.get('Rip-Worker-Busy') === '1') {
        const retry = this.getNextAvailableSocket()
        if (retry && retry !== socket) {
          this.releaseWorker(socket)
          released = true
          retry.inflight = 1
          const t1 = performance.now()
          res = await this.forwardOnce(req, retry.socket)
          workerSeconds = (performance.now() - t1) / 1000
          const headers = stripInternalHeaders(res.headers)
          headers.delete('date')
          if (this.flags.jsonLogging) logAccessJson(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
          else if (this.flags.accessLog) logAccessHuman(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
          this.releaseWorker(retry)
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
        }
      }
    } catch {
      this.sockets = this.sockets.filter(x => x.socket !== socket.socket)
      this.availableWorkers = this.availableWorkers.filter(x => x.socket !== socket.socket)
      released = true
      return new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '1' } })
    } finally {
      if (!released) this.releaseWorker(socket)
    }
    if (!res) return new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '1' } })
    const headers = stripInternalHeaders(res.headers)
    headers.delete('date')
    if (this.flags.jsonLogging) logAccessJson(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
    else if (this.flags.accessLog) logAccessHuman(this.flags.appName, req, res, (performance.now() - start) / 1000, workerSeconds)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }

  private async forwardOnce(req: Request, socketPath: string): Promise<Response> {
    const inUrl = new URL(req.url)
    const forwardUrl = `http://localhost${inUrl.pathname}${inUrl.search}`
    const { signal, cancel } = this.abortAfter(this.flags.connectTimeoutMs)
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
      const worker = this.getNextAvailableSocket()
      if (!worker) { this.inflightTotal--; break }
      this.forwardToWorker(job.req, worker)
        .then(r => job.resolve(r))
        .catch(e => job.resolve(e instanceof Response ? e : new Response('Internal error', { status: 500 })))
        .finally(() => {
          this.inflightTotal--
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
            this.availableWorkers.push(worker)
          }
          if (version !== null) this.newestVersion = this.newestVersion === null ? version : Math.max(this.newestVersion, version)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        }
        if (j && j.op === 'quit' && typeof j.workerId === 'number') {
          this.sockets = this.sockets.filter(x => x.workerId !== j.workerId)
          this.availableWorkers = this.availableWorkers.filter(x => x.workerId !== j.workerId)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        }
      } catch {}
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not-found', { status: 404 })
  }
}
