# HANDOFF — session launch document (2026-07-30, ~07:00 UTC-6)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Facts below were verified
live on this branch against package suites and browser-boot pins.

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

## Active branch (not on main yet)

**Branch: `marquee-live-apply`** — Probe 1 PR cut (landing).

Includes: Q8′ etag door; narrow remount apply floor; juxta `f? x`;
cart Playwright harness (real `rip server` + stub Janus); package store
paths `@rip-lang/<name>/…` (no `_pkg`); cart type-only import fix.

Verified: `packages/browser-tests` Playwright 19 pass / 2 skip;
browser-modules + browser-boot + server package suites green on the
harness/store-path tip.

## Door wire (Q8′ — sealed)

| Surface | Shape |
|---|---|
| Hub ding | `{ id, etag }` (+ optional `kind: 'delete' \| 'epoch'`) — no bodies, **no `rev`** |
| Manifest | `{ files: [{ id, etag }, …] }` |
| HTTP | `GET /app/mood.rip?etag=E` → 200 + body + `ETag`, or 409 + current |
| Passport | `{ id, path, etag, source, compiled? }` — etag equality |
| Bag unit | **module** (path-keyed). Not “cell.” “File” = OS path only. |
| Env leftover | `runDir/cells` / `RIP_CELLS_DIR` — rename later; not the product noun |

Constitution: [`docs/WORKSPACE.md`](docs/WORKSPACE.md) Q2 / Q8′ / D2.
HMR Layer A **is** this door ([`docs/HMR.md`](docs/HMR.md)).

## Apply today (Probe 1 floor — not marquee yet)

- [`packages/app/apply.rip`](packages/app/apply.rip) — `createApply`;
  discardable under Q10.
- [`packages/app/renderer.rip`](packages/app/renderer.rip) —
  `remountDirty(paths)` → `'narrow' \| 'noop' \| 'escape'`.
- Wired from [`src/browser-boot.js`](src/browser-boot.js) after the
  compile barrier / `setCompiled`.
- Applied-log:
  - narrow: `applied … — narrow remount (route state reset; stash kept)`
  - escape: `applied … — remounted (component state reset)`
- **Stash escape must be decided before the live-route guard** — after
  a failed whole-launch escape, `lastRoute` may be null; stash edits
  must still return `'escape'` so the next good generation recovers
  (pinned in browser-boot).

This is the **Vue remount floor** for route/layout modules — not S1
markup patch, not named-state migrate, not signatures.

## Exemplars

- **Cart** ([`examples/cart/`](examples/cart/)) — marquee certification
  host for the S-suite. Needs real `rip server` (watch), not the
  synthetic `packages/browser-tests/serve.mjs` door fake.
- **Pulse** ([`examples/pulse/`](examples/pulse/)) — thin door canary.

## Probe 1 harness (in this PR)

- [`packages/browser-tests/cart-harness.mjs`](packages/browser-tests/cart-harness.mjs)
  — real `rip server` on a /tmp cart copy + stub Janus; HTTP proxy +
  hub ding fanout (no bodies). Not `serve.mjs`.
- [`tests/cart-apply.spec.mjs`](packages/browser-tests/tests/cart-apply.spec.mjs)
  — leaf markup no-reload + layout sentinel; stash `Cart (1)` survives;
  compile-fail keeps LKG (S10). Project `cart-chromium`.

## After this PR lands

1. Rename door leftovers `cell*` → `file*` (`RIP_CELLS_DIR`, etc.).
2. CSS soft path: watch `app/**/*.css`, ding `{id,etag}`, swap
   `<style data-rip-css>` — no JS remount (S12).
3. Signatures + true patch / migrate; feel budget; S1–S15 on cart.
4. **Do not market remount as HMR done** until the suite earns it.

Plan notes (Cursor): `exceptional_rip_hmr_*.plan.md` — Phase 0 done on
this branch; marquee apply continues here.

## Working agreements

- PRs: TRUE MERGE only (AGENTS rule 9). Subject:
  `PR #N — <title>` via `gh pr merge N --merge --subject "…"`.
- HANDOFF rewritten at session boundaries with live-verified facts.
- Shared branches: MERGE, never rebase; never force-push.
- Red pin before fix; cold review before big merges (rule 10).
- No AI attribution in commits.
- Nothing pushed without owner approval.

## Do not trust (stale mental models)

- Ding `{ id, rev, … }` or per-rev cell museum URLs
- Bag noun “cell” / HMR “definition cell”
- Whole-launch remount as “HMR done”
- A separate `packages/refresh` package
- Extending `serve.mjs` to fake the cart app
- `HANDOFF.md` from before `marquee-live-apply` (museum-era)
