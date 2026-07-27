# Type audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`. Hover rulings: `RULINGS.md`.

## Built

Six lanes, each judged by a different reference so they can't all fail the same way.

| audit | flag | probes | judged against |
| --- | --- | --- | --- |
| Grammar Gate | `--grammar` | which productions the corpus reduces — carrying the type-vocabulary census, the negative-coverage contract, and the CLAIMS.md join | the parser's own rule list and TypeScript's own type grammar — closed denominators nobody here chose; parser only |
| Mapping Audit | `--map` | every source identifier maps to a generated position holding the same text | the compiler output alone — no server, no tsgo, no twin |
| Type Audit | *(default)* | five dimensions per fixture: compiles, verdict, runtime, twin, strict | the fixtures — suppression directives are refused in positives, so every one publishes zero diagnostics; directive CARRIAGE is gated in test/lang/tsface.test.js |
| Diagnostics Lane | `--diagnostics` | the corpus's negatives — every diagnostic asserted by code AND position | the line-aligned twin's own tsgo diagnostics, with `error-pins.json` for rows no honest twin can spell |
| Hover Audit | `--hover` | hover every top-level declaration through the editor server | the hand-written `.ts/.tsx` twin, falling back to `hover-pins.json` |
| Token Audit | `--token` | semantic token + modifiers on every top-level declaration | the `.rip` source itself — no twin, no baseline, cannot self-confirm |

## Complete — the corpus's exit condition

Each closed denominator has a bottom and stays there once drained. The AXIS LIST needs a bottom too, or every "what about X?" adds a census forever. It has one: every construct passes through the same pipeline — lex, parse, type-text, semantics, emit, run — so the stages are a closed list and coverage axes are stages.

**The charter: claims are tests, populations are the audit.** A test asserts one claim and must be GREEN; this instrument measures a POPULATION against a denominator and may be RED. Capability is not the line — `check.test.js` drives `rip check` over tsgo, and four `test/toolchain` suites drive the real LSP. What a test cannot hold is the answer's SHAPE: a census over a closed set is a report, and gating its number blesses a baseline while losing the actionable list; a red held by agreement is expressible only by asserting the wrong behavior as current, which inverts when the bug is fixed; and a ruled-uncarried row is neither pass nor fail. So a lone reproducible defect with a known-correct answer belongs in a test — this instrument's job is to FIND it, not hold it, which is why the empty program left for `check.test.js`.

**Complete means, for every stage:** its denominator is NAMED, or the absence of one is ruled with its replacing registry named; the denominator is DRAINED — every item exercised, parked behind an open FINDINGS row, or excluded by a ruled table; every registry row is CARRIED IN BOTH POLARITIES; and a gate FAILS IN BOTH DIRECTIONS when that stops holding. The last clause makes the others assertable: until the exit-code contract lands, nothing fails, so completion cannot be claimed.

**A census yields CANDIDATES, not obligations.** The suites partition by QUESTION: the battery owns behavior and emitted bytes, `test/lang` and `test/schema` own the face's TEXT, this corpus owns whether that face type-checks and answers. A spelling gated elsewhere can still be dark here, and only that gap is this program's — `::` is the worked example, its emission, declaration text, and eight decline classes already gated in [prototype.rip](../battery/prototype.rip), leaving the call sites and hover. Every queue row passes this triage before authoring, and records the verdict.

**The corpus retires.** The gate's unique-contribution line names any fixture the rest already covers, so completeness is not a ratchet.

| stage | denominator | state |
| --- | --- | --- |
| lexer spellings | the lexer's `ALIASES`/`KEYWORDS`/`STATEMENTS` tables read live, plus a mint list guarded against lexer drift | none built — a spelling the lexer normalizes (`and`, `is`, `on`, `::`) earns production credit it never proved; the battery gates these behaviorally, so the queue is candidates for the type question alone |
| parser productions | the parser's own rule list (`Parser().ruleNames`) | drained; remainder parked behind open findings |
| type sub-language | TypeScript's own type grammar, classified in-process by node kind | drained; remainder finding-held |
| checker semantics | none possible — CLAIMS.md's Behaviors is the registry | ruled rows outrun their carriers; the claims bucket is where they land |
| containment / context | none possible — the matrix is measured, CLAIMS.md's ruled cells are the contract | not closed: the matrix names only `CONSTRUCT_HEADS`, so cells it cannot express are invisible rather than red |
| schema body | none possible — `Schema → SCHEMA_BODY` is one production, sub-parsed at lexer-rewrite time, never reaching the type census | pins-or-nothing by architecture, under RULINGS.md; the face's TEXT is gated by `test/schema/schema-types.test.js`, so the checker's answers over it are what's dark |
| emission | the mapping census over the compiler's own rows | red by design while the identifier-read finding is open; the BYTES are gated outside, by `corpus-expected` and the mapping tests, which catch drift but not an emission already wrong when committed |
| runtime behavior | out of scope — the battery and runtime suites own it | the `runtime` dimension proves each fixture executes; behavioral coverage is not this charter |

A blank cell is the only incompleteness that counts. Numbers stay out: the gate prints them live, and a count copied here rots into a false certificate. And this is COVERAGE-complete, never correctness-complete — every spelling exercised and every ruled behavior carried, not every answer right. The second is unreachable, which is why the registry exists.

## M1 — Mapping audit

*Built.* `--map`. Walks every source identifier and checks it maps to a generated position holding the same text, from the compiler's own rows. Two invariants partition the failures: `placed` (the precise resolver refuses — a rewrite) and `text` (it resolves to the wrong bytes — the #21 hazard), each classified by the row it fell to and by root. It also proves each pass that no flagged read lacks a containing row. The census counts the AT-RISK population — reads with no exact row, larger than what misleads the editor today, since some resolve only by sitting at their cover's start.

The motivating case: `console.log total` is paren-less, so rip injects the parens and the face reads `console.log(total)`. The compiler emits one `args` row for the injected `(total)` and it round-trips EXACTLY — which is all `mapping.test.js` asserts. But `total` itself maps to that row's left edge, onto `(tota`, so hover there answers about `console.log`. The row is self-consistent and wrong, and no other lane visits that use site.

**Standalone by design.** No oracle, and none needed: the logic was validated against the real editor once (2026-07-17, driven) and the scaffolds removed rather than wired in. A change to the mapping internals it reads re-validates by recovering that drive from git. **Overlap, settled:** the Token Audit's `member` invariant is fully subsumed here; `survival` is root-subsumed but also checks the server DELIVERS a token, which M1 cannot see — when the mapping gap closes, both revert to guarding delivery.

Depends on nothing. Produces: use-site position coverage and the root classifier.

## M2 — Grammar gate

*Built.* `--grammar`. Parses the corpus with an instrumented Parser — Solar's generated module carries `ruleNames` and a `ctx.onReduce` hook — and reports which productions no fixture reduces, grouped by owning file (`--verbose` lists every one). The denominator is the parser's own rule list, so coverage is judged against a CLOSED set rather than a corpus-relative rate.

Coverage here is necessary, not sufficient: production counting is context-free and cannot distinguish switch-in-render from switch-anywhere, so interaction shapes are measured by the containment matrix this same gate builds from the parse trees, joined against CLAIMS.md's ruled cells.

Depends on nothing. Produces: the coverage number and the uncovered-rule list M3 consumes.

## M3 — Corpus rewrite

*The grammar bucket is authored: `01-basics` through `14-schema`, twin and error-lane pair each. The twelve legacy fixtures are retired. The remainder is the claims bucket, born empty and authored to CLAIMS.md's ruled rows. Productions a positive fixture cannot yet carry are parked in MANIFEST.md, each row held by an open FINDINGS.md row; spellings no fixture can or should ever reduce are excluded from the denominator by the gate's own table in runner.js.*

Not additive growth: a REWRITE, executed as a strangler migration. The corpus splits by charter — `corpus/grammar/` fixtures justified by the closed denominators, `corpus/claims/` fixtures by CLAIMS.md rows — each bucket held to its own retirement standard by the gate. The claims bucket numbers independently from 01; basenames stay unique corpus-wide, since twins, pins, and carriers all key on them.

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

**Authoring.** Files go out in parallel waves, each authored in an isolated worktree against its MANIFEST.md allocation, adversarially reviewed, then integrated and verified by gate arithmetic: coverage must rise by exactly the sum of the wave's claims, and a still-dark production names the file that missed it. Rulings-gated, pin-heavy files stay SEQUENTIAL, where independent interpretation costs most. The dependency ladder is a tiebreaker, not a law — charter-boundary calls are settled in MANIFEST.md, never per-author. Every coverage claim goes through the gate: **verified, never asserted.** Density follows starvation — grammar-dark families get minimal-honest coverage, shape-starved ones (components, schema) get dense, real-shaped content. **The register:** explicit call parens by default (the implicit spelling stays covered densely in `02-operations`), single quotes unless interpolation forces double, padded braces on inline object and type literals in both pair members, negatives in the family's error fixture and never inline.

**Oracles.** Hand-written twins, written WITH the fixture, for 01, 02, 06, 08, 09, 10, 11, and 12 — the reactive twin is plain TS (`:=` → `let`, `~=`/`=!` → `const`), honest because the editor's ruled answers are value types; where a write re-fires an effect the twin hand-replays the flush, so runtime parity there asserts a predicted trace. Analogy twins for `13-components` (TSX) and `14-schema` (zod), scoped to where the analogy is honest. Positive twins are STANDARD-TS-formatted, never line-parity with the `.rip`: correspondence is by construct order and symbol name, the fixture is never edited for the twin's sake, and the twin running longer is desired. Error pairs stay strictly line-aligned, because the Diagnostics Lane derives positions from them. Everything rip-native is pinned per RULINGS.md. Twins beyond the subset are M5's budget.

**Negatives.** A negative test is an unsuppressed program plus an asserted diagnostic — TypeScript's own model.

- **The pair.** Each family file pairs with an unsuppressed `corpus/errors/NN-family.errors.rip` beside its twin, LINE-ALIGNED, with an `@ts-nocheck` pragma pair that is lane-stripped and lane-enforced. A blank line separates setup from the `wrong*` variables; names are full words in both members (`wrongArgument`, never `wrongArg`).
- **Asserted, and derived.** Every diagnostic's code AND position, derived from tsgo's run over the twin — never hand-authored where a twin can judge. The lane structurally owns what no other check can reach: columns, the emitter's decline classes, and negatives that would crash the runtime dimension.
- **Positives are error-free absolutely.** Zero published diagnostics, no marker accounting, no `@ts-expect-error`. The directive stays in rip on its own merits, gated by `check.test.js` and the editor suite, but the corpus does not depend on it.
- **Rip-native negatives are pinned**, exactly where no twin can judge: components and schema, code and position, under the hover-pins discipline and gated on RULINGS.md. Reactive is HYBRID — twin-judgeable rows stay derived, and only the lowering's extra diagnostics (the `:=`/`~=` second publish) carry pins in `error-pins.json`.
- **Outside the walk.** `corpus/errors/` sits outside the shared fixture walk, twice necessary: verdict demands zero unsuppressed errors, and error fixtures must not earn grammar credit.
- **Falsifiability is contractual.** Every type-vocabulary class the positives use must carry an error-lane instance, or it paints red. The vocabulary is TypeScript's own type grammar, classified in-process each run by TS type-AST node kind — a closed taxonomy, never curated, never stale. The census closes the positive side on the same denominator: an unclaimed kind sits in a visible queue until claimed or ruled out through the exclusion table, so a kind nobody thought of is still a queue item.

**Type sub-language boundaries** (probed 2026-07-24, one rip probe per unclaimed kind through compile-to-face). Excluded by design, with the lexer's own errors as reasons: template-literal types (the backtick is rip's token) and construct signatures (`(new () => T)` is the surviving spelling). Finding-held rather than excluded: mapped types (the rejection is the type-body validator's code-expression check firing on TS's `in`, not a ruling), `import(…)` types (a `.rip` specifier does not resolve in type position, a `.ts` one does), and inline method signatures (the indented spelling claims the kind). Position-constrained but expressible: constructor and abstract-construct types only inside parentheses in an annotation or after `as`, `this`-types only as a class method's return annotation, type predicates only as a def's return annotation (in a type body, `value is string` collides with rip's `is`). Census-queue authoring uses the surviving spellings; both member layouts reach the census, because the gate classifies through the compiler's own `renderTypeDecl` rather than rip's source text. The `.ts` seam is verified both polarities: an exotic alias imports into rip by NAME, and a wrong assignment draws TS2322 spelled in the exotic type, positioned on the rip line.

**No exit-code contract yet — deliberately deferred.** The runner exits non-zero only on STRUCTURAL refusals (bad argv, a malformed manifest, a suppression directive in a positive, a moved TypeScript surface, a probe pass that missed the corpus). Its own findings print red and exit 0, and the runner sits outside `test` and `test:all`, so the audits are read by a person. Wiring a CI gate is not a flag: several reds are permanent by agreement, so a build failing on any red fails forever. It needs the expected-red set declared where the runner joins it live (the `error-pins.json` pattern — prose `why`, never a row's number), gating contractual invariants while gauges stay informational, and failing in BOTH directions, since fewer reds than declared means a finding closed and its row needs retiring.

**The claims bucket** carries what no syntactic denominator reaches, and it is where the remaining authoring lives. Both classes are ruled into CLAIMS.md before a fixture exists: CHECKER BEHAVIORS (narrowing, inference enforcement, the component consumer face, schema projection), and CONTAINMENT cells. Interaction coverage is this bucket's charter — a cross-context shape becomes a ruled cell checked against the containment matrix, so a missing interaction paints red as data rather than sitting in prose as a to-do. The matrix reaches only the constructs `CONSTRUCT_HEADS` names: cast, pattern, and param heads are absent, so cast placement and the pattern-inside-param family are not yet expressible as cells, and head curation is a prerequisite for ruling them. Grammar-bucket fixtures may serve as carriers; a claims fixture exists when no grammar charter can honestly hold the shape.

**Grammar credit** goes to `corpus/grammar/` fixtures alone, so neither an error nor a claims fixture can cover a production by accident, and retirement reasons about the grammar charters only. The claims bucket's mirror standard: every `corpus/claims/` fixture must be a named carrier of at least one CLAIMS.md row, judged live.

**Retirement.** The legacy fixtures are retired, twins and pins with them, every ledger citation re-grounded. The unique-contribution line is the standing instrument: a healthy corpus reads "every fixture reduces at least one production no other fixture does."

Depends on M2 (built), RULINGS.md (the components/schema files and their pinned negatives are gated on it), MANIFEST.md (the grammar bucket's ownership record, joined live), and CLAIMS.md (the claims bucket's, where a row must be ruled before its fixture is authored). Produces: the corpus — and M1, M4, and M5 see only what the corpus contains, so their completeness is bounded here.

## M4 — Spelling-invariance

*Not built; hover and definition driven.*

Same program, two spellings, same LSP answers: `console.log total` and `console.log(total)` must hover, go-to-def, and complete identically. Reaches the LSP surfaces M1 never drives, because it asks the server — but needs no oracle, since the two spellings check each other. Driven on the #21 pair, where hovering `total` in the paren-less form answers about `console.log` and go-to-def lands in `lib.dom.d.ts`; a whitespace-only respelling holds, so the check isn't trivially red.

Depends on the server; benefits from M3. Produces: surface coverage across the LSP entry points, no twins written.

## M5 — Content oracles (#22)

*Not started.*

Hover CONTENT at use sites, completion, signature help — what M4 cannot reach by symmetry alone, checked against hand-written twins.

Depends on the server + new twins. Produces: the content-level checks #22 asks for.

## M6 — Rename to Audit, and the default surface

*Not started. Its precondition is met: the non-type lanes exist.*

The umbrella `type audit` collides with its own default member (also *Type Audit*) and undersells the five lanes that are not about types. Rename the family to **Audit** — `bun run audit` → `bun run audit`, `test/audit/` → `test/audit/`, plus the script and doc references. The default member keeps the name *Type Audit*.

**Bare, not an adjective.** The lanes share a METHOD, not a subject: each measures rip's output against a reference rip did not author. Any subject-adjective misnames the majority and re-misnames the family the next time a lane lands — *Editor Audit* fails on the count as badly as *type* does, since grammar, mapping, and type never speak to the editor server.

**`bun audit` is not a collision** (verified, bun 1.3.14): `bun run audit` reaches the script even though `audit` names a builtin, and bare `bun audit` stays Bun's dependency scanner. The residual is a mistype: this repo has a lockfile, so `bun audit` prints vulnerability output instead of failing — but the two outputs share nothing, so it cannot read as a scoreboard that ran. Prose spells it `the audit (bun run audit)` on first mention.

**The default runs every lane**, with `--type` for the fast loop and `--all` still accepted. Measured 2026-07-27, all six cost 21s — grammar 0.3s, mapping 0.2s, type 5.9s, diagnostics 4.2s, hover 11.7s, token 4.8s — and the type lane's clean run is contractual, so a type-only default prints an all-green screen while every lane that can carry news goes unrun.

**One flag per lane, named for its lane:** `--grammar`, `--map`, `--type`, `--diagnostics`, `--hover`, `--token`. `--errors` becomes `--diagnostics` — it named the corpus directory rather than the lane, which asserts diagnostics by code and position; the plural is then principled, tracking a set per file against hover's and token's one answer per position. `--map` keeps its abbreviation: it names the source map, the artifact the lane audits. `--v` becomes `--verbose` with a `-v` alias. `--serial` is a mode, not a lane.

Depends on nothing outstanding — M1–M3 are built, and M4/M5 add surfaces to existing lanes rather than new nouns. Produces: a name that fits what the instrument became, a default that reports the whole instrument, and a flag per lane that names it.
