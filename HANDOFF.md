# HANDOFF — session launch document (2026-08-06)

Read this first when starting a session. Permanent architecture lives in
`docs/`. Git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — live v4 checkout; branch `main` tracking
  `origin/main`.
- Fast commands: `bun run test:rip` · package-local `bun run test` ·
  `packages/browser-tests`: `bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests`: `bun run test:cart`.
- Sites architecture: `docs/SERVER.md` · `packages/sites/README.md`.
- Browser publication: `docs/WORKSPACE.md`.
- Sites open work: `packages/sites/TODO.md`.
- Repo open notes: `TODO.md`.

## Uncommitted working tree (Sites CLI unification)

Ready to commit/PR when asked — **do not land mixed with unrelated
compiler work**. `packages/sites` suite verified green (including
`test:appliance`).

What landed in the tree:

- **Unified CLI:** `rip sites <verb> <noun>` — reserved nouns `edge` |
  `all` | `tray`. `rip edge …` thin alias. Advanced verbs fold in:
  `run` | `browse` | `hold` | `release` | `migrate` | `recover`
  (raw-forward to `site.rip` before Sites option parsing).
- **`sites.json`:** Rip-owned durable catalog (one-time rename from
  `agent.json`). `list` / `add` / `remove` / idle `status` are file I/O
  (+ Janus probe for external edge) — **no control-plane spawn**.
- **Edge-scoped control:** control process starts when edge / desired
  apps need supervision; `maybeExitIdle` exits when edge is stopped and
  no app remains desired-running. Tray polls stay cheap.
- Docs: `packages/sites/README.md`, `TODO.md`, `bin/rip` help, appliance
  pins for no-spawn + reserved names.

Key files: `packages/sites/{sites,catalog,appliance,agent,edge}.rip`.

## Live machine state

Re-verify edge/hello before treating status as healthy — prior session
had `sites.ripdev.io` answering 500 and cautioned about stale Agent
plists after Caddyfile changes. After pulling this work: stop edge (lets
control exit), then `rip sites start edge` so launchd picks up a fresh
dual-socket plist.

## Product posture (Sites edge)

| Mode | Bind | Apps | Status |
| --- | --- | --- | --- |
| default | loopback 80/443 | `*.ripdev.io` | `https://sites.ripdev.io/` |
| local | all interfaces | `*.local` (+ ripdev.io twin) | `https://sites.local/` |
| public | phase 2 | — | `rip sites public edge` refuses |

Trust required before `rip sites local edge`. Mode flips stop+recreate;
stop sites first.

## Testing cadence (durable — also in AGENTS.md)

1. Edit loop — smallest disproof (`test:rip`, package `test`, named spec).
2. Milestone — owning package suite + direct consumers.
3. Landing — freeze candidate, then PR gates (`test:rip` + browser smoke);
   `test:all` / cart only when explicitly certifying.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only. No AI attribution.
