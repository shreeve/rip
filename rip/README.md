<div align="center"><img src="logo.png" style="height:200px" /><br></div>

# Rip Language

A modern programming language that compiles to ES6+ with first-class multi-runtime support.

## Design Philosophy

Rip is designed from the ground up to be **runtime-agnostic** while being **Bun-first**:

- **Primary Target**: Bun (for best performance and developer experience)
- **Full Support**: Deno, Node.js, and modern browsers
- **Pure ES6/ESM Output**: Generated JavaScript works everywhere
- **No Runtime Lock-in**: Your compiled code isn't tied to any specific platform
- **Pure Data AST**: Uses data-driven AST nodes instead of executable semantic actions

## Architecture

```
/rip
├── src/           # Source files (all .rip)
│   ├── lexer.rip      # Tokenizer
│   ├── parser.rip     # Parser (using Solar)
│   ├── grammar.rip    # Grammar definition with o/x DSL
│   ├── nodes.rip      # AST node definitions
│   ├── compiler.rip   # Main compiler
│   ├── solar.rip      # Parser generator
│   └── index.rip      # Main exports
├── lib/           # Compiled JavaScript (ES6/ESM)
├── bin/           # CLI tools
│   └── rip.rip        # Command-line interface
└── test/          # Test suite
```

## The `o` vs `x` Parser DSL Design

### The Core Insight
When writing grammar rules for a parser generator, every production does one of two things:
1. **CREATES** new structure (AST nodes, arrays, objects)
2. **FORWARDS** existing values unchanged (pass-through)

We use two distinct functions to make this intent explicit:
- **`o()` - CREATE/BUILD** (like a bullet point that adds to a list)
- **`x()` - FORWARD/PASS** (like crossing through to what's beneath)

### The Pipe Syntax Innovation
To eliminate verbose boilerplate, we support two powerful features:
1. **Inline syntax** for single-production rules
2. **Pipe operator (`|`)** for alternatives within a pattern

This transforms verbose grammar definitions:
```coffeescript
# OLD: 14 lines of bureaucracy
Line: [
  x 'Expression'
]
Expression: [
  x 'Value'
]
Value: [
  x 'Assignable'
  x 'Literal'
  x 'Invocation'
]
```

Into concise, readable rules:
```coffeescript
# NEW: 3 lines of clarity
Line:       x 'Expression'
Expression: x 'Value'
Value:      x 'Assignable | Literal | Invocation'
```

### Helper Architecture
The helper functions (`o` and `x`) are defined in `parser.rip` and imported into grammar files:

```coffeescript
# parser.rip
export o = (pattern, node, precedence) -> # BUILD helper
export x = (pattern, value) ->             # PASS helper

# grammar.rip
import {o, x} from './parser.rip'

# Third parameter for precedence
o 'Expr + Expr', { left: '$1', op: '+', right: '$3' }, 'ADDITIVE'
```

### Custom Grammar Helpers
Grammar files can define domain-specific helpers that leverage the pipe syntax:

```coffeescript
# Custom helper that expands pipe syntax
binary = (ops) ->
  ops.split('|').map (op) ->
    o "Expression #{op.trim()} Expression", { left: '$1', op: op.trim(), right: '$3' }

# Incredibly concise grammar rules
BinaryOp: binary '+ | - | * | / | ** | %'  # Expands to 6 productions!
```

### Complete Grammar Example
```coffeescript
grammar =
  Program: [
    o '', { body: [] }                          # Create empty Program node
    o 'Body', { body: '$1' }                    # Create Program with body
  ]
  
  # Pass-through chains collapsed to one-liners
  Line:       x 'Expression'
  Expression: x 'Value | Operation'
  Value:      x 'Assignable | Literal | Invocation'
  
  # Simple node creation
  Identifier: o 'IDENTIFIER', { name: '$1' }    # Auto-adds type: 'Identifier'
  
  # Complex rules still use arrays
  SimpleAssignable: [
    x 'Identifier'
    o 'Value Accessor', { type: 'MemberExpression', object: '$1', property: '$2' }
  ]
  
  # Custom helpers for repetitive patterns
  BinaryOp: binary '+ | - | * | / | ** | %'
  UnaryOp:  unary '! | ~ | typeof | delete'
  
  # Bitwise OR uses BAR since | is reserved for DSL
  BitwiseOp: o 'Expression BAR Expression', { op: '|', left: '$1', right: '$3' }
```

### Key Features
- **Auto-typing**: Objects created with `o()` automatically get `type: LHS` if not specified
- **Default pass-through**: `x()` with no second parameter passes through `$1`
- **Explicit values**: `x()` can pass specific positions or literal values:
  ```coffeescript
  OptComma:    x ' | ,'           # Empty string or comma
  Wrapped:     x '( Expr )', '$2'  # Pass through position 2
  OptFlag:     x '', false         # Return literal false
  RequireFlag: x 'REQUIRED', true  # Return literal true
  ```
- **Array operations**: Special operators like `$concat` for building lists
- **Pure data nodes**: All semantic actions are data structures, not executable code

## How Parsing Works

Let's trace through how Rip parses a simple statement like `console.log 42`:

### Token Stream (from Lexer/Rewriter)
```
IDENTIFIER("console") . PROPERTY("log") CALL_START NUMBER("42") CALL_END
```
*Note: The rewriter adds implicit `CALL_START` and `CALL_END` for the implicit function call*

### Parse Tree with Pure Data Nodes

```coffeescript
Program: o 'Body', { body: '$1' }
  # Creates: { type: 'Program', body: ... }

  Body: o 'Line', ['$1']
    # Creates: array with single Line

    Line: x 'Expression'
      # Passes through Expression

      Expression: x 'Value'
        # Passes through Value

        Value: x 'Invocation'
          # Passes through Invocation

          Invocation: o 'Value OptFuncExist Arguments', {
            type: 'CallExpression',
            callee: '$1',
            args: '$3',
            optional: '$2'
          }
            # $1 = Value node (console.log - the callee)
            # $2 = OptFuncExist (false)
            # $3 = Arguments node (array containing 42)

            # For $1 (console.log):
            SimpleAssignable: o 'Value Accessor', {
              type: 'MemberExpression',
              object: '$1',
              property: '$2'
            }
              # $1 = Identifier(console)
              # $2 = Accessor(.log)

            # For $3 (Arguments):
            Arguments: x 'CALL_START ArgList OptComma CALL_END', '$2'
              # Passes through ArgList

              ArgList: o 'Arg', ['$1']
                # Creates array with single Arg

                Arg: x 'Expression'
                  # Passes through Expression
                  
                  AlphaNumeric: o 'NUMBER', { 
                    type: 'NumericLiteral', 
                    value: '$1' 
                  }
                    # Creates: { type: 'NumericLiteral', value: '42' }
```

### Summary of Key Productions

| Rule | Type | Pattern | Result |
|------|------|---------|--------|
| `Identifier` | `o` | `IDENTIFIER` | Creates `{ type: 'Identifier', name: '$1' }` |
| `Property` | `o` | `PROPERTY` | Creates `{ type: 'Property', name: '$1' }` |
| `Expression` | `x` | `Value` | Passes through `$1` |
| `SimpleAssignable` | `o` | `Value Accessor` | Creates `{ type: 'MemberExpression', ... }` |
| `ArgList` | `o` | `Arg` | Creates `['$1']` |
| `OptFuncExist` | `x` | `''` | Returns `false` |

The `o` function creates new nodes (automatically adding types), while `x` forwards existing values. This distinction makes the grammar's intent crystal clear!

## Complex Example: Functions and Control Flow

```coffeescript
show = (args) -> console.log ...args

if x > 0.5
  show "Big"
else
  show "Small"
```

### Grammar Rules in Action

```coffeescript
# Function definition
Code: o 'PARAM_START ParamList PARAM_END FuncGlyph Block', {
  params: '$2',
  bound: '$4',
  body: '$5'
}

# Assignment
Assign: o 'Assignable = Expression', {
  left: '$1',
  right: '$3'
}

# If/else
If: [
  o 'IfBlock', { consequent: '$1' }
  o 'IfBlock ELSE Block', { consequent: '$1', alternate: '$3' }
]

# Comparison operators
Operation: o 'Expression COMPARE Expression', {
  op: '$2',
  left: '$1',
  right: '$3'
}

# Spread operator
Splat: o '... Expression', {
  type: 'SpreadElement',
  argument: '$2'
}

# String literals
String: o 'STRING', {
  type: 'StringLiteral',
  value: { $slice: ['$1', 1, -1] },  # Remove quotes
  raw: '$1'
}
```

## Special Syntax Notes

### Reserved Characters
The pipe character `|` is reserved for the DSL's alternative syntax. For bitwise OR operations, use the `BAR` token:

```coffeescript
# Grammar definition uses | for alternatives
Value: x 'Literal | Identifier | Call'

# Bitwise OR uses BAR token
BitwiseOp: o 'Expression BAR Expression', { op: '|', left: '$1', right: '$3' }
```

### Array Building
Lists are built using special operators:

```coffeescript
Body: [
  o 'Statement', ['$1']                           # Start with single item
  o 'Body TERMINATOR Statement', { $concat: ['$1', '$3'] }  # Concatenate
  x 'Body TERMINATOR'                             # Pass through (trailing terminator)
]
```

## Current Status

This is a **work-in-progress implementation** of Rip:

### Completed
- ✅ Parser DSL design (o/x functions)
- ✅ Grammar syntax with pipe operators
- ✅ Pure data AST node approach

### In Progress
- 🚧 Lexer implementation
- 🚧 Parser generator (Solar) integration
- 🚧 AST node definitions
- 🚧 Compiler framework
- 🚧 Bootstrap process

### Planned
- 📋 Full test suite
- 📋 Runtime-specific optimizations
- 📋 Source maps
- 📋 REPL
- 📋 Language server protocol

## Why Pure Data Nodes?

Instead of mixing executable code into the parser (like traditional semantic actions), Rip uses pure data structures to define AST nodes:

**Traditional (with code):**
```javascript
Body: o 'Line', code: -> [$1]  // Executable function
```

**Rip (pure data):**
```coffeescript
Body: o 'Line', ['$1']  // Data structure
```

Benefits:
1. **Predictable** - No side effects during parsing
2. **Debuggable** - AST is just data, easy to inspect
3. **Portable** - Same grammar works across all runtimes
4. **Optimizable** - Parser generator can optimize better

## Multi-Runtime Support

### Bun (Primary)
```bash
bun run rip script.rip
```

### Deno
```bash
deno run --allow-read --allow-write rip script.rip
```

### Node.js
```bash
node rip script.rip
```

### Browser
```javascript
import { compile } from '@rip/lang';
const js = compile('x = 42');
```

## Development

```bash
# Install dependencies (using Bun)
bun install

# Build the compiler
bun run build

# Run tests
bun test           # Bun (fastest)
bun run test:deno  # Deno
bun run test:node  # Node.js
```

## Bootstrap Strategy

1. **Phase 1**: Manual JavaScript compilation of core `.rip` files
2. **Phase 2**: Use bootstrap compiler to compile itself
3. **Phase 3**: Full self-hosting with all features
4. **Phase 4**: Feature parity with CoffeeScript
5. **Phase 5**: Rip-specific enhancements

## Goals

- **Simple**: Clean, readable syntax with clear grammar
- **Fast**: Bun-optimized performance
- **Portable**: Runs everywhere JavaScript runs
- **Modern**: ES6+ output by default
- **Maintainable**: Pure data approach keeps complexity low
- **Practical**: Designed for real-world use