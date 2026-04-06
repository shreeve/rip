# Grammar DSL Reference

The grammar DSL defines both lexer and parser in a single `.grammar` file. The grammar engine (`src/grammar.zig`) reads this file and generates `src/parser.zig`.

## File Structure

```
@lang = "rip"          # language module (imports rip.zig)

@lexer                 # lexer section

state                  # state variables with initial values
    ...
after                  # state resets applied after each token
    ...
tokens                 # token type declarations
    ...
<pattern> → <token>    # lexer rules

@parser                # parser section

@conflicts = 0         # expected conflict count
@as = [ident, keyword] # context-sensitive keyword promotion

<rule> = <elements> → <action>   # parser rules

@infix <base>          # operator precedence table
    ...
```

All block declarations (`state`, `after`, `tokens`, `@infix`) use indentation — no braces or brackets.

---

## Lexer

### State Variables

```
state
    beg   = 1       # initial value (i32)
    paren = 0
```

Persist across tokens within a single parse. Reset on lexer reset.

### After (Post-Token Reset)

```
after
    beg = 0         # applied after each token unless rule overrides
```

### Token Types

```
tokens
    ident           # one per line, optional trailing comment
    integer
    plus            # +
```

Generates a `TokenCat` enum in Zig.

### Lexer Rules

```
<pattern>                        → <token>
<pattern>                        → <token>, {action}
<pattern>  @ <guard>             → <token>, {action}
```

**Patterns** (regex-like):

| Syntax | Meaning |
|--------|---------|
| `'x'` | Literal character |
| `"xy"` | Literal string |
| `[abc]` | Character class |
| `[a-z]` | Character range |
| `[^x]` | Negated class |
| `.` | Any character (except newline) |
| `X*` | Zero or more |
| `X+` | One or more |
| `X?` | Optional |
| `(X)` | Grouping |

**Guards** (conditional on state):

```
'(' @ beg              → lparen      # when beg is non-zero
')' @ !pat             → rparen      # when pat is zero
'!' @ pre > 0          → exclaim_ws  # when preceded by whitespace
```

`pre` is a pseudo-variable — the whitespace count computed at the start of each `matchRules()` call.

**Actions**:

| Syntax | Effect |
|--------|--------|
| `{var = val}` | Set variable |
| `{var++}` | Increment |
| `{var--}` | Decrement |
| `skip` | Don't emit token (discard) |
| `simd_to 'x'` | SIMD-accelerated scan to character |

**Examples**:

```
'\n'                             → newline, {beg = 1}
'('                              → lparen, {paren++}
"=="                             → eq
[a-zA-Z_][a-zA-Z0-9_]* '?'?     → ident
.                                → err
```

---

## Parser

### Rule Syntax

```
rulename = element1 element2     → (action)
         | alternative           → (action)
```

- Lowercase names = nonterminals (grammar rules)
- UPPERCASE names = terminals (lexer tokens)
- `"literal"` = match exact token value

### Quantifiers

| Syntax | Meaning |
|--------|---------|
| `X?` | Optional |
| `X*` | Zero or more |
| `X+` | One or more |

### Lists

`L(X)` = comma-separated list of X (one or more):

```
params = L(name)                 → (...1)
args   = L(expr)                 → (...1)
```

`L(X, sep)` = list with custom separator.

### Start Symbols

Mark entry points with `!`:

```
program! = body                  → (module ...1)
expr!    = expr                  → 1
```

Generates `parseProgram()` and `parseExpr()` methods.

### Aliases

```
name = IDENT
```

Zero-cost redirect — `name` is treated as `IDENT` everywhere.

### Actions (S-Expression Output)

Actions specify what S-expression to emit. Numbers reference matched elements by position (1-based):

```
assign = name "=" expr           → (= 1 3)
         ↑    ↑   ↑
         1    2   3
```

| Syntax | Meaning |
|--------|---------|
| `N` | Element N |
| `...N` | Spread list elements |
| `key:N` | Element N with schema key |
| `_` | Explicit nil |
| `(tag ...)` | Build S-expression with tag head |
| `→ N` | Pass through element N (no wrapping) |

**Examples**:

```
fun = FUN name params block      → (fun 2 params:3 body:4)
body = stmt                      → (1)
     | body NEWLINE stmt         → (...1 3)
block = INDENT body OUTDENT      → (block ...2)
atom = "(" expr ")"              → 2
```

Trailing nils are automatically stripped.

### Directives

| Directive | Purpose |
|-----------|---------|
| `@lang = "rip"` | Import language module (`rip.zig`) |
| `@conflicts = 0` | Expected parser conflict count |
| `@as = [ident, keyword]` | Promote identifiers to keywords when parser state expects them |
| `@code location { ... }` | Inject raw Zig at `imports`, `sexp`, `parser`, or `bottom` |

### Operator Precedence

`@infix` auto-generates a binary operator precedence chain:

```
@infix unary
    "||"  left
    "&&"  left
    "=="  none, "!=" none, "<" none
    "+"   left, "-"  left
    "*"   left, "/"  left
    "**"  right
```

- First line names the base expression (`unary`)
- Each subsequent line is one precedence level (first = lowest)
- Operators on the same line (comma-separated) share precedence
- Associativity: `left`, `right`, or `none`
- Generates a nonterminal called `infix`, referenced in rules as `@infix`

### Parser Hints

| Hint | Purpose |
|------|---------|
| `<` | Prefer reduce on shift/reduce conflict (tight binding) |
| `X "c"` | Exclude alternative when next character matches |

### Context-Sensitive Keywords

`@as = [ident, keyword]` enables the `@lang` module's `keyword_as()` function. Identifiers like `fun`, `if`, `return` are promoted to their keyword terminals only when the current parser state has a valid action for that keyword. This means the same word can be a keyword in one context and an identifier in another.
