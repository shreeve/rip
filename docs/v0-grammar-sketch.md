# Rip V0 Grammar

The authoritative grammar lives in `rip.grammar` at the repo root. It defines both the lexer and parser in a single file, processed by `src/grammar.zig` to generate `src/parser.zig`.

## Current Nonterminals

```
program  body  stmt  block
fun  sub  use  params
expr  if  return  assign  const
unary  call  args  atom
```

## Key Features

- `body` uses NEWLINE as separator (not terminator) — one rule shared by top-level and blocks
- `block` is `INDENT body OUTDENT`
- `@infix` auto-generates the operator precedence chain from a declarative table
- `L(X)` handles comma-separated lists (params, args, implicit calls)
- `@as = [ident, keyword]` enables context-sensitive keyword promotion
- Zero parser conflicts

See `docs/architecture.md` for the grammar engine pipeline and `docs/v0-syntax.md` for the language surface spec.
