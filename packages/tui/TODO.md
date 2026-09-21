# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

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

- [ ] A whole frame pays for spans it does not need: every grid write
      reads its row's span, about a tenth of the paint of a screen of
      bordered boxes (`bun run frame`, panels).
- [ ] 100% churn of the 40×8 table is about 340 µs of CPU an update
      over the 300 updates of `bun run tui`, and about 170 µs over
      12,000: the run ends while the damage path is still being
      compiled. Warm the bench longer, or make the path smaller.

## 6. Compiler-side, filed separately

- A loop variable named like a tag (`i`, `a`, `b`, `p`) at the end of a
  render line takes the indented children beneath it.
- A bound effect that awaits marks its enclosing function `async`.
- `rip -t` prints a stack trace for a lexer error.
- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
