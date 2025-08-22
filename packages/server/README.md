# Rip Server - Per-Worker Socket Application Server

High-performance HTTP entry that dispatches to per-worker Unix sockets. The server selects idle workers (LIFO), preserving single-inflight isolation without relying on kernel accept distribution.

## 🚀 Key Features

- **Per-Worker Unix Sockets**: One socket per worker; the server selects idle workers
- **Single-Inflight Isolation**: One request per worker for clean resource management
- **Hot Reload Support**: none, process (rolling restart on entry mtime), module (in-worker)
- **Unix Socket Communication**: High-performance inter-process communication

## 📊 Performance

- **Direct server**: `/server` shows raw entry overhead
- **Application Endpoints**: `/ping` throughput scales with number of workers

## 🏗️ Architecture

### Components

1. **Manager** (`manager.ts`): Process supervisor that spawns and monitors workers
2. **Server** (`server.ts`): HTTP entry + per-worker selector (control socket)
3. **Worker** (`worker.ts`): Single-inflight request handlers with hot reload support (join/quit)
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
  --max-reloads=20 \
  --hot-reload=module \
  --json-logging
```

### CLI Examples

- Basic dev (defaults)
  - `bun server apps/labs/api`

- Set HTTPS port (bare int)
  - `bun server 5700 apps/labs/api`

- Set HTTPS port (value form)
  - `bun server https:5700 apps/labs/api`

- Set HTTPS port (flag form)
  - `bun server --https-port=5700 apps/labs/api`

- Provide cert/key (value forms)
  - `bun server cert:./certs/app.pem key:./certs/app.key apps/labs/api`

- Provide cert/key (flags)
  - `bun server --cert=./certs/app.pem --key=./certs/app.key apps/labs/api`

- Tuning workers/limits/logging
  - `bun server apps/labs/api w:auto r:20000 --json-logging --queue-timeout-ms=2000 --max-queue=8192`

- Override hot reload mode
  - `bun server apps/labs/api --hot-reload=module`

- Explicit redirect toggle
  - `bun server apps/labs/api --no-redirect-http`

- Host registry (subcommands)
  - `bun server add labs.ripdev.io apps/labs/api`
  - `bun server remove labs.ripdev.io`
  - `bun server list`

- Stop running server
  - `bun server stop`

### CLI Flags

- `w:<N|auto>` - Number of workers (default: CPU count)
- `r:<N>` - Max requests per worker before cycling (default: 10000)
- `--max-reloads=<N>` - Max hot reloads per worker before cycling (default: 10)
- `--hot-reload=<mode>` - Hot reload: `none` | `process` | `module`
- `--max-queue=<N>` - Max server queue depth (default via env RIP_MAX_QUEUE)
- `--queue-timeout-ms=<N>` - Max time queued before 504
- `--connect-timeout-ms=<N>` - Upstream connect timeout
- `--read-timeout-ms=<N>` - Upstream read timeout
- `--json-logging` - Enable JSON access logs
- `--no-access-log` - Disable access logging
 - `http:<port>` - HTTP port (default from PORT env or 5002)

### Environment Variables

- `RIP_HOT_RELOAD` - Hot reload mode
- `RIP_MAX_RELOADS` - Max reloads per worker
 - `PORT` - Default HTTP port (overridden by `http:<port>`)

## 🔄 Hot Reload Modes

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

### Hot Reload Roadmap
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
├── manager.ts       # Process supervisor + process hot reload
├── worker.ts        # Worker process (join/quit)
├── utils.ts         # Shared utilities
└── README.md        # This file
```

---

Built with ❤️ for high-performance Rip applications.
