/**
 * Rip LB Server (server2, shared-socket variant):
 * Minimal HTTP entry that forwards to a single shared Unix socket per app.
 * Workers are single-inflight; the kernel balances accepts across idle workers.
 */

import { logAccessHuman, logAccessJson, nowMs, ParsedFlags, getAppSocketPath } from './utils'

export class LBServer {
  private flags: ParsedFlags
  private server: any | null = null
  private httpsServer: any | null = null
  private startedAt = nowMs()
  private appSocketPath: string

  constructor(flags: ParsedFlags) {
    this.flags = flags
    this.appSocketPath = getAppSocketPath(flags.socketPrefix)
  }

  start(): void {
    if (this.flags.httpPort !== null) {
      this.server = Bun.serve({ port: this.flags.httpPort, idleTimeout: 8, fetch: this.fetch.bind(this) })
    }
  }

  stop(): void {
    try { this.server?.stop() } catch {}
    try { this.httpsServer?.stop() } catch {}
  }

  private status(): Response {
    const uptime = Math.floor((nowMs() - this.startedAt) / 1000)
    const body = JSON.stringify({ status: 'healthy', app: this.flags.appName, workers: this.flags.workers, ports: { http: this.flags.httpPort ?? undefined }, uptime })
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
  }

  private async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/status') return this.status()
    if (url.pathname === '/server') return new Response('ok', { headers: { 'content-type': 'text/plain' } })

    const start = performance.now()
    let res: Response
    try {
      res = await this.forwardOnce(req, this.appSocketPath)
    } catch {
      // Return a clean 503 if unix forwarding fails
      res = new Response('Service unavailable', { status: 503 })
    }
    const totalSeconds = (performance.now() - start) / 1000

    if (this.flags.jsonLogging) logAccessJson(this.flags.appName, req, res, totalSeconds, totalSeconds)
    else if (this.flags.accessLog) logAccessHuman(this.flags.appName, req, res, totalSeconds, totalSeconds)

    return res
  }

  private async forwardOnce(req: Request, socketPath: string): Promise<Response> {
    const inUrl = new URL(req.url)
    const forwardUrl = `http://localhost${inUrl.pathname}${inUrl.search}`
    return await fetch(forwardUrl, { method: req.method, headers: req.headers, body: req.body, unix: socketPath })
  }
}
