/**
 * scale - Number scaling for readable display of time, file sizes, etc.
 *
 * Scales numbers for optimal readability with appropriate unit prefixes.
 * Perfect for durations, file sizes, frequencies, etc.
 *
 * @param show - The number to scale
 * @param unit - Base unit (e.g., 's', 'B', 'Hz')
 * @param base - Scaling base (1000 for metric, 1024 for binary)
 * @returns Formatted string like "1.23ms" or "456µs"
 */
export function scale(show: number, unit: string, base: number = 1000): string {
  const baseFloat = Number(base);
  let slot = 3;
  const span = ["G", "M", "K", " ", "m", "µ", "n"];

  if (show === 0) return "(overflow)";

  // Scale down for small numbers
  while (show > 0 && show < 1.0) {
    show *= baseFloat;
    slot += 1;
  }

  // Scale up for large numbers
  while (show >= baseFloat) {
    show /= baseFloat;
    slot -= 1;
  }

  // Check bounds and format
  if (slot >= 0 && slot <= 6) {
    const prefix = span[slot];
    return `${show.toFixed(2).padStart(6, ' ')} ${prefix}${unit}`;
  } else {
    return "(overflow)";
  }
}
