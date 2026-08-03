# HANDOFF — session launch document (2026-08-03)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session boundaries
with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.

## Active branch

**Branch: `close-findings` at `1977916`**, with the round-3 cold-review
closure uncommitted in the working tree.

Current working-tree facts:

- `rip check` refreshes `echoSpans` after its Tier-3 pin recompile, so
  component/schema echo diagnostics use the rebuilt face offsets.
- Tolerant parsing does not reopen spent repair candidates when it
  deletes a fabricated hole, and panic-delete diagnostics carry the
  parser state's expected-token set.
- Schema callable tolerance propagates unpositioned internal failures;
  the server comment states the actual last-good-face boundary.
- Component/schema behavior-const collision checks include module-level
  `def` and `class` bindings. Boolean aliases render as TypeScript
  `true`/`false` literal types in faces and declarations.
- The audit contract gates mapping-census decomposition, FaceOracle
  drift, stale hover pins, and an empty ruled-hover population. Its
  use-site scanner uses the lexer identifier vocabulary, compiler-owned
  all-scope binding inventory, and token-shaped static import spans.
- Identical mapped diagnostics still deduplicate before directive
  handling, now with a direct mutation-catching unit pin. The combined
  diagnostics audit supplied the firing TS7006 case.
- The round-3 ROADMAP/RULINGS/FINDINGS and audit-report wording is aligned
  with the live gates. Direct multi-line `toMatchable` coercion remains
  the ruled JavaScript-string behavior.
- Generated artifacts are current: `src/parser.js` and
  `dist/browser/rip.js`. Corpus regeneration changed no artifacts.

Live verification:

- `bun run test` — 6,080 passed, 35 extended-tier skips, 0 failed.
- `bun run audit` — 34/34 invariants green; every lane passed.
- `bun run corpus-expected` — 0 written, 186 unchanged, 0 removed.
- `bun run test:all` — 21 lanes, 8,283 tests passed. The documented
  `packages/browser-tests` lane remains a separate CI job.
- `git diff --check` — passed.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
