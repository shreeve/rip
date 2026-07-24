# Type audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`. Hover rulings: `RULINGS.md`.

## Built

Four audits, each judged by a different reference so they can't all fail the same way.

| audit | flag | probes | judged against |
| --- | --- | --- | --- |
| Type Audit | *(default)* | five dimensions per fixture: compiles, verdict, runtime, twin, strict | the fixtures — suppression directives are refused in positives (the runner's preflight): every fixture publishes zero diagnostics, its negatives asserted by the Diagnostics Lane; directive CARRIAGE is gated in test/lang/tsface.test.js |
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

**Standalone by design.** The audit has no oracle and needs none to run; trusting its *logic* is a one-time act, so the logic was validated against the real editor once (2026-07-17, driven — a hand-countable fixture set and a full-corpus hover sweep, both recoverable from git) and the server-driven scaffolds were then removed rather than wired in. A later change to the mapping internals it reads (`codeMask`, the skip list, translate.js's precise resolver) re-validates by recovering that drive from git — not by a permanent server tie-in a manual gauge would fire only when run. The one finding worth carrying: the walk counts the *at-risk* population (reads with no exact row), larger than what currently misleads the editor — some reads resolve today only because they sit at their cover's start, one face rewrite from breaking.

**Overlap — settled.** The Token Audit's `member` invariant is fully subsumed by M1 (the same failures, from compiler output alone); `survival` is root-subsumed but also checks the server *delivers* a token, which M1 can't see. So when the mapping gap closes, `member` reverts to guarding delivery and `survival` keeps only its delivery half.

Depends on nothing. Produces: use-site position coverage and the root classifier.

## M2 — Grammar gate

*Built.* `bun run type-audit --grammar`. Parses the corpus with an instrumented Parser — Solar's generated module carries a `ruleNames` table and a `ctx.onReduce` hook (src/grammar/solar.rip), so each reduce records its production — and reports which of the grammar's productions no fixture ever reduces, grouped by construct (`--v` lists every production). The denominator is the parser's own rule list, so "exercised by at least one fixture" is judged against a CLOSED set rather than any corpus-relative rate; the run prints the live coverage number. Parser only: no compile, no server, no tsgo.

Coverage here is necessary, not sufficient — a production can be exercised while its interaction shapes (emission reorder × repeated names, strings and comments inside the frame) stay untested. Those belong to M3's adversarial tranche, not to this gate's denominator.

Depends on nothing. Produces: the coverage number and the uncovered-rule list M3 consumes.

## M3 — Corpus rewrite

*Authoring underway: `01-basics` through `14-schema` landed — twin and error-lane pair each; the Diagnostics Lane itself (`bun run type-audit --errors`, over `corpus/errors/`) arrived with the first, the pinned-negatives lane (`error-pins.json`) and the hover `silence` gauge with `12-reactive`, and the `ruled` gauge (hover-pins.json's `positions` sections — the RULINGS-governed in-body hover positions) with `13-components`. `15-interactions` remains; the twelve legacy fixtures are retired. Productions a positive fixture cannot yet carry are parked — MANIFEST.md's Parked table, each row held by an open FINDINGS.md row — and spellings no fixture can or should ever reduce (lexically unreachable, banned by design) are excluded from the denominator by the gate's own exclusion table in runner.js.*

Not additive growth: a REWRITE, executed as a strangler migration. The new corpus owns every production the grammar defines; the twelve legacy fixtures are retired.

**The map.** Sixteen grammar-bucket files (renumbered to 01+ once the legacy corpus retired; filenames are KEYS, in `hover-pins.json` and in ledger citations, so nothing renames casually). The corpus splits by charter: `corpus/grammar/` fixtures are justified by the closed denominators below, `corpus/claims/` fixtures by CLAIMS.md rows — each bucket held to its own retirement standard by the gate.

| file | charter |
| --- | --- |
| `01-basics.rip` | program skeleton, all literals (strings, interpolation, heregex, regex), `this`, parentheticals, do-IIFE |
| `02-operations.rip` | operators, invocation, arg lists, existence/presence |
| `03-collections.rip` | objects, arrays, ranges, slices, splats, elisions, pick |
| `04-assignments.rip` | every binding form — simple, compound, method, merge, destructured patterns/spreads/rests |
| `05-conditionals.rip` | if/unless, switch/when, postfix forms, ternary |
| `06-loops.rip` | `for` in all its forms, while/until, loop, comprehensions |
| `07-exceptions.rip` | try/catch/finally, throw |
| `08-functions.rip` | def, params (typed/default/splat), return, arrows |
| `09-classes.rip` | class, super, statics, constructors, `new` forms |
| `10-modules.rip` | import/export, every specifier form, `import.meta` |
| `11-types.rip` | type aliases, interfaces, enums, generics, casts/`satisfies` |
| `12-reactive.rip` | `:=`, `~=`, `=!`, effects |
| `13-components.rip` | component definition + render (structure, control flow, binds/events/refs/keys/slots), gates, offer/accept |
| `14-schema.rip` | field forms, defaults, optionals, computed, transforms |
| `15-interactions.rip` | the adversarial tranche — emission reorder × repeated names, strings/comments inside frames, shapes minimized from real code |
| `16-edges.rip` | reserved — only if residue productions survive the sweep-up |

**Authoring.**

- **Order.** The ground floor first (01, 02 — the files that set the conventions the rest imitate), then PARALLEL WAVES: 03–07, then 08–11 — each file authored in an isolated worktree against its MANIFEST.md allocation, adversarially reviewed against the charter and the 01/02 precedent, then integrated and verified by gate arithmetic: coverage must rise by exactly the sum of the wave's claims, and a still-dark production names the file that missed it. 12–14 stay sequential: rulings-gated (RULINGS.md) and pin-heavy, where independent interpretation costs most.
- **The ladder is a tiebreaker, not a law.** The order remains a dependency ladder (each file reads using constructs already introduced); charter-boundary calls for ambiguous productions are settled in MANIFEST.md, not per-author.
- **The register.** Explicit call parens by default (matching the twins; the implicit spelling stays covered, densely in `02-operations` whose charter owns invocation); single quotes unless rip's interpolation syntax forces double; padded braces on inline object and type literals in both pair members (`{ host: 1 }` — the TS standard, and the dominant register in this repo's own rip sources); negatives in the family's error fixture, never inline (see **Negatives**).
- **Verified, never asserted.** Every coverage claim goes through the gate: parse instrumented, confirm the reduction.
- **Density follows starvation.** Grammar-dark families (loops, modules, operations) get minimal-honest coverage; the shape-starved ones (components, schema — grammar-covered yet the worst mapping territory in real code) get dense, real-shaped content. `15-interactions` has no slot — it grows as real-code sweeps surface shapes worth minimizing.

**Oracles.** Hand-written twins, written WITH the fixture, for `01-basics`, `02-operations`, `06-loops`, `08-functions`, `09-classes`, `10-modules`, `11-types`, and `12-reactive` — the reactive twin is plain TS (`:=` → `let`, `~=`/`=!` → `const`, an effect's disposer spelled as a value), honest for the type story because the editor's ruled answers are value types; where a write re-fires an effect the twin hand-replays the flush, so runtime parity there asserts a predicted trace, not an independent derivation. Analogy twins for `13-components` (TSX) and `14-schema` (zod), scoped to where the analogy is honest. Positive twins are STANDARD-TS-formatted — every closing brace on its own line at conventional indentation, as a formatter would produce, never line-parity with the `.rip`: correspondence is by construct order and symbol name, the fixture is never edited for the twin's sake, and the twin running longer than its fixture is desired — it showcases rip's concision. Error pairs (`corpus/errors/`) remain strictly line-aligned, because the Diagnostics Lane derives expected positions from them. Everything rip-native is pinned per RULINGS.md, which the components/schema files are gated on (offer/accept is parked there). Twins beyond the subset are M5's budget.

**Negatives.** Every negative lives in the error lane — a negative test is an unsuppressed program plus an asserted diagnostic, the model TypeScript's own compiler suite uses.

- **The pair.** Each family file pairs with an UNSUPPRESSED fixture in `corpus/errors/` — named `NN-family.errors.rip` beside its twin `NN-family.errors.ts`, the role suffix keeping basenames unique across the corpus (quick-open, tabs, and tool output all disambiguate without the path) — LINE-ALIGNED, with an `@ts-nocheck` pragma pair that keeps every authoring surface quiet, lane-stripped and lane-enforced. A blank line separates the setup declarations from the `wrong*` variables, and names are full words in both members — `wrongArgument`, never `wrongArg`; `amount`, never `n`.
- **Asserted, and derived.** The Diagnostics Lane (`bun run type-audit --errors`) asserts every published diagnostic's code AND position, expectations derived from tsgo's own run over the twin — never hand-authored where a twin can judge.
- **Positives are error-free absolutely.** The verdict dimension means zero published diagnostics, no marker accounting, and M3 fixtures carry no `@ts-expect-error`. The directive stays in rip on its own merits — strict-mode's per-line acknowledgment, gated by `check.test.js` and the editor suite — but the corpus does not depend on it.
- **Rip-native negatives are pinned — exactly where no twin can judge.** Components and schema have no honest twin to derive from; their expectations are PINNED — code and position, reviewed measurements under the hover-pins discipline, gated on RULINGS.md like the hovers beside them. Reactive is HYBRID: rows its plain-TS twin can judge stay derived (a wrong `=!` initializer, a write to a `=!` binding), and only the lowering's extra diagnostics — the `:=`/`~=` second publish, which no honest twin line can spell — carry pins (`error-pins.json`, additive per pair, same discipline).
- **Outside the walk.** `corpus/errors/` sits OUTSIDE the shared fixture walk (every other audit reads the positive buckets — `corpus/grammar/` and `corpus/claims/` — see `runner.js`'s `fixtures` array), a necessity twice over: verdict demands zero unsuppressed errors, and error fixtures must not earn grammar credit.
- **Falsifiability is contractual.** The gate's Negative-coverage section measures the error lane against the positive corpus's own claims: every type-vocabulary class the positives use must carry at least one error-lane instance — an unfalsified class paints red. The vocabulary is TypeScript's own type grammar: the gate parses every type text through the pinned tsgo's unstable API in-process each run and classifies by TS type-AST node kind — a closed taxonomy, never a curated list, never stale. The census closes the positive side on the same denominator: every kind TS's type grammar defines is enumerated, and every kind the corpus does not claim sits in a visible queue until it is claimed or ruled out through the gate's exclusion table — a kind nobody thought of is still a queue item. Per-family production fractions print beside it as a gauge, contract unruled. CLAIMS.md carries the rest: behaviors and containment cells — coverage no syntactic denominator can derive.
- **What the lane structurally owns beyond codes:** columns (the #21 diagnostics surface — a line-level check cannot see a mis-position within the line), shapes no head-line directive could govern (the emitter's decline classes), and negatives that would crash the runtime dimension (error fixtures never run).
- **Type sub-language boundaries** (probed 2026-07-24, the expressibility census — one rip probe per unclaimed census kind through compile-to-face). Two kinds are lexer-rejected by design and sit in the census exclusion table with the lexer's own errors as reasons: template-literal types (a dedicated rejection — the backtick is rip's own token) and construct signatures (the parenthesized annotation `(new () => T)` is the surviving spelling). Mapped types are lexer-rejected but NOT excluded — the open mapped-type finding holds the queue row, because the rejection is the type-body validator's generic code-expression check firing on TS's own `in`, not a considered ruling. Five kinds are position-constrained — expressible, but only in some spellings: constructor types only inside parentheses in an annotation or after `as` (a bare `new` at annotation start is a parse error, and a `type` body rejects it as a code expression), method signatures only in INDENTED type blocks (the inline `{ greet(n: number): string }` body is rejected), `import(…)` types only in annotation position (not inside a `type` body), `this`-types only as a class method's return annotation (`bump: (): this ->` — type bodies reject it), and type predicates only as a def's return annotation (inside a type body, `value is string` collides with rip's `is` rewrite — the open type-predicate finding). Census-queue authoring must use the surviving spellings. The seam for out-of-charter type-level programming is verified, both polarities: an exotic alias authored in a `.ts` module imports into rip by NAME (an ordinary, backtick-free type reference), and enforcement crosses the boundary — a wrong assignment draws TS2322 spelled in the exotic type, positioned on the rip line.

**Grammar credit** goes to `corpus/grammar/` fixtures alone: the gate counts reductions only from the grammar bucket, so neither an error fixture nor a claims fixture can cover a production even by accident — every production's home is a grammar fixture whose charter names it, and retirement checks reason about the grammar charters alone. The claims bucket has its own mirror standard: every `corpus/claims/` fixture must be a named carrier of at least one CLAIMS.md row, judged live by the gate.

**Retirement.** The legacy fixtures are retired — twins and pins with them, every ledger citation re-grounded on the new corpus. The gate's unique-contribution line is the standing instrument: a fixture it lists as removable contributes nothing the rest of the corpus lacks, and a healthy corpus reads "every fixture reduces at least one production no other fixture does."

The mapping census RISES throughout: every new fixture adds at-risk reads to a gauge that is red by design while the identifier-read finding stays open (see FINDINGS.md). Expected, and the point — the grown corpus is what makes that census meaningful when the fix lands. Nothing to fix here.

Depends on M2 (built), RULINGS.md — the components/schema files and their pinned negatives are gated on it — and MANIFEST.md (the ownership decision record the gate joins against — claim lists stay live in the gate's own output, so nothing is regenerated). Produces: the corpus — and M1, M4, and M5 see only constructs the corpus contains, so their completeness is bounded here.

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
