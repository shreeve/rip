// 30-types.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

type Code = number
type Chart = { mode: string }
type Crate<T> = { item: T }
interface Route {
  path: string }
let label = 'five'
const Tier = {
  free: 0, 0: 'free',
  paid: 1, 1: 'paid' }

let wrongAlias: Code = 'zero'
let wrongShape: Chart = { mode: 4 }
let wrongCrate: Crate<number> = { item: 'pearl' }
let wrongRoute: Route = {}
let wrongCast = (label as number)
let wrongMember = Tier.pro
