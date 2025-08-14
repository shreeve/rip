/**
 * 🛠️ Shared utilities for Rip Server
 *
 * Common functions used across server, manager, and worker components
 * to eliminate code duplication and ensure consistency.
 */

/**
 * scale - Number scaling for readable display of time, file sizes, etc.
 * Helpful for durations, file sizes, frequencies, etc.
 *
 * @param show - The number to scale
 * @param unit - Base unit (e.g., 's', 'B', 'Hz')
 * @param base - Scaling base (1000 for metric, 1024 for binary)
 * @returns Formatted string like "1.2ms", " 12ms", or "123ms"
 */
export function scale(show: number, unit: string, base = 1000): string {
  const baseNum = Number(base)
  const span = ['G', 'M', 'K', ' ', 'm', 'µ', 'n']
  let slot = 3 // Starting slot for the unit

  // Handle zero case
  if (show === 0) return `  0 ${unit}`

  // Scale down for small numbers
  while (show > 0 && show < 1.0) {
    show *= baseNum
    slot += 1
  }

  // Scale up for large numbers
  while (show >= baseNum) {
    show /= baseNum
    slot -= 1
  }

  // Handle too-wide numbers
  if (show >= 999.5) {
    show /= baseNum
    slot -= 1
  }

  // Check bounds and format with smart alignment
  if (slot >= 0 && slot <= 6) {
    let nums: string

    if (show >= 100) { // 123 -> "123"
      nums = Math.round(show).toString()
    } else if (show >= 10) { // 12.3 -> " 12" (pad to align)
      nums = ' ' + Math.round(show).toString()
    } else { // 1.23 -> "1.2" (one decimal place)
      nums = show.toFixed(1)
    }

    return `${nums}${span[slot]}${unit}`
  } else {
    return `??? ${unit}`
  }
}

/**
 * Alternative scale function with two decimal places and padding
 * Used for more precise measurements when needed
 */
export function scale_two_decimals(
  show: number,
  unit: string,
  base = 1000,
): string {
  const baseNum = Number(base)
  const span = ['G', 'M', 'K', '', 'm', 'µ', 'n']
  let slot = 3 // Starting slot for the unit

  // Handle zero case
  if (show === 0) return `  0 ${unit}`

  // Scale down for small numbers
  while (show > 0 && show < 1.0) {
    show *= baseNum
    slot += 1
  }

  // Scale up for large numbers
  while (show >= baseNum) {
    show /= baseNum
    slot -= 1
  }

  // type is the prefix for the unit
  const type = slot >= 0 && slot <= 6 ? span[slot] : '?'

  return `${show.toFixed(2).padStart(6, ' ')} ${type}${unit}`
}

/**
 * Generate standardized timestamp with timezone for logs
 * Used by server.ts, manager.ts, and worker.ts
 */
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

/**
 * Generate shared socket path for app
 * Used by server.ts, manager.ts, and worker.ts
 */
export function getSharedSocketPath(appName: string): string {
  return `/tmp/rip_shared_${appName}.sock`
}

/**
 * Parse environment variable as integer with default
 * Used for connection limits and other numeric config
 */
export function parseEnvInt(envVar: string, defaultValue: number): number {
  return Number.parseInt(process.env[envVar] ?? defaultValue.toString())
}

/**
 * Log with standardized format (timestamp + timezone + content)
 * Used across all server components for consistent logging
 */
export function logWithTimestamp(message: string): void {
  const { timestamp, timezone } = formatTimestamp()
  console.log(`[${timestamp} ${timezone}] ${message}`)
}

/**
 * Log with standardized format including duration metrics
 * Used for request logs and hot reload logs
 */
export function logWithDurations(
  message: string,
  duration1Seconds?: number,
  duration2Seconds?: number,
): void {
  const { timestamp, timezone } = formatTimestamp()

  let durationStr = ''
  if (duration1Seconds !== undefined) {
    const d1 = scale(duration1Seconds, 's')
    if (duration2Seconds !== undefined) {
      const d2 = scale(duration2Seconds, 's')
      durationStr = ` ${d1} ${d2}`
    } else {
      durationStr = ` ${d1} ${d1}` // Duplicate for alignment (hot reload pattern)
    }
  }

  console.log(`[${timestamp} ${timezone}${durationStr}] ${message}`)
}
