<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Server - @rip-lang/server

> **Sinatra-style web framework and worker-pool runtime — routes, smart responses, elegant request-parameter validation; serve one file on a port for development, or run the same app as the app tier behind Janus and Caddy**

Handlers are plain functions bound to a request context: return an object
and it ships as JSON, return a string and it ships as text (or HTML when it
looks like markup), throw `error!`/`notice!` and a structured envelope goes
out with the right status. `read()` pulls validated parameters from body,
query, and path with one call, backed by the `@rip-lang/validate`
vocabulary, and `AsyncLocalStorage` makes `session`, `read()`, and `ctx()`
work anywhere in your call stack — no threading a context argument through
your code. The same app file runs standalone on a port or under a worker
pool behind [Janus](https://github.com/shreeve/janus) — the full stack is
described below.

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

## The full stack

In production the app sits behind [Janus](https://github.com/shreeve/janus),
a Caddy module, and five layers divide the labor. Each fact below has one
authoritative home: edge internals are contracted in the
[janus docs](https://github.com/shreeve/janus/blob/main/docs/README.md),
and this README covers the Rip side.

| Layer | Owns |
| --- | --- |
| **Caddy** | Listeners, HTTP/1–3, TLS termination, ACME certificates, SNI site selection |
| **Janus** (a Caddy module) | Site admission (`janus` directive; unknown hosts → 404), dynamic host→unix-socket routing (least-conn + health), the `/1.0` control API (app registration, upstream publication, heartbeats with a 15s TTL reap, the on-demand-TLS allowlist ask), a 1s-default micro-cache with request coalescing, and the hub — edge-terminated WebSocket fan-out |
| **Rip manager** (`manager.rip`) | Registers the app on `/1.0`, heartbeats every 5s, compiles the app once per boot epoch, spawns workers on unique unix sockets, publishes them with atomic full-list PUTs, drives watch-mode hot reload; never on the data path |
| **Rip workers** (`worker.rip`) | Boot the compiled artifact and serve plain HTTP over their unix socket; bounce at capacity with marked 503s; die disposably |
| **The framework** (`server.rip`) | Routes, smart responses, `read()` validation, `@cache` Cache-Control sugar, middleware, `notFound`/`onError`, sessions and request context |

A request walks the stack like this:

1. **TLS terminates at Caddy.** SNI picks the site; certificates and ACME
   are ordinary Caddy configuration.
2. **Janus admits the host.** Only sites carrying the `janus` directive
   join the data plane; a public host with no registered app answers 404.
3. **The micro-cache may answer.** An anonymous GET can be served from
   memory (1s TTL by default), and concurrent misses on one key coalesce
   into a single worker fill.
4. **The registry routes.** The host resolves to the app's live worker
   sockets; least-conn selection with health accounting picks one.
5. **A worker runs the handler** — plain HTTP over the unix socket. The
   manager never touches client traffic.
6. **Response headers steer the edge on the way out.** `Cache-Control`
   (the `@cache` helper) is honored by the micro-cache, capped at its
   `ttl_max` (10s by default) — the header still reaches CDNs and browsers
   intact. A worker's marked 503 (busy or draining) sends Janus straight
   to the next worker without poisoning health accounting.

**Hot reload** (watch mode, the default outside `RIP_ENV=production`): a
save settles (~150ms) and passes a content-hash gate — identical bytes are
free. A changed hash cuts admission with one doorbell PUT; nothing boots
until a request actually rings. The ring triggers one compile, a fresh
worker pool, and a sockets PUT — and the held request completes against
the new code. The protocol is contracted in the janus repo
([pool protocol](https://github.com/shreeve/janus/blob/main/docs/20260719-002000-pool-protocol.md)).

**WebSockets terminate at the edge.** The hub owns the sockets, channels,
and fan-out; workers never need to hold a socket. The app participates
over plain HTTP: Janus POSTs every socket event
(`Sec-WebSocket-Frame: open | text | close`) to the app's registered
`bridge_path`, the response body carries delivery directives, and
server-initiated broadcasts go out via
`POST /1.0/apps/{id}/hub/publish`. An app reload is invisible to connected
clients — sockets ride above the worker plane. One honest caveat: this
split is not enforced with a 4xx. An `Upgrade` request on a hub-off site
proxies through to a worker like any request, and that socket dies at the
next pool reload — do not build on it. The hub grammar and lifecycle are
contracted in the
[hub design](https://github.com/shreeve/janus/blob/main/docs/20260720-162350-hub-design.md).

**Rate limiting: nobody does it.** No layer of this stack performs per-IP
request-rate limiting today — Janus ships none and no third-party Caddy
module is compiled in. If ever wanted, it belongs at the edge. The
framework ships `bodyLimit` (request-size, not request-rate); the one
rate-shaped concern that belongs in the framework is identity-keyed quotas
(per-user, per-session, per-API-key) — application knowledge Janus
deliberately lacks. See **Planned** below.

The runnable end-to-end tutorial — all four Janus capabilities driven by a
Rip app, one page and one `app.rip` — is the
[counter demo](https://github.com/shreeve/janus/blob/main/docs/counter/index.md)
in the janus repo.

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

## notFound and onError

Two registrable handlers cover the requests no route answers and the
errors no handler catches:

```coffee
notFound -> @text 'lost', 404          # every unmatched request
onError (err) -> @json { oops: err.status ?? 500 }, err.status ?? 500
```

`notFound (handler) ->` registers the catch-all for unmatched requests;
without one the response is a plain 404. `onError (handler) ->` replaces
the default error envelope for errors thrown from matched routes; the
handler receives the error (and the context as both `this` and a second
argument). Both handlers receive the request context and must return a
`Response` — the ctx helpers (`@text`, `@json`, …) do; a bare return
value is not smart-converted.

Middleware and before/after filters wrap matched routes only — an
unmatched request goes straight to `notFound`, never through the chain.

## @cache — response freshness, one word

```coffee
get '/report' -> @cache '1h';      report()   # fresh for an hour
get '/feed'   -> @cache 10;        feed()     # ten seconds
get '/live'   -> @cache off;       stats()    # never stored
get '/logo'   -> @cache 'forever'; @send 'logo.svg'
```

Sugar over standard `Cache-Control`, so the same word steers a
micro-cache (Janus), a CDN, and the browser alike.

**Never store** — all emit `Cache-Control: no-store`:

```coffee
@cache 0
@cache false
@cache off            # bare word — off is rip's false
@cache 'off'
@cache 'no-store'
```

**Finite freshness** — emit `public, max-age=N` plus a matching
`Expires`. Bare numbers and numeric strings are seconds; counted units
take any listed spelling, singular or plural, with optional whitespace,
case-insensitive:

```coffee
@cache 10             # max-age=10
@cache '90'           # max-age=90
@cache '30s'          # s / sec / secs / second / seconds
@cache '36m'          # m / min / mins / minute / minutes — m is ALWAYS minutes
@cache '2 hours'      # h / hr / hrs / hour / hours
@cache '7 days'       # d / day / days
@cache '2 weeks'      # w / week / weeks
@cache '1 month'      # mo / month / months — 30 days by convention, never m
@cache '1y'           # y / yr / yrs / year / years
```

**Forever** — the canonical HTTP forever, for fingerprinted assets that
never change under one URL (browsers skip revalidation entirely):

```coffee
@cache 'forever'      # public, max-age=31536000, immutable
```

**Anything else throws** — a cache directive that does not parse is a
bug, never a guessed TTL:

```coffee
@cache '1 fortnight'  # unknown unit
@cache '5ms'          # milliseconds are not a cache duration
@cache 'always'       # one canonical word for forever, and this isn't it
@cache -1             # negative — a computed TTL gone wrong, not "forever"
@cache 1.5            # fractional seconds aren't representable in max-age
@cache ''             # empty string — almost always an interpolation bug
```

An edge cache in front may cap long freshness at its own ceiling
(Janus: `ttl_max`); the header still reaches the browser intact.

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

## Running under Janus — the pool runtime

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
protocol: it POSTs `{name, hosts}` to `/1.0/apps` (retrying a 409 for 30s
by default — sized so a dead predecessor's claim, held for Janus's 15s
heartbeat TTL plus its reap-sweep lag, expires inside the window),
heartbeats every 5s from the moment of registration, owns a persistent
doorbell socket, and spawns workers on unique unix socket paths,
publishing them with atomic full-list PUTs. A boot failure is cached and
answered 503 with the error; the next content-changing save clears it. On
SIGINT/SIGTERM it logs one lifecycle line —
`rip-server: <SIGNAL> — deregistering <name> (<appId>), draining workers`
— publishes an empty upstream list, drains, and DELETEs the registration.
Registration carries `name` and `hosts` only: a hub app's `bridge_path` is
wired today with a manual `PATCH /1.0/apps/{id}` — the
[counter demo](https://github.com/shreeve/janus/blob/main/docs/counter/index.md)
documents the exact command (a `--bridge` flag is planned; see below).

Workers never carry the Rip compiler. The manager compiles the app **once
per boot epoch** — `Bun.build` with a `.rip` plugin over the compiler it is
already running on — into a single ESM artifact in the pool's run tmpdir,
and each worker (itself prebuilt to plain JS at startup) just imports the
artifact: no loader preload, no per-worker recompile. A new epoch builds a
new artifact, so never-stale is automatic, and a compile error is a boot
failure like any other — the doorbell answers 503 carrying the diagnostic.
Bundling freezes each module's `import.meta` path fields to its source
location, so `import.meta.dir`-relative file serving works unchanged. The
handover seam is `start()`: under a worker environment
(`WORKER_ID`/`SOCKET_PATH`) it hands over its fetch handler instead of
opening a port, so the same `app.rip` runs standalone on your laptop and
pooled behind Janus in production, unchanged.

For local HTTPS the janus repo commits a trusted `*.ripdev.io` wildcard
certificate whose DNS resolves to `127.0.0.1` — SNI picks the site, and
the dev flow needs no local CA ceremony (see
[certs/README.md](https://github.com/shreeve/janus/blob/main/certs/README.md)).

### rip server — CLI

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

Unless `RIP_ENV=production`, the pool publishes at the first ready worker
(`readyWhen: 1`) and late workers join with follow-up PUTs — this keys off
`RIP_ENV`, not watch mode. With `RIP_ENV=production` all workers must be
ready before the first publish, and a startup boot failure exits nonzero.

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
manager dies exits on its own), `RIP_REGISTER_409_MS` (30000 — how long a
409 at registration retries before aborting, sized to outlive a dead
predecessor's still-live host claim: heartbeat TTL 15s + reap-sweep lag up
to 5s + retry spacing up to 5s, with margin), `RIP_HANDLER_DEADLINE_MS` (30000
hung-handler watchdog: an in-flight request older than this recycles the
worker; 0 disables), and `RIP_WAITER_CAP` (64 held rings, a count).
Workers receive their in-flight cap via `WORKER_CONCURRENCY`, set by the
manager from `-c`, and their SIGTERM drain budget via
`RIP_DRAIN_DEADLINE_MS`, derived from `RIP_KILL_MS` so a drain always
finishes inside the manager's SIGTERM→SIGKILL ceiling.

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

## Planned

Approved near-term work — everything in this section is **not yet
shipped**; the rest of this README states only what is:

1. **`--bridge` manager flag** — registration carries `bridge_path`, so a
   hub app needs no manual `PATCH /1.0/apps/{id}` after launch.
2. **Hub ergonomics in the framework** — bridge-frame dispatch
   (open/text/close routed like methods), directive-response helpers for
   the sigil grammar (`!` / `@` / `+` / `-` / `?` / `<` / `*`, including
   the required-`!` rule on the bridge plane), a publish client with
   app-id plumbing (the manager holds `state.appId`; workers currently
   re-derive it by name), and membership-snapshot access.
3. **Identity-keyed rate quotas** — middleware for per-user, per-session,
   and per-API-key limits: the one rate-shaped concern that lives in the
   framework, because it needs application identity the edge lacks.
4. **Structured startup report** — composed from what the manager knows
   plus read-backs of `GET /1.0` and `GET /1.0/apps/{id}`, so it reports
   the registration as Janus holds it (control-plane surfaces: `/1.0`,
   `/1.0/health`, `/1.0/apps[/{id}]`, `/1.0/tls/ask`, `/1.0/cache`,
   `/1.0/hub`, `/1.0/apps/{id}/hub`).
