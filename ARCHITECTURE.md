<img src="/assets/logo.png" style="width:50px" />

# Rip Language Architecture

This document provides comprehensive technical documentation for developers working on the Rip language project. It covers the internal architecture, implementation details, development workflow, and technical insights.

## 🎯 Project Overview

**Rip** is a modern programming language that transpiles to JavaScript, built on top of CoffeeScript with significant enhancements. It's designed for web development with a focus on clean syntax, async programming, and modern tooling.

### Key Value Propositions
- **Clean Async Syntax**: `fetch!` instead of `await fetch()`
- **LEGENDARY Regex Matching**: `val =~ /regex/` and `str[/regex/]` with automatic `_` assignment
- **Elegant Conditional Patterns**: `(val =~ /regex/; if _ then transform else fallback)`
- **Modern Web Stack**: Bun + Hono + Drizzle ORM integration
- **Type-Safe Database**: Custom DSL for schema definition
- **Hot Reload**: Development server with file watching
- **Production Ready**: Real-world web applications

## 🏗️ Architecture Overview

### Monorepo Structure
```
rip/
├── packages/           # Core packages
│   ├── server/        # rip-server (multi-process web server)
│   ├── server/        # rip-server (per-worker sockets)
│   ├── schema/        # rip-schema (database DSL)
│   ├── bun/           # rip-bun (Bun transpiler plugin)
│   └── parser/        # rip-parser (SLR(1) parser)
├── examples/          # Example applications
├── apps/              # Full applications
│   └── labs/server/   # BHVR Labs server (Rip implementation)
├── coffeescript/      # Enhanced CoffeeScript compiler
└── docs/              # Documentation
```

### Core Components

#### 1. Enhanced CoffeeScript Compiler (`/coffeescript`)
- **Location**: `/coffeescript/` (modified CoffeeScript fork)
- **Key Enhancement**: `!` suffix for automatic `async` function detection
- **How it works**: AST traversal detects `!` suffixes and sets `@isAsync = yes`
- **Build**: `cd coffeescript && ./bin/cake build`
- **Critical files**:
  - `src/nodes.coffee` (contains the `!` suffix detection logic)
  - `lib/coffeescript/` (compiled output)

#### 2. Bun Transpiler Plugin (`/packages/bun`)
- **File**: `packages/bun/rip-bun.ts`
- **Purpose**: Bun plugin that transpiles `.rip` files using our enhanced CoffeeScript compiler
- **Usage**: Referenced in `bunfig.toml` as `preload = ["/path/to/rip-bun.ts"]`
- **Key code**:
```typescript
Bun.plugin({
  name: 'rip-bun',
  setup({ onLoad }) {
    onLoad({ filter: /\.rip$/ }, async ({ path }) => ({
      loader: 'js',
      contents: compile(await Bun.file(path).text(), { bare: true })
    }))
  }
})
```

#### 3. Web Server (`/packages/server`)
- **Architecture**: Multi-process (manager + workers)
- **Key files**:
  - `rip-server.ts` - Main CLI and process manager
  - `manager.ts` - Process orchestration
  - `worker.ts` - HTTP request handlers
  - `server.ts` - Core server logic
- **Features**: Hot reload, load balancing, Unix sockets, HTTPS support
- **Usage**: `rip-server [directory] [port]`

#### 4. Unified Web Server (`/packages/server`)
- nginx+unicorn+Sinatra–inspired: in‑process server with per‑worker sockets and ergonomic app assembly
- **Architecture**: High-performance LIFO worker selection with optimized process management
- **Key features**:
  - **LIFO worker selection** - Prioritizes recently-used workers for better cache locality
  - **Event-driven queue draining** - Reactive processing without polling overhead
  - **Worker cycling** - Prevents memory bloat with configurable reload limits
  - **Clean control interface** - Simple join/quit operations via Unix socket
  - **Per-worker Unix sockets** - Userland server selects idle workers; one-inflight-per-worker preserved
  - **Hot-reload modes** - `none` | `process` | `module`; recommend `process` for multi-file apps
- **Performance targets**: 20K+ RPS with seamless hot reloading
- **Key files**:
  - `rip-server.ts` - CLI with worker lifecycle management
  - `manager.ts` - Process supervisor with restart logic
  - `worker.ts` - Single-inflight workers with mtime-based hot reload
  - `server.ts` - LIFO worker selector with efficient forwarding
  - `utils.ts` - Shared utilities and configuration parsing
- **Usage**: `bun server <app-path> w:<N> --max-reloads=<N>`

#### 5. Database Schema DSL (`/packages/schema`)
- **Purpose**: ActiveRecord-inspired DSL for defining database schemas
- **Syntax**: CoffeeScript-based, compiles to Drizzle ORM
- **CLI**: `rip-schema db:push`, `rip-schema db:drop`
- **Example**:
```coffeescript
export default schema ->
  @table 'users', ->
    @string 'email', unique: true
    @string 'firstName'
    @boolean 'admin', default: false
```

## 🚀 Recent Major Achievement: BHVR Labs Server

### What We Built
A complete drop-in replacement for a Node.js/Hono server using the Rip language.

**Location**: `/apps/labs/server/`

### Key Files
- `index.rip` - Main server application (258 lines)
- `db/schema.rip` - Database schema definition
- `bunfig.toml` - Bun configuration for transpilation
- `package.json` - Dependencies and workspace config

### API Endpoints Implemented
- `GET /config` - Client configuration
- `POST /auth/code` - Send authentication code
- `POST /auth/verify` - Verify authentication code
- `GET /users/me` - Get current user
- `PATCH /users/me` - Update user profile
- `GET /users` - List all users
- `POST /orders` - Create new order
- `GET /orders` - List user orders
- `GET /results` - Get user results

### Technical Stack
- **Framework**: Hono (web framework)
- **Database**: SQLite via Drizzle ORM
- **Validation**: Zod with Hono middleware
- **Transpilation**: rip-bun plugin
- **Schema**: rip-schema DSL

## 🔧 Critical Technical Details

### The `!` Suffix Enhancement
**Problem**: CoffeeScript's automatic `async` detection only worked for `await` keyword, not our `!` suffix.

**Solution**: Modified `/coffeescript/src/nodes.coffee` in the `Code` class constructor:
```coffeescript
# rip: Detect ! suffix (async call operator) to set @isAsync
if node instanceof IdentifierLiteral and node.value?.endsWith?('!')
  @isAsync = yes
if node instanceof Value
  lastProp = node.properties?[node.properties.length - 1]
  if lastProp?.name?.value?.endsWith?('!')
    @isAsync = yes
```

**Result**: Functions using `db.select().get!` automatically become `async` functions.

### The `=~` and `_` Regex Enhancement with Built-in Security
**Problem**: JavaScript regex matching required verbose `.match()` calls, manual result assignment, and was vulnerable to newline injection attacks.

**Solution**: Added Ruby-style `=~` operator with automatic `_` variable assignment and **Ruby-level security**:
- **Lexer**: Added `'=~'` to `COMPARE` array in `/coffeescript/src/lexer.coffee`
- **Compiler**: Enhanced to recognize `=~` operator and generate secure code that sets `_` variable
- **Security**: Automatically rejects strings containing `\n` or `\r` (mimics Ruby's `\A` and `\z` behavior)
- **Override**: Use `/m` flag to explicitly allow multiline when needed

**Result**: Elegant regex syntax with automatic match result capture and **bulletproof security**:
```coffeescript
# Before (verbose and vulnerable)
match = val.match(/^([A-Z]{2})$/)
code = match?[1]?.toUpperCase()

# After (LEGENDARY and SECURE)
val =~ /^([A-Z]{2})$/
code = _?[1]?.toUpperCase()

# Explicit multiline (when actually needed)
text =~ /^start.*end$/m  # Developer acknowledges multiline risk
```

**Security Examples**:
```coffeescript
# SECURE: Blocks injection attacks
"user\n<script>alert('xss')</script>" =~ /^[a-z]+$/  # → null (rejected)

# EXPLICIT: When multiline is legitimately needed
"line1\nline2" =~ /^line1.*line2$/m  # → ["line1\nline2"] (allowed)
```

**Generated JavaScript Comparison**:
```javascript
// Default (secure) - no second parameter
username =~ /^[a-z]+$/
// → (_ = toSearchable(username).match(/^[a-z]+$/))

// Explicit multiline - allowNewlines=true parameter
text =~ /^start.*end$/m
// → (_ = toSearchable(text, true).match(/^start.*end$/m))
```
**Clean, readable, and self-documenting!** The presence of the second parameter clearly indicates "this allows multiline input."

### The `str[/regex/]` Ruby-Style Indexing Enhancement with Security
**Problem**: While `=~` was great for setting `_`, sometimes you just want the match result directly, but JavaScript regex indexing was also vulnerable to injection attacks.

**Solution**: Added Ruby-style regex indexing with bracket notation and **built-in security**:
- **Parser**: Extended `RegexIndex` handling in `/coffeescript/src/nodes.coffee`
- **Compiler**: Enhanced to handle `str[/regex/]` syntax and safely set `_` variable with match results
- **Security**: Automatically rejects strings with newlines, same protection as `=~` operator
- **Safety**: Handles null matches gracefully, never throws errors, **blocks injection attempts**

**Result**: Even more elegant regex syntax for common cases with **bulletproof security**:
```coffeescript
# Get full match directly - SECURE by default
email = "user@domain.com"
normalized = email[/^.+@.+$/]?.toLowerCase()  # Safe, clean, and secure

# Access capture groups via global _ - PROTECTED
domain = email[/@(.+)$/] and _[1]             # "domain.com" (injection-proof)
username = email[/^([^@]+)/]                  # "user" (newline-safe)

# Perfect for validation pipelines - BULLETPROOF
phone[/^\d{10}$/] and formatPhone(_[0])       # Chain operations securely

# Explicit multiline when legitimately needed
content[/^header.*footer$/m] and _[0]         # Developer acknowledges risk
```

**Security in Action**:
```coffeescript
# BLOCKS malicious input automatically
"user\n<script>" [/^[a-z]+$/]  # → null (attack blocked)

# EXPLICIT multiline override when needed
"line1\nline2"[/^line.*$/m]    # → "line1" (developer choice)
```

### The Semicolon Pattern for Conditional Regex
**Problem**: Even with `=~`, regex validation often required conditional logic for transformations.

**Solution**: Discovered that CoffeeScript's existing semicolon operator combined with `=~` provides an elegant pattern:
- **No New Syntax**: Works with existing CoffeeScript/Rip features
- **Clear Separation**: Semicolon clearly separates match from transformation
- **Flexible**: Can handle any conditional logic using `if` expressions

**Result**: Elegant one-line conditional transformations:
```coffeescript
# Pattern: match, then conditionally transform
result = (val =~ /^([A-Z]{2})$/; if _ then _[1].toUpperCase() else null)

# With custom fallback
result = (val =~ /^([A-Z]{2})$/; if _ then _[1].toUpperCase() else "UNKNOWN")
```

### Transpilation Pipeline
1. **Write**: `.rip` files with `!` suffix and `=~` regex matching
2. **Transpile**: `rip-bun.ts` plugin calls enhanced CoffeeScript compiler
3. **Execute**: Bun runs the compiled JavaScript
4. **Serve**: rip-server handles HTTP requests

### Workspace Configuration
Root `package.json` includes:
```json
"workspaces": [
  "packages/*",
  "examples/*",
  "apps/*/client",
  "apps/*/server"
]
```

## 🐛 Known Issues & Limitations

### Database Issues
- Some Drizzle ORM compatibility issues with `shouldDisableInsert()` method
- Version mismatches between rip-schema generated code and Drizzle versions
- SQL column name conflicts (e.g., `desc` reserved word)

### Development Workflow
- CoffeeScript compiler must be rebuilt after changes: `cd coffeescript && ./bin/cake build`
- Absolute paths sometimes needed in `bunfig.toml` for worker processes
- Hot reload can cause socket conflicts during rapid restarts

## 🔄 Development Workflow

### Starting the Labs Server
```bash
cd apps/labs/server
rip-schema db:push  # Set up database
rip-server . 8305   # Start server on port 8305
```

### Making Language Changes
```bash
cd coffeescript
# Edit src/nodes.coffee or other source files
./bin/cake build
# Test with: bun -e "const cs = require('./lib/coffeescript'); console.log(cs.compile('test!'))"
```

### Testing Transpilation
```bash
cd apps/labs/server
bun -e "const app = await import('./index.rip'); console.log(typeof app.default)"
```

## 📦 Dependencies & Versions

### Key Package Versions
- `bun`: latest
- `hono`: ^4.7.8
- `drizzle-orm`: ^0.38.3
- `@hono/zod-validator`: ^0.4.2
- `zod`: ^3.23.8
- `@faker-js/faker`: ^9.3.0

### Workspace Dependencies
- `@rip/schema`: workspace:* (internal package)

## 🎯 Design Philosophy: The 4 C's
1. **Correct** - Code works as expected
2. **Clear** - Easy to understand and maintain
3. **Consistent** - Follows established patterns
4. **Concise** - Minimal but complete

## 🚀 Current Status

### ✅ Working Features
- `!` suffix automatic async detection
- `=~` regex matching with automatic `_` assignment
- `str[/regex/]` Ruby-style regex indexing with global `_` assignment
- Semicolon pattern for conditional regex transformations
- Full web server with Hono framework
- Database schema DSL with SQLite
- Hot reload development server
- Multi-process architecture
- HTTPS support with CA certificates
- Request logging and error handling

### 🔄 In Progress
- Fixing Drizzle ORM compatibility issues
- Improving database schema generation
- Enhanced error messages and debugging

### 🎯 Future Enhancements
- Pattern matching syntax
- Pipeline operators
- Null-safe chaining
- Custom operators
- Range syntax improvements (e.g., `3..18`, `18..`)

## 💡 Key Development Insights

1. **Always use `rip-bun.ts`** for transpilation, never CoffeeScript register directly
2. **Absolute paths** may be needed in `bunfig.toml` for worker processes
3. **Rebuild CoffeeScript** after any language changes: `./bin/cake build`
4. **Test transpilation** before testing server functionality
5. **Database issues** are separate from language functionality
6. **The `!` suffix and `=~` operator** are the key language enhancements that make Rip special
7. **🧹 IMPORTANT: Test script hygiene** - Always place experimental test files in `/tmp/` directory, never in the root or project directories. Clean up test files immediately after experimentation to keep the codebase clean.

## 🎉 Success Metrics

The BHVR Labs server proves Rip is ready for:
- ✅ Real-world web development
- ✅ Modern async programming patterns
- ✅ Database-driven applications
- ✅ Production-style server architecture
- ✅ Integration with existing npm ecosystem

This represents a major milestone from experimental language to production-ready web framework!
