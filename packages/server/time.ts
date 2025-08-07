/**
 * formatTimestamp
 * Returns a timestamp string like: YYYY-MM-DD HH:mm:ss.SSS ±HH:MM
 *
 * Uses ISO base for stability and computes the local timezone offset
 * without hardcoding or environment-specific assumptions.
 */
export function formatTimestamp(date: Date = new Date()): string {
  const base = date.toISOString().slice(0, 23).replace('T', ' ')
  // getTimezoneOffset returns minutes to add to local time to get UTC
  // Positive for locations west of UTC (e.g. US), negative for east (e.g. Europe/Asia)
  const offsetMinutesFromUTC = -date.getTimezoneOffset()
  const sign = offsetMinutesFromUTC >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutesFromUTC)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  return `${base}${sign}${hours}:${minutes}`
}


