<div align="center"><img src="logo.png" style="height:200px" /><br></div>

# Rip Language

A modern programming language that compiles to ES6+ with first-class multi-runtime support.

## Design Philosophy

Rip is designed from the ground up to be **runtime-agnostic** while being **Bun-first**:

- **Primary Target**: Bun (for best performance and developer experience)
- **Full Support**: Deno, Node.js, and modern browsers
- **Pure ES6/ESM Output**: Generated JavaScript works everywhere
- **No Runtime Lock-in**: Your compiled code isn't tied to any specific platform

## Architecture

```
/rip
├── src/           # Source files (all .rip)
│   ├── lexer.rip      # Tokenizer
│   ├── parser.rip     # Parser (using Solar)
│   ├── nodes.rip      # AST nodes
│   ├── compiler.rip   # Main compiler
│   ├── solar.rip      # Parser generator
│   └── index.rip      # Main exports
├── lib/           # Compiled JavaScript (ES6/ESM)
├── bin/           # CLI tools
│   └── rip.rip        # Command-line interface
└── test/          # Test suite
```

## How Parsing Works

Let's trace through how Rip parses a simple statement like `console.log 42`:

### Token Stream (from Lexer/Rewriter)
```
IDENTIFIER("console") . PROPERTY("log") CALL_START NUMBER("42") CALL_END
```
*Note: The rewriter adds implicit `CALL_START` and `CALL_END` for the implicit function call*

### Parse Tree with Captured Values

```coffeescript
Program: o 'Body', body: '$1'
  # $1 = Body node (array with one Line)

  Body: o 'Line', code: -> [$1]
    # $1 = Line node (the Invocation)

    Line: o 'Expression'
      # $1 = Expression node (passes through)

      Expression: o 'Value'
        # $1 = Value node (the Invocation)

        Value: o 'Invocation'
          # $1 = Invocation node

          Invocation: o 'Value OptFuncExist Arguments'
            # $1 = Value node (console.log - the callee)
            # $2 = OptFuncExist (empty, returns nothing/false)
            # $3 = Arguments node (array containing 42)

            # For $1 (console.log):
            Value: o 'Assignable'
              Assignable: o 'SimpleAssignable'
                SimpleAssignable: o 'Value Accessor'
                  # $1 = Value node (console)
                  # $2 = Accessor node (.log)

                  # For $1 (console):
                  Value: o 'Assignable'
                    Assignable: o 'SimpleAssignable'
                      SimpleAssignable: o 'Identifier'
                        Identifier: o 'IDENTIFIER'
                          # $1 = "console" (the token value)

                  # For $2 (.log):
                  Accessor: o '. Property'
                    # $1 = "." (the dot token)
                    # $2 = Property node

                    Property: o 'PROPERTY'
                      # $1 = "log" (the token value)

            # For $3 (Arguments):
            Arguments: o 'CALL_START ArgList OptComma CALL_END'
              # $1 = CALL_START token
              # $2 = ArgList node (array with one Arg)
              # $3 = OptComma (empty)
              # $4 = CALL_END token

              ArgList: o 'Arg'
                # $1 = Arg node (the number 42)

                Arg: o 'Expression'
                  Expression: o 'Value'
                    Value: o 'Literal'
                      Literal: o 'AlphaNumeric'
                        AlphaNumeric: o 'NUMBER'
                          # $1 = "42" (the token value)
```

### Summary of Key Captures

| Rule | Pattern | Captured Values |
|------|---------|-----------------|
| `Identifier` | `IDENTIFIER` | `$1 = "console"` |
| `Property` | `PROPERTY` | `$1 = "log"` |
| `Accessor` | `. Property` | `$1 = "."`, `$2 = Property("log")` |
| `SimpleAssignable` | `Value Accessor` | `$1 = Value(console)`, `$2 = Accessor(.log)` |
| `AlphaNumeric` | `NUMBER` | `$1 = "42"` |
| `ArgList` | `Arg` | `$1 = Arg(42)` |
| `Arguments` | `CALL_START ArgList OptComma CALL_END` | `$1 = CALL_START`, `$2 = ArgList`, `$3 = empty`, `$4 = CALL_END` |
| `Invocation` | `Value OptFuncExist Arguments` | `$1 = Value(console.log)`, `$2 = false/empty`, `$3 = Arguments([42])` |

The `$` variables always refer to the positional elements in the pattern, counting terminals and non-terminals from left to right!

### Minimal Grammar Required

For this simple example, we only need about **18 grammar rules**:
- Program, Body, Line
- Expression, Value
- Invocation, Arguments, ArgList, Arg
- SimpleAssignable, Assignable
- Identifier, Property, Accessor
- Literal, AlphaNumeric
- OptFuncExist, OptComma

Yet with just these rules, we can already parse meaningful programs. The grammar scales beautifully - each new feature (functions, if statements, loops) adds just a few more rules while exponentially increasing expressiveness!

## The `o` vs `x` Parser DSL Design with Pipe Syntax and Custom Helpers

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

### Complete Example
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
```

### Key Benefits
1. **Visual clarity** - The `o` vs `x` distinction shows intent at a glance
2. **Minimal boilerplate** - Inline syntax and pipe operators eliminate repetition
3. **Extensible** - Custom helpers allow domain-specific abstractions
4. **Familiar** - Pipe syntax honors BNF traditions
5. **Progressive** - Start simple, add helpers as patterns emerge
6. **Clean separation** - Parser provides tools, grammar uses them

### Special Features
- **Auto-typing**: Objects created with `o()` automatically get `type: LHS` if not specified
- **Default pass-through**: `x()` with no second parameter passes through `$1`
- **Explicit values**: `x()` can pass specific positions or literal values:
  ```coffeescript
  # x() can also pass specific positions or literal values
  OptComma:    x ' | ,'           # Empty string or comma
  Wrapped:     x '( Expr )', '$2'  # Pass through position 2
  OptFlag:     x '', false         # Return literal false
  RequireFlag: x 'REQUIRED', true  # Return literal true
  ```
- **Array operations**: Special operators like `$concat` for building lists
- **Literal values**: Boolean/null/number literals are passed through directly

This design achieves near-theoretical minimum verbosity while maintaining crystal clarity. Grammar files become true DSLs for describing languages, not parser implementation details.

## Complex Example: Functions, If/Else, and String Interpolation

Let's trace through a more complex CoffeeScript-style program:

```coffeescript
show = (args) -> console.log ...args

if (x = Math.rand()) > 0..5
  show "Biggie: #{x}"
else
  show "Smalls: #{x}"
```

### Token Stream (simplified)

```
IDENTIFIER("show") = PARAM_START IDENTIFIER("args") PARAM_END ->
  IDENTIFIER("console") . PROPERTY("log") CALL_START ... IDENTIFIER("args") CALL_END
TERMINATOR
IF ( IDENTIFIER("x") = IDENTIFIER("Math") . PROPERTY("rand") CALL_START CALL_END )
  COMPARE(">") NUMBER("0") .. NUMBER("5")
INDENT
  IDENTIFIER("show") CALL_START STRING_START "Biggie: " INTERPOLATION_START
    IDENTIFIER("x") INTERPOLATION_END STRING_END CALL_END
OUTDENT
ELSE
INDENT
  IDENTIFIER("show") CALL_START STRING_START "Smalls: " INTERPOLATION_START
    IDENTIFIER("x") INTERPOLATION_END STRING_END CALL_END
OUTDENT
```

### Key Parse Tree Elements

#### Line 1: `show = (args) -> console.log ...args`

```coffeescript
Assign: o 'Assignable = Expression'
  # $1 = Assignable (show)
  # $3 = Expression (the arrow function)

  Code: o 'PARAM_START ParamList PARAM_END FuncGlyph Line'
    # $2 = ParamList ([args])
    # $4 = FuncGlyph (-> = false, not bound)
    # $5 = Line (console.log ...args)

    # The spread operator:
    Splat: o '... Expression'
      # $1 = "..."
      # $2 = Expression (args identifier)
```

#### Line 2: `if (x = Math.rand()) > 0..5`

```coffeescript
If: o 'IfBlock ELSE Block'
  IfBlock: o 'IF Expression Block'
    # $2 = Expression (the comparison)

    Operation: o 'Expression COMPARE Expression'
      # $1 = Expression (parenthetical assignment)
      # $2 = ">"
      # $3 = Expression (range 0..5)

      # Parenthetical assignment:
      Parenthetical: o '( Body )'
        Assign: o 'Assignable = Expression'
          # x = Math.rand()

      # Range literal:
      Range: o 'Expression RangeDots Expression'
        # $1 = Expression (0)
        # $2 = RangeDots (..)
        # $3 = Expression (5)

        RangeDots: o '..'
          # Returns {exclusive: false}
```

#### Lines 3 & 5: String Interpolation

```coffeescript
String: o 'STRING_START Interpolations STRING_END'
  # Creates a template literal

  Interpolations: o 'Interpolations InterpolationChunk'
    # Combines literal strings and interpolated expressions

    # Literal part:
    InterpolationChunk: o 'String'
      # "Biggie: " or "Smalls: "

    # Interpolated variable:
    InterpolationChunk: o 'INTERPOLATION_START Body INTERPOLATION_END'
      # $2 = Body containing identifier 'x'
```

### Summary of Features Used

| Feature | Key Rules | Description |
|---------|-----------|-------------|
| **Function Definition** | `Code`, `ParamList`, `FuncGlyph` | Arrow functions with parameters |
| **Assignment** | `Assign`, `Assignable` | Variable binding |
| **Parenthetical Grouping** | `Parenthetical` | Expression grouping with `()` |
| **Method Calls** | `Invocation`, `Accessor` | Dot notation like `Math.rand()` |
| **Comparison** | `Operation COMPARE` | Binary comparison operators |
| **Range Literals** | `Range`, `RangeDots` | Inclusive `..` and exclusive `...` ranges |
| **If/Else** | `IfBlock`, `Block` | Conditional branching |
| **String Interpolation** | `Interpolations` | Template literals with `#{}` |
| **Spread Operator** | `Splat` | Rest/spread with `...` |
| **Implicit Calls** | Rewriter adds `CALL_START/END` | Parenthesis-free function calls |

With just **~33 grammar rule categories**, Rip can parse this rich, expressive program that includes:
- Function definitions with parameter lists
- Nested expressions and assignments
- String templates with interpolation
- Range literals for numeric sequences
- Spread operators for variadic arguments
- Control flow with if/else blocks
- Implicit function calls for cleaner syntax

The parse tree elegantly composes these features - each rule handles its specific concern while seamlessly integrating with others. This composability is what makes the grammar both powerful and maintainable!

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

## Current Status

This is a **clean-room implementation** of Rip, starting fresh with:

- ✅ Multi-runtime architecture
- ✅ Basic lexer implementation
- ✅ AST node definitions
- ✅ Compiler framework
- ✅ CLI interface
- 🚧 Parser integration (Solar)
- 🚧 Bootstrap process
- 📋 Test suite
- 📋 Documentation

## Why Start Fresh?

Instead of trying to fix the CoffeeScript codebase in place (which has deep CommonJS dependencies), we're building Rip from scratch with:

1. **Pure ESM from day one** - No CommonJS baggage
2. **Runtime-agnostic design** - Works everywhere
3. **Modern tooling** - Bun-first for speed
4. **Clean architecture** - No legacy compatibility layers
5. **Gradual feature addition** - Start simple, build up

## Bootstrap Strategy

1. **Phase 1**: Manual JavaScript compilation of core `.rip` files
2. **Phase 2**: Use bootstrap compiler to compile itself
3. **Phase 3**: Full self-hosting with all features
4. **Phase 4**: Feature parity with CoffeeScript
5. **Phase 5**: Rip-specific enhancements

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

## Goals

- **Simple**: Clean, readable syntax
- **Fast**: Bun-optimized performance
- **Portable**: Runs everywhere JavaScript runs
- **Modern**: ES6+ output by default
- **Practical**: Designed for real-world use
