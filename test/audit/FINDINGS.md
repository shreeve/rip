# Audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip** — every expectation in it was authored, so it checks only what its author already knew, and it was green through every finding recorded here (hence the *"why the suite missed it"* paragraphs below). The audit verifies rip against **TypeScript**, through oracles this repo does not control — the hand-written twin, the source's own grammar, TypeScript's own diagnostics over the error lane — which is why it can discover, and why its output is a categorized diff rather than a pass/fail boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. No gate is red *by agreement* today — every contract invariant is green, so the next red is a regression rather than a queue, and a row filed from here on arrives with its gate already failing. Read each row's Gate cell anyway, because a gate does not always track only its own finding. One row (#23) has no gate because its own subject does not fail — the probe round's driven defects have closed — so #23's exit is a ruling rather than a green run, unless the open question in its body answers yes and hands it an ordinary gate.

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

**Re-driving.** `bun run test:all` — green as of 2026-07-18. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree. The audit itself is `bun run audit` (`--help` for what each audit is judged against; hover pins are hand-maintained per row — the run prints paste-ready rows for divergences, and adopting one is an explicit reviewed edit). The wider editor surface — completions, definition, references, rename, code actions — is covered by the extension's own suite in `packages/vscode/test/`, not here.

## The road

Ordered by **how many rip users a gap reaches**, then by how badly the editor misleads. **Order is the recommendation; the ID is only a name** — a number records when a gap was found, which says nothing about what to do next.

| # | Finding | Tags | Gate |
| --- | --- | --- | --- |
| [22](#22-completion-and-signature-help-fail-on-an-incomplete-expression) | Completion & signature help fail on an incomplete expression | `editor`, `compiler` | `incomplete-expression` — asserts the stale scope list at the dot and the null signature help **as the gap**, liveness-paired; it goes red the day the parse gap closes, the cue to invert it |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | `capability` | `auto-import` — the gap is an **expected failure** |
| [62](#62-an-unannotated-computed-members-face-type-names-the-lowering) | An unannotated computed member's face type names the lowering | `editor`, `compiler` | the Hover Audit's 13-components' shade position pin (`hover-pins.json`) asserts the ruled silence — green while the projection stands, and the day the face types the member from an inferred position the pin moves to the value-first answer every other member kind already serves |
| [35](#35-a-wrong--initializer-publishes-twice-in-lowering-vocabulary) | A wrong `:=`/`~=` initializer publishes twice, in lowering vocabulary | `compiler` | the Diagnostics Audit's 12-reactive pins (`error-pins.json`) assert the double **as the interim** — they go red the day the emission publishes once, the cue to retire them |
| [23](#23-an-in-face-value-declaration-could-retire-the-tier-3-pin-probe) | An in-face value declaration could retire the Tier 3 pin probe | `hoist` | **none today** — nothing fails; adoption hands it an ordinary gate (bindings still needing a pin, expect zero) |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |

**The ordering principles.** Audience first: everything down to #8 reaches every rip user, mode-independent — permissive still infers. Within a band, *silently wrong* outranks *visibly missing*: a wrong answer stated without hedging misleads, where a loud failure merely interrupts — so the loud rows (build breaks, parse errors) sink below the silent ones however broken their output is. #16 sits last because it is blocked upstream, not because it matters least. Each row's own body argues its place; this paragraph does not restate them.

**The `strict` dimension's clean run is contractual** — a red row there is a discovery, not residue; the runner's header states the curation rules.

## Findings

### 22. Completion and signature help fail on an incomplete expression

The broker builds its TypeScript face from a **successful** compile, so it can serve a request only where the source parses — but the two features whose trigger is an *incomplete* expression fire precisely where it does not. The trigger byte is the same byte that breaks the parse: type a member-access dot and pause (`items.‸`), or sit inside an open call (`add(‸`), and the buffer no longer parses, so no face carries the member-access / call context and the request has nothing to map into. rip's compiler throws where TypeScript's error-tolerant parser recovers — which is why the hand-written twin serves the correct answer on the identical incomplete text and the broker does not. What you actually get instead is nothing, or (for completion) the wrong list; the popup works only once the expression is complete enough to parse, which is backwards from how these features are used.

**Why (code) — two surfaces, one root.** Member completion at a bare dot and signature help inside an open call. Both are un-parseable at the cursor (`bin/rip --ts` on `items.` → `Unexpected end of input — expected PROPERTY`; on `add(` and `add(1,` → a parse error at the `(`), so neither has a face. They differ only in fallback: completion has a statement-context one (it serves *something* wrong), signature help has none (it serves plain null).

**The fix — an error-tolerant face, or a fixup at the cursor.** v3's dot rewrite (below) is the cheap end and is proven on this exact surface, but it is per-trigger: signature help's open paren needs its own. The general form is a parser that recovers where TypeScript's does, which serves both. **Not** by widening the staleness fallback — serving the last good face's scope list is what produces the wrong list today, and a better-chosen wrong list is still wrong.

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

**Status.** ⬜ **Open** (2026-07-15) — gated as the interim by [incomplete-expression.test.js](../toolchain/incomplete-expression.test.js): the real server driven through both surfaces, the wrong answers asserted **as the gap** — the stale scope list at the bare dot, null inside the open call — each liveness-paired in the same session with the parseable form answering correctly (the auto-import pattern, and for the same reason not `test.failing`). One nuance the gating drive added (2026-07-29): the stale face is position-sensitive — when the last good compile already carried a member access at the cursor (`x = items.map` backspaced to `x = items.`), the stale face serves the member list, the same wrong mechanism returning a luckier answer — so the gate compiles the dotless statement first, and any re-drive must too. It goes red the day the parse gap closes — the cue to invert it, not a regression. The fuller instruments (a twin-oracled completion content audit; a signature-help audit on label + `activeParameter`) stay unbuilt; the interim watches the gap until either exists.
### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Why (code) — candidacy is bound by which mirrors exist on disk.** `materializeClosure` walks only seeds and recorded imports, and `pruneClosure` deletes any mirror no open buffer reaches ([server.js](../../packages/vscode/src/server.js)) — so the candidate set is exactly the tsgo program, and the program is exactly the open buffers' closure. The generated tsconfig's `include` is **not** the constraint: `['**/*.ts', '../../**/*.d.ts']` globs the whole mirror tree and narrows nothing. Driven against real tsgo (2026-07-28): a mirror written to disk and never opened IS offered — the whole requirement is a `.ts` present inside the tree, with no didOpen, no overlay and no import edge.

**The fix — populate, do not glob.** The change belongs in mirror population and pruning, not in the tsconfig: no `include` pattern can match a mirror that was never written, and tsgo cannot read a `.rip` file, so widening the glob is inert for the headline case. The open question is how cheap a mirror can be — a full face, or a declaration-only stub — and whether it survives `pruneClosure`. v3 got a wider set free from a whole-workspace root (below), which proves one is serviceable but is **not** the shape to copy: materializing every mirror eagerly defeats the closure, which exists to bound session cost.

**Why the suite missed it.** Auto-import was exercised only through the closure, where it works. Nothing probed a file no open buffer reached, because until the mirror model existed there was no reason to think reachability could differ from workspace membership.

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

**Status.** ⬜ **Open** (2026-07-14) — gated as the interim, and **green**: [auto-import.test.js](../toolchain/auto-import.test.js) drives real completion requests against the server and asserts the gap with `not.toContain`, so the wrong behaviour is pinned deliberately, the way the closed match-operator and schema-callable rows pinned theirs. It goes red the day the scope widens, which is the cue to invert it. The expected-failure device was considered and rejected in the gate's own header: under `test.failing` any throw counts as a pass, so a server returning nothing would satisfy it — which is why every completion assertion is liveness-paired against a candidate that IS offered.
### 62. An unannotated computed member's face type names the lowering

A component's unannotated computed member is typed in the face through the lowering's own behavior object — `declare shade: { readonly value: ReturnType<typeof __Badge__computed.shade>; read(): ReturnType<typeof __Badge__computed.shade> };` — so the only type that can be spelled at that declaration names a symbol the author never wrote. RULINGS.md's register bans a machinery name as a stand-in, and the interim it prescribes is silence: the editor declines there, where every other member kind answers value-first.

**Why (code).** `memberTypeSegments` ([component-types.js](../../src/component-types.js)) reads an unannotated computed's type from its BODY, which the face carries a second time in a module-scope behavior object beside the component's companion interface, and projects it back with `ReturnType<typeof …>`. That projection is what gives these members a real inferred type at all — the form table it replaced typed most bodies `any` (the closed computed-form row) — so this is the cost of that fix, not a regression it introduced.

**Why the editor cannot present past it.** TypeScript's quickinfo echoes a declaration's TYPE NODE verbatim: driven against tsgo 2026-07-30 on a two-member probe, both `ReturnType<typeof f>` and an inlined `extends … infer R` conditional print exactly as written, resolved neither time. So no server-side rewrite reaches the underlying type — the answer has to be resolved before the annotation is written, which the compiler cannot do.

**The fix — type the member from an INFERRED position.** A declaration with no type node has nothing to echo, so TypeScript prints the resolved type. v3 reaches that by construction: its shadow emits the computed as a class FIELD WITH ITS INITIALIZER — `shade = __computed(() => ((this.tone.value === "warn") ? "#a60" : "#06f"))` (driven 2026-07-30, `rip --shadow`) — where `this` is already the class and no annotation exists. v4 assigns members in `_init` instead, so its face has no inferred position to hang the body on, and the behavior object exists to give that body a typed `this` while the JS emission stays byte-identical. The fix is a face-side inferred spelling for the member, not a change to the projection's name — renaming machinery keeps it machinery.

**Why the suite missed it.** The projection is younger than the pin: while the member declaration served the container wrapper, every member's pin was null and the computed's null was indistinguishable from the rest. It became visible only when the other kinds started serving their value.

**vs v3 — the gap is v4-only** (v3's face driven 2026-07-30; its LSP was not, so the served answer is not claimed). v3 has no projection to leak: the field-initializer shadow above gives the member an inferred type with no minted name anywhere in it.

**Status.** ⬜ **Open** (2026-07-30) — gated as the ruled interim: the Hover Audit's 13-components' shade position pin (`hover-pins.json`) asserts null, green while the projection stands. The day the face types the member from an inferred position, the pin moves to the value-first answer every other member kind already serves.

### 35. A wrong `:=`/`~=` initializer publishes twice, in lowering vocabulary

One wrong line, two squiggles — and the first one talks emission. `wrongState: number := 'oops'` publishes **TS2322 on the name**, whose message reads `Type '{ value: string; read(): string; }' is not assignable to type '{ value: number; read(): number; }'` — the cell wrapper, the vocabulary the hover surface was explicitly cured of when the reactive-hover row closed — **plus TS1360 on the literal**, from the `satisfies` guard the state lowering plants (`__state('oops' satisfies number)`). The computed spelling doubles the same way (TS2322 on the name in wrapper prose, a second value-level TS2322 on the expression). `=!` and an annotated effect publish once, cleanly — driven 2026-07-23, `rip check --json` across all four operators. The positions are right and the errors are real; what misleads is the count and the prose.

**Why (code) — the emission's redundant guard, not the annotation.** The annotated cell type already carries the constraint (it alone produces the name-anchored TS2322); the `satisfies` on the initializer re-states it and produces the second. The prose half is the same doctrine as the closed reactive-hover row: the user's error should speak value types, which the cell's structural assignability message does not.

**The fix is NOT dropping the guard** — driven 2026-07-29 and reverted. The guard is not duplication: it is the only source of the VALUE-TYPED diagnostic, and dropping it leaves exactly the cell-wrapper publish this row objects to. On `entry: [string, number] := ['a', 'b']` the guard's diagnostic reads `Type 'string' is not assignable to type 'number'` anchored ON the offending element, while the annotated cell type's reads five levels of wrapper prose anchored on the name. Removing the guard halves the count and deletes the useful half, so it trades this row's prose complaint for a worse one — and it is the element-anchored diagnostic that the same batch's span-narrowing row was busy adding for plain literals.

**The road out is explicit type arguments, and its blocker is gone.** `__state<T>(…)` / `__computed<T>(…)` deliver the target — one diagnostic, value-typed, anchored on the value — and needed the runtime destructure in component-carrying files typed, which the closed member-initializer row did. One thing changed with it: `__state`'s signature now admits an existing cell in its ARGUMENT (`T | {value: T; read(): T}` — the prop delivery seam legitimately passes one), so an explicit type argument's rejection names that union rather than the bare type, and the prose half of this row is not free. Note for whoever lands it: the expectations need re-deriving PER SPELLING, not by one code swap — driven against the runtime's generic signature, the scalar state spelling's name-anchored TS2322 becomes TS2345 on the value, while `~=` and the array/tuple spellings keep TS2322 and move from the name to the value or the element. The count halves in every case.

**The element anchor is not this row's to keep.** The guard's diagnostic lands on the offending element only because the rewritten-literal row's span narrowing put it there; before that fix the same diagnostic spanned the whole element list. So the two are coupled — a future change to either moves this row's evidence.

**Why the suite missed it.** A directive consumes however many diagnostics land on its line — a double publishes, the marker fires, green — so marker-based negatives structurally cannot see a double. The Diagnostics Audit is the first instrument that asserts each published diagnostic individually, and deriving 12-reactive's error pair is what surfaced both the double and the prose.

**vs v3 — regression on both halves** (driven both sides, 2026-07-28, the same `wrongState: number := 'oops'`). v3 publishes **once**, and in value vocabulary: a single TS2322 reading *Type 'string' is not assignable to type 'number'*. So neither the count nor the prose is inherited — v3 plants no `satisfies` guard on the initializer and its message never mentions a cell. The fix's shape is therefore already demonstrated rather than merely argued for — but v3 reaches it by planting no guard AND typing the initializer, not by dropping a guard alone.

**Status.** ⬜ **Open** (2026-07-23) — gated as the interim: the Diagnostics Audit's 12-reactive pins (`error-pins.json`) assert the measured double — code and position, the hover-pins discipline — so the lane is green while the behavior stands and flips loudly the day it changes. The twin-derivable rows beside them (`=!`, effect, the TS2588 write) stay derived and are not this row's subject. **The gate's scope is the count, not the prose:** the lane asserts codes and positions, and no instrument asserts message text — so an emission change that keeps both diagnostics but cleans the wrapper vocabulary flips nothing, and one that halves the count while keeping the wrapper flips the lane green having made the user's diagnostic worse. That is not hypothetical: it was driven and reverted on 2026-07-29, which is why the fix slot above now rules the guard's removal out. The prose claim must be re-driven by hand for this row to close, whatever the count does.

### 23. An in-face value declaration could retire the Tier 3 pin probe

A binding that stays hoist-split and is **also** read from inside a closure is an evolving `let` TypeScript declines to infer (`TS7034` — an evolving `let` serves only same-function references), so no site in the real face knows its type. The Tier 3 pin probe recovers those types by manufacturing a declaration site, hovering it ([pins.js](../../packages/vscode/src/pins.js)), and feeding the answer back through `compile()` as a pin — in the editor and in `rip check`'s batch alike, so the type lands in the **face** where every consumer reads it.

**The alternative works, and that is new.** A TS-only value declaration ahead of the hoist line — `const __p0 = <first-write RHS>; let x: typeof __p0;` — types the binding with no round trip at all. Driven 2026-07-28 against the repo's pinned TypeScript (7.0.2): the object case infers and its negative fires (TS2322), and so does the **class-expression** case (TS2339 on a bad member), which is the shape that makes the forward-reference row publish a dangling probe symbol. So the probe is not the only route to a type — it is the only route the current face shape leaves.

**Why (code) — what keeps a binding hoisted, and what the alternative needs.** `captureScan`'s safety rule ([emitter.js](../../src/emitter.js)) has three clauses; driven over this repo and medlabs, roughly a third of pinnable bindings are held solely by the third — any name touched inside a hoisted `def`, because a `def` is callable from above its own statement — and roughly two thirds by first-occurrence or placement, dominated by forward-referenced and recursive helpers. Neither group can declare in place: the write genuinely may not have run. The in-face declaration sidesteps that entirely by typing from the RHS rather than from the write's position, which is why it reaches cases widening never could.

**The fix — settle the strip gate, then adopt or rule.** Two things remain unproven, both narrow: the strip gate must admit a stripped TS-only value declaration (a JS capture would break it), and the RHS must resolve in the declaring scope — true of the constants that dominate the population, false where it reads a block-local. A third is cosmetic and real: the type prints as the minted name (`typeof __p0`), so hover leaks machinery unless aliased. **Not** by widening declare-in-place — driven, that reaches only self-referential function-expression writes, and the `def` hazard it declines is genuine.

**Why the suite missed it.** Nothing missed anything: no gate can fail while the probe works, which is why this row's exit was a ruling until the alternative was driven.

**vs v3 — not a choice to weigh.** `patchUninitializedTypes` (rip-lang 3.17.5, `src/typecheck.js`) does not infer a type onto the hoist line: it takes the `ts` module and the live LanguageService, calls `checker.getSymbolAtLocation`, and injects types by mutating binder symbols on DocumentRegistry-shared SourceFiles — its own comment records the price, symbols released by hand or "every rebuilt program leaks (~50MB/compile → GBs over an editing session)". The tsgo broker is a separate process spoken to over LSP: no `ts` module, no `Program`, no symbol to mutate. So v3's mechanism is unavailable here, and the in-face declaration is the portable alternative it never needed.

**Status.** ⬜ **Open** (2026-07-17) — **no gate today, and an ordinary one on adoption**: count the bindings still needing a pin, expect zero. The row closes by adopting the in-face declaration or by ruling it out on the strip gate; either way it leaves through the same door as every other row. Adopting it would also dissolve the forward-reference row, which exists only because a probe symbol can be pinned — a fixer taking this route is closing two rows and would learn that from neither.

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
| 9 | Write-only locals hover any | hover audit's not-any invariant |
| 10 | Reactive bindings hover cell wrapper | hover audit + `hover-pins.json` |
| 11 | Config changes required a reload | `config-reactivity` |
| 12 | `rip.noCheck` parsed but never applied | `config-reactivity` |
| 14 | Unused `@ts-expect-error` silently swallowed | `check` |
| 15 | Reactive `:=` bindings tagged `readonly` | `semantic-tokens`, token audit's `readonly` invariant |
| 17 | A directive swallows the unused-local fade | `editor-features` |
| 18 | A directive blinded its whole indented block | `check`'s head-line-only case |
| 19 | Inline render-block directive lost from the face | `check`'s inline component-prop and two-way-bind directive cases; audit `verdict` |
| 20 | Render branch/loop bodies unchecked (`ctx`, loop items) | `check`'s typed-factory-params case; audit `strict` (13-components' render branches and loops) |
| 24 | A `schema` block's implicit `it` untyped | audit `strict` (14-schema's transforms); `schema-types`' transform case |
| 25 | Event handler parameters get no event type | `check`'s handler case; `dom-vocab-lib` |
| 47 | Census blind to indented type declarations | `runner.js` (the type-vocabulary census) — soft |
| 51 | A value word names a binding — every read became the literal, silently | `battery` (value-words.rip): rejection rows for every annotated binding site, property-position rows for the legal negative space |
| 60 | A value word in a destructuring pattern bound — the module did not parse | `battery` (value-words.rip): rejection rows for every pattern form, negative-space rows for ordinary names |
| 53 | A paren-injected call's arity error lands on the wrong argument | the Diagnostics Audit, position rows on 02-operations |
| 59 | A type predicate shipped as `==` in the emitted declarations | `dts-tsc` |
| 45 | A type predicate in a type body collided with rip's `is` | audit `compiles`, `dts-tsc`, and `types`' predicate-admission rows |
| 46 | A mapped type rejected by the type-body validator | audit `compiles`/`census`, `types` |
| 48 | A method member in an inline type body rejected | audit `compiles` and `types`' shorthand-admission rows |
| 28 | A postfix cast on an inline try body detached the catch arm | audit `compiles`, `verdict` |
| 58 | A classed SVG element emitted an unclosed call | audit `runtime`/`verdict`/`strict` |
| 30 | `new` on a tagged template leaked the sexpr head | audit `compiles`/`verdict`/`runtime`, and `battery` (classes.rip) pinning the bytes; the parked production cleared |
| 29 | `new` on an optional chain emitted an unconstructable spelling | audit `verdict`/`runtime`/`strict`, `battery` (classes.rip) |
| 57 | A void-marked binding's declaration split, so its token read `variable` | audit `type`, `contract.js` (the reason clause deleted) |
| 50 | A rewritten literal widened its neighbours' diagnostics to the whole element list | `mapping`, `contract.js` (the element-position reason clause deleted) |
| 31 | A promoted param declared no field on the checked face | `check` (08-functions) |
| 27 | A pattern catch destructured `unknown` | `check`, audit `verdict` (07-exceptions), `tsface` |
| 26 | The match operator's emission was never null-clean | `check`, `tsface` |
| 32 | Reassigning an exported plain binding double-declared | `battery` (modules.rip) |
| 54 | A generic component's shipped declarations referenced a type parameter they never declared | `dts-tsc` |
| 40 | A component member's initializer and in-method writes were never type-checked | `check`, `error-pins.json` (13-components) |
| 42 | A wrong-typed schema default was never type-checked | `check`, `error-pins.json` (14-schema) |
| 43 | A schema callable's output typed unknown | audit `verdict`/`strict` (14-schema) |
| 55 | A computed member's type came from its expression's FORM, so most bodies typed `any` | audit `verdict`/`strict` |
| 49 | An import type could not name a `.rip` module | audit `verdict` (11-types) |
| 61 | A constructor body's `@field =` declared no field, so every read of it rejected | `check` |
| 34 | The bare `~>` operator hovered the runtime's machinery | audit `silence` |
| 38 | Render-DSL positions hovered the lowering's scaffold | audit `ruled` (`hover-pins.json`) |
| 39 | A component member's declaration hovered the container wrapper | audit `ruled` (`hover-pins.json`) |
| 33 | An enum name's semantic token said `type`, not `enum` | audit `type`, `contract.js` (the enum reason clause deleted) |
| 44 | A `:mixin` declaration hovered the runtime's machinery | audit `ruled` (`hover-pins.json`), `schema-types` |
| 13 | Single-rooted tsconfig — a nested project's own config was ignored | `check`, `editor-gaps-synthetic-project` |
| 37 | A state write site kept the lowering's `readonly` color | audit `readonly`, `contract.js` (the readonly reason clause deleted) |
| 21 | Identifier reads carried no source span — hover, definition, diagnostics and tokens all resolved through a cover | `mapping`, audit `census`/`identity` |
| 41 | A forward-referenced class or component pinned the probe's own symbol — TS2304 on legal code | `check`, `pins` |
| 52 | A destructured binding read by a hoisted def was implicitly `any` under strict | `check`, audit `strict` (20-inference) |
| 63 | A forward-referenced class binding lost its class color | `semantic-tokens` |
| 36 | A reactive import served the raw cell, with no stated contract | `reactive-imports` |
