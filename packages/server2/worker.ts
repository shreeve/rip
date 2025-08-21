/**
 * Rip Worker (server2 variant): single-inflight Unix socket worker with self-registration.
 *
 * Features:
 * - Single-inflight request isolation
 * - Rate-limited mtime-based hot module reloading (100ms intervals) with handler caching
 * - Graceful cycling after maxReloads to prevent memory bloat
 * - Self-registration via join/quit operations on control socket
 * - Automatic exit after maxRequests for clean lifecycle management
 * - High-performance: no blocking filesystem calls on request hot path
 */

import { getControlSocketPath } from './utils'

const workerId = Number.parseInt(process.argv[2] ?? '0')
const maxRequests = Number.parseInt(process.argv[3] ?? '10000')
const maxReloads = Number.parseInt(process.argv[4] ?? '10')
const appBaseDir = process.argv[5]
const appEntry = process.argv[6]
const appNameArg = process.argv[7]

const socketPath = process.env.SOCKET_PATH as string
const hotReloadMode = (process.env.RIP_HOT_RELOAD as 'none' | 'process' | 'module') || 'none'
const socketPrefix = process.env.SOCKET_PREFIX as string

let appReady = false
let inflight = false
let handled = 0
let reloader: any = null
let lastMtime = 0
let cachedHandler: any = null
let hotReloadCount = 0
let lastCheckTime = 0
const CHECK_INTERVAL_MS = 100  // Only check for changes every 100ms

async function checkForChanges(): Promise<boolean> {
  if (hotReloadMode !== 'module') return false

  // Rate limit: only check filesystem every 100ms to avoid performance impact
  const now = Date.now()
  if (now - lastCheckTime < CHECK_INTERVAL_MS) {
    return false
  }
  lastCheckTime = now

  try {
    const fs = require('fs')
    const stats = fs.statSync(appEntry)
    const currentMtime = stats.mtime.getTime()
    if (lastMtime === 0) {
      lastMtime = currentMtime
      return false
    }
    if (currentMtime > lastMtime) {
      lastMtime = currentMtime
      return true
    }
    return false
  } catch {
    return false
  }
}

async function getHandler(): Promise<(req: Request) => Promise<Response> | Response> {
  // Simple mtime-based hot reload for module mode
  const hasChanged = await checkForChanges()
  if (hasChanged) {
    hotReloadCount++
    console.log(`[worker ${workerId}] File changed, reloading... (${hotReloadCount}/${maxReloads})`)
    cachedHandler = null
    reloader = null

    // Graceful exit after maxReloads to prevent module cache bloat
    if (hotReloadCount >= maxReloads) {
      console.log(`[worker ${workerId}] Reached maxReloads (${maxReloads}), graceful exit`)
      setTimeout(() => process.exit(0), 100) // Let current request finish
      return async () => new Response('Worker cycling', { status: 503 })
    }
  }

  // Return cached handler if available and no changes
  if (cachedHandler && !hasChanged) {
    return cachedHandler
  }

  if (!reloader) {
    // @ts-ignore dynamic import of package without types
    const api = await import('@rip/api').catch(() => null)
    if (!api?.createReloader) {
      // Direct import with cache busting for module reload
      const bustQuery = hotReloadMode === 'module' ? `?bust=${Date.now()}` : ''
      const mod = await import(appEntry + bustQuery)
      const fresh = (mod as any).default || (mod as any)
      const h = typeof fresh === 'function' ? fresh : (fresh && typeof fresh.fetch === 'function' ? fresh.fetch.bind(fresh) : null)
      cachedHandler = h || (async () => new Response('Invalid app', { status: 500 }))
      return cachedHandler
    }
    reloader = api.createReloader({ entryPath: appEntry })
  }
  try {
    const h = await reloader.getHandler()
    cachedHandler = h
    return h
  } catch (e) {
    // Fallback: direct import of app entry
    try {
      const bustQuery = hotReloadMode === 'module' ? `?bust=${Date.now()}` : ''
      const mod = await import(appEntry + bustQuery)
      const fresh = (mod as any).default || (mod as any)
      const h = typeof fresh === 'function' ? fresh : (fresh && typeof fresh.fetch === 'function' ? fresh.fetch.bind(fresh) : null)
      cachedHandler = h || (async () => new Response('not ready', { status: 503 }))
      return cachedHandler
    } catch {
      return async () => new Response('not ready', { status: 503 })
    }
  }
}

async function selfRegister(): Promise<void> {
  try {
    const payload = { op: 'join', app: appNameArg, workerId, pid: process.pid, socket: socketPath }
    const body = JSON.stringify(payload)
    const ctl = getControlSocketPath(socketPrefix)
    await fetch('http://localhost/worker', { method: 'POST', body, headers: { 'content-type': 'application/json' }, unix: ctl })
  } catch {}
}

async function selfDeregister(): Promise<void> {
  try {
    const payload = { op: 'quit', app: appNameArg, workerId }
    const body = JSON.stringify(payload)
    const ctl = getControlSocketPath(socketPrefix)
    await fetch('http://localhost/worker', { method: 'POST', body, headers: { 'content-type': 'application/json' }, unix: ctl })
  } catch {}
}

async function start(): Promise<void> {
  const initial = await getHandler()
  appReady = typeof initial === 'function'

  const server = Bun.serve({
    unix: socketPath,
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
