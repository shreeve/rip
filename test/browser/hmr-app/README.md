# HMR fixture

The App the refresh-tier gates run against (`bun run test:live` →
[`tests/live-hmr.spec.mjs`](../tests/live-hmr.spec.mjs)). It is owned by the
browser suite, not a demo: nothing here is written to teach, and its copy may
be rewritten freely by whoever owns the gates.

That ownership is the point. A certification fixture and a demo want opposite
things — a fixture wants to be frozen and exhaustive, a demo wants to be free
and legible — so pointing gates at a demo silently freezes the demo and leaves
coverage to whatever state the demo happens to have.

## Shape

Every element carries an `id`, so specs address anchors rather than prose.

| Path | Role |
| --- | --- |
| `index.rip` | API entry — `start()` and `/styles.css` |
| `app/routes/_layout.rip` | The ancestor a route remount must keep; `#brand`, `#hits` |
| `app/routes/index.rip` | Tier target: `count` (`:=`), `counter` (`~=`), `#bump`, `#count` |
| `app/routes/form.rip` | `#field` — focus and caret restoration |
| `app/routes/idle.rip` | Never mounted during the noop gate |
| `app/stash.rip` | `counter` — shared state a remount must not disturb |
| `app/styles.css` | The soft-refresh target |
| `app/index.html` | The shell whose edit forces a document reload |

## Reaching each tier

Tiers come from the compiler signature, not from a heuristic
(`__hmrClassify` in [`src/runtime/components.js`](../../../src/runtime/components.js)):
`props`, `gates`, and `extends` decide remount; `state` and `computed` names
decide migrate; everything else patches. So one deliberate edit reaches each:

| Tier | Edit |
| --- | --- |
| `patch` | Change render markup only — `h1#title 'home'` |
| `migrate` | Add or remove a `:=` slot — the intersecting slots are carried |
| `remount` | Add or remove an `@prop`, a gate, or change `extends` |
| `reload` | Edit `app/index.html` |
| `noop` | Edit `routes/idle.rip` while it is not mounted |
| `reject` | Append source that does not compile |

Keep those shapes when editing this fixture: the specs assert the tier a given
edit must take, so removing `count` or the `@`-less prop list would quietly
reclassify an edit and turn a gate into a tautology.
