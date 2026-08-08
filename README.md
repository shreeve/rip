# Rip

Rip is a zero-build, full-stack language for reactive UI, schemas, ORM,
and server code. It runs directly under Bun, emits clean JavaScript,
type-checks through TypeScript 7, and ships a full LSP.

## Repository scope

This repository owns the complete Rip product:

- the lexer, grammar, parser generator, and compiler;
- precise bidirectional mappings between Rip and generated artifacts;
- reactive, schema, ORM, component, and standard-library runtimes;
- package and application infrastructure, including
  [`@rip-lang/sites`](packages/sites) (Agent, edge, tray, demos);
- VS Code/Cursor, Vim, and highlight.js integrations;
- language, mapping, type, runtime, corpus, and editor test contracts.

Every capability must preserve the compiler's mapping architecture and
carry correctness tests at the surfaces it affects.

Open product work is tracked in [docs/ROADMAP.md](docs/ROADMAP.md) and
package-local `TODO.md` files (for example
[packages/sites/TODO.md](packages/sites/TODO.md)).

## Documentation

**Working docs (read / rewrite while shipping):**

- [AGENTS.md](AGENTS.md) — mandatory repository rules and invariants
- [packages/AGENTS.md](packages/AGENTS.md) — first-party package mold and earned shapes

**Understanding (permanent contracts under `docs/`):**

- [docs/SERVER.md](docs/SERVER.md) — Sites, Janus, manager, worker architecture
- [docs/WORKSPACE.md](docs/WORKSPACE.md) — browser publication / apply contract
- [docs/TYPES.md](docs/TYPES.md) — type-system and editor architecture
- [docs/HMR.md](docs/HMR.md) — hot-module-replacement design
- [docs/FRAME.md](docs/FRAME.md) — Rip-native hypermedia design
- [docs/ROADMAP.md](docs/ROADMAP.md) — current open product work
- [docs/CLEANROOM.md](docs/CLEANROOM.md) — clean-room engine rewrite plan

## Core commands

```sh
bun run test:rip       # language suite (PR code check)
bun run test           # fast compiler/runtime suite
bun run test:all       # exhaustive: extended tier + every package
rip check [paths...]   # headless TypeScript checking over Rip source
bun run parser         # regenerate src/parser.js
bun run corpus
bun run audit
```

Package work: `bun run test` from that package directory (for example
`packages/sites`). Browser smoke: `bun run test:browser`.

`test:all` needs `xcaddy` on PATH for the Sites janus lane:

```sh
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
export PATH="$(go env GOPATH)/bin:$PATH"     # in your shell profile
```

`JANUS_CADDY=/path/to/caddy` supplies an existing janus-enabled binary
instead of building one.

## REPL

`rip` on a TTY (or `rip -r`) starts the interactive REPL: reactive
bindings persist across lines, input is syntax-highlighted live from
the real lexer, themes auto-detect the terminal background (`.theme`
to override), imports resolve against the session cwd, and `-e`
evaluates one entry. `.help` inside the session lists the commands.

## Sites (local HTTPS)

```sh
rip edge start
rip sites add packages/sites/demos/hello
rip sites start hello
# https://hello.ripdev.io/
```

Postures, tray, and LAN/`local` trust: [packages/sites/README.md](packages/sites/README.md).
