# HANDOFF — session launch document (2026-08-06)

Read this first when starting a session. Permanent architecture lives in
`docs/`. Git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — live v4 checkout; branch `main` at
  `de205cb` (merge of Sites edge postures #215), tracking `origin/main`.
- Fast commands: `bun run test:rip` · package-local `bun run test` ·
  `packages/browser-tests`: `bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests`: `bun run test:cart`.
- Sites architecture: `docs/SERVER.md` · `packages/sites/README.md`.
- Browser publication: `docs/WORKSPACE.md`.
- Sites open work: `packages/sites/TODO.md`.
- Repo open notes: `TODO.md`.

## Live machine state (verified 2026-08-06)

- Edge: running, Rip-owned, mode `default`, ports 80/443, packaged
  `Caddyfile`, Janus control under `$TMPDIR/rip-agent-<uid>/janus.sock`.
- Hello demo: running via Agent; `https://hello.ripdev.io/` → 200.
  Uncommitted `serve.rip` dual-claims `hello.ripdev.io` + `hello.local`.
- `https://sites.ripdev.io/` currently answers 500 (investigate before
  treating status as healthy).
- After Agent or Caddyfile changes: kill the Agent process (or stop
  edge + sites) so launchd picks up a fresh dual-socket plist — a stale
  Agent writing an old single-socket plist bricks Janus heartbeats.

## Uncommitted working tree

LAN dual-claim + status-page Start/Stop/Restart + `mdns { apps on }` +
demo/README walkthrough — not yet on `main`:

- `packages/sites/agent.rip`, `Caddyfile.local`, `tray` already on main
  from #215; remaining diff is dual-claim / dashboard actions / demo hosts.
- `packages/sites/TODO.md` rewritten for current leftovers.

Land as its own PR when ready; do not mix with unrelated compiler work.

## Product posture (Sites edge)

| Mode | Bind | Apps | Status |
| --- | --- | --- | --- |
| default | loopback 80/443 | `*.ripdev.io` | `https://sites.ripdev.io/` |
| local | all interfaces | `*.local` (+ ripdev.io twin) | `https://sites.local/` |
| public | phase 2 | — | `rip edge public` refuses |

Trust required before `rip edge local`. Mode flips stop+recreate; stop
sites first.

## Testing cadence (durable — also in AGENTS.md)

1. Edit loop — smallest disproof (`test:rip`, package `test`, named spec).
2. Milestone — owning package suite + direct consumers.
3. Landing — freeze candidate, then PR gates (`test:rip` + browser smoke);
   `test:all` / cart only when explicitly certifying.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.
