# TODO — Rip TUI

Open work only, in the order it should be done. Delete a line when it
lands or moves into docs/tests. The design and the order of the larger
steps are in [PLAN.md](PLAN.md).

## 3. Reading `layout.rip`

- [ ] `edges` has no caller but two pins in `test/layout.rip`, and its
      arm for a node not laid out is reached by nothing: give it a
      caller, or remove it with its pins.
- [ ] The `border*Width` keys and `overflow: 'scroll'` are reached only
      by writing `styles` past the document, which refuses both: Yoga's
      cases through the shim (about 160 write a border width, 3
      scroll), and the fuzz. Let the document take them, or stop the
      suites writing them; until then the slots stay.
- [ ] A leaf sums its padding and border as Yoga does — both paddings,
      then both borders — and `insideAxis` sums edge by edge.
      Fractional edges part the two by one rounding, so one sum for
      both moves floats: decide which order stands.

## 4. Layout cost

- [ ] **A layout boundary.** A change dirties every ancestor up to the
      root and each recomputes: a widened text in a flat column of
      2,000 costs 6,001 visits, and a chain of 14 definite-size boxes
      recomputes all 14. Stop at the first ancestor whose width and
      height are both definite (PLAN §5).
- [ ] First layout of a 1,551-node tree is about 665 µs; style parsing
      is a third of it.

## 5. The painter and the screen

- [ ] A single code point the width tables do not know gets no column
      move after it, as a cluster of several does: U+1F6D9, unassigned
      in Unicode 17, is one cell here, and a terminal that draws it wide
      puts the rest of its run a cell off. Decide whether a code point
      outside the tables earns the move.
- [ ] Damage tracking: paint and diff only what moved (PLAN §6).

## 6. Compiler-side, filed separately

- A typed vocabulary for non-HTML hosts, so `rip check` and the editor
  accept terminal props (PLAN §14).
