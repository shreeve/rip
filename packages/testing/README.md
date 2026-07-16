<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" style="width:50px" /> <br>

# Rip Testing - @rip-lang/testing

> **Tiny Rip harness for first-party package `test.rip` files (`test`, `eq`, `ok`, `throws`).**

Shared helpers for package suites. The tally prints on process exit;
failures set `process.exitCode = 1`. This is **not** the language
battery harness (`test` / `code` / `fail` / `type` in
`test/support/testing.js`) — packages ignore those compiler verbs.

```coffee
import { test, eq, ok, throws } from '@rip-lang/testing'
import { CSV } from '@rip-lang/csv'

test "simple CSV", ->
  eq CSV.read("a,b\n"), [['a','b']]
```

| Export | Role |
| --- | --- |
| `test` | Run a named case; print ✓/✗ |
| `eq` | Deep-equal via JSON; throw on mismatch |
| `ok` | Truthy assert |
| `throws` | Expect a throw (optional error class) |
