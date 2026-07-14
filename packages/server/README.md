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
