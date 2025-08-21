## rip-server vs. nginx + unicorn

### Summary
- Goal: feature parity with nginx + unicorn for zero-downtime, TLS, process management; exceed them in developer UX and integrated platform capabilities.

### Deploys / Zero‑downtime
- nginx + unicorn
  - Master/worker model; HUP/USR2 phased restarts; drain old workers; zero 503s
- rip-server
  - Blue‑green hot reload (default): pre‑spawn new generation (green), readiness probe over Unix sockets, atomic balancer swap, drain old (blue)
  - Result: zero stale responses and zero 503s under swap

### TLS and Ports
- nginx
  - Robust TLS: HSTS, OCSP stapling, HTTP/2, ALPN, auto 80→443 redirects
- rip-server
  - HTTPS modes: quick (self‑signed), ca (dev CA), smart (auto choose)
  - Dual bind http+https; dev CA utilities (init/trust/export)
  - Gap: HTTP/2/ALPN, HSTS, OCSP, built‑in 80→443 redirect (roadmap)

### Load Balancing / Process Model
- nginx (+ upstreams) + unicorn
  - Reverse proxy with upstream pools, retries, keepalive
  - Unicorn prefork workers; TTIN/TTOU scale; phased restart
- rip-server
  - Manager + workers via Unix sockets, round‑robin; per‑worker request caps (`r:N`); blue‑green swap
  - Gap: upstream retries/keepalive knobs (roadmap)

### Routing / Proxy Features
- nginx
  - Powerful routing/rewrites, buffering, body size/timeouts
- rip-server
  - App‑level routing (Hono/@rip/api) behind internal load balancer
  - Gap: reverse‑proxy features (buffering, upstream proxying, body limits) (roadmap)

### Static Files / Compression
- nginx
  - High‑performance static, gzip/brotli, cache/etag
- rip-server
  - App‑handled today
  - Gap: optional static middleware with gzip/brotli + caching controls (roadmap)

### Observability / Ops
- nginx
  - Access/error logs, stub_status/metrics
- rip-server
  - Fixed‑width screen logs or `--json-logging`; `/health`, `/metrics`
  - `status --json` with exit codes; targeted `stop`; PID tracking
  - Dashboard with per‑port health badges; platform API
  - Gap: NCSA/ELF access log format, rotation, compression (optional roadmap)

### Developer Ergonomics
- nginx + unicorn
  - Config‑heavy; external deploy tooling
- rip-server
  - Single CLI; flexible args (any order); hot reload; blue‑green by default
  - Dev CA auto‑certs; platform deploy/scale/restart/list; web dashboard

### Platform Orchestration
- nginx + unicorn
  - Typically systemd/capistrano/ansible
- rip-server
  - Built‑in platform controller (multi‑app). REST API + dashboard

### Security / Hardening
- nginx
  - Mature hardening presets (headers, rate‑limit, WAF)
- rip-server
  - TLS dev CA; default no‑store response headers to avoid 304 staleness
  - Gap: HSTS, redirect to HTTPS, rate‑limit, body limits, timeouts, security headers presets (roadmap)

### Performance
- nginx
  - Highly tuned C proxy; buffered I/O
- rip-server
  - Bun + Unix sockets; lean app path
  - Gap: advanced proxy buffering knobs (roadmap)

---

## rip-server advantages over nginx + unicorn (out‑of‑the‑box)
- Blue‑green deploys via CLI (no config files)
- Dev CA with quick/ca/smart and auto‑gen certs on platform deploy
- `status --json` with exit codes, targeted `stop`/`--force`, PID tracking
- Platform controller + dashboard with per‑port health
- Request caps per worker (rolling restarts), flexible CLI (`w:N`, `r:N`, any order)
- Built‑in JSON logging format or fixed‑width screen logs
- Rip language ergonomics and `@rip/api` helpers for rapid API dev

---

## Gaps to close (roadmap)
- Protocol/TLS
  - HTTP/2 + ALPN; HSTS; 80→443 redirect; OCSP stapling; optional ACME/Let’s Encrypt auto‑renew
- Reverse proxy
  - Upstream retries/health; keepalive tuning; timeouts; body‑size limits; buffering controls
- Static/compression
  - Static file server with gzip/brotli; cache/etag control
- Security/ops
  - Rate limiting; security headers presets; optional NCSA access log; log rotation

---

## Current status (implemented)
- Multi‑process (server → manager → workers) with Unix sockets
- Blue‑green hot reload with readiness and atomic swap; drain old
- http/https/http+https; TLS quick/ca/smart; platform deploy auto‑certs
- `--json-logging` or fixed‑width logs; `/health`, `/metrics`
- `status --json` with exit codes; targeted `stop`; `--force` port free; PID files
- Platform controller (deploy/scale/restart/list); dashboard with per‑port badges
- Flexible CLI; per‑worker request caps; default no‑store caching headers

---

## Next priorities
1) HTTPS port auto‑bump; HTTP→HTTPS redirect flag; HSTS (dev toggle)
2) Readiness timing polish (reduce “not ready” noise) and swap metrics in status
3) Optional static + gzip/brotli; basic rate‑limit/body size/timeouts presets
4) HTTP/2 (ALPN) support
5) Optional NCSA access log format + rotation
