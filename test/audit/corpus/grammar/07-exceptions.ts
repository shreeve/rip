// 07-exceptions.ts — the twin oracle for 07-exceptions.rip.

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

// ── pattern catch bindings: the object kind and the array kind ──

let summarize = function(raw: string) {
  let message: any
  let parsed = false
  try {
    JSON.parse(raw)
    parsed = true
  } catch (err: any) {
    ({ message } = err)
    console.log('reason held:', message.length > 0)
  }
  return parsed
}

let firstFault = function() {
  let first: any
  return (() => { try {
    throw ['too short', 'no digits']
  } catch (err: any) {
    ([first] = err)
    return first
  } })()
}

console.log('summarize:', summarize('nope'), 'firstFault:', firstFault())

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
let cast = (() => { try { return JSON.parse('broken') as { live: boolean } } catch (e) { return { live: false } } })()

console.log('live:', live, 'backed:', backed, 'cast:', cast)

let earlyExit = function(n: number): number {
  try {
    return n
  } catch {}
  return 0
}

let exitGuarded = function(n: number): number {
  try {
    return n
  } catch {
    return 0
  }
  return 0
}

let exitClosing = function(n: number): number {
  return (() => { try { return n } finally { console.log('closing') } })()
}

let exitBoth = function(n: number): number {
  return (() => { try { return n } catch { return 0 } finally { console.log('both') } })()
}

console.log('statement try:', earlyExit(1), exitGuarded(2), exitClosing(3), exitBoth(4))

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
