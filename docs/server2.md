# Server2 (Per-Worker Socket Application Server)

Server2 is a multi-process HTTP application server for Rip apps that uses one Unix socket per worker and a lightweight in-process load balancer (LB). It preserves strict one‑inflight‑per‑worker isolation while delivering high throughput.

## Architecture Overview

- Manager (`packages/server2/manager.ts`)
  - Spawns N workers
  - Unlinks per‑worker sockets on spawn/stop
  - Monitors and restarts crashed workers with exponential backoff
  - Optional process hot‑reload: polls entry file mtime (debounced ~100ms) and triggers rolling restarts

- LB Server (`packages/server2/server.ts`)
  - Public HTTP entrypoint
  - Control socket listener for worker join/quit
  - Tracks per‑worker sockets, LIFO idle stack, and a bounded request queue
  - Forwards requests directly to selected worker socket with connect/read timeouts
  - Normalizes headers (strips internal LB headers and removes Date)

- Worker (`packages/server2/worker.ts`)
  - Listens on its per‑worker Unix socket
  - Single‑inflight handler; returns 503 with `Rip-Worker-Busy: 1` when busy
  - Joins/quits the LB via control socket on startup/shutdown
  - Module hot‑reload: 100ms mtime check, handler cache, optional graceful cycling after max reloads

## Process Flow
```
HTTP → LB (server.ts) → Select idle worker (LIFO) → Forward to worker.N.sock → Worker handles (single inflight)
```

Workers self‑register with the LB over a control socket (`/tmp/<prefix>.ctl.sock`) using join/quit operations.

## Endpoints
- `GET /server` → "ok" (LB health)
- `GET /status` → JSON `{ status, app, workers, ports, uptime }`
- Application paths (e.g., `/ping`) → forwarded to selected worker

## Control Plane
- Control socket path: `/tmp/<socketPrefix>.ctl.sock`
- Worker join payload: `{ op: 'join', workerId, pid, socket, version? }`
- Worker quit payload: `{ op: 'quit', workerId }`

## Load Balancer Behavior
- LIFO idle selection (warm workers preferenced)
- Single‑inflight per worker; workers signal busy via `Rip-Worker-Busy: 1`
- Bounded queue: LB queues requests up to `--max-queue`; queued requests 504 after `--queue-timeout-ms`
- Timeouts: per‑forward connect (`--connect-timeout-ms`) and read (`--read-timeout-ms`)
- Header normalization: strips internal headers and removes Date so the LB emits a single Date header

## Hot Reload Modes
- `--hot-reload=none` (default in prod)
  - No automatic reloads (maximum performance)
- `--hot-reload=module`
  - Worker‑level: 100ms mtime check, handler cache, optional graceful worker cycling after `--max-reloads`
- `--hot-reload=process`
  - Manager‑level: polls entry file mtime (debounced ~100ms) and triggers `rollingRestart()`; workers drain gracefully

### Hot Reload Roadmap
- Planned: replace mtime polling with a single Manager-side recursive watcher per app (ignore temp files, debounce 150–300ms) to coalesce edits and trigger one rolling restart batch. This avoids N× worker watchers and keeps the hot path minimal.

## CLI
Run:
```bash
bun packages/server2/rip-server.ts <app-path> http:<port> w:<workers> [flags]
```

Flags:
- `w:<N|auto>`: number of workers (default: CPU cores)
- `r:<N>`: max requests per worker before cycling (default: 10000)
- `--max-reloads=<N>`: max module hot‑reloads per worker before cycling (default: 10)
- `--hot-reload=<none|process|module>`: hot‑reload mode
- `--max-queue=<N>`: LB queue depth (default via env `RIP_MAX_QUEUE` or internal default)
- `--queue-timeout-ms=<N>`: LB queue timeout for enqueued requests
- `--connect-timeout-ms=<N>`: upstream connect timeout to worker sockets
- `--read-timeout-ms=<N>`: upstream read timeout after connect
- `--json-logging`: emit JSON access logs
- `--no-access-log`: disable human access logging
- `--variant=<name>`: variant label used in socket prefix
- Utility: `--stop` best‑effort stop of prior server2 processes (pkill by script path) and exit

Env overrides:
- `RIP_HOT_RELOAD`, `RIP_MAX_RELOADS`
- `RIP_MAX_QUEUE`, `RIP_QUEUE_TIMEOUT_MS`, `RIP_CONNECT_TIMEOUT_MS`, `RIP_READ_TIMEOUT_MS`

## Internal Headers
- Worker busy signaling: `Rip-Worker-Busy: 1`
- LB strips (case‑insensitive) before responding to clients:
  - `rip-worker-busy`, `rip-worker-id`, and `date`

## Performance Notes
- Keep client concurrency (`-c`) close to worker count (`w`) for best success with strict isolation
- For peak RPS on simple endpoints, scale workers toward or slightly above core count and benchmark
- Disable access logs for perf runs; use JSON logs if needed

## File Map
```
packages/server2/
├── manager.ts       # Spawns workers, monitors, optional process hot‑reload poller
├── server.ts        # HTTP entry, control socket, LIFO selection, bounded queue, timeouts
├── worker.ts        # Per‑worker Unix socket, join/quit, single inflight, module hot‑reload
├── utils.ts         # Flag parsing, socket path helpers, logging, header utilities
├── rip-server.ts    # CLI wrapper (supports --stop)
└── README.md        # Quickstart and usage
```

## Guarantees & Tradeoffs
- Guarantees: single inflight per worker, graceful drain on restarts, deterministic dispatch via LB
- Tradeoffs: LB queue can add minimal latency under bursts; strict isolation means clients should avoid overdriving concurrency beyond worker count

---

## HTTPS/TLS/CA (Future‑Goal Notes)
- Quick self‑signed and CA‑signed localhost certs
- macOS trust flow for dev CA; export cert
- Cert reloads: on file change, reload on next LB restart; live reload may be added later behind a flag
- HTTPS modes (future flags): `https:quick|https:ca|https:smart`
- When implemented, CLI will accept `protocol:http|https|http+https` and manage both listeners
