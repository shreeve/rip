// 11-types.ts — the twin oracle for 11-types.rip.

// ── type aliases: simple, union, function ──

type Port = number
type Flag = boolean | 'auto'
type Format = (value: number) => string

let port: Port = 8080
let flag: Flag = 'auto'
let fmt: Format = (value) => '$' + String(value)

console.log('port:', port, 'flag:', flag, 'fmt:', fmt(3))

// ── object aliases: the inline literal and the indented block ──

type Host = { name: string, port?: number }

type Bounds = {
  low: number
  high: number
}

let host: Host = { name: 'edge' }
let bounds: Bounds = { low: 1, high: 9 }

console.log('host:', host.name, host.port ?? port, 'bounds:', bounds.low, bounds.high)

// ── typeof: a value's inferred shape, named ──

let defaults = { theme: 'dark', depth: 2 }
type Defaults = typeof defaults

let tuned: Defaults = { theme: 'light', depth: 3 }

console.log('tuned:', tuned.theme, tuned.depth)

// ── generic aliases: parameters and a constraint ──

type Boxed<T> = { item: T }
type Mapper<T, R> = (input: T) => R
type Keyed<T extends { id: number }> = T & { key: string }

let boxed: Boxed<string> = { item: 'pearl' }
let stringify: Mapper<number, string> = (input) => String(input)
let keyed: Keyed<{ id: number }> = { id: 4, key: 'k4' }

console.log('boxed:', boxed.item, stringify(8), keyed.key)

// ── interfaces: extension, optional and method members, generic ──

interface Signal {
  name: string
  level: number
}

interface Alarm extends Signal {
  acknowledged: boolean
}

interface Sink {
  accept(entry: string): string
  flush?: () => void
}

interface Registry<T> {
  entries: T[]
  find(key: string): T | undefined
}

let alarm: Alarm = { name: 'smoke', level: 2, acknowledged: false }
let sink: Sink = { accept: (entry) => 'sunk ' + entry }
let registry: Registry<Alarm> = { entries: [alarm], find: (key) => registry.entries.find((s) => s.name === key) }

console.log('alarm:', alarm.level, sink.accept('log'), sink.flush?.(), registry.find('smoke')?.acknowledged)

// ── enums: one const object, forward and reverse entries ──

const Direction = { north: 0, south: 1, 0: 'north', 1: 'south' }
type Direction = (typeof Direction)[keyof typeof Direction]

const Status = { draft: 'D', final: 'F', D: 'draft', F: 'final' }
type Status = (typeof Status)[keyof typeof Status]

export const Priority = { low: 1, standby: 2, urgent: 9, 1: 'low', 2: 'standby', 9: 'urgent' }
export type Priority = (typeof Priority)[keyof typeof Priority]

let pick: Status = Status.final

console.log('direction:', Direction, Direction.north, Direction[1])
console.log('status:', Status.draft, 'priority:', Priority.standby, Priority.urgent)
console.log('pick:', pick)

// ── the bare typed forward declaration ──

function choosePort(): Port {
  let chosen!: Port
  if (Direction.north < Direction.south) {
    chosen = 443
  } else {
    chosen = 80
  }
  return chosen
}

console.log('chosen:', choosePort())

// ── bodiless overload signatures: the face of one implementation ──

function describe(id: number): string
function describe(id: string): string
function describe(id: number | string): string {
  return `entry ${id}`
}

console.log(describe(7), describe('seven'))

// ── exported type declarations ──

export type Outcome = 'ok' | 'failed'

export interface Manifest {
  version: number
}

let outcome: Outcome = 'ok'
let manifest: Manifest = { version: 4 }

console.log('outcome:', outcome, manifest.version)

// ── casts: `as` narrows for the checker and erases at runtime ──

let payload: unknown = 'stored'
let text = payload as string
let count = (JSON.parse('[3,4]') as number[]).length
let veiled = payload as unknown as { deep: boolean }

console.log('cast:', text.length, count, typeof veiled)

// ── keyword types: the primitive vocabulary an annotation can name ──

type Loose = any
type Bag = object
type Marked = symbol
type Huge = bigint
type Yes = true
type No = false

let loose: Loose = 'anything'
let bag: Bag = { crate: true }
let marked: Marked = Symbol('mark')
let huge: Huge = 9007199254740993n
let affirmed: Yes = true
let denied: No = false

console.log('keywords:', loose, typeof bag, typeof marked, huge, affirmed, denied)

// ── never: the return of a function that only throws ──

function refuse(reason: string): never {
  throw new Error(reason)
}

console.log('never:', typeof refuse)

// ── operators and access: keyof, readonly, indexed access, index signature ──

type HostKey = keyof Host
type Frozen = readonly string[]
type Locked = { readonly id: number }
type HostName = Host['name']
type Counts = { [label: string]: number }

let hostKey: HostKey = 'name'
let frozen: Frozen = ['a', 'b']
let locked: Locked = { id: 7 }
let hostName: HostName = 'edge'
let counts: Counts = { hits: 3 }

console.log('operators:', hostKey, frozen[0], locked.id, hostName, counts.hits)

// ── tuples: named members, an optional tail, a rest element ──

type Entry = [first: string, second: number]
type Trailing = [string, number?]
type Trail = [string, ...number[]]

let entry: Entry = ['a', 1]
let trailing: Trailing = ['b']
let trail: Trail = ['c', 2, 3]

console.log('tuples:', entry[0], entry[1], trailing[0], trail.length)

// ── conditional types: the branch, and `infer` inside it ──

type IsText<T> = T extends string ? 'yes' : 'no'
type Elem<T> = T extends Array<infer U> ? U : never

let isText: IsText<string> = 'yes'
let elem: Elem<number[]> = 5

console.log('conditional:', isText, elem)

// ── a self-referential alias: the type names itself ──

type Branch = { label: string, kids: Branch[] }

let branch: Branch = { label: 'root', kids: [{ label: 'leaf', kids: [] }] }

console.log('recursive:', branch.label, branch.kids.length, branch.kids[0].label)

// ── a call signature: the callable object type ──

type Formatter = { (value: number): string }

let formatter: Formatter = (value) => '#' + String(value)

console.log('callable:', formatter(5))

// ── narrowing annotations: the type predicate and the assertion ──

function looksText(value: unknown): value is string {
  return typeof value === 'string'
}

function mustText(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error('not text')
  }
}

console.log('predicate:', looksText('a'), looksText(1), typeof mustText)

// ── `this` as a return type: the method that returns its receiver ──

class Tally {
  count: number = 0
  bump(): this {
    this.count = this.count + 1
    return this
  }
}

console.log('this:', new Tally().bump().bump().count)

// ── an abstract construct signature ──

type Shaped = { id: number }

let maker: (abstract new () => Shaped) = class {
  id: number = 3
}

console.log('abstract:', typeof maker)
