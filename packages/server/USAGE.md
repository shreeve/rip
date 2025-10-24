# Rip Server Usage Guide 🚀

Complete guide to running Rip Server with HTTPS, mDNS, and the live dashboard.

## 🎯 Quick Start

### Recommended: Auto-TLS with mkcert (No Browser Warnings!)

```bash
# One-time setup: Install mkcert
brew install mkcert              # macOS
# or
sudo apt install mkcert          # Linux

# Install the local CA
mkcert -install

# Start server with auto-TLS
cd /Users/shreeve/Data/Code/rip
bun packages/server/rip-server.ts --auto-tls apps/labs/api

# Dashboard opens at: https://rip.local
# or: https://localhost:443
```

### Quick Start: Self-Signed (Fast but Browser Warnings)

```bash
# Just run it - auto-generates self-signed cert
bun packages/server/rip-server.ts apps/labs/api

# Click through browser warning once
# Dashboard: https://localhost
```

### HTTP Only (No Certificates)

```bash
# Use http: prefix to disable HTTPS
bun packages/server/rip-server.ts http:3000 apps/labs/api

# Dashboard: http://localhost:3000
```

## 📊 Dashboard Access

Once running, access the live dashboard at:

**With HTTPS (default):**
- **https://rip.local** (if mDNS works)
- **https://localhost:{port}**
- **https://127.0.0.1:{port}**

**With HTTP:**
- **http://rip.local:{port}**
- **http://localhost:{port}**

### What the Dashboard Shows

- ✅ Server status (healthy/degraded/offline)
- ✅ Active workers count and state
- ✅ Server uptime
- ✅ HTTP/HTTPS ports
- ✅ Registered hosts and aliases
- ✅ Auto-refreshes every 10 seconds

## 🔐 HTTPS Options

### Option 1: mkcert (Recommended for Development)

**Trusted certificates with zero browser warnings!**

```bash
# One-time install
brew install mkcert
mkcert -install  # Adds CA to system trust store

# Use with server
bun packages/server/rip-server.ts --auto-tls apps/labs/api
```

**What it does:**
1. Checks for mkcert installation
2. Creates `~/.rip/certs/localhost.pem` and `localhost-key.pem`
3. Certificates are trusted by your browser
4. No security warnings!

### Option 2: Bring Your Own Certificates

```bash
bun packages/server/rip-server.ts \
  --cert=/path/to/cert.pem \
  --key=/path/to/key.pem \
  apps/labs/api
```

Perfect for production certificates (Let's Encrypt, etc.).

### Option 3: Self-Signed (Automatic Fallback)

```bash
# No flags needed - auto-generates if mkcert unavailable
bun packages/server/rip-server.ts apps/labs/api
```

**What it does:**
1. Tries mkcert first (if `--auto-tls` is set)
2. Falls back to self-signed via openssl
3. Creates `~/.rip/certs/selfsigned-localhost.pem`
4. Works but shows browser warnings

## 🌐 mDNS Aliases (.local domains)

Make your app accessible with friendly names on your LAN!

### Basic Alias

```bash
bun packages/server/rip-server.ts --auto-tls apps/labs/api@api

# Creates:
# - https://rip.local (dashboard)
# - https://api.local (your app)
```

### Multiple Aliases

```bash
bun packages/server/rip-server.ts --auto-tls apps/labs/api@api,mobile,demo

# Creates:
# - https://rip.local (dashboard)
# - https://api.local (your app)
# - https://mobile.local (your app)
# - https://demo.local (your app)
```

**Perfect for testing on phones/tablets on your LAN!**

### How It Works

- Uses Bonjour/mDNS to broadcast `.local` domains
- Automatically works on macOS (built-in)
- Linux: Install Avahi (`sudo apt install avahi-daemon`)
- Windows: Install Bonjour Print Services

## ⚙️ Port Configuration

### Default Behavior (HTTPS)

```bash
bun packages/server/rip-server.ts apps/labs/api

# Tries port 443 first
# If taken, probes from 5700, 5701, 5702...
```

### Explicit HTTPS Port

```bash
bun packages/server/rip-server.ts 5700 apps/labs/api
# HTTPS on port 5700

bun packages/server/rip-server.ts https:8443 apps/labs/api
# HTTPS on port 8443
```

### HTTP Only

```bash
bun packages/server/rip-server.ts http apps/labs/api
# Tries port 80, then probes from 5700+

bun packages/server/rip-server.ts http:3000 apps/labs/api
# HTTP on port 3000
```

### Both HTTP and HTTPS

```bash
# HTTP on 80, HTTPS on 443 (with redirect)
bun packages/server/rip-server.ts --auto-tls apps/labs/api

# Custom ports
bun packages/server/rip-server.ts --auto-tls 8443 apps/labs/api
# HTTPS on 8443, HTTP redirect from 80
```

## 👥 Worker Management

### Scale Workers

```bash
# Auto (number of CPU cores)
bun packages/server/rip-server.ts w:auto apps/labs/api

# Half of cores (default)
bun packages/server/rip-server.ts w:half apps/labs/api

# Specific number
bun packages/server/rip-server.ts w:8 apps/labs/api
```

### Worker Budgets (Auto-Restart)

Restart workers after hitting limits:

```bash
# Restart after 20,000 requests
bun packages/server/rip-server.ts r:20000 apps/labs/api

# Restart after 20,000 requests OR 30 minutes
bun packages/server/rip-server.ts r:20000,1800s apps/labs/api

# With reload budget (for module-reload mode)
bun packages/server/rip-server.ts r:20000,1800s,10r apps/labs/api
```

Format: `r:requests[,seconds[,reloads]]`

## 🔄 Reload Modes

### Process Reload (Default - Clean & Deterministic)

```bash
bun packages/server/rip-server.ts apps/labs/api

# File changes → kills workers → spawns fresh ones
# Slower but completely clean state
```

### Module Reload (Fast Development)

```bash
bun packages/server/rip-server.ts --reload=module apps/labs/api

# File changes → workers reload modules in-place
# Faster but may have stale references
```

## 📝 Logging Options

### Human-Readable Logs (Default)

```bash
bun packages/server/rip-server.ts apps/labs/api

# Output:
# 2025-10-24 14:23:45 GET /users 200 12.3ms (worker: 8.1ms)
```

### JSON Logs (For Production Parsing)

```bash
bun packages/server/rip-server.ts --json-logging apps/labs/api

# Output:
# {"timestamp":"2025-10-24T14:23:45Z","method":"GET","path":"/users","status":200,"ms":12.3,"worker_ms":8.1}
```

### Disable Access Logs

```bash
bun packages/server/rip-server.ts --no-access-log apps/labs/api
```

## 🔧 Advanced Options

### Timeouts

```bash
bun packages/server/rip-server.ts \
  --queue-timeout-ms=2000 \
  --connect-timeout-ms=200 \
  --read-timeout-ms=5000 \
  apps/labs/api
```

### Queue Size

```bash
bun packages/server/rip-server.ts --max-queue=8192 apps/labs/api
```

### HSTS (Strict Transport Security)

```bash
bun packages/server/rip-server.ts --auto-tls --hsts apps/labs/api

# Adds: Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Disable HTTP→HTTPS Redirect

```bash
bun packages/server/rip-server.ts --auto-tls --no-redirect-http apps/labs/api
```

## 🛠️ Management Commands

### List Registered Hosts

```bash
bun packages/server/rip-server.ts list

# Output:
# localhost
# 127.0.0.1
# rip.local
# api.local
```

### Stop Server

```bash
bun packages/server/rip-server.ts stop

# Kills server and all workers
# Cleans up mDNS processes
```

### Check Status (While Running)

```bash
# Health check
curl https://localhost/server
# Output: ok

# Full status JSON
curl https://localhost/status | jq
# Output:
# {
#   "status": "healthy",
#   "app": "api",
#   "workers": 4,
#   "ports": { "http": 80, "https": 443 },
#   "uptime": 3600,
#   "hosts": ["localhost", "127.0.0.1", "rip.local", "api.local"]
# }
```

## 📱 Mobile/Tablet Testing

Perfect for testing your app on real devices:

```bash
# Start with mobile alias
bun packages/server/rip-server.ts --auto-tls apps/labs/api@mobile,tablet

# On your phone/tablet (same WiFi network):
# 1. Trust the mkcert CA (one-time):
#    - Export CA: mkcert -CAROOT (copy rootCA.pem to device)
#    - iOS: Settings → General → VPN & Device Management → Install Profile
#    - Android: Settings → Security → Install from storage
#
# 2. Open in browser:
#    https://mobile.local
#    https://tablet.local
#    https://rip.local (dashboard)
```

## 🎯 Common Recipes

### Development (Fast Iteration)

```bash
bun packages/server/rip-server.ts --auto-tls --reload=module apps/labs/api
```

### Production-Like (Clean Restarts)

```bash
bun packages/server/rip-server.ts \
  --auto-tls \
  w:auto \
  r:50000,3600s \
  --hsts \
  --json-logging \
  apps/labs/api
```

### Demo/Testing (Multiple Aliases)

```bash
bun packages/server/rip-server.ts --auto-tls apps/labs/api@api,demo,staging,mobile
```

### HTTP Only (Simple)

```bash
bun packages/server/rip-server.ts http:3000 apps/labs/api
```

## 🏗️ App Structure

Your app needs an entry point:

```
apps/labs/api/
├── index.rip       ← Entry point (or index.ts)
├── routes/
│   ├── users.rip
│   └── posts.rip
└── db/
    └── schema.rip
```

The entry point should export a `default` or `fetch` handler:

```rip
# apps/labs/api/index.rip
export default (req) ->
  new Response 'Hello from Rip!'
```

Or using Hono/other frameworks:

```rip
import { Hono } from 'hono'

app = new Hono()

app.get '/users', (c) ->
  c.json { users: [] }

export default app
```

## 🔍 Troubleshooting

### Port Already in Use

Server auto-probes for free ports. If you need a specific port:

```bash
# Check what's using the port
lsof -i :443

# Kill it or use a different port
bun packages/server/rip-server.ts 5700 apps/labs/api
```

### mkcert Not Found

```bash
# Install it
brew install mkcert

# Or use self-signed (automatic fallback)
bun packages/server/rip-server.ts apps/labs/api
```

### .local Domains Not Working

**macOS:** Should work out of the box (Bonjour built-in)

**Linux:**
```bash
sudo apt install avahi-daemon
sudo systemctl start avahi-daemon
```

**Windows:**
Install Bonjour Print Services from Apple

### Worker Crashes

Check logs for errors. The server will continue serving with remaining workers and auto-spawn replacements.

### Browser Certificate Warnings

If you see warnings:
1. Use `--auto-tls` flag
2. Make sure mkcert is installed and CA is installed (`mkcert -install`)
3. For self-signed certs, click "Advanced" → "Proceed"

## 📚 Flag Reference

### Server Flags

| Flag | Description | Example |
|------|-------------|---------|
| `--auto-tls` | Use mkcert → self-signed fallback | `--auto-tls` |
| `--cert=PATH` | Path to TLS certificate | `--cert=/path/cert.pem` |
| `--key=PATH` | Path to TLS private key | `--key=/path/key.pem` |
| `--hsts` | Enable HTTP Strict Transport Security | `--hsts` |
| `--no-redirect-http` | Disable HTTP→HTTPS redirect | `--no-redirect-http` |

### Worker Flags

| Flag | Description | Example |
|------|-------------|---------|
| `w:NUMBER` | Number of workers | `w:8` |
| `w:auto` | Workers = CPU cores | `w:auto` |
| `w:half` | Workers = CPU cores / 2 (default) | `w:half` |
| `r:BUDGET` | Restart budget (requests[,seconds[,reloads]]) | `r:20000,1800s,10r` |
| `--reload=MODE` | Reload mode: `process` or `module` | `--reload=module` |

### Logging Flags

| Flag | Description | Example |
|------|-------------|---------|
| `--json-logging` | JSON access logs instead of human | `--json-logging` |
| `--no-access-log` | Disable access logs | `--no-access-log` |

### Performance Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--max-queue=N` | Max queued requests | 4096 |
| `--queue-timeout-ms=N` | Queue timeout | 1000ms |
| `--connect-timeout-ms=N` | Worker connect timeout | 100ms |
| `--read-timeout-ms=N` | Worker read timeout | 3000ms |

## 🎨 Complete Examples

### Example 1: Local Development

```bash
bun packages/server/rip-server.ts --auto-tls --reload=module apps/labs/api

# Fast module reloads
# HTTPS with mkcert
# Dashboard: https://rip.local
```

### Example 2: Mobile Testing

```bash
bun packages/server/rip-server.ts --auto-tls apps/labs/api@api,mobile,dev

# Access from phone:
# - https://api.local
# - https://mobile.local
# - https://dev.local
# - https://rip.local (dashboard)
```

### Example 3: Production-Like

```bash
bun packages/server/rip-server.ts \
  --auto-tls \
  w:auto \
  r:50000,3600s \
  --hsts \
  --json-logging \
  --max-queue=8192 \
  apps/labs/api
```

### Example 4: Custom Ports

```bash
# HTTPS on 8443
bun packages/server/rip-server.ts --auto-tls 8443 apps/labs/api

# HTTP on 8080
bun packages/server/rip-server.ts http:8080 apps/labs/api

# Both
bun packages/server/rip-server.ts --auto-tls 8443 apps/labs/api
# HTTPS on 8443, HTTP redirect from 80
```

### Example 5: High Performance

```bash
bun packages/server/rip-server.ts \
  --auto-tls \
  w:16 \
  r:100000,7200s \
  --queue-timeout-ms=500 \
  --max-queue=16384 \
  apps/labs/api
```

## 🚀 npm Scripts Setup

Add to your root `package.json`:

```json
{
  "scripts": {
    "server": "bun packages/server/rip-server.ts --auto-tls apps/labs/api",
    "server:dev": "bun packages/server/rip-server.ts --auto-tls --reload=module apps/labs/api@dev",
    "server:mobile": "bun packages/server/rip-server.ts --auto-tls apps/labs/api@api,mobile,tablet",
    "server:prod": "bun packages/server/rip-server.ts --auto-tls w:auto r:50000,3600s --hsts --json-logging apps/labs/api",
    "server:http": "bun packages/server/rip-server.ts http:3000 apps/labs/api",
    "server:stop": "bun packages/server/rip-server.ts stop",
    "server:list": "bun packages/server/rip-server.ts list"
  }
}
```

Then just:

```bash
bun run server           # Start with HTTPS
bun run server:dev       # Development mode
bun run server:mobile    # With mobile aliases
bun run server:stop      # Stop server
bun run server:list      # List hosts
```

## 📊 Status & Health Endpoints

### Health Check

```bash
curl https://localhost/server
# Output: ok
```

### Full Status (JSON)

```bash
curl https://localhost/status | jq

# Output:
{
  "status": "healthy",
  "app": "api",
  "workers": 4,
  "ports": {
    "http": 80,
    "https": 443
  },
  "uptime": 3600,
  "hosts": [
    "localhost",
    "127.0.0.1",
    "rip.local",
    "api.local"
  ]
}
```

## 🔐 Certificate Management

### Check Current Certificates

```bash
# mkcert certs (trusted)
ls ~/.rip/certs/localhost*.pem

# Self-signed certs
ls ~/.rip/certs/selfsigned-localhost*.pem
```

### Regenerate Certificates

```bash
# Remove old certs
rm ~/.rip/certs/*.pem

# Restart server - auto-generates new ones
bun packages/server/rip-server.ts --auto-tls apps/labs/api
```

### Trust mkcert CA on Mobile Devices

```bash
# 1. Find CA root certificate
mkcert -CAROOT
# Output: /Users/shreeve/Library/Application Support/mkcert

# 2. Copy rootCA.pem to your phone

# 3. On iOS:
# - Email rootCA.pem to yourself
# - Open on device → Install Profile
# - Settings → General → About → Certificate Trust Settings → Enable

# 4. On Android:
# - Copy rootCA.pem to device
# - Settings → Security → Install from storage
```

## 🎯 Development Workflow

### Typical Development Session

```bash
# 1. Start server with auto-reload
bun packages/server/rip-server.ts --auto-tls --reload=module apps/labs/api@dev

# 2. Open dashboard
open https://rip.local

# 3. Open app
open https://dev.local

# 4. Edit files in apps/labs/api/
# → Changes appear instantly (module reload)

# 5. Check logs in terminal
# → See request timing and worker info

# 6. When done
bun packages/server/rip-server.ts stop
```

### Testing Workflow

```bash
# Start with test alias
bun packages/server/rip-server.ts --auto-tls apps/labs/api@test

# Run tests against it
curl https://test.local/api/users
curl https://test.local/api/posts

# Or from your test suite
# BASE_URL=https://test.local bun test
```

## 🌟 Best Practices

### For Development
- ✅ Use `--auto-tls` with mkcert (no warnings)
- ✅ Use `--reload=module` for fast iteration
- ✅ Use aliases: `@dev,local,test`
- ✅ Keep default worker count (`w:half`)

### For Production
- ✅ Use explicit `--cert` and `--key` paths
- ✅ Use `w:auto` for full CPU utilization
- ✅ Set restart budgets: `r:100000,7200s`
- ✅ Enable `--hsts`
- ✅ Use `--json-logging` for log parsing
- ✅ Monitor `/status` endpoint

### For Mobile Testing
- ✅ Install mkcert CA on devices (one-time)
- ✅ Use descriptive aliases: `@mobile,tablet,demo`
- ✅ Ensure same WiFi network
- ✅ Use `.local` domains for auto-discovery

## 💡 Tips

1. **First time using mkcert?** Run `mkcert -install` once - it's permanent
2. **Can't bind port 443?** Use `sudo` or let it auto-probe from 5700+
3. **Testing on phone?** Use aliases like `@mobile` for clean URLs
4. **Need to restart workers?** They auto-restart based on budgets
5. **Want zero-downtime deploys?** Workers do rolling restarts automatically

## 🚨 Common Issues

### "Port 443 in use"

Server auto-probes to next available port. Check output for actual port:

```bash
# Output shows actual port:
rip-server: app=api workers=4 url=https://localhost:5700/server
#                                                      ^^^^
```

### "mkcert command not found"

```bash
# Install it
brew install mkcert  # macOS
sudo apt install mkcert  # Linux

# Or run without it (self-signed fallback)
bun packages/server/rip-server.ts apps/labs/api
```

### Browser Shows "Not Secure"

You're using self-signed certs. Two options:
1. Install mkcert and use `--auto-tls`
2. Click "Advanced" → "Proceed to localhost (unsafe)"

### .local Domains Don't Work

**macOS:** Should work automatically

**Linux:** Install Avahi
```bash
sudo apt install avahi-daemon
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon
```

**Windows:** Install Bonjour Print Services

## 📚 See Also

- [README.md](./README.md) - Overview and architecture
- [SPEC.md](./SPEC.md) - Technical specification
- [STATUS-03.md](./STATUS-03.md) - Latest development status

---

**Built with ❤️ for fast, resilient Rip applications**
