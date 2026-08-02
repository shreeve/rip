<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Server - @rip-lang/server

> **Small API framework and managed runtime — exact routes, Web-standard middleware, safe reloads, and disposable workers behind Caddy and Janus.**

Rip Server is a small API framework and project manager for applications served
through Caddy and [Janus](https://github.com/shreeve/janus).

- Caddy and Janus own public HTTP, TLS, host admission, static files, SPA
  fallback, ranges, validators, Hub WebSockets, and routing.
- The manager owns project discovery, generation, App publication, Janus
  registration, heartbeats, reload coordination, operations, and worker pools.
- Disposable workers import one generated JavaScript artifact and execute API
  handlers on private Unix sockets.

The manager is a control-plane process. It never serves an ordinary public
request.

## Current application API

`@rip-lang/server` exports:

```coffee
import { get, post, use, session, fetch, start } from '@rip-lang/server'
```

The route surface is deliberately exact:

```coffee
import { get, post, start } from '@rip-lang/server'

get '/api/hello' -> { message: 'Hello!' }

post '/api/echo', (request) ->
  request.json()

start!
```

`get` and `post` require absolute, exact paths. Duplicate method/path
registrations reject. There are no parameter, wildcard, prefix, schema, or
OpenAPI route forms in the current surface.

Handlers receive the Web-standard `Request`. Their result becomes:

- `Response` → unchanged;
- `null` or `undefined` → `204 No Content`;
- object → `Response.json(value)`;
- any other value → UTF-8 plain text.

An unmatched route returns `404`. An uncaught handler or middleware failure is
logged by the worker and returns a masked JSON `500`.

`start!` only hands the composed fetch handler to the managed worker runtime.
It does not open a public listener. Calling it outside a generated worker
rejects.

## Middleware

Middleware is a Web-standard `(request, next) -> Response` function:

```coffee
import { get, session, start, use } from '@rip-lang/server'
import {
  cors, csrf, htmlJson, secureHeaders, sessions, timeout
} from '@rip-lang/server/middleware'

use secureHeaders!
use cors origin: 'https://app.example.com', credentials: true
use sessions secret: process.env.SESSION_SECRET, encrypt: true, secure: true
use csrf secret: process.env.SESSION_SECRET, secure: true
use '/api/reports', timeout 120, grace: 2
use htmlJson

get '/api/session' -> { user: session.user ?? null }
start!
```

Global and path-scoped middleware share registration order. A scoped path
matches itself and descendants on a segment boundary. `next!()` may be called
once and may receive a replacement `Request`; request-local session state
follows that replacement.

### `cors`

`cors` accepts one origin, `*`, an exact-origin array, or an async predicate.
Wildcard credentials reject. It handles every `OPTIONS` request with `204` and
sets CORS headers only for an allowed origin. Actual responses carry
cache-correct `Vary: Origin` where required.

Options are `origin`, `credentials`, `methods`, `headers`, `exposeHeaders`, and
`maxAge`.

### `sessions`

`sessions` requires a secret. Cookies are HMAC-SHA256 authenticated by default
or AES-256-GCM authenticated and encrypted with `encrypt: true`. Session data
is isolated per request through `AsyncLocalStorage` and exposed through the
`session` proxy.

Options are `secret`, `encrypt`, `name`, `maxAge`, `secure`, `httpOnly`, and
`sameSite`. Invalid cookie policy rejects during registration. Encoded sessions
must remain within the cookie size bound.

### `csrf`

`csrf` requires a secret and uses a signed double-submit cookie with
constant-time token comparison. Safe requests receive a token at
`request.csrfToken`; unsafe requests must return it in the configured header.

Options are `secret`, `cookieName`, `headerName`, `exempt`, `secure`, and
`sameSite`.

### `timeout`

```coffee
use timeout 30, grace: 1
use '/api/reports', timeout 120, grace: 2
```

Both durations are integer seconds. At `timeout`, downstream work receives an
aborted `request.signal` and the client receives the configured failure,
`504 Gateway Timeout` by default. If the handler does not settle during
`grace`, the worker recycles. Returning a streaming `Response` ends handler
timing; subsequent body delivery is transport work.

Options are `grace`, `status`, `message`, and async `exempt`.

### `secureHeaders`

`secureHeaders` fills only headers absent from the application response:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'
X-Frame-Options: SAMEORIGIN
```

Options are `contentTypeOptions`, `referrerPolicy`,
`contentSecurityPolicy`, `frameOptions`, and opt-in `permissionsPolicy`.
Each accepts a nonempty header value or `false` to disable it. Explicit
response headers win.

The middleware does not emit obsolete `X-XSS-Protection`. HSTS remains an edge
policy so static files, redirects, unavailable workers, and Janus-generated
responses receive the same protection.

### `htmlJson`

`htmlJson` renders a bounded JSON response as escaped, highlighted HTML when an
iPhone, iPad, or iPod directly navigates to it. API requests retain JSON.
Compressed bodies and responses larger than 1 MB pass through unchanged.
Representation inputs are recorded in `Vary`.

### Compression

Rip has no compression middleware. Caddy's streaming `encode` handler can
cover static, generated, `X-Sendfile`, and proxied API responses without
buffering bodies in workers. Applications use standard response controls:
`Cache-Control: no-transform` forbids transformation, and an existing
`Content-Encoding` remains authoritative.

## Project shapes

The manager accepts:

- an API entry file;
- a directory containing `app.rip` or `index.rip`;
- an App-only directory containing `app/`;
- a full project containing both an API entry and `app/`.

Public traffic always enters Caddy and Janus. API source never mounts browser
routes.

Start a manager:

```bash
rip server . --control /run/janus/control.sock --host app.example.com
```

`JANUS_CONTROL` may supply the control endpoint. Current start options are:

```text
--name <name>            Janus registration name
--host <host>            exact public host
--control <target>       Janus Unix socket or HTTP(S) control endpoint
-w, --workers <n>        worker count; default 1
-c, --concurrency <n>    admitted requests per worker; default 1
--watch                  enable App and API watching
--no-watch               disable watching; currently the default
```

One canonical manager owns a project. A concurrent manager for the same
canonical root rejects without disturbing the owner.

## API generation and workers

Generation runs in a short-lived child with the Rip loader:

1. Bun builds one loader-free ESM artifact.
2. The generator records every consumed Rip and JavaScript input.
3. It rereads and hashes those inputs before reporting success.
4. Every worker imports that same artifact through `APP_ARTIFACT`.

The manager never imports application code. Workers expose readiness, reject
excess capacity with marked `503` responses, drain admitted work on shutdown,
report boot failure, replace crashes, recycle hung work, and exit when their
manager disappears.

The optional `RIP_HANDLER_DEADLINE_MS` watchdog defaults to `0`. Application
timeouts normally belong in `timeout`; the worker watchdog remains an explicit
last-resort bound.

## Browser App publication

The App bag is `app/**/*.{rip,css,html}`. One publication reads each file once
into an ephemeral snapshot and computes:

- one six-character content `hash` per file;
- one shared bag `rash` from the ordered `[id, hash]` inventory.

`static/generated/bundle.json` and watch-only `manifest.json` describe the same
inventory and carry the same `rash`. The bundle includes selected source
content, initially every `.rip` module; the manifest carries no source
content. Unchanged documents are not rewritten.

The manager registers two finite roots when an App exists:

- `static/generated` with `revalidate`;
- `app` with `never`.

It uses authored `app/index.html` when present or writes a generated shell.
Janus serves every public byte and supplies weak mtime/size ETags.

With `--watch`, changed entries publish content-free `{id, hash}` dings through
the Hub. Deletions add `kind: 'delete'`. Empty batches are not published.

## API reload

An API edit builds and verifies a complete candidate before admission changes.
A failed candidate leaves current workers active. A successful candidate
publishes a doorbell and drains the old pool; the next held request rings one
bounded boot, and only ready sockets replace the doorbell.

App-only edits do not replace API workers. API-only edits do not rewrite App
documents.

## Operations

The manager exposes local project-scoped control commands:

```bash
rip server status [project]
rip server hold [project]
rip server release [project]
rip server migrate [migration-entry] --dir migrations [--id 32hex]
rip server recover <operation-id>
```

Operational states are:

- `Active` — ordinary activation and publication;
- `Held` — current API and App remain active while changes are fenced;
- `Maintenance` — registration and heartbeats remain alive with no API
  upstreams.

Release, migration, activation, and restoration use the transient states
`Releasing`, `Migrating`, `Activating`, and `Restoring`. They are reported by
`status` while the corresponding operation is in flight and are not
independently selectable modes.

`release` prepares one coherent API/App snapshot before activation and emits
one epoch ding. Coordinated migration cuts admission, drains workers, runs
`rip schema migrate` in a child, and records
`.rip/server-operation.json`. Failure after the database may have changed
stays in Maintenance for explicit fix-forward `recover`.

## Janus file offload

Ordinary public files belong in registered Janus roots. An API that authorizes
a private file may return an empty response with `X-Sendfile`:

```coffee
get '/api/report' ->
  authorizeRequest!()
  new Response null, headers: { 'X-Sendfile': absolutePath }
```

Released Janus consumes the private header and owns file opening, type
detection, validators, ranges, framing, and streaming. The header never reaches
the client.

## Verification

The clean-room fixtures earn one capability at a time:

```bash
bun run verify:hello-api
bun run verify:workers
bun run verify:hello-app
bun run verify:reloads
bun run verify:operations
bun run verify:middleware
JANUS_CADDY=/path/to/released/caddy bun run verify:janus
```

`verify:janus` requires a Caddy binary built from released Janus `v1.5.0`; it
rejects a local module replacement.

The package's broad `bun run test` still points at the burn-down suite and is
not the completion gate for the reconstruction. Final certification requires
reviewing that remainder, running every retained package verification, the
root `bun run test:all`, browser Playwright, and the Janus test layers.
