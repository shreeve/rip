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

**Branch: `css-soft-apply`** (from `main` / `83312e8` after PR #195).

S12 CSS soft path: watch `app/**/*.css` on the door; ding `{id,etag}`
(no `kind:style`); soft-apply via `<style data-rip-css>`; never remount
JS; CSS stays out of `assembleBundle`.

Verified: `packages/server` (176), `packages/app` (workspace + apply),
browser-boot, cart Playwright including S12 soft-apply pin.

## On main (already landed)

- PR #194 — Probe 1 etag door + narrow remount + cart harness
- PR #195 — door leftovers cell → file (`RIP_FILES_DIR`, etc.)

## Door wire (Q8′ + S12)

| Surface | Shape |
|---|---|
| Hub ding | `{ id, etag }` (+ optional `kind: 'delete' \| 'epoch'`) |
| Manifest | `{ files: [{ id, etag }, …] }` — `.rip` and `.css` |
| HTTP | `GET /app/…?etag=E` → 200 / 409 |
| Bundle | **`.rip` only** — CSS never compiles |
| Soft-apply | `<style data-rip-css="<id>">` textContent swap; disable matching `<link>` |
| Bag unit | **module** / **passport**; CSS is a passport with source text |

## Next after this branch lands

1. Signatures + true patch / migrate; feel budget; S1–S15 on cart.
2. **Do not market remount as HMR done** until the suite earns it.

## Working agreements

- PRs: TRUE MERGE only (AGENTS rule 9).
- **Land** = merge green + delete the feature branch (local + origin).
- HANDOFF rewritten at session boundaries with live-verified facts.
- No AI attribution in commits.

## Do not trust (stale mental models)

- `RIP_CELLS_DIR` / bag noun “cell”
- `kind: 'style'` on the ding (extension branches apply)
- CSS in `assembleBundle` / JS remount for style-only saves
- Whole-launch remount as “HMR done”
