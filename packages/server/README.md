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

The system-wide ownership, reload, migration, request-flow, and cache-policy
contract is [docs/SERVER.md](../../docs/SERVER.md). The App publication wire
contract and its implementation lifecycle are specified below under
[Detailed Lifecycle](#detailed-lifecycle).

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
│   └── watch changes + local control
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
    └── latest.json               current bundle identity
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
- **The manager publishes App identity.** It snapshots the configured App
  manifest (by default `app/**/*.{rip,css,html}`), assigns each member a
  six-character content `hash`, and identifies it relative to the App root
  (`routes/home.rip`, not `app/routes/home.rip`). It writes a deterministic
  `bundle.json` containing the complete member inventory and a tiny
  `latest.json` containing only the resulting bundle hash. While watching, it
  publishes one metadata change for each nonempty watcher batch.
- **Caddy and Janus serve bytes.** They terminate HTTPS, select the trusted
  tenant, search file roots, proxy configured API prefixes, serve the SPA
  shell, and provide ordinary HTTP cache behavior.

### Rip hashes and HTTP ETags

These identifiers are intentionally independent:

```text
authored bytes ──manager──► hash ──Hub change──► browser Workspace
file metadata  ──Janus────► weak ETag  ──HTTP──────► browser cache
```

The manager's `hash` is a content identity produced by `rash(bytes)` and used to suppress
no-op changes, describe individual files, and construct the complete bundle
hash. The publication client trusts manager-issued Rip hashes and compares
them for equality; it never calculates a Rip hash for server-published bytes
or bundle state. Janus's weak `W/"mtime-size"` ETag is a separate transport
validator used for ordinary HTTP caching. Janus neither calculates nor
compares Rip hashes.

For a real App change, the manager atomically replaces `bundle.json`, then
`latest.json`, and only then publishes one metadata-only `change`. The browser
fetches non-eager content at its ordinary URL. `/latest.json` uses
`Cache-Control: no-store` because it is the small authoritative reconnect
probe. File responses retain their configured Caddy/Janus cache policy.

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
  URLs; ordinary HTTP supplies content, with explicitly enabled development
  mode allowed to carry bounded eager text.
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

An `app/` directory is the browser App. The manager publishes its complete
configured membership in `dist/bundle.json` and publishes the current bundle
identity in `dist/latest.json`.

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

The conventional App membership selects `app/**/*.{rip,css,html}`. Its URLs
are relative to the App root, so `app/routes/home.rip` is represented as
`routes/home.rip` and requested as `/routes/home.rip`. One watcher batch
produces one `change` containing its affected URLs; a batch with no effective
change publishes nothing:

- `.rip` → fetch and apply the latest module
- `.css` → fetch latest bytes and update the existing stylesheet URL
- `.html` → full reload
- an unrecognized or disconnected transition → recover from `bundle.json`

Rip Manager is the only Rip-hash authority for server-published files. The
browser stores and compares manager-declared hashes but never recalculates
them. Rapid saves converge on the newest available HTTP representation; Janus
does not retain historical App versions.

See [docs/WORKSPACE.md](../../docs/WORKSPACE.md) for the browser passport bag
and door contract.

## Detailed Lifecycle

This section is the implementation contract for App publication shared by Rip
Server, Rip App, and the browser runtime. Its central separation is:

```text
HTTP                         WSS /hub
────                         ────────
bundle.json                  change metadata
latest.json                  optional bounded development text
authored file content        no production file content
```

`manifest.json` is not part of this protocol. `bundle.json` is the complete
App snapshot, and `latest.json` is the inexpensive reconnect probe.

### Authority and browser state

Rip Manager owns all Rip hashes. For each configured App member it calculates
`rash(bytes)`, and from the complete canonical member list it calculates the
bundle hash. The publication client never hashes downloaded server bytes and
never recomputes the server bundle hash. It trusts the manager's declarations
and uses hashes as synchronization identities, not as client-verified
integrity proofs. Hashes for browser-local editor entries are outside this
server-publication protocol.

The browser keeps three related pieces of state:

```text
File Store       URL → content, when content has been obtained
Hash Store       URL → manager-declared file hash
current hash     manager-declared complete bundle hash
```

Both stores are keyed by URL. Content is not stored by hash. A client commit
must never advance `current hash` without also committing the corresponding
Hash Store mutations. Content needed for the immediate apply verdict is
staged before the commit; lazy content may remain absent from the File Store.

### Canonical URLs and bundle hash

A publication URL is an App-root-relative URL path such as
`routes/home.rip`, never a disk path such as `app/routes/home.rip`. It has no
leading slash, query, fragment, backslash, empty segment, `.` segment, or
`..` segment. The browser requests it by prefixing `/` and URL-encoding its
individual path segments.

Every wire hash is the six-character, Base64URL-folded value produced by `rash`.
It is a Rip synchronization identity and never an HTTP ETag.

The complete list is sorted lexicographically by URL and contains each URL
exactly once. Rip Manager calculates the bundle hash as:

```text
rash(UTF8(JSON.stringify(canonical [[url, fileHash], ...] list)))
```

Optional eager content never participates in either the file hash or bundle
hash. A candidate with an invalid URL, duplicate URL, invalid hash, invalid
UTF-8 eager source, or noncanonical ordering rejects before publication.

### `bundle.json`: complete state

`GET /bundle.json` returns the complete current membership:

```json
{
  "hash": "APP123",
  "list": [
    ["routes/index.rip", "RIP111"],
    ["styles.css", "CSS222"],
    ["template.html", "HTML33"]
  ]
}
```

The rules are:

- `hash` is the resulting complete bundle hash.
- `list` contains every current configured App member.
- Every normal entry is exactly `[url, fileHash]`.
- A complete bundle never contains a deletion or `null` hash.
- Normal production and watch publication do not include file content.
- Manager-owned `bundle.json` and `latest.json` are never members of the
  bundle.

The client validates the document's structure, hash syntax, URL syntax,
ordering, and uniqueness. It does not recalculate any Rip hash.

### `latest.json`: reconnect identity

`GET /latest.json` returns only the current complete bundle hash:

```json
{"hash":"APP123"}
```

Rip Manager writes this file only when the bundle hash changes. It is served
with `Cache-Control: no-store`; clients must not use a cached body to decide
that they are current. `latest.json` is manager-owned, is outside the watched
App root, never appears in a change, and cannot create a watcher feedback
loop.

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
      ["routes/index.rip", "RIP444"],
      ["styles.css", "CSS555"]
    ]
  }
}
```

Its meaning is: "If the client is at `from`, applying this list advances it
to `hash`." The fields are:

- `from`: the complete bundle hash immediately before the watcher batch.
- `hash`: the complete bundle hash after the watcher batch.
- `list`: only URLs created, changed, or deleted by that batch.

The list is sorted by URL and contains each affected URL once. Creation and
replacement use `[url, fileHash]`. Deletion uses `[url, null]`:

```json
{"change":{"from":"APP124","hash":"APP125","list":[["routes/old.rip",null]]}}
```

A rename is one atomic deletion plus creation. The transport does not infer a
rename from watcher event names and does not preserve component identity
across it; any state-preserving rename semantics belong to Rip App.

An ordinary transition has different `from` and `hash` values and a nonempty
list. An unchanged watcher batch emits no message. WSS never carries
`bundle.json` or `latest.json`.

### Manager startup and initial publication

At startup the manager:

1. Resolves the configured App root and membership globs.
2. Reads and hashes every current member once.
3. Builds the canonical complete list and bundle hash.
4. Assembles and validates `bundle.json` in memory.
5. Atomically writes `bundle.json`.
6. Atomically writes `latest.json` with the same hash.
7. Opens the watcher only after the in-memory graph and both files agree.

If an existing valid `bundle.json` and `latest.json` disagree after an
interrupted manager run, startup rewrites `latest.json` from the validated
bundle before enabling the publication feed. `latest.json` must never lead
`bundle.json`: the complete recovery document is made visible first.

### Initial browser load

Initial App boot does not depend on WSS or `latest.json`:

1. The browser requests `/bundle.json`.
2. It validates the envelope and stages the complete Hash Store.
3. It obtains the files required to launch through their ordinary HTTP URLs.
4. Rip App validates or compiles the required source.
5. The browser atomically commits the File Store, Hash Store, and bundle hash.
6. The App renders.

If the Hub is unavailable, initial HTTP boot still succeeds. Watching only
controls whether an already-open App receives live transitions.

### Watch processing and publication

The recursive watcher observes the configured App root. Manager-owned output
lives under `dist/`, outside that root, and is never watched. Ordinary events
for paths outside configured App membership are ignored by the publication
pipeline and remain normal Janus-served static files.

For exact matching file events, the manager collects only the reported URLs
in one debounced dirty set. It reads and hashes only those files. Directory,
pathless, overflow, or otherwise ambiguous events require a complete
membership reconciliation because the watcher did not identify a trustworthy
individual path.

One batch follows this order:

```text
read and hash watcher-identified members
→ stop if membership and hashes are unchanged
→ merge changes into the prior in-memory graph
→ calculate the resulting bundle hash
→ assemble and validate bundle.json
→ atomically write bundle.json
→ atomically write latest.json
→ commit the manager's in-memory graph
→ publish one WSS change
```

Writing `bundle.json` and `latest.json` is manager publication, not an App
file event. Neither write produces another change.

If bundle construction, validation, or either atomic write fails, the manager
does not publish the WSS transition. If WSS publication fails after the HTTP
documents are current, the manager retains and retries the pending transition
until Janus acknowledges it or a newer transition supersedes it. A superseded
transition is never published after its successor; clients that missed it
fail the successor's `from` check and recover from `bundle.json`. An ambiguous
acknowledgement may produce a harmless duplicate. If the manager exits, loss
of its Janus registration closes live sockets, and reconnect recovery through
`latest.json` remains authoritative.

### Live client application

The browser serializes changes in WSS arrival order. For each change:

```text
if current hash == change.hash
  ignore the duplicate

else if current hash != change.from
  stop applying queued changes and recover from bundle.json

else
  stage change.list against the current Hash Store
  obtain content required for immediate apply
  validate or compile affected Rip source
  atomically commit staged stores and change.hash
  emit one Rip App apply batch
```

The browser trusts every declared file hash and the resulting bundle hash. It
does not hash eager server content, server HTTP responses, or the staged
server inventory.

For a non-eager creation or replacement, the browser requests the current
content from the entry's ordinary URL. HTTP delivery is latest-wins: if a
newer edit reaches disk between the change and the fetch, the browser may
receive the newer representation. A later `change` advances the declared
identity; a missed or disconnected transition is healed by `from` mismatch or
reconnect recovery. Request-owner tokens or equivalent cancellation fencing
must prevent an older completed request from overwriting a newer committed
request.

Deletion removes the declared URL from both stores as one staged operation.
A missing HTTP response, rejected compilation, malformed entry, or failed
apply leaves the prior committed state running and triggers complete recovery.

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

After the acknowledgement it requests `/latest.json` with
`cache: "no-store"`:

- If `latest.json.hash` equals the current client hash, no bundle fetch is
  required.
- If the hashes differ, the client fetches and atomically installs
  `/bundle.json`.
- It then replays buffered changes in arrival order using the normal
  `from → hash` rules.
- A buffered change already represented by the installed bundle is a
  duplicate and is ignored.
- Any disconnected transition causes another complete bundle recovery.

This ordering closes every reconnect race:

- A change completed before subscription is visible through `latest.json` and
  `bundle.json`.
- A change completed after subscription is delivered through WSS.
- A change racing the HTTP checks may be represented by both paths, and the
  duplicate rule makes that harmless.

Browser `online`, page restoration, and tab resumption are triggers to attempt
this procedure, not proof that the network or App state is current. A failed
probe leaves the last committed App running and retries with bounded backoff.

### Optional eager development content

The metadata-only change format is the default. An explicitly enabled
development optimization may add a third tuple element containing the exact
UTF-8 text Rip Manager already read for that watcher batch:

```json
{
  "change": {
    "from": "APP123",
    "hash": "APP124",
    "list": [
      ["routes/index.rip", "RIP444", "export Index = component ..."]
    ]
  }
}
```

This optimization obeys all of these rules:

- Its eager-pattern list is empty by default.
- It requires watching and an explicit development configuration.
- Only replacement paths matching `app.changes.eager` are eligible.
- Matched content must be valid UTF-8; deletes and binary files never carry
  content.
- The total eager UTF-8 byte length for one change is capped by
  `app.changes.limit`, which defaults to 32768 bytes.
- If the eligible content exceeds the cap, the entire change is sent without
  eager content and the browser uses HTTP; the manager does not split one
  transition into multiple messages.
- Eager content is never required for correctness or reconnect recovery.
- A client whose current hash does not equal `from` ignores all eager content
  and recovers from `bundle.json`.

The `serve.rip` schema exposes the eligible paths as `app.changes.eager`, an
array of App-relative globs defaulting to `[]`, and the byte cap as
`app.changes.limit`, defaulting to `32768`. A nonempty eager list while
watching is disabled or while `RIP_ENV` is `production` rejects during
configuration validation.

### Watch-off and production behavior

With watching disabled, the manager publishes `bundle.json` and
`latest.json` but sends no App changes and the browser opens no publication
subscription. The same Janus Hub may independently carry application-owned
chat, presence, CRDT, collaboration, or other realtime traffic. Those
messages do not activate file watching and are outside this lifecycle.

All App file bytes remain available through HTTP. Production never includes
App file content in WSS changes, even when the Hub is enabled for unrelated
realtime behavior.

### Implementation sequence

The transport and the application runtime land as two explicit phases. Phase
1 proves Rip Server, Rip Manager, Janus, HTTP, and WSS without importing or
launching Rip App. Phase 2 integrates that proven protocol with browser boot,
the Workspace, compilation, and rendering. No compatibility adapter, dual
wire format, or temporary translation layer belongs between the phases.

#### Phase 1: Server and protocol reference client

Phase 1 implements:

- manager publication of `bundle.json` and `latest.json`;
- watcher batching, exact dirty-path hashing, deletion, rename, and no-op
  suppression;
- `from → hash` WSS changes and bounded optional eager development text;
- Janus file serving and Hub publication using the existing `/hub` endpoint;
- publish ordering, failure retry, manager restart repair, and watch-off
  behavior; and
- a small protocol reference client owned by `packages/server/test`.

The reference client is intentionally not Rip App. It performs only the
operations required to prove the wire contract:

```text
HTTP GET bundle.json / latest.json / authored URLs
WSS join + acknowledgement + ordered frame collection
URL → declared-hash map maintenance
current bundle-hash comparison
from mismatch and duplicate recovery
optional eager-content capture
```

It does not compile Rip, render a component, create a Workspace, implement an
apply verdict, or calculate a Rip hash. Tests obtain expected hashes from the
manager's published documents and messages. The harness must exercise the
real published Janus integration, not a mock that bypasses Hub ordering or
static-file behavior.

Phase 1 may change the server wire format before Rip App understands it. Its
checkpoint gate is the focused `packages/server` suite and the real-Janus
reference-client scenarios below. This is an internal feature-branch
checkpoint, not a completion, commit, or merge boundary: the complete change
still requires Phase 2 and the canonical repository-wide suite. No dual format
is added merely to keep both protocols alive between the two work phases.

#### Phase 2: Rip App and browser integration

Phase 2 begins only after the Phase 1 protocol survives its failure and race
tests. It updates the existing browser seams rather than moving server logic
into Rip App:

- `src/browser-boot.js` consumes the new `bundle.json`, obtains required
  modules through HTTP, and stops validating server declarations by hashing
  their source.
- `packages/app/feed.rip` consumes `change` and owns the acknowledged
  subscribe-before-`latest.json` reconnect flow. It has no separate manifest
  reconciliation or per-file notification format.
- `packages/app/workspace.rip` accepts manager-declared hashes for
  server-owned records. Its local editor/write behavior remains a separate
  concern and does not become server publication authority.
- Rip App keeps ownership of `.rip` update, CSS replacement, HTML reload,
  compilation, last-known-good behavior, and one atomic apply batch.
- Browser delivery keeps request-owner fencing so an older HTTP completion
  cannot overwrite a newer change.

The compiled `@rip-lang/app` core launch embedded in `rip.js` remains
transport-agnostic: it receives prepared
bundle objects and compiled components. HTTP, WSS, `latest.json`, and browser
cache behavior stay in the browser delivery/feed boundary.

### Phase 1 acceptance tests

The Server/Manager phase is incomplete until its reference client establishes
all of the following without Rip App:

1. `/bundle.json` and every required authored HTTP URL load with the Hub
   unavailable.
2. `bundle.json` and `latest.json` contain the same bundle hash.
3. Both manager-owned files are excluded from watcher membership and changes.
4. An exact file event reads and hashes only that file.
5. An idempotent file event rewrites nothing and publishes nothing.
6. One multi-file watcher batch produces one sorted `from → hash` change.
7. Missing change 7 makes change 8 fail its `from` check and fetch the bundle.
8. A duplicate whose `hash` is already current is ignored.
9. Create, replace, delete, and rename transitions produce the expected
   complete URL/hash map.
10. `bundle.json` and `latest.json` are visible before the WSS transition.
11. Startup repairs a valid bundle/latest mismatch before opening the feed.
12. Subscription acknowledgement precedes the `latest.json` reconnect probe.
13. Changes racing the reconnect probe are buffered and reconciled without a
    mixed committed map.
14. A failed or ambiguous Hub publish retries safely; an acknowledged
    duplicate is harmless.
15. Manager or Janus restart makes the client reconnect and recover through
    `latest.json` and `bundle.json`.
16. A nonmatching static-asset event produces no publication work.
17. Normal and production WSS changes contain no file content.
18. Eager development content respects `app.changes.eager` and
    `app.changes.limit`.
19. An oversized eager candidate falls back to one metadata-only change.
20. Watch-off mode publishes no changes while unrelated Hub traffic remains
    available.
21. Neither the reference client nor any production browser-publication code
    calculates a Rip hash for manager-published content.

### Phase 2 acceptance tests

Rip App integration is incomplete until tests establish:

1. Browser boot obtains the complete server publication without a manifest.
2. The browser stores manager-declared file and bundle hashes without
   recalculating them.
3. `.rip`, CSS, HTML, creation, deletion, and rename produce the specified App
   verdicts from one staged change.
4. A failed fetch, compile, or apply leaves the prior App generation running.
5. Two rapid changes cannot let an older request completion overwrite the
   newer committed state.
6. Missing, duplicate, and racing changes converge through the same
   `latest.json` and `bundle.json` recovery proven in Phase 1.
7. Eager and non-eager development changes have identical observable apply
   results.
8. Initial HTTP boot and the last committed App remain usable while the Hub is
   unavailable.
9. Real-browser Chromium, Firefox, and WebKit scenarios exercise initial load,
   live change, disconnect, reconnect, and failed apply.
10. Browser-local editor entries remain isolated from manager-declared server
    state and do not alter the server bundle hash.

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
    changes:
      eager: []
      limit: 32768
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

`app.changes.eager` is an array of App-relative globs and defaults to `[]`.
Matching replacement files may use the eager-text optimization defined in
Detailed Lifecycle. `app.changes.limit` is a positive integer byte limit and
defaults to `32768`. A nonempty eager list rejects when watching is disabled
or `RIP_ENV` is `production`. Unknown keys in `app.changes` reject.

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
full-reload notification, and then clears hold.

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
bun run test:hello-app
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
