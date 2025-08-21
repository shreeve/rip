/**
 * Shared utilities for Rip Server (per-worker sockets)
 */

import { existsSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, resolve } from 'path'

export type HotReloadMode = 'none' | 'process' | 'module'

export interface ParsedFlags {
  appPath: string
  appBaseDir: string
  appEntry: string
  appName: string
  workers: number
  maxRequestsPerWorker: number
  maxReloadsPerWorker: number
  httpPort: number
  jsonLogging: boolean
  accessLog: boolean
  socketPrefix: string
  maxQueue: number
  queueTimeoutMs: number
  connectTimeoutMs: number
  readTimeoutMs: number
  hotReload: HotReloadMode
}

export function isDev(): boolean {
  const env = (process.env.NODE_ENV || '').toLowerCase()
  return env === 'development' || env === 'dev' || env === ''
}

export function coerceInt(value: string | number | undefined | null, def: number): number {
  if (value === undefined || value === null || value === '') return def
  const n = Number.parseInt(String(value))
  return Number.isFinite(n) ? n : def
}

export function parseWorkersToken(token: string | undefined, def: number): number {
  if (!token) return def
  if (token === 'auto') return Math.max(1, require('os').cpus().length)
  const n = Number.parseInt(token)
  return Number.isFinite(n) && n > 0 ? n : def
}

export function parseFlags(argv: string[]): ParsedFlags {
  if (!argv[2]) {
    console.error('Usage: bun packages/server/rip-server.ts <app-path> [flags]')
    process.exit(2)
  }

  const rawFlags = new Set<string>()
  for (let i = 3; i < argv.length; i++) rawFlags.add(argv[i])

  const getKV = (prefix: string): string | undefined => {
    for (const f of rawFlags) {
      if (f.startsWith(prefix)) return f.slice(prefix.length)
    }
    return undefined
  }
  const has = (name: string): boolean => rawFlags.has(name)

  const appPathInput = argv[2]
  const { baseDir, entryPath, appName } = resolveAppEntry(appPathInput)

  const defaultPort = coerceInt(process.env.PORT, 5002)
  const httpPort = coerceInt(getKV('http:'), defaultPort)

  const socketPrefixOverride = getKV('--socket-prefix=')
  const socketPrefix = socketPrefixOverride || `rip_${appName}`

  const workers = parseWorkersToken((getKV('w:') || undefined) as string | undefined, Math.max(1, require('os').cpus().length))
  const maxRequestsPerWorker = coerceInt(getKV('r:'), 10000)
  const maxReloadsPerWorker = coerceInt(getKV('--max-reloads='), coerceInt(process.env.RIP_MAX_RELOADS, 10))

  const jsonLogging = has('--json') || has('--json-logging')
  const accessLog = !has('--no-access-log')

  const maxQueue = coerceInt(getKV('--max-queue='), coerceInt(process.env.RIP_MAX_QUEUE, 8192))
  const queueTimeoutMs = coerceInt(getKV('--queue-timeout-ms='), coerceInt(process.env.RIP_QUEUE_TIMEOUT_MS, 2000))
  const connectTimeoutMs = coerceInt(getKV('--connect-timeout-ms='), coerceInt(process.env.RIP_CONNECT_TIMEOUT_MS, 200))
  const readTimeoutMs = coerceInt(getKV('--read-timeout-ms='), coerceInt(process.env.RIP_READ_TIMEOUT_MS, 5000))

  const hotFlag = getKV('--hot-reload=') || process.env.RIP_HOT_RELOAD
  let hotReload: HotReloadMode = 'none'
  if (hotFlag === 'none' || hotFlag === 'process' || hotFlag === 'module') hotReload = hotFlag
  else hotReload = isDev() ? 'module' : 'none'

  return {
    appPath: resolve(appPathInput),
    appBaseDir: baseDir,
    appEntry: entryPath,
    appName,
    workers,
    maxRequestsPerWorker,
    maxReloadsPerWorker,
    httpPort,
    jsonLogging,
    accessLog,
    socketPrefix,
    maxQueue,
    queueTimeoutMs,
    connectTimeoutMs,
    readTimeoutMs,
    hotReload,
  }
}

export function resolveAppEntry(appPathInput: string): { baseDir: string; entryPath: string; appName: string } {
  const abs = isAbsolute(appPathInput) ? appPathInput : resolve(process.cwd(), appPathInput)
  let baseDir: string
  let entryPath: string
  if (existsSync(abs) && require('fs').statSync(abs).isDirectory()) {
    baseDir = abs
    const one = join(abs, 'index.rip')
    const two = join(abs, 'index.ts')
    if (existsSync(one)) entryPath = one
    else if (existsSync(two)) entryPath = two
    else {
      console.error(`No app entry found. Probed: ${one}, ${two}`)
      process.exit(2)
    }
  } else {
    if (!existsSync(abs)) {
      console.error(`App path not found: ${abs}`)
      process.exit(2)
    }
    baseDir = dirname(abs)
    entryPath = abs
  }
  const appName = basename(baseDir)
  return { baseDir, entryPath, appName }
}

export function getWorkerSocketPath(socketPrefix: string, workerId: number): string {
  return `/tmp/${socketPrefix}.${workerId}.sock`
}

export function getControlSocketPath(socketPrefix: string): string {
  return `/tmp/${socketPrefix}.ctl.sock`
}

export const INTERNAL_HEADERS = new Set(['rip-worker-busy', 'rip-worker-id'])

export function stripInternalHeaders(h: Headers): Headers {
  const out = new Headers()
  for (const [k, v] of h.entries()) {
    if (INTERNAL_HEADERS.has(k.toLowerCase())) continue
    out.append(k, v)
  }
  return out
}

export function nowMs(): number {
  return Date.now()
}

export function formatTimestamp(): { timestamp: string; timezone: string } {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`
  const tzMin = now.getTimezoneOffset()
  const tzSign = tzMin <= 0 ? '+' : '-'
  const tzAbs = Math.abs(tzMin)
  const timezone = `${tzSign}${String(Math.floor(tzAbs / 60)).padStart(2, '0')}${String(tzAbs % 60).padStart(2, '0')}`
  return { timestamp, timezone }
}

export function scale(value: number, unit: string, base = 1000): string {
  const baseNum = Number(base)
  const span = ['G', 'M', 'K', ' ', 'm', 'µ', 'n']
  let slot = 3
  if (value === 0) return `  0 ${unit}`
  while (value > 0 && value < 1.0) {
    value *= baseNum
    slot += 1
  }
  while (value >= baseNum) {
    value /= baseNum
    slot -= 1
  }
  if (value >= 999.5) {
    value /= baseNum
    slot -= 1
  }
  if (slot >= 0 && slot <= 6) {
    let nums: string
    if (value >= 99.5) nums = Math.round(value).toString()
    else if (value >= 9.5) nums = ' ' + Math.round(value).toString()
    else nums = value.toFixed(1)
    return `${nums}${span[slot]}${unit}`
  }
  return `??? ${unit}`
}

export function logAccessJson(app: string, req: Request, res: Response, totalSeconds: number, workerSeconds: number): void {
  const url = new URL(req.url)
  const len = res.headers.get('content-length')
  const type = (res.headers.get('content-type') || '').split(';')[0] || undefined
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      app,
      method: (req as any).method || 'GET',
      path: url.pathname,
      status: res.status,
      totalSeconds,
      workerSeconds,
      type,
      length: len ? Number(len) : undefined,
    }),
  )
}

export function logAccessHuman(app: string, req: Request, res: Response, totalSeconds: number, workerSeconds: number): void {
  const { timestamp, timezone } = formatTimestamp()
  const d1 = scale(totalSeconds, 's')
  const d2 = scale(workerSeconds, 's')
  const method = (req as any).method || 'GET'
  const url = new URL(req.url)
  const path = url.pathname
  const status = res.status
  const lenHeader = res.headers.get('content-length') || ''
  const len = lenHeader ? `${lenHeader}B` : ''
  const contentType = (res.headers.get('content-type') || '').split(';')[0] || ''
  const type = contentType.includes('/') ? contentType.split('/')[1] : contentType
  console.log(`[${timestamp} ${timezone} ${d1} ${d2}] ${method} ${path} → ${status} ${type} ${len}`)
}
