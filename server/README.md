# 🚀 RIP Application Server

**Bun-Powered Application Server Framework**

A production-ready replacement for nginx + unicorn + ruby that combines:
- 🔥 **Hot Reload Development** - Instant .rip file changes
- ⚡ **Multi-Process Production** - Unicorn-style architecture
- 🛡️ **Fault Tolerance** - Auto-restart and failover
- 🌍 **Universal Deployment** - Same code dev → production
- 📊 **Load Balancing** - Round-robin with Unix sockets

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     server      │───▶│     manager     │───▶│     worker      │
│                 │    │                 │    │                 │
│ HTTP Server +   │    │ Process Mgr +   │    │ Sequential      │
│ Port :3000      │    │ File Watcher +  │    │ Request Handler │
│ Load Balancer   │    │ Hot Reload      │    │ Perfect         │
│                 │    │                 │    │ Isolation       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 🔥 Key Features:

1. **🔧 Development**: File watching in manager → graceful worker restarts
2. **🚀 Production**: Same architecture, file watching dormant
3. **⚡ Emergency**: Production hot-fixes via file watching
4. **🎯 Perfect Isolation**: Sequential processing per worker - no shared state
5. **🛡️ Fault Tolerance**: Individual worker failures don't affect system
6. **📊 Scalability**: Add workers = add capacity
7. **🌍 Universal**: One system for all environments

## 🚀 Quick Start

```bash
# 🔒 HTTPS by Default (Recommended)
bun run dev       # Development HTTPS + HTTP (auto-generates certificates)
bun run start     # Production HTTPS + HTTP

# 📡 HTTP Only (when you specifically need it)
bun run dev:http  # Development HTTP only
bun run start:http # Production HTTP only

# Foreground modes (see all logs)
bun run dev:fg    # Development foreground (HTTPS + HTTP)
bun run start:fg  # Production foreground (HTTPS + HTTP)

# Testing
bun run test      # Test HTTPS endpoint (default)
bun run test:http # Test HTTP endpoint
bun run health    # HTTPS health check (default)
bun run health:http # HTTP health check

# Custom configuration
bun run server    # Just HTTP server
bun run manager   # Just process manager
bun run worker    # Just worker process
```

## 🔒 HTTPS by Default

**HTTPS is now the default!** 🚀 Certificates are auto-generated on first run.

```bash
# Just run normally - HTTPS works automatically!
bun run dev             # HTTPS + HTTP (certificates auto-generated)
bun run start           # Production HTTPS + HTTP

# Both servers start automatically:
# 🔒 HTTPS: https://localhost:3443  (primary, secure)
# 📡 HTTP:  http://localhost:3000   (fallback, compatibility)

# Manual certificate generation (optional)
./generate-ssl.sh       # If you want to pre-generate

# HTTP-only mode (when you specifically need it)
bun run dev:http        # Developers who need HTTP-only
bun run start:http      # Legacy systems requiring HTTP
```

**Why HTTPS by Default?**
- 🔒 **Security-first** development
- 🌍 **Modern web standards** (HTTPS everywhere)
- 🎯 **Production parity** (matches real deployment)
- ⚡ **Zero configuration** (auto-generates certificates)

### **🏭 Using Production SSL Certificates**

Drop in your existing SSL certificates from trusted CAs:

```bash
# Let's Encrypt certificates
./start.sh prod false /app 3443 /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Custom SSL certificates
./start.sh prod false /app 3443 /path/to/your/cert.pem /path/to/your/key.pem

# Update package.json for easy deployment
"start:prod": "cd /Users/shreeve/Data/Code/rip/server && ./start.sh prod false /app 3443 /etc/ssl/certs/yourdomain.pem /etc/ssl/private/yourdomain.key"
```

**📖 See [production-ssl.md](production-ssl.md) for complete production SSL setup guide**

## ✨ Features

- **🔥 Hot Reload** - .rip file changes trigger graceful worker restarts
- **🎯 Sequential Processing** - One request per worker for perfect isolation
- **🔒 HTTPS Support** - Native TLS/SSL with automatic HTTP + HTTPS servers
- **🔄 Load Balancing** - Round-robin across multiple worker processes
- **⚡ Auto Failover** - Dead workers replaced instantly
- **🛡️ Graceful Shutdown** - Workers finish requests before restarting
- **📊 Zero Downtime** - Manager respawns workers seamlessly
- **🔌 Unix Sockets** - High-performance inter-process communication
- **🎯 Rip Language** - Full .rip transpilation support
- **🌍 Universal** - Same code in development and production
- **🛡️ Perfect Isolation** - No shared state between requests within workers

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

**Modern application server architecture built with Bun** 🚀

---

## 📚 Documentation

- **[Architecture Deep Dive](architecture.md)** - Detailed technical overview and design philosophy