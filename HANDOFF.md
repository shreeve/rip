# HANDOFF — session launch document (2026-08-02)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run browser-bundle`.

## Active branch

**Branch: `rip-server-fixes`** with an uncommitted Rip Server
module-boundary burn-down.

Current working-tree facts:

- `server.rip` owns the documented Sinatra framework, including routing,
  Web middleware, filters, validation, request context, OpenAPI, `@cache`,
  and `@send`; `worker.rip` remains the artifact-only process host.
- `manager.rip` owns strict `serve.rip` normalization, finite Janus file
  roots, standalone browse leases, worker supervision, App publication,
  operations, and access observation.
- `browse: false` is omitted; the project root is never implicitly public.
- manager registrations retry bounded stale `409` claims, manager control
  files live in an ownership-checked per-user `0700` runtime directory, and
  control commands reject startup-only flags.
- focused package fixtures live under `packages/server/test/`; scripts are
  `test:*`. The broad root test and the `temp/` burn-down directory are gone.
- `monitor.rip` is internal to the manager; the package exports only the
  framework root and `./middleware`.

Live verification:

- `bun run test:all` — 21 lanes, 7,967 tests passed.
- `packages/server`: 84 tests passed, including released Janus v1.5.
- `git diff --check` — passed.
- One cold review completed; all actionable findings were fixed and pinned.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
