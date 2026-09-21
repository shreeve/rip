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
- [ ] 100% churn of the 40×8 table is about 340 µs of CPU an update
      over the 300 updates of `bun run tui`, and about 170 µs over
      12,000: the run ends while the damage path is still being
      compiled. Warm the bench longer, or make the path smaller.

## 6. Compiler-side, filed separately

- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
