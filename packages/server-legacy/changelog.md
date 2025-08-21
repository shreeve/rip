## Changelog

### v4.0.0 - August 8, 2025 - 🎯 **Flexible Arguments & Revolutionary Platform**

**🚀 Revolutionary Multi-App Platform:**
* Complete concurrent multi-app hosting on different ports
* Dynamic scaling with `bun server scale <app> <workers>`
* Real-time deployment with `bun server deploy <name> <directory>`
* Production-ready hot reload with zero downtime
* Native Unix socket load balancing with Bun's `fetch({ unix })`
* Comprehensive platform dashboard and REST API

**🎯 Flexible Argument Parsing:**
* Arguments can be provided in ANY order!
* Smart detection: `w:5` (workers), `8080` (port), `apps/labs/api` (directory)
* Configuration file support: package.json and bunfig.toml
* Certificate auto-detection: `.pem`, `.crt`, `.key` files
* Mode detection: `dev`, `prod`, `https:ca`, `https:quick`

**🔒 Complete HTTPS/CA Integration:**
* Full Certificate Authority management with `ca:init`, `ca:trust`, `ca:export`
* macOS keychain integration for trusted development certificates
* Self-signed and CA-signed certificate generation
* Professional 3072-bit RSA keys with 2-year validity

**🔥 Production-Grade Hot Reload:**
* Graceful sequential worker restarts (2-second intervals)
* 500ms debounce timer to prevent rapid restart cycles
* File watching with proper cleanup and error handling
* Zero-downtime updates in development and production

**🏗️ Multi-Process Architecture:**
* Manager → Workers → Load Balancer pipeline
* Process isolation with fault tolerance
* Exponential backoff for worker crash recovery
* Health monitoring and statistics per worker

### v3.0.1 - August 3, 2025 - 🛑 **Enhanced Stop Command**

**🛑 Improved Process Management:**
* `rip-server stop` now uses `pkill -f "rip-server"` for complete cleanup
* Ensures all rip-server processes and components are terminated
* More reliable than the previous implementation

### v3.0.0 - August 3, 2025 - 🎯 **Flexible Arguments & Pure TypeScript**

**🚀 Pure TypeScript Implementation:**
* Eliminated all shell scripts - 100% TypeScript/Bun
* Fixed Bun.spawn() issues completely
* No more exec chains or environment problems
* Modern, maintainable codebase

**🎯 Flexible Argument System:**
* Arguments can be provided in ANY order!
* Smart type detection (ports, paths, certificates, w:, r:)
* Sensible defaults for everything
* Examples: `rip-server 8080 w:5`, `rip-server prod ./api`, `rip-server w:10 r:100 3443`

**📋 Configuration File Support:**
* package.json: `{ "rip-server": { "workers": 5, "requests": 100 } }`
* bunfig.toml: `[rip-server]` section
* Command line arguments override file configs

**🔒 HTTPS Support:**
* **Smart Mode** (`https`) - Automatically uses best certificate option
* **Quick Mode** (`https:quick`) - Instant self-signed certificates
* **CA Mode** (`https:ca`) - Professional CA-signed certificates
* **Certificate Authority Management:**
  - `ca:init` - One-time CA setup
  - `ca:trust` - Trust CA in system (no more warnings!)
  - `ca:export` - Export CA for manual import
  - `ca:info` - Show CA details
  - `ca:list` - List generated certificates
  - `ca:clean` - Clean old certificates
* **Protocol Options:**
  - `http` - HTTP only (default)
  - `https` - HTTPS with smart selection
  - `http+https` - Both protocols simultaneously
* Auto-generates certificates when needed
* Supports custom certificates: `rip-server cert.pem key.pem`

**⚡ Simplified Commands:**
* Removed background/foreground modes (always foreground)
* Use systemd/Docker/PM2 for production process management
* Cleaner, more intuitive command structure

**Breaking Changes:**
* Shell scripts removed (start.sh, stop.sh, test.sh)
* Background mode removed
* Old positional argument syntax deprecated
* Default is now HTTP-only (use `https` for HTTPS)

### v2.0.0 - August 3, 2025 - 🚀 **API-Rip: HTTPS-by-Default**

**🔒 HTTPS-by-Default Architecture:**
* HTTPS is now the default for all development and production
* Auto-generates SSL certificates on first run (zero configuration)
* HTTP-only mode requires explicit `:http` suffix
* Both HTTPS (port 3443) and HTTP (port 3000) servers available simultaneously

**🎯 Sequential Processing Enhancement:**
* Workers now handle one request at a time for perfect isolation
* Intelligent 503 failover - busy worker triggers next worker attempt
* Erlang/WhatsApp-style reliability pattern implementation

**🚀 Unified Server Architecture:**
* Complete rewrite using Bun runtime and Rip language
* Multi-process architecture (server → manager → workers)
* Hot reload via file watching with graceful worker restarts
* Unix socket communication for maximum performance
* Built-in health monitoring and metrics endpoints

**📊 Enhanced Request Logging:**
* Full date+time+timezone timestamps (YYYY-MM-DD HH:MM:SS.mmm±HH:MM)
* Human-friendly 1-indexed worker display (W1, W2, W3)
* Compact one-line format with method, URL, status, type, size, duration
* Perfect for development monitoring and production debugging

**📋 New Commands:**
* `bun run dev` - HTTPS + HTTP development (default)
* `bun run dev:http` - HTTP-only development (explicit)
* `bun run test` - Tests HTTPS endpoint (default)
* `bun run health` - HTTPS health check (default)
