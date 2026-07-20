<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Server - @rip-lang/server

> **Sinatra-style web framework — routes, smart responses, read() validation, and AsyncLocalStorage-powered request context**

Handlers are plain functions bound to a request context: return an object
and it ships as JSON, return a string and it ships as text (or HTML when it
looks like markup), throw `error!`/`notice!` and a structured envelope goes
out with the right status. `read()` pulls validated parameters from body,
query, and path with one call, backed by the `@rip-lang/validate`
vocabulary, and `AsyncLocalStorage` makes `session`, `read()`, and `ctx()`
work anywhere in your call stack — no threading a context argument through
your code. The same app file runs standalone on a port or under a worker
pool behind [Janus](https://github.com/shreeve/janus).

**Runtime:** not browser-safe — uses `Bun.serve`, `Bun.file`, and
`node:async_hooks`. Four `.rip` files: the DSL (`server.rip`, also the
`rip-server` bin), the middleware collection (`middleware.rip`), and the
pool runtimes (`manager.rip`, `worker.rip`).

## Quick Start

```bash
bun add @rip-lang/server
```

```coffee
import { get, post, read, error, start } from '@rip-lang/server'

get '/' -> { message: 'Hello!' }

get '/users/:id' ->
  id = read 'id', 'id!'          # validated integer > 0, 400 if missing
  { id, name: "User #{id}" }

post '/signup' ->
  email = read 'email', 'email!' # normalized, lowercased, 400 if invalid
  error! 'taken', 409 if email is 'admin@example.com'
  { ok: true, email }

start port: 3000
```

## Features

- **Sinatra-style routes** — `get`, `post`, `put`, `patch`, `del`, `all`,
  with `:params`, wildcards, optional segments, and `prefix` grouping
- **Smart responses** — return objects (JSON), strings (text/HTML),
  numbers, `null` (204), or a raw `Response`
- **`read()`** — one call to fetch and validate any input (body, query,
  path), with 35+ named validators, regex/range/enum forms, dotted paths,
  and a `!` suffix for required fields
- **Error helpers** — `error!`, `notice!`, `bail!` halt the request with a
  structured JSON envelope; 5xx internals are always masked
- **Request context anywhere** — `session`, `ctx()`, `mark()`, and
  `subrequest()` ride AsyncLocalStorage, so library code sees the current
  request without plumbing
- **`input:` schemas** — validate JSON bodies through a Rip `schema`
  before the handler runs; `GET /openapi.json` generates itself
- **Middleware** — Koa-style `use` composition plus a built-in set:
  `cors`, `logger`, `compress`, `sessions` (signed or AES-256-GCM
  encrypted), `csrf`, `secureHeaders`, `timeout`, `bodyLimit`, `htmlJson`
- **Runs anywhere** — standalone `Bun.serve` on a port, or handed to a
  worker pool via `startHandler()`

## Routing

```coffee
get '/users/:id' -> { id: @req.param('id') }
get '/files/*' -> @send "public/#{@req.path.slice(7)}"
get '/reports/:year/:month?' -> @req.param()      # optional segment
all '/webhook' -> @req.method

prefix '/api/v1', ->
  get '/ping' -> 'pong'                           # GET /api/v1/ping
```

Handlers receive the context as both `this` and the first argument, so
`@req`, `@json()`, `@send()`, and `@session` all work. A handler's return
value becomes the response: `Response` passes through, objects become
JSON, strings become text (or HTML when they start with `<`), and
`null`/`undefined` becomes 204.

## read() — validated input, one call

`read()` merges the parsed body, query string, and path params, then
validates:

```coffee
post '/orders' ->
  user  = read 'userId', 'id!'          # required positive integer
  total = read 'total', 'money!'        # "$1,234.56" → 123456 cents
  when_ = read 'date', 'date'           # real calendar dates only
  size  = read 'size', ['S', 'M', 'L']  # enumeration
  qty   = read 'qty', [1, 99]           # numeric range
  note  = read 'note', /^[\w ]{0,80}$/  # regex extract
  name  = read 'patient.firstName'      # dotted path into nested JSON
  ...
```

A trailing `!` makes the field required (400 with the field name if
absent). The third argument supplies a default (or a function to call) for
missing values. The validator vocabulary — `id`, `int`, `money`, `email`,
`date`, `phone`, `ssn`, `uuid`, and thirty more — lives in
`@rip-lang/validate` and is re-exported here (`registerValidator` adds
your own).

## Error helpers

```coffee
get '/admin' ->
  user = session.user or bail!          # 401, session cleared
  error! 'forbidden', 403 unless user.admin
  notice! 'Quota exceeded' if user.overQuota   # always user-facing
  ...
```

Thrown errors become one JSON envelope: `{ error: { message, notice?,
issues? } }`. Messages show for 4xx; 5xx and raw throws are masked to a
generic status line so internals never leak.

## input: schemas and OpenAPI

```coffee
Signup = schema :input
  name! 2..50
  age?  ~integer

post '/signup', input: Signup, ->
  { welcome: @input.name }    # parsed, coerced, defaulted
```

A bad body never reaches the handler — a 400 with structured
`{field, error, message}` issues goes out instead. The first `input:`
route turns on `GET /openapi.json`, generated from the route table and
each schema's JSON Schema, always current.

## Middleware

```coffee
import { use, before, session } from '@rip-lang/server'
import { cors, logger, sessions, csrf, secureHeaders } from '@rip-lang/server/middleware'

use logger()
use cors origin: 'https://myapp.com', preflight: true
use sessions secret: process.env.SESSION_SECRET, encrypt: true
use csrf secret: process.env.SESSION_SECRET
use secureHeaders()
```

`use` also takes custom Koa-style middleware — `(c, next) ->` — either
global or path-scoped:

```coffee
use (c, next) ->                # global: every request
  await next()

use '/api', (c, next) ->        # scoped: /api and everything beneath it
  return c.text('denied', 403) unless session.user   # short-circuits
  await next()
```

A path-scoped pattern uses the same `:param` / `*` grammar as routes but
is **match-only** — its `:params` are never exposed; `@req.param()` binds
from the matched route's pattern alone. Global and scoped middleware share
one registration order; a scoped entry is skipped (never called) when the
request path is outside its pattern. `sessions` cookies are HMAC-signed by
default or AES-256-GCM sealed with `encrypt: true`; `csrf` implements
double-submit with HMAC binding.

## Architecture

The package is three concepts — the DSL is the only part an app ever
imports; the manager and worker are the runtime `rip server` runs it under:

```text
                     ┌──────────────────────────────┐
/1.0 + doorbell ◄────┤  MANAGER   (manager.rip)     │  the process you run
                     │  watch · spawn · heartbeat   │  never touches a request
                     └──────────┬───────────────────┘
                                │ Bun.spawn + env
                     ┌──────────▼───────────────────┐
Janus ──UDS─────────►│  WORKER    (worker.rip)      │  binds the unix socket
                     │  bind UDS · /ready · drain   │  loads your app
                     └──────────┬───────────────────┘
                                │ import
                     ┌──────────▼───────────────────┐
                     │  YOUR APP  (app.rip)         │
                     │  import { get, read, start } │
                     │    from '@rip-lang/server'   │  ◄── the DSL (server.rip)
                     └──────────────────────────────┘
```

The manager implements the Rip Server half of the pool coordination
protocol in the Janus repository (`docs/20260719-002000-pool-protocol.md`):
it registers the app on `/1.0` and heartbeats every 5s from the moment of
registration, owns a persistent doorbell socket, and spawns workers on
unique unix socket paths, publishing them with atomic full-list PUTs. In
watch mode a save settles (~150ms), passes a content-hash gate (identical
bytes are free), then cuts admission with one doorbell PUT and retires the
old pool — nothing boots until a request actually rings, and the ring is
answered 204 only after the fresh sockets PUT is acknowledged. A boot
failure is cached and answered 503 with the error; the next
content-changing save clears it.

Workers never carry the Rip compiler. The manager compiles the app **once
per boot epoch** — `Bun.build` with a `.rip` plugin over the compiler it is
already running on — into a single ESM artifact in the pool's run tmpdir,
and each worker (itself prebuilt to plain JS at startup) just imports the
artifact: no loader preload, no per-worker recompile. A new epoch builds a
new artifact, so never-stale is automatic, and a compile error is a boot
failure like any other — the doorbell answers 503 carrying the diagnostic.
Bundling freezes each module's `import.meta` path fields to its source
location, so `import.meta.dir`-relative file serving works unchanged. The handover seam is `start()`: under a
worker environment (`WORKER_ID`/`SOCKET_PATH`) it hands over its fetch
handler instead of opening a port, so the same `app.rip` runs standalone
on your laptop and pooled behind Janus in production, unchanged.

## The no-fork memory story

Unicorn-era servers had a beautiful trick: load the app once in a master
process, then `fork()` workers that share every untouched page with the
parent via copy-on-write. Modern JS runtimes cannot play it. Bun/JSC runs
concurrent GC and JIT threads before any of your code executes, and a
forked child inherits permanently locked mutexes from threads that don't
exist on its side of the fork — the child is unusable, and no quiesce
hatch exists. `Bun.spawn` uses `posix_spawn`, which is safe precisely
because it discards the address space: no shared pages, no COW. So the
typical Node/Bun cluster pays the full price in every worker — each
process independently loads, compiles, and retains everything the app
needs to boot, times `w`.

Fork's durable value was never really the shared pages (more on that
below) — it was **load the app once**. Rip Server recovers that without
fork: the manager compiles the app once per reload epoch and workers boot
the resulting plain-JS artifact, so the Rip compiler — its code, its
parser tables, its retained heap — exists in exactly one process instead
of `w + 1`. Workers get module evaluation and heap build, the part that
is irreducibly per-process, and nothing else.

Measured on the landing commit (M5, Bun 1.3.14, interleaved
before/after legs):

- **Per-worker RSS ~137–145MB → 33–40MB** — ~3.7x smaller, ~105MB less
  per worker, ~850MB recovered at `w:8`.
- **Reload (save → fresh response) at `w:8`: ~470ms → ~170ms** — ~2.7x,
  and reload latency no longer scales with worker count (`w:2` measured
  ~245ms → ~153ms; one build now serves all `w` instead of `w`
  recompiles racing for cores).
- **Boot to all-ready at `w:8`: ~650ms → ~300ms** — ~2x, with the
  artifact build included in the after number.

The honest coda, in two parts. First, fork's *other* promise — a shared
warm heap — decays even where fork works: GC, inline caches, and JIT
profiling counters dirty the "shared" pages within minutes (Ruby spent
years on `GC.compact` fighting exactly this). Load-once was always the
part worth keeping. Second, there is a read-only-pages variant that
would genuinely share memory across workers — compile the artifact to
JSC bytecode and let the kernel mmap it into every process — and it is
measured as **not yet viable on Bun 1.3.14**: ESM bytecode requires
`compile: true` (a standalone executable), and the one bundle format
bytecode accepts (CJS) rejects top-level await, which idiomatic Rip
emits routinely. When Bun ships ESM bytecode, the artifact is one flag
away from kernel-shared pages.

## rip server — CLI

```bash
rip server [app-entry] [options]   # app-entry defaults to ./app.rip, then ./index.rip
```

| Flag | Meaning |
| --- | --- |
| `--name <n>` | App name for registration (default: the app directory's name) |
| `--host <h>` | Public host to claim; repeatable (default: the app name) |
| `-w, --workers <n>` | Worker processes (default: 2) |
| `-c, --concurrency <n>` | Concurrent requests per worker (default: 1). Refused with watch on — `--eager` included — raise `c` only with watch off (`--no-watch`, or `RIP_ENV=production`); see the sizing maxim below |
| `--watch` / `--no-watch` | File watching + hot reload (default ON unless `RIP_ENV=production`) |
| `--allow-watch` | Required to enable `--watch` when `RIP_ENV=production`; logs loudly |
| `--eager` | Boot the fresh pool at settle instead of waiting for a ring |
| `--control <target>` | Janus control endpoint — unix socket path or http(s) URL (or env `JANUS_CONTROL`); required, verified at startup |

With watch on the pool publishes at the first ready worker (`readyWhen: 1`)
and late workers join with follow-up PUTs; with `RIP_ENV=production` all
workers must be ready before the first publish, and a startup boot failure
exits nonzero.

Sizing the pool: **raise `c` when handlers wait; raise `w` when handlers
work.** Workers (`-w`) are processes — real parallelism across cores, for
CPU-bound handlers. Per-worker concurrency (`-c`) interleaves I/O waits on
one event loop — it adds capacity only while handlers are blocked on a
database or upstream, and cannot add CPU. The default is `c:1`: one
in-flight request per worker, and concurrent arrivals bounce to the next
worker via a marked 503. Raising `c` is the opt-in for I/O-bound apps,
and only with watch off — retiring a pool must drain up to `c` in-flight
requests per worker, so hot reload and `c > 1` do not mix (the manager
refuses the combination at startup).

Env knobs (all in milliseconds, defaults per the protocol): `RIP_SETTLE_MS`
(150), `RIP_DRAIN_MS` (2500 drain grace before SIGTERM), `RIP_KILL_MS`
(5000 SIGTERM→SIGKILL), `RIP_HEARTBEAT_MS` (5000), `RIP_HOLD_MS` (15000
ring hold cap), `RIP_BOOT_DEADLINE_MS` (30000 per worker),
`RIP_PPID_MS` (1000 orphan-watchdog cadence — a worker whose parent
manager dies exits on its own), and `RIP_WAITER_CAP` (64 held rings, a
count). Workers receive their in-flight cap via `WORKER_CONCURRENCY`,
set by the manager from `-c`.

## Test

```bash
bun run test
```

The suite drives the exported fetch handler end-to-end — routing, smart
responses, error envelopes, the full `read()` vocabulary, session/context
helpers, `input:` schema validation with the generated OpenAPI document,
and every built-in middleware — with no live socket. The worker and
manager runtimes then run as real subprocesses over unix sockets against
a stub Janus `/1.0` control socket that records every call in order:
readiness, drains, the dirty epoch (doorbell PUT before the ring's 204,
sockets PUT before the 204), save coalescing, the identical-bytes no-op,
boot-failure caching, prebuilt-artifact boots (loader-free workers,
`import.meta.dir` preservation, loud build rejection), and shutdown.
