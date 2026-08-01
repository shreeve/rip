// 14-schema.ts — the twin oracle for 14-schema.rip.
// Every schema symbol's hover is pinned rather than twin-judged (the runner's rip-native rule), so this file owes only the type story and byte-identical output.

import { z } from 'zod'

// ── Field forms: required, optional, defaults, literal unions, arrays, nested schemas ──

const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  zip: z.string().nullish(),
})

const PersonSchema = z.object({
  name: z.string(),
  age: z.number().nullish(),
  role: z.string().default('guest'),
  tier: z.union([z.literal('basic'), z.literal('pro')]),
  scores: z.number().array(),
  home: AddressSchema.nullish(),
})

type Person = z.infer<typeof PersonSchema>

let ada = PersonSchema.parse({ name: 'Ada', age: 36, tier: 'pro', scores: [3, 9], home: { street: 'Loop Rd', city: 'London' } })
let guest = PersonSchema.parse({ name: 'Guest', tier: 'basic', scores: [] })

console.log(`person: ${ada.name} ${ada.role} ${ada.tier} ${ada.home?.city}`)
console.log(`guest: ${guest.name} ${guest.role} ${guest.age ?? 0} ${guest.scores.length}`)

// ── Coercion built-ins and constraints ──

const ReadingSchema = z.object({
  celsius: z.coerce.number(),
  taken: z.coerce.date(),
  label: z.string().min(2).max(40),
  ref: z.string().regex(/^[A-Z]{2}-\d+$/),
})

type Reading = z.infer<typeof ReadingSchema>

let reading = ReadingSchema.parse({ celsius: '21.5', taken: '2026-07-23T10:00:00Z', label: 'north wing', ref: 'AB-42' })

console.log(`reading: ${reading.celsius} ${reading.taken.toISOString()} ${reading.label} ${reading.ref}`)

// ── Transforms ──

const VendorSchema = z.object({
  Id: z.string(),
  DisplayName: z.string(),
}).transform((it) => ({
  id: it.Id,
  displayName: it.DisplayName,
}))

let vendor = VendorSchema.parse({ Id: 'V-9', DisplayName: 'Acme Corp' })

console.log(`vendor: ${vendor.id} ${vendor.displayName}`)

// ── The callable surface: eager transform for the derived field; the lazy getter and the method are parity-only spellings, and `.refine()` is the @ensure analogue ──

const CartSchema = z.object({
  items: z.number().array(),
  taxRate: z.number(),
}).transform((c) => {
  let subtotal = c.items.reduce((a, b) => a + b, 0)
  return {
    ...c,
    subtotal,
    total: subtotal * (1 + c.taxRate),
    describe: () => `${c.items.length} items`,
  }
}).refine((c) => c.items.length > 0, { message: 'a cart needs items' })

let cart = CartSchema.parse({ items: [700, 550], taxRate: 0.1 })
const cartTotal: number = cart.total
const cartLabel: string = cart.describe()

console.log(`cart: ${cart.subtotal} ${cartTotal} ${cartLabel}`)

// ── :enum ──

const StatusSchema = z.enum(['open', 'closed'])

console.log(`status: ${StatusSchema.parse('open')}`)

// ── :union with a discriminant ──

const EmailContactSchema = z.object({
  kind: z.literal('email'),
  address: z.string(),
})

const PhoneContactSchema = z.object({
  kind: z.literal('phone'),
  number: z.string(),
})

const ContactSchema = z.discriminatedUnion('kind', [
  EmailContactSchema,
  PhoneContactSchema,
])

let reach = ContactSchema.parse({ kind: 'phone', number: '555-0100' })

console.log(`contact: ${reach.kind}`)
if (reach.kind === 'phone') {
  console.log(`dial: ${reach.number}`)
}

// ── :mixin as .extend() ──

const StampedSchema = z.object({
  createdBy: z.string(),
})

const DocSchema = StampedSchema.extend({
  title: z.string(),
})

let doc = DocSchema.parse({ title: 'Charter', createdBy: 'ada' })

console.log(`doc: ${doc.title} by ${doc.createdBy}`)

// ── :model and the named-coercer registry: declare-only in the fixture; the twin mirrors the runtime surface actually exercised (a value exists) ──

const AccountSchema = z.object({
  handle: z.string(),
  contact: z.string(),
})

console.log(`model: ${typeof AccountSchema}`)

// ── The inline body spelling ──

const TinySchema = z.object({ note: z.string().nullish() })

console.log(`tiny: ${typeof TinySchema}`)

// ── Companion types at use sites ──

function describePerson(p: Person): string {
  return `${p.name} (${p.role})`
}

function cheapest(readings: Reading[]): Reading {
  return readings[0]
}

console.log(describePerson(ada))
console.log(`cheapest: ${cheapest([reading]).ref}`)
