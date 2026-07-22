# HANDOFF — session launch document (2026-07-22, early morning)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-22 ~4 AM against git, gh, the files, and
fresh suite runs.

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

## State of main (code @ 6d62d33, 2026-07-22 early morning)

- Suites, both re-run live at this handoff: repo-root
  `bun run test:all` → **5954 pass / 0 fail** (26.5s); packages/server
  `bun run test` (its own loop) → **134/134**.
- HANDOFF.md is TRACKED as of tonight (owner ruling, reversing
  `fe35067`, which had reversed `960b398`): `20b84b4` committed the
  prior snapshot verbatim; this rewrite lands with the AGENTS.md
  working-ledgers update in one commit on top.
- Landed tonight (2026-07-22), each on main:
  - **#179** `@cache` full directive vocabulary, rejecting loudly
    (never-store family → canonical no-store; 'forever' → year+
    immutable; finite durations via enumerated CACHE_UNITS; unparsable
    directives throw naming the input).
  - **#180** manager operational polish: the 409-retry window aligns
    with the claim-TTL worst case (30000ms default outlives the
    enumerated 25s), shutdown announces its signal in one lifecycle
    line, and the unmatched-request/404 contract is documented and
    pinned (middleware wraps matched routes only).
  - **#181** the packages/server README rewritten as the full-stack
    gold-standard document (division-of-labor table, request
    lifecycle, ownership rulings, Planned section).
  - **#182** ROADMAP Server bullet true-up to the settled
    edge/framework split.
  - **#183** README tagline names the worker-pool runtime and the
    Janus/Caddy app tier.
- Direct commits tonight, each on main:
  - `464ff0b` AGENTS.md/TODO.md ledger update (working-ledgers
    section, rules 9/10, Language Semantics Doctrine).
  - `1c0dc4e` ROADMAP true-up: the executable pending lane removed,
    the CLI-completeness section removed, db/stamp facts corrected.
  - `507beb4` rule 9 bans squash and rebase merges — a landed branch's
    tip stays an ancestor of main.
  - `52f409c` rate-limiting discussion removed from the docs entirely,
    per ruling.
  - `5121e1f` bodyLimit removed from the framework entirely.
  - `9b183bc` worker maxRequestBodySize removed (body-size admission
    is the edge's).
  - `fa739b3` STRUCTURED STARTUP REPORT shipped in manager.rip: the v3
    `scale` port, control-plane read-backs through the writer chain
    (the registered line states what JANUS holds, never what was
    sent), NO_COLOR/non-TTY mono, +4 pins.
  - `6d62d33` the logging contract: every line written by the process
    that witnessed the event; per-request access logging is the
    edge's; ONE merged server stream with `[worker N]` tags; severity
    is a field on a line, never a separate file; stdout default;
    opt-in `logs:`/`RIP_LOG_DIR` file logging is planned-not-built.
- **Edge ownership rulings (owner, tonight):** Janus-with-Caddy owns
  proxy/stream execution, TLS (ACME/certs/SNI), WebSocket termination
  (the hub), per-IP rate limiting (if ever built), and request-body
  size admission. Identity-keyed quotas are application code — not
  framework surface, not documented. mDNS is dropped entirely (no
  owner; zero references remain outside misc/). Rip Server stops at
  publishing upstreams to the control plane.
- **Server remaining in-framework work** (README Planned + ROADMAP,
  verified in both): the `--bridge` registration flag, hub ergonomics
  (bridge-frame dispatch, sigil directive helpers, publish client with
  app-id plumbing, membership-snapshot access), and the opt-in file
  logging knob. Startup reporting is SHIPPED. TODO.md's server B-list
  stays open: respawn edges, watcher blind spots, writer-chain growth
  during control-plane outages, and the rip-mark access log — that
  last one is inherently Janus-side now (the edge writes access logs)
  but has not been formally reassigned.
- **Branch state:** merged branches cleaned tonight
  (roadmap-server-trueup, server-readme-full-stack,
  manager-operational-polish, server-readme-tagline — deleted local
  and remote where they existed). Remote carries only main,
  type-audit-verify-and-resolve, and the steve-types-* branches.
- **Unnamed flake watch stands**: an unreproduced single-failure
  test:all run (two sightings, 2026-07-20/21; evidence points at
  timing sensitivity under machine load). If a logged run ever fails,
  capture the test NAME verbatim — identifying it matters more than
  the green rerun.
- Session archaeology: the v3 logging format was fully excavated
  tonight (v3 `packages/server/serving/logging.rip` carries `scale` +
  `logAccessHuman`; `control/lifecycle.rip` carries
  `logStartupSummary`). `scale` is now IN v4 manager.rip (exported).
  The v3 access-line format (fixed-width `│` columns) is the reference
  spec if Janus ever grows a human-format access log.

## Open decisions / in-flight

- **PR #156** "Type-audit verify-and-resolve (preview)" — DRAFT, head
  `7d3a10d` (the second catch-up merge tonight, 03:45; the first was
  `a42a9fb`, 01:23), CI SUCCESS, mergeStateStatus CLEAN, current
  through main `6d62d33` (ancestry verified). Blocked SOLELY on owner
  + Philip go/no-go. UI work (the headless widget catalog +
  app-framework integration) begins with Philip after #156 lands.
- Open PRs besides #156: the steve-types findings series — #158, #159,
  #160, #161, #162, #165 (#157 is CLOSED).
- RULED (owner, 2026-07-22 morning): the `gate` package moves to the
  Janus project as a Janus enhancement, which kills the v3-comparison
  pass the packages upgrade ledger was gated on; that ledger is
  deleted (its remainder was a done-items archive) and the migration
  is tracked in TODO.md (Package moves). The clean-room rewrite plan
  is docs/CLEANROOM.md, listed as permanent documentation.
- Pending owner rulings: misc/PLAN.md + misc/FINALIZE.md deletion
  (recommended: delete — stale campaign machinery);
  the three untriaged misc/ directories
  (analysis/, server-v4-discarded/, vite/); the bare-optional-
  parameters strict contract (docs/ROADMAP.md, Type and editor
  directions).

## Next session: recommended starting point

- **Browser delivery is the highest-leverage unblocked block**:
  `<script type="text/rip">` compilation/loading, browser package
  graphs, dev-server integration. Partial machinery exists in
  `src/browser-scripts.js`. It is the prerequisite for HMR
  (docs/HMR.md) and FRAME (docs/FRAME.md).
- The server Planned items (--bridge flag, hub ergonomics, file
  logging knob) are small and independent — good parallel work.
- The syntax reference (TODO.md, grammar drill-down) parallelizes with
  anything; owner-deprioritized.

## Upstream Bun thread

- **PR [oven-sh/bun#29291](https://github.com/oven-sh/bun/pull/29291)**
  (ESM bytecode without `--compile`): OPEN, head `fa97f46`, 76 checks
  pass / 2 skipping (Mintlify, Claude Code Review) / 0 failing. Sole
  gate unchanged: codeowner review (REVIEW_REQUIRED). When it merges:
  canary build, then revisit the prebuild bytecode decision in
  `packages/server/manager.rip` (the comment at ~L224 records why
  bytecode is not viable on Bun 1.3.14 — ESM bytecode requires
  `compile: true`).
- Issue [oven-sh/bun#34835](https://github.com/oven-sh/bun/issues/34835)
  (mmap the bytecode sidecar): OPEN, still exactly one comment (the
  owner's 2026-07-20 RoboBun-review request, cc @alii) — no maintainer
  response as of 2026-07-22 early morning.
- Installed Bun: 1.3.14 (the last Zig release; Bun canary is the Rust
  port line).

## Working agreements (this collaboration)

- PRs land as TRUE MERGE commits — never squash-merged, never
  rebase-merged (AGENTS.md rule 9, tonight): a landed branch's tip
  stays an ancestor of main, so merged-branch verification is a pure
  git ancestry check. Landing subject: `PR #N — <PR title>` via
  `gh pr merge N --merge --subject "PR #N — <title>"`.
- HANDOFF.md is tracked and rewritten at session boundaries with
  live-verified facts (owner ruling, tonight).
- Shared branches catch up by MERGE, never rebase; never force-push.
- Nothing pushed or posted without explicit owner approval.
- Red pin before fix: reproduce the defect as a failing test first.
- Adversarial review with at least one genuinely COLD pass before big
  merges (AGENTS.md rule 10; proven by #176's cold-caught defects).
- Every bug is fixed at the layer that owns it (rule 4).
- Anything posted publicly is fact-checked claim-by-claim first.

## Operational notes (this environment)

- The `user-ai` MCP: the Anthropic leg is OUT OF CREDITS (verified
  live 2026-07-22 — the API returns a credit-balance error); the GPT
  leg works (verified live, gpt-5.5 responded).
- `.handoff/bunpr-bench` — Bun #29291 validation evidence (benchmarks,
  memory results, upstream source excerpts). 15 MB, in-repo but
  invisible to git via `.git/info/exclude`. KEEP while Bun #29291 and
  #34835 are open; delete freely once both resolve.
- The /tmp scratch assets from prior sessions are GONE (only
  `/tmp/rip-report-demo` remains); `/tmp/janus-bench` no longer
  exists. Rebuild probes fresh if needed.
- Background subagents intermittently stalled right after their
  opening message (three occurrences 2026-07-21; unverified since).
  Recovery that worked every time: interrupt + resume with "restate
  your mandate and proceed". Detection: transcript mtime AND repo-tree
  writes AND new commits all stale >10 min.
