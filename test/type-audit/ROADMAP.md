# Type audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`. Hover rulings: `RULINGS.md`.

## Built

Six lanes, each judged by a different reference so they can't all fail the same way.

| audit | flag | probes | judged against |
| --- | --- | --- | --- |
| Grammar Gate | `--grammar` | which of the grammar's productions the corpus reduces, and which it never does — carrying the type-vocabulary census, the negative-coverage contract, and the CLAIMS.md join | the parser's OWN rule list and TypeScript's own type grammar — closed denominators nobody here chose; parser only, no compile, no server |
| Mapping Audit | `--map` | every source identifier maps to a generated position holding the same text | the compiler output alone — no server, no tsgo, no twin (its logic validated against the editor once, then the scaffold retired) |
| Type Audit | *(default)* | five dimensions per fixture: compiles, verdict, runtime, twin, strict | the fixtures — suppression directives are refused in positives (the runner's preflight): every fixture publishes zero diagnostics, its negatives asserted by the Diagnostics Lane; directive CARRIAGE is gated in test/lang/tsface.test.js |
| Diagnostics Lane | `--errors` | the corpus's negatives — every published diagnostic asserted by code AND position | the LINE-ALIGNED twin's own tsgo diagnostics, with `error-pins.json` carrying the rows no honest twin can spell |
| Hover Audit | `--hover` | hover every top-level declaration through the editor server | the hand-written `.ts/.tsx` twin, falling back to `hover-pins.json` |
| Token Audit | `--token` | semantic token + modifiers on every top-level declaration | the `.rip` source itself — no twin, no baseline, cannot self-confirm |

The Type, Hover, and Token audits probe declarations or type verdicts. None asks, of an identifier at a *use* site: where does it map, and is that the right place? The Mapping Audit does — from the compiler's own rows, so it needs no server. It closed the gap below.

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

Coverage here is necessary, not sufficient — a production can be exercised while its interaction shapes (emission reorder × repeated names, strings and comments inside the frame) stay untested. Production counting is context-free and cannot distinguish switch-in-render from switch-anywhere, so those shapes are measured by the containment matrix this same gate builds from the parse trees, joined against CLAIMS.md's ruled cells — not by this denominator.

Depends on nothing. Produces: the coverage number and the uncovered-rule list M3 consumes.

## M3 — Corpus rewrite

*The grammar bucket is authored: `01-basics` through `14-schema` landed — twin and error-lane pair each; the Diagnostics Lane itself (`bun run type-audit --errors`, over `corpus/errors/`) arrived with the first, the pinned-negatives lane (`error-pins.json`) and the hover `silence` gauge with `12-reactive`, and the `ruled` gauge (hover-pins.json's `positions` sections — the RULINGS-governed in-body hover positions) with `13-components`. The twelve legacy fixtures are retired. The remainder is the claims bucket, which is born empty and authored to CLAIMS.md's ruled rows. Productions a positive fixture cannot yet carry are parked — MANIFEST.md's Parked table, each row held by an open FINDINGS.md row — and spellings no fixture can or should ever reduce (lexically unreachable, banned by design) are excluded from the denominator by the gate's own exclusion table in runner.js.*

Not additive growth: a REWRITE, executed as a strangler migration. The new corpus owns every production the grammar defines; the twelve legacy fixtures are retired.

**The map.** Fourteen grammar-bucket files (renumbered to 01+ once the legacy corpus retired; filenames are KEYS, in `hover-pins.json` and in ledger citations, so nothing renames casually). The corpus splits by charter: `corpus/grammar/` fixtures are justified by the closed denominators below, `corpus/claims/` fixtures by CLAIMS.md rows — each bucket held to its own retirement standard by the gate. The claims bucket numbers independently from 01, and basenames stay unique corpus-wide (twins, pins, and carriers all key on them — the gate refuses a collision).

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

**Authoring.**

- **Order.** The ground floor first (01, 02 — the files that set the conventions the rest imitate), then PARALLEL WAVES: 03–07, then 08–11 — each file authored in an isolated worktree against its MANIFEST.md allocation, adversarially reviewed against the charter and the 01/02 precedent, then integrated and verified by gate arithmetic: coverage must rise by exactly the sum of the wave's claims, and a still-dark production names the file that missed it. 12–14 stay sequential: rulings-gated (RULINGS.md) and pin-heavy, where independent interpretation costs most.
- **The ladder is a tiebreaker, not a law.** The order remains a dependency ladder (each file reads using constructs already introduced); charter-boundary calls for ambiguous productions are settled in MANIFEST.md, not per-author.
- **The register.** Explicit call parens by default (matching the twins; the implicit spelling stays covered, densely in `02-operations` whose charter owns invocation); single quotes unless rip's interpolation syntax forces double; padded braces on inline object and type literals in both pair members (`{ host: 1 }` — the TS standard, and the dominant register in this repo's own rip sources); negatives in the family's error fixture, never inline (see **Negatives**).
- **Verified, never asserted.** Every coverage claim goes through the gate: parse instrumented, confirm the reduction.
- **Density follows starvation.** Grammar-dark families (loops, modules, operations) get minimal-honest coverage; the shape-starved ones (components, schema — grammar-covered yet the worst mapping territory in real code) get dense, real-shaped content.

**Oracles.** Hand-written twins, written WITH the fixture, for `01-basics`, `02-operations`, `06-loops`, `08-functions`, `09-classes`, `10-modules`, `11-types`, and `12-reactive` — the reactive twin is plain TS (`:=` → `let`, `~=`/`=!` → `const`, an effect's disposer spelled as a value), honest for the type story because the editor's ruled answers are value types; where a write re-fires an effect the twin hand-replays the flush, so runtime parity there asserts a predicted trace, not an independent derivation. Analogy twins for `13-components` (TSX) and `14-schema` (zod), scoped to where the analogy is honest. Positive twins are STANDARD-TS-formatted — every closing brace on its own line at conventional indentation, as a formatter would produce, never line-parity with the `.rip`: correspondence is by construct order and symbol name, the fixture is never edited for the twin's sake, and the twin running longer than its fixture is desired — it showcases rip's concision. Error pairs (`corpus/errors/`) remain strictly line-aligned, because the Diagnostics Lane derives expected positions from them. Everything rip-native is pinned per RULINGS.md, which the components/schema files are gated on (offer/accept is parked there). Twins beyond the subset are M5's budget.

**Negatives.** Every negative lives in the error lane — a negative test is an unsuppressed program plus an asserted diagnostic, the model TypeScript's own compiler suite uses.

- **The pair.** Each family file pairs with an UNSUPPRESSED fixture in `corpus/errors/` — named `NN-family.errors.rip` beside its twin `NN-family.errors.ts`, the role suffix keeping basenames unique across the corpus (quick-open, tabs, and tool output all disambiguate without the path) — LINE-ALIGNED, with an `@ts-nocheck` pragma pair that keeps every authoring surface quiet, lane-stripped and lane-enforced. A blank line separates the setup declarations from the `wrong*` variables, and names are full words in both members — `wrongArgument`, never `wrongArg`; `amount`, never `n`.
- **Asserted, and derived.** The Diagnostics Lane (`bun run type-audit --errors`) asserts every published diagnostic's code AND position, expectations derived from tsgo's own run over the twin — never hand-authored where a twin can judge.
- **Positives are error-free absolutely.** The verdict dimension means zero published diagnostics, no marker accounting, and M3 fixtures carry no `@ts-expect-error`. The directive stays in rip on its own merits — strict-mode's per-line acknowledgment, gated by `check.test.js` and the editor suite — but the corpus does not depend on it.
- **Rip-native negatives are pinned — exactly where no twin can judge.** Components and schema have no honest twin to derive from; their expectations are PINNED — code and position, reviewed measurements under the hover-pins discipline, gated on RULINGS.md like the hovers beside them. Reactive is HYBRID: rows its plain-TS twin can judge stay derived (a wrong `=!` initializer, a write to a `=!` binding), and only the lowering's extra diagnostics — the `:=`/`~=` second publish, which no honest twin line can spell — carry pins (`error-pins.json`, additive per pair, same discipline).
- **Outside the walk.** `corpus/errors/` sits OUTSIDE the shared fixture walk (every other audit reads the positive buckets — `corpus/grammar/` and `corpus/claims/` — see `runner.js`'s `fixtures` array), a necessity twice over: verdict demands zero unsuppressed errors, and error fixtures must not earn grammar credit.
- **Falsifiability is contractual.** The gate's Negative-coverage section measures the error lane against the positive corpus's own claims: every type-vocabulary class the positives use must carry at least one error-lane instance — an unfalsified class paints red. The vocabulary is TypeScript's own type grammar: the gate parses every type text through the pinned tsgo's unstable API in-process each run and classifies by TS type-AST node kind — a closed taxonomy, never a curated list, never stale. The census closes the positive side on the same denominator: every kind TS's type grammar defines is enumerated, and every kind the corpus does not claim sits in a visible queue until it is claimed or ruled out through the gate's exclusion table — a kind nobody thought of is still a queue item. Per-family production fractions print beside it as a gauge, contract unruled. CLAIMS.md carries the rest: behaviors and containment cells — coverage no syntactic denominator can derive.
- **What the lane structurally owns beyond codes:** columns (the #21 diagnostics surface — a line-level check cannot see a mis-position within the line), shapes no head-line directive could govern (the emitter's decline classes), and negatives that would crash the runtime dimension (error fixtures never run).
- **Type sub-language boundaries** (probed 2026-07-24, the expressibility census — one rip probe per unclaimed census kind through compile-to-face). Two kinds are lexer-rejected by design and sit in the census exclusion table with the lexer's own errors as reasons: template-literal types (a dedicated rejection — the backtick is rip's own token) and construct signatures (the parenthesized annotation `(new () => T)` is the surviving spelling). Mapped types are lexer-rejected but NOT excluded — the open mapped-type finding holds the queue row, because the rejection is the type-body validator's generic code-expression check firing on TS's own `in`, not a considered ruling. `import(…)` types are finding-held rather than excluded: a `.rip` specifier does not resolve in type position, though a `.ts` one does, so the corpus cannot carry the kind. Method signatures are claimed by their INDENTED spelling only — the inline `{ greet(n: number): string }` body draws the same code-expression rejection, held by the open method-member finding. Four kinds are position-constrained — expressible, but only in some spellings: constructor types only inside parentheses in an annotation or after `as` (a bare `new` at annotation start is a parse error, and a `type` body rejects it as a code expression), abstract construct signatures the same way, `this`-types only as a class method's return annotation (`bump: (): this ->` — type bodies reject it), and type predicates only as a def's return annotation (inside a type body, `value is string` collides with rip's `is` rewrite — the open type-predicate finding). Census-queue authoring must use the surviving spellings; both member layouts reach the census, because the gate classifies each declaration through the compiler's own renderer (`renderTypeDecl`) rather than through rip's source text, which is not TypeScript. The seam for out-of-charter type-level programming is verified, both polarities: an exotic alias authored in a `.ts` module imports into rip by NAME (an ordinary, backtick-free type reference), and enforcement crosses the boundary — a wrong assignment draws TS2322 spelled in the exotic type, positioned on the rip line.

- **No exit-code contract yet — deliberately deferred.** The runner exits non-zero only on STRUCTURAL refusals (bad argv, a malformed manifest, a suppression directive in a positive fixture, a moved TypeScript surface, a probe pass that did not cover the corpus). Its own findings — invariant violations, position violations, unfalsified classes — print red and exit 0, and `bun run type-audit` sits outside `test` and `test:all`, which collect `*.test.js` only. So the audits are read by a person, not gated. Wiring them to a CI gate is not a flag: several reds are permanent by agreement, each held by an open FINDINGS row, so a build that fails on any red fails forever. It needs the expected-red set declared where the runner can join it live (the `error-pins.json` pattern — prose `why`, never a row's number, which would rot when the row closes), gating contractual invariants while gauges stay informational, and failing in BOTH directions: fewer reds than declared means a finding closed and its row needs retiring, which is exactly the signal a one-directional baseline swallows.

**The claims bucket** carries what no syntactic denominator reaches, and it is where the remaining authoring lives. Two classes of coverage land here, both ruled into CLAIMS.md before a fixture exists: CHECKER BEHAVIORS — narrowing, inference enforcement, the component consumer face, schema projection — where the semantics have no token or production to count; and CONTAINMENT cells, the construct-inside-construct shapes production counting is context-free about. Interaction coverage is this bucket's charter: a cross-context shape becomes a ruled cell the gate checks against the containment matrix it walks from the parse trees, so an interaction the corpus lacks paints red as data rather than sitting in prose as a to-do.

The matrix reaches only the constructs its head set names (`CONSTRUCT_HEADS` in runner.js). Cast, pattern, and param heads are absent, so cast placement (in an operand, in an index result, inside a parenthetical) and the pattern-inside-param family are not yet expressible as cells at all — head curation is a prerequisite for ruling them, and until it happens a green Containment section understates what is dark. Grammar-bucket fixtures may satisfy claims rows as carriers; a claims fixture exists when no grammar charter can honestly hold the shape.

**Grammar credit** goes to `corpus/grammar/` fixtures alone: the gate counts reductions only from the grammar bucket, so neither an error fixture nor a claims fixture can cover a production even by accident — every production's home is a grammar fixture whose charter names it, and retirement checks reason about the grammar charters alone. The claims bucket has its own mirror standard: every `corpus/claims/` fixture must be a named carrier of at least one CLAIMS.md row, judged live by the gate.

**Retirement.** The legacy fixtures are retired — twins and pins with them, every ledger citation re-grounded on the new corpus. The gate's unique-contribution line is the standing instrument: a fixture it lists as removable contributes nothing the rest of the corpus lacks, and a healthy corpus reads "every fixture reduces at least one production no other fixture does."

The mapping census RISES throughout: every new fixture adds at-risk reads to a gauge that is red by design while the identifier-read finding stays open (see FINDINGS.md). Expected, and the point — the grown corpus is what makes that census meaningful when the fix lands. Nothing to fix here.

Depends on M2 (built), RULINGS.md — the components/schema files and their pinned negatives are gated on it — MANIFEST.md (the ownership decision record the gate joins against — claim lists stay live in the gate's own output, so nothing is regenerated), and CLAIMS.md, which owns the claims bucket's charter the way MANIFEST.md owns the grammar bucket's: a claims fixture cannot be authored before its row is ruled. Produces: the corpus — and M1, M4, and M5 see only constructs the corpus contains, so their completeness is bounded here.

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

## M6 — Rename to Audit, and the default surface

*Not started. Its precondition is met: the non-type lanes exist.*

The umbrella `type audit` collides with its own default member (also *Type Audit*) and undersells the five lanes that are not about types. Rename the family to **Audit** — `bun run type-audit` → `bun run audit`, `test/type-audit/` → `test/audit/`, plus the script, `FINDINGS.md`, and doc references. The default member keeps the name *Type Audit*.

**Bare, not an adjective.** The lanes share a METHOD, not a subject: each measures rip's own output against a reference rip did not author. Any subject-adjective misnames the majority, and re-misnames the family the next time a lane lands — *Editor Audit* fails on the count as badly as *type* does, since grammar, mapping, and type never speak to the editor server.

**`bun audit` is not a collision** (verified, bun 1.3.14): `bun run audit` reaches the script even though `audit` names a builtin, and bare `bun audit` stays Bun's dependency scanner. The residual is a mistype: this repo has a lockfile, so `bun audit` prints vulnerability output instead of failing — but the two outputs share nothing, so it cannot read as a scoreboard that ran. (The repo's own `test` script argues neither way: `bun test` and `bun run test` are near-aliases, differing only by a `--timeout` the suite does not need.) Prose spells it `the audit (bun run audit)` on first mention.

**The default runs every lane**, with `--type` for the fast loop and `--all` still accepted. Measured 2026-07-27, all six cost 21s — grammar 0.3s, mapping 0.2s, type 5.9s, diagnostics 4.2s, hover 11.7s, token 4.8s — and the type lane's clean run is contractual, so a type-only default prints an all-green screen while every lane that can carry news goes unrun. The two cheapest lanes are the two holding closed denominators.

**One flag per lane, named for its lane:** `--grammar`, `--map`, `--type`, `--diagnostics`, `--hover`, `--token`. `--errors` becomes `--diagnostics` — it names the corpus directory it reads rather than the lane, which asserts diagnostics by code and position; the plural is then principled, tracking a set per file against hover's and token's one answer per position. `--map` keeps its abbreviation: it names the source map, the artifact the lane audits. `--v` becomes `--verbose` with a `-v` alias, matching `--help`/`-h`. `--serial` is a mode, not a lane.

Depends on nothing outstanding — M1–M3 are built, and M4/M5 add surfaces to existing lanes rather than new nouns. Produces: a name that fits what the instrument became, a default that reports the whole instrument, and a flag per lane that names it.
