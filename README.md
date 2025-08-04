<div align="center"><img src="/docs/rip-icon-512wa.png" style="width:200px" alt="Rip Logo" /><br></div>

# Rip

**A multilanguage universal runtime**

A revolutionary universal parser platform that enables elegant programming across multiple languages. The `rip` executable can run programs written in various languages through interchangeable language packs, with the default **Rip language** serving as a modern echo of CoffeeScript.

*The rip ecosystem transforms language development from monolithic parsers to elegant, interoperable components that can be mixed, matched, and shared across the entire development ecosystem.*

## The Rip Ecosystem

### 🎯 **Design Philosophy: The 4 C's**
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

## 🚀 Key Components

### **[Rip Parser](parser/)**
SLR(1) parser generator that creates fast, reliable parsers from grammar definitions. The foundation of the Rip ecosystem.

### **[Rip Server](server/)**
Production-ready application server with multi-process architecture, hot reload, and built-in HTTPS support.

### **[Rip Schema](schema/)**
ActiveRecord-inspired database DSL for elegant schema definitions with Drizzle ORM.

### **[Rip API](api/)**
Modern database-backed API showcase using the Rip language, Hono, and SQLite.

### **[Rip Bun](bun/)**
Seamless transpilation plugin enabling `.rip` files to run directly in Bun.

## The Rip Language

**Rip** is a modern echo of CoffeeScript - maintaining all the elegance and expressiveness that made CoffeeScript beloved, while focusing on the core syntax without JSX or literate support.

### ✨ **What Makes Rip Special**
- **Elegant Syntax**: All the beauty of CoffeeScript's significant whitespace and expressive operators
- **Modern Runtime**: Designed for today's JavaScript engines (Bun, Node, Deno, browsers)
- **Clean Focus**: Core language features without JSX or literate extensions
- **Universal Parsing**: Built on our revolutionary parser architecture

### 🎯 **Key Language Features**

#### Clean Syntax
```coffee
# Functions with implicit returns
greet = (name) ->
  "Hello, #{name}!"

# Object destructuring
{name, age} = person

# Array comprehensions
squares = (x * x for x in [1..10])
```

#### Async Made Simple
```coffee
# Using the ! suffix for await
data = fetch('/api/data')!
users = db.getUsers()!
```

## 🚀 Getting Started

### Prerequisites
- **Bun** (v1.0.0+) - [Install Bun](https://bun.sh)
- **Node.js** (v18+) - For compatibility (optional)

### Quick Start
```bash
# Clone the repository
git clone https://github.com/yourusername/rip.git
cd rip

# Install dependencies
bun install

# Run a Rip program
bun api/index.rip

# Start the development server
cd api && rip-server
```

## 📚 Documentation

- **[Parser Documentation](parser/)** - SLR(1) parser generator details
- **[Server Documentation](server/)** - Application server architecture
- **[Schema Documentation](schema/)** - Database DSL reference
- **[API Examples](api/)** - Real-world API implementation
- **[Brand Assets](BRANDING.md)** - Logos and brand guidelines

## License

MIT

## Contributing

Rip is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community