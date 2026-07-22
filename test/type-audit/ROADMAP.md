# Type audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`. Hover rulings: `RULINGS.md`.

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

*Built.* `bun run type-audit --grammar`. Parses the corpus with an instrumented Parser — Solar's generated module carries a `ruleNames` table and a `ctx.onReduce` hook (src/grammar/solar.rip), so each reduce records its production — and reports which of the grammar's productions no fixture ever reduces, grouped by construct (`--v` lists every production). The denominator is the parser's own rule list, so "exercised by at least one fixture" is judged against a CLOSED set rather than any corpus-relative rate; the run prints the live coverage number. Parser only: no compile, no server, no tsgo.

Coverage here is necessary, not sufficient — a production can be exercised while its interaction shapes (emission reorder × repeated names, strings and comments inside the frame) stay untested. Those belong to M3's adversarial tranche, not to this gate's denominator.

Depends on nothing. Produces: the coverage number and the uncovered-rule list M3 consumes.

## M3 — Corpus rewrite

*Planned in full; authoring not started.*

Not additive growth: a REWRITE, executed as a strangler migration. The new corpus owns every production the grammar defines; the legacy fixtures (01–12) retire.

**The map.** Fifteen files from 20 (legacy keeps 01–12; the blocks coexist in `fixtures/` — filenames are KEYS, in `hover-pins.json` and in ledger citations, so nothing is renamed mid-migration; one optional atomic renumber-to-01 commit may close it).

| file | charter |
| --- | --- |
| `20-basics.rip` | program skeleton, all literals (strings, interpolation, heregex, regex), `this`, parentheticals, do-IIFE |
| `21-operations.rip` | operators, invocation, arg lists, existence/presence |
| `22-collections.rip` | objects, arrays, ranges, slices, splats, elisions, pick |
| `23-assignments.rip` | every binding form — simple, compound, method, merge, destructured patterns/spreads/rests |
| `24-conditionals.rip` | if/unless, switch/when, postfix forms, ternary |
| `25-loops.rip` | `for` in all its forms, while/until, loop, comprehensions |
| `26-exceptions.rip` | try/catch/finally, throw |
| `27-functions.rip` | def, params (typed/default/splat), return, arrows |
| `28-classes.rip` | class, super, statics, constructors, `new` forms |
| `29-modules.rip` | import/export, every specifier form, `import.meta` |
| `30-types.rip` | type aliases, interfaces, enums, generics, casts/`satisfies` |
| `31-reactive.rip` | `:=`, `~=`, `=!`, effects, gates |
| `32-components.rip` | component definition + render (structure, control flow, binds/events/refs/keys/slots), offer/accept |
| `33-schema.rip` | field forms, defaults, optionals, computed, transforms |
| `34-interactions.rip` | the adversarial tranche — emission reorder × repeated names, strings/comments inside frames, shapes minimized from real code |
| `35-edges.rip` | reserved — only if residue productions survive the sweep-up |

**Authoring.** In file order, 20 → 34: the first files set the conventions the rest imitate, and the order is a dependency ladder (each file reads using constructs already introduced) — a placement tiebreaker, not a law. Every coverage claim is verified through the gate (parse instrumented, confirm the reduction), never asserted. Grammar-dark families (loops, modules, operations) get minimal-honest coverage; the shape-starved ones (components, schema — grammar-covered yet the worst mapping territory in real code) get dense, real-shaped content. `34-interactions` has no slot — it grows as real-code sweeps surface shapes worth minimizing.

**Oracles.** Line-aligned hand-written twins, written WITH the fixture, for `20-basics`, `21-operations`, `25-loops`, `27-functions`, `28-classes`, `29-modules`, `30-types`; analogy twins for `32-components` (TSX) and `33-schema` (zod), scoped to where the analogy is honest. Everything rip-native is pinned per RULINGS.md, which the components/schema files are gated on (offer/accept is parked there). Twins beyond the subset are M5's budget.

**Negatives.** Inline in the family fixtures — no shadow error corpus. Every marker: head-line placement over a single-statement target, with mandatory expected code and reason (`# @ts-expect-error — TS2322: …`). Depends on the directive-placement and directive-scope findings landing first (see FINDINGS.md). One addition rides with the first negatives: an asserted-diagnostics lane — fixtures whose errors are UNSUPPRESSED, their exact diagnostics (code and position) asserted against the twin. Its fixtures live in `fixtures/errors/`, OUTSIDE the shared fixture walk (every other audit reads the flat `fixtures/` list — see `runner.js`'s single `fixtures` array), which is a necessity, not taste: verdict demands zero unsuppressed errors, and only this lane can see a mis-positioned diagnostic — everywhere else suppression consumes the evidence on the face.

**Grammar credit** goes to positive fixtures mechanically: the gate walks the flat `fixtures/` list, and the error lane lives outside it, so an error fixture cannot cover a production even by accident — every production's home is a positive file whose charter names it, and retirement checks reason about the positive charters alone.

**Retirement.** A legacy fixture retires only when, in one change: the gate shows zero coverage loss without it (needs a small runner enhancement first — per-fixture UNIQUE contribution; the cumulative `+N` cannot say what only one fixture provides); its distinctive mapping shapes exist in the new corpus; every ledger citation of it is updated (fixtures cited by open findings retire last); and its twin and pins leave with it.

Depends on M2 (built), the directive findings, and RULINGS.md. Produces: the corpus — and M1, M4, and M5 see only constructs the corpus contains, so their completeness is bounded here.

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
