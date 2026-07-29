# HANDOFF — session launch document (2026-07-29, ~noon)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-29 morning (UTC-6) against git, fresh suite
runs, an independent cold review + re-review, and live end-to-end runs
through a real Janus binary, except where an older verification date
is stated explicitly.

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

## PR #188 LANDED — the Workspace is the DEFAULT

- **`main` is at `7c100ab`** — "PR #188 — The Workspace is the
  default: cold-review fixes, RIP_WORKSPACE retired (Q10),
  packages/workspace folded into packages/app, and the cross-run
  cell-cache fix" — a TRUE MERGE commit (rule 9), local and origin in
  sync. Ancestry verified live: `git merge-base --is-ancestor aa9da2a
  main` holds. The `workspace-default` branch is deleted local and
  remote.
- The landed arc (11 commits), in three movements:
  1. **The #187 cold-review should-fixes**, every one red-pin-first:
     the door's rev verdict gates ALL loader mutation · the manifest is
     the LAST document written and the FIRST fetched (bundle/manifest
     correlation) · the feed percent-encodes cell ids and RETRIES a
     miss (wants + backoff) · manager cell-path runs serialize on one
     promise chain · a throwing relaunch reports loudly and recovers ·
     epoch dings (a pool swap reloads every open page) · nits
     (DEV_CHANNEL equality pin, client() notFound warn, Pulse res.ok).
  2. **Q10** — `RIP_WORKSPACE` retired; `packages/workspace` folded
     into `packages/app` (`createWorkspace`/`connectFeed` on the
     public entry — `@rip-lang/app` IS the client side);
     `packages/refresh` will never be a separate package (the M2 apply
     engine lands as a discardable `packages/app` module); the
     bundle's `claims` mechanism deleted.
  3. **The cross-run cell-cache fix** — revs restart across manager
     runs while cell responses cache immutable for a year, so a bare
     `(id, rev)` URL silently served the OLD run's bytes on a
     collision (proven live; it also explained the 07-28 "missed
     ding"). Cell URLs now carry a 16-hex sha256 discriminator
     (`?rev=N&h=…`) minted into manifests and dings.
- **The #188 cold review found one blocker, fixed before landing**:
  the door had opened in production worker mode. The feed surface is
  now WATCH-ONLY — a production manager (watch off) sets no feed env,
  writes no cells/manifest, publishes no dings, its pages boot PLAIN,
  and the bridge answers opens with a bare 204 (app-level hub sockets
  never ride the dev channel). Production has no hub (Q2), enforced
  structurally. Also from that review: `h` is REQUIRED on the cell
  route (a bare URL is a 400, never a cacheable 200); the page-side
  cross-run verdict (a covered rev whose bytes differ from the page's
  copy names a manager restart → reload), arbitrated through the
  no-store manifest so an overtaken hub frame never causes a spurious
  reload; want retirement for lost delete dings.

## Suites (all verified this session, on the landed tree)

- repo-root `bun run test:all` → **6120 pass / 0 fail** — run by me
  (twice on the final tree) AND independently by the cold reviewer.
- `packages/server` → **169 pass / 0 fail** · `packages/app` →
  **281 pass** (bun half) + **63 pass / 0 fail** (workspace harness) ·
  `packages/vscode` → **128 pass / 0 fail**.
- Playwright certification (`packages/browser-tests`) → **16 pass /
  2 skip** across chromium, firefox, webkit.
- FLAKE SIGHTING (per the flake-watch rule, name captured verbatim):
  one full Playwright run failed once on
  "a harness ding visibly updates the page without reload, and the
  hub never carries bodies" [firefox] — the error snapshot showed the
  DOM had ALREADY updated to the expected stamp; passed in isolation
  and on the full rerun. Unreproduced; treat as the known
  timing-sensitivity family.
- `bun run audit` NOT re-run (no editor-surface changes); last
  verified midday 2026-07-28: 15 green / 3 red by agreement.

## Rule 10 discharged (this landing)

An adversarial COLD review (a fresh agent, zero context) ran against
PR #188: verdict "not safe to land" — one blocker (the production
door, above) + four should-fixes, ALL fixed red-pin-first (7 pins
verified failing against the unfixed tree). The reviewer then
independently re-verified every fix and re-ran the suites: **safe to
land, no blockers**. Its re-review contributed one more improvement
(manifest arbitration for covered-mismatch dings, landed) and two
deferrable notes, ledgered in TODO.md ("workspace feed" section).

## Rip Workspace state

docs/WORKSPACE.md is the constitution; Q1–Q10 locked. The door is the
default for every WATCHING manager-served browser app; production and
standalone pages boot plain. M1 is met and landed; apply is still the
**remount labeled escape** (never called hot apply). Open, in priority
order:

- **Hot apply (M2 apply quality)** — swap a component's implementation
  under live instances with state intact; remount stays the
  always-correct fallback. Lands as a discardable module in
  `packages/app` against the S-suite (Q10). The seams are ready:
  versioned bag, per-cell hashed dings, transitive loader
  invalidation, the `door` wrapper in `src/browser-boot.js`.
- The two deferred feed notes in TODO.md (want-retirement edge under a
  held-back manifest; crossRun vs a future editor producer).
- Id persistence across renames is open research (rename = retire +
  mint at rev 1). `rip.browser` granularity stays on the owner's
  deferred docket.

## State of main (beyond the workspace arc)

The findings road: #21 heads it (identifier read mappings), then #22,
#40, #42. The owner's deferred docket stands: findings #36/#45/#46,
`rip.browser` granularity, misc/ triage, and the bare-optional-
parameters contract — do not resolve unilaterally.

## Next session: recommended starting point

- **Hot apply (M2)** — the constitution's S-suite (S1, S2, S5, S7,
  S10) implemented as a `packages/app` module; remount remains the
  fallback verdict for anything the module cannot prove.
- Or the findings road (#21) if the session is compiler/editor-
  directed.

## Still running on this machine at handoff

Deliberately left up (the owner's live demo): Janus
(`~/Data/Code/janus`, `./bin/caddy run`, since ~10:27) and the Pulse
manager (`examples/pulse`, `rip server app.rip --name pulse --host
pulse.ripdev.io --bridge /hub`, log `/tmp/pulse-manager2.log`). NOTE:
the manager process predates the final commits — restart it before
demoing to pick up the landed tree. Kill or reuse freely.

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
  `gh pr merge N --merge --subject "PR #N — <title>"`. (#187 and #188
  landed exactly this way.)
- HANDOFF.md is tracked and rewritten at session boundaries with
  live-verified facts (owner ruling).
- Shared branches catch up by MERGE, never rebase; never force-push.
- Nothing pushed or posted without explicit owner approval (#188's
  push/land rode the owner's standing "do exactly as you recommend"
  for the retirement plan).
- Red pin before fix: reproduce the defect as a failing test first
  (every #188 fix did).
- Adversarial review with at least one genuinely COLD pass before big
  merges (rule 10; discharged for #188 with a review + re-verify
  loop).
- Every bug is fixed at the layer that owns it (rule 4).
- Anything posted publicly is fact-checked claim-by-claim first.

## Operational notes (this environment)

- `test/audit/` needs its own `bun install` (fixture corpus) before
  `bun run audit` — done on this machine 2026-07-28.
- The working tree carries ONE deliberate uncommitted edit:
  `examples/pulse/app/mood.rip` (the owner's live demo playground,
  label experiments — currently 'upbeaten'). Do not commit or revert
  it without asking. It survived the merge via autostash.
- `rip test` (the CLI wrapper) exits 0 on "No tests found" — a
  silent-success edge that predates the workspace work. The
  contract-standard invocation for package suites is `bun run test`
  inside the package.
- The unnamed test:all flake watch stands (sightings 2026-07-20/21,
  one audit-lane 07-28, one Playwright-firefox 07-29 — all
  unreproduced, names captured). Every canonical run this session was
  green.
- Background subagents intermittently stall right after their opening
  message (recurrences through 07-28). Recovery: interrupt + resume
  with "restate your mandate and proceed". (Both reviewer runs this
  session were clean.)
- `.handoff/bunpr-bench` — Bun #29291 validation evidence, in-repo but
  git-invisible via `.git/info/exclude`. KEEP while #29291/#34835 are
  open.
- The `user-ai` MCP: the Anthropic leg was OUT OF CREDITS as of
  2026-07-22; the GPT leg worked. Not re-verified since.
