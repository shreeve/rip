// 14-schema.errors.ts — the line-aligned twin: tsgo's diagnostics derive each expected code and position; the rank line carries a CORRECT default, so the wrong-typed default on the rip side stays pinned rather than deriving zod's own code.
// @ts-nocheck
import { z } from 'zod'
const Person = z.object({
  name: z.string(),
  tag: z.union([z.literal('a'), z.literal('b')]),
  rank: z.number().default(3) })
type Person = z.infer<typeof Person>
const Cart = z.object({
  items: z.number().array() }).transform((c) => ({
  ...c, total: c.items.length }))

const Color = z.enum([
  'red',
  'green'])
type Color = z.infer<typeof Color>
const Stamp = z.object({
  at: z.string().optional() })

const Order = z.object({
  ...Stamp.shape,
  qty: z.number().int().min(1).max(99),
  code: z.string(),
}).refine((o) => o.qty > 0)



const wrongAssign: Person = { name: 42, tag: 'a' }
const wrongLiteral: Person = { name: 'ok', tag: 'c' }
const wrongRead = Person.parse({ name: 'x', tag: 'a' }).nope
const wrongEnum: Color = 'mauve'
const wrongConstruct = new Person()
const wrongGetter: string = Cart.parse({ items: [3] }).total
