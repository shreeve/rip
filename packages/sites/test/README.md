# Rip Sites test apps

These fixtures earn the Rip Sites implementation one observable capability at
a time. Each directory is independent: it owns its source, state, and
acceptance surface, and must not depend on a more advanced fixture (`janus`
and `operations` reuse the `reloads/project` fixture as their App source).

Order:

1. `framework` — public routing, response, validation, and context contract.
2. `hello-api` — one API artifact, worker, route, and clean shutdown.
3. `workers` — readiness, concurrency, draining, failure, and recycling.
4. `hello-app` — one browser App with no API workers.
5. `publication` — canonical browser Rip bundle assembly.
6. `reloads` — App updates and API pool replacement.
7. `operations` — hold, release, migration, and recovery.
8. `manager-boundary` — declaration, finite file policy, and standalone browse.
9. `middleware` — application-owned request policy.
10. `monitor` — Janus access protocol, framing, formatting, and foreground output.
11. `appliance` — `sites.json` catalog, edge-scoped control, unified
    `rip sites` lifecycle (no separate edge/site CLIs).
12. `janus` — the released Janus data plane and control plane.

Code enters `rip/sites` only when one of these fixtures demonstrates why
the server, rather than Janus, Caddy, or application code, must own it.

## Capability admission

A fixture demonstrates an approved requirement; it never creates one. Before a
fixture uses a server feature, that feature must be justified by the current v4
contract, the released Janus interface, or an explicit product decision.

Implementation code, tests, and convenient fixture authoring are not evidence
by themselves that a feature belongs in v4. A helper, syntax form, mode, or
fallback requires a current contract or explicit product decision. Fixtures use
the smallest approved surface.
