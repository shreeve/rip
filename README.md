<div align="center"><img src="/docs/rip-icon-512wa.png" style="width:200px" alt="Rip Logo" /><br></div>

# Rip

**A multilanguage universal runtime**

A revolutionary universal parser platform that enables elegant programming across multiple languages. Built as a monorepo with interchangeable components that can be mixed, matched, and shared across the development ecosystem.

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
- **Regex matching**: `val =~ /pattern/` - elegant and intuitive
- **Function calls**: `read 'email', 'email'` - clean and simple
- **Object returns**: `{ success: true, data }` - natural and concise

**🎯 Rare Things Possible** *(10% of use cases)*:
- **One-sided ranges**: `min: 0` or `max: 100` - explicit when needed
- **Complex patterns**: `min: 1, max: 5, default: 3` - powerful when required
- **Advanced regex**: Full CoffeeScript regex features available
- **Custom validation**: Extensible patterns for edge cases

**💫 Perfect Balance**: Learn the common patterns first (covers 90% of needs), discover advanced features as you grow. No feature bloat, no cognitive overload, just elegant progression from simple to sophisticated.

## 📦 Packages

### **[@rip/parser](packages/parser/)**
SLR(1) parser generator that creates fast, reliable parsers from grammar definitions.

### **[@rip/server](packages/server/)**
Production-ready application server with multi-process architecture, hot reload, and HTTPS.

### **[@rip/schema](packages/schema/)**
ActiveRecord-inspired database DSL for elegant schema definitions with Drizzle ORM.

### **[@rip/bun](packages/bun/)**
Seamless transpilation plugin enabling `.rip` files to run directly in Bun.

## 🚀 Examples

Explore working examples in the [`/examples`](examples/) directory:
- **[blog](examples/blog/)** - Full blog API with posts, users, and comments
- **[legal](examples/legal/)** - Law firm management system
- **[medical](examples/medical/)** - Complex medical schema showcase
- **[users](examples/users/)** - Simple user management API
- **[hello](examples/hello/)** - Minimal hello world

## The Rip Language

**Rip** is a modern echo of CoffeeScript - maintaining elegance and expressiveness while focusing on core syntax.

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

# 🔥 NEW: Ruby-style regex indexing (Change 005)
phone = "1234567890"
areaCode = phone[/^(\d{3})(\d{3})(\d{4})$/, 1]  # "123"
initial = name[/[A-Z]/]                         # "J" from "Jonathan"
word = text[/(\w+)/].toUpperCase()              # Extract and transform

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

## Quick Start

```bash
# Install dependencies
bun install

# Run an example
rip-server ./examples/blog

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
├── docs/            # Documentation and assets
└── coffeescript/    # Standalone CoffeeScript compiler
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