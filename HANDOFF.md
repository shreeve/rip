# HANDOFF — session launch document (2026-07-20, end of day)

Session launch document — TRACKED as of 2026-07-20 (owner ruling;
previously untracked). Rewrite it at each session boundary; it states
the current session's verified facts, not history. Every fact below
was verified live on 2026-07-20 evening against git, gh, and the
files.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout. The workspace root
  `~/Data/Code/rip-v4` is DEAD; do not work there.
- v3 oracle: `~/Data/Code/rip-lang` — read-only reference, never edit.
- `AGENTS.md` is doctrine. Read it before touching code. Key rules:
  reject loudly; fix at the owning layer; never hand-edit
  `src/parser.js` (regen via `bun run parser`); output changes land
  with enumerated corpus diffs; no AI attribution in commits.
- Commands: `bun run test:all` (CANONICAL suite — completion claims run
  against this, not the fast loop) · `bun run test` (fast loop) ·
  `bun run test:rip` (battery only, sub-second) · `bun run type-audit`
  · `bun run parser` · `bun run corpus-expected`.

## State of main (origin/main @ dd787d0, 2026-07-20 night)

- Suite: `bun run test:all` → **5930 pass / 0 fail** (verified at the
  #177 merge; up from 5688 this morning — +242 pins across today's
  PRs).
- Working tree: on `main`, even with origin, CLEAN except this
  untracked file plus staged late-night changes (commit when ready):
  `docs/REWRITE.md` renamed to `docs/REWRITE-V5.md`;
  `docs/POSSIBLE-FUTURE-SYNTAX.md` DELETED by owner ruling (mixed real
  and aspirational syntax; recover from git history if needed);
  `CHANGELOG.md` DELETED by owner ruling ("too hard to maintain" —
  git history and PR bodies are the record now); references to both
  removed from AGENTS.md/README.md/TODO.md/docs/ROADMAP.md. Earlier
  docs true-up committed as `dd787d0` (README REPL section, TODO.md
  consolidation).
- Landed TODAY (each independently verified before merge):
  - **#175** last-match `_` per-invocation scoping (`f3a8d18`). The
    concurrency clobber was real (overlapping async invocations
    crossed regex captures); fixed with per-function-invocation
    `let _`, no ALS. Module-level `_` stays one binding — no-await
    rule pinned in the battery.
  - **#176** the complete v4 REPL (14 commits, `src/repl.js` + four
    compiler seams: `ambientBindings`, `result.bindings` inventory,
    `classifyCompleteness`, `repl:true` emission). Reactive
    persistence across lines, live lexer-driven highlighting, themes
    with OSC 11 light/dark detection, declaration echo, cwd-anchored
    dynamic imports (minted runtime resolver — handles computed
    specifiers), injective 0600 history, Unicode identifiers
    (exactly ONE identifier vocabulary repo-wide: the lexer's
    `isIdentifierName`/`identifierRuns`), `-e/--eval`. Bare `rip` on
    a TTY starts it. Survived: 3 adversarial plan reviews, 2
    independent verifications, a cold review (request-changes →
    approve-with-nits), and a re-review.
  - **#177** same-scope redeclaration rejects positioned (`2b54cfa`).
    Closed the 54-cell duplicate-declaration matrix (unpositioned
    BuildMessages, the assign-then-state TDZ trap, double-def
    last-wins, param+def argument swallowing). 42 pins in
    `test/battery/redeclare.rip`. Bonus: `def f` then `f = 2` is now
    a working reassignment. Writes/write-through/shadowing/REPL
    fluidity untouched. Dry-run survey found ZERO collateral in our
    own 171 .rip files.

## Open decisions / in-flight

- **PR #156** "Type-audit verify-and-resolve (preview)" — DRAFT, head
  `2feb9d2` (caught up to main by MERGE on 2026-07-20 evening; five
  mechanical conflicts, union-resolved; branch suite 6044/0; CI
  CONFIRMED green on the new head — mergeable MERGEABLE,
  mergeStateStatus CLEAN, test SUCCESS). Still blocked on: owner +
  Philip go/no-go — the branch is in its best shape yet, waiting only
  on that decision. `rip check` arrives with this PR when Philip lands
  it. The old /tmp/rip-pr156-catchup clone was gone; the catch-up used
  a fresh /tmp clone — check /tmp if more #156 work is needed.
- TODO.md (consolidated 2026-07-20) is the open-items ledger: REPL
  deferred nits (history decode edge, OSC 11 chunk race, parameter
  message line number), server B-list (+ two bench-incident items:
  silent exit-0 shutdown logging, 409-retry vs claim-TTL
  misalignment), Janus B-list, and the syntax-reference documentation
  effort (grammar drill-down; parked — owner says it can wait).

## Next session: recommended starting point

- **docs/ROADMAP.md is STALE and the true-up is the proposed opener**
  (analysis done end of session; owner had not yet said go). Two
  staleness proofs: it still lists "an interactive REPL" under CLI
  completeness (shipped today, #176 — hygiene rule says implemented
  items leave the file), and it claims server S2 "process workers and
  the control plane" is pending, yet today's janus-bench ran
  rip-server with 2 process workers registered against Janus's control
  plane with heartbeats. True-up = verify each claimed-pending item
  against the codebase, remove what shipped, produce the honest
  remaining list.
- **After the true-up, the dependency-ordered candidates** (build in
  dependency order, not clarity order): (1) browser delivery
  (`<script type="text/rip">`, browser package graphs, dev-server
  integration — prerequisite for FRAME and browser HMR; partial
  machinery exists in src/browser-scripts.js); (2) the genuinely
  remaining server stages of S2–S7; (3) HMR (starts with
  last-known-good live reload per docs/HMR.md); (4) the syntax
  reference (parallelizes with any of the above).

## Upstream Bun thread

- **PR [oven-sh/bun#29291](https://github.com/oven-sh/bun/pull/29291)**
  (ESM bytecode without `--compile`): OPEN, head `fa97f46`, all
  checks green. Sole gate unchanged: alii codeowner review
  (REVIEW_REQUIRED). When it merges: canary build → flip
  `bytecode: true` in `packages/server/manager.rip` ~L257.
- Issue [oven-sh/bun#34835](https://github.com/oven-sh/bun/issues/34835)
  (mmap the bytecode sidecar): OPEN; owner posted a comment today
  (21:07 UTC) asking a maintainer to run it through RoboBun/Claude
  feasibility review, cc @alii. Watch for a response.
- NOTE: Bun's canary is now the RUST port (v1.4 line; PR #30412 merged
  May 2026 — ~47% Rust, ~32% Zig, ~13% C++). v1.3.14 (installed) is
  the last Zig release. `bunx bun-pr 29291` builds against Rust main.

## Working agreements (this collaboration)

- Every bug is fixed at the layer that owns it (AGENTS.md rule 4).
- Red pin before fix: reproduce the defect as a failing test first.
- Dual adversarial review before big merges — TODAY'S LESSON: warm
  reviews missed what cold eyes caught (the Unicode session-bricking
  in #176 was found only by a context-free cold reviewer; the
  dynamic-import gap only by independent verification). Always run at
  least one genuinely cold pass before merging.
- Anything posted publicly is fact-checked claim-by-claim first.
- Never rebase shared branches — catch up by MERGE (see `dfaf3c9`).
- Nothing pushed or posted without explicit owner approval (owner
  authorized today's pushes/merges explicitly, each time).
- TODO.md stays POLS: open items on top, done/refuted at the bottom.

## Operational notes (this environment)

- Background subagents INTERMITTENTLY STALL right after their opening
  message (three occurrences today; no cause visible in transcripts —
  reconnaissance completes, then no writes). Recovery that worked
  every time: interrupt + resume with "restate your mandate and
  proceed". Detection: transcript mtime AND repo-tree writes AND new
  commits all stale >10 min (transcript flushing lags real activity
  by many minutes — the repo tree is ground truth; a /tmp watchdog
  script pattern from today works well).
- The `user-ai` MCP panel: Anthropic API credits EXHAUSTED (billing
  console also threw a transient auth_rpc_unavailable when owner tried
  to fund — retry at platform.claude.com → Plans & Billing). GPT leg
  works. GPT endorsed the redeclaration rule design (2026-07-20).
- Janus bench stack (/tmp/janus-bench): something external cycles it
  (deliberate SIGTERMs, "down on purpose" drains). Do NOT restart it
  without checking for a concurrent session first.

## Scratch assets map (/tmp — survives until reboot)

- `.handoff/bunpr-bench` — Bun #29291 validation evidence (benchmarks,
  memory results, upstream source excerpts incl. Rust transpiler).
  15 MB, in-repo but invisible to git via `.git/info/exclude`. KEEP
  (owner ruling 2026-07-20) while Bun #29291 and #34835 are open —
  it's the reproducible backing for our posted numbers. DELETE freely
  once both threads resolve.
- `/tmp/ripmatrix` — the 64-cell declaration-collision sweep: probes,
  results.json, nested variants. Historical (fixed by #177) but the
  probe harness is reusable for future matrix sweeps.
- `/tmp/rip-main-verify`, `/tmp/rip-probes`, `/tmp/rip-verify` —
  verification clones/probes from today's three PR verifications.
- The #156 catch-up clone: the old `/tmp/rip-pr156-catchup` is GONE;
  the 2026-07-20 evening catch-up (`2feb9d2`) used a fresh clone in
  /tmp — locate it there if more #156 work is needed.
- `/tmp/rip-imsg-monitor.sh`, `/tmp/rip-worker-watchdog.sh` — the
  iMessage commit-notifier and the worker-stall watchdog from today;
  both parameterized by paths at the top, reusable.
