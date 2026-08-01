# HANDOFF — session launch document (2026-07-31)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run browser-bundle`.

## Active branch

**Branch: `server-app-api-architecture`** (`60aaae6` before the current
working tree).

The Rip Server architecture implementation is present in the working tree:

- compile-only generation validates candidates before API admission cuts;
- canonical local manager control provides status, hold, release, migrate,
  and recover;
- Active, Held, and Maintenance fence API/App activation and durable
  migration recovery;
- generated coordination files and authored App files register atomically
  with Janus, including App-only projects and direct Hub admission;
- pooled workers are API-only;
- App delivery is latest-wins with six-character `rash(bytes)` identities,
  `{id,hash}` update dings, generation-fenced delete dings, and epoch reload
  dings.

Live verification on this working tree:

- `bun run test:all` — passed (21 lanes).
- `bun run test` in `packages/server` — passed.
- `bun run test` in `packages/app` — passed.
- `bunx playwright test` in `packages/browser-tests` — passed.
- `./test.sh` in `~/Data/Code/janus` — 159 passed.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
