# TODO — open design / correctness notes

Scratchpad for decisions and footguns we must not lose. Not a roadmap;
permanent product docs live under `docs/`. Remove items when fixed or
moved into real docs/tests — git history and PR bodies are the record
of completed work.

Package-local leftovers live beside the package (for example
[`packages/sites/TODO.md`](packages/sites/TODO.md)).

---

## Documentation

- [ ] Write the REAL syntax reference: drill down from
      `src/grammar/grammar.rip`, the lexer's context-sensitive behavior
      (retags like `POST_IF`), and the battery (the syntax contract)
      into an authoritative document. It takes the `docs/SYNTAX.md`
      name when it exists. Cross-check the three editor grammars for
      drift while at it.

---

## Distribution

- [ ] Owner call: CLI publish channel (npm/bunx vs other), thin-client
      vs self-contained VS Code extension, timing. Blocks marketplace
      publish of the extension.

---

## Workspace feed

- [ ] When an editor producer lands (M2), `crossRun` cannot distinguish
      "another run" from "another producer": a local write over a
      server-owned id bumps the rev with local bytes, and the next
      resync would reload and discard the local edit. Unreachable
      today — nothing writes server-owned ids locally.

---

## HMR

Constitution and end-state: [docs/HMR.md](docs/HMR.md). Cart Gate A/B
are green on `packages/browser-tests` `test:cart`. Open compression
targets live in that doc (quarantine state machine, router/content
decoupling) — not a morph project.

- [ ] Do **not** lead with migrate-on-confirmation: `__hmrPreserveState`
      only copies `:=` sig slots, so migrate remounts a fresh
      `createMutation` and drops `succeeded`. Profile form survival
      remains a weaker pin.

## Test-lane audits (remaining)

Edit / milestone / landing gates and PR vs certification CI already
landed. Still worth a focused pass when touching that package:

- [ ] `packages/app` — consolidate repeated Workspace/apply scenarios
      around shared transactional invariants.
- [ ] Root compiler suite — collapse permutations already covered by
      battery, corpus, mapping, or generated-byte gates.
- [ ] `packages/vscode` — separate fast protocol/unit behavior from
      tsgo process integration and editor-wide certification.
