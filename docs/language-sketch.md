# Rip Language Sketch

## Purpose

This document defines the smallest useful slice of `Rip` for the first compiler bootstrap. It is not a complete language spec. It is a constrained starting point that is easy to parse, normalize, and lower into `Zig`.

For the concrete bootstrap surface, see `docs/v0-syntax.md`.

## Principles For The First Subset

- indentation-sensitive syntax
- no semicolons
- keep the ethos of `rip-lang` without copying its exact syntax
- expressions produce values when those values are used
- routines produce values when those values are used
- obvious intent should not require extra boilerplate
- optional type annotations in source
- expression-oriented arithmetic
- imports/modules should follow the Zig approach
- a tiny number of core forms
- semantics that map cleanly to `Zig`
- no JS-specific reactivity or UI constructs
- optional capability packs for powerful non-core features

## Optional Types

`Rip` should allow types to be omitted in source, added selectively where useful, and still produce fully typed `Zig` in the end.

That means:

- source annotations are optional
- explicit source annotations act as constraints and declarations
- missing types should be inferred when the answer is safe and obvious
- unresolved or ambiguous types should produce compiler errors before Zig emission

The important distinction is:

- optional in source
- required by code generation

So the compiler needs a real type-resolution phase even if the source language keeps types lightweight.

## Language Feel

The first version of `Rip` should optimize for feel as much as for mechanics.

That means:

- prefer succinct forms over ceremonial ones
- do not force separate statement syntax when an expression form is clearer
- allow functions and control-flow forms to stay value-oriented where practical
- avoid copying `rip-lang` syntax mechanically when systems semantics call for different shapes
- use Zig-shaped module boundaries instead of JavaScript-style import/export conventions
- enable extra power through opt-in capabilities rather than bloating the core language

The continuity with `rip-lang` should be philosophical, not syntactic.

## Routine Declaration Semantics

For routines, `Rip` should use two clear declaration forms rather than encoding return behavior in punctuation at the definition site.

The model is:

- `fun` declares a value-yielding routine
- `sub` declares an effect-oriented routine
- every `fun` implicitly yields its final expression by default
- `sub` does not implicitly yield a final value
- explicit `return` exists for early exit
- appending `!` at call time keeps the `rip-lang` meaning of `await`
- a `?` suffix is different: it is part of the routine's real name

This gives you concise code while keeping routine intent visible and stable.

Examples of the distinction:

- `sub save data` defines an effect-oriented routine named `save`
- `save data` calls that routine normally
- `fetch! url` means await the call to `fetch`
- `exists? path` calls a routine whose actual name is `exists?`

## Value Position vs Effect Position

This context-sensitive distinction still matters, but now mostly for expression forms rather than for deciding what a routine fundamentally is.

- forms in value position must yield a value
- forms in effect position may still yield a value, but that value is ignored

Applied to `if`:

- an `if` used in value position must yield a value on all relevant branches
- an `if` used in effect position does not need to produce a meaningful value

## Example Source

```text
fun add a: i32, b: i32 -> i32
  a + b

sub main
  total = add 1, 2
  if total > 0
    print total
  else
    print 0
```

In this example:

- `add` is a `fun`, so it implicitly yields its final expression
- `main` is a `sub`, so it does not need to yield a final value
- the `if` in `main` is used in effect position, so it does not need to yield a value

An equally valid long-term direction would be:

```text
fun add a, b
  a + b
```

as long as a later type-resolution pass can determine the concrete types needed for emitted `Zig`, or produce a good error when it cannot.

## Raw S-expressions

The parser can emit a direct structural representation of the source:

```lisp
(module
  (fun add
    ((param a i32)
     (param b i32))
    (ret i32)
    (+ a b))
  (sub main
    ()
    (= total (call add 1 2))
    (if (> total 0)
        (call print total)
        (call print 0))))
```

This form is still fairly close to the original source. It preserves user intent without yet forcing every construct into a minimal canonical shape.

In the longer direction of the language, value flow should be a first-class design concern. If a form is used as a value, it should behave like one. If it is used only for effect, the compiler can lower it accordingly.

This raw form should be the actual first compiler product. The parser does not need to invent a separate intermediate tree only to convert it into S-expressions immediately afterward.

## Normalized S-expressions

After normalization, the compiler should operate on a smaller and more regular set of forms:

```lisp
(module
  (fun add
    ((a i32) (b i32))
    i32
    (block
      (return (+ a b))))
  (sub main
    ()
    (block
      (= total (call add 1 2))
      (if (call > total 0)
          (block
            (expr (call print total)))
          (block
            (expr (call print 0)))))))
```

Normalization goals:

- one function shape
- one parameter shape
- one call shape
- explicit blocks
- explicit expression statements where needed
- explicit value-yielding behavior after sugar is removed

The intended workflow is:

1. parse into raw S-expressions
2. rewrite into normalized S-expressions
3. resolve required types
4. keep working in S-expression form until a stronger IR is genuinely useful

## Generated Zig

That normalized form can lower into readable `Zig`:

```zig
pub fn add(a: i32, b: i32) i32 {
    return a + b;
}

pub fn main() void {
    const total = add(1, 2);
    if (total > 0) {
        print(total);
    } else {
        print(0);
    }
}
```

## Initial Core Forms

The first implementation should stay close to a very small vocabulary:

- `module`
- `fun`
- `sub`
- `block`
- `=`
- `=!`
- `return`
- `if`
- `call`
- arithmetic and comparison operators
- literals
- symbols

This is enough to bootstrap the parser, normalization pass, and emitter without prematurely inventing a richer IR.

## V0 Type Policy

The best initial policy is:

- infer locals when the answer is obvious
- infer final return types for simple `fun` bodies when obvious
- keep literals context-sensitive until they are constrained
- require explicit types at important boundaries

Important boundaries likely include:

- `fun` parameters in v0
- public definitions
- extern or FFI boundaries
- struct fields and other layout-sensitive declarations

## Capability Packs

Some features should live outside the tiny core language while still feeling native to use.

For those cases, `Rip` should support optional capability packs:

- explicitly enabled, likely with a `use` form
- easy to remove
- compiled into supporting Zig modules or helpers
- reserved for facilities that are useful but not worth reinventing per project
- handled downstream of parsing rather than being hardwired into the grammar

Capability enablement may eventually be inferable from actual use, but an explicit `use` surface is the best initial design because it keeps compilation behavior obvious.

The first likely example is regex support. If a `Rip` program opts into regex capability, the compiler can include a performant regex substrate and make regex forms available without turning regex implementation into a language-core concern.

## Explicit Exclusions

The systems-language bootstrap should not include:

- `component`
- `render`
- reactive assignment forms
- computed/effect forms
- JavaScript-style import/export surface forms

That exclusion does not apply to optional capability packs. Capability packs are allowed, but they should remain explicit and separate from the minimal core syntax.

## Notes

- Source spans should be attached to every parsed form from the start.
- `infer` is a placeholder for early experimentation and does not need to remain in the long-term language.
- If normalization starts carrying too much semantic weight, that is the right moment to introduce a stronger core IR.
- The bootstrap subset can stay conservative even if the long-term ethos is more expression-oriented; the important thing is to preserve that direction in the design.
- Audited LR conflicts are acceptable if they keep the grammar readable and the resulting parser behavior is well understood.
