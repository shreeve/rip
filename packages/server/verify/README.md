# Rip Server verification apps

These fixtures earn the Rip Server implementation one observable capability at
a time. Each directory is independent: it owns its source, state, and
acceptance surface, and must not depend on a more advanced fixture.

Order:

1. `hello-api` — one API artifact, worker, route, and clean shutdown.
2. `workers` — readiness, concurrency, draining, failure, and recycling.
3. `hello-app` — one browser App with no API workers.
4. `reloads` — App updates and API pool replacement.
5. `operations` — hold, release, migration, and recovery.
6. `janus` — the released Janus data plane and control plane.
7. `middleware` — application-owned request policy.

Code enters `@rip-lang/server` only when one of these fixtures demonstrates why
the server, rather than Janus, Caddy, or application code, must own it.
