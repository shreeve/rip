<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip DB

> **DuckDB over duckdb-harbor — connect(), module-level sql, MCP stdio server, and rip-db CLI.**

The client tier for a running
[duckdb-harbor](https://github.com/shreeve/duckdb-harbor) instance. The
wire itself — HTTP transport, sessions, NDJSON reading, the typed error
taxonomy, temporal encode/decode, timeouts, and cancellation — is the
core runtime's DuckDB substrate (`src/runtime/duckdb.js`), shared with
the `schema :model` ORM; this package re-exports that adapter and layers
the client ergonomics on top: a process-wide default (`connect` +
module-level `sql` / `findOne` / `findAll` / `transaction`), a
materializing client (`createClient`) with a retrying transaction
runner, a boot-time reachability probe, an MCP stdio server for
assistants, and the `rip-db` dump/load/checkpoint CLI. Harbor is never
vendored; every network edge goes through an injectable `fetch`, so
protocol behavior tests without a live database.

For typed models — fields, scopes, relations, hooks, migrations — and
the adapter contract those ride on, see
[docs/ORM.md](../../docs/ORM.md). Both tiers share one adapter after
`connect!`, so an app using raw SQL beside its models configures once.

**Runtime:** not browser-safe — talks to harbor over HTTP (`fetch`),
the CLI/MCP paths use the filesystem and `node:readline`, and the
`rip-db` bin is a stdio server when run as `rip-db mcp`. One `.rip`
file, which is itself the `rip-db` binary (first line
`#!/usr/bin/env rip`).

**Mental model:** this package does not embed or start DuckDB. Harbor
runs inside a DuckDB process and speaks HTTP; Rip DB is the client.
`connect!` installs a process-wide default so `findOne!` and schema
`:model` share one connection. Starting and stopping harbor is outside
this package (keep the DuckDB process up yourself).

## Quick Start

### 1. Start harbor (once)

```sql
INSTALL harbor FROM community;
LOAD harbor;
CALL harbor_serve(bind := '127.0.0.1', port := 9495);
```

Keep that DuckDB process open — when it exits, harbor exits with it.

```bash
export RIP_DB_URL=http://127.0.0.1:9495
```

### 2. Query from Rip

Use Rip's dammit operator (`!`) to call and await in one step.

```coffee
import { connect, ensureRunning, findOne, findAll, sql, transaction } from 'rip/db'

ensureRunning!    # fail fast if harbor is down
connect!          # process default from env (or connect! url)

# Positional ? params — never interpolate values into SQL strings
user  = findOne! 'SELECT * FROM users WHERE id = ?', [1]
list  = findAll! 'SELECT * FROM users WHERE active = ?', [true]
count = (sql! 'SELECT count(*) AS n FROM users').rows[0].n

newId = transaction! (tx) ->
  (tx.one! 'INSERT INTO users (name) VALUES (?) RETURNING id', ['Grace']).id
```

`connect` installs a process-wide default and rewires it on later
calls. Skip it and the first `sql!` call lazy-connects from env.
Power users can still build `harborAdapter` + `createClient` by hand.

### 3. Ops CLI (same env)

```bash
rip-db ping                  # harbor up? prints url + database name
rip-db dump                  # → <db>-YYYYMMDD-HHMMSS.tar.gz
rip-db load snapshot.tar.gz  # refuses unless the target DB is empty
rip-db checkpoint [--force]
rip-db mcp                   # MCP stdio server for AI assistants
```

Runnable smoke script (harbor already up):

```bash
rip packages/db/example.rip
```

## Features

- **`connect()`** — installs the process default (harbor adapter +
  client); soft-wires schema `:model` when that runtime is loaded
- **Module-level API** — `sql` / `findOne` / `findAll` /
  `transaction` / `begin` over that default, plus `show` — pretty-prints
  an envelope / rows array / row / promise / query builder
- **Client surface** — materialize to row objects, `sql` / `rows` /
  `one` / `value` / `values` on the client, nested-joining transactions with a retry
  loop for optimistic-concurrency conflicts, AbortSignal cancellation
- **`ping`** — `/ready` + `current_database()` health check (`rip-db
  status` is the CLI alias)
- **Substrate re-exports** — `harborAdapter`, `resolveUrl`, and the
  error hierarchy (`DbError` → `QueryError` | `ConnectionError` |
  `CancelledError`, catchable with `isDbError`) are the core runtime's
  own, so a caller's `instanceof` and the ORM's name the same classes
- **MCP tools** — `execute_query`, `list_tables`, `list_columns` over
  stdio JSON-RPC
- **Operational CLI** — ping / dump / load / checkpoint / mcp

## Configuration

| Env / option | Meaning | Default |
|---|---|---|
| `RIP_DB_URL` | Harbor base URL | `http://127.0.0.1:9495` |

URL resolution is one rule everywhere (adapter, probe, CLI, MCP):
explicit argument → `RIP_DB_URL` → default. Trailing slashes are
trimmed.

Three URL spellings dial two transports:

| Spelling | Transport |
|---|---|
| `http://host:port` | TCP |
| `unix:///path/to.sock` | unix domain socket (Bun's fetch `unix` option) |
| `harbor:<name>` | resolution sugar — never a third transport |

`harbor:<name>` reads harbor's own `config.toml` (`[connection.<name>]`)
and desugars to whichever transport that entry implies — the unix socket
preferred, a configured TCP port otherwise. Identity is DERIVED from the
database path, never registered, so `RIP_DB_URL=harbor:medlabs` names a
database and lets the transport stay harbor's business.

**No spelling carries a credential, because there is none to carry.**
Harbor authenticates nobody: a unix socket's 0700 directory and a
loopback-only TCP port are the access control, and remote reach belongs
to an edge proxy. This client sends no `Authorization` header at all.

The raw spellings remain for registry-less worlds (containers, CI,
custom socket paths); `resolveTarget(url)` is the resolver, exported for
callers that need the same answer.

```coffee
connect!                                    # env / default
connect! 'http://127.0.0.1:9495'            # string URL
connect! url: '…', timeoutMs: 60_000
connect! { adapter }                        # tests / custom wires
```

Local convenience: put the `LOAD` / `harbor_serve` lines in an init
file (`duckdb -init ~/.duckdb-harbor.rc my.duckdb`).

## Working with Results

| Want | Use |
|---|---|
| One row object (or `null`) | `findOne! sql, params` |
| Array of row objects | `findAll! sql, params` |
| Rows + column names + count | `sql! text, params` → `{ rows, columns, rowCount }` |
| First scalar | `(sql! 'SELECT count(*) AS n FROM t').rows[0].n` — or `db.value!` on the client |

Module-level names are `findOne` / `findAll` so you can write
`rows = findAll! …` without shadowing an import. The client object from
`connect()` still has short projections:

```coffee
db = connect!
db.rows!  'SELECT id, name FROM users'
db.one!   'SELECT * FROM users WHERE id = ?', [1]
db.value! 'SELECT count(*) AS n FROM users'
```

`ident(name)` quotes a SQL identifier (doubling embedded `"`);
`materializeAll(result)` turns a raw adapter envelope into row objects.

Row keys are the database's own spellings — raw SQL is never rewritten.
For rows headed to camelCase-keyed consumers, pass `{ camel: true }` in
any call's options (`sql! text, params, { camel: true }` — likewise
`findAll` / `findOne`, every client method, transaction surfaces, and
`materializeAll(result, { camel: true })`) to opt that result's row
keys and reported `columns` into a snake_case → camelCase projection.
It is the same transform the schema ORM uses for column names, and it
is not total: only `_` before a lowercase letter folds, so `nickname_2`
and ALL-CAPS segments stay put, and a leading underscore folds
(`_internal` → `Internal`).

Duplicate column names in a join overwrite in row objects (object keys
are unique) — alias them in SQL (`users.id AS user_id`) or read
positionally from the adapter's `data` arrays.

## Client

`createClient(adapter)` materializes `{ columns, data }` into row
objects and projects them:

| Client method | Module-level | Returns |
|---|---|---|
| `sql` | `sql` | `{ rows, columns, rowCount }` |
| `rows` | `findAll` | array of row objects |
| `one` | `findOne` | first row or `null` |
| `value` | — (use `client.value` or read `sql!.rows`) | first scalar or `null` |
| `values` | — (client only) | all scalars of the first row, or `null` |

```coffee
db = connect!

db.transaction! (tx) ->
  tx.sql! 'INSERT INTO users (name) VALUES (?)', ['Ada']
  tx.one! 'SELECT * FROM users WHERE name = ?', ['Ada']
```

`transaction(fn)` begins a session, hands `fn` a client bound to it,
commits on return, and rolls back on throw. A nested `tx.transaction`
joins the outer session — there are no savepoints. Module-level
`transaction(fn)` is the same runner on the process default. `begin()`
is the raw adapter session + `BEGIN` (what schema transactions use
under the hood).

DuckDB resolves write conflicts optimistically — a conflicting write is
refused, not queued — so `transaction` retries the whole callback on a
fresh snapshot when the failure left nothing behind: a write conflict,
a pool with no free connection, an expired lease (`isRetryable` names
the cases). Five retries with jittered backoff by default, honoring the
server's `Retry-After` when harbor sends one. **The callback may run
more than once**, so it must be safe to repeat: pure database work is —
the failed attempt rolled back — but a callback with an effect outside
the database (a charge, an email) must pass `{ retries: 0 }` and handle
conflicts itself.

Pass `{ signal }` to cancel: an already-aborted signal rejects before
dispatch; an in-flight abort rejects with `CancelledError` and aborts
the harbor request. Pass `{ camel: true }` to opt the result into the
snake_case → camelCase key projection described above.

## Boot Probe

```coffee
import { assertReachable, ensureRunning, ping } from 'rip/db'

ensureRunning!                 # same as assertReachable!
assertReachable!               # RIP_DB_URL / default
info = ping!                   # { ok, url, database } — or throws
```

`assertReachable` / `ensureRunning` hit harbor's unauthenticated
`/ready` with a 5s timeout. `ping` also runs `SELECT current_database()`
and returns `{ ok: true, url, database }`. The CLI accepts `rip-db status`
as a synonym for `rip-db ping`.

## Errors

| Type | When |
|---|---|
| `QueryError` | Engine rejected the statement — `.code`, `.details`, `.sql` |
| `ConnectionError` | Transport failure, HTTP 5xx, timeout, abort |
| `CancelledError` | The statement was stopped — caller `AbortSignal` or harbor cancellation |

Catch the family with `isDbError(err)`. `httpStatus` is set when the
failure came back over HTTP. The classes, the temporal wire (TIMESTAMP
/ DATE / TIMESTAMPTZ decode to real `Date`s; outbound `Date`s encode as
ISO-8601 UTC), timeouts, and statement cancellation are all the
substrate's — one implementation under both this package and the ORM,
documented with the adapter contract in [docs/ORM.md](../../docs/ORM.md).

```coffee
import { findOne, isDbError, QueryError } from 'rip/db'

try
  findOne! 'SELECT * FROM users WHERE id = ?', [1]
catch e
  throw e unless isDbError e
  if e instanceof QueryError
    warn "SQL failed (#{e.code}): #{e.message}"
  else
    warn "harbor unreachable: #{e.message}"
```

## CLI

`rip-db` never starts or stops harbor — point `RIP_DB_URL` at a
running instance.

| Command | Behavior |
|---|---|
| `ping` / `status` | `/ready` + database name; exits 1 if unreachable |
| `dump [ARCHIVE\|DIR]` | `EXPORT DATABASE` → `.tar.gz`; auto-names `<db>-YYYYMMDD-HHMMSS.tar.gz`; refuses to overwrite |
| `load ARCHIVE` | `IMPORT DATABASE` into an **empty** DB; screens the archive for traversal paths — load only archives you trust |
| `checkpoint [--force]` | flush the WAL; plain mode fails while other writers are active; `--force` preempts them (can lose their uncommitted writes) |
| `mcp [--url URL]` | MCP stdio server |

## MCP

```bash
rip-db mcp --url http://127.0.0.1:9495
```

```json
{
  "mcpServers": {
    "duckdb": {
      "command": "rip-db",
      "args": ["mcp"],
      "env": {
        "RIP_DB_URL": "http://127.0.0.1:9495"
      }
    }
  }
}
```

Tools: `execute_query`, `list_tables`, `list_columns`. Results truncate
past 1024 rows or 50KB. Harbor traffic uses the same adapter wire as
the rest of the package (timeouts, temporal encode, DbError hierarchy).
Import `{ createMcpServer }` and inject an `sql` runner for hermetic
tests.

## Test

```bash
bun run test
```

One `test.rip` on `rip/testing` covers the package surface, the
adapter and temporal wire, the client (including transaction retry and
cancellation), CLI helpers, boot probe, MCP protocol, and the `rip-db`
bin. Network-facing cases run against fetch doubles — no live harbor
required.
