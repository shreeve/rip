// 20-inference.ts — the twin oracle: reassignment, arithmetic, lib generics,
// contextual callbacks, inferred returns, branch-written and hoisted bindings, destructured parameters

// ── An inferred binding carries its type through a legal reassignment ──

let ledger = 12
ledger = 34

console.log('ledger:', ledger.toFixed(0))

// ── Arithmetic infers through the operators: number by number is number ──

let width = 4
let height = 2.5
let area = (width * height)

console.log('area:', area.toFixed(2))

// ── Library generics carry instantiated element types, including the
// point-free spelling where the callback is a named function ──

let tallies = [1, 2, 3]
let twiced = tallies.map((n) => (n * 2))
let retained = tallies.filter((n) => (n > 1))

function add(a: number, b: number) {
  return (a + b)
}

let summed = tallies.reduce(add, 0)
let labels = ['alpha', 'beta']
let upper = labels.map((w) => w.toUpperCase())

console.log('generics:', twiced, retained, summed.toFixed(0), upper)

// ── Contextual typing reaches an unannotated callback parameter: `n` is
// number inside map, with no annotation written and no implicit any ──

let formatted = tallies.map((n) => n.toFixed(1))

console.log('formatted:', formatted)

// ── An unannotated function's inferred return governs its call sites ──

function magnify(factor: number) {
  return (factor * 100)
}

console.log('scaled:', magnify(1.5).toFixed(0))

// ── A branch-written binding types later same-scope reads: no function
// involved, so this is the checker's own flow analysis rather than the pin pass ──

let tideline = ''
if (tallies.length > 2) {
  tideline = 'many'
} else {
  tideline = 'few'
}

console.log('tideline:', tideline.toUpperCase())

// ── A block-confined binding read by a HOISTED function. The destructured
// spelling is absent on purpose — see the .rip ──

let ribbon = ''
if (labels.length > 1) {
  ribbon = labels[0]
}

function recount() {
  return `${ribbon}/plain`
}

let { json: media } = { json: 'application/json' }

console.log('media:', media.toUpperCase())

console.log('recount:', recount())

// ── Destructured bindings carry their source property's type, enforced at
// use — every parameter spelling: plain, renamed, nested, defaulted, array ──

function introduceAll({ name, years: age }: { name: string, years: number }) {
  return `${name} is ${age}`
}

function burrowed({ inner: { tone } }: { inner: { tone: string } }) {
  return tone.toUpperCase()
}

function withDefault({ label = 'none' }: { label?: string }) {
  return label.trim()
}

function arrayed([first, second]: number[]) {
  return ((first + second) * 2)
}

console.log('plain:', introduceAll({ name: 'Ada', years: 36 }))
console.log('burrowed:', burrowed({ inner: { tone: 'warm' } }))
console.log('withDefault:', withDefault({}))
console.log('arrayed:', arrayed([2, 3]).toFixed(0))
