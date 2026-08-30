# Cart

Top rung of the [demos ladder](../README.md): a multi-route shop that proves
the full App rails — `index.rip` + `app/` + `api/` + SQLite. Products, cart,
profile, and orders — the canonical full-shape exemplar beside Pulse’s thin
live-publication demo ([docs/WORKSPACE.md](../../../../docs/WORKSPACE.md)).

It is a runnable example — nothing here is wired into CI. Like every demo, it
is free to change without asking a test suite. The live-Site contracts are
certified against `test/browser/hmr-app`, a fixture that suite owns
(`bun run test:live`).

## Layout

| Path | Role |
| --- | --- |
| `serve.rip` | Catalog entry: names the site `cart`, hosts `cart.via.rip` / `cart.local` (tray **Add Site…** target); everything else is default |
| `index.rip` | API entry: createSchema/seed, the open `hub` bridge Janus needs to admit live watch, bare `start!` handoff |
| `setup.rip` | One-shot `createSchema` + `seed` |
| `api/` | SQLite adapter, models, seed, `/api/*` handlers (not a public URL tree) |
| `app/index.html` | SPA shell (Pico + styles + `bootApp`) |
| `app/stash.rip` | `stash` — cart + `source` cells for user/products/orders plus the parametric `order` source |
| `app/routes/` | File routes + `_layout.rip` |

Client modules import `UserPublic` / etc. from `../api/models.rip`; the
bundler overlays shippable projections at that path (`:model` stays server-side).

Persistence starts on **bun:sqlite**. A follow-up swaps `api/db.rip` to
`rip/db` (DuckDB over duckdb-harbor).

## Run

With the edge up (`rip sites start edge`):

```bash
cd packages/sites/demos/cart
rip sites run --name cart
```

Open the registered site. Seeded products render; add to cart, place an
order, and edit the profile. Data lives in `api/cart.sqlite` (gitignored).
Watching mode activates the Workspace publication feed; edit a client module
under `app/` to see a live update.
