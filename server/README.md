# 🚀 RIP Application Server

**The Revolutionary Bun-Powered Application Server Framework**

A production-ready replacement for nginx + unicorn + ruby that combines:
- 🔥 **Hot Reload Development** - Instant .rip file changes
- ⚡ **Multi-Process Production** - Unicorn-style architecture
- 🛡️ **Fault Tolerance** - Auto-restart and failover
- 🌍 **Universal Deployment** - Same code dev → production
- 📊 **Load Balancing** - Round-robin with Unix sockets

## 🏗️ Revolutionary Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     server      │───▶│     manager     │───▶│     worker      │
│                 │    │                 │    │                 │
│ HTTP Load Bal.  │    │ Process Mgr +   │    │ Rip Handler +   │
│ Port :3000      │    │ File Watcher +  │    │ Unix Socket     │
│ Round-robin     │    │ Hot Reload      │    │ Auto-restart    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 🔥 What Makes This Revolutionary:

1. **🔧 Development**: File watching in manager → graceful worker restarts
2. **🚀 Production**: Same architecture, file watching dormant
3. **⚡ Emergency**: Production hot-fixes via file watching
4. **🛡️ Fault Tolerance**: Individual worker failures don't affect system
5. **📊 Scalability**: Add workers = add capacity
6. **🌍 Universal**: One system for all environments

## 🚀 Quick Start

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start

# Custom configuration
bun run server    # Just HTTP server
bun run manager   # Just process manager
bun run worker    # Just worker process
```

## ✨ Features

- **🔥 Hot Reload** - .rip file changes trigger graceful worker restarts
- **🔄 Load Balancing** - Round-robin across multiple worker processes
- **⚡ Auto Failover** - Dead workers replaced instantly
- **🛡️ Graceful Shutdown** - Workers finish requests before restarting
- **📊 Zero Downtime** - Manager respawns workers seamlessly
- **🔌 Unix Sockets** - High-performance inter-process communication
- **🎯 Rip Language** - Full .rip transpilation support
- **🌍 Universal** - Same code in development and production

## 🎯 Production Deployment

This replaces entire web server stacks:

**Before:**
```
nginx → unicorn → ruby app
```

**After:**
```
rip-server (server → manager → workers)
```

Benefits:
- ✅ **Simpler**: One system instead of three
- ✅ **Faster**: Bun performance + Unix sockets
- ✅ **Safer**: Built-in fault tolerance
- ✅ **Modern**: Hot reload in production (when needed)

---

**Modern application server architecture for the Bun era** 🔥⚡🚀

---

## 📚 Documentation

- **[Architecture Deep Dive](architecture.md)** - Detailed technical overview and design philosophy