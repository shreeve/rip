/**
 * Rip Worker (server1 variant): single-inflight Unix socket worker.
 */

import { createAbortAfter, fileMtimeMs } from './utils'

const workerId = Number.parseInt(process.argv[2] ?? '0')
const maxRequests = Number.parseInt(process.argv[3] ?? '10000')
const appBaseDir = process.argv[4]
const appEntry = process.argv[5]
const appNameArg = process.argv[6]

const socketPath = process.env.SOCKET_PATH as string
const hotReloadMode = (process.env.RIP_HOT_RELOAD as 'none' | 'process' | 'module') || 'none'

let appModule: any = null
let handler: ((req: Request) => Promise<Response> | Response) | null = null
let appReady = false
let inflight = false
let handled = 0
let lastLoadedMtime = 0

async function loadApp(moduleUrlExtra?: string): Promise<void> {
  const url = appEntry + (moduleUrlExtra || '')
  const mod = await import(url)
  appModule = mod.default || mod
  if (typeof appModule === 'function') handler = appModule
  else if (appModule && typeof appModule.fetch === 'function') handler = appModule.fetch.bind(appModule)
  else handler = null
  appReady = Boolean(handler)
}

async function maybeReloadForModuleMode(): Promise<void> {
  if (hotReloadMode !== 'module') return
  const mt = fileMtimeMs(appEntry)
  if (mt > lastLoadedMtime && !inflight) {
    try {
      if (appModule && typeof appModule.onUnload === 'function') await appModule.onUnload()
    } catch {}
    lastLoadedMtime = mt
    // bust module cache by query string
    await loadApp(`?v=${mt}`)
  }
}

async function start(): Promise<void> {
  await loadApp()
  lastLoadedMtime = fileMtimeMs(appEntry)

  const server = Bun.serve({
    unix: socketPath,
    idleTimeout: 7,
    maxRequestBodySize: 100 * 1024 * 1024,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (url.pathname === '/ready') {
        return new Response(appReady ? 'ok' : 'not-ready')
      }
      if (inflight) {
        return new Response('busy', { status: 503, headers: { 'Rip-Worker-Busy': '1', 'Retry-After': '0' } })
      }
      inflight = true
      try {
        if (hotReloadMode === 'module') await maybeReloadForModuleMode()
        if (!handler) return new Response('not ready', { status: 503 })
        const res = await handler(req)
        return res instanceof Response ? res : new Response(String(res))
      } catch (e) {
        return new Response('error', { status: 500 })
      } finally {
        inflight = false
        handled++
        if (handled >= maxRequests) setTimeout(() => process.exit(0), 10)
      }
    },
  })

  const shutdown = async () => {
    while (inflight) await new Promise(r => setTimeout(r, 10))
    try { server.stop() } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

start().catch(err => {
  console.error('worker start failed', err)
  process.exit(1)
})
