# Type-audit findings — gaps in rip's typed-editor story

> **No finding here has been verified against this code.** Fixes have landed for most of them; the statuses below say only what someone actually ran.
>
> **No line numbers.** Code is cited by file and symbol name — greppable, and it does not rot. (The rip-v4 line anchors this ledger used to carry were stale on arrival — most pointed into a differently-shaped file.)
>
> The **vs v3** comparisons throughout were established by driving v3 (the rip-lang repo) before its retirement — historical, not re-runnable. This repo is **v4, cleaned up**; the bodies' "v4" means the code here.

Each finding's body is the original audit snapshot (hence present-tense, even where a fix has landed); the **Status** line under each heading is the current truth.

**Evidence tags.** A status carries a tag only if someone ran the thing. **No tag means it has not been checked** — there is no tag for "we believe this."

| Tag | Meaning |
| --- | --- |
| **[driven]** | The real tool, run programmatically — the compiler CLI, or the real editor server over LSP (what `runner.js` does). Settles compile/emit questions outright. For editor surfaces it settles the *payload* — a `textDocument/hover` response is the text VS Code renders — but not the client glue around it, and it reaches nothing the runner does not request. |
| **[editor]** | Checked by hand in a live VS Code session. Required wherever the claim is about the session itself rather than a payload: config reactivity, watcher-driven refresh, "no window reload," completions offered as you type. |

**What the runner does and does not reach.** It drives the real server, so hovers (twin-oracle checked, with 6 residual pins in `hover-pins.json`) and diagnostics (dim 3) are genuinely instrumented — a green run there is real evidence, not theater. But it issues **no completion request** and performs **no `package.json` edit or `didChangeWatchedFiles` notification**, so **#8, #11, and #12 have no harness coverage at all** and can only be established `[editor]`.

**Statuses** — `🟡 Fix landed, unverified` (the code is in; nobody has watched it work) · `⬜ Open` (no fix) · `✅ Verified`. **Nothing is `✅`.**

## Summary

**Settles it** names the weakest instrument that *could* establish the finding — a fact about the claim and the runner's reach. It is not a tag: bracketed `[driven]`/`[editor]` mean evidence someone actually produced, and no status carries one.

| # | Finding | Class | Status | Settles it |
| --- | --- | --- | --- | --- |
| [C1](#c1-optional-marker-rejected) | Optional `?` marker rejected | Compiler blocker | 🟡 Fix landed, unverified | driven — compile/emit |
| [C2](#c2-method-shorthand-in-type-body-rejected) | Method-shorthand in type body rejected | Compiler blocker | 🟡 Fix landed, unverified | driven — compile/emit |
| [1](#1-implicit-any-suppressed-with-no-opt-out) | Implicit-any suppressed, no opt-out | Silent safety hole | 🟡 Fix landed, unverified | driven — verdict (dim 3) |
| [2](#2-use-before-assign-hidden-on-annotated-forwards) | Use-before-assign hidden by `!` | Silent safety hole | 🟡 Fix landed, unverified | driven — verdict (dim 3) |
| [3](#3-reactive-binding-annotations-not-enforced) | Reactive annotations not enforced | Silent safety hole | 🟡 Fix landed, unverified | driven — verdict (dim 3) |
| [4](#4-evolving-let-reassignment-not-caught) | Evolving-`let` reassignment not caught | Silent safety hole | 🟡 Fix landed, unverified | driven — verdict (dim 3) |
| [5](#5-typeof-on-an-unannotated-value-resolves-to-undefined) | `typeof` unannotated → `undefined` | Loud correctness | 🟡 Fix landed, unverified | driven — verdict (dim 3) |
| [6](#6-ts-expect-error-dropped-on-multi-line-emit) | `@ts-expect-error` dropped on multi-line | Loud correctness | 🟡 Fix landed, unverified | driven — face bytes |
| [7](#7-no-headless-type-checker-rip-check) | No headless `rip check` | Missing capability | ⬜ Open | — (a build, not a check) |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | Missing capability | ⬜ Open | **editor** — no harness coverage |
| [9](#9-write-only-unannotated-locals-hover-any) | Write-only locals hover `any` | Hover DX | 🟡 Fix landed, unverified | driven — hover audit, oracle-free not-`any` invariant |
| [10](#10-reactive-bindings-hover-as-their-cell-wrapper) | Reactive bindings hover cell wrapper | Hover DX | 🟡 Fix landed, unverified | **editor** — rip-native, no oracle |
| [11](#11-config-changes-required-a-reload) | Config changes required a reload | Config surface | 🟡 Fix landed, unverified | **editor** — no harness coverage |
| [12](#12-nocheck-parsed-but-never-applied) | `rip.noCheck` parsed but never applied | Config surface | 🟡 Fix landed, unverified | **editor** — no harness coverage |

## Compiler-coverage gaps — file won't compile (hard blockers)

More severe than every editor-layer regression below: these produce **no face at all**, so the file is dark to the whole typed-editor pipeline (no diagnostics, hover, or completion — there is nothing downstream to run). All four affected fixtures are v3's own `test/types` files, ported verbatim; **v3 compiles all four** (`bin/rip -c` → EXIT 0 each, driven against v3), so each is a straight regression. Two nameable parser holes account for all four.

### C1. Optional marker rejected

rip's parser rejects the TS-optional `?` suffix wherever v3 accepted it — on both type-body property members and `def`/function parameters. Any type, interface, or signature that marks a member or param optional fails to compile.

**Status.** 🟡 **Fix landed, unverified.** Compile/emit finding, so `[driven]` settles it; it has not been driven against this code.

- **Face** — `bin/rip --ts` on 03/05/06 should carry the `?`.
- **`.d.ts` optional params (C1-dts)** — `dts.js` reads the `optionalMarker` role (shared `renderParam`): typed `title?: string` keeps the `?`, bare `title?: any` (a declaration can't carry an implicit any).
- **`.d.ts` generics (generics-dts)** — declarations emit the `<T, …>` clause from the `typeParams` role, so a generic `def` references `T` in scope instead of `TS2304`.

Note: under `rip.strict` a bare optional param (`title?`, no type) flags `TS7006` on the face — a regression vs v3 (which emitted `title?: any` and stayed strict-clean). The face-side fix (emit `title?: any`, matching the `.d.ts`) is deferred to the strict-audit campaign.

**Reproduced** — two surfaces (pre-fix output; a fix has landed, unverified — see Status): type-body members ([03-structural.rip](fixtures/03-structural.rip) `ssl?: boolean`, [05-interfaces.rip](fixtures/05-interfaces.rip) `method?: string`) and params ([06-functions.rip](fixtures/06-functions.rip) `title?: string`).
```
$ bin/rip --ts test/type-audit/fixtures/03-structural.rip
03-structural.rip:12:6: code expression ('?') in a type body — types erase and cannot execute
$ bin/rip --ts test/type-audit/fixtures/06-functions.rip
06-functions.rip:40:40: Unexpected '{' … expected … ?
```

**vs v3** — compiles all three (driven, EXIT 0 above) and emits the `?` into the `.d.ts` (`title?: string`), per the fixtures' own comments ([06-functions.rip](fixtures/06-functions.rip)).

### C2. Method shorthand in type body rejected

A type/interface body accepts only property-style members (`name: type`); it has no grammar for the `name(args): ret` method-signature shorthand, so any object type declaring a method fails to compile.

**Status.** 🟡 **Fix landed, unverified.** Face and `.d.ts` should both render the shorthand, and the isolated `.d.ts` should pass `tsc --strict`. The fix sits in the shared `typetext.js` seam (which `dts.js` also uses), making it the positive control for C1's drift. Compile/emit finding, so `[driven]` settles it.

**Reproduced** — [09-components.rip](fixtures/09-components.rip): `addItem(item: CartItem): void` inside `export type Cart =` (pre-fix output; a fix has landed, unverified).
```
$ bin/rip --ts test/type-audit/fixtures/09-components.rip
09-components.rip:273:10: code expression ('(') in a type body — types erase and cannot execute
```

**vs v3** — compiles it (EXIT 0) and preserves the shorthand as a real method signature in its `.d.ts` — `addItem(item: CartItem): void;` (driven against v3). The `.tsx` twin ([09-components.tsx](fixtures/09-components.tsx)) expresses the same member as a property arrow type (`addItem: (item: CartItem) => void`) — the TS-equivalent, not the shorthand form.

## Regressions vs v3 (v4 behind v3)

v4 is behind v3 here — consequences of the tsgo/LSP broker and the strip-gated face replacing v3's in-process LanguageService and its free-form type-checking shadow. **Ordered most-severe first:** silent, no-opt-out safety holes a strict project can't recover (1–4) → loud correctness breaks on valid typed code (5–6) → missing/degraded capabilities (7–8) → hover DX degradations (9–10).

> The *gaps* below were driven against rip-v4. The **fix statuses** are what is unverified — none of #1–#6, #9, or #10 has been re-run against this code.

### 1. Implicit-any suppressed with no opt-out

v4 drops the entire implicit-any diagnostic family (`TS7005`–`7053`) for ALL code, with no config to re-enable it. A project that wants strict `noImplicitAny` enforcement cannot get it: an unannotated function parameter is silently `any` and its misuse goes unchecked (any-propagation). Real type errors (`TS2322`/`2339`/`2345`) are unaffected — only the missing-annotation family is hidden.

**Status.** 🟡 **Fix landed, unverified.** `rip.strict` stops suppressing the implicit-any family: `TS7006` should surface on the `.rip` param under `strict:true` and stay hidden under `strict:false`. Dim 3 pulls diagnostics from the real server, so `[driven]` settles this; it has not been run against this code.

**Reproduced** — `greet = (name) -> name.toUpperCase()` → face `function(name){…}`; `tsc --strict` on the face reports `TS7006: Parameter 'name' implicitly has an 'any' type`, but the v4 editor dropped it: [server.js](../../packages/vscode/src/server.js) filtered on `SUPPRESSED_TS_CODES` (the set lives in [translate.js](../../packages/vscode/src/translate.js)). That guard now reads `if (!good.strict && SUPPRESSED_TS_CODES.has(d.code))` — the strict gate is the fix.

**Why** — rip allows unannotated code (gradual typing); the family would fire on every unannotated binding, which is legal rip, so it's suppressed as a class (D40).

**vs v3** — v3's suppression was conditional/surgical (`shouldSuppressConditional` — only specific codes in specific structural cases: DTS-header collisions, `.rip`/`@rip-lang` resolution, test globals). Implicit-any was NOT blanket-suppressed: a project opted into `noImplicitAny` via `package.json#rip.strict` and GOT the enforcement. v4 forces `noImplicitAny` on (tsgo's strict default) but unconditionally hides its diagnostics — removing that control.

**Root** — this and the `!`/use-before-assign suppression below both descend from one D39 principle — *"annotations add checking, never noise on legal patterns"* — applied with no strict-project opt-in (the plan never models a `rip.strict`/`checkAll` equivalent; searched, absent). A strictly-typed rip project is not a persona the plan's diagnostic posture accounts for. Making the posture strictness-gated (as v3 was) closes both at once.

### 2. Use-before-assign hidden on annotated forwards

A bare typed forward (`y: number`) emits `let y!: number` — TypeScript's definite-assignment assertion — which suppresses `TS2454` (variable used before being assigned). A strict project that annotates *and* wants use-before-assign caught cannot get it; no opt-out.

**Status.** 🟡 **Fix landed, unverified.** With #1: under `rip.strict` the emitter drops the `!` on typed forwards, so `TS2454` is checked.

**Reproduced** — `y: number` / `console.log y` / `y = 5` → v4 face `let y!: number; console.log(y); y = 5;` passes `tsc --noEmit --strict` clean; the same face with the `!` removed (`let y: number`) errors `TS2454: Variable 'y' is used before being assigned` — so the `!` is what hides it.

**Why** — rip's hoist makes read-before-assign legal (yields `undefined`); annotating opts the name into TS's definite-assignment analysis, which flags patterns that are "legal Rip." Per D39 the `!` is added so annotations *"add checking, never noise on legal patterns"* — the plan records the cost explicitly: *"the assertion also hides genuine use-before-assign mistakes — consistent with Rip's permissive model."* Type-level twin of the runtime no-TDZ behavior (a plain-`=` read before assignment yields `undefined`, not a `ReferenceError`; see the `=` hoisting note below), and shares the `Root` above.

**vs v3** — v3 catches it: on the same code v3's `rip check` (strict+checkAll) reports `TS2454` at both read sites (v3's shadow emits a plain `let y`, no assertion). v4 hides it unconditionally.

### 3. Reactive-binding annotations not enforced

An explicit type annotation on a reactive binding (`:=`) does not constrain the assigned value. `badClicks: number := 'oops'` compiles clean and the wrong-typed initializer is never flagged — you annotate `number`, assign a string, and get no error. Silent, no opt-out.

**Status.** 🟡 **Fix landed, unverified.** `:=`/`~=` emit a face-only `satisfies T`, so the annotation checks the value; JS unchanged.

**Reproduced** — [08-reactive.rip](fixtures/08-reactive.rip): `badClicks: number := 'oops'` (also `badName: string := 42`, `badEnabled: boolean := 'yes'`, …). The face emits `const badClicks: { value: number; read(): number } = __state("oops")` (driven: `bin/rip --ts test/type-audit/fixtures/08-reactive.rip`) — the `: number` becomes the reactive-CELL type and the value is handed to `__state(...)`, which does not re-check it against `number`. Nothing fires on the value, so each `# @ts-expect-error` is instead flagged `TS2578` (unused) — 5 such on 08 in the runner's verdict.

**Why** — the `:=` lowering wraps the value in a state cell and rewrites the annotation to describe the cell (`{ value: T; read(): T }`), not the value; the initializer flows through `__state(...)` unchecked. Same root as the reactive-cell hover leak (#10) — the value-type *checking* failure here, the value-type *display* failure there.

**vs v3** — v3 enforces the annotation: it compiles 08 (`bin/rip -c` → EXIT 0) and `bin/rip check test/types` is clean (no `TS2578`), so on these lines the expected error fired and was absorbed. v4 accepts the wrong type silently.

### 4. Evolving-let reassignment not caught

A plain `=` binding hoists to an evolving `let` with no type, so TS never pins its inferred type across statements: a variable inferred one type and then reassigned another is not caught. `total = count + ratio` (number) then `total = 'oops'` compiles clean; the expected type error never fires. Silent, no opt-out.

**Status.** 🟡 **Fix landed, unverified.** The evolving-`let` campaign (declare-in-place; follow-ups) lets TS pin the type, so reassignment errors.

**Reproduced** — [11-inference.rip](fixtures/11-inference.rip): nine reassign-to-different-type cases (`total`→string, `label`→number, `active`→string, `result`→string, `upper`→number, `joined`→boolean, `first`→number, `msg`→number), each marked `# @ts-expect-error — inferred T`. Driven three ways: (a) the minimal `let total; total = 7; total = 'oops';` passes `tsc --noEmit --strict` (EXIT 0) — evolving-`any` genuinely accepts the reassignment; (b) `tsc` on the full 11 face reports exactly the 9 `TS2578` unused directives; (c) the editor's verdict reports the same 9.

**Why** — the hoist emits `let total; … total = <number>; … total = 'oops'`. TS types such a split binding by widening across writes (evolving-`any`) rather than pinning it, so no assignment is a type error. Same declaration/initialization split as `typeof`→`undefined` (#5) and write-only-`any` (#9) — here the split *suppresses* real errors. (Contrast the minimal `let total = 7; total = 'oops'` WITH an initializer, which TS does catch — the hoist is precisely what strips the initializer.)

**vs v3** — v3's `patchUninitializedTypes` pinned each hoisted binding to its first-assignment type (`total: number`), so `total = 'oops'` errored — the markers are USED (v3 compiles 11 EXIT 0; `rip check test/types` clean). v4's evolving-`let` cannot pin it (the LSP broker can't patch tsgo's Program), so the reassignment is accepted.

### 5. typeof on an unannotated value resolves to undefined

For `type X = typeof y` (`y` unannotated), the face reads `typeof y` as `undefined`, so downstream uses of `X` fail. `typeof value` is idiomatic TS (`type Config = typeof defaultConfig`), so this blocks legitimate typed code.

**Status.** 🟡 **Fix landed, unverified.** Same declare-in-place campaign as #4: the `typeof`'d binding declares in place, so `typeof` reads its real value type.

**Reproduced** — [02-aliases.rip](fixtures/02-aliases.rip): `defaults = {theme:'dark',lang:'en'}` / `type Defaults = typeof defaults` / `prefs: Defaults = {…}` → the face fails `tsc --noEmit --strict` with `TS2322: … not assignable to type 'undefined'`; the v4 editor squiggles it.

**Why** — the face is byte-equal to shipped JS after type-stripping (D37/D38), so it mirrors the JS hoist-split — the `type Defaults` line lands above the assignment, so `typeof` reads the uninitialized `let`. Same root as write-only-`any` (#9): the hoist splits declaration from initialization.

**vs v3** — v3's type-checking shadow is NOT strip-gated, so it declares the `typeof`'d variable in-place (`let defaults = {…}`, verified via `rip --shadow`) → `typeof` resolves to the object type; `rip check` is clean (EXIT 0). v3 does this selectively — a plain object assignment without a `typeof` still hoist-splits in v3's shadow.

### 6. ts-expect-error dropped on multi-line emit

A `# @ts-expect-error` guarding a statement whose face emits as MORE THAN ONE line — any arrow/function assignment (`f = (x) -> …`, `x: T = (a) -> …`, an arrow inside a call like `.reduce`) — is silently dropped from the face. The directive stops working, so a real error the author explicitly acknowledged leaks into the editor. Single-line statements keep their directive; the escape hatch just fails on the multi-line class.

**Status.** 🟡 **Fix landed, unverified.** Directives always place above the statement head (D47 probe retired), re-anchoring over inlined forwards. Emit-surface, so `[driven]` on the face bytes settles it.

**Reproduced** — [02-aliases.rip](fixtures/02-aliases.rip): `# @ts-expect-error` over `badSorter: Comparator = (a, b) -> 'nope'`. The face emits `badSorter = function(a, b){ return "nope"; };` (three lines) with **no** directive above it (`bin/rip --ts` drops it: src 5 → face 4), and the suppressed error then surfaces in the editor verdict: `62:0 [TS2322] Type '(a: number, b: number) => string' is not assignable to type 'Comparator'`. Minimal isolation: a `# @ts-expect-error` over a one-line arrow assign `b = (x) -> x.length` is dropped; over a value assign `a = 'oops'` it is kept — and both `a` and `b` are hoisted identically (`let a, b;`), so it is the multi-line emission, not the hoist, that drops it. (01-basic loses 3 the same way: `badAllIds`, `implicitAny`, one more — all arrow-bearing.)

**Why (code)** — [emitter.js](../../src/emitter.js) `withTsDirectives` — a deliberate "place-or-decline" rule (D47): the statement emits behind a checkpoint, and `if (this.b.multiLineSince(cp)) return` declines the directive on any multi-line emission, reasoning that a directive governs only its immediate next line and a multi-line statement may carry its error on an inner line. That single-vs-multi-line test is a PROXY for "can the directive govern the error," and it over-declines the common case where the error lands on the head line (an arrow assigned to a hoisted typed binding — the mismatch reports on `x = function(…){`), which the directive could govern.

**vs v3** — v3 hoists `badSorter` identically and emits the same multi-line `function`, but KEEPS the directive above the assignment (verified via `rip --shadow`), and `bin/rip check test/types` → EXIT 0 with no output (no leak). So v3 governs the multi-line case; v4's proxy declines it. Because the runner's `directives` and `verdict` dimensions both count this one event, they are not independent evidence of it.

### 7. No headless type-checker rip check

v4 has no CLI to type-check a file or a project (the `tsc --noEmit` of rip-land). Type diagnostics exist only inside the editor server over LSP — so CI/pre-commit checking requires driving the editor (which is exactly why `runner.js` must be an LSP client).

**Status.** ⬜ **Open.** No `rip check` exists; `bin/rip` has no `check` subcommand.

**Reproduced** — [bin/rip](../../bin/rip) has no `check` subcommand (modes: `-c`/`--ts`/`-o`/`-m`/`-t`/`-s`/`--dts`/`--runtime`/`--explain`/`--face`). v3 had `rip check [dir]`, whole-project, strict+checkAll.

**vs v3** — v3's checker was an in-process LanguageService CLI; v4's moved into tsgo/LSP, so the headless equivalent no longer exists. The batch counterpart of what the editor already does (faces → mirror → tsgo batch → map diagnostics back) does not exist.

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Status.** ⬜ **Open.** Auto-import scope unchanged; no fix has landed. Completions are an editor surface, and the runner issues no completion request at all; the reproduction below came from rip-v4 via an LSP client.

**Reproduced** — real server over LSP (2026-07-09): workspace with `util.rip` (reachable — `a.rip` imports it, open `app.rip` imports `a`) + `orphan.rip` (nothing imports it). Completing in `app.rip` offers `shout` from `./util.rip` [closure works] but not `orphanWidget`, which stays `TS2304` with no quickfix [the gap]. Opening `orphan.rip` makes `orphanWidget` immediately offered → candidate set = the closure, reversible only by bringing the file in.

**Why (code)** — the generated tsconfig's `include` is `['**/*.ts']` rooted at the mirror closure ([server.js](../../packages/vscode/src/server.js), where the generated tsconfig is built); the candidate set is exactly the tsgo program.

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. The plan files v4's behavior as a D50 "scope note," which undersells it: for this feature it's a functional regression, not a caveat.

### 9. Write-only unannotated locals hover any

A **non-exported** unannotated local — a value *or* an arrow function (`f = -> …`) — assigned once and never read hovers `any` in v4; v3 showed the inferred type. Mildest of the set: degraded hover in a transient/authoring state (self-heals once any read exists), no hidden bug, no broken code. **The scope is narrow:** evolving-`let` types every case that HAS a read — including a *cross-scope* closure read (an outer var read inside a nested fn types correctly) — and **exported** bindings are exempt (they emit declare-in-place, `export const f = …`), so a `util.rip` of exported-but-uncalled functions all hover their real types. Only a never-read *local* falls to `any`.

**Status.** 🟡 **Fix landed, unverified.** Declare-in-place infers has-a-read cases natively; the write-only remainder is pin-probed. The hover audit instruments this through its oracle-free not-`any` invariant (an initialized binding must not hover `any`) — no twin and no pin file, so the check cannot self-confirm. It has not been run against this code.

**Reproduced** — [11-inference.rip](fixtures/11-inference.rip): `matches = filterBy('a')` (never read) hovers `let matches: any` in v4 vs `let matches: string[]` in v3 (a hover-differential no-oracle invariant hit).

**Why** — the face hoists to an evolving-`let`: TS types it `any` at the declaration and every write, materializing the real type only at reads. `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) recovers it by querying a read site — with zero reads there is nothing to query, so `any` stands.

**vs v3** — v3's `patchUninitializedTypes` injected each hoisted symbol's first-assignment type across all scopes — the general mechanism. v4's evolving-`let` supersedes it for every has-a-read case (verified across scopes); this write-only remainder is the part it can't reach (the LSP broker can't patch tsgo's Program).

### 10. Reactive bindings hover as their cell wrapper

Hovering a reactive binding — `:=` state, `~=` computed, `~>` effect — shows the internal reactive-cell shape instead of the value type v3 resolves. Degraded editor info on the reactive system's core forms; it is the hover-side twin of #3 (the value-type *checking* consequence is #3, this is the value-type *display* one).

**Status.** 🟡 **Fix landed, unverified.** The broker rewrites reactive-cell hovers to the value type; the runtime is generic on the face. Reactive bindings are rip-native, so the twin oracle cannot judge them — they rest on `hover-pins.json`, a baseline that self-confirms if it was ever re-photographed. Weakest evidence of any hover finding.

**Reproduced** — hover differential (v3 oracle) over [08-reactive.rip](fixtures/08-reactive.rip) — four shapes, all driven:
- **untyped state** `clicks := 0` → v3 `number`, v4 `any`.
- **typed state** `tags: string[] := []` → v3 `string[]`, v4 `{ value: string[]; read(): string[]; }`.
- **computed** `clicksDoubled ~= clicks * 2` → v3 `number`, v4 `{ valueOf(): any; toString(): string; …; value: any; read(): any; … }` (the full cell interface).
- **effect** `clickLogger: Function ~> …` → v3 `() => void`, v4 `Function`.

**Why** — the `:=`/`~=`/`~>` lowering binds the name to a state/computed cell object, and hover reports that object's type. A typed state echoes the annotation into the cell (`{ value: T; read(): T }`); untyped state and computed collapse to `any` / the full cell interface; the effect's `: Function` annotation is echoed verbatim (losing `() => void`). Same reactive-cell root as #3 — the type describes the cell, not the value.

**vs v3** — v3's in-process checker resolved each reactive binding to its value type (`clicks: number`, `clicksDoubled: number`, `clickLogger: () => void`) — the type the developer reads and writes. v4's broker sees only the emitted cell object.

## Config surface — rip.strict / rip.noCheck

Two defects found while verifying finding #1: `package.json#rip` config was not reactive, and `rip.noCheck` (v3's `exclude`) was parsed but never applied. Fixes for both have landed.

### 11. Config changes required a reload

Editing `package.json#rip` — e.g. toggling `strict` — did not update already-open `.rip` docs; the editor kept the old posture until you edited the `.rip` file or reloaded the window. The server re-read config only inside `refresh()`, and its watched-file globs covered `**/*.rip` and `**/tsconfig.json` but not `**/package.json`, so a config edit fired nothing.

**Status.** 🟡 **Fix landed, unverified.** Added `**/package.json` to the watch globs and a handler branch that refreshes every open doc on a non-`node_modules` `package.json` change — a full refresh, since `strict` changes the face itself and a re-pull alone would miss it. [server.js](../../packages/vscode/src/server.js) — `**/package.json` is present in the `watchers` registration.

Unestablished: that flipping `rip.strict` re-governs an already-open doc **with no window reload**. No harness can express the claim, having no window to avoid reloading.

### 12. noCheck parsed but never applied

v3's `rip.exclude` let a partly-typed project keep untyped/legacy paths from being type-checked. v4 parsed the key but consumed it nowhere — the sole reference was the parse line in `config.js` — so excluded paths were still fully checked in the editor.

**Status.** 🟡 **Fix landed, unverified.** Renamed to `rip.noCheck` (the glob form of the per-file `# @ts-nocheck` directive: matched paths stay in-program so imports resolve, but their diagnostics are silenced) and wired it into `refresh()` and `repullDiagnostics`. Type diagnostics for matched paths are suppressed; a genuine compile error still surfaces. [config.js](../../src/config.js) parses it; [server.js](../../packages/vscode/src/server.js) matches docs against it (`isNoCheck`, globs resolving relative to the config's `_configDir`) and guards the cross-file re-pull (`repullDiagnostics`).

Unestablished, both session-shaped: that silencing applies **reactively** to an already-open file, and that a **cross-file re-pull cannot resurrect** a silenced file's diagnostics — the reason the guard sits in `repullDiagnostics()` as well as `refresh()`.

## `=` hoisting: four type regressions and a bounded fix (owner's call)

**Status.** 🟡 **Addressed, unverified.** The declare-in-place fix this note proposed shipped as the evolving-`let` tiers (+ follow-ups); #4, #5, #9 and the excess-property case all close through it. This note inherits their status: it is settled exactly when they are, and reopens if any of them does.

*Not a gap — a note on the shared root of findings #4, #5, and #9 (plus one unnumbered instance), and one option, for the owner to weigh. rip's type philosophy is permissive by design (D17/D39); this is not an argument against that. These regressions hold regardless of it.*

**The root.** Hoisting splits a plain `=` binding's declaration from its value: `x = 1` → `let x; … x = 1`. Four regressions trace to exactly that split — and it cuts *both* ways, so it is not simply "more permissive":
- **#4 reassignment not caught** (under-check) — `total` inferred number, `total = 'oops'` not flagged; the evolving `let` never pins the type.
- **#5 `typeof`→`undefined`** (over-check, wrong type) — `type Config = typeof defaults` reads the uninitialized `let` as `undefined`; v3 handled it, v4 doesn't.
- **#9 write-only-`any`** (degraded) — v3 showed the inferred type at a write-only local; v4 shows `any`.
- **spurious excess-property error** (over-check, unnumbered) — `def getEl(): {tag:string}` with `o = {tag, __meta}` emits `let o; o = {…}`, and the evolving `let` takes the return type as context, so the fresh literal trips `TS2353` — which `const o = {…}` does not ([12-cast.rip](fixtures/12-cast.rip), driven: v4's hoisted form errors under `tsc --strict`, the declare-in-place form is clean).

**The fix rip already ships.** `=!` declares in place today (`x =! 5` → `const x = 5`) — no split, no gap. `=` could do the same *where the first assignment dominates its uses*, hoisting only where it must. The rip source is unchanged; all four close.

**Measured blast radius.** On medlabs (all 61 files compile, 1,075 hoisted bindings), **~65% already have a top-level first assignment** — the clean declare-in-place case. ~35% are assigned inside a block or nested scope; a subset of those genuinely need the hoist (used after the block), so it stays for them. The denser v3 compiler source splits ~52/48. So this is not "abandon hoisting" — it stays for a real minority, and the change targets the majority, where these regressions live. *(Proxy: top-level vs nested first assignment over emitted JS; "needs-hoist" is an upper bound.)*

**Cost & timing.** A dominance / definite-assignment analysis to classify each binding, plus a corpus runtime-diff to prove behavior unchanged — bounded but not free. v3 and medlabs are being ported to v4 regardless, so it rides that port if chosen.

## Triaged — the rest of the audit (not new gaps)

Everything the runner surfaces (five dimensions plus the hover audit) is accounted for above. The remaining raw signal was triaged and adds no new findings:

- **Verdict divergences** — all promoted or explained: reactive-annotation-not-enforced (#3), evolving-`let` reassignment (#4), `typeof`→`undefined` (#5), directive-loss (#6); the `12-cast` excess-property case folds into the hoisting note; and `07-integration`'s six divergences are a **cascade** of compiler-gap C1 — its `import … from './06-functions.rip'` can't resolve (06 doesn't compile), so the imported calls become `any` and their five guards report unused.
- **Hover sweep** — the reactive-cell leak is now #10. The rest is not-a-gap: **benign** union-member reordering (v4 sorts literals, v3 keeps source order — same type); **v4 more precise than v3** (nullable/optional unions preserved where v3 flattened to a bare type; branch-only assignment reads `T | undefined`, sound, vs v3's flat `T`); and the evolving-`let` hover shapes on 11-inference (a reassigned binding hovers its later-write type) are the display face of #4/#9, not a separate gap.
- **Skipped fixtures** — non-compiling (C1/C2) and import-bearing files have no face to compare; their would-be differs are the compiler gaps already catalogued, not hover defects.

**What the triage establishes.** It accounts for the raw signal the runner surfaces. It does not verify any fix — the triage explains divergences, it does not confirm that a fix behaves.
