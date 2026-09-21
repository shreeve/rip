# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

## 1. Wrong or silent

- [ ] **Paint values are refused where they are written,** as layout
      values are: a color that is no color, an unknown `borderStyle`,
      and a weight flag that is not a boolean (`bold: 'no'` is bold)
      fail at the first paint, inside a scheduled frame.
- [ ] An error for a style names the node it was written on.
- [ ] PLAN §5 lists every stated divergence from Yoga, each with a pin:
      the rounding, the baseline child, **the owner's size in the cache
      key** (a `{width: 0, padding: '5%'}` box comes out 10×1 here and
      10×10 in Yoga, which reuses a measure taken under another owner
      width), **a first flex basis that stands for one pass** (a
      `flexBasis: '50%'` child laid out at 100 then 200 gives 100 here
      and 50 in Yoga), and **the float tolerance** (Yoga's float32
      `17.9 − 16 < 1.9` reports an overflow in an auto-sized wrapping
      container that doubles within a tolerance do not).

## 2. Tests the seeded bugs slipped past

Each of these survived a single-line bug seeded into the engine. Add
the test, re-seed the bug, and see it caught.

- [ ] An absolute node with an aspect ratio other than 1.
- [ ] A measure function on a node with padding and border; a measured
      size with a fraction rounds up (port Yoga's
      `YGRoundingMeasureFuncTest.cpp`).
- [ ] Negative padding clamps to zero; `overflow: 'scroll'` while
      measuring a basis; the gap count at the wrap limit; the
      lone-flexible-child shortcut with a shrink of zero.
- [ ] Port Yoga's hand-written JavaScript tests that the shim can carry
      (`YGMeasureTest`, `YGMeasureCacheTest`, `YGDirtiedTest`,
      `YGHasNewLayout`, `YGFlexBasisAuto`, `YGAlignBaseline`,
      `YGComputedMargin` / `Padding` / `Border`, `YGHadOverflow`).

## 3. Reading `layout.rip`

- [ ] Comment every field of `Lay` and `Flex`; name the five pass
      stamps for what they record; untangle `hold!` / `holds` / `held`
      / `HELD`, `pinned` / `pin!`, `owned`, and the two meanings of
      `left` and of `owner`.
- [ ] Name the dimension indices (`WIDTH`, `HEIGHT`) and give each enum
      one labelled group (`RELATIVE`, `WRAP`, `CONTENT_BOX`; `CONTENT`
      / `CONTENTS` / `MAX_CONTENT` and `FLEX` / `Flex` / `lay.flex`
      collide).
- [ ] Split `style!` (71 lines; name the ranks) and `compute!` (143
      lines; steps 2 and 9 are each written twice); comment the module
      globals as out-parameters and say why.
- [ ] Reading order: the cache flags sit 900 lines before "The cache";
      `baselined`, `percents`, `seat!`, `measureFixed` sit away from
      their sections.
- [ ] Say in the header why `for kid, i in` keeps an unused `i` (it
      compiles to a counted loop), or the loops get "cleaned".
- [ ] Remove what no suite reaches: `edges`, the `textOf` export,
      `flatten!` and the fallback arm of `kids`, the `border*` and
      `overflow` slots the document refuses, guards that cannot fire,
      `mainAxis`, parameters nobody reads. Fold the five `measured[0]`
      / `measured[1]` pairs, the two ascent / descent computations, and
      the inside sums. About 95 lines.
- [ ] Cite Yoga's functions, not C++ line numbers.
- [ ] Declare `lay` and `measure` in `Node`'s constructor; take `cols`
      and `rows` at `layout`'s door, as the rest of the package names
      them.

## 4. Layout cost

- [ ] **A layout boundary.** A change dirties every ancestor up to the
      root and each recomputes: a widened text in a flat column of
      2,000 costs 6,001 visits, and a chain of 14 definite-size boxes
      recomputes all 14. Stop at the first ancestor whose width and
      height are both definite (PLAN §5).
- [ ] First layout of a 1,551-node tree is about 665 µs; style parsing
      is a third of it.

## 5. The painter and the screen

- [ ] The style tables never evict, and a cell holds a style id in
      sixteen bits: an app that animates `'#rrggbb'` colors reaches the
      limit and is refused. Reclaim ids no cell uses.
- [ ] A layout error names the node it came from.
- [ ] `overflow: 'hidden'` clips (text wider than its box draws past it
      today); the per-edge border switches; then the document accepts
      both keys.
- [ ] `backgroundColor` on text fills its box, not only its glyphs —
      decide, and pin.
- [ ] Text wrapping, truncation, grapheme clusters (PLAN §6).
- [ ] Damage tracking: paint and diff only what moved (PLAN §6).

## 6. Compiler-side, filed separately

- A loop variable named like a tag (`i`, `a`, `b`, `p`) at the end of a
  render line takes the indented children beneath it.
- A bound effect that awaits marks its enclosing function `async`.
- `rip -t` prints a stack trace for a lexer error.
- `src/runtime/reactive.js` makes and aborts an `AbortController` on
  every effect run: half the CPU of the 40×8 table bench.
- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
