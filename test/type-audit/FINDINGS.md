# Type-audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip**: every expectation in it was authored, so it can only ever check what its author already knew — which is why the suite was green through every finding recorded here, and why almost every body below carries a *"why the suite missed it"* paragraph. The type audit verifies rip against **TypeScript**, using oracles this repo does not control: the hand-written twin, whose answer *is* TypeScript's; the `.rip` source's own grammar; the fixtures' own `@ts-expect-error` markers. That is why it can discover, why it cannot be a pass/fail gate (a differential against an outside reference has legitimate divergences as well as real gaps), and why its output is a categorized score rather than a boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. Some gates are red *by design* (#21) and their rows stay until they flip — read each row's Gate cell. One row (#23) has no gate because nothing about it fails: its exit is a ruling rather than a green run, unless the open question in its body answers yes and hands it an ordinary gate.

**A fix closes the root, and the test is where the datum lands** — into the **face**, where every consumer reads it, or into the one response. A gate cannot tell them apart: a mitigation makes its payload correct without supplying the datum that was missing. The Tier 3 probe (#23) feeds tsgo's answers back through `compile()` as pins, so **a query is not the tell** — across an out-of-process checker it is the only route to a type at all; `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) returns a reference's hover in place of an `any` and touches nothing else. Same shape, opposite verdicts. The other tell is scope: one root leaves four surfaces wrong in #21, so greening one closes nothing, and **a mitigation's residue is not the finding** — a row restated around what the workaround could not reach reads as progress, and is how a workaround becomes the architecture. Nor is the root always in the compiler (#13's is `generatedTsconfig`, #16's is inside tsgo): *upstream* is where to look, not the rule. Diagnose the root, state it in the body, and make the gate measure **that** — one aimed at a symptom can be satisfied by a patch, and eventually is.

**IDs are doc-internal** — they name a row so another row can cite it, and nothing outside this file cites one: a row is engineered to disappear, so a pointer to it from code, which is permanent, is a reference built to rot. [findings.test.js](../toolchain/findings.test.js) enforces that and explains the rest when it fails. Never reused or renumbered — the commit that filed a finding is its durable provenance, and reusing a number makes that log lie rather than merely dangle.

**Tags group by root** — `compiler` (parser/emitter) · `strict` (implicit-any & safety) · `directive` (the `@ts-expect-error` family) · `hoist` · `config` · `editor` · `capability`. They are **labels, not partitions**: a row that shares a fix with two roots carries both. #22 is an editor complaint whose fix is a parse/recovery seam (`compiler`), and would be torn in half by any scheme that filed each row in exactly one bucket. **Order is a signal, not a container.**

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** A **vs v3** line records what the typed editor did before the tsgo/LSP broker replaced v3's in-process LanguageService — the root almost every gap here traces back to. Each was established by driving v3, still reachable at 3.17.5 (`~/Code/shreeve/rip-lang`). It survives on an open row because it argues about a fix not yet made; it dies with the body when the row closes. This repo is **v4, cleaned up**; "v4" in a body means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-07-16. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree. The audit itself is `bun run type-audit` (`--help` for what each of its three audits is judged against, and for the one trap worth knowing before you touch `--update-hovers`). The wider editor surface — completions, definition, references, rename, code actions — is covered by the extension's own suite in `packages/vscode/test/`, not here.

**How gates go blind.** Every rule below was earned by a green suite sitting through a real defect. They are the failure modes to write a *new* gate against — the findings are their worked examples, not the other way round.

- **A fixture that cannot fail a dimension is not covering it.** 09's `RenderCondTest` exercises every render branch form and puts a string literal in every body — a body that *cannot* carry a type error. The fixture proved the conditions were checked and said nothing about the bodies, while its section header claimed render-block expressions were type-checked generally — a gap since closed by `untyped-params`.
- **A differential claim needs a differential test.** A config surface no harness ever writes is invisible to that harness: the runner copies only `tsconfig.json` into its workspace and never a `package.json`, so `rip.strict` was false in every run and the flag sat inert — wired in source, exercised by nothing (#1).
- **Position fidelity is not content fidelity.** A gate can assert a payload lands in the right place and stay green through the entire life of a defect in what it *says*. The semantic-token surface was watched for position and unwatched for meaning; no test had ever asserted a modifier (#15).
- **A floor is not a description.** `verdict` counts Error-severity diagnostics only, so everything above that floor — the hint and suggestion classes — is invisible to it, and its silence is a statement about what it counts rather than about the payload (#17).
- **Driven is not asserted.** Exercising a feature only at the position where it works, never at the position where it is used, is the sharpest form of this: completion is tested at `msg.sub` and signature help at a closed `pick(1, 2)` — the two states that parse, and the two states nobody is in when they need the feature (#22).
- **A fixture's prose is not a gate.** 09-components.rip carries section headers asserting contracts the fixture does not exercise — render-block body typing and event handler param typing were both examples, now gated by `untyped-params`. Both comments were ported from v3 and have been read as coverage ever since. A comment claiming a behavior is a claim to *test*, not evidence.

## The road

Ordered by **how many rip users a gap reaches**, then by how badly the editor misleads, with one forced dependency honored. **Order is the recommendation; the ID is only a name** — a number records when a gap was found, which says nothing about what to do next.

| # | Finding | Tags | Gate |
| --- | --- | --- | --- |
| [21](#21-an-identifier-read-carries-no-source-span) | Identifier reads carry no source span — hover, definition, diagnostics, tokens | `editor`, `compiler` | `member` + `survival` — **red by design**, token surface only; the other three **unwatched** |
| [23](#23-the-tier-3-pin-probe-cannot-be-retired-by-more-declare-in-place) | Pin probe can't be retired by more declare-in-place | `hoist` | **none while the probe stands** — nothing fails; one open question could hand it a gate |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |

**#21 reaches every rip user** — it never lets a bug through (the check is sound; only the answer's *position* is wrong), but hover names the wrong symbol without hedging, which is silent in the same way, and it reaches 31% of medlabs' identifier reads.

**The remaining open rows reach almost nobody day-to-day.** #23 reaches nobody: the probe is correct and the editor is right. **#16 is blocked**, not deprioritized — it sits last because no amount of work here moves it, not because it matters least.

## Findings

### 21. An identifier read carries no source span

An identifier READ gets no mapping row of its own — it inherits the **cover** row of whatever construct carries it. Every consumer that resolves a face position by byte arithmetic ([generatedEditSpanToSource](../../packages/vscode/src/translate.js)) refuses past the first byte divergence inside that cover and falls back to the **cover's start**, so the read does not resolve imprecisely — it resolves to *another symbol*.

**Four surfaces, one root** — driven 2026-07-17, the real server against tsgo on the hand-written twin, at the argument read in a `console.log` whose label is single-quoted:

| surface | source | answer at the read |
| --- | --- | --- |
| hover | `console.log('total:', total)` | **`(method) Console.log(...data: any[]): void`** — the wrong symbol, stated without hedging |
| definition | `console.log('total:', total)` | **null** |
| diagnostics | `console.log('total:', totalz)` | underlines `'total:', totalz`; TypeScript underlines the name alone |
| semantic token | `console.log('total:', total)` | dropped |

The diagnostics row needs a *bad* name — a resolving `total` raises nothing to mis-place — so it reads `totalz`; the other three need a resolving one. Same construct, same cover, same collapse.

Checking itself is **sound** — the same diagnostics fire with the same codes, and the compiled JS is unaffected; only *where* an answer lands is wrong. That is what keeps it at the top of the road: it misleads, it does not let a bug through.

**Two triggers, each sufficient alone** (driven, one variable at a time, same read):

| | no literal | double-quoted | single-quoted |
| --- | --- | --- | --- |
| **parens** | ok | ok | **fails** |
| **paren-less** | **fails** | **fails** | **fails** |

A **paren-less call** fails unconditionally — the `args` cover maps source `total` onto face `(total)`, so the face span opens with an inserted `(` and the verbatim prefix is zero-length. A **single-quoted literal** fails positionally — `('x:', total)` → `("x:", total)` holds the prefix until the quote, so arguments *left* of it survive. Parens **and** double quotes is the only combination that works, and neither is idiomatic rip: this fires on ordinary code, not a corner.

**Status.** ⬜ **Open** (2026-07-17) — **gated red by design on the token surface only**, by `member` and `survival`. The other three surfaces are **unwatched**: `verdict` counts Error-severity diagnostics and gets zero (a fixture's `@ts-expect-error` is consumed inside tsgo, on the face, at the face's true positions — *before* rip's mapping runs, so the mis-position is unreachable while the directives are in place), and the hover audit probes only `declsOf` declarations, never a read.

**The two token invariants, and why it takes two.** Both assert the CORRECT behavior (a name *should* classify), never the bug's absence — the direction #16 warns against — and both are platform-independent, so unlike #16 they carry none of that finding's gating hazard.

- **`member`** ([runner.js](runner.js) `typeMembersOf`) — enumerates type-body members from SOURCE and asserts each gets a token. Presence only. It reaches the third root category below, where a name's span never existed.
- **`survival`** ([runner.js](runner.js) `faceSurvival`) — count-based, and must be: a dropped token's source offset is unrecoverable, so it does not correspond by position. It takes the SET of names tsgo classifies on the face, counts each name's source occurrences, and subtracts what the real server (`session.semanticTokens`) delivered — the deficit is the drop. The server is the delivery oracle, so no remap is reimplemented. It is the only invariant reaching use sites and rip-native names.

A source enumeration cannot see a use, and a classified-name-vs-delivered count cannot say *where* a surviving name landed — hence two, and hence neither alone.

**The population is the census, not the symptom count.** A read is safe when it sits inside an `exact` row: [builder.js](../../src/builder.js) records `exact` only for verbatim-equal slices, so byte arithmetic *inside* one is valid by construction. Everything else has no positional guarantee — it resolves today only while its cover's prefix happens to stay verbatim through it. Driven 2026-07-17 over the 252 of 255 `.rip` files in this repo and in medlabs that compile (3 fail to compile and are in no column below), predicate validated against all four rows of the trigger table above:

| where | reads with no exact row |
| --- | --- |
| medlabs — the real app, 58 files | **3,063 / 9,999 — 31%** |
| this repo's shipped packages, 83 files | 6,619 / 33,400 — 20% |
| the audit corpus, 12 fixtures | 515 / 2,138 — 24% |

**The corpus rate sits between the two, so for this row it is a fair instrument** — the rate is uniform because the triggers are ordinary syntax, not a shape that needs scale to appear. (It is not fair for #23, where the same 12 fixtures under-count by two orders of magnitude and carry the wrong shape.) A hover-containment sweep — a returned range must contain the position asked for — finds **100** wrong across 9 of the 12 fixtures today. The gap between census and sweep is the finding: the rest are one face rewrite away from breaking, with nothing watching. [10-validation.rip](fixtures/10-validation.rip) is the corpus's most exposed file (42%) and reports **zero** hover violations; medlabs' worst is `app/components/icon.rip` at 94%.

**Root (code) — three categories, each losing the span at a different point.**

- **List elements** (call arguments). The list *is* a node with a span — `console.log a, b` yields one node over `a, b` — but per-element spans are never derived: [parser.js](../../src/parser.js) records one row per **role**, and for a spread role `childNodeId` stays null, because [stores.js](../../src/stores.js) takes per-element spans only from *"the children's own NodeStore rows"* and a bare identifier is a primitive string in the tree (`["...", "console", "log"], "total"`), which has none. The span exists transiently at the accumulator's reduce (`locs`) and dies when the stack pops.
- **Annotation names.** The `annotation` role's span is `": number"` — it includes the operator — and `number` gets no node.
- **Type-declaration internals.** `type ID = string` is **one lexer token** (`TYPE_DECL`, via [lexer.js](../../src/lexer.js)'s `claim`) → one node → one role over the whole text. `ID` and `string` have no spans *at all*; the grammar never sees inside a type. This is the largest slice — `string` and `number` top the at-risk census — and the type-heavy fixtures are the most exposed in the corpus (10-validation 42%, 05-interfaces 39%, 03-structural 37%, 02-aliases 35%).

**The fix — upstream, and the same move for all three.** Give primitive reads real source spans and mark them: `markSpan` + `SPAN_ROLES` ([builder.js](../../src/builder.js)), whose `mappingKind` stays decided by the builder's verbatim comparison, so a name row classifies exact **by construction** rather than by assertion. `shorthandProp` is the precedent and the model — *"a boolean-shorthand prop key is a primitive with no store row"*, given an exact row from an anchored bare-word scan. Type internals need no type grammar: the `TYPE` token already carries its span and its text, and the face emits that text near-verbatim, so the scan is over text already in hand. **Do not solve this at query time.** A query-time resolver (identity, ordinal, or otherwise) fixes one consumer, cannot serve the edit path — which must never guess — and structurally cannot resolve a name that repeats inside its cover, which an emit-time row resolves for free because the span is *known*, not searched. See the upstream rule under [How to read this ledger](#how-to-read-this-ledger).

**The gate this wants** is the census above — reads with no exact row, computed straight from the mapping rows, no server and no oracle. It measures the root and nothing else, so no downstream mitigation can satisfy it. Unbuilt.

**Why the suite missed it.** Every token gate was source-enumerated at declarations — `declsOf` (column-0), plus [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) and the `readonly` sweep on column-0 `:=`/`=!`/`~=` names. A name's *declaration* gets a token, so every gate passed while its *use* was never in any set. The editor suite's definition tests are the sharper miss: they **do** drive use sites (`// total at its read`, `// answer at its use` — [editor-features.test.js](../../packages/vscode/test/editor-features.test.js)), and pass because their fixtures are `next = total + 1` and `double = answer * 2` — binop operands, which the emitter's read guard gives an exact row. Right position, source that cannot fail. And `declsOf`'s own comment names the construct it excludes — *"a name followed by `.`/`(`/`[` is a usage (`console.log(…)`) — which the old heuristic wrongly probed"* — a refinement that was correct on its own terms and removed the only shape in the corpus that carries the defect.

**vs v3 — established for TOKENS (driven both sides, 2026-07-15), unestablished for the other three.** v3 compiles to TS, runs `getEncodedSemanticClassifications`, and remaps the spans back (rip-lang 3.17.5 `packages/vscode/src/lsp.js`) — it is not remap-free, so a token surviving there is a property of its remap, not of classifying on raw source. The token verdict **splits by surface**:

- **Type-body members — regression.** `type Circle = { kind: 'circle', radius: number }`: v3 classifies `radius` `property`, v4 drops it. The `member` gauge tracks a genuine v4 loss — v3's remap survives the quote rewrite where v4's cover-prefix does not.
- **Use sites — mostly inherited, causes inverted.** `console.log('total:', total)`: both drop the use, so no outcome change on the common single-quoted form. But the cause is opposite — v4 drops it to quote-normalization (`console.log("total:", total)` **rescues** it in v4, which is the trigger table above), while v3 drops it to the call-argument context regardless of quotes (double-quoting does **not** rescue it in v3). A bare `x = total` and a minimal reactive read (`x = clicks` off `clicks := 0`) classify in **both**. So the `console.log`-argument drops — the bulk of the `survival` count — are v3-inherited, not v4 drift.

Unsettled on tokens: 08's reactive reads drop in v4 only in render/component context (the minimal read survives both); that exact context was not reproduced on v3. Net for tokens: the **member** surface is the established v4 regression; the **use-site** surface is largely a shared, pre-existing limitation.

**Unsettled everywhere else, and it is the bigger question.** Whether v3 *hovers* a read correctly, resolves its definition, or positions its diagnostics — the three surfaces this row now turns on — was never driven. Re-drivable at 3.17.5 (`~/Code/shreeve/rip-lang`); worth settling before assuming those three are v4 drift, since the token split above shows the answer can invert per surface.

### 23. The Tier 3 pin probe cannot be retired by more declare-in-place

A binding that stays hoist-split and is **also** read from inside a closure is an evolving `let` TypeScript declines to infer (`TS7034` — an evolving `let` serves only same-function references), so no site in the real face knows its type. The Tier 3 pin probe recovers those types by manufacturing a declaration site and hovering it ([pins.js](../../packages/vscode/src/pins.js)), in the editor and in `rip check`'s batch alike, and feeds the answers back through `compile()` as pins — so the type lands in the **face**, where every consumer reads it.

**What keeps a binding hoisted is not what the name suggests.** `captureScan`'s safety rule has three clauses, and in real code the dominant one is the third: **any name touched inside a hoisted `def` keeps the hoist**, because a `def` is the one construct callable from above its own statement. That has nothing to do with where the write sits — `MIME = { … }` in [serving.rip](../../packages/server/serving.rip) is a top-level write, hoisted purely because `def mimeType` reads it. Driven 2026-07-17 over the 252 of 255 `.rip` files in this repo and in medlabs that compile (3 fail and are uncounted): **222 pinnable bindings** — 204 here, 18 in medlabs — and the population is dominated by top-level constants and helpers (`MIME`, `fail`, `COMMANDS`, `DEFAULT_TIMEOUT_MS`) that a hoisted `def` touches.

**So widening declare-in-place cannot retire the probe** — not because it only records top-level writes, but because the `def` hazard it declines is real: the write genuinely may not have run. What widening *would* reach is the block-confined shape ([11-inference](fixtures/11-inference.rip)'s `needle`, [09-components](fixtures/09-components.rip)'s `term`) — a binding first written inside an `if` and never read outside it, which could declare in place with no hazard at all. Driven: declared in place, tsgo infers `needle: string` natively and the `TS7034`/`TS7005` pair disappears. **That shape is 2 of 3 in the audit corpus and rounding error in real code** — which is why the corpus is the wrong instrument for this row, and why the 222 above was measured outside it.

**Status.** ⬜ **Open** (2026-07-17) — not a defect: the probe round is correct and the editor's answers are right, so there is nothing to fail today. **Gate: none while the probe stands** — but "none possible" would overstate it. If the in-face declaration below turns out to work, the probe becomes unnecessary and the gate is immediate: count the bindings still needing a pin, expect zero. So this row's exit is a **ruling** only if that question answers no; answer yes and it leaves through the same door as every other row.

**v3's alternative does not exist here, and is not a choice to weigh.** `patchUninitializedTypes` (rip-lang 3.17.5, `src/typecheck.js`) does not infer a type onto the hoist line: it takes the `ts` module and the live LanguageService, calls `checker.getSymbolAtLocation`, and injects types by mutating binder symbols on DocumentRegistry-shared SourceFiles (`sym.flags |= ts.SymbolFlags.Transient; sym.links = { type }`) — its own comment records the price, symbols released by hand or "every rebuilt program leaks (~50MB/compile → GBs over an editing session)". The tsgo broker is a separate process spoken to over LSP: no `ts` module, no `Program`, no symbol to mutate. **Across an out-of-process checker a query is the only route to a type at all** — so the probe is not a workaround deferring a fix, it is the architecture doing the only thing available, and its answer lands in the face rather than in one response. See the upstream rule under [How to read this ledger](#how-to-read-this-ledger).

**What is genuinely open** is narrower than a choice of mechanism: whether the face could carry a TS-only value declaration (`const __p = <first-write RHS>; let x: typeof __p;`) as a recorded region, typing the binding with no round trip. It needs the RHS to resolve in the declaring scope — true of the constants that dominate the 222, false where the RHS reads a block-local — and it needs the strip gate to admit a stripped value declaration, which a JS capture would break. **Undriven.** Settle that before ruling on the probe; the ruling is cheap and wrong if this turns out to be possible.

### 16. Library globals lose the `defaultLibrary` modifier

Symbols declared in `lib.*.d.ts` reach the editor with **no `defaultLibrary` modifier**, so VS Code falls back to `variable.other.readwrite` / `entity.name.function` instead of the `support.*` scopes themes reserve for the standard library. Token *types* are correct; only the modifier is missing. Driven on `console`, `Math`, `parseInt` and `isNaN`, and true of the whole class — the lookup that sets the bit never consults the symbol, and **not one token** in the fixture carries it. The only finding here whose cause is outside rip.

**Status.** ⬜ **Open** (2026-07-14). **Upstream, in tsgo**: rip cannot fix it in `ripSemanticTokens` because the bit never arrives to forward. Filed as [microsoft/typescript-go#4635](https://github.com/microsoft/typescript-go/issues/4635). Blocked — it sits last on the road because no amount of work here moves it, not because it matters least.

**Driven** — both editor servers over real LSP, same machine, same fixture lineage:

| server | library globals carrying `defaultLibrary` |
| --- | --- |
| v3 — in-process TS 6.0.3 LanguageService, on v3's `test/types/06-functions.rip` | **every one** |
| v4 — tsgo broker, on [06-functions.rip](fixtures/06-functions.rip) | **none** |

Also driven straight against the tsgo binary, bypassing rip: **not a single token** on the `.ts` twin, under both the native-preview extension and the released `typescript@7.0.2`. The engine, not rip's remapping.

**Why (code)** — tsgo's classifier (`internal/ls/semantictokens.go`, `collectSemanticTokensInRange`) passes a declaration's **raw** `FileName()` to `IsSourceFileDefaultLibrary`, a lookup in a map keyed by **canonical** paths. Canonicalization lowercases on a case-insensitive filesystem, so `/Users/…` never matches its key `/users/…` and the lookup always misses; every other caller in tsgo passes `sourceFile.Path()`. Causally confirmed: copy tsgo's lib dir to an all-lowercase path, change nothing else, and every library global gets its modifier back — same binary, same file, same client.

**Platform-conditional — the gating hazard.** On a case-SENSITIVE filesystem the canonicalization is the identity function and the bug does not occur, so a gate asserting `console` carries `defaultLibrary` **fails on macOS/Windows and passes on Linux**. Reporting differently by platform is worse than no gate, and the expected-failure device (#8) does not fit — an expected failure that passes on half the platforms is not one. Hence Gate **none**. **Never close this by asserting the modifier's ABSENCE:** that pins an upstream bug into the suite and certifies it correct. The honest gate becomes writable the day #4635 lands.

**vs v3** — **regression** (driven, above). v3 classifies in-process through the JS TypeScript LanguageService (`getEncodedSemanticClassifications`), which canonicalizes correctly, so the same code on the same machine gets the bit. It surfaced late because the modifier surface is only half-watched: `readonly` is gated, and nothing asserts `defaultLibrary` — or any modifier on a *library* symbol, since both that gate and the token audit probe rip's own declarations.

## Closed

Verified, and gone. **The gate is the record** — each row's constraint is stated where it is enforced, and the audit that retired these bodies confirmed the root of every one already lives in the code it governs, usually better stated than it was here. The body is recoverable from git (`git log -S`), and the commit that filed each finding still names its ID.

| # | Finding | Gate |
| --- | --- | --- |
| C1 | Optional `?` marker rejected | `dts-tsc`, audit `compiles` |
| C2 | Method-shorthand in type body rejected | `dts-tsc`, audit `compiles` |
| 1 | Implicit-any suppressed, no opt-out | `strict-modes` |
| 2 | Use-before-assign hidden by `!` | `strict-modes`, `tiers` |
| 3 | Reactive annotations not enforced | audit `verdict` |
| 4 | Evolving-`let` reassignment not caught | audit `verdict` |
| 5 | `typeof` unannotated → `undefined` | audit `verdict`/`twin`, `tsface-tsc` |
| 6 | `@ts-expect-error` dropped on multi-line emit | audit `directives`, `check` |
| 7 | No headless `rip check` | `check` |
| 9 | Write-only locals hover any | hover audit's not-any invariant |
| 10 | Reactive bindings hover cell wrapper | hover audit + `hover-pins.json` |
| 11 | Config changes required a reload | `config-reactivity` |
| 12 | `rip.noCheck` parsed but never applied | `config-reactivity` |
| 14 | Unused `@ts-expect-error` silently swallowed | `check` |
| 15 | Reactive `:=` bindings tagged `readonly` | `semantic-tokens`, token audit's `readonly` invariant |
| 17 | A directive swallows the unused-local fade | `editor-features` |
| 20 | Render branch/loop bodies unchecked (`ctx` / loop params) | `untyped-params` |
| 24 | Schema block implicit `it` untyped | `untyped-params`, audit `strict` |
| 25 | Event handler parameters get no event type | `untyped-params` |
| 22 | Completion & signature help fail on an incomplete expression | `incomplete-expressions` |
| 19 | Inline render-block directive lost from the face | `tsface`, audit `directives` |
| 18 | A directive blinds the whole indented block | `directive-range` |
| 13 | Single-rooted tsconfig — no per-project resolution | `per-project-tsconfig` |
| 8 | Auto-import is closure-scoped | `auto-import`, `export-index` |
