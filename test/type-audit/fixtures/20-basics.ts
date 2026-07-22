// 20-basics.ts — the corpus ground floor: program skeleton, every
// literal form (numbers, strings, regex, heregex, symbols), `this`, parentheticals, do-IIFE

// ── Number, boolean, null, undefined literals ──

let integer = 42
let float = 3.14
let hex = 0xff
let grouped = 1_000_000
let truthy = true
let falsy = false
let nil: null = null
let absent: undefined = undefined

console.log('numbers:', integer, float, hex, grouped)
console.log('others:', truthy, falsy, nil, absent)

// ── Strings: quotes, interpolation (plain, empty, multiline), heredoc ──

let single = 'single quotes'
let double = "double quotes"
let interpolated = `mix of ${single} and ${double}`
let gap = `gap end`
let multiline = `sum ${
  integer + float
}!`
let heredoc = `\
  alpha
  beta\
`

console.log(interpolated, gap, multiline)
console.log(heredoc)

// ── Regex literals: plain, and heregex (whitespace, comments, interpolation) ──

let regex = /ab+c/g
let heregex = RegExp(
  'ab+' +      // letters, then an interpolated tail
  single,
'i')

console.log('regex:', regex, heregex)

// ── Symbol literals: `:name` is Symbol.for("name") ──

let symbol = Symbol.for('alpha')
console.log('symbol:', symbol)

// ── `this`: the keyword, bare `@`, and the string-keyed `@'…'` ──

let host = {
  tag: 'host',
  'data-x': 9,
  show() { return this.tag },
  whoami() { return String(this) },
  peek() { return this['data-x'] },
}
console.log(host.show(), host.whoami(), host.peek())

// ── Parentheticals: grouping, and the multiline body ──

let parenthetical = (integer + 1) * 2
let tall = (
  integer +
  float
)

console.log('parenthetical:', parenthetical, 'tall:', tall)

// ── do-IIFE, and a function literal as a chain subject ──

let iife = (function() { return integer * 2 })()
let seeded = (function(seed = 5) { return seed + 1 })()
let chain = (function() { return 7 })
.bind(null)
let noop = function() {
  // a comment-only body still parses — the empty block
}
console.log('iife:', iife, 'seeded:', seeded)
// the corpus default is explicit parens; this one paren-less call keeps the implicit spelling covered (21-operations owns invocation)
console.log(typeof chain, typeof noop)

// ── Program skeleton: a bare statement, and a trailing terminator on the last line ──

debugger
let done = 'basics';
