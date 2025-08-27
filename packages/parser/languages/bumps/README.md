## BUMPS (MUMPS) grammar using Solar SLR(1)

This folder contains a CoffeeScript/Rip-based grammar (`bumps.coffee`) for the M (MUMPS) language, targeting the Solar SLR(1) parser generator (`packages/parser/solar.coffee`). The design mirrors how CoffeeScript’s own grammar is authored and compiled within this repo, but adapted to M’s syntax and whitespace/command rules.

### Current status

- Grammar file: `packages/parser/languages/bumps/bumps.coffee`
- Linter: 0 errors (as of latest edits)
- Major cleanups completed:
  - Normalized relational operators to named tokens: `GT`, `LT`, `GE`, `LE`, `EQ`, `NE`, `CONTAINS`, `NCONTAINS`, `FOLLOWS`, `NFOLLOWS`, `SORTAFTER`, `NSORTAFTER`.
  - Fixed typo `NFOLOWS` → `NFOLLOWS` in both grammar and lexer.
  - Removed unused `LS` token and the `opt_ls` rule; simplified `opt_label` accordingly.
  - Restructured operator precedence to better reflect M semantics (see below).
  - Corrected lexer escaping and quoting around `'`, `?`, `]`, and `]]` to avoid parser/linter issues.

### Operator precedence (high → low)

- Unary: `NOT`, `UPLUS`, `UMINUS`
- Exponent: `EXP` (`**` if supported)
- Multiplicative: `MUL`, `DIV`, `IDIV`, `MOD` (`*`, `/`, `\`, `#`)
- Additive: `PLUS`, `MINUS`
- String concat: `CONCAT` (`_`)
- Pattern: `PMATCH` (`?`)
- Relational (nonassoc): `GT`, `LT`, `GE`, `LE`, `EQ`, `NE`, `CONTAINS`, `NCONTAINS`, `FOLLOWS`, `NFOLLOWS`, `SORTAFTER`, `NSORTAFTER`
- Logical: `AND`, then `OR`

This layout reduces shift/reduce risk and matches how M’s expressions are typically evaluated.

### Lexer and parsing model

- The grammar includes a Jison-style lex spec (`exports.lex`) to document tokenization rules for M, including:
  - Command/expr modes (space-separated commands, dot-indentation, labels/tags)
  - Command abbreviations normalized into canonical tokens
  - Postconditions (`:`) and argument separators
  - Operators and patterns, with negations expressed as distinct tokens (e.g. `NFOLLOWS`)

Note: Solar currently focuses on generating the parser. It doesn’t compile `exports.lex` into a runtime lexer. At parse time, attach a lexer that implements `setInput` and `lex` (Jison-style). The included lex spec can be used as the source for such a lexer (e.g., via jison-lex or a lightweight adapter).

### Build (generate the parser)

Use Solar to generate a CommonJS parser module from the grammar:

```bash
coffee packages/parser/solar.coffee -g \
  -o packages/parser/languages/bumps/parser.js \
  packages/parser/languages/bumps/bumps.coffee
```

Add `-s` to print grammar stats, or `-c` to emit a Brotli-compressed build.

### Runtime wiring (how to parse)

At runtime the Solar-generated parser expects:

- A lexer with `setInput(input, yy)` and `lex()` that returns token names or ids, and sets `yytext`, `yyleng`, `yylineno`, `yylloc`.
- A `yy` object supplying any helpers/functions/classes referenced by grammar actions. For this grammar, `yy.node(type, props)` is sufficient (a trivial factory is provided via `moduleInclude` if not supplied).

Minimal adapter example (pseudocode):

```js
const parser = require('./parser.js');

class LexerAdapter { /* implement setInput, lex, showPosition */ }

parser.yy = { node: (type, props) => ({ type, ...props }) };
parser.lexer = new LexerAdapter();

const ok = parser.parse(source);
```

If you compile the Jison-style `exports.lex` into a lexer with jison-lex, bind its instance as `parser.lexer`.

### Important consistency note (assignment token)

The grammar currently uses `EQUAL` for `set_item` (`lvalue EQUAL expr`), but the lexer returns `EQ` for `=`. Pick one of these approaches before generating the parser:

- Preferred: change the grammar to use `EQ` in `set_item`.
- Alternative: modify the lexer to emit `EQUAL` (only where appropriate) instead of `EQ`.

### Design choices that make SLR(1) work for M

- Move context-sensitive concerns into the lexer/rewriter: command position, abbreviations, space-separated command lists, dot indentation to `INDENT/OUTDENT` depth, and postconditions. Keep the grammar LR-friendly.
- Normalize negated relations and pattern matches into distinct tokens (`NE`, `NCONTAINS`, `NFOLLOWS`, `NSORTAFTER`, etc.) to avoid binding quirks around `'`.
- Keep commands and expressions separate, with a `CommandList` and per-command productions that accept optional postconditions and arguments.

### What’s next

- Align the `EQUAL` vs `EQ` token (see consistency note above).
- Expand command argument patterns (many are scaffolded: `SET`, `KILL`, `NEW`, `DO`, `WRITE`, `READ`).
- Decide on whether to generate a lexer from `exports.lex` (jison-lex) or maintain a hand-written adapter.
- Add a small `run-bumps.js` like the CoffeeScript `run-parse.js` if you’d like a one-command demo.

### Inception bonus

The BUMPS grammar is authored in CoffeeScript/Rip and compiled by Solar—the same pipeline used to generate CoffeeScript’s own parser here—parsing a grammar that itself documents the lexer and parser for M. Layers on layers. 🎯
