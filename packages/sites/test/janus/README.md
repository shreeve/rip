# janus

`test.rip` runs Rip Sites through a Janus-enabled Caddy binary carrying a
non-replaced published Janus module. It rejects a local module replacement and
certifies:

- registration, heartbeat survival, and upstream swap;
- generated shell, bundle, App CSS, and weak ETag revalidation;
- `X-Sendfile` transformation and range delivery;
- cache-safe API replacement after an authored source edit;
- deregistration on clean shutdown.

Run it with:

```bash
bun run test:janus
```

The test resolves an already-built Janus Caddy binary: `JANUS_CADDY` first,
then the packaged `bin/janus`, then `caddy` on `PATH`. It performs no
build and errors when no binary exists. In every case the test rejects a
local module replacement.

Directory browsing is a Janus-owned process lease and access observation is a
separate Rip Sites client; their tests belong to the capabilities
that consume those interfaces.
