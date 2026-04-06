# Rip Session State

Last updated after commit `5b14a5e` on `origin/main`.

## What Rip Is

Rip is a high-performance systems language with elegant syntax that compiles to Zig source code. The Zig toolchain then handles code generation, optimization, linking, and cross-compilation. Think of it as: beautiful syntax on top, Lisp-like S-expression core in the middle, Zig-level performance underneath.

## What Is Working

The end-to-end pipeline from Rip source to raw S-expressions is working:

```
rip.grammar → grammar.zig → parser.zig (generated) → raw sexps
```

Tested and verified:
- `fun` declarations with parameters
- `sub` declarations with parameters  
- multiple functions in one file (with blank lines between)
- unary operators: `-x` → `(neg x)`, `!flag` → `(not flag)`
- binary operators via `@infix` (auto-generated precedence chain)
- optional type annotations silently stripped by rewriter
- typed and untyped source produce identical parse output
- indentation-sensitive blocks via wrapper lexer

Example:
```text
fun add a: i32, b: i32 -> i32
  a + b
```
produces:
```lisp
(module (fun add (a b) (block (+ a b))))
```

## What Is NOT Yet Working

- assignment: `total = add 1, 2`
- constant binding: `limit =! 100`
- function calls with arguments: `add 1, 2`
- call-site `!` for await: `fetch! url`
- `if` / `else`
- `sub` with body statements
- `return`
- `use` declarations (grammar accepts them but not tested)
- string literals in expressions
- boolean literals
- the full `hello.rip` example fails on calls/assignment
- normalization pass (raw sexps only so far)
- type resolution
- Zig source emission

## Key Design Decisions

### Language Surface
- `fun` = value-yielding routine (implicitly yields final expression)
- `sub` = effect-oriented routine (no implicit yield)
- `=` for binding, `=!` for constant binding (no `let`/`const` keywords)
- call-site `!` means `await`
- `?` is a valid identifier suffix (part of the name)
- types are optional in source, stripped by rewriter before parsing
- `:` is the type annotation marker (stripped, stored as metadata)
- `->` is the return type marker (also stripped)
- `use` enables capability packs (downstream compilation feature)

### Architecture
- `rip.grammar` is the single source of truth for lexer + parser
- `src/grammar.zig` is a language-agnostic grammar engine (forked from slash, cleaned)
- `src/rip.zig` is the Rip language module: keyword lookup + wrapper lexer
- `src/parser.zig` is auto-generated (do not edit by hand)
- the wrapper lexer in `rip.zig` handles: indentation, type stripping, duplicate newline suppression
- types are metadata, not grammar — the parser never sees them
- the rewriter is a first-class layer between lexer and parser
- audited LR conflicts are acceptable (`@expect = 18`)

### Grammar Engine Features
- `@infix` directive auto-generates operator precedence chains
- `@errors` directive maps rules to human-readable names
- `L(X)` and `L(X, sep)` for comma/custom-separated lists
- `_`, `...N`, `key:N`, `~N` action features from the DSL
- `@as`, `@op`, `@code`, `@lang` extension hooks
- multiple start symbols with `name!`

### Token Metadata Contract
- `.pre` — preceding whitespace count
- `.spaced` — has preceding whitespace (derived)
- `.lineStart` — begins a logical line
- `.lineEnd` — followed by a logical line break  
- `.loc` — source location
- `.data` — extra metadata (future: type info side table)

### Type System
- optional in source, required before Zig emission
- `rip-lang` front-end philosophy: selective, lightweight annotations
- Zig-like back-end discipline: concrete types before codegen
- type info will be stored in a side table (not on the 8-byte Token struct)
- type resolution is a dedicated compiler phase after normalization

## File Inventory

| File | Lines | Role |
|------|-------|------|
| `rip.grammar` | ~394 | Language definition: lexer + parser rules |
| `src/grammar.zig` | ~6534 | Grammar engine: reads .grammar, generates parser |
| `src/rip.zig` | ~280 | Language module: keywords, Tag enum, wrapper lexer |
| `src/parser.zig` | ~1020 | Auto-generated lexer + SLR(1) parser |
| `src/main.zig` | ~43 | Compiler driver: reads .rip files, prints sexps |
| `src/dump_tokens.zig` | ~33 | Debug tool: dumps raw token stream |
| `build.zig` | ~80 | Build system: grammar tool, main exe, tests |
| `ZIG-0.15.2.md` | ~1070 | Zig 0.15.2 API reference (critical for I/O changes) |
| `examples/tiny.rip` | 3 | Minimal untyped example |
| `examples/typed.rip` | 3 | Same example with type annotations |
| `examples/hello.rip` | 10 | Full example (not yet fully parsing) |
| `examples/unary.rip` | 6 | Unary operator test |
| `docs/architecture.md` | | Pipeline, stage boundaries, design principles |
| `docs/roadmap.md` | | Phase 0-3, compiler stages, parsing philosophy |
| `docs/language-sketch.md` | | Principles, routine semantics, examples, sexps |
| `docs/v0-syntax.md` | | Bootstrap syntax spec with sexp shapes |
| `docs/v0-grammar-sketch.md` | | First grammar nonterminals and implementation order |
| `docs/rip-syntax-responsibilities.md` | | Per-form responsibility across pipeline stages |
| `docs/grammar-system-lessons.md` | | Lessons from rip-lang, slash, mumps |
| `docs/type-system-direction.md` | | rip-lang front-end + Zig back-end synthesis |
| `docs/findings/zig-parsing-notes.md` | | How Zig handles parsing (from source inspection + peer AI) |

## External References

- `rip-lang` at `/Users/shreeve/Data/Code/rip-lang/` — JS-targeting Rip with grammar.rip, lexer.js, types.js
- `slash` at `/Users/shreeve/Data/Code/slash/` — shell language, original grammar.zig source
- `em` at `/Users/shreeve/Data/Code/em/` — MUMPS language, grammar DSL docs at `docs/language/GRAMMAR.md` and `LEXER.md`
- Zig source at `misc/zig/` — vendored Zig compiler for reference
- AI MCP at `/Users/shreeve/Data/Code/rip-lang/packages/ai/mcp.rip` — peer AI with status/chat/review/discuss + per-call model override

## Build Commands

```bash
zig build grammar          # build the grammar tool
./bin/grammar rip.grammar src/parser.zig  # generate parser from grammar
zig build                  # build the rip compiler
./bin/rip examples/tiny.rip  # parse a .rip file and print sexps
zig build test             # run rip.zig tests
```

## Next Concrete Tasks

Priority order for getting the full v0 bootstrap working:

1. **Get `hello.rip` parsing end-to-end** — needs:
   - assignment expressions (`total = add 1, 2`)
   - function calls with arguments (implicit call detection or explicit syntax)
   - `if` / `else` blocks
   - `sub` with body
   
2. **Implicit call syntax** — the rewriter should detect `name arg1, arg2` and insert call structure before parsing

3. **String literals in expressions** — basic string support in the parser

4. **Normalization pass** — transform raw sexps into canonical forms

5. **Type resolution stub** — minimal pass that fills in concrete types

6. **Zig emission** — generate valid Zig source from typed sexps

## Important Gotchas

- Zig 0.15.2 has a completely new I/O API ("Writergate") — see `ZIG-0.15.2.md`
- `src/parser.zig` is auto-generated — never edit it directly
- the grammar engine still has dormant pattern-mode code (conditional on `pat` state, which Rip doesn't declare)
- heredoc support was intentionally removed from grammar.zig — it belongs in rip.zig using the rip-lang approach (triple-quote with closing-sigil margin detection)
- the `@infix` directive generates a nonterminal called `infix_expr` — reference it in grammar rules
- type stripping in the wrapper lexer currently discards type info; a side table for preservation is designed but not yet implemented
