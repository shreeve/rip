# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

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

## 6. Input and focus

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

## 8. Compiler-side, filed separately

- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
- A spelling for a capture listener in a render block. The package reads
  a type that ends in `Capture` (`@keydownCapture:`), since `@name:` is
  always `addEventListener(name, handler)` with no third argument.

## 9. Found by the live test runner

- [ ] Frames are paced by a fixed 8 ms. A lane that writes a thousand
      chunks a second would draw a frame each 8 ms, so
      `scripts/test-live.rip` keeps its run in a plain model that a
      computed re-reads on each `tick.frame`, painting once a tick. An
      app should set the least interval between frames (`run App,
      pace: ms`, and `mount` honoring it through `view.tick`) and bind
      its state directly.
- [ ] `print` writes above only the `Static` items already in the tree:
      an effect that prints in the turn that appends an item runs
      before the render block adds that item, so the item's row lands
      below the printed text. The runner holds its ending back a tick
      so its last lanes' rows are written before the failures it
      prints.
- [ ] A mount closed by `quit` draws no last frame, where `run` does:
      what the quitting turn added to `Static`, or changed in the
      frame, reaches neither `view.scrollback` nor the frame unless the
      test calls `view.frame()` before the quit lands.
- [ ] `mount` always draws at full color depth, so a test cannot see an
      app at 16 colors or at none: the runner's named colors for a
      terminal of 16, and its rows with no color at all, are unpinned.
- [ ] A row `Box` of several `Text`s wraps at a narrow width; the row
      that holds is one `Text` of nested styled runs with `wrap:
      'truncate'`, which the runner found by trial. The README's text
      section does not say so.
