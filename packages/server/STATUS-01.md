# Rip Server Development Summary

## Project Overview
Enhanced the `rip-server` with HTTPS/TLS support and host-based routing, following POLS (Principle of Least Surprise) design philosophy. The server architecture uses a single `Server` acceptor, `Manager` for process supervision, and `Worker` processes with Unix Domain Sockets for IPC.

## Key Architectural Components
- **Server**: Single Bun.serve on ports 443 (HTTPS) and 80 (HTTP redirect), routes by Host header
- **Manager**: Spawns/monitors workers, implements rolling restarts with spawn-before-kill strategy
- **Worker**: Handles single in-flight request, supports reload modes (none/process/module)
- **IPC**: Per-worker Unix Domain Sockets with control socket for orchestration

## Major Features Implemented

### 1. CLI Design (Position-Independent Arguments)
- **App path**: First path-like token that exists
- **Workers**: `w:half` (default), `w:auto`, `w:2x`, `w:3x`, or specific count
- **Restart policy**: `r:10000,3600s,10r` (requests, seconds, reloads)
- **Ports**: Bare int for HTTPS, `http:PORT` for HTTP-only
- **Reload**: `--reload=none|process|module` (default: process)
- **Subcommands**: `stop`, `list`, `add <host>`, `remove <host>`

### 2. HTTPS/TLS Implementation
- **Port selection**: Try 443, fallback to 5000+ on EACCES/EADDRINUSE
- **Certificate precedence**: Explicit paths → mkcert → self-signed
- **Auto-TLS**: `--auto-tls` uses mkcert with ~/.rip/certs/ cache
- **HTTP redirect**: Port 80 → 301 to HTTPS (best-effort)
- **Security**: Optional HSTS headers with `--hsts`

### 3. Rolling Restart Mechanism
- Spawn-before-kill strategy (zero capacity dip)
- Parallel worker spawning and readiness checks
- Version-aware routing (only routes to latest version)
- Graceful draining of old workers

### 4. Host-Based Routing
- In-memory host registry (Set<string>)
- Seeded with localhost/127.0.0.1 by default
- Control API: GET/POST/DELETE /registry
- CLI: `bun server list|add|remove`
- 404 response for unknown hosts

## Performance Benchmarks
- **/server endpoint**: ~105K RPS (minimal overhead)
- **/ping endpoint**: 5-20K RPS (app path with ALS, routing)
- **Bottlenecks identified**: AsyncLocalStorage, app routing layer
- **Keep-alive experiment**: No significant improvement for UDS

## File Structure
```
packages/server/
├── rip-server.ts   # CLI entry point
├── server.ts       # HTTP/HTTPS server with host registry
├── manager.ts      # Process supervision and rolling restarts
├── worker.ts       # Request handling worker
├── utils.ts        # Flag parsing and utilities
├── README.md       # Usage and architecture docs
└── SPEC.md         # Complete specification
```

## Key Design Decisions
1. **No dev/prod modes**: Single set of defaults, override as needed
2. **HTTPS-first**: HTTP only serves redirects or explicit HTTP-only mode
3. **Position-independent CLI**: Clean, orthogonal arguments
4. **Single-app focus**: Multi-app mapping deferred ("Not yet")
5. **Process isolation**: Chose processes over threads for safety

## Current State
- HTTPS/TLS fully implemented with auto-cert provisioning
- Host registry operational with CLI management
- Rolling restarts with zero-downtime deployments
- All lints clean, documentation updated
- Ready for production use with single app per server instance

## Future Considerations
- ACME/Let's Encrypt automation
- Multi-app routing (host → different app paths)
- Registry persistence (currently in-memory only)
- Mutual TLS support
- SCM_RIGHTS for zero-copy socket passing (when Bun supports it)

## Session Timeline

### Initial Setup & CLI Refinement
- Reviewed SPEC.md for completeness
- Refined CLI terminology (add/remove/list vs join/quit)
- Made app-path position-independent
- Removed `--stop` flag in favor of `stop` subcommand
- Introduced `w:half`, `w:2x`, `w:3x` worker tokens
- Extended restart policy to include reloads: `r:<requests>,<seconds>s,<reloads>r`
- Renamed `--hot-reload` to `--reload` throughout

### Performance Investigation
- Benchmarked `/server` endpoint: 105K RPS
- Benchmarked `/ping` endpoint: 5-20K RPS
- Traced request paths to identify bottlenecks
- Experimented with UDS keep-alive (no significant improvement)
- Discussed but deferred: SCM_RIGHTS, thread pools, async logging

### Rolling Restart Implementation
- Changed from kill-then-spawn to spawn-before-kill
- Implemented parallel worker spawning
- Added version-aware routing
- Created retiringIds set to prevent respawn races
- Parallelized SIGTERM and exit waiting

### HTTPS/TLS Implementation
- Implemented port probing (443 then 5000+ for HTTPS, 80 then 5000+ for HTTP)
- Added certificate loading hierarchy
- Implemented `--auto-tls` with mkcert integration
- Added self-signed fallback
- Implemented HTTP→HTTPS redirect
- Added HSTS support

### Host Registry & Routing
- Added in-memory host registry with Set<string>
- Implemented Host header routing with 404 for unknown hosts
- Added control API endpoints (GET/POST/DELETE /registry)
- Implemented CLI subcommands (list/add/remove)
- Seeded localhost/127.0.0.1 by default

## Key Commits
- Initial commit hash referenced: ea8e5756124dfb0cbb4452da4b4b195097b72ac3
- Multiple incremental improvements with clean linting throughout
- All changes maintain backward compatibility

## Testing Commands Used
```bash
# Performance testing
wrk -t8 -c128 -d10s http://127.0.0.1:5025/server
wrk -t8 -c128 -d10s http://127.0.0.1:5025/ping

# Server invocations
bun server apps/labs/api
bun server apps/labs/api 5677
bun server apps/labs/api https:5700
bun server apps/labs/api http:5002
bun server apps/labs/api w:auto r:20000,900s
bun server stop

# Host registry
bun server list
bun server add my.localhost
bun server remove my.localhost
```

## Architecture Strengths
- Clean separation of concerns (Server/Manager/Worker)
- Zero-downtime deployments via rolling restarts
- Flexible CLI with position-independent arguments
- HTTPS-first with automatic certificate provisioning
- Process isolation for safety
- Efficient per-worker socket architecture

## Known Limitations
- Single app per server instance (multi-app deferred)
- Host registry is in-memory only
- No ACME/Let's Encrypt automation yet
- Requires elevated permissions for ports < 1024
- No built-in rate limiting
