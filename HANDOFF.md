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

**Branch: `marquee-live-apply`** (ahead of `main` / `b51d597`):

| Commit | What |
|---|---|
| `691f6a4` | Q8′ door finished: ding/manifest/passport are `{id,etag}`; feed has no rev cursor; docs/READMEs scrubbed |
| `df4a781` | Probe 1 apply floor: `packages/app/apply.rip` + `renderer.remountDirty` — narrow remount keeps stash + ancestor layouts; stash edits → labeled whole-launch escape |
| `2221950` | Juxta optional call: `f? x` ≡ `f?(x)` → `f?.(x)`; feed/renderer prefer juxta |
| tip | Handoff: Probe 1 next steps, Workspace vocabulary |

**Not pushed.** Open a PR from this branch when Probe 1 harness + pins
are ready (or earlier if the owner wants the door cut alone).

Verified green on this tip: `bun run test:all`, `packages/app` (bun +
workspace + apply), `packages/server` (etag suite), browser-boot pins.
Browser bundle regenerated with the juxta change.

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

## Next session — finish Probe 1 → climb toward marquee

Priority order:

1. **Playwright cart harness** — second webServer (or project) that
   boots `examples/cart` under watching `rip server`; disk-edit probes
   for S1/S2/S3/S8/S10; copy assertion style from
   `packages/browser-tests/tests/workspace.spec.mjs` (sentinel, no
   reload, ding shape). Do **not** fake cart inside `serve.mjs`.
2. **Feel pins** — leaf S1/S2 visible update budget; layout never
   flashes; `@app.data.cart` survives leaf apply.
3. **Signatures + true patch** (Phase C) — emitter-owned component
   signatures; patch markup/methods when signature-stable; migrate
   named state (S4). Marquee claim blocked until S3 leaves the Vue
   floor and S1–S15 are green on cart.
4. **Idiomatic Rip only** in new `.rip` — dammit `f! x`, not
   `await f(x)` when dammit fits; no needless braces/parens; optional
   call: `fn? x` ≡ `fn?(x)` (see AGENTS Style). Mirror nearby
   `packages/app/*.rip`.
5. **Do not market remount as HMR done.** No README hero until the
   suite earns it.

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
