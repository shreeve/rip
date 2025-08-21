<div align="center"><img src="/logo.png" style="width:200px" alt="Rip Logo" /><br></div>

# Rip

**A multilanguage universal runtime**

A universal parser platform that enables elegant programming across multiple languages. Built as a monorepo with interchangeable components that can be mixed, matched, and shared across the development ecosystem.

## 🎯 Design Philosophy: The 4 C's

Everything in the Rip ecosystem follows four core principles, in order of importance:

1. **Correct** *(Most Important)*: Accurate, reliable, and thoroughly tested
   - *If the code doesn't work correctly, nothing else matters*
   - *Bugs and errors undermine trust and usability*
   - *This is the foundation everything else builds on*

2. **Clear**: Easy to understand, well-documented, and intuitive
   - *Even correct code is useless if no one can understand it*
   - *Clear code is maintainable and extensible*
   - *Good documentation enables adoption and contribution*

3. **Consistent**: Unified patterns and naming across all components
   - *Makes the codebase predictable and learnable*
   - *Reduces cognitive load when moving between components*
   - *Essential for team collaboration*

4. **Concise**: Minimal, elegant code without unnecessary complexity
   - *Important, but only after the other three are satisfied*
   - *Premature optimization for brevity can harm clarity*
   - *Elegance is the cherry on top, not the foundation*

## 🎯 The Larry Wall Principle

> *"Common things should be easy, rare things should be possible"*
> **— Larry Wall, creator of Perl** *(Personal conversation, Open Source Conference, San Diego, 2002)*

This foundational principle guides every API design decision in Rip:

**✅ Common Things Easy** *(90% of use cases)*:
- **Range validation**: `[min, max]` - shortest, clearest syntax
- **Regex matching**: `val =~ /pattern/` and `str[/regex/]` - elegant and intuitive
- **Function calls**: `read 'email', 'email'` - clean and simple
- **Object returns**: `{ success: true, data }` - natural and concise
- **Flexible server args**: `bun server w:5 8080 apps/my-app` - any order works

**🎯 Rare Things Possible** *(10% of use cases)*:
- **One-sided ranges**: `min: 0` or `max: 100` - explicit when needed
- **Complex patterns**: `min: 1, max: 5, default: 3` - powerful when required
- **Advanced regex**: Full CoffeeScript regex features available
- **Custom validation**: Extensible patterns for edge cases

**💫 Perfect Balance**: Learn the common patterns first (covers 90% of needs), discover advanced features as you grow. No feature bloat, no cognitive overload, just elegant progression from simple to sophisticated.

## 🎯 The Matz Principle

> *"Ruby is designed to make programmers happy"*
> *"I hope to see Ruby help every programmer in the world to be productive, and to enjoy programming, and to be happy."*
> **— Yukihiro "Matz" Matsumoto, creator of Ruby**

Matz's **Principle of Least Surprise (POLS)** is deeply woven into Rip's DNA. Every interface should behave exactly as developers naturally expect:

**✅ Intuitive Defaults**:
- `bun server` → Start/restart (what you want most of the time)
- `bun server status` → Show status (explicit intent, explicit result)
- `bun server stop` → Stop server (clear action, predictable outcome)

**✅ Natural Language Flow**:
- `read 'email', 'email'` → Reads like English, works like you'd expect
- `phone[/(\d{3})/]` → Bracket notation works just like arrays
- `state =~ /^([A-Z]{2})$/` → Regex matching feels natural

**✅ Happy Developer Experience**:
- **No surprises**: Commands do exactly what they say
- **Consistent patterns**: Learn once, use everywhere
- **Elegant progression**: Simple things are simple, complex things are possible

**🌐 Platform Mode** (fully working):
```bash
# Transform any machine into a dynamic application platform
bun server platform              # Start platform controller
bun server deploy api apps/labs/api --port 3001 --workers 2
bun server scale api 10          # Real-time scaling
bun server list                  # Show all deployed apps
# Visit dashboard: http://localhost:3000/platform
```

**💡 The Goal**: When you use Rip, it should feel like the computer is reading your mind. The syntax and behavior should match your mental model so perfectly that the tool disappears and you can focus purely on solving problems.

## 🌟 Live Language Innovation

**Rip demonstrates rapid language development** - major features can go from concept to production in hours, not years:

### 🎯 What This Enables

**Traditional Language Development**: Years from idea to production
**Rip Development**: Hours from concept to live deployment

This isn't just about features - it's about **improving how programming languages evolve** to meet developer needs in real time.

## 📦 Packages

### **[@rip/parser](packages/parser/)**
SLR(1) parser generator that creates fast, reliable parsers from grammar definitions.

### **[@rip/server](packages/server/)**
Decoupled server/app architecture. One server runtime runs any Rip application with multi-worker load balancing, instant HTTPS, and hot reload. Point-and-run any app directory for development or production.

### **[@rip/schema](packages/schema/)**
ActiveRecord-inspired database DSL for elegant schema definitions with Drizzle ORM.

### **[@rip/api](packages/api/)**
Sinatra/Rails-like API enhancements for your app code: context-free endpoints with `withHelpers`, elegant validation via `read()`, and clean return-style handlers. Brings Ruby-style ergonomics to Rip/Hono routes.

### **[@rip/bun](packages/bun/)**
Seamless transpilation plugin enabling `.rip` files to run directly in Bun.

## 🚀 Examples

Explore working examples in the [`/examples`](examples/) directory:
- **[hello](examples/hello/)** - Minimal hello world with worker info
- **[blog](examples/blog/)** - Full blog API with posts, users, and comments
- **[medical](examples/medical/)** - Enterprise medical system API
- **[users](examples/users/)** - In-memory user management API
- **[legal](examples/legal/)** - Law firm management system

## The Rip Language

**Rip** is a modern evolution of CoffeeScript - maintaining elegance and expressiveness while pioneering rapid language innovation. Features like Ruby-style regex indexing demonstrate how programming languages can evolve in real-time to meet developer needs.

### Key Features

```coffee
# Clean function syntax
greet = (name) -> "Hello, #{name}!"

# Async with ! suffix
data = fetch(url)!
result = processData(data)!

# LEGENDARY regex matching with =~ and _
state =~ /^([A-Z]{2})$/     # Match and auto-assign to _
code = _?[1]?.toUpperCase() # Access match groups elegantly

# 🔥 NEW: Ruby-style regex indexing - Makes regex operations joyful!
email = "user@example.com"
domain = email[/@(.+)$/] and _[1]        # "example.com" - sets _ globally
username = email[/^([^@]+)/]             # "user" - clean and readable

# Perfect for validation and parsing
phone = "1234567890"
formatted = phone[/^(\d{3})(\d{3})(\d{4})$/] and "#{_[1]}-#{_[2]}-#{_[3]}"

# Elegant null handling - no crashes, no boilerplate
initial = name[/[A-Z]/]                  # Returns match or null
result = text[/\d+/]?.toUpperCase()      # Safe chaining

# Elegant conditional transformations with semicolon pattern
code = (state =~ /^([A-Z]{2})$/; if _ then _[1].toUpperCase() else null)

# Pattern matching
status = switch response.code
  when 200 then 'success'
  when 404 then 'not found'
  else 'error'

# Null-safe operations
userName = user?.profile?.name ? 'Anonymous'
```

## 🚀 Architecture

**Rip pioneered decoupled server/app architecture** - one server runtime can instantly run any Rip application:

```bash
# One server, infinite possibilities
bun server apps/blog 3000           # Blog on port 3000
bun server apps/api 8080            # API on port 8080
bun server apps/ecommerce 4000      # E-commerce on port 4000
bun server ../any-project 5000      # Any Rip app anywhere

# HTTPS is trivial (one-time setup)
bun server ca:init                  # Create Certificate Authority
bun server ca:trust                 # Trust in system (no browser warnings!)
bun server apps/api https:ca        # Secure HTTPS with CA-signed certs

# Both protocols simultaneously
bun server apps/api http+https      # HTTP on 3000, HTTPS on 3443
```

### 🔥 Live Development Experience

**Edit files → See changes instantly** with zero configuration:

1. **🎯 Point & Run**: Server discovers and loads your app automatically
2. **⚡ Hot Reload**: File changes trigger graceful worker restarts
3. **📊 Load Balance**: Multi-worker architecture with beautiful request logging
4. **🔒 Production Ready**: Same architecture for development and deployment

```bash
# Start development
bun server apps/my-app              # Server starts, discovers app
# Edit files in apps/my-app/ → changes appear instantly
# No build steps, no server restarts needed!

# Deploy to production
bun server prod apps/my-app         # Same app, production mode
```

## Quick Start

```bash
# Install dependencies
bun install

# Run an example with hot reload
bun server examples/blog

# Try HTTPS (CA setup - one time only)
bun server ca:init && bun server ca:trust
bun server examples/blog https:ca

# Create a schema
cd examples/medical
rip-schema db:push

# Run directly with Bun
bun examples/hello/index.rip
```

## Project Structure

```
rip/
├── packages/          # Core packages
│   ├── bun/          # @rip/bun - Transpiler
│   ├── parser/       # @rip/parser - Parser generator
│   ├── schema/       # @rip/schema - Database DSL
│   └── server/       # @rip/server - Multi-worker server
├── examples/         # Example applications
├── apps/            # Development applications
├── docs/            # Documentation and assets
└── coffeescript/    # Enhanced CoffeeScript compiler with Rip features
```

## Development

This is a Bun workspace monorepo:

```bash
# Install all dependencies
bun install

# Run linting
bun run lint

# Format code
bun run format
```

## License

MIT

## Contributing

Contributions welcome! Please follow the 4 C's principles.

---

Built with ❤️ for the Bun community