# Package Upgrade: rip-lang (v3) → rip (v4)

## Task

Bring the traditional Rip packages from **rip-lang** (Rip v3) into **rip** (Rip v4).

Rip v3 had a cobbled-together types/IDE stack that was brittle. Rip v4 rearchitected that around TypeScript 7 and a much more efficient source↔editor mapping. Typing will be re-applied later as a separate step — this upgrade is about the **Rip source** itself.

**Types are out of scope for this pass.** Hand-written `.d.ts` companions have already been removed from v4 packages. Do not bring types over from v3. When comparing, strip inline `: Type` annotations and `type`/`interface` decls from both sides and judge **Rip logic only**.

### Scope for this pass

One package still needs the compare→strip→judge loop and the Rip test roll:

1. `gate`

(`x12`, `validate`, `print`, `swarm`, `script`, and `utils` completed
both passes — see their sections below.)

**Package contract:** layout, package.json key order, README mold, and test rules are codified in [AGENTS.md](AGENTS.md) — follow it.

**Out of scope (do not bring over):** none — `stamp` was the last holdout and is now ported (server-only, security-gated; see its section below).

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
| **validate** | Real redesign | **KEEP_V4 (done)** | Calendar-true dates, stricter validators, Map registry; coercer split merged back into ONE file (owner decision); Rip test roll + frame complete |
| **gate** | Substantially improved | **KEEP_V4** | Fail-closed secrets, login throttle, reserved `/_gate` 404, self-contained middleware |
| **swarm** | Identical core + 3 judged deltas | **KEEP_V4 (done)** | Loader from the live `--preload` flag (loud); wrapper and worker bootstrap folded into swarm.rip; Rip test roll + frame complete |
| **utils** | Identical curl + CLI hygiene | **KEEP_V4 (done)** | Multi-bin collection frame; `curl.rip` → `rip-curl` (version from package.json, import guard, documented 4-tier vars); Rip test roll complete |
| **stamp** | Identical Rip + fold/frame | **KEEP_V4 (done)** | 4 src files folded into `stamp.rip` (bin); 14 directives + example stamps kept; injectable exec seam for hermetic tests; injection-safety battery; Rip test roll + frame complete |

**None of these warrant restoring v3 Rip.** Do not reintroduce `.d.ts` or type annotations as part of this upgrade.

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
| Entry | `validate.rip` (all-in-one, 248 lines) | `validate.rip` (all-in-one, ~300 lines) |
| Coercers | auto-register on import via `globalThis.__ripSchema` | auto-register on import via a REAL `registerCoercer` import (loud collisions) |
| Types | inline annotations (ignore) | stripped (typing is a later pass) |
| Tests | `test.rip` | root `test.rip` (34 cases, 152-row vocabulary table) |

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
| Coercer bridge | Side effect of package import (soft no-op without runtime) | Side effect of package import via real `registerCoercer` import — loud collisions, atomic with the validator registry |
| Misc fixes | — | `toName` Mac regex, `formatMoney` finite check, `toPhone` keeps `ext` |

**Worth keeping:** All of the above. Calendar-true `date` matches runtime doctrine.

**The merge (owner decision, cross-cutting note 3 executed):** the v4
`index.rip`/`registry.rip`/`coercers.rip` split collapsed back into ONE
`validate.rip` — v3's shape with v4's logic. Coercers ride the main
import: `define()` registers the `~:name` coercer FIRST, so a collision
rejects loudly and leaves the validator registry unchanged (the
watcher/`_eachValidator` machinery this replaced is deleted). The
browser story survives the merge because the schema-runtime import
bridges to the page's one runtime copy — pinned end-to-end by the
toolchain browser tests.

**Runtime change that fell out:** `registerCoercer` now tolerates
IDENTICAL re-registration (same source text, same raw flag) — the
schema-name registry's reload policy applied to coercers — because a
browser reboot re-evaluates package modules into the same process
table. Different definitions still reject loudly. Bundle assembly also
stopped shipping root verb files (`test.rip`/`demo.rip`/`bench.rip`)
and `bench/` into browser bundles.

**Recommendation: KEEP_V4 (done)** — v4 logic in v3's single-file
shape; frame, README, and 34-case root `test.rip` complete.

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

### 6. `swarm` — DONE

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Main | `swarm.rip` (387 lines) | `swarm.rip` (444) — core line-for-line identical |
| Worker entry | `lib/worker.mjs` bootstrap + `_getPerform` bridge export | none — swarm.rip is its own worker entry (same module instance, no bridge) |
| CLI | `bin/swarm` wrapper | none — `swarm.rip` IS the bin (`#!/usr/bin/env rip` + runner block) |
| Loader for workers | two hardcoded path candidates, `?? null` (silent degradation) | the main thread's own `--preload` flag from `process.execArgv`; loud, named rejection when absent |
| Tests | none (`example.rip` only) | root `test.rip` (27 cases) + `fixtures/` job-script corpus |

**Strip types:** No annotations on either side (the deferred `.d.ts`
face test was deleted). Diffing the Rip head-on: everything outside
three regions is byte-identical — the ANSI rendering, the queue
(`init`/`todo`/`retry`), dispatch, crash recovery, `args()`.

**Judged deltas (all verified by pins):**

1. **Worker loader resolution** — verified that a worker thread gets
   neither the parent's preloads nor bunfig's (the inherited `execArgv`
   even shows the flag, inert), so `Worker({preload})` is genuinely
   required; the loader path now comes from the main thread's own
   `--preload` flag — the exact loader compiling the process — instead
   of two guessed filesystem layouts with a silent `?? null` fallback.
2. **One file, three roles** — the `bin/swarm` wrapper and
   `lib/worker.mjs` bootstrap both folded into swarm.rip, split by
   `import.meta.main` and `isMainThread` guards (in a worker the entry's
   `import.meta.main` is ALSO true — the guard matters). Folding the
   worker entry removed the `_getPerform` bridge export and the
   module-identity subtlety it existed for (the bootstrap's file-URL
   import had to dedupe against the script's bare-specifier import).
3. **`fixtures/` is an earned directory** — the suite's corpus is ten
   real runnable job programs (crash simulators, retry loops) spawned
   as subprocesses; inlining them as strings would fight the quoting
   sharp edges. Same justification class as csv's `bench/`.

**Frame:** contract package.json (description = README pitch, pinned
byte-for-byte by a test), README on the mold (server-only Runtime
line), `rip test.rip` with the standard package-surface opener. The
v3 wart of `-w 0` silently meaning CPU-count is pinned as observed.

**Recommendation: KEEP_V4** — done; confidence high.

### 7. `script` — DONE

**Inventory**

| | v3 | v4 (before) | v4 (after) |
| --- | --- | --- | --- |
| Main | `script.rip` (500 lines) | byte-identical except one line | unchanged |
| Tests | `test/basic.rip`, `test/ssh.rip` (live drivers, no assertions) | `test/*.test.js` — 60 Bun-test cases + `ssh-driver.mjs` | root `test.rip` (61 cases) + `fixtures/ssh-driver.rip` |
| Manifest | 1.0.0, npm metadata | 0.0.0, `"test": "rip test"` | contract (4.0.0, pitch = description, `rip test.rip`) |

**Source:** one judged fix, otherwise untouched. The engine, three
transports, and helpers were already a clean line-for-line port (the
one prior v4 delta, `transport.ready!` → `await transport.ready`, is
correct: `ready` is a Promise property, not a method — the dammit form
compiled to a `.ready()` CALL, which throws). No annotations to strip.
The fix: `read()`'s timeout sentinels were the STRINGS `'fast'`/`'slow'`
while a successful read returns the new buffer contents — also a
string — so a buffer that spelled exactly `fast` was misread as a
fast-timeout and fired `:else` spuriously. The sentinels are now the
symbols `:fast`/`:slow` (collision-proof; internal-only, no API
change). Both behaviors are pinned, and the collision pin was verified
to FAIL against the string-sentinel code before landing.

**Tests:** the 60-case Bun suite (itself a faithful conversion of v3's
live drivers, plus added tcp/connect/dispatch/timeout coverage) ported
1:1 into root `test.rip` on the shared harness; case parity diffed by
name (the 61st case is the added description-pitch pin). The ssh flow
keeps its subprocess seam — Bun.spawn resolves PATH at process start,
so the stub-ssh conversation runs in `fixtures/ssh-driver.rip` (now
Rip, was `.mjs`). The v3 warts stay pinned: `enter()` ignores its
value argument, and single-colon `spawn:` URLs are unknown schemes.

**Frame:** contract package.json and README on the mold (logo header,
pitch blockquote, server-only Runtime line absorbing the old
Requirements section, Features, Test section replacing the License
footer). `export default Script` stays — published-API churn is not
this pass (same call as time's default).

**Recommendation: KEEP_V4** — done; confidence high.

### 8. `utils` — DONE

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Layout | `README.md` + `curl.rip` (no package.json) | multi-bin collection: `curl.rip` + contract package.json + README mold |
| CLI | shebang'd `curl.rip`, run as `rip curl.rip` | same file IS `rip-curl` (`#!/usr/bin/env rip`); version from package.json |
| Vars | CLI > `.auth` > `.env` file > `Bun.env` (README under-documented) | same priority; README matches; `process.env` for the last tier |
| Tests | none | root `test.rip` (package surface + curl: flags, vars, parse, live HTTP) |

**Strip types:** No annotations on either side. v4 Rip is v3's program
with judged CLI hygiene (the same class as print):

1. **Import guard** — rejects loudly unless `import.meta.main` (v3 ran
   the program on import).
2. **Version from package.json** — v3 hard-coded `1.0.0`.
3. **`process.argv` / `process.env`** — matches the other v4 CLIs.
4. **`-h` / `--help`** — usage that documents the real four-tier
   variable order (CLI → `.auth` → `.env` → process env).
5. **`Bun.stdin.text!`** — replaces `readFileSync('/dev/stdin')`, which
   EACCES-fails on an empty pipe under Bun.spawn on macOS.
6. **Frame** — first package.json (4.0.0, description = README pitch,
   `"bin": { "rip-curl": "./curl.rip" }`, no `exports`); README on the
   mold with an "Adding a Utility" section; AGENTS.md documents the
   multi-bin collection shape.

**Recommendation: KEEP_V4** — done; confidence high.

### 9. `stamp` — DONE

**Inventory**

| | v3 | v4 |
| --- | --- | --- |
| Entry | `src/{cli,engine,parser,helpers}.rip` (4 files) + `bin/stamp` bun-spawn wrapper | `stamp.rip` — the four src files folded into one, and it IS the `rip-stamp` bin (`#!/usr/bin/env rip`) |
| Directives | `directives/` (14 handlers) | `directives/` (14 handlers, logic byte-identical) |
| Examples | `stamps/` (basic/host/mac-install/mac-vm) | `stamps/` (kept as data assets; `host` drives a parser test) |
| Types | none | none |
| Tests | `test/runner.rip` (hand-rolled harness: parser + helpers) | root `test.rip` (51 cases) on `@rip-lang/testing` + an injected exec seam |
| Manifest | 0.1.43, npm metadata, `bun --preload` test | contract (4.0.0, private, pitch = description, `rip test.rip`) |

**Strip types:** No annotations on either side. The port is essentially
v3 Rip → v4 Rip: the engine, parser, shell helpers, and all 14 directive
handlers are line-for-line identical apart from the folding and the
mechanical v4-parser adjustments below.

**Judged deltas:**

1. **Four `src/` files folded into `stamp.rip`** — cli + engine + parser
   + helpers become one root entry (AGENTS.md "simple beats pure" — a
   `src/` split that only mirrors the call graph is not an earned
   directory). `directives/` stays: it is a genuine plugin-discovery
   directory (drop a `.rip` and the engine resolves it). `stamps/` stays
   as example DATA (one file drives a parser test).
2. **Bin is the entry, not a wrapper** — v3's `bin/stamp` bun-spawn shim
   is deleted; `stamp.rip` carries the shebang + executable bit and the
   CLI runs behind `import.meta.main`. The command name is `rip-stamp`
   per the contract (v3 shipped `stamp`).
3. **Exec seam (`setExec`)** — the shell backend behind `run`/`sh`/`ok`
   is a single swappable function, so the suite drives handlers
   hermetically (record argv, return canned success) without
   provisioning a host. Pure addition; the default spawn path is
   unchanged.
4. **v4-parser mechanics** — `import.meta.dir` parenthesized as a call
   argument, and `import! x` → `import!(x)` (the keyword-collision paren
   form, matching swarm). No logic change. Handler-resolution paths shift
   up one directory level (the engine moved from `src/` to the root).
5. **Frame** — contract package.json with all v3 publish metadata
   stripped (author, repository, keywords, license, homepage, bugs,
   `main`); README on the mold (server-only Runtime line, `bash` fences,
   no License footer); root `test.rip` replacing `test/runner.rip`.

**Test roll:** every v3 `test/runner.rip` case landed in `test.rip`
(parser structure / variables / arrow / blocks / sub-blocks / plural /
comments / use / quoting / tabs / packages-block / full-host-stamp, and
the `sh`/`ok`/`run` string- and tagged-template helper cases). Added: the
package-surface opener, the plugin contract (all 14 handlers export
`name`/`check`/`apply`/`verify`), and an injection-safety battery driving
every handler through the exec seam.

**Security summary:** the `$"..."` tagged-template argv construction is
the injection boundary, and it holds — pinned across all 14 directives
plus the helper directly (no handler ever spawns `sh -c` from an
interpolated value; a hostile `; rm -rf /` stays one argv element).
Owner-facing residual notes, not blockers and unchanged from v3: `sh
"string"` (untagged) still routes through `sh -c` (documented as
literal-only); `use <url>` fetches and imports remote handler code
(cached under `~/.stamp`, trust-on-first-use, no integrity pin); npm
`@stamp/<name>` / `stamp-<name>` auto-resolution imports by convention.
Full findings are in the PR security section.

**Recommendation: KEEP_V4** — done; confidence high.

---

## Cross-cutting notes

1. **No `.d.ts` in these packages** — confirmed. Do not bring type files over from v3. Package `exports` point at `.rip` only.
2. **Inline annotations** still exist in some `.rip` sources (`validate`). They are ignored for this upgrade judgment. A later typing pass can strip or regenerate them; that is separate work.
3. **Schema coercers auto-register on the main import** (owner decision, reversing the v4 `/coercers` split): importing the package registers its `~:name` coercers, collisions reject loudly, and `register<X>Coercer(name)` covers custom names. Applied to `decimal` and `validate` (both done).
4. **Package tests are Rip.** Shared helpers live in [`@rip-lang/testing`](testing/) (`test`, `eq`, `ok`, `throws`). The tally prints on process exit; failures set `process.exitCode`. Each pure library package gets a root `test.rip` that imports them and runs via `"test": "rip test.rip"` — per the contract in [AGENTS.md](AGENTS.md). Host-heavy suites (server, db, vscode) may stay on Bun until they have a natural Rip shape — that is the exception, not the default. The language battery keeps its own harness (`test/support/testing.js`).
5. **Only intentional Rip-logic keepers among the three:** validate (redesign), gate (security + middleware shape). Everything else is “v3 Rip + packaging/tests.”

## Suggested next steps

1. Accept **KEEP_V4** for the finished set (no Rip restores; no type reintroduction).
2. Roll root `test.rip` + `@rip-lang/testing` across the remaining packages (`gate` where security tests fit) — `x12`, `validate`, `swarm`, `print`, `script`, and `utils` are done.
3. Continue the compare→strip→judge loop for remaining packages (`server`, `app`, `db`, `ui`, `ai`, …) — without bringing types (`stamp` is done; see its section).
4. Optional follow-up: gate standalone `GATE_*` bootstrap once v4 serving story is ready.
5. Typing pass (separate): strip or regenerate types.
