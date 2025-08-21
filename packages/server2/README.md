# Rip Server2 - High-Performance Load Balancer

A clean-room implementation of a high-performance HTTP load balancer with advanced worker management, built specifically for Rip applications.

## 🚀 Key Features

- **LIFO Worker Selection**: Prioritizes recently-used workers for optimal cache locality
- **Event-Driven Queue Management**: Reactive processing without polling overhead
- **Smart Worker Cycling**: Prevents memory bloat with configurable reload limits
- **Single-Inflight Isolation**: One request per worker for clean resource management
- **Hot Reload Support**: Three modes (none/process/module) with seamless transitions
- **Unix Socket Communication**: High-performance inter-process communication
- **Clean Control Interface**: Simple join/quit operations for worker registration

## 📊 Performance

- **Target**: 20K+ RPS for application endpoints
- **Direct LB**: 30K+ RPS for `/server` health checks
- **Queue**: 8192 capacity with 2s timeout
- **Timeouts**: 200ms connect, 5s read
- **Worker Cycling**: Configurable via `--max-reloads` (default: 10)

## 🏗️ Architecture

### Components

1. **Manager** (`manager.ts`): Process supervisor that spawns and monitors workers
2. **Load Balancer** (`server.ts`): HTTP server with LIFO worker selection and queue management
3. **Worker** (`worker.ts`): Single-inflight request handlers with hot reload support
4. **CLI** (`rip-server.ts`): Command-line interface and configuration parsing
5. **Utils** (`utils.ts`): Shared utilities and flag parsing

### Process Flow

```
HTTP Request → Load Balancer → LIFO Worker Selection → Unix Socket → Worker Process
                     ↓
              Queue (if busy) → Event-driven draining → Worker becomes available
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
  --max-queue=16384 \
  --hot-reload=module \
  --json-logging
```

### CLI Flags

- `w:<N|auto>` - Number of workers (default: CPU count)
- `r:<N>` - Max requests per worker before cycling (default: 10000)
- `--max-reloads=<N>` - Max hot reloads per worker before cycling (default: 10)
- `--hot-reload=<mode>` - Hot reload mode: none/process/module (default: module in dev)
- `--max-queue=<N>` - Queue capacity (default: 8192)
- `--queue-timeout-ms=<N>` - Queue timeout (default: 2000)
- `--connect-timeout-ms=<N>` - Connect timeout (default: 200)
- `--read-timeout-ms=<N>` - Read timeout (default: 5000)
- `--json-logging` - Enable JSON access logs
- `--no-access-log` - Disable access logging

### Environment Variables

- `RIP_HOT_RELOAD` - Hot reload mode
- `RIP_MAX_RELOADS` - Max reloads per worker
- `RIP_MAX_QUEUE` - Queue capacity
- `RIP_QUEUE_TIMEOUT_MS` - Queue timeout
- `RIP_CONNECT_TIMEOUT_MS` - Connect timeout
- `RIP_READ_TIMEOUT_MS` - Read timeout

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

### Load Balancer Health Check
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

### LIFO Worker Selection
- Maintains a stack of available workers
- `pop()` for selection (most recently used)
- `push()` for release (back to top of stack)
- O(1) operations with optimal cache locality

### Event-Driven Queue Draining
- No polling loops or timers
- Uses `setImmediate()` for reactive processing
- Triggered when workers become available
- Prevents CPU waste and improves responsiveness

### Worker Lifecycle Management
- Self-registration via control socket
- Graceful shutdown with inflight request completion
- Automatic cycling based on request count or reload count
- Exponential backoff for restart attempts

### Error Handling
- 503: Server busy (queue full) or worker busy
- 504: Queue timeout or upstream read timeout
- Automatic worker removal on connection failures
- Retry logic with single-attempt limit

## 📁 File Structure

```
packages/server2/
├── rip-server.ts    # CLI entry point
├── server.ts        # Load balancer implementation
├── manager.ts       # Process supervisor
├── worker.ts        # Worker process implementation
├── utils.ts         # Shared utilities
└── README.md        # This file
```

## 🎯 Design Principles

1. **Performance First**: LIFO selection and event-driven processing for maximum throughput
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
