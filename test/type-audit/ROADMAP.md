# Type audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`.

## Built

Three audits, each judged by a different reference so they can't all fail the same way.

| audit | flag | probes | judged against |
| --- | --- | --- | --- |
| Type Audit | *(default)* | six dimensions per fixture: compiles, directives, verdict, runtime, twin, strict | the fixtures — a `# @ts-expect-error` marks a line that must error |
| Hover Audit | `--hover` | hover every top-level declaration through the editor server | the hand-written `.ts/.tsx` twin, falling back to `hover-pins.json` |
| Token Audit | `--token` | semantic token + modifiers on every top-level declaration | the `.rip` source itself — no twin, no baseline, cannot self-confirm |

The shared gap: all three probe declarations or type verdicts. None asks, of an identifier at a *use* site: where does it map, and is that the right place?

## Why the gap bites

`console.log total` is a paren-less call, so rip supplies the parens: the face reads `console.log(total)`.

- The compiler emits one `args` row for the injected `(total)`, and it **round-trips exactly** — the whole span maps back to the whole `total`. That is what `mapping.test.js` asserts, over every row the compiler emits.
- But `total` itself maps to that row's left edge — onto `(tota`, not `total`. Hover there answers about `console.log`.

The row is self-consistent and wrong, and no built audit visits that use site.

## M1 — Mapping audit

*Prototyped; not built.*

`bun run type-audit --map`. Walks every identifier in the source, checks it maps to a generated position holding the same text. No server, no tsgo, no twin — it runs from the compiler output alone.

Two invariants, neither catching the other's cases:

- **`placed`** — an exact position resolves. Catches rewrites, where the map refuses.
- **`text`** — that position holds the identifier. Catches mark-width, where the map answers wrong.

Each failure is classified by root, from the row it fell to. The classification is the output — the run prints the live counts; they don't belong frozen here.

The prototype's failures all fall to two roots, and none is a genuinely missing span (the classifier finds no identifier without a containing row — the spans exist, they're just wrong):

1. **A mark includes synthetic text its source span doesn't.** The dominant class. It bites type-body members (`$self`), paren-less calls (`args`), and schema fields (`body`): the row degrades to a cover and byte arithmetic dies. `operator` roles already emit punctuation as zero-width synthetic rows, leaving operands `exact` — the precedent exists.
2. **A rewrite inside a span.** A smaller, distinct class: string literals are unconditionally re-rendered double-quoted with escapes recomputed. TypeScript accepts `'x:'`, so the divergence isn't required.

**Calibration gate, before any run is trusted:** 01-basic's `console.log('…:', value)` lines are a hand-countable set of use-site identifiers; the ones the audit flags there must match an independent LSP hover sweep of the same positions. No oracle means nothing else contradicts a wrong mask, skip list, or classifier — that agreement is the only outside evidence the instrument gets.

**Overlap sub-step:** whether the Token Audit's `member` / `survival` invariants are red for reasons M1 also catches is unverified. Compare the failure sets. If subsumed, they revert to guarding token *delivery*, which M1 structurally can't see.

Depends on nothing. Produces: use-site position coverage and the root classifier.

## M2 — Grammar gate

*Prototyped; not built.*

Report per run: how many grammar rules the corpus exercises, and which it doesn't.

The corpus exercises only a fraction of the rules real rip code uses, and whole constructs are missing — `throw`, for one, appears in no fixture.

Depends on nothing. Produces: the coverage number and the uncovered-rule list M3 consumes.

## M3 — Corpus growth

*Not started.*

Toward full coverage of the rules real code uses, driven by M2's gap list.

New fixtures need no twins — both twin dimensions already return `n/a`.

Depends on M2. Produces: fixtures. M1, M4, and M5 see only constructs the corpus contains, so their completeness is bounded here.

## M4 — Spelling-invariance

*Hover and definition driven; not built.*

Same program, two spellings, same LSP answers. `console.log total` and `console.log(total)` must hover, go-to-def, and complete identically.

Reaches the LSP surfaces M1 never drives, because it asks the server — but it needs no oracle: the two spellings check each other.

Driven on the #21 pair: hovering `total` in `console.log total` returns `console.log`'s own docs and go-to-def jumps into `lib.dom.d.ts`, while `console.log(total)` hovers `let total: number` and defines to the local declaration — violation caught, no oracle consulted. A whitespace-only respelling holds, so the check isn't trivially red.

Depends on the server; benefits from M3. Produces: surface coverage across the LSP entry points, no twins written.

## M5 — Content oracles (#22)

*Not started.*

Hover *content* at use sites; completion; signature help. What M4 can't reach by symmetry alone, checked against hand-written twins.

Depends on server + new twins. Produces: the content-level checks #22 asks for.

## M6 — Rename to Editor Audit

*Not started; last, deliberately.*

The umbrella `type audit` collides with its own default member (also *Type Audit*) and undersells the non-type members. Once those members exist, rename the family to **Editor Audit**: `bun run type-audit` → `bun run editor-audit`, plus the `FINDINGS.md` and doc references; the default member keeps the name *Type Audit*. Not bare *audit* — that reads as `bun audit`, dependency-security auditing.

Depends on M1–M5. Renaming before they exist is churn for no benefit. Produces: a name that fits what the instrument became.
