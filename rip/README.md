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
