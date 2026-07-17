# Type audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`.

## Built

Four audits, each judged by a different reference so they can't all fail the same way.

| audit | flag | probes | judged against |
| --- | --- | --- | --- |
| Type Audit | *(default)* | six dimensions per fixture: compiles, directives, verdict, runtime, twin, strict | the fixtures — a `# @ts-expect-error` marks a line that must error |
| Hover Audit | `--hover` | hover every top-level declaration through the editor server | the hand-written `.ts/.tsx` twin, falling back to `hover-pins.json` |
| Token Audit | `--token` | semantic token + modifiers on every top-level declaration | the `.rip` source itself — no twin, no baseline, cannot self-confirm |
| Mapping Audit | `--map` | every source identifier maps to a generated position holding the same text | the compiler output alone — no server, no tsgo, no twin (its logic validated against the editor once, then the scaffold retired) |

The first three probe declarations or type verdicts. None asks, of an identifier at a *use* site: where does it map, and is that the right place? The Mapping Audit does — from the compiler's own rows, so it needs no server. It closed the gap below.

## Why the gap bites

`console.log total` is a paren-less call, so rip supplies the parens: the face reads `console.log(total)`.

- The compiler emits one `args` row for the injected `(total)`, and it **round-trips exactly** — the whole span maps back to the whole `total`. That is what `mapping.test.js` asserts, over every row the compiler emits.
- But `total` itself maps to that row's left edge — onto `(tota`, not `total`. Hover there answers about `console.log`.

The row is self-consistent and wrong, and no built audit visits that use site.

## M1 — Mapping audit

*Built.* `bun run type-audit --map`. Walks every source identifier and checks it maps to a generated position holding the same text — from the compiler's own rows, so no server, tsgo, or twin, under any flag. Two invariants partition the failures: `placed` (the precise resolver refuses — a rewrite) and `text` (it resolves to the wrong bytes — mark-width, the #21 hazard). Each is classified by the row it fell to and by root (synthetic-inclusion dominant, string-rewrite smaller); the run prints the live counts. It also proves each pass that no flagged read lacks a containing row — a genuinely missing span would be a new class.

**Standalone by design.** The audit has no oracle and needs none to run; trusting its *logic* is a one-time act, so the logic was validated against the real editor once (2026-07-17, driven — the hand-countable 01-basic set and a full-corpus hover sweep, both in git) and the server-driven scaffolds were then removed rather than wired in. A later change to the mapping internals it reads (`codeMask`, the skip list, translate.js's precise resolver) re-validates by recovering that drive from git — not by a permanent server tie-in a manual gauge would fire only when run. The one finding worth carrying: the walk counts the *at-risk* population (reads with no exact row), larger than what currently misleads the editor — some reads resolve today only because they sit at their cover's start, one face rewrite from breaking.

**Overlap — settled.** The Token Audit's `member` invariant is fully subsumed by M1 (the same failures, from compiler output alone); `survival` is root-subsumed but also checks the server *delivers* a token, which M1 can't see. So when the mapping gap closes, `member` reverts to guarding delivery and `survival` keeps only its delivery half.

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
