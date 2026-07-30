# HANDOFF — session launch document (2026-07-30)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-30 against git and package suites, except
where an older verification date is stated explicitly.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout. The workspace root
  `~/Data/Code/rip-v4` is DEAD; do not work there.
- v3 oracle: `~/Data/Code/rip-lang` — read-only reference, never edit.
- Janus: `~/Data/Code/janus` — the Caddy-module edge server, its own
  repo. `./bin/caddy` there is a working Janus binary;
  `./bin/caddy run --config Caddyfile` starts the dev edge.
- `AGENTS.md` is doctrine. Commands: `bun run test:all` (canonical) ·
  `bun run test` (fast) · `bun run test:rip` · `bun run audit` ·
  `bun run parser` · `bun run corpus-expected` ·
  `bun run browser-bundle`.

## Door wire (Q8′ — current truth)

Do **not** relearn the old `#188` `(id, rev, h)` cell museum. That
model is gone.

| Surface | Shape |
|---|---|
| Hub ding | `{ id, etag }` (+ optional `kind: 'delete' \| 'epoch'`) — **never bodies**, **no `rev`** |
| Manifest | `{ files: [{ id, etag }, …] }` |
| HTTP | `GET /app/mood.rip?etag=E` → `200` + body + `ETag`, or `409` + current `ETag` |
| Passport | `{ id, path, etag, source, compiled? }` — freshness is etag equality |
| Bag unit noun | **file** (path-keyed). Not “cell.” |
| Apply today | Whole-launch **remount escape** (labeled). Not marquee HMR. |

Env leftover (not a product noun): on-disk pool may still live under
`runDir/cells` / `RIP_CELLS_DIR` — rename is a follow-up; docs and wire
say **files**.

Constitution: [`docs/WORKSPACE.md`](docs/WORKSPACE.md) Q2 / Q8′ / D2.
HMR Layer A **is** this door ([`docs/HMR.md`](docs/HMR.md)).

## State of main

`main` matches `origin/main` at handoff start was `b51d597` (PR #193
v3 app seams). Phase 0 Q8′ wire cleanup (etag-only ding/manifest/feed/
passport) is the active door work in this session — verify with
`packages/app`, `packages/server`, `test/toolchain/browser-boot.test.js`
before claiming green.

### Exemplars

- **Cart** ([`examples/cart/`](examples/cart/)) — full-shape multi-route
  shop; marquee certification host for apply (S-suite).
- **Pulse** ([`examples/pulse/`](examples/pulse/)) — thin door canary.

### Open product work (priority)

1. **Finish Phase 0 verification** if any suite still red after the
   etag cut; scrub residual “cell”/“rev” nouns in READMEs.
2. **Marquee apply (M2)** — discardable `packages/app/apply.rip` against
   S1–S15; Probe 1 first (S1/S2/S3 Vue floor/S8/S10 + feel budget).
   No product HMR claim until the suite is green. Remount stays the
   labeled escape.
3. Findings road (#21…) if the session is compiler/editor-directed.

## Working agreements

- PRs land as TRUE MERGE commits — never squash/rebase-merged
  (AGENTS.md rule 9).
- HANDOFF.md rewritten at session boundaries with live-verified facts.
- Shared branches catch up by MERGE, never rebase; never force-push.
- Red pin before fix; cold review before big merges (rule 10).
- No AI attribution in commits.

## Do not trust (stale mental models)

- Ding `{ id, rev, hash }` / `{ id, rev, etag }` as product wire
- Per-rev immutable cell museum URLs (`?rev=N&h=`)
- “definition cell” as the component-identity noun → use
  **component definition**
- Calling remount “HMR done”
- A separate `packages/refresh` package
