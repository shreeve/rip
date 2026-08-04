<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Server - @rip-lang/server

> **Sinatra-style API framework and per-server runtime — concise routes, smart
> responses, validated input, safe hot reload, and disposable Bun workers
> behind Caddy and Janus**

Rip Server has four surfaces that share one contract:

- `@rip-lang/server` is the framework API source imports: routes, response
  helpers, `read()` validation, schemas, middleware, sessions, and request
  context.
- `rip server` is the manager for one project: it registers with Janus,
  publishes browser-App coordination files, watches source, prepares API
  generations, and supervises worker processes.
- `rip app` remembers projects and controls their managers through the private
  per-user Rip Agent.
- `rip edge` observes or controls the one shared Caddy+Janus edge.

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

For a remembered, supervised project:

```bash
rip edge start --caddy /path/to/janus-enabled-caddy
rip app add . --name hello --host hello.ripdev.io
rip app start hello
rip app open hello
```

The packaged edge baseline binds `ripdev.io` and `*.ripdev.io` on loopback
HTTPS using the real, publicly trusted development-only certificate and key
included with this package. Both names resolve only to `127.0.0.1`.
`rip edge status` also observes an already-running external edge, but Rip will
not stop or reload a process it does not own.

## The Shape of a Server

```text
Caddy + Janus
├── serves ───────────────► public/, app/, dist/
├── terminates ───────────► Hub WebSockets
└── proxies /api ─────────► private worker sockets

one Rip server
├── manager
│   ├── registration + heartbeats
│   ├── generation + worker supervision
│   ├── dist App publication
│   └── watch dings + local control
├── API source ───────────► disposable worker processes
└── App source + assets ──► served directly by Janus
```

Three project shapes use the same model:

- **Full:** API workers plus `app/` and dist App files.
- **API-only:** API workers with no browser App.
- **App-only:** `app/` and dist files with no API workers.

## Site Files and Ownership

A full multi-tenant project may look like this on disk:

```text
project/
├── index.rip                     API entry and route registration
├── api/                          worker source; not implicitly public
├── sites/
│   ├── cheetos/public/           files specific to the `cheetos` tenant
│   └── common/public/            shared fallback files
├── app/
│   ├── index.html                optional SPA shell
│   ├── routes/[id].rip           live Rip modules
│   └── styles.css
└── dist/                         manager-owned publication
    ├── @rip/rip.js
    ├── bundle.json
    └── manifest.json             watch publication artifact
```

The paths on disk are not public directory prefixes. Janus searches the
registered roots in order and appends the request path to each one. A typical
tenant registration searches `dist`, then
`sites/{site}/public`, then `sites/common/public`, then `app`. Consequently:

**Root names are never exposed.** An App member's id is its path relative to
`app/`, which is also its normal public URL without the leading slash.

- `dist/bundle.json` is requested as `/bundle.json`;
- `sites/cheetos/public/logo.svg` overrides
  `sites/common/public/logo.svg` for `/logo.svg`;
- `app/routes/[id].rip` has the bag id `routes/[id].rip` and is fetched from
  `/routes/[id].rip`; and
- `app/index.html` is an HTML-navigation fallback, not a response for a
  missing script, stylesheet, image, or module.

`serve.rip` makes the host or tenant rule, root order, API prefixes, cache
policy, and shell explicit. Without it, ordinary projects discover `dist/`
plus existing `public/` and `app/` roots. The project root and
`api/` are never implicitly public.

The three owners have deliberately narrow jobs:

- **Workers execute API routes.** A route such as `/api/private/profile` may
  talk to S3 and return a normal response. A route serving a private local file
  may use `@send`; the worker selects the file and Janus performs the actual
  `X-Sendfile` transfer, including validators, ranges, and content type.
- **The manager publishes App identity.** It snapshots the configured App
  manifest (by default `app/**/*.{rip,css,html}`), assigns each member a six-character content
  `hash`, and identifies it relative to the App root (`routes/home.rip`, not
  `app/routes/home.rip`). It writes a deterministic `bundle.json` and—while
  watching—a matching `manifest.json`. The bundle carries the complete
  inventory plus Rip module source needed for first paint; the manifest
  carries the inventory without source bodies.
- **Caddy and Janus serve bytes.** They terminate HTTPS, select the trusted
  tenant, search file roots, proxy configured API prefixes, serve the SPA
  shell, and provide ordinary HTTP cache behavior.

### Rip hashes and HTTP ETags

These identifiers are intentionally independent:

```text
authored bytes ──manager──► hash/rash ──Hub ding──► browser Workspace
file metadata  ──Janus────► weak ETag  ──HTTP──────► browser cache
```

The manager's `hash` is a content identity (`rash(bytes)`) used to suppress
no-op changes, describe the manifest, and tell an open browser that a bag
member may be newer. Janus's weak `W/"mtime-size"` ETag is a cheap transport
validator used for conditional HTTP requests. Janus neither calculates nor
compares Rip hashes.

For a real App change, the manager writes the bundle and then the manifest,
atomically replacing each file, and only then publishes a tiny `{id, hash}`
ding. The browser treats that hash as a
freshness hint, fetches the current file at its ordinary URL with
`cache: "no-store"`, hashes the bytes it actually received, and applies only
the latest completed fetch. This remains correct if another edit lands between
the ding and the fetch. Stable generated URLs such as `/bundle.json` and
`/manifest.json` instead use `Cache-Control: no-cache` plus Janus's ETag, so
an unchanged revalidation is a cheap `304`.

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
- **Middleware:** Web-standard composition plus CORS, sessions, CSRF,
  security headers, cooperative timeout, and mobile JSON rendering.
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
import {
  cors, csrf, htmlJson, secureHeaders, sessions, timeout
} from '@rip-lang/server/middleware'

use secureHeaders!
use cors origin: 'https://app.example.com'
use sessions secret: process.env.SESSION_SECRET, encrypt: true
use csrf secret: process.env.SESSION_SECRET
use '/api/reports', timeout 120, grace: 2
use htmlJson

use '/api/private', (request, next) ->
  return new Response('unauthorized', { status: 401 }) unless session.user
  next!()
```

Global and path-scoped middleware share one registration order. Calling
`next!()` continues the chain; returning a `Response` short-circuits it.

Framework filters operate on the Rip request context:

```coffee
raw (request) ->                     # before body parsing
  ...

before ->
  bail! unless session.user

after ->
  recordAudit! @req.path, @mark
```

`before` and `after` apply to every matched route in registration order.
`raw` receives the Web `Request` before Rip parses its body. `App`, `env`,
`resetGlobals`, and `requestContext` remain available for embedded runtimes,
configuration, and isolated framework tests.

Built-ins:

- `cors`
- `sessions`
- `csrf`
- `secureHeaders`
- `timeout`
- `htmlJson`

Sessions are HMAC-signed by default or AES-256-GCM sealed with
`encrypt: true`. CSRF uses a signed double-submit cookie and constant-time
header comparison. Both require a secret.

`cors` handles every `OPTIONS` request with `204`; allowed preflights receive
the configured CORS headers. Wildcard credentials reject.

`timeout 30, grace: 1` uses integer seconds. At the timeout it aborts the
downstream `Request`, returns `504 Gateway Timeout`, and gives cancellation one
grace period to settle before recycling the worker. It can be scoped with
`use '/path', timeout 120, grace: 2`.

`secureHeaders` fills absent application response headers with `nosniff`,
`strict-origin-when-cross-origin`, a minimal CSP, and `SAMEORIGIN`. Explicit
response headers win; individual defaults accept `false`. It does not emit
obsolete `X-XSS-Protection` or edge-owned HSTS.

`htmlJson` renders bounded JSON as escaped, highlighted HTML for direct iOS
navigation. API requests, encoded bodies, and responses larger than 1 MB pass
through as JSON with cache-correct `Vary` headers.

Compression belongs at the Caddy edge, where streaming `encode` can cover
static, generated, `X-Sendfile`, and proxied API responses. Applications use
standard controls: `Cache-Control: no-transform` disables transformation and
an existing `Content-Encoding` remains authoritative.

## Browser App and Development Feed

An `app/` directory is the browser App. The manager assembles its `.rip`
module graph into `dist/bundle.json`; while watching, it also
publishes `manifest.json`.

Janus serves:

- The App shell
- Authored `.rip`, CSS, HTML, and other registered files
- `bundle.json` and `manifest.json`
- The browser runtime at `/@rip/rip.js`
- Hub WebSockets

Workers serve API routes only. The manager writes files and publishes control
state but is never on the client data path.

The conventional development manifest selects `app/**/*.{rip,css,html}`. Its
ids are relative to the App root, so a change to `app/routes/home.rip`
produces a tiny ding naming `{id: "routes/home.rip", hash}`:

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
  app:
    root: 'app'
    manifest:
      update: ['**/*.rip']
      css: ['**/*.css']
      reload: ['**/*.html']
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

`app.root` selects the browser App directory relative to the project.
`app.manifest` classifies authored files by client apply verdict. The block
shown above is the complete default; omitting `app`, `manifest`, or one of its
categories retains the corresponding default. An explicit empty category
disables it. Patterns are relative globs and each category accepts only its
owned suffix (`.rip`, `.css`, or `.html`). Dot-prefixed path segments remain
outside the manifest. Bun still observes the entire App root recursively.
Nonmatching asset-file events do no publication work, and matching file events
reread and rehash only the exact App-relative paths reported by the watcher.
Directory and pathless events fall back to a full membership reconciliation.

Each root has optional `cache` policy: `never`, `revalidate`, or `forever`.
Omission means `revalidate`. The manager emits the normalized policy on every
Janus root. MIME detection is independent of cache policy.

An object root may set strict Boolean `browse: true` to let Janus serve
directory indexes for that root when browse is enabled in Caddy. The flag does
not configure themes or renderers; those remain process-wide Janus
configuration and are never exposed through Rip.

The manager normally prepends its own `dist` root with
`cache: 'revalidate'`. It resolves
every declared path against the project directory and rejects unknown keys,
missing roots, malformed browse values, missing shells, malformed templates,
overlapping API prefixes, and invalid hosts. `shell` may be omitted only when
every declared root is browsable, `proxyFirst` is empty, and the manager has no
API upstreams. That terminal browse-only policy is registered exactly as
declared, without the dist or conventional roots. With `files` declared, the
project root is public only when its path is listed explicitly.

Without a `files` declaration, conventional discovery registers `dist/` plus
`public/` and `app/` when present. The project directory is never an
implicit public root.

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
rip server stop [project]
rip server hold [project]
rip server release [project]
rip server migrate [models] --dir migrations
rip server recover <operation-id>
```

`status` prints the manager's machine-readable JSON state. `stop` asks the
canonical manager to drain its workers, deregister from Janus, remove its local
control artifacts, and exit cleanly.

`release` prepares one coherent API/App snapshot, exposes it, sends one
full-reload ding, and then clears hold.

## Per-User App and Edge Control

The Rip Agent is private process machinery shared by both public CLIs. It
auto-starts on demand, stores one durable app catalog, captures manager and
edge logs, and adopts healthy managers after an agent restart.

```bash
rip app list
rip app add [project] [--name NAME] [--host HOST]
rip app start <app>
rip app stop <app>
rip app restart <app>
rip app status [app] [--json]
rip app open <app>
rip app logs <app> [--lines N] [--follow]

rip edge status [--json]
rip edge start [--caddy PATH] [--config PATH]
rip edge stop
rip edge reload
```

An app selector may be its stable id, unique name, or canonical root. Removal
rejects while the app is running. Starting requires a reachable Janus control
plane. Stopping the edge rejects while an app manager is still running.

`rip edge start` finds Caddy through `--caddy`, the remembered configuration,
`JANUS_CADDY`, or `PATH`, in that order, and verifies that the binary contains
Janus before starting it. `--config` selects another Caddyfile; the packaged
baseline is the default. An external reachable edge is observable but never
silently adopted as a Rip-owned process.

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

The focused fixtures test one server capability at a time:

```bash
bun run test:framework
bun run test:hello-api
bun run test:workers
bun run test:hello
bun run test:reloads
bun run test:operations
bun run test:manager-boundary
bun run test:middleware
bun run test:monitor
bun run test:appliance
bun run test:janus
```

`test:janus` builds and caches a Caddy binary with released Janus `v1.5.0`;
`JANUS_CADDY` can override that binary. `bun run test` discovers and runs every
`test/*/test.rip` fixture.

Repository-wide certification additionally runs:

```bash
bun run test:all
cd packages/browser-tests && bunx playwright test
```

The first command covers the compiler and generated browser bundle; Playwright
certifies the real browser App and Workspace path across Chromium, Firefox,
and WebKit.
