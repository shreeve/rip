# HANDOFF — session launch document (2026-08-05)

Read this working ledger first when starting a session. Permanent architecture
lives in `docs/`; git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.
- Server architecture: `docs/SERVER.md`.
- Browser publication contract: `docs/WORKSPACE.md`.
- Detailed lifecycle: `packages/server/README.md`.

## App publication contract

- Rip Manager publishes `bundle.json` as exactly `{ hash, list }`. The sorted
  list contains the complete browser Rip program as `[modulePath, source]`.
  There is no `manifest.json`, public per-file hash inventory, resolver table,
  or duplicated `@rip-lang/app` source.
- `bundle.json.br` is the exact Brotli representation of `bundle.json`.
  `latest.json` contains only the complete App hash used for reconnect checks.
- Manager privately hashes managed App files, rejects idempotent watcher
  events, watches package and schema-projection inputs, atomically publishes
  complete state, and sends one ordered `change {from,hash,list}` per effective
  batch.
- Changed Rip source rides through the watch feed. CSS and every other ordinary
  asset remain normal HTTP resources; changes carry only their paths. Non-watch
  mode publishes the same initial files without watchers or change messages.
- Rip App owns browser delivery. It validates and compiles the complete Rip
  graph, keeps one persistent module loader, stages Workspace and renderer
  state transactionally, and leaves HTTP bytes in the browser cache.
- A malformed or disconnected transition reloads. A failed Rip candidate is
  quarantined while the last committed App stays live; the next newer
  generation reloads a complete bundle. A valid transition that requires
  whole-App reconstruction reloads without being quarantined.
- Reconnect joins `/hub`, receives the Janus acknowledgement, then requests
  `latest.json`. Only one exact outstanding server acknowledgement starts the
  probe; client-originated Hub frames cannot acknowledge or inject publication
  changes. `latest.json` is exactly `{ hash }`.
- Browser publication modules use static imports and canonical Rip paths.
  Missing targets, cycles, dynamic imports, hidden segments, and file-shaped
  directory segments reject before Manager commits a publication. App,
  package, and schema-projection source reject malformed UTF-8.

## Verification state

- `bun run test:all` — 22 lanes, 8,357 tests passed in 96.3 seconds.
- `bunx playwright test --reporter=line` in `packages/browser-tests` — 21
  passed, 2 intentionally skipped across Chromium, Firefox, WebKit, and the
  live Cart Server/Manager harness.
- `git diff --check` — passed.
- Independent verification and genuinely cold adversarial review — GO after
  empirical race, security, invalidation, watcher, encoding, and transaction
  probes were converted into tests.

The pushed feature tip entering this handoff is `eaa93fe` on
`rip-app-publication`. Its final two commits are isolated browser-harness work:

- `f820b8f Stabilize Cart harness readiness` changes only `HANDOFF.md` and
  `packages/browser-tests/`.
- `eaa93fe Make Cart readiness nonblocking` changes only
  `packages/browser-tests/cart-harness.mjs`.

PR #209 is open and must not be merged until its Cart browser decision is made.
GitHub Actions run `30998804952`, browser job `92282290483`, reached the tests
but failed all five `cart-chromium` cases at initial boot: `h1` never appeared
with text `Products` within 20 seconds, and each retry failed the same way. The
job finished with 5 failed, 19 passed, and 2 skipped. The run's main test job
passed in 4m41s and its audit job passed in 37s.

A subsequent local Playwright attempt never reached a test. The managed sandbox
rejected local TCP binds while `lsof` and the process table showed no listener;
even a direct Bun bind to unused port 4175 reported `EADDRINUSE`. Treat that as
a sandbox finding, not a repository failure. The outside-sandbox retry was
aborted without a result. No Cart opt-in change remains in the worktree.

Arbitrary top-level ESM side effects execute while a candidate module graph is
evaluated and cannot be rolled back. Workspace, renderer, source, route
manifest, and DOM state remain transactional; code that performs external
top-level effects owns that consequence.

## Session state

Landing is deliberately stopped. Do not rerun tests, modify the Cart selection,
rewrite or revert the two pushed harness commits, or merge PR #209 without new
direction. The publication implementation and its reviews remain intact;
precompressed-sidecar selection is Janus-owned behavior and is not implemented
by the Rip repository.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.
