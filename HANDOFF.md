# HANDOFF — session launch document (2026-08-06)

Read this first when starting a session. Permanent architecture lives in
`docs/`. Git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — live v4 checkout; branch `main` tracking
  `origin/main` (tip includes HMR #218 + patch correctness #219).
- Fast commands: `bun run test:rip` · package-local `bun run test` ·
  `packages/browser-tests`: `bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests`: `bun run test:cart`.
- HMR contract: `docs/HMR.md` · Workspace: `docs/WORKSPACE.md`.
- Sites: `docs/SERVER.md` · `packages/sites/README.md`.
- Open notes: `TODO.md` · `packages/sites/TODO.md`.

## Just landed (HMR)

True-merged and source branches deleted:

- **#218** — signature-aware HMR (overlay, classify, patch / migrate /
  remount floor, `rip:hmr` events, Cart profile pin).
- **#219** — patch correctness: `_hmrBindEffects` +
  `_hmrRefreshComputeds` so body `~>` and `~=` refresh without
  re-running `_init`. Production/`hmr:false` bytes unchanged.

Patch is a **correct state-preserving view remount** (instance + `:=` /
prop containers + plain `_init` members survive; DOM rebuilt via
`_create`/`_setup`). Not surgical DOM morph — and that is enough for
correctness; React Fast Refresh is the competitive bar, not morphdom.

## Cart HMR confirmation bar (pins in progress)

Do **not** treat the profile typed-input pin as sufficient.

**Local action-state:** add item → place order → render-only h1 edit on
`cart.rip` → stay on confirmation; require `rip:hmr` `patch`. Smoking
gun if empty cart: remount fallthrough after `cart.clear()` — patch
keeps plain `placeOrder`; re-`_init` does not. Migrate cannot save this
(`succeeded` is not a `:=` sig slot).

**LKG-on-confirmation:** same state + compile-fail LKG while still
confirmed + recover with stamped heading, no reload / re-order.

Strategy canvas (IDE): `hmr-beat-react-vue`.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.

## Testing cadence (durable — also in AGENTS.md)

1. Edit loop — smallest disproof (`test:rip`, package `test`, named spec).
2. Milestone — owning package suite + direct consumers.
3. Landing — freeze candidate, then PR gates (`test:rip` + browser smoke);
   `test:all` / cart only when explicitly certifying.
