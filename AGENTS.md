# AGENTS.md

## Project Overview

**Rip** is a modern programming language that transpiles to JavaScript, built as an enhanced fork of CoffeeScript. Rip adds powerful features for modern web development while maintaining elegant, readable syntax.

**Key Features:**
- Async bang syntax (`fetch!(url)` → `await fetch(url)`)
- Ruby-style regex matching (`val =~ /regex/` with automatic `_` variable)
- Universal type coercion (safe regex matching on any data type)
- Clean bare compilation (no IIFE wrappers by default)
- Full CoffeeScript compatibility

**Architecture:**
- Primary implementation: `/coffeescript/` (enhanced CoffeeScript fork)
- Package ecosystem: `/packages/` (various Rip tooling packages)
- Tests: `/coffeescript/test/rip/` (49 Rip modernization tests)

## Development Environment Setup

**Prerequisites:**
- Bun runtime (preferred)
- Git for version control

**Setup Commands:**
```bash
# Clone and setup
git clone <repo-url>
cd rip

# Build the Rip compiler (CoffeeScript fork)
cd coffeescript
cake build

# Verify installation
./bin/coffee --version
```

## Build and Test Commands

**Core Compiler:**
```bash
cd coffeescript

# Rebuild compiler after changes
cake build

# Run all tests (1473 CoffeeScript legacy + 49 Rip modernization)
npm test

# Run only Rip feature tests
./bin/cake test:rip

# Compile Rip files
./bin/coffee -c your-file.rip
./bin/coffee -c -o output/ source/
```

**Package Development (Server):**
```bash
# Run unified server (per-worker sockets)
bun server apps/labs/api http:5002 w:4 --hot-reload=process

# Stop prior instances (best-effort)
bun packages/server/rip-server.ts --stop
```

**API Utilities:**
```bash
# Run toName tests (uses Bun + rip plugin)
bun packages/api/test-toName.rip
```

## Code Style Guidelines

**Language:**
- Primary development in CoffeeScript (for compiler work)
- TypeScript for packages and tooling
- Generated JavaScript should be clean and modern

**Formatting:**
- Follow existing CoffeeScript indentation (2 spaces)
- Use meaningful variable names
- Comment complex regex or AST manipulations

**File Organization:**
- Compiler code: `/coffeescript/src/`
- Tests: `/coffeescript/test/rip/` (for Rip features)
- Packages: `/packages/<name>/`

**Naming Conventions:**
- Language references: "Rip" (like "CoffeeScript")
- Environment variables: `RIP_*` (all caps)
- CLI commands: `rip` (lowercase)
- Package names: `@rip/package-name`

## Naming Convention Guidelines

**When to use `RIP` (all uppercase):**
- Environment variables: `RIP_LOG_JSON`, `RIP_HOT_RELOAD`
- Configuration constants in code that represent environment variables
- Titles that are already capitalized: "RIP LANGUAGE FEATURES"

**When to use `Rip` (title case):**
- Language and platform references: "Rip language", "Rip compiler", "Rip syntax"
- Documentation headings: "## Rip Language Features"
- User-facing descriptions: "This is a Rip application"
- Comments describing the language: "# Rip: Enhanced regex matching"

**When to use `rip` (lowercase):**
- Command line utilities: `rip compile`, `rip build`
- File extensions: `.rip` files
- Package names: `@rip/lang`, `rip-server`
- Directory names: `/rip-projects/`
- Variable names in code: `ripCompiler`, `ripConfig`
- URLs and identifiers: `https://github.com/shreeve/rip`

**Examples in context:**
```bash
# CLI usage (lowercase)
rip compile app.rip
bun your-app.rip

# Environment variables (uppercase)
export RIP_HOT_RELOAD=module

# Documentation (title case)
"The Rip language provides elegant syntax..."
"Rip's regex matching is bulletproof..."
```

This consistent naming follows established patterns from other languages like CoffeeScript, TypeScript, and JavaScript.

## Testing Instructions

**Test Framework:**
- CoffeeScript's built-in test framework for compiler tests
- Bun test for package tests

**Running Tests:**
```bash
# Full test suite (recommended before commits)
cd coffeescript && npm test

# Only Rip feature tests (faster iteration)
cd coffeescript && ./bin/cake test:rip

# Specific test file
cd coffeescript && ./bin/coffee test/rip/enhanced-regex-match.coffee
```

**Writing Tests:**
- Place Rip feature tests in `/coffeescript/test/rip/`
- Use descriptive test names: `"enhanced =~ handles null safely"`
- Test edge cases, especially for type coercion
- Verify both functionality and generated JavaScript

**Test Coverage Expectations:**
- All new Rip features must have comprehensive tests
- Test various data types for regex features
- Maintain 100% pass rate on legacy CoffeeScript tests

## Pull Request Guidelines

**Branch Naming:**
- `feat/feature-name` for new features
- `fix/bug-description` for bug fixes
- `refactor/improvement-name` for refactoring

**Commit Messages:**
Follow conventional commits format:
```
feat: add universal type coercion to regex indexing
fix: handle null values in async bang syntax
refactor: generate clean toSearchable().match() for regex operations
docs: update ARCHITECTURE.md with new features
```

**Before Submitting:**
1. Run full test suite: `cd coffeescript && npm test`
2. Verify Rip tests pass: `./bin/cake test:rip`
3. Test compilation on sample files
4. Update documentation if needed
5. Check that generated JavaScript is clean

## Rip Language Features

**Current Implementation Status:**
- ✅ Async Bang Syntax (`!`) - fully implemented
- ✅ **Secure Regex Match Operator (`=~`)** - with universal type coercion **and built-in security**
- ✅ **Secure Ruby-Style Regex Indexing (`[]`)** - with universal type coercion **and injection protection**
- ✅ Bare Compilation - default mode
- ✅ Modern Output - clean JavaScript generation

**🛡️ Major Security Enhancement:**
Rip's regex operations are now **secure by default** - automatically blocking newline injection attacks while preserving clean JavaScript output. Use `/m` flag for explicit multiline when needed.

**Key Files for Feature Development:**
- `/coffeescript/src/lexer.coffee` - tokenization
- `/coffeescript/src/grammar.coffee` - parsing rules
- `/coffeescript/src/nodes.coffee` - AST nodes and compilation
- `/coffeescript/src/rewriter.coffee` - syntax transformations

**Testing New Features:**
- Add comprehensive tests to `/coffeescript/test/rip/`
- Test with various data types (null, undefined, numbers, symbols, etc.)
- Verify backward compatibility with existing CoffeeScript code

## Package Ecosystem

**Active Packages:**
- `@rip/api` - API utilities
- `@rip/bun` - Bun integration
- `@rip/data` - Database utilities
- `@rip/schema` - Schema validation
- `@rip/server` - Unified per-worker socket HTTP server

**Package Development:**
- Each package has its own `package.json` and dependencies
- Use Bun for package development and testing
- Follow TypeScript best practices

## Environment Variables

**Rip-Specific Variables:**
- `RIP_LOG_JSON` - JSON logging mode
- `RIP_HOT_RELOAD` - Hot reload configuration

## Known Issues and Limitations

**Current Limitations:**
- Async bang syntax requires function calls (not arbitrary expressions)
- Some complex nested regex patterns may need testing
- Package ecosystem is still evolving

**Performance Notes:**
- String inputs use fast path for regex operations
- Type coercion adds minimal overhead for non-string inputs
- Generated JavaScript is optimized for modern engines

## Contributing Guidelines

**For AI Agents:**
- Focus on maintaining backward compatibility with CoffeeScript
- Always run tests before suggesting changes
- When working on regex features, test with all JavaScript data types
- Preserve the elegant, readable nature of the language
- Generated JavaScript should be clean and performant

## Quick Links

- Architecture: ARCHITECTURE.md
- Branding: BRANDING.md
- Unified Server: packages/server/

**Code Review Checklist:**
- [ ] All tests pass (legacy + Rip features)
- [ ] Generated JavaScript is clean
- [ ] Documentation updated if needed
- [ ] Edge cases tested (especially null/undefined)
- [ ] No breaking changes to existing syntax

**Getting Help:**
- Check existing tests for examples
- Review `/coffeescript/test/rip/` for feature patterns
- Examine generated JavaScript to understand compilation
- Test with `./bin/coffee -c` to see output

---

*This project represents the evolution of CoffeeScript into a modern, feature-rich language for web development. The focus is on developer experience, type safety, and clean JavaScript generation.*
