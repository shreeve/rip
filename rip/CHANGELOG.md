# Changelog

All notable changes to the Rip language will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-09-06

### 🎉 Initial Release - "The Birth of Rip"

This is the first working version of Rip - a clean, simple language that compiles to JavaScript.

### ✨ Features

#### **Core Language**
- **Complete compilation pipeline** in ~1000 lines total
- **Lexer** (253 lines) - Tokenizes Rip source code
- **Rewriter** (~200 lines) - Handles implicit syntax transformations
- **Grammar** (469 lines) - Defines complete language syntax
- **Parser Generator** (Solar) - SLR(1) parser generation
- **Compiler** (~200 lines) - Transforms AST to JavaScript

#### **Language Features**
- **Implicit function calls** - No parentheses needed: `console.log 42`
- **Clean syntax** - CoffeeScript-inspired but simpler
- **ES6 output** - Generates modern JavaScript with `let`, arrow functions, etc.
- **Comments** - Single-line (`#`) and multi-line (`###`)
- **String interpolation** - `"Hello, #{name}!"`
- **Postfix conditionals** - `return x if y > 0`
- **Arrow functions** - `(x) -> x * 2`

#### **CLI Tool** (`bin/rip`)
- **Run mode** - Execute .rip files directly: `rip file.rip`
- **Compile mode** - Output JavaScript: `rip -c file.rip`
- **AST mode** - Display Abstract Syntax Tree: `rip --ast file.rip`
- **Token mode** - Show token stream: `rip --tokens file.rip`
- **Version flag** - `rip --version` or `rip -v`

### 🚀 Performance
- **108,000 compilations per second** (0.009ms per compilation)
- **Parser generation**: ~8ms one-time cost
- **Instant compilation** for development

### 🏗️ Architecture Highlights
- **No complex class hierarchies** - AST uses simple objects with `type` fields
- **Completely uncoupled components** - Each part does one thing
- **Pure data flow** - Tokens → Rewritten Tokens → AST → JavaScript
- **Direct transformations** - Simple switch statements instead of visitor patterns

### 📊 Statistics
- **Total codebase**: ~1000 lines
- **Source files**: 7 files in `src/`
- **Compiled files**: 6 files in `lib/`
- **Test coverage**: Lexer, Rewriter, Parser, Compiler all tested
- **Zero dependencies**: Pure JavaScript/Rip implementation

### 🛠️ Development Journey
- Started with CoffeeScript-based bootstrap compiler ("cheat" compiler)
- Achieved self-compilation capability
- Removed all scaffolding and bootstrap code
- Clean, professional structure with consistent naming

### 📦 Package Details
- **Name**: `@rip/lang`
- **Runtime**: Bun-first, but supports Deno, Node.js, and browsers
- **Module system**: ES6/ESM
- **License**: MIT
- **Author**: Steve Shreeve

### 🎯 Philosophy
> "Perfection is achieved not when there is nothing more to add,
> but when there is nothing left to take away."
> — Antoine de Saint-Exupéry

Rip embodies this philosophy with its minimal, elegant design where every line has a purpose.

### 🔥 Revolutionary Aspects
1. **10x smaller than traditional compilers** (CoffeeScript: ~10,000 lines)
2. **No visitor pattern overhead**
3. **AST as pure data** - Can be console.logged and debugged easily
4. **Universal position tracking** - Every AST node has location info
5. **Grammar-driven development** - Grammar actions build AST directly

### 📝 Example
```coffeescript
# Rip code
console.log "Hello, Rip!"
x = 42
console.log x

# Compiles to JavaScript:
console.log("Hello, Rip!");
let x = 42;
console.log(x);
```

### 🙏 Acknowledgments
- Inspired by CoffeeScript's elegance
- Built with Bun for modern JavaScript runtime
- Solar parser generator for efficient parsing

---

**This is just the beginning. Rip is alive and ready to grow!** 🚀
