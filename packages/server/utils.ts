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
  maxSecondsPerWorker: number
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
  const cores = require('os').cpus().length
  if (token === 'auto') return Math.max(1, cores)
  if (token === 'half') return Math.max(1, Math.floor(cores / 2))
  if (token === '2x') return Math.max(1, cores * 2)
  if (token === '3x') return Math.max(1, cores * 3)
  const n = Number.parseInt(token)
  return Number.isFinite(n) && n > 0 ? n : def
}

function parseRestartPolicyToken(
  token: string | undefined,
  defRequests: number,
  defSeconds: number,
  defReloads: number,
): { maxRequests: number; maxSeconds: number; maxReloads: number } {
  if (!token) return { maxRequests: defRequests, maxSeconds: defSeconds, maxReloads: defReloads }
  let maxRequests = defRequests
  let maxSeconds = defSeconds
  let maxReloads = defReloads

  for (const part of token.split(',').map(s => s.trim()).filter(Boolean)) {
    if (part.endsWith('s')) {
      const secs = Number.parseInt(part.slice(0, -1))
      if (Number.isFinite(secs) && secs >= 0) maxSeconds = secs
    } else if (part.endsWith('r')) {
      const rls = Number.parseInt(part.slice(0, -1))
      if (Number.isFinite(rls) && rls >= 0) maxReloads = rls
    } else {
      const n = Number.parseInt(part)
      if (Number.isFinite(n) && n > 0) maxRequests = n
    }
  }
  return { maxRequests, maxSeconds, maxReloads }
}

export function parseFlags(argv: string[]): ParsedFlags {
  const rawFlags = new Set<string>()
  let appPathInput: string | undefined

  // Minimal heuristic: only consider tokens that "look like a path"
  // (has "/" or starts with "." or is absolute or ends with .rip/.ts), then validate.
  const tryResolveApp = (tok: string): string | undefined => {
    const looksLikePath = tok.includes('/') || tok.startsWith('.') || isAbsolute(tok) || tok.endsWith('.rip') || tok.endsWith('.ts')
    if (!looksLikePath) return undefined
    try {
      const abs = isAbsolute(tok) ? tok : resolve(process.cwd(), tok)
      return existsSync(abs) ? tok : undefined
    } catch { return undefined }
  }

  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]
    if (!appPathInput) {
      const maybe = tryResolveApp(tok)
      if (maybe) { appPathInput = maybe; continue }
    }
    rawFlags.add(tok)
  }

  if (!appPathInput) {
    console.error('Usage: bun server [flags] <app-path>')
    process.exit(2)
  }

  const getKV = (prefix: string): string | undefined => {
    for (const f of rawFlags) {
      if (f.startsWith(prefix)) return f.slice(prefix.length)
    }
    return undefined
  }
  const has = (name: string): boolean => rawFlags.has(name)

  const { baseDir, entryPath, appName } = resolveAppEntry(appPathInput)

  // If no explicit http: token and no PORT env, set to 0 (auto-select later)
  const httpToken = getKV('http:')
  let httpPort = 0
  if (httpToken !== undefined) httpPort = coerceInt(httpToken, 0)
  else if (process.env.PORT) httpPort = coerceInt(process.env.PORT, 0)

  const socketPrefixOverride = getKV('--socket-prefix=')
  const socketPrefix = socketPrefixOverride || `rip_${appName}`

  const cores = require('os').cpus().length
  const workers = parseWorkersToken((getKV('w:') || undefined) as string | undefined, Math.max(1, Math.floor(cores / 2)))
  const restartPolicy = parseRestartPolicyToken(
    getKV('r:'),
    coerceInt(process.env.RIP_MAX_REQUESTS, 10000),
    coerceInt(process.env.RIP_MAX_SECONDS, 3600),
    coerceInt(process.env.RIP_MAX_RELOADS, 10),
  )
  const maxRequestsPerWorker = restartPolicy.maxRequests
  const maxSecondsPerWorker = restartPolicy.maxSeconds
  const maxReloadsPerWorker = restartPolicy.maxReloads

  const jsonLogging = has('--json') || has('--json-logging')
  const accessLog = !has('--no-access-log')

  const maxQueue = coerceInt(getKV('--max-queue='), coerceInt(process.env.RIP_MAX_QUEUE, 8192))
  const queueTimeoutMs = coerceInt(getKV('--queue-timeout-ms='), coerceInt(process.env.RIP_QUEUE_TIMEOUT_MS, 2000))
  const connectTimeoutMs = coerceInt(getKV('--connect-timeout-ms='), coerceInt(process.env.RIP_CONNECT_TIMEOUT_MS, 200))
  const readTimeoutMs = coerceInt(getKV('--read-timeout-ms='), coerceInt(process.env.RIP_READ_TIMEOUT_MS, 5000))

  const hotFlag = getKV('--hot-reload=') || process.env.RIP_HOT_RELOAD
  let hotReload: HotReloadMode = 'none'
  if (hotFlag === 'none' || hotFlag === 'process' || hotFlag === 'module') hotReload = hotFlag
  else hotReload = 'process'

  return {
    appPath: resolve(appPathInput),
    appBaseDir: baseDir,
    appEntry: entryPath,
    appName,
    workers,
    maxRequestsPerWorker,
    maxSecondsPerWorker,
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

export function scale(value: number, unit: string, pad: boolean = true): string {
  if (value > 0 && Number.isFinite(value)) {
    const span = ['T', 'G', 'M', 'k', pad ? ' ' : '', 'm', 'µ', 'n', 'p'] as const
    const base = 4, min = 0, max = span.length - 1
    let   slot = base // index of base unit

    // Target display range for best 3-char digits: '0.1', '1.1', ' 11', '111'
    while (value <    0.05 && slot <= max) { value *= 1000; slot++ }
    while (value >= 999.5  && slot >= min) { value /= 1000; slot-- }

    // When number is in range, format it
    if (slot >= min && slot <= max) {

      // Use tenths-rounded proxy to determine formatting
      const tens = Math.round(value * 10) / 10

      let nums: string
      if      (tens >= 99.5) nums = Math.round(value).toString()
      else if (tens >= 10  ) nums = Math.round(value).toString()
      else                   nums = tens.toFixed(1)
      if (pad) nums = nums.padStart(3, ' ')
      return `${nums}${span[slot]}${unit}`
    }
  }

  // Handle edge cases
  if (value == 0) {
    return `${pad ? '  0 ' : '0'}${unit}`
  } else {
    return `???${pad ? ' ' : ''}${unit}`
  }
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
