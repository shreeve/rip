<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Testing - @rip-lang/testing

> **Tiny Rip harness for first-party package test.rip files (test, eq, ok, throws).**

Four helpers and nothing else: run a named case, assert structural
equality, assert truthiness, assert a throw. The tally prints once on
process exit, a failed case sets `process.exitCode = 1` so CI sees it,
and the whole harness is one deliberately small file that grows only
when a concrete test cannot be written without it. This is **not** the
language battery harness (`test` / `code` / `fail` / `type` in
`test/support/testing.js`) — packages ignore those compiler verbs.

**Runtime:** not browser-safe — it owns `process` exit hooks and
writes to stdout. One `.rip` file.

## Quick Start

```bash
bun add @rip-lang/testing
```

```coffee
import { test, eq, ok, throws } from '@rip-lang/testing'
import { CSV } from '@rip-lang/csv'

test "simple CSV", ->
  eq CSV.read("a,b\n"), [['a','b']]

test "bad input rejects loudly", ->
  throws (-> CSV.read(42)), TypeError, 'expects a string'
```

## Features

- **Four exports** — `test`, `eq`, `ok`, `throws`; no runner binary, no
  config, no lifecycle hooks
- **Tally on exit** — one summary line, printed exactly once; failures
  set `process.exitCode = 1`
- **Structural `eq`** — arrays ordered, object keys unordered, scalars
  by identity; `{}` never equals `[]`
- **Refinable `throws`** — an Error class checks `instanceof`, a string
  checks message containment, both may be given in order
- **Async via `test!`** — the file awaits the case in place, so output
  stays ordered
- **Colors honor NO_COLOR / FORCE_COLOR** — and `NO_COLOR` wins when
  both are set

## The four helpers

| Helper | Contract |
| --- | --- |
| `test name, fn` | Runs `fn`; prints `✓ name` or `✗ name: reason`. Any throw is the failure reason. |
| `eq got, want` | Deep structural equality — arrays ordered, object keys unordered, scalars by identity. Throws `expected <want>, got <got>`. |
| `ok cond, msg?` | Throws `msg` (default `assertion failed`) unless `cond` is truthy. |
| `throws fn, ...refinements` | Requires `fn` to throw. An Error-class refinement checks `instanceof`; a string refinement checks message containment. |

Async cases use the dammit form so the suite stays sequential:

```coffee
test! "fetches the fixture", ->
  res = fetch! "http://localhost:#{port}/echo"
  eq res.status, 200
```

## Test

```bash
bun run test
```

The suite pins the export surface, `eq`/`ok`/`throws` semantics
in-process, and `test`'s output, tally, exit status, and color rules by
running fixture suites as real subprocesses through this repository's
`rip`.
