# @rip-lang/server

The Rip HTTP server framework, assembled unit by unit. Server-only by
design: this package never declares browser safety and never travels
in an application bundle. The server HTTP router is not the App SPA
router.

## The request matcher

`createMatcher()` is the framework's pure routing core — no sockets,
no I/O; every behavior is a function of the registered routes and the
incoming `(method, pathname)`.

```rip
import { createMatcher } from '@rip-lang/server'

routes = createMatcher()
routes.add 'GET',  '/users/:id',         showUser
routes.add 'GET',  '/orders/:id{\\d+}',  showOrder
routes.add 'GET',  '/files/*path',       sendFile
routes.add 'ALL',  '/health',            health

hit = routes.match 'GET', '/users/42'
# { handler: showUser, params: { id: '42' }, route: {…} }
```

Constraints ride inside string literals, so regex backslashes double:
the pattern `:id{\d+}` is spelled `':id{\\d+}'` in source.

Routes match in registration order and the first match wins — there is
no specificity scoring, so precedence is exactly the order you wrote.
That also means two patterns with the same shape (`/users/:id` after
`/users/:name`) both register and the later one never matches; only an
exact method+pattern duplicate rejects loudly, as does every malformed
pattern (at registration, never at request time).

Pattern grammar, per `/`-separated segment:

| Segment | Meaning |
|---|---|
| `users` | static — compared literally, as written |
| `:id` | param — one segment, percent-decoded |
| `:id{\d+}` | constrained param — the regex judges the decoded segment; capturing groups reject |
| `*rest` / `*` | catch-all — final segment only; captures the remaining segments (at least one), decoded and re-joined |

Methods normalize to uppercase; `ALL` matches every method. Matching
tolerates one trailing slash. An empty path segment never satisfies a
param or a catch-all piece, and a segment that fails to percent-decode
matches nothing — a malformed escape is not routable data.

Decoded captures are data, nothing more: `%2F` decodes to `/` inside
one param and `%2e%2e` to `..` inside a catch-all. A handler building
file paths from params owns its own containment — the serving units
do exactly that.

`parseQuery(search)` is the query representation for `location.search`
/ `url.search` input (fragments are not stripped): WHATWG decoding,
duplicate keys keep the last value, `+` decodes to a space, and a
`__proto__` key lands as inert own data.

`routes()` returns an ordered snapshot of `{ method, pattern, handler }`
— the seam later units (OpenAPI generation, the app-serving preset)
read instead of reaching into the table.

## The request context

`createContext(request, { params, files })` wraps one web-standard
`Request` into the surface a handler works with — reading never
touches a socket, and every helper returns a web-standard `Response`:

```rip
show = (c) ->
  id   = c.req.param 'id'         # one param, or param() for all
  sort = c.req.query 'sort'       # last value wins, like parseQuery
  body = await c.req.parseBody()  # dispatches on content type
  c.json { id, sort, body }       # or text/html/body/redirect/send
```

Response headers stage on the context: `c.header 'Vary', 'Accept'`
lands on every later response (`append: true` to accumulate), per-call
headers override staged ones, and one response's per-call headers
never leak into the next. `c.cache 60` (or `'2 hours'`) stages
`Cache-Control`; an unparseable duration rejects loudly.

`send(path)` serves through the injected `files` host with weak-ETag
revalidation (304 on `If-None-Match`); there is no default host —
this package never touches a filesystem, and the serving units own
the real host alongside its containment policy.

## The pipeline

`compose({ use, before, after, handler })` builds the middleware
pipeline as an onion — every stage a pure function of the context:

```rip
run = compose
  use:     [logger(), cors(origin: 'https://app.example')]
  before:  [requireUser]           # a returned Response short-circuits
  after:   [stampVersion]          # observes (and may replace) every response
  handler: show

response = await run createContext(request, params: hit.params)
```

Middleware receives `(c, next)`; `next()` returns the downstream
`Response` for inspection or replacement. Returning a `Response`
short-circuits; returning nothing *without* calling `next` is a loud
mistake, never a silent hang; calling `next` twice rejects. Before
filters guard the handler; after filters run at the center of the
onion — on guard responses and handler envelopes alike — so a
wrapping logger sees the final truth. A throw in any stage translates
through the error envelope. An aborted request stops the pipeline
with 499 and skips everything downstream. `c.locals` is the
request-local bag, owned by one request across all stages.

`cors()` reflects any origin as `*` by default and scopes by string,
list, or predicate — a scoped policy always emits `Vary: Origin`, on
allow and deny alike. A true preflight (`OPTIONS` carrying
`Access-Control-Request-Method`) answers 204 before the handler; any
other `OPTIONS` is an ordinary request. Credentials never ride a
wildcard or the literal `null` origin. `logger()` writes one line per
request to an injected stream — the status logged is the status sent,
envelopes included, and a broken sink loses a log line, never the
response. Security middleware (sessions, CSRF, secure headers)
arrives with its own dedicated unit and review.

## Input validation and OpenAPI

`reading()` parses the body once and installs `c.read` — the
zero-ceremony reader over body ∪ query ∪ params (params win), speaking
the `@rip-lang/validate` vocabulary:

```rip
create = (c) ->
  email = @read 'email', 'email!'          # required — missing is a 400
  phone = @read 'phone', 'phone'           # optional — miss answers null
  role  = @read 'role', ['admin', 'user'], 'user'
  age   = @read 'age', [18, 120]
  first = @read 'patient.name.first'       # dotted paths walk the body
  @json { email, phone, role, age, first }
```

An unknown validator name rejects loudly — a vocabulary typo is a
configuration mistake, not an empty read.

`withInput(schema, handler)` validates the JSON body through a schema
before the handler runs: the parsed, defaulted, coerced value is
`c.input`, and a failing body — invalid JSON included — is a
structured 400 carrying `{field, error, message}` issues. The wrapped
handler carries its schema, which is how the OpenAPI document knows
the route table:

```rip
routes.add 'POST', '/orders', withInput(CreateOrder, create)
doc = openapi routes.routes(), title: 'Orders API', version: '1.0.0'
```

`openapi(routes, info)` is derived, never registered, and
deterministic: paths and methods sort, identical schemas deduplicate
into `components/schemas` under their own names, and the same route
table is the same bytes whatever order registration ran in.

## Security

`sessions({ secret })` decodes `c.session` before the handler and
writes it back as one cookie afterward, only when it changed — an
emptied session expires its cookie, and a 5xx response commits no
change (a half-applied mutation from a failed handler never reaches
the client). Signed (HMAC-SHA256) by default: tamper-proof, but the
payload is client-readable, so never store secrets in a signed
session. `encrypt: true` seals it with AES-256-GCM (key derived from
the secret). A missing, blank, or too-short secret is a startup
failure — no environment sniffing; a deployment that truly wants
unsigned dev sessions writes `insecure: true` in its own words. Cookie
defaults are `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` (`Secure`
is opt-out for plaintext dev; `SameSite=None` requires it). A tampered
or foreign cookie is a fresh empty session, never a throw.

`csrf({ secret })` is header-only double-submit: safe requests mint a
readable `csrf_token` cookie; every unsafe request must echo it in
`X-CSRF-Token`, compared in constant time. There is no form-field
fallback. The cookie carries an HMAC binding, so a planted cookie
fails without the server key — a secretless double-submit is forgeable
and so, like sessions, needs an explicit `insecure: true`.

`secureHeaders()` sets the modern set — `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, and `X-XSS-Protection: 0` (the
legacy filter it once enabled caused more injection than it stopped).
CSP and HSTS are explicit opt-ins. `trustProxy()` reads `X-Forwarded-*`
only when you opt in — `trust: true` or a `hops` count — because
trusting those headers in front of a directly-exposed app hands the
client control of its own attested `ip`/`proto`/`host`; a forwarded
host is accepted only in bare `hostname[:port]` shape. It resolves
`c.locals.client` from the trusted hop. `harden()` is the cheap
pre-handler gate on already-parsed values: 414 over-long URLs, 405
unknown methods. Real body-size limits read the stream at the socket
layer, not a client-declared `Content-Length`.

## Static and application serving

`serveStatic({ root, host })` serves files under `root` and falls
through to the next handler on a miss (`spa: true` instead serves the
root `index.html` for HTML navigations). Containment is the whole
game: a request path is decoded, every `..` resolved, and any climb
above the root refused (`403`) — then the resolved path's realpath is
re-checked against the root's realpath, so a symlink pointing outside
is refused too. Files carry their content type and a weak ETag with
`304` revalidation; `maxAge`/`immutable` set `Cache-Control`. The
filesystem arrives through an injected `host` — `diskHost()` is the
Bun-backed default; a test passes an in-memory host of the same shape,
so the containment policy is exercised without a disk. Content types
follow the file extension, so a static root must never point at a
user-upload directory — an uploaded `x.html` would serve as
`text/html` in your origin. Serve untrusted uploads from a separate
origin.

`appServer({ root, host, bundle })` is the app-serving preset:
`secureHeaders` ride every response (opt out with `secure: false`),
the bundle serves at `/bundle.json` with ETag revalidation, static
assets serve from `root`, and an HTML navigation that matched no asset
gets the shell — `appShell({ title, state })` — with the bundle's
`data` injected as boot state. `appShell` escapes a hostile title into
text and neutralizes a state payload that tries to close its `<script>`
block, so neither can break out into markup.

## Development watch

`createWatch()` is the SSE development transport — one client
implementation, web-standard streams, no socket of its own. Its
`handler` opens a `text/event-stream` that fans one event to every
open connection, each tagged with a monotonic revision as its SSE id;
`reload()`, `css(hrefs)`, and `error(payload)` push to whoever is
connected. A client that reconnects with a stale `Last-Event-ID` is
reloaded at once (last-known-good), a compile `error` is sticky so a
client entering a broken build still sees it (and the next `reload`
clears it), and `css()` is the fast path — the client swaps only the
named stylesheets, no reload, no lost application state.

```rip
watch = createWatch()
# the file watcher (with the CLI) calls these:
watch.css ['/style.css']          # a stylesheet changed
watch.reload()                    # a source module changed
watch.error { file, line, message }  # a build broke
```

`watchClient({ path })` is that one client, emitted as a string to
inline under watch: it connects, reloads, swaps stylesheets, and shows
a compile-error overlay that clears on the next good build.

## The worker pool

`createPool({ spawn })` schedules jobs across a fixed set of workers
with bounded concurrency, a bounded queue, a recycle policy, and
graceful shutdown — all deterministic, because the worker body and
the clock are injected. `spawn()` builds a worker exposing
`handle(job) → Promise` (and an optional `close()` the pool calls when
it disposes the worker); `submit(job)` dispatches to a free worker or
queues, rejecting loudly once the queue is at capacity and rejecting a
job that waits past the timeout. A synchronous throw from `handle` is
caught and becomes a normal rejection — a misbehaving worker never
wedges the pool. A worker retires when its request budget or age is
spent; its replacement spawns at once (the pool keeps `size`
non-retiring workers, so there is no capacity gap) and the retiring
worker leaves only after its in-flight jobs drain, so a recycle never
drops a request. `shutdown()` stops intake,
cancels the queue, and resolves once every worker is idle. `stats()`
reports `size`/`inflight`/`queued`/`recycled`.

Defaults follow the product's operational profile: concurrency 1, a
queue of 512 with a 30 s wait timeout, and recycle after 10000
requests or 3600 s (the real deployment sizes the pool at `cores/2`
and passes process-backed workers and wall-clock timers).

## TLS

No certificate or private key is committed to this repository, so
`resolveTls(opts, adapters)` is pure over injected host adapters —
`load(path)` reads a PEM pair, `acme(domain)` fetches an ACME-managed
pair, `devCert(host)` mints a local development certificate. The
policy is the surface it enforces: material resolves by precedence
(an explicit cert/key, inline or by path, then ACME, then the dev CA),
**production requires real material** — a missing certificate is a
startup failure, never a silent plaintext fallback and never a
development cert — and a per-host cert map resolves most-specific
first. `certSpecificity`, `orderCerts`, and `matchCert` are the SNI
primitives: a wildcard `*.example.com` covers exactly one deeper label,
never the apex or a two-level subdomain, and matching is
case-insensitive with the port and trailing dot normalized away. The
result — `{ mode, material, sni, serverNames }` — is what the serving
layer hands the socket; key material is never logged.

`errorEnvelope(err)` is the one deterministic error translation:
`notice` and `issues` are explicitly user-facing and always shown, a
plain message shows only for 4xx, and 5xx or raw throws mask to the
generic status text so internals never leak. `respond(handler, ctx)`
drives a handler to a `Response` — a `Response` passes through, an
object becomes JSON, a string becomes text or HTML by its shape,
`null`/`undefined` become 204, and a throw becomes its envelope.
