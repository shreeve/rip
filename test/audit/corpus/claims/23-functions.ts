// 23-functions.ts — the twin oracle.

// ── The dammit operator calls AND awaits, so it types as the awaited value ──

function fetchCount(): Promise<number> {
  return Promise.resolve(9)
}

let harvested = await fetchCount()

console.log('dammit:', harvested.toFixed(0))

// ── A fat arrow with an explicit return type emits inline and enforces it ──

let doubler: (n: number) => string = (n) => String(n * 2)

console.log('arrow:', doubler(4))

// ── Prototype augmentation: the write types, and so does every call site ──

declare global {
  interface String { titleCase(): string }
}
String.prototype.titleCase = function(): string { return this.toUpperCase() }

let titled = 'hello'.titleCase()

console.log('proto:', titled)
