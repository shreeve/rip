# Type-audit findings — gaps in rip's typed-editor story

> **Trust the Status line, not the body.** Each finding's body is the original audit snapshot — present-tense and pre-fix, even where a fix has since landed. The **Status** line under each heading is the current truth, and records only what someone actually ran.
>
> **No line numbers.** Code is cited by file and symbol name — greppable, and it does not rot. (The rip-v4 line anchors this ledger used to carry were stale on arrival — most pointed into a differently-shaped file.)
>
> The **vs v3** comparisons throughout were established by driving v3 (the rip-lang repo) — historical snapshots, but v3 (3.17.5) is still reachable at `~/Code/shreeve/rip-lang` and can be re-driven, as the [performance-crossover note](#rip-check-vs-v3-the-performance-crossover-measured) below does. This repo is **v4, cleaned up**; the bodies' "v4" means the code here.

**Evidence tags.** A status carries a tag only if someone ran the thing. **No tag means it has not been checked** — there is no tag for "we believe this."

| Tag | Meaning |
| --- | --- |
| **[driven]** | The real tool, run programmatically — the compiler CLI, or the real editor server over LSP (what `runner.js` does). Settles compile/emit questions outright. For editor surfaces it settles the *payload* — a `textDocument/hover` response is the text VS Code renders — but not the client glue around it, and it reaches nothing the runner does not request. |
| **[editor]** | Checked by hand in a live VS Code session. Required wherever the claim is about the session itself rather than a payload: config reactivity, watcher-driven refresh, "no window reload," completions offered as you type. |

**What the runner does and does not reach.** It drives the real server, so hovers (twin-oracle checked, with 6 residual pins in `hover-pins.json`) and diagnostics (dim 3) are genuinely instrumented — a green run there is real evidence, not theater. But it issues **no completion request** and performs **no `package.json` edit or `didChangeWatchedFiles` notification**, so **#8, #11, and #12 have no harness coverage at all** and can only be established `[editor]`.

**Statuses** — `✅ Verified` · `🟡 Fix landed, unverified` (the code is in; nobody has watched it work) · `⬜ Open` (no fix).

> **Driven 2026-07-12** against this code: `bun run test:all` (5261 pass / 0 fail, with `RIP_EXTENDED=1 RIP_REQUIRE_TSC=1` and a real tsc), `bun run type-audit --all` (60/60 dimensions, 335/335 hover probes), and `test/toolchain/strict-modes.test.js` — a two-mode gate written for #1, which was found to be exercised by nothing at all. **Nine findings verify.** Four remain: #10 (rip-native hovers, no oracle), #11 and #12 (no harness coverage), #8 (open, no fix).
>
> **Driven 2026-07-13:** #7 now closes — `rip check` exists, a headless CLI that runs the editor's faces→mirror→tsgo→map-back pipeline in **batch**: one tsgo session over the whole mirror, **pin-probed like the editor** (so evolving-`any` closure reads resolve, not just a bare `tsc --noEmit`), diagnostics pulled per file and mapped onto `.rip` source. The drift-sensitive core (mapping/strict/noCheck/directives, and the mirror+tsconfig+closure) was extracted from `server.js` into shared `diagnostics.js` / `mirror.js`, so checker and editor are one implementation. Driven by `test/toolchain/check.test.js` (clean / type-error at the mapped `.rip` position / `rip.strict` differential / `rip.noCheck` / `@ts-expect-error` / cross-file / `--json`) and over the 12 audit fixtures (`bin/rip check fixtures` → 12/12 clean, matching the runner's verdict dimension — pin-dependent case included). **Ten findings now verify;** the five that remain are #8 (open, no fix), #10 (rip-native hovers, no oracle), #11 and #12 (no harness coverage), and #13 (newly filed — single-rooted tsconfig, no monorepo support; the fix approach is driven-feasible but unbuilt).
>
> **Driven 2026-07-14:** #14 filed and fixed — an unused `@ts-expect-error` was silently swallowed (a stale escape hatch that rots invisibly and can later absorb a genuine new error). tsgo's `TS2578` maps fine onto the directive; the drop was `applyRipDirectives` counting a suggestion-class hint (`TS6133`) as "directive used." Now only a real error marks it used. Driven by a new `check.test.js` case (unused expect-error → `TS2578` at the directive; `@ts-ignore` exempt; used single/multi-line clean), fixtures 12/12, audit 60/60. **Eleven findings now verify.**

## Summary

**Settles it** names the weakest instrument that *could* establish the finding — a fact about the claim and the runner's reach. It is not a tag: bracketed `[driven]`/`[editor]` mean evidence someone actually produced, and no status carries one.

| # | Finding | Class | Status | Settles it |
| --- | --- | --- | --- | --- |
| [C1](#c1-optional-marker-rejected) | Optional `?` marker rejected | Compiler blocker | ✅ Verified · [driven] | — |
| [C2](#c2-method-shorthand-in-type-body-rejected) | Method-shorthand in type body rejected | Compiler blocker | ✅ Verified · [driven] | — |
| [1](#1-implicit-any-suppressed-with-no-opt-out) | Implicit-any suppressed, no opt-out | Silent safety hole | ✅ Verified · [driven] | — |
| [2](#2-use-before-assign-hidden-on-annotated-forwards) | Use-before-assign hidden by `!` | Silent safety hole | ✅ Verified · [driven] | — |
| [3](#3-reactive-binding-annotations-not-enforced) | Reactive annotations not enforced | Silent safety hole | ✅ Verified · [driven] | — |
| [4](#4-evolving-let-reassignment-not-caught) | Evolving-`let` reassignment not caught | Silent safety hole | ✅ Verified · [driven] | — |
| [5](#5-typeof-on-an-unannotated-value-resolves-to-undefined) | `typeof` unannotated → `undefined` | Loud correctness | ✅ Verified · [driven] | — |
| [6](#6-ts-expect-error-dropped-on-multi-line-emit) | `@ts-expect-error` dropped on multi-line | Loud correctness | ✅ Verified · [driven] | — |
| [7](#7-no-headless-type-checker-rip-check) | No headless `rip check` | Missing capability | ✅ Verified · [driven] | — |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | Missing capability | ⬜ Open | **editor** — no harness coverage |
| [9](#9-write-only-unannotated-locals-hover-any) | Write-only locals hover `any` | Hover DX | ✅ Verified · [driven] | — |
| [10](#10-reactive-bindings-hover-as-their-cell-wrapper) | Reactive bindings hover cell wrapper | Hover DX | 🟡 Fix landed, unverified | **editor** — rip-native, no oracle |
| [11](#11-config-changes-required-a-reload) | Config changes required a reload | Config surface | 🟡 Fix landed, unverified | **editor** — no harness coverage |
| [12](#12-nocheck-parsed-but-never-applied) | `rip.noCheck` parsed but never applied | Config surface | 🟡 Fix landed, unverified | **editor** — no harness coverage |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | Config surface | ⬜ Open | **driven** — code + real tsgo |
| [14](#14-unused-ts-expect-error-silently-swallowed) | Unused `@ts-expect-error` silently swallowed | Loud correctness | ✅ Verified · [driven] | — |

## Compiler-coverage gaps — file won't compile (hard blockers)

More severe than every editor-layer regression below: these produce **no face at all**, so the file is dark to the whole typed-editor pipeline (no diagnostics, hover, or completion — there is nothing downstream to run). All four affected fixtures are v3's own `test/types` files, ported verbatim; **v3 compiles all four** (`bin/rip -c` → EXIT 0 each, driven against v3), so each is a straight regression. Two nameable parser holes account for all four.

### C1. Optional marker rejected

rip's parser rejects the TS-optional `?` suffix wherever v3 accepted it — on both type-body property members and `def`/function parameters. Any type, interface, or signature that marks a member or param optional fails to compile.

**Status.** ✅ **Verified · [driven]** (2026-07-12).

- **Face** — 03/05/06 compile; the audit's `compiles` dimension is 12/12 and `tsface-tsc` passes 59/59 under a real tsc.
- **`.d.ts` optional params** — `bun bin/rip --dts` on 06 emits `formal(name: string, title?: string)` and, for a bare optional, `greetUntyped(name: string, title?: any)`. The marker survives and the bare case defaults, as claimed.
- **`.d.ts` generics** — the same run emits `wrap<T extends string>(value: T): Promise<[T]>`; `T` resolves in scope, no `TS2304`.
- **tsc-valid** — the `dts-tsc` gate, which this finding cites as its validator, passes **37/37**. It had been silently skipping 25 of 26 tests because no `tsc` was on PATH; run with `RIP_EXTENDED=1 RIP_REQUIRE_TSC=1` and `RIP_TSC` pointed at a real binary, it executes and passes.

**Why (code)** — `dts.js` reads the `optionalMarker` role (shared `renderParam`): typed `title?: string` keeps the `?`, bare `title?: any` (a declaration can't carry an implicit any); generic declarations emit the `<T, …>` clause from the `typeParams` role, so a generic `def` references `T` in scope instead of `TS2304`.

Note: under `rip.strict` a bare optional param (`title?`, no type) flags `TS7006` on the face — a regression vs v3 (which emitted `title?: any` and stayed strict-clean). The face-side fix (emit `title?: any`, matching the `.d.ts`) is deferred to the strict-audit campaign.

**Reproduced** — two surfaces (pre-fix output — see Status): type-body members ([03-structural.rip](fixtures/03-structural.rip) `ssl?: boolean`, [05-interfaces.rip](fixtures/05-interfaces.rip) `method?: string`) and params ([06-functions.rip](fixtures/06-functions.rip) `title?: string`).
```
$ bin/rip --ts test/type-audit/fixtures/03-structural.rip
03-structural.rip:12:6: code expression ('?') in a type body — types erase and cannot execute
$ bin/rip --ts test/type-audit/fixtures/06-functions.rip
06-functions.rip:40:40: Unexpected '{' … expected … ?
```

**vs v3** — compiles all three (driven, EXIT 0 above) and emits the `?` into the `.d.ts` (`title?: string`), per the fixtures' own comments ([06-functions.rip](fixtures/06-functions.rip)).

### C2. Method shorthand in type body rejected

A type/interface body accepts only property-style members (`name: type`); it has no grammar for the `name(args): ret` method-signature shorthand, so any object type declaring a method fails to compile.

**Status.** ✅ **Verified · [driven]** (2026-07-12). 09 compiles (`compiles` 12/12) and the `dts-tsc` gate passes 37/37, so the shorthand renders on both the face and the `.d.ts` and the declaration is tsc-valid. The fix sits in the shared `typetext.js` seam (which `dts.js` also uses) — the positive control for C1's drift, and it holds.

**Reproduced** — [09-components.rip](fixtures/09-components.rip): `addItem(item: CartItem): void` inside `export type Cart =` (pre-fix output — see Status).
```
$ bin/rip --ts test/type-audit/fixtures/09-components.rip
09-components.rip:273:10: code expression ('(') in a type body — types erase and cannot execute
```

**vs v3** — compiles it (EXIT 0) and preserves the shorthand as a real method signature in its `.d.ts` — `addItem(item: CartItem): void;` (driven against v3). The `.tsx` twin ([09-components.tsx](fixtures/09-components.tsx)) expresses the same member as a property arrow type (`addItem: (item: CartItem) => void`) — the TS-equivalent, not the shorthand form.

## Regressions vs v3 (v4 behind v3)

v4 is behind v3 here — consequences of the tsgo/LSP broker and the strip-gated face replacing v3's in-process LanguageService and its free-form type-checking shadow. **Ordered most-severe first:** silent, no-opt-out safety holes a strict project can't recover (1–4) → loud correctness breaks on valid typed code (5–6) → missing/degraded capabilities (7–8) → hover DX degradations (9–10).

> The *gaps* below were driven against rip-v4. The **fix statuses** were re-driven against this code on 2026-07-12: #1–#6 and #9 all verify. #10 still needs an editor — reactive hovers are rip-native, so the twin oracle cannot judge them.

### 1. Implicit-any suppressed with no opt-out

v4 drops the entire implicit-any diagnostic family (`TS7005`–`7053`) for ALL code, with no config to re-enable it. A project that wants strict `noImplicitAny` enforcement cannot get it: an unannotated function parameter is silently `any` and its misuse goes unchecked (any-propagation). Real type errors (`TS2322`/`2339`/`2345`) are unaffected — only the missing-annotation family is hidden.

**Status.** ✅ **Verified · [driven]** (2026-07-12) — by `test/toolchain/strict-modes.test.js`, written for this finding.

The claim is differential — *suppressed by default, surfaced under `rip.strict`* — so no single-mode run can express it. The gate drives the **real editor server** over LSP against a workspace whose `package.json` carries the config verbatim (the server reads it from disk via `readProjectConfig`), once in each mode:

- **Default** — zero diagnostics. Unannotated code is legal rip, and `TS7006` never fires. This half matters as much as the other: a regression that put implicit-any noise on unannotated bindings would break the permissive contract, and a strict-only gate would be blind to it.
- **`rip.strict: true`** — `TS7006: Parameter 'name' implicitly has an 'any' type` fires, mapped back to the `.rip` source at **1:9**, on the `name` parameter itself.
- **The delta is additive** — every code visible by default is still visible under strict, and the added set is non-empty. An inert flag (which is exactly what this finding was, unnoticed) now fails the gate.

Why nothing caught this before: the type-audit runner copies only a `tsconfig.json` into its workspace and **never writes a `package.json`**, so `rip.strict` was always false there and the gate never fired — and no other test in the repo referenced `SUPPRESSED_TS_CODES`. The audit ran green in precisely the mode where the old suppression is still active.

**Reproduced** — `greet = (name) -> name.toUpperCase()` → face `function(name){…}`; `tsc --strict` on the face reports `TS7006: Parameter 'name' implicitly has an 'any' type`, but the v4 editor dropped it: [server.js](../../packages/vscode/src/server.js) filtered on `SUPPRESSED_TS_CODES` (the set lives in [translate.js](../../packages/vscode/src/translate.js)). That guard now reads `if (!good.strict && SUPPRESSED_TS_CODES.has(d.code))` — the strict gate is the fix.

**Why** — rip allows unannotated code (gradual typing); the family would fire on every unannotated binding, which is legal rip, so it is suppressed as a class.

**vs v3** — v3's suppression was conditional/surgical (`shouldSuppressConditional` — only specific codes in specific structural cases: DTS-header collisions, `.rip`/`@rip-lang` resolution, test globals). Implicit-any was NOT blanket-suppressed: a project opted into `noImplicitAny` via `package.json#rip.strict` and GOT the enforcement. v4 forces `noImplicitAny` on (tsgo's strict default) but unconditionally hides its diagnostics — removing that control.

**Root** — this and the `!`/use-before-assign suppression below both descend from one principle — *annotations add checking, never noise on legal patterns* — originally applied with no strict-project opt-in at all. A strictly-typed rip project was simply not a persona the diagnostic posture accounted for. Making the posture strictness-gated (as v3 was) closes both at once, which is the fix that landed: see #1's status.

### 2. Use-before-assign hidden on annotated forwards

A bare typed forward (`y: number`) emits `let y!: number` — TypeScript's definite-assignment assertion — which suppresses `TS2454` (variable used before being assigned). A strict project that annotates *and* wants use-before-assign caught cannot get it; no opt-out.

**Status.** ✅ **Verified · [driven]** (2026-07-12) — both halves, by two independent gates.

- **Emitter** — `tiers.test.js`: under `strict: true` a typed forward emits `let y: number;`, the `!` gone, so TypeScript's definite-assignment analysis is no longer suppressed. The JS is unchanged (presentation-only).
- **Diagnostic** — `strict-modes.test.js`: the real server publishes `TS2454: Variable 'y' is used before being assigned`, mapped back to the `.rip` source at **5:12**, on the read site. Under default it stays hidden, as designed.

The emitter half alone was never enough: dropping the `!` only means TS *could* check it. This pins that the diagnostic actually reaches the user, at the right place.

**Reproduced** — `y: number` / `console.log y` / `y = 5` → v4 face `let y!: number; console.log(y); y = 5;` passes `tsc --noEmit --strict` clean; the same face with the `!` removed (`let y: number`) errors `TS2454: Variable 'y' is used before being assigned` — so the `!` is what hides it.

**Why** — rip's hoist makes read-before-assign legal (yields `undefined`); annotating opts the name into TS's definite-assignment analysis, which flags patterns that are "legal Rip." The `!` is added under the governing principle that annotations *add checking, never noise on legal patterns* — with the cost accepted explicitly at the time: the assertion also hides genuine use-before-assign mistakes, consistent with rip's permissive model. Type-level twin of the runtime no-TDZ behavior (a plain-`=` read before assignment yields `undefined`, not a `ReferenceError`; see the `=` hoisting note below), and shares the `Root` above.

**vs v3** — v3 catches it: on the same code v3's `rip check` (strict+checkAll) reports `TS2454` at both read sites (v3's shadow emits a plain `let y`, no assertion). v4 hides it unconditionally.

### 3. Reactive-binding annotations not enforced

An explicit type annotation on a reactive binding (`:=`) does not constrain the assigned value. `badClicks: number := 'oops'` compiles clean and the wrong-typed initializer is never flagged — you annotate `number`, assign a string, and get no error. Silent, no opt-out.

**Status.** ✅ **Verified · [driven]** (2026-07-12). `:=`/`~=` emit a face-only `satisfies T`, so the annotation checks the value; JS unchanged. The audit's `verdict` dimension is 12/12, which means 08's `# @ts-expect-error` markers are *used* — the wrong-typed initializers now error and are absorbed. This is not circular: `TS2578` (unused directive) is **not** in `SUPPRESSED_TS_CODES` — that set is exclusively the 70xx implicit-any family — so an unfired expectation would have surfaced as a stray error and failed the dimension.

**Reproduced** — [08-reactive.rip](fixtures/08-reactive.rip): `badClicks: number := 'oops'` (also `badName: string := 42`, `badEnabled: boolean := 'yes'`, …). The face emits `const badClicks: { value: number; read(): number } = __state("oops")` (driven: `bin/rip --ts test/type-audit/fixtures/08-reactive.rip`) — the `: number` becomes the reactive-CELL type and the value is handed to `__state(...)`, which does not re-check it against `number`. Nothing fires on the value, so each `# @ts-expect-error` is instead flagged `TS2578` (unused) — 5 such on 08 in the runner's verdict.

**Why** — the `:=` lowering wraps the value in a state cell and rewrites the annotation to describe the cell (`{ value: T; read(): T }`), not the value; the initializer flows through `__state(...)` unchecked. Same root as the reactive-cell hover leak (#10) — the value-type *checking* failure here, the value-type *display* failure there.

**vs v3** — v3 enforces the annotation: it compiles 08 (`bin/rip -c` → EXIT 0) and `bin/rip check test/types` is clean (no `TS2578`), so on these lines the expected error fired and was absorbed. v4 accepts the wrong type silently.

### 4. Evolving-let reassignment not caught

A plain `=` binding hoists to an evolving `let` with no type, so TS never pins its inferred type across statements: a variable inferred one type and then reassigned another is not caught. `total = count + ratio` (number) then `total = 'oops'` compiles clean; the expected type error never fires. Silent, no opt-out.

**Status.** ✅ **Verified · [driven]** (2026-07-12). Declare-in-place lets TS pin the type, so reassignment errors. The nine `# @ts-expect-error` markers on 11-inference are used — `verdict` is 12/12, and `TS2578` is reported rather than suppressed, so the nine unused-directive errors this finding recorded are gone.

**Reproduced** — [11-inference.rip](fixtures/11-inference.rip): nine reassign-to-different-type cases (`total`→string, `label`→number, `active`→string, `result`→string, `upper`→number, `joined`→boolean, `first`→number, `msg`→number), each marked `# @ts-expect-error — inferred T`. Driven three ways: (a) the minimal `let total; total = 7; total = 'oops';` passes `tsc --noEmit --strict` (EXIT 0) — evolving-`any` genuinely accepts the reassignment; (b) `tsc` on the full 11 face reports exactly the 9 `TS2578` unused directives; (c) the editor's verdict reports the same 9.

**Why** — the hoist emits `let total; … total = <number>; … total = 'oops'`. TS types such a split binding by widening across writes (evolving-`any`) rather than pinning it, so no assignment is a type error. Same declaration/initialization split as `typeof`→`undefined` (#5) and write-only-`any` (#9) — here the split *suppresses* real errors. (Contrast the minimal `let total = 7; total = 'oops'` WITH an initializer, which TS does catch — the hoist is precisely what strips the initializer.)

**vs v3** — v3's `patchUninitializedTypes` pinned each hoisted binding to its first-assignment type (`total: number`), so `total = 'oops'` errored — the markers are USED (v3 compiles 11 EXIT 0; `rip check test/types` clean). v4's evolving-`let` cannot pin it (the LSP broker can't patch tsgo's Program), so the reassignment is accepted.

### 5. typeof on an unannotated value resolves to undefined

For `type X = typeof y` (`y` unannotated), the face reads `typeof y` as `undefined`, so downstream uses of `X` fail. `typeof value` is idiomatic TS (`type Config = typeof defaultConfig`), so this blocks legitimate typed code.

**Status.** ✅ **Verified · [driven]** (2026-07-12). Same declare-in-place campaign as #4: the `typeof`'d binding declares in place, so `typeof` reads its real value type. 02-aliases passes `verdict` and `twin`, and `tsface-tsc` (59/59, real tsc) type-checks the face — the `TS2322: … not assignable to type 'undefined'` this finding recorded is gone.

**Reproduced** — [02-aliases.rip](fixtures/02-aliases.rip): `defaults = {theme:'dark',lang:'en'}` / `type Defaults = typeof defaults` / `prefs: Defaults = {…}` → the face fails `tsc --noEmit --strict` with `TS2322: … not assignable to type 'undefined'`; the v4 editor squiggles it.

**Why** — the face is byte-equal to shipped JS after type-stripping, so it mirrors the JS hoist-split — the `type Defaults` line lands above the assignment, so `typeof` reads the uninitialized `let`. Same root as write-only-`any` (#9): the hoist splits declaration from initialization.

**vs v3** — v3's type-checking shadow is NOT strip-gated, so it declares the `typeof`'d variable in-place (`let defaults = {…}`, verified via `rip --shadow`) → `typeof` resolves to the object type; `rip check` is clean (EXIT 0). v3 does this selectively — a plain object assignment without a `typeof` still hoist-splits in v3's shadow.

### 6. ts-expect-error dropped on multi-line emit

A `# @ts-expect-error` guarding a statement whose face emits as MORE THAN ONE line — any arrow/function assignment (`f = (x) -> …`, `x: T = (a) -> …`, an arrow inside a call like `.reduce`) — is silently dropped from the face. The directive stops working, so a real error the author explicitly acknowledged leaks into the editor. Single-line statements keep their directive; the escape hatch just fails on the multi-line class.

**Status.** ✅ **Verified · [driven]** (2026-07-12). Directives always place above the statement head (the multi-line probe is retired), re-anchoring over inlined forwards. The audit's `directives` dimension — the face carries every `# @ts-expect-error` — is **12/12**, so the multi-line drop this finding recorded no longer happens. Caveat recorded below still holds: `directives` and `verdict` both count this one event, so they are not independent of each other.

**Reproduced** — [02-aliases.rip](fixtures/02-aliases.rip): `# @ts-expect-error` over `badSorter: Comparator = (a, b) -> 'nope'`. The face emits `badSorter = function(a, b){ return "nope"; };` (three lines) with **no** directive above it (`bin/rip --ts` drops it: src 5 → face 4), and the suppressed error then surfaces in the editor verdict: `62:0 [TS2322] Type '(a: number, b: number) => string' is not assignable to type 'Comparator'`. Minimal isolation: a `# @ts-expect-error` over a one-line arrow assign `b = (x) -> x.length` is dropped; over a value assign `a = 'oops'` it is kept — and both `a` and `b` are hoisted identically (`let a, b;`), so it is the multi-line emission, not the hoist, that drops it. (01-basic loses 3 the same way: `badAllIds`, `implicitAny`, one more — all arrow-bearing.)

**Why (code)** — [emitter.js](../../src/emitter.js) `withTsDirectives` — a deliberate "place-or-decline" rule: the statement emits behind a checkpoint, and `if (this.b.multiLineSince(cp)) return` declines the directive on any multi-line emission, reasoning that a directive governs only its immediate next line and a multi-line statement may carry its error on an inner line. That single-vs-multi-line test is a PROXY for "can the directive govern the error," and it over-declines the common case where the error lands on the head line (an arrow assigned to a hoisted typed binding — the mismatch reports on `x = function(…){`), which the directive could govern.

**vs v3** — v3 hoists `badSorter` identically and emits the same multi-line `function`, but KEEPS the directive above the assignment (verified via `rip --shadow`), and `bin/rip check test/types` → EXIT 0 with no output (no leak). So v3 governs the multi-line case; v4's proxy declines it. Because the runner's `directives` and `verdict` dimensions both count this one event, they are not independent evidence of it.

### 7. No headless type-checker rip check

v4 has no CLI to type-check a file or a project (the `tsc --noEmit` of rip-land). Type diagnostics exist only inside the editor server over LSP — so CI/pre-commit checking requires driving the editor (which is exactly why `runner.js` must be an LSP client).

**Status.** ✅ **Verified · [driven]** (2026-07-13). `rip check [paths...]` now exists — [bin/rip](../../bin/rip) dispatches the `check` subcommand to [src/check.js](../../src/check.js), the batch counterpart the finding called for: it compiles each target `.rip` (and its transitive `.rip` closure) to a TS face, materializes the faces into a mirror with the editor's generated tsconfig, then drives **one tsgo session** over the whole mirror — **pin-probing each file exactly as the editor does** (Tier-3 pins, so an evolving-`let` binding read across a closure resolves to its real type, not `any`) and pulling diagnostics per file (a request/response, so no settle) — and maps every diagnostic back onto `.rip` source. It is the editor's refresh→probe→pull loop, batched and headless.

No second copy of the drift-sensitive logic: the mapping / `rip.strict` gate / `@ts-expect-error` (`applyRipDirectives`) / `rip.noCheck` core was extracted from the server into [diagnostics.js](../../packages/vscode/src/diagnostics.js), and the mirror layout + generated tsconfig + closure-edge discovery into [mirror.js](../../packages/vscode/src/mirror.js); [server.js](../../packages/vscode/src/server.js) now imports both, and pins ride the shared [pins.js](../../packages/vscode/src/pins.js). So the batch checker and the editor share one implementation — a batch run resolves imports / @types / strictness / pins and suppresses exactly as VS Code does.

Driven by `test/toolchain/check.test.js` and by hand: a clean file exits 0; `n: number = 'oops'` reports `TS2322` mapped to `bad.rip:1:1` and exits 1; the implicit-any family stays suppressed by default and surfaces as `TS7006` at the `name` parameter under `package.json#rip.strict` (the #1 differential, now reachable headlessly); `rip.noCheck: ['legacy/**']` silences a matched path; a `# @ts-expect-error` absorbs its error; a cross-file misuse reports `TS2345` at the call site through the imported type. **Parity check:** `bin/rip check fixtures` runs the 12 audit fixtures **12/12 clean**, matching the runner's verdict dimension — including the pin-dependent case (`11-inference`'s `search`, where a **block-confined** `needle`/`hits` — first-assigned inside a branch, so still hoist-split — is read from a closure and resolves to its real type only via the pin; a pins-less `tsc --noEmit` batch mis-reports it as an unused directive, so this parity is the reason for the tsgo-session-with-pins design over a bare batch). Runs in ~0.4s over the 12 fixtures (the per-keystroke editor session, driven as a client, took ~1.7s). The pin pass is the batch inheriting the editor's Tier-3 cost; the declare-in-place fix in the [`=` hoisting note](#-hoisting-four-type-regressions-and-a-bounded-fix-owners-call) below would let both retire it — a simplification (and, in the editor, one fewer async pass) more than a checker speedup: measured with-vs-without, the pin round-trips are only ~30ms (~8%) of the ~370ms wall-clock, the rest being startup and tsgo's program-build.

**Reproduced** (pre-fix) — [bin/rip](../../bin/rip) had no `check` subcommand (modes: `-c`/`--ts`/`-o`/`-m`/`-t`/`-s`/`--dts`/`--runtime`/`--explain`/`--face`). v3 had `rip check [dir]`, whole-project, strict+checkAll.

**vs v3** — v3's checker was an in-process LanguageService CLI; v4's moved into tsgo/LSP, so an in-process equivalent no longer exists. `rip check` restores the capability the other way: rather than re-checking in-process, it runs the editor's own pipeline (faces → mirror → tsgo-with-pins → map diagnostics back) in batch — the one honest source of truth for v4's diagnostics. On speed, see the [performance-crossover note](#rip-check-vs-v3-the-performance-crossover-measured) below: v4 is ~3–4× faster than v3 at typical sizes, but the lead is file-count-sensitive and reverses on many-thin-file projects.

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Status.** ⬜ **Open.** Auto-import scope unchanged; no fix has landed. Completions are an editor surface, and the runner issues no completion request at all; the reproduction below came from rip-v4 via an LSP client.

**Reproduced** — real server over LSP (2026-07-09): workspace with `util.rip` (reachable — `a.rip` imports it, open `app.rip` imports `a`) + `orphan.rip` (nothing imports it). Completing in `app.rip` offers `shout` from `./util.rip` [closure works] but not `orphanWidget`, which stays `TS2304` with no quickfix [the gap]. Opening `orphan.rip` makes `orphanWidget` immediately offered → candidate set = the closure, reversible only by bringing the file in.

**Why (code)** — the generated tsconfig's `include` is `['**/*.ts']` rooted at the mirror closure ([server.js](../../packages/vscode/src/server.js), where the generated tsconfig is built); the candidate set is exactly the tsgo program.

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This behavior was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

### 9. Write-only unannotated locals hover any

A **non-exported** unannotated local — a value *or* an arrow function (`f = -> …`) — assigned once and never read hovers `any` in v4; v3 showed the inferred type. Mildest of the set: degraded hover in a transient/authoring state (self-heals once any read exists), no hidden bug, no broken code. **The scope is narrow:** evolving-`let` types every case that HAS a read — including a *cross-scope* closure read (an outer var read inside a nested fn types correctly) — and **exported** bindings are exempt (they emit declare-in-place, `export const f = …`), so a `util.rip` of exported-but-uncalled functions all hover their real types. Only a never-read *local* falls to `any`.

**Status.** ✅ **Verified · [driven]** (2026-07-12). Declare-in-place infers has-a-read cases natively. Settled by the hover audit's **oracle-free not-`any` invariant** (an initialized binding must not hover `any`): **0 violations**, and the gauge reads **335/335 typed hovers** — every probe answers a real type. This is the strongest evidence in the ledger: no twin and no pin file are involved, so the check structurally cannot self-confirm.

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

### 13. Single-rooted tsconfig — no per-project resolution

Both the editor and `rip check` generate ONE tsconfig at the mirror root that `extends` only `<workspaceRoot>/tsconfig.json` ([mirror.js](../../packages/vscode/src/mirror.js) `generatedTsconfig`: `extends: '../../tsconfig.json'`, `rootDirs: ['.', '../..']`). Every `.rip` file is type-checked under the ROOT's `compilerOptions`; a nested package's own `tsconfig.json` — its `types`, `lib`, `jsx`, `strict`, `paths` — is ignored. `package.json#rip` (`strict`/`noCheck`) is already resolved per-file via `readProjectConfig` (nearest `package.json`, [config.js](../../src/config.js)), so the two config systems disagree: rip policy is per-package, tsconfig is flat. A second symptom: the editor roots the mirror at the VS Code folder while `rip check`'s `findWorkspaceRoot` walks to the nearest `package.json`/`tsconfig.json`/`.git` marker — so in a monorepo the same file can extend DIFFERENT tsconfigs in the two surfaces.

**Status.** ⬜ **Open** (no fix). The fix approach is **verified feasible · [driven]** (see below).

**The fix — one mirror, one session, per-project wrapper tsconfigs.** tsgo's LSP does per-file NEAREST-`tsconfig.json` discovery (the tsserver "configured project" model), so the single mirror tree and single tsgo session stay. Instead of one generated tsconfig at the mirror root, place a generated WRAPPER at each mirrored project dir, each `extends`-ing its source `tsconfig.json` with the same overrides (`noImplicitAny`, `noEmit`, `allowImportingTsExtensions`, `types:["*"]` unless the chain sets `types`) and reach-ups (`extends`, `rootDirs`) computed by `path.relative` instead of the hardcoded `../..`. tsgo then partitions the faces per project internally. Wrappers set their own `include`/`exclude`, so a source tsconfig's file set is not inherited (only `compilerOptions` are).

**Driven** — the real tsgo LSP, two probes:
- Two sibling dirs, one with a `strict:true` `tsconfig.json`, one governed by a loose root: `let x: string = null` reported `TS2322` ONLY under the nearest strict config; the loose file stayed clean. tsgo routes per file.
- The production shape — a nested generated wrapper `extends`-ing a strict source tsconfig via `../../../../pkg/tsconfig.json`, under one mirror root, one session: `pkg/a.rip.ts` reported `TS2322` (strict) while `root.rip.ts` stayed loose. Nested wrappers + reach-ups work.

**Blast radius.** Shared: generalize `generatedTsconfig` + add a `nearestTsconfig(dir, anchor)` walk in `mirror.js`. `rip check` ([src/check.js](../../src/check.js)): after materialization, emit one wrapper per distinct owning tsconfig — small, self-contained. Editor ([server.js](../../packages/vscode/src/server.js)): larger — emit/refresh wrappers during closure materialization and on `tsconfig.json` (or extends-chain) changes via the existing watcher; no session multiplexing. The pin pass and single-session architecture are untouched.

**vs v3** — not established (v3 is retired; not re-runnable). Framed as a missing capability, not a driven v3 regression.

## Directive handling — unused `@ts-expect-error`

### 14. Unused `@ts-expect-error` silently swallowed

An `@ts-expect-error` that catches nothing must raise `TS2578` — tsc's contract, and the self-cleaning property that makes it safer than `@ts-ignore`. v4 swallowed it: over a throwaway binding (`# @ts-expect-error` / `badCount = 'oops'`, no annotation) the directive governs nothing yet the check reads clean, so a stale escape hatch rots invisibly and can later absorb a genuine new error on that line.

**Status.** ✅ **Verified · [driven]** (2026-07-14) — a `test/toolchain/check.test.js` case: an unused `@ts-expect-error` reports `TS2578` at the directive and exits 1; used single- and multi-line directives stay clean; an unused `@ts-ignore` stays silent (tsc never flags it). Fixtures 12/12, audit 60/60. The editor shares the fixed core, so the squiggle now appears there too (`[editor]`-unverified, identical path).

**Root (code).** Not the mapping — tsgo's `TS2578` maps cleanly onto the source directive line. [diagnostics.js](../../packages/vscode/src/diagnostics.js) `applyRipDirectives` marked a directive used on ANY diagnostic in its range, then dropped the mapped `TS2578` via `used.has(...)`. A throwaway binding leaves an unused-local hint (`TS6133`, severity 4 — a fade, not an error) in that range, so the directive looked used. Fix: only an error/warning (`severity <= 2`) marks a directive used; a hint does not (the finding-#6 leaked-error path, severity 1, is unaffected).

**vs v3** — v3 checked the shadow in-process, where the directive sits in the real source, so tsc flagged it natively. Same machinery as #6, inverse failure: #6 is a *used* directive dropped from a multi-line face; #14 an *unused* one that should stay loud but was silenced.

## `=` hoisting: four type regressions and a bounded fix (owner's call)

**Status.** ✅ **Addressed · [driven]** (2026-07-12). The declare-in-place fix this note proposed shipped as the evolving-`let` tiers (+ follow-ups). #4, #5 and #9 all close through it and are now each verified above; the excess-property case rides the same mechanism (12-cast passes `verdict` and `twin`).

*Not a gap — a note on the shared root of findings #4, #5, and #9 (plus one unnumbered instance), and one option, for the owner to weigh. rip's type philosophy is permissive by design; this is not an argument against that. These regressions hold regardless of it.*

**The root.** Hoisting splits a plain `=` binding's declaration from its value: `x = 1` → `let x; … x = 1`. Four regressions trace to exactly that split — and it cuts *both* ways, so it is not simply "more permissive":
- **#4 reassignment not caught** (under-check) — `total` inferred number, `total = 'oops'` not flagged; the evolving `let` never pins the type.
- **#5 `typeof`→`undefined`** (over-check, wrong type) — `type Config = typeof defaults` reads the uninitialized `let` as `undefined`; v3 handled it, v4 doesn't.
- **#9 write-only-`any`** (degraded) — v3 showed the inferred type at a write-only local; v4 shows `any`.
- **spurious excess-property error** (over-check, unnumbered) — `def getEl(): {tag:string}` with `o = {tag, __meta}` emits `let o; o = {…}`, and the evolving `let` takes the return type as context, so the fresh literal trips `TS2353` — which `const o = {…}` does not ([12-cast.rip](fixtures/12-cast.rip), driven: v4's hoisted form errors under `tsc --strict`, the declare-in-place form is clean).

**The fix rip already ships.** `=!` declares in place today (`x =! 5` → `const x = 5`) — no split, no gap. `=` could do the same *where the first assignment dominates its uses*, hoisting only where it must. The rip source is unchanged; all four close.

**A fifth payoff — the pin pass shrinks.** The Tier-3 pin probe (editor, and the batch `rip check`'s pin pass, #7) recovers the type of a **hoist-split** binding read across a closure. Declare-in-place already removed the split for the dominant case, so top-level bindings no longer need probing — the pin's remaining job is the RESIDUAL: **block-confined** bindings, first-assigned inside a branch so they genuinely stay hoisted (the ~35% below), read from within a closure. That is exactly v4's stand-in for v3's `patchUninitializedTypes` walking into the branch — e.g. [11-inference](fixtures/11-inference.rip)'s `needle`/`hits` in `search`. So declare-in-place SHRANK the pin pass — the top-level closure-reads it used to pin now declare in place and drop out of the pinnable set — but it cannot retire it: a pinnable binding is *by construction* one that stayed hoisted (`captureScan` records a declare-in-place site only for a top-level `=`; a binding is pinnable only when it's still hoisted AND read in a closure — disjoint sets). Retiring what's left would take a *different* recovery for those block-confined reads — statically inferring the first-write type onto the hoist line (v3's `patchUninitializedTypes`, done in-face), NOT more declare-in-place. On the batch checker the residual pin pass is cheap either way — measured with-vs-without, only ~30ms (~8%) of `rip check`'s ~370ms wall-clock on the 12 fixtures (dominated by startup and tsgo's cold program-build) — so what's left of the pin pass is a simplicity/latency concern, not a checker speed lever.

**Measured blast radius.** On medlabs (all 61 files compile, 1,075 hoisted bindings), **~65% already have a top-level first assignment** — the clean declare-in-place case. ~35% are assigned inside a block or nested scope; a subset of those genuinely need the hoist (used after the block), so it stays for them. The denser v3 compiler source splits ~52/48. So this is not "abandon hoisting" — it stays for a real minority, and the change targets the majority, where these regressions live. *(Proxy: top-level vs nested first assignment over emitted JS; "needs-hoist" is an upper bound.)*

**Cost & timing.** A dominance / definite-assignment analysis to classify each binding, plus a corpus runtime-diff to prove behavior unchanged — bounded but not free. v3 and medlabs are being ported to v4 regardless, so it rides that port if chosen.

## rip check vs v3: the performance crossover (measured)

**Status.** **Driven** (2026-07-13) — both checkers run fresh; v3 (3.17.5) is still reachable at `~/Code/shreeve/rip-lang`.

Same capability, different engine: v3's `rip check` type-checks **in-process** through the JS TypeScript LanguageService; v4's drives **native tsgo out-of-process** (faces → mirror → per-file pull). Timed over the same corpus (the 12 audit fixtures are v4's ports of v3's `test/types`) and scaled with portable `.rip` (best-of-N wall-clock):

| files | v3 | v4 | winner |
| --- | --- | --- | --- |
| 12 (fixtures) | 1373 ms | 370 ms | v4 3.7× |
| 100 | 801 ms | 255 ms | v4 3.1× |
| 500 | 1127 ms | 822 ms | v4 1.4× |
| 1000 | 1405 ms | 2162 ms | **v3 1.5×** |

v4 is ~3–4× faster at typical sizes, but the lead erodes monotonically and **crosses over near ~700 thin files** — past that v3 wins. Opposite cost curves: **v3** ≈ ~730 ms fixed + ~0.7 ms/file, LINEAR (the fixed cost warms the in-process LanguageService — loading the whole JS TypeScript compiler, building the program — after which per-file checking is flat, with no IPC). **v4** ≈ ~40 ms fixed + SUPERLINEAR per-file (0.8 → 2.7 ms/file): native tsgo spawns almost instantly, but each file pays a round-trip tax v3 never did — a diagnostic pull (and, where it has a pinnable read, a pin-probe hover), run **sequentially**, plus a face compile and mirror write. v4 traded v3's high-fixed / low-per-file profile for a low-fixed / high-per-file one.

**Two caveats.** (1) The scaling corpus is type-TRIVIAL; on type-HEAVY code the native engine dominates regardless of file count — the react/zod-laden fixtures hit 3.7× on only 12 files, where the work is a big type graph and native tsgo crushes JS. Real projects sit on both axes (file count × type complexity). (2) v4's superlinearity is an implementation artifact, not an architectural limit: the per-file pulls run **sequentially** (issue them concurrently and the round-trips collapse), and the pin pass adds a hover for every file with a block-confined closure read — an irreducible remainder (those bindings stayed hoisted precisely because they *can't* declare in place; see the [`=` hoisting note](#-hoisting-four-type-regressions-and-a-bounded-fix-owners-call) above), removable only by a different type-recovery mechanism, not by more declare-in-place. Batching the pulls is the lever that actually flattens v4's curve; the pin pass is the smaller, harder remainder.

The bulk of the per-file tax is the sequential pulls, not the pin pass (already shrunk to block-confined residuals now that declare-in-place shipped for the dominant case). Correctness is not at stake here — the residual pin pass keeps those cases correct; batching the pulls concurrently, and later retiring what's left of the pin pass, is a scaling/simplicity optimization, not a correctness fix.

## Triaged — the rest of the audit (not new gaps)

Everything the runner surfaces (five dimensions plus the hover audit) is accounted for above. The remaining raw signal was triaged and adds no new findings:

- **Verdict divergences** — all promoted or explained: reactive-annotation-not-enforced (#3), evolving-`let` reassignment (#4), `typeof`→`undefined` (#5), directive-loss (#6); the `12-cast` excess-property case folds into the hoisting note; and `07-integration`'s six divergences are a **cascade** of compiler-gap C1 — its `import … from './06-functions.rip'` can't resolve (06 doesn't compile), so the imported calls become `any` and their five guards report unused.
- **Hover sweep** — the reactive-cell leak is now #10. The rest is not-a-gap: **benign** union-member reordering (v4 sorts literals, v3 keeps source order — same type); **v4 more precise than v3** (nullable/optional unions preserved where v3 flattened to a bare type; branch-only assignment reads `T | undefined`, sound, vs v3's flat `T`); and the evolving-`let` hover shapes on 11-inference (a reassigned binding hovers its later-write type) are the display face of #4/#9, not a separate gap.
- **Skipped fixtures** — non-compiling (C1/C2) and import-bearing files have no face to compare; their would-be differs are the compiler gaps already catalogued, not hover defects.

**What the triage establishes.** It accounts for the raw signal the runner surfaces. It does not verify any fix — the triage explains divergences, it does not confirm that a fix behaves.
