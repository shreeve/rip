// 26-schema.ts — the twin oracle for 26-schema.rip.
// Every schema symbol's hover is pinned rather than twin-judged (the runner's rip-native rule), so this file owes only the type story and byte-identical output.

import { z } from 'zod'

// ── A schema-array field projects the nested companion, and a deep read types the leaf ──

const HopSchema = z.object({
  port: z.string(),
  miles: z.number(),
})

const WaybillSchema = z.object({
  code: z.string(),
  hops: HopSchema.array(),
})

// A named type, not `z.infer`: an inferred alias EXPANDS at a hover where the rip side names its companion, and the twin is the oracle for that comparison.
interface Hop { port: string, miles: number }

const waybill = WaybillSchema.parse({ code: 'W-1', hops: [{ port: 'Dover', miles: 21 }, { port: 'Calais', miles: 34 }] })

const leafPort: string = waybill.hops[0].port
const leafMiles: number = waybill.hops[1].miles

console.log('nested:', leafPort, leafMiles)

// ── A plain datetime field projects Date, and parse coerces an ISO string into one ──

const StampSchema = z.object({
  at: z.coerce.date(),
})

const stamped = StampSchema.parse({ at: '2026-07-28T09:00:00Z' })
const minted: Date = stamped.at

console.log('datetime:', minted.toISOString())

// ── A callable body derives and interpolates, and both reach the caller ──
// zod spells callables as ordinary methods on the parsed value, so the cast the rip side needs has no analogue here.

const ParcelSchema = z.object({
  label: z.string(),
  units: z.number(),
  price: z.number(),
})

const base = ParcelSchema.parse({ label: 'crate', units: 3, price: 4 })
const parcel = { ...base, weight: base.units * base.price, slip: () => `${base.label}/${base.units}` }

console.log('callable:', parcel.weight, parcel.slip())

// ── A schema companion resolves inside generic type arguments ──

async function fetchHop(): Promise<Hop> {
  return HopSchema.parse({ port: 'Ostend', miles: 12 })
}

function heldHops(): Hop[] {
  return [HopSchema.parse({ port: 'Bruges', miles: 8 })]
}

const fetched = await fetchHop()
const held = heldHops()

console.log('generic args:', fetched.port, held[0].miles)
