# Rip TUI — Plan

A terminal UI framework built from Rip components. The goal is a
smaller, faster, clearer alternative to Ink + Yoga, proven by numbers
the repo can reproduce.

This plan is the product of five independent reviews (layout engine,
paint pipeline and benchmarks, input and lifecycle, the Rip host
contract, and a red-team critique) over the Ink 7.1.1 and Yoga source
checkouts. Where the reviews disagreed with the first sketch, the
review won; those points are marked **Decided**.

## Sources

Everything here is built from public, permissively licensed sources:
Ink (MIT) and Yoga (MIT), the xterm control-sequence reference, the
kitty keyboard protocol documentation, and the terminal emulators'
own published behavior. No reconstructed, leaked, or otherwise
proprietary source — including any recovered internal fork of Ink —
is read as a reference for any part of this package, at any time.
Feature lists and well-known terminal techniques are fair to discuss;
that code is not fair to read. The package stays clean and
publishable.

## 1. Thesis

Ink is React driving a fake DOM, Yoga (C++ compiled to WebAssembly)
laying it out, and a string-based painter writing it. Three facts make
a better design available to Rip:

1. **No reconciler.** A compiled `render` block calls
   `document.createElement` / `insertBefore` directly and installs one
   effect per dynamic binding. A terminal `document` is the whole host
   contract. This runs on the stock compiler with zero changes
   (verified: components, `slot`, rest props, `if`/`for` blocks, `<=>`,
   `ref:`, events, unmount cleanup).
2. **One node.** The document node, the layout node, and the paint
   node are one object. Ink keeps a DOM node and a Yoga node in sync
   across a WebAssembly bridge and frees them by hand.
3. **The host sees every mutation.** Every change arrives through a
   setter the package owns (`setAttribute`, text `data`, `insertBefore`),
   so the package knows exactly which node changed. Ink re-runs layout
   from the root on every commit and re-walks the whole tree on every
   paint.

## 2. What "beats Ink + Yoga" means

Every claim is falsifiable, and a README number exists only with the
bench that reproduces it (`packages/AGENTS.md`, value 4).

### Lines of code

Counted as non-blank, non-comment source lines, excluding tests,
fixtures, examples, and benchmarks. Three rows, always published
together:

| Row | Ink + Yoga | Rip TUI (budget) |
|---|---|---|
| Framework only | Ink `src/` ≈ 7,250 | ≈ 1,900 |
| Framework + layout algorithm | + `yoga/algorithm/` 4,679 ≈ 12,000 | ≈ 3,400 |
| Full runtime closure | + React, react-reconciler, 23 npm deps | + Rip runtime 2,262 |

The honest headline is **roughly 3× smaller**, not more. Raw totals
(9,872 + 12,471) overstate Ink + Yoga by counting comments, bindings,
and the C API.

### Performance

Measured by `bench.rip` against Ink on the same Bun, through a fake
TTY stream, with final screens proven identical by a terminal reducer.
Metrics: CPU time per update, p50/p99 set-to-write latency, bytes and
writes per update, heap delta and GC count, cold start to first frame,
import time, install size, dependency count.

### Clarity

The only defensible proxy is side-by-side examples: lines per example,
concepts each one needs, and public export count (Ink: 6 components,
13 hooks). Nothing beyond that goes in the README.

### Feature matrix

A smaller number means nothing if it comes from missing features. The
README carries this matrix.

| Must match in v0.1 | Beyond Ink in v0.1 | Disclosed gaps in v0.1 | Never |
|---|---|---|---|
| Flexbox layout incl. baseline, static position, and aspect ratio; borders, backgrounds | Mouse, opt-in: `@click`, `@wheel` (§7) | Screen-reader output mode (`role` / `aria-*` are accepted from the start, §13) | React devtools |
| `overflow: hidden` clipping | Keys bubble from the focused node, with preventable default actions | Windows — unclaimed and untested, as for Rip itself (§13) | Concurrent rendering, Suspense |
| Scrolling by content offset (`contentOffsetX` / `contentOffsetY`) | Tree-order focus | List virtualization | |
| Wrap and truncate modes | Node-relative cursor placement | | |
| `Static` scrollback output | A text change of unchanged size runs no layout | | |
| Inline and alternate-screen rendering | Hyperlinks as a prop: `link` on text (OSC 8), refused unless the URL is printable ASCII, never left open across a cursor move | | |
| Synchronized, diffed, coalesced output | | | |
| Non-TTY / CI output, `NO_COLOR`, color depth | | | |
| Console capture while rendering | | | |
| Error display with terminal restore | | | |
| `renderToString` and a test driver | | | |
| Node metrics (`useBoxMetrics` equivalent) | | | |
| Key input, paste, focus, cursor placement | | | |
| Enhanced keyboard (kitty protocol), opt-in | | | |
| Animation clock (`useAnimation` equivalent) | | | |

Ink's string `Transform` has no counterpart because it has no job
here: a text transform is an ordinary expression in the binding
(`"#{name.toUpperCase()}"`), and per-cell restyling is a style
callback (§6).

## 3. Architecture

```
component effects ──► node setters ──► dirty marks ──► frame flush
                                                        │
                        layout (dirty subtree) ◄────────┤
                        paint  (damaged rows)  ◄────────┤
                        diff + emit (one write) ◄───────┘
```

One flush per reactive batch: a microtask, a minimum interval of about
8 ms, deferred while `write()` reports backpressure. Input dispatch
wraps each stdin chunk in one batch, so one chunk is one frame. Rip
flushes effects synchronously per write outside a batch, so coalescing
is the host's job and is not optional.

Flat package, the `packages/barcodes` shape. All modules are Rip,
including hot paths (the emitted loops are the JavaScript one would
write by hand; hot loops use the indexed `for x, i in` form).

| Module | Job | Code lines |
|---|---|---|
| `tui.rip` | Entry: `run`, `mount`, `renderToString`, `screen`, widgets; to come: `focus`, `clock` | 111, about 220 when complete |
| `document.rip` | Terminal document: nodes, tree links, events, style road, damage marks | 278 |
| `layout.rip` | Flexbox, containing blocks, baseline, cache, edge rounding | 1,461 |
| `text.rip` | Sanitize, grapheme clusters, width, wrap, truncate | 421 |
| `paint.rip` | Cell grids, styles, clip, borders, backgrounds, damage, diff | 597 |
| `screen.rip` | Frames and pacing; to come: alternate screen, `Static`, non-TTY | 56, about 250 |
| `input.rip` | Key tokenizer and decoder, paste, mouse, replies; to come: keyboard negotiation | 312 |
| `terminal.rip` | To come: setup / teardown, signals, suspend, console capture | about 170 |
| | **Total** | **3,236 built; about 3,650 complete** |

Lines are counted as §2 counts them: non-blank and non-comment.

Also at the package root: `test.rip`, `demo.rip`, `bench.rip`,
`bench/` (its own `package.json` quarantining Ink, React, and
`yoga-layout`), `README.md`.

## 4. The host contract (`document.rip`)

The node model follows `packages/email/dom.rip` (sibling links), not
the test stub `test/support/recording-dom.js`, which lacks
`nextSibling` and so mounts `if` blocks in the wrong place.

**Value 1 — loud beats everything — governs this module.** A member
the terminal cannot honor throws a named error.

| Implement | Accept and ignore | Reject loudly |
|---|---|---|
| `createElement('div' \| 'span')`, `createTextNode`, `createComment`, `createDocumentFragment` | `data-part`, `id`; `role` and `aria-*` are accepted and **stored** (§13) | Any other tag, `createElementNS` |
| `appendChild`, `insertBefore` (flattening fragments), `removeChild`, `remove`, `parentNode`, `childNodes`, `nextSibling`, `nodeType` | | `className` writes, string `style` |
| Text `data` setter (same-value short-circuit, marks dirty) | | `value`, `checked`, `innerHTML`, `textContent` |
| `setAttribute`, `removeAttribute`, `toggleAttribute` | | `querySelector`, `document.head` (transitions) |
| `addEventListener`, `removeEventListener`, `dispatchEvent` with bubbling and `target` | | Unknown style keys, with a suggestion |
| Globals: `document`, `Node` (base class of every node), an `SVGElement` stub | | |

`div` is a box and `span` is text. Comments are zero-size anchors.

**Decided — install is scoped.** `run` and `mount` install the
globals for the life of the app, and `quit` or `close` restores them.
The globals are the process's, so one app is mounted at a time: a
second `run`, `mount`, or `renderToString` is refused by name, and the
install throws when a foreign `document` exists (`packages/email`
installs one transiently; an isomorphic npm library probing
`typeof document` is a documented hazard).

**Decided — styles travel as attributes through rest forwarding.**

```coffee
export Box = component extends div
  render
    div
      slot
```

`Box flexDirection: 'row', gap: 1` reaches the node as typed values
through `setAttribute`. Measured on 2,000 boxes (ranking only): rest
forwarding mounts in 2.4 ms and 7.8 MB; declaring 40 props per `Box`
costs 22.2 ms and 74.4 MB. One `node.set(key, value)` serves
`setAttribute` and the `style` object road, short-circuits equal
values (effects re-fire with identical values), expands shorthands,
stores numerics, and marks the node layout-dirty or paint-dirty. The
style object is a class with table-generated prototype accessors, not
a Proxy. The node remembers the keys a `style:` object wrote, so an
object taken away (`removeAttribute('style')`) takes them with it and
leaves the props.

The runtime contains a child that fails to construct: it reports the
error and leaves a `rip:child-error` comment where the child would be.
On a terminal that is a silent hole in the screen, so `install` swaps
the runtime's child-failure reporter (`__setChildFailureReporter`) for
one that throws, and `restore` puts the previous one back — `run`,
`mount`, and `renderToString` fail with the child's own error.

## 5. Layout (`layout.rip`)

**Decided — float layout, one edge-rounding pass.** Thirds, percents,
centering, and `space-around` all produce fractions. Layout computes
in doubles and rounds absolute edges once (Yoga's `PixelGrid`, about
40 lines), which guarantees no gaps or overlaps and is why every Yoga
expectation is an integer. "Cell-rounded", not "cell-based": Yoga's
rounding test expects 33/34/33 where an integer distributor gives
34/33/33.

**Decided — the layout cache is part of v0.1.** Flexbox visits a node
for measure, flex, and stretch; without a cache the cost multiplies
with nesting depth. One layout entry plus up to eight measure entries
per node, as Yoga keeps.

**Scope** (Ink's `styles.ts` is the floor): direction, wrap, grow,
shrink, basis, align-items / self / content including **baseline**,
justify, gap, margin (including auto), padding, border, width /
height / min / max in points or percent, relative, absolute, and
**static** position with insets, `display: none`, and measure
functions for text. The engine's contract is Yoga's suite, which needs
a border of any width (`border*Width`) and `overflow: 'scroll'`, so
the engine keeps both. The document writes only what a terminal can
draw — a border is 0 or 1 cell, and scrolling is `overflow: 'hidden'`
plus a content offset — so both are reached by writing `styles` past
the document, as the shim and the fuzz do.

Two features Ink exposes are in scope because a retrofit would be
expensive and a terminal needs them:

- **Static position (containing blocks).** An absolute node positions
  against its nearest non-static ancestor, which is how a modal,
  dropdown, or toast written deep in the tree escapes to the screen.
  It decides *who lays out* an absolute node, so it is built in from
  the start: absolute nodes are collected and laid out by their
  containing block, never inline by their parent.
- **Baseline.** A label beside a bordered input aligns with the
  input's text row, not its border row. It lives inside the cross-axis
  step (per-line maximum ascent), the most delicate part of the
  algorithm, and is 78 lines in Yoga.

Also in scope, each behind one seam:

| Feature | Seam |
|---|---|
| `display: contents` | Layout iterates a cached list of layout children, never raw `childNodes`, and a contents node's children join its parent's list. The list exists anyway: comment anchors (`if`, `for`) are zero-size and skipped. |
| `boxSizing: content-box` | Every width / height / min / max / basis read goes through one size resolver. |
| Aspect ratio | Yoga's handling, ported. A ratio counts CELLS, which are about twice as tall as wide, so a box that looks square asks for about 2. |
| Intrinsic keywords | `max-content`, `fit-content`, and `stretch` as a size resolve as Yoga resolves them: to no length, so the node sizes as an `auto` one does. |

**Not laid out:** right-to-left. `row-reverse` and `column-reverse`
already flip an axis, which is the machinery a right-to-left pass
would reuse.

**Dropped:** auto-min-size, errata and experimental flags.

**Parity target:** classic Yoga behavior as its generated tests encode
it (running totals, no auto-min), not the CSS specification — except
where a divergence is stated below.

**Algorithm:** `visit(node, availW, availH, modeW, modeH, ownerW,
ownerH, perform)` is the cache's door — it answers from a stored entry
or calls `compute!` — and `perform = false` means measure only. Leaf
measure → inner
available size → flex basis → line building → free space → two-pass
freeze loop for grow / shrink under min / max → justify and auto
margins → cross-axis align and stretch → align-content → final size →
reverse-direction fix-up → absolute children → rounding. Text height
follows the width offered because a stretch child in a column
container is measured at exact width.

**Two wins Yoga cannot have,** because text and layout are one node:

- *Same-size fast path.* A changed text node is re-measured under its
  last constraints; an unchanged size marks paint-dirty only and runs
  no layout. A counter ticking from 41 to 42 costs zero layout.
- *Layout boundary.* A change stops at the first ancestor whose
  answers cannot follow its content: a node that has been offered an
  exact width and height on every ask since its owner last started its
  answers over. An exact offer is the answer, held in the node's own
  min and max, so every answer an ancestor holds stands. No style names
  the case — a definite width and height, a percent of an exact owner,
  a stretched or `flex: n` child of one, an absolute node with sizes or
  opposing insets all qualify by the offers they get, and a percent of
  a content-sized owner, or a size put back to `auto`, stops qualifying
  at its first offer that is not exact. `sync` leaves such a node dirty,
  answers its ancestors that nothing is different, and after the pass
  the node is laid out again under the offer of its last layout (its
  layout entry) and what is under it is rounded from its own corner,
  absolute and rounded, as `settle` recorded it. Two readers go past an
  answer: a baseline row reads baselines to any depth, and is computed
  on every pass with everything above and under it, so a boundary
  there is reached before it is laid out alone; and a static node's
  absolute descendants belong to a containing block above it, so a
  static node is never a boundary. The dirty climb still reaches the
  root — the screen is owed a frame — and `sync` still reads the
  children of each dirty ancestor. A text widened in one row of a
  definite height among 2,000 costs 5 visits and 41 µs where it cost
  4,004 and 425 µs; at the bottom of 14 boxes of a definite size, 5
  visits where it cost 18. A change under a content-sized chain still
  computes every ancestor to the root (TODO §4).

### Acceptance: Yoga's own suite

`misc/yoga/javascript/tests/generated/` holds 543 cases in 26 files,
each asserting integer boxes recorded from Chrome. They run, byte for
byte as upstream wrote them, against a test-only shim shaped like the
`yoga-layout` API (`test/yoga-shim.rip`, `rip test/yoga.rip`).

- **All 543 run and none is skipped.** Yoga's 37 hand-written aspect
  ratio cases are ported beside them (`test/yoga-aspect.rip`), and 53
  of its hand-written cases for measure functions, the measure cache,
  measure modes, rounding, dirtying, and computed edges
  (`test/yoga-hand.rip`; `test/yoga/SOURCE.md` says which are left out
  and why). Real
  `yoga-layout` 3.2.1, the release Ink ships, passes 537 of the 543
  through the same runner: it predates the intrinsic keywords and one
  alignment fix.
- **Two cases answer differently on purpose, pinned, not skipped**
  (divergences 1 and 6 below). The runner holds each differing
  expectation to this engine's exact answer, with the reason beside
  it, and fails on a pinned answer that never runs.
- Every case has a right-to-left half. **Decided — RTL is deferred.**
  One mechanical gate stops each case before its RTL pass and the
  report says "LTR half". The expensive part of RTL in a terminal is
  bidirectional text, which no layout decision made here makes harder;
  the RTL halves are 543 more cases waiting in the same files.
- `misc/` is gitignored, so **the suite is vendored as-is** under
  `test/yoga/`, excluded from published `files`.
- **License:** Yoga and Ink are MIT. Vendored tests keep their headers
  and ship with Yoga's `LICENSE`. An engine that follows
  `CalculateLayout.cpp` structurally is a derivative work, so the MIT
  notice ships in the package itself (`NOTICE`, listed in `files`).

Build order, so categories go green one at a time: node + shim +
rounding + fixed sizes + padding / border / margin → grow / shrink /
min / max → justify / align / auto margins → reverse directions →
wrap / align-content / gap → percent → absolute → `display: none` and
measure functions → cache and dirty.

### Stated divergences from Yoga

Each is a decision, and each has a pin that holds this engine's answer
and states Yoga's beside it; Yoga's answers are `yoga-layout` 3.2.1's
on the same tree. Divergences 3 and 4 are one rule — an incremental
layout equals a fresh one — where Yoga's cache breaks it.

1. **Every edge rounds from its absolute position.** Yoga rounds a
   node's position from its offset in its parent and its size from its
   absolute edges; under a fractional ancestor offset the two disagree,
   and `rounding_fractial_input_3` expects two siblings to share a row
   and a row to be left empty. Here neighbors never overlap and never
   gap. Pin: `DIVERGES` in `test/yoga.rip`.
2. **A hidden child is never the baseline child.** Yoga picks a row's
   first child even when it is `display: none`, reads its zeroed
   height, and answers NaN for the row's top. Here the first child
   that shows is the one that aligns. Pin: "a hidden child is never
   the baseline child" in `test.rip`.
3. **The owner's size is part of a cached answer's key,** for a node
   whose own percent margin, padding, min or max reads it. Yoga keys
   an answer by the offer alone, so a `{width: 0, padding: '5%'}` box
   laid out under 100 columns and then 10 keeps its 10×10. Here it is
   1×1, as a fresh layout makes it in both engines. Pin: "divergence:
   the owner's size is part of a cached answer's key" in
   `test/layout.rip`.
4. **A first flex basis stands for one pass.** Yoga keeps the first
   basis it resolves until the child is dirtied, so a `flexBasis:
   '50%'` child laid out at 100 and then 200 stays 50. Here every pass
   starts a child over and it is 100, as a fresh layout makes it in
   both engines. Pin: "divergence: a first flex basis stands for one
   pass" in `test/layout.rip`.
5. **Sizes are compared within a tolerance, in doubles.** Yoga works
   in float32, where `17.9 − 16` is less than `1 + 0.9`: a wrapping
   box with 1.9 cells of room overflows and wraps the second child.
   Doubles miss such sums too, by less and to either side, so every
   comparison that decides — a line break, an overflow, a frozen share
   — carries one tolerance (`near`), and what fits by arithmetic fits.
   Pin: "divergence: sizes are compared within a tolerance, in
   doubles" in `test/layout.rip`.
6. **A percent `min` / `max` is one length wherever it is read:** a
   percent of the space inside the container, as a percent size is
   and as CSS has it. Yoga resolves it against the container's OWNER
   when it breaks lines and shares space, and against the container
   everywhere else: a `minWidth: '50%'` child of a 10-wide row comes
   out 50 wide at 100 columns, which is why Ink marks its own tests
   for it as failing. Being right costs one case of the 543:
   `percentage_flex_basis_main_min_width` passes in Yoga only because
   its root has no owner, so the percents bound nothing while space is
   shared — give the root an owner and Yoga answers 128 / 72 at 200
   columns, 600 / 200 at 1000, and never Chrome's 120 / 80. Here it is
   128 / 72 at any, as the same mins in points make it in both
   engines. Pins: `DIVERGES` in `test/yoga.rip`, "divergence: a
   percent min or max is one length wherever it is read" in
   `test/layout.rip`, and Ink's "set min width in percent" in
   `test/ink/width-height.rip`, which holds to the frame Ink's authors
   ask for.
7. **The cache compares exactly.** Yoga reuses a measurement for an
   offer that rounds to the same point, or that equals the measured
   size within a tolerance. A tolerance is not transitive, and a stale
   fraction would round a text box differently from the box a fresh
   layout gives, so an answer here is reused only for the very numbers
   it was computed from. The boxes are the same; a leaf can be measured
   once more than Yoga measures it. Pin:
   `remeasure_with_already_measured_value_smaller_but_still_float_equal`
   in `test/yoga-hand.rip`, which holds 2 measurements where upstream
   asserts 1.

## 6. Paint (`paint.rip`, `text.rip`, `screen.rip`)

**Cell buffers.** A front and a back buffer of three typed arrays —
`ch: Uint32Array` (code point, or a flagged index into a grapheme side
table), `style: Uint16Array` (interned style id), `w: Uint8Array` (0
continuation, 1, 2). Nothing is allocated per frame. Ink allocates one
object per cell per frame: about 114 µs for a blank 200×60 grid, where
a full diff of two typed buffers that size takes about 9 µs.

**Styles** are interned per (fg, bg, attributes, link) with the SGR
string precomputed and transitions cached by id pair. Text with no
background inherits the cell beneath it; `'default'` is the terminal's
own color (SGR 39, 49) and a color like any other, so it stands against
an ancestor's color and against the background beneath. A link is part of the style, so the diff sees
a changed link as a changed cell; OSC 8 opens on a run and is closed
before every cursor move and at the end of every run.

**The tables are swept.** A cell holds a style in sixteen bits and a
cluster of several code points as an index, and both tables grow with
what an app draws. Between frames, once a table passes its mark
(32,768 styles, 16,384 clusters), every entry no cell of the grid on
the terminal holds is let go and that grid is renumbered in place, so
the next diff stands; a flow takes its cluster cells again when it is
next drawn. A grid left out of a sweep says so by its epoch and is
drawn from nothing. Frames that are never diffed (`renderToString`)
are swept as a paint starts.

**Damage** is a `[lo, hi)` span per row of the grid on the terminal:
the union of what every changed node inked and what it will. Every
change passes through a setter, and the setter says so BEFORE the node
changes (`Node.mark`): the cells it inked are owed as they stand, and
the node and its ancestors are marked for a survey. What a node inks
is not its box — words spill out of theirs, children overflow, a
content offset shifts them, an absolute child sits anywhere — so each
node holds the bounds of everything inked from it down, in its own
coordinates, held to its box on an axis it clips. Before a paint, the
survey walks the marked paths only, renews those bounds, and owes what
changed as it will be painted.

| Change | Owes |
|---|---|
| A text of unchanged size, one line that fits its box | Its leaf's bounds, and no survey |
| Any other text; a style of a text | The leaf's bounds, before and after |
| A border or a background | The box, where it has either |
| Any other style of a box: a color or weight that passes down, a clip, a content offset, a layout style | The bounds of everything under it, before and after |
| A box that layout moves or resizes (`Node.place`) | The box where it was and where it is, where it inks one; its bounds if it clips; every box under it that moves says the same |
| A node inserted, removed, or moved | Its bounds where it was, and where it is |
| A node hidden or shown | Its bounds; while hidden, nothing |
| A `contents` node | Whatever it says is said of the children it lends |
| A frame of another height, its top row the same | What the rows that stay owe, and every cell of a row that comes; the rows that go are erased |
| A first frame, a resize, a frame of another top row, a sweep as a paint starts, damage past half the grid | Every cell |

The paint is held to the spans — each grid write is cut to its row's
span — and walks the tree in order, passing over every child whose
bounds hold no owed cell or lie outside the clip, so whatever lies over
or under a change is painted again inside it, and text with no
background finds the cell beneath it freshly painted. The spare grid is
a scratch: only owed cells are blanked, painted, and compared, and the
diff copies each cell that differs into the grid the terminal shows,
which stays whole; a whole frame swaps the two. Nothing else reaches
across a span's edge but a wide glyph, which blanks its other half when
half of it is written over; so a glyph that a span would cut widens the
span to the run of words it is in, and the paint runs again — twice at
most, then once more with the row owed whole, which nothing cuts. The diff reads the same cells in the
same order a whole diff would find changed, so the bytes are the same.
Clip is four integers passed down the recursion. Z-order is tree order.

**Emit.** Diff dirty rows, group runs, move with the cheapest of CUF /
CHA / CUP (inline mode uses relative vertical moves only), rewrite a
row when more than about half changed, build one string, make one
`write`, inside synchronized output (DEC 2026). After a cell of more
than one code point, or of one that Unicode leaves unassigned (a later
terminal may draw it wide; a private use glyph is one cell and gets no
move), an absolute column move keeps a width
disagreement with the terminal to that glyph (measured: a CJK-heavy
80×40 frame is 5,008 bytes this way and 12,648 with a move after
every wide cell). A line feed is never written with a background
held, since a terminal that erases with the current background would
paint the scrolled-in row with it. Bytes per update
are benchmarked, since a cell diff can emit more than a line diff.

**Decided — styling is structural only.** Raw ANSI inside text is what
forces Ink's 509-line tokenizer and repeated re-tokenizing. Text is
sanitized once in the `data` setter (escape and control characters
stripped, tabs expanded). For text that arrives pre-colored, an opt-in
`ansi(str)` helper parses SGR into styled spans once, outside the
paint path. Ink's string `Transform` is replaced by a per-cell style
callback.

**Held to Ink's own tests.** `test/ink/` ports 478 of Ink's paint
cases — borders, backgrounds, overflow, text, wrapping, truncation,
widths, hyperlinks, content offset, position, display, the flex files
— with every expected frame taken from published Ink 7.1.1 as an
oracle, or from Ink's test source where its main branch is ahead. Plain
frames compare as text, and colors and links as styled cells, never as
escape bytes. 53 of them are Ink's `rerender` cases, drawn through
`mount` (§10): a tree stays mounted, takes other props, and draws again,
and each updated frame is also held to a fresh mount's frame and to the
bytes a terminal was sent for it, replayed.
The cases run through widgets that spell out Ink's defaults (a row
that shrinks), since this package keeps Yoga's. Where a frame differs
from Ink's test on purpose, the case still runs, pinned to this
package's frame with its reason, and fails when it no longer differs:
text with no background keeps the one beneath it, where Ink carries
backgrounds down the tree; the `…` of a cut line is inside its link,
where Ink closes the link before it; a value the package cannot use is
refused where Ink reads it as zero; and four frames Ink's own tests mark
as failing, where this package draws what Yoga and published Ink draw.

**Decided — an offset-based wrapper of our own,** with an ASCII fast
path; `Bun.stringWidth` per grapheme. Structural spans need break
offsets, not new strings, and `Intl.Segmenter` is about 40× slower
than `Bun.stringWidth` on ASCII. Emoji width is parity with Ink, not
a win: both disagree with some terminals and with tmux.

**Inline rendering is its own design item.** Drawing below the prompt
uses relative cursor moves and clips the live region to the terminal
height, showing the bottom. `Static` paints an item once above the
live region, invalidates the front buffer, and detaches its nodes; on
the alternate screen it is a documented no-op and nothing accumulates.

**Resize** is coalesced to one frame: reallocate, then erase and paint
(alternate screen) or move up by the estimated reflowed rows, erase
down, and repaint (inline). **Non-TTY and CI** write static output
immediately and the final frame once, with no cursor control, and
honor `NO_COLOR` / `FORCE_COLOR` and color depth.

One serializer, `rowsToString`, serves `renderToString`, `Static`, and
the non-TTY final frame.

## 7. Input, focus, cursor (`input.rip`, `document.rip`)

**Events replace hooks.** A key goes to `focus.active ?? root`,
bubbles to `document`, and honors `stopPropagation` and
`preventDefault`. A listener may ask for the capture phase, which runs
root to target before the bubble, so a dialog takes a key before the
node under it does. Tab / Shift-Tab (focus), Ctrl-C (exit), and Ctrl-Z
(suspend) are default actions that run only when not prevented. In
Ink every `useInput` handler receives every key and gates itself with
an `isActive` flag, and a text input cannot keep Tab.

The event mirrors DOM `KeyboardEvent`: `key`, `ctrlKey`, `shiftKey`,
`altKey`, `metaKey`, `repeat`, `sequence`. Events: `@keydown`,
`@paste`, `@focus`, `@blur`, `@resize`, `@click`, `@wheel`.

**Parser** (`input.rip`, built). `Parser.new {escape, patience, clock,
late, paste}` and `parser.feed chunk`, a string or a `Uint8Array`, answering
the events the chunk completed: `key`, `paste`, `focus` / `blur`,
`mouse`, and `reply`. One state machine reads every byte once — ground,
ESC, a CSI or SS3 body, an OSC / DCS / APC / PM / SOS string, a paste —
and holds
a sequence cut by the end of a read for the next one; UTF-8 and a
surrogate pair cut the same way come out whole. CSI and SS3 finals come
from one table; xterm's modifier parameter, its old
modifier-as-only-parameter form, kitty's `CSI u` with its shifted key,
associated text and event type, and xterm's `modifyOtherKeys`
(`CSI 27 ; mod ; code ~`) decode on one road. `key` is DOM's name
(`'Enter'`, `'ArrowUp'`, `'F5'`) or one code point: text is an event
per code point, never per grapheme cluster, because a cluster can be
cut between two reads and only code points decode the same however the
bytes are split. A C0 control is Ctrl and its letter, with the four
classic exceptions Ink also makes: 0x09 is Tab, 0x0D is Enter, 0x1B is
Escape, and 0x08 is Backspace as 0x7F is. Kitty's super and meta bits
are DOM's `metaKey`; hyper and the locks have no field. Releases are
dropped (the package has `@keydown` and no `@keyup`) and repeats are
flagged. SGR mouse reports decode now, at cells counted from zero, with
a wheel as `deltaX` / `deltaY` and xterm's buttons 8 to 11 as DOM's 3
to 6; the hit test is the dispatcher's.
Replies — `CSI ? flags u`, `CSI ? … c`, `CSI row ; col R` — are
events of kind `keyboard`, `attributes`, `cursor`, so the probe below
needs no timer.

**Time has three rules, by what a person can have typed.** An ESC
with nothing after it for `escape` milliseconds (50, on an injected
clock in tests) is the Escape key. ESC and an introducer — `[ O ] P _ ^
X`, which open CSI, SS3, OSC, DCS, APC, PM and SOS — with nothing after
it for the same 50 ms is Alt and that character, as ESC and any other
character is at once: a person types Esc and then O, and no terminal
leaves a bare introducer hanging; a bare `ESC [` or `ESC O` before a
byte that cannot continue it is the same. A sequence that holds a byte
past its introducer, a string with content, and an open paste were not
typed by a person, and wait `patience` milliseconds (1,000) for their
next byte, so a slow link completes them: `ESC [ < 0 ; 10`, 50 ms, then
`; 10 M` is a mouse report. **Past its patience a partial sequence is
discarded, never typed** — Ink types whatever it holds when its one
short timeout runs out, which on a slow SSH link is the tail of an
arrow key, `[A` — as is one cut short by a byte that cannot continue
it, and a paste whose terminator never comes ends as what was
collected. Every read that holds a character starts the wait again, and
an empty read does not. Bytes that arrive after a wait ran out are read
as what they are alone: `ESC`, the timeout, then `[A` is Escape and the
keys `[` and `A`, which is the honest reading, since the parser cannot
know they belonged to what it gave up on. What time completes is handed
to `late`; `parser.flush()` is every wait run out now, answering its
events, for a suspend, a blur, or a shutdown (`reset()` forgets what is
held in silence), and `parser.holding` is `null`, `'escape'`,
`'sequence'`, `'string'` or `'paste'`.

Dropped terminal forms are pinned as what they decode to here: rxvt's
`$` and `^` finals are sequences with no key, the Linux console's
`CSI [ A` is a sequence with no key followed by typed text, a doubled
ESC is Escape and then the sequence the second one opens, eight-bit
Meta is a byte of UTF-8, and an eight-bit C1 control opens and ends
nothing, since a UTF-8 terminal sends its sequences in seven bits. The
secondary attributes reply (`CSI > … c`) is dropped: the package never
asks for it. `CSI 1 ; mod R` with mod from 2 to 16 is xterm's modified
F3 and also a cursor on row 1, so the package's own cursor probe is
DECXCPR (`CSI ? 6 n`), whose reply carries the `?`. The application
keypad (`SS3 j` to `y`, `SS3 X`, `SS3 M`) types what its keys show.
What is held is bounded: a CSI or SS3 sequence to 1,024 characters (a
longer one is swallowed to its final byte and discarded), a string to
nothing at all, and a paste to `paste` characters an event (4 Mi by
default; a longer one arrives in pieces, in order, and its reads are
joined every 1,024 so a paste read a character at a time is not an
entry a read), so no input grows memory without limit, and nothing
makes `feed` throw. 244 of Ink's 256 input titles are rows of a table
in `test/input/`, 205 held to Ink's answer under one mapping to DOM
names and 39 stated differences; `test/input/SOURCE.md` lists them and
the 12 left out.

**Enhanced keyboard** is opt-in (`run App, keyboard: 'enhanced'`).
Setup asks the terminal for the kitty protocol's disambiguation flag
and teardown withdraws it; the decoder is always on, so a terminal
already in that mode works without the option. It buys what ordinary
terminals cannot report: Shift-Enter distinct from Enter (multi-line
input), Ctrl-I distinct from Tab, and an Escape that needs no timer.
Support is probed with a `CSI ? u` query followed by a device
attributes query; whichever reply arrives first decides, so no timer
is involved. tmux answers only the second query, so the app runs on
ordinary reports there: nothing hangs, and only the extra keys are
lost. Three rules follow. An app never makes an enhanced-only key the
sole way to do something (a chat input that takes Shift-Enter for a
new line also takes Alt-Enter or Ctrl-J). `screen.keyboard` reads
`'enhanced'` or `'basic'`, so an app shows the hint that matches the
terminal. The decoder also reads xterm's modify-other-keys form
(`CSI 27 ; mod ; code ~`), which tmux forwards when its
`extended-keys` option is on. tmux's 500 ms `escape-time` delays a
lone Escape for every terminal program and is the user's setting; the
README names it.

**Mouse** is opt-in (`run App, mouse: true`), because capture takes
over the terminal's own text selection. SGR mouse reports decode to
`@click` and `@wheel` events carrying `x` and `y` relative to the
target. The target is found by a hit test over the rounded boxes in
reverse paint order, honoring clips and the absolute-node list; the
event then bubbles like any other, and a click on a focusable node
focuses it as a preventable default. Ink has no mouse support.

**Scrolling** is Ink's content offset: `contentOffsetX` /
`contentOffsetY` shift a node's children under `overflow: hidden`
(on Ink's main branch; the published 7.1.1 scrolls by a negative
margin, which is what the bench drives). It is a paint-only change,
so a scroll runs no layout. A wheel handler
that adjusts the offset is the whole scrolled-list pattern.

**Focus** follows tree order, computed by a walk on Tab (Ink uses
registration order). Attributes: `focusable`, `autofocus`, `disabled`.
Removing the focused node clears focus.

**Cursor.** A focused node declares `cursor: {x, y}` relative to its
own box; the renderer adds the layout offset, parks the hardware
cursor there after each frame, and hides it otherwise. IME popups and
screen readers follow the hardware cursor.

## 8. Lifecycle (`terminal.rip`)

One idempotent `setup()` / `teardown()` pair is shared by exit,
signals, crash, `suspend`, and Ctrl-Z / SIGCONT. The host owns raw
mode and bracketed paste for the app's lifetime; there is no
ref-counting.

Verified on Bun 1.4.2: an unhandled SIGTERM skips exit hooks, so
SIGINT / SIGTERM / SIGHUP get explicit handlers that restore and exit
with 128 + n; Bun restores termios on exit but not the cursor,
alternate screen, or paste mode; `console.log` bypasses
`process.stdout.write`, so the `console.*` methods are captured, not
the stream. Inline mode clears, writes the log line, and repaints; the
alternate screen buffers logs and replays them at exit.

An uncaught error restores the terminal, prints the stack, and exits 1.

## 9. Public surface

```coffee
import { run, quit, screen, focus, Box, Text } from 'rip/tui'

App = component
  passed := 0
  ~>
    timer = setInterval (-> passed += 1), 100
    -> clearInterval timer

  render
    Box flexDirection: 'row', gap: 2, borderStyle: 'round', @keydown: ((e) -> quit() if e.key is 'q')
      Text color: 'green'
        "#{passed} passed"
      Text dimColor: true
        "#{screen.cols}×#{screen.rows}"

run App
```

- `run(App, {altScreen, mouse, keyboard, stdin, stdout})` →
  `{app, done, quit, flush}`; `suspend(fn)`; `print(text)`.
- `mount(App, {cols, rows, props, damage})` → `{app, frame, ansi, bytes,
  damage, resize, close, done}` is the test driver (§10), and
  `renderToString(App, {cols, rows, props, ansi})` is a mount, one
  frame, and a close.
- `screen` (`cols`, `rows`, `interactive`) and `focus` (`active`,
  `next`, `prev`, `to`) are **getter-backed objects**. An imported
  `:=` cell is not unwrapped across modules, so raw cells are never
  exported.
- `clock(interval)` is the animation helper: a getter-backed object
  with `frame`, `time`, and `delta`, driven by one shared timer per
  interval that runs only while a mounted component reads it and never
  when output is not interactive. A spinner is
  `frames[tick.frame % frames.length]`. The frame scheduler already
  coalesces every change into one paint, so the helper is a
  convenience, not a requirement.
- `Parser` (`input.rip`, §7) is the module `run` reads its terminal
  through: `Parser.new {escape, patience, clock, late, paste}`,
  `feed chunk` → events, `flush()` → events, `holding`, `reset()`. It is not a `rip/tui` export; a test of an app drives keys
  through `mount`, never through the parser.
- Widgets: `Box`, `Text`, `Spacer`, `Newline`, `Static`. Raw `div` and
  `span` are the documented zero-overhead primitives.
- Metrics: `div ref: el` then `w ~= el?.box.w ?? 0`. The node's `box`
  getter mints a cell lazily and the layout pass writes it. `ref:`
  captures elements only, so metrics use a raw tag.
- Apps run through `rip app.rip`. A plain `bun app.rip` has no loader,
  and a standalone bundle is out of scope.

## 10. Testing

- `test.rip` on `rip/testing`, importing `rip/tui`, opening with a
  "Package surface" section. Streams and the clock are injectable; no
  pty dependency. One end-to-end smoke test runs under
  `script -q /dev/null`.
- **Layout:** the Yoga suite and the ported aspect ratio cases (§5).
- **Paint:** about 400 Ink cases ported as literal expected strings
  plus a plain cell dump — borders 52, backgrounds 35, overflow 44,
  text 57 (minus ANSI), wrap and width 32, dimensions 29, content
  offset 23, position 13, render-to-string 37, log-update 34, resize
  10, synchronized write 5, static 5, wide-character regressions 10.
- **Damage:** `test/damage.rip` changes random trees a step at a time
  — texts, styles, clips, offsets, nodes inserted, removed, moved,
  hidden, a keyed list driven through its component, resizes — and
  after every frame holds the grid painted from its damage to the same
  tree painted whole, cell for cell, and the bytes sent, replayed over
  what the terminal showed, to that frame: glyphs, colors, links.
  `test.rip` holds each kind of change to the cells it owes.
- **Input:** `test/input.rip` — 244 of Ink's input titles as a table
  (§7), and the parser's own pins: every key form it reads; the three
  patiences and the discard rule on an injected clock; every row cut at
  every byte across two reads — short of the timeout, and inside a
  sequence short of its patience (decodes the same), and past it
  (Escape, Alt, or nothing, then the tail as typed); paste
  across reads with its terminator never found inside the text; UTF-8
  and surrogate pairs cut between reads; mouse; replies; the bounds on
  what is held; a growth-ratio check that hostile input is read once;
  and a fuzz of random bytes in random cuts that never throws, makes
  only well-formed events, and decodes the same whole or cut, held to a
  floor of bytes fed and events made so it cannot pass by feeding
  nothing. Focus and dispatch to come.
- **The test driver is public,** because users' tests are a contract
  too. `mount(App, {cols, rows, props})` is `run` without a terminal:
  the same install, the same `Screen`, the same close, drawing to a
  terminal of `cols` by `rows` that only keeps what it is sent (with
  no `rows` it is as tall as the frame). It hands back the app, whose
  public state a test sets, and draws only when asked: `frame()` lays
  out, paints, and answers the frame as plain text; `ansi` is that
  frame with its escape sequences; `bytes` is what the terminal was
  sent for it, the difference from the frame before; `damage` is the
  cells it painted and compared, which is what a test of damage
  tracking reads, and `damage: false` owes every cell of every frame;
  `resize(cols, rows)` draws the next frame whole; `close()` unmounts and restores the globals. A frame
  that fails throws from `frame`, to the test that asked. A `quit`
  from the app closes the mount and resolves `done`. Simulated input
  joins it with §7.

## 11. Benchmark (`bench.rip`, `bench/`)

Ink's own benchmarks record no metric and mostly measure React,
because paint is throttled and piped output writes no frames. Ours:

| Scenario | Shows |
|---|---|
| One counter in a 1,000-node tree | Fine-grained update cost |
| 10,000-row list through a 40-row viewport | Scrolling, large moves |
| 80×40 table, 10% and 100% churn | Diff and emit |
| Insert at the top of a list | Region moves |
| 1,000 `Static` appends | Scrollback path |
| Resize 120 → 80 → 120 | Relayout and repaint |
| Full relayout at 10,000 nodes | Layout engine vs WebAssembly |
| Startup to first frame, import time | Cold path |
| Wide-character and emoji text | Text path |

Ink runs with `interactive: true`, with incremental rendering on and
off, `CI` unset, on the same Bun, **on React's production build** (a
run without `NODE_ENV=production` is refused), written the way a
careful React app is (memoized cells and rows). Its frame throttle is
lifted and every update awaits the frame it causes, so a number is
the cost of one update.

### The Ink baseline

`bench/` holds the harness (`harness.rip`), the Ink scenarios
(`ink.rip`, `ink-startup.rip`), and the frame profiler
(`profile.rip`). Reproduce with `cd bench && bun install`, then
`bun run ink` and `bun run profile`. Ink 7.1.1, React 19.3.0, Bun
1.4.2, Apple M5, a 200×60 terminal, incremental rendering on:

| Scenario | CPU per update | p50 / p99 latency | Bytes per update |
|---|---|---|---|
| One counter in a 1,000-element tree | 3.8 ms | 3.1 / 4.9 ms | 347 (9,013 with incremental off) |
| 40×8 table, 10% churn | 2.8 ms | 2.2 / 3.3 ms | 3,109 |
| 40×8 table, 100% churn | 3.9 ms | 3.3 / 4.5 ms | 3,852 |
| 2,000-row list, scroll by one | 22.0 ms | 20.7 / 22.9 ms | 2,501 |
| 1,000 scrollback appends | 0.14 ms | 0.11 / 0.57 ms | 55 |
| Cold start to first frame | 83 ms from process start; importing Ink and React is 47 ms of it | | |

Every update costs three writes. Heap deltas swing with collector
timing and are not quoted.

**Where an Ink frame goes** (share of in-frame CPU time, sampled):

| Stage | counter | table 100% | list |
|---|---|---|---|
| Text: measure, wrap, tokenize and re-join ANSI | 74% | 43% | 82% |
| Layout: Yoga | 12% | 36% | 12% |
| Reconcile: React and the host config | 5% | 14% | 3% |
| Paint: the output grid, borders | 9% | 7% | 3% |
| Emit: diff and write | under 1% | under 1% | under 1% |

In the counter scenario four functions of the ANSI tokenizer
(`diffAnsiCodes`, `tokenize`, `undoAnsiCodes`, `ansiCodesToString`)
take over half of the whole run. One changed digit in a 1,000-element
tree costs Ink about 4 ms because every frame re-tokenizes and
re-joins the styled text of the entire screen.

**First contact.** The skeleton (full relayout and full repaint every
frame, no damage tracking, no layout cache) on the same scenarios,
`bun run tui`:

| Scenario | Ink | Rip TUI skeleton |
|---|---|---|
| One counter in a 1,000-element tree | 3.8 ms, 347 bytes, 3 writes | 0.20 ms, 33 bytes, 1 write |
| 40×8 table, 10% churn | 2.8 ms, 3,109 bytes | 0.54 ms, 262 bytes |
| 40×8 table, 100% churn | 3.9 ms, 3,852 bytes | 0.49 ms, 1,985 bytes |

These rank the two and are not README numbers: the terminal reducer
that proves both sides drew the same screen lands with the published
bench (PR 6).

**One frame, whole and damaged.** `bun run frame` times the frame
alone — paint, diff, write; the state change left out, no layout owed —
twice for each scenario: owing every cell (`damage: false`), and owing
its damage. Median microseconds on a 200×60 terminal, and the cells the
damaged frame painted and compared; the bytes are the same either way,
and the run refuses to report if they are not:

| Scenario | Whole | Damaged | Cells |
|---|---|---|---|
| One cell of a 1,000-element tree | 65 | 1.1 | 7 |
| One cell of a full 200×60 table | 125 | 0.8 | 4 |
| Every cell of that table | 160 | 165 | 12,000 |
| One of 200 bordered panels of wide text | 90 | 0.9 | 8 |
| A 40-line log whose last row comes and goes, laid out each time | 57 | 24 | 200 |

A small update's paint and diff fall with its damage, and a frame that
changes everything costs what a whole one does. Under `bun run tui` the
counter in a 1,000-element tree is about 15 µs of CPU an update. 100%
churn of the 40×8 table is about 170 µs over a long run (`rip tui.rip
table100 40`, 12,000 updates) and about 340 µs over the 300 updates of
a default run, which end while the engine is still compiling the path.

What this settles:

- **The text path is the prize, not layout.** Structural styling,
  interned style ids, and sanitizing once in the text setter (§6)
  remove the largest stage outright. Yoga is a minority cost, so a
  native flexbox needs to be correct and cached, not heroic.
- **Knowing the changed node is the right bet.** The dominant costs
  are whole-screen work repeated per frame, which damage tracking and
  the same-size fast path never start.
- **The order of work stands.** The skeleton (PR 1) proves the damage
  path early; the text and paint step (PR 3) is where the measured
  win lands and carries the bench for it.

## 12. Order of work

Each step is its own branch and PR under the repo's landing rules.

| Step | Contents | Exit |
|---|---|---|
| 1 | Layout soundness: an incremental layout equals a fresh one, one float tolerance, values refused where they are written | The reviewers' fuzzers and the differential against compiled Yoga find nothing new; every seeded bug is caught |
| 2 | Text and the painter: wrap / truncate, grapheme clusters, `overflow: 'hidden'` clipping, per-edge borders, background fills, content offset | Ported Ink paint cases pass |
| 3 | Damage tracking: paint and diff only what moved (§6) | A small update's paint and diff fall with the damage, measured in `bench/` |
| 4 | Input, focus, cursor, capture and bubble phases; then mouse and the enhanced keyboard as opt-ins; then text selection with clipboard copy (OSC 52), since mouse capture takes the terminal's own selection away | Ported parser cases pass; select-list, text-input, and wheel-scrolled list examples |
| 5 | Lifecycle, inline `Static`, non-TTY, console capture, resize, animation clock, progress reporting (OSC 9;4) | Crash, signal, and suspend restore the terminal under test |
| 6 | Four Ink examples side by side (counter, borders, use-focus, static), README, published bench with a terminal reducer proving both sides drew the same screen | Every README number reproduces with `bun run bench` |

Hardware scroll regions (DECSTBM) are a bench experiment for long
scrolling views, never a commitment.

**Decided — the skeleton precedes the full layout engine.** Layout is
the most mechanical part (a reference exists); the component model in
a terminal is where the unknowns are.

## 13. Seams for deferred features

A deferred feature is cheap later only when its seam exists from the
start. Each row is a rule the v0.1 code follows.

| Deferred | Rule followed from the start | Cost to add later |
|---|---|---|
| Screen-reader output | `role` and every `aria-*` attribute are accepted and stored on the node, never rejected as unknown keys, so components are written accessibly from day one. The hardware cursor follows focus (§7). | One tree walk that serializes roles, states, and labels as linear text — the counterpart of Ink's `renderNodeToScreenReaderOutput`. |
| Windows | Rip itself claims only macOS and Linux (CI is Linux). All platform code lives in `terminal.rip`. Resize comes from the stream's `resize` event, never the SIGWINCH signal. Suspend is guarded by platform. The painter never writes the last cell of the last row. Nothing rejects `win32`. | A CI lane and whatever it finds. |
| Error overview | Uncaught errors and the runtime's component error hook (`__setErrorHandler`) route through one reporter that restores the terminal first. | A prettier reporter: source excerpt and mapped stack. |
| Right-to-left | The reverse directions already flip an axis (§5). | A flip per direction, the 543 RTL halves, and bidirectional text. |

## 14. Decisions

1. **Typed editor for terminal props — decided.** Unknown attributes
   on raw tags and unknown rest props are errors in the TypeScript face
   only (`rip check`, the editor); they compile and run. The skeleton
   ships with that limit; a typed rest / attribute vocabulary for
   non-HTML hosts lands in the compiler, as its own PR, before PR 6.
   Declaring every prop on `Box` is rejected at a measured 9× mount
   cost.
2. **Yoga's suite — decided.** Vendored as-is under `test/yoga/`.
3. **RTL — decided.** Deferred behind the direction seam (§5).
4. **Static position and baseline — decided.** In scope for PR 2 (§5).
5. **Name.** `@rip/tui`, imported as `rip/tui`.

## 15. Risks

- Parity means reproducing Yoga's quirks, not the CSS specification.
- Terminal and `Bun.stringWidth` disagree on some emoji and ZWJ
  sequences; mitigated by forced column moves, not solved.
- Inline reflow after a resize can only be estimated.
- tmux strips kitty sequences and delays ESC by 500 ms by default.
- A cell diff can write more bytes than a line diff; measured in PR 0.
- A global `document` is visible to every module in the process.
