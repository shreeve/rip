<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Server - @rip-lang/server

> **Sinatra-style API framework and per-server runtime — concise routes, smart
> responses, validated input, safe hot reload, and disposable Bun workers
> behind Caddy and Janus**

Rip Server has two faces that share one contract:

- `@rip-lang/server` is the framework API source imports: routes, response
  helpers, `read()` validation, schemas, middleware, sessions, and request
  context.
- `rip server` is the manager for one project: it registers with Janus,
  publishes browser-App coordination files, watches source, prepares API
  generations, and supervises worker processes.

Caddy and [Janus](https://github.com/shreeve/janus) form the public edge. They
own HTTP and TLS, host and tenant admission, static and App files, cache
policy, Hub WebSockets, and routing to private API worker sockets. The manager
never handles an ordinary client request.

The authoritative ownership, reload, migration, request-flow, and cache-policy
contract is [docs/SERVER.md](../../docs/SERVER.md).

## Quick Start

Install the package:

```bash
bun add @rip-lang/server
```

Create `index.rip`:

```coffee
import { get, post, read, error, prefix, start } from '@rip-lang/server'

prefix '/api', ->
  get '/hello' -> { message: 'Hello!' }

  get '/users/:id' ->
    id = read 'id', 'id!'
    { id, name: "User #{id}" }

  post '/signup' ->
    email = read 'email', 'email!'
    error! 'taken', 409 if email is 'admin@example.com'
    { ok: true, email }

start!
```

With Janus running, launch the project:

```bash
rip server . --host hello.ripdev.io --control /run/janus/control.sock
```

`rip server` discovers `app.rip`, `index.rip`, or an App-only `app/`
directory in the selected project or its parents. One invocation creates one
manager. Many managers may register independent servers behind the same
Caddy+Janus process.

## The Shape of a Server

```text
Caddy + Janus
├── serves ───────────────► public/, app/, static/generated/
├── terminates ───────────► Hub WebSockets
└── proxies /api ─────────► private worker sockets

one Rip server
├── manager
│   ├── registration + heartbeats
│   ├── generation + worker supervision
│   ├── generated App publication
│   └── watch dings + local control
├── API source ───────────► disposable worker processes
└── App source + assets ──► served directly by Janus
```

Three project shapes use the same model:

- **Full:** API workers plus `app/` and generated App files.
- **API-only:** API workers with no browser App.
- **App-only:** `app/` and generated files with no API workers.

## Features

- **Sinatra-style routes:** `get`, `post`, `put`, `patch`, `del`, and `all`
  with parameters, wildcards, optional segments, and `prefix` groups.
- **Smart responses:** objects become JSON, strings become text or HTML,
  numbers and booleans become text, and `null` becomes `204`.
- **Response helpers:** `@json`, `@text`, `@html`, `@body`, `@redirect`,
  `@header`, `@cache`, and `@send`.
- **Validated input:** `read()` draws from body, query, and path parameters
  using the shared `@rip-lang/validate` vocabulary.
- **Schema routes:** `input:` validates JSON through a Rip schema and
  contributes to an automatically generated OpenAPI 3.1 document.
- **Request context:** `ctx()`, `session`, `mark()`, and `subrequest()` ride
  `AsyncLocalStorage`; library code needs no threaded context argument.
- **Middleware:** Koa-style composition plus CORS, logging, compression,
  sessions, CSRF, security headers, timeout, and mobile JSON rendering.
- **Safe API reload:** a short-lived generation process validates a candidate
  before the manager cuts admission to the active workers.
- **Latest-wins App updates:** tiny `{id,hash}` dings trigger ordinary HTTP
  fetches of current source; source bytes never ride Hub frames.
- **Operational barriers:** `hold`, `release`, coordinated `migrate`, and
  fix-forward `recover`.

## Routing

```coffee
get '/users/:id' -> { id: @req.param('id') }
get '/reports/:year/:month?' -> @req.param()
all '/webhook' -> @req.method

prefix '/api/v1', ->
  get '/ping' -> 'pong'
  post '/orders' -> createOrder! @input
```

Static routes use a fast exact-path map. Parameter and wildcard routes retain
registration order:

```text
:id          one path segment
:id{\d+}     one segment matching a custom pattern
:id?         optional final segment
*            wildcard remainder
```

`use(path, middleware)` accepts the same path grammar for matching, but its
parameters are not projected into `@req.param()`. Only the selected route
binds route parameters.

Behind Janus, `@req.site` is the trusted tenant selected from the registered
site pattern. The framework never derives a tenant from an untrusted `Host`
header or URL parameter.

## Responses

Handlers receive the request context as both `this` and their first argument.
Returning an ordinary value invokes the smart response rules:

```coffee
get '/object' -> { ok: true }        # JSON
get '/text'   -> 'hello'             # text/plain
get '/html'   -> '<h1>Hello</h1>'    # text/html
get '/empty'  -> null                # 204
get '/raw'    -> new Response('raw') # unchanged
```

Use explicit helpers when status, headers, or representation must be clear:

```coffee
get '/created' ->
  @json { id: 42 }, 201,
    Location: '/api/items/42'

get '/page' ->
  @html '<h1>Hello</h1>'

get '/export' ->
  bytes = buildExport()
  @body bytes, 200,
    'Content-Type': 'application/octet-stream'
    'Content-Disposition': 'attachment; filename="export.bin"'
```

`@body` sends bytes through the API worker. `@send` instead asks Janus to
serve a file chosen by API logic:

```coffee
get '/reports/:id.pdf' ->
  report = findReport! @req.param('id')
  authorize! report
  @header 'Content-Disposition', "attachment; filename=\"#{report.name}.pdf\""
  @send report.path, 'application/pdf'
```

`@send` resolves the path to an absolute pathname and returns an empty
`X-Sendfile` instruction response. Janus opens and streams the file, supplies
omitted type and validators, and owns conditional requests, ranges, framing,
and transport. An explicit type and headers set through `@header` or `@cache`
remain authoritative; the default cache policy is `no-cache`. Ordinary
public/App files belong in Janus file roots; `@send` is for dynamic,
protected, or otherwise API-selected files.

## Reading and Validating Input

`read()` merges parsed body fields, query parameters, and route parameters,
then validates the selected value:

```coffee
post '/orders/:id' ->
  id    = read 'id', 'id!'                  # required positive integer
  email = read 'email', 'email!'            # normalized and lowercased
  total = read 'total', 'money!'            # "$12.34" → 1234 cents
  date  = read 'date', 'date'               # real calendar date
  size  = read 'size', ['S', 'M', 'L']      # enumeration
  qty   = read 'qty', [1, 99]               # numeric range
  note  = read 'note', /^[\w ]{0,80}$/      # regex extract
  name  = read 'patient.firstName'           # dotted JSON path
  ...
```

A trailing `!` makes a value required. The third argument provides a default
value or a function to call when the value is absent:

```coffee
page = read 'page', 'int', 1
token = read 'token', 'text', -> mintToken()
```

Named validators come from `@rip-lang/validate` and are re-exported by this
package. `registerValidator` adds an application validator.

## Errors

```coffee
get '/admin' ->
  user = session.user or bail!             # 401 and clear session
  error! 'forbidden', 403 unless user.admin
  notice! 'Account suspended' if user.suspended
  ...
```

Thrown failures become `{ error: { message, notice?, issues? } }`. Explicit
4xx messages are visible. Raw failures and 5xx details are masked.

`notFound` handles unmatched requests; `onError` replaces the default matched
route error response:

```coffee
notFound -> @text 'lost', 404
onError (err) -> @json { error: 'request failed' }, err.status ?? 500
```

Both handlers must return a `Response`; smart conversion applies to ordinary
route handlers, not these terminal hooks.

## Schemas and OpenAPI

```coffee
Signup = schema :input
  name! 2..50
  age?  ~integer

post '/api/signup', input: Signup, ->
  { welcome: @input.name }
```

An invalid body never reaches the handler. The first `input:` route enables
`GET /openapi.json`; the document is rebuilt from the live route table and
each schema's JSON Schema.

Customize its info block with:

```coffee
openapi title: 'Medlabs API', version: '1.0.0'
```

## Response Caching

`@cache` emits standard response headers. Janus's micro-cache stores only
explicitly cacheable responses; the same headers continue to govern browsers
and downstream CDNs.

```coffee
get '/live'   -> @cache off;       stats()
get '/feed'   -> @cache 10;        feed()
get '/report' -> @cache '1 hour';  report()
get '/asset'  -> @cache 'forever'; @send versionedAsset()
```

Accepted forms:

```text
0 | false | off | 'off' | 'no-store'  → Cache-Control: no-store
10 | '90' | '30s' | '36m' | '2 hours' → public, max-age=N + Expires
'forever'                              → one year, immutable
```

Unknown units, milliseconds, negatives, fractions, and invented synonyms
throw. Cache instructions are never guessed.

The complete policy for immutable assets, mutable files, generated
coordination files, live Rip source, CSS, HTML, media, APIs, and Hub
connections lives in [docs/SERVER.md](../../docs/SERVER.md#url-addressable-resources-and-cache-policy).

## Middleware

```coffee
import { use, session } from '@rip-lang/server'
import { cors, sessions, csrf } from '@rip-lang/server/middleware'

use cors origin: 'https://app.example.com', preflight: true
use sessions secret: process.env.SESSION_SECRET, encrypt: true
use csrf secret: process.env.SESSION_SECRET

use '/api/private', (c, next) ->
  return c.text('unauthorized', 401) unless session.user
  next!()
```

Global and path-scoped middleware share one registration order. Calling
`next!()` continues the chain; returning a `Response` short-circuits it.
`before` and `after` filters wrap matched routes after middleware.

Built-ins:

- `cors`
- `compress`
- `sessions`
- `csrf`
- `secureHeaders`
- `timeout`
- `htmlJson`

Sessions are HMAC-signed by default or AES-256-GCM sealed with
`encrypt: true`. CSRF uses a double-submit cookie with optional HMAC binding.

## Browser App and Development Feed

An `app/` directory is the browser App. The manager assembles its `.rip`
module graph into `static/generated/bundle.json`; while watching, it also
publishes `manifest.json`.

Janus serves:

- The App shell
- Authored `.rip`, CSS, HTML, and other registered files
- `bundle.json` and `manifest.json`
- The browser runtime at `/@rip/rip.js`
- Hub WebSockets

Workers serve API routes only. The manager writes files and publishes control
state but is never on the client data path.

The default development bag is `app/**/*.{rip,css,html}`. A change produces a
tiny `{id,hash}` ding:

- `.rip` → fetch and apply the latest module
- `.css` → fetch latest bytes and update the existing stylesheet URL
- `.html` → full reload
- unknown or retired entries → ignore or resynchronize as appropriate

The six-character `hash` is `rash(bytes)`, a change/deduplication identity
computed from the bytes the browser actually receives. It is not an HTTP
ETag. Rapid saves converge on the newest available representation; Janus does
not retain historical App versions.

See [docs/WORKSPACE.md](../../docs/WORKSPACE.md) for the browser passport bag
and door contract.

## App-Local `serve.rip`

`serve.rip` next to the project entry declares Janus-facing identity and file
policy:

```coffee
export default
  name: 'medlabs'
  sites:
    host: '{site}.medlabs.health'
    dir: 'sites'
    aliases:
      localhost: 'ola'
  files:
    roots: [
      { path: 'public' }
      { path: 'sites/{site}/public', cache: 'revalidate', browse: true }
      { path: 'sites/common/public', cache: 'forever' }
      { path: 'app', cache: 'never' }
    ]
    proxyFirst: ['/api']
    shell: 'app/index.html'
```

Exact-host servers use `hosts` instead of `sites`. `hosts` and `sites` are
mutually exclusive.

Each root has optional `cache` policy: `never`, `revalidate`, or `forever`.
Omission means `revalidate`. The manager emits the normalized policy on every
Janus root. MIME detection is independent of cache policy.

An object root may set strict Boolean `browse: true` to let Janus serve
directory indexes for that root when browse is enabled in Caddy. The flag does
not configure themes or renderers; those remain process-wide Janus
configuration and are never exposed through Rip.

The manager normally prepends its own `static/generated` root with
`cache: 'revalidate'`. It resolves
every declared path against the project directory and rejects unknown keys,
missing roots, malformed browse values, missing shells, malformed templates,
overlapping API prefixes, and invalid hosts. `shell` may be omitted only when
every declared root is browsable, `proxyFirst` is empty, and the manager has no
API upstreams. That terminal browse-only policy is registered exactly as
declared, without generated or conventional roots. With `files` declared, the
project root is public only when its path is listed explicitly.

Without a `files` declaration, conventional discovery registers the generated
root, `public/` and `app/` when present, and the project directory as a final
live fallback. Declare `files` when the public surface must be finite.

Janus receives one atomic registration containing identity, site or hosts,
normalized file policy, and the initial upstream list. Hub direct mode is
Janus edge policy; it is not a separate manager registration field.

## API Generation and Hot Reload

An API change follows validate-before-cut:

```text
source change
  → short-lived generation process builds a loader-free artifact
  → changed-input check validates the exact consumed bytes
  → failure leaves current workers admitted
  → success publishes the doorbell and drains old workers
  → next API request rings one bounded boot
  → fresh workers import the prepared artifact
  → ready sockets publish atomically
  → the held request reaches fresh code
```

The manager never imports API artifacts. Compiler and bundler memory dies with
the generation child. Every worker imports the same plain-JavaScript artifact,
so worker count no longer multiplies compilation work.

App-only changes regenerate coordination files and ding browsers without
touching API admission. API-only changes replace workers without reloading the
browser App.

## Operational States and Local Control

The manager has three operational states:

- **Active:** observe and activate API and App changes.
- **Held:** keep the last generated API/App state active, emit no dings, and
  decline generation changes. Janus still reads explicitly requested authored
  files from live roots.
- **Maintenance:** keep registration and heartbeats alive with no admitted API
  upstreams; static/App requests continue and API requests receive `503`.

Control commands find the canonical manager for the project:

```bash
rip server status [project]
rip server hold [project]
rip server release [project]
rip server migrate [models] --dir migrations
rip server recover <operation-id>
```

`release` prepares one coherent API/App snapshot, exposes it, sends one
full-reload ding, and then clears hold.

Migration is explicit. It never runs because the server started, a file
changed, or a worker booted. Coordinated migration enters Maintenance, drains
workers, runs the database-only child, records a durable outcome, and either
returns safely to Held or activates the candidate. Once the database may have
changed, activation failure stays in Maintenance for fix-forward recovery.

## CLI

```bash
rip server [project] [options]
rip server browse <directory> [--host <host>] [--control <target>]
rip server browse <directory> [--host <host>] [--until-restart]
```

The project argument may identify an entry or directory. Discovery searches
for `app.rip`, `index.rip`, or `app/`.

```text
--name <name>           registration name
--host <host>           exact public host; repeatable
-w, --workers <n>       worker processes (default 2)
-c, --concurrency <n>   requests per worker (default 1; >1 requires watch off)
--watch / --no-watch    enable or disable watching
--allow-watch           required to watch under RIP_ENV=production
--eager                 boot after settle instead of waiting for a ring
--control <target>      Janus unix socket or HTTP(S) control endpoint
--until-restart         process lease for `browse`; register and exit
--access-log=<mode>     pretty, raw, or off (default pretty)
--access-format <pic>   pretty-mode access picture
```

`JANUS_CONTROL` supplies the control endpoint when `--control` is omitted.
Startup validates the endpoint before claiming the server.

`rip server browse` resolves and publishes exactly the named directory as one
`revalidate` browsable root. It publishes no worker upstreams and no SPA shell. By
default it chooses `browse-<random>.localhost`, prints
`https://<host>/`, heartbeats while running, and deletes the registration on
orderly shutdown. An explicit `--host` is claimed exactly and never changed on
conflict.

`--until-restart` creates a Janus process lease instead. The command prints the
registration id, URL, and DELETE instruction, then exits without heartbeats or
deletion. The registration survives Caddy reloads but ends with the Janus/Caddy
process unless explicitly deleted.

With watching enabled, one request per worker keeps retirement bounded.
With watching disabled, raise concurrency for I/O-bound handlers and worker
count for CPU-bound work:

> **Raise `c` when handlers wait; raise `w` when handlers work.**

Framework request context is isolated per request. Application module-level
mutable bindings are shared by concurrent requests, so handlers running with
`c > 1` keep request-specific state in local bindings or the request context.

Workers bounce excess requests with marked `503` responses so Janus can try
another ready socket without poisoning health accounting.

## Logging

Caddy and Janus own the public access log because they observe static hits,
Hub traffic, cache hits, unknown hosts, and requests that never reach a
worker.

The foreground manager subscribes to the current registration's live access
stream. `--access-log=pretty` renders one line per request with the default
picture:

```text
{local_time} {local_timezone} {duration_seconds:@s} │ {status} {mime_abbrev:<4} {response_bytes:@B} │ {method} {path} │ {mark}
```

Each replacement has this shape:

```text
{field}
{field:[alignment]width[overflow]}
{field:[alignment]width[overflow]@unit}
{field:@unit}
```

`width` is an exact terminal display width from 1 through 1,024 columns.
Alignment comes before the width:

- omitted or `<` left-aligns a short value;
- `>` right-aligns a short value;
- `^` centers a short value.

Let `S` be the requested width and `N` the value's natural display width. If
`N <= S`, the renderer pads to exactly `S`: left alignment pads on the right,
right alignment pads on the left, and center alignment puts
`floor((S-N)/2)` spaces on the left and the remainder on the right.

If `N > S`, omitted or `<` keeps the head and puts one ellipsis at the end;
`>` keeps the tail and puts one ellipsis at the start. Leading `^` selects the
centered interior and puts one ellipsis at each outer edge. That form requires
`S >= 3`, so `{path:^2}` rejects.

A trailing `^` after the width overrides those overflow rules and puts
ellipsis in the middle. It works with omitted, `<`, or `>` alignment; alignment
still affects only short-value padding. For slot `S`, the renderer assigns
`L=floor(S/2)` columns to the prefix and `R=S-L-1` to the suffix, then emits
`prefix(L) + … + suffix(R)`. Leading and trailing `^` cannot be combined:
`{path:^20^}` rejects.

For `ABCDEFG`, middle ellipsis produces:

```text
S=1  …
S=2  A…
S=3  A…G
S=4  AB…G
S=5  AB…FG
S=6  ABC…FG
```

Examples:

```text
{method:8}                 exact 8 columns; left-align when short
{status:>3}                exact 3 columns; right-align when short
{path:^40}                 exact 40 columns; centered with edge ellipses
{path:40^}                 exact 40 columns; put ellipsis in the middle
{duration_seconds:@s}      scale only; no width bound
{response_bytes:>8@B}      scale, then exact-width formatting
{duration_seconds:20^@Hz}  scale, then put ellipsis in the middle
```

Scaling is available only for `duration_seconds` and `response_bytes`. The
unit after `@` is arbitrary nonempty safe Unicode text; scaling happens before
exact-width formatting. `{{` and `}}` emit literal braces.

Raw event fields are `sequence`, `timestamp`, `request_id`, `app_id`,
`app_name`, `tenant_site`, `request_host`, `client_ip`, `method`, `path`,
`status`, `duration_seconds`, `response_bytes`, `mime_type`,
`response_class`, `cache_verdict`, `selected_upstream`, `retry_count`,
`outcome`, and `mark`. The renderer also provides `local_time`,
`local_timezone`, and `mime_abbrev`. The first two are the event timestamp in
the process local zone (`YYYY-MM-DD HH:mm:ss.SSS`) and its numeric
`+HHMM`/`-HHMM` offset; `mime_abbrev` is the lowercase MIME subtype with
common web types shortened. Null fields render `-`.

Unknown fields, malformed formats, unsafe picture text, and invalid units
reject at startup with zero-based UTF-16 offsets. `truncated_fields` and
`omitted_fields` describe the wire record and are not picture fields.

Widths use `Bun.stringWidth` and Unicode grapheme clusters. Combining
sequences, wide glyphs, and ZWJ emoji are never split. Dangerous controls are
first rendered as atomic `\u{XXXX}` text and are never cut in half. When a wide
grapheme cannot exactly occupy its allocated content columns, deterministic
spaces fill the gap so every bounded replacement is exactly `S` columns.

`--access-log=raw` writes validated Janus NDJSON byte-for-byte to stdout.
Manager reports, lifecycle notices, and both worker streams move to stderr so
stdout remains pure. `off` opens no access subscription. A heartbeat-lease
`browse` command follows re-registration; `browse --until-restart` has no
foreground owner and rejects explicit access flags.

`mark()` lets application code attach one correlation value that Janus
consumes for access logging without exposing it to the client.

## Why Workers Stay Small

Bun cannot safely provide a general `fork()`-with-copy-on-write model after
its runtime threads start. Rip recovers the useful part—compile once—without
forking:

1. A short-lived generation process builds one ESM artifact.
2. The manager retains neither API code nor compiler generation memory.
3. Every worker imports the same loader-free artifact.
4. Module evaluation and mutable heap remain correctly process-local.

This removes repeated parsing and compilation from worker startup while
preserving real process isolation and parallelism.

## Test

From this package:

```bash
bun run test
```

The suite covers the API framework in-process and drives generation, workers,
manager control, Janus registration, doorbell reload, App publication,
latest-wins dings, Full/API-only/App-only shapes, Held and Maintenance
transitions, migration recovery, and shutdown through real subprocesses and
Unix sockets.

Repository-wide certification additionally runs:

```bash
bun run test:all
cd packages/browser-tests && bunx playwright test
```

The first command covers the compiler and generated browser bundle; Playwright
certifies the real browser App and Workspace path across Chromium, Firefox,
and WebKit.
