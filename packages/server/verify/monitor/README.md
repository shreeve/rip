# Access monitor verification

Certifies the Janus v1.5 NDJSON envelope and access-event schema, exact framing,
picture parsing, Unicode display width, scaling, bounded output writes,
app-scoped subscriptions, and pretty/raw rendering.

The foreground integration remains in `verify/hello-api`: the manager subscribes
after Janus registration, prints pretty access output, aborts the stream before
deregistration, and exits cleanly.

Run:

```bash
bun run verify:monitor
```
