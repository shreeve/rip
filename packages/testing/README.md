# @rip-lang/testing

Shared helpers for first-party package `test.rip` files.

```coffee
import { test, eq, ok, throws } from '@rip-lang/testing'
import { CSV } from './csv.rip'

test "simple CSV", ->
  eq CSV.read("a,b\n"), [['a','b']]
```

| Export | Role |
| --- | --- |
| `test` | Run a named case; print ✓/✗ |
| `eq` | Deep-equal via JSON; throw on mismatch |
| `ok` | Truthy assert |
| `throws` | Expect a throw (optional error class) |

The tally prints on process exit. Failures set `process.exitCode = 1`.

This is **not** the language battery harness (`test` / `code` / `fail` / `type` in `test/support/testing.js`). Packages ignore those compiler verbs.
