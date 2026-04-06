# Zig Parsing Notes

## Purpose

This document records our best current understanding of how Zig handles source parsing, based on:

- direct inspection of the Zig source vendored under `misc/zig`
- a second-opinion review from the `user-ai` MCP peer

This is not meant to be a formal grammar reference for Zig. It is an implementation-oriented note intended to help `Rip` decide what to borrow, what not to borrow, and why.

## Short Answer

Zig does **not** appear to use a standalone grammar file or parser generator for the main language parser.

Instead, it uses:

1. a hand-written tokenizer
2. a hand-written parser
3. a flat-array AST representation
4. a separate lowering pass from AST to ZIR

So the practical pipeline is:

```text
source
  -> Tokenizer
  -> token array
  -> Parse
  -> Ast
  -> AstGen
  -> ZIR
```

## Key Files

The most important files we found are:

- `misc/zig/lib/std/zig/tokenizer.zig`
- `misc/zig/lib/std/zig/Parse.zig`
- `misc/zig/lib/std/zig/Ast.zig`
- `misc/zig/lib/std/zig/AstGen.zig`

These seem to be the core language front-end path.

## What Each File Does

### `tokenizer.zig`

This is the hand-written tokenizer.

Important observations:

- it defines Zig token tags
- it classifies keywords directly
- it emits token locations as source ranges
- it is not generated from a grammar file

The tokenizer defines a `Token` type with:

- `tag`
- `loc.start`
- `loc.end`

and a large `Tag` enum containing:

- keywords
- operators
- punctuation
- literals

This is a conventional hand-written tokenizer for a compiler.

### `Ast.zig`

This file is the stable parsed representation.

Important observations:

- it owns the source text, tokens, nodes, extra data, and errors
- `Ast.parse()` first tokenizes the whole source into a token list
- `Ast.parseTokens()` then builds a `Parse` struct and runs parsing
- the parser output is not an s-expression; it is a flat AST with indexes

This is an important distinction:

- tokenization completes first
- parsing then operates over a full token array

That is a useful lesson for `Rip`.

### `Parse.zig`

This appears to be the real parser implementation.

Important observations:

- `Parse` is described as \"in-progress parsing\"
- it stores:
  - source
  - token slice
  - current token index
  - error list
  - node arrays
  - extra data
  - scratch storage
- it has explicit parse entry points like:
  - `parseRoot()`
  - `parseZon()`

This strongly suggests a hand-written recursive-descent parser rather than a generated parser.

### `AstGen.zig`

This is the next phase after parsing.

Important observations:

- it explicitly says it ingests AST and produces ZIR
- it is a separate pass from parsing
- it uses AST node indexes and extra data, not parser callbacks

This stage separation is very important.

## What Zig's Real Parsing Pipeline Looks Like

Based on the inspected source, the real pipeline seems to be:

### 1. Tokenization

`Ast.parse()` creates a tokenizer and drains it into a full token array.

This means tokenization is completed before parsing begins.

### 2. Parsing

`Ast.parseTokens()` creates a `Parse` struct and calls into:

- `parseRoot()` for Zig mode
- `parseZon()` for Zon mode

This builds:

- node tags
- node token references
- extra data arrays
- error lists

### 3. Frozen AST

The parser output becomes an `Ast` value containing:

- source
- tokens
- nodes
- extra data
- errors

This is a compact, indexed syntax structure.

### 4. AST lowering

`AstGen.generate()` consumes the AST and emits ZIR.

This means:

- parsing and semantic lowering are separate
- ZIR is not produced directly by the parser

## Is Zig's Parser Hand-Written?

Yes, that is the best current conclusion.

The evidence:

- there is no visible grammar file for the Zig language parser
- the parser logic is encoded in `Parse.zig`
- tokenization is encoded in `tokenizer.zig`
- AST lowering is encoded in `AstGen.zig`

So it is fair to say Zig uses a hand-written tokenizer and hand-written parser.

## What Zig Seems To Optimize For

The current architecture strongly suggests Zig cares about:

- total control over parsing behavior
- strong diagnostics and error recovery
- low memory overhead
- cache-friendly internal structures
- clear phase boundaries
- self-hosted compiler discipline

The AST representation in `Ast.zig` appears especially optimized for:

- compact storage
- index-based access
- no per-node heap-object overhead

## What `Rip` Should Not Copy Exactly

Even though Zig's approach is strong, `Rip` should probably not imitate it exactly.

Main reasons:

- `Rip` wants a grammar-driven source of truth
- `Rip` wants a rewriter as a first-class stage
- `Rip` wants raw S-expression output
- `Rip` is still evolving its surface syntax quickly

Those goals are different enough that a fully hand-written parser architecture would likely be the wrong fit.

## What `Rip` Should Borrow

Even if `Rip` should not copy Zig's parser design literally, there are several excellent lessons to borrow.

### 1. Fully tokenize first, then parse

This is a very good boundary.

`Rip` should likely do:

```text
source
  -> BaseLexer
  -> rewriter (rip.zig: indentation, type stripping)
  -> parser
```

That keeps parsing simple and makes lookahead/backtracking easier.

### 2. Keep source references instead of copying text everywhere

Zig's AST refers back to source via token positions.

`Rip` should preserve this same spirit:

- sexps or intermediate structures should point into source when possible
- diagnostics should retain source origin through rewriting and normalization

### 3. Preserve strict phase boundaries

This is one of Zig's strongest architectural traits.

For `Rip`, the desired phase split should remain:

```text
lexer -> rewriter -> parser -> raw sexps -> normalization -> type resolution -> Zig emission
```

The important thing is to avoid backward entanglement between stages.

### 4. Keep the parser structurally simple

One of Zig's deeper lessons is not “write a hand parser.”
It is:

- keep the syntax disciplined enough that the parser stays boring

That is a valuable design principle for `Rip` too.

## Main Contrast With `Rip`

The best overall contrast is:

### Zig

- hand-written tokenizer
- hand-written parser
- indexed AST
- AST -> ZIR lowering

### Rip

- grammar-driven lexer/parser generation
- rewriter as a first-class stage
- parser emits raw sexps
- normalized sexps
- type resolution
- Zig emission

So `Rip` should aim to borrow Zig's discipline, not Zig's exact front-end implementation style.

## Best Current Takeaway

The best current takeaway is:

- Zig proves that strong stage separation is valuable
- Zig proves that concrete internal representations matter
- Zig does **not** suggest that `Rip` should abandon its grammar-driven / rewriter / sexp-based design

Instead, `Rip` should keep its own architecture and borrow the best implementation discipline from Zig.

## Note On Confidence

This note reflects our best current understanding from source inspection plus peer-AI review.

It is strong enough to guide `Rip` design decisions, but it should still be treated as:

- implementation-oriented understanding
- not a formal language-reference substitute

If we need deeper precision later, the next files to inspect more closely are:

- `misc/zig/lib/std/zig/Parse.zig`
- `misc/zig/lib/std/zig/tokenizer.zig`
- `misc/zig/lib/std/zig/Ast.zig`
- `misc/zig/lib/std/zig/AstGen.zig`
