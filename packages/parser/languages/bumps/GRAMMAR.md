## BUMPS (MUMPS) Grammar Overview

This document summarizes the BUMPS SLR(1) grammar and lexer used to parse M (MUMPS). It extracts the essential behavior and conventions from `bumps.coffee` and is intended for contributors and tool authors consuming the AST.

### Goals
- Parse core M commands, expressions, and line structure with space‑sensitive command parsing.
- Keep keywords non‑reserved: names can be identifiers in expressions while also serving as command words in command mode.
- Provide a clean, uniform AST suited for analysis, transform, and tooling.
- Model M‑specific constructs: postconditions, dot‑indent blocks, entry references, pattern matching, WRITE adorners, indirection, extended/naked globals, and transaction commands.

## Architecture

### Parser
- Start symbol: `program` → `lines` of `line`.
- Error recovery: a failed line produces `LineError` (line‑level recovery; parsing continues).
- Operator precedence: currently a flat left‑associative tier for all binary operators and a tighter right‑associative tier for unary. See “Operator Precedence” below.

### Lexer Modes
- INITIAL: line start. Recognizes leading dots (`DOTS`), labels (`LABEL`), and comments. Hands off to `CMD` when a label is followed by two or more spaces or an open paren.
- CMD: command keywords and command spacing (`CS`). A single space in `CMD` switches to argument parsing (`EXPR`) or `WEXPR` after `WRITE`. Postcondition colon in `CMD` starts `EXPR` with a `COLON`.
- EXPR: general expression mode with depth tracking (`yy.exprDepth`) for parentheses and space‑sensitive return to `CMD` when depth is 0. Pattern operator `?` switches to `PAT`.
- PAT: pattern sublanguage after `?`, with its own nesting depth (`yy.patDepth`). Returns to `EXPR` at top‑level comma or `)`.
- WEXPR: same as `EXPR` but with top‑level WRITE adorners gated by `yy.wItemStart`.

Mode hygiene on newline: resets `_afterWrite`, `wItemStart`, `inPostcond`, and depth counters, then returns to `INITIAL`.

## Tokens (selected)
- Structure: `NEWLINE`, `DOTS`, `LABEL`, `CS`, `COMMENT`.
- Punctuation: `LPAREN`, `RPAREN`, `COMMA`, `COLON`, `CARET`, `AT`, `VBAR`.
- Literals/Names: `STRING` (supports doubled quotes), `NUMBER` (integers, decimals, and scientific notation), `NAME`.
- Intrinsics: `DOLFN`, `ZDOLFN`, `DOLSPECVAR` (writable subset, gated by options; see below).
- Commands: `BREAK`, `CLOSE`, `DO`, `ELSE`, `FOR`, `GOTO`, `HALT`, `HANG`, `IF`, `JOB`, `KILL`, `LOCK`, `MERGE`, `NEW`, `OPEN`, `QUIT`, `READ`, `SET`, `USE`, `VIEW`, `WRITE`, `XECUTE`, `TSTART`, `TCOMMIT`, `TROLLBACK`, `TRESTART`, and vendor `ZCOMMAND`.
- Operators: arithmetic, relational, logical, concatenation, and pattern match (`PMATCH` for `?`, with negation via preceding `NOT`).
- Pattern atoms (PAT): `P_NUM`, `P_CODE`, `P_DOT` and `STRING`.
- WRITE adorners (WEXPR): `WBANG` (`!`), `WTAB` (`?expr`), `WPOUND` (`#`), `WSTAR` (`*expr`), `WSLASH` (`/expr`).

## Operator Precedence

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

## Lines, Labels, and Blocks
- `Line`: `{ depth, label, cmds, comment }`
  - `depth`: count of leading `.` characters.
  - `label`: `Label | null` where `Label` is `{ name, formals: Formal[] }`.
  - `cmds`: array of command/flow nodes parsed from the line.
  - `comment`: trailing comment text or `null`.
- Labels are recognized in `INITIAL` when an identifier is followed by two or more spaces or `(` (formals).
- Dot‑indent blocks are recorded per line via `DOTS` and should be attached in a post‑parse pass (by depth and adjacency).

## Postconditions and Command Spacing
- Postcondition: `postcond ::= ':' expr`.
- A pre‑command postcondition applies to the following command node: `postcond cmd` or `postcond CS cmd`. The parser attaches `pc` to nodes of type `Cmd | For | If | Else`.
- `ELSE` in GT.M/VistA does not support postconditions. The grammar may syntactically attach one via the general wrapper; downstream tooling should reject or ignore an `Else.pc` if present.
- `CS` (command space) is the syntactic separator between a command and its arguments, or between commands when depth returns to 0.

## Expressions
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

## Pattern Sublanguage
- Two forms are accepted:
  1) Inline token sequence: `pat_seq` of `pat_atom` values.
  2) Whole‑pattern token `PATTERN` parsed by a hook: if `yy.parsePattern` is provided, it is called with the raw source to build a structured pattern AST; otherwise, a raw node is produced.
- Grammar atoms:
  - Repeatable: `P_CODE` (class code), `STRING` (literal), or grouped `(` pat_alt `)`.
  - Quantifiers: `n.m what` → `PRange { min:n, max:m, what }`; `n what` → `PCount { count:n, what }`.
  - Alternation: `pat_seq (',' pat_seq)+`.
- Class codes currently recognized by the inline grammar: `[A C E L N P U]` (upper‑case). The external `parsePattern` helper supports canonicalization and additional long‑form codes.

## Commands and Arguments

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

## Entry References (for DO/GOTO/JOB)
`EntryRef { label: string|null, routine: string|null, offset: number|null, args: expr[], indirect?: Indirect }` supports:
- `LABEL(args)`
- `LABEL^ROUT(args)`
- `LABEL+n^ROUT(args)` and `LABEL-n^ROUT(args)`
- `^ROUT(args)`
- `@NAME(args)` and `@(expr)(args)`

## AST Quick Reference (selected)
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

## Options and Intrinsics
- `exports.options` feature gates for writable system variables in `SET` and `READ/WRITE` contexts:
  - `allowWritableDeviceVars` (default `false`): allows `$IO` / `$DEVICE` as `DOLSPECVAR`.
  - `allowWritableSystemVar` (default `false`): allows `$SYSTEM` as `DOLSPECVAR`.
- Intrinsic names: `exports.intrinsics` and `exports.isKnownIntrinsic(name)` are provided for tooling/hints; parsing accepts any `$name` and normalizes `$…` names to uppercase in the lexer.

## Abbreviations and Case
- Abbreviations: single‑letter forms for most commands are recognized (`w`, `r`, `s`, …). Full keywords are also recognized.
- Case:
  - `$…` and `$Z…` intrinsic names are normalized to uppercase in lexer actions.
  - Command token regexes currently match lowercase keywords and single‑letter forms. Extending to true case‑insensitive matching for commands is straightforward (either via character classes or by normalizing `yytext` in actions).
  - Variable and label names preserve case as written by the source.

## Error Handling
- Line‑level recovery: `line: error` returns `LineError` so the parser can continue on subsequent lines.
- Consumers should validate semantic constraints not enforced by syntax (e.g., disallow postconditions on `ELSE`).

## Samples
`exports.samples` (in `bumps.coffee`) contains a compact, categorized corpus that exercises labels, command chaining, postconditions, WRITE adorners, NEW/KILL nesting, LOCK timeouts, MERGE multi‑target shorthand, DO/GOTO entryrefs, IF/ELSE with dot‑blocks, device commands, XECUTE, intrinsic calls, indirection, pattern matching, extended/naked globals, negative entryref offsets, FOR headers, JOB variants, and Z‑commands.

## Development Notes
- Mode transitions carefully gate spaces and depth:
  - A space in `CMD` switches to `EXPR` or `WEXPR` (after `WRITE`).
  - A space in `EXPR` at depth 0 returns to `CMD` (or yields `CS` after a postcondition).
  - `PAT` exits at top‑level comma/`RPAREN` back to `EXPR`.
- The lexer resets state on newline across all modes.
- Provide `yy.parsePattern` to enable the rich external pattern parser.
- Provide `parser.yy.options` to configure writable `$` variable gates.

## Known Gaps / Future Enhancements
- Implement explicit multi‑tier operator precedence matching M semantics (see table above).
- Expand pattern class codes beyond `[A C E L N P U]` in the inline grammar; long‑form aliases are supported by the external parser.
- Make command tokenization fully case‑insensitive (accept uppercase/mixed‑case keywords).
- Optional “ELSE IF expr” sugar (emit as `If` or `ElseIf` node) if desired.
- Consider command indirection (`@"DO"`, etc.) if needed for advanced use cases.
- Optional support for longer unique command prefixes (beyond 1‑letter abbreviations).
- Harden depth underflow guards in rare recovery scenarios.


