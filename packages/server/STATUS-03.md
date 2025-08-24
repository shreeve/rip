# Rip Server STATUS-03 — *.local mDNS + rip.local Dashboard

Date: 2025-08-24

## Overview

This session delivered two major wins that transform local and mobile development with Rip Server:

- A reliable, zero-config LAN discovery flow using Bonjour/mDNS for clean `*.local` domains
- A professional, file-based dashboard at `rip.local` for real-time server monitoring

Together, these eliminate “what’s your IP/port?” friction and make sharing and testing on phones effortless.

---

## 1) Bonjour/mDNS — Clean LAN URLs via `*.local`

### What we implemented
- Auto-advertise `rip.local` (dashboard) and all app aliases (e.g., `labs.local`) via Bonjour/mDNS
- Register hosts internally for routing and access control
- Determine the actual listening port and log clickable URLs for each host

### How it works
- On startup, the server advertises each `*.local` alias with `dns-sd -P` (Bonjour/mDNS)
- The server logs LAN-accessible URLs for each alias, e.g.:
  - `http://rip.local:5700` (Dashboard)
  - `http://labs.local:5700` (Your app)
- These are directly clickable in most terminals

### Why it matters
- No more IP/port sharing; iPhones/iPads discover services instantly
- Professional demo flow: “Open `rip.local`” instead of “type 10.0.0.155:5700”

### Notes
- We only print URLs for ports we actually listen on (e.g., `http:5700` shows `:5700`)
- When HTTPS is used, the protocol and port reflect that (e.g., `https://rip.local:443`)
- Corner cases (dual HTTP/HTTPS, redirects, custom TLS) will be refined in a follow-up

---

## 2) `rip.local` Dashboard — Real-time, Mobile-friendly Monitoring

### Access
- `https://rip.local` (or `http://rip.local:<port>` when in HTTP-only mode)

### What it shows
- Server Status: healthy / degraded / offline with clear color and icon
- Active Workers: current worker count
- Live Uptime: ticks every second, synced to server on refresh
- Registered Hosts: all allowed hostnames (e.g., `rip.local`, `labs.local`)

### UX details
- Beautiful, responsive UI (TailwindCSS + Alpine.js via CDN; zero build step)
- Authentic Rip logo in a circular badge with tasteful hover animation
- 10‑second countdown arc around the uptime icon (buttery-smooth CSS)
- “Updated HH:MM:SS” footer reflects the last successful server refresh time
- Manual Refresh button with non-intrusive states; no flicker during silent refreshes

### Offline / Degraded behavior
- Offline: Fetch failure sets `connected = false`, pauses the arc, stops uptime, shows “OFFLINE”
- Degraded: Server responds but with zero workers → dashboard shows “degraded”

### Architecture notes
- Served from disk as `packages/server/dashboard.html` (no embedded HTML in TS)
- Alpine.js state manages: `status`, `connected`, `serverUptime`, `lastUpdated`
- Refresh cadence: silent background fetch every 10s; uptime ticks locally each second

---

## 3) Logging — Clickable, Useful URLs

We upgraded startup logs to print exactly what’s accessible on the LAN:

```
rip-server: http://rip.local:5700
rip-server: http://labs.local:5700
rip-server: app=api workers=4 url=http://localhost:5700/server
```

- `rip.local` → dashboard for everyone on the network
- `labs.local` → your app on the network
- `localhost:/server` → local health endpoint

This is vastly more useful than raw mDNS records and avoids listing ports we don’t serve.

---

## 4) Developer Flow

### Start HTTPS-first (default behavior)
```bash
bun server apps/labs/api@labs
# Logs will show https://rip.local[:443] and https://labs.local[:443] as applicable
```

### Start HTTP on a specific port
```bash
bun server apps/labs/api@labs http:5700
# Logs show http://rip.local:5700 and http://labs.local:5700
```

### Mobile testing
- Open `rip.local` on an iPhone/iPad connected to the same LAN
- Navigate to your app via `labs.local` (or whatever aliases you chose)

---

## 5) Implementation Highlights

- Host registry captures allowed hostnames (`rip.local`, `localhost`, aliases)
- mDNS advertising uses `dns-sd -P` with the correct service name and port
- `/status` endpoint exposes health, worker count, ports, hosts, uptime
- Dashboard is file-based HTML (Tailwind + Alpine) and not baked into TS
- Silent background refresh (10s) avoids UI flicker; manual refresh shows progress
- Countdown arc implemented with smooth CSS animation; no 12 o’clock flicker
- “Updated HH:MM:SS” reflects last successful fetch rather than current time

---

## 6) Known Corners / Next Steps

- Dual listeners (HTTP + HTTPS): decide what to print and how to prioritize
- Redirect scenarios: clarify printed URLs when HTTP→HTTPS redirect is enabled
- TLS modes: surface certificate info and linkable URLs consistently
- Multiple apps: consider grouped/logical output when many aliases are active
- Dashboard enhancements: mini logs, worker detail, latency sparklines

---

## 7) Quick Reference

### Typical outputs
```
rip-server: http://rip.local:5700
rip-server: http://labs.local:5700
rip-server: app=api workers=4 url=http://localhost:5700/server
```

### Status contract (server)
```json
{
  "status": "healthy | degraded",
  "app": "api",
  "workers": 4,
  "ports": {"http": 5700},
  "uptime": 123,
  "hosts": ["localhost", "rip.local", "labs.local"]
}
```

### Dashboard tech
- HTML served from disk: `packages/server/dashboard.html`
- TailwindCSS via CDN, Alpine.js via CDN (no build step)
- State: `connected`, `status`, `serverUptime`, `lastUpdated`

---

## Summary

We now have first-class *.local support and a professional `rip.local` dashboard:

- Instantly share clean LAN URLs, especially to mobile devices
- Monitor health, workers, and uptime with a smooth, modern UI
- Trustworthy, clickable URL logs reflecting exactly what’s accessible

This is a step-change in developer ergonomics and demo readiness. Further polish will focus on dual-protocol edge cases and richer dashboard metrics.

---

## Benchmarks (quick smoke tests)

Commands used:

```bash
# Start (HTTP-only) with 2x workers, large restart budget, no access logs
bun server --no-access-logs apps/labs/api http:5700 r:50000 w:2x

# wrk against entry fast-path
wrk -t4 -c200 -d10s http://localhost:5700/server

# wrk against app route
wrk -t4 -c200 -d10s http://localhost:5700/ping
```

Observed on this machine (development environment):

- `/server` (entry fast-path): ~120K+ requests/sec
- `/ping` (app route via worker): ~20K+ requests/sec

Notes:
- `/server` exercises only the entry process; `/ping` routes through a worker via Unix socket
- Disable access logs for clean numbers; leave TLS off for HTTP-only benchmarking
- Actual throughput will vary by hardware and flags (`w`, `r`, etc.)


