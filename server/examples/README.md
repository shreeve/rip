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
bun run dev       # Development with HTTPS + HTTP (auto-generates certificates)
bun run dev:http  # Development HTTP-only mode
bun run start     # Production HTTPS + HTTP
```

### `api/` - Advanced API Example
- Full REST API with CRUD operations
- JSON middleware
- In-memory data store
- Worker stats

**Usage:**
```bash
cd api
bun run dev       # Development with HTTPS + HTTP (auto-generates certificates)
curl -k https://localhost:3443/users  # Test HTTPS (default)
curl http://localhost:3000/users      # Test HTTP (fallback)
```

## 🔒 HTTPS by Default

All examples now start with HTTPS by default:
- **🚀 Auto-generates SSL certificates** on first run
- **🔒 Primary endpoint: `https://localhost:3443`**
- **📡 Fallback endpoint: `http://localhost:3000`**
- **⚡ Zero configuration required**

Use `-k` flag with curl for self-signed certificates:
```bash
curl -k https://localhost:3443    # HTTPS (default)
curl http://localhost:3000        # HTTP (fallback)
```

## 🔥 Hot Reload Testing

1. Start any example: `bun run dev`
2. Edit the `.rip` file (change a message)
3. Save the file
4. Watch the workers gracefully restart!
5. Test: `curl -k https://localhost:3443` (HTTPS) or `curl http://localhost:3000` (HTTP)

## 📊 Monitoring

Each example includes monitoring endpoints on both protocols:

**HTTPS (default):**
- `GET https://localhost:3443/health` - Server health and stats
- `GET https://localhost:3443/metrics` - Prometheus-style metrics

**HTTP (fallback):**
- `GET http://localhost:3000/health` - Server health and stats
- `GET http://localhost:3000/metrics` - Prometheus-style metrics

## 🧪 Load Testing

```bash
# HTTPS load testing (default)
wrk -t4 -c10 -d30s https://localhost:3443
wrk -t12 -c100 -d60s https://localhost:3443

# HTTP load testing (fallback)
wrk -t4 -c10 -d30s http://localhost:3000
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