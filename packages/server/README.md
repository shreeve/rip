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

`errorEnvelope(err)` is the one deterministic error translation:
`notice` and `issues` are explicitly user-facing and always shown, a
plain message shows only for 4xx, and 5xx or raw throws mask to the
generic status text so internals never leak. `respond(handler, ctx)`
drives a handler to a `Response` — a `Response` passes through, an
object becomes JSON, a string becomes text or HTML by its shape,
`null`/`undefined` become 204, and a throw becomes its envelope.
