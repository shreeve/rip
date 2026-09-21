# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

## 1. Wrong or silent

- [ ] **`justifyContent: 'space-around'` on a line with no in-flow
      item divides by zero** and turns the whole tree's boxes to
      Infinity or NaN (`layout root, 80` with `{justifyContent:
      'space-around', minHeight: 5}` whose only child is absolute).
      Yoga shares it. Guard it, and pin.
- [ ] **The flex freeze compares doubles exactly where Yoga compares
      float32 within a tolerance,** so plain integer trees come out
      wrong when a lone flexible child's share lands on its min, max,
      or padding floor: a 100×41 column of `{height: 30}` and `{height:
      25, minHeight: 11, flexShrink: 1}` gives 25 (Yoga 11); a 100×30
      root with `{height: 1, flexGrow: 7, maxHeight: '100%'}` gives 1
      (Yoga 30); a 200-wide row of `{maxWidth: 10, flexGrow: 1}` and
      `{maxWidth: 30, flexGrow: 0.2}` gives 0 and 0 (Yoga 10 and 30 —
      1.2 − 1 − 0.2 is negative in doubles). Compare within a
      tolerance, as Yoga's `inexactEquals` does, and pin all three.
- [ ] **A percent overshoots its reference in doubles** (`100 * x *
      0.01 > x` for about a fifth of fractional x, never in float32),
      so a `width: '100%'` child of a wrapping row can wrap when it
      fits. The line-break and overflow tests compare with no
      tolerance. Pin the 10-wide case from the parity review.
- [ ] Parity: an item that overflows to the next line still adds its
      auto margins to the line it left, which then ignores
      `justifyContent` (Yoga's `FlexLine.cpp`); the lone-flexible-child
      shortcut counts `display: none` children as Yoga does.
- [ ] PLAN §5 lists every stated divergence, each with a pin: the
      rounding, the baseline child, **the owner's size in the cache
      key** (Yoga reuses a measure taken under another owner width: a
      `{width: 0, padding: '5%'}` box comes out 10×1 here and 10×10 in
      Yoga), and **a first flex basis that stands for one pass, not
      until the node is dirtied** (a `flexBasis: '50%'` child laid out
      at 100 then 200 gives 100 here and 50 in Yoga).
- [ ] **`display` flex → contents → flex keeps stale child positions.**
      `display` is not a parsed slot, so `sync` sees no change and the
      cached layout stands (`none` ↔ `flex` and `hidden` are fine).
      Pin with a live toggle compared to a fresh mount.
- [ ] **Style values are refused where they are written, by name, with
      the node.** Today a bad value fails at the first layout, inside a
      scheduled frame, and these never fail at all:
      `flexGrow: 'lots'` → 0, `flex: '1 1 auto'` → ignored,
      `aspectRatio: '2'` → ignored, `alignItems: 'space-between'` →
      flex-end, `alignContent: 'baseline'` → flex-start (one word list
      serves the three align keys), `padding: 'auto'` / `gap: 'auto'` /
      `minWidth: 'auto'` → 0, `width: '50px%'` → 50% (`parseFloat`),
      `width: -5` and `width: NaN` → auto, `hidden: 'false'` → hidden,
      any truthy `bold`. The error for a length recommends `'auto'` on
      keys that do not take it.
- [ ] **`flex` has no test.** Pin the shorthand and what it expands to.
- [ ] README: an absolute node positions against its PARENT unless every
      box between is `position: 'static'`; the defaults list omits
      `position: 'relative'`; "all 543 cases" is the LTR half of each;
      there are two stated divergences (rounding, the baseline child),
      not one. The `Gauge` example has no fixed point at some widths
      (its text changes the space it measures) — give the readout a
      fixed width.
- [ ] PLAN: "about four measure entries" (eight); "one recursive
      `layout(node, …)`" (`visit` and `compute!`); "dirty propagation
      stops at a boundary" (it climbs to the root — say what the engine
      really skips); the MIT notice does not ship in `files`; three
      passages describe a `direction` argument that does not exist.

## 2. Tests the seeded bugs slipped past

Each of these survived a single-line bug seeded into the engine. Add
the test, re-seed the bug, and see it caught.

- [ ] Shorthands — `margin`, `marginX` / `marginY`, `paddingX` /
      `paddingY`, `gap`, `flex`, `borderStyle` insets, and their
      precedence against longhands. The Yoga shim writes longhands
      only, so nothing reaches this code.
- [ ] An absolute node with an aspect ratio other than 1.
- [ ] A measure function on a node with padding and border; a measured
      size with a fraction rounds up (port Yoga's
      `YGRoundingMeasureFuncTest.cpp`).
- [ ] Negative padding clamps to zero; `overflow: 'scroll'` while
      measuring a basis; the gap count at the wrap limit; the
      lone-flexible-child shortcut with a shrink of zero.
- [ ] Fuzz: a pair of texts of equal width and different height, moves
      of a subtree between parents, sibling reorders; print the failing
      tree; stop at the first failure; say in the header that
      `rip test/fuzz.rip 7 413` replays seed 7 through round 412.
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

- [ ] **`flex: n` turns the cache off up to the root.** It writes a
      point basis, so its container counts as order-sensitive whenever
      its main size is not a plain number, and every ancestor recomputes
      every pass: one text change costs 2,325 visits and 268 µs where
      the same tree with `flexGrow: 1` costs 307 visits and 40 µs.
      Narrow the rule soundly — two attempts at "only containers
      offered an undefined main size" still fail the fuzz.
- [ ] `parse`: a node parsed for the first time skips the change scan
      (about 7% of a first layout).

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
