# @rip/lang

**The future clean implementation of the RIP language**

## 🎯 What is RIP?

**RIP** is a modern programming language that transpiles to JavaScript, built on top of CoffeeScript with significant enhancements for web development. RIP maintains the elegance and expressiveness of CoffeeScript while adding powerful features for modern async programming and pattern matching.

### Core Philosophy
- **Clean Syntax**: Minimal, readable code that expresses intent clearly
- **Modern Async**: First-class support for async/await patterns
- **Pattern Matching**: Elegant regex and data structure matching
- **Web-First**: Designed specifically for modern web development

### Key Features
```coffeescript
# Clean function syntax
greet = (name) -> "Hello, #{name}!"

# Elegant async with ! suffix
data = fetch(url)!
result = processData(data)!

# LEGENDARY regex matching with =~ and _
state =~ /^([A-Z]{2})$/
code = _?[1]?.toUpperCase()

# Null-safe operations
userName = user?.profile?.name ? 'Anonymous'
```

## 🚀 Vision

This package will contain the clean, purpose-built RIP language compiler - a ground-up implementation designed specifically for modern web development.

## 📋 Evolution from CoffeeScript

RIP started as CoffeeScript but evolved with targeted enhancements for modern web development. Here's our journey:

### Change 001 - Default Bare Compilation
**Timestamp**: 2025-08-01 20:11:35 -0600
**Problem**: CoffeeScript wrapped all code in an IIFE (Immediately Invoked Function Expression) by default, creating unnecessary function scoping that interfered with modern module systems and debugging.
**Solution**: Made `bare: true` the default compilation mode, generating clean, unwrapped JavaScript.
**Why Better**:
- Cleaner generated JavaScript that's easier to debug
- Better integration with modern ES modules
- Reduced bundle size by eliminating wrapper functions
- More predictable variable scoping

### Change 002 - Async Bang Syntax (!)
**Timestamp**: 2025-08-01 23:22:46 -0600
**Problem**: JavaScript's `await` keyword created verbose, cluttered code especially in function call chains. Writing `await fetch(await getUrl())` was repetitive and hard to read.
**Solution**: Added `!` suffix operator that automatically detects async calls and marks containing functions as `async`.
**Why Better**:
- `fetch(url)!` is cleaner than `await fetch(url)`
- Automatic async function detection - no manual `async` declarations needed
- Function call chains become elegant: `processData(fetch(url)!)!`
- Reduces async/await boilerplate by ~60%

**Example**:
```coffeescript
# Before (verbose)
getData = ->
  url = await getUrl()
  response = await fetch(url)
  await response.json()

# After (elegant)
getData = ->
  url = getUrl()!
  response = fetch(url)!
  response.json()!
```

### Change 003 - Regex Match Operator (=~ and _)
**Timestamp**: 2025-08-05 01:15:07 -0600
**Problem**: JavaScript regex matching required verbose `.match()` calls and manual result assignment, making pattern matching code cluttered and error-prone.
**Solution**: Added Ruby-style `=~` operator with automatic `_` variable assignment for match results.
**Why Better**:
- `val =~ /regex/` is cleaner than `val.match(/regex/)`
- Automatic `_` assignment eliminates intermediate variables
- Optional chaining works perfectly: `_?[1]?.toUpperCase()`
- Transforms regex matching from chore to poetry

**Example**:
```coffeescript
# Before (verbose)
validateState = (input) ->
  match = input.match(/^([A-Z]{2})$/)
  if match then match[1].toUpperCase() else null

# After (LEGENDARY)
validateState = (input) ->
  input =~ /^([A-Z]{2})$/
  _?[1]?.toUpperCase()
```

## 🏗️ "Building the 747 Mid-Flight"

While the current `/coffeescript` directory serves as our working implementation (modified CoffeeScript), this package represents the future:

- **Current State**: `/coffeescript` - Modified CoffeeScript fork with RIP enhancements
- **Future State**: `/packages/lang` - Clean, purpose-built RIP language implementation

## 🎯 Key Features (Planned)

### ✅ Proven Features (from current implementation)
- `!` suffix for elegant async syntax
- `=~` regex matching with automatic `_` assignment
- CoffeeScript-inspired clean syntax

### 🔮 Future Enhancements
- Purpose-built parser (not CoffeeScript-based)
- Enhanced error messages
- Better source maps
- Custom operators
- Pattern matching
- Pipeline operators
- Native TypeScript integration

## 🛠️ Development Strategy

1. **Phase 1**: Package structure and planning (current)
2. **Phase 2**: Core parser implementation
3. **Phase 3**: AST and code generation
4. **Phase 4**: Feature parity with current implementation
5. **Phase 5**: Enhanced features and optimizations
6. **Phase 6**: Migration from `/coffeescript` to `/packages/lang`

## 📦 Current Status

**🚧 Under Construction** - Package structure created, implementation in progress.

## 🤝 Contributing

This is the future of RIP - contributions that push the language forward are welcome!

---

*"Building the 747 mid-flight" - maintaining current functionality while constructing the future.*