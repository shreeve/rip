# Campaign plan — drive the findings road to empty

Working doc for the `close-findings` campaign. Scope: every open row in [FINDINGS.md](FINDINGS.md) except #21, which stays with its own session. The ledger stays the truth about each finding — this plan only sequences the work, records the decisions the rows said someone had to make, and sets the execution protocol.

## Settled decisions

Work proceeds on these per "recommend and proceed" — Steve reviews working code plus rationale, and any of these can be reverted by his ruling. The register spellings (#36, #44) go to him as proposals in [RULINGS.md](RULINGS.md)'s open rows; they are not written there unilaterally.

- **#36 — the cell is the cross-module API.** Importers consume `count.value` explicitly. Remaining work is governing the bare read and documenting `.value` as the contract; no import-aware deref pass. Presented to Steve as the recommended Reactive ruling with the mechanism evidence (`collectReactiveNames` scoping, `__primitiveCoercion`'s beneficiary).
- **#46 — admit mapped types.** The validator admits `in` between `[` and `]` inside a type body — the only position TS grammar puts it; excluding would remove a capability v3 shipped.
- **#43 — the inference road.** `ReturnType<typeof …>` over an emitted behavior object, v3's demonstrated shape. Known limit accepted: closes the in-project surface; the consumer `.d.ts` stays `unknown`, as v3's did.
- **#23/#41 — spike first, then adopt.** A bounded spike settles the strip gate and scope-resolution unknowns. Both clear → adopt the in-face declaration, retire the Tier 3 pin probe, and #41 dissolves. Either fails → the probe stays, #41 gets the filter clause (self-referential answers cache null), and #23 closes by ruling the alternative out.
- **#44 — propose `MixinSchema<Stamped>`.** A dedicated kind-specific interface carrying only what a mixin honestly offers, no parse surface — `Schema<Stamped, Stamped>` would promise a parse surface the runtime refuses. The final spelling is Steve's call via RULINGS.md's open Schema row; the cast mechanism is planned regardless.
- **#42 — the default half only.** Type the descriptor's `default?: T`; the transform half stays ruled out on the settled `it: any` ground and remains an honest runtime-only check.
- **#22 — error-tolerant parser now.** The general fix, not v3's per-trigger fixups: a parser that recovers where TypeScript's does, serving completion and signature help (and every future incomplete-expression surface) at once. The campaign's largest single work item.
- **Residue policy — no new rows.** Closing is subtractive: an accepted limit (#43's consumer surface, #42's transform half) is recorded in the row's closing line and, where a register row exists, in the RULINGS proposal — not filed as a fresh open row. If #22's recovery work turns out to need staging, the row simply stays open until both surfaces are served rather than splitting.

## Standing constraints

- A row closes only when its named gate runs green — author or invert the gate first and **watch it fail against the unfixed compiler**, then fix, then watch it pass. A gate that has never been red proves nothing about the fix that greened it.
- Interim gates that assert the wrong behavior **as the gap** go red when the fix lands; that red is the cue to invert the gate and move spellings into the corpus (and out of MANIFEST.md's Parked table where applicable) in the same change.
- The contract's red-by-agreement invariants are **per-cause** (`diagnostics.positions.element` for #50; `token.type.enum` for #33; `token.type.void` for #57; `token.readonly` for #37; `mapping.census` for #21's residue), so each row recovers on its own fixture evidence. A row's exit is its fixture reporting zero violations plus its own reason clause deleted from `contract.js` in the same change — the contract's recovery signal fails if a satisfied reason is left standing.
- Corpus style: explicit parens + single quotes for fixtures and examples, both spellings covered where a row's trigger is the quote.
- Corpus comments state what no instrument can — never the lowering the twin already states, never a byte pin restated, never the defect a closing row just removed. A property a later author could quietly break belongs in the battery as a pin, not in prose. Full rule in [ROADMAP.md](ROADMAP.md)'s Authoring paragraph, which governs.
- Editor-path changes are not live until `bun run install-vscode` from `packages/vscode/`; Philip reloads the window.
- No commits, pushes, or PRs without Philip explicitly saying so; work lands in the tree and is reported.
- v3 (`~/Code/shreeve/rip-lang`, 3.17.5) stays available for re-drives; remember its probe hazards — `hasTypes` gates tokens/`@ts-nocheck`, so any v3 probe must carry a type annotation.
- FINDINGS.md close protocol: body deleted, one line added to Closed naming the gate. Parallel-session hazard: the #21 session edits the same file, so coordinate merges.

## Execution protocol

Optimized for closing all 36 rows quickly, without giving up the gate discipline that makes a close real.

- **Two concurrent tracks from the start.** The main track works the phases in order. A background track runs the #23 spike in a worktree immediately — its verdict shapes Phase E (#41, #52) and is ready long before the main track arrives there.
- **Fan out inside a batch where rows are file-independent; inline where they collide.** B3's emitter independents and Phase D's server items are separable enough to hand one row per worktree agent (fix + gate flip each), merged and suite-run centrally. B1 (one lexer function cluster), B2 (one walk), and everything in C, E, and F stays inline — collision cost or design weight makes delegation a false economy there.
- **Verification is a workflow, not a self-check.** At each batch close, a small verify workflow (one skeptic agent per row, under the session's agent guideline) independently re-drives every gate: red on the pre-fix baseline worktree, green on the post-fix tree. A fix whose gate a skeptic can't drive red does not close its row.
- **Checkpoint after each batch.** Land the batch in the working tree, run the batch's gates plus `bun run test:all`, report what flipped red → green with the verify workflow's evidence, and wait for Philip's go-ahead before the next batch.
- **Baseline before each batch:** `bun run test:all` green, `bun run audit` output captured for before/after comparison.
- FINDINGS.md edits happen centrally at batch close, never mid-fix, to keep the #21 merge surface small.
- **Model allocation.** The campaign runs on Opus end to end: the main session (orchestration, merging, FINDINGS.md edits, inline fixes) and every delegated agent (fan-out fix agents, verify skeptics, the spike's driving). Fable is reserved for exactly two moments: the #22 error-tolerant-parser design pass, and the #23 spike's adopt-or-rule verdict once the Opus-driven evidence is in.
- **The long tail is design, not row count.** Phases A–E hold 30 rows of bounded work and should drain fast under this model; Phase F's four items (#13, #8, #22, #36) are the calendar, #22 above all, and no amount of fan-out compresses a design pass. Expect the board to shrink quickly and then narrow to those four.

## Phase A — #58 alone

One line, first, because it reaches shipped code: medlabs carries two occurrences, and a classed SVG makes the whole module unparseable, so every other diagnostic in that file is unreachable behind it. Branch the static class-attribute walk's close on `isSvg`, mirroring the reactive branch ten lines above (`this.b.emit(isSvg ? '));' : ');')`). Gate: the classed-SVG spelling enters 13-components under `compiles` + `runtime`.

## Phase B — mechanical compiler and lexer fixes

Fifteen rows with prescribed, bounded fixes and named gate inversions, batched by the file they touch.

### B1 — the lexer's type-run and validator (`lexer.js`)

1. **#46** — validator admits `in` between `[` and `]` in a type body. Gate: `MappedType` claimed in 11-types with a contract negative alongside; census queue row drains.
2. **#48** — validator admits a name followed by a parameter list inside an inline type body (C2's admission reaching the inline literal). Gate: inline spelling enters 11-types under `compiles`.
3. **#45 + #59** — scope the `is`→`==` rewrite so it never reaches type text (one fix, two symptoms). Explicitly not a validator carve-out — that would close the loud symptom and leave #59's silent one standing — and not a `tidyType` un-rewrite. **Both paths must be verified in one drive:** the annotation path already renders `is` correctly, so a fix verified only there proves nothing about the path that ships `==`. Gates: the type-body predicate compiles; the predicate spelling enters `dts-tsc.test.js`'s fixture where the consumer compile would fail on `==`. Re-drive the census probe after the lexer change per #45's boundaries note.
4. **#28** — add `CATCH` to `CAST_STOPS`. Clause-keyword group only; `|`/`&` stay out — they carry union and intersection types. Gate: unparenthesized spelling enters 07-exceptions under `compiles` + `verdict`.

### B2 — the new-spine walk (`emitter.js`)

5. **#29** — parenthesize the spine when it carries `?.` (`new (Registry?.Box)()`). Gate: spelling enters 09-classes (`compiles`/`runtime`/`verdict`); Parked row cleared.
6. **#30** — add the tagged-template case to the walk, copied from the ordinary expression path where the correct lowering already exists. Gate: spelling enters 09-classes; Parked row cleared.

### B3 — independent emitter fixes

7. **#26** — make the match spine null-clean inside its own lowering (both `=~` and regex-index). Not by softening `toMatchable`'s signature (v3's lie) and not via null-strictness. Gate: `check`'s match-operator case flips → invert it; both spellings enter 02-operations under `verdict`; Parked rows cleared.
8. **#27** — mint the catch annotation on the pattern branch alone (`catch (_err: any)` or a scoped cast). The identifier spelling's `unknown` stays — it is honest and the user can govern it. Gate: `check`'s pattern-catch case flips → invert; both pattern spellings enter 07-exceptions; Parked rows cleared.
9. **#31** — the check mirror declares the field a promoted `@`-param implies, with the dedupe `dts.js`'s constructor branch already models. The dedupe is load-bearing: 08-functions carries the both-spellings shape, and an unconditional declaration draws TS2300 and turns a green fixture red. Gate: `check`'s promoted-param case flips → invert; field-less spelling enters 08-functions.
10. **#32** — reject reassignment of an exported plain binding loudly (the for-range ban is the model). Not a writable export — const is the emitter's own asserted design, so that is a language change and Steve's call. Gate: the reassignment becomes an asserted compile error; 10-modules keeps the never-reassigned form.
11. **#57** — void-marked bindings emit one initialized declaration (`let report = function(): void { … }`), not a split. Gate: the `token.type.void` invariant recovers — delete its reason clause with the fix. Also re-drive the declaration hover, which currently passes only because 04-assignments carries a later call that `enrichEvolvingAnyHover` re-serves.
12. **#35** — drop the redundant `satisfies` guard so a wrong `:=`/`~=` initializer publishes once, in value vocabulary. Gate: the 12-reactive error pins flip red → retire them. **The gate's scope is the count, not the prose:** no instrument asserts message text, so the body's prose claim must be re-driven by hand before the row closes.

13. **#50** — narrow the rewritten literal's mapping row to the offending literal so a neighbour's diagnostic no longer widens to the whole element list. The span fix (#21's PrimitiveStore channel) landed without recovering this row, so it is ordinary work now — coordinate with the #21 session's residual census in the same territory. **The single-quoted OFFENDING literal is the fixture's load-bearing property** — double-quoting it greens the lane with no span work at all. Gate: `errors/11-types.errors.rip` reports zero position violations and the `diagnostics.positions.element` reason clause is deleted in the same change.

### B4 — the shipped declarations

14. **#54** — carry the type-parameter list onto both shipped declarations (instance interface and constructor). Not by erasing the references — that silently widens a generic component's props to `unknown` for every consumer. Gate: a type parameter on `dts-tsc.test.js`'s component fixture. #59's gate lands in the same fixture (from B1); with `dts-tsc.test.js` growing two shapes in one pass, this is the cheapest moment to ask what else the shipped declarations have never been compiled against.

## Phase C — component and schema type story

Medium emitter/projection work, all in the face's typing.

1. **#40** — type the runtime destructure in component-carrying files (restores v3's annotated delivery; fixes `:=`/`~=` initializers and re-splits #35's riding evidence), plus the `=!` micro-fix (a typed this-cast or `satisfies` on the value — the current `(this as any).x = …` swallows the value check). The in-method **write half is not this fix** — it belongs to #21's family; see Checkpoints. Gate: `check`'s component-member case flips on the initializer half → invert what the fix bought; member negatives enter 13-components' error pair. The write half is now testable against the landed span fix — verify whether the three in-method writes survive `mapTsDiagnostic` and fold the result into this gate inversion; if they still drop, the write-half assertions stay in the interim gate with the #21 session's residue.
2. **#42** — typed descriptor, default half only (`{ default?: T }`). Gate: `check`'s schema-misdeclaration case flips for the default → invert, record the transform half as ruled runtime-only in the closing line, move the default negative into 14-schema's error pair.
3. **#43** — the inference road: emit the behavior object beside the companion, project callables as `ReturnType<typeof …>`. Also resolves the `@ensure` strict wall if the predicate's param types through the same shape — verify while driving. Gate: the 14-schema `wrongGetter` pin flips red → retire it, drop the fixture's workaround shapes (use-site casts, interpolation-only reads, recomputed `total`), let `verdict` hold typed reads. The consumer-surface limit is recorded in the closing line per the residue policy.
4. **#55** — computed members: state the member as an inference over the body rather than `syntacticLiteralType`'s form table (the `ReturnType` kinship with #43 — consider doing them together). The `siblingRooted` guard's deferral target does not exist and goes with it. **Fixture trap:** the gate's claims row must have a computed body that reads a property rather than multiplying — the arithmetic shape a fixture author reaches for first is exactly the form that already works. Gate: a consumer-face claims row held by `strict` and an error-lane negative. Note #55 does not share a root with #40 despite reading as neighbours — fixing one does not move the other, so each verifies against its own gate.

## Phase D — server and editor surfaces

All in `packages/vscode` (plus the check BFS); every batch ends with `bun run install-vscode`.

1. **#49** — make an import type a closure edge (`ripImportsOf` collects it; the BFS pulls the sibling in). One half, not two: with the module in the program the untouched `.rip` specifier already resolves. No specifier rewriting — that would be a second divergent resolution rule. Gate: `ImportType` claimed in 11-types with a contract negative; census row drains.
2. **#34 + #38** — one suppression change: the hover path declines at compiler-known spans with no user symbol (the bare `~>` operator; render-DSL words, scaffold locals, bind slots, gate-key params). #38's diagnostics flavor (the TS2304-class error anchoring at a cover start) belongs to #21's family and does not gate this row. Gate: the Hover Audit's `silence` gauge greens and the `ruled` gauge's null expectations hold; both rows retire.
3. **#39** — value-first answer at a component member's declaration (rewrite from compiler facts, the enum-correction mechanism — not a change to `memberDeclareSegments`' container type, which consumers legitimately see: `ref.b.value` is real). Gate: the `ruled` gauge's member-declaration and gate-target pins move from null to the served value-type answer, rulings first.
4. **#33 + #37** — extend the source-informed token corrections: a new span list + token-type rewrite for enum names (declaration, annotation, and use positions — a fix reaching declarations alone leaves two thirds standing), and write-site spans added to the `readonly` clearing. Not v3's source-regex mechanism, which over-clears. Shared machinery, one pass. Gates: the `token.type.enum` invariant recovers (delete its reason clause with the fix) and the `token.readonly` invariant at 12-reactive's write sites greens. **#37's gate rides an accident:** it exists only because `declsOf` counts a bare reassignment as a declaration, so when this row is worked its expectation moves into an explicit use-site probe in the same change, whether or not the heuristic is touched.
5. **#44** — cast the mixin binding like every other schema kind, target type `MixinSchema<Stamped>` (new runtime-types interface, no parse surface). Emitter-side, not server-side. Propose the spelling in RULINGS.md's open Schema row for Steve. Gate: the 14-schema `Stamped` decls pin flips → re-rule and move the pin to the new answer, rulings first.

## Phase E — pin and hoist architecture

Sequenced: the spike's outcome changes the shape of everything after it.

1. **#23 spike** — prove or refute the two unknowns: the strip gate admits a TS-only value declaration (a JS capture would break semantics), and the RHS resolves in the declaring scope (with a stay-unpinned fallback for block-local reads). Also design the alias so hover never prints `typeof __p0`.
2. **Adopt path** — in-face declarations replace the Tier 3 probe; `pins.js`'s probe machinery retires; #41 dissolves with it. Gate: count of bindings still needing a pin, expect zero; the forward-reference spelling enters the corpus under `verdict` (closing #41's interim gate by inversion).
3. **Fallback path** — the probe stays; #41 gets the self-reference clause in `parseProbeHover`'s filter (answers naming a probe symbol cache null). The ceiling — substituting the real binding name — is not a free upgrade, since annotating a binding with its own `typeof` is circular at the declaration site. Gate: `check`'s forward-reference case flips → invert; spelling enters the corpus. #23 closes by ruling, recorded with the spike's evidence.
4. **#52** — after the spike decision, because the fix's binding-site half depends on which architecture stands: admit pattern-introduced bindings to the carrier set (the `captureScan` assign branch walks them as reads, so `firstWrite` stays null), and make the probe — or the in-face declaration — bind through the pattern rather than pinning the whole object's type; per-element value spans also feed `pinKey`, else siblings from one pattern share a hash. If the element-span route is taken it can ride the landed PrimitiveStore occurrence channel. Not by annotating the pattern as a whole — the read is of one name. Gate: the destructured spelling enters `claims/20-inference.rip`, where `strict` holds it.

## Phase F — design work

The campaign's large items, in recommended order. (#36 rides here because its exit is a ruling, not because it is large — the remaining work is small.)

1. **#13 — per-project wrapper tsconfigs.** Already driven and verified feasible against real tsgo, so the risk is implementation, not design. Shared: generalize `generatedMirror` + `nearestTsconfig` walk in `mirror.js`. `rip check`: one wrapper per owning tsconfig after materialization. Editor: wrappers during closure materialization + refresh on tsconfig-chain changes via the existing watcher. Also moves the host floor per-project, emitted from each project's own gate answers. Gate (new): a two-package fixture workspace — nested strict beside loose root — driven through `rip check` **and** the editor session, asserting per-config posture and that both surfaces agree on the root; the agreement assertion is the second symptom's regression guard and the reason both surfaces must be driven.
2. **#8 — auto-import mirror population.** Change candidacy at mirror population/pruning, not the tsconfig glob (driven: an on-disk mirror is offered with no didOpen). Open sub-question to settle by spike: full face vs declaration-only stub, and surviving `pruneClosure`. Guard session cost — eager materialization of everything defeats the closure's purpose. Gate: the interim `auto-import.test.js` flips (`not.toContain` fails) → invert it, **keeping every assertion liveness-paired** against a candidate that IS offered — the gate's header records why `test.failing` was rejected, and that reasoning survives the inversion.
3. **#22 — error-tolerant parser.** The settled road: the parser recovers where TypeScript's does, so an incomplete buffer still yields a face (member access at a bare dot, open call for signature help, future triggers for free). New compiler architecture — plan a design pass first (recovery points, what the face carries for an unfinished node, how the mapping rows behave over recovered spans) and drive it against the twin's answers as the oracle. **Re-drive trap:** the stale face serves the member list when the last good compile already carried a member access at the cursor, so the gate compiles the dotless statement first and any re-drive must too. Gate: `incomplete-expression.test.js` flips red → invert both surfaces to assert the correct answers; then build the fuller instruments the row names (twin-oracled completion content audit, signature-help audit on label + `activeParameter`).
4. **#36 — cell is the API.** Nearly free once ruled: the bare write already fails twice (TS2632 and the bundler), so the work is the bare read — decline it, or make the face state what the importer holds — plus documenting `.value` as the contract. Present to Steve per Settled decisions. Gate on adoption: an asserted answer at the bare read (the one surface open under this design), plus a runtime-parity fixture importing a reactive binding. 12-reactive covers the export productions already, so no fixture is blocked on this.

## Checkpoints — rows owned elsewhere or waiting

- **#21's span fix has landed** (PrimitiveStore, with #53 closing on contact — its arity invariant recovered and its clause is gone). The row itself stays open on a residual census (`mapping.census`, red by agreement, reads with no exact row) and remains its own session's; this campaign only consumes what the fix bought. #50 did **not** recover on contact — the named contingency fired, and it is now ordinary work at B3's tail. #40's write half is now verifiable and is handled in Phase C's item.
- **#16** — nothing to do but watch: the exit is a stable TS 7.1 reaching the pin (`microsoft/typescript-go#4635` fixed; npm `latest` still 7.0.2, and only `7.1.0-dev.*` builds carry the fix — adopting one early would put every tsc-backed gate on a daily build, so wait). On the bump: re-drive the probe, write the honest gate asserting `defaultLibrary` present, close. Never gate on the modifier's absence, and remember the pre-fix presence gate is platform-dependent (passes on Linux, fails on macOS).

## Execution order

A (#58, immediate) → B1–B4 (mechanical drain, visible progress, no decisions left inside it) → C (type story, unlocks corpus moves) → D (editor surfaces, one install-vscode cycle per batch) → E (consumes the background spike track's verdict, which has been running since day one — it shapes #52 and #41) → F (largest last; #13 first among them since it is already de-risked). Checkpoints fire whenever their trigger lands, independent of phase.
