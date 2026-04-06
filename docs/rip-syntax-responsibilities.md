# Rip Syntax Responsibilities

## Purpose

This document defines the bootstrap `Rip` syntax in terms of compiler responsibilities.

Instead of only saying what the syntax looks like, it answers:

- what the lexer must recognize
- what the rewriter should infer or insert
- what the grammar should parse
- what raw S-expressions should look like
- what normalization should produce
- what type resolution must decide
- how the result should lower to `Zig`

This is meant to make the first implementation effort concrete and prevent responsibility from drifting between stages.

## Pipeline

The relevant pipeline is:

1. `BaseLexer`
2. `Rip` rewriter
3. parser
4. normalization
5. type resolution
6. `Zig` emission

## Token Metadata Contract

The token model should eventually support at least:

- `.pre` — preceding whitespace count
- `.spaced` — token has preceding whitespace
- `.lineStart` — token begins a logical line
- `.lineEnd` — token is followed by a logical line break
- `.loc` — source location
- `.data` — extra token metadata

These fields exist to make the rewriter simpler and more predictable.

## Syntax Responsibility Table

### `use`

Examples:

```text
use regex
use text
```

Lexer:

- recognize `use` as a keyword or contextual keyword
- tokenize capability names as identifiers

Rewriter:

- usually no transformation needed

Grammar:

- parse top-level `use` declarations

Raw sexp:

```lisp
(use regex)
```

Normalized sexp:

```lisp
(use regex)
```

Type resolution:

- no type behavior

Zig lowering:

- influences downstream imports, helpers, modules, and preamble generation

### `fun`

Examples:

```text
fun add a: i32, b: i32 -> i32
  a + b
```

Lexer:

- recognize `fun`
- tokenize identifiers
- tokenize type annotations and return arrows

Rewriter:

- may help clarify parameter grouping if implicit delimiters are allowed
- should not change the semantic identity of a `fun`

Grammar:

- parse `fun` as a value-yielding routine declaration

Raw sexp:

```lisp
(fun add
  ((param a i32)
   (param b i32))
  (ret i32)
  (+ a b))
```

Normalized sexp:

```lisp
(fun add
  ((a i32) (b i32))
  i32
  (block
    (return (+ a b))))
```

Type resolution:

- parameter types likely required in v0
- return type may be explicit or inferred when obvious
- final type must be concrete before `Zig` emission

Zig lowering:

- emit a normal Zig function with a concrete return type

### `sub`

Examples:

```text
sub log_total total: i32
  print total
```

Lexer:

- recognize `sub`

Rewriter:

- same structural help as `fun` if needed

Grammar:

- parse `sub` as an effect-oriented routine declaration

Raw sexp:

```lisp
(sub log_total
  ((param total i32))
  (call print total))
```

Normalized sexp:

```lisp
(sub log_total
  ((total i32))
  void
  (block
    (expr (call print total))))
```

Type resolution:

- parameters likely required in v0
- emitted return type is `void`

Zig lowering:

- emit a Zig `void` function

### `=`

Examples:

```text
total = add 1, 2
```

Lexer:

- tokenize `=` as a normal binding/assignment operator

Rewriter:

- may help determine implicit call boundaries on the right-hand side
- should not change the operator identity

Grammar:

- parse binding/assignment expressions

Raw sexp:

```lisp
(= total (call add 1 2))
```

Normalized sexp:

```lisp
(= total (call add 1 2))
```

Type resolution:

- infer the bound type when obvious
- decide whether this is definition or reassignment based on scope rules

Zig lowering:

- emit either `const`, `var`, or assignment depending on binding semantics determined by later passes

### `=!`

Examples:

```text
limit =! 100
```

Lexer:

- tokenize `=!` as a dedicated operator

Rewriter:

- no major transformation expected

Grammar:

- parse explicit constant binding

Raw sexp:

```lisp
(const limit 100)
```

Normalized sexp:

```lisp
(const limit 100)
```

Type resolution:

- infer type when obvious
- enforce constant semantics

Zig lowering:

- likely emit Zig `const`

### Calls

Examples:

```text
add 1, 2
print total
```

Lexer:

- tokenize identifiers, literals, commas, delimiters
- expose whitespace metadata needed for implicit calls

Rewriter:

- this is one of the most important responsibilities
- detect implicit call structure
- insert or clarify call boundaries where necessary

Grammar:

- consume already-clarified call structure with minimal complexity

Raw sexp:

```lisp
(call add 1 2)
```

Normalized sexp:

```lisp
(call add 1 2)
```

Type resolution:

- resolve callee and argument types

Zig lowering:

- emit direct function call syntax

### Awaited calls

Examples:

```text
fetch! url
save_result! total
```

Lexer:

- recognize `!` at call site
- preserve enough context to distinguish it from identifier spelling

Rewriter:

- likely responsible for converting call-site `!` into an explicit await form

Grammar:

- parse an explicit `await` expression form

Raw sexp:

```lisp
(await (call fetch url))
```

Normalized sexp:

```lisp
(await (call fetch url))
```

Type resolution:

- must validate awaitable forms later if async semantics exist in v0

Zig lowering:

- emit whichever Zig-compatible lowering strategy the async model requires

### `?` identifier suffix

Examples:

```text
fun exists? path: string -> bool
  # ...
```

Lexer:

- allow `?` as part of identifier spelling when valid

Rewriter:

- ideally none; this should remain a lexical property

Grammar:

- treat it as an ordinary identifier

Raw sexp:

```lisp
(fun exists? ...)
```

Normalized sexp:

```lisp
(fun exists? ...)
```

Type resolution:

- no special semantics required

Zig lowering:

- may require name mangling or translation if Zig identifiers cannot represent the spelling directly

### `if`

Examples:

```text
if total > 0
  print total
else
  print 0
```

```text
sign =
  if n > 0
    1
  else
    -1
```

Lexer:

- tokenize `if`, `else`
- emit indentation tokens
- preserve line boundaries carefully

Rewriter:

- normalize single-line versus block structure if necessary
- help ensure `else` attaches correctly in indentation-sensitive form

Grammar:

- parse `if` / `else` into one structural family

Raw sexp:

```lisp
(if (> total 0)
    (call print total)
    (call print 0))
```

Normalized sexp:

```lisp
(if (call > total 0)
    (block
      (expr (call print total)))
    (block
      (expr (call print 0))))
```

Type resolution:

- in value position, branches must resolve compatibly
- in effect position, no meaningful yielded value is required

Zig lowering:

- emit `if` expression or explicit block-based lowering depending on what Zig supports cleanly in that context

### `return`

Examples:

```text
return total
return
```

Lexer:

- tokenize `return`

Rewriter:

- no major transformation expected

Grammar:

- parse early-return form

Raw sexp:

```lisp
(return total)
```

Normalized sexp:

```lisp
(return total)
```

Type resolution:

- ensure value/no-value form matches enclosing `fun` or `sub`

Zig lowering:

- direct `return`

## What Should Stay Mostly In The Rewriter

These are the biggest syntax features that should remain rewriter responsibilities rather than being pushed deeply into the grammar:

- implicit call inference
- implicit grouping / braces / parens where the answer is obvious
- line normalization for indentation-sensitive shorthand
- contextual cleanup around call-site `!`
- optional type-token shaping if needed

## What Should Stay Mostly In The Grammar

- routine declarations
- `if`
- `return`
- basic assignment forms
- canonical invocation forms
- blocks
- arithmetic/comparison structure

## Notes

- The lexer should do more than raw tokenization, but less than full syntactic inference.
- The rewriter is where most “Rip beauty” should live.
- The grammar should stay smaller because the rewriter clarifies token structure first.
- The goal is not to eliminate the rewriter. The goal is to make it smaller, more principled, and easier to debug.
