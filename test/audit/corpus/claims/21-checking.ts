// 21-checking.ts — the twin oracle: excess-property freshness, the weak-type
// rule, switch and else-if narrowing

// ── The excess-property check fires on a FRESH object literal, and only on a
// fresh one: the same extra key is legal once it arrives through a binding ──

type Placard = { heading: string }

let exactPlacard: Placard = { heading: 'welcome' }
let widenedSource = { heading: 'notice', footnote: 'small print' }
let inheritedPlacard: Placard = widenedSource
console.log('placards:', exactPlacard.heading, inheritedPlacard.heading)

// ── The weak-type rule: an all-optional type accepts the empty literal, and
// any subset of its own members ──

type Knobs = { mode?: string, depth?: number }

let noKnobs: Knobs = {}
let someKnobs: Knobs = { mode: 'quiet' }
let allKnobs: Knobs = { mode: 'loud', depth: 3 }
console.log('knobs:', noKnobs.mode, someKnobs.mode, allKnobs.depth)

// ── switch on a union discriminant narrows the arm ──

type Ring = { form: 'ring', radius: number }
type Tile = { form: 'tile', side: number }
type Bar = { form: 'bar', length: number }
type Facet = Ring | Tile | Bar

function spanOf(facet: Facet) {
  switch (facet.form) {
    case 'ring': return (facet.radius * 2)
    case 'tile': return (facet.side * 4)
    default: return (facet.length)
  }
}

console.log('spans:', spanOf({ form: 'ring', radius: 4 }), spanOf({ form: 'tile', side: 3 }), spanOf({ form: 'bar', length: 7 }))

// ── The same union narrowed by an else-if chain, inside a loop body ──

let facets: Facet[] = [{ form: 'ring', radius: 1 }, { form: 'tile', side: 2 }, { form: 'bar', length: 5 }]
let notes = facets.map((facet) => {
  if (facet.form === 'ring') {
    return `ring ${facet.radius}`
  } else if (facet.form === 'tile') {
    return `tile ${facet.side}`
  } else {
    return `bar ${facet.length}`
  }
})
console.log('notes:', notes)
