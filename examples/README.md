<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Examples - Learn by Example

**Ready-to-run examples showcasing different aspects of the Rip ecosystem**

## Available Examples

### 🏥 Medical (`/medical`)
- Comprehensive medical/enterprise system API
- **Real-world production schema** (1,192+ lines, 80+ tables)
- Actual healthcare practice data models
- Best for: Learning enterprise database architectures

### 📝 Blog (`/blog`)
- Full blog API with posts, users, comments
- Real database integration (DuckDB + Drizzle)
- RESTful endpoints with Faker.js
- Best for: Building content-based applications

### ⚖️ Legal (`/legal`)
- Law firm management API
- CRUD operations with validation
- DuckDB + Drizzle + Zod integration
- Best for: Business applications

### 👥 Users (`/users`)
- In-memory user management API
- RESTful patterns without database
- Shows multi-worker features
- Best for: Learning API patterns

### 👋 Hello (`/hello`)
- Minimal "Hello World" example
- Worker info and performance testing
- Input validation and error handling
- Best for: Getting started

## Running Examples

### **🎯 Single App Mode**
```bash
# Install all dependencies (from project root)
bun install

# Run with bun server (recommended)
bun server ./examples/blog

# Or run directly (from monorepo root)
bun examples/blog/index.rip

# Flexible arguments (ANY order):
bun server w:5 8080 examples/blog  # 5 workers, port 8080
bun server examples/legal prod w:3 # Production mode, 3 workers
bun server 3001 dev examples/hello # Port 3001, dev mode
```

### **🌐 Platform Mode (FULLY WORKING!) - Run Multiple Examples**
```bash
# Start the Rip Platform Controller
bun server platform

# Deploy multiple examples at once!
bun server deploy blog examples/blog --port 3001 --workers 2
bun server deploy medical examples/medical --port 3002 --workers 3
bun server deploy users examples/users --port 3003 --workers 2
bun server deploy legal examples/legal --port 3004 --workers 4

# Visit the platform dashboard
open http://localhost:3000/platform

# Scale examples in real-time
bun server scale blog 5          # Scale blog to 5 workers
bun server list                  # Show all running examples
```

**🎛️ Platform Benefits:**
- **📊 Unified dashboard**: Monitor all examples from one interface
- **⚡ Real-time scaling**: Add/remove workers without restarts
- **🔧 Hot deployments**: Update examples without downtime
- **📈 Performance comparison**: See which patterns perform best

## Example Features

Each example demonstrates:
- ✅ Rip language syntax
- ✅ Hono web framework
- ✅ Multi-worker architecture
- ✅ Hot reload support

Database examples (blog, legal, medical) also show:
- ✅ DuckDB integration
- ✅ Drizzle ORM usage
- ✅ @rip/schema validation
- ✅ Faker.js data generation

## License

MIT

## Contributing

Examples are part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community