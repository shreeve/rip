# The Rip Ecosystem

Rip is a full-stack application platform built from small processes with explicit
ownership boundaries. Rip supplies the language, compiler, browser runtime,
application framework, server framework, and database client. Janus supplies the
public edge. DuckDB Harbor supplies shared, process-isolated DuckDB access, and
Pilot supplies the human SQL client.

The normal MedLabs request path is:

```text
Browser
  │
  ▼
Caddy + Janus
  │  TLS, host and tenant admission, files, Hub, API proxy
  ▼
Rip Sites worker
  │  routes, middleware, validation, application code
  ▼
Rip DB / schema :model ORM
  │  Harbor protocol over HTTP on a Unix socket or loopback TCP
  ▼
DuckDB Harbor
  │  DuckDB connection pool and transaction leases
  ▼
libduckdb → one .duckdb file
```

Janus and Harbor do not integrate directly. Janus manages public requests and
admission and routing to the upstream socket list that Rip Manager publishes;
Rip Manager owns worker process lifecycle. Harbor independently manages
database statements and sessions. A Rip worker is the application boundary
between the two systems.

This document describes the current implementation. When a duplicated README
disagrees with code, tests, or one of the focused contracts below, treat the
implementation and tests as authoritative and then correct the stale document.

## Repositories and responsibilities

| Repository or package | Responsibility |
| --- | --- |
| `rip` | Language, compiler, loader, browser bundle, runtime, standard packages, editor support, tests |
| [`rip/packages/sites`](packages/sites) | Server framework, CLI, per-user control, per-project Manager, API generation, workers, App publication |
| [`rip/packages/app`](packages/app) | Browser application substrate: stash, data sources, routes, renderer, Workspace, feed, HMR |
| [`rip/packages/db`](packages/db) | Raw SQL client, default connection, transaction runner, operational CLI, MCP server |
| Rip `schema :model` runtime | Validation, typed model declarations, ORM, relations, hooks, DDL, and migration input; the schema CLI owns diff, history, and application |
| [Janus](https://github.com/shreeve/janus) | Caddy module for dynamic app admission, files, proxying, Hub, auth, and access observation |
| [DuckDB Harbor](https://github.com/shreeve/duckdb-harbor) | Standalone Rust database owner and HTTP/UDS server, one process per DuckDB file |
| Pilot | Harbor protocol client and DuckDB-shell-class terminal UI; it does not link DuckDB |
| MedLabs | A concrete multi-tenant application using the complete stack |

The most useful Rip contracts are:

- [`docs/SERVER.md`](docs/SERVER.md) for the Sites system boundary;
- [`docs/WORKSPACE.md`](docs/WORKSPACE.md) for browser publication state;
- [`docs/HMR.md`](docs/HMR.md) for live refresh and last-known-good behavior;
- [`docs/ORM.md`](docs/ORM.md) for `schema :model` and the adapter contract;
- [`packages/sites/README.md`](packages/sites/README.md) for CLI and framework
  usage, with the drift cautions described later in this document; and
- [`packages/app/README.md`](packages/app/README.md) and
  [`packages/db/README.md`](packages/db/README.md) for their public APIs.

## The complete topology

```text
                                public network
                                      │
                         HTTPS / WSS / HTTP redirects
                                      │
                         ┌────────────▼────────────┐
                         │ Caddy + Janus edge     │
                         │                        │
                         │ cold: Caddyfile gates │
                         │ hot: /1.0 registry    │
                         └─────┬──────┬──────┬───┘
                               │      │      │
                    static/App │      │ Hub  │ API proxy
                               │      │      │ over UDS
                     ┌─────────▼─┐ ┌──▼───┐  ▼
                     │ app/dist │ │ WSS  │  Rip worker pool
                     │ roots    │ │ conns│       │
                     └───────────┘ └──────┘       │ Rip DB / ORM
                                                  ▼
                                          Harbor berth
                                                  │
                                             libduckdb
                                                  │
                                             app.duckdb

  rip sites CLI ──► Rip per-user control ──► edge and Manager processes
                                              │
                                              └──► Janus /1.0 control socket

  per-project Manager ──► App publications, generation children, workers
  Pilot ─────────────────────────────────────► Harbor protocol
```

There are several control surfaces, and they should not be conflated:

- The **Rip per-user control process** backs `rip sites` catalog and lifecycle
  commands.
- The **Janus `/1.0` control plane** owns hot app registration, upstreams,
  heartbeats, Hub publication, and access streams.
- Each **Rip Manager control socket** owns one project's `status`, `stop`,
  `hold`, `release`, `migrate`, and `recover` operations.
- The **Harbor protocol** owns SQL, readiness, catalog inspection, sessions,
  and cancellation.

## Rip: language and shared compiler

Rip source runs through the same compiler architecture in three different
contexts:

1. Bun's Rip loader compiles ordinary server and tool modules.
2. A short-lived Sites generation child compiles an API graph into one
   loader-free JavaScript artifact.
3. The browser bundle compiles the published browser-safe Rip program into
   ES modules on the client.

This is not three compilers. It is one compiler used behind different delivery
seams. The server loader can reach server-only runtimes; the browser entry in
[`src/browser.js`](src/browser.js) structurally exposes only browser-safe
runtimes and packages. TypeScript faces and editor machinery remain outside the
in-page compiler.

The compiler records import and mapping facts while compiling. Sites uses
those facts to assemble a browser graph, and the browser loader uses them to
resolve source modules without scanning generated JavaScript. Static imports
are required in a published App; missing modules, cycles, dynamic imports, and
server-only package imports reject before activation.

## Janus: the two-faced edge

Janus is compiled into Caddy. Caddy continues to own listeners, HTTP versions,
TLS, ACME, and the ordinary Caddy configuration model. Janus adds a dynamic,
app-aware inward face.

Janus has two configuration times:

- **Cold configuration:** the Caddyfile enables capabilities and decides which
  sites admit Janus traffic and where the control API may listen.
- **Hot configuration:** tenant orchestrators such as Rip Manager call `/1.0`
  to register identity, hosts or tenant policy, file roots, Hub bridge, and
  worker upstreams. Workers do not write this state.

A hot registration cannot enable a capability forbidden by cold
configuration. This keeps operator policy separate from application state.

Janus holds its registry, data plane, and Hub state in Caddy pooled process
state; selected capability services also pool the state that must survive a
reload. A successful Caddy configuration reload preserves registrations and
WebSockets. A Caddy process restart clears them; Managers must register again.
Janus is deliberately not a durable store or a process supervisor.

### Numbered capabilities

Janus currently has nine numbered capability families:

1. `ping` — prove module load, TLS admission, and cascade behavior;
2. `control` — expose the internal/local/public `/1.0` listeners;
3. `hub` — edge-terminated WebSocket rooms, fan-out, bridges, and control-plane
   publication;
4. `mdns` — LAN discovery and the local status front door;
5. `auth` — prefix gates and trusted `Remote-User` injection for apps without
   their own authentication wall;
6. `files` — ordered registered roots, cache policy, precompressed sidecars,
   SPA shells, and directory-gated tenants;
7. `sendfile` — transform an upstream `X-Sendfile` response into an edge-owned
   ranged and validated file transfer;
8. `browse` — explicitly browsable roots, themes, and bounded renderers; and
9. `access log` — durable Caddy-compatible JSON plus bounded per-app live NDJSON.

The app registry, heartbeat reaping, TLS ask, request routing, and doorbell
protocol are important supporting surfaces rather than extra numbered
capabilities.

### Request ownership

For an admitted request, Janus performs edge concerns before selecting an API
upstream: it always strips a client-supplied `Rip-Site`; when the auth wall is
enabled it also strips client `Remote-User` and injects the authenticated
identity. It then applies host policy, handles Hub upgrades and registered file
roots, and finally proxies to a local worker
socket. Unknown hosts are a `404`; a registered app with no published or
currently healthy upstream is a retryable `503`.

Workers may return marked busy or draining `503`s. Janus can choose another
upstream only when replay is safe; it never guesses that a streamed request
body can be sent twice. Least-connections selection, passive health
suppression live at this layer.

For multi-tenant Apps, Janus admits `{site}` only when the configured direct
child directory exists. It injects the trusted selected site into the worker
request. Application code must use that trusted value rather than deriving a
tenant from an untrusted URL or `Host` value.

## Rip Sites: application server and orchestrator

Rip Sites has a per-user layer and a per-project layer.

### Per-user layer

The `rip sites` CLI owns a durable `sites.json` catalog and talks to a small
control process. That process starts and observes the shared Janus-enabled
Caddy edge, starts Managers for desired Apps, and exits when neither the edge
nor an App needs supervision. It distinguishes a Rip-owned edge from an
external one and will not silently take control of an external Caddy process.

On packaged macOS configurations, `launchd` owns loopback TCP listeners for
ports 80 and 443 and passes them to a user-owned Caddy process. HTTP/1.1 and
HTTP/2 use those inherited streams. HTTP/3 is not enabled on that path because
QUIC requires a separately inherited UDP socket.

### Per-project Manager

One Manager owns one project. It:

- discovers and validates `serve.rip`;
- publishes browser App state into `dist/`;
- compiles API generations in disposable children;
- starts, monitors, drains, and replaces workers;
- registers the App atomically with Janus and maintains heartbeats;
- publishes App changes through Janus's Hub control endpoint;
- consumes Janus access streams for developer logs; and
- implements operational barriers and migration journals.

The Manager never handles normal public HTTP requests. A browser request goes
from Janus directly to a registered file root or worker.

### Worker and framework

A worker imports the Manager's precompiled API artifact and exposes one Bun
HTTP handler on a Unix socket. [`packages/sites/site.rip`](packages/sites/site.rip)
owns routing, middleware, request parsing, validation, request-local context,
smart Web `Response` conversion, OpenAPI generation, and structured error
handling.

Request state uses `AsyncLocalStorage`, so helpers such as `session`, request
context, and access marks do not need to be threaded through every function.
Worker concurrency is explicit. Module-level mutable state is shared when
concurrency is greater than one; request-specific state belongs in locals or
the request context.

Workers do not serve browser files. For a private or dynamically authorized
file, application code selects a path with `@send`; the worker returns
`X-Sendfile`, and Janus owns the actual file transfer, ranges, MIME type,
validators, and cache behavior.

## API generation and the doorbell

The API edit loop compiles once per generation rather than once per worker:

```text
API source change
  → disposable generation child compiles one loader-free artifact
  → child reports the exact source inputs it consumed
  → build or validation failure: current workers remain admitted
  → success: Manager replaces Janus upstreams with one doorbell socket
  → old workers drain; no new request enters the stale generation
  → next API request makes Janus ring GET /ring
  → Manager boots a bounded fresh worker pool from the prepared artifact
  → ready sockets atomically replace the doorbell
  → Janus sends the held request to the fresh generation exactly once
```

`--eager` boots the prepared generation without waiting for a request. The
doorbell is the default because it creates a clean admission boundary without
buffering or replaying the original request body. A generation-build failure
keeps the old pool. A worker-boot failure after the doorbell cut cannot safely
restore code already declared stale. The triggering ring receives the bounded
boot failure; subsequent rings fail fast until a newer candidate succeeds.

## Browser App publication

A Rip App has authored input under `app/` and Manager-owned publication output
under `dist/`:

```text
project/
├── index.rip                 optional API entry
├── serve.rip                 edge, App, and file policy
├── app/
│   ├── index.html
│   ├── stash.rip
│   ├── routes/
│   ├── styles.css
│   └── ordinary assets
└── dist/
    ├── @rip/rip.min.js
    ├── @rip/rip.min.js.br
    ├── @rip/tailwind.min.js
    ├── @rip/tailwind.min.js.br
    ├── bundle.json
    ├── bundle.json.br
    └── latest.json
```

Janus searches registered roots in order; root directory names are not URL
prefixes. `dist/bundle.json` is `/bundle.json`, and `app/styles.css` is
`/styles.css`. The project root, API source, database, migrations, and secrets
are private unless a file root explicitly exposes them.

### Complete publication

`bundle.json` contains exactly one Manager-declared App hash and one sorted
source list:

```json
{
  "hash": "ABC123",
  "list": [
    ["rip/http/index.rip", "export class HTTPError ..."],
    ["stash.rip", "export stash = ..."],
    ["routes/index.rip", "export Index = component ..."]
  ]
}
```

The list may contain authored browser Rip, browser-safe package source,
generated browser schema projections, and authored `data.rip` when present. It
does not contain ordinary assets, API implementation, ORM model behavior, or
`rip/app`.
`rip/app` and the browser compiler/runtime are already embedded in
`/@rip/rip.min.js`.

The top-level App hash covers the managed App identity and the published
runtime set. It is a synchronization identity, not a browser-computed
integrity hash. Individual file hashes stay private to Manager. Janus's weak
file ETag is an independent HTTP transport validator.

Manager prepares the canonical JSON and its exact Brotli representation,
commits the JSON, attempts to install the sidecar, and then updates
`latest.json`; `latest.json` never points ahead of the canonical bundle. A
sidecar-install failure leaves valid uncompressed JSON available. The browser
requests `/bundle.json`, never `/bundle.json.br`; Janus selects the sidecar
through normal `Accept-Encoding` negotiation.

### Watch reconciliation

Watcher events are invalidations, not mutations. A filename decides only
whether reconciliation should wake. Current Manager behavior is:

```text
relevant watcher event
  → 50 ms trailing debounce, capped 250 ms from the first event
  → snapshot the complete managed App tree and external assembly inputs
  → compare with the committed publication
  → commit a complete successor, or a coherent raw-source quarantine candidate
  → publish one ordered change
  → repeat until disk and publication agree
```

A slow sweep, two seconds by default, recovers from entirely lost filesystem
notifications, changed package membership, changed schema/package/runtime
inputs, and work left after a failed candidate.

The change wire carries Rip source but not ordinary asset bytes:

```json
{
  "change": {
    "from": "ABC123",
    "hash": "DEF456",
    "list": [
      ["routes/index.rip", "updated Rip source"],
      ["styles.css"],
      ["images/old.png", null]
    ]
  }
}
```

- `[path, source]` creates or replaces Rip source.
- `[path]` says an ordinary HTTP asset changed.
- `[path, null]` says a file was deleted.

Publishing happens through Janus's private control-plane Hub endpoint. It does
not depend on an application worker or the optional application Hub bridge.

## Rip App in the browser

[`src/browser.js`](src/browser.js) is the publication-facing boot layer. It
fetches and strictly validates `bundle.json`, builds an in-memory module graph,
compiles the complete Rip program into browser-loadable Blob or data-URL ES
modules, activates a Workspace, and then calls `rip/app`'s
transport-independent `launch` function.

The module loader rewrites compiler-recorded imports to source modules or
stable runtime/package bridges. Browser-safe package source is compiled in the
same graph. Server-only modules are structurally unavailable.

`launch` builds the application substrate:

- a reactive stash and lazy source cells;
- filesystem-derived routes and layouts;
- a router over browser history;
- a renderer with route data gates and transactional staging;
- owned-link interception, preloading, and scroll behavior;
- mutations, timing helpers, and optional stash persistence.

Rip App separately exports route-aware accessibility helpers.

The core launch layer receives already prepared module objects. It does not
fetch a bundle, open WebSockets, or understand Janus, Sites, or publication
hashes.

### Workspace and live application

Workspace is the atomic browser boundary:

```text
module path → active Rip source + active compiled namespace
App         → one Manager-declared complete hash
```

On a live change, the browser constructs and compiles the complete candidate
program before staging it. Workspace exposes the staged module registry to the
renderer and commits source, modules, hash, and route notifications only after
activation succeeds. Failure rolls back without exposing partial state.

The feed subscribes to `/hub` before requesting `latest.json`. It waits for an
exact server acknowledgement, buffers changes during the race, and accepts
publication messages only after rejecting client-originated frames carrying
Janus sender provenance. Manager control-plane publications arrive unstamped.

### HMR and last-known-good behavior

Framework-aware HMR classifies a valid Rip edit as:

- **patch** — keep the living component instance and initialization state,
  refresh computeds/effects, and rebuild its view;
- **migrate** — retain compatible named state across a replacement;
- **remount** — replace the narrowest dirty route/layout suffix; or
- **reload** — reconstruct the whole document when isolation is not honest.

When Manager cannot assemble a watch candidate, it may still publish coherent
raw source for browser quarantine. Separately, browser compilation or
activation can fail after Manager published an assembled graph. In both cases
the browser quarantines that candidate hash, shows an overlay, and keeps the
previous App interactive. A later live transition can rebase from the
quarantined hash onto the living last-known-good state and apply in place. If
the browser was disconnected and discovers that it missed the recovery
through `latest.json`, it reloads the complete publication.

CSS refreshes through HTTP after a successful commit. Other managed asset
changes, deletion of a mounted route/layout, or replacement of the browser
runtime require a document reload.

## Rip DB and the ORM

Rip has one DuckDB transport implementation:
[`src/runtime/duckdb.js`](src/runtime/duckdb.js). Both the `schema :model` ORM
and [`rip/db`](packages/db) use it. The wire implementation and codecs are
shared rather than duplicated; higher-level timeout defaults, cancellation
exposure, and retry policies intentionally differ.

The layers are:

```text
application model or SQL call
  ├── schema :model ORM ── SQL builder, hydration, hooks, relations
  └── rip/db client ───── raw SQL, row projection, retry runner, CLI/MCP
              │
              ▼
        shared Harbor adapter
              │
              ▼
       HTTP/UDS Harbor protocol
```

### Target resolution

Rip understands two transports and one convenience name:

| Spelling | Result |
| --- | --- |
| `http://host:port` or `https://host` | TCP HTTP(S) |
| `unix:///path/to.sock` | HTTP over a Unix socket using Bun's `fetch` `unix` option |
| `harbor:name` | Read Harbor's registry and resolve to the registered socket or TCP port plus token |

`RIP_DB_URL=harbor:medlabs` reads `$HARBOR_HOME/medlabs.json` and
`medlabs.token`, preferring the Unix socket. A dummy HTTP host is used for the
UDS request; it is never resolved on the network. Explicit credentials win
over registry credentials, which win over `RIP_DB_TOKEN`.

### Shared adapter contract

The required storage boundary is:

```text
query(sql, params) → { columns, data, rowCount }
```

`begin()` adds transaction support, `catalog()` adds migration inspection, and
`capabilities` declares features such as transactional DDL. The ORM can use a
non-Harbor adapter if it implements this contract.

The default ORM adapter is Harbor-backed and reads the environment. An
explicit `schema.connect()` constructs an adapter; `schema.setAdapter()`
installs it. `rip/db`'s `connect()` installs its adapter as the process default
and soft-wires the ORM through one load-order-independent global handshake.
Consequently raw SQL and models in one worker normally share one configured
adapter.

`rip/db` materializes raw column arrays into row objects and exposes `sql`,
`findAll`, `findOne`, and `transaction`. It can opt into snake_case-to-camelCase
keys, but raw SQL is otherwise never rewritten. Values belong in positional
parameters; trusted SQL fragments and identifiers remain a caller decision.

### ORM surface

A `schema :model` declaration is simultaneously:

- a runtime validating type;
- a TypeScript/editor type;
- a persisted table description;
- a query builder and instance persistence API; and
- migration input.

The ORM owns naming and quoting, structured and trusted-string `where` forms,
ordering, scopes, soft deletion, timestamps, relations, eager loading,
lifecycle hooks, bulk operations, `INSERT ... RETURNING`, and DDL rendering.
Structured identifiers are validated and quoted; string predicates are
trusted SQL and must use parameters for untrusted values.

Transactions propagate through `AsyncLocalStorage`. Nested work on the same
adapter joins one transaction without savepoints. Different adapters are
independent and do not pretend to provide distributed atomicity. `afterCommit`
runs only after an acknowledged outer `COMMIT`. `afterRollback` runs after the
outer rollback attempt; rollback errors are suppressed so the original
callback error wins. A failed `COMMIT` runs neither hook family.

The `rip/db` transaction runner can retry optimistic DuckDB conflicts,
unavailable leases, and expired sessions. Its callback may therefore execute
more than once. Database-only callbacks are normally safe; callbacks that
charge a card, send email, or perform another external side effect should
disable automatic retries and own their recovery logic. Transaction options
are currently available on the client returned by `connect()`, not on the
module-level wrapper:

```coffee
db = connect!
db.transaction! work, { retries: 0 }
```

Several adapter boundaries are intentional and worth remembering:

- The ORM emits relation metadata and accessors but no physical DuckDB
  `REFERENCES` constraints.
- The Harbor adapter decodes temporal types. JSON object decoding belongs to
  the adapter; the ORM does not guess that a string containing JSON should be
  parsed.
- Harbor streams NDJSON, but the current Rip adapter buffers the HTTP body
  before parsing and materializing it. Harbor's wire supports streaming; the
  current Rip query surface is not an incremental row iterator.
- ORM transactions do not retry automatically. The `rip/db` client transaction
  runner does.
- The raw client exposes `AbortSignal` cancellation; the public ORM query
  surface currently does not.

## DuckDB Harbor

Current Harbor is a standalone Rust process, not a loadable DuckDB extension.
One `harbor serve` process owns one DuckDB file, one listen address, and one
token. A fleet is several isolated berth processes.

Harbor dynamically links external `libduckdb` through the operating-system
loader and DuckDB's compatible C interface. The binary does not manually
`dlopen` a library for each berth. The same Harbor executable can run against
compatible DuckDB 1.5 and 2.0 libraries; the resolved library is the engine.

### Daemonless fleet

Harbor keeps two roots. `~/.config/harbor/config.toml` is the user's to
edit; the fleet registry is harbor's to write and safe to delete, and
lives under `~/.local/state/harbor` (or `$XDG_STATE_HOME/harbor`, or an
absolute `$HARBOR_HOME`, which collapses both roots into one directory):

```text
~/.local/state/harbor/runtime/
├── medlabs.lock    process-lifetime ownership lock
├── medlabs.sock    default local data endpoint
├── medlabs.json    identity and dial information
├── medlabs.token   per-berth bearer token
└── log/
```

`harbor serve` runs in the foreground. `harbor start` starts a detached berth
and waits for real readiness. `harbor show` discovers the fleet, `harbor stop`
drains and checkpoints, and `harbor forget` clears registry state without deleting
the database file. Harbor is not a central daemon or supervisor.

UDS is the default local face. Loopback or trusted-network TCP is optional.
Harbor speaks plain HTTP; remote TLS and edge authentication belong in Caddy.

### Execution model and protocol

Harbor opens a fixed DuckDB connection pool and divides it between ordinary
query workers and transaction leases. The default pool is sixteen connections,
with six ordinary workers and ten lease connections. Held transactions cannot
consume all request executors. A dedicated probe lane and a reaper keep
readiness, cancellation, release, and deadlines available under saturation.

The protocol has eight main routes:

```text
POST   /sql                    execute one statement
GET    /ready                  real database readiness; unauthenticated
GET    /catalog                complete schema document
GET    /info                   berth identity
POST   /sql/sessions/new       acquire a transaction lease
DELETE /sql/sessions/<id>      release it
GET    /sessions               inspect lease accounting
DELETE /sql/queries/<id>       cancel a named statement
```

`POST /sql` accepts exactly one statement and positional parameters. Results
stream as typed NDJSON by default: one schema event, row events, and one end or
error event. A caller may request one-shot JSON for a small result, but Harbor
caps that representation at 32 MiB. The schema describes DuckDB types and
whether each column's DuckDB type and encoding cross the JSON representation
losslessly.

The client chooses a unique `queryId` before execution so cancellation can
arrive before the response. A Rip client abort or client-side deadline sends a
best-effort `DELETE` for the named query. Harbor enforces its own statement
deadline independently through the reaper, which remains available when
request workers are all busy. Session leases enforce idle and maximum
lifetimes, serialize statements, and roll back abandoned open transactions.

Harbor requires one Bearer header on authenticated routes. `/ready` is the one
unauthenticated exception. SQL itself is powerful enough to read host files or
load extensions unless the berth is started with the appropriate sealed
posture, so a token is not a substitute for deciding which SQL callers are
trusted.

## Pilot

Pilot is a Harbor client, not another DuckDB host. It links its `wire`
protocol-types crate but no DuckDB engine or C library. This makes one Pilot
binary usable across berths running different compatible DuckDB versions.
Harbor currently implements the same wire shapes independently, so a contract
change needs tests on both sides rather than relying on a shared Rust type to
make drift a compile error.

Pilot resolves:

- a live berth name from `~/.local/state/harbor/runtime`;
- a Unix socket;
- a plain HTTP endpoint; or
- a `.duckdb` path, joining its current owner or asking `harbor start` to start
  an idle-exit berth.

It provides a DuckDB-shell-class REPL, syntax highlighting, server-assisted
completion, multiple render modes, history, one-shot `-c`, piped scripts, and
Ctrl-C cancellation. Pilot is DuckDB-aware as a SQL user interface but has no
embedded engine and no DuckDB ABI dependency. Current Pilot deliberately does
not implement HTTPS; use a local socket, trusted HTTP, or SSH to the host.

## End-to-end flows

### Static or navigation request

```text
Browser → Caddy TLS → Janus tenant/host admission
        → ordered registered roots → file or SPA shell
```

No Manager or worker is on this data path.

### API request

```text
Browser → Caddy/Janus → worker UDS → Rip Sites route/middleware
        → application code → Web Response → Janus → Browser
```

If the route uses the database:

```text
worker → rip/db or ORM → Harbor adapter → Harbor UDS → DuckDB
```

### App edit

```text
save → Manager whole-state reconciliation → successor publication commit
     → Janus control-plane Hub publish → browser feed
     → complete candidate compile → Workspace stage
     → patch/migrate/remount/reload → commit or quarantine
```

### API edit

```text
save → generation child → prepared artifact → Janus doorbell cut
     → next request rings → fresh workers boot → upstream swap
     → request enters only the fresh generation
```

### SQL from a developer terminal

```text
pilot medlabs → ~/.local/state/harbor/runtime/medlabs.{json,sock,token}
              → Harbor protocol → DuckDB
```

Pilot and application workers use the same server protocol but are otherwise
independent clients.

## Operational lifecycle

For a MedLabs-shaped local deployment, start the database owner before the
site and let it outlive worker reloads:

```bash
harbor start api/db/medlabs.duckdb --name medlabs --statement-timeout 30s
rip sites start edge --config Caddyfile
rip sites add . --name medlabs
rip sites start medlabs
```

The App uses `RIP_DB_URL=harbor:medlabs`, so workers resolve the live berth
from its registry rather than depending on a hand-selected port. `rip sites`
does not start or stop Harbor. This independence is intentional: worker
replacement must not change ownership of the database file.

MedLabs also enables Harbor's browser UI with `--unsigned` and initialization
statements in its current local runbook. Those flags are UI-specific; the
statement timeout above is the independent backstop for runaway application
queries.

Stop application Managers before stopping the edge. Stop Harbor separately
when database service should end; graceful Harbor shutdown drains work,
rolls back abandoned leases, checkpoints, and removes live registry entries.

Use Manager barriers for coordinated changes:

- `hold` freezes App and API replacement while current service continues;
- `release` validates and activates a coherent held candidate;
- `migrate` journals and performs an explicit database cutover; and
- `recover` resumes the exact journaled operation for fix-forward recovery.

Database migration never happens merely because a server starts or source
changes.

## Why the architecture is fast and clean

The design obtains performance mainly by assigning work to the narrowest
owner:

- Caddy terminates modern HTTP and TLS instead of application code rebuilding
  those facilities.
- Janus serves static and authorized files without involving Bun workers,
  terminates long-lived WebSockets at the stable edge, and routes over local
  sockets.
- Manager compiles API source once into one artifact; workers import it rather
  than each running the compiler.
- Workers remain small, isolated processes with explicit bounded concurrency.
- One compressed `bundle.json` carries the complete browser source graph in
  one request and compression context.
- The browser uses the same Rip compiler and owns activation locally, avoiding
  a server-side JavaScript bundle pipeline while retaining complete-graph
  validation.
- Workspace transactions and doorbell admission fences make generation
  changes coherent without timing guesses.
- Rip DB and the ORM share one Harbor adapter rather than maintaining parallel
  wire clients.
- Harbor exposes a simple streaming protocol, bounds SQL concurrency, splits
  transaction leases from ordinary workers, and uses local UDS by default.
- Harbor owns the DuckDB file once; every worker and tool becomes a lightweight
  protocol client instead of competing for the embedded database lock.

The same boundaries make the code easier to reason about. Caddy does not know
Rip hashes. Janus does not compile Apps or supervise workers. Manager does not
serve public traffic. Workers do not publish browser files or open DuckDB
files. Harbor does not know Rip models. Pilot does not host an engine. Each
layer can therefore reject invalid input at the boundary it actually owns.

## Failure and consistency model

| Failure | Expected behavior |
| --- | --- |
| Caddy config reload | Janus registrations and Hub connections survive through pooled state |
| Caddy/Janus process restart | Memory registry is empty; live Managers re-register |
| Manager heartbeat stops | Janus reaps the App claim after its TTL |
| API generation fails before cut | Existing workers remain admitted |
| Fresh worker boot fails after doorbell cut | Triggering ring gets the bounded boot failure; later rings fail fast until a newer candidate succeeds |
| Worker is busy or draining | Marked `503` lets Janus retry another safe upstream |
| App source candidate fails in browser | Candidate is quarantined; last-known-good App remains interactive |
| Browser misses an ordered transition | Reload the complete publication rather than infer missing state |
| Rip client aborts or reaches its own deadline | Best-effort named cancellation targets the correct Harbor job; typed cancellation propagates |
| Harbor statement deadline expires | Harbor's independent reaper interrupts the query and returns the typed timeout |
| Harbor client disappears mid-transaction | Lease expiry rolls back and returns the connection |
| Harbor exits cleanly | Requests drain, transactions roll back as needed, DuckDB checkpoints |
| Migration outcome becomes uncertain | Remain in Maintenance and recover by journaled operation id |

## Working effectively in this ecosystem

When changing the platform, begin by naming the owner:

- TLS, public host admission, static-file transport, ranges, or WebSocket
  fan-out → Janus/Caddy;
- project watching, App publication, worker generations, or operational
  barriers → Rip Sites Manager;
- request routing, middleware, validation, or API responses → Rip Sites
  worker framework;
- browser state, routes, render gates, Workspace, or HMR → Rip App and
  `src/browser.js`;
- SQL wire, cancellation, temporal decoding, or target resolution → shared
  Rip DuckDB adapter;
- model/query semantics or migrations → ORM runtime and schema CLI;
- connection pools, leases, NDJSON, database ownership, or fleet lifecycle →
  Harbor; and
- terminal SQL interaction → Pilot.

Do not repair a cross-layer symptom at the nearest convenient file. Trace the
request or state transition to the boundary that first owns the incorrect
fact, fix it there, and pin both sides of any wire contract.

Useful focused verification commands are:

```bash
# Rip packages
cd packages/sites && bun run test
cd packages/app && bun run test
cd packages/db && bun run test

# Rip browser and repository contracts
bun run test:browser
bun run test:all

# Janus
go test ./...
./test.sh

# Harbor and Pilot
make check_quick
make check
```

Run the smallest test that can disprove a change during development, then the
owning package and its direct consumers. Cross-repository protocol changes
need pins on both sides. Harbor protocol changes are additive by current
design so deployed Rip adapters and Pilot clients continue to work.

## Implementation map

Use this map to move from the architecture to the owning code quickly:

| Concern | Primary implementation |
| --- | --- |
| Browser compile, module loading, publication boot, HMR transaction | [`src/browser.js`](src/browser.js) |
| Harbor transport, typed errors, temporal codec, sessions, cancellation | [`src/runtime/duckdb.js`](src/runtime/duckdb.js) |
| Model query/persistence runtime | [`src/runtime/orm.js`](src/runtime/orm.js) |
| Schema validation/runtime registry | [`src/runtime/schema.js`](src/runtime/schema.js) |
| Sites CLI and per-user control client | [`packages/sites/sites.rip`](packages/sites/sites.rip), [`agent.rip`](packages/sites/agent.rip) |
| Per-project publication and worker lifecycle | [`packages/sites/manager.rip`](packages/sites/manager.rip) |
| Browser graph assembly | [`packages/sites/bundle.rip`](packages/sites/bundle.rip) |
| API artifact generation and worker host | [`packages/sites/generate.rip`](packages/sites/generate.rip), [`worker.rip`](packages/sites/worker.rip) |
| Server routes, middleware boundary, responses | [`packages/sites/site.rip`](packages/sites/site.rip), [`middleware.rip`](packages/sites/middleware.rip) |
| Browser Workspace and publication feed | [`packages/app/workspace.rip`](packages/app/workspace.rip), [`feed.rip`](packages/app/feed.rip) |
| Browser launch, router, renderer, HMR apply | [`packages/app/launch.rip`](packages/app/launch.rip), [`router.rip`](packages/app/router.rip), [`renderer.rip`](packages/app/renderer.rip), [`apply.rip`](packages/app/apply.rip) |
| Raw DB package, CLI, MCP, retry runner | [`packages/db/db.rip`](packages/db/db.rip) |
| Janus process/config modules | [`app.go`](https://github.com/shreeve/janus/blob/main/app.go), [`handler.go`](https://github.com/shreeve/janus/blob/main/handler.go), [`state.go`](https://github.com/shreeve/janus/blob/main/state.go) |
| Janus hot registry and data plane | [`apps.go`](https://github.com/shreeve/janus/blob/main/apps.go), [`dataplane.go`](https://github.com/shreeve/janus/blob/main/dataplane.go), [pool protocol](https://github.com/shreeve/janus/blob/main/docs/20260719-002000-pool-protocol.md) |
| Harbor fleet and process entry | [`crates/harbor/src/main.rs`](https://github.com/shreeve/duckdb-harbor/blob/main/crates/harbor/src/main.rs) |
| Harbor pool, leases, HTTP protocol | [`crates/harbor/src/lib.rs`](https://github.com/shreeve/duckdb-harbor/blob/main/crates/harbor/src/lib.rs) |
| Pilot's Harbor wire types | [`crates/wire/src/lib.rs`](https://github.com/shreeve/duckdb-harbor/blob/main/crates/wire/src/lib.rs) |
| Pilot resolution, REPL, and client | [`crates/pilot/src`](https://github.com/shreeve/duckdb-harbor/tree/main/crates/pilot/src) |

## Known documentation cautions

The architecture above reconciles current code and tests. Several older or
duplicated descriptions should not be copied into new work:

- Current Harbor is a standalone `harbor serve`/`harbor start` binary. The
  `INSTALL harbor; LOAD harbor; CALL harbor_serve(...)` extension instructions
  still present in [`packages/db/README.md`](packages/db/README.md) and
  `packages/db/example.rip` are retired.
- [`packages/db/example.rip`](packages/db/example.rip) also imports a
  module-level `query` export that does not exist, so it is not a runnable
  current example. Use a client returned by `connect()`.
- The money guidance in [`docs/ORM.md`](docs/ORM.md) says Harbor returns
  `DECIMAL` values as floating-point JSON numbers. Current Harbor preserves
  them as lossless strings with type metadata. Integer minor units can still
  be a good application policy, but lossy Harbor transport is no longer the
  reason for it.
- Rip's migration client and Harbor's README say a per-request timeout of zero
  opts out of the deployment statement timeout. Current Harbor instead treats
  the deployment timeout as a hard ceiling and maps zero to that ceiling. A
  long migration can therefore time out when Harbor has a configured cap;
  this wire-policy disagreement should be resolved before relying on an
  unbounded migration window.
- Current Sites watch handling uses whole-state reconciliation. Exact watcher
  paths are relevance hints, despite exact-path rehash language still present
  in parts of [`packages/sites/README.md`](packages/sites/README.md).
- A watch-time App assembly failure may publish coherent source for browser
  quarantine. It is not universally true that every failed graph build leaves
  publication untouched; that description applies to initial admission, not
  the last-known-good live path.
- A live successor after a quarantined App can apply in place. A document
  reload is required when recovery was missed and is discovered through
  reconnect, not for every successor hash.
- Current API replacement uses the doorbell/lazy-boot protocol. Descriptions
  that always boot a fresh pool before cutting the old one are outdated.
- Pilot is deliberately TLS-free in current code. Harbor decision-record text
  suggesting that Pilot itself reaches HTTPS endpoints is stale.
- The blanket `globalThis` ban in [`packages/AGENTS.md`](packages/AGENTS.md)
  is too broad for browser packages: `globalThis` is itself a Web platform
  global and the current App implementation legitimately uses it. The rule
  should prohibit server-only globals and dependencies in browser code.
- The root instruction to avoid all backwards-compatibility paths and all
  historical comments is also broader than the platform's real obligations.
  Persisted catalog migration, the independently deployed Harbor wire, and
  comments that explain a live safety invariant need deliberate, tested
  compatibility. The rule should target accidental legacy branches and dead
  chronology instead of forbidding explicit migrations and rationale.

These cautions are about documentation drift, not alternate compatibility
modes. There is one current architecture described in the preceding sections.
