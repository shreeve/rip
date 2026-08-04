# HANDOFF — session launch document (2026-08-03)

The tracked session launch document (see AGENTS.md, working ledgers): read it
first when starting a session; rewrite it at session boundaries with
live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.
- Permanent server architecture and App publication protocol:
  `docs/SERVER.md`.

## Active branch

**Branch: `main`, synchronized with `origin/main`.**

Tip `129c35b0` carries the coherent Rip App publication protocol:

- The default authored bag is `app/**/*.{rip,css,html}` with dot-prefixed
  files and directories excluded. Ids are paths relative to `app/` and map to
  ordinary root URLs.
- `rash(bytes)` identifies exact authored file bytes. `check(files)` hashes the
  deterministic sorted `[id, hash]` inventory and is the complete authored-bag
  identity. Bundle and manifest now carry `check`, not an aggregate `rash`.
- `bundle.json` is the self-contained first-paint package. It carries the
  complete authored inventory plus Rip source, browser packages, resolution
  metadata, schema projections, and seed data. The browser validates inventory
  shape/order, recomputes the check, verifies authored Rip source hashes, and
  populates the Workspace without fetching the manifest.
- CSS and HTML populate as identity-only passports. The shell and stylesheet
  links own first-paint delivery; a later advancing fetch supplies source and
  applies `css` or `reload`.
- `manifest.json` is watch-only and bodyless. It is fetched after the Hub opens,
  on reconnect, after misses, and while unresolved wants remain. A matching
  check skips detailed reconciliation; malformed entries or a mismatched check
  reject before mutation. Manifest comparison stays additive and never infers
  deletion from one omission.
- Publication remains bundle → manifest → dings from one in-memory snapshot.
  Invalid UTF-8 Rip source and all bundle assembly/validation failures preserve
  the last good generation. Starting with watch disabled removes a stale
  generated manifest and opens no development feed.
- `dist/` is the manager-owned App publication root. It carries `@rip/rip.js`,
  `bundle.json`, the watch-only `manifest.json`, and a generated shell when the
  App does not author one. Janus mounts `dist/` at the URL root, and the API
  watcher excludes it. Every runnable example ignores its runtime `dist/`
  tree; Hello, Cart, and Pulse have each been live-verified against that path.
- `serve.rip` may select `app.root` and classify App membership through
  `app.manifest.update`, `.css`, and `.reload` globs. The defaults are
  `app/` plus `**/*.rip`, `**/*.css`, and `**/*.html`; omitted categories keep
  their defaults and `[]` disables one explicitly. The recursive watcher
  observes the complete configured root but filters nonmatching asset-file
  events before publication work. Matching file events contribute exact ids to
  a debounced dirty set and only those members are reread and rehashed;
  directory and pathless events request a complete reconciliation.
- Dings remain identity-only hints. Latest fetched bytes win, owner tokens
  fence stale requests, delete hashes fence newer passports, compilation
  precedes Rip passport commit, and the apply vocabulary remains
  `update | css | reload | ignore`.
- Janus still owns current-byte delivery, HTTP ETags, and Hub transport without
  calculating or interpreting Rip hashes or checks. App and API lifecycles stay
  independent.
- `docs/SERVER.md` now contains the complete end-to-end publication model;
  `docs/WORKSPACE.md` and `docs/HMR.md` carry only their matching constitutional
  and apply-specific statements.

## Verification

- `bun run test:all` — all 22 lanes passed, 8,369 tests total.
- Root fast suite — 6,131 passed, 35 extended-tier skips.
- `packages/app` — package, Workspace/feed, and apply suites passed.
- `packages/server` — all 92 package tests passed, including real published
  Janus integration and the exact-dirty-path watcher pin.
- Browser bundle regeneration under Bun 1.3.14 is byte-identical to the
  committed artifact.
- `packages/browser-tests` remains the documented CI-only Playwright lane.
- `git diff --check` — passed.

## Next work

The App publication redesign is implemented and documented. State-preserving
framework refresh remains the separate research/apply track described in
`docs/HMR.md`; the shipped apply engine still uses its honestly labeled remount
escape.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
