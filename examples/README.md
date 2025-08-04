<img src="/assets/rip-icon-512wa.png" style="width:50px" /> <br>

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

```bash
# Install dependencies (from example directory)
bun install

# Run with rip-server
rip-server ./examples/blog

# Or run directly
cd examples/blog && bun index.rip
```

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