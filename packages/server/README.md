# Rip Server - Per-Worker Socket Application Server

High-performance HTTP entry that dispatches to per-worker Unix sockets. The server selects idle workers (LIFO), preserving single-inflight isolation without relying on kernel accept distribution.

## 🚀 Key Features

- **Per-Worker Unix Sockets**: One socket per worker; the server selects idle workers
- **Single-Inflight Isolation**: One request per worker for clean resource management
- **Reload Support**: none, process (rolling restart on entry mtime), module (in-worker)
- **Unix Socket Communication**: High-performance inter-process communication

## 📊 Performance

- **Direct server**: `/server` shows raw entry overhead
- **Application Endpoints**: `/ping` throughput scales with number of workers

## 🏗️ Architecture

### Components

1. **Manager** (`manager.ts`): Process supervisor that spawns and monitors workers
2. **Server** (`server.ts`): HTTP entry + per-worker selector (control socket)
3. **Worker** (`worker.ts`): Single-inflight request handlers with reload support (join/quit)
4. **CLI** (`rip-server.ts`): Command-line interface and configuration parsing
5. **Utils** (`utils.ts`): Shared utilities and flag parsing

### Process Flow

```
HTTP Request → HTTP entry (server) → Select idle worker → Unix socket (worker.N.sock) → Worker process
```

## 🏷️ The @ Alias System

### Universal Alias Operator

The `@` symbol is the universal operator for all alias operations in rip-server, creating a clean separation between command syntax and user-defined names.

#### **Declaring Aliases (path@aliases)**
```bash
# Default: app name becomes the alias
bun server apps/labs/api              # → api.local

# Explicit: @ defines exact aliases (replaces default)
bun server apps/labs/api@labs         # → ONLY labs.local (no api.local)
bun server apps/labs/api@labs,test    # → labs.local + test.local
bun server apps/labs/api@api,labs     # → api.local + labs.local (must include 'api' explicitly)
```

#### **Why @ is Brilliant POLS**

The `@` symbol creates perfect clarity - you ALWAYS know what's what:

```bash
# Without @: These are commands/paths/modes
bun server stop                    # 'stop' is a command
bun server list                    # 'list' is a command
bun server apps/labs/api           # path to app
bun server http apps/labs/api      # 'http' is a mode

# With @: These are ALWAYS aliases
bun server apps/labs/api@demo      # @ = declaring alias
```

#### **No Ambiguity, No Collisions**

This design eliminates entire classes of problems:
- **No naming conflicts**: You can have an alias called "stop" or "list" - `@stop` is clearly different from the command `stop`
- **Visual clarity**: The @ makes aliases jump out in commands
- **Future-proof**: New CLI features won't break existing aliases
- **Consistent mental model**: See @? It's about aliases. No @? It's a command or path.

#### **The Symmetry**

```bash
# @ after path = ASSIGN aliases to app
apps/labs/api@labs,test,demo

# Future: @ after command = USE alias to identify app (multi-app support)
# remove@demo   # Remove app that has 'demo' alias
# stop@demo     # Stop app that has 'demo' alias
# status@labs   # Get status of app with 'labs' alias
```

#### **Real-World Usage**

```bash
# Multiple API servers without collision
bun server apps/labs/api@labs         # Terminal 1: labs.local
bun server apps/homework/api@homework # Terminal 2: homework.local
bun server apps/work/api@work         # Terminal 3: work.local

# All three can run simultaneously, each with their own 'api' codebase
# but exposed on different .local domains for testing
```

This alias system enables clean, collision-free multi-app development with the clearest possible syntax.

## 🔧 Usage

### Basic Usage
```bash
bun server <app-path> w:4 http:5002
```

### Advanced Configuration
```bash
bun server apps/my-app \
  w:8 \
  r:20000,1800s,20r \
  --reload=module \
  --json-logging
```

### CLI Examples

- Basic dev (defaults)
  - `bun server apps/labs/api`

- HTTPS defaults and options
  - HTTPS default (try 443, else auto-port 5000+; 80→301): `bun server apps/labs/api`
  - HTTPS on a specific port (bare int): `bun server 5700 apps/labs/api`
  - Force HTTP-only (no TLS, no redirect): `bun server http apps/labs/api` (tries 80, else 5000+)
  - Force HTTP-only on specific port: `bun server http:5002 apps/labs/api`
  - Provide cert/key: `bun server --cert=/full/path/app.pem --key=/full/path/app.key apps/labs/api`
  - Auto TLS (mkcert → self-signed): `bun server --auto-tls apps/labs/api`

- Tuning workers/limits/logging
  - `bun server apps/labs/api w:auto r:20000,900s,10r --json-logging --queue-timeout-ms=2000 --max-queue=8192`

- Override reload mode
  - `bun server apps/labs/api --reload=module`

- Explicit redirect toggle
  - `bun server apps/labs/api --no-redirect-http`

- Host aliases (@ syntax)
  - `bun server apps/labs/api` - default: api.local
  - `bun server apps/labs/api@labs` - explicit: labs.local only
  - `bun server apps/labs/api@labs,test,demo` - multiple aliases
  - `bun server list` - show registered hosts

- Stop running server
  - `bun server stop`

### CLI Flags

- `w:<N|auto>` - Number of workers (default: half cores)
- `r:<N>[,<seconds>s][,<reloads>r]` - Restart policy (requests, seconds, reloads)
- `--reload=<mode>` - Reload: `none` | `process` | `module`
- `--max-queue=<N>` - Max server queue depth (default via env RIP_MAX_QUEUE)
- `--queue-timeout-ms=<N>` - Max time queued before 504
- `--connect-timeout-ms=<N>` - Upstream connect timeout
- `--read-timeout-ms=<N>` - Upstream read timeout
- `--json-logging` - Enable JSON access logs
- `--no-access-log` - Disable access logging
 - `http[:<port>]` - HTTP-only listener (else HTTPS-first)
 - `--https-port=<port>` or bare `<port>` - HTTPS port select
 - `--cert=<path>` `--key=<path>` - TLS material (PEM)
 - `--auto-tls` - try mkcert, else self-signed, cache under `~/.rip/certs`
 - `--hsts` - add Strict-Transport-Security when HTTPS active

### Environment Variables

- `RIP_RELOAD` - Reload mode
- `RIP_MAX_RELOADS` - Max reloads per worker
 - `PORT` - Default HTTP port (overridden by `http:<port>`)

## 🔄 Reload Modes

### Module Mode (Development)
- Worker-level mtime checking (100ms intervals)
- Handler caching for performance
- Automatic worker cycling after `maxReloads`

### Process Mode (Rolling Restarts)
- Manager polls entry mtime (debounced to ~100ms) and triggers `rollingRestart()` when changed
- Graceful worker draining; no inflight requests are dropped

### None Mode
- No automatic reloads
- Maximum performance

## 🏥 Health & Monitoring

### Status Endpoint
```bash
curl http://localhost:5002/status
```

### Entry Health Check
```bash
curl http://localhost:5002/server
# Response: "ok"
```

## 🔍 Implementation Details

### Server selection
- LIFO worker selection for warm cache reuse
- Internal busy signaling via `Rip-Worker-Busy` header
- Control socket for workers to join/quit

### Reload Roadmap
- Current: process-mode uses a simple entry mtime poll (debounced ~100ms) to trigger rolling restarts; module-mode is dev-only and serves the last good handler during reload.
- Planned: move change detection into the Manager with a single recursive watcher per app (ignore temp files, debounce/coalesce 150–300ms) to eliminate per-worker watchers entirely. Manager will trigger one rollingRestart per change batch for clean, deterministic reloads under load.

### Worker Lifecycle Management
- Graceful shutdown with inflight request completion
- Automatic cycling based on request count or reload count
- Exponential backoff for restart attempts

### Timeouts
- Connect timeout and read timeout applied to upstream fetches

## 📁 File Structure

```
packages/server/
├── rip-server.ts    # CLI entry point
├── server.ts        # HTTP entry + per-worker selector
├── manager.ts       # Process supervisor + process reload
├── worker.ts        # Worker process (join/quit)
├── utils.ts         # Shared utilities
└── README.md        # This file
```

## 🔬 Request Path Tracing (/server vs app routes)

### Direct entry: GET /server (fast path)

1. `Server.fetch(req)`
2. Path check `if (url.pathname === '/server')`
3. Return `new Response('ok', text/plain)`

- No worker dispatch
- No Unix socket IPC
- No framework/ALS
- Minimal logging (only if enabled at entry)

Why `/server` ≫ app routes: it bypasses Unix socket forwarding, framework routing, ALS setup, and reload checks—returning immediately from the entry process.

### Application route: e.g., GET /ping

1. `Server.fetch(req)`
2. Select idle worker (`getNextAvailableSocket`), increment `inflightTotal`
3. `forwardToWorker(req, socket)` → `forwardOnce()` → `fetch(..., unix: socketPath)`
4. Worker `Bun.serve({ unix }).fetch(req)`
5. `getHandler()` (uses cached handler; in module reload mode may do a rate‑limited fs.stat)
6. `@rip/api` pipeline:
   - `withHelpers` middleware parses body only for POST/PUT/PATCH (JSON or form)
   - Merge query params
   - Wrap handler in `AsyncLocalStorage` via `requestContext.run({ hono, data })`
   - Route handler (e.g., `get '/ping'`) via `smart()` returns Response
7. Worker returns Response to server
8. Server strips internal headers, optional access logging
9. Release worker, decrement `inflightTotal`, `drainQueue()`

### Process reload trace (reload=process)

- Change detection (Manager)
  - Poll entry mtime (debounced ~100ms, 50ms timer, 200ms cooldown)
  - On change, trigger `rollingRestart()`

- Rolling restart (per worker)
  1. Send SIGTERM to current worker
  2. Worker waits for `inflight=false`, stops its Bun.serve, POSTs `quit` to control socket, exits
  3. Manager immediately `spawnWorker()` with fresh env and per‑worker socket
  4. New worker starts, preloads handler, POSTs `join`

- Server during roll
  - Continues serving with N−1 workers briefly
  - Control socket updates `sockets`/`availableWorkers` on quit/join
  - If a socket dies mid‑forward, server removes it and either retries/queues or 503s if capacity exhausted

- What process mode avoids
  - No per‑request fs checks in workers (module reload logic skipped)
  - Centralized change detection → deterministic, low‑overhead reloads under load

## 🍎 Platform Notes

### macOS Privileged Port Binding (Mojave 10.14+)

Starting with macOS Mojave (10.14, 2018), Apple relaxed the traditional Unix restriction that required root privileges to bind to ports below 1024. This change allows developers to run web servers on standard ports (80, 443) without `sudo`, but with specific conditions:

**✅ Works without root:**
- Binding to `0.0.0.0` (all interfaces) - e.g., `bun server http apps/api` successfully binds to port 80
- Omitting hostname (defaults to all interfaces in most tools including Bun)
- Empty string `''` hostname (treated as `0.0.0.0`)

**❌ Still requires root:**
- Binding to `127.0.0.1` (localhost specifically)
- Binding to any specific IP address (e.g., `10.0.0.155`)
- Binding to `::1` (IPv6 localhost)

**Practical impact for rip-server:**
```bash
# These work on macOS without sudo:
bun server http apps/api           # Binds to 0.0.0.0:80
bun server apps/api                 # Binds to 0.0.0.0:443 (HTTPS)

# These would fail without sudo (if explicitly configured):
# Binding specifically to 127.0.0.1:80 or 127.0.0.1:443
```

**⚠️ Security Warning:** When binding to ports 80/443 without root on macOS, your service is **exposed to your entire local network** (LAN). This means any device on your WiFi/network can access your development server. This is particularly risky on:
- Shared networks (coffee shops, co-working spaces)
- Corporate networks
- Home networks with untrusted devices

**When to use each approach:**

| Use Case | Best Approach | Why |
|----------|--------------|-----|
| 📱 **Mobile testing** | `0.0.0.0` on port 80/443 | iPhone can access via `hostname.local` |
| 🎯 **Team demos** | `0.0.0.0` on any port | Share with colleagues on same network |
| 💻 **Solo development** | Port 5000+ | Secure by default, still convenient |
| ☕ **Coffee shop coding** | `sudo` + `127.0.0.1` | Maximum security on untrusted networks |

**Quick reference - Your three options:**
1. **Convenience path** (`0.0.0.0`) - No sudo but LAN-exposed 🌐
2. **Secure path** (`127.0.0.1`) - Needs sudo but localhost-only 🔒
3. **Best of both** (ports 5000+) - No sudo AND can be localhost-only ✨

**Safer alternatives:**
- Use high ports (5000+): `bun server http:5001 apps/api` - can bind to localhost only
- Use sudo if you need port 80/443 with localhost-only access
- Enable macOS firewall or configure `pf` rules to block external access
- Only use low ports on trusted, isolated networks

This behavior is consistent across all applications on macOS (not Bun-specific) and represents Apple's trade-off between developer convenience and security.

## 📱 Mobile Development Game-Changer

### Automatic mDNS Advertisement for `.local` Domains

When you declare `.local` aliases with the `@` syntax, rip-server **automatically** advertises them via Bonjour/mDNS, making them instantly accessible from any device on your LAN - especially iPhones and iPads!

**The Magic:**
```bash
# Start your server with custom aliases
bun server http apps/labs/api@api,cheese,demo

# Your iPhone can now access:
# http://api.local
# http://cheese.local
# http://demo.local
```

**No more:**
- ❌ "What's your IP address?"
- ❌ "What port are you running on?"
- ❌ Typing `192.168.x.x:8080` on phone keyboards
- ❌ IP addresses changing with DHCP

**Instead:**
- ✅ Clean, memorable URLs
- ✅ Works instantly on all Apple devices
- ✅ Zero configuration on the phone
- ✅ Multiple apps with different domains

### How It Works

1. When you start with aliases (`apps/labs/api@api,cheese`), the server:
   - Adds them to the host registry for routing
   - Spawns `dns-sd` processes to advertise via mDNS
   - Automatically detects your LAN IP

2. Your iPhone/iPad discovers these domains via Bonjour (built into iOS)

3. Clean URLs work immediately - no ports, no IPs!

### Real-World Usage

**Testing responsive design:**
```bash
bun server apps/labs/api@mobile
# Visit http://mobile.local on your phone - instant feedback!
```

**Client demos:**
```bash
bun server apps/labs/api@demo,staging
# "Check out demo.local on your phone" - professional and clean
```

**Team collaboration:**
```bash
bun server apps/labs/api@review,team,dev
# Everyone on WiFi can access any of these .local domains
```

This transforms rip-server from a great local dev server into a **mobile testing powerhouse**! 🚀

---

Built with ❤️ for high-performance Rip applications.
