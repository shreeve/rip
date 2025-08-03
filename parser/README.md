<img src="/assets/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Parser - SLR(1) Parser Generator

**Clean, Efficient Parser Generation in CoffeeScript**

A modern SLR(1) parser generator that creates fast, reliable parsers from grammar definitions. Written in clean CoffeeScript for readability and maintainability, Solar generates compact JavaScript parsers suitable for everything from simple DSLs to complex programming languages.

## Overview

Solar is a clean SLR(1) parser generator implementation, influenced by Jison but rewritten in CoffeeScript for clarity and efficiency. It generates compact, dependency-free JavaScript parsers from grammar definitions.

**Mathematical Foundation**: SLR(1) ⊆ LALR(1) ⊆ LR(1) ⊆ Context-Free Languages
**Grammar Class**: Deterministic context-free grammars with 1-token lookahead

### Key Features

- **Clean Implementation**: Written in readable CoffeeScript
- **Efficient Parsers**: Generates compact JavaScript with no dependencies
- **SLR(1) Algorithm**: Simple LR with single lookahead
- **Comprehensive Analysis**: First/follow sets, nullable detection
- **Conflict Resolution**: Precedence and associativity support
- **Production Ready**: Generates standalone parsers

## 🚀 Getting Started

### Prerequisites
- **CoffeeScript** or **Bun** with Rip transpilation
- **Node.js** (v18+) for running generated parsers

### Quick Start

```bash
# Run the parser generator
coffee parser/rip-parser.rip grammar.coffee -o parser.js

# Or with Bun + Rip
bun parser/rip-parser.rip grammar.coffee -o parser.js
```

### Example: Calculator Grammar

```coffee
# calculator.coffee
grammar =
  rules: [
    ["expression", ["expression", "+", "term"], -> $1 + $3]
    ["expression", ["expression", "-", "term"], -> $1 - $3]
    ["expression", ["term"], -> $1]
    ["term", ["term", "*", "factor"], -> $1 * $3]
    ["term", ["term", "/", "factor"], -> $1 / $3]
    ["term", ["factor"], -> $1]
    ["factor", ["NUMBER"], -> Number($1)]
    ["factor", ["(", "expression", ")"], -> $2]
  ]

  operators: [
    ["left", "+", "-"]
    ["left", "*", "/"]
  ]

module.exports = grammar
```

## How It Works

Solar implements the SLR(1) parsing algorithm through several phases:

1. **Grammar Analysis**: Computes first/follow sets and nullable symbols
2. **State Construction**: Builds the LR(0) automaton with SLR(1) lookaheads
3. **Table Generation**: Creates compact parsing tables
4. **Code Generation**: Outputs optimized JavaScript parser

## Grammar Format

Grammars are defined as JavaScript/CoffeeScript objects with:

- **rules**: Array of production rules `[lhs, rhs, action]`
- **operators**: Precedence and associativity declarations
- **start**: Optional start symbol (defaults to first rule's LHS)

### Rule Format
```coffee
[
  "nonterminal",           # Left-hand side
  ["symbol1", "symbol2"],  # Right-hand side (array)
  -> $1 + $2               # Semantic action (optional)
]
```

### Operator Precedence
```coffee
operators: [
  ["left", "+", "-"],      # Lowest precedence
  ["left", "*", "/"],      # Higher precedence
  ["right", "^"]           # Highest precedence
]
```

## Generated Parser Format

Solar generates ultra-compact parsers with just 4 data structures:

```javascript
{
  symbols: ["$", "expression", "term", ...],     // Symbol names
  terminals: [true, false, false, ...],          // Terminal flags
  rules: [[1, 3], [1, 3], [1, 1], ...],         // [LHS, RHS length]
  states: {                                      // Parse tables
    0: { 3: "s5", 4: "s6", 1: 1, 2: 2 },       // State transitions
    1: { 5: "s7", 0: "acc" },                   // Accept state
    // ...
  },
  actions: [                                     // Semantic actions
    function() { this.$ = this.$1 + this.$3; },
    function() { this.$ = this.$1; },
    // ...
  ]
}
```

## Command Line Usage

```bash
# Basic usage
coffee parser/rip-parser.rip grammar.coffee -o parser.js

# With options
coffee parser/rip-parser.rip grammar.coffee \
  --output parser.js \
  --module-type commonjs \
  --no-default-action
```

### Options

| Option | Description |
|--------|-------------|
| `-o, --output` | Output file path |
| `--module-type` | Module format: `commonjs` or `es6` |
| `--no-default-action` | Disable default semantic actions |
| `--validate` | Validate grammar without generating |

## Architecture

Solar is organized into clean, focused classes:

- **Terminal/Nonterminal**: Symbol representations
- **Production**: Grammar rules with actions
- **Item**: LR items for state construction
- **LRState**: Parser states with transitions
- **Grammar**: Complete grammar representation
- **Generator**: Main parser generator logic

## Advanced Features

### Conflict Resolution

Solar handles shift/reduce and reduce/reduce conflicts through:
- Operator precedence declarations
- Associativity rules (left, right, nonassoc)
- Default shift preference for S/R conflicts

### Error Recovery

Generated parsers include basic error recovery:
- Synchronization on error tokens
- State stack unwinding
- Customizable error messages

### Optimization

The generator performs several optimizations:
- State minimization
- Table compression
- Dead code elimination
- Efficient action dispatch

## Examples

### JSON Parser
```coffee
grammar =
  rules: [
    ["value", ["object"], -> $1]
    ["value", ["array"], -> $1]
    ["value", ["STRING"], -> JSON.parse($1)]
    ["value", ["NUMBER"], -> Number($1)]
    ["value", ["true"], -> true]
    ["value", ["false"], -> false]
    ["value", ["null"], -> null]
    # ... more rules
  ]
```

### Expression Evaluator
```coffee
grammar =
  rules: [
    ["expr", ["expr", "**", "expr"], -> Math.pow($1, $3)]
    ["expr", ["expr", "*", "expr"], -> $1 * $3]
    ["expr", ["expr", "/", "expr"], -> $1 / $3]
    ["expr", ["expr", "+", "expr"], -> $1 + $3]
    ["expr", ["expr", "-", "expr"], -> $1 - $3]
    ["expr", ["NUMBER"], -> Number($1)]
    ["expr", ["(", "expr", ")"], -> $2]
  ]

  operators: [
    ["left", "+", "-"]
    ["left", "*", "/"]
    ["right", "**"]
  ]
```

## Integration

### With Lexers

Solar parsers expect a lexer that provides:
```javascript
{
  lex: function() { /* return next token */ },
  setInput: function(input) { /* initialize */ },
  yytext: "", // Current token text
  yylloc: {}  // Location information (optional)
}
```

### In Applications

```javascript
const parser = require('./generated-parser');
const lexer = require('./my-lexer');

parser.lexer = lexer;
const ast = parser.parse('input string');
```

## License

MIT

## Contributing

Rip Parser is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community