// 31-reactive.ts — the plain-TS twin of the reactive vocabulary: state → let,
// computed and readonly → const, an effect's disposer spelled as a value
// (ROADMAP.md, Oracles). Where a write re-fires an effect, the twin replays
// the flush by hand — those lines are marked.

// ── State (:=): inline, carried, indented; opt-marked; annotated ──

let count = 0
let label: string = 'idle'
let mood = 'steady'
let tone = 'calm'
let maybe = 1
let maybeCarried = 2
let maybeDropped = 3
let maybeTyped: number = 4
let maybeTypedDropped: number = 5
let typedCarried: string = 'typed carried'
let typedDropped: string = 'typed dropped'

console.log(count, label, mood, tone, maybe, maybeCarried, maybeDropped, maybeTyped, maybeTypedDropped, typedCarried, typedDropped)

// ── Computed (~=) ──

const doubled = count * 2
const half = count / 2
const sized = label.length
const sizedCarried = label.length + 1
const sizedDropped = label.length + 2
const ratio: number = count / 4
const ratioCarried: number = count / 5
const ratioDropped: number = count / 6
const summaryCarried: string = 'summary carried'
const summaryDropped: string = 'summary dropped'

console.log(doubled, half, sized, sizedCarried, sizedDropped, ratio, ratioCarried, ratioDropped, summaryCarried, summaryDropped)

// ── Readonly (=!) ──

const limit = 100
const limitCarried = 101
const limitDropped = 102
const cap = 10
const capCarried = 11
const capDropped = 12
const capTyped: number = 13
const capTypedCarried: number = 14
const capTypedDropped: number = 15
const ceiling: number = 201
const ceilingDropped: number = 202

console.log(limit, limitCarried, limitDropped, cap, capCarried, capDropped, capTyped, capTypedCarried, capTypedDropped, ceiling, ceilingDropped)

// ── Effects (~>): named (the binding is the disposer), bare, annotated ──

const watcher = (() => { console.log('watcher sees', count); return () => {} })()
const watcherCarried = (() => { console.log('carried watcher ran'); return () => {} })()
const watcherDropped = (() => { console.log('dropped watcher ran'); return () => {} })()
console.log('bare effect sees', label)
console.log('bare carried ran')
console.log('bare dropped ran')
const typedCarriedEffect: Function = (() => { console.log('typed carried effect ran'); return () => {} })()
const typedDroppedEffect: Function = (() => { console.log('typed dropped effect ran'); return () => {} })()

// ── Reactivity in motion: the re-fired watcher is replayed by hand ──

let pulse = 1
const pulseWatcher = (() => { console.log('pulse is', pulse); return () => {} })()
pulse = 3
console.log('pulse is', pulse) // replay: the watcher re-fires on the write
pulseWatcher()
pulse = 9 // disposed — nothing re-fires, so nothing is replayed
console.log('pulse settled at', pulse)

// ── Disposal: a named effect's binding is its disposer ──

watcher()
watcherCarried()
watcherDropped()
typedCarriedEffect()
typedDroppedEffect()

// ── Exported spellings ──

export let tally = 0
export let banner: string = 'ready'
export let bannerCarried: string = 'ready carried'
export let bannerDropped: string = 'ready dropped'
export const tallyTwice = tally * 2
export const note: string = 'note inline'
export const noteCarried: string = 'note carried'
export const noteDropped: string = 'note dropped'
export const flagMax = 50
export const span: number = 60
export const spanCarried: number = 61
export const spanDropped: number = 62
export const sentry = (() => { console.log('sentry sees', tally); return () => {} })()
export const sentryTyped: Function = (() => { console.log('typed sentry ran'); return () => {} })()
export const sentryCarried: Function = (() => { console.log('carried sentry ran'); return () => {} })()
export const sentryDropped: Function = (() => { console.log('dropped sentry ran'); return () => {} })()

console.log('exports:', tally, tallyTwice, banner, bannerCarried, bannerDropped, note, noteCarried, noteDropped, flagMax, span, spanCarried, spanDropped)
