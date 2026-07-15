# @rip-lang/app

Dependency-free application data substrate for Rip.

The package currently provides:

- `createStash` and `unwrapStash` for source-aware application data
- `source` for lazy singleton and keyed server-backed values
- `createComponents` for in-memory component source and compiled-module storage
- `buildRoutes` and `parseQuery` for the pure file-route manifest and matcher
- `createRouter` and `browserAdapter` for reactive navigation state
- `createMutation` for the write-side action primitive
- `delay`, `debounce`, `throttle`, and `hold` timing signals
- `launch` for the one application boot path, with `persistStash`
- `ariaCurrent` and `ownsAnchor` route-aware accessibility helpers
- `createRenderer` for precompiled route/layout construction with render gates

Only named exports are supported:

```coffee
import { createStash, source, createComponents } from '@rip-lang/app'

data = createStash
  user: source fetch: -> fetch! '/api/user'
  order: source fetch: (id) -> fetch! "/api/orders/#{id}"

components = createComponents()
components.write 'app.rip', 'export App = component'
```

Source reads are lazy. A direct stash read starts loading and returns `null`
until the value lands. `unwrapStash(data)` exposes source cells to framework
code that must call `ensure`, `peek`, `refetch`, or `reset` without triggering
an ordinary read.

`data.source(path, key?)` returns a per-cell handle
`{ value, loading, error, refetch, reset }` for application code — signing out
is `data.source('user').reset()`. It resolves the nearest source cell along
the path (a keyed family takes the key as the second argument); `value`,
`loading`, and `error` are reactive reads, assigning `value` seeds the cell,
and a path that does not reach a source key throws. `peek`, `reset`, and
`source` are reserved stash methods and shadow data keys of the same name.

Source kind follows JavaScript runtime arity exactly:

- `fetch: -> ...` is a singleton.
- `fetch: (signal = null) -> ...` is also a singleton and receives its
  `AbortSignal` without increasing runtime arity.
- `fetch: (key) -> ...` is keyed. The runtime passes a private
  `AbortSignal` as its second argument.

TypeScript cannot distinguish an optional parameter from a defaulted parameter
after type erasure. Signal-aware typed callbacks therefore declare their source
kind explicitly:

```ts
const user = source({
  kind: 'singleton',
  fetch: async (signal?: AbortSignal) => loadUser(signal),
});

const order = source({
  kind: 'keyed',
  fetch: async (id: string, signal?: AbortSignal) => loadOrder(id, signal),
});
```

Without `kind`, the declaration accepts only `[]` or `[K]`, matching runtime
arity inference for idiomatic Rip. Kind and callback arity must agree.

## Routes

`buildRoutes(files, root = '_route')` compiles route files into a frozen,
deterministic manifest with no browser dependency:

```coffee
manifest = buildRoutes components.listAll('_route')
manifest.match '/users/7'   # { route: { pattern, file, layouts }, params: { id: '7' } }
```

Route files map to URLs by convention: `index.rip` is `/`, `[id]` captures a
segment, `[[page]]` is optional, `[...rest]` captures the remaining path, and
a `(group)` directory adds no URL segment while contributing its
`_layout.rip`. Underscore-prefixed files and directories are not routable.
Precedence is decided per segment, left to right — static before dynamic
before optional before catch-all — and two files claiming the same URL shape
reject at build time.

`match` takes a URL pathname without query or hash. Segments are
percent-decoded before comparison, so an encoded spelling reaches its route
and a `%2F` inside a dynamic segment yields a param containing `/`; a segment
that fails to decode matches nothing. `parseQuery` turns a search string into
a plain object with `URLSearchParams` semantics: last value wins per key and
`+` reads as a space.

## Router

`createRouter` runs the navigation state machine over a route manifest,
with every host concern behind an injectable adapter — history entries,
URL reads, and scroll primitives — so the machine tests under Node and
`browserAdapter()` supplies the one History-API implementation:

```coffee
router = createRouter
  routes: buildRoutes components.listAll('_route')
  adapter: browserAdapter()
  onError: (failure) -> console.error failure.status, failure.path

router.init()
router.push '/users/7?tab=posts'
```

`current` bundles the resolved route, layout chain, params, and query
into one reactive dependency, exactly the shape the renderer consumes;
the fragment lives on `router.hash`, so an in-page anchor navigation
never looks like a route change. Params and query keep their identity
across navigations that do not change them. `push`/`replace` take
app-relative URLs (`base` joins on write and strips on read);
`hash: true` routes through the fragment. History writes land before
state commits and callback dispatch, so a redirect from `onNavigate`
supersedes a coherent history — and an unconditional redirect loop is
cut loudly after ten nested navigations. A push saves the outgoing
scroll position into the outgoing entry under `__ripScroll`, merging
with any host state, and a throttled watch keeps the current entry's
position fresh between navigations, so a departure the router cannot
intercept (back/forward) still preserves it; traversal restores the
saved position — retrying across frames while the destination is still
mounting — and leaves entries without one alone. An unmatched push
reports
`{ status: 404, path }` to `onError` and changes nothing; a traversal
to a URL the manifest no longer claims reports 404 and keeps the prior
state while the address bar owns the dead URL. `onNavigate` callbacks
receive each successful navigation and cannot break it — or each
other — by throwing. `navigating` is a writable flag the renderer owns
during mounts, read through a 100 ms grace: a navigation that finishes
inside the window never shows as navigating, so fast pages don't flash
a spinner.

## Renderer

`createRenderer` is the Node-testable render-gate consumer. It accepts an
injectable router state, app stash, precompiled component registry, and minimal
target:

```coffee
renderer = createRenderer
  router: router
  app: app
  components: components
  target: target
  onError: (failure) -> console.error failure.path, failure.status

renderer.start()
```

Route state has `{ route: { file }, layouts, params, query }`. Every listed
module must already exist in `components.getCompiled(file)`. Before any route
or layout constructor runs, the renderer unions and deduplicates static
`__gates`, resolves each gate against the raw stash, and awaits its source cell.
Keyed gates evaluate their static key function with `params` and `query`
exactly once. Renderer-resolved addressed cells and subpath tails cross into
the component runtime through private metadata; `app`, `params`, and `query`
are not component props.

Layouts construct as a real outer-to-inner ancestry chain. Browser roots
compose through the first `#content` found in top-level root order, falling
back to the first layout root when no explicit slot exists. Replacement is
transactional: whatever mounts — the full chain, or only the page when the
layout chain stays — goes into staging first and commits only after every
constructor and mount succeeds, then the outgoing instances tear down.

Navigation reuses what it can. A staying navigation (same page, same params,
same chain, query-only change) keeps the mounted page's identity and calls
its `load(params, query)`; an unchanged layout chain survives page swaps
without re-gating — unless a keyed gate now addresses a different cell,
which always rebuilds. Every other visit constructs a fresh instance.

A gate failure routes to the nearest already-gated ancestor whose class
defines `onError`: the boundary chain renders (or the living chain keeps
standing) and the failure becomes control flow — `mount` resolves null and
the global `onError` stays quiet. Without a boundary, the previous screen is
retained and the failure rejects `renderer.mount(info)` and reaches
`onError` as an `Error` carrying `status`, `path`, `file`, and the original
`error`. This package does
not provide source compilation, launch, or browser delivery.

## Launch

`launch({ bundle, ... })` is the one boot path: it builds the stash
(seed data overlays plain keys and never overwrites a source cell,
then the result is stamped as the reset baseline), loads the component
registry, derives the route manifest, and wires router and renderer
together before starting. The application declares its stash in the
bundle module `_app/stash.rip` through its `appStash` export — a stash
module without the export rejects loudly — and the `stash` option
overrides it for tests and embedding hosts. It installs `__ripApp` and `__ripRouter`; a
second launch rejects loudly, as does a malformed bundle, and
`destroy()` tears down in reverse and restores every global. Bundles
arrive as objects — fetching, compiling, and watch transports belong
to browser delivery. Every host concern (target, router adapter,
storage) is an option with the browser default applied only when
omitted, so launch tests under Node.

`persistStash(app, { local?, key?, debounce?, storage? })` projects the
stash into Web Storage: plain keys persist, source keys are skipped at
every depth, restore merges around live cells, saving debounces on the
stash write-version and flushes on dispose and page unload, and
`reset()` purges the snapshot so signing out leaves nothing behind.

## Route-aware accessibility

`ariaCurrent(router, host?)` keeps `aria-current` truthful across every
anchor the router owns — `"page"` on the exact route, `"true"` on an
ancestor path, removed everywhere else — re-running on navigation and
on DOM mutations, and never touching a mark it did not set itself. The
DOM arrives through an injectable host (`anchors()` + `observe()`), so
the walker tests under Node; the browser default walks `document`.
`ownsAnchor(router, anchor)` is the one shared ownership predicate, so
current-marking, preloading, and click interception can never disagree
about which links belong to the router. It resolves the anchor's
document href through `router.claims(url)` — base paths strip, hash
mode reads the fragment, and protocol-relative or backslashed
spellings are never owned, catch-all routes included. Marks the
application manages itself are never set over and never removed, and a
walker's own marks are cleaned when the anchor stops earning them and
when the walker disposes.

## Owned links

`interceptClicks(router, host?)` turns a plain left-click on an owned
same-origin `<a href>` into an SPA navigation: the claim's own URL
reading is pushed (query and fragment intact), and
`data-router-noscroll` keeps the scroll position. Any click
`ownsAnchor` declines — non-self target, `download`,
`data-router-ignore`, cross-origin, out-of-base, unmatched — falls
through to the browser untouched, as does every modified or non-left
click. `preloadLinks(router, renderer, host?)` warms a hovered or
focused owned link's render gates after a 50 ms settle (a pointer
brushing past never fires; the same href re-preloads only after a
3 s window) through `renderer.preload(info)`, whose cells'
freshness floor bridges the hover into the navigation without a
double fetch. Both delegate on `document` by default and accept an
injectable host (`listen(type, fn)`), so they test under Node;
`launch()` installs both and its teardown removes every listener.

## Test

```sh
bun run test
```
