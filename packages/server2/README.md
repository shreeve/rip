# Rip Server2 - Shared-Socket Application Server

High-performance HTTP entry that forwards to a single shared Unix socket per app. The kernel balances accepts across workers, each handling a single request at a time for clean isolation.

## 🚀 Key Features

- **Shared Unix Socket**: One socket per app; kernel balances connections to idle workers
- **Single-Inflight Isolation**: One request per worker for clean resource management
- **Hot Reload Support**: Three modes (none/process/module)
- **Unix Socket Communication**: High-performance inter-process communication

## 📊 Performance

- **Direct LB**: `/server` shows raw entry overhead
- **Application Endpoints**: `/ping` throughput scales with number of workers

## 🏗️ Architecture

### Components

1. **Manager** (`manager.ts`): Process supervisor that spawns and monitors workers
2. **Server** (`server.ts`): HTTP entry that forwards to the shared socket
3. **Worker** (`worker.ts`): Single-inflight request handlers with hot reload support
4. **CLI** (`rip-server.ts`): Command-line interface and configuration parsing
5. **Utils** (`utils.ts`): Shared utilities and flag parsing

### Process Flow

```
HTTP Request → HTTP Entry → Unix Socket (shared) → Kernel accept → Worker Process
```

## 🔧 Usage

### Basic Usage
```bash
bun server2 <app-path> w:4 http:5002
```

### Advanced Configuration
```bash
bun server2 apps/my-app \
  w:8 \
  --max-reloads=20 \
  --hot-reload=module \
  --json-logging
```

### CLI Flags

- `w:<N|auto>` - Number of workers (default: CPU count)
- `r:<N>` - Max requests per worker before cycling (default: 10000)
- `--max-reloads=<N>` - Max hot reloads per worker before cycling (default: 10)
- `--hot-reload=<mode>` - Hot reload mode: none/process/module (default: module in dev)
- (No userland queue in shared-socket mode)
- `--json-logging` - Enable JSON access logs
- `--no-access-log` - Disable access logging

### Environment Variables

- `RIP_HOT_RELOAD` - Hot reload mode
- `RIP_MAX_RELOADS` - Max reloads per worker

## 🔄 Hot Reload Modes

### Module Mode (Development)
- Rate-limited mtime checking (100ms intervals)
- Handler caching for performance
- Automatic worker cycling after `maxReloads`
- Best for single-worker development

### Process Mode (Production)
- Explicit admin-triggered rolling restarts
- Graceful worker draining
- Preferred for multi-worker production

### None Mode (Production)
- No automatic reloads
- Maximum performance
- Manual restart required for updates

## 🏥 Health & Monitoring

### Status Endpoint
```bash
curl http://localhost:5002/status
```

Response:
```json
{
  "status": "healthy",
  "app": "my-app",
  "workers": 4,
  "ports": { "http": 5002 },
  "uptime": 3600
}
```

### Entry Health Check
```bash
curl http://localhost:5002/server
# Response: "ok"
```

## 🧪 Testing & Benchmarking

### Basic Health Check
```bash
curl -sf http://localhost:5002/status
```

### Performance Testing
```bash
# Application endpoint
wrk -t8 -c512 -d15s --latency http://127.0.0.1:5002/ping

# Direct LB endpoint
wrk -t8 -c512 -d15s --latency http://127.0.0.1:5002/server
```

## 🔍 Implementation Details

### Shared-Socket Accept
- Kernel chooses an idle worker blocked in accept
- No userland queue/selection on hot path

### Worker Lifecycle Management
- Graceful shutdown with inflight request completion
- Automatic cycling based on request count or reload count
- Exponential backoff for restart attempts

### Error Handling
- 503: Worker busy (single-inflight guard) or entry error

## 📁 File Structure

```
packages/server2/
├── rip-server.ts    # CLI entry point
├── server.ts        # HTTP entry → shared socket forwarder
├── manager.ts       # Process supervisor
├── worker.ts        # Worker process implementation
├── utils.ts         # Shared utilities
└── README.md        # This file
```

## 🎯 Design Principles

1. **Performance First**: Minimal hot path, leverage kernel accept balancing
2. **Clean Architecture**: Clear separation of concerns between components
3. **Operational Simplicity**: Minimal configuration with sensible defaults
4. **Graceful Degradation**: Predictable behavior under load and failure conditions
5. **Developer Experience**: Hot reload and clear logging for development productivity

## 🔧 Development

### Building
No build step required - uses TypeScript directly with Bun.

### Testing
```bash
# Start test server
bun server2 examples/hello w:2 http:3000

# Run benchmarks
wrk -t4 -c256 -d10s http://localhost:3000/ping
```

### Debugging
- Use `--json-logging` for structured logs
- Check `/status` endpoint for worker health
- Monitor worker cycling in console output
- Use process monitoring tools for resource usage

---

Built with ❤️ for high-performance Rip applications.
