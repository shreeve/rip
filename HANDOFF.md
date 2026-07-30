# HANDOFF — session launch document (2026-07-30)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout. `~/Data/Code/rip-v4`
  is DEAD; do not work there.
- v3 oracle: `~/Data/Code/rip-lang` — read-only, never edit.
- Janus: `~/Data/Code/janus` — edge; `./bin/caddy run --config Caddyfile`
  for the dev hub.
- `AGENTS.md` is doctrine — including **Style → idiomatic Rip** and
  **Workspace vocabulary**. Read those before writing `.rip`.
- Commands: `bun run test:all` (canonical) · `bun run test` (fast) ·
  `bun run test:rip` · `bun run audit` · `bun run parser` ·
  `bun run corpus-expected` · `bun run browser-bundle`.

## Active branch

**Branch: `door-file-rename`** (from `main` / `8cc10cc` after PR #194).

Door leftover rename: `cell*` → `file*` on the Workspace door store
and APIs only. Reactive `SourceCell` / `cellFor` / FRAME prose
untouched.

Verified green: `packages/server` (175), `packages/app` (workspace +
apply + bun suite), `test/toolchain/browser-boot.test.js`. Browser
bundle regenerated.

| Old | New |
|---|---|
| `RIP_CELLS_DIR` | `RIP_FILES_DIR` |
| `runDir/cells` | `runDir/files` |
| `state.cells` / `cellsDir` | `state.files` / `filesDir` |
| `syncCells` / `onCellChange` | `syncFiles` / `onFileChange` |
| `revertCellsAndManifest` | `revertFilesAndManifest` |
| `opts.cellUrl` / `manifest.cells` | removed (wire is `files` only) |

## On main (already landed)

PR #194 — Probe 1: etag door, narrow remount apply, cart harness
(`8cc10cc`).

## Door wire (Q8′ — sealed)

| Surface | Shape |
|---|---|
| Hub ding | `{ id, etag }` (+ optional `kind: 'delete' \| 'epoch'`) |
| Manifest | `{ files: [{ id, etag }, …] }` |
| HTTP | `GET /app/mood.rip?etag=E` → 200 + body + `ETag`, or 409 |
| Passport | `{ id, path, etag, source, compiled? }` |
| Bag unit | **module** (path-keyed) |
| On-disk store | `runDir/files` via `RIP_FILES_DIR` |

## Next after this branch lands

1. CSS soft path: watch `app/**/*.css`, ding `{id,etag}`, swap
   `<style data-rip-css>` — no JS remount (S12).
2. Signatures + true patch / migrate; feel budget; S1–S15 on cart.
3. **Do not market remount as HMR done** until the suite earns it.

## Working agreements

- PRs: TRUE MERGE only (AGENTS rule 9). Subject:
  `PR #N — <title>` via `gh pr merge N --merge --subject "…"`.
- **Land** = merge green + delete the feature branch (local + origin).
- HANDOFF rewritten at session boundaries with live-verified facts.
- Shared branches: MERGE, never rebase; never force-push.
- No AI attribution in commits.

## Do not trust (stale mental models)

- `RIP_CELLS_DIR` / `runDir/cells` / `onCellChange` / bag noun “cell”
- Ding `{ id, rev, … }` or per-rev museum URLs
- Whole-launch remount as “HMR done”
- A separate `packages/refresh` package
- Extending `serve.mjs` to fake the cart app
