# @rip-lang/app

Dependency-free application data substrate for Rip.

The package currently provides:

- `createStash` and `unwrapStash` for source-aware application data
- `source` for lazy singleton and keyed server-backed values
- `createComponents` for in-memory component source and compiled-module storage

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

## Test

```sh
bun run test
```
