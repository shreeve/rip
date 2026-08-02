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
- [docs/TYPES.md](docs/TYPES.md) — type-system and editor architecture
- [docs/HMR.md](docs/HMR.md) — hot-module-replacement design
- [docs/ROADMAP.md](docs/ROADMAP.md) — current open product work
- [docs/CLEANROOM.md](docs/CLEANROOM.md) — the clean-room engine rewrite plan (activates when v4 is declared done)

## Core commands

```sh
bun run test:rip       # language battery
bun run test           # fast compiler/runtime suite
bun run test:all       # canonical full suite: extended tier + every package
bun run parser         # regenerate src/parser.js
bun run corpus-expected
bun run audit
```

`test:all` needs `xcaddy` on PATH for the `packages/server` janus lane:

```sh
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
export PATH="$(go env GOPATH)/bin:$PATH"     # in your shell profile
```

`go install` writes to `$(go env GOPATH)/bin`, which is not on PATH by
default — without the second line the lane fails as though xcaddy were
never installed. It builds a Caddy binary from the published Janus module
on first run and caches it. `JANUS_CADDY=/path/to/caddy` supplies an
existing janus-enabled binary instead.

## REPL

`rip` on a TTY (or `rip -r`) starts the interactive REPL: reactive
bindings persist across lines, input is syntax-highlighted live from
the real lexer, themes auto-detect the terminal background (`.theme`
to override), imports resolve against the session cwd, and `-e`
evaluates one entry. `.help` inside the session lists the commands.
