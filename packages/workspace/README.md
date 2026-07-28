<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Workspace - @rip-lang/workspace

> **Reactive bag of component passports for the browser — populate, set, seal, plus a drop-in component store view — zero dependencies**

The Workspace holds one record per component — a **passport**:
`{ id, path, rev, source, compiled? }`. The id is stable and
path-derived at birth; the path is a label, so renames keep the id.
Producers (first load, disk watch, an editor) all mutate the same bag
through the door — `populate` seeds it, `set` applies rev-keyed cells,
`seal` locks it for production — while the app reads it through a
path-keyed view that implements the exact `ComponentsStore` interface
from `@rip-lang/app`, ready for `launch()` to accept as an injected
store.

This is the **experimental Workspace door bag** governed by
[docs/WORKSPACE.md](../../docs/WORKSPACE.md) (version 0.0.0, matching
`@rip-lang/app`). Wire formats, cell signing, hashes, manifests, and
the hub/WebSocket subscriber are open research there — this package is
records + door + view, nothing more.

**Runtime:** browser-safe (`rip.browser: true`). One `.rip` file.

## Quick Start

```bash
bun add @rip-lang/workspace
```

```coffee
import { createWorkspace } from '@rip-lang/workspace'

ws = createWorkspace()

# Birth: seed the bag from a ledger (ids minted by the server)
ws.populate [
  { id: 'c1', path: 'app.rip',        rev: 3, source: 'export App = component' }
  { id: 'c2', path: 'routes/hi.rip',  rev: 1, source: 'export Hi = component' }
]

# Live mutation: rev-keyed cells through the door
ws.set { id: 'c1', rev: 4, source: 'export App = component\n  render null' }   # true
ws.set { id: 'c1', rev: 4, source: 'stale duplicate' }                         # false — ignored

# The app-facing store view (ComponentsStore, path-keyed)
ws.read 'app.rip'
ws.watch (event, path) -> console.log event, path
ws.write 'routes/new.rip', 'export New = component'   # mints a local id

# Production lock
ws.seal()
```

## Features

- One passport record type: `{ id, path, rev, source, compiled? }`
- Stable ids — path-derived at birth; renames re-label, never re-identify
- `populate` is birth: rejects on a non-empty bag, duplicate ids, or duplicate paths, and commits atomically
- `set` is a rev cursor: a cell whose rev is not newer than the bag's is ignored (returns `false`, no event) — the stale/duplicate-ding defense
- `seal` is a production lock: every mutating operation afterwards throws loudly; reads keep working
- Drop-in `ComponentsStore` view — same methods, same validation, same watch events as `@rip-lang/app`
- `passport(pathOrId)` inspection returns a defensive copy
- Zero runtime dependencies, browser-safe

## The door

| Operation | Meaning |
|---|---|
| `populate(cells)` | Seed an empty bag with passport records; ids are taken as given (the server mints them). Fires no watch events — populate precedes observation. |
| `set(cell)` | Apply one rev-keyed cell: `{ id, rev, source?, compiled?, path?, deleted? }`. Returns `true` when applied, `false` when the rev is stale. |
| `seal()` | Lock the bag. `populate`, `set`, `write`, `del`, `load`, and `setCompiled` all throw afterwards; sealing twice throws. |

`set` semantics, in full:

- An **unknown id** with a full record shape (`id`, `path`, `rev`,
  `source`) creates the passport and fires `('create', path)`; a
  partial record for an unknown id throws.
- An **existing id** requires `rev` strictly greater than the bag's
  current rev; anything else returns `false` and does nothing.
- New `source` without `compiled` clears the old projection (matching
  the store view's write-clears-compiled semantics); `compiled` alone
  swaps the projection. Applied mutations fire `('change', path)`.
- A new `path` **re-labels** the id: path-keyed observers see
  `('delete', oldPath)` then `('create', newPath)`; `passport(id)`
  shows the same id throughout.
- `deleted: true` removes the record (rev-guarded like any set) and
  fires `('delete', path)`. A delete for an id the bag no longer holds
  returns `false` — the replayed-ding defense again.

## The store view

The full `ComponentsStore` interface from `@rip-lang/app`, path-keyed
over the bag: `read`, `write`, `del`, `exists`, `size`, `list`,
`listAll`, `load`, `watch`, `getCompiled`, `setCompiled`. `write` to
an existing path bumps that passport's rev by 1; `write` to a new path
mints a local id (the birth path itself) at rev 0. `load` is bulk
write and, like the app store, fires no watch events. Watchers are
error-isolated: one throwing watcher never silences the rest.

One deliberate deviation: `setCompiled` for a path with no passport
throws — a projection with no passport has no home in the bag.

## Inspection

```coffee
ws.passport 'c1'          # by id  → { id, path, rev, source, compiled }
ws.passport 'app.rip'     # by path → same record (defensive copy)
ws.sealed()               # false until seal()
ws.ids()                  # every passport id
ws.paths()                # every path label
```

## Test

```bash
bun run test
```

The suite pins the package surface (exports, zero-dependency posture,
browser safety), interface parity with the app's component store, the
door rules (populate birth, the set rev cursor, rename identity), and
the seal lock.
