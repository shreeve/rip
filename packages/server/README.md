<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Server - Production-Ready Application Framework

**Bun-Powered Multi-Process Server with Hot Reload**

**🔥 Ruby Analogy**: This layer is analogous to **nginx + unicorn in the Ruby ecosystem** - it's the production server infrastructure that handles HTTP requests, manages worker processes, provides load balancing, and ensures fault tolerance. Just as nginx + unicorn gives you production-grade Ruby deployment, `@rip/server` gives you production-grade Rip deployment.

## 🤔 Why Choose rip-server?

**For developers tired of complex deployment stacks** - rip-server replaces entire toolchains:

**❌ Traditional Stack:**
```
nginx + unicorn + ruby + systemd + complex configs
```

**✅ rip-server:**
```bash
rip-server apps/my-app        # That's it. Production ready.
```

**🔥 Key Benefits:**
- 🎯 **Point-and-run any app** - No configuration, just works
- ⚡ **Same system dev→prod** - No deployment surprises
- 🔄 **Smart restart behavior** - Always does what you expect
- 📊 **Built-in monitoring** - Status, health checks, process info
- 🔒 **Trivial HTTPS** - One command for trusted certificates
- 🛡️ **Production proven** - Multi-process, fault-tolerant architecture

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

## ⚡ Getting Started in 30 Seconds

```bash
# 1. Create a simple app
mkdir my-app && cd my-app
echo "export default { fetch: () => new Response('Hello World!') }" > index.ts

# 2. Run it
rip-server                      # Serves on http://localhost:3000

# 3. That's it! 🎉
```

## 🚀 Quick Start

```bash
# Install globally (recommended)
ln -sf $(pwd)/packages/server/rip-server.ts ~/bin/rip-server
chmod +x ~/bin/rip-server

# Flexible argument syntax - provide options in ANY order!
rip-server                          # HTTP only (default)
rip-server https                    # HTTPS with smart certificates
rip-server https:quick              # HTTPS with quick self-signed cert
rip-server https:ca                 # HTTPS with CA-signed cert
rip-server http+https               # Both HTTP and HTTPS
rip-server 8080                     # Custom HTTP port
rip-server https 8443               # Custom HTTPS port
rip-server prod                     # Production mode
rip-server ./api                    # Specific app directory
rip-server w:5 r:100                # 5 workers, 100 requests each
rip-server cert.pem key.pem         # HTTPS with your certificates

# Mix and match in any order!
rip-server prod https w:10          # Production HTTPS, 10 workers
rip-server ./api http+https         # Both protocols for API
rip-server https:ca 8443 w:5        # CA cert on port 8443

# Smart Lifecycle Commands
rip-server apps/my-app              # Start/restart server (smart default)
rip-server status                   # Show detailed server status
rip-server stop                     # Stop server (explicit)
rip-server help                     # Show help

# Certificate Authority commands
rip-server ca:init                  # Initialize CA (one-time setup)
rip-server ca:trust                 # Trust CA in system (macOS)
rip-server ca:export                # Export CA certificate
rip-server ca:info                  # Show CA information
rip-server ca:list                  # List generated certificates
rip-server ca:clean                 # Clean old certificates

# Configuration files (optional)
# package.json: { "rip-server": { "workers": 5, "requests": 100 } }
# bunfig.toml:  [rip-server]
#               workers = 5
#               requests = 100
```

## 📊 Request Logging

**Beautiful, comprehensive request logs** for development and debugging:

```
[2025-08-03 14:30:15.123-08:00] W1.5 GET / → 200 plain 26b 3ms
[2025-08-03 14:30:15.456-08:00] W2.3 GET /health → 200 plain 7b 1ms
[2025-08-03 14:30:15.789-08:00] W3.1 GET /info → 200 json 248b 12ms
```

**📊 What Each Field Shows:**
- `[2025-08-03 14:30:15.123-08:00]` - Full timestamp with timezone
- `W1.5` - Worker 1, Request #5 (human-friendly 1-indexed)
- `GET /health` - HTTP method + path
- `→ 200` - Response status code
- `plain` - Content type (shortened)
- `7b` - Response size in bytes
- `3ms` - Request duration

**Perfect for monitoring, debugging, and performance analysis!** 🎯

## 🎯 **Complete Server Management Demo**

**Step-by-step practical workflow** - everything you need to know:

### **📊 1. Check Status (Always Start Here)**
```bash
bun server status                    # Check if anything is running
# OR
rip-server status                    # Same thing, direct command
```

### **🚀 2. Start Server with App**
```bash
# From monorepo root (recommended)
bun server apps/labs/api             # Start labs API
bun server examples/blog             # Start blog example
bun server examples/legal            # Start legal example

# From monorepo root (recommended)
rip-server apps/labs/api             # Auto-finds index.rip
rip-server examples/blog             # Auto-finds index.rip
```

### **🔄 3. Restart Server (Smart Behavior)**
```bash
# If server is already running, this restarts it
bun server apps/labs/api             # Smart restart
rip-server apps/labs/api             # Same thing
```

### **📡 4. Test Your Running App**
```bash
curl http://localhost:3000/ping      # Test endpoint
curl http://localhost:3000/health    # Health check
curl http://localhost:3000/metrics   # Performance metrics
```

### **🔍 5. Monitor Server**
```bash
bun server status                    # Detailed status with PID, memory, runtime
# Shows:
# ✅ Status: Running
# 📋 Active Processes: PID, memory usage, runtime
# 🌐 Port Status: HTTP 200 checks
```

### **🛑 6. Stop Server**
```bash
bun server stop                     # Graceful shutdown
rip-server stop                     # Same thing, direct
```

### **⚡ 7. Advanced Options**
```bash
# Custom ports and workers
bun server apps/labs/api 8080       # Custom port
rip-server w:5 r:100                # 5 workers, 100 requests each
rip-server https                    # HTTPS with auto-cert
rip-server prod                     # Production mode
```

### **🎯 Typical Workflow:**
```bash
# 1. Check what's running
bun server status

# 2. Start your app
bun server apps/labs/api

# 3. Test it
curl http://localhost:3000/ping

# 4. Check status anytime
bun server status

# 5. Stop when done
bun server stop
```

**🔥 The beauty**: It's all **smart and predictable** - commands do exactly what you expect with **Principle of Least Surprise (POLS)**!

---

## 🎛️ Smart Lifecycle Management

**Following the Principle of Least Surprise** - commands do exactly what you expect:

### **🚀 Smart Default Behavior**
```bash
# Default: Start or restart (what you want 90% of the time)
rip-server                    # Start/restart with defaults
rip-server 8080               # Start/restart on port 8080
rip-server https w:5          # Start/restart with HTTPS and 5 workers

# If not running → Starts fresh
🚀 Starting rip-server...

# If already running → Restarts gracefully
🔄 rip-server is already running, restarting...
```

### **🔍 Explicit Status Command**
```bash
rip-server status
```
```
🔍 rip-server Status

✅ Status: RUNNING

📋 Active Processes:
   • PID: 12345 | Parent: 1234 | Runtime: 2:30:15 | Memory: 45MB
     Port: 3000 | Command: bun rip-server.ts
     🟢 Health check: HEALTHY (200)

🌐 Port Status:
   • Port 3000: 🟢 ACTIVE (HTTP 200)
   • Port 3443: 🟢 ACTIVE (HTTPS 200)
```

### **🛑 Explicit Stop Command**
```bash
rip-server stop

# If running → Stops gracefully
🛑 Stopping rip-server...

# If already stopped → Friendly message
✅ rip-server is already stopped
```

### **💡 Why This Design?**
- **Intuitive**: Default behavior is "make it work"
- **Explicit**: When you want status/stop, be explicit
- **Safe**: All commands are idempotent and automation-friendly
- **Predictable**: No surprises, follows Principle of Least Surprise

## 🎯 Server/App Separation Architecture

**Decoupled Design** - The server runtime is separated from your application code, enabling flexibility and developer productivity:

### 📱 Point-and-Run Any App
```bash
# One server, infinite apps
rip-server apps/blog 3000           # Blog on port 3000
rip-server apps/api 8080            # API on port 8080
rip-server apps/ecommerce 4000      # E-commerce on port 4000
rip-server ../other-project 5000    # Any Rip app anywhere
```

### 🔥 Live Development Experience
- **🎯 Zero Coupling**: Server runtime ↔ App logic completely independent
- **⚡ Instant Switching**: Point server at different apps without restart
- **🔄 Hot Reload**: Edit app files → automatic worker restart → zero downtime
- **📁 Clean Architecture**: Apps are self-contained directories
- **🧪 Easy Testing**: Point server at test apps for isolated testing

### 🌟 What This Enables
```bash
# Development workflow with smart defaults
rip-server apps/my-app              # Start/restart - always works
# Edit files in apps/my-app/ → changes appear instantly
# No build steps, no server restarts needed!

# Production deployment
rip-server prod apps/my-app         # Start/restart in production mode

# Safe automation (perfect for scripts)
rip-server stop                     # Always safe to stop
rip-server apps/api                 # Always safe to start/restart
rip-server apps/api                 # Run again? Restarts gracefully!

# Multi-app development
rip-server apps/frontend 3000       # Start/restart frontend
rip-server apps/api 8080            # Start/restart API
rip-server apps/admin 4000          # Start/restart admin
# All running simultaneously!

# Check what's running
rip-server status                   # Comprehensive status of all servers
```

### 🎉 The Magic in Action
When you send a request like:
```json
{
  "phone": "1234567890",
  "email": "test@example.com",
  "zip": "12345"
}
```

**The server:**
1. 🔍 **Discovers** your app in the specified directory
2. 🔥 **Loads** your `helpers.rip` with Ruby-style regex syntax
3. 📡 **Routes** the request through your app's middleware
4. ✨ **Processes** using your custom validators and business logic
5. 📊 **Logs** the entire request flow beautifully

**All while your app code remains completely portable and server-agnostic!**

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

## 🔒 HTTPS Support

### Smart Certificate Management

**rip-server** offers multiple HTTPS options to match your needs:

1. **Smart Mode** (`https`) - Automatically selects the best option:
   ```bash
   rip-server https              # Uses CA if available, creates if not
   ```

2. **Quick Self-Signed** (`https:quick`) - For quick testing:
   ```bash
   rip-server https:quick        # Browser warnings, but works immediately
   ```

3. **CA-Signed Certificates** (`https:ca`) - Professional development:
   ```bash
   rip-server ca:init           # One-time CA setup
   rip-server ca:trust          # Trust in system (no more warnings!)
   rip-server https:ca          # Use CA-signed certificates
   ```

4. **Your Own Certificates** - For any environment:
   ```bash
   rip-server cert.pem key.pem  # Use your Let's Encrypt or other certs
   ```

### Certificate Authority Benefits

After running `ca:init` and `ca:trust` once:
- ✅ No more browser warnings
- ✅ Valid HTTPS for all local development
- ✅ Wildcard support (*.localhost)
- ✅ Works with custom domains
- ✅ 2-year validity

### Both Protocols

Need HTTP and HTTPS together?
```bash
rip-server http+https         # Both on default ports (3000 & 3443)
rip-server http+https 8080 8443  # Custom ports for both
```

### Using Your Own SSL Certificates

**Drop in your existing SSL certificates from trusted Certificate Authorities** like Let's Encrypt, DigiCert, Comodo, etc.

#### Quick Start with Existing Certificates

```bash
# Using your existing certificates (arguments in ANY order!)
rip-server prod https /path/to/cert.pem /path/to/key.pem
rip-server cert.pem key.pem prod https w:10
rip-server /etc/ssl/cert.pem /etc/ssl/key.pem

# Let's Encrypt example
rip-server prod https /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Custom SSL directory
rip-server prod https /opt/ssl/yourdomain.com/certificate.pem /opt/ssl/yourdomain.com/private.key
```

#### Configuration File Method

```json
// package.json
{
  "rip-server": {
    "workers": 10,
    "requests": 100,
    "protocol": "https",
    "httpsPort": 443,
    "certPath": "/etc/ssl/certs/server.crt",
    "keyPath": "/etc/ssl/private/server.key"
  }
}
```

Then just run:
```bash
rip-server prod
```

#### Symlink Method

```bash
# Create standard location for certificates
mkdir -p ~/.rip-server/certs
ln -s /etc/letsencrypt/live/yourdomain.com/fullchain.pem ~/.rip-server/certs/server.crt
ln -s /etc/letsencrypt/live/yourdomain.com/privkey.pem ~/.rip-server/certs/server.key

# Then run normally
rip-server prod https
```

#### Docker/Container Usage

```dockerfile
FROM oven/bun:1.0

# Copy SSL certificates
COPY ssl/certificate.pem /app/ssl/
COPY ssl/private.key /app/ssl/
RUN chmod 644 /app/ssl/certificate.pem
RUN chmod 600 /app/ssl/private.key

# Copy application
COPY . /app
WORKDIR /app

# Start with certificates
CMD ["rip-server", "prod", "https", "/app/ssl/certificate.pem", "/app/ssl/private.key"]
```

#### Security Best Practices

```bash
# Set correct permissions
chmod 644 /path/to/certificate.pem    # Certificate can be world-readable
chmod 600 /path/to/private.key        # Private key should be owner-only

# Verify certificate and key match
openssl x509 -noout -modulus -in certificate.pem | openssl md5
openssl rsa -noout -modulus -in private.key | openssl md5
# The MD5 hashes should match

# Check certificate expiration
openssl x509 -noout -dates -in certificate.pem
```

#### Zero-Downtime Certificate Updates

When certificates need renewal:
```bash
# 1. Update certificates in place
cp new-certificate.pem /etc/ssl/certs/yourdomain.pem
cp new-private.key /etc/ssl/private/yourdomain.key

# 2. Graceful restart
rip-server stop  # Graceful shutdown
rip-server prod https /etc/ssl/certs/yourdomain.pem /etc/ssl/private/yourdomain.key
```

## 🌐 **Platform Controller**

### **✅ FULLY WORKING - Ready for Production!**

The Rip Platform Controller is **completely implemented and working**. All commands use REST API communication for reliable multi-app management.

### **🚀 Multi-App Dynamic Platform**

Transform any machine into a **Heroku-like platform** with the Rip Platform Controller:

```bash
# Start the platform (like starting Heroku locally)
rip-server platform

🌐 Rip Platform running on :3000
📊 Dashboard: http://localhost:3000/platform
✨ Ready to deploy apps dynamically...
```

### **🎯 Deploy Multiple Apps Instantly:**

```bash
# First, start the platform in one terminal
rip-server platform

# Then, in another terminal, deploy apps dynamically
rip-server deploy blog examples/blog --port 3001 --workers 3
rip-server deploy api apps/labs/api --port 3002 --workers 5
rip-server deploy legal examples/legal --port 3003 --workers 2

# Scale in real-time
rip-server scale api 10        # Scale API to 10 workers
rip-server scale blog 1        # Scale blog to 1 worker

# Management commands
rip-server list                # Show all deployed apps
rip-server restart api         # Restart just the API app
rip-server undeploy blog       # Remove blog app completely
```

### **🎯 Complete Platform Workflow:**

```bash
# Terminal 1: Start the platform
rip-server platform
# 🌐 Rip Platform running on :3000
# 📊 Dashboard: http://localhost:3000/platform

# Terminal 2: Deploy and manage apps
rip-server deploy api apps/labs/api --port 3001 --workers 2
rip-server list                # See all deployed apps
rip-server scale api 5         # Scale to 5 workers
rip-server restart api         # Restart the app
rip-server undeploy api        # Remove the app
```

### **🎛️ Visual Management Dashboard:**

- **📊 Real-time stats**: Memory, CPU, request counts
- **⚡ One-click scaling**: Add/remove workers instantly
- **📈 Performance monitoring**: Response times, throughput
- **🔧 Hot deployments**: Deploy new versions without downtime
- **📱 Mobile-friendly**: Manage from anywhere

### **🔧 REST API for Automation:**

```bash
# Full programmatic control
curl -X POST http://localhost:3000/api/deploy \
  -d '{"name":"api","directory":"apps/api","workers":5}'

curl -X PUT http://localhost:3000/api/scale/api \
  -d '{"workers":10}'

curl -X GET http://localhost:3000/api/stats
```

---

## 🎯 **Two Ways to Run Rip Server**

### **From Monorepo Root: `bun server` (Recommended for Teams)**
```bash
# From the Rip monorepo root directory:
bun server apps/labs/api        # Clean, consistent
bun server examples/blog        # Works from any monorepo directory
bun server status               # Check status
bun server stop                 # Stop server
```

### **From Anywhere: `rip-server` (Universal)**
```bash
# After global installation:
rip-server apps/labs/api        # POLS: finds index.rip automatically
rip-server apps/labs/api        # Explicit path
rip-server status               # Check status
rip-server stop                 # Stop server
```

### **When to Use Which:**
- **Use `bun server`**: Team workflows, documentation, scripts (from monorepo root)
- **Use `rip-server`**: Individual productivity, quick iteration, CI/CD, standalone projects

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

## License

MIT

## Contributing

rip-server is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community