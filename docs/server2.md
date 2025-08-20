<!--
ONE-SHOT IMPLEMENTATION INSTRUCTIONS

You are an AI code generator. Using the specification below, implement a brand-new server in this repository.

Deliverables:
- Create all code in packages/server2:
  - packages/server2/{rip-server.ts, server.ts, manager.ts, worker.ts, utils.ts}
- Add a root script in package.json:
  - "server2": "bun packages/server2/rip-server.ts"

Constraints:
- Bun-only runtime. Do NOT modify packages/server/*.
- Follow the spec exactly; no directory scans on the request path; workers self-register.

Acceptance (smoke):
- bun server2 <app-path> protocol:http http:<PORT> w:<N>
- curl -sf http://localhost:<PORT>/status
- wrk -t8 -c512 -d15s --latency http://127.0.0.1:<PORT>/ping
-->

## Rip Server – Clean-Room Spec (v0.2 – server2)

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
  - Manager: spawns, restarts worker processes; orchestrates rolling process reloads (no file watchers).
  - Worker: Bun.serve on per-worker Unix socket; single-inflight; resolves the app handler from the API-layer reloader.
  - LB Server: Bun.serve HTTP(S); forwards to workers with in-memory pool (explicit registration) + queue/timeouts.
- Processes: 1 LB per app by default; optionally multiple LB replicas (future) for TCP; control via local Unix socket.

### Application entry resolution
- Invocation form: `bun server <app-path> [flags]`
- If `<app-path>` is a directory:
  - Base app directory = `<app-path>`
  - Entry probing order (first match wins): `index.rip`, then `index.ts`
  - If neither exists: fail with a clear error
- If `<app-path>` is a file (e.g., `apps/labs/api/main.rip`):
  - Base app directory = directory of the file
  - Entry = the specified file only (no fallback probing)

### Worker (packages/server2/worker.ts)
- Per-worker Unix socket path: `/tmp/rip_<variant>_<app>.<id>.sock`.
- Single-inflight policy and internal busy signal unchanged.
- HTTP: keepalive, short idleTimeout (5–10s), 100MB body limit.
- Module mode: before taking the inflight slot, call `await reloader.getHandler()` (API-layer) → atomic swap, no 404s.
- Lifecycle: graceful exit on signals or after `maxRequests`.

### Manager (packages/server2/manager.ts)
- Spawns N workers; sets env; cleans per-worker sockets.
- Monitor & restart with exponential backoff; cap attempts. On exit, respawn.
- Rolling process reloads on explicit admin command (no file watchers, no socket touching).

#### Control plane & registration (worker self-registers)
- Control socket: `/tmp/rip_<variant>_<app>.ctl.sock` (owned by LB).
- Single endpoint: `POST /worker` handles both operations via payload.
- Worker self-registers only when actually ready: `{ op: "join", app, workerId, pid, socket, version? }` → `{ ok: true }`.
- Worker deregisters on clean shutdown: `{ op: "quit", app, workerId }` → `{ ok: true }`.
- LB maintains an in‑memory pool from these messages; no per‑request directory scans.

#### Admin operations (process reloads)
- Triggered via Manager CLI/admin (e.g., `bun server2 restart <app>`; not via LB). Rolling sequence per worker: wait drain (single‑inflight) → terminate → spawn → worker self-registers.

### Load Balancer (packages/server2/server.ts)
- Bind HTTP(S) using Bun.serve.
- Forwarding
  - Destination set populated by worker self-registrations (no per-request directory scans).
  - Selection: round-robin; skip sockets with inflight>0.
  - Single-inflight at LB: map `socket -> inflight(0|1)`; only dispatch when free.
  - Keepalive on LB↔worker connections.
  - Upstream pool knobs: configurable max concurrent connections per socket (default 1) and max idle keepalive per socket (default 8).
  - Version routing (process mode): if workers register with a version, the LB routes only to the newest version observed for the app; older versions stop receiving new requests.
- Queue/Backpressure
  - Bounded FIFO queue with `max_size` and `timeout_ms`.
  - When no socket available: enqueue or return 503 if queue full; 504 if queue wait exceeds timeout.
- Retries & Quarantine
  - On worker-busy 503 (`Rip-Worker-Busy: 1`): try next socket once (race-safety; LB already avoids busy sockets).
  - On connect/read error: drop the socket from the pool immediately (no default quarantine). Rely on worker exit + manager respawn + re‑registration. A tiny quarantine (500–1000ms) is optional future hardening.
  - Retry budget: at most one retry per request (per-worker-once overall).
  - Active health checks (optional/future): periodic probes; open circuit after K failures for T ms.
- Timeouts
  - Connect timeout (AbortSignal) default 200ms.
  - Read timeout guard default 5000ms (504 on expiry).
- Endpoints
  - `GET /status`: `{ status: "healthy|degraded", app, workers, ports, uptime }` (cache Response).
  - All others: forwarded to workers. LB is healthy once ≥1 worker is registered.
- Headers on egress
  - None by default (strip internal headers). Optional debug-only: `Rip-App`, `Rip-Response-Time` (ms).
  - Strip list (internal): `Rip-Worker-Busy`, `Rip-Worker-Id`.
  - Standard headers (e.g., `Retry-After`) keep their standard names and are preserved on LB responses.
- Logging
  - Access log ON by default (human format). Disable explicitly with `--no-access-log`.
  - JSON logging optional via `--json-logging`.

### File layout & responsibilities
- packages/server2/server.ts: LB only (HTTP[S], pool routing, queue/backpressure, strip internal headers, `/status`).
- packages/server2/manager.ts: process supervisor (spawn/restart; admin ops). Workers self-register/deregister.
- packages/server2/worker.ts: per-worker server with single‑inflight; uses API reloader.
- packages/server2/utils.ts: shared helpers (copy `scale`, timestamp/log helpers, header stripping, timeouts, queue helpers, flag/env parsing).

### CLI & Config (packages/server2/rip-server.ts)
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
- Modes: `--hot-reload=<none|process|module>` (env: `RIP_HOT_RELOAD`)
  - `none`: no automatic reloads.
  - `process`: explicit admin-triggered rolling restarts; readiness-gated; preferred for prod w>1.
  - `module`: API-layer reloader (`getHandler()` per request) with cache-busted imports; no file watchers; best for dev (w:1 ideal).
  - Defaults: dev = `module`; prod = `none` or `process`.

### Bun plugin support (.rip)
- Loader must support cache-busting queries: filter `/\.rip(\?.*)?$/`; read via `path.split('?')[0]`.

### TLS/HTTPS & CA (packages/server2/rip-server.ts)
- Quick self-signed and CA-signed localhost certs.
- macOS trust flow for dev CA; export cert.
 - Cert reloads: document behavior. If cert/key files change at runtime, reload on next LB restart; live reload may be added later behind a flag.

### Platform Controller (packages/server2/rip-server.ts)
- API: list/deploy/undeploy/start/scale/restart apps; simple stats.
- Dashboard: static HTML page; periodic fetch of APIs.

### Compatibility constraints
- Preserve existing platform controller APIs and CLI UX.
- Preserve TLS/CA flows and commands (init/trust/export/list/clean).

### Performance Targets (default localhost guidance)
- `/ping` (app endpoint): ≥ 20k RPS with reasonable busy rate depending on queue settings; p50 ≤ 10ms when not queued.

### OS & Runtime Tuning (docs)
- `ulimit -n` ≥ 65536.
- Keep short `idleTimeout` on worker/LB (5–10s); enable keepalive.
- Use `reusePort` when running multiple LB replicas.
 - Backlog: ensure high listen backlog; on macOS, consider `kern.ipc.somaxconn` if running separate TCP listeners.

### Observability
- Logs: JSON optional (time, app, method, path, status, durations, length).
  - JSON fields (recommended): `t` (ISO time), `app`, `method`, `path`, `status`, `totalSeconds`, `workerSeconds`, `length`, and optional `workerId` (debug-only).
- Status: `/status` on LB.
- Counters (in-code + status exposure in future): queue depth, retries, dropped sockets, inflight per socket, 5xx counts.

### Failure Modes & Responses
- 503: no free sockets and queue full; worker busy immediate response.
- 504: queue wait exceeded; upstream read timeout.
- Dropped sockets are re-added automatically when replacement workers self-register.

### Testing & Benchmarks
- Smoke
  - `curl -sf http://localhost:PORT/status`
- wrk example
```
wrk -t8 -c512 -d15s --latency http://127.0.0.1:PORT/ping
```
- Success: meets targets; acceptable busy rate on `/ping` per queue policy.

### Acceptance Criteria
- Compiles under Bun; no lints.
- All CLI commands work as documented.
- Workers single-inflight enforced; LB never dispatches to a busy socket.
- Queue & timeouts respected; predictable 503/504 behavior.
- Performance targets met on localhost with recommended settings.
- LB health reflects registered workers (healthy once ≥1 registered); no /ready dependency.

### Nice-to-have (Future)
- Optional least-connections policy.
- Multiple LB replicas with `reusePort`.
- Structured metrics endpoint.

### Single-shot scope and options
- Core (must implement now)
  - Single-inflight workers; per-worker AF_UNIX sockets.
  - LB: round-robin with pre-dispatch inflight check (do not send to busy sockets).
  - Bounded FIFO queue with timeout (503 when full, 504 on timeout).
  - Retries on busy/connect; drop sockets from pool on failure (no default quarantine).
  - Keepalive LB↔worker; short idleTimeouts.
  - Endpoints: `/status` (LB only).
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
  - Routing pool is sourced from worker self-registrations over the control socket; no directory scanning.
