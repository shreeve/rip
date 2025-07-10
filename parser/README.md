# rip-parser

*A modern, self-contained LALR(1) parser generator written in CoffeeScript.*

`rip-parser` is the parsing engine that powers the emerging **rip** language ecosystem.
Inspired by classic tools like **Yacc/Bison** but pared down to the minimal set of moving parts, it turns a declarative grammar description into a ready-to-run JavaScript parser—no external code-generation step required.

---

## Why another parser generator?

1. **Succinctness first** – the entire generator fits in a single CoffeeScript file (~1 k lines) and emits a single JS module you can `require()` immediately.
2. **Modern runtime** – the generated parser is CommonJS compatible, uses plain JavaScript data structures, and has no runtime dependencies besides an external lexer you supply.
3. **Full LALR(1) power** – comparable look-ahead power to Bison, including precedence/associativity handling and conflict detection.
4. **Great ergonomics** – grammars are written as ordinary CoffeeScript/JS objects; semantic actions are just functions.

---

## How it works

**rip-parser** turns grammar definitions into working parsers through a simple pipeline:

```
grammar.coffee  →  rip-parser  →  parser.js  →  run your programs
(your language     (generator)    (generated     (parse & execute)
 definition)                       parser)
```

### The three stages:

1. **Define your language** – Write a grammar file that describes your language's syntax and behavior
2. **Generate a parser** – Feed your grammar to rip-parser, which outputs JavaScript parser code
3. **Parse programs** – Use the generated parser to read and execute programs written in your language

### In practice:

```coffee
# 1. Load your grammar definition
grammar = require './my-language-grammar'

# 2. Generate parser code
{Generator} = require './rip-parser'
parserCode = new Generator().generate(grammar)
fs.writeFileSync('my-language-parser.js', parserCode)

# 3. Use the parser to run programs
parser = require './my-language-parser'
ast = parser.parse(programSource)
```

Since **generation** happens at runtime, you can create parsers on-the-fly or build grammars programmatically. The generated parser is a standalone JavaScript module with no dependencies except a lexer (tokenizer) that you provide.

---

## Anatomy of the generator (high level)

`rip-parser.coffee` is organised around a handful of small, single-purpose classes:

| Class      | Role |
|------------|------|
| `Symbol`   | Metadata for every terminal & non-terminal (id, nullable, FIRST/FOLLOW sets) |
| `Rule`     | One production *A → β* (+ optional semantic action & precedence tag). |
| `Item`     | LR(1) item  *A → β · γ , LA*  used during state construction. |
| `State`    | A set of LR items plus transitions to other states. |
| `Generator`| The orchestrator – performs grammar analysis, builds the LALR automaton, resolves conflicts and finally generates JS code. |

### Pipeline inside `Generator`

1. **Grammar ingestion**: converts your spec into `Symbol`/`Rule` objects, maps tokens, infers the start symbol and inserts the augmented `$accept → start $end` rule.
2. **Sanity passes**: eliminates unreachable and unproductive symbols so the final table is minimal.
3. **Nullable / FIRST / FOLLOW**: classic fixed-point algorithms compute these sets for every non-terminal.
4. **State building**: constructs the canonical LR(0) machine, merging equivalent cores to produce LALR states.
5. **Look-ahead computation**: calculates spontaneous look-aheads and propagation links, then iteratively propagates them until convergence.
6. **Conflict handling**: detects shift/reduce or reduce/reduce conflicts.
   − If you provide `operators` precedence info, many conflicts are auto-resolved; unresolved states are flagged as "inadequate".
7. **Table & code generation**: compiles actions (`shift`, `reduce`, `accept`) into a compact table, serialises symbols and rules, then embeds everything – plus your semantic actions – into a CommonJS module.

The end product is a **complete parser module** with `parse()`, `Parser` class, and optional CLI support.

---

## Grammar format

```coffee
grammar =

  Expression: [
    o 'Expression "+" Term', -> $1 + $3
    o 'Expression "*" Term', -> $1 * $3, {prec: "*"}
    o 'Term'               , -> $1
  ]

  Term: [
    o 'NUMBER'             , -> Number $1
    o '"(" Expression ")"' , -> $2
  ]

operators = [
  [ 'left', '+', '-' ]
  [ 'left', '*', '/' ]
]

gen = new Generator()
parserCode = gen.generate {
  grammar,
  operators,
  tokens: 'NUMBER + - * / ( )'
  start:  'Expression',
}
```

### Notes

- Each production is an array: `[pattern, action, options]`
- `pattern` is a space-separated RHS; use `''` or omit for ε (empty).
- `action` can be a function or arrow function. Positional values `$1 … $n`, `$$` (result), `@$` (result location) and location variables `@1 … @n` are supported.
- `options.prec` lets you tag a production with an explicit precedence symbol for conflict resolution.
- In the generated parser, `$$` is shorthand for `this.$` (the semantic value being constructed).

---

## Conflict resolution & defaults

When both a shift and a reduce are possible on the same look-ahead, `rip-parser` applies:
1. **Higher precedence wins** (from `operators` array - later entries have higher precedence).
2. **Equal precedence** ⇒ associativity decides (`left` ⇒ reduce, `right` ⇒ shift, `nonassoc` ⇒ error).
3. **No precedence info** ⇒ defaults to shift (and warns about the conflict).

States that still harbour ambiguities are marked as *inadequate*; you'll see warnings during generation.

---

## Lexer interface

The generated parser expects a lexer object with:
```javascript
{
  lex()        // returns next token (string) or '' for EOF
  setInput()   // initialize with source string
  yytext       // current token text
  yylloc       // location info {first_line, last_line, first_column, last_column}
  yylineno     // current line number
  yyleng       // current token length
}
```

---

## Debugging helpers

The generator provides several methods you can call after grammar processing:

```coffee
gen = new Generator()
gen.processGrammar(spec)  # Parse the grammar first

gen.printStatistics()     # Basic counts
gen.debugTable()          # Every state & item
gen.reportConflicts()     # Detailed conflict list
gen.validateGrammar()     # Check for undefined symbols
```

These print to the console and make it easier to understand grammar behavior.

---

## Advanced features

### Default reductions
The generator automatically detects states where all actions are the same reduction and optimizes them with default actions, reducing table size.

### Symbol elimination
Before table generation, the parser automatically:
- Removes unreachable non-terminals (not derivable from start symbol)
- Removes unproductive non-terminals (can't derive terminal strings)
- Warns about these removals to help debug grammar issues

### Action code transformations
Semantic actions support several convenience notations:
- `$1, $2, ...` → stack values
- `$$` → result value (`this.$`)
- `@1, @2, ...` → location info for positions
- `@$` → result location

---

## Generated parser API

```javascript
const parser = require('./generated-parser');

// Basic usage
result = parser.parse(inputString);

// With custom lexer
parser.lexer = myLexer;
result = parser.parse(inputString);

// Access parser class
const p = new parser.Parser();
p.yy = { /* shared state */ };
result = p.parse(inputString);
```

---

## Roadmap / known limitations

`rip-parser` is functional but still evolving. Current limitations and planned improvements:

- **Error recovery**: The `error` token is defined but error recovery rules aren't fully implemented.
- **Reduce/reduce conflicts**: Currently resolved by earliest rule order; could be improved.
- **Better conflict diagnostics**: Commented code shows planned example-based explanations.
- **GLR mode**: For handling truly ambiguous grammars.
- **Tree-sitter output**: Alternative backend for incremental parsing.

---

## License

MIT © 2025 Steve Shreeve and Claude 4 Opus