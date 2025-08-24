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

## How to use / compile / test

1) **Build the Zig lexer library** (optional, but recommended for speed):

```bash
# macOS
zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.dylib

# Linux
zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.so
```

Place the resulting library where your process can load it, either:
- in the same directory as `zig-lex.js` (the loader looks for `./libmumps_lex.*` by default), or
- by setting an absolute path via the environment variable `ZIG_MUMPS_LEX_PATH`.

Examples:

```bash
# macOS: point to an absolute path
ZIG_MUMPS_LEX_PATH=/abs/path/libmumps_lex.dylib \
  bun run demo-parse.js sample.m

# Linux: point to an absolute path
ZIG_MUMPS_LEX_PATH=/abs/path/libmumps_lex.so \
  bun run demo-parse.js sample.m

# Or simply place the built lib next to zig-lex.js and run:
bun run demo-parse.js sample.m
```

2) **Run the demo** (falls back to pure JS if the Zig lexer isn’t found):

```bash
bun run demo-parse.js sample.m
```

This will:
- Try the Zig-token path (`parseMumpsWithTokens`) if the dylib/so is found via `zig-lex.js`.
- Otherwise fall back to pure JS parsing (`parseMumps`).
- Print parse/lex timings and a formatted output of the sample, with:
  - command abbreviations (`S`, `W`, `I`, …),
  - `SET` equals aligned,
  - comments padded to column 48.

3) **Parse your own file** (minimal script):

Create a script called `demo-parse.js` like this, then run `bun run demo-parse.js path/to/your.m`:

```js
import { parseMumps, parseMumpsWithTokens } from "./mumps-parser-pro.js";
import { zigLex } from "./zig-lex.js";

const path = process.argv[2];
const text = await Bun.file(path).text();
const buf = new TextEncoder().encode(text);
const toks = zigLex(buf);
const ast = toks ? parseMumpsWithTokens(buf, toks) : parseMumps(buf);

console.log(
  ast.format({
    abbreviateCommands: true,
    alignSetEquals: true,
    commentColumn: 48,
    betweenCommands: "  ",
    spaceAfterCommand: " ",
  })
);
```

Tip: to benchmark parsing speed on your machine, prefix the run with `time`.

## Community

Feedback from mumpsters and folks who appreciate M’s unique strengths is very welcome. Open issues with examples, edge cases, or historical behaviors you want preserved.

---

## Building (macOS/Linux)

```bash
# macOS dylib
zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.dylib

# Linux .so
zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.so
```

<div align="center">Built with ❤️ for the Bun community</div>
