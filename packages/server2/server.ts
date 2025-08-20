/**
 * Rip LB Server (server2 variant): HTTP(S) entry + in-process load balancer with control socket.
 */

import { INTERNAL_HEADERS, logAccessHuman, logAccessJson, nowMs, ParsedFlags, stripInternalHeaders, getControlSocketPath } from './utils'

type UpstreamState = { socket: string; inflight: number; version: number | null; workerId: number }

export class LBServer {
  private flags: ParsedFlags
  private server: any | null = null
  private httpsServer: any | null = null
  private control: any | null = null
  private sockets: UpstreamState[] = []
  private rr = 0
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
    if (this.flags.httpsPort !== null) {
      // TLS quick/ca not implemented in this single-shot scope
    }
    this.startControl()
    setInterval(() => this.drainQueue(), 1).unref()
  }

  stop(): void {
    try { this.server?.stop() } catch {}
    try { this.httpsServer?.stop() } catch {}
    try { this.control?.stop() } catch {}
  }

  private async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/status') return this.status()

    if (this.inflightTotal < Math.max(1, this.sockets.length) && this.hasAvailableSocket()) {
      this.inflightTotal++
      try { return await this.forward(req) } finally { this.inflightTotal--; this.drainQueue() }
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

  private hasAvailableSocket(): boolean {
    const candidates = this.getCandidateSockets()
    for (const s of candidates) if (s.inflight === 0) return true
    return false
  }

  private getCandidateSockets(): UpstreamState[] {
    if (this.newestVersion === null) return this.sockets
    return this.sockets.filter(s => (s.version ?? this.newestVersion) === this.newestVersion)
  }

  private async forward(req: Request): Promise<Response> {
    const start = performance.now()
    let res: Response | null = null
    let workerSeconds = 0
    const pool = this.getCandidateSockets()
    const attempts = pool.length
    for (let a = 0; a < attempts; a++) {
      const idx = this.rr++ % pool.length
      const s = pool[idx]
      if (s.inflight > 0) continue
      try {
        s.inflight = 1
        const t0 = performance.now()
        res = await this.forwardOnce(req, s.socket)
        workerSeconds = (performance.now() - t0) / 1000
        if (res.status === 503 && res.headers.get('Rip-Worker-Busy') === '1') { res = null; continue }
        break
      } catch {
        // Drop socket on failure
        this.sockets = this.sockets.filter(x => x.socket !== s.socket)
        res = null
      } finally {
        s.inflight = 0
      }
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
    while (this.inflightTotal < Math.max(1, this.sockets.length) && this.hasAvailableSocket()) {
      const job = this.queue.shift()
      if (!job) break
      if (nowMs() - job.enqueuedAt > this.flags.queueTimeoutMs) { job.reject(new Response('Queue timeout', { status: 504 })); continue }
      this.inflightTotal++
      this.forward(job.req).then(r => job.resolve(r)).catch(e => job.reject(e)).finally(() => { this.inflightTotal-- })
    }
  }

  private startControl(): void {
    const ctlPath = getControlSocketPath(this.flags.socketPrefix)
    try { require('fs').unlinkSync(ctlPath) } catch {}
    this.control = Bun.serve({ unix: ctlPath, idleTimeout: 8, fetch: this.controlFetch.bind(this) })
  }

  private async controlFetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/worker') {
      try {
        const j = await req.json()
        if (j && j.op === 'join' && typeof j.socket === 'string' && typeof j.workerId === 'number') {
          const version = typeof j.version === 'number' ? j.version : null
          const exists = this.sockets.find(x => x.socket === j.socket)
          if (!exists) this.sockets.push({ socket: j.socket, inflight: 0, version, workerId: j.workerId })
          if (version !== null) this.newestVersion = this.newestVersion === null ? version : Math.max(this.newestVersion, version)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        }
        if (j && j.op === 'quit' && typeof j.workerId === 'number') {
          this.sockets = this.sockets.filter(x => x.workerId !== j.workerId)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        }
      } catch {}
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not-found', { status: 404 })
  }
}
