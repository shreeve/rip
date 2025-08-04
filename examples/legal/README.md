<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip API - Modern Database-Backed API

**Fast API with SQLite, type-safe schemas, and automatic data generation**

## Stack

- **[Rip](../README.md)** - Clean syntax, native async/await
- **[Bun](https://bun.sh)** - Fast runtime with native SQLite
- **[Hono](https://hono.dev)** - Minimal web framework
- **[Drizzle](https://orm.drizzle.team)** - Type-safe SQL
- **[Zod](https://zod.dev)** - Schema validation
- **[Faker](https://fakerjs.dev)** - Test data generation

## Quick Start

```bash
# Install dependencies
bun install

# Run with rip-server (recommended)
rip-server ./api

# Or run directly
bun index.rip
```

## Project Structure

```
api/
├── index.rip        # Main API with routes
├── bunfig.toml      # Enables Rip transpilation
├── package.json     # Dependencies
└── db/
    ├── schema.rip   # Database schema using rip-schema
    └── api.db       # SQLite database (auto-created)
```

## API Endpoints

### Core
- `GET /` - API info
- `GET /health` - Health check
- `GET /info` - Detailed info

### Law Firms
- `GET /api/lawfirms` - List all firms
- `POST /api/lawfirms/generate` - Generate random firm

### Example Response

```json
{
  "id": 1,
  "name": "Smith & Associates Law Firm",
  "email": "contact@smithlaw.com",
  "phone": "555-123-4567",
  "address": "123 Legal Street",
  "city": "Law City",
  "state": "CA",
  "zip": "90210"
}
```

## Database Schema

Using rip-schema DSL in `db/schema.rip`:

```coffeescript
import { schema as Schema } from '@rip/schema'

export default Schema ->
  @table 'lawfirms', ->
    @string   'name!', 100
    @string   'address', 100
    @string   'city', 50
    @string   'state', 2
    @string   'zip', 10
    @string   'phone', 20
    @email    'email!'
    @string   'website'
    @text     'notes'
    @boolean  'active', true
    @decimal  'hourly_rate', 10, 2
    @integer  'employee_count'
    @timestamps()

    @index    'name'
    @index    ['state', 'city']
    @index    'active'
```

## Key Features

- **Multi-worker** - Runs under rip-server with load balancing
- **Hot reload** - Auto-restart on file changes
- **Type-safe** - Full TypeScript support via Drizzle
- **Fast** - Bun + SQLite = microsecond queries
- **Clean syntax** - Rip's `!` suffix for await

## Configuration

In `package.json`:
```json
{
  "rip-server": {
    "workers": 4,
    "requests": 20
  }
}
```

## Development

1. Database is at `db/api.db`
2. Schema changes: Edit `db/schema.rip` and restart
3. Routes are in `index.rip` (can be modularized)
4. Test with `curl` or any HTTP client

## License

MIT

## Contributing

Rip API is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community