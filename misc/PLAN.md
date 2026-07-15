# Campaign Plan — Finish the Rip Product

This is the working ledger for the product-finalization campaign defined in
[FINALIZE.md](FINALIZE.md). It records the settled product decisions, the
ordered PR queue, and each unit's status. Process, invariants, and porting
rules live in the permanent documents; this file does not restate them.

Statuses: `pending`, `in progress`, `merged (#N)`, `deferred`, `rejected`.
When the campaign completes, this file is removed and the permanent
documents state the finished facts.

## Settled decisions

These are product contracts. Code and tests implement them as stated;
changing one requires owner approval recorded here.

### App

- Optional route segments are spelled `[[name]]` and match with and
  without the segment present. A route carries at most eight optional
  segments, and a route whose optionals make it ambiguous with itself
  rejects at build.
- A route's identity is its normalized route file path. There is no
  synthetic route id.
- Route precedence is deterministic and per segment, left to right:
  static before dynamic before optional before catch-all, with code-unit
  pattern order breaking ties. Two files claiming the same URL shape
  reject at manifest build.
- Matching compares percent-decoded path segments; a segment that fails
  to decode matches nothing.
- `(group)` directory segments do not appear in the URL and contribute
  their `_layout.rip` to the layout chain. Files and directories whose
  name starts with `_` are not routable; `_layout.rip` is the only
  special underscore file.
- Params are `decodeURIComponent`-decoded strings. Duplicate query keys
  keep the last value. The hash is stored without `#`.
- Navigating to the same route with only a query change calls the mounted
  page's `load!(params, query)` instead of remounting, unless a
  query-keyed render gate now addresses a different cell. Pushing the
  identical URL resolves and scrolls. Scroll restoration is manual, with
  per-history-entry positions.
- The application data surface is source cells and mutations. There is no
  separate resource abstraction.
- `launch()` is the one boot path. It receives a bundle object; fetching
  bundles is browser delivery's concern. A second launch and a malformed
  bundle reject loudly. Teardown restores every global it installed.
- Interaction primitives (list navigation, dismissal, focus trap,
  positioning, scroll lock) are typed named exports of `@rip-lang/ui`.
  `@rip-lang/app` owns route-aware `aria-current` and the focus/scroll
  policy contracts. Nothing is published on `globalThis`.
- On an unhandled failure with no previous screen (first mount), the
  renderer shows a self-contained fatal-error card; mid-session
  unhandled failures retain the previous screen (owner ruling
  2026-07-15; lands on `fix/app-boot-error-card`).
- The reserved stash surface is `peek`, `reset`, and the reactive
  `source(path, key?)` handle (`{value, loading, error, refetch,
  reset}`). The v3 sugar methods (`inc`, `dec`, `flip`, `join`, `keys`,
  `has`, `del`) are not product surface (owner ruling 2026-07-15; lands
  on `fix/app-stash-source-handle`).

### Validate

- `@rip-lang/validate` is dependency-free and owns the 37-name validator
  vocabulary and its normalization semantics.
- Date validation is calendar-true: validity is computed from the written
  components (leap years included) before any `Date` exists.
- The validator registry is frozen; registration happens only through
  `registerValidator`, and registering an existing name rejects loudly.
- The vocabulary is US-English (phone, zip, state, name casing) and the
  documentation says so.
- Named coercers are synchronous. Registering an async coercer rejects.
- Packages consume sibling packages by direct path resolution through the
  Rip loader. The compiler root carries no workspace or dependency graph.

### Browser delivery

- Rip compiles in the browser. Application bundles carry `.rip` source;
  the browser entry compiles modules into the components store. Bundles
  of precompiled JavaScript are not a product surface.
- All `<script type="text/rip">` sources execute in one shared lexical
  scope, in document order.
- The delivery design requires `unsafe-eval`; the CSP contract is
  documented, and a blocked eval produces a loud, mapped diagnostic.
- Browser module ids use the prefixes `_route/`, `_app/`, `_lib/<name>/`,
  `_pkg/<package>/`, and `_shared/`, resolved with `_pkg` before `_lib`
  before `_app` before `_route`. Every id or name collision rejects.
- Inline source maps ship under watch/development and are absent from
  production bundles.
- Real-browser tests run under Playwright, isolated as a dev dependency
  inside its own test package boundary.

### Server

- The HTTP framework router matches in registration order, first match
  wins. Registering an exact duplicate of an existing method+pattern
  rejects loudly.
- Sessions: cookie name `session`, `HttpOnly`, `SameSite=Lax`,
  HMAC-signed by default with AES-256-GCM encryption opt-in. A missing
  session secret in production is a startup failure.
- CSRF protection is header-only double-submit (`csrf_token` cookie,
  `X-CSRF-Token` header). There is no form-field fallback.
- `secureHeaders` is wired into the app-serving preset (opt-out), and
  independently available.
- No certificate or private key is committed to this repository. TLS uses
  an explicit certificate, ACME, or a locally generated development CA.
- Operational defaults: workers `cores/2` at concurrency 1, per-IP rate
  limit 300 req/min, body limit 10 MB, queue 512 with 30 s timeout,
  worker recycle at 10000 requests / 3600 s.
- The development watch transport is SSE with a CSS-only fast path and a
  single client implementation.
- In scope: framework, static/app serving, watch transport, workers,
  TLS, proxy, CLI, nginx/caddy config generation, and mDNS with the
  `rip.local` dashboard. Out of scope unless the owner adds it: L4
  stream passthrough.

### Browser UI

- Overlays use the native top layer (Popover API and `<dialog>`). There
  is no portal machinery.
- Widgets ship zero CSS. State is exposed through data attributes and
  styled by the consumer.
- The binding contract is `<=>` two-way binding with an `emit('change')`
  mirror and the `isTrusted` self-event guard, uniformly.
- Browser Tailwind is an application-level stylesheet service: explicit
  class lists compile deterministically to CSS inside the existing
  `packages/ui/tailwind` dependency boundary (`tailwindcss`, `css-tree`).
  There is no content scanner and no widget theming.

### Database

- Database access goes through one adapter contract (`query`, `begin`,
  `capabilities`). `introspect` was dropped in #111; the migration
  runner reads the DuckDB catalog directly (owner ruling 2026-07-15).
  Exactly one adapter ships: DuckDB via a `duckdb-harbor` HTTP endpoint.
  The harbor server is external and never vendored.
- Live integration tests run in the extended tier, gated on an available
  harbor endpoint; protocol-level tests run everywhere.
- Migrations are the checksummed engine already in this repository:
  forward-only, destructive/lossy changes behind explicit flags, with a
  migration lock so concurrent `migrate` runs are safe.
- Transaction semantics are documented product guarantees: one session
  per transaction, no savepoints, post-commit hooks cannot roll back.
- Temporal values cross the adapter wire as real JS `Date` objects: the
  adapter decodes from the declared `duckdbType` at the wire, `Date`
  parameters encode to ISO-8601 UTC (`Z`), and an Invalid Date rejects
  loudly (owner ruling 2026-07-15; lands on `fix/db-temporal-boundary`).
- The schema ORM is the one ORM. The lightweight Model/QueryBuilder
  factory for undeclared tables is not ported; raw SQL (`db.rows`) is
  the ad-hoc path (owner ruling 2026-07-15).

### Language

- In render blocks, a bare word matching the HTML boolean-attribute
  list compiles as a true attribute (v3 semantics); every other bare
  word is a child element (owner ruling 2026-07-15; lands on
  `fix/render-bare-boolean-flags`).

### Editor

- Render-DSL editor intelligence returns through typed attribute
  positions in the TS face, so completion and checking are tsgo-native.
  Scheduled with the UI stage (owner ruling 2026-07-15).

## PR queue

Primary chain. Each row is one branch and one squash-merged PR started
from fresh `main`. Detailed scope, tests, and gates are in each PR body.

| # | Branch | Scope | Status |
|---|--------|-------|--------|
| 1 | `app-route-core` | Pure route manifest and matcher: segment grammar (static, `[id]`, `[[id]]`, `[...rest]`, `(group)`), `_layout` chains, precedence, duplicate rejection, params/query, route ids | merged (#80) |
| 2 | `app-router-state` | Router state machine: push/replace/back/forward/match/onNavigate, navigation ownership, injectable history/location/scroll adapters | merged (#84) |
| 3 | `app-renderer-navigation` | Renderer/router integration: layout-chain reuse, query fast path, query-keyed gate remount, gate-failure routing to nearest layout `onError`, stale-navigation cancellation | merged (#85) |
| 4 | `app-mutations-timing` | `createMutation`; `delay`/`debounce`/`throttle`/`hold`; construction and hot-path measurements | merged (#86) |
| 5 | `app-launch` | `launch()` boot path, global install/restore, seed overlay, `persistStash`, loud double-launch/malformed-bundle rejection, teardown | merged (#88) |
| 6 | `app-aria-route` | Route-aware `aria-current` walker; focus/scroll policy contracts | merged (#89) |
| 7 | `validate-core` | `@rip-lang/validate`: vocabulary, frozen registry, structured issues, calendar-true dates, adversarial tests | merged (#82) |
| 8 | `validate-coercers` | Coercer registration into the schema runtime seam; ownership table; duplicate/missing diagnostics; declarations | merged (#83) |
| 9 | `validate-closeout` | Docs, browser-safety metadata, public-surface audit, package CI step, certification | merged (#87) |
| 10 | `browser-entry-core` | Browser entry and deterministic bundle; byte-fresh CI gate; forbidden-import graph gate | merged (#90) |
| 11 | `browser-script-loading` | `<script type="text/rip">`: inline and `data-src`, shared scope, mapped diagnostics, CSP contract | merged (#91) |
| 12 | `browser-package-graph` | Browser-safe package discovery, `_pkg/` ids, bare-specifier rewriting, server-only import rejection | merged (#92) |
| 13 | `browser-app-integration` | App boot through the browser entry; real-browser navigation and gate tests; Playwright boundary | merged (#93) |
| 14 | `server-http-router` | Pure request matcher: methods, patterns, precedence, duplicate rejection | merged (#94) |
| 15 | `server-context-responses` | Request context, body/query/param reading, response helpers, error envelope | merged (#95) |
| 16 | `server-middleware` | Composition, double-send/next protection, filters, core middleware | merged (#96) |
| 17 | `server-validate-openapi` | `read()` validation, `input:` schemas, structured 400s, deterministic OpenAPI | merged (#97) |
| 18 | `server-sessions-security` | Sessions, CSRF, secure headers, proxy trust, request hardening (dedicated security review) | merged (#98) |
| 19 | `server-static-app-serving` | Static files with containment, SPA fallback, bundle endpoints, state injection (security review) | merged (#99) |
| 20 | `server-watch-transport` | SSE watch: revisioned reload, CSS fast path, reconnection, compile-error delivery | merged (#100) |
| 21 | `server-workers-lifecycle` | Worker pool, queue/backpressure, recycle policy, graceful shutdown | merged (#101) |
| 22 | `server-tls` | TLS/SNI and ACME (security review) | merged (#102) |
| 23 | `server-proxy` | Upstream proxy, health checks, retries, circuit breaker | merged (#103) |
| 24 | `server-cli` | `rip server` dispatch, flags/config, control operations | merged (#104) |
| 25 | `server-compat-generators` | nginx and caddy configuration generation | merged (#105) |
| 26 | `server-mdns-dashboard` | mDNS `.local` advertising and the `rip.local` dashboard | merged (#106) |
| — | server serving/bin lane | Runnable serving layer: listener, process workers, proxy execution, file watcher, ACME/dev-CA, config loader, rate/body limits, `rip server` bin. Rows 14–26 merged the decision cores (#94–#106); this lane awaits owner scheduling and a CLI-grammar ruling | pending |
| 27 | `db-adapter-client` | Adapter contract and the harbor adapter; error taxonomy; config | merged (#107) |
| 28 | `db-query-transactions` | Parameterized execution, transactions, cancellation, materialization policy | merged (#108) |
| — | `grammar-implicit-call-logical` | Compiler: trailing `or`/`and`/`\|\|`/`&&`/`??` continue the paren-less call argument (CoffeeScript semantics); lexer-rewriter fix, precedence/mapping pins retargeted | merged (#109) |
| 29 | `db-orm-adapter-integration` | Schema ORM connected to the adapter; live integration tests | merged (#110) |
| 30 | `db-migrations-live` | Migration engine against the live adapter; migration lock; round trips | merged (#111) |
| 31 | `db-surfaces` | Justified CLI/tooling surfaces only (rip-db, embed, mcp) | merged (#112) |
| 32 | `db-certification` | Adapter matrix, concurrency/failure probes, security review, certification | merged (#114) — closes DB stage F1–F6 |
| — | `db-live-integration` | Live harbor-gated integration tier (settled above): extended-tier tests against a real harbor endpoint. Does not exist yet — current integration tests run on fetch doubles | pending |
| — | HMR stage | Its own plan at entry per [../docs/HMR.md](../docs/HMR.md); scheduled here, before UI | pending |
| 33 | `ui-interaction-primitives` | `packages/ui/primitives`: navigation, dismissal, focus, positioning, scroll lock, ARIA wiring; real-browser a11y tests | pending |
| 34 | `ui-basic-controls` | Buttons, form structure, text inputs, checkbox/radio, simple display | pending |
| 35 | `ui-selection-popups` | Select, Combobox, Autocomplete, MultiSelect, ToggleGroup, CheckboxGroup | pending |
| 36 | `ui-overlays` | Dialog, AlertDialog, Drawer, Toast, Tooltip, Popover, PreviewCard | pending |
| 37 | `ui-menus-disclosure` | Menu family, Tabs, Accordion, Collapsible, Toolbar | pending |
| 38 | `ui-data-advanced` | Data display, advanced fields, ScrollArea/Resizable/Carousel, DatePicker, Grid | pending |
| 39 | `ui-browser-tailwind` | Deterministic class-to-stylesheet compile, cache identity, serving integration | pending |
| 40 | `ui-certification` | Public-surface audit, browser matrix, accessibility pass, capability boundary update | pending |

Ordering: 1→6 and 7→9 are parallel lanes (separate worktrees, one writer
each). 10 requires 5. 14–17 require 9; 19 requires 10 and 12. The remaining
stages run in series: Server (14–26), then the database stage (27–32,
requires 21), then HMR (its own plan, once App/Browser/Server module
ownership is stable), then the libraries lane (http, time, csv, …; each
its own plan), then the UI stage LAST (33–40, requires 13 and 19 for
serving-dependent tests).

## Later stages

- **Libraries** (each its own plan at entry): http, time, csv, rsx (XML),
  x12, decimal; then swarm/script/print if justified. `ai`, `gate`, and
  `stamp` require an owner-approved public contract and a dedicated
  security review before implementation. `utils/curl` is not ported.
  Scheduled after HMR and before the UI stage. Each is kept small — one
  or a few clean `*.rip` files for the functionality, not a sprawling
  module tree.
- **CLI/type/editor**: headless checking (one checker shared with the
  LSP), REPL, package subcommand dispatch, the pinned type/editor
  contracts, and the language candidates — each candidate is presented
  for owner acceptance before any implementation.
- **HMR**: proceeds by the phases and acceptance contract in
  [../docs/HMR.md](../docs/HMR.md) once App, Browser, and Server module
  ownership is stable. Scheduled after the database stage, before the
  libraries lane and UI (rows 33–40). Open HMR decisions return to the
  owner at stage entry.

## Owner notification

After each significant commit (feature, fix, review remediation,
certification):

```sh
imessage +15027588802 "Rip <unit> committed: <result, short hash, tests, PR status>"
```

Bookkeeping commits do not notify. A final campaign message is sent when
the sequence is certified.
