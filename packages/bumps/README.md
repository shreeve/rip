<img src="/logo.png" style="width:50px" />

# BUMPS — A modern, Bun‑powered MUMPS (M) runtime

BUMPS is a clean‑room implementation of MUMPS/M built on **Bun** (the extremely fast JavaScript runtime written in Zig). It’s a respectful, modern take on a beloved language — familiar to mumpsters, designed for today.

> Name: “BUMPS” (short: **B**) — a hat tip to MUMPS, powered by Bun.

## Goals

- Faithful core semantics of MUMPS/M (globals, routines, intrinsic ops)
- Modern ergonomics and tooling (Bun, TypeScript interop, tests)
- Performance‑first runtime choices with a portable implementation
- Clean room: no code, binaries, or artifacts from existing M runtimes

## Why BUMPS

- **Heritage, not parody**: BUMPS honors MUMPS’ legacy while embracing modern infrastructure
- **Bun speed**: A fast event loop, native HTTP, and excellent I/O backed by Zig
- **Developer friendly**: Great DX, package scripts, tests, and clear extension points

## Project Scope (initial)

1. Parser and AST for core M syntax
2. Interpreter for core operations and intrinsic functions
3. Globals store (pluggable):
   - In‑memory store (dev/testing)
   - File‑backed store (append‑only journal + compaction)
   - Future: embeddable key/value engines
4. Routine loader/executor (with simple module boundaries)
5. CLI entry (`bun run bumps`) with scripts and test rig

## Roadmap (early sketch)

- [ ] Grammar + tokenizer + AST
- [ ] Core evaluator (expressions, intrinsic functions, control flow)
- [ ] Basic global storage (in‑memory)
- [ ] File‑backed globals (journal + snapshot)
- [ ] Routine execution + simple modules
- [ ] CLI + REPL (optional)
- [ ] Interop layer (TypeScript hooks for host integrations)

## Design Principles

- **Respect the language**: don’t “improve” M away — emulate faithfully first
- **Make it testable**: golden tests for grammar and execution
- **Make it portable**: Bun runtime primary; minimize platform‑specific code
- **Keep it clear**: readable code, clear types, and focused modules

## Quick Start (placeholder)

```bash
# Install Bun if needed
curl -fsSL https://bun.sh/install | bash

# Run the (future) CLI
bun run bumps --help
```

> Note: The runtime is in active development. APIs and artifacts are likely to change.

## Community

Feedback from mumpsters and folks who appreciate M’s unique strengths is very welcome. Open issues with examples, edge cases, or historical behaviors you want preserved.

---

<div align="center">Built with ❤️ for the Bun community</div>
