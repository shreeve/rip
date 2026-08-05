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
  `latest.json`. Client-originated Hub frames cannot inject publication changes.
- Browser publication modules use static imports and canonical Rip paths.
  Missing targets, cycles, dynamic imports, hidden segments, and file-shaped
  directory segments reject before Manager commits a publication.

## Verified landing candidate

- `bun run test:all` — 22 lanes, 8,353 tests passed in 73.7 seconds.
- `bunx playwright test --reporter=line` in `packages/browser-tests` — 21
  passed, 2 intentionally skipped across Chromium, Firefox, WebKit, and the
  live Cart Server/Manager harness.
- `git diff --check` — passed.
- Adversarial publication review — GO after empirical race, security,
  invalidation, watcher, and transaction probes were converted into tests.

Arbitrary top-level ESM side effects execute while a candidate module graph is
evaluated and cannot be rolled back. Workspace, renderer, source, route
manifest, and DOM state remain transactional; code that performs external
top-level effects owns that consequence.

## Session state

No publication implementation work remains in this delivery. Check the active
branch and worktree before beginning new work. Precompressed-sidecar selection
is Janus-owned behavior and is not implemented by the Rip repository.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.
