# Type-audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip**: every expectation in it was authored, so it can only ever check what its author already knew — which is why the suite was green through every finding recorded here, and why almost every body below carries a *"why the suite missed it"* paragraph. The type audit verifies rip against **TypeScript**, using oracles this repo does not control: the hand-written twin, whose answer *is* TypeScript's; the `.rip` source's own grammar; the fixtures' own `@ts-expect-error` markers. That is why it can discover, why it cannot be a pass/fail gate (a differential against an outside reference has legitimate divergences as well as real gaps), and why its output is a categorized score rather than a boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. Some gates are red *by design* (#20, #24, #25, #21, #8) and their rows stay until they flip — read each row's Gate cell, because a red gate does not always track only its own finding (#20's does not). One row (#23) can never have a gate at all: it is a design question, and its exit is a ruling rather than a green run.

**IDs are doc-internal** — they name a row so another row can cite it, and nothing outside this file cites one: a row is engineered to disappear, so a pointer to it from code, which is permanent, is a reference built to rot. [findings.test.js](../toolchain/findings.test.js) enforces that and explains the rest when it fails. Never reused or renumbered — the commit that filed a finding is its durable provenance, and reusing a number makes that log lie rather than merely dangle.

**Tags group by root** — `compiler` (parser/emitter) · `strict` (implicit-any & safety) · `directive` (the `@ts-expect-error` family) · `hoist` · `config` · `editor` · `capability`. They are **labels, not partitions**: a row that shares a fix with two roots carries both. #21 spans type bodies and component reads under one root and would be torn in half by any scheme that filed each row in exactly one bucket. **Order is a signal, not a container.**

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** A **vs v3** line records what the typed editor did before the tsgo/LSP broker replaced v3's in-process LanguageService — the root almost every gap here traces back to. Each was established by driving v3, still reachable at 3.17.5 (`~/Code/shreeve/rip-lang`). It survives on an open row because it argues about a fix not yet made; it dies with the body when the row closes. This repo is **v4, cleaned up**; "v4" in a body means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-07-16. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree. The audit itself is `bun run type-audit` (`--help` for what each of its three audits is judged against, and for the one trap worth knowing before you touch `--update-hovers`). The wider editor surface — completions, definition, references, rename, code actions — is covered by the extension's own suite in `packages/vscode/test/`, not here.

**How gates go blind.** Every rule below was earned by a green suite sitting through a real defect. They are the failure modes to write a *new* gate against — the findings are their worked examples, not the other way round.

- **A fixture that cannot fail a dimension is not covering it.** 09's `RenderCondTest` exercises every render branch form and puts a string literal in every body — a body that *cannot* carry a type error. The fixture proved the conditions were checked and said nothing about the bodies, while its section header claimed render-block expressions were type-checked generally (#20).
- **A differential claim needs a differential test.** A config surface no harness ever writes is invisible to that harness: the runner copies only `tsconfig.json` into its workspace and never a `package.json`, so `rip.strict` was false in every run and the flag sat inert — wired in source, exercised by nothing (#1).
- **Position fidelity is not content fidelity.** A gate can assert a payload lands in the right place and stay green through the entire life of a defect in what it *says*. The semantic-token surface was watched for position and unwatched for meaning; no test had ever asserted a modifier (#15).
- **A floor is not a description.** `verdict` counts Error-severity diagnostics only, so everything above that floor — the hint and suggestion classes — is invisible to it, and its silence is a statement about what it counts rather than about the payload (#17).
- **Driven is not asserted.** Exercising a feature only at the position where it works, never at the position where it is used, is the sharpest form of this: completion is tested at `msg.sub` and signature help at a closed `pick(1, 2)` — the two states that parse, and the two states nobody is in when they need the feature (#22).
- **A fixture's prose is not a gate.** 09-components.rip carries two section headers asserting contracts nothing checks — that render-block expressions are type-checked (#20), and that event handler params are typed from `__RipEvents` (#25, whose mechanism does not exist in this repo at all). Both were ported from v3 and have been read as coverage ever since. A comment claiming a behavior is a claim to *test*, not evidence.

## The road

Ordered by **how badly the editor misleads**, with one forced dependency honored. **Order is the recommendation; the ID is only a name** — a number records when a gap was found, which says nothing about what to do next.

| # | Finding | Tags | Gate |
| --- | --- | --- | --- |
| [20](#20-everything-inside-a-render-branch-is-unchecked) | Render branch/loop bodies unchecked (`ctx: any`) | `strict`, `compiler` | audit `strict` — red, but **tracks more than this finding** |
| [24](#24-a-schema-blocks-implicit-it-parameter-is-untyped) | A `schema` block's implicit `it` is untyped | `strict`, `compiler` | audit `strict` (10) — **red by design**, and 10's rows are exactly this |
| [25](#25-event-handler-parameters-get-no-event-type) | Event handler parameters get no event type | `strict`, `compiler` | audit `strict` (09) — red; 9 of 09's rows |
| [22](#22-completion-and-signature-help-fail-on-an-incomplete-expression) | Completion & signature help fail on an incomplete expression | `editor`, `compiler` | **none** — a content audit for each would catch them; neither built |
| [19](#19-a-directive-inside-a-render-block-never-reaches-the-face) | Inline render-block directive lost from the face | `directive`, `compiler` | **none** — the audit's `directives` would catch it; no fixture uses the shape |
| [18](#18-a-directive-blinds-the-whole-indented-block) | A directive blinds the whole indented block | `directive` | **none** — over-suppression is what makes `verdict` pass |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | `config` | **none** |
| [21](#21-tokens-drop-past-a-face-rewrite-on-a-cover-row) | Tokens drop past a face rewrite on a cover row | `editor`, `compiler` | audit `member` + `survival` — **red by design** |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | `capability` | `auto-import` — the gap is an **expected failure** |
| [23](#23-the-tier-3-pin-probe-cannot-be-retired-by-more-declare-in-place) | Pin probe can't be retired by more declare-in-place | `hoist` | **none possible** — a ruling, not a defect |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |

**The ranking axis is *silently wrong* over *visibly missing*.** #20, #24 and #25 let code you wrote go unchecked while the editor looks clean — the worst thing an editor can do. #22 ranks next because it is the most *felt*: it answers wrong at every dot, which is a visible failure but a constant one. Below that, #18 eats real errors but only for a directive user (medlabs writes zero), #13 mis-resolves config but only in a monorepo, and #21/#8 fail visibly and harmlessly.

**They are not, together, "the distance to `rip.strict` running clean."** Of the 188 strict errors across the corpus, these three are 55; the rest are generated scaffolding (131) and two author-annotatable params in 06. Closing every hole here leaves the `strict` dimension red. See #20's table.

**The forced edge:** #19 lands before #18. Narrowing the directive's range (#18) makes the inline render-block directive the only way to acknowledge an error inside a render element, and today that hatch works only by accident — the face never receives it (#19). #19 ranks here on #18's severity, not its own; alone it is latent.

**#20, #24 and #25 are one class, split by root.** Each is a parameter the compiler emits untyped, with user expressions typing through it, so everything it reaches is unchecked. Separate rows because the roots and the fixes differ — the render fragment's context parameter and loop signature (#20), the schema block's injected lambda parameter (#24), the event handler's parameter (#25). #20 and #24 name something the author never wrote and cannot annotate; #25's `e` the author *did* write, but the fixture's own contract says they should not have to.

**#16 is blocked**, not deprioritized: it sits last because no amount of work here moves it, not because it matters least.

## Findings

### 20. Everything inside a render branch is unchecked

Move an expression one level inside any `if` / `for` / `switch` in a render block and TypeScript stops seeing it. Same expression, same component, one indent apart:

```rip
render                              render
  div                                 div
    span count.toUpperCase()            if label
                                          span count.toUpperCase()

→ TS2339, caught                    → SILENT
```

`count` is a `number`. At render top level the bad member access is a hard error; inside a branch body it is invisible — to the editor and to `rip check` alike.

**Status.** ⬜ **Open** — no fix. **Gated, but the gate tracks more than this finding** (2026-07-14): the audit's sixth dimension, `strict` (`bun run type-audit`), runs `rip check` over the corpus with `rip.strict` on and demands zero errors. It names this in its evidence — `09-components.rip … [TS7006] Parameter 'ctx' implicitly has an 'any' type` — but **it will not go green when this closes**, and that is not a defect in the finding, it is the dimension's real scope. See the cost below.

That dimension exists because nothing else could see this. `verdict` demands zero Error-severity diagnostics, so an unchecked region is indistinguishable from a clean one — *silence is what passing looks like* — and `verdict` already runs under the strict **tsconfig**, which is a different switch entirely: tsgo emits the `TS7006` today and `mapTsDiagnostic` **drops** it (`SUPPRESSED_TS_CODES`). **The two holes compound: the implicit-any suppression hides the symptom that would have exposed this**, and un-suppressing it is the whole content of the dimension.

**Read its failures, not its ratio — four roots, and only two are this finding.** Driven 2026-07-16, `rip check` under `rip.strict`, counted per name:

| root | where | count | is it a hole? |
| --- | --- | --- | --- |
| **the context parameter** | 09's `ctx` | **30** | **yes — this finding.** User expressions type through it |
| **the loop factory's parameters** | 09's `item`/`opt`/`i`/`__item`/`__opt`/`__i` | **14** | **yes — this finding too**, and *not* costed below |
| event handler parameters | 09's `e` | 9 | yes — #25, a different root |
| generated scaffolding | 09's `__fr`/`_elN`/`_tN`/`target`/`anchor`/`detaching`/`e_` | 131 | **no.** Generated names in generated code; typing `_el2` checks nothing a user wrote |
| the schema lambda | 10's `it` | 2 | yes — #24, a different root |
| author-annotatable | 06's `title?`, `asOf` | 2 | no. Gradual typing permitting exactly what it promises |

09 carries 184 (30 + 14 + 9 + 131), and the dimension goes green only when the scaffolding is typed *and* 06 is annotated — neither of which closes a hole. **Do not read the ratio as distance to this fix.**

**The loop parameters are this finding's second half.** A loop block's factory is `create_block_0(ctx, item, i)` and its patch is `p(ctx, __item, __i)` — so `item`/`i` are the *generated signature's* parameters, which happen to carry the user's loop name. Same emitter seam as `ctx`, same untyped emission. They are a real hole: `for opt in options` over a declared `@options?: TOption[]` still leaves `opt` an implicit `any`, so every member access through it is unchecked. (`item` at 09's `for item in itemsz` is *not* evidence — `itemsz` is a deliberate typo the fixture covers with a directive, so nothing could infer an element type there. `opt` at `for opt in options` is the honest case.)

*(Aside worth its own look: much of the 131 is `let _el2, _t0;` declared-then-assigned — evolving-`let` hoist split in the emitter's *own* output, the same shape declare-in-place already solved for user code.)*

**Driven** (2026-07-14), one expression relocated, everything else held fixed:

| where `count.toUpperCase()` sits | `rip check` |
| --- | --- |
| render top level | **caught** — `TS2339` |
| inside an `if` branch | **silent** |
| inside a `for` row | **silent** |
| inside a `switch` arm | **silent** |

**Root (code).** A branch/loop body lowers to a **fragment**, and the fragment's context parameter is emitted **untyped** — [emitter.js](../../src/emitter.js), the fragment record's `self` (minted `ctx`) and the `p(ctx)` / factory signatures built from it. The face reads `p(ctx) { __effect(() => { _t0.data = ctx.count.value.toUpperCase() }) }`, so `ctx` is an implicit `any` and every member access through it is unchecked. The diagnostics that would have said so are exactly the implicit-any family rip suppresses: under `rip.strict` the face reports `TS7005`/`TS7006` — complaints about the *implicitness*, never the `TS2339` underneath.

**Scope.** Conditions, discriminants and iterables ARE checked — `if labelz`, `switch statusz`, `for item in itemsz` all fire (they are emitted in component scope, not through `ctx`), which is why [09-components.rip](fixtures/09-components.rip)'s typo directives are genuinely used. It is the **bodies** that go dark. So the checked/unchecked boundary runs straight through the middle of a render block, exactly where a reader would assume it does not.

**Cost — for `ctx`, driven, and it is three lines of type syntax** (2026-07-16). **This prices the context parameter only.** The loop factory's `item`/`i` are the same seam but not the same problem: `ctx` has a type already sitting in scope, while `item` needs the *element type of the iterable*, inferred at the emitter from a collection expression that lives in a different scope. Not costed — do not read the number below as the price of the whole finding.

`ctx` *is* the component instance: the face calls `this.create_block_0(this)` and `currentBlock.p(this)`. So the factory takes TypeScript's polymorphic `this` type, and a TS-only alias carries it across the object-literal boundary — necessary because `p` **shadows** the factory's parameter and sits inside a returned literal, where `this` would mean the block:

```ts
create_block_0(ctx: this) {
  type __Self = typeof ctx;            // TS-only; a JS capture would break the strip gate
  return { p(ctx: __Self) { … } }
}
```

Driven against the pinned tsc on the minimal relocation case: the patched face reports `TS2339: Property 'toUpperCase' does not exist on type 'number'` where the unpatched face is clean — **the fix closes the `ctx` hole**. Re-driven on the loop shape (`p(ctx, __item, __i)`, where `ctx` routes through `__reconcile` as a value): same patch, same result. *Both probes read through `ctx`, never through `item` — so they establish the `ctx` half and say nothing about the loop parameters.* **No new machinery** — the emitter already emits TS-only annotations in this exact scaffolding (`let currentBlock: any = null`, `(this as any)._first`), and both shapes the fix needs (a param annotation, a whole `type` statement) are already in the recorded region vocabulary, so strip parity holds by construction. Scale: **15 block factories in the whole corpus, all in 09**, from the fragment emission site in [emitter.js](../../src/emitter.js) — one seam, not fifteen edits.

**Why the suite missed it.** [09-components.rip](fixtures/09-components.rip) `RenderCondTest` tests every branch form — and every body it puts inside them is a string literal (`span 'label'`, `span 'ready'`, `span 'list'`), which cannot carry a type error. The fixture proves the *conditions* are checked and says nothing about the bodies, while its section header claims render-block expressions are type-checked generally.

**vs v3** — **not established.** v3 is re-drivable (3.17.5, `~/Code/shreeve/rip-lang`); nobody has put a bad expression inside a v3 render branch. Worth settling before assuming this is inherited rather than v4 drift.

### 24. A schema block's implicit `it` parameter is untyped

A `schema` block injects an implicit lambda parameter `it` (`id! -> it.Id`) and emits it **untyped**, so every member access through it is an unchecked `any`. Same class as #20's `ctx`: a name the user never wrote, cannot see, and cannot annotate — so no amount of author diligence closes it.

**Status.** ⬜ **Open** (2026-07-16) — no fix, **gated red by design** by the audit's `strict` dimension, which names it in its evidence: `10-validation.rip … [TS7006] Parameter 'it' implicitly has an 'any' type` (driven 2026-07-16, `bun run type-audit`). It goes green when the parameter carries a type.

**One class with #20, two findings.** `ctx` is the render fragment's context parameter in the components lowering, `it` is the schema block's injected lambda parameter. Different roots, different fixes, different subsystems.

**This row's gate is exact, unlike #20's.** 10-validation's *only* two strict errors are these two `it` sites, so for this fixture the dimension really does go green when the hole closes. That is a property of 10, not of the dimension — 09 carries 131 scaffolding errors that no finding will ever close. Same sentence, true here and false there; only counting per fixture told them apart.

**Not established.** Whether a bad expression *through* `it` is silently unchecked the way a render body is. The relocation probe that established #20 — same expression moved one indent, caught → silent — has not been run for the schema lambda. The `TS7006` is driven and real; the downstream consequence is inferred from the shared class, not demonstrated. **Drive it before fixing it.**

### 25. Event handler parameters get no event type

An event handler's parameter is emitted untyped, so `e` is an implicit `any` and every member access through it goes unchecked — `e.clientX` on a submit event raises nothing. [09-components.rip](fixtures/09-components.rip) documents the opposite contract, in its own comments:

> `@click: (e) -> ...` — inline, contextual typing from `__RipEvents`
> `@submit: @handleSubmit` — named, stub injects `HTMLElementEventMap` type
> The stub pre-scans the render block for `@event: @method` bindings and annotates the first untyped parameter with the event type.

**None of that machinery exists here** (driven 2026-07-16). `__RipEvents` appears nowhere in this repo *except those two comment lines*. `HTMLElementEventMap` appears nowhere in `src/` or `packages/*/src/`. And the face emits the opposite of the claim — the companion interface declares `handleSubmit(e: any): any` and the class method emits a bare `handleSubmit(e) {`, so the parameter is not merely un-inferred, it is explicitly widened.

**Status.** ⬜ **Open** (2026-07-16) — no fix. **Gated** by the audit's `strict` dimension: 9 of 09's 184 rows are `Parameter 'e' implicitly has an 'any' type`, at the named-method definitions (`handleSubmit`, `handleClick`) and at the inline handlers alike. `e` is the one compiler-untyped name in 09 that the *user* wrote, which is what separates this row from #20.

**The comment is v3's, ported verbatim.** `__RipEvents` is real in v3: rip-lang 3.17.5's `test/check.test.js` describes injecting "the event type (matching `__RipEvents`), rather than left to TS contextual typing," and v3's own `test/types/09-components.rip` carries these same comment lines. The fixture was ported; the mechanism was not. It has been asserting the contract by comment ever since.

**Not established** — three things, and the fix should wait for them:
- whether a bad member access *through* `e` is silently unchecked (inferred from `e: any`, not driven with a relocation probe the way #20 was);
- whether v3 actually types `e` (its `check.test.js` says so; nobody has driven it);
- whether an author can annotate their way out today with `(e: MouseEvent) -> …`, which decides whether this is a hole or a missing convenience.

**Why the suite missed it.** The same disease as #20, in the same fixture: a section header asserting a contract nothing tests. `verdict` cannot see it — an `any` parameter is legal TypeScript and produces no Error-severity diagnostic — and only `strict` reports it. **09-components.rip now has two false section headers**, this one and `RenderCondTest`'s, both inherited from v3, both claiming a contract the evidence contradicts. A fixture's prose is not a gate, and this corpus has been treating it as one.

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

### 21. Tokens drop past a face rewrite on a cover row

A name loses its semantic token — no classification, no modifiers — whenever it rides a coarse cover row whose byte-for-byte correspondence to the face breaks *before* it. The token surface only: types, checking, and compiled JS are unaffected. VS Code falls back to the TextMate scope (e.g. `variable.parameter.type.rip`, an ordinary variable) instead of the `property`/`variable` the semantic token would have named — whatever the theme paints each.

**Two surfaces, one root.** It drops **type-body members** (a property in a `type`/`interface` body — found first, gated first) and **use sites** (every identifier read right of the divergence — a `console.log('x:', x)` argument, a reactive `:=` read). Uses outnumber declarations, so the use-site surface is larger and the one no source enumeration reaches. Two triggers put a divergence before the name: an inline **quote rewrite** (`'circle'` → `"circle"` in `type Circle = { kind: 'circle', radius: number }`, dropping every member after it — likewise `'total:'` left of `total`), and a **block reflow** (`interface Identifiable` / `  id` → `interface Identifiable { id }`, whose inserted `{` drops *every* member, nothing preceding it).

**Status.** ⬜ **Open** (2026-07-15) — no fix, but **gated red by design** on both surfaces, by two invariants that flip green together the day the mapping fix lands:

- **`member`** ([runner.js](runner.js) `typeMembersOf`) — enumerates type-body members from SOURCE and asserts each gets a token. Presence only.
- **`survival`** ([runner.js](runner.js) `faceSurvival`) — the OTHER direction, and count-based: a dropped token's source offset is unrecoverable (past a byte divergence the map collapses to the cover-row start), so it does not correspond by position. It takes the SET of names tsgo classifies on the face, counts each name's source occurrences, and subtracts what the real server (`session.semanticTokens`) delivered — the deficit is the drop. The only invariant that reaches use sites and rip-native names, and the server is the delivery oracle, so no remap is reimplemented.

Both are red rows retired the day the fix lands, the way the `strict` gauge's `ctx` rows are. Platform-independent (a token lands or it does not), so unlike #16 they carry none of that finding's gating hazard. Each asserts the CORRECT behavior (a name *should* classify), never the bug's absence — the direction #16 warns against.

**Driven — type-body members.** Over the real server (`session.semanticTokens`) every compiling fixture: almost every block member drops; the only survivors are members that sit AHEAD of their line's divergence — a discriminated-union `kind` before its `'…'` literal, the members of a `{…}` union arm the face leaves byte-for-byte intact. The mechanism, on `type Circle = { kind: 'circle', radius: number }`:

| name | vs the `'circle'` rewrite | token |
| --- | --- | --- |
| `kind` | before | `property` ✓ |
| `radius` | after | **absent** |

Control — `type P = { a: number, b: string }`, no literal to rewrite and no block reflow: **both** `a` and `b` classify. So the trigger is the divergence, not member position; leave the body verbatim and the whole line maps. (Live tally: the audit's `member` gauge.)

**Driven — use sites.** The `survival` gauge, over the real server, confirms the same drop at reads across the corpus. Three shapes:

- **The `console.log('x:', x)` family** — the argument name drops because the single-quoted label to its left is quote-normalized on the call's coarse cover row.
- **Rip-native reactive reads** — [08-reactive.rip](fixtures/08-reactive.rip)'s `:=`/`~=` names, lowered to `.value` cells, with no column-0 declaration and **no TS twin** — the surface only this gauge can see.
- **Union arms and component reads** — a union's tag/value reads, a component's property/element reads.

**Why (code).** A type declaration emits ONE coarse `typedecl` **cover** row over its whole span, no per-identifier rows (verified with `rip --explain --face ts`): `type Circle …` is source `23:1-23:49` → face `5:1-5:50`; `interface Identifiable …` is source `[62,97)` → face `[0,40)`. So every member maps through the cover fallback, [generatedEditSpanToSource](../../packages/vscode/src/translate.js) (called by [ripSemanticTokens](../../packages/vscode/src/server.js) via `exactSpanMapper`'s miss path), whose rule is a **verbatim prefix check from the cover's start**: a token `[s,e)` maps only where source and face agree byte-for-byte from the cover start through `e`. The first divergence ends the prefix — for the inline case the quote at source `23:22`, for the block case the ` {` inserted right after `Identifiable`. Every member past that point fails the slice comparison, `generatedEditSpanToSource` returns null, and the token is dropped.

**The general shape.** Any face difference — quote normalization, block→brace reflow, added `;`, stripped indentation — before a name on a construct carried by a single coarse cover row truncates the verbatim prefix and drops every later token on it. The remap verifier itself is correct — it refuses to guess past a divergence, exactly the strictness edits and auto-import (#8) depend on — so the fix belongs upstream at the mapping seam: emit per-name exact rows (names no longer ride a cover prefix), or narrow the face rewrites (leave literals un-normalized, keep the intervening bytes verbatim). Either flips **both** gauges green — they share this one root, so neither closes alone.

**Why the suite missed it.** Every token gate was source-enumerated at declarations — `declsOf` (column-0), plus [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) and the `readonly` sweep on column-0 `:=`/`=!`/`~=` names, and [editor-features.test.js](../../packages/vscode/test/editor-features.test.js) on span fidelity. `Circle` and `total`'s *declaration* get tokens, so every gate passed while `radius` and `total`'s *use* were never in any set. The two surfaces then needed two different moves: a **wider enumeration** (`typeMembersOf`) for members, but use sites have no column-0 anchor and rip-native reads no twin, so they needed a different oracle entirely — the `survival` gauge. Source→token enumeration cannot see a use; a classified-name-vs-delivered count can.

**vs v3 — established (driven both sides, 2026-07-15).** v3 compiles to TS, runs `getEncodedSemanticClassifications`, and remaps the spans back (rip-lang 3.17.5 `packages/vscode/src/lsp.js`) — it is not remap-free, so a token surviving is a property of its remap, not of classifying on raw source. The verdict **splits by surface**:

- **Type-body members — regression.** `type Circle = { kind: 'circle', radius: number }`: v3 classifies `radius` `property`, v4 drops it. The `member` gauge tracks a genuine v4 loss — v3's remap survives the quote rewrite where v4's cover-prefix does not.
- **Use sites — mostly inherited, causes inverted.** `console.log('total:', total)`: both drop the use, so no outcome change on the common single-quoted form. But the cause is opposite — v4 drops it to quote-normalization (`console.log("total:", total)` **rescues** it in v4), while v3 drops it to the call-argument context regardless of quotes (double-quoting does **not** rescue it in v3). A bare `x = total` and a minimal reactive read (`x = clicks` off `clicks := 0`) classify in **both**. So the `console.log`-argument drops — the bulk of the `survival` count — are v3-inherited, not v4 drift.

Unsettled: 08's reactive reads drop in v4 only in render/component context (the minimal read survives both); that exact context was not reproduced on v3. Net: the **member** surface is the established v4 regression; the **use-site** surface is largely a shared, pre-existing limitation.

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Status.** ⬜ **Open** (2026-07-14). No fix has landed, but the finding is **gated** — [auto-import.test.js](../toolchain/auto-import.test.js) drives real completion requests against the server. What works is asserted green (a candidate reachable through the closure *is* offered — a genuine guard against auto-import breaking altogether; opening the orphan *does* bring it in, which is what proves the candidate set is exactly the tsgo program). The gap itself is an **expected failure** asserting the correct behavior — an unimported workspace `.rip` should be offered from cold — so it stays red by agreement while this is open and converts to a real failure the day the scope widens. Pinning the broken behavior as if it were correct would be worse than no coverage: a green test certifying the gap.

*Trap worth recording:* tsgo filters auto-import candidates **by prefix**, so a probe typed at `sh` can never offer `orphanWidget` no matter what the program contains — a gate probing the wrong prefix would "reproduce" this against a server that had it fixed. And a bare identifier statement does not map cleanly into the face and answers with no completions at all; the probe must sit in an expression position.

**Reproduced** — real server over LSP (2026-07-09): workspace with `util.rip` (reachable — `a.rip` imports it, open `app.rip` imports `a`) + `orphan.rip` (nothing imports it). Completing in `app.rip` offers `shout` from `./util.rip` [closure works] but not `orphanWidget`, which stays `TS2304` with no quickfix [the gap]. Opening `orphan.rip` makes `orphanWidget` immediately offered → candidate set = the closure, reversible only by bringing the file in.

**Why (code)** — the generated tsconfig ([mirror.js](../../packages/vscode/src/mirror.js) `generatedTsconfig`) roots its `include` at the mirror closure: `['**/*.ts', '../../**/*.d.ts']`. The reach-up matches ambient declarations only — no `.rip` mirrors — so the candidate set is exactly the tsgo program, and the program is exactly the open buffers' closure (`materializeClosure` walks only seeds and recorded imports; `pruneClosure` drops any mirror no open buffer reaches).

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

### 23. The Tier 3 pin probe cannot be retired by more declare-in-place

Declare-in-place (Tier 1) types every binding whose first assignment is top-level. A binding first assigned *inside a block* stays hoist-split, and one that is **also** read from inside a closure is an evolving `let` TypeScript declines to infer (`TS7034` — an evolving `let` serves only same-function references). The Tier 3 pin probe recovers those types by manufacturing a declaration site and hovering it ([pins.js](../../packages/vscode/src/pins.js)), in the editor and in `rip check`'s batch alike. Example: [11-inference](fixtures/11-inference.rip)'s `needle`/`hits` inside `search`.

**The two sets are disjoint by construction** — which is the whole point, and the thing most likely to be forgotten. `captureScan` records a declare-in-place site only for a **top-level** `=`; a binding is pinnable only if it **stayed hoisted** and is read in a closure. Widening declare-in-place therefore reaches none of the remainder: it shrinks the probe round's input without touching its reason, and cannot shrink it to nothing. The declare-in-place campaign *shrank* the pin pass and could never have retired it.

**Status.** ⬜ **Open** (2026-07-16) — a design question, not a defect. **Gate: none, and none is possible.** The probe round is correct; there is nothing to fail. This row's exit is a **ruling**, not a green gate — the one item here that does not leave through the door the rest do.

**The choice.** Keep the probe as the permanent mechanism for block-confined closure reads, or replace it: infer the first-write type statically onto the hoist line, in-face, so no manufactured site is needed at all — which is what v3's `patchUninitializedTypes` did. It is a **simplicity** question, not a performance one: the probe round is a small share of `rip check`'s wall-clock, which startup and tsgo's cold program build dominate. *(Treat that split as an estimate — `rip check` has no switch to disable the pin pass, so it cannot be re-measured without patching the checker.)*

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
