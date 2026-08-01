# Rip Server Architecture Objective

This document defines the target Rip Server architecture and its ownership
contract. The objective is one independently managed server per invocation,
with many Rip servers able to run behind one shared Caddy process and its
Janus module.

```text
Caddy process
└── Janus
    ├── reads files from ────► medlabs static files and app
    └── proxies requests to ─► medlabs API worker(s)

medlabs server
├── manager
│   └── registration/upstreams/heartbeats/dings ─► Janus control plane
├── api
│   ├── source
│   └── worker(s) ◄─ manager supervises and hot reloads
├── static
│   ├── site-specific
│   ├── common
│   └── generated
│       ├── bundle.json
│       └── manifest.json
└── app
    └── source and assets ◄── manager watches and dings on changes
```

The manager controls the Medlabs server. Caddy and Janus form the shared edge
that serves its static files and routes its API requests.

## Vocabulary

- **Rip Server** is the package and the `rip server` command.
- A **Rip server** is one running project, such as Medlabs.
- The **manager** is the one long-running control process for that server.
- The **API** is dynamic server-side source executed by workers.
- A **worker** is a disposable process that executes API request handlers.
- A **generation process** is a short-lived child that builds and validates one
  candidate API artifact, then exits.
- The **App** is the client application source and assets under `app/`, served
  directly by Caddy and Janus. While watching is enabled, the manager watches
  this tree and dings changed files.
- **Static** contains site-specific files, common files, and manager-generated
  coordination files such as `bundle.json` and `manifest.json`.
- **Caddy + Janus** is the shared edge for zero or more Rip servers.

One `rip server` invocation launches one manager. That manager may supervise
zero, one, or many workers for its API. It does not manage another Rip server.

## Shared Edge

### Caddy

One Caddy process is the machine's public HTTP server. It owns:

- Network listeners and HTTP/1–3.
- TLS termination and ACME certificates.
- SNI and the HTTP handler pipeline.
- Public connection parsing, transport timeouts, slow-client defense, and
  other hostile-Internet concerns.
- The Janus module running inside the same process.

Caddy does not launch Rip managers or workers. API workers listen on private
Unix sockets and retain application-level protections, but they do not
duplicate Caddy's public-server machinery.

### Janus

Janus is active runtime code inside Caddy, not a configuration generator or a
separate process. It has two planes.

The **control plane** lets managers register servers, publish worker sockets,
send heartbeats, and use capabilities such as Hub publication.

The **data plane** handles admitted requests. It:

- Resolves the hostname and tenant.
- Enforces edge policies.
- Routes configured API prefixes to workers.
- Serves registered static files and the SPA shell.
- Runs cache and Hub behavior.
- Rings a manager's doorbell when its API needs a fresh worker generation.

Hot control-plane updates change Janus's in-memory registry. They do not
rewrite Caddy's configuration for each request or worker change.

## The Manager

The manager is the long-running control process for one Rip server. It
registers, watches, generates coordination files, sends dings, and
supervises, but it never handles an ordinary client request or serves a file.

### 1. Registration and heartbeats

At startup, the manager:

1. Loads and validates the server declaration.
2. Resolves its host, tenant, API-prefix, static-root, SPA-shell, and Hub
   policy.
3. Creates its private doorbell socket.
4. Registers the server with Janus.
5. Starts heartbeats.

The declaration is stable for the manager's lifetime. Live state remains
separate: its Janus app id, heartbeat clock, doorbell state, worker sockets,
worker health, cache state, and Hub state.

A heartbeat proves that the manager still owns and supervises the server. It
does not claim that workers are ready. Worker readiness is represented by
the upstream socket list.

If Caddy and Janus restart, Janus loses its memory-resident registrations.
The manager observes a heartbeat `404`, registers the same declaration
again, and republishes its current upstreams.

During shutdown, the manager cuts worker admission, drains its workers, and
deregisters from Janus.

### 2. API workers and server hot reload

The manager owns the API lifecycle:

- Watches API and other server-side source.
- Spawns a short-lived generation process to build and validate each candidate
  server artifact without importing it into the manager.
- Starts workers on unique Unix sockets.
- Waits for workers to report readiness.
- Atomically publishes ready sockets to Janus.
- Replaces crashed workers.
- Drains and retires superseded workers.

An API-source change first prepares a candidate while the active workers keep
accepting requests. A failed build or validation reports the error and leaves
the active generation untouched. Only a valid candidate may cut admission:

```text
API source changes
        │
        ▼
short-lived generation process builds and validates a candidate artifact
        │
        ├── failure ───────────────► report; active workers stay admitted
        │
        ▼ success
manager publishes its doorbell as the only upstream
        │
        ▼
Janus sends no new requests to the old workers
        │
        ▼
old workers finish in-flight requests and retire
        │
        ▼
the next API request causes Janus to ring the doorbell
        │
        ▼
manager starts fresh workers from the prepared artifact
        │
        ▼
manager awaits readiness and publishes the fresh sockets
        │
        ▼
manager answers the ring; Janus sends the held request to a fresh worker
```

The client request never enters the manager. Janus holds it untouched and
sends a separate bodyless `GET /ring` over the doorbell's Unix socket. The
manager awaits Janus's acknowledgement of the new socket list before
answering the ring.

Concurrent requests join one bounded boot. A candidate compilation failure
occurs before admission changes and therefore leaves requests on the active
workers. After admission is cut, worker boot failure, timeout, or waiter
overflow produces an explicit `503`; a request is delivered once to a fresh
worker or not delivered at all.

Building a generation never runs database migrations. Migrations are explicit
operations coordinated separately from ordinary file watching.

Caddy and Janus continue running throughout the replacement.

### 3. App, generated files, and client hot dings

The App remains in its authored tree. Janus serves eligible App source
and assets directly; the manager does not copy every App file into a second
publication tree.

```text
App ────────────────────────────────────► served source and assets
    │
    └── manager snapshots the graph ───► static/generated
                                           ├── bundle.json
                                           └── manifest.json
```

`bundle.json` is the first-paint transfer. It carries the App's Rip source
graph, browser-safe package sources, package-resolution metadata, and any
synthetic client projections needed from API schemas. It avoids one initial
request per Rip module.

`manifest.json` is the lightweight inventory of current `{ id, hash }`
representations used to populate and resynchronize the development Workspace.
After first paint, a ding causes the browser to request only the changed live
App file.

The manager writes generated files atomically. A bundle lands before a
manifest or notification names the representations it carries. Rip hashes
remain manager-owned App content identities; Janus-owned HTTP ETags are
separate transport validators.

While watching is enabled, an App-source change:

1. Re-snapshots the affected App files.
2. Assigns their new Rip hashes.
3. Regenerates `bundle.json` and `manifest.json` coherently.
4. Sends tiny `{ id, hash }` dings through Janus Hub.
5. Lets the browser choose `reload`, `css`, `update`, or `ignore`.

An App-only change does not replace API workers. An API-source change replaces
the API workers without reloading the client app.

With watching disabled, the generated files are sealed and no development feed
is exposed.

### 4. Static-file policy

The manager gives Janus an ordered list of places to check. Each place is a
root template; Janus appends the request URI and serves the first regular-file
match. A root may contain the trusted `${site}` selected from the hostname:

```text
public/${uri}
generated/${uri}
sites/${site}/public/${uri}
sites/common/public/${uri}
app/${uri}
```

The order is policy. In this example, a tenant file overrides the common file,
while `public` and `generated` take priority over both. Another server may
choose a different order.

The SPA shell is a separate HTML-only fallback, commonly `app/index.html`. It
is not an unconditional final file candidate: a missing script, stylesheet,
image, or Rip module must never receive HTML.

Janus and Caddy perform path-confined lookup, conditional HTTP behavior, range
handling, and response delivery. The manager neither handles the request nor
serves the bytes.

### 5. Hold, maintenance, and migrations

The manager has three operational states:

- **Active** observes and activates API and App changes.
- **Held** continues serving the last activated API, bundle, and manifest while
  declining to activate filesystem events. It sends no dings, exposes no new
  generated state, and performs no worker replacement. Release rebuilds from
  the current disk state whether or not individual events were retained.
- **Maintenance** keeps the registration and heartbeats alive but publishes an
  empty upstream list. Static and App requests continue; API requests receive
  `503`. Maintenance never publishes the doorbell.

Releasing a normal hold prepares one coherent API/App generation, exposes it,
sends one full-reload ding, and only then clears hold.

Hold is a coordination barrier, not a filesystem snapshot. Janus still reads
the authored App tree directly, so an unsolicited request for one of those
paths can observe bytes changed during hold. Normal clients receive no reason
to make such a request because the manager sends no dings, and first paint
continues to use the last generated bundle. This pragmatic exception avoids
copying the App into a second publication tree.

Database migration is explicit; it never runs because the server started, a
file changed, or a worker booted. A server-coordinated migration follows this
sequence:

1. Enter hold and prepare the candidate API/App generation.
2. Enter maintenance, stop API admission, and drain all workers.
3. Run the database-only migration command in a short-lived process.
4. If migration fails with no durable database change, restore the prior API
   generation and return to held state.
5. If migration commits, activate the candidate, send the full-reload ding,
   and clear hold.

Any durable database change crosses the rollback boundary. That includes a
successful migration followed by candidate activation failure, and a
multi-file migration run in which earlier files committed before a later file
failed. The old API is no longer assumed compatible with the database; the
server stays in maintenance and is fixed forward.

## Request Flow

Every public request enters the shared edge:

```text
HTTP request
    │
    ▼
Caddy: HTTP and TLS
    │
    ▼
Janus: host and tenant admission
    │
    ├── configured API prefix ───────────────► API worker
    │
    ├── first configured root hit ───────────► file
    │
    ├── next configured root hit ────────────► file
    │
    ├── … ───────────────────────────────────► file
    │
    ├── HTML navigation miss ────────────────► SPA shell
    │
    └── other miss ──────────────────────────► 404
```

### API requests

Configured API prefixes such as `/api` are worker-first. They:

- Never resolve as static assets.
- Never receive the SPA shell.
- Route to a ready worker, ring the manager's doorbell, or return `503` while
  the server is in maintenance.

### Static requests

Janus searches the registered roots in order and serves the first regular-file
match. Static delivery supports `GET` and `HEAD`, validators, ranges, and no
directory listing.

Ordinary HTTP validators describe transport bytes. Live App source uses a
latest-wins protocol instead of historical-version retrieval. A ding's Rip hash
is a change and deduplication hint: when the browser does not already hold that
hash, it fetches the current file without using an HTTP-cached response,
computes the Rip hash of the bytes actually received, and applies that
representation. If the file advanced again before the fetch, receiving the
newer bytes is correct; a later matching ding is ignored. Janus serves the
latest file normally and does not compute or compare Rip hashes.

### App navigation

An HTML navigation request that misses every file root receives the live
App's shell. The client router then resolves the route.

### Not found

A non-HTML static miss returns `404`. An unknown hostname or tenant also
returns `404`. API unavailability is different: it returns `503` because the
server is known but currently cannot execute the request.

## Server Shapes

The same model permits three useful shapes.

### Full server

```text
manager + API workers + App + static/generated files
```

### API-only server

```text
manager + API workers
```

There is no App or generated App state. Janus routes the configured API
surface to workers.

### App-only server

```text
manager + App + static/generated files
```

There are no API workers. The manager maintains registration, generated
files, watch dings when enabled, and heartbeats; Caddy and Janus serve
every public request.

## Ownership Rule

The complete architecture reduces to four owners:

- **The manager registers, watches, generates, dings, and supervises.**
- **Workers execute dynamic API code.**
- **Janus admits, routes, coordinates, and serves registered files.**
- **Caddy owns the network, HTTP, and TLS.**

## URL-Addressable Resources and Cache Policy

Cache policy follows a resource's semantics, not whether watching is enabled.
Watching controls observation, generation, and dings. It does not redefine the
meaning of a URL.

Three mechanisms have separate jobs:

- A **changed URL** makes the browser address a different cache entry and is
  the reliable way to trigger browser-owned resources such as stylesheets and
  images.
- `Cache-Control: no-cache` permits storage but requires validation with the
  server before a stored response may be reused. A matching Janus ETag allows
  an efficient `304 Not Modified`.
- `Cache-Control: no-store` forbids storage. A programmatic
  `fetch(url, { cache: "no-store" })` also bypasses the browser's existing HTTP
  cache for that request.

The directive's side matters:

- On a **request**, `no-cache` asks every cache to validate before answering.
  Fetch's `cache: "no-store"` mode bypasses existing cache entries and does not
  store the new response.
- On a **response**, `no-cache` allows caches to retain the response but
  requires validation before reuse; `no-store` tells them not to retain it.
- A response directive cannot cause an idle page to make a request. Dings,
  application state, navigation, or a changed resource URL do that.

### 1. Immutable versioned assets

Examples are `/company-logo-a83f92.svg`, `/rip-4.2.0.min.js`, and a font whose
filename contains its content identity. The URL's bytes never change:

```text
Cache-Control: public, max-age=31536000, immutable
```

Janus serves the file directly. A changed asset receives a new URL.

### 2. Mutable ordinary static files

Examples are `/company-logo.svg`, `/build-state.svg`, and
`/download/current.pdf`. Their bytes may change at a stable URL, but no live
App protocol owns them:

```text
Cache-Control: no-cache
ETag: W/"mtime-size"
```

Janus revalidates them when requested. An already-open page is not notified.
If a build-state image must change immediately, application code must change
its URL or trigger a reload.

### 3. Generated coordination files

`/bundle.json` and `/manifest.json` have stable URLs and manager-controlled
contents:

```text
Cache-Control: no-cache
ETag: W/"mtime-size"
```

The manager serializes deterministically, does not rewrite identical bytes,
atomically replaces changed files, lands the bundle before the manifest, and
dings only after publication. Janus's ETag then makes unchanged revalidation
cheap. This policy remains the same when watching is disabled.

### 4. Live Rip source

Files such as `/app/routes/home.rip` are latest-wins App bag members. A browser
whose current hash differs from a ding fetches the file with
`cache: "no-store"`, computes `rash` from the bytes actually received, and
applies that hash and source. The Workspace is already the useful source cache,
so a second HTTP cache adds no value.

`rash(bytes)` is the Rip hash: SHA-256 over the exact content, encoded as the
first six unpadded Base64URL characters with `-` folded into `_`. The public
manifest and ding field is `hash`; `rash` is the internal helper name.

### 5. Live CSS

The feed fetches the latest CSS source, computes its actual Rip hash, and
changes the page's existing stylesheet link:

```text
/styles.css?hash=ABC123
```

The changed URL forces a stylesheet request. The stylesheet may use:

```text
Cache-Control: no-cache
ETag: W/"mtime-size"
```

This retains useful cached CSS while requiring revalidation before reuse. The
query hash is a reload trigger, not a promise that Janus retains historical
bytes. If a request triggered by one ding receives a newer stylesheet, that is
the desired latest-wins result.

### 6. HTML shell and HTML bag files

The top-level shell uses `Cache-Control: no-cache`, so every navigation
validates it. An HTML bag ding currently produces the `reload` verdict because
a changed file path and hash do not identify a DOM owner, target, or swap
operation. HTMX can replace a fragment because the initiating request carries
that context; a filesystem ding does not. A future fragment registration
contract may add targeted HTML absorption without changing this safe default.

### 7. Images, fonts, video, and other referenced assets

These files are outside the default `app/**/*.{rip,css,html}` bag and therefore
receive no ding. Choose one policy:

- Content-versioned URL and `immutable` for bytes that never change at that
  URL.
- Stable URL with `no-cache` and Janus ETag for ordinary mutable files.
- Changed URL such as `/badge.svg?hash=ABC123` when an open App must fetch a
  new representation.
- A full reload when the application cannot target the affected reference.

A stylesheet's query string does not propagate into `url(...)` references.
Changing `/styles.css?hash=ABC123` does not change
`url("/images/background.png")`. A mutable embedded asset therefore needs its
own changed URL, must revalidate at a stable URL, or must be covered by a
reload.

Query and pathname versions are different URLs, not aliases in HTTP caches:

```text
/app/video/intro.mp4?hash=AB31
/app/video/intro-AB31.mp4
```

The query form can map to one stable disk path and is convenient for
latest-wins cache busting. The pathname form needs a matching file or rewrite
rule and is preferable for truly immutable assets because CDNs and caches
universally treat the changed path as a new resource.

Rip does not rewrite URLs embedded in CSS or string URLs embedded in Rip
source, and CSS does not enter `bundle.json`. Rewriting those references would
be a separate asset-build system. Applications instead use versioned asset
URLs, ordinary revalidation, or reload semantics.

### 8. Dynamic API responses

API responses are not file resources. Workers own their cache semantics. The
safe default is `Cache-Control: no-store`; an application may opt into caching
explicitly through `@cache`.

### 9. Hub and private control connections

Hub WebSockets are not HTTP response-cache resources. Doorbell and manager
control sockets are private Unix sockets and have no public cache policy.

### Summary

```text
Immutable versioned asset       → immutable
Mutable ordinary static file    → no-cache + Janus ETag
Bundle/manifest                 → no-cache + Janus ETag
Live Rip source                 → no-store
Live CSS                        → changed URL + no-cache + Janus ETag
HTML shell                      → no-cache
Mutable live image/media        → changed URL, targeted state update, or reload
API response                    → no-store unless the app explicitly caches
```

This preserves buttery delivery:

1. `.rip` updates fetch and apply the latest source.
2. CSS changes force a new stylesheet request.
3. Generated bundle/manifest revalidate efficiently.
4. Images update when their URL changes.
5. Ordinary static files remain Janus's responsibility.
6. Cache behavior remains stable regardless of watch state.

Legend:

1. A ding starts a cache-bypassing source fetch; the browser hashes and applies
   the bytes it actually receives, so rapid saves converge to the newest file.
2. The browser assigns the stylesheet link a URL containing the actual fetched
   hash; changing `href` makes the browser request and install the stylesheet.
3. Deterministic compare-before-write generation keeps the Janus ETag stable
   for identical bytes, while `no-cache` permits cheap `304` validation.
4. Browser caches key resources by URL, so changing an image or media URL
   creates a new lookup; changing disk bytes alone does not notify an open page.
5. Caddy and Janus continue to perform all public file lookup, validation,
   range handling, and byte delivery; the manager only observes and coordinates.
6. Policies are assigned by immutable, mutable, generated, live-source, HTML,
   and API semantics. Watch state changes activity, not cache meaning.
