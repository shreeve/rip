# Rip Server Architecture Objective

This document defines the target Rip Server architecture and its ownership
contract. The objective is one independently managed server per invocation,
with many Rip servers able to run behind one shared Caddy process and its
Janus module.

```text
Caddy process
└── Janus
    ├── reads files from ───────────► medlabs static files
    └── proxies requests to ────────► medlabs API worker(s)

medlabs server
├── manager
│   ├── registration/upstreams/heartbeats/dings ─► Janus control plane
│   ├── api
│   │   ├── source
│   │   └── worker(s)
│   └── app
│       └── source → static/published App
└── static
    ├── site-specific
    ├── common
    └── published App
```

The manager controls the Medlabs server. Caddy and Janus form the shared edge
that serves its static files and routes its API requests.

## Vocabulary

- **Rip Server** is the package and the `rip server` command.
- A **Rip server** is one running project, such as Medlabs.
- The **manager** is the one long-running control process for that server.
- The **API** is dynamic server-side source executed by workers.
- A **worker** is a disposable process that executes API request handlers.
- The **App** is browser-side source managed and published by the manager.
- **Static** is every file Caddy and Janus can serve directly: site-specific
  files, common files, and the published App.
- **Caddy + Janus** is the shared edge for zero or more Rip servers.

One `rip server` invocation launches one manager. That manager may supervise
zero, one, or many workers for its API. It does not manage another Rip server.

## Shared Edge

### Caddy

One Caddy process is the machine's public HTTP server. It owns:

- Network listeners and HTTP/1–3.
- TLS termination and ACME certificates.
- SNI and the HTTP handler pipeline.
- The Janus module running inside the same process.

Caddy does not launch Rip managers or workers.

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
registers, watches, publishes, and supervises, but it never handles an
ordinary client request or serves a static file.

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
- Produces one server artifact for each source generation.
- Starts workers on unique Unix sockets.
- Waits for workers to report readiness.
- Atomically publishes ready sockets to Janus.
- Replaces crashed workers.
- Drains and retires superseded workers.

A server-side source change creates a dirty API generation:

```text
API source changes
        │
        ▼
manager publishes its doorbell as the only upstream
        │
        ▼
Janus sends no new requests to the old workers
        │
        ▼
the next API request causes Janus to ring the doorbell
        │
        ▼
manager produces the latest server artifact and starts fresh workers
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

Concurrent requests join one bounded boot. Compilation failure, worker boot
failure, timeout, or waiter overflow produces an explicit `503`; a request is
delivered once to a fresh worker or not delivered at all.

Caddy and Janus continue running throughout the replacement.

### 3. App publication and client hot dings

The manager turns App source into browser-ready static files:

```text
App source
    │
    ▼
manager publication
    │
    ▼
static/published App
```

A publication may contain an `index.html`, a manifest, browser-ready Rip
modules, CSS, images, and startup metadata. Publication does not require a
general-purpose bundler; it is the operation that makes the App directly
servable by Caddy and Janus.

The manager writes publication changes atomically. File representations land
before a manifest or notification names them.

In development, an App-source change:

1. Updates the affected published representations.
2. Assigns their new ETags.
3. Sends tiny `{ id, etag }` dings through Janus Hub.
4. Lets the browser choose `reload`, `css`, `update`, or `ignore`.

An App-only change does not replace API workers. A server-side change replaces
the API generation and tells connected browsers to reload against it.

In production, the publication is sealed and no development feed is exposed.

### 4. Static-file policy

The manager declares static-file policy to Janus but does not serve the
files. It registers three ordered classes:

1. Site-specific static files.
2. Common static files.
3. The published App.

It also registers the App's SPA shell. Janus and Caddy perform the file
lookup, conditional HTTP behavior, range handling, and response delivery.

Site-specific files can override shared resources while still inheriting
common and published App files. The exact configured root order decides the
first match.

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
    ├── site-specific static hit ────────────► file
    │
    ├── common static hit ───────────────────► file
    │
    ├── published App hit ───────────────────► file
    │
    ├── HTML navigation miss ────────────────► SPA shell
    │
    └── other miss ──────────────────────────► 404
```

### API requests

Configured API prefixes such as `/api` are worker-first. They:

- Never resolve as static assets.
- Never receive the SPA shell.
- Route to a ready worker or ring the manager's doorbell.

### Static requests

Janus searches the registered roots in order and serves the first regular-file
match. Static delivery supports `GET` and `HEAD`, validators, ranges, and no
directory listing.

### App navigation

An HTML navigation request that misses every static root receives the
published App's shell. The browser-side router then resolves the route.

### Not found

A non-HTML static miss returns `404`. An unknown hostname or tenant also
returns `404`. API unavailability is different: it returns `503` because the
server is known but currently cannot execute the request.

## Server Shapes

The same model permits three useful shapes.

### Full server

```text
manager + API workers + published App + static files
```

### API-only server

```text
manager + API workers
```

There is no App publication. Janus routes the configured API surface to
workers.

### App-only server

```text
manager + published App + static files
```

There are no API workers. The manager maintains registration, publication,
development dings when enabled, and heartbeats; Caddy and Janus serve every
public request.

## Ownership Rule

The complete architecture reduces to four owners:

- **The manager registers, watches, publishes, and supervises.**
- **Workers execute dynamic API code.**
- **Janus admits, routes, coordinates, and serves registered files.**
- **Caddy owns the network, HTTP, and TLS.**
