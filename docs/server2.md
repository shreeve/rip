## Rip Server – Clean-Room Spec (v0.1)

### Purpose
- Bun-based replacement for nginx+unicorn-style serving for Rip apps.
- Preserve single-inflight isolation per worker; maximize throughput with per-worker fan-out and keepalive.

### Goals
- Serve Rip apps via multi-process workers behind an in-process HTTP load balancer.
- Isolation: exactly one request in-flight per worker process.
- High throughput with low overhead: per-worker sockets, keepalive, minimal allocations.
- Simple operability: CLI flags/env; clear health/status; predictable failure modes.

### Non-Goals
- No auth/multi-tenant routing.
- No persistence or schema changes.
- No exotic balancing beyond RR/optional least-connections.

### Architecture
- Components:
  - Manager: spawns, monitors, restarts worker processes; hot-reload in dev.
  - Worker: Bun.serve on per-worker Unix socket; single-inflight; app entry dispatch.
  - LB Server: Bun.serve HTTP(S); forwards to workers via Unix sockets with queue/timeouts.
- Processes: 1 LB per app by default; optionally multiple LB replicas with reusePort (flag: `--lb-replicas=<N>`).

### Application entry resolution
- Invocation form: `bun server <app-path> [flags]`
- If `<app-path>` is a directory:
  - Base app directory = `<app-path>`
  - Entry probing order (first match wins): `index.rip`, then `index.ts`
  - If neither exists: fail with a clear error
- If `<app-path>` is a file (e.g., `apps/labs/api/main.rip`):
  - Base app directory = directory of the file
  - Entry = the specified file only (no fallback probing)

### Worker (packages/server/worker.ts)
- Per-worker Unix socket path: `/tmp/rip_<variant>_<app>.<id>.sock`.
  - `variant` distinguishes parallel servers (e.g., `server`, `server1`, `server2`).
  - Default `variant` derives from the invoked task/entry (e.g., `bun server1` → `variant=server1`).
  - Override via flag `--variant=<name>` or env `RIP_VARIANT`. For full control, `--socket-prefix=/tmp/custom_prefix` replaces `rip_<variant>_<app>`.
- Single-inflight policy:
  - If busy: return 503 with header `Rip-Worker-Busy: 1`. MAY include standard `Retry-After`.
  - Note: the LB does not forward the worker's busy response to clients; it retries another socket. The LB will set a standard `Retry-After` on client-facing 503/504 responses as appropriate.
  - Else: handle request by calling Rip app function or `fetch(req)`.
- Endpoints:
  - `GET /ready`: returns `ok` (200) if app loaded; `not-ready` otherwise.
- HTTP
  - Keepalive enabled (do not force `Connection: close`).
  - `idleTimeout`: 5–10s.
  - `maxRequestBodySize`: 100 MB.
- Timeouts
  - Optional per-request guard (default OFF for perf); enable via flag in dev if desired.
- Busy handling
  - Worker maintains an in-process busy flag and returns 503 immediately if a second request arrives concurrently.
  - LB maintains `socket -> inflight(0|1)` and only dispatches when inflight=0 (prevents most busy hits).
  - Race-safety/multi-LB: worker also adds an internal response header `Rip-Worker-Busy: 1` on its 503 so the LB can retry another socket if a race occurs.
  - Internal headers (`Rip-Worker-Busy`, `Rip-Worker-Id`) must NOT be forwarded to clients.
  - `Rip-Worker-Id` is optional and debug-only.
- Lifecycle
  - Exit gracefully after `maxRequests` (cycling) or on SIGTERM/SIGINT.

### Manager (packages/server/manager.ts)
- Spawns N workers (N = flag/auto cores) with env: WORKER_ID, APP_NAME, SOCKET_PATH.
- Cleans per-worker sockets on start/stop/restart; no legacy shared-socket cleanup.
- Restarts with exponential backoff; cap restart attempts.
- Hot reload in dev: watch `.rip` files, debounce; stop all workers, cleanup sockets, respawn.

### Load Balancer (packages/server/server.ts)
- Bind HTTP (and optional HTTPS) using Bun.serve.
- Forwarding
  - Destination set: dynamically discovered per-worker sockets under `/tmp` matching `rip_<variant>_<app>.*.sock`.
  - Selection: round-robin; skip quarantined and sockets with inflight>0.
  - Single-inflight at LB: map `socket -> inflight(0|1)`; only dispatch when free.
  - Keepalive on LB↔worker connections.
  - Upstream pool knobs: configurable max concurrent connections per socket (default 1) and max idle keepalive per socket (default 8).
- Queue/Backpressure
  - Bounded FIFO queue with `max_size` and `timeout_ms`.
  - When no socket available: enqueue or return 503 if queue full; 504 if queue wait exceeds timeout.
- Retries & Quarantine
  - On worker-busy 503 (`Rip-Worker-Busy: 1`): try next socket once (race-safety; LB already avoids busy sockets).
  - On connect error: log compactly; quarantine socket for 1s (exponential backoff optional future).
  - Retry budget: at most one retry per request (per-worker-once overall).
  - Active health checks (optional): periodic `/ready` probe per socket; open circuit after K failures for T ms.
- Timeouts
  - Connect timeout (AbortSignal) default 200ms.
  - Read timeout guard default 5000ms (504 on expiry).
- Endpoints
  - `GET /status`: `{ status: "healthy", app, workers, ports, uptime }` (static object; cache Response).
  - All others: forwarded to workers (including `/ready`).
  - Readiness gating: LB reports healthy only after at least 1 worker `/ready` success; degraded if 0 healthy workers.
- Headers on egress
  - None by default (strip internal headers). Optional debug-only: `Rip-App`, `Rip-Response-Time` (ms).
  - Strip list (internal): `Rip-Worker-Busy`, `Rip-Worker-Id`.
  - Standard headers (e.g., `Retry-After`) keep their standard names and are preserved on LB responses.
- Logging
  - Access log ON by default (human format). Disable explicitly with `--no-access-log`.
  - JSON logging optional via `--json-logging`.

### File layout & responsibilities
- packages/server/server.ts
  - HTTP(S) load balancer only: accept client traffic, apply queue/backpressure, pick a free worker socket (pre-dispatch inflight check), forward with connect/read timeouts and keepalive, handle retries/quarantine, expose `/status`, strip internal headers.
  - No process-spawn logic; composes a Manager instance.
- packages/server/manager.ts
  - Process supervisor: spawn N workers, set env (APP_NAME, WORKER_ID, SOCKET_PATH), cleanup per-worker sockets, restart with backoff, orchestrate hot reload.
  - No HTTP request handling.
- packages/server/worker.ts
  - Per-worker Bun.serve bound to unique Unix socket; enforce single-inflight; serve app; expose `/ready`; on race, respond 503 with internal `Rip-Worker-Busy: 1`.
- packages/server/utils.ts
  - Shared helpers: socket paths, header stripping, timeout/abort helpers, bounded queue helpers, env/flag parsing, logging formatting, timestamps/uptime.

### CLI & Config (packages/server/rip-server.ts)
- Commands
  - Direct mode: start app under LB+workers on a port; simple status/stop.
  - Platform mode: controller for deploy/start/scale; HTTP API + dashboard.
  - CA management: dev CA init/trust/export/list/clean; quick/self-signed.
- Flags (order-agnostic parser)
  - `w:<N|auto>` workers; `r:<N>` maxRequests per worker (cycling).
  - Ports: HTTP/HTTPS; protocol: `http|https|http+https`.
  - HTTPS mode: `https:quick|https:ca|https:smart`.
  - JSON: `--json`, `--json-logging`.
  - Access log: `--no-access-log` to disable (on by default).
  - Variant & sockets: `--variant=<name>` (default inferred), `--socket-prefix=<prefix>` to override `/tmp/rip_<variant>_<app>`.
- LB Tuning via env/flags
  - `RIP_MAX_QUEUE` (default 8192)
  - `RIP_QUEUE_TIMEOUT_MS` (default 2000)
  - `RIP_CONNECT_TIMEOUT_MS` (default 200)
  - `RIP_READ_TIMEOUT_MS` (default 5000)
  - Flags (no prefix): `--max-queue`, `--queue-timeout-ms`, `--connect-timeout-ms`, `--read-timeout-ms`.
  - LB replicas: `--lb-replicas=<N>` (enables reusePort), LB policy: `--lb-policy=rr|lc`.
  - Upstream pool: `--upstream-max-idle=<N>` (default 8), `--upstream-max-conns-per-socket=<N>` (default 1).
  - Variant env: `RIP_VARIANT` to set variant when flags are omitted.

### Dev/Prod Behavior & Hot Reload
- File watching: `.rip` and `.ts` under the app base directory; debounce 100–300ms.
- Modes: `--hot-reload=<none|process|module>` (env: `RIP_HOT_RELOAD`)
  - `none`: no automatic reloads.
  - `process` (safe, robust): Manager restarts workers on change; cleans sockets, respawns; preserves isolation; slight blip to in‑flight queue.
  - `module` (fastest dev loop): workers keep running; on next request the worker re‑imports the entry module with cache‑busting (e.g., `?<mtime>`), swaps the handler atomically.
    - Safety: best for mostly stateless code; modules may export optional `onUnload()` to dispose resources before swap.
    - Isolation: single‑inflight ensures swaps happen between requests.
- Defaults: dev = `module`; prod = `none` (can be overridden). If hot reload is desired in prod, prefer `process` for safety.

### TLS/HTTPS & CA (packages/server/rip-server.ts)
- Quick self-signed and CA-signed localhost certs.
- macOS trust flow for dev CA; export cert.
 - Cert reloads: document behavior. If cert/key files change at runtime, reload on next LB restart; live reload may be added later behind a flag.

### Platform Controller (packages/server/rip-server.ts)
- API: list/deploy/undeploy/start/scale/restart apps; simple stats.
- Dashboard: static HTML page; periodic fetch of APIs.

### Compatibility constraints
- Preserve existing platform controller APIs and CLI UX.
- Preserve TLS/CA flows and commands (init/trust/export/list/clean).

### Performance Targets (default localhost guidance)
- `/ready`: ≥ 20k RPS, p50 ≤ 10ms, 0% non-2xx.
- `/ping` (app endpoint): ≥ 20k RPS with reasonable busy rate depending on queue settings; p50 ≤ 10ms when not queued.

### OS & Runtime Tuning (docs)
- `ulimit -n` ≥ 65536.
- Keep short `idleTimeout` on worker/LB (5–10s); enable keepalive.
- Use `reusePort` when running multiple LB replicas.
 - Backlog: ensure high listen backlog; on macOS, consider `kern.ipc.somaxconn` if running separate TCP listeners.

### Observability
- Logs: JSON optional (time, app, method, path, status, durations, length).
  - JSON fields (recommended): `t` (ISO time), `app`, `method`, `path`, `status`, `totalSeconds`, `workerSeconds`, `length`, and optional `workerId` (debug-only).
- Status: `/status` on LB; `/ready` on workers.
- Counters (in-code + status exposure in future): queue depth, retries, quarantined sockets, inflight per socket, 5xx counts.

### Failure Modes & Responses
- 503: no free sockets and queue full; worker busy immediate response.
- 504: queue wait exceeded; upstream read timeout.
- Quarantine reduces log spam and hot-looping on dead sockets.

### Testing & Benchmarks
- Smoke
  - `curl -sf http://localhost:PORT/status`
  - `curl -sf http://localhost:PORT/ready`
- wrk examples
```
wrk -t8 -c512 -d15s --latency http://127.0.0.1:PORT/ready
wrk -t8 -c512 -d15s --latency http://127.0.0.1:PORT/ping
```
- Success: meets targets; no timeouts on `/ready`; acceptable busy rate on `/ping` per queue policy.

### Acceptance Criteria
- Compiles under Bun; no lints.
- All CLI commands work as documented.
- Workers single-inflight enforced; LB never dispatches to a busy socket.
- Queue & timeouts respected; predictable 503/504 behavior.
- Performance targets met on localhost with recommended settings.

### Nice-to-have (Future)
- Optional least-connections policy.
- Multiple LB replicas with `reusePort`.
- Structured metrics endpoint.

### Single-shot scope and options
- Core (must implement now)
  - Single-inflight workers; per-worker AF_UNIX sockets.
  - LB: round-robin with pre-dispatch inflight check (do not send to busy sockets).
  - Bounded FIFO queue with timeout (503 when full, 504 on timeout).
  - Retries on busy/connect; socket quarantine on connect errors.
  - Keepalive LB↔worker; short idleTimeouts.
  - Endpoints: `/ready` (workers), `/status` (LB).
  - Readiness gating: LB healthy only after ≥1 worker `/ready` success (degraded if 0 healthy).
  - Logging: access log ON by default; `--no-access-log` disables. `--json-logging` optional.
  - CLI/env: `--max-queue`, `--queue-timeout-ms`, `--connect-timeout-ms`, `--read-timeout-ms`; `RIP_*` env equivalents.
  - Hot reload flag: `--hot-reload` / `--no-hot-reload` (ON in dev, OFF in prod by default).

- Optional (default OFF; may be implemented later or gated by flags)
  - LB replicas with `reusePort` (`--lb-replicas=<N>`), policy `--lb-policy=rr|lc`.
  - Active health checks with circuit breaker (K failures → open for T ms).
  - Upstream pool knobs: `--upstream-max-idle=<N>` (default 8), `--upstream-max-conns-per-socket=<N>` (default 1; LB enforces single-inflight regardless).
  - Structured metrics endpoint.

- Implementation notes (internal behavior)
  - Internal headers used only between LB and workers must be stripped from client responses: `Rip-Worker-Busy`, `Rip-Worker-Id`.
  - Worker busy handling: worker maintains a busy flag and returns 503 with `Rip-Worker-Busy: 1` if a race allows a second concurrent arrival; LB primarily avoids busy by pre-check and only retries on that internal busy signal.
  - Socket discovery: dynamically list `/tmp/rip_<app>.*.sock`; quarantine failures briefly to avoid hammering dead sockets.
  - Start-up: perform a quick warm probe to populate healthy set before LB reports healthy.
