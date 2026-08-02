# janus

`test.rip` runs Rip Server through a Janus-enabled Caddy binary built from the
published `v1.5.0` module. It rejects a local module replacement and certifies:

- registration, heartbeat survival, doorbell activation, and upstream swap;
- generated shell, bundle, App CSS, weak ETag revalidation, and SPA routing;
- `X-Sendfile` transformation and range delivery;
- cache-safe API replacement after an authored source edit;
- deregistration on clean shutdown.

Run it with:

```sh
bun run verify:janus
```

The test builds and caches a Caddy binary from the published Janus `v1.5.0`
module with `xcaddy`. `JANUS_CADDY=/path/to/released/caddy` may supply an
existing binary instead. In both cases the test rejects a local module
replacement.

Directory browsing is a Janus-owned process lease and access observation is a
separate Rip Server client; their verification belongs to the capabilities
that consume those interfaces.
