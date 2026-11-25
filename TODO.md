# TODO — Rip

Open work only. Delete a line when it lands or moves into docs/tests.

## Construction spelling — `new X` or `X.new`, owner decision deferred

Rip has two construction spellings. `X.new …` is the one in use (2,633
uses in `packages/`, 225 in medlabs, counted from real parses at main
`1d68bbe4`, 2026-11-24); `new X(…)` has none, and the package style gate
bans it. Removing `new X` drops 16 grammar rules and 23 LALR states, no
conflicts. The reverse choice is also open: keep `new X` and drop
`X.new`, which costs a spelling of its own — no method named `new` can
be called through dot syntax (`obj.new 1` compiles to `new obj(1)`).
Both stay until the owner picks one.
