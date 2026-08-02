# Cart

A multi-route shop that proves the full app rails: `index.rip` + `app/` +
`api/` + SQLite persistence. Products, cart, profile, and orders — the
canonical full-shape exemplar beside Pulse’s thin Workspace door demo
([docs/WORKSPACE.md](../../docs/WORKSPACE.md)).

It is a runnable example — not a CI suite.

## Layout

| Path | Role |
| --- | --- |
| `index.rip` | API entry: migrate/seed, `/styles.css`, bare `start!` handoff |
| `setup.rip` | One-shot `migrate` + `seed` |
| `api/` | SQLite adapter, models, seed, `/api/*` handlers (not a public URL tree) |
| `app/index.html` | SPA shell (Pico + styles + `bootApp`) |
| `app/stash.rip` | `stash` — cart + `source` cells for user/products/orders |
| `app/routes/` | File routes + `_layout.rip` |

Client modules import `UserPublic` / etc. from `../api/models.rip`; the
bundler overlays shippable projections at that path (`:model` stays server-side).

Persistence starts on **bun:sqlite**. A follow-up swaps `api/db.rip` to
`@rip-lang/db` (DuckDB over duckdb-harbor).

## Run

With a Janus control endpoint running:

```bash
cd examples/cart
rip server index.rip --name cart
```

Open the registered site. Seeded products render; add to cart, place an
order, and edit the profile. Data lives in `api/cart.sqlite` (gitignored).
Watching mode opens the Workspace door; edit a client module under `app/`
to see a live update.
