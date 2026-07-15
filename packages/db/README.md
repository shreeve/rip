# @rip-lang/db

The one database adapter contract and its single shipped adapter:
DuckDB reached over HTTP by an external `duckdb-harbor` endpoint. The
harbor server is never vendored, and the adapter is pure over an
injected `fetch`, so every protocol behavior tests without a server.

## The adapter contract

An adapter implements four members. `query(sql, params)` returning
`{ columns, data, rowCount }` is the floor; the rest layer on top. Each
`columns` entry is a `{ name, type }` object (harbor's own per-column
shape, with `type` aliased from its `duckdbType`), and `data` is an
array of positional row arrays — the shape the schema ORM hydrates from:

```rip
import { harborAdapter } from '@rip-lang/db'

db = harborAdapter url: process.env.RIP_DB_URL, token: process.env.RIP_DB_TOKEN

{ data } = await db.query 'SELECT id, name FROM users WHERE active = ?', [true]

tx = await db.begin()
try
  await tx.query 'INSERT INTO users (name) VALUES (?)', ['Ada']
  await tx.commit()
catch error
  await tx.rollback()
```

- **`query(sql, params)`** POSTs `/sql`; parameters ride alongside the
  SQL and are omitted when empty.
- **`begin(options)`** opens a session (`POST /sql/sessions/new`),
  carries its `sessionId` on every statement, and drops it after
  COMMIT or ROLLBACK. Transaction semantics are the product's: one
  session per transaction, no savepoints. The session is dropped in a
  `finally`, so a failed COMMIT or ROLLBACK still releases the open
  transaction promptly; a failed BEGIN drops its own orphaned session;
  and a session response with no id refuses to run rather than execute
  a fake, unisolated transaction. A failed drop itself is best-effort —
  harbor's idle TTL reaps it — so it never masks the outcome.
- **`capabilities`** declares `{ tx, ddlTransactional }` — DuckDB rolls
  DDL back with the transaction, so the migration runner may claim a
  whole-file rollback.

There is deliberately no `introspect()` method. Schema introspection for
the migration runner reads DuckDB's own catalog directly through
`query` (`information_schema`, `duckdb_constraints()`, `duckdb_indexes()`,
`duckdb_sequences()`) — the rich metadata a diff needs, which a thin
adapter surface cannot carry.

## Errors

Every failure is one typed hierarchy, so a caller can catch the family
with `isDbError(err)` (or `err instanceof DbError`):

- **`QueryError`** — the engine rejected the statement (a body error
  code); carries its `code`, `details`, and the offending `sql`.
- **`ConnectionError`** — the transport failed or the harbor was
  unreachable, including an HTTP 5xx with no engine code, so a retry
  loop keyed on `ConnectionError` catches an availability failure even
  during a query.
- Both extend **`DbError`**, which carries the `httpStatus` when the
  failure came back over HTTP; the offending `sql` is attached
  whenever there was one.

Configuration is `url` (defaulting to the local harbor
`http://127.0.0.1:9494`), an optional bearer `token`, the injectable
`fetch`, and `timeoutMs` — a per-request deadline (default 30s; `0`
disables) that actually aborts a hung request and surfaces as a
`ConnectionError` with `code: 'TIMEOUT'`. `query` also accepts a
`{ signal }` AbortSignal; a caller abort cancels the in-flight fetch
and surfaces as `code: 'ABORTED'`.

## The query client

`createClient(adapter)` layers result ownership over any adapter: it
materializes the adapter's `{ columns, data }` into row objects and
projects them.

```rip
db = createClient harborAdapter(url: env.RIP_DB_URL)

people   = await db.rows  'SELECT id, name FROM users WHERE active = ?', [true]
ada      = await db.one   'SELECT * FROM users WHERE id = ?', [1]   # first row or null
howMany  = await db.value 'SELECT count(*) FROM users'              # scalar

newId = await db.transaction (tx) ->
  row = await tx.one 'INSERT INTO users (name) VALUES (?) RETURNING id', ['Ada']
  row.id
```

- **`query`** returns `{ rows, columns, rowCount }`; **`rows`**,
  **`one`** (first row or `null`), and **`value`** (first scalar) are
  the projections.
- **`transaction(fn)`** begins a session, hands `fn` a client bound to
  it, and commits on return or rolls back on any throw. A nested
  `tx.transaction` JOINS the outer one — there are no savepoints, so
  the inner call reuses the session rather than opening a second.
- **Cancellation**: pass a `{ signal }` `AbortSignal`. An
  already-aborted signal rejects before dispatch; an abort in flight
  rejects the caller with a `CancelledError` at once AND aborts the
  underlying harbor request — the signal is threaded through to the
  adapter's fetch.

## Operational surfaces

Three tools ride the same harbor `/sql` wire. None starts the database —
harbor's lifecycle is external.

### `rip-db` — snapshot, restore, checkpoint

```
rip-db dump [ARCHIVE.tar.gz | DIRECTORY]   # EXPORT DATABASE → a .tar.gz
rip-db load ARCHIVE.tar.gz                 # IMPORT DATABASE (into an empty DB)
rip-db checkpoint [--force]                # flush the WAL into the DB file
```

`dump` auto-names `<db>-YYYYMMDD-HHMMSS.tar.gz` and refuses to overwrite;
`load` refuses a non-empty target and screens the archive for traversal
paths (it is for archives you trust). `checkpoint` fails while other
writers are active; `--force` preempts them. The command logic lives in
`cli.rip` behind an injected host seam, so it tests without a server;
`bin/rip-db` supplies the real `fetch`/filesystem/tar seam.

### `@rip-lang/db/embed` — a boot reachability probe

```rip
import { assertReachable } from '@rip-lang/db/embed'
await assertReachable 'http://127.0.0.1:9494'   # throws if harbor isn't answering
```

Hits harbor's unauthenticated `/ready` probe with a 5s timeout, so an app
fails loudly at boot instead of on its first mysterious query 500.

### `@rip-lang/db/mcp` — an MCP server

A line-delimited JSON-RPC stdio server exposing three tools —
`execute_query`, `list_tables`, `list_columns` — to AI assistants:

```json
{ "mcpServers": { "duckdb": {
  "command": "rip",
  "args": ["packages/db/mcp.rip", "--url", "http://127.0.0.1:9494"],
  "env": { "RIP_DB_TOKEN": "<token>" }
} } }
```

Results are truncated past 1024 rows or 50KB. `createMcpServer({ sql })`
is the protocol core, pure over an injected runner, so every method and
tool tests without stdio or a server.
