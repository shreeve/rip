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
| Inline and alternate-screen rendering | | | |
| Synchronized, diffed, coalesced output | | | |
| Non-TTY / CI output, `NO_COLOR`, color depth | | | |
| Console capture while rendering | | | |
| Error display with terminal restore | | | |
| `renderToString` and a test driver | | | |
| Node metrics (`useBoxMetrics` equivalent) | | | |
| Key input, paste, focus, cursor placement | | | |
| Enhanced keyboard (kitty protocol), opt-in | | | |
| Animation clock (`useAnimation` equivalent) | | | |
| Hyperlinks: a `link` prop (OSC 8) | | | |

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
| `tui.rip` | Entry: `run`, `screen`, widgets; to come: `focus`, `clock` | 90, about 200 when complete |
| `document.rip` | Terminal document: nodes, tree links, events, style road | 236 |
| `layout.rip` | Flexbox, containing blocks, baseline, cache, edge rounding | 1,437 |
| `text.rip` | Sanitize, grapheme clusters, width, wrap, truncate | 312 |
| `paint.rip` | Cell grids, styles, clip, borders, backgrounds, diff; to come: damage | 400, about 550 |
| `screen.rip` | Frames and pacing; to come: alternate screen, `Static`, non-TTY | 53, about 250 |
| `input.rip` | To come: key tokenizer and decoder, paste, mouse, keyboard negotiation | about 250 |
| `terminal.rip` | To come: setup / teardown, signals, suspend, console capture | about 170 |
| | **Total** | **2,528 built; about 3,400 complete** |

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

**Decided — install is scoped.** `run` installs the globals and
teardown restores them. The install is idempotent for this package's
own document and throws when a foreign `document` exists
(`packages/email` installs one transiently; an isomorphic npm library
probing `typeof document` is a documented hazard).

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
a Proxy.

The runtime contains a child that fails to construct: it reports the
error and leaves a `rip:child-error` comment where the child would be.
On a terminal that is a silent hole in the screen, so `install` swaps
the runtime's child-failure reporter (`__setChildFailureReporter`) for
one that throws, and `restore` puts the previous one back — `run` and
`renderToString` fail with the child's own error.

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
functions for text.

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
- *Layout boundary — not built.* A change dirties every ancestor up to
  the root, and each one recomputes; its other children answer from
  the cache, at about three visits apiece. A widened text in a flat
  column of 2,000 costs 6,001 visits, and a chain of 14 definite-size
  boxes recomputes all 14. Stopping at the first ancestor whose width
  and height are both definite is open work (TODO §4).

### Acceptance: Yoga's own suite

`misc/yoga/javascript/tests/generated/` holds 543 cases in 26 files,
each asserting integer boxes recorded from Chrome. They run, byte for
byte as upstream wrote them, against a test-only shim shaped like the
`yoga-layout` API (`test/yoga-shim.rip`, `rip test/yoga.rip`).

- **All 543 run and none is skipped.** Yoga's 37 hand-written aspect
  ratio cases are ported beside them (`test/yoga-aspect.rip`). Real
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
measure functions → cache and dirty (port Yoga's 11 hand-written
dirtied / new-layout / measure-cache tests).

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

## 6. Paint (`paint.rip`, `text.rip`, `screen.rip`)

**Cell buffers.** A front and a back buffer of three typed arrays —
`ch: Uint32Array` (code point, or a flagged index into a grapheme side
table), `style: Uint16Array` (interned style id), `w: Uint8Array` (0
continuation, 1, 2). Nothing is allocated per frame. Ink allocates one
object per cell per frame: about 114 µs for a blank 200×60 grid, where
a full diff of two typed buffers that size takes about 9 µs.

**Styles** are interned per (fg, bg, attributes, link) with the SGR
string precomputed and transitions cached by id pair. Text with no
background inherits the cell beneath it.

**Damage** is a `[lo, hi)` span per row, the union of a node's old and
new boxes. Paint walks the tree clipped to the damage and skips
subtrees that do not intersect. The saving is the skipped walk, not
the diff. Clip is four integers passed down the recursion. Z-order is
tree order with absolute nodes deferred into a stable list.

**Emit.** Diff dirty rows, group runs, move with the cheapest of CUF /
CHA / CUP (inline mode uses relative vertical moves only), rewrite a
row when more than about half changed, build one string, make one
`write`, inside synchronized output (DEC 2026). After a cell of more
than one code point, an absolute column move keeps a width
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

**Held to Ink's own tests.** `test/ink/` ports 386 of Ink's paint
cases — borders, backgrounds, overflow, text, wrapping, truncation,
widths, content offset, position, display, the flex files — with
every expected frame taken from published Ink 7.1.1 as an oracle, or
from Ink's test source where its main branch is ahead. Plain frames
compare as text and colors as styled cells, never as escape bytes.
The cases run through widgets that spell out Ink's defaults (a row
that shrinks), since this package keeps Yoga's. Where a frame differs
from Ink's test on purpose, the case still runs, pinned to this
package's frame with its reason, and fails when it no longer differs:
text with no background keeps the one beneath it, where Ink carries
backgrounds down the tree; a value the package cannot use is refused
where Ink reads it as zero; and four frames Ink's own tests mark as
failing, where this package draws what Yoga and published Ink draw.

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

**Parser.** One module: a CSI / SS3 tokenizer with a pending buffer
across reads, one table for finals, xterm modifier parameters, ESC +
char as Alt, CSI-u decoding, bracketed paste. The lone-ESC timer is
50 ms, configurable, with an injected clock for tests. **A partial
sequence that times out is discarded, never typed** — on a slow SSH
link Ink turns an arrow key into the literal text `[A`. About 100 of
Ink's 156 parser cases port as a table; the rest pin dropped terminal
forms (rxvt, Cygwin, double-ESC meta).

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
  `{done, quit, flush}`;
  `suspend(fn)`; `print(text)`; `renderToString(App, {cols, rows})`.
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
- **Input:** about 100 ported parser cases, plus focus and dispatch.
- The test driver (`renderToString` plus simulated input) is public,
  because users' tests are a contract too.

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
| 1 | Layout soundness: an incremental layout equals a fresh one, one float tolerance, values refused where they are written (TODO §1–§2) | The reviewers' fuzzers and the differential against compiled Yoga find nothing new; every seeded bug is caught |
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
