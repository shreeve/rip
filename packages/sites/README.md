<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Sites - @rip-lang/sites

> **Rip Sites — concise routes, smart responses, validated input, safe hot reload,
> and disposable Bun workers behind Caddy and Janus (App + API)**

Rip Sites has four surfaces that share one contract:

- `@rip-lang/sites` is the framework API source imports: routes, response
  helpers, `read()` validation, schemas, middleware, sessions, and request
  context.
- `rip site` is the manager for one project: it registers with Janus,
  publishes browser-App coordination files, watches source, prepares API
  generations, and supervises worker processes.
- `rip sites` remembers projects and controls their managers through the private
  per-user Rip Agent.
- `rip edge` observes or controls the one shared Caddy+Janus edge.

Caddy and [Janus](https://github.com/shreeve/janus) form the public edge. They
own HTTP and TLS, host and tenant admission, static and App files, cache
policy, Hub WebSockets, and routing to private API worker sockets. The manager
never handles an ordinary client request.

The system-wide ownership, reload, migration, request-flow, and cache-policy
contract is [docs/SERVER.md](../../docs/SERVER.md). The App publication wire
contract and its implementation lifecycle are specified below under
[Detailed Lifecycle](#detailed-lifecycle).

## Quick Start

Install the package:

```bash
bun add @rip-lang/sites
```

Create `index.rip`:

```coffee
import { get, post, read, error, prefix, start } from '@rip-lang/sites'

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
rip site . --host hello.ripdev.io --control /run/janus/control.sock
```

`rip site` discovers `app.rip`, `index.rip`, or an App-only `app/`
directory in the selected project or its parents. One invocation creates one
manager. Many managers may register independent servers behind the same
Caddy+Janus process.

For a remembered, supervised project:

```bash
rip edge start --caddy /path/to/janus-enabled-caddy
rip sites add . --name hello --host hello.ripdev.io
rip sites start hello
rip sites open hello
```

The packaged edge baseline binds `ripdev.io` and `*.ripdev.io` on loopback
HTTPS using the real, publicly trusted development-only certificate and key
included with this package. Both names resolve only to `127.0.0.1`.
`rip edge status` also observes an already-running external edge, but Rip will
not stop or reload a process it does not own.

## The Shape of a Site

```text
Caddy + Janus
├── serves ───────────────► public/, app/, dist/
├── terminates ───────────► Hub WebSockets
└── proxies /api ─────────► private worker sockets

one Rip site
├── manager
│   ├── registration + heartbeats
│   ├── generation + worker supervision
│   ├── dist App publication
│   └── watch changes + local control
├── API source ───────────► disposable worker processes
└── App source + assets ──► served directly by Janus
```

Three project shapes use the same model:

- **Full:** API workers plus `app/` and dist App files.
- **API-only:** API workers with no browser App. Its Janus registration omits
  `files`, so every normal route remains eligible for worker proxying and no
  empty `dist/` root is created.
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
    ├── bundle.json.br            precompressed bundle representation
    └── latest.json               current App identity
```

The paths on disk are not public directory prefixes. Janus searches the
registered roots in order and appends the request path to each one. A typical
tenant registration searches `dist`, then
`sites/{site}/public`, then `sites/common/public`, then `app`. Consequently:

**Root names are never exposed.** An App member's publication URL is its path
relative to `app/`, which is also its normal public URL without the leading
slash.

- `dist/bundle.json` is requested as `/bundle.json`;
- `dist/latest.json` is requested as `/latest.json`;
- `sites/cheetos/public/logo.svg` overrides
  `sites/common/public/logo.svg` for `/logo.svg`;
- `app/routes/[id].rip` has the publication URL `routes/[id].rip` and is
  fetched from `/routes/[id].rip`; and
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
- **The manager publishes Apps.** It privately hashes managed App files,
  constructs the complete browser Rip graph, writes `bundle.json` plus its
  Brotli sidecar, and writes `latest.json` with the resulting App hash. While
  watching, it publishes one source/path change for each nonempty watcher
  batch.
- **Caddy and Janus serve bytes.** They terminate HTTPS, select the trusted
  tenant, search file roots, proxy configured API prefixes, serve the SPA
  shell, and provide ordinary HTTP cache behavior.

### Rip hashes and HTTP ETags

These identifiers are intentionally independent:

```text
authored bytes ──manager──► private file hashes ──► one App hash
file metadata  ──Janus────► weak ETag ──HTTP──────► browser cache
```

Manager uses `rash(bytes)` privately to suppress no-op events and calculate
the complete App hash. The publication client receives only that top-level
hash and compares it for equality; it never calculates a Rip hash for
server-published bytes. Janus's weak `W/"mtime-size"` ETag is a separate
transport validator used for ordinary HTTP caching. Janus neither calculates
nor compares Rip hashes.

For a real App change, Manager publishes `bundle.json`, `bundle.json.br`, then
`latest.json`, and only then sends one `change`. Rip source rides in that
change; every other asset remains normal HTTP. Generated responses use
revalidation caching, while authored file responses retain their configured
Caddy/Janus cache policy.

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
- **Latest-wins App updates:** one `from → hash` change names the affected
  paths; Rip source rides with the change and ordinary HTTP supplies every
  other asset.
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
import { use, session } from '@rip-lang/sites'
import {
  cors, csrf, htmlJson, secureHeaders, sessions, timeout
} from '@rip-lang/sites/middleware'

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

An `app/` directory is the browser App. Manager packages its complete browser
Rip program in `dist/bundle.json` and publishes the current App identity in
`dist/latest.json`.

Janus serves:

- The App shell
- Authored `.rip`, CSS, HTML, and other registered files
- `bundle.json` and `latest.json`
- The browser runtime at `/@rip/rip.js`, including compiled `@rip-lang/app`
- Hub WebSockets

Workers serve API routes only. The manager writes files and publishes control
state but is never on the client data path.

The complete `@rip-lang/app` package is part of the versioned browser runtime,
not an App publication. `bundle.json` carries authored modules and any imported
non-core browser packages; it never duplicates App framework source. Authored
imports from `@rip-lang/app` resolve to the copy already active in `rip.js`.

The conventional change policy updates every `.rip`, refreshes every `.css`,
and reloads for every other non-hidden App file. Paths are relative to the App
root. One watcher batch produces one `change`; a batch with no effective byte
change publishes nothing:

- `.rip` → compile and apply source carried by the change
- `.css` → refetch the existing stylesheet URL
- every other managed file → full reload
- an unrecognized or disconnected transition → full reload

Rip Manager is the only hash authority. The browser stores one declared App
hash and never recalculates it. Janus does not retain historical App versions.

See [docs/WORKSPACE.md](../../docs/WORKSPACE.md) for the browser publication
consumer and mutation contract.

## Detailed Lifecycle

This section is the implementation contract for App publication shared by Rip
Sites, Rip App, and the browser runtime. Its central separation is:

```text
HTTP                            WSS /hub while watching
────                            ───────────────────────
bundle.json: browser Rip source change: changed Rip source and asset paths
latest.json: current App hash   reload: server-generation replacement
CSS, HTML, images, fonts        no ordinary asset bytes
```

`manifest.json` is not part of this protocol. `bundle.json` is one compressed
startup package for the browser Rip program, `latest.json` is the inexpensive
reconnect probe, and every non-Rip asset remains an ordinary HTTP resource.

### Authority and browser state

Rip Manager owns all hashing. Its watcher retains private file hashes to
reject idempotent filesystem events. From the complete managed App state and
the browser Rip graph it calculates one App hash. Individual file hashes never
cross the wire.

The browser keeps:

```text
current hash          manager-declared complete App identity
active Rip source     canonical source used to stage later changes
compiled module graph executable browser Rip program
```

The client never recalculates a server hash. The JSON publication envelope is
released after activation; its active Rip source lives once in Workspace so a
later change can be staged transactionally. Ordinary assets remain in the
browser's HTTP cache rather than a second Rip-owned content store.

### Canonical URLs and bundle hash

A module path is App-root-relative, such as `routes/home.rip`, never a disk
path such as `app/routes/home.rip`. Browser-package modules use canonical
paths such as `@rip-lang/http/index.rip`. Paths have no leading slash, query,
fragment, backslash, empty segment, `.` segment, or `..` segment.

Every wire hash is the six-character, Base64URL-folded value produced by `rash`.
It is a Rip synchronization identity and never an HTTP ETag.

Manager calculates each private file hash over exact bytes, sorts the complete
`[path, fileHash]` identity list by path, and calculates the App hash as:

```text
rash(UTF8(JSON.stringify(canonical [[path, fileHash], ...] list)))
```

The identity list is Manager-private. It covers configured App files plus Rip
source materialized from browser-safe packages and schema projections. Browser
publication imports are static: a candidate with a dynamic import, missing or
cyclic import, invalid or duplicate module path, invalid UTF-8 source, unknown
package, or server-only browser code rejects before publication.

### `bundle.json`: complete state

`GET /bundle.json` returns the complete browser Rip program:

```json
{
  "hash": "APP123",
  "list": [
    ["@rip-lang/http/index.rip", "export class HTTPError ..."],
    ["data.rip", "export data = ..."],
    ["routes/index.rip", "export Index = component ..."]
  ]
}
```

The rules are:

- `hash` is the resulting complete App hash.
- `list` contains exactly `[modulePath, RipSource]` pairs.
- The list is sorted by module path and contains every browser Rip module once.
- `@rip-lang/app` is absent because `rip.js` embeds it.
- CSS, HTML, images, fonts, video, and other ordinary assets are absent.
- A complete bundle contains no deletion markers.

Manager also writes `bundle.json.br` from the exact `bundle.json` bytes. A
client requests `/bundle.json`; an edge with precompressed-file support may
select the Brotli sidecar transparently. JSON parsing follows transparent HTTP
decompression.

### `latest.json`: reconnect identity

`GET /latest.json` returns only the current complete bundle hash:

```json
{"hash":"APP123"}
```

Rip Manager writes this file after committing `bundle.json`. The generated
root uses revalidation caching, so a reconnect request cannot treat an
unvalidated cached response as current. `latest.json` is outside the watched
App root, never appears in a change, and cannot create a watcher feedback loop.

The file exists whether watching is enabled or disabled. A client uses it for
live-session recovery only when the publication feed is active. A production
Hub used for chat, presence, CRDTs, or other application traffic does not by
itself activate the publication feed.

### `change`: one App transition

With watching active, one nonempty watcher batch produces one WSS message:

```json
{
  "change": {
      "from": "APP123",
      "hash": "APP124",
      "list": [
      ["routes/index.rip", "updated Rip source"],
      ["styles.css"]
    ]
  }
}
```

Its meaning is: "If the client is at `from`, applying this list advances it
to `hash`." The fields are:

- `from`: the complete bundle hash immediately before the watcher batch.
- `hash`: the complete bundle hash after the watcher batch.
- `list`: only paths created, changed, or deleted by that batch.

The list is sorted by path and contains each affected path once:

- A Rip creation or replacement uses `[path, source]`.
- A non-Rip creation or replacement uses `[path]`; the browser uses HTTP.
- Any deletion uses `[path, null]`.

```json
{"change":{"from":"APP124","hash":"APP125","list":[["routes/old.rip",null]]}}
```

A rename is one atomic deletion plus creation. The transport does not infer a
rename from watcher event names and does not preserve component identity
across it; any state-preserving rename semantics belong to Rip App.

An ordinary transition has different `from` and `hash` values and a nonempty
list. An unchanged watcher batch emits no message. WSS never carries the
complete `bundle.json`, ordinary asset bytes, or `latest.json`.

### Manager startup and initial publication

At startup the manager:

1. Resolves the configured App root and change policy.
2. Reads and privately hashes every managed App file once.
3. Constructs and validates the complete browser Rip graph.
4. Calculates the one complete App hash.
5. Serializes `bundle.json` and compresses those exact bytes.
6. Publishes `bundle.json`, `bundle.json.br`, then `latest.json`.
7. Opens the watcher only in watch mode.

Watch and non-watch modes use this identical initial path. Manager prepares
hidden temporary JSON and Brotli files first. It removes the old Brotli
sidecar, atomically renames the new JSON over `bundle.json`, installs the new
sidecar, and then atomically updates `latest.json`. The deliberate sidecar gap
may temporarily lose compression but can never pair new JSON with old Brotli
bytes. `latest.json` never leads the complete recovery document.

### Initial browser load

Initial App boot does not depend on WSS or `latest.json`:

1. The browser requests `/bundle.json`.
2. HTTP transparently decompresses the Brotli representation when selected.
3. Rip App validates the envelope and compiles every listed Rip module.
4. It discards the source envelope after compilation.
5. It commits the compiled graph and one App hash.
6. The App renders while ordinary assets load through normal HTTP references.

If the Hub is unavailable, initial HTTP boot still succeeds. Watching only
controls whether an already-open App receives live transitions.

### Watch processing and publication

The recursive watcher exists only in watch mode and observes the configured
App root. Manager-owned output lives under `dist/`, outside that root, and is
never watched. `app.changes` classifies managed paths as `update`, `css`, or
`reload`; unmatched paths remain ordinary Janus-served static files.

For exact matching file events, the manager collects only the reported URLs
in one debounced dirty set. It reads and hashes only those files. Directory,
pathless, overflow, or otherwise ambiguous events require a complete
membership reconciliation because the watcher did not identify a trustworthy
individual path.

One batch follows this order:

```text
read and privately hash watcher-identified files
→ stop if every reported file is byte-identical
→ merge actual changes into the prior source graph
→ reconstruct and validate the browser Rip graph
→ calculate the resulting App hash
→ publish bundle.json / bundle.json.br / latest.json
→ commit the Manager's in-memory publication
→ publish one WSS change
```

Writing `bundle.json` and `latest.json` is manager publication, not an App
file event. Neither write produces another change.

If graph construction, validation, or canonical JSON publication fails, the
manager does not advance its in-memory publication and sends no change. A
Brotli-sidecar installation failure is reported loudly but leaves the valid
canonical JSON available. If a client misses a transition, the next `from`
mismatch or reconnect probe forces a page reload.

### Live client application

The browser serializes changes in WSS arrival order. For each change:

```text
if current hash == change.hash
  ignore the duplicate

else if current hash != change.from
  stop applying queued changes and reload the page

else
  stage and compile the resulting Rip program
  refresh CSS through HTTP or reload for other assets
  atomically commit the module changes and change.hash
  emit one Rip App apply batch
```

The browser trusts Manager's App hash and never hashes source or HTTP
responses. A Rip entry already contains its replacement source. A CSS entry
has only its path and refreshes the linked stylesheet through HTTP. HTML and
the default unknown-asset verdict reload the page. A malformed entry,
disconnected transition, deletion that cannot be applied, or uncertain
post-commit teardown reloads.

A Rip compile or activation failure rejects and quarantines that candidate
hash while the last committed App remains live. Repeated delivery or reconnect
confirmation of the same rejected hash does not retry it or reload the same
bad complete bundle. The first observed hash beyond the rejected generation
reloads the page and obtains the newer complete bundle.

A validated Rip transition that requires whole-App reconstruction, such as a
stash change or deletion of the mounted route or layout, is not a rejected
generation. It requests a document reload so the browser activates the valid
complete bundle from HTTP.

### Reconnect in watch mode

The browser never uses the WebSocket `open` event alone as proof that its
subscription is active. It installs the message handler first, then sends one
Janus frame that joins `/hub` and asks for an acknowledgement:

```json
{"+":["/hub"],"?":"sync-17"}
```

It buffers incoming changes immediately and waits for:

```json
{"!":"sync-17"}
```

Only that exact, outstanding, server-origin acknowledgement starts the probe.
A client-origin frame stamped with `<`, a combined frame, or a duplicate
acknowledgement is ignored.

After the acknowledgement it requests `/latest.json` with
`cache: "no-store"`:

- If `latest.json.hash` equals the current client hash, no bundle fetch is
  required.
- If a candidate hash is quarantined and `latest.json.hash` still equals it,
  the client keeps the last committed App and waits.
- Any other hash difference reloads the page and obtains the complete bundle.
- Buffered changes are applied only when their `from` value still matches.
- A duplicate whose `hash` is already current is ignored.
- Any disconnected transition or ordering uncertainty reloads the page.

This ordering closes every reconnect race:

- A change completed before subscription is visible through `latest.json` and
  `bundle.json`.
- A change completed after subscription is delivered through WSS.
- A change racing the HTTP checks may be represented by both paths, and the
  duplicate rule makes that harmless.

Browser `online`, page restoration, and tab resumption are triggers to attempt
this procedure, not proof that the network or App state is current. A failed
probe leaves the last committed App running and retries with bounded backoff.
If an operational reload arrives during a quarantine probe, the browser queues
a fresh probe behind the in-flight request so a stale response cannot swallow
the newer Server generation.

### Rip source and ordinary assets

Changed Rip source always rides with a watch-mode change:

```json
{
  "change": {
    "from": "APP123",
    "hash": "APP124",
    "list": [
      ["routes/index.rip", "export Index = component ..."]
    ]
  }
}
```

This is the same precision-update optimization as the initial bundle: Rip
source is small, textual, and immediately compilation-critical. Non-Rip
entries contain no bytes. CSS refreshes by path, HTML reloads, and the default
verdict for another managed asset is reload. Deletion is `[path, null]` for
every file type.

### Watch-off and production behavior

With watching disabled, Manager runs the same construction and atomic
publication steps but creates no App watcher and sends no publication
changes. The same Janus Hub may independently carry application-owned chat,
presence, CRDT, collaboration, or other realtime traffic. Those messages do
not activate file watching and are outside this lifecycle.

All non-Rip App bytes remain available through HTTP in both modes. A future
production publication feed can use the same `from → hash` contract; merely
having an application Hub does not enable one.

### Implementation boundary

Rip Sites owns publication construction and commit. Its focused suite pins
source-graph construction, package normalization, exact-path watcher hashing,
idempotent-save suppression, the JSON/Brotli pair, matching `latest.json`,
watch-off publication, and one batched `change` through real Janus.

Rip App consumes this publication directly. No compatibility adapter or dual
wire format sits between Manager and the browser.

#### Rip App and browser integration

The browser implementation updates the existing browser seams without moving
server logic into Rip App:

- Rip App's browser entry consumes `bundle.json`, compiles its source list,
  discards the envelope, and stops validating Manager declarations by hashing
  their source.
- `packages/app/feed.rip` consumes `change` and owns the acknowledged
  subscribe-before-`latest.json` reconnect flow. It has no separate manifest
  reconciliation or per-file notification format.
- Rip App keeps ownership of `.rip` compilation/update, CSS replacement, HTML
  or unknown-asset reload, last-known-good behavior, and one atomic apply
  batch.

The complete browser surface still belongs to Rip App and ships in `rip.js`.
Its internal launch core receives compiled components and remains ignorant of
HTTP, WSS, `latest.json`, and bundle syntax.

### Server acceptance tests

The Server/Manager suite establishes:

1. Watch and non-watch startup produce the same two-key bundle shape.
2. `bundle.json.br` decompresses to the exact canonical JSON bytes.
3. `latest.json.hash` equals `bundle.json.hash`.
4. `manifest.json` is absent.
5. Browser-safe packages normalize to canonical `index.rip` paths without a
   resolver-metadata key.
6. Exact watcher events rehash only their reported paths.
7. An idempotent save publishes nothing.
8. A Rip edit publishes its source in one `from → hash` change.
9. A CSS edit publishes only its path.
10. A deletion publishes `[path, null]`.
11. Real Janus serves the JSON and latest probe and transports the batch.
12. Hold, release, migration, and API replacement retain publication fences.

### Browser acceptance tests

Rip App and browser tests establish:

1. Browser boot obtains the complete server publication without a manifest.
2. The browser stores one Manager-declared App hash without recalculating it.
3. `.rip`, CSS, HTML, creation, deletion, and rename produce the specified App
   verdicts from one change.
4. A failed compile or activation quarantines its candidate hash and leaves
   the prior App generation running.
5. Missing, duplicate, and racing changes either apply in order, remain on a
   quarantined generation, or reload to a newer complete bundle.
6. Initial HTTP boot and the last committed App remain usable while the Hub is
   unavailable.
7. Real-browser Chromium, Firefox, and WebKit scenarios exercise initial load
   and live change; focused feed tests exercise disconnect, reconnect, races,
   and failed activation.

## App-Local `serve.rip`

`serve.rip` next to the project entry declares Janus-facing identity and file
policy:

```coffee
export default
  name: 'medlabs'
  hub:
    bridge: 'hub'
  app:
    root: 'app'
    changes:
      update: ['**/*.rip']
      css: ['**/*.css']
      reload: ['**/*']
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
`app.changes` classifies authored files by client apply verdict. The block
shown above is the complete default; omitting `app`, `changes`, or one of its
categories retains the corresponding default. An explicit empty category
disables it. `update` accepts `.rip` globs, `css` accepts `.css` globs, and
`reload` accepts every other App-relative glob. A `.rip` or `.css` file not
selected by its owned category does not fall through to `reload`.

Dot-prefixed path segments remain outside publication. Bun observes the App
root recursively only in watch mode. Matching file events reread and rehash
only the exact App-relative paths reported by the watcher. Directory and
pathless events fall back to a full reconciliation.

Package manifests and schema projections discovered while constructing the
browser Rip graph are publication inputs even when they live outside
`app.root`. Manager installs recursive watchers for their roots before an
authoritative reread, so an edit during registration is either included in
that publication or schedules a following full reconciliation. External
schema projection uses the conventional `app` root; a custom `app.root`
rejects that combination because the browser projection mount would be
ambiguous.

Whether Manager owns the generated shell or an authored `index.html` is fixed
when the App starts. Creating or deleting authored `index.html` while Manager
is running rejects the publication; restart the App to change shell ownership.

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

Without a `files` declaration, a browser App registers `dist/` plus `public/`
and `app/` when present. A genuinely API-only project with no file surface
omits `files` entirely. The project directory is never an implicit public
root.

Janus receives one atomic registration containing identity, site or hosts,
normalized file policy, optional Bam `bridge`, and the initial upstream
list. App-local `hub.bridge: 'hub'` (or `'/hub'`, `'///hub///'`, …) normalizes
to `/hub`; Manager registers that path and ensures it is proxied to workers.
Presence of `hub.bridge` selects Janus bridge mode’s tenant HTTP door; Manager
publication still uses control-plane `hub/publish` and does not ride the bridge.

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

App-only changes regenerate coordination files and notify watching browsers
without touching API admission. API-only changes replace workers without
reloading the browser App.

## Operational States and Local Control

The manager has three operational states:

- **Active:** observe and activate API and App changes.
- **Held:** keep the last generated API/App state active, emit no App changes, and
  decline generation changes. Janus still reads explicitly requested authored
  files from live roots.
- **Maintenance:** keep registration and heartbeats alive with no admitted API
  upstreams; static/App requests continue and API requests receive `503`.

Control commands find the canonical manager for the project:

```bash
rip site status [project]
rip site stop [project]
rip site hold [project]
rip site release [project]
rip site migrate [models] --dir migrations
rip site recover <operation-id>
```

`status` prints the manager's machine-readable JSON state. `stop` asks the
canonical manager to drain its workers, deregister from Janus, remove its local
control artifacts, and exit cleanly.

`release` prepares one coherent API/App snapshot, exposes it, sends one
full-reload notification, and then clears hold.

## Per-User App and Edge Control

The Rip Agent is private process machinery shared by both public CLIs. It
auto-starts on demand, stores one durable app catalog, captures manager and
edge logs, and adopts healthy managers after an agent restart.

```bash
rip sites list
rip sites add [project] [--name NAME] [--host HOST]
rip sites start <site>
rip sites stop <site>
rip sites restart <site>
rip sites status [site] [--json]
rip sites open <site>
rip sites logs <site> [--lines N] [--follow]

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

On macOS, the packaged baseline remains both unprivileged and loopback-only on
standard HTTPS. The Agent registers a per-user `launchd` socket for
`127.0.0.1:443`; the launchd listener passes that descriptor to an ordinary
user-owned Caddy process, which serves HTTP/1.1 and HTTP/2 directly from the
inherited TCP socket. The packaged Caddyfile explicitly selects `h1 h2` because
HTTP/3 is QUIC over UDP and cannot use the stream descriptor passed as `fd/3`.
Adding HTTP/3 to this launch path requires a separately inherited loopback UDP
socket on port 443 and Caddy integration that assigns it to QUIC; enabling the
protocol without that datagram listener makes Caddy reject startup. Stop
removes the launchd job and releases port 443. A running edge survives an Agent
restart, and the Agent recreates its launchd job after a login or reboot when
the durable desired state is `running`. An explicitly selected Caddyfile runs
directly as a Rip-owned child and retains its own listener choices.

Migration is explicit. It never runs because the server started, a file
changed, or a worker booted. Coordinated migration enters Maintenance, drains
workers, runs the database-only child, records a durable outcome, and either
returns safely to Held or activates the candidate. Once the database may have
changed, activation failure stays in Maintenance for fix-forward recovery.

## CLI

```bash
rip site [project] [options]
rip site browse <directory> [--host <host>] [--control <target>]
rip site browse <directory> [--host <host>] [--until-restart]
```

The project argument may identify an entry or directory. Discovery searches
for `app.rip`, `index.rip`, or `app/`.

```text
--name <name>           registration name
--host <host>           exact public host; repeatable
-w, --workers <n>       worker processes (default 2)
-c, --concurrency <n>   requests per worker (default 1; >1 requires API watch off)
--watch / --no-watch    enable or disable App and API watching together
--watch-app / --no-watch-app
--watch-api / --no-watch-api
                        enable or disable App publication or API worker watching
--allow-watch           required to watch under RIP_ENV=production
--eager                 boot after settle instead of waiting for a ring
--control <target>      Janus unix socket or HTTP(S) control endpoint
--until-restart         process lease for `browse`; register and exit
--access-log=<mode>     pretty, raw, or off (default pretty)
--access-format <pic>   pretty-mode access picture
```

`JANUS_CONTROL` supplies the control endpoint when `--control` is omitted.
Startup validates the endpoint before claiming the server.

`rip site browse` resolves and publishes exactly the named directory as one
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
bun run test:hello-app
bun run test:reloads
bun run test:operations
bun run test:manager-boundary
bun run test:middleware
bun run test:monitor
bun run test:appliance
bun run test:janus
```

`test:janus` builds and caches a Caddy binary with released Janus `v1.6.1`;
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
