# Stage Ownership

## Purpose

For each compiler stage, what it owns. For the syntax surface itself, see `docs/syntax.md`.

## Pipeline

1. **BaseLexer** — generated from `zag.grammar`. Tokenization, state variables, character-class dispatch.
2. **Rewriter** — in `zag.zig`. Indentation tracking (indent/outdent), type annotation passthrough, duplicate newline suppression, comment handling.
3. **Parser** — generated SLR(1). Produces raw S-expressions directly.
4. **Normalization** — (future) canonical structural forms.
5. **Type resolution** — `compiler.zig` pre-pass. Builds symbol table from fun/sub declarations (return types, visibility, param typing). Used for void-call detection, var binding type inference, and declaration warnings.
6. **Zig emission** — `compiler.zig`. Tag-based dispatch, walks sexps, emits readable Zig source.

## Token Metadata Contract

The token model should eventually support at least:

- `.pre` — preceding whitespace count
- `.spaced` — token has preceding whitespace
- `.lineStart` — token begins a logical line
- `.lineEnd` — token is followed by a logical line break
- `.loc` — source location
- `.data` — extra token metadata

Currently only `.pre`, `.pos`, `.len`, and `.cat` are implemented.

## Rewriter Responsibilities

These features should stay in the rewriter rather than being pushed into the grammar:

- indentation tracking (indent/outdent token synthesis)
- type annotation passthrough (`: type` and `-> type`)
- duplicate newline suppression
- comment-line handling during indent changes
- leading blank line suppression
- spacing-sensitive minus classification (`-` prefix vs infix based on adjacency)
- future: implicit call inference for other operators

## Grammar Responsibilities

- routine declarations (`fun`, `sub`)
- control flow (`if`, `while`, `for`, `match`)
- bindings and assignments
- type declarations (`enum`, `struct`, `error`, `type`)
- expression precedence via `@infix`
- block structure via `INDENT`/`OUTDENT`

## Compiler Responsibilities

- Tag-based dispatch on S-expression nodes
- Scope tracking (var vs const inference via pre-scan)
- Type resolution pre-pass (symbol table from fun/sub declarations)
- Type-aware emission (explicit types from source, inferred from callee return types, defaults for untyped)
- Void-call detection (skip `_ = ` prefix for void-returning calls)
- Declaration diagnostics (warnings for untyped pub/extern boundaries)
- Zig-specific lowering (print mapping, for-range to while, `??` to orelse, captures to |val| pipes)

## Notes

- The lexer does more than raw tokenization, but less than full syntactic inference.
- The rewriter is where most "Zag beauty" lives.
- The grammar stays smaller because the rewriter clarifies token structure first.
- The goal is not to eliminate the rewriter — it is to make it small, principled, and debuggable.
