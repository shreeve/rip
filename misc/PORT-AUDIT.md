# Rip v3 → v4 Port Audit

**Date:** 2026-07-15 · **Method:** five independent auditors compared each completed package in
`rip/` (v4) against its `rip-lang/` (v3) counterpart, treating v3's test suites as the executable
spec and `misc/PLAN.md`'s settled decisions + PR bodies (#80–#114) as the record of *deliberate*
divergence. Every divergence was classified DELIBERATE or SILENT, then judged
IMPROVEMENT / REGRESSION / JUDGMENT CALL. Analysis only — no files were modified.

Packages audited: **validate, db, server, app, vim, vscode, highlight** (the completed stages).
**ui** was intentionally excluded: PLAN.md rows 33–40 are pending, so v4's ui is an unported
stage, not drift. HMR and the libraries lane are likewise not yet portable.

---

## Executive summary

The "maybe they all got better" hunch is **mostly right — with a specific, repeating failure
mode**. In every package, the v4 code that exists is equal or superior to v3: real product
contracts implemented faithfully, dozens of genuine v3 bugs fixed, dramatically better tests
(the feared "line-count bloat" decomposed as *test investment* everywhere — product source
actually **shrank** in validate, db, app, and server). The style verdict across the board:
still succinct, idiomatic showcase Rip. Wholesale re-porting from v3 is not recommended for
any package.

The failure mode is **features dying in hand-offs**. When a PR said "the impure edge belongs to
a neighbor" (the bin, the socket layer, "C4 will ship it", the UI stage), the neighbor
frequently never shipped, and nothing recorded the gap. That is where every regression in this
audit lives:

- **server**: no runnable server at all — pure decision cores with no listener, bin, process
  workers, control plane, or proxy execution; plus two settled contracts (rate limit, body
  limit) and ACME/dev-CA implemented nowhere.
- **app**: anchor click interception and link-intent preloading fell between PR #89 and #93 —
  a launched v4 app's plain links full-page-reload.
- **db**: v3's hardest-won correctness work (the temporal boundary) silently dropped, leaving
  a three-way contradiction between the `.d.ts`, the runtime, and a stale comment.
- **highlight**: crashes on load (TDZ); no test, no consumer, so nothing noticed.

## Verdict matrix

| Package | Verdict | Headline |
|---|---|---|
| validate | **KEEP V4** | 37/37 vocabulary intact; every divergence declared in PR bodies; rest are real v3 bug fixes. Cleanest port audited. |
| vim | **KEEP V4** | Strict superset; 3 of 4 files byte-identical; zero losses. |
| vscode | **KEEP V4** (2 rulings) | The RFC 12 payoff: tsgo pipeline, 7 new LSP capabilities, 122 green tests vs v3's zero. Rulings needed on render-DSL completions and bare boolean flags. |
| highlight | **KEEP V4 + FIX** | Genuine crash-on-load regression (TDZ at hljs-rip.js:140 vs :187) + misplaced new rules; five-minute fix + smoke test. |
| app | **HYBRID** | Keep v4 base (fixes ≥6 real v3 bugs, 234 tests); restore click interception, preloading; rule on stash surface, boot-failure UX, scroll fidelity. |
| db | **HYBRID** | Keep v4 architecture (adapter/client split, error taxonomy); back-port temporal boundary + timeouts; rule on Model/QueryBuilder. |
| server | **HYBRID / NEEDS OWNER DECISION** | v4 cores superior everywhere they exist, but the stage is not product-complete: nothing serves. Needs a new serving/bin PR lane with v3 as oracle. |

## Ranked decision list for the owner

### P0 — product-breaking or contract-violating

1. **Server: the missing runnable layer.** `rip server start` does not exist; nothing imports
   `dispatchServer`, `createPool`, `resolveTls`, `createWatch`, or `createUpstream`. PR #106
   declared the stage complete; `docs/ROADMAP.md:39-42` still lists it open. Decide: new PR
   lane in PLAN.md (listener + bin + process workers + control plane + proxy execution + file
   watcher + dns-sd advertiser + config loader) or an explicit re-scope.
2. **Server: settled contracts with zero implementation.** Per-IP rate limit 300/min and 10 MB
   body limit (PLAN.md:97-98) exist nowhere — the body-limit check was removed in PR #98 F4
   pointing at a socket layer that was never built. ACME + dev-CA (PLAN.md:95-96) exist only as
   adapter type signatures (`packages/server/tls.rip:78-81`); v3 has a full RFC 8555 client
   (`rip-lang/packages/server/acme/`) to port from.
3. **App: anchor click interception is gone (B1).** No click listener exists anywhere in the
   v4 repo; plain `<a href>` links full-page-reload. The Playwright suite dodges it by calling
   `router.push` directly (`packages/browser-tests/tests/app.spec.mjs:11`). The `ownsAnchor`
   seam is shipped and ready; the consumer never landed.
4. **DB: temporal boundary silently dropped (D2).** V3 decoded naive `TIMESTAMP` to real `Date`
   at the wire and encoded `Date` params symmetrically, throwing on Invalid Date — pinned by
   v3's entire test suite. V4 has none of it, and contradicts itself three ways:
   `src/runtime/schema-orm.js:1999-2001` claims the adapter decodes temporals (it doesn't);
   the generated `.d.ts` declares `datetime` as `Date` while the runtime pins ISO strings
   (`packages/db/test/schema/schema-types.test.js:61` vs `:516`). Either re-port v3's
   `decodeEnvelope`/`encodeParams` + TZ-pinned tests, or rule "datetimes are ISO strings" and
   fix the `.d.ts` and stale comment.
5. **highlight: crashes on load.** `FUNCTION_DEF.contains` references `WORD_ARRAY`
   (`packages/highlight/hljs-rip.js:140`) before its `const` at line 187 —
   `registerLanguage('rip', rip)` throws. Also: `WORD_ARRAY`/`SYMBOL_LIT` only live inside
   `FUNCTION_DEF`, not top-level `contains`, so `%w[…]`/`:symbol` wouldn't highlight in normal
   code even after the fix. No package.json, no tests, no consumer. Fix + one smoke test.

### P1 — silent feature losses and live bugs needing a ruling

6. **Compiler/DSL: bare boolean flags in render blocks mis-compile.** V3 treated a bare
   `disabled` line as an attribute flag; v4 compiles it to `document.createElement('disabled')`
   — a bogus child element. Any ported v3 UI source breaks silently. Rule whether the
   colon-only form (`disabled: busy`) is the settled DSL; if so, consider a loud compile error
   for the bare form.
7. **vscode: the render-DSL completion layer is gone** — component-prop, HTML-attribute,
   `@event`, union-value, and discriminant completions (~700 lines,
   `rip-lang/packages/vscode/src/lsp.js:1442-2106`). tsgo cannot replace it: the TS face lowers
   attributes to string literals cast `as any`. Decide: (a) deferred to UI stage, (b) redesign
   so the TS face types attributes (better than v3's approach), or (c) abandoned — and record it.
8. **DB: core runtime's duplicate default adapter (D8).** `src/runtime/schema-orm.js:570-627`
   never received PR #107's session-lifecycle fixes — commit drops the session outside
   `finally` (`:616`), failed BEGIN orphans its session, missing sessionId runs unisolated.
   Schema-model apps on the default adapter get exactly the bugs the db stage fixed next door.
   Backport or construct the default lazily from `@rip-lang/db`.
9. **DB: Model/QueryBuilder not ported (D3).** `Model('users')` + chainable QueryBuilder
   (`rip-lang/packages/db/client.rip:454-736`) has no v4 equivalent short of raw SQL or a full
   `schema :model` declaration. Semi-deliberate (one-ORM consolidation) but unrecorded. If
   wanted, ~150 lines over `createClient` re-ports cleanly.
10. **DB: adapter timeout (D5).** V3 aborted every query at 30 s with TIMEOUT/ABORTED codes;
    v4's `harborAdapter` has no timeout and accepts no signal — a hung harbor hangs the app.
    Filed as LOW backlog in PR #114; it's a real availability hole. Cheap fix.
11. **App: link-intent preloading dead code (B2).** `cell.preload()` shipped, tested, never
    called. Same PR #89 → #93 hand-off gap as click interception; fix together.
12. **App: stash method surface 10 → 2 (B3).** `inc dec flip join keys has del` and the
    reactive `source(path, key)` handle (pinned by v3's own tests) are gone; only `peek`/`reset`
    remain. Rule on it; if the reduction stands, record it as a settled decision.
13. **App: blank page on boot-gate failure (B4).** Retain-previous-screen is better mid-session
    than v3's unmount-everything, but on first load there is no previous screen — a failed boot
    gate renders a blank page. Decide whether first mount deserves v3's fatal-error card.
14. **App: scroll fidelity + `navigating` grace (B5/B6).** V4 saves scroll only at `push` (v3
    continuously saved into `history.state`, so back/forward departures kept position) and
    restores with a single immediate `scrollTo` (v3 retried ~20 frames for async mounts). V3's
    100 ms `navigating` grace (no spinner flash) is gone. One-screen fixes in `router.rip`.
15. **Server: silently absent operational features to rule in or out** (never listed in PLAN's
    scope): realtime WebSocket hub (`rip-lang/.../serving/realtime.rip`), metrics/`/status`/
    `/diagnostics`, request IDs, per-request `timeout` middleware, `compress`, SSE heartbeat,
    request-smuggling gates, directory listings/markdown rendering in static serving. ~4,500
    lines of v3 operational capability with no v4 counterpart or recorded decision.
16. **Server: CLI grammar + config model.** V4 quietly replaced v3's `w:4 c:2 https:443
    app@alias` token grammar and `serve.rip` config with conventional `--flags` and an
    unloaded `--config`. Taste ruling needed **before** the bin gets written against it.
17. **Validate/server seam: hardcoded raw-type list.** `packages/server/input.rip:26,60`
    ignores the registry's per-entry `{raw: true}` flag — custom raw validators get
    stringified through `read()`. Cheap fix.

### P2 — hygiene and ledger reconciliation

18. **Ledger drift.** PLAN.md still promises `introspect` on the adapter contract (dropped in
    PR #111, correctly) and a live harbor-gated test tier (doesn't exist — all "integration"
    tests run on fetch doubles); PLAN.md:14-15 requires owner-recorded amendments. ROADMAP
    contradicts PR #106 on server-stage completion. Reconcile.
19. **vscode README hygiene.** "the the" scrubbing artifacts (lines 133/156/199), stale
    "Version 1.0.0" vs package.json 4.0.0, stale "render doesn't compile yet" note, committed
    `vscode-rip-4.0.0.vsix` binary.
20. **DB small losses (D10).** `dump` no longer rewrites `load.sql` to relative paths; mcp
    `INSTRUCTIONS` shrank from v3's ~38-line DuckDB cheat-sheet to 5 lines; v3 README's
    wire-format table (BIGINT/DECIMAL/INTERVAL/BLOB) not carried over.
21. **Validate judgment items** (all declared, none urgent): `date` canonicalizes `'20240115'`
    → `'2024-01-15'`; `check()` now throws on unknown type (soft probe = `getValidator`);
    strict money comma-grouping (`'1,00'` now rejects instead of parsing as $100.00); browser
    code must `import '@rip-lang/validate/coercers'` explicitly.
22. **Env-config inconsistency (db D1).** `harborAdapter` ignores `RIP_DB_URL`/`RIP_DB_TOKEN`
    while embed/cli/mcp/core-ORM honor them.

**Owner rulings 2026-07-15** (recorded in `misc/PLAN.md`): item 4 — temporal boundary re-ported,
`Date` at the wire (`fix/db-temporal-boundary`); item 6 — bare boolean flags compile as
attributes, v3 semantics restored (`fix/render-bare-boolean-flags`); item 7 — render-DSL
intelligence returns via typed attribute positions in the TS face, with the UI stage; item 9 —
Model/QueryBuilder not ported, the schema ORM is the one ORM and raw SQL the ad-hoc path;
item 12 — the stash surface is `peek`, `reset`, and the reactive `source(path, key?)` handle
(`fix/app-stash-source-handle`); item 13 — first mount gets the fatal-error card, mid-session
retains the previous screen (`fix/app-boot-error-card`). Items 1 and 18 reconcile in PLAN's
queue: the server serving/bin lane and the live harbor test tier are explicit pending rows.

## Calibration for the remaining stages (HMR, libraries, UI)

Patterns worth writing into the porting rules before the next ten stages:

1. **Declared divergence works.** Validate's PR bodies enumerated every behavior change; that
   package audited clean. Keep requiring a "v3 divergences" section in every port PR.
2. **Hand-offs are where features die.** Every regression found traces to "a neighbor will own
   this" with no neighbor ever scheduled (server bin, app click interception/preload, ACME,
   body limit, render completions). Rule: any deferral must land as a named row in PLAN.md's
   queue or an explicit ROADMAP entry in the same PR — otherwise it's a cut and must say so.
3. **Port the v3 tests first.** The two worst silent drops (db temporal, app click matrix)
   were exactly the behaviors v3's tests existed to pin — the tests weren't carried, so the
   behavior vanished without a tripwire.
4. **The bloat fear is unfounded.** In every audited package, v4 product source is smaller or
   justified; growth is tests and declarations. Line counts are not a drift signal here —
   absence is.
5. **Everything needs one smoke test.** highlight shipped broken because nothing ever called
   its factory. No artifact rides along untested.

---

# Package dossiers

## validate — KEEP V4

**Sources:** v3 `rip-lang/packages/validate/` (validate.rip 248, test.rip 121); v4
`rip/packages/validate/` (registry.rip 286, index.rip 8, coercers.rip 19, tests 566).

**Headline:** vocabulary intact — exactly the same 37 names, no renames/drops/additions
(v3 `validate.rip:125-209` vs v4 `registry.rip:135-232`; pinned at
`test/validate.test.js:232-254`). The validator table is nearly byte-identical. The 2.4×
growth is almost entirely tests (121 → 566); source grew 248 → 313 (+26%), every addition
tracing to a settled decision. **Every behavioral divergence is enumerated in PR #82's
"v3 divergences" section** — declared drift adopted through review, not silent drift.

### Semantic changes

| # | Change | Concrete input → v3 vs v4 | Status | Verdict |
|---|---|---|---|---|
| 1 | `date` calendar-true + canonical form (v3 `validate.rip:164` shape-only; v4 `registry.rip:124-129,176-182`) | `'2023-02-29'` → v3 accepted, v4 `null`; `'20240115'` → v3 `'20240115'`, v4 `'2024-01-15'` | Validity: DELIBERATE (PLAN.md:56-58). Canonicalization: PR-declared, not in PLAN.md | Validity: IMPROVEMENT. Canonicalization: JUDGMENT CALL — compact `YYYYMMDD` storage/compare now gets a different string |
| 2 | `zip` anchored (v3 prefix `/^(\d{5})/` → v4 `/^(\d{5})(?:-\d{4})?$/`, `registry.rip:194`) | `'12345 Main St'` → v3 `'12345'`, v4 `null` | Declared (PR #82, HIGH) | IMPROVEMENT — v3 silently truncated garbage |
| 3 | `money` comma grouping validated (`registry.rip:145`) | `'1,00'` → v3 `10000` ($100.00!), v4 `null` | Declared | IMPROVEMENT |
| 4 | `float` sign on bare fractions (`registry.rip:140`) | `'-.5'` → v3 `null`, v4 `-0.5` | Declared | IMPROVEMENT — v3 regex bug |
| 5 | `phone` keeps ext on `+1` numbers (`registry.rip:91`) | `'+1 502 758 8802 x12'` → v3 dropped ext, v4 `'(502) 758-8802, ext. 12'` | Declared (HIGH) | IMPROVEMENT — v3 lost data |
| 6 | `semver` rejects leading zeros (`registry.rip:209`) | `'01.2.3'` → v3 passed, v4 `null` | Declared | IMPROVEMENT |
| 7 | `toName` char-class typo `[a-k,m-z]`→`[a-km-z]`, dup `ohrt` removed (`registry.rip:66,68`) | marginal | Declared | IMPROVEMENT (trivial) |
| 8 | `formatMoney` rejects non-finite (`registry.rip:106`) | `NaN` → v3 `'$NaN.NaN'`, v4 throws | Declared | IMPROVEMENT |
| 9 | Registry Map + name gate (`registry.rip:242,252`) vs v3 plain object | v3 `check('x','constructor')` hit inherited members; `registerValidator('__proto__',…)` polluted. v4 inert | Declared | IMPROVEMENT — real v3 hazard |

Unchanged and verified identical: money rounding, cents, decimal, string/text blank-in-blank-out
(a change was explicitly DECLINED in PR #82 review to preserve v3 semantics), time/time12,
booleans, email, state (any two letters), ssn, sex, username, ip, mac (mixed-separator-lenient,
pinned), url, color, uuid, slug, ids, array/hash/json, toName, isBlank.

### API-shape changes

- **A. Mutable `validators` export removed**; `validatorNames()` added (`index.rip:7-8`,
  `registry.rip:270-271`). DELIBERATE (frozen registry, PLAN.md:58-59). IMPROVEMENT, but
  breaking: `validators.id(x)` → `getValidator('id')(x)` or `check(x,'id')`.
- **B. `registerValidator` rejects loudly** — duplicates, non-functions, async/generator, bad
  names (`registry.rip:251-265`); v3 silently overwrote. DELIBERATE. IMPROVEMENT.
- **C. `check` throws on unknown type** (`registry.rip:277`); v3 returned `undefined` (tested
  at v3 `test.rip:75`). PR-declared, not a settled decision. JUDGMENT CALL — coherent (soft
  probe = `getValidator`; server `read()` fails loud independently, `packages/server/input.rip:59`)
  but a contract flip on a public function.
- **D. Coercer bridge is a separate entry** `@rip-lang/validate/coercers` via direct path
  (`coercers.rip:16-17`); v3 auto-registered via optional `globalThis.__ripSchema` hook that
  silently no-opped if the runtime wasn't loaded. DELIBERATE (PLAN.md:63-64). IMPROVEMENT;
  usage change: bare package import no longer registers coercers.
- **E. `registerValidator` gains `{raw: true}`** (`registry.rip:262-265`). Declared. IMPROVEMENT.
- **F. Issue shape unchanged**; miss sentinel narrowed so coerced `false` is a value —
  `~:bool` of `'no'` now works (PR #83, HIGH). IMPROVEMENT.

**Cross-package finding:** `packages/server/input.rip:26,60` hardcodes
`RAW_TYPES = ['array','hash','json']` instead of consulting per-entry raw flags — custom
`{raw: true}` validators get stringified through `read()`.

### Complexity accounting

Source 248 → 313 (+65: calendar math ~16, registry machinery ~45, both settled); tests
121 → 566 (dense contract table covering adversarial edges v3 never tested). Only arguable
ceremony: hand-written `index.d.ts` + 57-line tsc harness for an 8-export package — explicit
PR #87 scope, repo-wide convention. Style verdict: still succinct idiomatic Rip; the `watchers`
indirection (~10 lines) buys registry/runtime decoupling and pre-commit atomicity.

**Recommendation: KEEP V4.** Re-porting would reintroduce fixed bugs. Personal-review items:
date canonicalization; `check` throws; money strictness; the server raw-flag seam; coercers
import ergonomics (confirm app/browser stages wire `import '@rip-lang/validate/coercers'`).

---

## db — HYBRID (keep v4 architecture; back-port temporal + timeout; rule on Model)

**The "doubling" inverts on inspection:** v4 library source is roughly half of v3
(873 vs 1,592 lines); growth is tests (107 → 1,591, 121 tests) and type declarations (0 → 104).
Every v4 source file is shorter than its v3 counterpart. No over-engineering; the question is
what got dropped while it shrank.

**v3 inventory:** module-singleton client (`query/findOne/findAll/materializeAll`,
env-configured, `connect()` auto-installing the schema adapter, `client.rip:95-99`); temporal
boundary (`client.rip:145-231`) with `TZ`-pinned tests; 30 s timeout/abort with
TIMEOUT/ABORTED/NETWORK_ERROR classification (`client.rip:297-338`); single `RipDBError`;
`begin()` over harbor sessions; Model/QueryBuilder ORM (`client.rip:454-736`); `bin/rip-db`
(dump/load/checkpoint), mcp (3 tools, rich DuckDB instructions), embed. DuckDB-via-harbor only.

**v4 inventory:** `adapter.rip` (settled contract: `harborAdapter({url,token,fetch})` →
`{query, begin, capabilities}`; typed `DbError`/`ConnectionError`/`QueryError`; session
lifecycle hardened — `adapter.rip:142-182`); `client.rip` (`createClient` →
`{query, rows, one, value, transaction}`; transaction joins nested, no savepoints;
`CancelledError`); cli/bin, embed, mcp faithful ports behind injected seams; 121 tests incl.
a certification suite. Migrations and schema ORM live in the compiler core (`src/migrate.js`
1,133 lines; `src/runtime/schema-orm.js` 2,390 lines) per settled decision.

### Divergences

- **D1. Singleton → explicit adapter+client.** DELIBERATE (PLAN.md:120-124, PRs #107/#108).
  IMPROVEMENT; every v3 call site breaks. Inconsistency: `harborAdapter` ignores
  `RIP_DB_URL`/`RIP_DB_TOKEN` (`adapter.rip:77-82`) while embed/cli/mcp/core-ORM honor them.
- **D2. Temporal decode/encode dropped — SILENT REGRESSION (top finding).** v3 decoded naive
  `TIMESTAMP` (no `Z`, so `new Date(v)` shifts by host offset) to `Date` at the wire and
  encoded symmetrically, throwing on Invalid Date. v4 has zero temporal handling; the
  schema-orm comment (`src/runtime/schema-orm.js:1999-2001`) claims the adapter decodes
  (false); `.d.ts` says `Date`, runtime pins ISO strings
  (`test/schema/schema-types.test.js:61` vs `:516`). No PR mentions the drop; no v4 test covers
  a temporal crossing the wire. Downstream: Invalid Date now silently serializes to `null`.
- **D3. Model/QueryBuilder dropped — SEMI-DELIBERATE, JUDGMENT CALL.** One-ORM consolidation is
  defensible under FINALIZE F1/F3/F5, but never recorded. `User.where(active: true).all!` on an
  undeclared table has no v4 equivalent short of raw SQL or a full schema model. ~150-line
  re-port over `createClient` if wanted.
- **D4. Error taxonomy** `RipDBError` → typed family, classification by domain with offending
  SQL attached (`adapter.rip:106-124`). DELIBERATE (PR #107). IMPROVEMENT; certified
  (`test/certification.test.js:105-147`).
- **D5. Timeout dropped — REGRESSION (medium).** v4 adapter has no timeout, accepts no signal;
  client cancellation races the promise but never aborts the socket
  (`packages/db/client.rip:36-47`, disclosed PR #108). Hung harbor hangs the app. PR #114
  filed it LOW backlog. Only `mcp.rip:190-196` kept 30 s.
- **D6. Transaction semantics.** DELIBERATE. IMPROVEMENT — fixed v3's masked commit errors,
  session leak on failed COMMIT, orphan on failed BEGIN, silent unisolated run on missing
  sessionId (`adapter.rip:147-182`).
- **D7. `introspect` dropped from the contract** (PR #111; migration runner reads DuckDB's
  catalog directly — richer). Right call; **PLAN.md:121 never amended** despite PLAN.md:14-15
  requiring owner-recorded changes. PROCESS FLAG.
- **D8. Duplicate harbor adapter in the core runtime** (`src/runtime/schema-orm.js:570-627`,
  inherited from v3): did NOT receive PR #107's fixes — commit drops session outside `finally`
  (`:616`), failed BEGIN orphans, missing sessionId runs unisolated, untyped errors. Default-
  adapter schema apps get the bugs the db stage fixed. Backport or construct lazily from
  `@rip-lang/db`. JUDGMENT CALL on mechanism, fix either way.
- **D9. No live endpoint-gated test tier — SILENT GAP vs settled decision** (PLAN.md:126-127).
  All "integration" tests run on fetch doubles; no test reads a real harbor endpoint.
- **D10. CLI/mcp/embed** (PR #112): faithful + improved (testable seams, `AND NOT internal`
  catalog queries). Disclosed losses: `dump` no longer rewrites `load.sql` to relative paths
  (v3 `bin/rip-db:362-383`); mcp INSTRUCTIONS shrank ~38 lines → 5; v3 README wire-format
  table not carried.

**No engines dropped** (v3 was already harbor-only). Breaking for v3 app code:
`query/findOne/findAll` singletons, `connect()`, Model/QueryBuilder, `RipDBError`, `ident`,
`decodeEnvelope/encodeParams` — v4 surface is exactly 7 exports
(`certification.test.js:19-26`). Schema-ORM app code carries over.

**Quality:** v4 is the better artifact — typed `export def` signatures, every host effect
behind a seam, v3's five-concern 735-line client properly factored. One dishonest artifact:
the stale temporal comment.

**Recommendation: HYBRID.** Personal-review items: temporal boundary (re-port or rule
ISO-strings and fix `.d.ts`); Model/QueryBuilder ruling; adapter timeout; the runtime's
duplicate default adapter; ledger hygiene (D7, D9).

---

## server — HYBRID; stage not product-complete; NEEDS OWNER DECISION on the missing layer

**v3:** 9,392 lines of `.rip` across 43 modules + 4,892 test lines + bin. **v4:** 2,713 lines
across 16 flat modules + 2,825 test lines (JS; 287 tests pass in 234 ms).

### Headline: v4 has no runnable server

Every v4 module is a pure decision core over injected adapters. No `Bun.serve`, no socket, no
process spawn, no bin. Each PR deferred the impure edge to a neighbor — cli.rip:1-4 ("the bin
owns argv/exit"), pool.rip:7-8, tls.rip:5-7, watch.rip:18-19, mdns.rip:5-6 — **and no PR ever
delivered the neighbor.** Nothing in the repo imports `dispatchServer`, `createPool`,
`resolveTls`, `createWatch`, or `createUpstream`. `rip server start` does not exist. PR #106
declares the stage complete; `docs/ROADMAP.md:39-42` lists it open. The v4 cores are genuinely
better-engineered than v3's, but the product contract (PLAN.md:102-105) is only satisfiable by
a serving/bin layer that was never scheduled.

### Settled-decision compliance

Compliant: router registration-order/duplicate-reject (`router.rip:140-149`); sessions
(`security.rip:154-186`; stricter: secret required always unless `insecure: true`,
`security.rip:32-38`); CSRF header-only (`security.rip:205-250`); secureHeaders in preset
(`serving.rip:210,224-225`); no committed certs (v3 ships `certs/ripdev.io.*` in git — v4
correctly refuses); queue/recycle numbers (`pool.rip:26-31`); SSE watch; L4 streams correctly
cut. **Violations:** TLS "ACME or dev CA" — policy only, adapter signatures at `tls.rip:78-81`,
no ACME client or CA generator anywhere (v3: full RFC 8555 client in `acme/client.rip`,
`acme/crypto.rip`, 12 h renewal loop). Workers `cores/2` — README sentence only, pool defaults
`size: 1` (`pool.rip:57`). **Rate limit 300/min — no rate limiter exists in v4** (v3:
`serving/ratelimit.rip` token bucket, LRU 100k, 429 + Retry-After). **Body limit 10 MB —
nothing enforces it**; PR #98 F4 removed the check pointing at worker units that have no socket
(v3: `maxRequestBodySize`, `server.rip:221-247`).

### Feature fate (v3 → v4)

**Present, improved:** route matching (regex compiler → segment grammar, loud registration,
fuzz-total, `router.rip:56-101`); `read()`/validators/`input:` schemas/structured 400s
(`input.rip`); OpenAPI (derived-never-registered, schema dedup, byte-determinism,
`openapi.rip`); cors (`Vary: Origin`, exact preflight, null-origin credential ban,
`builtin.rip:37-69`); sessions/CSRF/secureHeaders (hardened, see below); static core
(symlink realpath containment both sides `serving.rip:70-77`, weak ETag/304 — stronger than
v3); TLS policy core; nginx/caddy generation (injection-proofed, deterministic, `compat.rip`);
watch transport (revision ids, `Last-Event-ID` catch-up, sticky compile error, CSS fast path).

**Deliberately cut (recorded):** Sinatra DSL globals → explicit `matcher.add`+`compose`
(PR #94/#96; `respond` still binds `ctx` so `@json`/`@read` work, `context.rip:208`); logger
`short` preset; L4 streams (~730 lines); committed certs; bench.

**Moved:** bundle construction → browser-delivery stage (PRs #90–#93); v4 serves a prebuilt
bundle at `/bundle.json` (`serving.rip:203-225`). Confirm nothing fell between stages
(Brotli variants, per-worker bundle caching).

**Silently missing (~4,500 lines of operational capability):** HTTP/HTTPS listeners (port
scan, EACCES fallback, idle timeout); optional route params `:id?`; ALS request context
extras — `mark()` correlation, `subrequest()`, `env` proxy; `error!`/`notice!`/`bail!`
spellings (envelope semantics preserved exactly, `context.rip:83-95`); `read()` object-range
form `{start,end}`/`{min,max}` (`input.rip:56-79` lacks it); HEAD→GET synthesis; `compress`;
per-request `timeout` (30 s → 408); `htmlJson`; request-smuggling gates (CL+TE, multi-Host,
null byte, triple-decode traversal — v4 `harden()` keeps only URL length + method allowlist,
`security.rip:323-330`); per-IP rate limiter; metrics/p50-p99/`/status`/`/diagnostics`;
request IDs; access logs w/ CrowdSec-friendly client IP; **realtime WebSocket hub**
(`serving/realtime.rip`, 269 lines — absent from PLAN's scope list, cut by omission, owner
should rule); proxy *execution* (hop-header stripping, XFF overwrite, `Via`, timeout→504, WS
bridge — v4 `upstream.rip` is selection/breaker/retry policy only); health-check poller;
**process workers** (spawn `bun --preload`, unix sockets, readiness, crash budgets, hot swap
with atomic version flip + rollback); control plane (unix socket `/reload`/`/restart`/etc.,
PID files, SIGHUP, verify-before-activate config reload — v4 CLI defines the commands,
`cli.rip:25`, with no handler: `cli.rip:137-138` returns "not available here"); `serve.rip`
config model/loader (v4 parses `--config F`, `cli.rip:19`, loads nothing); multi-app registry
+ wildcard hosts; directory listings/markdown/highlight source views/multi-index in static;
SAN scanning; ACME; mDNS advertiser + served dashboard (v4 computes descriptor only); file
watchers (likely HMR-stage-intended — unrecorded); SSE heartbeat (20 s keepalive — matters
behind proxies); generated-config hardening (OCSP, http2, HSTS, rate-limit zones, 421 default
server, `nginx -t` smoke).

### Changed-in-both divergences

Improvements (deliberate): session `Secure` default on; secret required (slightly stricter
than settled "production" wording — dev needs `insecure: true`; defensible); 5xx commits no
session (`security.rip:178-181`); `X-XSS-Protection: 0`; `trustProxy()` explicit opt-in with
host-shape validation (`security.rip:292-310`; v3's `trustedProxies` was validated but
unconsumed); ETag minting refused without real freshness numbers (`context.rip:186-190`).
Silent judgment calls: upstream defaults (least-inflight→round-robin, EWMA tiebreak dropped,
`minRequests` 10→20, jitter 0.3→0.2; re-arm + pure-eligibility fixes are real improvements —
`upstream.rip:21-23`); retry backoff linear→exponential; nginx/caddy generator takes a new
standalone site model rather than the (missing) runtime config (`compat.rip:14-17`); **CLI
grammar** v3 token style (`w:4 c:2 https:443 app@alias`) → conventional `--flags`
(`cli.rip:15-25`) — distinctive product surface replaced without a ruling.

### Quality

v3: mature idiomatic Rip, big-file architecture (1,268/1,155/808-line modules), module-global
state, everything wired and operable — a *product*. v4: showcase Rip, small typed DI modules,
no globals, unusually narrative comments, JS tests per repo convention — a *library* where
everything tests instantly and nothing runs.

**Recommendation: HYBRID — keep v4's cores; schedule the serving/bin lane** (listener +
process workers + proxy fetch/health loop + watcher + dns-sd + ACME client + dev CA + config
loader + rate/body limits + `rip server` bin), v3 as oracle. Personal-review items: the missing
runnable layer (new stage vs re-scope; ROADMAP/PLAN contradiction); rate/body limits; ACME +
dev CA; realtime hub / metrics / control plane rulings; CLI grammar + config model.

---

## app — HYBRID (keep v4 base; restore B1/B2; rule on B3–B6)

**v3:** one 3,462-line `index.rip` + ambient `aria.d.ts`. No package tests (spec lives in
`rip-lang/test/bundle.test.js`, 1,120 lines, + `check.test.js`). Surface: context accessors,
stash (+10 reserved methods incl. reactive `source(path,key)` handle, index.rip:489,602),
`createResource` (index.rip:755), `source` cells (index.rip:1062), `createMutation`, timing
helpers, `createComponents`, `createRouter` (browser-only; document-level click interception
index.rip:1566, scroll save/restore w/ retry index.rip:1519, aria-current walker), 
`createRenderer` (in-browser compile→blob→import index.rip:1898, error card index.rip:2098,
link-intent preloading index.rip:2534, `remount(force)`), `launch` (bundle or bundleUrl w/
ETag, `window.app`/`window.__RIP__`, SSE connectWatch index.rip:2677), `globalThis.ARIA`
(14 helpers, index.rip:3452).

**v4:** twelve focused modules, 2,278 lines product source + 389-line `index.d.ts` + README +
**4,174 lines of tests (234 tests, verified passing ~1 s)**. Exports (index.rip:1-19):
`source, createStash, unwrapStash, createMutation, delay/debounce/throttle/hold,
createComponents, buildRoutes, parseQuery, createRouter, browserAdapter, createRenderer,
persistStash, launch, ariaCurrent, ownsAnchor`.

### A. Deliberate (settled decisions) — implemented and tested, all judged improvements

A1 `createResource` removed per contract. A2 optional segments `[[name]]` + 8-cap +
self-ambiguity rejection (routes.rip:55-121). A3 per-segment precedence, code-unit tie-break
(routes.rip:217-224) — v3's `localeCompare` sort was locale-dependent (a real bug,
v3 index.rip:1390). A4 percent-decoded matching; malformed encoding fails the match — v3 threw
uncaught URIError (v3 index.rip:1351). A5 duplicate/ambiguity rejection over full shape
expansion (routes.rip:204-213). A6 route identity = file path, frozen manifest. A7 injectable
adapters everywhere (router.rip:14-21, aria.rip:64, persist.rip:20, launch.rip:75-80) — whole
package tests under Node; v3 threw `assertBrowser`. A8 compile/blob machinery →
`src/browser-modules.js`/`browser-boot.js`; renderer consumes precompiled modules
(renderer.rip:38-52). A9 `bundleUrl`/ETag → `bootApp` (src/browser-boot.js:37-79) with
cache-poisoning self-heal v3 lacked. A10 SSE connectWatch → server watch stage. A11 ARIA
surface removed per contract (→ `@rip-lang/ui` typed exports) — **but the UI stage is pending,
so today this functionality exists nowhere in v4**. A12 `ariaCurrent`/`ownsAnchor` typed
exports (aria.rip); PR #89 fixed six v3-class defects (base-path ownership, hash inversion,
`//evil.com` claims). A13 gate construction private capability (renderer.rip:3-5) vs v3's
spoofable `globalThis.__ripGateMount` (v3 index.rip:2424). A14 transactional mounting
(staging fragment, commit-after-success, old screen retained — renderer.rip:219-235, 372-405)
vs v3's `innerHTML` wipe (v3 index.rip:2399). A15 stash module convention `appStash`, loud
missing-export, cells-by-reference seed (launch.rip:86-101, stash.rip:237-246).

### B. Silent divergences

- **B1. Anchor click interception gone — REGRESSION.** v3 made every same-origin `<a>` an SPA
  navigation (modifier keys, `_blank`, `download`, `data-router-ignore`, base scoping —
  v3 index.rip:1554-1579). v4 has **no click listener anywhere** (grepped src + all packages:
  zero hits). PR #89 said `ownsAnchor` is the seam "C4's preloading and click interception will
  share"; C4 (PR #93) shipped neither; ROADMAP doesn't list it. The Playwright fixture proves
  it: navigates via `globalThis.__rip.router.push('/profile')`
  (packages/browser-tests/tests/app.spec.mjs:11) because clicking would full-page-reload.
- **B2. Link-intent preloading dead code — REGRESSION.** v3 preloaded a hovered/focused link's
  gate union after 50 ms settle (v3 index.rip:2534-2609). v4 kept and improved the cell-side
  `preload()`/freshness floor (source.rip:154-160, tested substrate.test.js:136) — nothing
  calls it.
- **B3. Stash methods 10 → 2 — JUDGMENT CALL.** `inc dec flip join keys has del` and the
  reactive `source(path, key)` handle (v3 index.rip:602-628; pinned v3 bundle.test.js:451)
  gone; v4 keeps `peek`/`reset` (stash.rip:3-5). PR #77 body doesn't record it. Reading
  `loading`/`error` now requires `unwrapStash(app.data).user.loading`.
- **B4. Unhandled failure UX — JUDGMENT CALL.** v3: unmount + fatal-error card
  (v3 index.rip:2098,2523). v4: previous screen retained, `mount()` rejects, `onError`
  notified (renderer.rip:249; recorded CHANGELOG #85) — but on first load there's no previous
  screen: failed boot gate = blank page + console error.
- **B5. Scroll fidelity narrowed — REGRESSION (subtle).** v3 continuously saved scroll into
  `history.state` (throttled listener, v3 index.rip:1532-1539) and retried restore ≤20 frames
  (v3 index.rip:1519-1527). v4 saves only at `push` (router.rip:189-191), restores with one
  immediate `scrollTo` (router.rip:284-286): traversal departures lose position; restore can
  clamp against a not-yet-mounted page.
- **B6. `navigating` lost its 100 ms grace** (v3 `delay 100`, index.rip:1453 → plain boolean,
  router.rip:92) — spinner flash on fast navigations. Minor regression.
- **B7. `load()` no longer runs on initial mount** — only on the query fast path
  (renderer.rip:334; v3 ran it after every mount, index.rip:2494). Settled decision covers
  only the query case. JUDGMENT CALL.
- **B8. Stash wraps only plain objects/arrays** (stash.rip:40-43); v3 made class instances
  reactive (v3 index.rip:322-326). JUDGMENT CALL (v4 more predictable).
- **B9. Loudness conversions** (staleTime typo throws, source.rip:50-69; malformed stash paths
  throw; non-thenable fetch throws). IMPROVEMENTS, breaking vs v3.
- **B10. Persist restore deep-merges** (`_mergePlain`, stash.rip:254-271) vs v3 shallow
  per-key replace. Minor JUDGMENT CALL.
- **B11. Removed conveniences:** `currentApp`/`currentRouter`, context re-exports,
  `window.app`/`window.__RIP__` devtools handle, `document.title` from bundle (now server
  shell's job, packages/server/serving.rip:167-179), `remount(force)` (HMR pending),
  `router.routes` getter.
- **B12. `@app`/`@router` self-heal from globals removed** (pinned at v3 bundle.test.js:523;
  v4 installs globals only as launch guard, launch.rip:148-149). Embedded non-route components
  lose ambient router access. JUDGMENT CALL.

### C. Silent improvements (v4 fixed real v3 bugs)

Mutation pending generation guard (mutation.rip:48 — v3's older async `onError` could kill a
newer call's spinner, v3 index.rip:1111); keyed-family cap prunes in a loop, protects active
key, rejects unserializable keys (source.rip:213-237 — v3 silently overflowed when all
loading); `delay` risen-guard (timing.rip:44-49 — in v3 a churning truthy source never rose);
persist primes the effect, untouched stash never writes, purge cancels pending debounce
(persist.rip:50-77); redirect-loop guard (router.rip:121,155-156); history-before-state
ordering; `__proto__` hardening in stash/params; nested source reset (stash.rip:199-209 — v3
reset only top level).

### Complexity

Product source 3,462 → **2,278** (−34%): ~1,150 lines left for plan-assigned owners (ARIA →
UI stage, compile/blob → browser delivery, watch → server, resource → deleted) and ~150 left
for nowhere (B1/B2). Growth = tests (0 → 4,174) and declarations. Style: all product code is
idiomatic Rip, no over-engineering found; the one place v4 is more elaborate (route shape
expansion, routes.rip:99-120) implements a settled decision.

**Recommendation: HYBRID.** Personal-review items: click interception (seam ready — queue a
small PR; before or with UI stage?); preloading (same PR or explicit deferral note); stash
surface ruling (record as settled if the reduction stands); boot-failure blank page; scroll
fidelity + navigating grace (one-screen fixes in router.rip).

---

## vim — KEEP V4

v3: four VimScript files (ftdetect 6, ftplugin 22, indent 52, syntax 218). v4: same four;
**ftdetect/ftplugin/indent byte-identical**; syntax 241 lines, a strict superset adding `.=`,
`*>`, `*{`, `?=` (syntax/rip.vim:109-111), `$"…"` bridge + `:name` symbols (:113-117), `<~`
(:123), `%w[...]` all five delimiter forms (:130-138), compound object keys (:141-143). All
deliberate tracking of v4 syntax. **Nothing lost.** Zero regressions.

---

## vscode — KEEP V4 (rulings on render completions + bare flags; doc cleanup)

Predates the campaign (PRs #11, #43, #52, #78). Governing doctrine: FINALIZE.md:874-884
(syntax changes update and test all three grammars in the same PR) and docs/TYPES.md:194-231.

**v3:** ~4,700 lines; one 3,689-line `src/lsp.js`; in-memory virtual `.ts` + in-process TS
LanguageService + `getSymbolLinks` monkey-patch (lsp.js:1295); capabilities: completion,
hover, definition, signature help, quickfix, semantic tokens (full). Bespoke: render-DSL
intelligence ~700 lines (component-prop completions lsp.js:1987, tag attributes from DOM types
:1528, `@event` names :1503, union values :1442, discriminants :1716, class/id suppression
:2565-2578); own auto-import index (workspace + node_modules scan :421-587); hand-rolled
semantic tokens (:2107-2541) incl. custom `attribute` token for bare boolean flags
(package.json:73-85); typed-route refresh (:247-286); client-side doc links; **zero tests**.

**v4:** ~7,100 lines: `server.js` 2,624, `translate.js` 562 (pure, unit-testable), `tsgo.js`
197, `pins.js` 62, `hash.js` 36 + **3,530 test lines, 10 files — 122 pass, 0 fail (run during
audit)**. Architecture per RFC 12 pipeline (TYPES.md:194-211): compile with `face: 'ts'`,
materialize the import closure as an on-disk mirror tree (`.rip/editor/`, hash-keyed cache,
server.js:145-910), run tsgo (TS 7 native) as external LSP, translate through MappingStore.
Capabilities: v3's set **plus** typeDefinition, implementation, references, rename
(prepare + cross-file, fail-safe whole-refusal, server.js:2415-2551), documentSymbol,
workspaceSymbol, inlay hints, semantic tokens full+range, `source.*` code actions with
byte-fidelity import rewrites, server-side doc links from compiler trivia (server.js:2155-2235),
`# @ts-nocheck`/`# @ts-expect-error` (server.js:1087-1125), Tier-3 evolving-let pin probes.

**Deliberate improvements:** mirror+tsgo replaces the fragile monkey-patch and fixes
cross-file resolution (regression-guarded, test/editor-gaps-cross-file-resolution.test.js:7-14
— in-memory mirrors structurally couldn't form one TS program); 7 new capabilities, each
tested; test coverage 0 → 3,530; Tailwind lockstep test proves every DSL class spelling
compiles and extracts (+ `class: (…)` paren form, package.json:88); doc links from real
compiler records (no false linkification); packaging embeds the compiler from repo `src/`
(scripts/package.js:39-44) — v3 loaded from the *workspace*, so behavior varied by project
(tradeoff: fatter vsix, re-package per release).

**Deliberate removals (recorded):** `attribute` token contribution (README.md:255-260 —
tsgo's standard legend); whole-workspace auto-import/references index → active-program scope
(README.md:58-65; roadmapped docs/ROADMAP.md:177-181) — day-to-day DX downgrade worth
prioritizing in Stage H; `checkAll` dropped / `exclude` → `noCheck` (deferred with headless
checker, TYPES.md:229-231).

**Silent losses:**
- **Render-DSL completion layer gone** (v3 lsp.js:1442-2106, 2542-3011) and NOT replaced by
  tsgo: the v4 face lowers attributes to `setAttribute('type', "button" as any)` — no typed
  position to complete from (verified by compiling a render block during audit). No v4 test,
  README, TYPES, or ROADMAP mention. REGRESSION for UI authoring; possibly intended to return
  with the UI stage — nothing says so.
- **Typed-route refresh gone** (v3 lsp.js:247-286). Likely obsolete-for-now (v3-framework-
  specific); real DX if v4 regains file-based routing hooks.
- **Bare boolean flags:** v3's editor supported bare `disabled` as an attribute flag
  (v3 package.json:76); in v4 the same source compiles to `document.createElement('disabled')`
  — a compiler-level language divergence surfaced by this audit. v4 spells it `disabled: busy`
  (test/ui/components.test.js:680-681,735). Ported v3 UI sources silently mis-compile.
  NEEDS OWNER DECISION.

**Cosmetic defects:** README "the the" artifacts (133/156/199), "Version 1.0.0" vs
package.json 4.0.0 (stale since PR #13), stale "render doesn't compile yet" note (stale since
#78), committed `vscode-rip-4.0.0.vsix` (inherited hygiene; FINALIZE frowns).

**Structure verdict:** growth is machinery, not sprawl — this is exactly the RFC 12 payoff
the v4 repo exists for.

---

## highlight — KEEP V4 + FIX (crash-on-load)

Not new functionality: v3's `docs/ui/hljs-rip.js` (209 lines, "Partial" in v3 AGENTS.md:63)
promoted to `packages/highlight/hljs-rip.js` (230) and extended for v4 syntax. Two verified
bugs (reproduced by execution; v3's version loads fine under the identical harness):

1. **TDZ crash:** `FUNCTION_DEF.contains` references `WORD_ARRAY` (hljs-rip.js:140) before its
   `const` at :187 — `hljs.registerLanguage('rip', rip)` throws `ReferenceError`. The README's
   own usage example throws.
2. **Misplaced rules:** `WORD_ARRAY`/`SYMBOL_LIT` live only inside `FUNCTION_DEF.contains`
   (:139-142), absent from top-level `contains` (:206-227) — `%w[…]`/`:symbol` in ordinary
   code wouldn't highlight even after the fix, despite the README's claim.

Root cause: no package.json, no tests, no consumer (README's "Rip Print consumes this" —
no such consumer exists), so the factory was never called. Violates FINALIZE's own
three-grammar test rule. **Fix:** move the declaration above :133, add both rules to top-level
`contains`, add a one-test smoke suite registering the grammar against real highlight.js.

---

*End of audit. Generated 2026-07-15 from five independent auditor reports; both repos left
untouched.*
