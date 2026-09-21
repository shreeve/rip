# TODO — Rip

Open work only. Delete a line when it lands or moves into docs/tests.

## Compiler

- [ ] **Decide what chained `for` clauses mean.**
      `v for a in as for b in bs` left-associates into two one-clause
      nodes (`(v for a in as) for b in bs`): the LAST clause is the
      outer loop and the result is a nested array, the same as the
      parenthesized `((v for a in as) for b in bs)`. That reading is
      pinned (`test/rip/comprehensions.rip`, 'nested literal ranges')
      and used (`packages/barcodes/test.rip`). Coffee and Python read
      the same spelling as FLATTEN, first `for` outermost, which is what
      `(item for xs in [[1,2],[3]] for item in xs)` → `[1, 2, 3]` asks
      for. A later clause that reads a name only an earlier clause binds
      rejects positioned, since under nesting it is unbound there.
      Flattening is a breaking change to the pinned reading and owns
      the grammar (one node, many clauses, a guard per clause, since a
      first clause's `when` must run before the second clause's source
      evaluates), then the emitter nests every clause. One flat list
      is spelled one `for` per comprehension, outer loop last, then
      `.flat()`.
