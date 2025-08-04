## Changelog

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

**🔒 Revolutionary HTTPS Support:**
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

### v2.0.0 - August 3, 2025 - 🚀 **API-Rip: HTTPS-by-Default Revolution**

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
