<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Server - Production-Ready Application Framework

**Bun-Powered Multi-Process Server with Hot Reload**

**🔥 Ruby Analogy**: This layer is analogous to **nginx + unicorn in the Ruby ecosystem** - it's the production server infrastructure that handles HTTP requests, manages worker processes, provides load balancing, and ensures fault tolerance. Just as nginx + unicorn gives you production-grade Ruby deployment, `@rip/server` gives you production-grade Rip deployment.

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
# Install globally
bun link @rip/server

# Or link manually
sudo ln -sf $(pwd)/packages/server/rip-server.ts /usr/local/bin/rip-server

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

# Smart Management Commands
rip-server start apps/my-app        # Start server (if not already running)
rip-server stop                     # Stop server (if running)
rip-server test                     # Run test suite
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

## 🎛️ Smart Start/Stop Commands

**Idempotent server management** - safe to run multiple times without errors:

### **🚀 Smart `start` Command**
```bash
# Always safe to run - won't double-start
rip-server start apps/my-app

# If not running → Starts the server
✅ Starting rip-server...

# If already running → Shows friendly message
✅ rip-server is already running
```

### **🛑 Smart `stop` Command**
```bash
# Always safe to run - won't error if already stopped
rip-server stop

# If running → Stops the server gracefully
🛑 Stopping rip-server...
✅ All processes stopped

# If already stopped → Shows friendly message
✅ rip-server is already stopped
```

### **🔍 Check Status**
```bash
# Quick status check
ps aux | grep rip-server | grep -v grep

# Or use pgrep
pgrep -f rip-server
```

### **💡 Benefits**
- **Idempotent**: Safe to run in scripts and automation
- **Clear Feedback**: Always tells you what's happening
- **No External Dependencies**: Built right into rip-server
- **Conventional**: Standard start/stop terminology
- **Automation Friendly**: Perfect for deployment scripts

## 🎯 Server/App Separation Architecture

**🚀 Revolutionary Decoupled Design** - The server runtime is completely separated from your application code, enabling unprecedented flexibility and developer productivity:

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
# Development workflow with smart commands
rip-server start apps/my-app        # Smart start - won't double-start
# Edit files in apps/my-app/ → changes appear instantly
# No build steps, no server restarts needed!

# Production deployment
rip-server start prod apps/my-app   # Smart start in production mode

# Safe automation (perfect for scripts)
rip-server stop                     # Always safe to stop
rip-server start apps/api           # Always safe to start
rip-server start apps/api           # Run again? No problem!

# Multi-app development
rip-server start apps/frontend 3000 # Smart start frontend
rip-server start apps/api 8080      # Smart start API
rip-server start apps/admin 4000    # Smart start admin
# All running simultaneously!
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