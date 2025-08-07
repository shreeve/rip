# Server v1 Checklist (Done-ish)

Goal: a stable, predictable server suitable for local dev and simple production, while the new language pipeline evolves in parallel.

## CLI & Lifecycle
- [ ] Harmonize `bun server` and `rip-server` behavior/flags
- [ ] Idempotent start/stop/status with clear exit codes
- [x] `status --json` machine-readable output
- [ ] Config precedence: CLI > package.json > bunfig.toml (documented)

## HTTPS/CA
- [ ] Reliable CA init/trust; clear messaging and docs
- [ ] Cert listing/cleanup flows work on macOS; docs for others
- [ ] Renewal/update guidance (zero-downtime steps)

## Manager/Worker Stability
- [ ] Graceful shutdown/restart with bounded backoff on crash loops
- [ ] Readiness/health checks; worker startup timeout
- [ ] Sequential per-worker handling validated under load

## Observability
- [ ] Consistent request logs
- [ ] `/metrics` endpoint with basic counters (Prometheus-friendly)
- [ ] Minimal tracing hooks (optional)

## Platform Controller
- [ ] REST: deploy/list/scale/restart/undeploy/stats stable
- [ ] Dashboard reflects state accurately; idempotent actions
- [ ] Clear error messages on invalid input or missing app

## Packaging & DX
- [ ] Global install instructions verified
- [ ] Example scripts for common workflows
- [ ] E2E smoke test: start, serve sample app, HTTPS check, stop

## Docs
- [ ] Task-focused quick start
- [ ] Troubleshooting and production notes

Notes:
- Keep CoffeeScript in `/coffeescript` (or move to `packages/coffeescript`) as an interim compiler; do not couple server to the clean `packages/lang` compiler yet.

