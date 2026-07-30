// 11-types.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck

type Code = number
type Chart = { mode: string }
type Crate<T> = { item: T }
type Mode = 'on' | 'off'
type Named = { name: string }
type Sized = { size: number }
type Constrained<T extends Code> = { key: T }
interface Route {
  path: string
  serve(id: number): string }
interface Beacon {
  level: number }
interface Strobe extends Beacon {
  hue: string }
let veiled: unknown = 'kept'
let notify: () => void = () => undefined
let label = 'five'
const Tier = {
  free: 0, 0: 'free',
  paid: 1, 1: 'paid' }
type Loose = any
type Locked = { readonly id: number }
type Counts = { [label: string]: number }
type Entry = [first: string, second: number]
type Trio = [string, number, string]
type Trailing = [string, number?]
type Trail = [string, ...number[]]
type IsText<T> = T extends string ? 'yes' : 'no'
type Elem<T> = T extends Array<infer U> ? U : never
type Branch = { label: string, kids: Branch[] }
type Formatter = { (value: number): string }
type Copy<T> = { [K in keyof T]: T[K] }
type Guard = { check: (value: unknown) => value is string }
let locked: Locked = { id: 1 }

let wrongAlias: Code = 'zero'
let wrongShape: Chart = { mode: 4 }
let wrongCrate: Crate<number> = { item: 'pearl' }
let wrongRoute: Route = {}
let wrongCast = (label as number)
let wrongMember = Tier.pro
let wrongMode: Mode = 'maybe'
let wrongJoined: Named & Sized = { name: 'kit' }
let wrongConstrained: Constrained<string> | null = null
let wrongStrobe: Strobe = { hue: 'crimson' }
let wrongVeiled: string = veiled
let wrongNotify: string = notify()
let wrongLoose: Loose[] = 5
let wrongObject: object = 5
let wrongSymbol: symbol = 'sym'
let wrongBigint: bigint = 5
let wrongTrue: true = false
let wrongFalse: false = true
let wrongNever: never = 1
let wrongKeyof: keyof Chart = 'nope'
locked.id = 5
let wrongIndexed: Chart['mode'] = 4
let wrongCounts: Counts = { hits: 'x' }
let wrongEntry: Entry = ['a', 'b']
let wrongTrio: Trio = ['a', 'a', 'a']
let wrongTrailing: Trailing = ['a', label]
let wrongTrail: Trail = ['a', label]
let wrongIsText: IsText<number> = 'yes'
let wrongElem: Elem<string[]> = 5
let wrongBranch: Branch = { label: 'r', kids: [{ label: 2, kids: [] }] }
let wrongFormatter: Formatter = 5
let wrongCopy: Copy<Chart> = { mode: 9 }
let wrongGuard: Guard = { check: 5 }
let wrongAbstract: (abstract new () => Chart) = 5
function wrongPredicate(value: number): value is string {
  return true }
function wrongAsserts(value: number): asserts value is string {
  return undefined }
class WrongTally {
  bump(): this {
    return this } }
let wrongThis: number = new WrongTally().bump()
let presets = { theme: 'dark', depth: 2 }
type Presets = typeof presets
let wrongPreset: Presets = { theme: 7, depth: 3 }
