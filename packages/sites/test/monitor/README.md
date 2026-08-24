# Access monitor test

Certifies the Janus v1.5 NDJSON envelope and access-event schema, exact framing,
picture parsing, exhaustive Unicode display width, scaling, field bounds,
attacker-sized framing, generation cuts, reconnect ordering and jitter,
bounded output backpressure, temporary listener cleanup, app-scoped
subscriptions, and pretty/raw rendering.

The foreground integration remains in `test/hello-api`: the manager subscribes
after Janus registration, prints pretty access output, and exits cleanly. (The
manager aborts the stream before deregistration; no test asserts that
ordering.)

Run:

```bash
bun run test:monitor
```
