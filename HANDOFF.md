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

The current tip makes authored Rip consistently use its own call and
construction vocabulary. Packages, package tests, examples, and the parser
generator use dammit for awaited calls, `.new` for construction, and `.new!`
for awaited construction. Written `await` remains only for promise values
already in hand. A syntax-aware toolchain gate enforces those boundaries while
the language fixtures continue to exercise every accepted spelling.

Live verification for that commit:

- `bun run test` — 6,122 passed, 35 extended-tier skips.
- `bun run test:all` — all 21 lanes passed, 8,334 tests total.
- `bun run parser` — regenerated `src/parser.js` byte-identically.
- Emission comparison — 78 of 84 changed Rip files byte-identical; the other
  six differ only by redundant parentheses around member-qualified constructor
  targets.
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
