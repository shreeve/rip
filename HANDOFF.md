# HANDOFF — session launch document (2026-08-06)

Read this first when starting a session. Permanent architecture lives in
`docs/`. Git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — live v4 checkout; branch `rip-hmr-test`
  (uncommitted work below) atop `main` with HMR #218 + #219.
- Fast commands: `bun run test:rip` · package-local `bun run test` ·
  `packages/browser-tests`: `bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests`: `bun run test:cart`.
- HMR contract: `docs/HMR.md` · Workspace: `docs/WORKSPACE.md`.
- Sites: `docs/SERVER.md` · `packages/sites/README.md`.
- Open notes: `TODO.md` · `packages/sites/TODO.md`.

## Cart confirmation bars — green on this branch

`packages/browser-tests` `test:cart` — all 8 `cart-apply` specs pass,
including:

- **Gate A** — order confirmation survives a compatible `cart.rip`
  markup edit (`rip:hmr` `patch`, not remount).
- **Gate B** — confirmation + compile-fail overlay + recover with
  stamped heading in place (no reload, no re-order).

Root causes that had to land for those pins:

1. **Staging `_target`** — after layout reuse, `mount` recorded a
   DocumentFragment; patch reinserted into the empty husk. Prefer a
   connected live parent (`#content`).
2. **`router.rebuild` after Workspace commit** — content-only route
   edits must soft-skip when the living match identity is unchanged;
   otherwise the renderer remounts and drops `placeOrder.succeeded`.
3. **Manager assemble gate** — watch refresh publishes raw sources when
   assemble/compile fails so the browser can quarantine (overlay).
4. **Quarantine recovery** — feed enqueues the next live generation;
   browser rebases when `change.from` is a rejected hash; walking back
   to the same LKG hash still clears the overlay.

Honest competitive claim (only with Gate B green): React-tier local
refresh **plus** App-level failed-publication quarantine — not “faster
DOM than React.”

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.

## Testing cadence (durable — also in AGENTS.md)

1. Edit loop — smallest disproof (`test:rip`, package `test`, named spec).
2. Milestone — owning package suite + direct consumers.
3. Landing — freeze candidate, then PR gates (`test:rip` + browser smoke);
   `test:all` / cart only when explicitly certifying.
