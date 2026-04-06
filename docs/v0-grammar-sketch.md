# Rip V0 Grammar Sketch

## Purpose

This document sketches the first `Rip` grammar in the style of `rip-lang`'s `grammar.rip`, but trimmed down to the bootstrap subset.

It is not intended to be a final parser file. It is meant to answer:

- what nonterminals should exist first
- how they should lower directly into raw S-expressions
- what should stay out of scope until the first compiler path works

## Design Goals

- keep the grammar small
- lower directly to raw S-expressions
- preserve indentation-sensitive structure
- prefer one canonical shape per concept
- allow some ergonomic surface syntax, but normalize aggressively afterward

## V0 Grammar Shape

The first grammar should probably have only a small number of top-level nonterminals:

- `Root`
- `Body`
- `Line`
- `Statement`
- `Expression`
- `Value`
- `Assign`
- `ConstAssign`
- `Fun`
- `Sub`
- `Invocation`
- `Arguments`
- `ArgList`
- `Block`
- `If`
- `Operation`
- `Identifier`
- `Literal`

That is enough to express the bootstrap language without dragging in loops, structs, enums, macros, or capability-specific syntax.

## Suggested Top-Level Structure

Modeled after `rip-lang`, the first file can still use the same helper shape:

```coffee
o = (pattern, action, options) ->
  pattern = pattern.trim().replace /\s{2,}/g, ' '
  [pattern, action ?? 1, options]

mode = 'sexp'

grammar =
```

## Program Structure

```coffee
Root: [
  o ''    , '["module"]'
  o 'Body', '["module", ...1]'
]

Body: [
  o 'Line'                , '[1]'
  o 'Body TERMINATOR Line', '[...1, 3]'
  o 'Body TERMINATOR'
]

Line: [
  o 'Statement'
  o 'Expression'
]
```

The key point is that `module` should be the first structural node, not just a parser convenience.

## Statements

For v0, the main true statements are:

- `use`
- `fun`
- `sub`
- `return`

Everything else should lean expression-first.

```coffee
Statement: [
  o 'Use'
  o 'Fun'
  o 'Sub'
  o 'Return'
]
```

## Capabilities

Keep `use` extremely simple in v0.

```coffee
Use: [
  o 'USE Identifier'                       , '["use", 2]'
  o 'USE Identifier TERMINATOR Identifier' , '["use", 2]'  # optional later cleanup if needed
]
```

Realistically, only the first rule is needed at first:

```lisp
(use regex)
```

## Routines

The routine split should be encoded directly in the grammar.

```coffee
Fun: [
  o 'FUN Identifier ParamClause ReturnClause Block', '["fun", 2, 3, 4, 5]'
  o 'FUN Identifier ParamClause Block'              , '["fun", 2, 3, null, 4]'
  o 'FUN Identifier Block'                          , '["fun", 2, [], null, 3]'
]

Sub: [
  o 'SUB Identifier ParamClause Block', '["sub", 2, 3, 4]'
  o 'SUB Identifier Block'             , '["sub", 2, [], 3]'
]
```

This keeps `fun` and `sub` separate at parse time rather than trying to encode the difference later.

## Parameters And Return Clauses

V0 should keep parameter syntax explicit and narrow.

```coffee
ParamClause: [
  o 'ParamStart ParamList ParamEnd', 2
]

ParamList: [
  o ''                                      , '[]'
  o 'Param'                                 , '[1]'
  o 'ParamList , Param'                     , '[...1, 3]'
  o 'ParamList OptComma TERMINATOR Param'   , '[...1, 4]'
]

Param: [
  o 'Identifier : TypeExpr'                 , '["param", 1, 3]'
]

ReturnClause: [
  o 'ARROW TypeExpr'                        , '["ret", 2]'
]
```

Whether the real delimiters are parenthesized or not can still change. The structural point is that params and return types should lower into explicit `param` and `ret` forms.

## Bindings

Since `Rip` has no `let` or `const` keywords, binding forms should be explicit operators in the grammar.

```coffee
Assign: [
  o 'Assignable = Expression'               , '["=", 1, 3]'
  o 'Assignable = TERMINATOR Expression'    , '["=", 1, 4]'
  o 'Assignable = INDENT Expression OUTDENT', '["=", 1, 4]'
]

ConstAssign: [
  o 'Assignable READONLY_ASSIGN Expression'               , '["const", 1, 3]'
  o 'Assignable READONLY_ASSIGN TERMINATOR Expression'    , '["const", 1, 4]'
  o 'Assignable READONLY_ASSIGN INDENT Expression OUTDENT', '["const", 1, 4]'
]
```

Here `READONLY_ASSIGN` is the token for `=!`.

These are good raw targets:

```lisp
(= total (call add 1 2))
(const limit 100)
```

## Expressions

Keep the expression family extremely small at first:

```coffee
Expression: [
  o 'Value'
  o 'Operation'
  o 'Assign'
  o 'ConstAssign'
  o 'If'
  o 'Await'
]
```

This is enough to build the first real compiler path.

## Values

```coffee
Value: [
  o 'Identifier'
  o 'Literal'
  o 'Invocation'
  o 'Parenthetical'
]
```

Do not include property access, indexing, map literals, object literals, arrays, regex literals, or other advanced forms until the bootstrap path works.

## Calls

This is one of the best parts to borrow from `rip-lang`: normalize calls into a single structural family immediately.

```coffee
Invocation: [
  o 'Value Arguments'                      , '["call", 1, ...2]'
]

Arguments: [
  o 'CALL_START CALL_END'                  , '[]'
  o 'CALL_START ArgList OptComma CALL_END' , 2
]

ArgList: [
  o 'Expression'                           , '[1]'
  o 'ArgList , Expression'                 , '[...1, 3]'
  o 'ArgList OptComma TERMINATOR Expression', '[...1, 4]'
]
```

For the first implementation, it may even be better to keep only one call style and avoid optional alternate syntax.

## Await

Call-site `!` should become a normal expression form, not a parser hack.

```coffee
Await: [
  o 'Value AWAIT_CALL'                     , '["await", 1]'
  o 'Invocation AWAIT_CALL'                , '["await", 1]'
]
```

Whether `AWAIT_CALL` is tokenized as postfix `!` or lowered another way, the structural target should stay simple:

```lisp
(await (call fetch url))
```

## Blocks

Keep the `rip-lang` block shape almost exactly.

```coffee
Block: [
  o 'INDENT OUTDENT'     , '["block"]'
  o 'INDENT Body OUTDENT', '["block", ...2]'
]

Parenthetical: [
  o '( Body )'               , '$2.length === 1 ? $2[0] : ["block", ...$2]'
  o '( INDENT Body OUTDENT )', '$3.length === 1 ? $3[0] : ["block", ...$3]'
]
```

This is one of the best patterns from `rip-lang` and should almost certainly be reused.

## Conditionals

The first `if` grammar should be simple and direct:

```coffee
IfBlock: [
  o 'IF Expression Block'              , '["if", 2, 3]'
  o 'IfBlock ELSE IF Expression Block' , '$1.length === 3 ? ["if", $1[1], $1[2], ["if", $4, $5]] : [...$1, ["if", $4, $5]]'
]

If: [
  o 'IfBlock'
  o 'IfBlock ELSE Block'               , '$1.length === 3 ? ["if", $1[1], $1[2], $3] : [...$1, $3]'
]
```

This gives you:

- effect-position `if`
- value-position `if`
- chained `else if`

all lowering to the same raw structural family.

## Return

`return` should stay explicit and minimal.

```coffee
Return: [
  o 'RETURN Expression'           , '["return", 2]'
  o 'RETURN'                      , '["return"]'
]
```

That is enough for early return in both `fun` and `sub`.

## Operations

Keep operators very small in v0:

```coffee
Operation: [
  o 'Expression + Expression'       , '["+", 1, 3]'
  o 'Expression - Expression'       , '["-", 1, 3]'
  o 'Expression MATH Expression'    , '[2, 1, 3]'
  o 'Expression COMPARE Expression' , '[2, 1, 3]'
]
```

This is enough to support arithmetic and conditions for the bootstrap subset.

## Type Expressions

The parser should not become type-heavy.

For v0, `TypeExpr` can be intentionally narrow:

```coffee
TypeExpr: [
  o 'Identifier'
]
```

The optional typing strategy means the parser only needs to preserve type syntax structurally. The real burden belongs in type resolution, not in making the grammar type-complete too early.

## Best Patterns To Reuse Directly

From `rip-lang`, these are worth reusing nearly unchanged:

- `Root` / `Body` accumulation pattern
- `Block` and `Parenthetical`
- `ParamList` / `ArgList` list-building style
- `IfBlock` plus `If`
- direct sexp-lowering actions

## Best Patterns To Delay

Do not import these until the bootstrap path works:

- objects and arrays
- comprehensions
- postfix control-flow sugar
- switch / when
- loops
- regex literals as grammar-native syntax
- property access and indexing
- optional chaining or optional call
- anything UI/reactive

## Recommended First Implementation Order

1. `Root`, `Body`, `Line`
2. `Identifier`, `Literal`, `Block`
3. `fun`, `sub`, `return`
4. `=`, `=!`
5. `Invocation`
6. `Operation`
7. `if`
8. `use`
9. optional type annotation parsing

That order gives the shortest path to a working compiler without overdesigning the grammar.
