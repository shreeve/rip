# Rip

Rip is a zero-build, full-stack language for reactive UI, schemas, ORM,
and server logic. It runs directly under Bun, emits clean JavaScript,
type-checks through TypeScript 7, and ships a full LSP.

## Repository scope

This repository owns the complete Rip product:

- the lexer, grammar, parser generator, and compiler;
- precise bidirectional mappings between Rip and generated artifacts;
- reactive, schema, ORM, component, and standard-library runtimes;
- package and application infrastructure;
- VS Code/Cursor, Vim, and highlight.js integrations;
- language, mapping, type, runtime, corpus, and editor test contracts.

Every capability must preserve the compiler's mapping architecture and
carry correctness tests at the surfaces it affects.

The compiler, feature runtimes, schema/ORM core, and editor integrations
are present. The remaining package and application portfolio is tracked
in [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentation

- [AGENTS.md](AGENTS.md) — mandatory repository rules and invariants
- [docs/SYNTAX.md](docs/SYNTAX.md) — context-sensitive syntax reference
- [docs/TYPES.md](docs/TYPES.md) — type-system and editor architecture
- [docs/HMR.md](docs/HMR.md) — hot-module-replacement design
- [docs/ROADMAP.md](docs/ROADMAP.md) — current open product work
- [CHANGELOG.md](CHANGELOG.md) — shipped and unreleased changes

## Core commands

```sh
bun run test:rip       # language battery
bun run test           # fast compiler/runtime suite
bun run test:all       # canonical extended suite
bun run parser         # regenerate src/parser.js
bun run corpus-expected
bun run type-audit
```
