# Cart

A multi-route shop that proves the full app rails: `index.rip` + `app/` +
`api/` + SQLite persistence. Products, cart, profile, and orders — the
canonical full-shape exemplar beside Pulse’s thin Workspace door demo
([docs/WORKSPACE.md](../../docs/WORKSPACE.md)).

It is a runnable example — not a CI suite.

## Layout

| Path | Role |
| --- | --- |
| `index.rip` | Server entry: migrate/seed, `/styles.css`, `start! 'app'` |
| `setup.rip` | One-shot `migrate` + `seed` |
| `api/` | SQLite adapter, models, seed, `/api/*` handlers (not a public URL tree) |
| `app/index.html` | SPA shell (Pico + styles + `bootApp`) |
| `app/stash.rip` | `appStash` — cart + `source` cells for user/products/orders |
| `app/routes/` | File routes + `_layout.rip` |
| `app/types.rip` | Browser-safe public shapes (`:shape` only — `:model` stays in `api/`) |

Persistence starts on **bun:sqlite**. A follow-up swaps `api/db.rip` to
`@rip-lang/db` (DuckDB over duckdb-harbor).

## Leg 1 — standalone

```bash
cd examples/cart
rip index.rip
```

Open the printed URL. Seeded products render; add to cart, place an
order, edit the profile. Data lives in `api/cart.sqlite` (gitignored).

## Leg 2 — pooled behind Janus

With a Janus control endpoint running:

```bash
cd examples/cart
rip server index.rip --name cart --bridge /hub
```

Same app as a worker pool. Watching mode opens the Workspace door; edit
a client module under `app/` to see a live update.
