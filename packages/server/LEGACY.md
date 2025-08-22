# Rip Server Legacy Nuggets

This file preserves non-obvious, still-useful ideas from legacy docs. Use it as a checklist of concepts to consider porting into the new `packages/server` implementation.

## HTTPS and Certificate Authority (CA)
- Dev CA layout under `~/.rip-server/`:
  - `ca/` (root CA: `root.crt`, `root.key`)
  - `certs/` (per-domain: `<domain>.crt`, `<domain>.key`, `<domain>.csr`)
  - `run/` (runtime artifacts as needed)
- Modes to support when adding HTTPS to the new server:
  - `https:quick`: generate a self-signed cert on demand
  - `https:ca`: generate a CA-signed cert (using our dev CA)
  - `https` (smart): prefer CA if present, else quick
  - Optional: allow explicit cert/key file paths
- CA commands worth preserving (CLI subcommands):
  - `ca:init`: create root CA (openssl, RSA 3072, ~2 years validity)
  - `ca:trust` (macOS): add root cert to login keychain as trusted
  - `ca:export`: export `root.crt` for manual import/automation
  - `ca:info`, `ca:list`, `ca:clean`: inspection and housekeeping
- Implementation notes:
  - Use `Bun.spawn` for openssl steps; keep logic idempotent
  - macOS trust: `security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/.rip-server/ca/root.crt`
  - Add HTTPS listener alongside HTTP using the same fetch handler
- curl note for dev:
  - curl uses its own CA store; for dev either use `-k` or `--cacert <exported-ca.crt>`

## LB/Worker Operational Ideas
- Per-worker Unix sockets; each worker is single-inflight for isolation
- Rolling restarts in manager; worker cycling after `maxRequests`; module-mode hot-reload count via `maxReloads`
- LB retry on `503` with header `Rip-Worker-Busy: 1`
- Queue with `--max-queue` and `--queue-timeout-ms` to shed load/backpressure
- Blue–green swap: pre-spawn new generation, readiness probe, atomic balancer swap, drain old generation

## CLI Ergonomics (optional future polish)
- Flexible argument tokens to consider:
  - `w:auto` or `w:N` (workers), `r:N` (max requests/worker)
  - `http`, `https`, `http+https`; `https:quick`, `https:ca`
  - Bare numbers as ports; directory paths for app
  - `--json-logging` for structured logs
- Auto port probing/bump for HTTP (dev) and HTTPS (future)

## Logging, Headers, and Status
- Human-readable fixed-width logs with timestamp + timezone and two duration slots (total vs worker)
- JSON access logs fields: time, app, method, path, status, totalSeconds, workerSeconds, type, length
- `/status` endpoint returns health and counts; normalize headers to avoid proxy date skew
- Default `Cache-Control: no-store` from worker to avoid stale caches during hot reloads

## Security/HTTP Hardening Ideas (roadmap)
- Optional HTTP→HTTPS redirect flag; HSTS toggle for dev; body size/timeouts presets
- Future: HTTP/2 (ALPN), OCSP stapling; basic rate-limit; static file helper with gzip/brotli + caching controls
- Optional NCSA access log format + rotation (ops-friendly)

## Dev Experience
- Hot reload strategies:
  - Process mode: manager polls entry mtime and performs rolling restarts
  - Module mode: worker checks entry mtime at ~100ms interval; bust import cache on change
- Rate-limit file checks to reduce overhead

## De-scoped Features (not porting now)
- Platform controller, dashboard, and multi-app orchestration
- Shared-socket architecture (replaced by per-worker sockets + control socket)
- HTML dashboards and platform REST endpoints

---

## Legacy TS Snippets (for reference)

### HTTPS/TLS serve
```ts
// Example Bun HTTPS server (from legacy/server.ts)
const httpsServer = Bun.serve({
  port: httpsPort,
  tls: { cert, key },
  fetch: handleRequest,
})
```

### CA/HTTPS Concepts
- RIP_CONFIG_DIR = ~/.rip-server
- CA_DIR = ~/.rip-server/ca
- CERTS_DIR = ~/.rip-server/certs
- Helpers to consider: `hasCA()`, `ensureDirectories()`,
  `generateCACert(domain) -> { cert, key }`, `generateSelfSignedCert() -> { cert, key }`
- CLI: `ca:init`, `ca:trust`, `ca:export`, `ca:info`, `ca:list`, `ca:clean`

---

As features are ported into `packages/server`, remove items from this list or link to their new implementations.
