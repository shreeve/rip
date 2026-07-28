// 21-checking.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck

type Placard = { heading: string }
type Knobs = { mode?: string, depth?: number }
type Ring = { form: 'ring', radius: number }
type Tile = { form: 'tile', side: number }
type Facet = Ring | Tile

function wrongSwitchArm(facet: Facet) {
  switch (facet.form) {
    case 'ring': return facet.side
    default: return facet.radius } }

function wrongChainArm(facet: Facet) {
  if (facet.form === 'ring') {
    return facet.side
  } else {
    return facet.radius } }

let wrongExcess: Placard = { heading: 'hello', footnote: 'extra' }
let wrongKnobs: Knobs = { unrelated: 1 }
