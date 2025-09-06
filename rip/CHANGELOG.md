# Changelog

All notable changes to the Rip language will be documented in this file.

## [3.0.0] - 2025-01-06 - 06:30 MST

### 🌟 **SOLAR-IZED!** - Full Solar Parser Integration

#### **Major Breaking Change**
- **Removed SimpleParser completely** - Rip now uses the Solar-generated parser exclusively
- **No more dual-parser maintenance** - One parser to rule them all!

#### **Core Improvements**
- **Rewriter fixed for implicit calls**:
  - Properly uses array token format (`token[0]` for type)
  - Checks `spaced` property for implicit function detection
  - Generates standard parentheses instead of special tokens
  
- **Solar parser integration complete**:
  - Parser returns proper AST from value stack
  - EOF token correctly maps to `$end` symbol
  - Lexer interface fully compatible with Solar
  
- **Compiler enhancements**:
  - Added `prop()` method for property access
  - Added `index()` method for array/object indexing
  - Fixed AST node handling in switch statement

#### **What Works Now**
- ✅ Implicit function calls: `console.log "Hello"` → `console.log("Hello");`
- ✅ Property access: `console.log` compiles correctly
- ✅ All basic literals and expressions
- ✅ Full parser generation from grammar (~40ms)

#### **Performance**
- Parser generation: ~40-60ms (one-time cost)
- Compilation speed: Maintained at ~0.009ms per file

This is a **major milestone** - Rip is now fully powered by its own Solar parser generator!

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2025-09-06 - 05:30 MST

### ✨ Compound Assignment Operators

#### **Added Full Support for Compound Assignments**
- **Operators supported**: `+=`, `-=`, `*=`, `/=`
- **Lexer enhancement**: Added tokenization for compound assignment operators
- **Parser update**: Extended SimpleParser to handle compound assignments
- **Compiler ready**: Already supported via `op` field in assign nodes
- **Test coverage**: Added comprehensive unit and feature tests
- **Grammar markers**: Updated to show ✅ for all compound assignment rules

### 🧪 Testing
- Created `test/features/compound-assignments.rip` with real-world examples
- Added `test/unit/compound-assignments.test.js` for unit testing
- All compound assignment operators tested and passing

## [0.2.2] - 2025-09-06 - 05:00 MST

### 📊 Test Coverage Tracking

#### **Added Grammar Test Coverage Markers**
- **Visual indicators** in `grammar.rip` showing test status for each rule
- **Coverage legend** at top of grammar file for clarity
- **27 rules tested and passing** (✅)
- **2 rules partially tested** (⚠️) - implicit function calls
- **4 rules tested but failing** (❌) - If/Block structures
- **Unmarked rules** are not yet tested (keeps file clean)

### 🎯 Benefits
- **Immediate visual feedback** on what's working and what needs attention
- **Grep-friendly** - Easy to find failures with `grep "# ❌"`
- **Progress tracking** - Watch coverage improve over time
- **Clean approach** - No clutter for untested features

### 📝 Documentation
- Added test coverage legend to grammar file
- Coverage markers align visually for easy scanning
- Simple to remove later with sed when no longer needed

## [0.2.1] - 2025-09-06 - 04:33 MST

### 🐛 Bug Fixes

#### **Fixed Critical Test Suite Issues**
- **Resolved duplicate export statements** in `lib/lexer.js` that were breaking the entire test suite
- **Improved test helper module** to prevent accumulation of duplicate exports
- **Fixed CLI execution** - `bin/rip` now works properly again

### 📊 Test Suite Recovery
- **Before**: Tests couldn't run due to `SyntaxError: Only one 'default' export is allowed`
- **After**:
  - ✅ **39 tests passing** (up from 17)
  - ❌ **8 tests failing** (down from 14) - expected due to SimpleParser limitations
  - 🚀 **90 expect() calls** executing successfully

### 🔧 Technical Details
- Cleaned up accumulated duplicate `export default` and `export { }` statements
- Modified `test/unit/test-helpers.js` to check for existing exports before adding new ones
- Ensured clean compilation from CoffeeScript source files

### 💡 Lesson Learned
Test helpers that modify compiled files need careful state management to avoid accumulating changes across test runs.

## [0.2.0] - 2025-01-01

### 🎯 Test Suite & Organization Release

This release establishes a comprehensive testing framework and improves project organization.

### ✨ Added

#### **Testing Infrastructure**
- **Bun test framework integration** - Professional test suite with 31 tests
- **Two-tier testing strategy**:
  - `test/unit/` - JavaScript tests for compiler internals (lexer, rewriter, compiler, integration)
  - `test/features/` - Rip tests for language features (math, functions, objects, control flow)
- **Test helper module** - Shared utilities for ESM conversion and module loading
- **Test runner for Rip files** - Execute `.rip` test files to verify language features
- **Coverage and watch modes** - `bun test:watch` and `bun test:coverage` scripts

#### **Examples & Documentation**
- **Organized examples directory** with descriptive names:
  - `hello-world.rip` - Classic first program
  - `implicit-calls.rip` - Demonstrates implicit function calls
  - `basic-features.rip` - Core language features
  - `advanced-features.rip` - Classes, destructuring, higher-order functions
- **README for examples** - Learning path and running instructions

### 🔧 Changed

#### **File Organization**
- Renamed files for clarity and brevity:
  - `implicit-function-calls.rip` → `implicit-calls.rip`
  - `control-flow.rip` → `control.rip`
  - `VICTORY.rip` → `basic-features.rip`
  - `demo-rip-features.rip` → `advanced-features.rip`
- Moved test files to structured directories (`test/unit/` and `test/features/`)
- Cleaned up `tmp/` directory of old experiments

#### **Package Scripts**
- Updated test scripts in `package.json`:
  - `test` - Run unit tests
  - `test:unit` - Run JavaScript tests
  - `test:features` - Run Rip language tests
  - `test:all` - Run both test suites
  - `test:watch` - Watch mode for development
  - `test:coverage` - Generate coverage reports

### 🐛 Fixed
- Fixed typo in `bin/rip` (line 171) - stray `3` character
- Resolved duplicate export issues in compiled modules
- Fixed ESM conversion race conditions with lock file

### 📊 Statistics
- **17 unit tests passing** (14 pending features)
- **4 feature test suites** ready for parser integration
- **Test organization**: Clear separation between internal and feature tests
- **Examples**: 4 well-documented example programs

### 🎨 Philosophy Reinforced
- **Testing at two levels**: Test the machinery (JS) and the experience (Rip)
- **Self-documenting code**: File names clearly indicate purpose
- **Clean structure**: Everything has its place

## [0.1.0] - 2025-09-06

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
