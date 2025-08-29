## Indirection in BUMPS (M)

This document summarizes the current state of “command indirection” support in the BUMPS grammar/lexer and outlines the work needed to support VistA-grade indirection.

### What indirection means here
- The command itself is chosen indirectly, e.g. `@NAME args` or `@(expr) args`, where `NAME` or `expr` evaluates to a command string like `"WRITE"` or `"DO"`.
- We already support indirection for variables and entry references (e.g., `SET @A=1`, `DO @X`, `GOTO @(Y)`).

## Current capabilities
- Indirect commands:
  - `@NAME [args]` and `@(expr) [args]` parse as a generic command node:
    - `Cmd { op: "INDIRECT", args: ArgsINDIRECT { target: Indirect(name|expr), args: exprlist } }`
  - Samples included: `@CMD 1,2` and `@(F(1)) "A","B"`.
- Indirection elsewhere: `DO @X`, `GOTO @(Y)`, `SET @A=1`, `WRITE @(E)` all parse today.

## Gaps (why many realistic cases fail today)
When the indirect target refers to a specific command with a specialized argument shape, the generic "exprlist" path is insufficient:

- WRITE adorners (WEXPR gating):
  - `@("WRITE") !,"Hello"` — lexer treats `!` as OR (not `WBANG`) because WRITE gating is not enabled after the indirect target.

- Structured argument grammars:
  - `@("READ") X:1` — `READ` items are `lvalue[:timeout]`, not arbitrary expressions; colon-timeouts are invalid in plain `exprlist`.
  - `@("LOCK") (^A,^B(1):5)` — `LOCK` items are `lvalue[:timeout]`; `exprlist` doesn’t accept colon semantics in nested items.
  - `@("OPEN") 56:"/dev/tty":5` and `@("USE") 56:(NOPROMPT)` — device parameter chains use `:expr[:expr...]` and must parse to `ArgsDEVICE`.
  - `@("FOR") A=1:1:10 WRITE A` — FOR header is not an expression list; needs `for_specs`.
  - `@("SET") A=1,B=2` — assignment list must parse as `set_list`, not `Rel(EQ)` expressions.

- ELSE  IF chaining with indirect WRITE:
  - `ELSE  @("WRITE") !,"Else path"` — same WRITE-mode issue as above.

Bottom line: Generic `INDIRECT` with `exprlist` args can’t express the command-specific argument grammars (READ/LOCK/OPEN/USE/SET/WRITE/DO/GOTO/FOR/etc.).

## Implementation plan

### 1) Lexer: gate WRITE mode after indirect WRITE
- Case A: `@ NAME` form
  - If `NAME` resolves lexically to `write` (case-insensitive), then after the command-space that follows, set the write-expression mode (WEXPR):
    - Behavior: treat `! ? # * /` at top-level as WRITE adorners, not logical/arithmetic ops.

- Case B: `@(expr)` with a literal string
  - If the expression is a literal string `"WRITE"` (case-insensitive), enable WEXPR after the closing `)` and required command-space.

- Reset gating on newline (already done for WRITE and elsewhere).

Notes:
- This gating is purely lexical: it doesn’t resolve computed expressions, it only catches literal `WRITE` targets or `@WRITE` text.
- Unknown or dynamic `@(expr)` targets continue to use EXPR mode.

### 2) Grammar: specialized indirect-command productions
Add command-specific rules so that when the indirect target is a literal known command, the indirect form maps onto the same argument grammar as the direct command.

For each `CMD`, add two literal-target forms in `cmd` (examples shown; adapt to your code style):

- WRITE
  - `AT NAME[=WRITE] CS write_list`
  - `AT LPAREN STRING[=WRITE] RPAREN CS write_list`

- READ
  - `AT NAME[=READ] CS read_list`
  - `AT LPAREN STRING[=READ] RPAREN CS read_list`

- SET
  - `AT NAME[=SET] CS set_list`
  - `AT LPAREN STRING[=SET] RPAREN CS set_list`

- LOCK
  - `AT NAME[=LOCK] CS lock_items`
  - `AT LPAREN STRING[=LOCK] RPAREN CS lock_items`

- OPEN / USE / VIEW / CLOSE
  - `... CS device_args` (same two literal-target forms for each)

- DO / GOTO
  - `... CS entryref_list` (same two literal-target forms)

- FOR
  - `... CS for_specs` and a bare `...` form mapping to `For {specs: []}` (if you want `@("FOR")` without specs)

- IF
  - `... CS expr` (IF requires an expression)

- HANG / QUIT / BREAK / HALT
  - Map to the same argless or optional-expr forms as the direct spellings.

- XECUTE
  - `... CS exprlist`

Keep the existing generic fallback for `@NAME` / `@(expr)`:
- When the target is not a literal known command, continue to emit:
  - `Cmd { op: "INDIRECT", args: ArgsINDIRECT { target: Indirect(name|expr), args: exprlist } }`

### 3) Postcondition handling
- The existing `postcond CS cmd | postcond cmd` wrapper should continue to work around the specialized indirect forms, so `:X @("WRITE") ...` attaches the `pc` to the resulting node.

### 4) Tests to add
- Indirect WRITE with WEXPR adorners (including inside ELSE  IF chaining):
  - `@("WRITE") !,"Hello"`
  - `ELSE  @("WRITE") !,"Else path"`

- Indirect SET/READ/LOCK/OPEN/USE/VIEW/CLOSE with representative arguments:
  - `@("SET") A=1,B=2`
  - `@("READ") X:1`
  - `@("LOCK") (^A,^B(1):5)`
  - `@("OPEN") 56:"/dev/tty":5`, `@("USE") 56:(NOPROMPT)`, `@("CLOSE") 56`

- Indirect DO/GOTO/FOR/IF/XECUTE/HANG/QUIT/BREAK/HALT:
  - `@("DO") ^ROU`, `@("DO") @(E)`
  - `@("GOTO") ^ROU(1)`
  - `@("FOR") A=1:1:10 WRITE A`
  - `@("IF") A>3 WRITE !,"ok"`
  - `@("XECUTE") "W !,""hi"""`
  - `@("HANG") 1`, `@("QUIT")`, `@("BREAK")`, `@("HALT")`

- Generic fallback remains:
  - `@CMDVAR X,Y,Z` (no literal binding) should produce `Cmd op="INDIRECT"` with `ArgsINDIRECT`.

### 5) AST shape
- For literal-target indirect commands that bind to known commands, emit the same AST nodes as their direct forms (`Cmd op="WRITE"`, `ArgsWRITE`, etc.).
- For unknown/dynamic targets, keep `Cmd op="INDIRECT"` with `ArgsINDIRECT`.

### 6) VistA readiness
With the above lexer gating for indirect WRITE and grammar specializations for literal indirect targets, the listed examples will parse, covering VistA patterns such as:

```
@("WRITE") !,"Hello"
@("SET") A=1,B=2
@("READ") X:1
@("IF") A>3 WRITE !,"ok"
ELSE  @("WRITE") !,"Else path"
@CMDVAR X,Y,Z
@("DO") ^ROU
@("DO") @(E)
@("GOTO") ^ROU(1)
@("LOCK") (^A,^B(1):5)
@("OPEN") 56:"/dev/tty":5
@("USE") 56:(NOPROMPT)
@("CLOSE") 56
@("HANG") 1
@("FOR") A=1:1:10 WRITE A
@("XECUTE") "W !,""hi"""
```

## Backwards-compatibility
- Direct command forms are unchanged.
- Generic `@NAME` / `@(expr)` still parse to `Cmd op="INDIRECT"` when they don’t match a literal known command.
- WRITE gating is triggered only for the direct `WRITE` command and literal indirect `WRITE` targets.

## Optional Enhancements
- Also bind indirect `JOB` targets to `job_targets` when literal `"JOB"` is used.
- Add diagnostics when an indirect literal `"CMD"` has an argument shape that doesn’t match that command’s grammar.


