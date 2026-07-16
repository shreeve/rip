# Package Upgrade: rip-lang (v3) → rip (v4)

## Task

Bring the traditional Rip packages from **rip-lang** (Rip v3) into **rip** (Rip v4).

Rip v3 had a cobbled-together types/IDE stack that was brittle. Rip v4 rearchitected that around TypeScript 7 and a much more efficient source↔editor mapping. Typing will be re-applied later as a separate step — this upgrade is about the **Rip source** itself.

**Types are out of scope for this pass.** Hand-written `.d.ts` companions have already been removed from v4 packages. Do not bring types over from v3. When comparing, strip inline `: Type` annotations and `type`/`interface` decls from both sides and judge **Rip logic only**.

### Scope for this pass

These two packages (simple, mostly pure Rip) still need the compare→strip→judge loop and the Rip test roll:

1. `validate`
2. `gate`

(`x12` completed both passes — see its section below.)

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
| **x12** | Identical + 4 judged fixes | **KEEP_V4 (done)** | v3 Rip plus loud/exact fixes (clone, trailing row, silent component loss, selector reject); Rip test roll + frame conformance complete |
| **validate** | Real redesign | **KEEP_V4** | Calendar-true dates, stricter validators, Map registry, opt-in coercers |
| **gate** | Substantially improved | **KEEP_V4** | Fail-closed secrets, login throttle, reserved `/_gate` 404, self-contained middleware |

**None of these three warrant restoring v3 Rip.** Do not reintroduce `.d.ts` or type annotations as part of this upgrade.

Cross-cutting v4 packaging (not logic): `private: true`, `exports` pointing at `.rip` only (no `"types"`); root Bun workspaces (`packages/*`, hoisted linker) so `@rip-lang/*` resolves in-tree; package tests via `rip test.rip` + `@rip-lang/testing` (per [AGENTS.md](AGENTS.md)) or `rip test` (Bun JS suites still migrating — the subcommand wraps `bun test` with the loader preloaded). No per-package `bunfig.toml`.

---

## Analysis

### 1. `x12` — DONE

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `x12.rip` (692 lines) | `x12.rip` — v3 logic + 4 judged fixes |
| CLI | `bin/rip-x12` wrapper | none — `x12.rip` IS the bin (`#!/usr/bin/env rip`); version read from package.json |
| Types | none | none |
| Tests | none | root `test.rip` (91 cases) on `@rip-lang/testing` |

**Strip types:** Neither side has annotations. The port started `cmp`
identical to v3; the initial v4 JS test suite pinned three v3 warts as
observed behavior. This pass fixed them (the pins now assert the CORRECT
behavior, per doctrine) and rolled the suite to the package contract.

**Judged fixes (all verified by pins):**

1. **Clone corruption** — `new X12(instance)` fell through to the
   object branch and re-applied the instance's own properties as
   selectors, appending junk `STR/FLD/REP/COM/SEG/ARY` segments to the
   output. An X12 instance now rides the string-parse path; a clone is
   exact.
2. **Trailing empty row** — the terminator after the last segment
   split off an 18th empty row, so `raw()` emitted a double `~~` and
   consumers filtered it by hand. `toArray` drops the empty tail;
   17 segments parse to 17 rows and `raw()` round-trips byte-exact.
3. **Silent component loss** — a component SET with no explicit repeat
   defaulted the repeat to 0, resolved to array index −1, and the write
   vanished. It now writes through repeat 1, matching the GET default.
4. **Selector rejection is loud and typed** — `SELECTOR` constrains the
   segment ID to 2–3 alphanumerics, so garbage like `***` rejects as
   `bad selector` instead of leaking a regex-construction error. Also:
   ISA width enforcement moved inside the per-row loop, so `ISA(*)` sets
   pad every occurrence (previously only the loop-leaked last row).

**Frame conformance:** root `test.rip` (JS `test/` dir removed; the 270
fixture is inlined and written to a temp dir for `X12.load`/CLI cases);
package.json in contract key order (`4.0.0`, description = README
pitch, `rip test.rip`, `@rip-lang/testing`); README on the mold
(server-only Runtime line — `X12.load` and the CLI read the
filesystem). No `bin/` wrapper: `x12.rip` is itself the `rip-x12` bin
(`#!/usr/bin/env rip` shebang + executable bit — the one blessed bin
shape, now codified in AGENTS.md). Every v3-oracle test case landed;
the CLI is exercised as a real subprocess through both the repo's
`bin/rip` and the shebang.

**Recommendation: KEEP_V4** — done; confidence high.

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

### 3. `gate`

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

### 4. `print` — DONE

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `print.rip` (embedded `hljs-rip.js` copy) | `print.rip` — same program; grammar from `@rip-lang/highlight` |
| CLI | `bin/rip-print` wrapper | none — `print.rip` IS the bin (`#!/usr/bin/env rip`) |
| Deps | `highlight.js` | `highlight.js` + `@rip-lang/highlight` (workspace) |
| Tests | none | root `test.rip` (22 cases), CLI as a real subprocess |
| Editor | `vscode/` extension (embedded grammar copy, no tests) | `vscode/` extension — grammar GENERATED from `packages/highlight` via `rip sync.rip` (byte-gated), own `test.rip` (17 cases) |

**Strip types:** No annotations on either side. v4 Rip is v3's program
with judged deltas:

1. **Shared grammar** — v3 embedded its own (older) `hljs-rip.js`; v4
   imports `@rip-lang/highlight`, so `%w[]` and `:symbol` highlighting
   land and the grammar stays in lockstep with the editor surfaces.
2. **Import guard** — a pure CLI with no export surface now throws on
   `import` instead of silently running the program at import time.
3. **Version from package.json** — v3 hard-coded `rip-print 1.1.59`
   (which had drifted from its own manifest, 1.1.127); v4 reads
   `VERSION` from package.json with the standard line.
4. **Frame** — shebang bin (wrapper deleted), contract package.json
   (4.0.0, description = README pitch, `rip test.rip`), README on the
   mold, JS `test/` dir replaced by root `test.rip` with every case
   ported (fixtures generated into a temp tree; browser opener stubbed
   via PATH). Per-package `bun.lock` removed — the workspace owns
   dependency resolution.
5. **Editor extension carried over** — `vscode/` ships the same printer
   as `rip-lang.print` for VS Code/Cursor. Upgrades over v3: the CJS
   grammar copy is GENERATED from `packages/highlight` by `rip sync.rip`
   and byte-gated in tests (v3 hand-carried a drifted copy — the
   editor-grammar lockstep rule, mechanized); repo URL updated; exact
   `highlight.js` pin; and a 17-case `test.rip` covering the manifest,
   grammar gate, and printer core (v3 shipped untested). The extension
   stays a standalone sub-package (own lockfile and node_modules — the
   vsix must embed highlight.js), like `packages/vscode`.

**Recommendation: KEEP_V4** — done; confidence high.

---

### 5. `highlight` — DONE (v4-native)

No v3 counterpart (v3 embedded grammar copies inside print and its
extension). The shared-grammar package now carries the full contract:
version 4.0.0, description = README pitch, `rip.browser: true` (earned
and pinned — the grammar file has zero imports and touches no host
APIs), root `test.rip` (18 cases driving the grammar through
highlight.js: keywords, strings/interpolation rules, word arrays,
symbols, regexes, operators), README on the mold with a consumers
table. Fix that fell out of writing the suite: `schema` was missing
from the keyword list (the TextMate grammar already had it — the
hljs surface had broken editor-grammar lockstep). The old JS `test/`
dir, per-package `bun.lock`, and `node_modules` are gone; highlight.js
is a devDependency test oracle only.

## Cross-cutting notes

1. **No `.d.ts` in these packages** — confirmed. Do not bring type files over from v3. Package `exports` point at `.rip` only.
2. **Inline annotations** still exist in some `.rip` sources (`validate`). They are ignored for this upgrade judgment. A later typing pass can strip or regenerate them; that is separate work.
3. **Schema coercers auto-register on the main import** (owner decision, reversing the v4 `/coercers` split — decimal already converted): importing the package registers its `~:name` coercers, collisions reject loudly, and `register<X>Coercer(name)` covers custom names. Apply the same merge to `validate` when it migrates.
4. **Package tests are Rip.** Shared helpers live in [`@rip-lang/testing`](testing/) (`test`, `eq`, `ok`, `throws`). The tally prints on process exit; failures set `process.exitCode`. Each pure library package gets a root `test.rip` that imports them and runs via `"test": "rip test.rip"` — per the contract in [AGENTS.md](AGENTS.md). Host-heavy suites (server, db, vscode) may stay on Bun until they have a natural Rip shape — that is the exception, not the default. The language battery keeps its own harness (`test/support/testing.js`).
5. **Only intentional Rip-logic keepers among the three:** validate (redesign), gate (security + middleware shape). Everything else is “v3 Rip + packaging/tests.”

## Suggested next steps

1. Accept **KEEP_V4** for all six (no Rip restores; no type reintroduction).
2. Roll root `test.rip` + `@rip-lang/testing` across the remaining packages (`validate`, then `gate` where security tests fit) — `x12` is done.
3. Continue the compare→strip→judge loop for remaining packages (`server`, `app`, `db`, `ui`, `swarm`, `script`, `ai`, …) — `print` is done; still excluding `util` and `stamp`, still without bringing types.
4. Optional follow-up: gate standalone `GATE_*` bootstrap once v4 serving story is ready.
5. Typing pass (separate): strip or regenerate types.
