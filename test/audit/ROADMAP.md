# Audit — roadmap

Internal build plan for the instrument. Runner: `runner.js`. Findings: `FINDINGS.md`. Hover rulings: `RULINGS.md`.

## Built

Six lanes, each judged by a different reference so they can't all fail the same way. `bun run audit` with no flag runs every one; a lane's own flag narrows the run to it.

| audit | flag | probes | judged against |
| --- | --- | --- | --- |
| Grammar Gate | `--grammar` | which productions the corpus reduces — carrying the lexer-spelling and type-vocabulary censuses, the negative-coverage contract, and the CLAIMS.md join | the parser's own rule list and TypeScript's own type grammar — closed denominators nobody here chose; parser only |
| Mapping Audit | `--map` | every source identifier maps to a generated position holding the same text | the compiler output alone — no server, no tsgo, no twin |
| Type Audit | `--type` | five dimensions per fixture: compiles, verdict, runtime, twin, strict | the fixtures — suppression directives are refused in positives, so every one publishes zero diagnostics; directive CARRIAGE is gated in test/lang/tsface.test.js |
| Diagnostics Lane | `--diagnostics` | the corpus's negatives — every diagnostic asserted by code AND position | the line-aligned twin's own tsgo diagnostics, with `error-pins.json` for rows no honest twin can spell |
| Hover Audit | `--hover` | hover every top-level declaration through the editor server | the hand-written `.ts/.tsx` twin, falling back to `hover-pins.json` |
| Token Audit | `--token` | semantic token + modifiers on every top-level declaration | the `.rip` source itself — no twin, no baseline, cannot self-confirm |

## Complete — the corpus's exit condition

Each closed denominator has a bottom and stays there once drained. The AXIS LIST needs a bottom too, or every "what about X?" adds a census forever. It has one: every construct passes through the same pipeline — lex, parse, type-text, semantics, emit, run — so the stages are a closed list and coverage axes are stages.

**The charter: claims are tests, populations are the audit.** A test asserts one claim and must be GREEN; this instrument measures a POPULATION against a denominator and may be RED. Capability is not the line — `check.test.js` drives `rip check` over tsgo, and four `test/toolchain` suites drive the real LSP. What a test cannot hold is the answer's SHAPE: a census over a closed set is a report, and gating its number blesses a baseline while losing the actionable list; a red held by agreement is expressible only by asserting the wrong behavior as current, which inverts when the bug is fixed; and a ruled-uncarried row is neither pass nor fail. So a lone reproducible defect with a known-correct answer belongs in a test — this instrument's job is to FIND it, not hold it, which is why the empty program left for `check.test.js`.

**Complete means, for every stage:** its denominator is NAMED, or the absence of one is ruled with its replacing registry named; the denominator is DRAINED — every item exercised, parked behind an open FINDINGS row, or excluded by a ruled table; every registry row is CARRIED IN BOTH POLARITIES; and a gate FAILS IN BOTH DIRECTIONS when that stops holding. The last clause is what makes the others assertable, and it is what the exit-code contract provides.

**A census yields CANDIDATES, not obligations.** The suites partition by QUESTION: the battery owns behavior and emitted bytes, `test/lang` and `test/schema` own the face's TEXT, this corpus owns whether that face type-checks and answers. A spelling gated elsewhere can still be dark here, and only that gap is this program's — `::` is the worked example, its emission, declaration text, and eight decline classes already gated in [prototype.rip](../battery/prototype.rip), leaving the call sites and hover. Every queue row passes this triage before authoring, and records the verdict.

**The corpus retires.** The gate's unique-contribution line names any fixture the rest already covers, so completeness is not a ratchet.

| stage | denominator | state |
| --- | --- | --- |
| lexer spellings | the lexer's own alias table, read live, plus a curated mint list each guarded by a probe that must still produce it | built — an alias whose emitted value differs from the word typed is a spelling the parser cannot distinguish, so it earns production credit it never proved; the queue is a gauge, and the battery gates these behaviorally, so a row earns a fixture only where the type question is distinct. Spellings whose tokens are byte-identical to a spelling the productions already cover are netted out by ruling, policed both ways: excluded-but-written and excluded-but-no-longer-rewritten each paint red |
| parser productions | the parser's own rule list (`Parser().ruleNames`) | drained; remainder parked behind open findings |
| type sub-language | TypeScript's own type grammar, classified in-process by node kind | drained; remainder finding-held |
| checker semantics | none possible — CLAIMS.md's Behaviors is the registry | ruled rows outrun their carriers; the claims bucket is where they land |
| containment / context | none possible — the matrix is measured, CLAIMS.md's ruled cells are the contract | the head table bounds what a cell can name, and it is policed: a curated head no fixture spells paints red, since a cell naming it could never be satisfied. What it omits is ruled — data heads sit under nearly every construct, so their cells would be satisfied by accident rather than by a chosen shape |
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

Coverage here is necessary, not sufficient, and the gate carries the two censuses that say why. BELOW the productions: a feature the lexer implements by rewriting bytes into existing tokens earns production credit it never proved — `a and b` reduces the same rule as `a && b`, and `A::m` mints three tokens over two bytes to reduce ordinary property rules. The denominator is the lexer's own alias table read live, plus curated scanner mints, each guarded by a probe that must still produce it rather than by a hash that would churn. ABOVE them: production counting is context-free and cannot distinguish switch-in-render from switch-anywhere, so interaction shapes are measured by the containment matrix this gate builds from the parse trees, joined against CLAIMS.md's ruled cells.

Depends on nothing. Produces: the coverage number and the uncovered-rule list M3 consumes.

## M3 — Corpus rewrite

*The grammar bucket is authored: `01-basics` through `14-schema`, twin and error-lane pair each. The twelve legacy fixtures are retired. The remainder is the claims bucket, born empty and authored to CLAIMS.md's ruled rows. Productions a positive fixture cannot yet carry are parked in MANIFEST.md, each row held by an open FINDINGS.md row; spellings no fixture can or should ever reduce are excluded from the denominator by the gate's own table in runner.js.*

Not additive growth: a REWRITE, executed as a strangler migration. The corpus splits by charter — `corpus/grammar/` fixtures justified by the closed denominators, `corpus/claims/` fixtures by CLAIMS.md rows — each bucket held to its own retirement standard by the gate. The grammar bucket numbers from 01 and the claims bucket from 20, so the prefix itself says which charter a fixture answers to and the two never collide in `corpus/errors/`, where both buckets' pairs share one directory. Basenames stay unique corpus-wide either way — twins, pins, and carriers all key on them.

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

**Comments.** One convention, every file in every bucket. A comment is never a reflowed paragraph: **no sentence spans two lines**, however long the line. A **header** is one line — the file's name and what it covers in a phrase; the charter table above owns the per-file detail, so a header that enumerates its own sections is duplication, which is how one reached eighteen lines. A **section divider** is `# ── … ──`, opening and closing on its own line. A **note** is one line at the shape it concerns, and exists for exactly one reason: the construct is written oddly, or is absent, because of an open defect — the one thing a reader cannot reconstruct from the code, and the thing a cleanup would otherwise undo. Parked absences carry a note on their nearest divider. **Twins** mirror the .rip's dividers so the pair reads side by side; an error pair's two sides change header length together or the line alignment breaks. Enforced by `corpus.dividers` — a divider that wraps is red, and the fix is always joining the lines. Header length is a **gauge** beside it, never a gate: any cap would be a threshold with no denominator, and satisfying a tripped one means deleting prose, which points authors at exactly the notes worth keeping.

**Authoring.** Files go out in parallel waves, each authored in an isolated worktree against its MANIFEST.md allocation, adversarially reviewed, then integrated and verified by gate arithmetic: coverage must rise by exactly the sum of the wave's claims, and a still-dark production names the file that missed it. Rulings-gated, pin-heavy files stay SEQUENTIAL, where independent interpretation costs most. The dependency ladder is a tiebreaker, not a law — charter-boundary calls are settled in MANIFEST.md, never per-author. Every coverage claim goes through the gate: **verified, never asserted.** Density follows starvation — grammar-dark families get minimal-honest coverage, shape-starved ones (components, schema) get dense, real-shaped content. **The register:** explicit call parens by default (the implicit spelling stays covered densely in `02-operations`), single quotes unless interpolation forces double, padded braces on inline object and type literals in both pair members, negatives in the family's error fixture and never inline.

**Oracles.** Hand-written twins, written WITH the fixture, for 01, 02, 06, 08, 09, 10, 11, and 12 — the reactive twin is plain TS (`:=` → `let`, `~=`/`=!` → `const`), honest because the editor's ruled answers are value types; where a write re-fires an effect the twin hand-replays the flush, so runtime parity there asserts a predicted trace. Analogy twins for `13-components` (TSX) and `14-schema` (zod), scoped to where the analogy is honest. Positive twins are STANDARD-TS-formatted, never line-parity with the `.rip`: correspondence is by construct order and symbol name, the fixture is never edited for the twin's sake, and the twin running longer is desired. Error pairs stay strictly line-aligned, because the Diagnostics Lane derives positions from them. Everything rip-native is pinned per RULINGS.md. Twins beyond the subset are M5's budget.

**Negatives.** A negative test is an unsuppressed program plus an asserted diagnostic — TypeScript's own model.

- **The pair.** Each family file pairs with an unsuppressed `corpus/errors/NN-family.errors.rip` beside its twin, LINE-ALIGNED, with an `@ts-nocheck` pragma pair that is lane-stripped and lane-enforced. A blank line separates setup from the `wrong*` variables; names are full words in both members (`wrongArgument`, never `wrongArg`).
- **Asserted, and derived.** Every diagnostic's code AND position, derived from tsgo's run over the twin — never hand-authored where a twin can judge. The lane structurally owns what no other check can reach: columns, the emitter's decline classes, and negatives that would crash the runtime dimension.
- **Positives are error-free absolutely.** Zero published diagnostics, no marker accounting, no `@ts-expect-error`. The directive stays in rip on its own merits, gated by `check.test.js` and the editor suite, but the corpus does not depend on it.
- **Rip-native negatives are pinned**, exactly where no twin can judge: components and schema, code and position, under the hover-pins discipline and gated on RULINGS.md. Reactive is HYBRID — twin-judgeable rows stay derived, and only the lowering's extra diagnostics (the `:=`/`~=` second publish) carry pins in `error-pins.json`.
- **Outside the walk.** `corpus/errors/` sits outside the shared fixture walk, twice necessary: verdict demands zero unsuppressed errors, and error fixtures must not earn grammar credit.
- **Falsifiability is contractual.** Every type-vocabulary class the positives use must carry an error-lane instance, or it paints red. The vocabulary is TypeScript's own type grammar, classified in-process each run by TS type-AST node kind — a closed taxonomy, never curated, never stale. The census closes the positive side on the same denominator: an unclaimed kind sits in a visible queue until claimed or ruled out through the exclusion table, so a kind nobody thought of is still a queue item.

**Type sub-language boundaries** (probed 2026-07-24, one rip probe per unclaimed kind through compile-to-face). Excluded by design, with the lexer's own errors as reasons: template-literal types (the backtick is rip's token) and construct signatures (`(new () => T)` is the surviving spelling). Finding-held rather than excluded: mapped types (the type-body validator's code-expression check fires on TS's `in`; the ANNOTATION spelling compiles and classifies, so the census row is drainable today and the rejection is scoped to declaration bodies), `import(…)` types (a `.rip` specifier does not resolve in type position, a `.ts` one does), and inline method signatures (the indented spelling claims the kind). Position-constrained but expressible: constructor and abstract-construct types only inside parentheses in an annotation or after `as`, `this`-types only as a class method's return annotation, type predicates in any annotation position — a typed binding, a nested object type, a def's return — but not in a `type`/`interface` body, where rip's `is`→`==` rewrite corrupts them (and, through the declaration path, ships the corruption). Census-queue authoring uses the surviving spellings; both member layouts reach the census, because the gate classifies through the compiler's own `renderTypeDecl` rather than rip's source text. The `.ts` seam is verified both polarities: an exotic alias imports into rip by NAME, and a wrong assignment draws TS2322 spelled in the exotic type, positioned on the rip line.

**The exit-code contract** ([contract.js](contract.js)). Beyond the STRUCTURAL refusals (bad argv, a malformed manifest, a suppression directive in a positive, a moved TypeScript surface, a probe pass that missed the corpus), the run now judges its own findings. Each INVARIANT — a property that holds or else something broke — is stated as the property and read off its lane's summary; a lane that did not run leaves its invariants unjudged rather than assumed green. GAUGES gate nothing, which is the whole reason a contract was needed: uncovered productions, the census queue, ruled-uncarried claims, the mapping census, the token member and use-site clauses are all expected non-zero, and a gate over them would fail forever. An invariant the toolchain currently fails carries a `redBecause` field on the invariant itself — a PROSE reason, never a row's number, which would dangle the day the row closes. Keeping the declaration ON the thing it describes is why a reason can never name an invariant that does not exist.

The check runs in BOTH directions: an undeclared red is a regression, and a DECLARED red that has gone green fails too, because the defect is fixed and its declaration would now mask the next break in the same invariant. That second direction is what a one-directional baseline swallows. No declaration carries a count — it says THAT an invariant is red, never by how much, so corpus growth never churns the file, and the lane's own line reports magnitude.

The audit stays a STANDALONE script, outside `test` and `test:all`, and CI will gate it when it is wired. Until something watches the exit code, an exit code can stop working silently, so the judgment itself is gated at unit speed by `test/toolchain/audit-contract.test.js`: both directions, one-predicate-per-invariant reachability, a lane that did not run never assumed green, and a refusal when a tolerated red cites a ledger row by number instead of stating its reason.

**The claims bucket** carries what no syntactic denominator reaches, and it is where the remaining authoring lives. Both classes are ruled into CLAIMS.md before a fixture exists: CHECKER BEHAVIORS (narrowing, inference enforcement, the component consumer face, schema projection), and CONTAINMENT cells. Interaction coverage is this bucket's charter — a cross-context shape becomes a ruled cell checked against the containment matrix, so a missing interaction paints red as data rather than sitting in prose as a to-do. The matrix reaches only the constructs `CONSTRUCT_HEADS` names: cast, pattern, and param heads are absent, so cast placement and the pattern-inside-param family are not yet expressible as cells, and head curation is a prerequisite for ruling them. Grammar-bucket fixtures may serve as carriers; a claims fixture exists when no grammar charter can honestly hold the shape.

**Grammar credit** goes to `corpus/grammar/` fixtures alone, so neither an error nor a claims fixture can cover a production by accident, and retirement reasons about the grammar charters only. The claims bucket's mirror standard: every `corpus/claims/` fixture must be a named carrier of at least one CLAIMS.md row, judged live.

**Retirement.** The legacy fixtures are retired, twins and pins with them, every ledger citation re-grounded. The unique-contribution line is the standing instrument: a healthy corpus counts every fixture as reducing a production no other does, and any that do not are named as removable at zero coverage loss.

Depends on M2 (built), RULINGS.md (the components/schema files and their pinned negatives are gated on it), MANIFEST.md (the grammar bucket's ownership record, joined live), and CLAIMS.md (the claims bucket's, where a row must be ruled before its fixture is authored). Produces: the corpus — and M1, M4, and M5 see only what the corpus contains, so their completeness is bounded here.

## M4 — Spelling-invariance

*Not built; hover and definition driven.*

Same program, two spellings, same LSP answers: `console.log total` and `console.log(total)` must hover, go-to-def, and complete identically. Reaches the LSP surfaces M1 never drives, because it asks the server — but needs no oracle, since the two spellings check each other. Driven on the #21 pair, where hovering `total` in the paren-less form answers about `console.log` and go-to-def lands in `lib.dom.d.ts`; a whitespace-only respelling holds, so the check isn't trivially red.

Depends on the server; benefits from M3. Produces: surface coverage across the LSP entry points, no twins written.

## M5 — Content oracles (#22)

*Not started.*

Hover CONTENT at use sites, completion, signature help — what M4 cannot reach by symmetry alone, checked against hand-written twins.

Depends on the server + new twins. Produces: the content-level checks #22 asks for.
