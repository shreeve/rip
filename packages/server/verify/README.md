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

## Capability admission

A fixture demonstrates an approved requirement; it never creates one. Before a
fixture uses a server feature, that feature must be justified by the current v4
contract, the released Janus interface, or an explicit product decision.

Old implementation code, old tests, and convenient fixture authoring are not
evidence that a feature belongs in v4. When they are the only reason a helper,
syntax form, mode, or fallback appears necessary, stop and surface the decision
instead of adding it. Fixtures use the smallest already-approved surface.
