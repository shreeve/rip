# Rip V0 Syntax Spec

## Purpose

This document defines the first implementation target for `Rip`. It is intentionally narrow: a small, coherent subset that can be parsed, normalized, type-resolved, and emitted as valid `Zig`. The actual grammar lives in `rip.grammar`.

## Language Principles

- indentation-sensitive, no semicolons
- expressions and routines produce values when those values are used
- obvious intent should not require extra boilerplate
- optional type annotations (required by code generation, not by the programmer)
- prefer succinct forms over ceremonial ones
- continuity with `rip-lang` is philosophical, not syntactic
- Zig-shaped module boundaries, not JavaScript-style import/export
- optional capability packs for powerful non-core features
- no JS-specific reactivity or UI constructs

## Included In V0

- `use`
- `fun`
- `sub`
- parameters
- optional type annotations
- bindings with `=` and `=!`
- function calls
- call-site `!` for `await`
- `?` as a valid identifier suffix
- arithmetic and comparison
- `if`
- block structure via indentation

## Excluded From V0

- structs
- enums
- loops
- pattern matching
- macros
- FFI syntax
- capability-specific syntax beyond `use`
- ownership or effect systems beyond the `fun` / `sub` split

## Surface Syntax

### Capabilities

Use an explicit `use` form at the top level.

```text
use regex
use text
```

This is a source-level declaration that enables downstream compilation features. It is not meant to complicate the parser or become a deep semantic construct by itself.

### Value-Yielding Routines

Use `fun` for routines that implicitly yield their final expression.

```text
fun add a: i32, b: i32 -> i32
  a + b
```

Parameter types may be required in v0 even if the long-term language supports more omission.

### Effect-Oriented Routines

Use `sub` for routines whose main role is effect, not value production.

```text
sub log_total total: i32
  print total
```

`sub` does not implicitly yield a final value.

### Optional Types

Source annotations are optional where the compiler can infer safely.

```text
fun add a: i32, b: i32 -> i32
  a + b

fun square x: i32
  x * x
```

The compiler may infer the return type of `square`, but should not guess types at important semantic boundaries when the answer is unclear.

### Bindings

Use plain `=` for normal bindings. In v0, a bare binding should create a scoped mutable binding by default, similar to how `rip-lang` treats assignment.

```text
total = add 1, 2
```

Use `=!` to force a constant binding.

```text
limit =! 100
```

The intent is:

- `=` defines or updates according to normal scope rules
- `=!` explicitly declares a constant binding
- there is no `let` keyword
- there is no `const` keyword

### Calls

Calls stay lightweight.

```text
add 1, 2
log_total total
```

### Awaited Calls

Call-site `!` means await.

```text
fetch! url
save_result! total
```

This is distinct from identifier spelling and from routine declaration keywords.

### Identifier Suffixes

A trailing `?` is just part of the identifier.

```text
fun exists? path: string -> bool
  # ...
```

This is not a special parser mode for routines. It is simply valid identifier syntax.

### Conditionals

Use indentation-sensitive `if`.

```text
if total > 0
  print total
else
  print 0
```

An `if` in value position must yield a value on every relevant branch.

```text
sign =
  if n > 0
    1
  else
    -1
```

## Raw S-expression Shapes

These shapes stay fairly close to the original source.

### `use`

```lisp
(use regex)
```

### `fun`

```lisp
(fun add
  ((param a i32)
   (param b i32))
  (ret i32)
  (+ a b))
```

### `sub`

```lisp
(sub log_total
  ((param total i32))
  (call print total))
```

### Local Binding

```lisp
(= total (call add 1 2))
```

### Constant Binding

```lisp
(const limit 100)
```

### Awaited Call

```lisp
(await (call fetch url))
```

### `if` In Value Position

```lisp
(= sign
  (if (> n 0)
      1
      -1))
```

### `if` In Effect Position

```lisp
(if (> total 0)
    (call print total)
    (call print 0))
```

## Normalized S-expression Shapes

These shapes should be the first canonical target of the bootstrap compiler.

### Module

```lisp
(module
  (use regex)
  ...)
```

### `fun`

```lisp
(fun add
  ((a i32) (b i32))
  i32
  (block
    (return (+ a b))))
```

### `sub`

```lisp
(sub log_total
  ((total i32))
  void
  (block
    (expr (call print total))))
```

### Local Binding

```lisp
(= total (call add 1 2))
```

### Constant Binding

```lisp
(const limit 100)
```

### Awaited Call

```lisp
(await (call fetch url))
```

### `if` In Value Position

```lisp
(= sign
  (if (call > n 0)
      (block
        (return 1))
      (block
        (return -1))))
```

### `if` In Effect Position

```lisp
(if (call > total 0)
    (block
      (expr (call print total)))
    (block
      (expr (call print 0))))
```

## Type-Resolution Expectations

### `use`

- does not itself carry a type
- affects downstream code generation and available facilities

### `fun`

- parameters should be explicitly typed in v0
- return type may be explicit or inferred when obvious
- must resolve to a concrete emitted Zig return type

### `sub`

- parameters should be explicitly typed in v0
- normal emitted return type is `void`
- explicit `return` is still allowed for early exit without a value

### `=`

- binding types may be inferred when obvious
- unresolved bindings become errors if later code requires a concrete type and inference fails

### `=!`

- constant bindings may be inferred when obvious
- constantness is part of the binding semantics even if the type is inferred

### Calls

- callee and argument types must resolve before Zig emission
- awaited calls must resolve to awaitable forms supported by the lowering strategy

### `if`

- in value position, all branches must resolve compatibly
- in effect position, no meaningful yielded value is required

## Zig Lowering Sketch

### `fun`

```text
fun add a: i32, b: i32 -> i32
  a + b
```

lowers to:

```zig
pub fn add(a: i32, b: i32) i32 {
    return a + b;
}
```

### `sub`

```text
sub log_total total: i32
  print total
```

lowers to:

```zig
pub fn log_total(total: i32) void {
    print(total);
}
```

### Value `if`

```text
sign =
  if n > 0
    1
  else
    -1
```

lowers to something Zig can express cleanly, such as:

```zig
const sign = if (n > 0) 1 else -1;
```

or a more explicit block-based lowering when necessary.

## Notes

- This spec is intentionally small.
- If a feature is not needed to prove the bootstrap pipeline, leave it out.
- The parser target is raw S-expressions.
- The first rewrite target is normalized S-expressions.
- Type resolution happens after normalization and before Zig emission.
