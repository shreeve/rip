# 🚀 RIP Server

**Lightning-fast, fault-tolerant HTTP server built with Bun**

A production-ready web server architecture featuring automatic load balancing, graceful worker restarts, and zero-downtime deployments.

## 🏗️ Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   server    │───▶│   manager   │───▶│   worker    │
│             │    │             │    │             │
│ HTTP Server │    │ Process Mgr │    │ Req Handler │
│ Port :3000  │    │ Spawns/Mgmt │    │ Unix Socket │
└─────────────┘    └─────────────┘    └─────────────┘
```

### Components

- **`server.ts`** - HTTP server that routes requests to workers via Unix sockets
- **`manager.ts`** - Process manager that spawns and monitors worker processes
- **`worker.ts`** - Worker processes that handle individual HTTP requests

## 🚀 Quick Start

```bash
# Start the manager (spawns workers automatically)
bun manager.ts &

# Start the HTTP server
bun server.ts &

# Test the server
curl http://localhost:3000
```

## ✨ Features

- **🔄 Round-robin load balancing** - Evenly distributes requests across workers
- **⚡ Automatic failover** - Seamlessly handles worker restarts
- **🛡️ Graceful shutdowns** - Workers finish current requests before restarting
- **📊 Zero-downtime restarts** - Manager respawns workers instantly
- **🔌 Unix socket communication** - High-performance inter-process communication
- **🎯 Configurable limits** - Set max requests per worker for memory management

## 🧪 Stress Testing

```bash
# Install wrk for load testing
brew install wrk

# Light load test
wrk -t4 -c10 -d30s http://localhost:3000

# Heavy load test
wrk -t12 -c100 -d60s http://localhost:3000
```

## ⚙️ Configuration

Edit the constants in each file:

```typescript
// manager.ts
const numWorkers = 3;                // Number of worker processes
const maxRequestsPerWorker = 5;      // Requests before worker restart

// server.ts
const port = 3000;                   // HTTP server port
```

## 🎯 Production Deployment

1. **Increase worker limits**: Set `maxRequestsPerWorker` to 1000+ for production
2. **Scale workers**: Adjust `numWorkers` based on CPU cores
3. **Add monitoring**: Integrate with your logging/metrics system
4. **Reverse proxy**: Put behind nginx/caddy for SSL termination

## 🔬 Development

The server handles worker restarts gracefully - you'll see workers cycling every 5 requests during development. This is intentional for testing the fault-tolerance system.

## 📈 Performance

- **High throughput** - Unix sockets provide minimal overhead
- **Low latency** - Direct memory communication between processes
- **Fault tolerant** - Individual worker failures don't affect the server
- **Memory efficient** - Workers restart to prevent memory leaks

---

**Part of the RIP ecosystem** - Building the future of web development! 🔥