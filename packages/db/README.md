<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip DB - @rip-lang/db

> **DuckDB over duckdb-harbor — connect(), module-level query/Model, MCP stdio server, and rip-db CLI.**

A client for a running [duckdb-harbor](https://github.com/shreeve/duckdb-harbor)
instance. One file covers the wire adapter (`harborAdapter`), the
materializing client (`createClient`), a process-wide default
(`connect` + module-level `query` / `findOne` / `Model`), a boot-time
reachability probe, an MCP stdio server for assistants, and the
`rip-db` dump/load/checkpoint CLI. Harbor is never vendored; every
network edge goes through an injectable `fetch`, so protocol behavior
tests without a live database.

**Runtime:** not browser-safe — talks to harbor over HTTP (`fetch`),
the CLI/MCP paths use the filesystem and `node:readline`, and the
`rip-db` bin is a stdio server when run as `rip-db mcp`. One `.rip`
file, which is itself the `rip-db` binary (first line
`#!/usr/bin/env rip`).

**Mental model:** this package does not embed or start DuckDB. Harbor
runs inside a DuckDB process and speaks HTTP; Rip DB is the client.
`connect!` installs a process-wide default so `findOne!` / `Model` /
schema `:model` all share one connection. Starting and stopping harbor
is outside this package (keep the DuckDB process up yourself).

## Quick Start

```bash
bun add @rip-lang/db
```

### 1. Start harbor (once)

```sql
INSTALL harbor FROM community;
LOAD harbor;
CALL harbor_serve(bind := '127.0.0.1', port := 9494, token := 'rip-token');
```

Keep that DuckDB process open — when it exits, harbor exits with it.

```bash
export RIP_DB_URL=http://127.0.0.1:9494
export RIP_DB_TOKEN=rip-token   # omit only if harbor_serve(..., token := NULL)
```

### 2. Query from Rip

Use Rip's dammit operator (`!`) to call and await in one step.

```coffee
import { connect, ensureRunning, findOne, findAll, query, Model, transaction } from '@rip-lang/db'

ensureRunning!    # fail fast if harbor is down
connect!          # process default from env (or connect! url)

# Positional ? params — never interpolate values into SQL strings
user  = findOne! 'SELECT * FROM users WHERE id = ?', [1]
list  = findAll! 'SELECT * FROM users WHERE active = ?', [true]
count = (query! 'SELECT count(*) AS n FROM users').rows[0].n

User  = Model 'users'
alice = User.find! 42
team  = User.where(active: true).order('name').limit(20).all!
User.insert! { name: 'Ada', email: 'ada@example.com' }

newId = transaction! (tx) ->
  (tx.one! 'INSERT INTO users (name) VALUES (?) RETURNING id', ['Grace']).id
```

`connect` installs a process-wide default and rewires it on later
calls. Skip it and the first `query!` / `Model` call lazy-connects
from env. Power users can still build `harborAdapter` + `createClient`
by hand.

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
rip packages/db/examples/hello.rip
```

## Features

- **`connect()`** — installs the process default (harbor adapter +
  client); soft-wires schema `:model` when that runtime is loaded
- **Module-level API** — `query` / `findOne` / `findAll` /
  `transaction` / `Model(table)` over that default
- **`Model(table)`** — lightweight ActiveRecord SQL builder (`pk`
  defaults to `id`); schema `:model` remains the typed ORM
- **`ping`** — `/ready` + `current_database()` health check (`rip-db status` is the CLI alias)
- **One adapter contract** — `query` / `begin` / `capabilities`; no
  `introspect()` — catalog SQL goes through `query`
- **Error hierarchy** — `DbError` → `QueryError` | `ConnectionError` |
  `CancelledError`, catchable with `isDbError`
- **Temporal wire seam** — TIMESTAMP/DATE/TIMESTAMPTZ decode to real
  `Date`s; outbound `Date`s encode as ISO-8601 UTC
- **Client surface** — materialize to row objects, `rows` / `one` /
  `value` on the client, nested-joining transactions, AbortSignal
  cancellation
- **MCP tools** — `execute_query`, `list_tables`, `list_columns` over
  stdio JSON-RPC
- **Operational CLI** — ping / dump / load / checkpoint / mcp

## Configuration

| Env / option | Meaning | Default |
|---|---|---|
| `RIP_DB_URL` | Harbor base URL | `http://127.0.0.1:9494` |
| `RIP_DB_TOKEN` | Bearer token for `/sql` | unset (only when harbor is unauthenticated) |

URL resolution is one rule everywhere (adapter, probe, CLI, MCP):
explicit argument → `RIP_DB_URL` → default. Trailing slashes are
trimmed.

```coffee
connect!                                    # env / default
connect! 'http://127.0.0.1:9494'            # string URL
connect! url: '…', token: '…', timeoutMs: 60_000
connect! { adapter }                        # tests / custom wires
```

Local convenience: put the `LOAD` / `harbor_serve` lines in an init
file (`duckdb -init ~/.duckdb-harbor.rc my.duckdb`). A shell alias is
optional sugar — not part of this package.

## Working with Results

| Want | Use |
|---|---|
| One row object (or `null`) | `findOne! sql, params` |
| Array of row objects | `findAll! sql, params` |
| Rows + column names + count | `query! sql, params` → `{ rows, columns, rowCount }` |
| First scalar | `(query! 'SELECT count(*) AS n FROM t').rows[0].n` — or `db.value!` on the client |
| Table helpers | `Model 'users'` |

Module-level names are `findOne` / `findAll` so you can write
`rows = findAll! …` without shadowing an import. The client object from
`connect()` still has short projections:

```coffee
db = connect!
db.rows!  'SELECT id, name FROM users'
db.one!   'SELECT * FROM users WHERE id = ?', [1]
db.value! 'SELECT count(*) AS n FROM users'
```

Duplicate column names in a join overwrite in row objects (object keys
are unique) — alias them in SQL (`users.id AS user_id`) or read
positionally from the adapter's `data` arrays.

## Model

Lightweight SQL builder over the process default — **not** schema
`:model` (typed models, scopes, and relations live in the schema
runtime). Both share the same harbor connection after `connect`.

`find` / `update` / `destroy` use the primary key column — **default
`id`**. Override with `pk:` (and optionally `database:`):

```coffee
User = Model 'users'                                      # pk: 'id'
User = Model 'users', 'analytics'                         # analytics.users, pk id
User = Model 'users', { pk: 'user_id' }
User = Model 'users', { database: 'analytics', pk: 'uid' }

User.find! 42
User.all! 100
User.where(active: true).or(role: 'admin').order('name').limit(20).all!
User.where(id: 1).first!
User.where(active: true).count!
User.insert! { name: 'Ada' }
User.insert! [{ name: 'Ada' }, { name: 'Grace' }]   # multi-row RETURNING *
User.update! 42, { last_login: new Date() }
User.upsert! { email: 'a@x.com', name: 'Ada' }, on: 'email'
User.destroy! 42
User.where(active: false).update! { archived: true }
User.where(active: false).destroy!
```


Builder chains: `where` / `or` / `not` / `select` / `order` / `group` /
`having` / `limit` / `offset`, then `all!` / `first!` / `count!` /
`update!` / `destroy!`. Object `where` uses `?` binds; string form is
an escape hatch (`where 'age > ?', [21]`). `ident(name)` quotes
identifiers.

| | `Model 'users'` (this package) | `schema :model` (Rip language) |
|---|---|---|
| What | Lightweight SQL builder | Typed ORM — fields, scopes, relations, hooks |
| Setup | `connect!` then `Model 'users'` | Declare models; `connect!` wires the adapter |
| Use when | Ad-hoc tables, scripts, simple CRUD | App domain models |

## Client

`createClient(adapter)` materializes `{ columns, data }` into row
objects and projects them:

| Client method | Module-level | Returns |
|---|---|---|
| `query` | `query` | `{ rows, columns, rowCount }` |
| `rows` | `findAll` | array of row objects |
| `one` | `findOne` | first row or `null` |
| `value` | — (use `client.value` or read `query!.rows`) | first scalar or `null` |

```coffee
db = connect!

db.transaction! (tx) ->
  tx.query! 'INSERT INTO users (name) VALUES (?)', ['Ada']
  tx.one! 'SELECT * FROM users WHERE name = ?', ['Ada']
```

`transaction(fn)` begins a session, hands `fn` a client bound to it,
commits on return, and rolls back on throw. A nested `tx.transaction`
joins the outer session — there are no savepoints. Module-level
`transaction(fn)` is the same runner on the process default. `begin()`
is the raw adapter session + `BEGIN` (what schema transactions use
under the hood).

Pass `{ signal }` to cancel: an already-aborted signal rejects before
dispatch; an in-flight abort rejects with `CancelledError` and aborts
the harbor request.

## Adapter Contract

The floor is `harborAdapter` → `{ query, begin, capabilities }`.

`query(sql, params)` returns `{ columns, data, rowCount }`. Each column
is `{ name, type }` (`type` aliased from harbor's `duckdbType`); `data`
is positional row arrays — the shape the schema ORM hydrates from.

- **`query`** POSTs `/sql`; parameters ride alongside the SQL and are
  omitted when empty
- **`begin`** opens a session (`POST /sql/sessions/new`), carries its
  `sessionId` on every statement, and drops it after COMMIT or
  ROLLBACK. No savepoints. Failed BEGIN drops its orphaned session; a
  missing session id refuses rather than faking isolation
- **`capabilities`** is `{ tx: true, ddlTransactional: true }` —
  DuckDB rolls DDL back with the transaction

There is deliberately no `introspect()` method. Schema introspection
for migrations reads DuckDB's catalogs through `query`
(`information_schema`, `duckdb_constraints()`, `duckdb_indexes()`,
`duckdb_sequences()`).

Every request honors `timeoutMs` (default 30s; `0` disables) and a
caller's `AbortSignal`. Timeouts are `ConnectionError` with code
`TIMEOUT`; caller aborts use code `ABORTED`.

```coffee
import { harborAdapter, createClient } from '@rip-lang/db'

adapter = harborAdapter url: '…', token: '…', fetch: myFetch
client  = createClient adapter
```

## Temporal Wire

DuckDB temporal columns decode to real JS `Date` objects at this seam —
the one decode path shared by raw adapter results, the client, and the
schema ORM. A naive TIMESTAMP arrives with no `Z`/offset
(`2024-03-15T10:30:00`); bare `new Date(value)` would read it as local
and shift by the host offset. Naive TIMESTAMP is defined here as UTC
wall-clock. TIMESTAMPTZ keeps its offset; DATE is civil midnight UTC.
TIME stays a string (no date component). Odd values (`infinity`,
unexpected formats) pass through untouched.

Outbound `Date` parameters encode to explicit ISO-8601 UTC (including
Dates nested in arrays/objects). An Invalid Date throws `TypeError`
instead of letting JSON silently turn it into `null`.

## Errors

| Type | When |
|---|---|
| `QueryError` | Engine rejected the statement — `.code`, `.details`, `.sql` |
| `ConnectionError` | Transport failure, HTTP 5xx, timeout, abort |
| `CancelledError` | Caller `AbortSignal` — also a `DbError`, `.code = 'ABORTED'` |

Catch the family with `isDbError(err)`. `httpStatus` is set when the
failure came back over HTTP.

```coffee
import { findOne, isDbError, QueryError } from '@rip-lang/db'

try
  findOne! 'SELECT * FROM users WHERE id = ?', [1]
catch e
  throw e unless isDbError e
  if e instanceof QueryError
    warn "SQL failed (#{e.code}): #{e.message}"
  else
    warn "harbor unreachable: #{e.message}"
```

## Boot Probe

```coffee
import { assertReachable, ensureRunning, ping } from '@rip-lang/db'

ensureRunning!                 # same as assertReachable!
assertReachable!               # RIP_DB_URL / default
info = ping!                   # { ok, url, database } — or throws
```

`assertReachable` / `ensureRunning` hit harbor's unauthenticated
`/ready` with a 5s timeout. `ping` also runs `SELECT current_database()`
and returns `{ ok: true, url, database }`. The CLI accepts `rip-db status`
as a synonym for `rip-db ping`.

## CLI

`rip-db` never starts or stops harbor — point `RIP_DB_URL` /
`RIP_DB_TOKEN` at a running instance.

| Command | Behavior |
|---|---|
| `ping` / `status` | `/ready` + database name; exits 1 if unreachable |
| `dump [ARCHIVE\|DIR]` | `EXPORT DATABASE` → `.tar.gz`; auto-names `<db>-YYYYMMDD-HHMMSS.tar.gz`; refuses to overwrite |
| `load ARCHIVE` | `IMPORT DATABASE` into an **empty** DB; screens the archive for traversal paths — load only archives you trust |
| `checkpoint [--force]` | flush the WAL; plain mode fails while other writers are active; `--force` preempts them (can lose their uncommitted writes) |
| `mcp [--url URL]` | MCP stdio server |

## MCP

```bash
rip-db mcp --url http://127.0.0.1:9494
```

```json
{
  "mcpServers": {
    "duckdb": {
      "command": "rip-db",
      "args": ["mcp"],
      "env": {
        "RIP_DB_URL": "http://127.0.0.1:9494",
        "RIP_DB_TOKEN": "<token>"
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

One `test.rip` on `@rip-lang/testing` covers the package surface, the
adapter and temporal wire, the client, module-level API / `Model`, CLI
helpers, boot probe, MCP protocol, and the `rip-db` bin. Network-facing
cases run against fetch doubles — no live harbor required.
