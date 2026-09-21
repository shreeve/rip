# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

## 3. Reading `layout.rip`

- [ ] Say in the header why `for kid, i in` keeps an unused `i` (it
      compiles to a counted loop), or the loops get "cleaned".
- [ ] Remove what no suite reaches: `edges`,
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

- [ ] Hyperlinks: a `link` prop on text (OSC 8). Two of Ink's cases
      and half of a third wait for it (`test/ink/SOURCE.md`).
- [ ] The cluster table never evicts, as the style tables do not:
      300,000 distinct clusters hold 41 MB.
- [ ] Widths follow string-width 8's rule. Where a terminal disagrees
      (Thai `กำ` is one cell by that rule and two by `Bun.stringWidth`;
      U+1F6D9 is newer than Bun's tables) the column move after a
      cluster keeps the damage to that glyph. Say so in the README's
      text section, with the cases.
- [ ] **A word for the terminal's own colors.** Text with no background
      keeps the one beneath it, so nothing spells "draw this run on the
      terminal's default background" inside a colored box (Ink writes
      `backgroundColor: ''`). `'default'` for both `color` and
      `backgroundColor`; then the pinned Ink case in
      `test/ink/background.rip` follows Ink.
- [ ] **A test driver for updates.** `renderToString` mounts fresh on
      every call, so 45 of Ink's cases — a mounted tree re-rendered with
      new props — have no way to run. A public driver that mounts once,
      hands back the app, and draws frames on demand (PLAN §10); then
      port those cases.
- [ ] The style tables never evict, and a cell holds a style id in
      sixteen bits: an app that animates `'#rrggbb'` colors reaches the
      limit and is refused. Reclaim ids no cell uses.
- [ ] Damage tracking: paint and diff only what moved (PLAN §6).

## 6. Compiler-side, filed separately

- A loop variable named like a tag (`i`, `a`, `b`, `p`) at the end of a
  render line takes the indented children beneath it.
- A bound effect that awaits marks its enclosing function `async`.
- `rip -t` prints a stack trace for a lexer error.
- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
