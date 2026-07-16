# Package Upgrade: rip-lang (v3) → rip (v4)

## Task

Bring the traditional Rip packages from **rip-lang** (Rip v3) into **rip** (Rip v4).

Rip v3 had a cobbled-together types/IDE stack that was brittle. Rip v4 rearchitected that around TypeScript 7 and a much more efficient source↔editor mapping. Typing will be re-applied later as a separate step — this upgrade is about the **Rip source** itself.

**Types are out of scope for this pass.** Hand-written `.d.ts` companions have already been removed from v4 packages. Do not bring types over from v3. When comparing, strip inline `: Type` annotations and `type`/`interface` decls from both sides and judge **Rip logic only**.

### Scope for this pass

These six packages (simple, mostly pure Rip) still need the compare→strip→judge loop and the Rip test roll:

1. `x12`
2. `validate`
3. `rsx`
4. `http`
5. `gate`
6. `decimal`

**Package contract:** layout, package.json key order, README mold, and test rules are codified in [AGENTS.md](AGENTS.md) — follow it.

**Out of scope (do not bring over):** `util`, `stamp`.

### Method (per package)

1. **Compare head-on** — v3 (`rip-lang/packages/<name>`) vs v4 (`rip/packages/<name>`): layout, entry points, Rip source, tests, packaging.
2. **Strip types from both sides** — ignore annotations and any type-only files. What remains should be essentially Rip→Rip.
3. **Diff the stripped Rip** — how close is v4 to v3? Ideal outcome: nearly identical logic and structure.
4. **Judge intentional improvements** — if v4 genuinely fixes bugs, simplifies, or optimizes in a way worth keeping, call that out. If the diff is remapping noise, file splits without payoff, or incidental churn, prefer the clean v3→v4 shape (or restore v3 Rip and drop the noise).

### Decision rule

| Situation | Action |
| --- | --- |
| Stripped Rip is essentially the same | Prefer the simple mapping; keep structure close to v3 |
| v4 has a real fix, cleanup, or better design | Keep it; document *why* |
| v4 only reorganized / remapped without benefit | Prefer the simpler v3-shaped Rip |

### Deliverable

This file: one section per remaining package with comparison findings and a keep / restore / merge recommendation.

---

## Executive summary

Re-run after `.d.ts` removal. Compared Rip logic only.

| Package | Stripped Rip vs v3 | Verdict | Why |
| --- | --- | --- | --- |
| **x12** | Byte-identical | **KEEP_V4** | Same Rip; v4 adds tests + loader-aware CLI |
| **validate** | Real redesign | **KEEP_V4** | Calendar-true dates, stricter validators, Map registry, opt-in coercers |
| **rsx** | Identical + 1 fix | **KEEP_V4** | DOCTYPE `or` parentheses required under v4 compiler |
| **http** | Identical (entry renamed) | **KEEP_V4** | Same Rip; tests + `rip.browser` |
| **gate** | Substantially improved | **KEEP_V4** | Fail-closed secrets, login throttle, reserved `/_gate` 404, self-contained middleware |
| **decimal** | Core identical; coercer split | **KEEP_V4** | Math stays browser-safe; schema bridge is opt-in |

**None of these six warrant restoring v3 Rip.** Do not reintroduce `.d.ts` or type annotations as part of this upgrade.

Cross-cutting v4 packaging (not logic): `private: true`, `exports` pointing at `.rip` only (no `"types"`); root Bun workspaces (`packages/*`, hoisted linker) so `@rip-lang/*` resolves in-tree; package tests via `rip test.rip` + `@rip-lang/testing` (per [AGENTS.md](AGENTS.md)) or `rip test` (Bun JS suites still migrating — the subcommand wraps `bun test` with the loader preloaded). No per-package `bunfig.toml`.

---

## Analysis

### 1. `x12`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `x12.rip` (692 lines) | `x12.rip` — **`cmp` identical** |
| CLI | `bin/rip-x12` | `bin/rip-x12` (v4 loader preload) |
| Types | none | none |
| Tests | none | `test/{x12,cli,consumers,package}.test.js`, fixture `270.x12` |

**Strip types:** Neither side has annotations. Rip logic is identical — same `X12` class, selectors, `get`/`set`/`find`/`show`, CLI.

**Worth keeping:** Test suite; CLI wiring for v4 loader.

**Noise:** package.json private/version shape.

**Recommendation: KEEP_V4** — confidence high.

---

### 2. `validate`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `validate.rip` (all-in-one, 248 lines) | `index.rip` (re-exports only) |
| Logic | inside `validate.rip` | `registry.rip` (291 lines) |
| Coercers | auto-register on import via `globalThis.__ripSchema` | `coercers.rip` → `@rip-lang/validate/coercers` (opt-in) |
| Types | inline annotations (ignore) | inline annotations (ignore); `.d.ts` gone |
| Tests | `test.rip` | `test/{validate,coercers,package}.test.js` (+ skipped types test) |

**Strip types:** Annotations peel off; **real logic divergence remains**. Same 37 builtin validator keys.

**Behavioral deltas (verified)**

| Area | v3 | v4 |
| --- | --- | --- |
| Public `validators` object | Exported, mutable | **Gone** — private Map; use `check` / `getValidator` / `validatorNames` |
| `check` unknown type | Returns `undefined` | **Throws** |
| `date` | Regex only; returns input spelling | Calendar-true + leap years; always `YYYY-MM-DD` |
| `zip` | `/^(\d{5})/` accepts trailing junk | Anchored; optional `+4` |
| `money` | Loose `[\d,]+` (accepts `1,00`) | Proper thousands groups |
| `toMoney` | `(value, half, cents)` | Always cents; `(value, even)` |
| `float` | Sign only on first alt — `-.5` fails | Sign applies to `.5` form |
| `semver` | Leading zeros OK (`01.0.0`) | `(0\|[1-9]\d*)` integers |
| Registry | Plain object overwrite | Map; reject duplicate / non-fn / async |
| Coercer bridge | Side effect of package import | Opt-in `/coercers` entry |
| Misc fixes | — | `toName` Mac regex, `formatMoney` finite check, `toPhone` keeps `ext` |

**Worth keeping:** All of the above. Calendar-true `date` matches runtime doctrine. File split is load-bearing: browser-safe vocabulary stays free of schema/`globalThis` side effects.

**Migration notes (not rollback reasons):** callers of `validators.foo`, silent unknown `check`, compact date return shapes, and auto-`~:name` registration need the `/coercers` import.

**Recommendation: KEEP_V4** — confidence high. Do not restore the single-file v3 shape. Do not add types yet.

---

### 3. `rsx`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `rsx.rip` | `rsx.rip` |
| Types | none | none |
| Tests | none | `test/{rsx,package}.test.js` (+ skipped types test) |
| Flag | no `rip.browser` | `rip.browser: true` |

**Strip types:** Already untyped. Diff is banner cleanup plus **one logic line**.

**The real fix — DOCTYPE `or` precedence**

```rip
# v3 (hazard under v4 emitter):
if @xml.startsWith '<!DOCTYPE', @pos or @xml.startsWith '<!doctype', @pos

# v4 (correct):
if @xml.startsWith('<!DOCTYPE', @pos) or @xml.startsWith('<!doctype', @pos)
```

Under the v4 compiler, the unparenthesized form miscompiles (`pos || startsWith(...)`). Parentheses are required.

**Worth keeping:** Parentheses fix; DOCTYPE tests; `rip.browser: true`.

**Noise:** Banner rewrite.

**Recommendation: KEEP_V4** — confidence high. Restoring v3 Rip would reintroduce a silent miscompile.

---

### 4. `http`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `http.rip` | `index.rip` (rename only) |
| Types | dense inline (ignore) | same; `.d.ts` gone |
| Tests | none | `test/{http,package}.test.js` (+ skipped types test) |

**Strip types:** After dropping the leading banner, bodies are **byte-identical** (including annotations). From `RETRY_METHODS` through `export http = makeInstance()`: same helpers, retry/backoff, `request`, `makeInstance` / `create` / `extend`, method shortcuts.

**Worth keeping:** Live Bun.serve test battery; `rip.browser: true`; entry rename is fine packaging.

**Noise:** Banner trim.

**Recommendation: KEEP_V4** — confidence high.

---

### 5. `gate`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `index.rip` (~425 lines) | `index.rip` (~479 lines) |
| Deps | ambient `@rip-lang/server` (`get`/`post`/`use`/`read`/`start`) | **none** — self-contained middleware |
| Types | none | none |
| Tests | `test.rip` | `test/{gate,security,package}.test.js` + `harness.js` |
| Standalone | `GATE_*` env + `start()` bootstrap | **removed** (known gap) |

**Strip types:** Shared core: session/CSRF/Argon2id/`safeReturnTo`/cookie attrs/`protect` modes. Real deltas:

1. **Endpoints inside middleware** — handlers keyed as `'GET /_gate/check'` etc.; compose-compatible `(c, next)`.
2. **`/_gate/*` reserved** — unknown path/method → **404**. v3 `next!()`’d unknown `/_gate` paths.
3. **Fail-closed secrets** — `validatedSecret` + `MIN_SECRET_LENGTH = 32`: weak secret **throws**; `insecure: true` only when secret is absent (mints random key). v3 only warned.
4. **Login throttle** — 5 failures / 15 min per `ip|user` → 429 + Retry-After before Argon2id.
5. **Local `formReader`** — stand-in for v3 server `read()`.
6. **No `GATE_*` standalone bootstrap** — known gap, not accidental deletion.
7. **Hash CLI** gated on `import.meta.main`.

**Worth keeping:** Fail-closed secrets, throttle, reserved `/_gate` 404, self-contained middleware, security tests.

**Optional later MERGE (not a rollback):** restore a v3-style env-driven standalone bootstrap once v4 has a runnable serving story — **without** restoring weak-secret warn or `/_gate` pass-through.

**Recommendation: KEEP_V4** — confidence high.

---

### 6. `decimal`

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Core | `decimal.rip` (math + auto coercer at end) | `decimal.rip` (core only) |
| Coercer | `registerDecimalCoercer()` on import via `globalThis.__ripSchema` | `coercers.rip` + `./coercers` export |
| Types | inline (ignore) | inline (ignore); `.d.ts` gone |
| Tests | `test/test.rip` | `test/{decimal,coercers,package}.test.js` + fixture |

**Strip types:** Core from `LIMITS` through `export D` is the same arithmetic API. Diff is banner, `RoundingMode` formatting, and removal of the trailing auto-register block (moved to `coercers.rip`).

| Coercer | v3 | v4 |
| --- | --- | --- |
| When | auto on main import | only on `import '@rip-lang/decimal/coercers'` |
| Collision | soft / silent if runtime absent | loud reject on duplicate |
| Registration | `globalThis.__ripSchema?.…` | `registerCoercer` from schema runtime |

**Worth keeping:** Browser-safe math without schema side effects; loud collision; explicit opt-in. Same pattern as validate.

**Noise:** Header rewrite; type formatting (ignore until typing pass).

**Recommendation: KEEP_V4** — confidence high.

---

## Cross-cutting notes

1. **No `.d.ts` in these packages** — confirmed. Do not bring type files over from v3. Package `exports` point at `.rip` only.
2. **Inline annotations** still exist in some `.rip` sources (`http`, `decimal`, `validate`). They are ignored for this upgrade judgment. A later typing pass can strip or regenerate them; that is separate work.
3. **Opt-in `/coercers` entries** (`validate`, `decimal`) are intentional module-boundary improvements — keep them.
4. **Package tests are Rip.** Shared helpers live in [`@rip-lang/testing`](testing/) (`test`, `eq`, `ok`, `throws`). The tally prints on process exit; failures set `process.exitCode`. Each pure library package gets a root `test.rip` that imports them and runs via `"test": "rip test.rip"` — per the contract in [AGENTS.md](AGENTS.md). Host-heavy suites (server, db, vscode) may stay on Bun until they have a natural Rip shape — that is the exception, not the default. The language battery keeps its own harness (`test/support/testing.js`).
5. **Only intentional Rip-logic keepers among the six:** validate (redesign), gate (security + middleware shape), rsx (DOCTYPE parens), decimal (coercer split). Everything else is “v3 Rip + packaging/tests.”

## Suggested next steps

1. Accept **KEEP_V4** for all six (no Rip restores; no type reintroduction).
2. Roll root `test.rip` + `@rip-lang/testing` across the remaining packages (`validate`, `rsx`, `http`, `decimal`, `x12`, then `gate` where security tests fit).
3. Continue the compare→strip→judge loop for remaining packages (`server`, `app`, `db`, `ui`, `swarm`, `print`, `script`, `ai`, …) — still excluding `util` and `stamp`, still without bringing types.
4. Optional follow-up: gate standalone `GATE_*` bootstrap once v4 serving story is ready.
5. Typing pass (separate): strip or regenerate types.
