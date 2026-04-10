# Grammar System Lessons

## Purpose

This document captures the most important lessons for `Zag` from studying three existing systems:

- `rip-lang` — especially `src/grammar/grammar.rip` and `src/lexer.js`
- `slash` — especially `slash.grammar` and `src/grammar.zig`
- `em` / MUMPS — especially `mumps.grammar`, `docs/language/GRAMMAR.md`, and `docs/language/LEXER.md`

The goal is not to document those projects for their own sake. The goal is to identify what `Zag` should borrow, what it should avoid, and what architectural patterns are now proven enough to trust.

## The Big Conclusion

The most important conclusion is this:

`Zag` should use a grammar file as the single source of truth for:

- lexer state
- token types
- lexical matching rules
- parser rules
- direct S-expression actions

and it should pair that with a `Zag`-specific rewriter that preserves the language's beautiful implicit syntax.

This gives `Zag` the best qualities of all three systems:

- `rip-lang`'s beautiful token rewriting and implicit syntax
- `slash`'s unified lexer/parser generation from one grammar file
- `mumps`'s powerful action language and grammar-driven lexer expressiveness

## Lesson 1: One Grammar File Is A Real Superpower

Both `slash` and `mumps` show that one grammar file can define:

- token categories
- state variables
- lexical matching rules
- parser rules
- S-expression output
- promotion and operator remapping directives
- parser conflict expectations
- multiple entry points

That is not just elegant. It is strategically important.

It means `Zag` can keep its language definition concentrated and visible rather than splitting it across:

- ad hoc lexer code
- parser code
- AST definitions
- semantic mapping tables

## Lesson 2: The Parser Should Emit Raw S-expressions Directly

This is one of the strongest ideas shared across the existing systems.

The grammar should produce structural forms directly rather than going through a large generated AST layer first.

Benefits:

- simpler pipeline
- easier testing
- easier debugging
- easier normalization
- easier downstream compilation

For `Zag`, this supports:

- raw sexps first
- normalized sexps second
- only later introducing a stronger typed/core IR if needed

## Lesson 3: The Rewriter Is Not A Hack; It Is A First-Class Layer

`rip-lang` proves that a language can get much of its beauty from a deliberate token rewrite phase.

The rewriter is doing things that are hard to express cleanly in the grammar alone:

- implicit calls
- implicit grouping
- line normalization
- postfix conditional tagging
- lightweight syntax sugar cleanup
- optional type-token shaping

The lesson for `Zag` is:

- do not try to push all beauty into the grammar
- do not try to eliminate the rewriter
- instead, make the rewriter small, principled, and well-supported by lexer metadata

## Lesson 4: The Lexer Can Be Grammar-Driven And Still Be Fast

`slash` and `mumps` prove that the grammar file can drive lexer generation without sacrificing performance.

Important supporting ideas:

- state variables are declared in the grammar
- token types are declared in the grammar
- single-character and multi-character operator dispatch is generated
- scanner loops for strings, numbers, and identifiers are generated
- character-class based dispatch is generated
- whitespace-sensitive behavior is generated

This means `Zag` does not need to choose between:

- grammar-driven design
- performance

It can have both.

## Lesson 5: Character-Class Dispatch Is Worth Keeping

The generated lexer path in `slash` and `mumps` uses character classification tables and inline helpers like:

- `isDigit`
- `isLetter`
- `isWhitespace`

This is important for `Zag`.

It means the grammar system is not merely matching regex-like patterns at runtime. It can generate the same kind of fast character dispatch a human would hand-write.

This should definitely be preserved in `Zag`'s local `src/grammar.zig`.

## Lesson 6: `pre` Is A Foundational Abstraction

Across the existing systems, `pre` is more than a convenience.

It enables:

- whitespace-sensitive tokens
- indentation
- spacing-aware disambiguation
- structural inference
- token-level context without separate whitespace tokens

For `Zag`, `pre` should remain foundational.

It should be paired with a token metadata contract that likely includes:

- `.pre`
- `.spaced`
- `.lineStart`
- `.lineEnd`
- `.loc`
- `.data`

## Lesson 7: Some Syntax Should Be Solved By Token Specialization

A great example from `slash` is the idea of spacing-sensitive token specialization such as `LPAREN_TIGHT`.

That pattern is very useful:

- some ambiguities are much easier to resolve in the lexer
- not everything should be deferred to parser conflicts or rewrite heuristics

For `Zag`, this means:

- when spacing creates a sharp local distinction, specialized tokens may be the right tool
- but generalized implicit structure should still stay in the rewriter

## Lesson 8: `_`, `...N`, `key:N`, and `~N` Are Excellent Action Features

The `mumps` grammar DSL has several action features that are especially valuable for `Zag`.

### `_`

Use `_` to intentionally preserve positional sexp shape when an earlier field is absent.

This is useful when the compiler wants one stable shape even if surface syntax is shorter.

### `...N`

Use `...N` to spread list children directly into a parent.

This keeps grammar rules concise and reduces nested wrapper noise.

### `key:N`

Use `key:N` as inline schema documentation.

This helps humans and tooling understand the shape of emitted sexps without changing runtime structure.

### `~N`

Use `~N` to preserve token/symbol identity efficiently.

This is especially attractive for operators and promoted tokens because later passes can dispatch on symbol ID instead of string comparisons.

## Lesson 9: `@as`, `@op`, and `@code` Are The Right Extension Hooks

These three directives form a very powerful trio.

### `@as`

Contextual promotion of tokens, especially identifiers.

Useful for:

- contextual keywords
- builtin namespaces
- promoted names

### `@op`

Operator remapping into stable internal names or identities.

Useful for:

- keeping grammar readable
- preserving operator identity for later dispatch

### `@code`

Disciplined escape hatch for lexical or contextual behavior that does not fit the declarative surface cleanly.

Useful for:

- hard local disambiguation
- rare special cases
- narrowly-scoped language-specific helpers

For `Zag`, all three are likely worth preserving.

## Lesson 10: Whitespace Sensitivity Can Be Defined In The Grammar

`mumps.grammar` is especially powerful here.

It shows that the grammar-driven lexer can treat whitespace as a first-class concern:

- line start
- mid-line spacing significance
- zero-width structural tokens
- counted prefixes

This matters for `Zag` because it means indentation-sensitive syntax does not require abandoning the grammar-driven lexer model.

## Lesson 11: Multiple Start Symbols Are Valuable

Both for parser development and later tooling, multiple start symbols are a big win.

For `Zag`, likely useful entry points include:

- full module/file
- expression
- statement
- maybe declaration

This helps:

- tests
- REPLs
- partial parsing
- grammar debugging

## Lesson 12: Audited LR Conflicts Are A Good Trade

Both your design instinct and the existing systems point toward the same conclusion:

- some grammar conflicts are acceptable
- they should be tracked explicitly
- they should be understood
- they should not silently grow without review

This is a much better approach than over-twisting the language to satisfy parser purity.

## Lesson 13: The Grammar Should Stay Narrow Even If The Engine Is Powerful

A major risk is letting the proven power of the engine tempt `Zag` into too much early scope.

The existing systems prove the engine can do a lot.
That does not mean the first `Zag` grammar should do a lot.

The bootstrap subset should remain small:

- `use`
- `fun`
- `sub`
- `=`
- `=!`
- calls
- call-site `!`
- `?` identifiers
- `if`
- `return`
- arithmetic/comparison
- optional source types

Everything else should wait until the bootstrap path works.

## Lesson 14: The Right Architecture For Zag

The strongest architecture now looks like this:

1. `zag.grammar`
   - source of truth for lexer + parser
2. generated `BaseLexer`
   - tokenization, state, whitespace-sensitive behavior, character-class dispatch
3. `Zag` rewriter
   - implicit calls
   - implicit grouping where obvious
   - line normalization
   - small syntax-sugar rewrites
4. parser
   - emits raw S-expressions
5. normalization
   - canonical structural forms
6. type resolution
   - source types optional, emitted Zig types required
7. Zig emission

This is the synthesis of the best ideas from all three systems.

## What Zag Should Borrow Directly

- one-file grammar definition
- grammar-driven lexer state
- explicit token declarations
- direct sexp actions
- `_`
- `...N`
- `key:N`
- maybe `~N`
- `@as`
- `@op`
- `@code`
- multiple start symbols
- audited LR conflict discipline
- generated fast character-class lexer support

## What Zag Should Borrow Carefully

- implicit syntax machinery
- line normalization
- token retagging based on context
- spacing-sensitive token specialization
- optional type-token shaping

These are powerful, but they belong in a carefully designed rewriter rather than as uncontrolled cleverness.

## What Zag Should Not Copy Directly

- JS-specific syntax from `rip-lang`
- shell-specific constructs from `slash`
- MUMPS-specific command and pattern-mode semantics
- reactive/UI syntax from `rip-lang`
- engine complexity that is not needed for the bootstrap subset

## Final Takeaway

The combined lesson from `rip-lang`, `slash`, and `mumps` is not just that `Zag` can have a good grammar system.

It is that `Zag` can plausibly have:

- a single grammar source of truth
- a generated, fast, whitespace-sensitive lexer
- a generated parser
- a powerful but principled rewriter
- direct raw sexp output
- optional source types with required final type resolution

That is a very strong foundation.
