# HANDOFF — session launch document (2026-08-06)

Read this first when starting a session. Permanent architecture lives in
`docs/`. Git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — live v4 checkout; `main` at merge of HMR
  Cart confirmation #220 (plus prior #218 / #219).
- Fast commands: `bun run test:rip` · package-local `bun run test` ·
  `packages/browser-tests`: `bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests`: `bun run test:cart`.
- HMR constitution: [docs/HMR.md](docs/HMR.md) · Workspace:
  [docs/WORKSPACE.md](docs/WORKSPACE.md).
- Sites: [docs/SERVER.md](docs/SERVER.md) · `packages/sites/README.md`.
- Open notes: `TODO.md` · `packages/sites/TODO.md`.

## HMR — product complete

Cart Gates A and B are green on `test:cart`. The honest claim is
React-tier local refresh **plus** App-level failed-publication
quarantine — not “faster DOM than React.” Surgical DOM morph is out of
scope. Optional seam compression (not a second product) is listed in
`docs/HMR.md`.

Live demo: `rip sites start edge` (if needed) → `rip sites start cart`
→ place order → render-only edit of `app/routes/cart.rip` confirmation
h1 → stay on Order Placed.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.

## Testing cadence (durable — also in AGENTS.md)

1. Edit loop — smallest disproof (`test:rip`, package `test`, named spec).
2. Milestone — owning package suite + direct consumers.
3. Landing — freeze candidate, then PR gates (`test:rip` + browser smoke);
   `test:all` / cart only when explicitly certifying.
