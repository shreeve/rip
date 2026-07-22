// 26-exceptions.ts — exception handling: every try shape (the block, the
// inline expression, catch, finally), the identifier and bare catch
// bindings, and throw in statement, indented-object, and expression positions
// (the pattern bindings — catch {message}, catch [first] — are parked: the
// lowering's minted binding stays unknown, so destructuring publishes
// TS2339/TS2488 on every use — see FINDINGS.md and MANIFEST.md's Parked table)

// ── try/catch: the classic block pair, an identifier binding ──

let parseConfig = function(raw: string) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    console.log('parse failed:', error instanceof SyntaxError)
    return null
  }
}

console.log('config:', parseConfig('{"port":8080}'), parseConfig('not json'))

// ── a handler-less try: the block alone, errors swallowed ──

let warmup: string | null = null
try {
  warmup = JSON.parse('"ready"')
} catch {}

console.log('warmup:', warmup)

// ── a bare catch: no binding, recovery only ──

let tolerant = function() {
  try {
    return JSON.parse('broken')
  } catch {
    return 'fallback'
  }
}

console.log('tolerant:', tolerant())

// ── try/finally: cleanup without a handler ──

let closed = false
let readAll = function() {
  try {
    return 'contents'
  } finally {
    closed = true
  }
}

console.log('readAll:', readAll(), 'closed:', closed)

// ── the full shape: catch and finally together ──

let settle = function(risky: () => string) {
  let outcome = 'pending'
  try {
    outcome = risky()
  } catch (failure) {
    outcome = 'recovered'
  } finally {
    console.log('settled as', outcome)
  }
  return outcome
}

console.log(settle(() => 'delivered'), settle(() => { throw new Error('nope') }))

// ── try as an expression: inline, and inline with a catch ──

let live = (() => { try { return JSON.parse('{"live":true}') as { live: boolean } } catch {} })()
let backed: { live: boolean } = (() => { try { return JSON.parse('broken') } catch (e) { return { live: false } } })()

console.log('live:', live, 'backed:', backed)

// ── throw: the indented-object payload, and the expression position ──

let reject = function(code: number) {
  throw {
    code: code,
    retriable: code >= 500,
  }
}

let demand = function(value: string | null) { return value ?? (() => { throw new Error('missing value') })() }

let held = (() => { try { return reject(503) } catch (caught) { return caught } })()
console.log('held:', held, 'demand:', demand('present'))
