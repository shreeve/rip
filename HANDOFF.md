# HANDOFF — session launch document (2026-08-05)

The tracked session launch document (see AGENTS.md, working ledgers): read it
first when starting a session; rewrite it at session boundaries with
live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.
- Permanent Server architecture: `docs/SERVER.md`.
- Browser publication consumer contract: `docs/WORKSPACE.md`.
- Detailed implementation lifecycle: `packages/server/README.md`.

## Active branch

**Branch: `rip-app-preparation`, tracking
`origin/rip-app-preparation`.**

The branch tip contains the embedded `@rip-lang/app` browser runtime and the
macOS inherited-port edge work. The worktree contains the uncommitted complete
Server/Manager/browser publication implementation described below.

## Publication implementation

- Browser-program construction is pure Rip in `packages/server/bundle.rip`.
  Server owns package traversal, browser-safety validation, shared schema
  projection, and canonical source-list construction.
- `bundle.json` is exactly `{ hash, list }`. The sorted list contains
  `[modulePath, source]` for the complete browser Rip program. There is no
  `manifest.json`, public per-file hash inventory, resolver table, or embedded
  `@rip-lang/app` source.
- Manager privately hashes managed App files, suppresses idempotent watcher
  events, calculates one complete App hash, and atomically publishes
  `bundle.json`, exact `bundle.json.br`, and `latest.json {hash}`.
- One effective watch batch sends one ordered
  `change {from,hash,list}`. Rip source rides as `[path,source]`, ordinary
  changed assets ride as `[path]`, and deletions ride as `[path,null]`.
- Watch and non-watch modes share the same initial publication. Non-watch mode
  creates no App watcher and no publication feed.
- Browser boot validates the two-key bundle, trusts the Manager-declared hash,
  compiles and atomically activates the complete Rip program, and leaves CSS,
  HTML, images, fonts, and other assets to normal HTTP caching.
- Workspace holds active Rip source, compiled modules, and one complete hash.
  It applies only a connected `from` to `hash` transition; malformed input,
  a sequence gap, or failed activation reloads instead of guessing.
- Reconnect subscribes to `/hub` before fetching `latest.json`. A matching
  hash continues; a mismatch reloads and obtains a complete bundle.
- CSS changes refresh the linked stylesheet over HTTP, Rip changes compile and
  update, and HTML or another managed ordinary asset reloads.
- Hello, Pulse, Cart, and the browser certification fixture all use this one
  protocol. There is no compatibility wire format.

## Verification

- `bun run test:all` — 22 lanes, 8,323 tests passed in 82.6s.
- `packages/server` within that gate — 96 passed.
- `packages/app` within that gate — 311 passed.
- `bun run test` fast tier — 6,133 passed, 38 intentionally skipped.
- `bunx playwright test --reporter=line` in `packages/browser-tests` —
  21 passed, 2 skipped across Chromium, Firefox, WebKit, and the real
  Server/Manager Cart harness.
- Direct publication assembly — Hello 1 Rip module, Pulse 3, Cart 13.
- `git diff --check` — passed.

## Remaining edge and landing work

1. Released Janus v1.5 does not select precompressed sidecars in its custom
   registered-file path. Manager produces `bundle.json.br`, but transparent
   Brotli delivery requires Janus behavior equivalent to Caddy
   `file_server { precompressed }`.
2. Complete the remaining open items in `packages/server/TODO.md`, including
   the Janus repository gates and independent/cold verification required for a
   substantial merge.
3. Review the complete worktree scope, commit intentionally, push, and open or
   update the branch PR when requested.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- PRs land as true merge commits only. No AI attribution.
