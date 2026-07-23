// 22-collections.ts — objects, arrays, ranges, slices, splats, elisions,
// pick: every collection shape — object and *{} map literals, sparse-array
// elisions, range values, slice reads, array and object spreads, and the
// pick family across plain, optional, and multiline heads

// ── Object literals, and the `*{}` map literal ──

let person = { name: 'ada', role: 'engineer' }
let record = { type: 'row', class: 'wide' }
let profile: { name: string, nick?: string, tag?: string } = { name: 'grace' }
let maybePerson: { name: string, role: string } | null = person
let scores = new Map([['alpha', 1], ['beta', 2]])

console.log('objects:', person.role, record.type, profile.name, scores.get('alpha'))

// ── Arrays: dense, spread, and sparse-array elisions ──

let values = [10, 20, 30, 40, 50]
let extended = [0, ...values]
let sparse = [, 60, , 70]
let holes = [,,]
let padded = [80, ,]
let stacked = [90, ,
  100, ,
]
let ragged = [110, , 120]
let layered = [
  130,
  140,
]

console.log('arrays:', extended.length, sparse.length, holes.length, padded.length, stacked.length, ragged.length, layered.length)

// ── Ranges — inclusive and exclusive — and slice reads ──

let upto = Array.from({ length: 5 }, (_, i) => i + 1)
let strictly = Array.from({ length: 4 }, (_, i) => i + 1)
let mid = values.slice(1, 4)
let tail = values.slice(2)
let front = values.slice(0, 3)
let whole = values.slice(0)

console.log('ranges:', upto, strictly, mid, tail, front, whole)

// ── Pick: shorthand, rename, defaults, keyword keys (tight braces), optional heads, multiline bodies ──

let duo = { ...{ name: person.name, role: person.role } }
let who = { ...{ label: person.name } }
let filled = { ...{ nick: profile.nick ?? 'none' } }
let badged = { ...{ badge: profile.tag ?? 'core' } }
let branded = { ...{ type: record.type, class: record.class } }
let opted = { ...(maybePerson == null ? undefined : { name: maybePerson.name }) }
let tall = {
  ...{
    name: person.name,
    role: person.role,
  },
}
let optTall = {
  ...(maybePerson == null ? undefined : {
    name: maybePerson.name,
    role: maybePerson.role,
  }),
}
let wider = { ...{ name: person.name, role: person.role } }

console.log('picks:', duo, who, filled, badged, branded, opted, tall, optTall, wider)

// ── Object spread: identifier, literal, parenthetical, member, soak, index, call, dammit, dynamic-import heads ──

let conf = { limits: { max: 9 } }
let maybeConf: { limits: { max: number } } | null = conf
let api = { fresh() { return { token: 'abc' } } }
let makeDefaults = function() { return { retries: 2 } }
let fetchDefaults = function() { return Promise.resolve({ ready: true }) }
let rows = [{ id: 1 }, { id: 2 }]

let clone = { ...person, copied: true }
let merged = { ...{ fresh: 1 }, stale: 0 }
let fallback = { ...(maybePerson ?? person) }
let capped = { ...conf.limits }
let soft = { ...maybeConf?.limits }
let firstRow = { ...rows[0] }
let secondRow = { ...rows[1] }
let issued = { ...api.fresh() }
let defaulted = { ...makeDefaults(), audited: true }
let eager = { ...await fetchDefaults() }

console.log('spreads:', clone, merged, fallback, capped, soft, firstRow, secondRow, issued, defaulted, eager, { ...import('./22-collections'), loaded: false })

// ── Spread heads that need a class: `super()`, `super.method()`, and `this` ──

class Row {
  base() { return { id: 0, shape: 'row' } }
}

class WideRow extends Row {
  base() { return { ...super.base(), width: 2 } }
  meta() { return { ...super.base(), noted: true } }
  dump() { return { ...this } }
}

let wide = new WideRow()
console.log('classes:', wide.base(), wide.meta(), wide.dump())
