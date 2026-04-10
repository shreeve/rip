# Type System Direction

## Purpose

This document clarifies how `Zag` should think about types by separating two questions:

1. What should `Zag` borrow from `rip-lang`'s optional type support?
2. What must become more Zig-like because `Zag` emits real `Zig` source?

The answer is not "choose one." The right design is a synthesis:

- `rip-lang` style optionality and lightweight source syntax on the front end
- Zig-like concreteness and type completeness on the back end

## What To Borrow From `rip-lang`

### 1. Keep types out of the parser as much as possible

One of the best lessons from `rip-lang` is that the parser does not need to become a full type-system engine.

That means for `Zag`:

- type syntax should be tokenized and preserved structurally
- explicit source annotations should act as metadata, constraints, and declarations
- the parser should remain focused on structure

This keeps the grammar smaller and the parser easier to evolve.

### 2. Let source types be optional and selective

`rip-lang` proves that optional typing can be ergonomic and practical.

For `Zag`, the front-end lesson is:

- users should be able to add types where helpful
- users should not be forced to annotate everything just to get started
- the language should support a spectrum from lightweight source to more explicit source

### 3. Preserve type information as compiler metadata

`rip-lang` preserves type information as metadata rather than forcing it into the main parse structure everywhere.

For `Zag`, this suggests:

- keep explicit source types attached to tokens or raw structural forms
- preserve them through rewriting and normalization
- let later passes interpret them

### 4. Treat explicit source types as constraints, not just decoration

This is a subtle but important lesson.

When a user writes a type, the compiler should use it to:

- constrain inference
- validate values and returns
- shape later lowering

That is more powerful than merely carrying type syntax along for documentation.

### 5. Keep the source language low-ceremony

This is not only about types, but the type story should support it.

For `Zag`, the source-language goal should remain:

- optional type annotations
- selective annotation where desired
- readable and concise surface syntax

## What Must Be More Zig-like In `Zag`

### 1. Final emitted code must be concretely typed

This is the biggest difference from `rip-lang`.

In `rip-lang`:

- JavaScript does not require concrete static types to run
- TypeScript support can live in declarations or shadow files

In `Zag`:

- emitted `Zig` must be concretely typed
- unresolved types cannot survive to code generation

So the final type-resolution pass is mandatory, not optional.

### 2. Type choices affect semantics, not just tooling

In a systems language, type choice changes real behavior:

- overflow behavior
- memory layout
- ABI compatibility
- signed vs unsigned interpretation
- pointer behavior
- storage size

That means the compiler cannot casually guess a "smallest" or "most efficient" type in ambiguous cases.

### 3. Important boundaries must become explicit

Because `Zag` targets `Zig`, some places need stronger discipline early:

- public definitions
- routine parameters in v0
- extern or FFI boundaries
- struct fields
- layout-sensitive declarations

At these boundaries, type inference should be constrained or explicit annotation should be required.

### 4. Numeric inference must be conservative

This is one of the biggest danger areas.

In a JS-targeting language, numeric ambiguity is often survivable.
In a Zig-targeting language, it is much more serious.

For `Zag`, the compiler should:

- keep literals context-sensitive as long as possible
- infer only when context makes the answer safe
- reject ambiguous numeric cases rather than silently guessing badly

### 5. Type resolution must be a real compiler phase

For `Zag`, type handling cannot just be a formatting pass or external tooling path.

The compiler needs a real stage that:

- preserves explicit types
- infers missing ones
- propagates resolved types
- checks compatibility
- errors on unresolved or ambiguous cases
- feeds fully typed information into Zig emission

## The Right Synthesis

The right overall model for `Zag` is:

1. Source types are optional.
2. Explicit types are preserved as constraints.
3. Parser output stays structural and sexp-based.
4. Rewriting and normalization do not depend on a fully resolved type system.
5. A dedicated type-resolution phase makes the program concrete enough for `Zig`.
6. Zig emission assumes the type story is complete.

This gives `Zag`:

- a pleasant source language
- a clean parser and grammar
- a serious systems-language backend story

## Recommended V0 Policy

### Allow omission here

- local bindings when the initializer is clear
- simple `fun` return types when the body is obvious
- internal helper values with unambiguous use sites

### Require explicit types here

- `fun` parameters
- public definitions
- extern or FFI interfaces
- struct fields
- anything layout-sensitive

### Infer only when safe

- locals from direct initializers
- obvious return types from simple bodies
- constants with unambiguous literal/context combinations

### Error when unresolved

- ambiguous numeric cases
- unresolved public API types
- incompatible branch/result typing
- anything that would force Zig codegen to guess semantics

## Practical Compiler Impact

This means the pipeline for `Zag` should look like:

```text
Zag source
  -> tokens with optional type metadata
  -> raw S-expressions
  -> normalized S-expressions
  -> type resolution
  -> generated Zig source
```

The important point is:

- `rip-lang` provides the front-end philosophy
- Zig provides the back-end discipline

`Zag` should combine both.

## Final Recommendation

Borrow from `rip-lang`:

- optional source types
- selective type annotations
- metadata-oriented handling
- parser simplicity

Become more Zig-like in:

- concrete type completeness
- boundary discipline
- numeric conservatism
- layout/ABI awareness
- mandatory pre-codegen type resolution

That is the right balance for `Zag`.
