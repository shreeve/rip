// 21-operations.ts — operators, invocation, arg lists, existence/presence:
// every operator family (arithmetic, bitwise, comparison, logic, relation,
// update, unary, await/yield), and every call shape from explicit parens to
// implicit, optional, do, dammit, tagged, and spread arguments

// ── Arithmetic: + - * /, floor division //, true modulo %%, power **, unary +/- ──

let ten = 10
let three = 3
let arithmetic = ten + three * 2 - 4 / 2
let floored = Math.floor(ten / three)
let modulo = ((-ten % three) + three) % three
let raised = ten ** 2
let numeric = +'42'

console.log('arithmetic:', arithmetic, floored, modulo, raised, numeric)

// ── Bitwise and shifts: & | ^ ~ << >> >>> ──

let masked = ten & 6
let merged = ten | 1
let toggled = ten ^ 3
let inverted = ~ten
let shifted = ten << 2 >> 1 >>> 0

console.log('bits:', masked, merged, toggled, inverted, shifted)

// ── Comparison and logic: symbolic and word spellings ──
// (the match operator =~ is parked: its emission publishes TS2531 on
// every use — see FINDINGS.md)

let bigger = ten > three
let looser = ten >= 10 && three <= 3
let same = ten === 10
let differ = ten !== three
let negated = !(ten < three)
let both = ten > 0 && three > 0
let either = false || 'fallback'

console.log('compare:', bigger, looser, same, differ, negated, both, either)

// ── Relations and unary words: in, of, instanceof, typeof, delete ──

let names = ['ada', 'grace']
let listed = names.includes('ada')
let keyed = 'host' in { host: 1 }
let arrayish = names instanceof Array
let kindOf = typeof ten
let bag: Record<string, number> = { a: 1, b: 2 }
let removed = delete bag.a

console.log('relation:', listed, keyed, arrayish, kindOf, removed)

// ── Update operators: postfix and prefix ──

let counter = 0
counter++
counter--
++counter
--counter
console.log('counter:', counter)

// ── Existence ? and presence ?! — and the soak family ?. ?.[ ?.( ──

let port: number | null = null
let chosen = port ?? 8080
let exists = port != null
let config: { host: string, retries?: number } | null = { host: 'local' }
let hostname = config?.host
let present = hostname ? true : undefined
let retries = config?.retries ?? 0
let maybeList: number[] | null = [5, 6]
let first = maybeList?.[0]
let scale: ((n: number) => number) | null = function(n: number) { return n * 2 }
let scaled = scale?.(21) ?? 42

console.log('presence:', chosen, exists, hostname, present, retries, first, scaled)

// ── Invocation: explicit parens, the implicit spelling, do, dammit, tagged ──

let greet = function(name: string) { return `hi ${name}` }
let loud = greet('ada').toUpperCase()
let quiet = greet('grace')
let answer = function() { return 42 }
let ran = answer()
let fetchNumber = function() { return Promise.resolve(7) }
let awaited = await fetchNumber()
let gotten = await fetchNumber()
let bundle = await {
  value: 9,
}
let rawPath = String.raw`col\t${ten}`

console.log('invoke:', loud, quiet, ran, awaited, gotten, bundle.value, rawPath)

// ── yield: bare, valued, `yield from`, and the indented-object body ──

let counterGenerator = function*() {
  yield 1
  yield
  yield* [2, 3]
  yield {
    tag: 'end',
  }
  return 'done'
}
let collected = Array.from(counterGenerator())

console.log('collected:', collected)

// ── Return guards: and/or/?? short-circuit into a statement return ──

let classify = function(n: number, label: string | null = null) {
  if (n === 0) return 'zero'
  if (!(n > 0)) return 'negative'
  if (label == null) return 'unlabeled'
  return label
}

console.log(classify(0), classify(-2), classify(3), classify(3, 'big'))

// ── Arg lists: the indented block, the line-split tail, and spread args ──

let sum3 = function(x: number, y: number, z: number) { return x + y + z }
let stacked = sum3(
  1,
  2,
  3,
)
let mixed = sum3(4,
  5,
  6)
let values = [7, 8]
let spread = Math.max(9, ...values)

console.log('args:', stacked, mixed, spread)
