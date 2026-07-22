// 23-assignments.ts — every binding form: simple assignment (inline, carried,
// indented), typed and optional-marked declarations, void, compound, method,
// and merge assignment, destructured patterns with defaults/rests, string-named
// class fields, computed and void object keys, and index/slice/pick targets

// ── Simple assignment: inline, value carried to the next line, indented body ──

let plain = 'assignments'
let carried =
'carried value'
let dropped =
  'indented value'
let annotated: string = 'typed'
let annotatedCarried: string =
'typed carried'
let annotatedDropped: string =
  'typed indented'

console.log(plain, carried, dropped, annotated, annotatedCarried, annotatedDropped)

// ── Optional-marked declarations: the `?` records; the lowering ignores it ──

let maybe = 1
let maybeCarried =
2
let maybeDropped =
  3
let maybeTyped: number = 4
let maybeTypedCarried: number =
5
let maybeTypedDropped: number =
  6

console.log(maybe, maybeCarried, maybeDropped, maybeTyped, maybeTypedCarried, maybeTypedDropped)

// ── Void assignment: the bang on the name suppresses the implicit return ──

let report = function(): void { console.log('report ran') }
let reportCarried =
function(): void { console.log('carried ran') }
let reportDropped =
  function(): void { console.log('dropped ran') }

report()
reportCarried()
reportDropped()

// ── Compound assignment: inline, carried, indented ──

let total = 10
total += 5
total -=
3
total *=
  2

console.log('total:', total)

// ── Method assignment: the target re-binds to a method call on itself ──

let label = '  rip  '
label = label.trim()

console.log('label:', label)

// ── Merge assignment: initialize-when-nullish, then merge into the target ──

let options: { host?: string, port?: number } | null = null
options = Object.assign(options ??= {}, { host: 'local' })
options = Object.assign(options ??= {}, { port: 8080 })

console.log('options:', options?.host, options?.port)

// ── Destructured patterns: renames, nesting, defaults (inline and indented), rests ──

let config = { host: 'localhost', port: 3000, meta: { retries: 2, mode: 'auto' } }
let { host, port: portNumber } = config
let { meta: { retries } } = config
let { mode = 'manual', ...metaRest } = config.meta
let { fallback =
    'none' } = { fallback: 'given' }
let [firstScore, ...restScores] = [7, 8, 9]

console.log(host, portNumber, retries, mode, metaRest.retries, fallback, firstScore, restScores.length)

// ── Object pairs: computed keys, indented values, void pairs, spreads, map keys ──

let keyName = 'alpha'
let dynamic = { [keyName]: 1 }
let nested =
  { outer: 'deep' }
let handlers = {
  ping(): void { console.log('ping') },
  pong(): void {
    console.log('pong')
  },
}
let merged = { ...config.meta, tagged: true }
let matchers = new Map([[/^rip/, 'language'], [/ts$/, 'suffix']])
let tagger = {
  seed: 'alpha',
  grab() { return new Map([[this['seed'], 1]]) },
}

console.log(dynamic.alpha, nested.outer, merged.tagged, matchers.size)
handlers.ping()
handlers.pong()
console.log('tagged:', tagger.grab().get('alpha'))

// ── String-named class fields: the TS spelling for names identifiers cannot carry ──

class MediaCard {
  'data-src' = '/cover.png';
  'data-width': number = 320;
  describe() { return `${this['data-src']} at ${this['data-width']}px` }
}

let card = new MediaCard()
console.log(card.describe())

// ── Index targets: the inline and indented key, slices, and the optional index ──
// (the regex-capture index text[/re/, n] is parked: its emission publishes
// TS2531 on every use, the match operator's root — see FINDINGS.md)

let scores = [10, 20, 30, 40]
let flatKey = scores[1]
let tallKey = scores[
  1
]
let midSlice = scores.slice(1, 3)
let tallSlice = scores.slice(
  0, 2
)
let settings: { theme: string, depth?: number } | null = { theme: 'dark' }
let softTheme = settings?.[
  'theme'
]

console.log(flatKey, tallKey, midSlice.length, tallSlice.length, softTheme)

// ── Pick targets: inline, optional, and both indented lists ──

let profile = { alpha: 1, beta: 2, gamma: 3 }
let picked = { alpha: profile.alpha }
let softPicked = settings == null ? undefined : { theme: settings.theme }
let stacked = {
  beta: profile.beta,
}
let softStacked = settings == null ? undefined : {
  depth: settings.depth,
}

console.log(picked.alpha, softPicked?.theme, stacked.beta, softStacked?.depth)

// ── import.meta and new.target as member spines ──

let moduleUrl = import.meta.url
let tagTarget = function() { return new.target?.name ?? 'called plain' }

console.log('from file url:', moduleUrl.startsWith('file:'), tagTarget())

// ── Generic component declaration: the one TYPE_PARAMS assignment ──
// (the carried and indented TYPE_PARAMS spellings are parked: the lexer mints
// TYPE_PARAMS only for a same-line `= component` head — see MANIFEST.md)

let Chip = class Chip<TLabel extends string> {
  label?: TLabel

  render() {
    return 'chip'
  }
}

console.log('generic component:', typeof Chip)
