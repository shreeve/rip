## Changelog

### v2.0.0 - August 3, 2025 - 🚀 **API-RIP: HTTPS-by-Default Revolution**

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
