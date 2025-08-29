<img src="assets/logo.png" alt="Rip" height="75" />

## Rip Server — Fast, resilient app server for dev → prod

Rip Server runs your app with serious speed and durability. It starts instantly for local work, scales across multiple workers, survives failures, reloads gracefully, and ships with a live dashboard and clean `.local` access for phones on your LAN.

### Why Rip Server
- **High performance**: Minimal server overhead and efficient worker forwarding. On typical hardware, server health checks hit 100K+ RPS; app routes commonly reach tens of thousands RPS.
- **Resilient by design**: If a worker crashes, the server keeps serving with the remaining workers and the manager brings a fresh one online. Rolling restarts replace workers without dropping in‑flight requests.
- **HTTPS‑first**: One command brings up TLS (cert/key, mkcert, or self‑signed fallback). Optional HTTP→HTTPS redirect and HSTS.
- **Instant local access**: Declare aliases like `apps/api@mobile` and get `mobile.local` on your LAN via Bonjour/mDNS. The dashboard lives at `rip.local`.
- **Developer‑friendly**: Live dashboard, structured logs, smart defaults, and quick, orthogonal flags for workers, timeouts, and reload modes.

---

## Quick start

```bash
# Start your app (HTTPS by default; auto‑probes a free port if needed)
bun server apps/labs/api

# Add clean LAN aliases (great for phones/tablets)
bun server apps/labs/api@api,mobile,demo

# Prefer HTTP-only with a specific port
bun server http:5700 apps/labs/api

# See allowed hosts; stop the server
bun server list
bun server stop
```

What you get immediately:
- `rip.local` → live server dashboard (status, workers, uptime, ports, hosts)
- `api.local` → your app (from the aliases above)

---

## The short version (how it works)

- Rip Server runs a server process that accepts requests and forwards them to a pool of isolated workers.
- Each worker handles one request at a time. The server picks an idle worker (LIFO) to keep caches warm and tail latencies low.
- If a worker is busy, the server retries another. If a worker dies, the server removes it and continues serving; the manager respawns a fresh one.
- Rolling restarts spin up new workers first, switch traffic to them, then retire the old ones—so you can redeploy under load without dropping requests.

That’s the resilience headline: one misbehaving worker doesn’t take the system down.

---

## Features at a glance

- **Performance**
  - Efficient forwarding over Unix sockets
  - LIFO worker selection for warm caches
  - Bounded queue with timeout and back‑pressure

- **Resilience**
  - Crash containment per worker; manager with exponential backoff
  - Rolling restarts (spawn‑before‑kill), version‑aware routing
  - Resource budgets: max requests / seconds / reloads per worker

- **Developer velocity**
  - Dashboard at `rip.local` (no build step; Tailwind + Alpine from CDN)
  - Module‑reload mode for fast edit‑save‑reload loops
  - Process‑reload mode for clean, deterministic rolls

- **Security & networking**
  - HTTPS‑first with `--cert/--key`, `--auto-tls` (mkcert), or self‑signed fallback
  - Optional `--hsts` and HTTP→HTTPS redirect
  - mDNS `.local` aliases for effortless phone testing

- **Observability**
  - Human or JSON access logs (per‑request total/worker durations)
  - `/server` health (plain text), `/status` JSON (status, workers, uptime, ports, hosts)

---

## Launch recipes

```bash
# Scale workers (auto = cores)
bun server apps/labs/api w:auto
bun server apps/labs/api w:half   # default
bun server apps/labs/api w:6

# Set restart budgets (whichever triggers first)
bun server apps/labs/api r:20000
bun server apps/labs/api r:20000,1800s
bun server apps/labs/api r:20000,1800s,10r   # module reload mode uses reload budget

# Timeouts, queueing, and logging
bun server apps/labs/api --queue-timeout-ms=2000 --max-queue=8192 \
  --connect-timeout-ms=200 --read-timeout-ms=5000 --json-logging

# HTTPS options
bun server apps/labs/api                       # try 443 then probe 5700+
bun server 5700 apps/labs/api                  # HTTPS on explicit port
bun server --cert=/full/path.pem --key=/full/key apps/labs/api
bun server --auto-tls apps/labs/api            # mkcert → self‑signed fallback
bun server --no-redirect-http apps/labs/api    # disable 80→HTTPS redirect

# HTTP-only (no TLS)
bun server http apps/labs/api                  # try 80 then probe 5700+
bun server http:5002 apps/labs/api

# Aliases (mDNS)
bun server apps/labs/api@api,labs,mobile       # api.local, labs.local, mobile.local
```

---

## Production‑ready behavior

- **Zero‑downtime rolls**: New workers start first and advertise a higher version. The server routes only to the latest, then retires old workers.
- **Crash resilience**: If a worker exits unexpectedly, traffic continues through the rest; the manager respawns a replacement with backoff.
- **TLS you control**: Bring your own certs, lean on mkcert for dev, or use self‑signed when nothing else is available.
- **Predictable defaults**: HTTPS‑first, access logs on (human), JSON logs opt‑in.
- **Back‑pressure**: Bounded queues and request/worker budgets help protect your app under load.

---

## Dashboard (`rip.local`)

Open `https://rip.local` (or `http://rip.local:<port>` in HTTP‑only mode) to see:

- Server status: healthy / degraded / offline
- Active workers and live uptime
- Current ports (HTTP/HTTPS)
- Registered hosts (your `.local` aliases)

The dashboard refreshes silently every 10s and handles offline/degraded states gracefully.

---

## Status & health endpoints

```bash
curl http://localhost:<port>/server   # "ok"
curl http://localhost:<port>/status   # JSON: { status, app, workers, ports, uptime, hosts }
```

---

## Notes for macOS developers (low ports)

On recent macOS versions, binding port 80/443 without sudo is possible when listening on all interfaces (`0.0.0.0`), which exposes your server on your LAN. Prefer high ports (e.g., 5700+) for localhost‑only dev, or use sudo with `127.0.0.1` if you need low ports without LAN exposure.

---

## FAQ

**Does it handle WebSockets?** Yes, sockets are forwarded end‑to‑end through workers.

**Why not one giant process?** Small, replaceable workers isolate failures and memory growth, and make rolling updates reliable. The server process stays lean and predictable.

**Do I have to learn a framework?** No. Start your app entrypoint (`index.rip` or `index.ts`) and handle requests. Rip Server focuses on running it fast and safely.

---

## TL;DR

Rip Server is a fast, resilient app runner with a live dashboard and `.local` access, designed to get you from quick iteration to confident, zero‑downtime production—without ceremony.

---

Built with ❤️ for high-performance Rip applications.
