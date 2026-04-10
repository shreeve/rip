# Zag Project Handoff

## Current State (Phase 1 Complete)

```
Phase 0: Foundation          ████████████████████ DONE
Phase 1: Bootstrap Compiler  ████████████████████ DONE
Phase 2: Stronger Structure  ░░░░░░░░░░░░░░░░░░░░ NOT STARTED
Phase 3: Broader Semantics   ░░░░░░░░░░░░░░░░░░░░ NOT STARTED
```

**56-rule grammar, 18 audited conflicts, ~1,650 line compiler, 446 line test suite, 333kB binary (ReleaseSmall).**

The bootstrap compiler works end-to-end: Zag source → S-expressions → Zig source → native binary. All high-priority Zig features are expressible. A real embedded protocol handler compiles from Zag.

## Pipeline

```
Zag source → Rewriter (indent/outdent, minus classification)
           → Parser (SLR(1), 56 rules, S-expressions)
           → Type resolution pre-pass (symbol table, typeOf)
           → Zig emission (tag-based dispatch)
           → zig run
```

## File Roles

| File | Role |
|------|------|
| `zag.grammar` | Lexer + parser definition (56 rules) |
| `src/grammar.zig` | Language-agnostic grammar engine (reads .grammar, generates parser) |
| `src/parser.zig` | Auto-generated lexer + SLR(1) parser (never hand-edit) |
| `src/zag.zig` | Language module: Tag enum, keywords, rewriter (indent, minus classify) |
| `src/compiler.zig` | S-expression → Zig emitter + type resolution pre-pass |
| `src/main.zig` | CLI driver: parse, compile, run, tokens |
| `test/examples/all.zag` | Comprehensive regression test (446 lines) |
| `test/examples/protocol.zag` | Real embedded protocol handler converted to Zag |

## Build Commands

```bash
zig build grammar                            # build the grammar tool
./bin/grammar zag.grammar src/parser.zig     # generate parser from grammar
zig build                                    # build the zag compiler
./bin/zag test/examples/hello.zag            # parse → print S-expressions
./bin/zag --compile test/examples/all.zag    # emit Zig source
./bin/zag --run test/examples/all.zag        # compile and run end-to-end
./bin/zag --tokens test/examples/hello.zag   # dump token stream
```

## What's Done

### Grammar (56 rules, 18 audited conflicts)

- Declarations: `fun`, `sub`, `enum`, `struct`, `packed struct`, `error`, `type`, `test`, `use`
- Modifiers: `pub`, `extern`, `export`, `packed`, `inline`, `comptime`, `callconv` (stackable)
- Control flow: `if`/`else`/`else if` (prefix + postfix), `while`, `for`/`for *item`, `match`
- Match patterns: literals, wildcards, enum `.variant`, range `a..b` (`pattern` nonterminal)
- Labeled flow: `:name` prefix labels statements, `break :label [expr]`, `continue :label`
- Captures: `as val`, `|val|` in `if`/`while`
- Bindings: `=`, `=!`, `+=`, `-=`, `*=`, `/=`, scope-tracked `var`/`const`
- Operators: `??`, `catch`, `try`, `|>`, `..`, `**`, all arithmetic/comparison/logical
- Types: `?T`, `*T`, `[]T`, `!T`, `[N]T`, `[*]T`, `[*:S]T`, `*volatile T`
- Atoms: integers (hex/bin/oct), reals, strings, booleans, arrays, struct literals, lambdas, `@builtins`
- Features: tagged unions, enum values, struct methods, defer/errdefer, `_` discard, pointer deref `ptr.*`

### Rewriter

- Indentation tracking (indent/outdent token synthesis)
- Whitespace-sensitive minus: tight `-` is negation, spaced `-` is subtraction
- `term` nonterminal: implicit calls accept `-expr` and `!expr` without parens
- Duplicate newline suppression, comment handling, leading blank line suppression

### Type Resolution Pre-Pass

- `FnInfo` symbol table: name, return type, is_void, is_pub, is_extern, has_untyped_params
- Void-call detection: bare calls to void functions skip `_ = ` prefix
- `typeOf()`: infers types for bools, `!expr`, calls to typed functions
- Var binding inference: `var x: i32 = add(1,2)` from callee return type
- Declaration warnings: untyped pub/extern params and return types

### Compiler

- Tag-based dispatch on S-expression nodes
- Shared `emitStructBody` for struct/extern struct/packed struct
- All v0 emission gaps resolved (struct literals, lambdas, error unions, enum backing, `/=` → `@divTrunc`)
- Source diagnostics: recognizable temp filenames, error pointer on failure

### Audited Conflicts (18)

1. Dangling else: if vs ELSE (×1), while vs ELSE (×2), for vs ELSE (×4), postif vs ELSE (×1) — standard, shift correct
2. Typed binding (unary vs ":") — shift into type annotation, correct
3. Labeled break (break vs ":") — shift into label, correct
4. Labeled continue (continue vs ":") — shift into label, correct
5. Postfix-if on flow control: return vs POST_IF (×2), break vs POST_IF (×2), continue vs POST_IF (×2) — shift into conditional, correct
6. Args vs "}" (×1) — shift correct

## What's Left

### Phase 1 Leftovers (tiny, do whenever)

| Item | Notes |
|------|-------|
| Multi-line strings | Deferred: triple-quote `"""` DFA conflicts with `"string"`. `zig '...'` escape covers the need. |
| Await (`call!`) | Deferred until Zig 0.16.0 restores async. Will use tight-bang rewriter split. |
| Anonymous struct types | `.{ .x = 1, .y = 2 }` without a named type. Nice-to-have. |

### Phase 2: Stronger Internal Structure

This is the next frontier. Nothing is started.

| Item | What it means | Complexity |
|------|---------------|-----------|
| **Normalization pass** | Desugar syntax variants into canonical forms before emission. Keeps emitter from growing into a mess of special cases. | Medium (design decisions) |
| **Expression type propagation** | `a + b` where `a: i32, b: i32` → result is `i32`. Walk expression tree, combine types through operators. | High |
| **Cross-assignment type checking** | `x = foo()` then `x = bar()` — are the types compatible? Error or widen? | High |
| **Internal type representation** | Replace raw Sexp types with a proper type enum/struct. Needed when `isVoidType` / structural comparison isn't enough. | High (architectural) |
| **Cross-module symbol resolution** | `use std` → know what `std.debug.print` returns. The hardest single piece. | Very high |
| **Zig error line → Zag source line** | Full line-level remapping (current version just shows the temp file path). | Medium |

**Entry point recommendation:** The normalization pass is the safest Phase 2 starter — it's design work that makes everything after it easier. Expression type propagation is the highest-impact item.

### Phase 3: Broader Language Semantics (distant)

Full pointer/mutability story, FFI boundaries, capability packs (`use regex`), custom backend.

## Key Design Decisions Made

1. **`=` auto-infers var/const** — no let/var/const/mut keywords. `=!` forces const.
2. **Whitespace-sensitive minus** — tight `-` is negation, spaced `-` is subtraction. Documented language rule, not a hack.
3. **`term` nonterminal** — implicit call args accept prefix `-`/`!` via a restricted grammar level between `atom` and `unary`.
4. **Await removed** — `call "!" atom` rule removed since Zig 0.15.x has no async. Will return with tight-bang rewriter split when Zig 0.16.0 ships.
5. **Modifiers are composable** — `pub packed struct`, `extern fun`, `export sub` all work via recursive `decl` wrapping.
6. **Labeled flow uses `:name` prefix** — `:outer while cond` / `break :outer`. Separate `break_to`/`continue_to` tags avoid trailing-nil ambiguity.
7. **Type resolution is a pre-pass, not a separate phase** — `buildSymbolTable` runs before emission in `compiler.zig`. Grows into a real phase when needed.

## External References

- `rip-lang` at `/Users/shreeve/Data/Code/rip-lang/` — the original rip-lang project (JS-targeting)
- `pico` at `/Users/shreeve/Data/Code/pico/` — embedded firmware, source of protocol.zag
- Zig 0.15.2 — see `ZIG-0.15.2.md` for breaking I/O changes
- AI peer MCP available (`user-ai`) with chat/review/discuss/status tools

## AI Collaboration Notes

- GPT-5.4 was consulted on the Tier 1/2 plan (reordered type resolution, proposed `pattern` nonterminal, analyzed `L(unary)` conflict)
- GPT-5.4 confirmed no grammar-only fix for prefix minus ambiguity in SLR(1) — rewriter split is the correct approach
- The `classifyMinus` rule was refined collaboratively: the user's insight that "tight minus = negation, period" simplified the algorithm from the original GPT-5.4 proposal
