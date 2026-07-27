// 22-vocabulary.ts — the twin oracle: tuple positions, recursive aliases, index
// signatures, deep members, overload returns, generic call-site inference, and the two ways a member can be optional

// ── Tuple positions type independently: each index reads its own member ──

let coordinate: [string, number] = ['origin', 12]
let axisName = coordinate[0]
let axisStep = coordinate[1]
let axisPair: [string, number] = [axisName, axisStep]

console.log('tuple:', axisPair)

// ── A recursive alias resolves, and checks all the way down a deep literal ──

type Twig = { label: string, shoots: Twig[] }

let canopy: Twig = { label: 'trunk', shoots: [{ label: 'limb', shoots: [{ label: 'bud', shoots: [] }] }] }

console.log('recursive:', canopy.shoots[0].shoots[0].label)

// ── An index signature admits extra keys while its named members stay required ──

type Tallies = { [slot: string]: number, entries: number }

let counters: Tallies = { entries: 2, alpha: 1, beta: 5 }

console.log('index:', counters.entries.toFixed(0), counters.alpha.toFixed(0))

// ── A deep member is checked at its own depth ──

type Crate = { inner: { depth: number } }

let packed: Crate = { inner: { depth: 3 } }

console.log('deep:', packed.inner.depth.toFixed(0))

// ── Overload resolution picks the MATCHED signature's return, where the
// overloads' returns differ ──

function measure(sample: string): number
function measure(sample: number): string
function measure(sample: string | number): number | string {
  if (typeof sample === 'string') { return sample.length } else { return String(sample) }
}

let measuredLength = measure('alpha')
let measuredLabel = measure(7)
let overloadPair: [number, string] = [measuredLength, measuredLabel]

console.log('overloads:', overloadPair)

// ── Generic call-site inference preserves the literal type rather than
// widening it to the constraint ──

function echoOf<T extends string>(sample: T) {
  return sample
}

let echoed = echoOf('narrow')
let narrowed: 'narrow' = echoed

console.log('generic:', narrowed.toUpperCase())

// ── A union-with-`undefined` member DEMANDS its key; `?:` does not ──

type Firm = { note: string | undefined }
type Lax = { note?: string }

let stated: Firm = { note: undefined }
let omitted: Lax = {}
let optionality = [stated.note, omitted.note]

console.log('optionality:', optionality)

// ── A nullable-union target accepts each arm ──

let drift: string | undefined = 'settled'
drift = undefined
let sounding: number | null = 4
sounding = null
let nullables: [string | undefined, number | null] = [drift, sounding]

console.log('nullable:', nullables)
