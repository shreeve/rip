<div align="center"><img src="logo.png" style="height:200px" /><br></div>

# Rip Language

A modern programming language that compiles to ES6+ JavaScript with a revolutionary grammar DSL and pure data AST approach.

## Project Vision

Rip reimagines how programming languages are built by introducing a **pure data approach** to parser construction. Instead of mixing executable code into grammar definitions, Rip uses data structures throughout, making the entire compilation pipeline predictable, debuggable, and portable across all JavaScript runtimes.

## Core Innovations

### 1. The `o` vs `x` Grammar DSL

Every grammar production either **creates** structure or **forwards** existing values. Rip makes this distinction explicit:

```typescript
// o() - CREATE/BUILD new AST nodes
Identifier: o('IDENTIFIER', { name: '$1' })  // Creates { type: 'Identifier', name: '...' }

// x() - FORWARD/PASS values through
Expression: x('Value | Operation | Call')     // Forwards without modification
```

This simple insight eliminates entire categories of grammar ambiguity while making intent crystal clear.

### 2. Pure Data AST Nodes

Traditional parser generators mix executable code into grammar rules. Rip uses only data:

```typescript
// Traditional approach (executable):
Body: o('Line', () => [$1])  // Function executes during parsing

// Rip approach (pure data):
Body: o('Line', ['$1'])       // Data structure, no execution
```

This makes parsing predictable, debugging trivial, and enables optimizations impossible with executable semantic actions.

### 3. Pipe Syntax for Clarity

Grammar alternatives use the familiar `|` operator, collapsing verbose definitions into readable one-liners:

```typescript
// Without pipes: 14 lines
Value: [
  x('Literal'),
  x('Identifier'),
  x('Call')
]

// With pipes: 1 line
Value: x('Literal | Identifier | Call')
```

## Grammar Helper System

Rip provides a comprehensive set of TypeScript helper functions that compose naturally:

```typescript
import { o, x, binOp, unaryOp, list, star, plus, opt } from './grammar-helpers';

const grammar = {
  // Simple pass-through chains
  Line:       x('Expression'),
  Expression: x('Value | Operation'),
  
  // Binary operators with automatic expansion
  Arithmetic: binOp('+ | - | * | /', 'MATH'),
  Comparison: binOp('< | <= | > | >=', 'COMPARE'),
  
  // List building with separators
  ArgList:    list('Arg', ','),        // Handles trailing commas
  ParamList:  plus('Param', ','),      // One or more
  ImportList: star('Import'),          // Zero or more
  
  // Optional elements
  OptSemi:    opt(';', ';', null),
  
  // Complex productions still supported
  IfStatement: [
    o('IF Expression Block', { test: '$2', consequent: '$3' }),
    o('IF Expression Block ELSE Block', { 
      test: '$2', 
      consequent: '$3', 
      alternate: '$5' 
    })
  ]
};
```

### Helper Functions Available

| Helper | Purpose | Example |
|--------|---------|---------|
| `o(pattern, node, prec?)` | Create AST nodes | `o('NUMBER', { value: '$1' })` |
| `x(pattern, value?)` | Pass through values | `x('Expression', '$2')` |
| `binOp(ops, prec?)` | Binary operators | `binOp('&& \| \|\|', 'LOGICAL')` |
| `unaryOp(ops, prec?)` | Unary operators | `unaryOp('! \| ~', 'UNARY')` |
| `list(item, sep?)` | Lists with separators | `list('Statement', ';')` |
| `star(item, sep?)` | Zero or more (EBNF *) | `star('Modifier')` |
| `plus(item, sep?)` | One or more (EBNF +) | `plus('Item', ',')` |
| `opt(pattern, yes?, no?)` | Optional (EBNF ?) | `opt('ASYNC', true, false)` |
| `keywords(words, template?)` | Keyword literals | `keywords('TRUE \| FALSE')` |
| `wrapped(open, close, inner?)` | Parenthetical groups | `wrapped('(', ')')` |

## Implementation Architecture

```
/rip
├── src/
│   ├── grammar-helpers.ts   # TypeScript DSL functions (o, x, etc.)
│   ├── grammar.ts           # Grammar definition using helpers
│   ├── parser.ts            # Parser generator (Solar)
│   ├── lexer.ts             # Tokenizer with rewriter
│   ├── nodes.ts             # AST node type definitions
│   ├── compiler.ts          # AST to JavaScript compiler
│   └── index.ts             # Main exports
├── lib/                     # Compiled JavaScript output
├── bin/                     # CLI tools
└── test/                    # Test suite
```

## How It Works: Parsing Example

Let's trace `console.log(42)` through the system:

### 1. Token Stream
```
IDENTIFIER(console) . PROPERTY(log) ( NUMBER(42) )
```

### 2. Grammar Productions Fire
```typescript
// Productions that match:
MemberAccess: o('Value . Property', { 
  object: '$1',     // Identifier(console)
  property: '$3'    // Property(log)
})

Call: o('Value ( ArgList )', {
  callee: '$1',     // MemberAccess(console.log)
  args: '$3'        // [Number(42)]
})

Number: o('NUMBER', { value: '$1' })  // Auto-typed to 'Number'
```

### 3. Resulting AST
```javascript
{
  type: 'Call',
  callee: {
    type: 'MemberAccess',
    object: { type: 'Identifier', name: 'console' },
    property: { type: 'Property', name: 'log' }
  },
  args: [
    { type: 'Number', value: '42' }
  ]
}
```

## Special Considerations

### Reserved Pipe Character

Since `|` is reserved for the DSL's alternative syntax, bitwise OR uses the `BAR` token:

```typescript
// Grammar alternatives use |
Value: x('Literal | Identifier | Call')

// Bitwise OR uses BAR
BitwiseOr: o('Expression BAR Expression', { op: '|', left: '$1', right: '$3' })
```

### Array Operations

Special operators handle list building:

```typescript
Body: [
  o('Statement', ['$1']),                              // Wrap in array
  o('Body TERM Statement', { $concat: ['$1', '$3'] }), // Concatenate
  x('Body TERM')                                        // Pass through
]
```

### Auto-Typing

The `o()` function automatically adds a `type` field matching the rule name:

```typescript
// Grammar rule:
Identifier: o('IDENTIFIER', { name: '$1' })

// Produces AST node:
{ type: 'Identifier', name: 'console' }  // 'type' added automatically
```

## Development Status

### ✅ Completed
- Grammar DSL design with `o()`/`x()` distinction
- TypeScript helper functions with full type safety
- Pipe syntax for alternatives
- Comprehensive helper library (binOp, list, star, plus, etc.)
- Pure data AST approach
- Auto-typing system

### 🚧 In Progress
- Parser generator integration
- Lexer with implicit call rewriter
- Bootstrap compiler (Rip compiling itself)
- AST to JavaScript code generator

### 📋 Planned
- Source map generation
- REPL with syntax highlighting
- Language Server Protocol (LSP) for IDE support
- Runtime-specific optimizations
- Comprehensive test suite

## Multi-Runtime Support

Rip compiles to pure ES6+ JavaScript that runs everywhere:

```bash
# Bun (primary target, fastest)
bun run rip script.rip

# Node.js
node rip script.rip

# Deno
deno run --allow-read --allow-write rip script.rip

# Browser
import { compile } from '@rip/lang';
const js = compile('x = 42');
```

## Getting Started

```bash
# Clone the repository
git clone https://github.com/yourusername/rip-lang

# Install with Bun (recommended)
bun install

# Run the tests
bun test

# Compile a Rip file (once bootstrap is complete)
bun run rip examples/hello.rip
```

## Why Rip?

### For Language Designers
- **Clearest grammar DSL ever created** - The `o`/`x` distinction eliminates ambiguity
- **Pure data approach** - No executable code in your grammar
- **Composable helpers** - Build complex patterns from simple primitives
- **TypeScript-first** - Full type safety throughout

### for Developers
- **Familiar syntax** - If you know CoffeeScript/JavaScript, you know Rip
- **No runtime lock-in** - Your code runs everywhere JavaScript runs
- **Modern output** - ES6+ modules, async/await, destructuring by default
- **Fast compilation** - Bun-optimized for speed

### For Everyone
- **Predictable** - Pure data means no surprises
- **Debuggable** - Every step is inspectable data
- **Maintainable** - Clear separation of concerns
- **Extensible** - Add new syntax without touching the core

## Contributing

Rip is in active development. We welcome contributions in:

- Grammar improvements and extensions
- Runtime optimizations
- Documentation and examples
- Test coverage
- IDE tooling

## Technical Foundation

Rip builds upon ideas from:
- **CoffeeScript** - Clean syntax, significant whitespace
- **Jison** - JavaScript parser generator
- **Tree-sitter** - Incremental parsing concepts
- **Babel** - AST transformation pipeline

But reimagines them with modern JavaScript capabilities and a pure data philosophy.

## Bootstrap Strategy

1. **Phase 1** ✅ - Grammar DSL and helper functions in TypeScript
2. **Phase 2** 🚧 - Basic parser generating JavaScript
3. **Phase 3** - Rip compiler written in JavaScript
4. **Phase 4** - Rip compiler rewritten in Rip
5. **Phase 5** - Full self-hosting with all features

## Goals

- **Simplicity** - Grammar should be obvious, not clever
- **Clarity** - Intent should be visible in the code
- **Performance** - Leverage modern runtime optimizations
- **Portability** - Work identically across all platforms
- **Pragmatism** - Ship working software, iterate based on use

---

*Rip is a radical rethinking of how programming languages are built. By separating concerns cleanly and using pure data throughout, we're building a foundation for the next generation of developer tools.*