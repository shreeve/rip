# Rip Server HTTPS (Host-based) – SPEC

## Purpose
Provide a simple, HTTPS‑first server so every app is reachable at a clean URL (Host‑based), with a single listener (443) and automatic HTTP→HTTPS redirect (80). Eliminate per‑app ports in day‑to‑day use.

## Goals
- Always‑on HTTPS in dev/staging/prod; HTTP only serves redirects (80→443).
- Route by Host header (e.g., https://labs.ripdev.io) to an app; no port management.
- Keep per‑worker Unix sockets and one‑inflight‑per‑worker isolation.
- Simple host registry and CLI/API to add/remove host→app mappings.
- Dev‑friendly certs (mkcert or step‑ca); staging/prod via Let’s Encrypt (DNS‑01).
- Preserve existing logging/access patterns; add minimal security presets.

## Non‑Goals (initial)
- No full ACME automation on day 1 (staging/prod DNS‑01 can be a follow‑up).
- No multi‑tenant platform dashboard (future). CLI/API only for registry.
- No blue‑green orchestration (rolling restarts suffice).

## Assumptions
- Domain: ripdev.io (owned). For dev: wildcard DNS may map to loopback (127.0.0.1/::1).
- Developers obtain trusted certs either per‑host (mkcert) or via a community dev CA (step‑ca).
- Mobile testing requires mapping hostnames to a LAN IP and trusting the dev CA on the device.

## High‑level Architecture
- Server: single Bun.serve on 443 (TLS) and 80 (redirect only). Routes by Host to app workers.
- Manager: spawns workers; informs gateway which hostnames map to which app (join/quit host registry).
- Worker: unchanged core; per‑worker Unix sockets; hotReload modes (none|process|module) preserved.

## Routing
- Incoming request → parse Host (SNI + Host header)
- Lookup host→app in registry; if not found: 404 (or configurable 502).
- Forward to selected app’s per‑worker socket using existing selection logic (retry on `Rip-Worker-Busy`).
- Strip internal headers on response; normalize date header as today.

## TLS & Certificates
- Dev:
  - Option A: mkcert per developer
    - mkcert app.ripdev.io (or wildcard on their machine)
    - Configure LB with cert/key paths via flags or env
  - Option B: step‑ca (community dev CA)
    - Developers trust CA root locally
    - Issue per‑host certs via ACME/CSR; private keys stay on dev machines
- Staging/Prod:
  - Let’s Encrypt DNS‑01 wildcard certs (e.g., *.stg.ripdev.io, *.ripdev.io)
  - Store PEMs securely; hot‑reload certificates with zero downtime

## HTTP → HTTPS
- 80 listens, responds 301 Location: https://host/path?query
- Optional exceptions: ACME challenges; otherwise redirect all.

## Configuration & Flags
- Flags/env (via `parseFlags()` in `utils.ts`):
  - `--https-port=<n>` (default: 443; null disables)
  - `--http-port=<n>` (default: 80; null disables)
  - `--cert=<path.pem>` `--key=<path.pem>` (PEM strings also accepted via env)
  - `--hsts` (default: off in dev; on in staging/prod)
  - Timeouts/body: `--connect-timeout-ms`, `--read-timeout-ms`, `--max-request-body`
  - Logging: `--json-logging`
  - Hot reload: `--hot-reload=none|process|module`
- Host registry persistence (initially in‑memory; optional JSON file for dev convenience)

## CLI Overview (Current vs Proposed)

### Current (already supported by `parseFlags()`)
- Positional:
  - `<app-path>`: absolute or relative; resolves to entry via `resolveAppEntry()`
- Order‑independent tokens:
  - `http:<PORT>`: override HTTP port (currently used for entry listener)
  - `w:<N>` / `w:auto`: workers count (number or `auto` = CPU cores)
  - `r:<N>`: max requests per worker
  - `--max-reloads=<N>`: max module reloads before cycling
  - `--json` or `--json-logging`: enable structured logs
  - `--no-access-log`: disable human access logs
  - Queue/Timeouts:
    - `--max-queue=<N>`
    - `--queue-timeout-ms=<N>`
    - `--connect-timeout-ms=<N>`
    - `--read-timeout-ms=<N>`
  - Hot reload:
    - `--hot-reload=none|process|module` (default: `module` in dev, `none` in prod)
  - Misc:
    - `--socket-prefix=<name>`: override socket naming prefix
  - Control:
    - `--stop`: best‑effort stop of running server processes

Examples (current style):
```bash
bun server apps/labs/api http:5002 w:auto r:10000 --json-logging --queue-timeout-ms=2000
```

### Proposed additions (this SPEC)
- HTTPS + TLS:
  - `https:<PORT>`: enable HTTPS listener on port (mirrors `http:<PORT>` style)
  - `--https-port=<PORT>`: explicit flag (alternative to token)
  - `cert:<PATH>` / `key:<PATH>`: token form for TLS material
  - `--cert=<PATH>` / `--key=<PATH>`: flag form for TLS material
- Redirect & HSTS:
  - `--redirect-http` (default on): enable 80→301 to HTTPS
  - `--no-redirect-http`: disable redirect
  - `--hsts`: send HSTS header (default off in dev; on in staging/prod)
  - `--no-hsts`: disable HSTS
- Host registry (subcommands; separate from worker join/quit):
  - `host add <host> <app-path>`
  - `host remove <host>`
  - `host list`

Notes:
- Maintain order‑independent, orthogonal tokens. Where practical, prefer `token:value` forms (`http:`, `https:`, `cert:`, `key:`) with equivalent `--flag=value` alternatives.
- V1 registry can be in‑memory only; persistence can follow.

## Host Registry & CLI/API
- Registry shape: `{ host: string, appPath: string, createdAt, updatedAt }`
- Control operations (via control socket/API):
  - `host:add { host, appPath }`
  - `host:remove { host }`
  - `host:list`
- CLI UX (examples):
  - `bun server host add labs.ripdev.io apps/labs/api`
  - `bun server host remove labs.ripdev.io`
  - `bun server host list`
- Manager integrates with registry so worker lifecycle aligns with host mappings (spawn on add; stop on remove).

## Logging & Metrics
- Keep existing human logs and JSON logs. Include host name and app name in records.
- `/status` returns server health and per‑host mapping counts (no secrets).

## Security Defaults
- HTTPS‑only by default; HTTP only for redirects.
- `Cache-Control: no-store` by default on worker responses.
- Optional HSTS flag (`off` in dev; `on` in staging/prod).
- Body size/timeouts sane defaults; rate‑limit is future work.

## Backward Compatibility & Migration
- Existing single‑app mode (hostless) remains via a default host mapping if desired (e.g., when Host not found and one app configured).
- Port‑based workflows still possible by bypassing the server for advanced users (not the default path).

## Milestones
1) HTTPS Core
- Add TLS flags; serve on 443 with provided cert/key
- 80→301 redirect; preserve existing selection logic

2) Host Routing + Registry
- In‑memory registry; Host lookup → app
- CLI/API for host add/remove/list
- Manager spawns/stops workers based on host mappings

3) Dev Cert UX
- Document mkcert quickstart
- Optional: integrate step‑ca instructions; helper commands to print cert info

4) Polish & Presets
- HSTS flag; timeouts/body presets
- Logs include host/app
- Minimal persistence for registry in dev (JSON file)

5) Staging/Prod TLS (Follow‑up)
- DNS‑01 automation scripts (certbot/acme.sh) for wildcards
- Hot reload certs; optional HTTP/2

## Acceptance Criteria
- Can browse https://labs.ripdev.io (dev) with trusted HTTPS and no browser warnings
- HTTP on 80 redirects to HTTPS
- Adding a host via CLI immediately serves that app (no port juggling)
- WebSockets work end‑to‑end
- JSON logs include host and durations
- Removing a host stops routing; 404 thereafter

## Open Questions
- Registry persistence scope (ephemeral vs. simple file vs. proper store)
- Default behavior when Host not found (404 vs. default app)
- ACME automation ownership (server vs. ops scripts)

## References Pulled From LEGACY.md
- TLS example (Bun.serve tls: {cert, key})
- CA folder conventions (RIP_CONFIG_DIR/ca|certs|run)
- HTTPS modes (quick|ca|smart) – simplified to HTTPS‑only + cert flags
- Security presets (HSTS toggle; no‑store; timeouts)
