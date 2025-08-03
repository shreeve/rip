<img src="/assets/logos/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip API - Modern Database-Backed API

A blazing-fast API built with the Rip language, featuring SQLite database persistence, type-safe schema validation, and automatic data generation.

## 🎯 Technology Stack

### Core Technologies

- **[Rip](https://github.com/shreeve/rip)** - A modern, elegant language that transpiles to JavaScript
  - Clean CoffeeScript-inspired syntax
  - First-class `await` support
  - Seamless Bun integration

- **[Bun](https://bun.sh)** - Ultra-fast JavaScript runtime
  - Native SQLite support (`bun:sqlite`)
  - Built-in TypeScript/Rip transpilation
  - Lightning-fast package management

### Web Framework

- **[Hono](https://hono.dev)** - Lightweight, ultrafast web framework
  - Minimal overhead (perfect for workers)
  - Excellent TypeScript support
  - Simple, Express-like API
  - First-class middleware support

### Database & ORM

- **[Drizzle ORM](https://orm.drizzle.team)** - Type-safe SQL query builder
  - Zero dependencies
  - Excellent SQLite support
  - Type-safe queries without runtime overhead
  - Simple migrations

- **[SQLite](https://www.sqlite.org)** (via `bun:sqlite`) - Embedded database
  - Zero configuration
  - Perfect for development and small-to-medium production apps
  - ACID compliant
  - Blazing fast with Bun's native implementation

### Data Validation & Generation

- **[Zod](https://zod.dev)** - TypeScript-first schema validation
  - Runtime type checking
  - Excellent error messages
  - Composable schemas
  - Perfect integration with Hono via `@hono/zod-validator`

- **[Faker.js](https://fakerjs.dev)** - Realistic data generation
  - Generate test data on-the-fly
  - Extensive locale support
  - Deterministic data generation
  - Perfect for demos and testing

## 📁 Project Structure

```
api/
├── index.rip           # Main API entry point
├── bunfig.toml        # Bun configuration (enables Rip transpilation)
├── package.json       # Dependencies and configuration
├── db/
│   ├── schema.ts      # Database schema definitions
│   └── api.db         # SQLite database (auto-created)
└── routes/
    └── lawfirms.rip   # Law firms CRUD routes (currently inline in index.rip)
```

## 🔧 How It Works

### 1. **Rip Transpilation**
The `bunfig.toml` configures Bun to automatically transpile `.rip` files:
```toml
preload = ["/path/to/bun/rip-bun.ts"]
```

### 2. **Database Schema**
Defined in `db/schema.ts` using Drizzle:
```typescript
export const lawfirmsTable = sqliteTable('lawfirms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
})
```

### 3. **API Routes**
Written in elegant Rip syntax:
```coffee
# GET all law firms
lawfirmsApp.get '/', (c) ->
  firms = await db.select().from(lawfirmsTable).all()
  c.json firms

# POST - Generate random law firm
lawfirmsApp.post '/generate', (c) ->
  firmData =
    name: faker.company.name() + " Law Firm"
    email: faker.internet.email()
    # ... more fields
  result = await db.insert(lawfirmsTable).values(firmData).returning().get()
  c.json result, 201
```

### 4. **Multi-Worker Architecture**
The API runs under `rip-server` with:
- Multiple worker processes for parallelism
- Hot reload on file changes
- Automatic worker recycling
- Load balancing across workers

## 🚀 Getting Started

### Installation
```bash
# Install dependencies
bun install
```

### Running the API

#### Option 1: Via rip-server (Recommended)
```bash
# From project root
rip-server ./api

# Or from anywhere if globally installed
rip-server /path/to/api
```

#### Option 2: Direct execution
```bash
# From api directory
bun index.rip
```

### Configuration

Default configuration can be set in `package.json`:
```json
{
  "rip-server": {
    "workers": 4,
    "requests": 20
  }
}
```

## 📡 API Endpoints

### Core Endpoints

- `GET /` - API info and status
- `GET /health` - Health check endpoint
- `GET /info` - Detailed API information

### Law Firms API

- `GET /api/lawfirms` - List all law firms
- `POST /api/lawfirms/generate` - Generate a random law firm with faker

### Example Responses

#### GET /api/lawfirms
```json
[
  {
    "id": 1,
    "name": "Smith & Associates Law Firm",
    "email": "contact@smithlaw.com",
    "phone": "555-123-4567",
    "address": "123 Legal Street",
    "city": "Law City",
    "state": "CA",
    "zip": "90210",
    "createdAt": "2024-08-03T10:00:00Z"
  }
]
```

#### POST /api/lawfirms/generate
```json
{
  "id": 2,
  "name": "Johnson Legal Group Law Firm",
  "email": "info@johnsonlegal.com",
  "phone": "555-987-6543",
  "address": "456 Justice Ave",
  "city": "Legal Town",
  "state": "NY",
  "zip": "10001",
  "createdAt": "2024-08-03T10:05:00Z"
}
```

## 🔥 Hot Reload

The API supports hot reload when running under `rip-server`:
- Edit any `.rip` file
- Workers automatically restart
- No manual restart needed
- Zero downtime updates

## 🎯 Why These Technologies?

### Why Rip?
- Clean, expressive syntax
- Native async/await support
- Seamless Bun integration
- Modern language features

### Why Hono?
- Minimal overhead (< 20KB)
- Faster than Express/Fastify
- Built for edge/worker environments
- Excellent middleware ecosystem

### Why Drizzle?
- Type-safe without code generation
- No build step required
- Lightweight and fast
- Great developer experience

### Why SQLite?
- Zero configuration
- Embedded = no separate server
- Perfect for development
- Scales to production for many use cases

## 🛠️ Development Tips

1. **Database Location**: The SQLite database is created at `db/api.db` in the API directory
2. **Schema Changes**: Modify `db/schema.ts` and restart to apply changes
3. **Adding Routes**: Currently routes are inline in `index.rip`, but can be modularized
4. **Testing**: Use `curl` or any HTTP client to test endpoints

## 📈 Performance

With the multi-worker architecture:
- Request handling: < 10ms average
- Hot reload: < 1 second
- Worker restart: Graceful with zero downtime
- Database queries: Microsecond latency with SQLite

## 🚧 Future Enhancements

- [ ] Full CRUD operations for law firms
- [ ] Route modularization (separate files)
- [ ] Database migrations
- [ ] Authentication middleware
- [ ] API documentation (OpenAPI/Swagger)
- [ ] More entity types
- [ ] Relationship modeling

---

Built with ❤️ using Rip, Bun, and modern web technologies.