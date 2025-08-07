<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Examples - Learn by Example

**Ready-to-run examples showcasing different aspects of the Rip ecosystem**

## Available Examples

### 🏥 Medical (`/medical`)
- Comprehensive medical/enterprise system schema
- Demonstrates ALL column types and patterns
- Complex relationships and indexes
- Best for: Learning advanced schema features

### 📝 Blog (`/blog`)
- Full blog API with posts, users, comments
- Real database integration (SQLite + Drizzle)
- RESTful endpoints with Faker.js
- Best for: Building content-based applications

### ⚖️ Legal (`/legal`)
- Law firm management API
- CRUD operations with validation
- Zod schema validation
- Best for: Business applications

### 👥 Users (`/users`)
- In-memory user management API
- RESTful patterns without database
- Shows multi-worker features
- Best for: Learning API patterns

### 👋 Hello (`/hello`)
- Minimal "Hello World" example
- Basic routing and worker info
- Simulated work endpoints
- Best for: Getting started

## Running Examples

### **🎯 Single App Mode**
```bash
# Install all dependencies (from project root)
bun install

# Run with bun server (recommended)
bun server ./examples/blog

# Or run directly
cd examples/blog && bun index.rip
```

### **🌐 Platform Mode (FULLY WORKING!) - Run Multiple Examples**
```bash
# Start the Rip Platform Controller
rip-server platform

# Deploy multiple examples at once!
rip-server deploy blog examples/blog --port 3001 --workers 2
rip-server deploy legal examples/legal --port 3002 --workers 3
rip-server deploy users examples/users --port 3003 --workers 1

# Visit the platform dashboard
open http://localhost:3000/platform

# Scale examples in real-time
rip-server scale blog 5          # Scale blog to 5 workers
rip-server list                  # Show all running examples
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
- ✅ SQLite integration
- ✅ Drizzle ORM usage
- ✅ Schema validation
- ✅ Data generation

## License

MIT

## Contributing

Examples are part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community