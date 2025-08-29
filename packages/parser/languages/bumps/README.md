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

### Runner

- Runner can optionally print debug info by setting `BUMPS_DEBUG=1`.

Examples:

```bash
# Print tokens and AST JSON for the default sample
BUMPS_DEBUG=1 node packages/parser/languages/bumps/run-bumps.cjs

# Or for a specific file
BUMPS_DEBUG=1 node packages/parser/languages/bumps/run-bumps.cjs path/to/file.b
```

When enabled, the runner prints the token stream (as `[tag, value]` pairs) and the parsed AST JSON. This is useful for verifying lexer output and grammar reductions while iterating.

### Performance and trade-offs

- Performance: LR parsing is linear in input size with small constant factors (table lookups). Solar emits compact tables and straight-line code; generation time is irrelevant at runtime.
- Maintainability: the grammar is declarative and readable; precedence/associativity are explicit. Evolution is mostly editing productions, not control flow.
- Pros vs hand-rolled: clearer spec, deterministic performance (no backtracking), easier refactors, and shared toolchain with CoffeeScript.
- Cons/notes: push context sensitivity (command position, abbreviations, dot-indentation, postconditions) into the lexer/rewriter; polish error messages; incremental/streaming parsing would require extra work.
- Net: fast enough and easy to work with. With context handled in the lexer/rewriter, the SLR(1) parser remains both performant and maintainable for M.

### Important consistency note (assignment token)

The grammar currently uses `EQUAL` for `set_item` (`lvalue EQUAL expr`), but the lexer returns `EQ` for `=`. Pick one of these approaches before generating the parser:

- Preferred: change the grammar to use `EQ` in `set_item`.
- Alternative: modify the lexer to emit `EQUAL` (only where appropriate) instead of `EQ`.

### Design choices that make SLR(1) work for M

- Move context-sensitive concerns into the lexer/rewriter: command position, abbreviations, space-separated command lists, dot indentation to `INDENT/OUTDENT` depth, and postconditions. Keep the grammar LR-friendly.
- Normalize negated relations and pattern matches into distinct tokens (`NE`, `NCONTAINS`, `NFOLLOWS`, `NSORTAFTER`, etc.) to avoid binding quirks around `'`.
- Keep commands and expressions separate, with a `CommandList` and per-command productions that accept optional postconditions and arguments.

### Command Indirection in VistA

Command indirection (`@VAR args` or `@(expr) args`) is handled as follows:

- **Parser**: Treats all arguments after `@expr` as generic expressions (`exprlist`). Special characters like `!`, `*`, `#` are parsed as operators (OR, MUL, MOD) not as command-specific adorners.
- **Interpreter** (runtime): Must re-interpret the parsed tokens in command context:
  1. Evaluate the indirect expression to get the command name
  2. Re-interpret the argument tokens according to that command's grammar
  3. Execute with proper command-specific semantics

This matches VistA/GT.M/YottaDB behavior - there is NO special parsing for literal strings like `@("WRITE")`. All command indirection is resolved at runtime, not parse time.

### What’s next

- Align the `EQUAL` vs `EQ` token (see consistency note above).
- Expand command argument patterns (many are scaffolded: `SET`, `KILL`, `NEW`, `DO`, `WRITE`, `READ`).
- Decide on whether to generate a lexer from `exports.lex` (jison-lex) or maintain a hand-written adapter.
- Add a small `run-bumps.js` like the CoffeeScript `run-parse.js` if you’d like a one-command demo.

### Inception bonus

The BUMPS grammar is authored in CoffeeScript/Rip and compiled by Solar—the same pipeline used to generate CoffeeScript’s own parser here—parsing a grammar that itself documents the lexer and parser for M. Layers on layers. 🎯

### Argumentless commands (standard M)
```

These have an argumentless form in the ANSI/X11/ISO sense (and in YottaDB/GT.M). I’m citing YottaDB because it documents the exact forms clearly:

BREAK — may be used with no argument; when followed by another command on the same line, at least two spaces must follow BREAK.
YottaDB Documentation

DO — has a no-argument form that transfers control to the next dot-indented line; also requires the two-spaces rule when followed by another command.
YottaDB Documentation

ELSE — has no arguments by design (it’s just ELSE plus the rest-of-line scope). (Same page’s command list; ELSE is the no-args branch of IF.)
YottaDB Documentation

FOR — the lvn=expr[:…] part is optional, so plain FOR is legal and controls the rest-of-line scope. Note: FOR is a conditional command and does not take a command postconditional.
YottaDB Documentation

HALT — no argument (only an optional postconditional).
YottaDB Documentation

IF — the truth-valued expression list is optional; IF alone tests $TEST. Note: IF is conditional and does not allow a command postconditional.
YottaDB Documentation

KILL — the argument list is optional; KILL alone is valid (kills locals per implementation rules).
YottaDB Documentation

LOCK — the argument list is optional; argumentless LOCK is valid (commonly used to release all locks). InterSystems docs state the “release all locks” behavior explicitly.
YottaDB Documentation
InterSystems Documentation

NEW — the variable list is optional; NEW alone is valid (new all locals per scope rules).
YottaDB Documentation

QUIT — optional argument; QUIT alone is valid. (YottaDB notes “commands without arguments such as QUIT…”, InterSystems QUIT page shows both forms.)
YottaDB Documentation
InterSystems Documentation

TCOMMIT — no argument.
YottaDB Documentation

TROLLBACK — optional integer argument; argumentless form is valid.
YottaDB Documentation

TSTART — arguments optional; argumentless form is valid.
YottaDB Documentation

Everything else in the base set requires arguments (e.g., CLOSE, GOTO, HANG, JOB, MERGE, OPEN, READ, SET, USE, VIEW, WRITE, XECUTE).
```

## Grammar Overview

This section summarizes the BUMPS SLR(1) grammar and lexer used to parse M (MUMPS). It extracts the essential behavior and conventions from `bumps.coffee` and is intended for contributors and tool authors consuming the AST.

### Goals
- Parse core M commands, expressions, and line structure with space‑sensitive command parsing.
- Keep keywords non‑reserved: names can be identifiers in expressions while also serving as command words in command mode.
- Provide a clean, uniform AST suited for analysis, transform, and tooling.
- Model M‑specific constructs: postconditions, dot‑indent blocks, entry references, pattern matching, WRITE adorners, indirection, extended/naked globals, and transaction commands.

### Architecture

#### Parser
- Start symbol: `program` → `lines` of `line`.
- Error recovery: a failed line produces `LineError` (line‑level recovery; parsing continues).
- Operator precedence: currently a flat left‑associative tier for all binary operators and a tighter right‑associative tier for unary. See “Operator Precedence” below.

#### Lexer Modes
- INITIAL: line start. Recognizes leading dots (`DOTS`), labels (`LABEL`), and comments. Hands off to `CMD` when a label is followed by two or more spaces or an open paren.
- CMD: command keywords and command spacing (`CS`). A single space in `CMD` switches to argument parsing (`EXPR`) or `WEXPR` after `WRITE`. Postcondition colon in `CMD` starts `EXPR` with a `COLON`.
- EXPR: general expression mode with depth tracking (`yy.exprDepth`) for parentheses and space‑sensitive return to `CMD` when depth is 0. Pattern operator `?` switches to `PAT`.
- PAT: pattern sublanguage after `?`, with its own nesting depth (`yy.patDepth`). Returns to `EXPR` at top‑level comma or `)`.
- WEXPR: same as `EXPR` but with top‑level WRITE adorners gated by `yy.wItemStart`.

Mode hygiene on newline: resets `_afterWrite`, `wItemStart`, `inPostcond`, and depth counters, then returns to `INITIAL`.

### Tokens (selected)
- Structure: `NEWLINE`, `DOTS`, `LABEL`, `CS`, `COMMENT`.
- Punctuation: `LPAREN`, `RPAREN`, `COMMA`, `COLON`, `CARET`, `AT`, `VBAR`.
- Literals/Names: `STRING` (supports doubled quotes), `NUMBER` (integers, decimals, and scientific notation), `NAME`.
- Intrinsics: `DOLFN`, `ZDOLFN`, `DOLSPECVAR` (writable subset, gated by options; see below).
- Commands: `BREAK`, `CLOSE`, `DO`, `ELSE`, `FOR`, `GOTO`, `HALT`, `HANG`, `IF`, `JOB`, `KILL`, `LOCK`, `MERGE`, `NEW`, `OPEN`, `QUIT`, `READ`, `SET`, `USE`, `VIEW`, `WRITE`, `XECUTE`, `TSTART`, `TCOMMIT`, `TROLLBACK`, `TRESTART`, and vendor `ZCOMMAND`.
- Operators: arithmetic, relational, logical, concatenation, and pattern match (`PMATCH` for `?`, with negation via preceding `NOT`).
- Pattern atoms (PAT): `P_NUM`, `P_CODE`, `P_DOT` and `STRING`.
- WRITE adorners (WEXPR): `WBANG` (`!`), `WTAB` (`?expr`), `WPOUND` (`#`), `WSTAR` (`*expr`), `WSLASH` (`/expr`).

### Operator Precedence

Current implementation:
- Binary operators: flat, left‑associative tier: `OR AND CONCAT GT LT GE LE EQ NE CONTAINS NCONTAINS FOLLOWS NFOLLOWS SORTAFTER NSORTAFTER PLUS MINUS MUL DIV IDIV MOD EXP PMATCH`.
- Unary operators: tighter, right‑associative: `UPLUS UMINUS NOT`.

Recommended tiering for closer M semantics (future enhancement):
1) right `EXP`
2) left `MUL DIV IDIV MOD`
3) left `PLUS MINUS`
4) left `CONCAT`
5) left `CONTAINS NCONTAINS FOLLOWS NFOLLOWS SORTAFTER NSORTAFTER`
6) left `GT LT GE LE EQ NE`
7) left `PMATCH`
8) left `AND`
9) left `OR`
10) right `UPLUS UMINUS NOT`

### Lines, Labels, and Blocks
- `Line`: `{ depth, label, cmds, comment }`
  - `depth`: count of leading `.` characters.
  - `label`: `Label | null` where `Label` is `{ name, formals: Formal[] }`.
  - `cmds`: array of command/flow nodes parsed from the line.
  - `comment`: trailing comment text or `null`.
- Labels are recognized in `INITIAL` when an identifier is followed by two or more spaces or `(` (formals).
- Dot‑indent blocks are recorded per line via `DOTS` and should be attached in a post‑parse pass (by depth and adjacency).

### Postconditions and Command Spacing
- Postcondition: `postcond ::= ':' expr`.
- A pre‑command postcondition applies to the following command node: `postcond cmd` or `postcond CS cmd`. The parser attaches `pc` to nodes of type `Cmd | For | If | Else`.
- `ELSE` in GT.M/VistA does not support postconditions. The grammar may syntactically attach one via the general wrapper; downstream tooling should reject or ignore an `Else.pc` if present.
- `CS` (command space) is the syntactic separator between a command and its arguments, or between commands when depth returns to 0.

### Expressions
- Primary forms: numbers, strings, variables (`varref`), parenthesized expressions, and intrinsic calls.
- Numbers: integers and decimals, with optional exponent part (e.g., `1`, `3.`, `.5`, `6.02E23`).
- Strings: `"…"` with doubled quotes `""` as literal quotes.
- Variables (`Var`):
  - Local: `NAME opt_subs` → `{ global: false, name, subs: expr[] }`.
  - Global: `^ NAME opt_subs` → `{ global: true, name, subs }`.
  - Extended: `^|env-expr|NAME(subs)` → `{ global: true, env: expr, name, subs }`.
  - Naked: `^(subs)` or `^|env-expr|(subs)` → `NakedRef { env?: expr, subs: expr[] }`.
- Indirection: `@NAME` or `@(expr)` → `Indirect { kind: 'name' | 'expr', target }`. Appears in expressions and as LHS in certain contexts (e.g., `SET`).
- Intrinsics:
  - `$NAME(args)` → `DollarFn { name: 'NAME', args }` (name normalized uppercase in the lexer for `$…` and `$Z…`).
  - `$X`, `$Y`, `$ECODE`, `$ETRAP`, `$IO`, `$DEVICE`, `$SYSTEM` can be emitted as `DollarVar { name, writable: true }` when options allow (see Options).
- Pattern match: `expr ? pattern` or `expr ' ? pattern` → `PatternMatch { op: 'PMATCH' | 'NPMATCH', lhs, pat }`.

### Pattern Sublanguage
- Two forms are accepted:
  1) Inline token sequence: `pat_seq` of `pat_atom` values.
  2) Whole‑pattern token `PATTERN` parsed by a hook: if `yy.parsePattern` is provided, it is called with the raw source to build a structured pattern AST; otherwise, a raw node is produced.
- Grammar atoms:
  - Repeatable: `P_CODE` (class code), `STRING` (literal), or grouped `(` pat_alt `)`.
  - Quantifiers: `n.m what` → `PRange { min:n, max:m, what }`; `n what` → `PCount { count:n, what }`.
  - Alternation: `pat_seq (',' pat_seq)+`.
- Class codes currently recognized by the inline grammar: `[A C E L N P U]` (upper‑case). The external `parsePattern` helper supports canonicalization and additional long‑form codes.

### Commands and Arguments

Command nodes use `Cmd { pc: expr|null, op: string, args: Args|[] }` except where specialized flow nodes are used (`For`, `If`, `Else`). Arguments are typed by command for clarity downstream.

- SET
  - `SET name=expr, name(subs)=expr, @X=expr, @(expr)=expr, $PIECE(...)=expr, $EXTRACT(...)=expr`
  - AST: `ArgsSET { items: Set[] }`, each `Set { lhs, rhs }`.
  - LHS forms:
    - `varref` (locals/globals with subscripts)
    - writable `$` vars (gated)
    - `$PIECE(...)` → `PieceLHS`, `$EXTRACT(...)` → `ExtractLHS`
    - Indirection `@NAME` or `@(expr)`

- NEW
  - `NEW name[,name|@name|@(expr)|(...)]`
  - AST: `ArgsNEW { names: (string|Indirect)[] }` with nested groups flattened.

- KILL
  - Items: `lvalue` or grouped `( … )` with nesting; indirection allowed.
  - AST: `ArgsKILL { items: lvalue[] }` with nested groups flattened.

- MERGE
  - `lvalue = lvalue` or multi‑target shorthand `(A,B)=C`.
  - AST: one or more `Merge { target, source }` (shorthand expands to multiple nodes).

- READ
  - Items: `ReadItem { lhs: lvalue, timeout: expr|null }` with optional per‑item timeout (via colon).
  - AST: `ArgsREAD { items: ReadItem[] }`.

- WRITE
  - Items may be expressions or adorners:
    - `WTab { expr }`, `WNL`, `WFF`, `WAscii { expr }`, `WFormat { expr }`, and `WExpr { expr }`.
    - PatternMatch items are preserved directly (not wrapped as `WExpr`).
  - AST: `ArgsWRITE { items: (WExpr|WNL|WFF|WTab|WAscii|WFormat|PatternMatch)[] }`.

- OPEN, USE, VIEW, CLOSE
  - Device specs: `expr[:p1[:p2[:…]]]` with comma‑separated devices.
  - AST: `ArgsDEVICE { specs: DeviceSpec[] }`, each `DeviceSpec { device: expr, params: expr[] }`.

- JOB
  - Targets: `entryref[:p1[:p2[:…]]]` comma‑separated.
  - AST: `JobTarget { target: EntryRef, params: expr[] }`; in `Cmd.args`, the list is used directly.

- DO, GOTO
  - Use `entryref_list` where `EntryRef` supports: `label`, `^routine`, `label^routine`, `label±n^routine`, and indirection forms `@NAME`, `@(expr)` with optional arguments.
  - DO’s args are wrapped: `ArgsENTRY { targets: EntryRef[] }`.

- FOR
  - Header specs: `NAME = from : to [: step]` with one or more specs separated by commas.
  - AST: `For { pc, specs: ForSpec[] }`, `ForSpec { name, from, to, step }` (default `step = 1`).

- IF, ELSE
  - `If { pc, cond }` and `Else { pc|null }` (note: postcondition on ELSE should be treated as invalid by consumers).

- Transactions
  - `TSTART [exprlist]`, `TCOMMIT`, `TROLLBACK`, `TRESTART [exprlist]` with and without postconditions.

- HALT, BREAK, QUIT, HANG
  - `QUIT` and `HANG` optionally accept an expression argument; others are argless.

- Z‑commands
  - Vendor commands: any `z…` word in `CMD` is tokenized as `ZCOMMAND` with the name upper‑cased in the lexer; may accept `exprlist`.

### Entry References (for DO/GOTO/JOB)
`EntryRef { label: string|null, routine: string|null, offset: number|null, args: expr[], indirect?: Indirect }` supports:
- `LABEL(args)`
- `LABEL^ROUT(args)`
- `LABEL+n^ROUT(args)` and `LABEL-n^ROUT(args)`
- `^ROUT(args)`
- `@NAME(args)` and `@(expr)(args)`

### AST Quick Reference (selected)
- `Program { lines }`
- `Line { depth, label, cmds, comment }`
- `Label { name, formals }`, `Formal { name }`
- `Cmd { pc, op, args }`
- `For { pc, specs }`, `ForSpec { name, from, to, step }`
- `If { pc, cond }`, `Else { pc }`
- `Var { global, name, subs, env? }`, `NakedRef { env?, subs }`
- `Indirect { kind, target }`
- `DollarFn { name, args, zext? }`, `DollarVar { name, writable? }`
- `BinOp { op, lhs, rhs }`, `UnOp { op, expr }`, `Rel { op, lhs, rhs }`
- `PatternMatch { op, lhs, pat }`, `Pattern { atoms }`
- `ArgsSET { items }`, `Set { lhs, rhs }`
- `ArgsREAD { items }`, `ReadItem { lhs, timeout }`
- `ArgsWRITE { items }`, `WExpr|WNL|WFF|WTab|WAscii|WFormat`
- `ArgsDEVICE { specs }`, `DeviceSpec { device, params }`
- `ArgsKILL { items }`, `ArgsNEW { names }`, `ArgsENTRY { targets }`
- `JobTarget { target, params }`, `Merge { target, source }`
- `EntryRef { label, routine, offset, args, indirect? }`
- `LineError {}`

### Options and Intrinsics
- `exports.options` feature gates for writable system variables in `SET` and `READ/WRITE` contexts:
  - `allowWritableDeviceVars` (default `false`): allows `$IO` / `$DEVICE` as `DOLSPECVAR`.
  - `allowWritableSystemVar` (default `false`): allows `$SYSTEM` as `DOLSPECVAR`.
- Intrinsic names: `exports.intrinsics` and `exports.isKnownIntrinsic(name)` are provided for tooling/hints; parsing accepts any `$name` and normalizes `$…` names to uppercase in the lexer.

### Abbreviations and Case
- Abbreviations: single‑letter forms for most commands are recognized (`w`, `r`, `s`, …). Full keywords are also recognized.
- Case:
  - `$…` and `$Z…` intrinsic names are normalized to uppercase in lexer actions.
  - Command token regexes currently match lowercase keywords and single‑letter forms. Extending to true case‑insensitive matching for commands is straightforward (either via character classes or by normalizing `yytext` in actions).
  - Variable and label names preserve case as written by the source.

### Error Handling
- Line‑level recovery: `line: error` returns `LineError` so the parser can continue on subsequent lines.
- Consumers should validate semantic constraints not enforced by syntax (e.g., disallow postconditions on `ELSE`).

### Samples
`exports.samples` (in `bumps.coffee`) contains a compact, categorized corpus that exercises labels, command chaining, postconditions, WRITE adorners, NEW/KILL nesting, LOCK timeouts, MERGE multi‑target shorthand, DO/GOTO entryrefs, IF/ELSE with dot‑blocks, device commands, XECUTE, intrinsic calls, indirection, pattern matching, extended/naked globals, negative entryref offsets, FOR headers, JOB variants, and Z‑commands.

### Development Notes
- Mode transitions carefully gate spaces and depth:
  - A space in `CMD` switches to `EXPR` or `WEXPR` (after `WRITE`).
  - A space in `EXPR` at depth 0 returns to `CMD` (or yields `CS` after a postcondition).
  - `PAT` exits at top‑level comma/`RPAREN` back to `EXPR`.
- The lexer resets state on newline across all modes.
- Provide `yy.parsePattern` to enable the rich external pattern parser.
- Provide `parser.yy.options` to configure writable `$` variable gates.

### Known Gaps / Future Enhancements
- Implement explicit multi‑tier operator precedence matching M semantics (see table above).
- Expand pattern class codes beyond `[A C E L N P U]` in the inline grammar; long‑form aliases are supported by the external parser.
- Make command tokenization fully case‑insensitive (accept uppercase/mixed‑case keywords).
- Optional “ELSE IF expr” sugar (emit as `If` or `ElseIf` node) if desired.
- Consider command indirection (`@"DO"`, etc.) if needed for advanced use cases.
- Optional support for longer unique command prefixes (beyond 1‑letter abbreviations).
- Harden depth underflow guards in rare recovery scenarios.
