# HANDOFF — session launch document (2026-07-27, early morning)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only. Every fact below was
verified live on 2026-07-27 ~1:30 AM (UTC-6) against git, gh, the
files, and fresh suite runs, except where an older verification date
is stated explicitly.

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

## State of main (tip 316f9ab, landed 2026-07-24)

- Suites, re-run live at this handoff: repo-root `bun run test:all` →
  **5954 pass / 0 fail** (26.2s); packages/server `bun run test` (its
  own loop) → **134/134**; `bun run type-audit` → **60 dimension
  checks, all passing**. Main's CI (316f9ab) is green.
- Main has NOT moved since 2026-07-24. The single landing since the
  2026-07-22 true-up (`73d71f3`) is `316f9ab` — **docs/WORKSPACE.md,
  the Rip Workspace constitution** (owner rulings 2026-07-23, polish
  2026-07-24), plus its ROADMAP wiring. It locks Q1–Q5 (Pure Rip with
  invisible Projection; signed cells and CSP without `unsafe-eval` on
  the happy path; Hub ding only in dev, HTTP carries bytes and never
  bodies; stable path-derived-at-birth component ids; research-first
  apply quality against the written S1–S15 scenario suite; M1 without
  RipFS/OPFS), fixes the door-vs-apply split (door = the contract;
  apply = a replaceable engine in packages/refresh), assigns package
  ownership, sets kill-switch rules under `RIP_WORKSPACE=1`, and
  defines milestones M0 (sealed populate) and M1 (live-mutate door).
  Experimental until apply research lands; never a Janus capability.
- Everything on main since the last CODE landing (`588b41f`,
  2026-07-22) is docs-only (HANDOFF, TODO, HMR.md, ROADMAP.md,
  WORKSPACE.md — verified by diff), so the 2026-07-22 code
  reconnaissance below still describes the live code.

## PR #156 and the findings series

- **PR #156** "Type-audit verify-and-resolve (preview)" — DRAFT, head
  `bb04a63`, CI SUCCESS, mergeStateStatus CLEAN, and now FULLY caught
  up with main: two catch-up merges landed 2026-07-24 (`a5f84e7`
  through 73d71f3, then `bb04a63` through 316f9ab), so the merge-base
  with main is 316f9ab itself. Diff vs main: 156 files,
  +13,562/−5,252.
- **No weekend work landed**: the branch head is unchanged since
  2026-07-24, and Philip's findings ledger
  (`test/type-audit/FINDINGS.md` on the branch) still runs to
  **finding #50**. Recent open findings include the type sub-language
  boundary cases (#45 type predicates vs rip's `is`, #46 mapped types
  rejected by the type-body validator, #48 method members in inline
  type bodies, #49 import type cannot name a `.rip` module) and #50
  (tuple-element diagnostics positioned on the whole list).
- Still blocked solely on owner + Philip go/no-go; UI work begins with
  Philip after it lands.
- **PR #162 (finding #8, cold auto-import) is CLOSED** — closed by the
  owner 2026-07-24 16:38 UTC, not merged, no comment or landing note
  recorded on the PR. Its branch `steve-types-6` was deleted from the
  remote 2026-07-27 06:43 UTC (minutes before this handoff).
- **PR #165 (finding #21 second try, identifier read mappings)** —
  OPEN, head `bfd668f`, mergeStateStatus DIRTY (conflicts with main),
  now 88 commits behind, no CI on its head. Its subject is the top of
  #156's findings road; its fate (rework vs close) is an open owner
  decision.
- **Branch inventory is clean**: main, `type-audit-verify-and-resolve`
  (#156), `steve-types-21.2` (#165) — local and remote, nothing else.

## Browser delivery / Rip Workspace (the big next-session context)

The 2026-07-22 reconnaissance stands (code unchanged since; see
above): script-tag loading and module/package-graph delivery are
SHIPPED and Playwright-certified in CI; no product surface serves
`index.html`/`bundle.json` (only the certification fixture
`packages/browser-tests/serve.mjs`); no watch→browser transport
exists anywhere in v4.

WORKSPACE.md resolved two of the three rulings that were pending at
the last handoff:

1. **Dev watch transport — SETTLED (Q2)**: Hub ding (Janus's existing
   hub carries tiny invalidate notices in watch mode), HTTP carries
   the bytes, the Hub never carries bodies. This supersedes HMR.md's
   inline-WebSocket payload rows (ROADMAP says so explicitly).
2. **Serving split — SETTLED (ownership table)**: the muscles (disk
   watch, path→id map, rev bump, HTTP cells/manifest) live in
   `packages/server` as a thin feed; the reactive bag is
   `packages/workspace`, never inside server; the doorbell is Janus.
   Bootstrap order: flag on → `packages/workspace` → thin server
   feed → Hub doorbell.
3. **`rip.browser` granularity — STILL OPEN** (ROADMAP): the flag is
   package-level, so `@rip-lang/ui/browser` cannot travel while the
   package's Tailwind half carries npm deps. Subpath metadata vs a
   package split vs an assembly-time export filter — no ruling.

The CSP-clean precompile leaning (2026-07-22: probably never
pure-JS-only; the compiler stays available on-the-fly) stands but
does NOT override Workspace M0 on the Workspace path (signed cells +
CSP without `unsafe-eval` on the happy path).

## Open decisions / in-flight

- **PR #156 go/no-go** (owner + Philip) — the gating decision for the
  whole findings series and the UI stage after it.
- **Philip's queued language rulings**, all verified open in the
  ledger: finding **#36** (a reactive import serves the raw cell —
  auto-deref vs cell-as-API), **#45** (type predicates inside type
  bodies collide with rip's `is`), **#46** (admit or ban mapped
  types).
- **Fate of PR #165** (DIRTY, 88 behind; subject is top of #156's
  findings road).
- **`rip.browser` granularity** (above).
- Pending owner rulings from before (all still unruled; the files are
  still present): misc/PLAN.md + misc/FINALIZE.md deletion
  (recommended: delete — stale campaign machinery); the three
  untriaged misc/ directories (analysis/, server-v4-discarded/,
  vite/); the bare-optional-parameters strict contract
  (docs/ROADMAP.md, Type and editor directions).

## Standing state (unchanged, spot-checked)

- **Edge ownership rulings stand**: Janus-with-Caddy owns
  proxy/stream execution, TLS, WebSocket termination (the hub),
  per-IP rate limiting, and body-size admission; identity-keyed
  quotas are application code; mDNS is dropped. Rip Server stops at
  publishing upstreams to the control plane.
- **Server remaining in-framework work** (README Planned + ROADMAP):
  the `--bridge` registration flag, hub ergonomics, and the opt-in
  file logging knob — plus, new since WORKSPACE.md, the thin
  Workspace feed (muscles) when that work starts.
- **Unnamed flake watch stands**: an unreproduced single-failure
  test:all run (two sightings, 2026-07-20/21; timing sensitivity
  under machine load suspected). If a logged run ever fails, capture
  the test NAME verbatim — identifying it matters more than the green
  rerun. (This handoff's runs: all green.)

## Next session: recommended starting point

- **Workspace M0 / dev-server integration** is the highest-leverage
  block, and WORKSPACE.md is now its constitution: the transport and
  serving-split rulings are in hand, so the work is wiring the thin
  server feed and `packages/workspace` under the kill-switch rules,
  plus settling `rip.browser` granularity so ui/browser can travel.
- The **#156 go/no-go** is the gating OWNER action — everything in
  the findings series and the Philip UI stage queues behind it.
- The server Planned items (--bridge flag, hub ergonomics, file
  logging knob) are small and independent — good parallel work.

## Upstream Bun thread

- **PR [oven-sh/bun#29291](https://github.com/oven-sh/bun/pull/29291)**
  (ESM bytecode without `--compile`): OPEN, head `fa97f46`, sole gate
  unchanged: codeowner review (REVIEW_REQUIRED). No activity since
  2026-07-20; re-verified via gh at this handoff. When it merges:
  canary build, then revisit the prebuild bytecode decision in
  `packages/server/manager.rip`.
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

- The `user-ai` MCP: the Anthropic leg was OUT OF CREDITS as of
  2026-07-22 early morning (the API returned a credit-balance error);
  the GPT leg worked. Not re-verified this session.
- `.handoff/bunpr-bench` — Bun #29291 validation evidence (benchmarks,
  memory results, upstream source excerpts). 15 MB, in-repo but
  invisible to git via `.git/info/exclude`. KEEP while Bun #29291 and
  #34835 are open; delete freely once both resolve. (Still present.)
- /tmp scratch: only `/tmp/rip-report-demo` remains; `/tmp/janus-bench`
  is gone. Rebuild probes fresh if needed.
- Background subagents intermittently stalled right after their
  opening message (three occurrences 2026-07-21; unverified since).
  Recovery that worked every time: interrupt + resume with "restate
  your mandate and proceed". Detection: transcript mtime AND repo-tree
  writes AND new commits all stale >10 min.
