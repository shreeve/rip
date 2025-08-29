## Command Indirection in BUMPS (VistA-Compatible)

This document describes how command indirection works in VistA and how the BUMPS parser correctly handles it.

### What is Command Indirection?

Command indirection allows the command itself to be determined at runtime:
```mumps
SET CMD="WRITE"  @CMD !,"Hello"     ; CMD evaluated at runtime
SET CMD="SET"    @CMD A=1,B=2       ; Different command, different syntax
```

### How VistA/GT.M/YottaDB Handle Indirection

**Key Insight**: Command indirection is ALWAYS a runtime feature in standard MUMPS implementations.

#### Parse Time
- The parser treats `@expr` as an indirect command marker
- All following arguments are parsed as **generic expressions**
- Special characters are parsed as operators:
  - `!` → OR operator
  - `*` → MUL operator
  - `#` → MOD operator
  - `?` → Pattern match (if followed by pattern)

#### Runtime (Interpreter Responsibility)
1. **Evaluate** the indirect expression to get command string
2. **Re-interpret** the already-parsed tokens in command context
3. **Execute** with command-specific semantics

Example:
```mumps
@("WRITE") !,"Hello"
; Parse time: ! is OR operator
; Runtime: "WRITE" evaluated, ! re-interpreted as newline adorner
```

### Current BUMPS Implementation

The parser correctly handles indirection as generic:

```coffee
# From grammar.coffee
o 'AT NAME CS exprlist'              , '...'
o 'AT NAME'                          , '...'
o 'AT LPAREN expr RPAREN CS exprlist', '...'
o 'AT LPAREN expr RPAREN'            , '...'
```

This produces AST nodes:
```javascript
{
  type: "Cmd",
  op: "INDIRECT",
  args: {
    type: "ArgsINDIRECT",
    target: { type: "Indirect", kind: "name|expr", target: ... },
    args: [...]  // Generic expressions
  }
}
```

### Examples of Command Indirection

All of these parse with generic expression semantics:

```mumps
; Variable indirection
SET CMD="WRITE"  @CMD !,"Hello"

; Literal string indirection (NO special parsing)
@("SET") A=1,B=2

; Expression indirection
@($SELECT(MODE=1:"READ",1:"WRITE")) X

; Indirect with various commands
@("WRITE") !,"Text",*65,?10
@("READ") X:5
@("LOCK") +^A,-^B:10
@("DO") ^ROUTINE
```

### What the Interpreter Must Do

The BUMPS interpreter (not parser) must:

1. **For indirect commands**: Check if `op` is "INDIRECT"
2. **Evaluate target**: Get the command name string
3. **Re-interpret arguments**: Based on the command:
   - `WRITE`: Convert OR→WBANG, MUL→WSTAR, etc.
   - `READ`: Handle timeouts, prompts, etc.
   - `SET`: Convert EQ comparisons to assignments
   - `LOCK`: Handle increment/decrement forms
4. **Execute**: Run the command with re-interpreted arguments

### Non-Command Indirection (Already Working)

These forms of indirection work at parse time:

```mumps
; Variable name indirection
SET @VAR=123           ; LHS indirection
WRITE @EXPR            ; RHS indirection

; Entry reference indirection
DO @ROUTINE            ; Routine indirection
DO @("LABEL^ROUTINE")  ; Label+routine indirection
```

### Why Not Optimize Literal Strings?

VistA does NOT specially parse `@("WRITE")` differently from `@VAR`:
- Both are treated as runtime indirection
- No MUMPS implementation optimizes literals at parse time
- The parser cannot know command-specific semantics until runtime

### Testing Command Indirection

Current test coverage in `exports.samples`:
```mumps
; Variable indirection
SET CMD="WRITE"  @CMD !,"Hello"

; Literal indirection (parses but needs runtime interpretation)
@("SET") A=1,B=2
@("KILL") (A,B,C)
```

These parse successfully but with generic semantics. The interpreter must handle the command-specific re-interpretation.

### Summary

✅ **Parser**: Correctly treats all command indirection as generic expressions
✅ **AST**: Properly marks indirect commands with `op: "INDIRECT"`
⚠️ **Interpreter**: Must implement runtime re-interpretation of arguments

This design matches VistA/GT.M/YottaDB exactly - command indirection is always resolved at runtime, never at parse time.