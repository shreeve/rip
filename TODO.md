# TODO — open design / correctness notes

Scratchpad for decisions and footguns we must not lose. Not a roadmap;
permanent product docs live under `docs/`. Remove items when fixed or
moved into real docs/tests — git history and PR bodies are the record
of completed work.

---

## Documentation

- [ ] Write the REAL syntax reference: drill down from
      `src/grammar/grammar.rip`, the lexer's context-sensitive behavior
      (retags like `POST_IF`), and the battery (the syntax contract)
      into an authoritative document. It takes the `docs/SYNTAX.md`
      name when it exists. Cross-check the three editor grammars for
      drift while at it.

---

## Workspace feed

- [ ] When an editor producer lands (M2), `crossRun` cannot distinguish
      "another run" from "another producer": a local write over a
      server-owned id bumps the rev with local bytes, and the next
      resync would reload and discard the local edit. Unreachable
      today — nothing writes server-owned ids locally.
