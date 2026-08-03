# HANDOFF — session launch document (2026-08-03)

The tracked session launch document (see AGENTS.md, working ledgers): read it
first when starting a session; rewrite it at session boundaries with
live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.
- Permanent server architecture: `docs/SERVER.md`.

## Active branch

**Branch: `main`, synchronized with `origin/main`.**

The current tip makes maybe dammit a first-class language construct. Bare
`fn?!` remains Houdini/presence; `fn?!()`, `fn?!(arg)`, and `fn?! arg` are
optional calls whose results are awaited. The compiler records a mapped
`dammit?` node, and the TextMate, highlight.js, Rip Print, and Vim surfaces
recognize the shared spelling.

Live verification for that commit:

- `bun run test:all` — all 21 lanes passed, 8,334 tests total.
- `packages/browser-tests` remains the documented CI-only Playwright lane.
- `git diff --check` — passed.
- Commit pushed to `origin/main`.

## Next server-appliance work

The proposed macOS Rip menu-bar product is not implemented. The recommended
next boundary is a persistent per-user Rip Agent, supervised by launchd, which
owns the shared Caddy + Janus edge and remembered Rip app manager processes.
Both a future `rip edge` / `rip app` CLI and the menu-bar UI should use one
private local control protocol rather than implementing process supervision
twice. A purpose-built baseline Caddyfile is also needed; Janus's repository
root Caddyfile is a development and acceptance fixture and must not ship as the
machine default.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
