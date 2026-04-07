# Rip Roadmap

## Guiding Strategy

Build the smallest credible version of `Rip` first.

That means:

- keep v0 semantically close to what `Zig` can express cleanly
- prove the source language shape before inventing deeper machinery
- add new compiler layers only when the simpler pipeline stops being enough
- keep the core language small, and move non-core power into optional capability packs
- keep the first passes in S-expression form instead of inventing extra representations too early
- allow types to stay optional in source while requiring full resolution before Zig emission

## Phase 0: Foundation ✓

Goal: make the project understandable and directionally credible.

Deliverables (all complete):

- expanded `README`
- architecture overview (`docs/architecture.md`)
- roadmap (`docs/roadmap.md`)
- initial language sketch (`docs/syntax.md`)
- compact v0 syntax/type spec (`docs/types.md`)
- grammar-system lessons from `rip-lang`, `slash`, and `mumps` (`docs/lessons.md`)
- grammar DSL reference (`docs/dsl.md`)

## Phase 1: Bootstrap Compiler (in progress)

Goal: compile a tiny `Rip` subset into valid `Zig`.

Primary spec reference:

- `docs/syntax.md`
- `docs/stages.md`

### What works now (v0.7-type-resolution)

- 54-rule grammar, 5 audited conflicts, 385 parser states
- grammar engine generates `src/parser.zig` from `rip.grammar`
- rewriter handles indentation, type annotation passthrough, newline normalization
- parser produces raw S-expressions directly
- type resolution pre-pass: symbol table, void detection, `typeOf()`, declaration warnings
- `src/compiler.zig` walks sexps and emits readable Zig source
- `./bin/rip --run test/examples/hello.rip` compiles and runs end-to-end
- all high-priority and medium-priority Zig target features implemented
- real embedded protocol handler converted to Rip (test/examples/protocol.rip)

Syntax coverage:

- declarations: `fun`, `sub`, `enum`, `struct`, `error`, `type`, `test`, `use`
- modifiers: `pub`, `extern`, `export` (stackable), `inline`, `comptime`
- control flow: `if`/`else`/`else if` (prefix + postfix), `while`, `for`, `for *item`, `match`
- match patterns: literals, wildcards, enum `.variant`, range `a..b`
- captures: `as val`, `|val|` in `if`/`while`
- bindings: `=`, `=!`, `+=`, `-=`, `*=`, `/=`, scope-tracked `var`/`const`
- operators: `??`, `catch`, `try`, `|>`, `..`, `**`, all arithmetic/comparison/logical
- types: `?T`, `*T`, `[]T`, `!T`, typed params, return types, field defaults
- atoms: integers, reals, strings, booleans, arrays, struct literals, lambdas, `@builtins`
- features: tagged unions, enum values, struct methods, defer/errdefer, `_` discard, pointer deref `ptr.*`, packed struct, labeled break/continue

Type resolution:

- symbol table from fun/sub declarations (return type, visibility, param typing)
- void-call detection: bare calls to void functions skip `_ = ` prefix
- `typeOf()`: infers types for bools, `!expr`, calls to typed functions
- var binding inference: `var x: i32` from callee return type (not just `i64`)
- declaration warnings: untyped pub/extern params and return types

### Remaining grammar items

| Feature | Difficulty | Frequency |
|---------|-----------|-----------|
| Await (`call!`) | Small | Deferred until Zig 0.16.0 restores async |
| Multi-line strings | Medium | Deferred: triple-quote DFA conflicts with string_dq |
| Anonymous struct types | Medium | Occasional |

### Compiler emission gaps

All v0 emission gaps resolved. Struct literals, lambdas, error union types, enum backing types, and `/=` → `@divTrunc` all compile end-to-end.

### What's next

- normalization pass (raw sexps → canonical forms)
- deeper type resolution (expression propagation, cross-assignment unification)
- source diagnostics pointing back to Rip locations (Zig error line → Rip source line)

Compiler stages:

1. parse source directly into S-expressions ✓
2. normalize S-expressions into a smaller canonical set
3. resolve required types (basic version) ✓
4. emit `Zig` source ✓
5. execute `zig run` ✓

Success criteria:

- a small example program compiles end-to-end ✓
- the generated `Zig` is readable ✓
- diagnostics still point back to source locations in `Rip`

## Phase 2: Stronger Internal Structure

Goal: introduce a more explicit compiler IR only if it clearly helps.

Potential triggers:

- normalization becomes hard to reason about
- code generation starts depending on resolved types
- control-flow lowering becomes awkward in pure S-expression space

Possible additions:

- typed core IR
- explicit block/control-flow forms
- symbol resolution layer
- clearer error-reporting passes

Success criteria:

- the compiler becomes easier to extend
- language growth does not immediately collapse into emitter complexity

## Phase 3: Broader Language Semantics

Goal: expand the language carefully after the bootstrap path works.

Likely topics:

- structs and enums
- pointers and mutability
- error handling
- foreign function boundaries
- layout-sensitive declarations
- a growing set of opt-in capability packs

Deferred topics:

- custom backend work
- macro systems
- advanced compile-time execution
- ownership or effect systems that do not map cleanly to the initial target
- any UI/reactivity features inherited from the JavaScript-oriented language

## What Not To Do Too Early

- do not target actual Zig internals
- do not design every advanced feature before the first compiler exists
- do not confuse pleasant syntax with permission for ambiguous semantics
- do not build a backend before proving the frontend model
- do not carry over JS-specific `component`, `render`, or reactive forms
- do not invent an extra intermediate representation before raw and normalized S-expressions stop being enough

## Parsing Philosophy

- Raw S-expressions are the first compiler product.
- Rewriting should continue in S-expression form as long as that stays tractable.
- Capability packs are enabled in source but handled downstream during compilation, not as core grammar features.
- Target a near-conflict-free grammar; the current grammar has 2 audited conflicts (dangling else).
- Explicit `return` is for early exit; final-expression yielding should handle the non-early-return case.
- Routine declaration semantics are definition-driven, while expression value/effect behavior remains context-sensitive.
- Types may be optional in source, but unresolved types must not survive past the type-resolution stage.
