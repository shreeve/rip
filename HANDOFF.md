# HANDOFF — session launch document (2026-08-04)

The tracked session launch document (see AGENTS.md, working ledgers): read it
first when starting a session; rewrite it at session boundaries with
live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.
- Permanent server architecture and current App publication protocol:
  `docs/SERVER.md`.
- Next App publication wire contract and implementation sequence:
  `packages/server/README.md`, under Detailed Lifecycle.

## Active branch

**Branch: `rip-app-preparation`, tracking
`origin/rip-app-preparation`.**

The branch carries three scoped feature commits above `1eaeb3c`:

- `7b750c5` embeds the complete compiled `@rip-lang/app` package in
  `dist/browser/rip.js`. App bundles no longer repeat the framework source;
  authored modules resolve App imports through the stable browser runtime.
- `eb97263` gives the packaged macOS edge a per-user, launchd-owned
  `127.0.0.1:443` TCP socket. The launcher passes it to ordinary user-owned
  Caddy as `fd/3`; stop, restart, reload, listener release, and the Hello App
  were live-verified. The inherited stream serves HTTP/1.1 and HTTP/2 because
  HTTP/3 requires a separately inherited UDP socket for QUIC.
- `f613865` specifies the next `bundle.json`, `latest.json`, and `from → hash`
  change lifecycle, its two implementation phases, and their acceptance
  tests. That lifecycle is a specification: the current server and Rip App
  still implement the manifest-and-ding protocol documented in
  `docs/SERVER.md`.

The generated browser artifact is unminified `dist/browser/rip.js`; no
`rip.min.js.br` or `rip.js.br` file is generated. The current artifact is
1,508,152 bytes and measured 193,473 bytes through Brotli. The combined
browser-runtime change is 21,915 Brotli bytes over the branch base artifact.

## Verification

- `bun run test:all` — all 22 lanes passed, 8,387 tests total in 73.1s.
- Root extended suite — 6,519 passed.
- `packages/vscode` — 169 passed.
- `packages/server` — 93 passed, including real published Janus integration
  and the launchd edge pin.
- Focused browser bundle, module-loader, and boot suites — 57 passed, one
  extended freshness test skipped locally and covered by `test:all`.
- `packages/browser-tests` remains the documented CI-only Playwright lane.
- `git diff --check` — passed.

## Next work

Review the three feature commits and begin Phase 1 of the Detailed Lifecycle
with the Server/Manager protocol reference client. Phase 1 proves publication,
change ordering, reconnect recovery, and failure handling independently of Rip
App. Phase 2 then moves Rip App and browser boot to the proven protocol. The
feature branch may be temporarily incomplete between phases; it does not carry
a dual wire format or land until both phases pass.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
