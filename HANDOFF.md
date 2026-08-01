# HANDOFF — session launch document (2026-08-01)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run browser-bundle`.

## Active branch

**Branch: `rip-server-fixes`** (`e8d6d70` before the current
working tree).

The Rip Server simplification and access-log implementation are present in
the working tree:

- Janus owns browser files, browse listings, cache policy, compression,
  access completion, and `X-Sendfile`; workers remain API-only;
- `rip server` subscribes to Janus's registration-scoped NDJSON access
  stream in pretty, raw, or off mode;
- pretty output uses the field-first picture grammar and fixed-width SI
  scaler; raw mode reserves stdout for validated NDJSON;
- registration generations, backpressure, EPIPE, browse leases, and
  direct/wrapper signals have deterministic cleanup pins;
- the generic worker request logger is removed after full response-class
  certification.

Live verification on this working tree:

- `bun run test:all` — passed (21 lanes).
- `bun run test` in `packages/server` — 200 passed after logger removal.
- `bunx playwright test` in `packages/browser-tests` — 21 passed, 2
  intentional source-map skips.
- `go test -race -count=1 ./...` in `~/Data/Code/janus` — passed.
- final rebuilt Janus `./test.sh` — 171 passed.
- Linux and Windows Janus builds — passed.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
