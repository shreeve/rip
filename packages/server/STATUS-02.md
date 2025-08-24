# Rip Server Development Summary (Session 02)

## Project Overview
This session focused on simplifying the CLI around the Principle of Least Surprise (POLS), fixing HTTP-only behavior, documenting macOS privileged port behavior, and adding automatic Bonjour/mDNS advertising of `.local` aliases for seamless mobile testing. We also introduced an `@` alias system and removed the `add`/`remove` commands from the flow and docs to keep the mental model clean and declarative.

## Key Architectural Components
- **Server**: Single `Bun.serve` acceptor for HTTPS/HTTP, host-based routing via in-memory registry
- **Manager**: Supervises workers, implements rolling restarts (spawn-before-kill)
- **Worker**: Handles requests with isolation; supports reload modes (none/process/module)
- **IPC**: Per-worker Unix Domain Sockets; control socket for orchestration

## Major Changes This Session

### 1) CLI Simplification and POLS
- Introduced `@` alias syntax on the app path: `apps/labs/api@labs,test`
- Removed reliance on dynamic `add`/`remove` registry commands (docs updated)
- Kept lifecycle surface minimal: `bun server ...`, `bun server list`, `bun server stop`
- Position-independent arguments preserved (`w:`, `r:`, flags)

### 2) HTTP-only Mode Bug Fix
- Corrected logic so `bun server http apps/labs/api` truly starts HTTP on 80 (or falls back to 5000+). URL logging now correctly shows `http://localhost:<port>` in HTTP-only mode.

### 3) Automatic mDNS Advertising for `.local`
- When aliases ending in `.local` are declared, the server auto-spawns `dns-sd -P` advertisements
- Works great for iPhone/iPad testing: clean URLs like `http://api.local` without typing LAN IPs/ports
- Ensured robust cleanup: tracked child `dns-sd` processes are terminated on stop/signals/crashes; `bun server stop` also kills orphaned `_http._tcp` ads

### 4) macOS Privileged Ports Documentation
- Documented Mojave-era behavior: binding privileged ports as non-root works when binding `0.0.0.0` (all interfaces), but not `127.0.0.1` (loopback only)
- Added clear security guidance and “trade-off” table: convenience vs LAN exposure vs localhost-only vs high ports

### 5) README Updates
- Replaced all `bun server add ...` examples with `@` alias startup examples
- Added a concise note about future `remove@alias` style commands for multi-app scenarios
- Documented the Mobile Dev Game-Changer section with `@`-driven mDNS

## Current CLI — Simple and Predictable
```bash
# Start server with aliases
bun server apps/labs/api               # Default: api.local
bun server apps/labs/api@labs          # labs.local only
bun server apps/labs/api@labs,test     # labs.local, test.local

# Discover and stop
bun server list                         # show registered hosts if running
bun server stop                         # stop server and mDNS ads
```

## File Updates (Highlights)
- `packages/server/server.ts`
  - HTTP-only detection corrected (`httpsPort === null`)
  - mDNS management: track `dns-sd` child processes; start/stop per alias
  - Control API simplified to read-only for registry
  - Graceful stop now terminates all mDNS advertisements

- `packages/server/rip-server.ts`
  - Correct URL output for HTTP-only
  - Global cleanup via signal handlers; ensure `svr.stop()`/`mgr.stop()` invoked
  - `stop` command removes orphaned mDNS ads (`pkill -f 'dns-sd -P.*_http._tcp'`)
  - Removed legacy `add`/`remove` paths in favor of declarative `@` aliases

- `packages/server/utils.ts`
  - `parseFlags` now parses `path@alias1,alias2`
  - Returns `appAliases` (defaults to `[appName]` when `@` omitted)
  - Usage text updated to show `@` alias syntax

- `packages/server/README.md`
  - POLS-aligned CLI examples using `@` aliases
  - macOS privileged port notes + security trade-offs
  - Automatic mDNS advertisement explained; real-world usage examples
  - Future note: `remove@alias`, `stop@alias`, `status@alias` for multi-app

## Performance Notes (unchanged this session)
- `/server` endpoint remains ~105K RPS in prior benchmarks
- `/ping` endpoint 5–20K RPS depending on routing/ALS

## Design Decisions Reinforced
1. **HTTPS-first** with explicit HTTP-only toggle
2. **Single-app, foreground** model for now (daemon/multi-app deferred)
3. **Aliases are declarative at startup** via `@`, not mutated at runtime
4. **Host-based routing** with in-memory registry; unknown hosts → 404
5. **Rolling restarts** for zero-downtime deploys

## Known Limitations
- Single app per server instance (multi-app deferred)
- In-memory registry (no persistence)
- No built-in ACME automation (mkcert/self-signed supported)
- Ports < 1024 nuances on macOS (documented)

## Example Commands Used This Session
```bash
# HTTP-only, fallback to 5000+
bun server http apps/labs/api

# With aliases for mDNS
bun server apps/labs/api@api,cheese,demo

# Lifecycle
bun server list
bun server stop
```

## Future Considerations
- Multi-app server with alias-based addressing: `status@alias`, `stop@alias`, `remove@alias`
- Registry persistence and admin API aligned with alias model
- ACME/Let’s Encrypt automation
- Hardening: rate-limiting, DoS protection, audit logging


