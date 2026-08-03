# HANDOFF — session launch document (2026-08-03)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session boundaries
with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.

## Active branch

**Branch: `close-findings`.** Round-3 review closure is committed at
`5c8f442`. Three independently reviewed extractions from the retired
`dragged-over` branch follow it:

- `cabc359` uses the lexer's identifier vocabulary for Unicode-sensitive
  compiler, checker, mapping-audit, and masking spans.
- `c226fa2` carries an import reference's original exported name through
  metadata so direct and aliased semantic-token corrections agree.
- `e5545e6` discovers import-type closure edges from authored syntax while
  excluding strings, comments, property access, and larger identifiers.

There is one checkout and one worktree, at this repository path. The local
`dragged-over` branch was deleted after its useful changes were reimplemented
and verified on `close-findings`; no code remains stranded in another
worktree or branch.

Generated artifacts are current: `src/parser.js` and `dist/browser/rip.js`.
Corpus regeneration changed no expected-output artifacts.

Live verification:

- `bun run audit` — 34/34 invariants green; every lane passed.
- `bun run test:all` — 21 lanes, 8,293 tests passed. The documented
  `packages/browser-tests` lane remains a separate CI job.
- `bun run corpus-expected` — 0 written, 186 unchanged, 0 removed after
  the compiler-facing extractions.
- `bun test test/project-model.test.js` from `packages/vscode` — 29 passed,
  0 failed after the import-type extraction.
- `git diff --check` — passed for each extraction and cumulatively.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
