# Audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip** — every expectation in it was authored, so it checks only what its author already knew, and it was green through every finding recorded here (hence the *"why the suite missed it"* paragraphs below). The audit verifies rip against **TypeScript**, through oracles this repo does not control — the hand-written twin, the source's own grammar, TypeScript's own diagnostics over the error lane — which is why it can discover, and why its output is a categorized diff rather than a pass/fail boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. No gate is red *by agreement* today — every contract invariant is green, so the next red is a regression rather than a queue, and a row filed from here on arrives with its gate already failing. Read each row's Gate cell anyway, because a gate does not always track only its own finding.

**A fix closes the root, and the test is where the datum lands** — into the **face**, where every consumer reads it, or into the one response. A gate cannot tell them apart: a mitigation makes its payload correct without supplying the datum that was missing. The Tier 3 probe (#23) feeds tsgo's answers back through `compile()` as pins, so **a query is not the tell** — across an out-of-process checker it is the only route to a type at all; `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) returns a reference's hover in place of an `any` and touches nothing else. Same shape, opposite verdicts. The other tell is scope: one root left four surfaces wrong in #21, so greening one would have closed nothing, and **a mitigation's residue is not the finding** — a row restated around what the workaround could not reach reads as progress, and is how a workaround becomes the architecture. Nor is the root always in the compiler (#13's is `generatedMirror`, #16's is inside tsgo): *upstream* is where to look, not the rule. Diagnose the root, state it in the body, and make the gate measure **that** — one aimed at a symptom can be satisfied by a patch, and eventually is.

**IDs are doc-internal** — nothing outside this file cites one (a row is engineered to disappear), and numbers are never reused or renumbered: the filing commit is the durable provenance. [findings.test.js](../toolchain/findings.test.js) enforces and explains this.

**Completeness — five slots, every row, gated.** A row is not a report of a symptom; it is everything the person who fixes it would otherwise have to rediscover. Each slot is recognized by its marker, because a section a gate cannot see goes missing silently — which is how a row shipped with its symptom driven and its root never diagnosed.

| slot | marker | what it holds |
| --- | --- | --- |
| root | `**Why (code)` | what in the code produces this, cited by file and symbol |
| fix | `**The fix` | where it belongs, what it must NOT do, and a precedent if one exists — or, where the fix needs a decision, the ruling required and who makes it |
| escape | `**Why the suite missed it` | which instrument should have caught it, and why it did not |
| prior | `**vs v3` | driven both sides, or explicitly why v3 cannot be asked |
| exit | `**Status.**` | open date, and the gate (or an honest none, plus what the fix's gate would be) |

**Root and fix are separate slots on purpose.** They are easy to merge into one paragraph and the merge costs the two most valuable sentences: *what the fix must not do*, and *which precedent it should follow*. Both are earned by driving, exist nowhere in the code, and die with the body — #21's "do not solve this at query time" and #26's "softening the annotation is the one fix this row rules out" are the shape. A prescribed fix is the root's proof, too: a root that cannot be turned into a fix shape is not diagnosed yet. What a row must NOT carry is the diff — a prescribed implementation is a prediction, and reads as wrong the day someone fixes it another way.

**A slot with nothing to say is still filled, honestly.** "Root not diagnosed, and here is what would settle it" is complete; silence is not.

**Tags group by root** — `compiler` (parser/emitter) · `strict` (implicit-any & safety) · `directive` (the `@ts-expect-error` family) · `hoist` · `config` · `editor` · `capability`. Labels, not partitions: a row that shares a fix with two roots carries both.

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** A **vs v3** line records what the typed editor did before the tsgo/LSP broker replaced v3's in-process LanguageService — the root almost every gap here traces back to. Each was established by driving v3, still reachable at 3.17.5 (`~/Code/shreeve/rip-lang`). It survives on an open row because it argues about a fix not yet made; it dies with the body when the row closes. This repo is **v4, cleaned up**; "v4" in a body means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-08-02. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree. The audit itself is `bun run audit` (`--help` for what each audit is judged against; hover pins are hand-maintained per row — the run prints paste-ready rows for divergences, and adopting one is an explicit reviewed edit). The wider editor surface — completions, definition, references, rename, code actions — is covered by the extension's own suite in `packages/vscode/test/`, not here.

## The road

Ordered by **how many rip users a gap reaches**, then by how badly the editor misleads. **Order is the recommendation; the ID is only a name** — a number records when a gap was found, which says nothing about what to do next.

| # | Finding | Tags | Gate |
| --- | --- | --- | --- |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |
| [67](#67-dynamic-rip-imports-type-any-on-linux-after-a-closure-prune) | Dynamic `.rip` imports type `any` on Linux after a closure prune | `editor` | **none today** — the fix's gate is the audit contract run on ubuntu (unpin the CI audit job) |
| [65](#65-a-render-loops-binding-classifies-parameter-because-the-lowering-makes-it-one) | A render loop's binding classifies `parameter` | `editor` `compiler` | **none today** — the fix's gate is `semantic-tokens` |
| [64](#64-the-await-hint-quotes-a-keyword-the-source-never-wrote-over-the-whole-construct) | The await hint quotes a keyword the source never wrote | `editor` `compiler` | **none, and none is honest** — no dimension admits Hint severity |
| [66](#66-adjacent-component-attributes-read-in-two-colors) | Adjacent component attributes read in two colors | `editor` `compiler` | **none today** — the fix's gate is `semantic-tokens` |

**The ordering principles.** Audience first; within a band, *silently wrong* outranks *visibly missing*: a wrong answer stated without hedging misleads, where a loud failure merely interrupts — so the loud rows (build breaks, parse errors) sink below the silent ones however broken their output is. Five rows remain, and all are quiet ones. #66 sits last on the same principle read the other way: it states nothing false — both colors are true of the name they paint — so an inconsistency ranks below a wrong answer however visible it is. #16 leads on audience — every library global in every file loses a modifier — though what holds it is an upstream release rather than a missing fix. #67 sits second: it answers a wrong *type* with full confidence — the worst kind of quiet — for every Linux editor session that churns a module through open and close, and it is what holds the audit's CI job pinned to one platform; what keeps it below #16 is reach, since no Linux session drives the editor today. #65 comes next on the silently-wrong principle: it miscolors a construct people write constantly, and states its wrong answer with the same confidence as a right one. #64 sits last because its answer is correct in substance and wrong only in the vocabulary it speaks, and it reaches only code that awaits something already synchronous. Each row's own body argues its place; this paragraph does not restate them.

**The `strict` dimension's clean run is contractual** — a red row there is a discovery, not residue; the runner's header states the curation rules.

## Findings

### 16. Library globals lose the `defaultLibrary` modifier

Symbols declared in `lib.*.d.ts` reach the editor with **no `defaultLibrary` modifier**, so VS Code falls back to `variable.other.readwrite` / `entity.name.function` instead of the `support.*` scopes themes reserve for the standard library. Token *types* are correct; only the modifier is missing. Driven on `console`, `Math`, `parseInt` and `isNaN`, and true of the whole class — the lookup that sets the bit never consults the symbol, and **not one token** in the fixture carries it. The only finding here whose cause is outside rip.

**Why (code)** — tsgo's classifier (`internal/ls/semantictokens.go`, `collectSemanticTokensInRange`) passes a declaration's **raw** `FileName()` to `IsSourceFileDefaultLibrary`, a lookup in a map keyed by **canonical** paths. Canonicalization lowercases on a case-insensitive filesystem, so `/Users/…` never matches its key `/users/…` and the lookup always misses; every other caller in tsgo passes `sourceFile.Path()`. Causally confirmed: copy tsgo's lib dir to an all-lowercase path, change nothing else, and every library global gets its modifier back — same binary, same file, same client.

**Platform-conditional — the gating hazard, while the pin predates the fix.** On a case-SENSITIVE filesystem the canonicalization is the identity function and the bug does not occur, so a gate asserting `console` carries `defaultLibrary` **fails on macOS/Windows and passes on Linux**. That asymmetry disappears once the pin moves — on a fixed build the modifier is present everywhere — so this hazard is an argument for waiting, not a permanent one. Reporting differently by platform is worse than no gate, and the expected-failure device (#8) does not fit — an expected failure that passes on half the platforms is not one. Hence Gate **none**. **Never close this by asserting the modifier's ABSENCE:** that pins an upstream bug into the suite and certifies it correct. The honest gate becomes writable the day #4635 lands.

**The fix — none here, and that is the finding.** The bit never arrives, so `ripSemanticTokens` has nothing to forward and no local change can synthesize one honestly; the cause and its causal experiment are above, and the issue is linked in Status. The constraint to carry is the gating hazard's: **never** close this by asserting the modifier's ABSENCE.

**Why the suite missed it.** The modifier surface is only half-watched: `readonly` is gated and nothing asserts `defaultLibrary` — or any modifier on a LIBRARY symbol, since both that gate and the token audit probe rip's own declarations. No instrument had ever looked at a `lib.*.d.ts` name.

**Driven** — both editor servers over real LSP, same machine, matching fixture content on each side (the evidence is engine-level either way — see the binary drive below and the causal experiment above, both fixture-independent):

| server | library globals carrying `defaultLibrary` |
| --- | --- |
| v3 — in-process TS 6.0.3 LanguageService, on v3's `test/types/06-functions.rip` | **every one** |
| v4 — tsgo broker | **none** |

Also driven straight against the tsgo binary, bypassing rip: **not a single token** on the `.ts` twin, under both the native-preview extension and the released `typescript@7.0.2`. The engine, not rip's remapping.

**vs v3** — **regression** (driven, above). v3 classifies in-process through the JS TypeScript LanguageService (`getEncodedSemanticClassifications`), which canonicalizes correctly, so the same code on the same machine gets the bit. It surfaced late for the reason the escape slot above records.

**Status.** ⬜ **Open** (2026-07-14) — **fixed upstream, waiting on a stable release.** [microsoft/typescript-go#4635](https://github.com/microsoft/typescript-go/issues/4635) closed 2026-07-21 (PR #4654, `declSourceFile.Path()`), and the modifier is present when the same probe runs against a build carrying it. But no stable release has it: npm `latest` is 7.0.2, published before the merge, and the only builds with the fix are `7.1.0-dev.*` under `next`. This repo pins 7.0.2, and that pin also feeds every tsc-backed gate ([tsc.js](../support/tsc.js) `resolveTsc`), so adopting it early means putting the gates on a daily build. The row's exit is a stable 7.1 reaching the pin. It still sits last because nothing here moves it — but the reason is now a release cadence, not an unfixed upstream bug.

### 67. Dynamic `.rip` imports type `any` on Linux after a closure prune

On linux-x64, after a module's mirror has been pruned to an auto-import stub and re-materialized, every binding typed through a **dynamic** import of that module answers `any` and stays `any` — driven to 30 seconds against the audit's 1.2-second budget — while bindings through **static** imports of the same module recover. The same sequence on darwin answers typed within milliseconds. Reproduced minimally: open `10-modules-lib.rip`, close it, open `10-modules.rip`, hover `lazyHost = (await import('./10-modules-lib.rip')).host` — and the `import!` sugar wedges identically; under the concurrent probe pool the `import('./10-modules-lib.rip').Parcel` type position joins them (it clears in the `--serial` control, so that position is the load-sensitive edge of the same lane). Semantic tokens degrade with it — tsgo classifies no member of an `any`-typed namespace, so the token lanes drop and drift at the same positions. Wrong types stated with full confidence, for any Linux editor session that churns a module through open and close.

**Why (code)** — the trigger sequence is driven; the seat inside tsgo is bounded but not yet pinned. (1) Opening the module materializes its real face (open buffers own their mirrors — `materializeClosure`, [server.js](../../packages/vscode/src/server.js)); (2) closing it lets `pruneClosure` demote the mirror to an auto-import stub, notified to tsgo as `Changed`; (3) opening an importer re-materializes the real face — the stub cannot pass `mirrorIntact`'s byte-hash, so the compile road rewrites it and notifies `Changed` again. After (3), tsgo on linux serves the stub-era `any` for that module's `import()`-shaped positions indefinitely, while static-import positions of the same module — updated by the same notifications — answer correctly. Eliminated by driving: the linux tsgo binary at rest (raw tsgo over an equivalent `.rip.ts` mirror answers every import form correctly on ubuntu), the mirror's extension-append trick, and a churn-free server (the same hovers are clean on ubuntu when the importer opens first). Both platforms run tsgo 7.0.2, and the audit harness registers no client watchers, so every invalidation tsgo sees is the server's own synthesized `didChangeWatchedFiles`; the leading candidate — not driven — is that darwin alone is rescued by a second invalidation path (tsgo's native watching), while the notification path drops `import()`-type resolution invalidation on both. What would settle the seat: the row-16-style dive into tsgo's module-resolution cache invalidation on `didChangeWatchedFiles`, aimed at `import()`-type resolutions specifically.

**The fix** — upstream if the dive lands where the driving points; the rip-side alternative needs a ruling. If tsgo's notification path drops `import()`-type resolution invalidation, the honest fix is upstream, as row 16's is. The server-side mitigation shape — notifying a re-materialized mirror as Deleted-then-Created instead of `Changed` — reverses a deliberate design (the prune-notification comment in [server.js](../../packages/vscode/src/server.js) records what the delete-then-recreate sequences were fighting), so taking it is the language owner's call, and it would be a mitigation: the missing datum is a settled resolution, and greening the hover without supplying it is the workaround-becomes-architecture path this ledger warns about. It must NOT be closed by widening the audit's retry budget — the answer never settles, so any budget merely moves the timeout. Until a fix lands, the CI audit job stays pinned to macOS ([test.yml](../../.github/workflows/test.yml)) so its red keeps meaning "this change broke the contract."

**Why the suite missed it.** The audit had only ever run on macOS: ROADMAP.md recorded the audit as standalone with CI gating deferred, `test`/`test:all` never drive the editor server against the corpus, and [audit-contract.test.js](../toolchain/audit-contract.test.js) gates the judgment, not the measurement, by design. The first ubuntu run of the newly wired CI audit job surfaced it immediately — the instrument worked; it had never been pointed at this platform.

**vs v3** — **not driven, and not drivable in kind.** v3's in-process LanguageService had no mirror tree, no stub/prune cycle, and no LSP notification seam — the machinery this finding lives in does not exist there, so 3.17.5 has no equivalent question to answer.

**Status.** ⬜ **Open** (2026-08-04) — gate **none** today, deliberately: the reproducing gate already exists (the audit's own hover-parity and token-delivery invariants, run on ubuntu) but wiring it into CI red would paint every push until the fix lands — row 16's platform-conditional hazard in mirror image. The fix's gate is unpinning the audit CI job to ubuntu (or an ubuntu audit job beside the macOS one); the existing contract invariants then hold it.

### 65. A render loop's binding classifies `parameter`, because the lowering makes it one

`for person in people` inside a render body reports the semantic token **`parameter`** — at its binding and at every read — while the identical construct outside a render body reports **`variable`**. Driven over LSP against the editor server: `human` in a plain `for human in folks` comes back `variable [declaration]` and then `variable`; `person` in a component's `for person in people` comes back `parameter [declaration]` and then `parameter`. One source syntax, two token types, decided by a lowering the author never wrote — so a loop variable reads parameter-orange inside a component and constant-blue everywhere else. Semantic tokens are the authority for identifier color, so nothing downstream corrects it; the TextMate scope underneath (`variable.other.constant.rip`) is already right and is simply outranked.

**Why (code)** — the render loop lowers its body to a BLOCK FUNCTION. The emitter's for/reconcile render path emits `create_block_0(ctx: this, person: …, i: number)` and a keyed callback `(person, i) => person` inside the `__reconcile` call, so in the face `person` genuinely **is** a parameter. tsgo classifies the face, which makes the answer faithful to what it was shown and wrong about what the user wrote. `ripSemanticTokens` ([server.js](../../packages/vscode/src/server.js)) is exactly where the three existing corrections of this shape live — clearing `readonly` on `:=` names, retyping enum names, retyping forward-referenced class bindings — and each is keyed on a span list the compiler reports (`mutables`, `enums`, `classDecls`, threaded through the emitter's `channels` list and `compile.js`'s result). There is no such channel for a loop binding.

**The fix** — a compiler channel carrying the loop binding, consumed in `ripSemanticTokens` beside the other three; the plumbing is the fixed channel list already in the emitter plus the result object. The binding is **not one span**: `person` is emitted in the block signature, in the keyed callback, and at every read inside the block, so a correction that fixes only the declaration leaves every use orange — the failure mode #63's gate already names ("every occurrence colors `class` — the use site, not only the declaration"). The channel is therefore either per-occurrence spans or the block's generated range plus the binding name. It must **not** retype every `parameter` inside a component: a handler's `(e) ->` parameter *is* a parameter and has to stay one, so the correction is the compiler's span and never a blanket rule — the constraint #63's non-class case pins for the same reason.

**Why the suite missed it.** [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) is the right instrument and already carries this exact shape for three other classes, but it has no case for a render-loop binding — its component coverage follows the `:=` member path, not the for/reconcile path. No audit dimension substitutes: they count Error-severity diagnostics, and a token TYPE is not a diagnostic.

**vs v3** — **not a regression, and driven at the emitter.** v3 (3.17.5) lowers the same source to the same block-function shape — `function create_block_0(ctx, person, i)` with a `p(ctx, person, i)` update arm — so its in-process LanguageService was classifying an identical face and had the same input. The editor side was not driven; the emission was, and the emission is what decides this.

**Status.** ⬜ **Open** (2026-08-03) — gate **none** today. The fix's gate is `semantic-tokens`, where the three sibling corrections are already pinned: a case asserting `variable` at the binding **and** at every read, with a handler's own parameter left as `parameter`, is what closes this.

### 64. The await hint quotes a keyword the source never wrote, over the whole construct

`instant = new Ticket!` draws TS **80007** — *"'await' has no effect on the type of this expression"* — at Hint severity, untagged. Two things are wrong for a rip reader, and neither is the hint's substance. The message quotes `await`, a word the source does not contain: rip spells it `!`. And the span covers the **whole construct** — columns 10–21, all of `new Ticket!` — rather than the one character that means await; `new Ticket!(7)` spans 11–25 the same way. Driven off the wire against the editor server. The hint itself is right and discriminating: it fires on a synchronous constructor and stays **silent** on `good = fetchReal!` where the callee returns a Promise, so it is a real "this bang buys nothing" signal, not noise. rip has two paren-less call forms already (juxtaposition and `f()`), so `!` is never reached for to avoid parens — it exists to await, and awaiting the synchronous is genuinely redundant.

**Why (code)** — the face carries `await new Ticket()`, and tsgo puts 80007 on its `await` keyword. That keyword is **synthetic**: nothing in the source spells it, so the lowering gives it a COVER mapping to the construct that produced it. Driven through `compile(src, { face: 'ts' })` and `generatedSpanToSource` — `gen await @107 → src [84,95] kind=cover`, exactly `new Ticket!`. `mapTsDiagnostic` ([diagnostics.js](../../packages/vscode/src/diagnostics.js)) then maps positionally and never narrows, which is correct in general: a construct-wide span is what most diagnostics want, and the mapper branches on tags, echo spans and parse state — never on individual codes — for span decisions. The message is tsgo's own text, forwarded untouched; nothing in the mapper rewrites `d.message`.

**The fix** — two shapes, and the cheaper one is not the better one. Editor-side: narrow the mapped span for this code to the bang inside it (the first `!` not followed by `=`, which skips `!=`/`!==`), about ten lines in `mapTsDiagnostic`. Compiler-side: emit an **exact** mapping from the generated `await` to the source `!`, after which `generatedSpanToSource` returns the bang with no special-casing and every surface benefits, not just this diagnostic — the root is the cover mapping, so this is the fix that addresses it. The editor-side narrowing is a code-keyed special case in a mapper deliberately kept code-agnostic, and it is shared with `rip check`'s batch driver, so it must be right in both. It must **not** suppress 80007: the hint is precise (driven above), and the suppressed-code list exists for a different reason — the implicit-any family is noise on legal unannotated rip, a gradual-typing posture, where this is a genuine no-op observation. It must **not** key on message text: TypeScript's strings are version-dependent and localizable, so any rewrite keys on the code. The wording half needs a ruling before it is built — whether face vocabulary leaking into user-facing messages gets a general mechanism (a code-keyed table with a stated rule) or nothing at all — and that is the language owner's call, taken against a sweep of how many other diagnostics speak face vocabulary. If the sweep finds only this one, nothing is the right answer.

**Why the suite missed it.** Severity, by design. Every audit dimension counts Error-severity only — `verdict` filters `severity <= 2`, and [runner.js](runner.js) states the fade classes (info/hint) are out of scope — while 80007 arrives at Hint severity, untagged, so no dimension can see it at all. The one instrument that checks diagnostic **positions**, the Diagnostics Audit's position rows, owns the `corpus/errors/` lane exclusively; this construct lives in the grammar corpus (`corpus/grammar/09-classes.rip`, under the *Construction dammit* heading), which that lane never descends into. A span this wrong was invisible to both halves.

**vs v3** — **not comparable, and driven to establish why.** v3 (3.17.5) lowers `new Ticket!` to `new await Ticket()()` — the await lands *inside* the `new`, so it awaits the callee and constructs the result — where v4 emits `await new Ticket()`. TypeScript reading v3's output is answering about a different program, so v3's span and message for this construct are not the same question, and no comparison of them would mean anything. AGENTS.md already records the `new` × dammit interaction as a v3-era grammar hazard, which is the same seam.

**Status.** ⬜ **Open** (2026-08-03) — gate **none, and none is honest**: no dimension admits Hint severity, so there is nothing green to point at and a row asserting the current wide span would pin the defect. The fix's gate is a Diagnostics-Audit position row over a grammar fixture with the hint lane admitted — which is the instrument change the escape slot names, and is worth more than this row: it would watch every Hint-severity position, not just this one.

### 66. Adjacent component attributes read in two colors

Two attributes on consecutive lines of the same element render differently. `label: 'Name'` shows **#C9D1D9** — its semantic token, `property [declaration]` — while `value <=> text` shows **#9CDCFE**, the TextMate `entity.other.attribute-name.rip` underneath. Both names carry that same TextMate scope; what differs is only whether a semantic token covers them, and the reason has nothing to do with either attribute. Neither color is false: `label` **is** a property and `value` **is** an attribute name. This is an inconsistency, not a wrong answer, which is why it sits last on the road.

**Why (code)** — the call site emits `new Field({ label: "Name", __bind_value__: this.text })`. `label` survives into the generated object literal as the same bytes, so its token maps **exactly** and is forwarded. The two-way bind does not: its key is **minted** as `__bind_value__`, which appears nowhere in the source, so `ripSemanticTokens` ([server.js](../../packages/vscode/src/server.js)) finds no exact row and no verbatim edit-span and drops the token. Driven against `compile(src, { face: 'ts' })`: for the bind key, `exactSpanMapper` and `generatedEditSpanToSource` both answer null, and the only correspondence is a **cover** onto the whole expression `value <=> text`. The drop is therefore CORRECT, and the rule that produces it is load-bearing — forwarding tsgo's `property` onto that cover would paint the `<=>` operator and the right-hand side as a property too.

**The fix** — suppress, not synthesize: drop the semantic token on a render ATTRIBUTE name so every one of them falls back to the TextMate attribute scope and reads as an attribute, which is the more useful fact inside a render body and the one thing all of them can share. It needs the compiler to report those names' source spans, the channel shape `mutables`/`enums`/`classDecls` already use, consumed beside the existing corrections. It must **not** manufacture a token at the bind's name: the server today only forwards or corrects what tsgo returned, and inventing one at a span the mapper could not verify is the capability this row rules out — the ruling is the language owner's and it went this way deliberately, trading a true classification for a consistent one. It must **not** be closed by letting the token mapper accept cover spans; that rule protects every other surface, and #21's body records what a cover-mapped answer costs.

**Why the suite missed it.** [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) pins what `:=` names, enum names and forward-referenced classes classify as; nothing asserts what a render attribute name classifies as, in either spelling. No audit dimension substitutes — they count Error-severity diagnostics, and a token's presence is not a diagnostic. The gap is also invisible to a single-fixture reading: it only shows when a plain prop and a bound prop sit on the same element, which no instrument compares.

**vs v3** — **inherited, and driven at the emitter.** v3 (3.17.5) emits the identical call site, `new Field({ label: 'Name', __bind_value__: this.text })`, so the minted key and the absent verbatim correspondence predate the broker. Whether v3's in-process LanguageService surfaced the same two-color result was NOT driven — only the emission was, and the emission is what removes the correspondence.

**Status.** ⬜ **Open** (2026-08-03) — gate **none** today. The fix's gate is `semantic-tokens`: a case asserting that a plain prop and a two-way-bound prop on the same element classify alike, which fails now and would hold the suppression afterwards.

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
| 6 | `@ts-expect-error` dropped on multi-line emit | `tsface`, `check` |
| 7 | No headless `rip check` | `check` |
| 8 | Auto-import was closure-scoped — a workspace `.rip` nothing had opened was never offered | `auto-import` (inverted), `project-model`; the stub is bytes-only, so the prune path is byte-identical. **Accepted limit:** a file that joins the closure and later leaves stops being a candidate until the next session — restoring it means writing a mirror inside the prune, reversing an older invariant, and is the language owner's call |
| 9 | Write-only locals hover any | hover audit's not-any invariant |
| 10 | Reactive bindings hover cell wrapper | hover audit + `hover-pins.json` |
| 11 | Config changes required a reload | `config-reactivity` |
| 12 | `rip.noCheck` parsed but never applied | `config-reactivity` |
| 13 | Single-rooted tsconfig — a nested project's own config was ignored | `check`, `editor-gaps-synthetic-project` |
| 14 | Unused `@ts-expect-error` silently swallowed | `check` |
| 15 | Reactive `:=` bindings tagged `readonly` | `semantic-tokens`, token audit's `readonly` invariant |
| 17 | A directive swallows the unused-local fade | `editor-features` |
| 18 | A directive blinded its whole indented block | `check`'s head-line-only case |
| 19 | Inline render-block directive lost from the face | `check`'s inline component-prop and two-way-bind directive cases; audit `verdict` |
| 20 | Render branch/loop bodies unchecked (`ctx`, loop items) | `check`'s typed-factory-params case; audit `strict` (13-components' render branches and loops) |
| 21 | Identifier reads carried no source span — hover, definition, diagnostics and tokens all resolved through a cover | `mapping`, audit `census`/`identity` |
| 22 | Completion and signature help fired exactly where the compile died — a trailing dot in the parser, an open call in the lexer before the parser ran | `incomplete-expression` (inverted): compile-level repair-driver pins plus barriered editor requests for the member list at a bare dot and signature help in an open call; every recovered request asserts the buffer's own rejection. `arrival` owns the no-barrier debounce probes. `editor-features` owns positional quick-fix edits and whole-file rename. The batch checker still exits non-zero. |
| 23 | An in-face value declaration could have retired the Tier 3 pin probe | none — closed by ruling, refused on measurement; the reasoning that would re-propose it is answered in pins.js, where it would be built |
| 24 | A `schema` block's implicit `it` untyped | audit `strict` (14-schema's transforms); `schema-types`' transform case |
| 25 | Event handler parameters get no event type | `check`'s handler case; `dom-vocab-lib` |
| 26 | The match operator's emission was never null-clean | `check`, `tsface` |
| 27 | A pattern catch destructured `unknown` | `check`, audit `verdict` (07-exceptions), `tsface` |
| 28 | A postfix cast on an inline try body detached the catch arm | audit `compiles`, `verdict` |
| 29 | `new` on an optional chain emitted an unconstructable spelling | audit `verdict`/`runtime`/`strict`, `battery` (classes.rip) |
| 30 | `new` on a tagged template leaked the sexpr head | audit `compiles`/`verdict`/`runtime`, and `battery` (classes.rip) pinning the bytes; the parked production cleared |
| 31 | A promoted param declared no field on the checked face | `check` (08-functions) |
| 32 | Reassigning an exported plain binding double-declared | `battery` (modules.rip) |
| 33 | An enum name's semantic token said `type`, not `enum` | audit `type`, `contract.js` (the enum reason clause deleted) |
| 34 | The bare `~>` operator hovered the runtime's machinery | audit `silence` |
| 35 | A wrong `:=`/`~=` initializer published twice, in lowering vocabulary | the Diagnostics Audit's codes and positions on 12-reactive, via `contract.js` — both reactive lines DERIVED, the twin spelling the call each lowers to, and their two `error-pins.json` entries deleted; plus `tsface` region shapes and `generated-scopes` |
| 36 | A reactive import served the raw cell, with no stated contract | `reactive-imports` |
| 37 | A state write site kept the lowering's `readonly` color | audit `readonly`, `contract.js` (the readonly reason clause deleted) |
| 38 | Render-DSL positions hovered the lowering's scaffold | audit `ruled` (`hover-pins.json`) |
| 39 | A component member's declaration hovered the container wrapper | audit `ruled` (`hover-pins.json`) |
| 40 | A component member's initializer and in-method writes were never type-checked | `check`, `error-pins.json` (13-components) |
| 41 | A forward-referenced class or component pinned the probe's own symbol — TS2304 on legal code | `check`, `pins` |
| 42 | A wrong-typed schema default was never type-checked | `check`, `error-pins.json` (14-schema) |
| 43 | A schema callable's output typed unknown | audit `verdict`/`strict` (14-schema) |
| 44 | A `:mixin` declaration hovered the runtime's machinery | audit hover parity (`hover-pins.json` declaration pin), `schema-types` |
| 45 | A type predicate in a type body collided with rip's `is` | audit `compiles`, `dts-tsc`, and `types`' predicate-admission rows |
| 46 | A mapped type rejected by the type-body validator | audit `compiles`/`census`, `types` |
| 47 | Census blind to indented type declarations | `runner.js` (the type-vocabulary census) — soft |
| 48 | A method member in an inline type body rejected | audit `compiles` and `types`' shorthand-admission rows |
| 49 | An import type could not name a `.rip` module | audit `verdict` (11-types) |
| 50 | A rewritten literal widened its neighbours' diagnostics to the whole element list | `mapping`, `contract.js` (the element-position reason clause deleted) |
| 51 | A value word names a binding — every read became the literal, silently | `battery` (value-words.rip): rejection rows for every annotated binding site, property-position rows for the legal negative space |
| 52 | A destructured binding read by a hoisted def was implicitly `any` under strict | `check`, audit `strict` (20-inference) |
| 53 | A paren-injected call's arity error lands on the wrong argument | the Diagnostics Audit, position rows on 02-operations |
| 54 | A generic component's shipped declarations referenced a type parameter they never declared | `dts-tsc` |
| 55 | A computed member's type came from its expression's FORM, so most bodies typed `any` | audit `verdict`/`strict` |
| 57 | A void-marked binding's declaration split, so its token read `variable` | audit `type`, `contract.js` (the reason clause deleted) |
| 58 | A classed SVG element emitted an unclosed call | audit `runtime`/`verdict`/`strict` |
| 59 | A type predicate shipped as `==` in the emitted declarations | `dts-tsc` |
| 60 | A value word in a destructuring pattern bound — the module did not parse | `battery` (value-words.rip): rejection rows for every pattern form, negative-space rows for ordinary names |
| 61 | A constructor body's `@field =` declared no field, so every read of it rejected | `check` |
| 62 | An unannotated computed member's face type named the lowering | `hover-pins.json`, audit `ruled` — limit: a component nested in a FUNCTION keeps the form table's any, because the behavior object the inferred position reads is emitted only for a module-scope named component; the projection never reached that shape either |
| 63 | A forward-referenced class binding lost its class color | `semantic-tokens` |
