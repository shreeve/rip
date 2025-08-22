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
  - Force HTTP-only (no TLS, no redirect): `bun server http apps/labs/api`
  - Force HTTP-only on specific port: `bun server http:5002 apps/labs/api`
  - Provide cert/key: `bun server --cert=/full/path/app.pem --key=/full/path/app.key apps/labs/api`
  - Auto TLS (mkcert → self-signed): `bun server --auto-tls apps/labs/api`

- Tuning workers/limits/logging
  - `bun server apps/labs/api w:auto r:20000,900s,10r --json-logging --queue-timeout-ms=2000 --max-queue=8192`

- Override reload mode
  - `bun server apps/labs/api --reload=module`

- Explicit redirect toggle
  - `bun server apps/labs/api --no-redirect-http`

- Host registry (subcommands)
  - `bun server add labs.ripdev.io apps/labs/api`
  - `bun server remove labs.ripdev.io`
  - `bun server list`

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

---

Built with ❤️ for high-performance Rip applications.
