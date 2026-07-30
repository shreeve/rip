# HANDOFF — session launch document (2026-07-30)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- `AGENTS.md` doctrine includes Workspace vocabulary (bag = membership).
- Commands: `bun run test:all` · `bun run test` · `bun run browser-bundle`.

## Active branch

**Branch: `bag-default-membership`** (from `main` / `bb28e8e`).

Default client bag = `app/**/*.{rip,css,html}`: watch, sync, ding
`{id,etag}`; client reacts by extension. Main entry
(`app.rip` / `index.rip` at project root) → epoch. HTML → document
reload; CSS → soft-apply (S12); Rip → remount floor.

## On main

- PR #194 — Probe 1 etag door + narrow remount + cart harness
- PR #195 — door leftovers cell → file
- PR #196 — CSS soft-apply (S12)

## Door doctrine (trivial)

1. Bag = membership (default globs above; lists/globs later).
2. Serve the bag; watch the bag; ding on change.
3. Client: care or ignore; reaction from extension — not from the hub.

## Working agreements

- **Land** = merge green + delete the feature branch.
- PRs: TRUE MERGE only. No AI attribution in commits.
