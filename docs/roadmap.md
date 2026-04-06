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

### What works now (v0.3-grammar)

- 51-rule grammar, 2 audited conflicts, 311 parser states
- grammar engine generates `src/parser.zig` from `rip.grammar`
- rewriter handles indentation, type annotation passthrough, newline normalization
- parser produces raw S-expressions directly
- `src/compiler.zig` walks sexps and emits readable Zig source
- `./bin/rip --run test/examples/hello.rip` compiles and runs end-to-end
- all high-priority and medium-priority Zig target features implemented

Syntax coverage:

- declarations: `fun`, `sub`, `enum`, `struct`, `error`, `alias`, `test`, `use`
- modifiers: `pub`, `extern`, `export` (stackable), `inline`, `comptime`
- control flow: `if`/`else`/`else if` (prefix + postfix), `while`, `for`, `match`
- captures: `as val`, `|val|` in `if`/`while`
- bindings: `=`, `=!`, `+=`, `-=`, `*=`, `/=`, scope-tracked `var`/`const`
- operators: `??`, `catch`, `try`, `|>`, `..`, `**`, all arithmetic/comparison/logical
- types: `?T`, `*T`, `[]T`, `!T`, typed params, return types, field defaults
- atoms: integers, reals, strings, booleans, arrays, struct literals, lambdas, `@builtins`
- features: tagged unions, enum values, struct methods, defer/errdefer, `_` discard

### Remaining grammar items

| Feature | Difficulty | Frequency |
|---------|-----------|-----------|
| Pointer deref `ptr.*` | Small | Common with pointers |
| Match with ranges | Small | Occasional |
| Match with capture | Small | Occasional |
| For with pointer capture | Small | Occasional |
| Labeled blocks | Medium | Rare |
| Packed/extern struct | Small | Niche |
| Multi-line strings | Medium | Niche |
| Sentinel types `[*:0]T` | Medium | Niche |
| Anonymous struct types | Medium | Occasional |

### Rewriter enhancement

| Feature | What's needed |
|---------|--------------|
| Unary args in implicit calls | Split `-`/`!` into prefix vs infix tokens in the rewriter so `print -42` works without parens. Well-defined fix: add `minus_prefix` token, detect spacing context in rewriter, update grammar. |

### Compiler emission gaps (parse but don't compile yet)

| Feature | What's needed |
|---------|--------------|
| Struct literals (`record`) | Emit `Name{ .field = val, ... }` |
| Lambdas | Emit anonymous function |
| Error union types (`!T`) | Emit in type positions |
| Enum backing types | Emit `enum(u8)` for valued enums |
| `/=` on signed ints | Emit `@divTrunc` instead |

None of the above or below block writing normal programs. Add as needed.

### What's next

- normalization pass (raw sexps → canonical forms)
- type resolution (strip-and-default → real inference)
- source diagnostics pointing back to Rip locations

Compiler stages:

1. parse source directly into S-expressions ✓
2. normalize S-expressions into a smaller canonical set
3. resolve required types
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
- Target a conflict-free grammar; the current grammar has zero parser conflicts.
- Explicit `return` is for early exit; final-expression yielding should handle the non-early-return case.
- Routine declaration semantics are definition-driven, while expression value/effect behavior remains context-sensitive.
- Types may be optional in source, but unresolved types must not survive past the type-resolution stage.
