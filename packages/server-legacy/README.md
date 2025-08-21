<img src="/logo.png" style="width:50px" /> <br>

# Rip Server - Production-Ready Application Framework

**Bun-Powered Multi-Process Server with Hot Reload**

**🔥 Ruby Analogy**: This layer is analogous to **nginx + unicorn in the Ruby ecosystem** - it's the production server infrastructure that handles HTTP requests, manages worker processes, provides load balancing, and ensures fault tolerance. Just as nginx + unicorn gives you production-grade Ruby deployment, `@rip/server` gives you production-grade Rip deployment.

## 🤔 Why Choose Rip Server?

**For developers tired of complex deployment stacks** - Rip server replaces entire toolchains:

**❌ Traditional Stack:**
```
nginx + unicorn + ruby + systemd + complex configs
```

**✅ Rip Server:**
```bash
bun server apps/my-app        # That's it. Production ready.
```

**🔥 Key Benefits:**
- 🎯 **Point-and-run any app** - No configuration, just works
- ⚡ **Same system dev→prod** - No deployment surprises
- 🔄 **Smart restart behavior** - Always does what you expect
- 📊 **Built-in monitoring** - Comprehensive status endpoint with metrics
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
echo "export default { fetch: () => new Response('Hello World!') }" > index.rip

# 2. Run it (from monorepo root)
bun server my-app               # Serves on http://localhost:3000

# 3. That's it! 🎉
```

## 🚀 Quick Start

```bash
# Run from monorepo root (recommended)
cd /path/to/rip

# Flexible argument syntax - provide options in ANY order!
bun server                          # HTTP only (default)
bun server https                    # HTTPS with smart certificates
bun server https:quick              # HTTPS with quick self-signed cert
bun server https:ca                 # HTTPS with CA-signed cert
bun server http+https               # Both HTTP and HTTPS
bun server 8080                     # Custom HTTP port
bun server https 8443               # Custom HTTPS port
bun server prod                     # Production mode
bun server ./api                    # Specific app directory
bun server w:5 r:100                # 5 workers, 100 requests each
bun server cert.pem key.pem         # HTTPS with your certificates

# Mix and match in any order!
bun server prod https w:10          # Production HTTPS, 10 workers
bun server ./api http+https         # Both protocols for API
bun server https:ca 8443 w:5        # CA cert on port 8443

# Smart Lifecycle Commands
bun server apps/my-app              # Start/restart server (smart default)
bun server status                   # Show detailed server status
bun server stop                     # Stop server (explicit)
bun server help                     # Show help

# Certificate Authority commands
bun server ca:init                  # Initialize CA (one-time setup)
bun server ca:trust                 # Trust CA in system (macOS)
bun server ca:export                # Export CA certificate
bun server ca:info                  # Show CA information
bun server ca:list                  # List generated certificates
bun server ca:clean                 # Clean old certificates

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
[2025-08-03 14:30:15.456-08:00] W2.3 GET /status → 200 json 248b 1ms
[2025-08-03 14:30:15.789-08:00] W3.1 GET /info → 200 json 248b 12ms
```

**📊 What Each Field Shows:**
- `[2025-08-03 14:30:15.123-08:00]` - Full timestamp with timezone
- `W1.5` - Worker 1, Request #5 (human-friendly 1-indexed)
- `GET /status` - HTTP method + path
- `→ 200` - Response status code
- `plain` - Content type (shortened)
- `7b` - Response size in bytes
- `3ms` - Request duration

**Perfect for monitoring, debugging, and performance analysis!** 🎯

### Logging modes

- Pretty fixed-width screen logs by default
- JSON mode with `--json-logging` (ideal for log collectors)

### Response headers

Every proxied response includes:

- `X-Rip-Worker`: worker index handling the request
- `X-Rip-App`: application name
- `X-Response-Time`: total server time in ms

## 🎯 **Complete Server Management Demo**

**Step-by-step practical workflow** - everything you need to know:

### **📊 1. Check Status (Always Start Here)**
```bash
bun server status                    # Check if anything is running
# OR
bun server status                    # Same thing, direct command
```

### **🚀 2. Start Server with App**
```bash
# From monorepo root (recommended)
bun server apps/labs/api             # Start labs API
bun server examples/blog             # Start blog example
bun server examples/legal            # Start legal example

# From monorepo root (recommended)
bun server apps/labs/api             # Auto-finds index.rip
bun server examples/blog             # Auto-finds index.rip
```

### **🔄 3. Restart Server (Smart Behavior)**
```bash
# If server is already running, this restarts it
bun server apps/labs/api             # Smart restart
bun server apps/labs/api             # Same thing
```

### **📡 4. Test Your Running App**
```bash
curl http://localhost:3000/ping      # Test endpoint
curl http://localhost:3000/status     # Server status & metrics
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
bun server stop                       # Graceful shutdown
bun server stop api                   # Target a specific direct-mode app
bun server stop platform:3100         # Stop a specific platform instance
bun server stop 3000 --force          # Free a stuck HTTP port (macOS)
```

### **⚡ 7. Advanced Options**
```bash
# Custom ports and workers
bun server apps/labs/api 8080       # Custom port
bun server w:5 r:100                # 5 workers, 100 requests each
bun server https                    # HTTPS with auto-cert
bun server prod                     # Production mode
bun server --json-logging           # Structured JSON logs
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
bun server                    # Start/restart with defaults
bun server 8080               # Start/restart on port 8080
bun server https w:5          # Start/restart with HTTPS and 5 workers

# If not running → Starts fresh
🚀 Starting bun server...

# If already running → Restarts gracefully
🔄 bun server is already running, restarting...
```

### **🔍 Explicit Status Command**
```bash
bun server status
```
```
🔍 bun server Status

✅ Status: RUNNING

📋 Active Processes:
   • PID: 12345 | Parent: 1234 | Runtime: 2:30:15 | Memory: 45MB
     Port: 3000 | Command: bun bun server.ts
     🟢 Health check: HEALTHY (200)

🌐 Port Status:
   • Port 3000: 🟢 ACTIVE (HTTP 200)
   • Port 3443: 🟢 ACTIVE (HTTPS 200)
```

### **🛑 Explicit Stop Command**
```bash
bun server stop

# If running → Stops gracefully
🛑 Stopping bun server...

# If already stopped → Friendly message
✅ bun server is already stopped
```

### **💡 Why This Design?**
- **Intuitive**: Default behavior is "make it work"
- **Explicit**: When you want status/stop, be explicit
- **Safe**: All commands are idempotent and automation-friendly
- **Predictable**: No surprises, follows Principle of Least Surprise

### **🧰 Machine-Readable Status and Exit Codes**

Use `--json` (or `-j`) to get structured status output that's easy to parse in scripts:

```bash
bun server status --json
# {
#   "status": "running",
#   "processes": [
#     { "mode": "platform", "port": 3000, "ok": true },
#     { "mode": "direct", "app": "api", "pid": 12345, "httpPort": 3000, "httpsPort": 3443, "workers": 2, "requests": 100, "ok": true }
#   ]
# }
```

Exit codes for automation:
- `status`: exits `0` when running/degraded; exits `3` when stopped
- `stop`: exits `0` if successful; `1` only when nothing was found to stop and not forced
- `start/dev/prod`: exit `0` upon successful launch

## 🎯 Server/App Separation Architecture

**Decoupled Design** - The server runtime is separated from your application code, enabling flexibility and developer productivity:

### 📱 Point-and-Run Any App
```bash
# One server, infinite apps
bun server apps/blog 3000           # Blog on port 3000
bun server apps/api 8080            # API on port 8080
bun server apps/ecommerce 4000      # E-commerce on port 4000
bun server ../other-project 5000    # Any Rip app anywhere
```

Accepted entry points (POLS): `index.rip`, `app.rip`, `server.rip`, `main.rip`, or `index.ts`.

### 🔥 Live Development Experience
- **🎯 Zero Coupling**: Server runtime ↔ App logic completely independent
- **⚡ Instant Switching**: Point server at different apps without restart
- **🔄 Hot Reload**: Edit app files → automatic worker restart → zero downtime
- **📁 Clean Architecture**: Apps are self-contained directories
- **🧪 Easy Testing**: Point server at test apps for isolated testing

### 🌟 What This Enables
```bash
# Development workflow with smart defaults
bun server apps/my-app              # Start/restart - always works
# Edit files in apps/my-app/ → changes appear instantly
# No build steps, no server restarts needed!

# Production deployment
bun server prod apps/my-app         # Start/restart in production mode

# Safe automation (perfect for scripts)
bun server stop                     # Always safe to stop
bun server apps/api                 # Always safe to start/restart
bun server apps/api                 # Run again? Restarts gracefully!

# Multi-app development
bun server apps/frontend 3000       # Start/restart frontend
bun server apps/api 8080            # Start/restart API
bun server apps/admin 4000          # Start/restart admin
# All running simultaneously!

# Check what's running
bun server status                   # Comprehensive status of all servers
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
2. 🔥 **Loads** your `@rip/api` helpers with Ruby-style regex syntax
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
 - **♻️ Rolling Restarts** - `r:N` caps requests per worker with staggered restarts
 - **🧠 Smart Port Handling** - Direct mode auto-bumps HTTP port if in use

## 🔒 HTTPS Support

### Smart Certificate Management

**bun server** offers multiple HTTPS options to match your needs:

1. **Smart Mode** (`https`) - Automatically selects the best option:
   ```bash
   bun server https              # Uses CA if available, creates if not
   ```

2. **Quick Self-Signed** (`https:quick`) - For quick testing:
   ```bash
   bun server https:quick        # Browser warnings, but works immediately
   ```

3. **CA-Signed Certificates** (`https:ca`) - Professional development:
   ```bash
   bun server ca:init           # One-time CA setup
   bun server ca:trust          # Trust in system (no more warnings!)
   bun server https:ca          # Use CA-signed certificates
   ```

4. **Your Own Certificates** - For any environment:
   ```bash
   bun server cert.pem key.pem  # Use your Let's Encrypt or other certs
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
bun server http+https         # Both on default ports (3000 & 3443)
bun server http+https 8080 8443  # Custom ports for both
```

### Using Your Own SSL Certificates

**Drop in your existing SSL certificates from trusted Certificate Authorities** like Let's Encrypt, DigiCert, Comodo, etc.

#### Quick Start with Existing Certificates

```bash
# Using your existing certificates (arguments in ANY order!)
bun server prod https /path/to/cert.pem /path/to/key.pem
bun server cert.pem key.pem prod https w:10
bun server /etc/ssl/cert.pem /etc/ssl/key.pem

# Let's Encrypt example
bun server prod https /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Custom SSL directory
bun server prod https /opt/ssl/yourdomain.com/certificate.pem /opt/ssl/yourdomain.com/private.key
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
bun server prod
```

#### Symlink Method

```bash
# Create standard location for certificates
mkdir -p ~/.bun server/certs
ln -s /etc/letsencrypt/live/yourdomain.com/fullchain.pem ~/.bun server/certs/server.crt
ln -s /etc/letsencrypt/live/yourdomain.com/privkey.pem ~/.bun server/certs/server.key

# Then run normally
bun server prod https
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
CMD ["bun server", "prod", "https", "/app/ssl/certificate.pem", "/app/ssl/private.key"]
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
bun server stop  # Graceful shutdown
bun server prod https /etc/ssl/certs/yourdomain.pem /etc/ssl/private/yourdomain.key
```

## 🌐 **Platform Controller**

### **✅ FULLY WORKING - Ready for Production!**

The Rip Platform Controller is **completely implemented and working**. All commands use REST API communication for reliable multi-app management.

### **🚀 Multi-App Dynamic Platform**

Transform any machine into a **Heroku-like platform** with the Rip Platform Controller:

```bash
# Start the platform (like starting Heroku locally)
bun server platform

🌐 Rip Platform running on :3000
📊 Dashboard: http://localhost:3000/platform
✨ Ready to deploy apps dynamically...
```

### **🎯 Deploy Multiple Apps Instantly:**

```bash
# First, start the platform in one terminal
bun server platform

# Then, in another terminal, deploy apps dynamically
bun server deploy blog examples/blog --port 3001 --workers 3
bun server deploy api apps/labs/api --port 3002 --workers 5
bun server deploy legal examples/legal --port 3003 --workers 2

# Scale in real-time
bun server scale api 10        # Scale API to 10 workers
bun server scale blog 1        # Scale blog to 1 worker

# Management commands
bun server list                # Show all deployed apps
bun server restart api         # Restart just the API app
bun server undeploy blog       # Remove blog app completely
```

#### 🔒 TLS on Deploy (Auto-Generation)

If you deploy with `protocol` set to `https` or `http+https` and you don't provide certs, the platform will auto-generate them for you based on the mode you specify:

```bash
# Smart (default): use CA if available, otherwise quick self-signed
bun server deploy api apps/labs/api http+https

# Quick self-signed
bun server deploy api apps/labs/api https:quick

# CA-signed (after ca:init & ca:trust)
bun server deploy api apps/labs/api https:ca

# Provide your own certs
bun server deploy api apps/labs/api https /path/to/cert.pem /path/to/key.pem
```

### **🎯 Complete Platform Workflow:**

```bash
# Terminal 1: Start the platform
bun server platform
# 🌐 Rip Platform running on :3000
# 📊 Dashboard: http://localhost:3000/platform

# Terminal 2: Deploy and manage apps
bun server deploy api apps/labs/api --port 3001 --workers 2
bun server list                # See all deployed apps
bun server scale api 5         # Scale to 5 workers
bun server restart api         # Restart the app
bun server undeploy api        # Remove the app
```

### **🎛️ Visual Management Dashboard:**

- **📊 Real-time stats**: Memory, CPU, request counts
- **⚡ One-click scaling**: Add/remove workers instantly
- **📈 Performance monitoring**: Response times, throughput
- **🔧 Hot deployments**: Deploy new versions without downtime
- **📱 Mobile-friendly**: Manage from anywhere
- **🌐 Port health badges**: Per-port status shown as 🟢/🔴 for HTTP/HTTPS

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

### **From Anywhere: `bun server` (Universal)**
```bash
# After global installation:
bun server apps/labs/api        # POLS: finds index.rip automatically
bun server apps/labs/api        # Explicit path
bun server status               # Check status
bun server stop                 # Stop server
```

### **When to Use Which:**
- **Use `bun server`**: Team workflows, documentation, scripts (from monorepo root)
- **Use `bun server`**: Individual productivity, quick iteration, CI/CD, standalone projects

### **Configuration Precedence**
`bun server` reads configuration from multiple places. Precedence (highest wins):
- **CLI flags/args** (e.g., `w:5`, `r:100`, `https:ca`, ports, paths)
- **package.json** `{"rip-server": { ... }}` in the app directory
- **bunfig.toml** `[rip-server]` section in the app directory

If a key is defined in multiple places, the value from the higher-precedence source is used.

## 🎯 Production Deployment

This replaces entire web server stacks:

**Before:**
```
nginx → unicorn → ruby app
```

**After:**
```
bun server (server → manager → workers)
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

bun server is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community