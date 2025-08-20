/**
 * Rip Worker (server2 variant): single-inflight Unix socket worker with self-registration.
 */

import { getControlSocketPath } from './utils'

const workerId = Number.parseInt(process.argv[2] ?? '0')
const maxRequests = Number.parseInt(process.argv[3] ?? '10000')
const appBaseDir = process.argv[4]
const appEntry = process.argv[5]
const appNameArg = process.argv[6]

const socketPath = process.env.SOCKET_PATH as string
const hotReloadMode = (process.env.RIP_HOT_RELOAD as 'none' | 'process' | 'module') || 'none'
const socketPrefix = process.env.SOCKET_PREFIX as string

let appReady = false
let inflight = false
let handled = 0
let reloader: any = null

async function getHandler(): Promise<(req: Request) => Promise<Response> | Response> {
  if (!reloader) {
    // @ts-ignore dynamic import of package without types
    const api = await import('@rip/api').catch(() => null)
    if (!api?.createReloader) {
      const mod = await import(appEntry)
      const fresh = (mod as any).default || (mod as any)
      const h = typeof fresh === 'function' ? fresh : (fresh && typeof fresh.fetch === 'function' ? fresh.fetch.bind(fresh) : null)
      return h || (async () => new Response('Invalid app', { status: 500 }))
    }
    reloader = api.createReloader({ entryPath: appEntry })
  }
  try {
    const h = await reloader.getHandler()
    return h
  } catch (e) {
    // Fallback: direct import of app entry
    try {
      const mod = await import(appEntry + `?bust=${Date.now()}`)
      const fresh = (mod as any).default || (mod as any)
      const h = typeof fresh === 'function' ? fresh : (fresh && typeof fresh.fetch === 'function' ? fresh.fetch.bind(fresh) : null)
      return h || (async () => new Response('Invalid app', { status: 500 }))
    } catch {
      return async () => new Response('not ready', { status: 503 })
    }
  }
}

async function selfRegister(): Promise<void> {
  try {
    const payload = { op: 'register', app: appNameArg, workerId, pid: process.pid, socket: socketPath }
    const body = JSON.stringify(payload)
    const ctl = getControlSocketPath(socketPrefix)
    await fetch('http://localhost/register', { method: 'POST', body, headers: { 'content-type': 'application/json' }, unix: ctl })
  } catch {}
}

async function selfDeregister(): Promise<void> {
  try {
    const payload = { op: 'deregister', app: appNameArg, workerId }
    const body = JSON.stringify(payload)
    const ctl = getControlSocketPath(socketPrefix)
    await fetch('http://localhost/deregister', { method: 'POST', body, headers: { 'content-type': 'application/json' }, unix: ctl })
  } catch {}
}

async function start(): Promise<void> {
  const initial = await getHandler()
  appReady = typeof initial === 'function'

  const server = Bun.serve({
    unix: socketPath,
    idleTimeout: 8,
    maxRequestBodySize: 100 * 1024 * 1024,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (url.pathname === '/ready') return new Response(appReady ? 'ok' : 'not-ready')
      if (inflight) return new Response('busy', { status: 503, headers: { 'Rip-Worker-Busy': '1', 'Retry-After': '0', 'Rip-Worker-Id': String(workerId) } })
      const handlerFn = await getHandler()
      inflight = true
      try {
        if (typeof handlerFn !== 'function') return new Response('not ready', { status: 503 })
        const res = await handlerFn(req)
        return res instanceof Response ? res : new Response(String(res))
      } catch {
        return new Response('error', { status: 500 })
      } finally {
        inflight = false
        handled++
        if (handled >= maxRequests) setTimeout(() => process.exit(0), 10)
      }
    },
  })

  await selfRegister()

  const shutdown = async () => {
    while (inflight) await new Promise(r => setTimeout(r, 10))
    try { server.stop() } catch {}
    await selfDeregister()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

start().catch(err => {
  console.error('worker start failed', err)
  process.exit(1)
})
