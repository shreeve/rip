<img src="../../../docs/assets/rip.png" alt="Rip" width="50" />

# Packaged Sites demos

Three runnable Apps that climb the Rip Sites stack. Permanent contracts
live in [`docs/SERVER.md`](../../../docs/SERVER.md) and
[`docs/WORKSPACE.md`](../../../docs/WORKSPACE.md).

| Demo | Job | Open when you want to… |
| --- | --- | --- |
| [`hello`](hello) | Workspace publication + watch policy | See Rip source `update`, CSS refresh, and asset invalidate without a product UI |
| [`pulse`](pulse) | Live remount + Hub collaboration | Edit `app/mood.rip`, watch badges update; post in two windows |
| [`cart`](cart) | Full App rails | Routes, stash/`source`, mutations, schema models, sessions — also `test:cart` |

```text
hello  →  prove the feed
pulse  →  feel live apply + collab
cart   →  ship-shaped App
```

Each demo is a project directory with `serve.rip` (catalog name + hosts +
Hub bridge). From the tray: **Add Site…** and select that directory — or:

```bash
rip sites add packages/sites/demos/hello
rip sites start hello
rip sites open hello
```

Same pattern for `pulse` and `cart`. Edge TLS and Janus are system-wide
(`rip sites start edge`); demos do not ship their own Caddyfile.
