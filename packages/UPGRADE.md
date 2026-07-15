# Package Upgrade: rip-lang (v3) → rip (v4)

## Task

Bring the traditional Rip packages from **rip-lang** (Rip v3) into **rip** (Rip v4).

Rip v3 had a cobbled-together types/IDE stack that was brittle. Rip v4 rearchitected that around TypeScript 7 and a much more efficient source↔editor mapping. Typing will be re-applied later as a separate step — this upgrade is about the **Rip source** itself.

### Scope for this pass

Start with these eight packages (simple, mostly pure Rip):

1. `x12`
2. `validate`
3. `time`
4. `rsx`
5. `http`
6. `gate`
7. `decimal`
8. `csv`

**Out of scope (do not bring over):** `util`, `stamp`.

### Method (per package)

1. **Compare head-on** — v3 (`rip-lang/packages/<name>`) vs v4 (`rip/packages/<name>`): layout, entry points, Rip source, tests, and any accompanying `.d.ts` / type surface.
2. **Strip types from both sides** — remove type annotations from the Rip source and set aside the `.d.ts` / type-only files (typing comes later). What remains should be essentially Rip→Rip.
3. **Diff the stripped Rip** — how close is v4 to v3 after types are gone? Ideal outcome: nearly identical logic and structure.
4. **Judge intentional improvements** — if v4 genuinely fixes bugs, simplifies, or optimizes in a way worth keeping, call that out with the reason. If the diff is just remapping noise, file splits without payoff, or incidental churn, prefer the clean v3→v4 shape (or restore v3 Rip and drop the noise).

### Decision rule

| Situation | Action |
| --- | --- |
| Stripped Rip is essentially the same | Prefer the simple mapping; keep structure close to v3 |
| v4 has a real fix, cleanup, or better design | Keep it; document *why* |
| v4 only reorganized / remapped without benefit | Prefer the simpler v3-shaped Rip |

### Deliverable

This file grows as the analysis lands: one section per package with comparison findings, what stripping types reveals, and a keep / restore / merge recommendation.

---

## Executive summary

After comparing all eight packages head-on (v3 Rip ↔ v4 Rip, types mentally stripped, `.d.ts` treated as droppable for this pass):

| Package | Stripped Rip vs v3 | Verdict | Why |
| --- | --- | --- | --- |
| **x12** | Identical | **KEEP_V4** | Same Rip; v4 adds tests + `.d.ts` + packaging |
| **validate** | Real redesign | **KEEP_V4** | Calendar-true dates, stricter validators, Map registry, opt-in coercers |
| **time** | Identical | **KEEP_V4** | Same Rip; v4 adds tests + `.d.ts` |
| **rsx** | Identical + 1 fix | **KEEP_V4** | DOCTYPE `or` parentheses — required under v4 compiler |
| **http** | Identical | **KEEP_V4** | Same Rip (entry renamed); tests + `.d.ts` |
| **gate** | Substantially improved | **KEEP_V4** | Fail-closed secrets, login throttle, reserved `/_gate` 404, self-contained middleware |
| **decimal** | Core identical; coercer split | **KEEP_V4** | Math stays browser-safe; schema bridge is opt-in |
| **csv** | Identical | **KEEP_V4** | Banner-only Rip diff; tests + `.d.ts` |

**None of these eight warrant restoring v3 Rip.** The packages that already lived in v4 were either byte-equal ports with packaging/tests bolted on, or deliberate upgrades (validate, gate, decimal coercers, rsx DOCTYPE). Next typing pass can strip inline annotations and rely on (or regenerate) the `.d.ts` surfaces — that work is separate from this Rip-logic judgment.

Cross-cutting v4 packaging (all eight): `private: true`, `version: 0.0.0`, `exports` with `"types"` + `"default"`, `bunfig.toml`, Bun test suites under `test/`. Those are monorepo/layout, not language semantics.

---

## Analysis

### 1. `x12`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `x12.rip` (692 lines) | `x12.rip` (692 lines, **byte-identical**) |
| CLI | `bin/rip-x12` | `bin/rip-x12` (loader wiring for v4) |
| Types | none | `x12.d.ts` |
| Tests | none | `test/{x12,cli,consumers,package}.test.js`, fixture `270.x12` |

**Strip types:** `x12.rip` has no type annotations in either tree. `.d.ts` is companion-only.

**Logic:** Identical — same `X12` class, selectors, `get`/`set`/`find`/`show`, CLI.

**Worth keeping in v4:** Test suite that pins observed behavior; v4 loader preload in the CLI bin.

**Noise:** package.json private/version shape; `.d.ts` (defer to typing pass).

**Recommendation: KEEP_V4** — confidence high.

---

### 2. `validate`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `validate.rip` (all-in-one, 248 lines) | `index.rip` (re-exports only) |
| Logic | inside `validate.rip` | `registry.rip` (291 lines) |
| Coercers | auto-register on import via `globalThis.__ripSchema` | `coercers.rip` → `@rip-lang/validate/coercers` (opt-in) |
| Types | inline annotations | inline + `index.d.ts`, `coercers.d.ts` |
| Tests | `test.rip` | `test/{validate,coercers,types,package}.test.js` |

**Strip types:** Annotations peel off cleanly; **real logic divergence remains**.

**Behavioral deltas (verified)**

| Area | v3 | v4 |
| --- | --- | --- |
| Public `validators` object | Exported, mutable | **Gone** — private Map; use `check` / `getValidator` / `validatorNames` |
| `check` unknown type | Returns `undefined` | **Throws** `unknown validator '…'` |
| `date` | Regex only; returns input spelling | Calendar-true + leap years; always `YYYY-MM-DD` |
| `zip` | `/^(\d{5})/` accepts trailing junk | Anchored; optional `+4` |
| `money` | Loose `[\d,]+` (accepts `1,00`) | Proper thousands groups |
| `toMoney` | `(value, half, cents)` | Always cents; `(value, even)` |
| `float` | Sign only on first alt — `-.5` fails | Sign applies to `.5` form |
| `semver` | Leading zeros OK (`01.0.0`) | `(0\|[1-9]\d*)` integers |
| Registry | Plain object overwrite | Map; reject duplicate / non-fn / async |
| Coercer bridge | Side effect of package import | Opt-in `/coercers` entry |
| Misc fixes | — | `toName` Mac regex, `formatMoney` finite check, `toPhone` keeps `ext` |

**Worth keeping:** All of the above. Calendar-true `date` matches runtime doctrine (no Date normalization). Stricter money/zip/float/semver fix real validation holes. Map registry + loud reject matches “reject loudly.” File split is load-bearing: browser-safe vocabulary stays free of schema/`globalThis` side effects (`package.test.js` asserts that).

**Migration notes (not reasons to roll back):** callers of `validators.foo`, silent unknown `check`, compact date return shapes, and auto-`~:name` registration need the `/coercers` import.

**Recommendation: KEEP_V4** — confidence high. Do not restore the single-file v3 shape.

---

### 3. `time`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `time.rip` (1182 lines) | `time.rip` (**byte-identical**) |
| Types | dense inline `type`/`interface` | same + `index.d.ts` |
| Tests | `test/test.rip` | `test/{time,types,package}.test.js` |
| Other | `demo.rip` | `demo.rip`, `bunfig.toml` |

**Strip types:** After peeling annotations / type decls, runtime is the same `time` / `Time` / `Duration` / `age` surface. `diff` on the `.rip` file is empty even *with* types still present.

**Worth keeping:** Bun/dayjs parity tests; `exports.types` wiring; `rip.browser: true`.

**Noise:** Dual type surface (inline + `.d.ts`) until the later typing pass consolidates.

**Recommendation: KEEP_V4** — confidence high.

---

### 4. `rsx`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `rsx.rip` | `rsx.rip` |
| Types | none | `rsx.d.ts` |
| Tests | none | `test/{rsx,types,package}.test.js` |
| Flag | no `rip.browser` | `rip.browser: true` |

**Strip types:** Implementation was already untyped. Diff is header cleanup plus **one logic line**.

**The real fix — DOCTYPE `or` precedence**

```rip
# v3 (ambiguous under v4 emitter):
if @xml.startsWith '<!DOCTYPE', @pos or @xml.startsWith '<!doctype', @pos

# v4 (correct):
if @xml.startsWith('<!DOCTYPE', @pos) or @xml.startsWith('<!doctype', @pos)
```

Under the v4 compiler, the unparenthesized form miscompiles to `startsWith("<!DOCTYPE", pos || startsWith(...))` — a silent wrong program. Parentheses are required. Keep them.

**Worth keeping:** Parentheses fix; DOCTYPE tests; `rip.browser: true`.

**Noise:** Banner rewrite that drops “legacy csex” wording.

**Recommendation: KEEP_V4** — confidence high.

---

### 5. `http`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `http.rip` | `index.rip` (rename only) |
| Types | dense inline | inline + `index.d.ts` |
| Tests | none | `test/{http,types,package}.test.js` |

**Strip types:** From `RETRY_METHODS` through `export http = makeInstance()`, logic is the same — `buildUrl`, merge helpers, retry/backoff, `request`, `makeInstance` / `create` / `extend`, method shortcuts. File diff is banner-only once types are ignored (types themselves are still duplicated in `.rip` + `.d.ts`).

**Worth keeping:** Live Bun.serve test battery (retries, Retry-After, hooks, timeout/abort); `rip.browser: true`; entry rename is fine packaging.

**Noise:** Banner trim; type duplication until typing pass.

**Recommendation: KEEP_V4** — confidence high.

---

### 6. `gate`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `index.rip` (~425 lines) | `index.rip` (~479 lines) |
| Deps | ambient `@rip-lang/server` (`get`/`post`/`use`/`read`/`start`) | **none** — self-contained middleware |
| Types | none | `index.d.ts` |
| Tests | `test.rip` | `test/{gate,security,package}.test.js` + `harness.js` |
| Standalone | `GATE_*` env + `start()` bootstrap | **removed** (no runnable layer yet) |

**Strip types:** Core session/CSRF/Argon2id/`safeReturnTo`/cookie attrs/`protect` modes are shared. Real deltas:

1. **Endpoints inside middleware** — handlers keyed as `'GET /_gate/check'` etc.; compose-compatible `(c, next)`. No ambient router registration.
2. **`/_gate/*` reserved** — unknown path/method → **404**. v3 `next!()`’d unknown `/_gate` paths (catch-alls could see them anonymously).
3. **Fail-closed secrets** — `validatedSecret` + `MIN_SECRET_LENGTH = 32`: weak secret **throws**; `insecure: true` only when secret is absent (mints random key). v3 only warned.
4. **Login throttle** — 5 failures / 15 min per `ip|user` → 429 + Retry-After before Argon2id.
5. **Local `formReader`** — stand-in for v3 server `read()`.
6. **No `GATE_*` standalone bootstrap** — known gap, not accidental deletion.
7. **Hash CLI** gated on `import.meta.main`.

**Worth keeping:** Fail-closed secrets, throttle, reserved `/_gate` 404, self-contained middleware (fits v4 server/compose), security test matrix.

**Optional later MERGE (not a rollback):** restore a v3-style env-driven standalone bootstrap once v4 has a runnable serving story — **without** restoring weak-secret warn or `/_gate` pass-through.

**Recommendation: KEEP_V4** — confidence high.

---

### 7. `decimal`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Core | `decimal.rip` (math + auto coercer at end) | `decimal.rip` (core only) |
| Coercer | `registerDecimalCoercer()` on import via `globalThis.__ripSchema` | `coercers.rip` + `./coercers` export |
| Types | inline | inline + `decimal.d.ts`, `coercers.d.ts` |
| Tests | `test/test.rip` | `test/{decimal,coercers,types,package}.test.js` + fixture |

**Strip types:** Core from `LIMITS` through `export D` is the same arithmetic API. Diff is banner, `RoundingMode` formatting, and **removal of the trailing auto-register block** (moved to `coercers.rip`).

| Coercer | v3 | v4 |
| --- | --- | --- |
| When | auto on main import | only on `import '@rip-lang/decimal/coercers'` |
| Collision | soft / silent if runtime absent | **throws** `already registered` |
| Registration | `globalThis.__ripSchema?.…` | `registerCoercer` from schema runtime |

**Worth keeping:** Browser-safe math package without schema side effects; loud collision; explicit opt-in. Same pattern as validate.

**Noise:** Author/GPT header removal; type formatting.

**Recommendation: KEEP_V4** — confidence high.

---

### 8. `csv`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `csv.rip` (458 lines) | `csv.rip` (456 lines) |
| Types | none | `csv.d.ts` |
| Tests | `test/test.rip`, `csv.test.mjs`, `bench.rip` | `test/{csv,quoting,types,package}.test.js` |

**Strip types:** `.rip` has no annotations either side. Full file diff is **banner comment only** — `DELIMITERS` through EOF is identical (`probe`, `makeEmitter`, `readFull`, `Writer`, `CSV.read`/`write`/`load`/`save`/`writer`/`formatRow`, CLI).

**Worth keeping:** `.d.ts`; Bun test suite (including Labcorp/late-quote cases in `quoting.test.js`); correctly **no** `rip.browser` (Bun file APIs).

**Noise:** Dropped `bench.rip` (perf harness, not behavior); test port Rip→JS.

**Recommendation: KEEP_V4** — confidence high.

---

## Cross-cutting notes for the later typing pass

1. **`.d.ts` files are scaffolding, not Rip logic.** Safe to treat as the type surface once inline annotations are stripped from `.rip` sources (`time`, `http`, `decimal`, `validate` still carry dense inline types today).
2. **Opt-in `/coercers` entries** (`validate`, `decimal`) are intentional module-boundary improvements — keep them when bringing remaining packages that touch schema.
3. **v4 test harnesses** (Bun `test/*.test.js`) are strictly better than v3’s ad-hoc `test.rip` files for these packages; keep them.
4. **Only intentional Rip-logic keepers among the eight:** validate (redesign), gate (security + middleware shape), rsx (DOCTYPE parens), decimal (coercer split). Everything else is “v3 Rip + packaging/tests.”

## Suggested next steps

1. Accept KEEP_V4 for all eight (no Rip restores).
2. Typing pass: strip inline annotations from `time` / `http` / `decimal` / `validate` Rip; leave or regenerate `.d.ts`.
3. Continue the same compare→strip→judge loop for the remaining packages to bring over (`server`, `app`, `db`, `ui`, `swarm`, `print`, `script`, `ai`, …) — still excluding `util` and `stamp`.
4. Optional follow-up: gate standalone `GATE_*` bootstrap once v4 serving story is ready.
