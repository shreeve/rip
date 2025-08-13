/**
 * scale - Number scaling for readable display of time, file sizes, etc.
 * Helpful for durations, file sizes, frequencies, etc.
 *
 * @param show - The number to scale
 * @param unit - Base unit (e.g., 's', 'B', 'Hz')
 * @param base - Scaling base (1000 for metric, 1024 for binary)
 * @returns Formatted string like "1.2ms", " 12ms", or "123ms"
 */
export function scale(show: number, unit: string, base: number = 1000): string {
  const baseNum = Number(base);
  const span = ["G", "M", "K", " ", "m", "µ", "n"];
  let slot = 3; // Starting slot for the unit

  // Handle zero case
  if (show === 0) return `  0 ${unit}`;

  // Scale down for small numbers
  while (show > 0 && show < 1.0) {
    show *= baseNum;
    slot += 1;
  }

  // Scale up for large numbers
  while (show >= baseNum) {
    show /= baseNum;
    slot -= 1;
  }

  // Check bounds and format with smart alignment
  if (slot >= 0 && slot <= 6) {
    let nums: string;

    if (show >= 100) { // 123 -> "123"
      nums = Math.round(show).toString();
    } else if (show >= 10) { // 12.3 -> " 12" (pad to align)
      nums = " " + Math.round(show).toString();
    } else { // 1.23 -> "1.2" (one decimal place)
      nums = show.toFixed(1);
    }

    return `${nums}${span[slot]}${unit}`;
  } else {
    return `??? ${unit}`;
  }
}

export function scale_two_decimals(show: number, unit: string, base: number = 1000): string {
  const baseNum = Number(base);
  const span = ["G", "M", "K", "", "m", "µ", "n"];
  let slot = 3; // Starting slot for the unit

  // Handle zero case
  if (show === 0) return `  0 ${unit}`;

  // Scale down for small numbers
  while (show > 0 && show < 1.0) {
    show *= baseNum;
    slot += 1;
  }

  // Scale up for large numbers
  while (show >= baseNum) {
    show /= baseNum;
    slot -= 1;
  }

  // type is the prefix for the unit
  const type = (slot >= 0 && slot <= 6) ? span[slot] : '?';

  return `${show.toFixed(2).padStart(6, ' ')} ${type}${unit}`;
}
