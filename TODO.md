# TODO — Rip

Open work only. Delete a line when it lands or moves into docs/tests.

## Compiler

- [ ] **Chained `for` comprehensions miscompile.**
      `v for a in as for b in bs` is Coffee/Python flatten: first `for`
      is the outer loop. Rip left-associates two one-clause nodes
      (`(v for a in as) for b in bs`) and the emitter only walks
      `clauses[0]`. Emitted JS inverts the loops and reads the first
      clause variable before it is bound (`ReferenceError`), or else
      pushes nested arrays. Parenthesized
      `((x * y for x in xs) for y in ys)` (2-D) is fine and must stay
      that way. Own this in the grammar (one node, many clauses), then
      nest every clause in the emitter. Pin
      `(item for xs in [[1,2],[3]] for item in xs)` → `[1, 2, 3]`.
      Workaround until then: one `for` per comprehension, then `.flat()`.
