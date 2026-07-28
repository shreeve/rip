// 22-vocabulary.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck

type Twig = { label: string, shoots: Twig[] }
type Tallies = { [slot: string]: number, entries: number }
type Crate = { inner: { depth: number } }
type Firm = { note: string | undefined }

let coordinate: [string, number] = ['origin', 12]

function measure(sample: string): number
function measure(sample: number): string
function measure(sample: string | number): number | string {
  if (typeof sample === 'string') { return sample.length } else { return String(sample) } }

function echoOf<T extends string>(sample: T) {
  return sample }

let wrongAxis: number = coordinate[0]
let wrongTwig: Twig = { label: 'trunk', shoots: [{ label: 7, shoots: [] }] }
let wrongTallies: Tallies = { alpha: 1 }
let wrongCrate: Crate = { inner: { depth: 'far' } }
let wrongOverload: string = measure('alpha')
let wrongEcho = echoOf(7)
let wrongFirm: Firm = {}
let wrongDrift: string | undefined = 42
