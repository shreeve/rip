# grammar.zig — Design Notes

`src/grammar.zig` is a language-agnostic parser generator that reads a `.grammar`
file with `@lexer` and `@parser` sections and generates a combined `parser.zig`
(lexer + SLR(1) parser). It is designed to be shared across projects (rip, em,
slash, and beyond).

---

## Resolved Issues

The following language-specific vestiges have been fixed:

- **`self.beg = 0`** — was emitted unconditionally into every generated lexer;
  now guarded behind a check for whether the grammar declares a `beg` state.
- **`"pat"` hardcoded name** — the generator checked for a state named `"pat"` to
  suppress number scanning in "pattern mode." Removed; pattern mode is a language
  concern handled by `@lang` wrappers.
- **`"flag"` dead skip** — a vestige from the slash project's flag scanner.
  Removed.
- **Hardcoded `"` exclusion** — double-quote was unconditionally excluded from the
  operator switch regardless of whether the grammar used it for strings. Now
  string-start characters are derived entirely from grammar rules.
- **Stale comments** — removed references to MUMPS dot-level counting, rip-specific
  examples, and `rip.grammar` in help text.
- **Postfix-if for flow control** — added `POST_IF` token and grammar rules so
  `return if cond`, `return value if cond`, `break if cond`, and `continue if cond`
  all parse correctly. The rewriter classifies `if` as `post_if` after flow keywords
  (`return`, `break`, `continue`), with the flag persisting for the line and
  suppressed inside parentheses, brackets, and braces. Uses the existing `return`,
  `break`, and `continue` tags with optional nil-slotted `if:` and `to:` fields
  rather than separate tags for each variant.
- **Address-of operator** — added `&` as a prefix unary operator (`addr_of` tag),
  enabling `&variable` syntax for pointer-taking.

---

## Grammar DSL Features

The grammar DSL has features beyond what Rip currently uses. These are documented
here for reference and future use.

### Action syntax

| Syntax | Meaning | Example |
|--------|---------|---------|
| `N` | Element N by position | `1`, `2`, `3` |
| `key:N` | Element N with explicit schema key | `value:2`, `if:4` |
| `key:_` | Explicit nil with schema key | `to:_`, `if:_` |
| `_` | Nil (absent value) | `(fun 2 _ _ 3)` |
| `~N` | Unwrap symbol ID into `src.id` | `~2` for O(1) dispatch |
| `0` | Rule name as tag | `(0 1 2)` |
| `...N` | Spread list elements | `(module ...1)` |
| `!elem` | Skip (left side) — parse but no position | `!INDENT body` |
| `(tag ...)` | Nested S-expression in action | `(foo (bar 1) 2)` |

**Trailing nil stripping:** Absent optional elements at the end of a list are
automatically removed. `(ref 1 2 3)` with only element 1 present produces
`(ref 1)`, not `(ref 1 nil nil)`. Interior nils are preserved.

### `~N` — Symbol unwrap

Stores the resolved identity (enum value) of element N in `src.id`, enabling
O(1) integer-switch dispatch on operators and keywords without string comparison:

```
binop = expr operator expr → (binop ~2 1 3)
```

The compiler dispatches: `switch (items[1].src.id) { ... }` — integer comparison,
not `std.mem.eql`.

### `<` — Tight binding (prefer reduce)

Parser hint on the left side of `→`. Forces reduce over shift in S/R conflicts.
Makes a construct "atomic" — it binds tightly to what came before:

```
atom = "@" < atom → (@name 2)    # @X+1 parses as (@X)+1, not @(X+1)
atom = "(" expr ")" < → 2        # parens are atomic
```

### `X "c"` — Character exclusion

Peek at the next raw character. If it matches, this alternative fails:

```
nameind = "@" atom X "@" → (@ name 2)   # not followed by @
subsind = "@" atom "@" subs → (@ subs 2 4)  # followed by @
```

The implementation stores the reduce action in the table and checks at runtime
via `getImmediateShift()` when `pre == 0`.

### `@` in tag names

Tag names can contain `@` and other special characters. In the Tag enum, these
become `@"@name"`, `@"@ref"`, etc. EM uses this for indirection nodes:

```
setarg = "@" atom → (@args 2)    # produces (Tag.@"@args", atom)
```

### Parser directives

| Directive | Purpose |
|-----------|---------|
| `@lang = "name"` | Import language module for keyword/tag support |
| `@as = [token, rule]` | Context-sensitive keyword promotion |
| `@op = [...]` | Operator literal-to-token mappings |
| `@infix base` | Auto-generate precedence chain |
| `@errors` | Human-readable rule names for diagnostics |
| `@conflicts = N` | Declare expected conflict count |
| `@code location` | Inject raw Zig into generated output |

### `@code` directive

Injects Zig code at specific locations in the generated output. Locations include
`imports` (top of file) and `sexp` (inside the Sexp type). This allows language
modules to extend the generated code without modifying `grammar.zig`.

---

## Lexer Architecture

The generated lexer uses a three-tier dispatch strategy, from fastest to slowest:

| Tier | Strategy | Driven by |
|------|----------|-----------|
| 1. Single-char switch | O(1) per character | Single-char literal patterns |
| 2. Multi-char prefix dispatch | Peek-ahead | Multi-char literal patterns |
| 3. Scanner functions | Inline loops | Complex patterns (ident, number, string) |

All behavior is derived from the grammar's `@lexer` section:

- **Character classification** (`char_flags[256]`) — derived from ident/number patterns
- **Operator switch arms** — generated from single/multi-char literal rules
- **Newline handling** — compiled from `\n`/`\r\n` rules with guards and actions
- **Comment scanning** — generated with optional SIMD acceleration via `simd_to`
- **String/number/ident scanners** — generated from pattern shapes

The generator recognizes common pattern shapes and emits optimized code:

| Pattern Shape | Generated Code |
|---------------|----------------|
| `'X' (body)* 'X'` | Delimited scanner with escape handling |
| `[class]+` | `while (isClass(c)) pos += 1` |
| `[class1][class2]*` | First char check + continuation loop |
| Guarded variant | Conditional dispatch based on state |

---

## Well-Known Token Names

The generator recognizes certain token names and provides optimized scanner
generation for them. This is a convention, not a requirement — grammars that
don't use these names simply won't get the corresponding built-in scanners.

| Token Name               | What Happens                                               |
|--------------------------|------------------------------------------------------------|
| `"ident"`                | Generates `scanIdent()`, drives all `@as` directive routing |
| `"integer"`, `"real"`    | Generates `scanNumber()`, prefix pattern detection          |
| `"string"`, `"string_*"` | Generates inline string scanning per delimiter             |
| `"comment"`              | Generates comment scanning, skipped in operator switch      |
| `"skip"`                 | Skipped in prefix scanner                                   |
| `"err"`, `"eof"`         | Hardcoded in fallback Token returns                         |

These are gated universal capabilities. The built-in scanners are substantial —
`scanNumber()` alone handles decimals, exponents, and hex/binary prefix patterns
across ~120 lines of generated code.

---

## Known Constraints

Documented design boundaries that are reasonable tradeoffs, not bugs.

### String escape semantics

String scanning currently assumes:
- Single-quote delimiters use `''` doubled-quote escaping
- Double-quote delimiters use `\` backslash escaping
- Both stop on newline (no multiline strings)

This covers rip, em, and slash. If a future language needs different escape
semantics, the recommended path is explicit annotations:

```
@string(open="'", escape=double, multiline=false)
@string(open='"', escape=backslash, multiline=true)
```

### Parser algorithm

The generated parser is SLR(1). This is weaker than LALR(1) or LR(1) but
sufficient for a wide range of practical grammars. Languages with significant
context-sensitivity may need `@lang` wrapper support.

### Token struct

```zig
pub const Token = struct {
    pos: u32,    // max ~4 GiB source
    len: u16,    // max 65535-byte token
    cat: TokenCat,
    pre: u8,     // max 255 whitespace chars
};
```

The 8-byte packed token is an intentional performance tradeoff.

### Production RHS limit

`MAX_ARGS = 32` limits the maximum number of symbols on the right-hand side of
a single production. This could be derived from the actual grammar maximum
instead of hardcoded.

### Value representation

The generated parser uses S-expressions (Sexp) as its AST representation. This
is the only supported value type. A future enhancement could make this pluggable.

### Lexer state variables

Grammar-declared state variables are always `i32`. This covers counters,
booleans, and flags. Richer state (mode stacks, delimiter stacks) requires
`@lang` wrapper support.

### Compiler typing limitations

Array literal emission defaults to `[_]i64{ ... }` and the `**` power operator
defaults to `std.math.pow(i64, ...)`. Both require a full type resolution pass
to handle non-integer types correctly. These are inherent to the current
bootstrap compiler and will be addressed when the type resolution phase (roadmap
Phase 2) is implemented.
