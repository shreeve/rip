# CLEANROOM — the clean-room engine rewrite plan

What we intend to do once Rip v4 runs and works as we want: rewrite the
engine — lexer, parser, emitter — from scratch, clean room, with full
access to v4 as reference. Not because v4 is broken, but because it is
the first version that is *finished enough to specify*. Everything we
have was cobbled forward from v1 → v2 → v3 → v4. The rewrite starts
with the end in mind: we know exactly what the engine must produce,
because the test suite says so.

This document is the ethos and the method. It is not scheduled work;
it activates when v4 is declared done.

## Why this is viable for Rip

Most rewrite-from-the-tests attempts fail because the tests are
incidental. Ours are constitutional — rule 5 says tests are the
contract, and the corpus was built accordingly:

- **The battery** (`test/battery/*.rip`) pins syntax → JavaScript,
  row by row — the language's syntax contract.
- **Corpus snapshots** pin whole-program emission.
- **Negative tests** pin positioned, identifying error messages.
- **The generated-scopes inventory** pins every emitter-introduced
  function scope with its control-flow policy.
- **Mapping/explain tests** pin source-map fidelity offset by offset.
- **The type-audit scoreboard** pins the editor surface.
- **Every confirmed defect becomes a permanent pin** in the same
  commit as its fix — the spec grows monotonically harder to violate.

We have been writing the rewrite's specification for four versions
without calling it that.

## The central decision: same bytes, or same behavior

Thousands of pins assert exact emitted JavaScript. A clean-room engine
that is semantically perfect but formats differently fails all of them
instantly. The decision, made here:

**Behavior-compatible, with individually renegotiated byte pins.**

- The battery's runtime tests and negative tests are the immovable
  spec: same inputs, same values, same rejections, same positions.
- The `code` pins and corpus are renegotiable — but only one deliberate
  decision at a time. Every place the new engine emits different bytes
  is inspected, justified, and landed with its regenerated snapshot
  (rule 6, applied at rewrite scale). An unexplained difference is a
  stop-and-report, exactly as today.

Byte-compatibility as a blanket goal is rejected: it would force the
new engine to inherit every formatting accident of the old one, which
defeats the purpose of a clean room.

## Precondition: measure the spec before trusting it

The dammit-on-new bug lived unpinned across four versions — proof that
the suite has holes exactly where nobody looked. A clean-room engine
could differ *silently* anywhere the suite does not constrain. So
before the first line of new engine code:

1. **Mutation audit.** Perturb the current engine mechanically (lexer,
   parser tables, emitter branches) and count which mutants the full
   suite kills. Every surviving mutant is unpinned behavior.
2. **Pin the holes.** Each survivor becomes a battery row or negative
   test against the CURRENT engine, reviewed for whether current
   behavior is even correct.
3. Only then is the suite a specification rather than a hope.

## Method: in place, one component at a time

No big bang. The architecture already provides the seams, and the
rewrite swaps components behind them:

```text
source → LEXER → TokenTape → PARSER → s-expressions → EMITTER → JS
         (1st)               (2nd)    ["=", "x", 42]   (3rd, hardest)
```

- **Lexer first.** The TokenTape contract is pinned by `-t` output.
- **Parser second.** The s-expression shape is pinned by `-s` output,
  and the parser generator compiles itself — a built-in canary: byte
  drift in the generated parser flags a doctrine violation for free.
- **Emitter last.** The hard one; this is where the byte-pin
  renegotiation lives, region by region.

Each new component ships only when the ENTIRE suite is green with it
in place; the old component stays one revert away. "Upgrade in place,
without risking everything" is not a hope — it is the property this
ordering purchases.

Workflow per behavior: red pins first (write the failing tests that
specify the cell), then implement to green — the same loop that fixed
dammit-on-new, run at language scale.

## What the suite does not capture (kept honestly in view)

- **Performance.** Pins assert correctness, not speed. The rewrite
  carries its own benchmark obligations (rule 7: a performance claim
  lands with its measurement, construction cost included).
- **Unpinned diagnostics.** Error messages beyond the pinned set may
  drift; drift in a message a user has learned to read is a
  regression even when no test fails.
- **Unknown unknowns.** The mutation audit shrinks this set; it does
  not eliminate it. Cold-reader review of the new engine against the
  written doctrine (AGENTS.md's lowering rules) covers what tests
  cannot.

## What the rewrite may bake in

Findings already measured and filed (see the performance map in the
janus repo and TODO.md) become design inputs instead of patches:
allocation-light per-request paths in emitted code, emitter output
shaped for JIT-friendliness, and any hot-path structure the profiler
has since identified. The clean room is the one place these can be
load-bearing decisions rather than retrofits.

## Non-goals

- **No language changes during the rewrite.** One variable at a time:
  the engine changes, the language does not. Syntax and semantics
  proposals queue until the new engine is the engine.
- **No spec-by-memory.** If a behavior matters and is not pinned, the
  pin comes first — against the old engine, so both engines answer to
  the same paper.
- **No parallel maintenance era.** The old engine is reference and
  fallback during the swap, never a second product line.
