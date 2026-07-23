// 33-schema.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position. The wrongGetter row has no
// honest zod spelling — the transform-derived total is a real number
// here, so its line stays quiet and the rip side pins it
// (error-pins.json).
// @ts-nocheck
import { z } from 'zod'
const Person = z.object({
  name: z.string(),
  tag: z.union([z.literal('a'), z.literal('b')]) })
type Person = z.infer<typeof Person>
const Cart = z.object({
  items: z.number().array() }).transform((c) => ({
  ...c, total: c.items.length }))

const Color = z.enum([
  'red',
  'green'])
type Color = z.infer<typeof Color>


const wrongAssign: Person = { name: 42, tag: 'a' }
const wrongLiteral: Person = { name: 'ok', tag: 'c' }
const wrongRead = Person.parse({ name: 'x', tag: 'a' }).nope
const wrongEnum: Color = 'mauve'
const wrongConstruct = new Person()
const wrongGetter: number = Cart.parse({ items: [3] }).total
