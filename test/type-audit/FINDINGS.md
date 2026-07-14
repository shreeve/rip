# Type-audit findings — gaps in rip's typed-editor story

✅ **Verified** (a named gate runs and passes) · 🟡 **Fix landed, unverified** (the code is in; no gate watches it — write one) · ⬜ **Open** (no fix). **The Gate column is the load-bearing one:** a finding with no gate cannot be Verified, however obviously fixed it looks.

| # | Finding | Class | Status | Gate |
| --- | --- | --- | --- | --- |
| [C1](#c1-optional-marker-rejected) | Optional `?` marker rejected | Compiler blocker | ✅ Verified | `dts-tsc`, audit `compiles` |
| [C2](#c2-method-shorthand-in-type-body-rejected) | Method-shorthand in type body rejected | Compiler blocker | ✅ Verified | `dts-tsc`, audit `compiles` |
| [1](#1-implicit-any-suppressed-with-no-opt-out) | Implicit-any suppressed, no opt-out | Silent safety hole | ✅ Verified | `strict-modes` |
| [2](#2-use-before-assign-hidden-on-annotated-forwards) | Use-before-assign hidden by `!` | Silent safety hole | ✅ Verified | `strict-modes`, `tiers` |
| [3](#3-reactive-binding-annotations-not-enforced) | Reactive annotations not enforced | Silent safety hole | ✅ Verified | audit `verdict` |
| [4](#4-evolving-let-reassignment-not-caught) | Evolving-`let` reassignment not caught | Silent safety hole | ✅ Verified | audit `verdict` |
| [5](#5-typeof-on-an-unannotated-value-resolves-to-undefined) | `typeof` unannotated → `undefined` | Loud correctness | ✅ Verified | audit `verdict`/`twin`, `tsface-tsc` |
| [6](#6-ts-expect-error-dropped-on-multi-line-emit) | `@ts-expect-error` dropped on multi-line | Loud correctness | ✅ Verified | audit `directives`, `check` |
| [7](#7-no-headless-type-checker-rip-check) | No headless `rip check` | Missing capability | ✅ Verified | `check` |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | Missing capability | ⬜ **Open** | `auto-import` (gap = expected-failure) |
| [9](#9-write-only-unannotated-locals-hover-any) | Write-only locals hover `any` | Hover DX | ✅ Verified | hover audit's not-`any` invariant |
| [10](#10-reactive-bindings-hover-as-their-cell-wrapper) | Reactive bindings hover cell wrapper | Hover DX | ✅ Verified | hover audit + `hover-pins.json` |
| [11](#11-config-changes-required-a-reload) | Config changes required a reload | Config surface | ✅ Verified | `config-reactivity` |
| [12](#12-nocheck-parsed-but-never-applied) | `rip.noCheck` parsed but never applied | Config surface | ✅ Verified | `config-reactivity` |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | Config surface | ⬜ **Open** | **none** |
| [14](#14-unused-ts-expect-error-silently-swallowed) | Unused `@ts-expect-error` silently swallowed | Loud correctness | ✅ Verified | `check` |
| [15](#15-reactive-state-bindings-carry-readonly) | Reactive `:=` bindings tagged `readonly` | Token DX | ✅ Verified | `semantic-tokens`, token audit's `readonly` invariant |

## How to read this ledger

**Trust the Status line, not the body.** Each finding's body is the original audit snapshot — present-tense and pre-fix, even where the fix has landed. The **Status** line is the current truth, and records only what someone actually ran.

**✅ Verified means a named gate runs and passes.** Nothing else earns it — not a code reading, not a scratch script, not a plausible argument. Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders. Beware the reflex to call a claim "editor-only": that is usually an unwritten test, not an unreachable one.

**What the evidence is worth.** The runner drives the real server (`bun run type-audit`; `--hover`, `--token`, `--all`, and `--help` for what each audit is judged against). Hovers are settled by the **twin oracle** — tsgo hovering the hand-written `.ts` twin, which is TypeScript's own answer — and, for the rip-native remainder the twin cannot express, by [hover-pins.json](hover-pins.json). *That file is a baseline, and `--update-hovers` re-photographs it from the server: re-pin without reading the diff and you launder a regression into the record.* The token audit carries no such hazard — its expectations come from the `.rip` source itself, so it cannot self-confirm.

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** Every **vs v3** line below was established by driving v3 — still reachable (3.17.5, `~/Code/shreeve/rip-lang`) and re-drivable, as the [performance-crossover note](#rip-check-vs-v3-the-performance-crossover-measured) does. This repo is **v4, cleaned up**; the bodies' "v4" means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-07-14. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree.

**Beyond this ledger.** The wider editor surface is covered by the extension's own suite (`packages/vscode/test/`) — completions, definition, references, rename, code actions, semantic tokens, inlay hints, all over real LSP. *Driven is not the same as asserted:* its semantic-token tests check that tokens land on Rip spans and dedup, and assert no **modifier** at all — a token can be in the right place and still say the wrong thing about the code. Modifiers are gated separately ([semantic-tokens.test.js](../toolchain/semantic-tokens.test.js), #15) and swept by the token audit. A green suite bounds only what its assertions reach.

## Compiler-coverage gaps — file won't compile (hard blockers)

More severe than every editor-layer regression below: these produce **no face at all**, so the file is dark to the whole typed-editor pipeline (no diagnostics, hover, or completion — there is nothing downstream to run). All four affected fixtures are v3's own `test/types` files, ported verbatim; **v3 compiles all four** (`bin/rip -c` → EXIT 0 each, driven against v3), so each is a straight regression. Two nameable parser holes account for all four.

### C1. Optional marker rejected

rip's parser rejects the TS-optional `?` suffix wherever v3 accepted it — on both type-body property members and `def`/function parameters. Any type, interface, or signature that marks a member or param optional fails to compile.

**Status.** ✅ **Verified** (2026-07-12).

- **Face** — 03/05/06 compile; the audit's `compiles` dimension is green and `tsface-tsc` passes under a real tsc.
- **`.d.ts` optional params** — `bun bin/rip --dts` on 06 emits `formal(name: string, title?: string)` and, for a bare optional, `greetUntyped(name: string, title?: any)`. The marker survives and the bare case defaults, as claimed.
- **`.d.ts` generics** — the same run emits `wrap<T extends string>(value: T): Promise<[T]>`; `T` resolves in scope, no `TS2304`.
- **tsc-valid** — the `dts-tsc` gate, which this finding cites as its validator, passes under a real tsc. At audit time it had been silently skipping nearly every row because no `tsc` was on PATH; the pinned-TypeScript dependency model since put a real tsc in the extended tier unconditionally, so the gate now executes — and a missing install throws rather than skipping.

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

**Status.** ✅ **Verified** (2026-07-12). 09 compiles and the `dts-tsc` gate passes, so the shorthand renders on both the face and the `.d.ts` and the declaration is tsc-valid. The fix sits in the shared `typetext.js` seam (which `dts.js` also uses) — the positive control for C1's drift, and it holds.

**Reproduced** — [09-components.rip](fixtures/09-components.rip): `addItem(item: CartItem): void` inside `export type Cart =` (pre-fix output — see Status).
```
$ bin/rip --ts test/type-audit/fixtures/09-components.rip
09-components.rip:273:10: code expression ('(') in a type body — types erase and cannot execute
```

**vs v3** — compiles it (EXIT 0) and preserves the shorthand as a real method signature in its `.d.ts` — `addItem(item: CartItem): void;` (driven against v3). The `.tsx` twin ([09-components.tsx](fixtures/09-components.tsx)) declares the member with the *same* method shorthand, so the twin is a direct check on this grammar, not a paraphrase of it.

## Regressions vs v3 (v4 behind v3)

v4 is behind v3 here — consequences of the tsgo/LSP broker and the strip-gated face replacing v3's in-process LanguageService and its free-form type-checking shadow. The *gaps* below were driven against rip-v4; the fix statuses were re-driven against this code. **Ordered most-severe first:** silent, no-opt-out safety holes a strict project can't recover (1–4) → loud correctness breaks on valid typed code (5–6) → missing/degraded capabilities (7–8) → hover DX degradations (9–10).

### 1. Implicit-any suppressed with no opt-out

v4 drops the entire implicit-any diagnostic family (`TS7005`–`7053`) for ALL code, with no config to re-enable it. A project that wants strict `noImplicitAny` enforcement cannot get it: an unannotated function parameter is silently `any` and its misuse goes unchecked (any-propagation). Real type errors (`TS2322`/`2339`/`2345`) are unaffected — only the missing-annotation family is hidden.

**Status.** ✅ **Verified** (2026-07-12) — by `test/toolchain/strict-modes.test.js`, written for this finding.

The claim is differential — *suppressed by default, surfaced under `rip.strict`* — so no single-mode run can express it. The gate drives the **real editor server** over LSP against a workspace whose `package.json` carries the config verbatim (the server reads it from disk via `readProjectConfig`), once in each mode:

- **Default** — zero diagnostics, asserted as the empty list rather than the absence of the two codes under test: any noise on legal unannotated code fails the gate, not just `TS7006`. This half matters as much as the other — a regression that put implicit-any noise on unannotated bindings would break the permissive contract, and a strict-only gate would be blind to it.
- **`rip.strict: true`** — `TS7006: Parameter 'name' implicitly has an 'any' type` fires, mapped back to the `.rip` source at **1:9**, on the `name` parameter itself.
- **The delta is additive** — every code visible by default is still visible under strict, and the added set is non-empty. An inert flag (which is exactly what this finding was, unnoticed) now fails the gate.

Why nothing caught this before: the type-audit runner copies only a `tsconfig.json` into its workspace and **never writes a `package.json`**, so `rip.strict` was always false there and the gate never fired — and no test anywhere exercised the strict path. (`packages/vscode/test/tsgo-broker.test.js` does *reference* `SUPPRESSED_TS_CODES`, but only as a filter over pulled diagnostics; it never flips the flag.) The audit ran green in precisely the mode where the old suppression is still active.

**Reproduced** — `greet = (name) -> name.toUpperCase()` → face `function(name){…}`; `tsc --strict` on the face reports `TS7006: Parameter 'name' implicitly has an 'any' type`, but the v4 editor dropped it: the broker filtered on `SUPPRESSED_TS_CODES` (the set lives in [translate.js](../../packages/vscode/src/translate.js)) unconditionally. That guard now reads `if (!good.strict && SUPPRESSED_TS_CODES.has(d.code))` — the strict gate is the fix — and it lives in [diagnostics.js](../../packages/vscode/src/diagnostics.js) `mapTsDiagnostic`, the core the editor and `rip check` share (#7), so both surfaces get the gate.

**Why** — rip allows unannotated code (gradual typing); the family would fire on every unannotated binding, which is legal rip, so it is suppressed as a class.

**vs v3** — v3's suppression was conditional/surgical (`shouldSuppressConditional` — only specific codes in specific structural cases: DTS-header collisions, `.rip`/`@rip-lang` resolution, test globals). Implicit-any was NOT blanket-suppressed: a project opted into `noImplicitAny` via `package.json#rip.strict` and GOT the enforcement. v4 forces `noImplicitAny` on (tsgo's strict default) but unconditionally hides its diagnostics — removing that control.

**Root** — this and the `!`/use-before-assign suppression below both descend from one principle — *annotations add checking, never noise on legal patterns* — originally applied with no strict-project opt-in at all. A strictly-typed rip project was simply not a persona the diagnostic posture accounted for. Making the posture strictness-gated (as v3 was) closes both at once, which is the fix that landed: see #1's status.

### 2. Use-before-assign hidden on annotated forwards

A bare typed forward (`y: number`) emits `let y!: number` — TypeScript's definite-assignment assertion — which suppresses `TS2454` (variable used before being assigned). A strict project that annotates *and* wants use-before-assign caught cannot get it; no opt-out.

**Status.** ✅ **Verified** (2026-07-12) — both halves, by two independent gates.

- **Emitter** — `tiers.test.js`: under `strict: true` a typed forward emits `let y: number;`, the `!` gone, so TypeScript's definite-assignment analysis is no longer suppressed. The JS is unchanged (presentation-only).
- **Diagnostic** — `strict-modes.test.js`: the real server publishes `TS2454: Variable 'y' is used before being assigned`, mapped back to the `.rip` source at **5:12**, on the read site. Under default it stays hidden, as designed.

The emitter half alone was never enough: dropping the `!` only means TS *could* check it. This pins that the diagnostic actually reaches the user, at the right place.

**Reproduced** — `y: number` / `console.log y` / `y = 5` → v4 face `let y!: number; console.log(y); y = 5;` passes `tsc --noEmit --strict` clean; the same face with the `!` removed (`let y: number`) errors `TS2454: Variable 'y' is used before being assigned` — so the `!` is what hides it.

**Why** — rip's hoist makes read-before-assign legal (yields `undefined`); annotating opts the name into TS's definite-assignment analysis, which flags patterns that are "legal Rip." The `!` is added under the governing principle that annotations *add checking, never noise on legal patterns* — with the cost accepted explicitly at the time: the assertion also hides genuine use-before-assign mistakes, consistent with rip's permissive model. Type-level twin of the runtime no-TDZ behavior (a plain-`=` read before assignment yields `undefined`, not a `ReferenceError`; see the `=` hoisting note below), and shares the `Root` above.

**vs v3** — v3 catches it: on the same code v3's `rip check` (strict+checkAll) reports `TS2454` at both read sites (v3's shadow emits a plain `let y`, no assertion). v4 hides it unconditionally.

### 3. Reactive-binding annotations not enforced

An explicit type annotation on a reactive binding (`:=`) does not constrain the assigned value. `badClicks: number := 'oops'` compiles clean and the wrong-typed initializer is never flagged — you annotate `number`, assign a string, and get no error. Silent, no opt-out.

**Status.** ✅ **Verified** (2026-07-12). `:=`/`~=` emit a face-only `satisfies T`, so the annotation checks the value; JS unchanged. The audit's `verdict` dimension is green, which means 08's `# @ts-expect-error` markers are *used* — the wrong-typed initializers now error and are absorbed. This is not circular: `TS2578` (unused directive) is **not** in `SUPPRESSED_TS_CODES` — that set is exclusively the 70xx implicit-any family — so an unfired expectation would have surfaced as a stray error and failed the dimension.

**Reproduced** — [08-reactive.rip](fixtures/08-reactive.rip): `badClicks: number := 'oops'` (also `badName: string := 42`, `badEnabled: boolean := 'yes'`, …). The face emits `const badClicks: { value: number; read(): number } = __state("oops")` (driven: `bin/rip --ts test/type-audit/fixtures/08-reactive.rip`) — the `: number` becomes the reactive-CELL type and the value is handed to `__state(...)`, which does not re-check it against `number`. Nothing fires on the value, so each `# @ts-expect-error` is instead flagged `TS2578` (unused) — 5 such on 08 in the runner's verdict.

**Why** — the `:=` lowering wraps the value in a state cell and rewrites the annotation to describe the cell (`{ value: T; read(): T }`), not the value; the initializer flows through `__state(...)` unchecked. Same root as the reactive-cell hover leak (#10) — the value-type *checking* failure here, the value-type *display* failure there.

**vs v3** — v3 enforces the annotation: it compiles 08 (`bin/rip -c` → EXIT 0) and `bin/rip check test/types` is clean (no `TS2578`), so on these lines the expected error fired and was absorbed. v4 accepts the wrong type silently.

### 4. Evolving-let reassignment not caught

A plain `=` binding hoists to an evolving `let` with no type, so TS never pins its inferred type across statements: a variable inferred one type and then reassigned another is not caught. `total = count + ratio` (number) then `total = 'oops'` compiles clean; the expected type error never fires. Silent, no opt-out.

**Status.** ✅ **Verified** (2026-07-12). Declare-in-place lets TS pin the type, so reassignment errors. The reassign-to-different-type markers on 11-inference are used — `verdict` is green, and `TS2578` is reported rather than suppressed, so the unused-directive errors this finding recorded are gone.

**Reproduced** — [11-inference.rip](fixtures/11-inference.rip): the reassign-to-different-type cases (`total`→string, `label`→number, `active`→string, `result`→string, `upper`→number, `joined`→boolean, `first`→number, `msg`→number), each marked `# @ts-expect-error — inferred T`. Driven three ways: (a) the minimal `let total; total = 7; total = 'oops';` passes `tsc --noEmit --strict` (EXIT 0) — evolving-`any` genuinely accepts the reassignment; (b) `tsc` on the full 11 face reported every one of them as a `TS2578` unused directive; (c) the editor's verdict reported the same set.

**Why** — the hoist emits `let total; … total = <number>; … total = 'oops'`. TS types such a split binding by widening across writes (evolving-`any`) rather than pinning it, so no assignment is a type error. Same declaration/initialization split as `typeof`→`undefined` (#5) and write-only-`any` (#9) — here the split *suppresses* real errors. (Contrast the minimal `let total = 7; total = 'oops'` WITH an initializer, which TS does catch — the hoist is precisely what strips the initializer.)

**vs v3** — v3's `patchUninitializedTypes` pinned each hoisted binding to its first-assignment type (`total: number`), so `total = 'oops'` errored — the markers are USED (v3 compiles 11 EXIT 0; `rip check test/types` clean). v4's evolving-`let` cannot pin it (the LSP broker can't patch tsgo's Program), so the reassignment is accepted.

### 5. typeof on an unannotated value resolves to undefined

For `type X = typeof y` (`y` unannotated), the face reads `typeof y` as `undefined`, so downstream uses of `X` fail. `typeof value` is idiomatic TS (`type Config = typeof defaultConfig`), so this blocks legitimate typed code.

**Status.** ✅ **Verified** (2026-07-12). Same declare-in-place campaign as #4: the `typeof`'d binding declares in place, so `typeof` reads its real value type. 02-aliases passes `verdict` and `twin`, and `tsface-tsc` (real tsc) type-checks the face — the `TS2322: … not assignable to type 'undefined'` this finding recorded is gone.

**Reproduced** — [02-aliases.rip](fixtures/02-aliases.rip): `defaults = {theme:'dark',lang:'en'}` / `type Defaults = typeof defaults` / `prefs: Defaults = {…}` → the face fails `tsc --noEmit --strict` with `TS2322: … not assignable to type 'undefined'`; the v4 editor squiggles it.

**Why** — the face is byte-equal to shipped JS after type-stripping, so it mirrors the JS hoist-split — the `type Defaults` line lands above the assignment, so `typeof` reads the uninitialized `let`. Same root as write-only-`any` (#9): the hoist splits declaration from initialization.

**vs v3** — v3's type-checking shadow is NOT strip-gated, so it declares the `typeof`'d variable in-place (`let defaults = {…}`, verified via `rip --shadow`) → `typeof` resolves to the object type; `rip check` is clean (EXIT 0). v3 does this selectively — a plain object assignment without a `typeof` still hoist-splits in v3's shadow.

### 6. ts-expect-error dropped on multi-line emit

A `# @ts-expect-error` guarding a statement whose face emits as MORE THAN ONE line — any arrow/function assignment (`f = (x) -> …`, `x: T = (a) -> …`, an arrow inside a call like `.reduce`) — is silently dropped from the face. The directive stops working, so a real error the author explicitly acknowledged leaks into the editor. Single-line statements keep their directive; the escape hatch just fails on the multi-line class.

**Status.** ✅ **Verified** (2026-07-12). Directives always place above the statement head (the multi-line probe is retired), re-anchoring over inlined forwards. The audit's `directives` dimension — the face carries every `# @ts-expect-error` its source does — is green across the fixtures, so the multi-line drop this finding recorded no longer happens. Caveat recorded below still holds: `directives` and `verdict` both count this one event, so they are not independent of each other.

**Reproduced** — [02-aliases.rip](fixtures/02-aliases.rip): `# @ts-expect-error` over `badSorter: Comparator = (a, b) -> 'nope'`. The face emits `badSorter = function(a, b){ return "nope"; };` (three lines) with **no** directive above it (`bin/rip --ts` drops it: src 5 → face 4), and the suppressed error then surfaces in the editor verdict: `62:0 [TS2322] Type '(a: number, b: number) => string' is not assignable to type 'Comparator'`. Minimal isolation: a `# @ts-expect-error` over a one-line arrow assign `b = (x) -> x.length` is dropped; over a value assign `a = 'oops'` it is kept — and both `a` and `b` are hoisted identically (`let a, b;`), so it is the multi-line emission, not the hoist, that drops it. (01-basic loses 3 the same way: `badAllIds`, `implicitAny`, one more — all arrow-bearing.)

**Why (code)** — [emitter.js](../../src/emitter.js) `withTsDirectives` implemented a deliberate "place-or-decline" rule: the statement emitted behind a builder checkpoint, and a `multiLineSince(cp)` probe declined the directive on any multi-line emission, reasoning that a directive governs only its immediate next line and a multi-line statement may carry its error on an inner line. That single-vs-multi-line test is a PROXY for "can the directive govern the error," and it over-declines the common case where the error lands on the head line (an arrow assigned to a hoisted typed binding — the mismatch reports on `x = function(…){`), which the directive could govern. *The probe and its builder support (`checkpoint`/`multiLineSince`/`rollback`) were removed with the fix — don't grep for them; `withTsDirectives` now always places.*

**vs v3** — v3 hoists `badSorter` identically and emits the same multi-line `function`, but KEEPS the directive above the assignment (verified via `rip --shadow`), and `bin/rip check test/types` → EXIT 0 with no output (no leak). So v3 governs the multi-line case; v4's proxy declines it. Because the runner's `directives` and `verdict` dimensions both count this one event, they are not independent evidence of it.

### 7. No headless type-checker rip check

v4 has no CLI to type-check a file or a project (the `tsc --noEmit` of rip-land). Type diagnostics exist only inside the editor server over LSP — so CI/pre-commit checking requires driving the editor (which is exactly why `runner.js` must be an LSP client).

**Status.** ✅ **Verified** (2026-07-13). `rip check [paths...]` now exists — [bin/rip](../../bin/rip) dispatches the `check` subcommand to [src/check.js](../../src/check.js), which runs the editor's own refresh→probe→pull loop, batched and headless: compile each target `.rip` (and its transitive `.rip` closure) to a TS face, materialize the faces into a mirror with the editor's generated tsconfig, drive **one tsgo session** over the whole mirror — pin-probing each file exactly as the editor does — and map every diagnostic back onto `.rip` source.

The drift-sensitive logic is shared, not copied: the mapping / `rip.strict` gate / `@ts-expect-error` / `rip.noCheck` core lives in [diagnostics.js](../../packages/vscode/src/diagnostics.js), the mirror layout + generated tsconfig + closure-edge discovery in [mirror.js](../../packages/vscode/src/mirror.js), pins in [pins.js](../../packages/vscode/src/pins.js) — and [server.js](../../packages/vscode/src/server.js) imports the same modules. A batch run therefore resolves and suppresses exactly as VS Code does.

Driven by `test/toolchain/check.test.js`: a clean file exits 0; `n: number = 'oops'` reports `TS2322` mapped to `bad.rip:1:1` and exits 1; the implicit-any family stays suppressed by default and surfaces as `TS7006` under `package.json#rip.strict` (the #1 differential, now reachable headlessly); `rip.noCheck: ['legacy/**']` silences a matched path; a `# @ts-expect-error` absorbs its error; a cross-file misuse reports `TS2345` at the call site. **Parity:** `bin/rip check fixtures` runs the audit fixtures clean, matching the runner's verdict dimension — including the pin-dependent case (`11-inference`'s block-confined `needle`/`hits`, read from a closure, which a pins-less `tsc --noEmit` batch mis-reports as an unused directive). That case is why the design is a tsgo session with pins rather than a bare batch. On the pin pass's future see the [`=` hoisting note](#-hoisting-the-shared-root-of-4-5-and-9); on speed, the [performance-crossover note](#rip-check-vs-v3-the-performance-crossover-measured), which is where every timing in this ledger lives.

**Reproduced** (pre-fix) — [bin/rip](../../bin/rip) had no `check` subcommand (modes: `-c`/`--ts`/`-o`/`-m`/`-t`/`-s`/`--dts`/`--runtime`/`--explain`/`--face`). v3 had `rip check [dir]`, whole-project, strict+checkAll.

**vs v3** — v3's checker was an in-process LanguageService CLI; v4's moved into tsgo/LSP, so an in-process equivalent no longer exists. `rip check` restores the capability the other way: rather than re-checking in-process, it runs the editor's own pipeline (faces → mirror → tsgo-with-pins → map diagnostics back) in batch — the one honest source of truth for v4's diagnostics. On speed, see the [performance-crossover note](#rip-check-vs-v3-the-performance-crossover-measured) below: v4 is ~3–4× faster than v3 at typical sizes, but the lead is file-count-sensitive and reverses on many-thin-file projects.

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Status.** ⬜ **Open** (2026-07-14). No fix has landed, but the finding is now **gated** — [auto-import.test.js](../toolchain/auto-import.test.js) drives real completion requests against the server. What works is asserted green (a candidate reachable through the closure *is* offered — a genuine guard against auto-import breaking altogether; opening the orphan *does* bring it in, which is what proves the candidate set is exactly the tsgo program). The gap itself is an **expected failure** asserting the correct behavior — an unimported workspace `.rip` should be offered from cold — so it stays red by agreement while #8 is open and converts to a real failure the day the scope widens. Pinning the broken behavior as if it were correct would be worse than no coverage: a green test certifying the gap.

*Trap worth recording:* tsgo filters auto-import candidates **by prefix**, so a probe typed at `sh` can never offer `orphanWidget` no matter what the program contains — a gate probing the wrong prefix would "reproduce" #8 against a server that had it fixed. And a bare identifier statement does not map cleanly into the face and answers with no completions at all; the probe must sit in an expression position.

**Reproduced** — real server over LSP (2026-07-09): workspace with `util.rip` (reachable — `a.rip` imports it, open `app.rip` imports `a`) + `orphan.rip` (nothing imports it). Completing in `app.rip` offers `shout` from `./util.rip` [closure works] but not `orphanWidget`, which stays `TS2304` with no quickfix [the gap]. Opening `orphan.rip` makes `orphanWidget` immediately offered → candidate set = the closure, reversible only by bringing the file in.

**Why (code)** — the generated tsconfig ([mirror.js](../../packages/vscode/src/mirror.js) `generatedTsconfig`) roots its `include` at the mirror closure: `['**/*.ts', '../../**/*.d.ts']`. The reach-up matches ambient declarations only — no `.rip` mirrors — so the candidate set is exactly the tsgo program, and the program is exactly the open buffers' closure (`materializeClosure` walks only seeds and recorded imports; `pruneClosure` drops any mirror no open buffer reaches).

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This behavior was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

### 9. Write-only unannotated locals hover any

A **non-exported** unannotated local — a value *or* an arrow function (`f = -> …`) — assigned once and never read hovers `any` in v4; v3 showed the inferred type. Mildest of the set: degraded hover in a transient/authoring state (self-heals once any read exists), no hidden bug, no broken code. **The scope is narrow:** evolving-`let` types every case that HAS a read — including a *cross-scope* closure read (an outer var read inside a nested fn types correctly) — and **exported** bindings are exempt (they emit declare-in-place, `export const f = …`), so a `util.rip` of exported-but-uncalled functions all hover their real types. Only a never-read *local* falls to `any`.

**Status.** ✅ **Verified** (2026-07-12). Declare-in-place infers has-a-read cases natively. Settled by the hover audit's **oracle-free not-`any` invariant** (an initialized binding must not hover `any`): **zero violations**, and the gauge reads every hover probe answering a real type, none `any`. This is the strongest evidence in the ledger: no twin and no pin file are involved, so the check structurally cannot self-confirm.

**Reproduced** — a local assigned once and never read hovers `let matches: any` in v4 vs `let matches: string[]` in v3 — a hover-differential no-oracle invariant hit.

**The class has an instance:** [11-inference.rip](fixtures/11-inference.rip)'s `neverRead = filterBy('z')`, written and never read, with a matching declaration in the `.ts` twin so the **twin oracle** judges its hover rather than a pin. It hovers `string[]`, agreeing with the twin. This matters because a read is all it takes to leave the class — every *other* candidate in that fixture is read somewhere, so without this line the not-`any` invariant would sweep the corpus and never once meet the shape the finding is about. A gate that cannot encounter the defect cannot fail on it.

**Why** — the face hoists to an evolving-`let`: TS types it `any` at the declaration and every write, materializing the real type only at reads. `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) recovers it by querying a read site — with zero reads there is nothing to query, so `any` stands.

**vs v3** — v3's `patchUninitializedTypes` injected each hoisted symbol's first-assignment type across all scopes — the general mechanism. v4's evolving-`let` supersedes it for every has-a-read case (verified across scopes); this write-only remainder is the part it can't reach (the LSP broker can't patch tsgo's Program).

### 10. Reactive bindings hover as their cell wrapper

Hovering a reactive binding — `:=` state, `~=` computed, `~>` effect — shows the internal reactive-cell shape instead of the value type v3 resolves. Degraded editor info on the reactive system's core forms; it is the hover-side twin of #3 (the value-type *checking* consequence is #3, this is the value-type *display* one).

**Status.** ✅ **Verified** (2026-07-12). The broker rewrites the reactive-cell shape to its value type (`presentReactiveCellHover`, [server.js](../../packages/vscode/src/server.js)); the runtime is generic on the face. All four shapes are pinned in [hover-pins.json](hover-pins.json), certified against the v3 oracle:

| source | hovers | |
| --- | --- | --- |
| `clicks := 0` | `number` | unannotated → inferred value type |
| `tags: string[] := []` | `string[]` | annotated → the annotation |
| `clicksDoubled ~= clicks * 2` | `number` | unannotated → inferred value type |
| `clickLogger: Function ~> …` | `Function` | annotated → the annotation |

**One rule, uniformly applied: infer when unannotated, honor the annotation when present.** The effect is not an exception — v3 resolved `clickLogger` to `() => void`, *overriding* what the author wrote, and **rip deliberately does not.** An annotation is the author's statement of the type; the hover shows it back. (Whether `: Function` is a *good* annotation to write is the author's business — the editor's job is to be honest about what the source says, not to second-guess it.) The v3 differential recorded in **Reproduced** below is therefore a difference, not a defect, on that row.

Because reactive bindings are rip-native, the twin oracle cannot judge them and these four rest on the pin file. That is sound — the values were reviewed against v3, not photographed blind — with the standing caveat that `--update-hovers` must never be run without reading the diff.

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

**Status.** ✅ **Verified** (2026-07-14) — by [config-reactivity.test.js](../toolchain/config-reactivity.test.js), which drives the real server over LSP. The fix has two halves and the gate pins both:

- **The handler** — open a doc with an unannotated param (clean), write `{"rip":{"strict":true}}` to `package.json`, send `workspace/didChangeWatchedFiles`. No `didOpen`, no edit to the `.rip` doc, no reload: the server re-publishes `TS7006` on the still-open document. The reverse is asserted too — dropping `strict` re-silences it — because a fix that only ever *added* diagnostics on a config change would strand a project turning strict back off.
- **The registration** — that `**/package.json` is in the `watchers` registration. This half cannot be proved by notifying, since a test client notifies whether or not the server asked to watch: a handler that reacts perfectly to a file it never registered is dead code in a real editor, and that unregistered glob *was* the bug. The gate captures the `client/registerCapability` request and asserts the glob is there. Removing it from `server.js` turns the gate red; removing it while asserting only the handler does not.

Not covered: that the VS Code window repaints once the server republishes. Everything upstream of the paint is server work, and that is what the gate holds.

### 12. noCheck parsed but never applied

v3's `rip.exclude` let a partly-typed project keep untyped/legacy paths from being type-checked. v4 parsed the key but consumed it nowhere — the sole reference was the parse line in `config.js` — so excluded paths were still fully checked in the editor.

**Status.** ✅ **Verified** (2026-07-14) — by [config-reactivity.test.js](../toolchain/config-reactivity.test.js). Renamed to `rip.noCheck` (the glob form of the per-file `# @ts-nocheck` directive: matched paths stay in-program so imports resolve, but their diagnostics are silenced) and wired into `refresh()` and `repullDiagnostics`. [config.js](../../src/config.js) parses it; [server.js](../../packages/vscode/src/server.js) matches docs against it (`isNoCheck`, globs resolving relative to `_configDir`). Both session-shaped halves are now pinned:

- **Reactive silencing** — two open files each carrying a `TS2322`; write `noCheck: ['legacy/**']` and notify. The matched file goes quiet *on the open document*, and the unmatched one keeps its error (a `noCheck` that silenced everything would pass a one-file test).
- **The re-pull cannot resurrect** — the reason the guard sits in `repullDiagnostics()` and not only `refresh()`. Editing any open document re-pulls diagnostics for every *other* open document, which is the sole path into `repullDiagnostics`; without the guard, a silenced file lights back up the moment anything else in the session is typed in. Two conditions are load-bearing, and a gate missing either passes whether or not the guard exists: the silenced file must carry a **real error** (an error-free file has nothing to resurrect), and the trigger must be a **`didChange` on another open doc** (a watched-file touch never reaches the re-pull). Deleting the guard from `server.js` turns this gate red.

### 13. Single-rooted tsconfig — no per-project resolution

Both the editor and `rip check` generate ONE tsconfig at the mirror root that `extends` only `<workspaceRoot>/tsconfig.json` ([mirror.js](../../packages/vscode/src/mirror.js) `generatedTsconfig`: `extends: '../../tsconfig.json'`, `rootDirs: ['.', '../..']`). Every `.rip` file is type-checked under the ROOT's `compilerOptions`; a nested package's own `tsconfig.json` — its `types`, `lib`, `jsx`, `strict`, `paths` — is ignored. `package.json#rip` (`strict`/`noCheck`) is already resolved per-file via `readProjectConfig` (nearest `package.json`, [config.js](../../src/config.js)), so the two config systems disagree: rip policy is per-package, tsconfig is flat. A second symptom: the editor roots the mirror at the VS Code folder while `rip check`'s `findWorkspaceRoot` walks to the nearest `package.json`/`tsconfig.json`/`.git` marker — so in a monorepo the same file can extend DIFFERENT tsconfigs in the two surfaces.

**Status.** ⬜ **Open** (no fix). The fix approach is **verified feasible** — driven against real tsgo (see below).

**The fix — one mirror, one session, per-project wrapper tsconfigs.** tsgo's LSP does per-file NEAREST-`tsconfig.json` discovery (the tsserver "configured project" model), so the single mirror tree and single tsgo session stay. Instead of one generated tsconfig at the mirror root, place a generated WRAPPER at each mirrored project dir, each `extends`-ing its source `tsconfig.json` with the same overrides (`noImplicitAny`, `noEmit`, `allowImportingTsExtensions`, `types:["*"]` unless the chain sets `types`) and reach-ups (`extends`, `rootDirs`) computed by `path.relative` instead of the hardcoded `../..`. tsgo then partitions the faces per project internally. Wrappers set their own `include`/`exclude`, so a source tsconfig's file set is not inherited (only `compilerOptions` are).

**Driven** — the real tsgo LSP, two probes:
- Two sibling dirs, one with a `strict:true` `tsconfig.json`, one governed by a loose root: `let x: string = null` reported `TS2322` ONLY under the nearest strict config; the loose file stayed clean. tsgo routes per file.
- The production shape — a nested generated wrapper `extends`-ing a strict source tsconfig via `../../../../pkg/tsconfig.json`, under one mirror root, one session: `pkg/a.rip.ts` reported `TS2322` (strict) while `root.rip.ts` stayed loose. Nested wrappers + reach-ups work.

**Blast radius.** Shared: generalize `generatedTsconfig` + add a `nearestTsconfig(dir, anchor)` walk in `mirror.js`. `rip check` ([src/check.js](../../src/check.js)): after materialization, emit one wrapper per distinct owning tsconfig — small, self-contained. Editor ([server.js](../../packages/vscode/src/server.js)): larger — emit/refresh wrappers during closure materialization and on `tsconfig.json` (or extends-chain) changes via the existing watcher; no session multiplexing. The pin pass and single-session architecture are untouched.

**vs v3** — not established. v3 *is* re-runnable (3.17.5, at `~/Code/shreeve/rip-lang`), so this could be settled either way; nobody has driven a monorepo through it. Framed as a missing capability, not a driven v3 regression.

## Directive handling — unused `@ts-expect-error`

### 14. Unused `@ts-expect-error` silently swallowed

An `@ts-expect-error` that catches nothing must raise `TS2578` — tsc's contract, and the self-cleaning property that makes it safer than `@ts-ignore`. v4 swallowed it: over a throwaway binding (`# @ts-expect-error` / `badCount = 'oops'`, no annotation) the directive governs nothing yet the check reads clean, so a stale escape hatch rots invisibly and can later absorb a genuine new error on that line.

**Status.** ✅ **Verified** (2026-07-14) — `test/toolchain/check.test.js` cases: an unused `@ts-expect-error` reports `TS2578` at the directive and exits 1; an unused `@ts-ignore` stays silent (tsc never flags it); a used directive stays clean on both a single-line statement and a **multi-line** emission (an arrow assigned to a typed binding — finding #6's class, carrying a no-directive negative control so a green run means *absorbed*, not *nothing fired*). The fixtures and the audit are green. The editor shares the fixed core (`applyRipDirectives` in [diagnostics.js](../../packages/vscode/src/diagnostics.js)), so the same directive handling governs both surfaces — one implementation, checked once.

**Root (code).** Not the mapping — tsgo's `TS2578` maps cleanly onto the source directive line. [diagnostics.js](../../packages/vscode/src/diagnostics.js) `applyRipDirectives` marked a directive used on ANY diagnostic in its range, then dropped the mapped `TS2578` via `used.has(...)`. A throwaway binding leaves an unused-local hint (`TS6133`, severity 4 — a fade, not an error) in that range, so the directive looked used. Fix: only an error/warning (`severity <= 2`) marks a directive used; a hint does not (the finding-#6 leaked-error path, severity 1, is unaffected).

**vs v3** — v3 checked the shadow in-process, where the directive sits in the real source, so tsc flagged it natively. Same machinery as #6, inverse failure: #6 is a *used* directive dropped from a multi-line face; #14 an *unused* one that should stay loud but was silenced.

## Semantic tokens — the modifier surface

### 15. Reactive state bindings carry `readonly`

`:=` is the one rip binding form you are *meant* to assign to — `clicks = 5` compiles, lowering to `clicks.value = 5` — yet the editor tags it `readonly` and VS Code paints it as a constant (`variable.other.constant`). The editor denies you the write on the only reactive form that allows one. Third face of the reactive-cell root: #3 is the *checking* failure, #10 the *hover* one, this the *token* one.

**Status.** ✅ **Verified** (2026-07-14). The compile reports the generated span of every `:=` state name (`mutables`), and [server.js](../../packages/vscode/src/server.js) `ripSemanticTokens` clears the `readonly` bit on exactly those. Presentation-only: the emitted JS is byte-identical.

Two gates. [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) pins the rule per binding form, and separately pins every path a `:=` name reaches the face by — bare, exported, nested in a `def`, and a component member (which lowers to a `declare` field, so TypeScript never calls it readonly and there is nothing to clear). The token audit's `readonly` invariant (`bun run type-audit --token`) sweeps every top-level declaration in the fixtures and is green.

**Read the audit's polarity breakdown, not its score.** A blanket strip of the modifier would score green too. What rules that out is that `=!`, `~=` and `~>` each still *demand* the bit and get it, while `plain` and `state` demand its absence: **the clearing is surgical, and `:=` is the only form that moved.** Both gates take their expectations from rip's own syntax, so unlike the hover pins there is no baseline to launder. Scope: declaration sites; locals, parameters and *use* sites are unprobed.

**Why (code).** `ripSemanticTokens` forwards tsgo's tokens verbatim — spans remapped, type and modifier bits untouched — and that is right wherever the face's declaration keyword agrees with rip's semantics. `:=` is the sole form where it does not: the lowering binds a `const` CELL whose value is mutable (`clicks = 5` compiles, becoming `clicks.value = 5`), so TypeScript's `readonly` describes the container, not the name. Every other const-emitting form (`=!`, `~=`, `~>`) really is immutable — the compiler rejects writes to them — so the pass-through stays correct there.

The fix had to reach the **compiler**, which is why it did not close alongside #10: a hover payload carries the cell's *shape* to key off (`presentReactiveCellHover`), but a token carries only a bit, and nothing downstream can tell a `:=` `const` from a `~=` one. The emitter alone knows, so it now exports each state name's generated span — the same seam `pinnables` already uses to hand the editor a span-keyed fact ([emitter.js](../../src/emitter.js) `mutables` → [compile.js](../../src/compile.js) → the server's `lastGood`).

**Why the suite missed it.** `editor-features.test.js` does drive `semanticTokens/full` over real LSP, but only for span fidelity — tokens land on Rip spans, hoist duplicates dedup. No test has ever asserted a **modifier**. The surface was watched for position and unwatched for meaning.

**vs v3 — not a regression.** v3's shadow emits the identical `const clicks = __state(0)` (driven), and v3's token handler bridges TypeScript's classification back to `.rip` the same way: same lowering, same pass-through, same bit. (Unestablished: v3's live token payload; its LSP is re-drivable.) **Not v4 drift — an original hole in the reactive story, inherited.** The only finding here with that shape.

## `=` hoisting: the shared root of #4, #5 and #9

**Status.** ✅ **Addressed** (2026-07-12). Declare-in-place shipped as the evolving-`let` tiers. #4, #5 and #9 each close through it and are verified above; the excess-property case rides the same mechanism (12-cast passes `verdict` and `twin`). *This is not a gap — it is the one root the three findings share, and the residue the fix left behind. Read it when touching the hoist.*

**The root.** Hoisting splits a plain `=` binding's declaration from its value: `x = 1` → `let x; … x = 1`. TypeScript types such a split binding as an evolving-`any` — widening across writes rather than pinning at the declaration — and four regressions traced to exactly that. It cut *both* ways, so it was never simply "more permissive":

| | direction | what the split did |
| --- | --- | --- |
| **#4** reassignment not caught | under-check | `total` inferred number, `total = 'oops'` not flagged — the evolving `let` never pins |
| **#5** `typeof` → `undefined` | over-check | `type Config = typeof defaults` read the uninitialized `let` |
| **#9** write-only-`any` | degraded | a never-read local hovered `any` instead of its inferred type |
| **excess property** (unnumbered) | over-check | `o = {tag, __meta}` against `def getEl(): {tag:string}` — the evolving `let` takes the return type as context, so the fresh literal trips `TS2353`, which `const o = {…}` does not ([12-cast.rip](fixtures/12-cast.rip)) |

**What shipped.** `=!` had always declared in place (`x =! 5` → `const x = 5`). The fix gave plain `=` the same treatment *where the first assignment dominates its uses*, hoisting only where it must. No rip source changed; all four closed at once. The permissive type philosophy is untouched — these were never consequences of permissiveness, just of the emit shape, which is why fixing them cost nothing in expressiveness.

**What it did not close: the block-confined residue.** Declare-in-place applies to a **top-level** `=`. A binding first assigned inside a branch genuinely stays hoist-split (the ~35% below), and if it is also read from inside a closure, TypeScript still sees an evolving-`any`. That is what the Tier-3 **pin pass** exists for — a hover probe at a read site to recover the real type — in the editor and in `rip check`'s batch (#7). Example: [11-inference](fixtures/11-inference.rip)'s `needle`/`hits` inside `search`.

So the fix **shrank** the pin pass without retiring it, and cannot ever retire it: the two sets are disjoint by construction. `captureScan` records a declare-in-place site only for a top-level `=`, and a binding is pinnable only if it *stayed hoisted* and is read in a closure. More declare-in-place therefore reaches none of the remainder. Retiring the pin pass would take a **different** mechanism — statically inferring the first-write type onto the hoist line, in-face, which is what v3's `patchUninitializedTypes` did. That is the open design question this note leaves behind, and it is a simplicity question, not a performance one: the pin pass is a small fraction of `rip check`'s wall-clock, which is dominated by startup and tsgo's cold program-build. (Treat that split as an estimate — `rip check` has no switch to disable the pin pass, so it cannot be re-measured without patching the checker.)

**Why the fix was safe — measured.** On medlabs (61 files, all compiling, ~1,075 hoisted bindings), **~65% already had a top-level first assignment** — the clean declare-in-place case. The other ~35% are assigned inside a block or nested scope, and a subset of those genuinely need the hoist (used after the block), so it stays for them. The change targeted the majority, where the regressions lived, and left hoisting intact for a real minority — it was never "abandon hoisting." *(Proxy: top-level vs nested first assignment over emitted JS, compiled with the v3 compiler since medlabs is v3 source; "needs-hoist" is an upper bound. Re-driven 2026-07-14 — 61/61 compile, 1,078 bindings, 63.9% top-level.)*

## rip check vs v3: the performance crossover (measured)

**Status.** **Driven** (2026-07-13, re-driven 2026-07-14) — both checkers run fresh; v3 (3.17.5) is still reachable at `~/Code/shreeve/rip-lang`.

*Absolute times are hardware-bound and will drift; what this note asserts is the SHAPE of the two curves and that they cross. Re-driving reproduced every row within ~10%.* **The scaling corpus is not checked in** — the 100/500/1000 rows used generated thin `.rip` files, and no generator lives in the repo, so those rows cannot be re-run as published (a rebuilt equivalent corpus reproduces them).

Same capability, different engine: v3's `rip check` type-checks **in-process** through the JS TypeScript LanguageService; v4's drives **native tsgo out-of-process** (faces → mirror → per-file pull). Best-of-N wall-clock:

| files | corpus | v3 | v4 | winner |
| --- | --- | --- | --- | --- |
| 12 | audit fixtures (type-heavy) | 1373 ms | 370 ms | v4 3.7× |
| 100 | generated (type-trivial) | 801 ms | 255 ms | v4 3.1× |
| 500 | generated (type-trivial) | 1127 ms | 822 ms | v4 1.4× |
| 1000 | generated (type-trivial) | 1405 ms | 2162 ms | **v3 1.5×** |

**The first row is a different corpus from the other three** — type-heavy (react/zod, a big type graph) rather than type-trivial — so it does not lie on the curves fitted below, and the four rows are not one series. It is here because it is the real corpus; the other three isolate file-count scaling.

Over the three scaling rows, the curves have opposite shapes. **v3** ≈ ~730 ms fixed + ~0.7 ms/file, LINEAR (the fixed cost warms the in-process LanguageService — loading the whole JS TypeScript compiler, building the program — after which per-file checking is flat, with no IPC). **v4** is SUPERLINEAR per-file (~0.8 → ~2.7 ms/file) on a small fixed cost (~100–140 ms, measured on an empty dir and a one-file run): native tsgo spawns almost instantly, but each file pays a round-trip tax v3 never did — a diagnostic pull (and, where it has a pinnable read, a pin-probe hover), run **sequentially**, plus a face compile and mirror write. v4 traded v3's high-fixed / low-per-file profile for a low-fixed / high-per-file one, and the lead erodes monotonically until the curves **cross in the mid-hundreds of thin files** (~640 by both the published rows and the re-drive) — past that v3 wins.

**Two caveats.** (1) The scaling corpus is type-TRIVIAL, so it isolates file count and says nothing about type complexity; on type-HEAVY code the native engine dominates regardless of file count — the react/zod-laden fixtures hit 3.7× on only 12 files, where the work is a big type graph and native tsgo crushes JS. Real projects sit on both axes (file count × type complexity), which is why the crossover is a property of *thin* files, not a project-size threshold. (2) v4's superlinearity is an implementation artifact, not an architectural limit: the per-file pulls run **sequentially** (issue them concurrently and the round-trips collapse), and the pin pass adds a hover for every file with a block-confined closure read — an irreducible remainder (those bindings stayed hoisted precisely because they *can't* declare in place; see the [`=` hoisting note](#-hoisting-the-shared-root-of-4-5-and-9) above), removable only by a different type-recovery mechanism, not by more declare-in-place. Batching the pulls is the lever that actually flattens v4's curve; the pin pass is the smaller, harder remainder — and neither is a correctness question, since the residual pin pass keeps those cases correct.

## Triaged — the rest of the audit (not new gaps)

Everything the runner surfaces (five dimensions plus the hover audit) is accounted for above. The remaining raw signal was triaged and adds no new findings:

- **Verdict divergences** — all promoted or explained: reactive-annotation-not-enforced (#3), evolving-`let` reassignment (#4), `typeof`→`undefined` (#5), directive-loss (#6); the `12-cast` excess-property case folds into the hoisting note; and `07-integration`'s six divergences are a **cascade** of compiler-gap C1 — its `import … from './06-functions.rip'` can't resolve (06 doesn't compile), so the imported calls become `any` and their five guards report unused.
- **Hover sweep** — the reactive-cell leak is now #10. The rest is not-a-gap: **benign** union-member reordering (v4 sorts literals, v3 keeps source order — same type); **v4 more precise than v3** (nullable/optional unions preserved where v3 flattened to a bare type; branch-only assignment reads `T | undefined`, sound, vs v3's flat `T`); and the evolving-`let` hover shapes on 11-inference (a reassigned binding hovers its later-write type) are the display face of #4/#9, not a separate gap.
- **Skipped fixtures** — non-compiling (C1/C2) and import-bearing files have no face to compare; their would-be differs are the compiler gaps already catalogued, not hover defects.

**What the triage establishes.** It accounts for the raw signal the runner surfaces. It does not verify any fix — the triage explains divergences, it does not confirm that a fix behaves.
