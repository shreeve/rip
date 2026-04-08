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
  examples (`FUN↔fun`, `"cmd"`), and `rip.grammar` in help text.
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

These are gated universal capabilities. Virtually every programming language needs
number scanning, string scanning, identifier scanning, and comment handling. The
built-in scanners are substantial — `scanNumber()` alone handles decimals,
exponents, and hex/binary prefix patterns across ~120 lines of generated code.

---

## Known Constraints

Documented design boundaries that are reasonable tradeoffs, not bugs.

### String escape semantics

String scanning currently assumes:
- Single-quote delimiters use `''` doubled-quote escaping
- Double-quote delimiters use `\` backslash escaping
- Both stop on newline (no multiline strings)

This covers rip, em, and slash. If a future language needs different escape
semantics (e.g., Python's backslash escaping for both quote types, or shell's
raw single-quote strings), the recommended path is to add explicit annotations:

```
@string(open="'", escape=double, multiline=false)
@string(open='"', escape=backslash, multiline=true)
```

This would make string behavior fully declarative while generating equally
performant code. The annotation is read at generator time, not runtime.

### Parser algorithm

The generated parser is SLR(1). This is weaker than LALR(1) or LR(1) but
sufficient for a wide range of practical grammars. Languages with significant
context-sensitivity (JavaScript regex-vs-division, Python indentation) may need
`@lang` wrapper support.

### Token struct

```zig
pub const Token = struct {
    pos: u32,    // max ~4 GiB source
    len: u16,    // max 65535-byte token
    cat: TokenCat,
    pre: u8,     // max 255 whitespace chars
};
```

The 8-byte packed token is an intentional performance tradeoff. The limits are
generous for typical source files.

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
