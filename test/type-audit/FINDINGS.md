# Type-audit findings — gaps in rip's typed-editor story

✅ **Verified** (a named gate runs and passes) · 🟡 **Fix landed, unverified** (the code is in; no gate watches it — write one) · ⬜ **Open** (no fix). **The Gate column is the load-bearing one:** a finding with no gate cannot be Verified, however obviously fixed it looks.

**Numbers are IDs, not order** — assigned once, cited in commits, code, and each other, never reused or renumbered. The **Tags** column groups by root: `compiler` (parser/emitter) · `strict` (implicit-any & safety) · `hoist` · `reactive` (the `:=` cell) · `directive` · `config` · `editor` (hover/token surfaces) · `capability`. They are **labels, not partitions** — a finding that shares a fix with two roots carries both, which is where the cross-cutting relationships live (a fix on the reactive cell touches #3, #10, and #15; #20 is a `compiler` hole the `strict` gate exposes).

| # | Finding | Tags | Status | Gate |
| --- | --- | --- | --- | --- |
| [C1](#c1-optional-marker-rejected) | Optional `?` marker rejected | `compiler` | ✅ Verified | `dts-tsc`, audit `compiles` |
| [C2](#c2-method-shorthand-in-type-body-rejected) | Method-shorthand in type body rejected | `compiler` | ✅ Verified | `dts-tsc`, audit `compiles` |
| [1](#1-implicit-any-suppressed-with-no-opt-out) | Implicit-any suppressed, no opt-out | `strict` | ✅ Verified | `strict-modes` |
| [2](#2-use-before-assign-hidden-on-annotated-forwards) | Use-before-assign hidden by `!` | `strict` | ✅ Verified | `strict-modes`, `tiers` |
| [3](#3-reactive-binding-annotations-not-enforced) | Reactive annotations not enforced | `reactive` | ✅ Verified | audit `verdict` |
| [4](#4-evolving-let-reassignment-not-caught) | Evolving-`let` reassignment not caught | `hoist` | ✅ Verified | audit `verdict` |
| [5](#5-typeof-on-an-unannotated-value-resolves-to-undefined) | `typeof` unannotated → `undefined` | `hoist` | ✅ Verified | audit `verdict`/`twin`, `tsface-tsc` |
| [6](#6-ts-expect-error-dropped-on-multi-line-emit) | `@ts-expect-error` dropped on multi-line | `directive` | ✅ Verified | audit `directives`, `check` |
| [7](#7-no-headless-type-checker-rip-check) | No headless `rip check` | `capability` | ✅ Verified | `check` |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | `capability` | ⬜ **Open** | `auto-import` (gap = expected-failure) |
| [9](#9-write-only-unannotated-locals-hover-any) | Write-only locals hover `any` | `hoist`, `editor` | ✅ Verified | hover audit's not-`any` invariant |
| [10](#10-reactive-bindings-hover-as-their-cell-wrapper) | Reactive bindings hover cell wrapper | `reactive`, `editor` | ✅ Verified | hover audit + `hover-pins.json` |
| [11](#11-config-changes-required-a-reload) | Config changes required a reload | `config` | ✅ Verified | `config-reactivity` |
| [12](#12-nocheck-parsed-but-never-applied) | `rip.noCheck` parsed but never applied | `config` | ✅ Verified | `config-reactivity` |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | `config` | ⬜ **Open** | **none** |
| [14](#14-unused-ts-expect-error-silently-swallowed) | Unused `@ts-expect-error` silently swallowed | `directive` | ✅ Verified | `check` |
| [15](#15-reactive-state-bindings-carry-readonly) | Reactive `:=` bindings tagged `readonly` | `reactive`, `editor` | ✅ Verified | `semantic-tokens`, token audit's `readonly` invariant |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | ⬜ **Open** | **none** (upstream; a naive gate is platform-dependent) |
| [17](#17-a-directive-swallows-the-unused-local-fade) | A directive swallows the unused-local fade | `directive` | ✅ Verified | `editor-features` (TS directives reach the editor) |
| [18](#18-a-directive-blinds-the-whole-indented-block) | A directive blinds the whole indented block | `directive` | ⬜ **Open** | **none** (over-suppression is what makes `verdict` pass) |
| [19](#19-a-directive-inside-a-render-block-never-reaches-the-face) | Inline render-block directive lost from the face | `directive`, `compiler` | ⬜ **Open** | **none** (audit `directives` would catch it — no fixture uses the shape) |
| [20](#20-everything-inside-a-render-branch-is-unchecked) | Render branch/loop bodies are unchecked (`ctx: any`) | `strict`, `compiler` | ⬜ **Open** | audit `strict` — **red by design** until it closes |
| [21](#21-tokens-drop-past-a-face-rewrite-on-a-cover-row) | Tokens drop past a face rewrite on a cover row | `editor`, `compiler` | ⬜ **Open** | audit `member` + `survival` — **red by design** until the mapping fix lands |
| [22](#22-completion-and-signature-help-fail-on-an-incomplete-expression) | Completion & signature help fail on an incomplete expression | `editor`, `compiler` | ⬜ **Open** | **none** (a completion + signature-help content audit would catch both — neither built) |

## How to read this ledger

**Trust the Status line, not the body.** Each finding's body is the original audit snapshot — present-tense and pre-fix, even where the fix has landed. The **Status** line is the current truth, and records only what someone actually ran.

**✅ Verified means a named gate runs and passes.** Nothing else earns it — not a code reading, not a scratch script, not a plausible argument. Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders. Beware the reflex to call a claim "editor-only": that is usually an unwritten test, not an unreachable one.

**What the evidence is worth.** The runner drives the real server (`bun run type-audit`; `--hover`, `--token`, `--all`, and `--help` for what each audit is judged against). Hovers are settled by the **twin oracle** — tsgo hovering the hand-written `.ts` twin, which is TypeScript's own answer — and, for the rip-native remainder the twin cannot express, by [hover-pins.json](hover-pins.json). *That file is a baseline, and `--update-hovers` re-photographs it from the server: re-pin without reading the diff and you launder a regression into the record.* The token audit carries no such hazard — its expectations come from the `.rip` source itself, so it cannot self-confirm.

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** Every **vs v3** line below was established by driving v3 — still reachable (3.17.5, `~/Code/shreeve/rip-lang`) and re-drivable, as the [performance-crossover note](#rip-check-vs-v3-the-performance-crossover-measured) does. This repo is **v4, cleaned up**; the bodies' "v4" means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-07-14. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree.

**Beyond this ledger.** The wider editor surface is covered by the extension's own suite (`packages/vscode/test/`) — completions, definition, references, rename, code actions, semantic tokens, all over real LSP. *Driven is not the same as asserted:* its semantic-token tests check that tokens land on Rip spans and dedup, and assert no **modifier** at all — a token can be in the right place and still say the wrong thing about the code. Modifiers are gated separately ([semantic-tokens.test.js](../toolchain/semantic-tokens.test.js), #15) and swept by the token audit. A green suite bounds only what its assertions reach.

## Findings

In ID order — the grouping is the **Tags** column above, not the layout here. Two things ID order does not show, worth stating once:

- **C1 and C2 are compiler blockers, a class apart.** They produce **no face at all**, so the file is dark to the whole pipeline — no diagnostics, hover, or completion, nothing downstream to run. All four affected fixtures are v3's own `test/types` files ported verbatim, and **v3 compiles all four** (driven, `bin/rip -c` → EXIT 0 each); two parser holes account for them.
- **Where v4 trails v3, the root is almost always one thing:** the tsgo/LSP broker and the strip-gated face replacing v3's in-process LanguageService and its free-form type-checking shadow. The gaps were driven against rip-v4; the fix statuses re-driven against this code. (#11 and #12 are a different root — config-surface defects found while verifying #1.)

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

### 14. Unused `@ts-expect-error` silently swallowed

An `@ts-expect-error` that catches nothing must raise `TS2578` — tsc's contract, and the self-cleaning property that makes it safer than `@ts-ignore`. v4 swallowed it: over a throwaway binding (`# @ts-expect-error` / `badCount = 'oops'`, no annotation) the directive governs nothing yet the check reads clean, so a stale escape hatch rots invisibly and can later absorb a genuine new error on that line.

**Status.** ✅ **Verified** (2026-07-14) — `test/toolchain/check.test.js` cases: an unused `@ts-expect-error` reports `TS2578` at the directive and exits 1; an unused `@ts-ignore` stays silent (tsc never flags it); a used directive stays clean on both a single-line statement and a **multi-line** emission (an arrow assigned to a typed binding — finding #6's class, carrying a no-directive negative control so a green run means *absorbed*, not *nothing fired*). The fixtures and the audit are green. The editor shares the fixed core (`applyRipDirectives` in [diagnostics.js](../../packages/vscode/src/diagnostics.js)), so the same directive handling governs both surfaces — one implementation, checked once.

**Root (code).** Not the mapping — tsgo's `TS2578` maps cleanly onto the source directive line. [diagnostics.js](../../packages/vscode/src/diagnostics.js) `applyRipDirectives` marked a directive used on ANY diagnostic in its range, then dropped the mapped `TS2578` via `used.has(...)`. A throwaway binding leaves an unused-local hint (`TS6133`, severity 4 — a fade, not an error) in that range, so the directive looked used. Fix: only an error/warning (`severity <= 2`) marks a directive used; a hint does not (the finding-#6 leaked-error path, severity 1, is unaffected).

**vs v3** — v3 checked the shadow in-process, where the directive sits in the real source, so tsc flagged it natively. Same machinery as #6, inverse failure: #6 is a *used* directive dropped from a multi-line face; #14 an *unused* one that should stay loud but was silenced.

### 15. Reactive state bindings carry `readonly`

`:=` is the one rip binding form you are *meant* to assign to — `clicks = 5` compiles, lowering to `clicks.value = 5` — yet the editor tags it `readonly` and VS Code paints it as a constant (`variable.other.constant`). The editor denies you the write on the only reactive form that allows one. Third face of the reactive-cell root: #3 is the *checking* failure, #10 the *hover* one, this the *token* one.

**Status.** ✅ **Verified** (2026-07-14). The compile reports the generated span of every `:=` state name (`mutables`), and [server.js](../../packages/vscode/src/server.js) `ripSemanticTokens` clears the `readonly` bit on exactly those. Presentation-only: the emitted JS is byte-identical.

Two gates. [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) pins the rule per binding form, and separately pins every path a `:=` name reaches the face by — bare, exported, nested in a `def`, and a component member (which lowers to a `declare` field, so TypeScript never calls it readonly and there is nothing to clear). The token audit's `readonly` invariant (`bun run type-audit --token`) sweeps every top-level declaration in the fixtures and is green.

**Read the audit's polarity breakdown, not its score.** A blanket strip of the modifier would score green too. What rules that out is that `=!`, `~=` and `~>` each still *demand* the bit and get it, while `plain` and `state` demand its absence: **the clearing is surgical, and `:=` is the only form that moved.** Both gates take their expectations from rip's own syntax, so unlike the hover pins there is no baseline to launder. Scope: declaration sites; locals, parameters and *use* sites are unprobed.

**Why (code).** `ripSemanticTokens` forwards tsgo's tokens verbatim — spans remapped, type and modifier bits untouched — and that is right wherever the face's declaration keyword agrees with rip's semantics. `:=` is the sole form where it does not: the lowering binds a `const` CELL whose value is mutable (`clicks = 5` compiles, becoming `clicks.value = 5`), so TypeScript's `readonly` describes the container, not the name. Every other const-emitting form (`=!`, `~=`, `~>`) really is immutable — the compiler rejects writes to them — so the pass-through stays correct there.

The fix had to reach the **compiler**, which is why it did not close alongside #10: a hover payload carries the cell's *shape* to key off (`presentReactiveCellHover`), but a token carries only a bit, and nothing downstream can tell a `:=` `const` from a `~=` one. The emitter alone knows, so it now exports each state name's generated span — the same seam `pinnables` already uses to hand the editor a span-keyed fact ([emitter.js](../../src/emitter.js) `mutables` → [compile.js](../../src/compile.js) → the server's `lastGood`).

**Why the suite missed it.** `editor-features.test.js` does drive `semanticTokens/full` over real LSP, but only for span fidelity — tokens land on Rip spans, hoist duplicates dedup. No test has ever asserted a **modifier**. The surface was watched for position and unwatched for meaning.

**vs v3 — not a regression.** v3's shadow emits the identical `const clicks = __state(0)` (driven), and v3's token handler bridges TypeScript's classification back to `.rip` the same way: same lowering, same pass-through, same bit. (Unestablished: v3's live token payload; its LSP is re-drivable.) **Not v4 drift — an original hole in the reactive story, inherited.** The only finding here with that shape.

### 16. Library globals lose the `defaultLibrary` modifier

Symbols declared in `lib.*.d.ts` reach the editor with **no `defaultLibrary` modifier**, so VS Code falls back to `variable.other.readwrite` / `entity.name.function` instead of the `support.*` scopes themes reserve for the standard library. Token *types* are correct; only the modifier is missing. Driven on `console`, `Math`, `parseInt` and `isNaN`, and true of the whole class — the lookup that sets the bit never consults the symbol, and **not one token** in the fixture carries it. The mirror of #15 — that modifier is wrongly present, this one wrongly absent — and the only finding here whose cause is outside rip.

**Status.** ⬜ **Open** (2026-07-14). **Upstream, in tsgo**: rip cannot fix it in `ripSemanticTokens` because the bit never arrives to forward. Filed as [microsoft/typescript-go#4635](https://github.com/microsoft/typescript-go/issues/4635).

**Driven** — both editor servers over real LSP, same machine, same fixture lineage:

| server | library globals carrying `defaultLibrary` |
| --- | --- |
| v3 — in-process TS 6.0.3 LanguageService, on v3's `test/types/06-functions.rip` (v3 is reachable at `~/Code/shreeve/rip-lang`) | **every one** |
| v4 — tsgo broker, on [06-functions.rip](fixtures/06-functions.rip) | **none** |

Also driven straight against the tsgo binary, bypassing rip: **not a single token** on the `.ts` twin, under both the native-preview extension and the released `typescript@7.0.2`. The engine, not rip's remapping.

**Why (code)** — tsgo's classifier (`internal/ls/semantictokens.go`, `collectSemanticTokensInRange`) passes a declaration's **raw** `FileName()` to `IsSourceFileDefaultLibrary`, a lookup in a map keyed by **canonical** paths. Canonicalization lowercases on a case-insensitive filesystem, so `/Users/…` never matches its key `/users/…` and the lookup always misses; every other caller in tsgo passes `sourceFile.Path()`. Causally confirmed: copy tsgo's lib dir to an all-lowercase path, change nothing else, and every library global gets its modifier back — same binary, same file, same client.

**Platform-conditional — the gating hazard.** On a case-SENSITIVE filesystem the canonicalization is the identity function and the bug does not occur, so a gate asserting `console` carries `defaultLibrary` **fails on macOS/Windows and passes on Linux**. Reporting differently by platform is worse than no gate, and the expected-failure device (#8) does not fit — an expected failure that passes on half the platforms is not one. Hence Gate **none**. **Never close this by asserting the modifier's ABSENCE:** that pins an upstream bug into the suite and certifies it correct. The honest gate becomes writable the day #4635 lands.

**vs v3** — **regression** (driven, above). v3 classifies in-process through the JS TypeScript LanguageService (`getEncodedSemanticClassifications`), which canonicalizes correctly, so the same code on the same machine gets the bit. Same tsgo/LSP-broker root as #1–#10. It surfaced late because the modifier surface is only half-watched: #15 gated `readonly`, and nothing asserts `defaultLibrary` — or any modifier on a *library* symbol, since both #15's gate and the token audit probe rip's own declarations.

### 17. A directive swallows the unused-local fade

A `@ts-expect-error` suppressed **everything** on the line it governs, not just the error it promised. So `# @ts-expect-error` / `badCount: number = 'oops'` — the shape every negative fixture in this corpus uses — lost its `TS6133` fade too: VS Code left `badCount` undimmed and gave no "declared but its value is never read" hover, while the `.ts` twin two panes over showed both. The user sees a suppressed line as *fully* clean, when tsc says only its error is.

**Status.** ✅ **Verified** (2026-07-14). [editor-features.test.js](../../packages/vscode/test/editor-features.test.js), `TS directives reach the editor` — two cases, split by **where the error is absorbed**, because only one of them reaches the changed code at all:

- *single-line* (`# @ts-expect-error` / `badCount: number = 'oops'`) — the face directive sits directly above the one emitted statement, so **tsgo** absorbs the `TS2322` at the face and `applyRipDirectives` only ever sees the hint. The `TS6133` survives at severity 4 with `tags: [1]` (Unnecessary — the bit VS Code fades on) on the binding's Rip span. Same for `@ts-ignore`, which takes the same range path and which nothing else pinned.
- *block-bodied* (a directive over a `def` whose body holds the error) — the face directive governs only its next FACE line, so the error **leaks** past it (#6's class) and reaches `applyRipDirectives` over rip positions. This is the only path that exercises the changed branch end to end: the leaked error is absorbed, absorbing it marks the directive **used**, tsgo's now-spurious `TS2578` drops — and the hint in the same range still rides through.

Both carry a negative control (read the binding / drop the directive), so green means *absorbed* and *survived*, not *nothing fired*. Both watched fail before the fix (the diagnostic set came back empty). **The guard that a hint alone must NOT mark a directive used — #14 — is pinned separately** by `check.test.js`'s *an unused `@ts-expect-error` stays loud*, where a hint is the only thing in range and the `TS2578` survives; neither case here can stand in for it.

**Root (code).** [diagnostics.js](../../packages/vscode/src/diagnostics.js) `applyRipDirectives` dropped every diagnostic in a directive's range unconditionally (`if (r) { …; continue; }`); the severity test governed only whether the directive counted as **used**, never whether the diagnostic *survived*. Fix: only an error/warning (`severity <= 2`) is both absorbed and marks the directive used — a hint does neither. Not the mapping layer: the `TS6133` maps `exact` onto the `.rip` identifier and clears the tagged-span gate in `mapTsDiagnostic` (that gate, the first suspect, is innocent).

**The reference.** tsc's directives govern **errors**, never the suggestion classes. Driven against tsgo itself on a plain `.ts` module (the engine rip brokers, no rip in the loop): under `// @ts-expect-error` the `TS2322` is suppressed and the `TS6133` still arrives, `severity 4`, `tags [1]` — and `// @ts-ignore` behaves identically. Rip's directive was strictly *stronger* than the thing it emulates, and the fade was collateral. *(A `.ts` probe must be a **module** — an unused top-level binding in a script is a global, which TypeScript never calls unused, and a script-shaped probe reports nothing and looks like a clean pass.)*

**Why the suite missed it.** The audit's `verdict` dimension counts **Error-severity** diagnostics only, so a swallowed hint scores clean — the audit stayed green through both the bug and the fix, and could not have gone red for either. `rip check` cannot see it either: the batch surface filters `severity <= 2` by design ([check.js](../../src/check.js)), the fade classes being no one's build failure. The bug lived in the one gap between them — an editor-only, presentation-only payload — and was found by *looking at the editor* beside its twin. **The `verdict` dimension is a floor, not a description of the diagnostic set;** the hint classes on top of it are still largely unwatched (`TS6138`, `TS6196`, the deprecation strike).

**vs v3** — **not established.** v3 checked the shadow in-process, where the directive sits in the real source and tsc's own suppression applies natively — so the fade would have survived for free, since v3 never had a range-suppression pass to get wrong. That is a code reading, not a driven result: v3's live diagnostic payload was not pulled, and the ledger's own rule is that a reading does not settle a **vs v3** line. v3 is re-drivable (3.17.5, `~/Code/shreeve/rip-lang`) if this is worth settling.

### 18. A directive blinds the whole indented block

`ripDirectiveLines` governs the next statement **plus its entire indented block**. tsc governs the next **line**. So one `# @ts-expect-error` above a `def` silently absorbs every error in that function body — including bugs written later that the directive never contemplated. It is the same disease as #17 (rip's directive stronger than the thing it emulates), one level up: #17 swallowed a fade, this swallows *errors*.

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

**What a fix costs.** The rule change is two lines in `ripDirectiveLines` (stop extending past the head) plus one fixture line. It must land **with #19**, not before: narrowing makes the inline-prop directive the only render-block hatch, and that hatch currently works only through rip's own suppression pass, because the face never receives it.

### 19. A directive inside a render block never reaches the face

Place `# @ts-expect-error` on a bind/prop line *inside* a render block and the compiler drops it: the face is emitted without it. The error is still suppressed in the editor and in `rip check` — but only because `applyRipDirectives` catches it over **rip** positions. TypeScript itself never sees the directive, so the suppression rests entirely on rip's fallback pass rather than on the face.

**Status.** ⬜ **Open** — no fix. **Gate: none today, but the audit *would* catch it:** the `directives` dimension counts directives in source vs face, and the moment a fixture places one inline it goes red (`directives src=32 face=31 (lost 1)` — driven 2026-07-14, by moving [09-components.rip](fixtures/09-components.rip)'s `Input` directive onto its bind line). It is green now only because **no fixture uses the inline form** — the dimension is watching a shape nobody writes.

**Driven, and independent of #18** (2026-07-14). Reproduced with block-scoping left fully intact and only the fixture edited, so it is not an artifact of narrowing the range rule: same `directives src=32 face=31`. This is #6's class — a directive lost in emission — surviving in a corner #6's fix did not reach: #6 taught a **statement** directive to place on the head line of its lowering; a directive *interior* to a render block has no such placement and is dropped.

**Why it matters now.** On its own it is latent — nobody writes the inline form, and rip's own pass would cover them if they did. It becomes load-bearing the moment #18 lands: narrowing the range makes the inline directive the *only* way to acknowledge an error inside a render element, and it would then be a hatch that works by accident. **Fix this first, then #18.**

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

**Status.** ⬜ **Open** — no fix, but **gated as of 2026-07-14: the audit's sixth dimension, `strict`** (`bun run type-audit`), which runs `rip check` over the corpus with `rip.strict` on and demands zero errors. It is **red by design** and names this finding in its evidence — `09-components.rip … [TS7006] Parameter 'ctx' implicitly has an 'any' type` — and it goes green exactly when the hole closes. *(The live ratio is what the run prints; quoting one here would go stale the day a fixture is added.)*

That dimension exists because nothing else could see this. `verdict` demands zero Error-severity diagnostics, so an unchecked region is indistinguishable from a clean one — *silence is what passing looks like* — and `verdict` already runs under the strict **tsconfig**, which is a different switch entirely: tsgo emits the `TS7006` today and `mapTsDiagnostic` **drops** it (`SUPPRESSED_TS_CODES`, #1). **The two holes compound: #1 hides the symptom that would have exposed #20**, and un-suppressing it is the whole content of the new dimension.

**Read its failures, not its ratio — they have two roots and only one is rip's fault.** *Compiler-emitted* (a real hole; the author cannot annotate their way out): `09-components`'s `ctx` and render scaffolding, and — surfaced by the same dimension — `10-validation`'s `it`, the implicit lambda parameter a `schema` block injects (`id! -> it.Id`), which is the same class as `ctx` and is untracked by any other finding. *Author-annotatable* (working as designed): `06-functions`'s `title?`, an optional param the author simply left untyped — gradual typing permitting exactly what it promises. Annotating `06` would raise the score without closing a single hole; do not mistake that for progress.

**Driven** (2026-07-14), one expression relocated, everything else held fixed:

| where `count.toUpperCase()` sits | `rip check` |
| --- | --- |
| render top level | **caught** — `TS2339` |
| inside an `if` branch | **silent** |
| inside a `for` row | **silent** |
| inside a `switch` arm | **silent** |

**Root (code).** A branch/loop body lowers to a **fragment**, and the fragment's context parameter is emitted **untyped** — [emitter.js](../../src/emitter.js), the fragment record's `self` (minted `ctx`) and the `p(ctx)` / factory signatures built from it. The face reads `p(ctx) { __effect(() => { _t0.data = ctx.count.value.toUpperCase() }) }`, so `ctx` is an implicit `any` and every member access through it is unchecked. The diagnostics that would have said so are exactly the implicit-any family rip suppresses (#1): under `rip.strict` the face reports `TS7005`/`TS7006` — complaints about the *implicitness*, never the `TS2339` underneath. **The two holes compound:** #1 hides the symptom that would have exposed #20.

**Scope.** Conditions, discriminants and iterables ARE checked — `if labelz`, `switch statusz`, `for item in itemsz` all fire (they are emitted in component scope, not through `ctx`), which is why [09-components.rip](fixtures/09-components.rip)'s typo directives are genuinely used. It is the **bodies** that go dark. So the checked/unchecked boundary runs straight through the middle of a render block, exactly where a reader would assume it does not.

**Why the suite missed it.** [09-components.rip](fixtures/09-components.rip) `RenderCondTest` tests every branch form — and every body it puts inside them is a string literal (`span 'label'`, `span 'ready'`, `span 'list'`), which cannot carry a type error. The fixture proves the *conditions* are checked and says nothing about the bodies, while its section header claims render-block expressions are type-checked generally. **A fixture that cannot fail a dimension is not covering it.**

**vs v3** — **not established.** v3 is re-drivable (3.17.5, `~/Code/shreeve/rip-lang`); nobody has put a bad expression inside a v3 render branch. Worth settling before assuming this is inherited rather than v4 drift.

### 21. Tokens drop past a face rewrite on a cover row

A name loses its semantic token — no classification, no modifiers — whenever it rides a coarse cover row whose byte-for-byte correspondence to the face breaks *before* it. The token surface only: types, checking, and compiled JS are unaffected. VS Code falls back to the TextMate scope (e.g. `variable.parameter.type.rip`, an ordinary variable) instead of the `property`/`variable` the semantic token would have named — whatever the theme paints each. The fourth face of the tsgo/broker root (#15 the modifier wrongly present, #16 wrongly absent, this one a token wholly absent).

**Two surfaces, one root.** It drops **type-body members** (a property in a `type`/`interface` body — found first, gated first) and **use sites** (every identifier read right of the divergence — a `console.log('x:', x)` argument, a reactive `:=` read). Uses outnumber declarations, so the use-site surface is larger and the one no source enumeration reaches. Two triggers put a divergence before the name: an inline **quote rewrite** (`'circle'` → `"circle"` in `type Circle = { kind: 'circle', radius: number }`, dropping every member after it — likewise `'total:'` left of `total`), and a **block reflow** (`interface Identifiable` / `  id` → `interface Identifiable { id }`, whose inserted `{` drops *every* member, nothing preceding it).

**Status.** ⬜ **Open** (2026-07-15) — no fix, but now **gated red by design** on both surfaces, by two invariants that flip green together the day the mapping fix lands:

- **`member`** ([runner.js](../../test/type-audit/runner.js) `typeMembersOf`) — enumerates type-body members from SOURCE and asserts each gets a token. Presence only.
- **`survival`** ([runner.js](../../test/type-audit/runner.js) `faceSurvival`) — the OTHER direction, and count-based: a dropped token's source offset is unrecoverable (past a byte divergence the map collapses to the cover-row start), so it does not correspond by position. It takes the SET of names tsgo classifies on the face, counts each name's source occurrences, and subtracts what the real server (`session.semanticTokens`) delivered — the deficit is the drop. The only invariant that reaches use sites and rip-native names, and the server is the delivery oracle, so no remap is reimplemented (which is why it needs no cross-check — a silent guard only flags it if this standalone face oracle drifts from the server's tsgo).

Both are token twins of the #20 `strict` gauge — red rows retired the day the fix lands. Platform-independent (a token lands or it does not), so unlike #16 they carry none of that finding's gating hazard. Each asserts the CORRECT behavior (a name *should* classify), never the bug's absence — the direction #16 warns against.

**Driven — type-body members.** Over the real server (`session.semanticTokens`, the #15 harness) every compiling fixture: almost every block member drops; the only survivors are members that sit AHEAD of their line's divergence — a discriminated-union `kind` before its `'…'` literal, the members of a `{…}` union arm the face leaves byte-for-byte intact. The mechanism, on `type Circle = { kind: 'circle', radius: number }`:

| name | vs the `'circle'` rewrite | token |
| --- | --- | --- |
| `kind` | before | `property` ✓ |
| `radius` | after | **absent** |

Control — `type P = { a: number, b: string }`, no literal to rewrite and no block reflow: **both** `a` and `b` classify. So the trigger is the divergence, not member position; leave the body verbatim and the whole line maps. (Live tally: the audit's `member` gauge.)

**Driven — use sites.** The `survival` gauge, over the real server, confirms the same drop at reads across the corpus — the count-based method (above) reports every classified source identifier the server fails to deliver. The same root, seen at reads rather than declarations, three shapes:

- **The `console.log('x:', x)` family** — the argument name drops because the single-quoted label to its left is quote-normalized on the call's coarse cover row.
- **Rip-native reactive reads** — [08-reactive.rip](fixtures/08-reactive.rip)'s `:=`/`~=` names, lowered to `.value` cells, with no column-0 declaration and **no TS twin** — the surface only this gauge can see.
- **Union arms and component reads** — a union's tag/value reads, a component's property/element reads.

The two gauges target different surfaces — `member` on type-body presence, `survival` on names the editor colors somewhere that then drop at uses (the `delivered ≥ 1` gate keeps a fully-dropped member from being double-counted here). They share one root, so they retire together. (Live tally: `bun run type-audit`.)

**Why (code).** A type declaration emits ONE coarse `typedecl` **cover** row over its whole span, no per-identifier rows (verified with `rip --explain --face ts`): `type Circle …` is source `23:1-23:49` → face `5:1-5:50`; `interface Identifiable …` is source `[62,97)` → face `[0,40)`. So every member maps through the cover fallback, [generatedEditSpanToSource](../../packages/vscode/src/translate.js) (called by [ripSemanticTokens](../../packages/vscode/src/server.js) via `exactSpanMapper`'s miss path), whose rule is a **verbatim prefix check from the cover's start**: a token `[s,e)` maps only where source and face agree byte-for-byte from the cover start through `e`. The first divergence ends the prefix — for the inline case the quote at source `23:22`, for the block case the ` {` inserted right after `Identifiable`. Every member past that point fails the slice comparison, `generatedEditSpanToSource` returns null, and the token is dropped; it falls through to the grammar's `variable.parameter.type.rip` scope, the `property` classification simply missing rather than overridden.

**The general shape.** Any face difference — quote normalization, block→brace reflow, added `;`, stripped indentation — before a name on a construct carried by a single coarse cover row truncates the verbatim prefix and drops every later token on it. The remap verifier itself is correct — it refuses to guess past a divergence, exactly the strictness edits and auto-import (#14, #8) depend on — so the fix belongs upstream at the mapping seam: emit per-name exact rows (names no longer ride a cover prefix), or narrow the face rewrites (leave literals un-normalized, keep the intervening bytes verbatim). Either flips **both** the `member` and `survival` gauges green — they share this one root, so neither closes alone.

**Why the suite missed it.** Every token gate was source-enumerated at declarations — `declsOf` (column-0), plus [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) (#15) and the `readonly` sweep on column-0 `:=`/`=!`/`~=` names, and [editor-features.test.js](../../packages/vscode/test/editor-features.test.js) on span fidelity. `Circle` and `total`'s *declaration* get tokens, so every gate passed while `radius` and `total`'s *use* were never in any set. The two surfaces then needed two different moves: a **wider enumeration** (`typeMembersOf`) for members, but use sites have no column-0 anchor and rip-native reads no twin, so they needed a different oracle entirely — the `survival` gauge, which compares the names the face classifies against the set the server delivered. Source→token enumeration cannot see a use; a classified-name-vs-delivered count can.

**vs v3 — established (driven both sides, 2026-07-15).** v3 compiles to TS, runs `getEncodedSemanticClassifications`, and remaps the spans back (rip-lang 3.17.5 `packages/vscode/src/lsp.js`) — it is not remap-free, so a token surviving is a property of its remap, not of classifying on raw source. Driven on the real v3 LSP against the v4 server, the verdict **splits by surface**:

- **Type-body members — regression.** `type Circle = { kind: 'circle', radius: number }`: v3 classifies `radius` `property`, v4 drops it. The `member` gauge tracks a genuine v4 loss — v3's remap survives the quote rewrite where v4's cover-prefix does not.
- **Use sites — mostly inherited, causes inverted.** `console.log('total:', total)`: both drop the use, so no outcome change on the common single-quoted form. But the cause is opposite — v4 drops it to quote-normalization (`console.log("total:", total)` **rescues** it in v4), while v3 drops it to the call-argument context regardless of quotes (double-quoting does **not** rescue it in v3). A bare `x = total` and a minimal reactive read (`x = clicks` off `clicks := 0`) classify in **both**. So the `console.log`-argument drops — the bulk of the `survival` count — are v3-inherited, not v4 drift.

Unsettled: 08's reactive reads drop in v4 only in render/component context (the minimal read survives both); that exact context was not reproduced on v3. Net: the **member** surface is the established v4 regression; the **use-site** surface is largely a shared, pre-existing limitation.

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
| `r = add(1, 2)` — closed, cursor inside the 2nd arg | rip broker | ✅ `add(a: number, b: number): number`, activeParameter 1 |
| closed, then backspaced to `r = add(1, ` | rip broker | **null** (no fallback) |
| `let r = add(1, ` — unclosed mid-args | tsgo (twin) | ✅ same label, activeParameter 1 |

Signature help is the harsher surface: with no statement-context fallback, every open-paren state returns plain null, prior compile or not. It works only on the **closed** call `add(1, 2)` — exactly when it is no longer needed — where the response passes through correctly (signatures / activeParameter untouched, the design the bodiless-overload note in `onSignatureHelp` relies on).

**Why the suite missed it.** Both tests use the **already-complete** form — the one state that has a face. Member completion is tested at `msg.sub‸` (a complete member expression; [editor-features.test.js](../../packages/vscode/test/editor-features.test.js) "member completion serves with resolve-lazy detail") and signature help at a closed `pick(1, 2)` ("active parameter indices hold across bodiless overload rows"). `msg.sub` and `pick(1, 2)` parse; `msg.` and `pick(` do not. Exercising a feature only at the position it works, never at the position it is used, is the sharpest form of *driven is not the same as asserted* — the twin proves the correct answer was reachable on the identical incomplete text the whole time.

**vs v3 — established (driven both surfaces, 2026-07-15).** v3 (3.17.5, `~/Code/shreeve/rip-lang`) type-checks in-process through the JS TypeScript LanguageService; driven on the real v3 LSP, the verdict **splits by surface**:

- **Member completion — v4 regression.** v3 serves the correct members at the bare dot — driven, fresh `x = items.` → the full `number[]` member list (40 items, `map`/`filter`/…), no prior good compile needed. Its `onCompletion` (rip-lang 3.17.5, `packages/vscode/src/lsp.js`) rewrites `word.` → `word.__rip__` before compiling, so the compiler sees a real member access, recompiling that fixed-up text on the fly (`catch {}` on failure). v4 has no such rewrite, so the dot never yields a face — the whole of the regression.
- **Signature help — split.** *Fresh* open paren is **inherited**: v3 has no equivalent open-paren fixup, so `r = add(` and `r = add(1,` compile-error (`missing )`) and return null in both. But the common interactive case — a call that *was* valid, now mid-edit — is a **v4 regression**: v3 falls back to the last good compile and `getSignatureHelpItems` still resolves the call (driven: closed `add(1, 2)` → backspace to `add(1, ` → `add(a: number, b: number): number`, activeParameter 1), where v4's stale path returns null.

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

Everything the runner surfaces (six dimensions plus the hover audit) is accounted for above. The remaining raw signal was triaged and adds no new findings:

- **Verdict divergences** — all promoted or explained: reactive-annotation-not-enforced (#3), evolving-`let` reassignment (#4), `typeof`→`undefined` (#5), directive-loss (#6); the `12-cast` excess-property case folds into the hoisting note; and `07-integration`'s six divergences are a **cascade** of compiler-gap C1 — its `import … from './06-functions.rip'` can't resolve (06 doesn't compile), so the imported calls become `any` and their five guards report unused.
- **Hover sweep** — the reactive-cell leak is now #10. The rest is not-a-gap: **benign** union-member reordering (v4 sorts literals, v3 keeps source order — same type); **v4 more precise than v3** (nullable/optional unions preserved where v3 flattened to a bare type; branch-only assignment reads `T | undefined`, sound, vs v3's flat `T`); and the evolving-`let` hover shapes on 11-inference (a reassigned binding hovers its later-write type) are the display face of #4/#9, not a separate gap.
- **Skipped fixtures** — non-compiling (C1/C2) and import-bearing files have no face to compare; their would-be differs are the compiler gaps already catalogued, not hover defects.

**What the triage establishes.** It accounts for the raw signal the runner surfaces. It does not verify any fix — the triage explains divergences, it does not confirm that a fix behaves.
