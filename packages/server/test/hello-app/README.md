# hello-app

Minimal browser-App-only Server fixture:

- authored App files under `app/`;
- Manager-generated `bundle.json`, `bundle.json.br`, and `latest.json`;
- finite Janus file roots;
- an authored or generated shell; and
- no API entry or workers.

The fixture pins the publication boundary:

1. Watch and non-watch startup produce the same two-key
   `{ hash, list }` bundle shape.
2. The list contains only the complete browser Rip source graph.
3. Private hashes for every managed App file contribute to the complete App
   hash without crossing the wire.
4. The Brotli sidecar expands to the exact `bundle.json` bytes.
5. `latest.json` contains the same complete App hash.
6. `manifest.json` is absent.
7. Exact watcher events rehash only the reported configured paths.
8. An idempotent write publishes nothing.
9. A Rip edit publishes `[path, source]`; a CSS edit publishes `[path]`; a
   deletion publishes `[path, null]`.
10. One confirmed watcher batch becomes one ordered
    `change { from, hash, list }` message.

Janus serves every public byte and transports changes without interpreting
Rip source or hashes.
