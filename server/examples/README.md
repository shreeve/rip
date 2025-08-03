# 🚀 Rip Server Examples

These examples show the capabilities of the Rip Application Server.

## 🌟 Examples

### `simple/` - Basic Example
- Simple Hono app with basic routes
- Shows worker information
- Demonstrates hot reload

**Usage:**
```bash
cd simple
bun run dev   # Development with hot reload
bun run start # Production mode
```

### `api/` - Advanced API Example
- Full REST API with CRUD operations
- JSON middleware
- In-memory data store
- Worker stats

**Usage:**
```bash
cd api
bun run dev   # Development with hot reload
curl http://localhost:3000/users
```

## 🔥 Hot Reload Testing

1. Start any example: `bun run dev`
2. Edit the `.rip` file (change a message)
3. Save the file
4. Watch the workers gracefully restart!
5. Test: `curl http://localhost:3000`

## 📊 Monitoring

Each example includes monitoring endpoints:

- `GET /health` - Server health and stats
- `GET /metrics` - Prometheus-style metrics
- `GET /stats` - Worker-specific stats (if implemented)

## 🧪 Load Testing

```bash
# Light load test
wrk -t4 -c10 -d30s http://localhost:3000

# Heavy load test
wrk -t12 -c100 -d60s http://localhost:3000
```

Watch how the server handles the load with:
- Round-robin load balancing
- Automatic failover
- Graceful worker restarts

## 🌟 Creating Your Own App

1. Create a new directory
2. Add `index.rip` (or `app.rip`, `server.rip`, `main.rip`)
3. Export a Hono app or define a `fetch` function
4. Run: `bun run dev` from the server directory

**Example `index.rip`:**
```coffeescript
import { Hono } from 'hono'

app = new Hono

app.get '/', (c) -> c.text 'My Rip App!'

export default app
```

---

**Get started with modern web development!** 🚀