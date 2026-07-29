# HANDOFF — session launch document (2026-07-29, ~1am)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-28 evening → 2026-07-29 ~1am (UTC-6) against
git, fresh suite runs, an independent cold review, and live end-to-end
runs through a real Janus binary, except where an older verification
date is stated explicitly.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout. The workspace root
  `~/Data/Code/rip-v4` is DEAD; do not work there.
- v3 oracle: `~/Data/Code/rip-lang` — read-only reference, never edit.
- Janus: `~/Data/Code/janus` — the Caddy-module edge server, its own
  repo. `./bin/caddy` there is a working Janus binary;
  `./bin/caddy run --config Caddyfile` starts the dev edge (control
  `http://127.0.0.1:7600`, hub at `/hub`, `*.ripdev.io → 127.0.0.1`
  with a trusted wildcard cert; `hubany.ripdev.io` accepts non-browser
  WebSocket clients).
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

## PR #187 LANDED — the workspace branch is merged and deleted

- **`main` is at `479a82e`** — "PR #187 — Rip Workspace: the door, the
  thin feed, and live HMR through Janus" — a TRUE MERGE commit (rule
  9), local and origin in sync. Ancestry verified live:
  `git merge-base --is-ancestor 8cd0a82 main` holds (the branch tip is
  an ancestor of main). The `workspace` branch is deleted local and
  remote.
- The landed arc (20 commits): rulings Q6–Q9 · `packages/workspace`
  (the passport bag: populate/set/seal door, Q8 rev cursor, drop-in
  ComponentsStore view) · `launch()` takes an injected store ·
  manager `--bridge` + `publish()` control client · `client()`
  browser-delivery surface (boot page, bundle ETag/304, runtime, SPA
  fallback) · the thin feed under `RIP_WORKSPACE=1` (rev-keyed
  immutable cells, atomic manifest, `{id, rev}` dings on `/rip/dev`,
  `kind: delete`; flag off byte-identical) · `connectFeed` (the hub
  subscriber) · `bootApp` workspace mode (bag from manifest,
  compile-through door, coalesced **remount labeled escape**; the
  remount rebuilds projections THROUGH the loader so a dinged
  dependency's importers recompile) · the `app/` client-tree
  vocabulary (disk path IS store path; `app/routes/`, `app/stash.rip`)
  · the `/@rip/` reserved namespace (Vite-style, replaced `/__rip/`) ·
  an emitter fix (a factory block's `_first` latch reassigns only when
  the child IS the block's first top-level node — a NotFoundError was
  silently halting list reconciliation; pinned) · `examples/pulse`
  (four demo legs) · the cold-review findings ledgered in TODO.md.

## Suites (all verified this session, on the landed tree)

- repo-root `bun run test:all` → **6118 pass / 0 fail** (51s) — run by
  me AND independently by the cold reviewer.
- `packages/vscode` `bun run test` → **128 pass / 0 fail**.
- Playwright certification (`packages/browser-tests`) → **16 pass /
  2 skip** across chromium, firefox, webkit (incl. the workspace ding
  spec).
- Package suites (cold reviewer's runs): workspace **56/56**, server
  **161/161**, app **281 pass / 1 skip**. Note: root `test:all`
  mechanically excludes `packages/**` (bunfig pathIgnorePatterns), so
  these are additional coverage.
- `bun run audit` NOT re-run (no editor-surface changes); last
  verified midday 2026-07-28: 15 green / 3 red by agreement.

## Rule 10 discharged (this landing)

An adversarial COLD review (a fresh agent, zero context on rationale)
ran before the merge. Verdict: **safe to land, zero blockers** — the
flag-off contract holds and is pinned, the emitter fix introduces no
evaluation-count or scope-capture hazard, the cell route resists path
traversal (decode → re-encode canonicalization), no pre-existing
acceptance criterion was weakened. **Five should-fixes + three nits,
all inside the experimental `RIP_WORKSPACE=1` surface, are ledgered in
TODO.md** ("Cold-review should-fixes"). The two that head the list are
silent-stale races (the doctrine's named worst class, contained by the
flag): the browser door mutates the loader before the bag's rev
verdict, and boot pairs the manifest rev with uncorrelated bundle
bytes.

## Live end-to-end (the session's proof, all four Pulse legs)

`examples/pulse` behind a real Janus binary
(`RIP_WORKSPACE=1 rip server app.rip --name pulse --host
pulse.ripdev.io --bridge /hub`):

- Leg 1 standalone and Leg 2 pooled: boot page, bundle, API, all
  verified. (A worker-mode gate keeps `workspace: true` out of
  standalone boots.)
- Leg 3 the door: `app/mood.rip` saves produced exactly one
  `{"ding":{id,rev}}` per save on the wire; pages fetched the
  rev-keyed cell over `/@rip/cells/…` and applied by remount — many
  consecutive live edits applied cleanly, including edits made WHILE
  the collaboration test ran.
- Leg 4 live collaboration: a status posted in one browser window
  appeared in a second untouched window — the page self-enrolls its
  `/hub` socket into `/pulse` (client-legal `{"+":[…]}` join) and the
  poster announces `{"@":["/pulse"],changed:{}}`; members refetch the
  API. The frame is a hint, the data rides HTTP; the worker holds no
  sockets. Zero framework changes — app-level code only.
- **Still running on this machine at handoff** (deliberately left up —
  the owner was live-driving the demo): Janus
  (`~/Data/Code/janus`, `./bin/caddy run`, log
  `/tmp/janus-pulse-caddy.log`) and the Pulse manager
  (`examples/pulse`). Kill or reuse freely next session.

## Rip Workspace state

docs/WORKSPACE.md is the constitution; Q1–Q9 locked. M1 Probe 0 is
DONE and LANDED: door + thin feed + browser apply by **remount labeled
escape** (never called hot apply). Open, in priority order:

- **Hot apply (M2 apply quality)** — swap a component's implementation
  under live instances with state intact; remount stays the
  always-correct fallback. The seams are ready (versioned bag,
  per-cell dings, transitive loader invalidation); the work is the
  apply policy in `src/browser-boot.js`. Start here — and take the two
  silent-stale should-fixes (TODO.md) first or alongside: they live in
  the same file.
- Epoch-path dings, the one unexplained missed ding, the no-retry
  resync gap — all ledgered in TODO.md with reproduction notes.
- Id persistence across renames is open research (rename = retire +
  mint at rev 1). `rip.browser` granularity stays on the owner's
  deferred docket.

## State of main (beyond the workspace arc)

The findings road: #21 heads it (identifier read mappings), then #22,
#40, #42. The owner's deferred docket stands: findings #36/#45/#46,
`rip.browser` granularity, misc/ triage, and the bare-optional-
parameters contract — do not resolve unilaterally.

## Next session: recommended starting point

- **Hot apply** (M2), leading with the two silent-stale should-fixes —
  red pins first (concurrent dings out of order; a save landing
  between the boot's bundle and manifest fetches).
- Or the findings road (#21) if the session is compiler/editor-
  directed.

## Upstream Bun thread (NOT re-verified this session; as of 07-28)

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
  `gh pr merge N --merge --subject "PR #N — <title>"`. (#187 landed
  exactly this way, with explicit owner approval to push.)
- HANDOFF.md is tracked and rewritten at session boundaries with
  live-verified facts (owner ruling).
- Shared branches catch up by MERGE, never rebase; never force-push.
- Nothing pushed or posted without explicit owner approval.
- Red pin before fix: reproduce the defect as a failing test first.
- Adversarial review with at least one genuinely COLD pass before big
  merges (rule 10; discharged for #187, proven by #176 before it).
- Every bug is fixed at the layer that owns it (rule 4).
- Anything posted publicly is fact-checked claim-by-claim first.

## Operational notes (this environment)

- `test/audit/` needs its own `bun install` (fixture corpus) before
  `bun run audit` — done on this machine 2026-07-28.
- The working tree carries ONE deliberate uncommitted edit:
  `examples/pulse/app/mood.rip` (the owner's live demo playground,
  label experiments). Do not commit or revert it without asking.
- `rip test` (the CLI wrapper) exits 0 on "No tests found" — a
  silent-success edge that predates the workspace branch, noticed by
  the cold reviewer. The contract-standard invocation for package
  suites is `bun run test` inside the package (which runs
  `rip test.rip`).
- The unnamed test:all flake watch stands (two sightings
  2026-07-20/21 plus one audit-lane sighting 2026-07-28 midday; all
  unreproduced). Every run this session was green. If a logged run
  ever fails, capture the test NAME verbatim.
- Background subagents intermittently stall right after their opening
  message (three occurrences 2026-07-21; recurred 2026-07-28).
  Recovery that works every time: interrupt + resume with "restate
  your mandate and proceed". Detection: transcript mtime AND repo-tree
  writes AND new commits all stale >10 min. (The cold reviewer this
  session ran clean.)
- `.handoff/bunpr-bench` — Bun #29291 validation evidence, in-repo but
  git-invisible via `.git/info/exclude`. KEEP while #29291/#34835 are
  open.
- The `user-ai` MCP: the Anthropic leg was OUT OF CREDITS as of
  2026-07-22; the GPT leg worked. Not re-verified since.
