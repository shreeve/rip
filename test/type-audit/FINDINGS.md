# Type-audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip**: every expectation in it was authored, so it can only ever check what its author already knew — which is why the suite was green through every finding recorded here, and why almost every body below carries a *"why the suite missed it"* paragraph. The type audit verifies rip against **TypeScript**, using oracles this repo does not control: the hand-written twin, whose answer *is* TypeScript's; the `.rip` source's own grammar; the fixtures' own `@ts-expect-error` markers. That is why it can discover, why it cannot be a pass/fail gate (a differential against an outside reference has legitimate divergences as well as real gaps), and why its output is a categorized score rather than a boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. Some gates are red *by design* (#8) and their rows stay until they flip — read each row's Gate cell. One row (#23) has no gate because nothing about it fails: its exit is a ruling rather than a green run, unless the open question in its body answers yes and hands it an ordinary gate.

**A fix closes the root, and the test is where the datum lands** — into the **face**, where every consumer reads it, or into the one response. A gate cannot tell them apart: a mitigation makes its payload correct without supplying the datum that was missing. The Tier 3 probe (#23) feeds tsgo's answers back through `compile()` as pins, so **a query is not the tell** — across an out-of-process checker it is the only route to a type at all; `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) returns a reference's hover in place of an `any` and touches nothing else. Same shape, opposite verdicts. **A mitigation's residue is not the finding** — a row restated around what the workaround could not reach reads as progress, and is how a workaround becomes the architecture. Nor is the root always in the compiler (#13's is `generatedTsconfig`, #16's is inside tsgo): *upstream* is where to look, not the rule. Diagnose the root, state it in the body, and make the gate measure **that** — one aimed at a symptom can be satisfied by a patch, and eventually is.

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
| [22](#22-completion-and-signature-help-fail-on-an-incomplete-expression) | Completion & signature help fail on an incomplete expression | `editor`, `compiler` | **none** — a content audit for each would catch them; neither built |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | `capability` | `auto-import` — the gap is an **expected failure** |
| [19](#19-a-directive-inside-a-render-block-never-reaches-the-face) | Inline render-block directive lost from the face | `directive`, `compiler` | **none** — the audit's `directives` would catch it; no fixture uses the shape |
| [18](#18-a-directive-blinds-the-whole-indented-block) | A directive blinds the whole indented block | `directive` | **none** — over-suppression is what makes `verdict` pass |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | `config` | **none** |
| [23](#23-the-tier-3-pin-probe-cannot-be-retired-by-more-declare-in-place) | Pin probe can't be retired by more declare-in-place | `hoist` | **none while the probe stands** — nothing fails; one open question could hand it a gate |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |

**Everything down to #8 reaches every rip user — including one who never annotates anything.** Permissive mode still infers, so `count := 0` is a `number` whether or not you asked for one, and the remaining holes above are mode-independent where they apply.

**Within that band the axis is *silently wrong* over *visibly missing*.** #22 is the most *felt*, wrong at every dot; #8 fails visibly and harmlessly.

**Below #8 the audience collapses.** #19 and #18 eat real errors, but only for someone writing directives — medlabs writes zero. #13 mis-resolves config, but only in a monorepo. #23 reaches nobody: the probe is correct and the editor is right. **#16 is blocked**, not deprioritized — it sits last because no amount of work here moves it, not because it matters least.

**The forced edge:** #19 lands before #18. Narrowing the directive's range (#18) makes the inline render-block directive the only way to acknowledge an error inside a render element, and today that hatch works only by accident — the face never receives it (#19). #19 ranks here on #18's severity, not its own; alone it is latent.

## Findings

### 22. Completion and signature help fail on an incomplete expression

The broker builds its TypeScript face from a **successful** compile, so it can serve a request only where the source parses — but the two features whose trigger is an *incomplete* expression fire precisely where it does not. The trigger byte is the same byte that breaks the parse: type a member-access dot and pause (`items.‸`), or sit inside an open call (`add(‸`), and the buffer no longer parses, so no face carries the member-access / call context and the request has nothing to map into. rip's compiler throws where TypeScript's error-tolerant parser recovers — which is why the hand-written twin serves the correct answer on the identical incomplete text and the broker does not. What you actually get instead is nothing, or (for completion) the wrong list; the popup works only once the expression is complete enough to parse, which is backwards from how these features are used.

**Two surfaces, one root.** Member completion at a bare dot and signature help inside an open call. Both are un-parseable at the cursor (`bin/rip --ts` on `items.` → `Unexpected end of input — expected PROPERTY`; on `add(` and `add(1,` → a parse error at the `(`), so neither has a face. They differ only in fallback: completion has a statement-context one (it serves *something* wrong), signature help has none (it serves plain null).

**Status.** ⬜ **Open** (2026-07-15) — no fix, no gate. A completion content audit (twin-oracled on the item set + resolved `detail`) and a signature-help audit (on the label + `activeParameter`) would catch the two surfaces and, sharing this root, retire together the day the parse gap closes — but both are unbuilt, and the extension tests exercise only the parseable form of each (below), which is why the suite is green.

**Driven — member completion** (2026-07-15), the real server (`server.js --stdio`, `onCompletion`) against tsgo on the twin, `items` typed `number[]`, completion right after the dot:

| buffer at the dot | server | result |
| --- | --- | --- |
| `x = items.` — fresh buffer, never compiled | rip broker | **empty** — no items |
| `x = items.` — after a good compile, dot just typed | rip broker | **stale scope list** — in-scope names + ambient globals (`items`, `count`, `Date`, `Map`, …), **no members** |
| `x = items.map` — parseable | rip broker | **correct** — `map`, `filter`, `join`, … |
| `let x = items.` — same trailing dot | tsgo (twin) | **correct** — the same members |

The two broker symptoms are the two branches of the staleness guard — [onCompletion](../../packages/vscode/src/server.js) maps the cursor into the **last good face** (the version before the dot, plain statement context → the in-scope identifier list) or, on a buffer that never compiled, nothing at all. Neither is the member list; make the expression parse (`items.map`) and a real face exists, member completion then matching the twin exactly.

**Driven — signature help** (2026-07-15), the real server (`onSignatureHelp`) against the twin, `add` typed `(a: number, b: number): number`, cursor inside the call:

| call state at the cursor | server | result |
| --- | --- | --- |
| `r = add(` — unclosed, fresh | rip broker | **null** |
| `r = add(1, ` — unclosed mid-args, fresh | rip broker | **null** |
| `r = add(1, 2)` — closed, cursor inside the 2nd arg | rip broker | **correct** — `add(a: number, b: number): number`, activeParameter 1 |
| closed, then backspaced to `r = add(1, ` | rip broker | **null** (no fallback) |
| `let r = add(1, ` — unclosed mid-args | tsgo (twin) | **correct** — same label, activeParameter 1 |

Signature help is the harsher surface: with no statement-context fallback, every open-paren state returns plain null, prior compile or not. It works only on the **closed** call `add(1, 2)` — exactly when it is no longer needed — where the response passes through correctly (signatures / activeParameter untouched, the design the bodiless-overload note in `onSignatureHelp` relies on).

**Why the suite missed it.** Both tests use the **already-complete** form — the one state that has a face. Member completion is tested at `msg.sub‸` (a complete member expression; [editor-features.test.js](../../packages/vscode/test/editor-features.test.js) "member completion serves with resolve-lazy detail") and signature help at a closed `pick(1, 2)` ("active parameter indices hold across bodiless overload rows"). `msg.sub` and `pick(1, 2)` parse; `msg.` and `pick(` do not. The twin proves the correct answer was reachable on the identical incomplete text the whole time.

**vs v3 — established (driven both surfaces, 2026-07-15).** v3 type-checks in-process through the JS TypeScript LanguageService; the verdict **splits by surface**:

- **Member completion — v4 regression.** v3 serves the correct members at the bare dot — driven, fresh `x = items.` → the full `number[]` member list (40 items, `map`/`filter`/…), no prior good compile needed. Its `onCompletion` (rip-lang 3.17.5, `packages/vscode/src/lsp.js`) rewrites `word.` → `word.__rip__` before compiling, so the compiler sees a real member access, recompiling that fixed-up text on the fly (`catch {}` on failure). v4 has no such rewrite, so the dot never yields a face — the whole of the regression.
- **Signature help — split.** *Fresh* open paren is **inherited**: v3 has no equivalent open-paren fixup, so `r = add(` and `r = add(1,` compile-error (`missing )`) and return null in both. But the common interactive case — a call that *was* valid, now mid-edit — is a **v4 regression**: v3 falls back to the last good compile and `getSignatureHelpItems` still resolves the call (driven: closed `add(1, 2)` → backspace to `add(1, ` → `add(a: number, b: number): number`, activeParameter 1), where v4's stale path returns null.

### 19. A directive inside a render block never reaches the face

Place `# @ts-expect-error` on a bind/prop line *inside* a render block and the compiler drops it: the face is emitted without it. The error is still suppressed in the editor and in `rip check` — but only because `applyRipDirectives` catches it over **rip** positions. TypeScript itself never sees the directive, so the suppression rests entirely on rip's fallback pass rather than on the face.

**Status.** ⬜ **Open** — no fix. **Gate: none today, but the audit *would* catch it:** the `directives` dimension counts directives in source vs face, and the moment a fixture places one inline it goes red (`directives src=32 face=31 (lost 1)` — driven 2026-07-14, by moving [09-components.rip](fixtures/09-components.rip)'s `Input` directive onto its bind line). It is green now only because **no fixture uses the inline form** — the dimension is watching a shape nobody writes.

**Driven, and independent of #18** (2026-07-14). Reproduced with block-scoping left fully intact and only the fixture edited, so it is not an artifact of narrowing the range rule: same `directives src=32 face=31`. This is the class of directive-loss a statement-level directive used to suffer, surviving in a corner that fix did not reach: a **statement** directive now places on the head line of its lowering, but a directive *interior* to a render block has no such placement and is dropped.

**Why it matters now.** On its own it is latent — nobody writes the inline form, and rip's own pass would cover them if they did. It becomes load-bearing the moment #18 lands: narrowing the range makes the inline directive the *only* way to acknowledge an error inside a render element, and it would then be a hatch that works by accident. **Fix this first, then #18.**

### 18. A directive blinds the whole indented block

`ripDirectiveLines` governs the next statement **plus its entire indented block**. tsc governs the next **line**. So one `# @ts-expect-error` above a `def` silently absorbs every error in that function body — including bugs written later that the directive never contemplated. It is rip's directive being stronger than the thing it emulates, at the level that matters: it swallows *errors*.

**Status.** ⬜ **Open** — no fix, by decision (2026-07-14): the divergence is characterized and scoped, the semantics change is not made. **Gate: none.** The audit cannot see this at all — `verdict` demands zero Error-severity diagnostics, and over-suppression is what makes a fixture *pass*.

**Driven** (2026-07-14) — same program down both paths, the `.rip` through the editor server and a hand-written `.ts` twin through tsgo:

| | rip | tsc |
| --- | --- | --- |
| directive above a `def`, two unrelated bugs in the body | **silent** | `TS2322` ×2 + `TS2578` |
| directive above a `def`, one bug in the body | **silent** | `TS2322` + `TS2578` |
| directive above an `if`, bug inside the branch | **silent** | `TS2322` + `TS2578` |
| directive over a single-line statement *(the intended use)* | silent | silent — **match** |

Note what tsc says in every divergent row: **`TS2578`, unused directive** — its verdict is not merely "the error stays loud" but "your marker did nothing, delete it." Rip claims the directive used and eats the error.

**Why it is this way, and why that reason does not hold.** The rule's comment justifies block scope by the render case: a marker above a render element must absorb an error on the element's bind/prop lines *inside* it. Driven: that is a convenience, not a necessity. A directive placed **on the offending prop line itself** already suppresses (`Input` / `# @ts-expect-error` / `value <=> count` — the error goes), which is exactly the idiom TSX forces, since TS will not let you cover a JSX attribute from above the element either. The hatch exists without block scope. **But it is not free — see #19, which is the prerequisite.**

**Blast radius — measured, and it is one line.** medlabs uses **zero** directives, so nothing outside this repo is touched. Inside it, 129 directives across 11 files (all fixtures/tests): 124 are head-line-only; 5 govern real block content; and narrowing the rule to head-line-only for real breaks **exactly one site** — [09-components.rip](fixtures/09-components.rip), a `# @ts-expect-error` above an `Input` whose error is on the `value <=> count` bind line. The other four (`if labelz`, `unless loadingz`, `switch statusz`, `for item in itemsz`) carry their error on the head line and survive narrowing untouched. Moving that one directive onto the bind line restores `verdict` to 12/12. *(Counting trap: the range rule extends across **blank** lines too, so a one-line statement followed by a blank line looks block-scoped — a naive count says 61, and 56 of those are blank-line padding.)*

**What a fix costs.** The rule change is two lines in `ripDirectiveLines` (stop extending past the head) plus one fixture line. It must land **with #19**, not before.

### 13. Single-rooted tsconfig — no per-project resolution

Both the editor and `rip check` generate ONE tsconfig at the mirror root that `extends` only `<workspaceRoot>/tsconfig.json` ([mirror.js](../../packages/vscode/src/mirror.js) `generatedTsconfig`: `extends: '../../tsconfig.json'`, `rootDirs: ['.', '../..']`). Every `.rip` file is type-checked under the ROOT's `compilerOptions`; a nested package's own `tsconfig.json` — its `types`, `lib`, `jsx`, `strict`, `paths` — is ignored. `package.json#rip` (`strict`/`noCheck`) is already resolved per-file via `readProjectConfig` (nearest `package.json`, [config.js](../../src/config.js)), so the two config systems disagree: rip policy is per-package, tsconfig is flat. A second symptom: the editor roots the mirror at the VS Code folder while `rip check`'s `findWorkspaceRoot` walks to the nearest `package.json`/`tsconfig.json`/`.git` marker — so in a monorepo the same file can extend DIFFERENT tsconfigs in the two surfaces.

**Status.** ⬜ **Open** (no fix). The fix approach is **verified feasible** — driven against real tsgo (see below).

**The fix — one mirror, one session, per-project wrapper tsconfigs.** tsgo's LSP does per-file NEAREST-`tsconfig.json` discovery (the tsserver "configured project" model), so the single mirror tree and single tsgo session stay. Instead of one generated tsconfig at the mirror root, place a generated WRAPPER at each mirrored project dir, each `extends`-ing its source `tsconfig.json` with the same overrides (`noImplicitAny`, `noEmit`, `allowImportingTsExtensions`, `types:["*"]` unless the chain sets `types`) and reach-ups (`extends`, `rootDirs`) computed by `path.relative` instead of the hardcoded `../..`. tsgo then partitions the faces per project internally. Wrappers set their own `include`/`exclude`, so a source tsconfig's file set is not inherited (only `compilerOptions` are).

**Driven** — the real tsgo LSP, two probes:
- Two sibling dirs, one with a `strict:true` `tsconfig.json`, one governed by a loose root: `let x: string = null` reported `TS2322` ONLY under the nearest strict config; the loose file stayed clean. tsgo routes per file.
- The production shape — a nested generated wrapper `extends`-ing a strict source tsconfig via `../../../../pkg/tsconfig.json`, under one mirror root, one session: `pkg/a.rip.ts` reported `TS2322` (strict) while `root.rip.ts` stayed loose. Nested wrappers + reach-ups work.

**Blast radius.** Shared: generalize `generatedTsconfig` + add a `nearestTsconfig(dir, anchor)` walk in `mirror.js`. `rip check` ([src/check.js](../../src/check.js)): after materialization, emit one wrapper per distinct owning tsconfig — small, self-contained. Editor ([server.js](../../packages/vscode/src/server.js)): larger — emit/refresh wrappers during closure materialization and on `tsconfig.json` (or extends-chain) changes via the existing watcher; no session multiplexing. The pin pass and single-session architecture are untouched.

**vs v3** — not established. v3 *is* re-runnable, so this could be settled either way; nobody has driven a monorepo through it. Framed as a missing capability, not a driven v3 regression.

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Status.** ⬜ **Open** (2026-07-14). No fix has landed, but the finding is **gated** — [auto-import.test.js](../toolchain/auto-import.test.js) drives real completion requests against the server. What works is asserted green (a candidate reachable through the closure *is* offered — a genuine guard against auto-import breaking altogether; opening the orphan *does* bring it in, which is what proves the candidate set is exactly the tsgo program). The gap itself is an **expected failure** asserting the correct behavior — an unimported workspace `.rip` should be offered from cold — so it stays red by agreement while this is open and converts to a real failure the day the scope widens. Pinning the broken behavior as if it were correct would be worse than no coverage: a green test certifying the gap.

*Trap worth recording:* tsgo filters auto-import candidates **by prefix**, so a probe typed at `sh` can never offer `orphanWidget` no matter what the program contains — a gate probing the wrong prefix would "reproduce" this against a server that had it fixed. And a bare identifier statement does not map cleanly into the face and answers with no completions at all; the probe must sit in an expression position.

**Reproduced** — real server over LSP (2026-07-09): workspace with `util.rip` (reachable — `a.rip` imports it, open `app.rip` imports `a`) + `orphan.rip` (nothing imports it). Completing in `app.rip` offers `shout` from `./util.rip` [closure works] but not `orphanWidget`, which stays `TS2304` with no quickfix [the gap]. Opening `orphan.rip` makes `orphanWidget` immediately offered → candidate set = the closure, reversible only by bringing the file in.

**Why (code)** — the generated tsconfig ([mirror.js](../../packages/vscode/src/mirror.js) `generatedTsconfig`) roots its `include` at the mirror closure: `['**/*.ts', '../../**/*.d.ts']`. The reach-up matches ambient declarations only — no `.rip` mirrors — so the candidate set is exactly the tsgo program, and the program is exactly the open buffers' closure (`materializeClosure` walks only seeds and recorded imports; `pruneClosure` drops any mirror no open buffer reaches).

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

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
| 21 | Identifier reads carry no source span | `identifier-reads`, audit `member` |
