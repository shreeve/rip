# HANDOFF — session launch document (2026-08-05)

Read this working ledger first when starting a session. Permanent architecture
lives in `docs/`; git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Fast commands: `bun run test:rip` · package-local `bun run test` ·
  `packages/browser-tests: bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests: bun run test:cart`.
- Server architecture: `docs/SERVER.md`.
- Browser publication contract: `docs/WORKSPACE.md`.
- Detailed lifecycle: `packages/sites/README.md`.
- Testing cleanup plan: `TEST-DIET.md`.

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
- Rip App validates and compiles the complete Rip graph, keeps one persistent
  module loader, stages Workspace and renderer state transactionally, and
  leaves HTTP bytes in the browser cache.
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

The immutable publication implementation checkpoint is `147f37c`.

- `bun run test:all` — 22 lanes, 8,357 tests passed in 96.3 seconds.
- `bunx playwright test --reporter=line` in `packages/browser-tests` — 21
  passed, 2 intentionally skipped across Chromium, Firefox, WebKit, and the
  live Cart Server/Manager harness.
- Independent empirical verification — GO.
- Genuinely cold adversarial review — GO after its findings were fixed and
  pinned.
- A path-limited comparison from `147f37c` through the test-policy merge and
  harness reverts is empty for Server, App, compiler/runtime, browser bundle,
  examples, and permanent docs: the verified production implementation has
  not changed.

PR #210 true-merged the testing policy as `769bc2a`:

- automatic PR code check: sub-second `bun run test:rip`;
- automatic browser check: deterministic `bun run test:smoke`;
- manual repository certification: `repository-certification` workflow;
- manual live Cart certification: `cart-certification` workflow;
- package suites run at coherent layer milestones, not after every edit.

`rip-sites-publication` merged that mainline at `bd8f407`. The two isolated,
unsuccessful browser-harness experiments were removed by normal revert commits:

- `e603ea2 Revert "Make Cart readiness nonblocking"`;
- `e188acf Revert "Stabilize Cart harness readiness"`.

Those experiments never modified Rip Sites or Rip App production code.

Arbitrary top-level ESM side effects execute while a candidate module graph is
evaluated and cannot be rolled back. Workspace, renderer, source, route
manifest, and DOM state remain transactional; code that performs external
top-level effects owns that consequence.

## Session state

PR #209 is open. The branch has merged current `origin/main`, preserves the
verified publication implementation, and deliberately excludes the Cart
harness experiments. Push the current tip, accept only the lightweight
language-battery and browser-smoke PR checks, then true-merge #209 and delete
the feature branch.

Do not run exhaustive repository or Cart certification unless the owner
explicitly requests it.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.
