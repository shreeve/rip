// 23-functions.ts — the twin oracle: the dammit call-and-await, and a fat
// arrow's declared return

// ── The dammit operator calls AND awaits, so it types as the awaited value ──

function fetchCount(): Promise<number> {
  return Promise.resolve(9)
}

let harvested = await fetchCount()

console.log('dammit:', harvested.toFixed(0))

// ── A fat arrow with an explicit return type emits inline and enforces it ──

let doubler: (n: number) => string = (n) => String(n * 2)

console.log('arrow:', doubler(4))
