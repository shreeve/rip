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

## Phase 0: Foundation

Goal: make the project understandable and directionally credible.

Deliverables:

- expanded `README`
- architecture overview
- roadmap
- initial language sketch

Success criteria:

- a new reader can understand the thesis in under two minutes
- the repo explains why `Rip -> Zig` is the first implementation strategy
- the project feels focused rather than speculative

## Phase 1: Bootstrap Compiler

Goal: compile a tiny `Rip` subset into valid `Zig`.

Initial language subset:

- function declarations
- typed parameters
- typed return values
- local bindings
- arithmetic expressions
- function calls
- `if` expressions or statements
- Zig-aligned module/import boundaries
- the basic shape of capability-pack enablement, even if only one pack exists at first
- value-position versus effect-position analysis for routines and `if`
- `def` versus `sub`, call-site `!` as `await`, and `?` as part of the real routine name
- optional type annotations with a narrow v0 inference policy

Compiler stages:

1. parse source directly into S-expressions
2. normalize S-expressions into a smaller canonical set
3. resolve required types
4. emit `Zig` source
5. execute `zig build-exe` or `zig test`

Success criteria:

- a small example program compiles end-to-end
- the generated `Zig` is readable
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
- Audited LR conflicts are acceptable when they preserve a cleaner language design and the parser behavior is understood.
- Explicit `return` is for early exit; final-expression yielding should handle the non-early-return case.
- Routine declaration semantics are definition-driven, while expression value/effect behavior remains context-sensitive.
- Types may be optional in source, but unresolved types must not survive past the type-resolution stage.
