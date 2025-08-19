/**
 * Rip LB Server (server1 variant): HTTP(S) entry + in-process load balancer.
 */

import { INTERNAL_HEADERS, logAccessHuman, logAccessJson, nowMs, ParsedFlags, stripInternalHeaders } from './utils'

type UpstreamState = {
  socket: string
  inflight: number
  quarantineUntil: number
  ready: boolean
}

export class LBServer {
  private flags: ParsedFlags
  private server: any | null = null
  private httpsServer: any | null = null
  private sockets: UpstreamState[] = []
  private rr = 0
  private inflightTotal = 0
  private queue: { req: Request; resolve: (r: Response) => void; reject: (e: any) => void; enqueuedAt: number }[] = []
  private statusCache: Response | null = null
  private startedAt = nowMs()

  constructor(flags: ParsedFlags) {
    this.flags = flags
    this.refreshSockets()
    setInterval(() => this.refreshSockets(), 200).unref()
    setInterval(() => this.drainQueue(), 1).unref()
    setInterval(() => { void this.checkReadiness() }, 500).unref()
  }

  start(): void {
    if (this.flags.httpPort !== null) {
      this.server = Bun.serve({ port: this.flags.httpPort, fetch: this.fetch.bind(this) })
    }
    if (this.flags.httpsPort !== null) {
      // TLS quick mode not implemented in this one-shot
      // Placeholder: can be wired with cert/key files via flags in future
    }
  }

  stop(): void {
    try { this.server?.stop() } catch {}
    try { this.httpsServer?.stop() } catch {}
  }

  private async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/status') return this.status()

    // Gate readiness: require at least 1 healthy worker
    if (!this.hasHealthySocket()) {
      return new Response(JSON.stringify({ status: 'degraded', app: this.flags.appName }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
    }

    if (this.inflightTotal < Math.max(1, this.sockets.length) && this.hasAvailableSocket()) {
      this.inflightTotal++
      try { return await this.forward(req) } finally { this.inflightTotal--; this.drainQueue() }
    }
    if (this.queue.length >= this.flags.maxQueue) return new Response('Server busy', { status: 503, headers: { 'Retry-After': '1' } })
    return await new Promise<Response>((resolve, reject) => this.queue.push({ req, resolve, reject, enqueuedAt: nowMs() }))
  }

  private status(): Response {
    const uptime = Math.floor((nowMs() - this.startedAt) / 1000)
    const healthy = this.sockets.some(s => s.ready && s.quarantineUntil <= nowMs())
    const body = JSON.stringify({ status: healthy ? 'healthy' : 'degraded', app: this.flags.appName, workers: this.sockets.length, ports: { http: this.flags.httpPort ?? undefined }, uptime })
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
  }

  private refreshSockets(): void {
    try {
      const entries = require('fs').readdirSync('/tmp') as string[]
      const prefix = `${this.flags.socketPrefix}.`
      const found = entries.filter(n => n.startsWith(prefix) && n.endsWith('.sock')).map(n => `/tmp/${n}`).sort()
      // seed new
      for (const s of found) if (!this.sockets.find(x => x.socket === s)) this.sockets.push({ socket: s, inflight: 0, quarantineUntil: 0, ready: false })
      // prune missing
      this.sockets = this.sockets.filter(x => found.includes(x.socket))
    } catch {}
  }

  private hasAvailableSocket(): boolean {
    const now = nowMs()
    for (const s of this.sockets) if (s.inflight === 0 && s.quarantineUntil <= now) return true
    return false
  }

  private hasHealthySocket(): boolean {
    const now = nowMs()
    return this.sockets.some(s => s.quarantineUntil <= now && s.ready)
  }

  private async forward(req: Request): Promise<Response> {
    const start = performance.now()
    let res: Response | null = null
    let workerSeconds = 0
    const attempts = this.sockets.length
    for (let a = 0; a < attempts; a++) {
      const idx = this.rr++ % this.sockets.length
      const s = this.sockets[idx]
      if (s.inflight > 0 || s.quarantineUntil > nowMs()) continue
      try {
        s.inflight = 1
        const t0 = performance.now()
        res = await this.forwardOnce(req, s.socket)
        workerSeconds = (performance.now() - t0) / 1000
        if (res.status === 503 && res.headers.get('Rip-Worker-Busy') === '1') { res = null; continue }
        break
      } catch (e) {
        s.quarantineUntil = nowMs() + 1000
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

  private async checkReadiness(): Promise<void> {
    const tasks = this.sockets.map(async s => {
      if (s.quarantineUntil > nowMs()) { s.ready = false; return }
      const url = 'http://localhost/ready'
      try {
        const { signal, cancel } = this.abortAfter(Math.min(200, this.flags.connectTimeoutMs))
        const res = await fetch(url, { method: 'GET', unix: s.socket, signal })
        cancel()
        s.ready = res.ok && (await res.text()).trim() === 'ok'
      } catch {
        s.ready = false
      }
    })
    await Promise.all(tasks)
  }
}
