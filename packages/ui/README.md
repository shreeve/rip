# @rip-lang/ui

First-party UI infrastructure for Rip.

The package is organized by ownership:

- `email/` — synchronous server-side email DOM, rendering, and components
- `shared/` — utilities genuinely shared by browser and email surfaces
- `tailwind/` — the sole boundary for Tailwind compilation and CSS parsing

Public APIs use named exports. Package dependencies are isolated here;
the Rip compiler root remains dependency- and workspace-free.

## Test

```sh
bun run test
```

Root battery rows exercise package/compiler/runtime integration.
