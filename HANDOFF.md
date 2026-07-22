# HANDOFF — session launch document (2026-07-22, afternoon)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-22 ~2 PM (UTC-6) against git, gh, the files,
and fresh suite runs.

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

## State of main (code @ 588b41f, 2026-07-22 afternoon)

- Suites, re-run live at this handoff: repo-root `bun run test:all` →
  **5954 pass / 0 fail** (25.4s); packages/server `bun run test` (its
  own loop) → **134/134**; `bun run type-audit` → **60 dimension
  checks, all passing**. Main's CI (588b41f) is green.
- Landed on main today (2026-07-22), after the 4 AM handoff rewrite
  `98d0976`:
  - `0a30f9c` — two owner rulings: the clean-room rewrite plan is
    `docs/CLEANROOM.md` (renamed, retitled, de-orphaned into the
    AGENTS.md and README permanent-doc lists), and
    `packages/UPGRADE.md` is deleted (its last open item — the gate
    package's v3-comparison pass — was killed by the gate-moves-to-
    Janus ruling; the rest was a done-items archive, which doctrine
    forbids).
  - `4808504` — AGENTS.md gains the document-placement test: opened
    as part of WORKING → repository root; consulted for
    UNDERSTANDING → docs/.
  - **#184** (`5fe7d1d`, merge `3507a6b`) — `packages/gate` removed:
    the auth wall is Janus's job. The v4 port was built against the
    discarded v4 server contract and was not a working artifact; its
    three genuine hardening ideas carry into the Janus capability's
    contract. This completed and removed TODO.md's "Package moves"
    item on this side.
  - **#185** (`ad97104`, merge `588b41f`) — the Janus auth-wall
    capability is named **auth**, not guard (the reserved URL is
    `/auth`; the capability name agrees with its front door).

## PR #156 and the findings series

- **PR #156** "Type-audit verify-and-resolve (preview)" — DRAFT, head
  `8aaa7f9`, CI SUCCESS, mergeStateStatus CLEAN. Philip's overnight
  work (merged into the branch at `954598b`, ~4:34 AM UTC-6):
  - `20bc61d` — the Grammar Gate (M2): report which productions the
    corpus reduces.
  - `be2cd43` — closes findings #18 and #19 (see below).
  - `7a189ba` — the M3 plan and hover rulings: the corpus rewrite,
    documented.

  Then four more commits this afternoon: `ef9dd20` (M3 pre-flight:
  the wave manifest), `8b97ac3` (manifest slimmed to decisions, gate
  joins live), `9fda36b` (M3 continues: 21-operations, and finding
  #26 — the match operator is never null-clean), `8aaa7f9` (M3 wave
  1: 22-collections through 26-exceptions, pushed ~2 PM UTC-6).
  The branch's merge-base with main is `6d62d33` — it has NOT caught
  up with today's main landings (0a30f9c..588b41f), though GitHub
  reports it CLEAN (no conflicts). Still blocked solely on owner +
  Philip go/no-go; UI work begins with Philip after it lands.
- **PRs #159 and #160 closed** (2026-07-22, 10:42 UTC): their content
  landed in `be2cd43` on the #156 branch, with resolution notes on
  each PR. Independently verified earlier today by re-running the
  gates on the branch: check.test.js directive cases, the tsface
  strip-identity pin, the editor suite, and the branch's type-audit
  (72/72) all green. #18 landed STRICTER than PR #160: a directive
  governs the line DIRECTLY beneath it — a blank line beneath the
  directive leaves it governing nothing (next-line adjacency, matching
  the emitter's attachment pre-pass), vs the PR's next-non-blank rule.
  #19 landed as a REDESIGN fixing two defects PR #159 had: broken
  strip identity (the pair-per-line layout now binds to source shape,
  emission stays ts-gated — pinned in tsface.test.js) and missing
  decline gates (re-homing an object-attached directive is
  line-preserving or nothing).
- **PRs #158 and #161 closed by the owner at 20:12 UTC today** — no
  comment, no landing note on either; their branches
  (steve-types-2, steve-types-5) still exist local+remote. The
  closures happened minutes before this handoff; the reason is not
  recorded anywhere verifiable.
- **Open PRs now: #156, #162** (finding #8: cold auto-import via
  export index, head `8adcb4a`), **#165** (finding #21 second try:
  exact source mappings for identifier reads, head `bfd668f`).
- **Branch state:** steve-types-1/3/4 deleted local+remote (owner
  instruction, this morning). Remaining besides main:
  type-audit-verify-and-resolve, steve-types-2/5/6/21.2 (2 and 5
  back the just-closed #158/#161; 6 and 21.2 back open #162/#165),
  and the merged-but-undeleted remote `rename-guard-to-auth` (#185).

## Browser delivery — reconnaissance (the big next-session context)

Verified against the code today. Of ROADMAP's three browser-delivery
bullets, (a) and (b) are SHIPPED and Playwright-certified in CI:

- **Script-tag loading works end-to-end**: `processRipScripts`
  (src/browser-scripts.js, dist/browser/rip.js — the byte-gated
  bundle).
- **Module/package-graph delivery works end-to-end**:
  `assembleBundle` (src/bundle.js) → `bootApp` (src/browser-boot.js)
  → `launch` — SPA navigation, ETag revalidation (304), debug-gated
  source maps. 54 Node tests (browser-scripts 14, browser-modules 18,
  browser-boot 14, browser-bundle 8) plus packages/browser-tests
  (5 Playwright specs × Chromium/Firefox/WebKit) run in CI.

The REAL remaining work is bullet (c), dev-server integration:

- **No product surface serves `index.html`/`bundle.json`** — the only
  server is the certification fixture
  `packages/browser-tests/serve.mjs`.
- **No watch→browser transport exists anywhere in v4** — rg finds no
  SSE/EventSource/WebSocket watch machinery in src/ or
  packages/server (docs/HMR.md's claim of an existing SSE watch
  transport was FALSE against the code; corrected this handoff — the
  WS transport will be built new, not migrated).
- **`@rip-lang/ui/browser` cannot travel**: `rip.browser` is
  package-level (src/bundle.js rejects a package without the
  manifest flag), and ui can't claim it — its Tailwind half carries
  npm deps (css-tree, tailwindcss). Concrete blocker for the Philip
  UI stage.
- **No CSP-clean precompiled-JS path.** Owner leaning (2026-07-22
  midday): probably NEVER pure-JS-only — the compiler stays available
  on-the-fly; possibly hybrid later. Decision deliberately deferred;
  it does not block dev-server work.

**Three load-bearing rulings pending (owner has NOT ruled):**

1. **Serving hook** — natural split: bundle assembly manager-side per
   epoch, serving worker-side, doorbell/epoch as the revision source.
2. **Dev watch transport** — HMR ruled WebSocket, but edge doctrine
   gives WebSocket termination to Janus's hub: is dev exempt (plain
   local WS from the worker) or does it ride the hub?
3. **`rip.browser` granularity** — subpath metadata vs splitting
   ui/browser into its own package vs an assembly-time export filter.

## Open decisions / in-flight

- PR #156 go/no-go (above).
- The three browser-delivery rulings (above).
- Pending owner rulings from before: misc/PLAN.md + misc/FINALIZE.md
  deletion (recommended: delete — stale campaign machinery); the
  three untriaged misc/ directories (analysis/, server-v4-discarded/,
  vite/ — all still present); the bare-optional-parameters strict
  contract (docs/ROADMAP.md, Type and editor directions).

## Standing state (unchanged, spot-checked)

- **Edge ownership rulings stand**: Janus-with-Caddy owns
  proxy/stream execution, TLS, WebSocket termination (the hub),
  per-IP rate limiting, and body-size admission; identity-keyed
  quotas are application code; mDNS is dropped. Rip Server stops at
  publishing upstreams to the control plane.
- **Server remaining in-framework work** (README Planned + ROADMAP):
  the `--bridge` registration flag, hub ergonomics, and the opt-in
  file logging knob. TODO.md's server B-list stays open; its
  rip-mark access-log item now carries the note that it is
  inherently Janus-side work (the edge writes access logs).
- **Unnamed flake watch stands**: an unreproduced single-failure
  test:all run (two sightings, 2026-07-20/21; evidence points at
  timing sensitivity under machine load). If a logged run ever fails,
  capture the test NAME verbatim — identifying it matters more than
  the green rerun. (Today's logged runs: all green.)

## Next session: recommended starting point

- **Dev-server integration is the highest-leverage block**, and the
  reconnaissance above is its map: get the three rulings, then wire
  bundle/HTML serving into packages/server, build the WS watch
  transport (HMR Phase 0 — honest live reload), and settle
  `rip.browser` granularity so ui/browser can travel. It is the
  prerequisite for HMR (docs/HMR.md) and FRAME (docs/FRAME.md).
- The server Planned items (--bridge flag, hub ergonomics, file
  logging knob) are small and independent — good parallel work.
- The syntax reference (TODO.md, grammar drill-down) parallelizes with
  anything; owner-deprioritized.

## Upstream Bun thread

- **PR [oven-sh/bun#29291](https://github.com/oven-sh/bun/pull/29291)**
  (ESM bytecode without `--compile`): OPEN, head `fa97f46`, sole gate
  unchanged: codeowner review (REVIEW_REQUIRED). Re-verified via gh
  at this handoff. When it merges: canary build, then revisit the
  prebuild bytecode decision in `packages/server/manager.rip`.
- Issue [oven-sh/bun#34835](https://github.com/oven-sh/bun/issues/34835)
  (mmap the bytecode sidecar): OPEN, still exactly one comment (the
  owner's 2026-07-20 RoboBun-review request, cc @alii) — no maintainer
  response as of this handoff.
- Installed Bun: 1.3.14 (the last Zig release; Bun canary is the Rust
  port line).

## Working agreements (this collaboration)

- PRs land as TRUE MERGE commits — never squash-merged, never
  rebase-merged (AGENTS.md rule 9): a landed branch's tip stays an
  ancestor of main. Landing subject: `PR #N — <PR title>` via
  `gh pr merge N --merge --subject "PR #N — <title>"`.
- HANDOFF.md is tracked and rewritten at session boundaries with
  live-verified facts (owner ruling).
- Shared branches catch up by MERGE, never rebase; never force-push.
- Nothing pushed or posted without explicit owner approval.
- Red pin before fix: reproduce the defect as a failing test first.
- Adversarial review with at least one genuinely COLD pass before big
  merges (AGENTS.md rule 10; proven by #176's cold-caught defects).
- Every bug is fixed at the layer that owns it (rule 4).
- Anything posted publicly is fact-checked claim-by-claim first.

## Operational notes (this environment)

- The `user-ai` MCP: the Anthropic leg is OUT OF CREDITS (verified
  2026-07-22 early morning — the API returns a credit-balance error);
  the GPT leg works.
- `.handoff/bunpr-bench` — Bun #29291 validation evidence (benchmarks,
  memory results, upstream source excerpts). 15 MB, in-repo but
  invisible to git via `.git/info/exclude`. KEEP while Bun #29291 and
  #34835 are open; delete freely once both resolve. (Still present.)
- The /tmp scratch assets from prior sessions are GONE (only
  `/tmp/rip-report-demo` remains); `/tmp/janus-bench` no longer
  exists. Rebuild probes fresh if needed.
- Background subagents intermittently stalled right after their
  opening message (three occurrences 2026-07-21; unverified since).
  Recovery that worked every time: interrupt + resume with "restate
  your mandate and proceed". Detection: transcript mtime AND repo-tree
  writes AND new commits all stale >10 min.
