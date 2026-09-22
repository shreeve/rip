# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

## 1. The closing audit — code

- [ ] The clip and offset arithmetic is copied into `paint.rip:820`,
      `mouse.rip:44` and `screen.rip:200` — sixteen border-inset
      expressions, six content-offset pairs — and "is this subtree
      shown" is spelled five ways (`focus.rip:17`, `screen.rip:29`,
      `mouse.rip:57`, `paint.rip:618`, `layout.rip:688`), one of them
      (`s.hidden` truthy against `is true`) differently. One `clipOf`
      and `offsetOf` in `paint.rip` and one `shown` in `focus.rip`,
      imported; and a fuzz that holds `locate(x, y)` to the node whose
      `draw` last wrote that cell.
- [ ] Focus is recorded three times — `doc.active`, `doc.lit`,
      `node.glow` — kept in step only by `take` (`focus.rip:52`). A
      fuzz of focus, blur, remove and disable holding `activeElement
      is active` and `node.focused` for every node.
- [ ] One word, several meanings: `settle` (screen, layout, input,
      tui), `probe` (terminal, layout, paint), `frame` (`Screen`, the
      border in paint, `Tick`), `refresh` (a text flow; tui's whole
      redraw, also named `held.redraw`), `watched` (tui's alias of
      terminal's `interactive`, beside terminal's own `watched`);
      `PASSES` is 32 in screen and 4 in paint; `TIMERS` is defined in
      tui and in input. Rename the local ones; export one `TIMERS`.
- [ ] `Screen` is built and then has `whole`, `interactive`, `alt`,
      `origin`, `after` and `failed` set from `tui.rip:276`, and its
      constructor initialises the same fields to values always
      overwritten. Take them as options.
- [ ] Void functions unmarked: `close` and `quit` (tui), `settle`
      (screen), `name`, `mouse`, `answer`, `cursor` (input), `put`
      (document).
- [ ] Exports nothing imports: `Document`, `NOWHERE` (document), `WIDE`
      (text), `Quiet` (terminal). Guards that cannot fire:
      `paint.rip:144`, `layout.rip:687`'s try, `terminal.rip:93`; the
      80 × 24 fallbacks in `screen.rip:66` and `tui.rip:142`. `step`
      written in both `tui.rip:432` and `terminal.rip:124`;
      `parser.flush()` in both closes. `Mount.press`, `type`, `paste`
      and `send` after a close drop in silence where `frame` throws —
      one rule.
- [ ] `Mount.held` is a public API with no doc: tests set
      `view.held.view.alt` fourteen times.

## 2. The closing audit — docs

- [ ] `bun run bench` refuses without a Yoga checkout at the
      `yoga-layout` version Ink ships (3.2.1), and `misc/yoga` is
      `main`. README and PLAN §11 say `YOGA_SRC` and the version; step
      6's exit holds only then.
- [ ] README's prose quotes numbers `bench/RESULTS.md` does not: a
      select-list key 8 µs, a no-op 0.3, 55 at a hundred items
      (RESULTS: 5.5, 0.2, 42); motion 0.5 µs and a click 1 µs "on
      1,576 elements" (2,403; 0.57, 1.06); "a row recolored in a
      2,000-row clipped log, 7 µs against 85" (no such scenario); one
      cell of a 200×60 table "about 125 µs" (143); `Static` "350 µs
      over 8,000" (only the 1,000 row exists). Quote RESULTS.md or
      drop.
- [ ] PLAN names what no code does: an opt-in `ansi(str)` helper and a
      per-cell style callback (§2, §6); frames "deferred while
      `write()` reports backpressure" (§3); the error overview "through
      `__setErrorHandler`" (§14); a `yoga-layout` differential runner
      ("537 of 543", §5); a smoke test "under `script -q /dev/null`"
      with "no pty dependency" (§10). Strike each, or name what is.
- [ ] PLAN §3's module table (tui 310, focus 62, paint 694, terminal
      181; "4,222 built") against the counting rule (311, 63, 701, 203;
      4,252); §10's per-file Ink counts and "478" against SOURCE.md's
      521; the progress markers "(built: …)" in §5–§8, "before PR 6",
      "In scope for PR 2", "measured in PR 0"; README's "Ctrl-Z is
      PLAN.md's lifecycle step" and "and what is planned".
- [ ] README idioms an app needs and cannot find: there is no no-wrap
      mode (a `width` wider than any line, then `contentOffsetX`;
      `truncate` cuts before the offset shifts); `screen.cols` and
      `screen.rows` are never named; `run App, props:`; `bytes`,
      `damage` and `cursor` describe the last `frame()` only, and a
      release's OSC 52 is in `bytes` until the next; `send` coordinates
      are the terminal's, shifted by the rows `Static` and `print`
      wrote above; Shift-Tab arrives as `Tab` with `shiftKey`; a text
      that changes size runs a whole layout (about 0.5 ms at 4,000
      nodes); the `flexShrink: 0` default beside `overflow`.
- [ ] Stale comments: `terminal.rip:204` says an unanswered probe is
      "taken to be the bottom" where the origin is `Infinity` and
      reports are dropped; `screen.rip`'s progress comment says never
      off a terminal, and it goes out under `mount`; `test/ink.rip`
      prints "20 frames differ" where SOURCE.md says 19 and a refusal.

## 4. Layout cost

- [ ] A boundary is a node whose answers CANNOT differ (PLAN §5). A
      change under a content-sized chain still computes every ancestor
      to the root, its siblings answering from the cache: a text
      widened among 2,000 in a column costs 6,001 visits, 610 µs. The
      open rule stops where the answers DID not differ: lay the node
      out again under every ask it holds, and climb only if one came
      out another size.
- [ ] Under a boundary, `sync` still reads every child of each dirty
      ancestor on the way down: 40 µs for 2,000 siblings.
- [ ] First layout of a 1,551-node tree is about 630 µs: its 3,651
      visits are 63% of it, rounding 4%, and reading the tree 32% — 55
      µs making 1,051 records, 70 µs parsing 551 of them, 25 µs the
      500 text flows. No single line moves it: a `seat` and a `boxOf`
      that return early, a parse that skips sums it has no edges for,
      `slice` for the blank slots, plain arrays for them, and zero
      edges shared until written each measured within the noise, 3%.
      What is left is structural: fewer allocations a record, or fewer
      visits a node.

## 5. The painter and the screen

- [ ] A whole frame pays for spans it does not need: every grid write
      reads its row's span, about a tenth of the paint of a screen of
      bordered boxes (`bun run frame`, panels).
- [ ] A frame taller than the terminal that changes height shifts
      every row shown, and is painted whole. Keeping those rows means
      scrolling the terminal by the rows gained, which needs the diff
      to address rows by more than the top row it holds.
- [ ] 100% churn of the 40×8 table is about 340 µs of CPU an update
      over the 300 updates of `bun run tui`, and about 170 µs over
      12,000: the run ends while the damage path is still being
      compiled. Warm the bench longer, or make the path smaller.
- [ ] A `Static` batch lays its container out as a root, and the
      body's next layout puts the container away again by visiting
      every item under it: a walk as long as the list, per batch, and
      the reconciler's keyed `for` walks the list again. An append
      costs 151 µs over 1,000, 173 over 4,000, 274 over 8,000
      (`rip bench/tui.rip static N`).
- [ ] `Static`'s items are elements; a bare text under `Static` is
      never hidden and is painted again with every batch.
- [ ] A line that ends exactly at a space at the cell width keeps that
      space at the head of the next line: `Box width: 5` holding
      `Text "abcde fgh"` draws `"abcde\n fgh"` where Ink draws
      `"abcde\nfgh"` (PLAN §11).

## 6. Input and focus

- [ ] Focus that a removed node held goes to nothing. A dialog that
      closes leaves the keyboard with the root element until Tab; giving
      focus back to the node that had it before the dialog took it — and
      holding Tab inside a dialog while it is open — is undecided.
- [ ] `autofocus` on a node that is not `focusable` claims nothing, in
      silence: the two switches arrive in either order, so neither write
      can refuse the other's absence.
- [ ] Tab walks the tree from the focused node, passing over shut
      subtrees whole: unmeasured on a tree of 10,000 nodes.
- [ ] A select list that marks its choice with one binding an item
      (`inverse: n is at`) pays for every item on every arrow key: about
      42 µs at a hundred items where ten cost 5.5 (`bun run keys`).
- [ ] After a resize the frame's row is asked of the terminal again
      from what was the top-left; a terminal whose reflow moves the
      cursor off that row places clicks wrongly until the next resize.
      The alternate screen has no such row.
- [ ] A selection is held to the rows the grid shows: in a frame
      taller than the terminal a drag past the top row selects nothing
      above it, and the tree rows scrolled out are not on the clipboard.
- [ ] `mouseenter` and `mouseleave` carry the terminal's cell and the
      other target, not `x`, `y` from the corner of each node they reach.

## 7. The terminal

- [ ] A log while the console is captured is written to the run's
      stdout, as Ink writes it, even when that is a stream of the
      caller's own: a test whose app is still live when it fails hands
      its own report to that stream. `test/terminal.rip` quits after
      every test for that; the other suites do not.
- [ ] A stdout whose `columns` is 0 — a pty whose size was never set,
      as `script` makes with no terminal behind it — draws frames of no
      cells, where an undefined `columns` is read as 80 (`screen.rip`)
      and Ink reads 0 as 80 too.

## 8. Compiler-side, filed separately

- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
- A spelling for a capture listener in a render block. The package reads
  a type that ends in `Capture` (`@keydownCapture:`), since `@name:` is
  always `addEventListener(name, handler)` with no third argument.
- A name that is not defined, read as a prop of an element that holds a
  keyed `for`, surfaces as a reconciler `TypeError` (`anchor.parentNode`,
  `src/runtime/components.js:590`) with no node named, where the same
  read on an element without the `for` surfaces as the `ReferenceError`.
