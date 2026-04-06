# Rip

A fast, modern systems language with elegant syntax.

`Rip` is a systems language project focused on clean, expressive syntax without giving up explicit control, predictable performance, or native compilation. The initial strategy is straightforward: compile `Rip` to `Zig`, and let the Zig toolchain own the lower half of the stack.

This keeps the early implementation narrow and practical. `Rip` can focus on syntax, structure, lowering, and semantics that feel good to write, while `Zig` handles code generation, linking, cross-compilation, and platform details.

`Rip` does not need to copy the exact syntax of `rip-lang`, but it should preserve the same ethos: whitespace-sensitive structure, succinct expression-oriented code, routines that naturally yield values when those values are used, and a bias toward removing ceremony when the meaning is already obvious.

Types should follow the same spirit. They can be optional in `Rip` source, selective where useful, and resolved before final `Zig` emission. That means the language can stay low-ceremony at the surface while still producing the concrete types that `Zig` requires underneath.

## Why Rip

Most systems languages inherit a lot of their surface shape from `C`, whether or not that syntax is actually required for performance. `Rip` starts from a different assumption:

- fast code does not require ugly syntax
- explicit semantics do not require excessive ceremony
- a beautiful surface language can still lower to efficient native code

The goal is not to hide low-level reality. The goal is to make systems programming feel structurally elegant.

## Language Ethos

`Rip` should feel like `Rip`, even in a different runtime and compilation world.

- whitespace-sensitive and structurally clean
- concise by default
- expressions yield values when they are used
- routines yield values when they are used
- obvious code should stay short
- power and clarity matter more than inherited ceremony

The point is not to imitate JavaScript semantics. The point is to preserve the feeling of writing in a language that values succinctness, expressiveness, and compositional power.

That also means leaving JavaScript-specific features behind when they do not belong in a systems language. `Rip` should not carry over `component`, `render`, or reactive assignment/effect features into this project.

At the same time, being a systems language should not force every program down to bare-metal minimalism. `Rip` should be able to offer optional capability packs for things like regex support, where the language can enable a high-performance substrate module instead of pretending every project should invent its own engine from scratch.

## Why Zig First

`Rip` is not trying to replace `Zig` on day one. It is using `Zig` as the initial backend substrate.

That means `Rip` can inherit:

- native code generation
- optimization
- cross-compilation
- linking
- C interop
- executable, library, and test workflows

This is the same leverage pattern that makes `rip-lang -> JavaScript` practical: own the language, target a mature platform, and postpone backend complexity until it is justified.

Module boundaries should also follow the Zig approach rather than JavaScript-style `import` and `export` conventions.

That does not rule out higher-level conveniences. It means those conveniences should be modeled as explicit, opt-in capabilities that lower cleanly into the Zig ecosystem.

## Compiler Pipeline

The initial pipeline is:

```text
Rip source
  -> S-expressions
  -> normalized S-expressions
  -> type resolution
  -> generated Zig source
  -> zig build-exe / zig test / zig build-lib
```

The key design choice is that S-expressions are not an optional side format. They are the first structural representation of the program. That makes the compiler easier to normalize, transform, and reason about.

Another key design choice is that types can be optional in source but not optional by codegen time. The compiler should preserve explicit annotations, infer missing types where safe, and reject unresolved cases before emitting Zig.

Another key design choice is that the core language can stay small while optional capability packs provide additional power. A regex pack is the clearest early example: if a program uses regex features, the compiler can enable a performant base module and expose the corresponding forms without bloating the core language for everyone else.

## Near-Term Roadmap

1. Define the public language thesis and repo structure.
2. Specify a tiny source language subset.
3. Lower that subset into raw and normalized S-expressions.
4. Resolve required types for the minimal subset.
5. Emit valid Zig for the minimal subset.
6. Only introduce a more explicit core IR when the compiler truly needs it.

## Non-Goals For V0

- building a custom machine-code backend
- targeting Zig internal IRs directly
- designing every advanced feature up front
- overcommitting to ownership, effects, macros, or comptime semantics before the bootstrap compiler exists
- carrying over JS UI/reactivity constructs that do not belong in systems `Rip`
- forcing every non-core feature into the core language instead of using opt-in capability packs

## Initial Docs

- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/v0-syntax.md`
- `docs/v0-grammar-sketch.md`
- `docs/rip-syntax-responsibilities.md`
- `docs/grammar-system-lessons.md`
- `docs/type-system-direction.md`
- `docs/findings/zig-parsing-notes.md`
