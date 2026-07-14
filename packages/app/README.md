# @rip-lang/app

Dependency-free application data substrate for Rip.

The package currently provides:

- `createStash` and `unwrapStash` for source-aware application data
- `source` for lazy singleton and keyed server-backed values
- `createComponents` for in-memory component source and compiled-module storage
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
transactional: the full chain mounts into staging, commits only after every
constructor and mount succeeds, then tears down the old route.

Gate failures reject `renderer.mount(info)` and reach `onError` as an `Error`
carrying `status`, `path`, `file`, and the original `error`. This package does
not provide file routing, source compilation, launch, or browser delivery.

## Test

```sh
bun run test
```
