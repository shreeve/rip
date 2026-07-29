# HANDOFF — session launch document (2026-07-28, evening)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-28 evening (UTC-6) against git, the files,
fresh suite runs, and two live end-to-end runs through a real Janus
binary, except where an older verification date is stated explicitly.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout. The workspace root
  `~/Data/Code/rip-v4` is DEAD; do not work there.
- v3 oracle: `~/Data/Code/rip-lang` — read-only reference, never edit.
- Janus: `~/Data/Code/janus` — the Caddy-module edge server, its own
  repo. `./bin/caddy` there is a working Janus binary (built
  2026-07-28); `./bin/caddy run --config Caddyfile` starts the dev
  edge (control `http://127.0.0.1:7600`, hub at `/hub`,
  `*.ripdev.io → 127.0.0.1` with a trusted wildcard cert;
  `hubany.ripdev.io` accepts non-browser WebSocket clients).
- `AGENTS.md` is doctrine. Read it before touching code. Key rules:
  reject loudly; fix at the owning layer; never hand-edit
  `src/parser.js` (regen via `bun run parser`); output changes land
  with enumerated corpus diffs; no AI attribution in commits.
- Commands: `bun run test:all` (CANONICAL suite — completion claims run
  against this, not the fast loop) · `bun run test` (fast loop) ·
  `bun run test:rip` (battery only, sub-second) · `bun run audit`
  (the typed-editor scoreboard; `--help` for the lanes) ·
  `bun run parser` · `bun run corpus-expected` ·
  `bun run browser-bundle` (regenerates `dist/browser/rip.js`).

## Branch topology (verified live)

- **Local `main` is at `965baf2`** — "WORKSPACE rulings Q6–Q9" —
  **ahead 1 of `origin/main`, unpushed** (nothing is pushed without
  explicit owner approval; that agreement stands).
- **Branch `workspace` is checked out at `7af886c`, 9 commits ahead
  of local main, working tree clean.** This is the session's work,
  in order:
  1. `d6da2bd` — `launch()` accepts an injected components store (Q7).
  2. `3e639e3` — `packages/workspace`: the passport bag
     (populate/set/seal door, Q8 rev cursor, ComponentsStore view).
  3. `9eee092` — manager `--bridge` flag + `publish()` control client.
  4. `f2df9c3` — `client()` browser-delivery surface (boot page,
     bundle ETag/304, runtime, SPA fallback; manager assembles per
     epoch; workers never carry the compiler).
  5. `f6fec3c` — workspace feed: the hub subscriber (`connectFeed`).
  6. `b4944b7` — the thin feed under `RIP_WORKSPACE=1`: client-only
     saves feed the live pool in place (rev-keyed immutable cells,
     atomic manifest, `/rip/dev` dings, `kind: delete`, bridge
     enrollment); flag off is byte-identical.
  7. `96edb5a` — the door in the browser: `bootApp` workspace mode
     (bag from manifest, compile-through door, coalesced remount
     labeled escape); three-engine Playwright pins.
  8. `dc89f9b` — boot page opens the door only in worker mode.
  9. `7af886c` — **client tree vocabulary: `app/` replaces `client/`
     with `_app/` and `_route/`** (owner ruling, this session): the
     disk path IS the store path. Route components live under
     `app/routes/` (the route root), the stash contract is
     `app/stash.rip`, cell ids and dings carry the same paths
     (`app/mood.rip`). `client()` defaults to the `app/` dir.
     Pulse (`examples/pulse/`) landed in this layout.
- No PR exists for `workspace` yet. It is a big merge: AGENTS.md
  rule 10 applies (independent empirical verification + at least one
  genuinely COLD review) before it lands in main.

## Suites (re-run live at this handoff, on `7af886c`)

- repo-root `bun run test:all` → **6116 pass / 0 fail** (56.7s).
- `packages/server` suite (`rip test.rip`) → **161/161**.
- `packages/app` suite (`rip test`) → **281 pass / 1 skip / 0 fail**.
- `packages/workspace` suite → **56/56**.
- Playwright certification (`packages/browser-tests`,
  `bunx playwright test`) → **16 pass / 2 skip** across chromium,
  firefox, webkit — including the workspace ding spec.
- `bun run audit` was NOT re-run this session (no editor-surface
  changes); last verified on main `b2594e8` midday: contract holding,
  15 green / 3 red by agreement.

## Live end-to-end through real Janus (the session's proof)

Two full runs through the actual edge binary, both verified at this
handoff (processes started, driven, and torn down; nothing left
running):

1. A scratch app, then 2. **Pulse** (`examples/pulse`) — both under
   `RIP_WORKSPACE=1 rip server … --host hubany.ripdev.io --bridge
   /hub` against Janus's dev Caddyfile. Verified on the wire:
   registration with `bridge_path` in the registry read-back; the
   boot page over HTTPS carrying `workspace: true`; the no-store
   manifest; API routes proxied; a live WebSocket on the edge hub;
   a client-file save producing exactly one ding frame
   (`{"ding":{"id":"app/mood.rip","rev":2}}` for Pulse's documented
   demo edit); the manifest rev bump; the rev-keyed immutable cell
   answering the new bytes; old revs still answering. No bodies ever
   rode the socket.
- Pulse standalone (`rip app.rip` from `examples/pulse`) also
  verified live: bundle ships `app/mood.rip`, `app/routes/index.rip`,
  `app/stash.rip`; API and boot page answer.
- Operational note from the runs: `rip server` dispatches through the
  generic `rip-<name>` fallback, so it needs `rip-server` discoverable
  (repo checkout: run `packages/server/server.rip` directly with the
  loader preload, as its tests do, or use `bun run link-global`).

## The new client-tree vocabulary (owner ruling 2026-07-28)

`client/`, `_app/`, and `_route/` are GONE from the vocabulary. The
browser app lives in `app/` next to the server entry; every `.rip`
under it is a bundle module keyed by its disk path — the disk path IS
the store path, the cell id, and the ding id. Route components live
under `app/routes/` (`buildRoutes` root default); the stash contract
is `app/stash.rip`. Files/dirs starting with `_` inside the route
tree stay non-routable (`_layout.rip` unchanged). The full-rename
scope (ids, manifest, dings — not a disk-only alias) was the owner's
explicit choice.

## Rip Workspace state

docs/WORKSPACE.md is the constitution; Q1–Q9 locked (Q6 M0/M1
independent exits, Q7 the bag subsumes the component store, Q8
rev-keyed cell freshness, Q9 package shape). M1 Probe 0 is DONE end
to end on the `workspace` branch: door + thin feed + browser apply by
**remount labeled escape** (never called hot apply). Open edges:

- **Apply quality is the M1 exit criterion still open** — the escape
  remounts the whole launch per change batch; hot apply is future
  work per the research-first ruling (Q5).
- **Epoch-path dings** (TODO.md): a full pool reload (server-file
  save) sends no ding, so an open page learns about a new epoch only
  by user refresh. Deliberately open.
- **Id persistence across renames** is open research (a rename today
  is retire + mint at rev 1).
- `rip.browser` granularity stays on the owner's deferred docket.

## State of main (unchanged since midday handoff)

PR #186 merged (`b2594e8`), then `965baf2` (Q6–Q9 rulings) landed
locally on top. The findings road: #21 heads it (identifier read
mappings), then #22, #40, #42. The owner's deferred docket stands:
findings #36/#45/#46, `rip.browser` granularity, misc/ triage, and
the bare-optional-parameters contract — do not resolve unilaterally.

## Next session: recommended starting point

- **Land the `workspace` branch**: adversarial review with a COLD
  pass (rule 10), decide the PR shape, obtain owner approval to push.
  The branch is green on every suite named above.
- **Or push M1 forward on apply quality** (component-level hot apply
  behind the same flag), with the escape as the always-correct
  fallback.
- The findings road (#21) remains the main-branch queue if the
  session is compiler/editor-directed instead.

## Upstream Bun thread (NOT re-verified this session; as of midday)

- PR [oven-sh/bun#29291](https://github.com/oven-sh/bun/pull/29291)
  (ESM bytecode without `--compile`): OPEN, sole gate codeowner
  review. When it merges: canary build, revisit prebuild bytecode in
  `packages/server/manager.rip`.
- Issue [oven-sh/bun#34835](https://github.com/oven-sh/bun/issues/34835)
  (mmap the bytecode sidecar): OPEN, no maintainer response.
- Installed Bun: 1.3.14.

## Working agreements (this collaboration)

- PRs land as TRUE MERGE commits — never squash-merged, never
  rebase-merged (AGENTS.md rule 9). Landing subject:
  `PR #N — <PR title>` via
  `gh pr merge N --merge --subject "PR #N — <title>"`.
- HANDOFF.md is tracked and rewritten at session boundaries with
  live-verified facts (owner ruling).
- Shared branches catch up by MERGE, never rebase; never force-push.
- Nothing pushed or posted without explicit owner approval.
- Red pin before fix: reproduce the defect as a failing test first.
- Adversarial review with at least one genuinely COLD pass before big
  merges (rule 10; proven by #176's cold-caught defects).
- Every bug is fixed at the layer that owns it (rule 4).
- Anything posted publicly is fact-checked claim-by-claim first.

## Operational notes (this environment)

- `test/audit/` needs its own `bun install` (fixture corpus) before
  `bun run audit` — done on this machine 2026-07-28.
- Janus dev runs unprivileged from its checkout; my session started
  and stopped it cleanly twice. Scratch evidence from the live runs:
  `/tmp/janus-smoke/` (logs + WS driver) — disposable.
- The unnamed test:all flake watch stands (two sightings 2026-07-20/21
  plus one audit-lane sighting 2026-07-28 midday; all unreproduced).
  Every run this session was green. If a logged run ever fails,
  capture the test NAME verbatim.
- Background subagents intermittently stall right after their opening
  message (three occurrences 2026-07-21; recurred 2026-07-28).
  Recovery that works every time: interrupt + resume with "restate
  your mandate and proceed". Detection: transcript mtime AND repo-tree
  writes AND new commits all stale >10 min.
- `.handoff/bunpr-bench` — Bun #29291 validation evidence, in-repo but
  git-invisible via `.git/info/exclude`. KEEP while #29291/#34835 are
  open.
- The `user-ai` MCP: the Anthropic leg was OUT OF CREDITS as of
  2026-07-22; the GPT leg worked. Not re-verified since.
