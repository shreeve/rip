# @rip-lang/db

The one database adapter contract and its single shipped adapter:
DuckDB reached over HTTP by an external `duckdb-harbor` endpoint. The
harbor server is never vendored, and the adapter is pure over an
injected `fetch`, so every protocol behavior tests without a server.

## The adapter contract

An adapter implements four members. `query(sql, params)` returning
`{ columns, data, rowCount }` is the floor; the rest layer on top:

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
- **`introspect()`** reads DuckDB's `information_schema` into
  `{ tables: [{ name, columns: [{ name, type }] }] }`.
- **`capabilities`** declares `{ tx, ddlTransactional }` — DuckDB rolls
  DDL back with the transaction, so the migration runner may claim a
  whole-file rollback.

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
`http://127.0.0.1:9494`), an optional bearer `token`, and the
injectable `fetch`.

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
  rejects the caller with a `CancelledError` at once (the request may
  still finish on the server).
