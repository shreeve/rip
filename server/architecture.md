# 🚀 Rip Application Server - Architecture & Design

**Modern Bun-Powered Application Server Framework**

This document explores the architecture and design philosophy behind the Rip Application Server - a unified solution that brings together the best aspects of modern application hosting.

## 🤯 What This Solves

The Rip Application Server addresses a common challenge: managing separate systems for development and production. Instead of juggling multiple tools:

- ❌ nginx (HTTP server/load balancer)
- ❌ unicorn (process manager)
- ❌ ruby application servers
- ❌ complex deployment pipelines
- ❌ separate development/production setups

We provide:
- ✅ **Single unified system** for all environments
- ✅ **Hot reload** in development (and emergency production fixes)
- ✅ **Multi-process architecture** for production scalability
- ✅ **Automatic failover** and fault tolerance
- ✅ **Unix socket performance**
- ✅ **Graceful shutdowns** and zero-downtime restarts
- ✅ **Native .rip language support**

## 🏗️ Architecture Overview

```
Internet → server.ts → manager.ts → worker.ts (×N)
           (Load Bal)   (Process Mgr)  (App Handlers)
```

This three-tier architecture provides clean separation of concerns:

### **🌐 server.ts** - HTTP Server and Load Balancer
- **Flexible protocol support** - HTTP, HTTPS, or both
- HTTP fallback on port 3000 for compatibility
- Round-robin distributes to workers via Unix sockets
- Intelligent 503 failover (busy worker → try next worker)
- Automatic failover when workers fail
- Health checks and metrics endpoints on both protocols

### **🧠 manager.ts** - Process Manager
- Spawns and monitors worker processes
- **File watching for hot reload** (.rip files)
- Graceful rolling restarts on file changes
- Process lifecycle management
- Fault recovery and auto-restart

### **🔥 worker.ts** - Application Handlers
- **Sequential processing** - one request per worker for perfect isolation
- Load and run .rip applications
- Handle HTTP requests via Unix sockets
- Return 503 when busy (triggers intelligent server failover)
- Graceful shutdown after request limits
- Full .rip language transpilation support

## 🌟 Key Design Decisions

### **🔥 Unified Hot Reload**
Rather than relying on built-in hot reload (which can be inconsistent with transpilers), we implemented file watching with graceful worker restarts:
- Edit any `.rip` file → automatic graceful worker restart
- **No dropped connections** (current requests finish)
- Rolling restarts (workers restart one-by-one)
- Works reliably with any transpilation setup

### **🚀 Same Architecture Everywhere**
The insight that drove this design: why have different systems for development and production?
- Same codebase in dev and production
- File watching simply stays dormant in production (zero overhead)
- **Emergency hot-fix capability** available when needed
- Scale by adding workers
- Built-in health monitoring

### **⚡ Performance Through Unix Sockets**
Inter-process communication via Unix sockets provides:
- **Minimal latency** (direct memory communication)
- **High throughput** (no network stack overhead)
- **Automatic load balancing** across workers
- **Memory leak prevention** (worker cycling)

### **🔒 Flexible HTTPS Support**
Modern web development with pragmatic security options:
- **HTTP by default** - simple and fast for development
- **Smart HTTPS modes** - quick, CA-based, or custom certificates
- **Protocol flexibility** - http, https, or http+https
- **Certificate Authority support** - one-time setup for trusted HTTPS
- **Production ready** - bring your own certificates
- **Zero-configuration option** - auto-generates certs when needed

### **🎯 Sequential Processing Pattern**
Each worker handles exactly one request at a time:
- **Perfect isolation** - zero shared state between requests
- **Predictable resource usage** - bounded memory and CPU per worker
- **Erlang/WhatsApp-style reliability** - battle-tested pattern
- **Easy debugging** - linear request flow, no async complexity
- **Intelligent 503 failover** - busy worker triggers next worker attempt

## 🎯 Usage Patterns

```bash
# 🔒 HTTPS by Default (Recommended)
bun run dev       # Development mode (defaults to HTTP)
bun run start     # Production: HTTPS + HTTP (same architecture)

# 📡 HTTP Only (when specifically needed)
bun run dev:http  # Development: HTTP only
bun run start:http # Production: HTTP only

# Foreground modes (see all logs)
bun run dev:fg    # Development with verbose logging
bun run start:fg  # Production with verbose logging

# Monitoring
bun run health    # HTTPS health check (default)
bun run health:http # HTTP health check
bun run test      # HTTPS endpoint test (default)
bun run test:http # HTTP endpoint test
```

## 📁 Project Structure

```
rip-server/
├── 🧠 manager.ts      # Process manager + hot reload
├── 🌐 server.ts       # HTTPS/HTTP load balancer (ports 3443/3000)
├── 🔥 worker.ts       # Sequential request handlers
├── 🚀 rip-server.ts   # Pure TypeScript CLI with flexible args
├── 📋 package.json    # Scripts & dependencies
├── ⚙️ bunfig.toml     # Rip transpiler config
├── 📖 README.md       # Usage documentation
├── 🏗️ architecture.md # This file - technical deep dive
├── 🔒 production-ssl.md # Production SSL certificate guide
└── 🌟 examples/       # Working examples
    ├── simple/        # Basic Rip app
    └── api/           # Advanced REST API
```

## 🧪 Getting Started

1. **Start the server (flexible arguments in ANY order):**
   ```bash
   # Simple start
   rip-server examples/simple

   # With options (any order!)
   rip-server w:5 8080 examples/simple
   rip-server examples/simple prod w:10 r:100
   rip-server 3443 examples/simple  # HTTPS with auto-cert
   ```

2. **Test hot reload:**
   - Edit `examples/simple/index.rip`
   - Save the file
   - Watch workers gracefully restart
   - Test: `curl http://localhost:3000` (or your custom port)

3. **Performance test:**
   ```bash
   bun run load-test
   ```

## 🌍 Real-World Context

This approach consolidates what many companies currently use as separate systems:
- **GitHub** (unicorn + nginx)
- **Shopify** (unicorn + nginx)
- **Basecamp** (unicorn + nginx)
- **Many Ruby/Rails shops** worldwide

**Benefits of the unified approach:**
- 🚀 **Better performance** (Bun runtime + Unix socket IPC)
- 🛡️ **Improved reliability** (built-in fault tolerance & auto-recovery)
- 🔧 **Simplified operations** (one system instead of multiple)
- 🔥 **Enhanced flexibility** (hot reload capability in production)
- ⚡ **Reduced complexity** (minimal configuration required)

## 🎉 Why This Design Works

The architecture addresses several common pain points:

1. **🔄 Dev/Prod Parity** - Same system everywhere eliminates environment differences
2. **🔥 Reliable Hot Reload** - Custom file watching works with any transpiler
3. **⚡ Modern Performance** - Bun runtime provides excellent performance characteristics
4. **🛡️ Built-in Resilience** - Multi-process design with automatic failover
5. **🌍 Practical Flexibility** - Works with any Rip application out of the box

## 🏆 Design Philosophy

The development approach focused on solving real problems:

1. **Problem:** Traditional hot reload doesn't work reliably with transpiled languages
2. **Solution:** Custom file watching with graceful worker management
3. **Problem:** Managing different systems for development vs production
4. **Insight:** Use the same architecture everywhere, with optional features
5. **Result:** A unified system that works across all environments
6. **Impact:** Simplified deployment and improved developer experience

## 🚀 What This Enables

The Rip Application Server provides a foundation for:
- **Production deployments** with enterprise-grade reliability
- **Rapid development** with instant feedback loops
- **Simplified operations** (one system to learn and maintain)
- **Scalable architecture** through worker processes
- **Modern development practices** with built-in tooling

## 📊 Performance Characteristics

- **Throughput**: High-performance Unix socket communication
- **Latency**: Direct memory communication between processes
- **Reliability**: Worker failures don't affect overall system availability
- **Scalability**: Horizontal scaling via additional worker processes
- **Memory Management**: Built-in leak prevention through worker cycling

## 🔧 Configuration Options

The server supports flexible configuration:
- Worker count (defaults: 3 dev, 8 prod)
- Request limits per worker
- Application directory paths
- Custom startup scripts
- Environment-specific settings

---

**A thoughtful approach to modern application server architecture, built with Bun and designed for real-world use.** 🚀⚡