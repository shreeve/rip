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

## Quick glance

```coffee
Generator = require('./rip-parser').Generator
parser    = new Generator().generate grammarSpec
result    = parser.parse(source, lexer)
```

* `grammarSpec` – a plain object defining non-terminals, productions and operator precedence.
* `lexer` (optional) – any object exposing a `lex()` method; tokens are simple strings.

The `generate` step happens at **runtime**, so you can build grammars programmatically or even on the fly.

---

## Anatomy of the generator (high level)

`rip-parser.coffee` is organised around a handful of small, single-purpose classes:

| Class      | Role |
|------------|------|
| `Symbol`   | Metadata for every terminal & non-terminal (id, FIRST/FOLLOW sets, etc.) |
| `Rule`     | One production *A → β* (+ optional semantic action & precedence tag). |
| `Item`     | LR(1) item  *A → β · γ , LA*  used during state construction. |
| `State`    | A set of LR(0) core items plus transitions to other states. |
| `Generator`| The orchestrator – performs grammar analysis, builds the LALR automaton, resolves conflicts and finally spits out JS code. |

### Pipeline inside `Generator`

1. **Grammar ingestion**: converts your spec into `Symbol`/`Rule` objects, maps tokens, infers the start symbol and inserts the augmented `$accept` rule.
2. **Sanity passes**: strips unreachable or unproductive symbols so the final table is minimal.
3. **Nullable / FIRST / FOLLOW**: classic fixed-point algorithms compute these sets for every non-terminal.
4. **State building**: constructs the canonical LR(0) machine, merging equivalent cores to produce LALR states.
5. **Look-ahead propagation**: calculates spontaneous look-aheads and iteratively propagates them until convergence.
6. **Conflict handling**: detects shift/reduce or reduce/reduce conflicts.
   − If you provide `operators` precedence info, many conflicts are auto-resolved; unresolved states are flagged as “inadequate”.
7. **Table & code generation**: compiles actions (`shift`, `reduce`, `accept`) into a compact integer table, serialises symbols and rules, then embeds everything – plus your semantic actions – into a CommonJS module.

The end product is a **single function `parse()`** that expects a lexer and returns your AST (or whatever your actions build).

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

gen    = new Generator()
parser = gen.generate {
  grammar,
  operators,
  tokens: 'NUMBER + - * / ( )'
  start:  'Expression',
}
```

### Notes

- Each production entry can be created with the helper `o pattern, action, opts`. `pattern` is a space-separated RHS; omit or use `''` for ε (empty).
- `action` can be a CoffeeScript/JS function **or** an arrow-body string. Positional values `$1 … $n`, `$$` (result) and location variables `@1 … @n` are supported.
- `opts.prec` lets you tag a production with an explicit precedence symbol for operator resolution.

---

## Conflict resolution & defaults

When both a shift and a reduce are possible on the same look-ahead, `rip-parser` applies:
1. **Higher precedence wins** (from `operators`).
2. **Equal precedence** ⇒ associativity decides (`left` ⇒ reduce, `right` ⇒ shift, `nonassoc` ⇒ error).

States that still harbour ambiguities are marked as *inadequate*; their cores are listed when you enable the debug helpers below.

---

## Debugging helpers

The generator ships with several methods you can call before code-gen:

```coffee
gen.printStatistics()   # basic counts
gen.debugTable()        # every state & item
gen.reportConflicts()   # detailed conflict list
```

These print to the console and make it easier to reason about why a given grammar misbehaves.

---

## Roadmap / missing pieces

`rip-parser` is functional but still early-stage. Planned improvements include:

- **On-demand look-ahead** to further slim down tables.
- **Better error-recovery & messages** in generated parsers.
- **Improved conflict diagnostics** with example inputs and suggestions.
- **ESM output** alongside CommonJS.
- **Source-map support** for semantic action errors.

---

## License

MIT © 2025 The rip team & contributors