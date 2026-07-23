// 27-functions.ts — functions: def in every shape (plain, parenless,
// return-typed, generic, void-marked with !, exported), the param surface
// (typed, default, optional, splat rest, the ... expansion, destructured
// object/array patterns, promoted @-props), the param-list layouts, every
// return form, and both arrow kinds (the bare optional and the expansion
// bind inside contextually typed arrows — a def spelling of either is an
// implicit any that strict correctly refuses)

// ── def: plain, annotated return, parenless, and parenless-with-type ──

function double(n: number) {
  return n * 2
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function tick() {
  console.log('tick')
}

function stamp(): string {
  return 'ready'
}

tick()
console.log('defs:', double(21), clamp(15, 0, 10), stamp())

// ── generic defs: inferred and annotated returns ──

function wrap<T>(value: T) {
  return [value]
}

function pairOf<T, U>(a: T, b: U): [T, U] {
  return [a, b]
}

console.log('generic:', wrap(7), pairOf('id', 3))

// ── void defs: the bang suppresses the implicit return ──

function announce(subject: string): void {
  console.log('announcing', subject)
}

function persist(entry: string): void {
  console.log('persisted', entry)
}

announce('launch')
persist('log line')

// ── params: the default, the optional, and the splat rest ──

function formal(name: string, title: string = 'Mx') {
  return `${title} ${name}`
}

function shorten(text: string, limit?: number) {
  return text.slice(0, limit ?? text.length)
}

function total(...nums: number[]): number {
  return nums.reduce((acc, n) => acc + n, 0)
}

console.log('params:', formal('Lovelace'), formal('Hopper', 'Adm'), shorten('typing', 3), total(1, 2, 3))

// ── bare optional and the ... expansion: contextually typed arrows ──

let labelOf: (name: string, title?: string) => string = function(name: string, title?) {
  return title ? `${title} ${name}` : name
}

let bracket: (...parts: number[]) => number[] = function(first: number, ...rest) {
  const last = rest[rest.length - 1]
  return [first, last]
}

console.log('contextual:', labelOf('ada'), labelOf('grace', 'Dr'), bracket(4, 5, 6, 7))

// ── param-list layouts: the split tail and the indented block ──

function compose(prefix: string, suffix: string) {
  return prefix + suffix
}

function volume(width: number, height: number, depth: number) {
  return width * height * depth
}

console.log('layouts:', compose('data', 'base'), volume(2, 3, 4))

// ── destructured params: object and array patterns ──

function introduce({ name, age }: { name: string, age: number }) {
  return `${name} is ${age}`
}

function endpoints([head, ...tail]: number[]) {
  return [head, tail.length]
}

console.log('patterns:', introduce({ name: 'Grace', age: 85 }), endpoints([3, 4, 5]))

// ── promoted params: @-props assign straight to the instance ──

class Badge {
  owner: string
  level: number
  constructor(owner: string, level: number = 1) {
    this.owner = owner
    this.level = level
  }
  describe() {
    return `${this.owner} at level ${this.level}`
  }
}

let badge = new Badge('ada')
console.log('badge:', badge.describe())

// ── return: bare, valued, and the indented-object payload ──

function drain(queue: string[]) {
  if (queue.length === 0) {
    return
  }
  console.log('draining', queue.length)
}

function firstWord(text: string) {
  return text.split(' ')[0]
}

function summarize(host: string, port: number) {
  return {
    host: host,
    port: port,
    ready: true,
  }
}

drain([])
drain(['a', 'b'])
console.log('returns:', firstWord('deep types'), summarize('local', 8080))

// ── arrows: thin with a return type, fat, and the parameterless forms ──

let caption = function(n: number): string {
  return `count=${n}`
}
let increment = (n: number) => n + 1
let seed = function() {
  return 42
}
let idle = function() {
  return 'idle'
}

console.log('arrows:', caption(7), increment(41), seed(), idle())

// ── export def: the function crosses the module boundary ──

export function shared(flag: boolean) {
  return flag ? 'on' : 'off'
}

console.log('shared:', shared(true))
