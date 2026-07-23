// 30-types.ts — the erased-type surface twin: aliases, typeof, generics,
// interfaces, enums, the forward declaration, overload signatures, and
// `as` casts. Enums mirror rip's lowering — one const object holding
// forward and reverse entries plus a same-name companion type — because
// that pair is the construct's honest TypeScript shape (a native TS enum
// would diverge at runtime: string enums get no reverse entries there).

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
