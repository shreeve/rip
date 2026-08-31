<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Sites

> **Routes, workers, and a browser App — behind one shared Caddy+Janus edge.**

Rip Sites is how you run Rip projects on HTTPS locally: a **framework** for
routes and validation, a **manager** per project, a **shared edge** for TLS and
routing, and an optional **menu-bar tray** that drives the same CLIs.

**Runtime:** Bun on the server (managers, workers, edge-scoped control).
Browser Apps use the published Workspace. The menubar host is macOS-only
(`rip/tray`).

The system-wide ownership, reload, migration, and cache contract is
[docs/SERVER.md](../../docs/SERVER.md). App publication wire details are under
[Detailed Lifecycle](#detailed-lifecycle) below.

## Mental model

```text
┌─────────────────────────────────────────────────────────────┐
│  rip sites             one CLI: apps · edge · tray          │
│                    HTTPS *.via.rip → files / Hub / /api     │
└────────────────────────────┬────────────────────────────────┘
                             │ Janus control socket
┌────────────────────────────▼────────────────────────────────┐
│  sites.json + control      remembered projects, start/stop  │
│  (control lives with edge — no idle forever daemon)         │
│  rip sites run/publish     foreground manager (optional)    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  your project          index.rip + app/ + serve.rip         │
│                        workers + published dist/            │
└─────────────────────────────────────────────────────────────┘

Optional UI:  rip sites start tray   →  menu over the same CLI
```

Caddy and [Janus](https://github.com/shreeve/janus) own every client request
(TLS, hosts, static/App files, Hub, `/api` proxy). Managers never take
ordinary HTTP themselves — they register with Janus and supervise workers.

## Surfaces

| Surface | What it is | When you use it |
| --- | --- | --- |
| `rip/sites` | Framework API (`get`, `read`, middleware, …) | Inside `index.rip` / App code |
| `rip sites` | Unified CLI: catalog, apps, edge, tray, advanced | Day-to-day Sites |
| `rip sites run` / `publish` | Foreground manager / directory publish | Dev without the catalog |
| Sites tray | Menu-bar UI over `rip sites` | Click instead of typing |

Reserved nouns (not app names): **`edge`**, **`all`**, **`tray`**, **`agent`**.
Durable catalog is
`sites.json` (Rip-owned). The control plane starts with the edge / desired
apps and exits when nothing remains to supervise — Janus stays live-only.

## Quick Start

### 1. Start the edge

From this repo the packaged Janus-enabled binary and Caddyfile are the
defaults:

```bash
rip sites start edge
rip sites status edge
# ● Edge  running (Rip-owned)
#   Control: …/rip-agent-…/janus.sock
#   Caddy:   …/packages/sites/bin/janus
#   Config:  …/packages/sites/Caddyfile
```

That binds `via.rip` and `*.via.rip` on loopback **HTTP→HTTPS** (ports
**80/443** by default) with exact-host certificates minted on demand by the
local CA — run `rip sites trust edge` once and every `*.via.rip` and
`*.local` name verifies. Those names resolve only to `127.0.0.1`. Browser
status is at `https://via.rip/` (Rip-owned page — not Bonjour).

Three postures:

| | **Default** (`rip sites start edge`) | **`local`** | **`public`** |
| --- | --- | --- | --- |
| Bind | `127.0.0.1` | all interfaces | phase 2 |
| Bonjour | off | shared `rip.local` (apps use `{name}.local` hosts) | — |
| Apps | `https://{name}.via.rip/` (+ `.local` twin claimed) | `https://{name}.local/` (dual-claim with via.rip) | — |
| Status | `https://via.rip/` | `https://rip.local/` (Rip catalog + `/trust`) | — |
| TLS | `tls internal` on-demand (trust first) | `tls internal` on-demand (trust first) | — |

```bash
rip sites trust edge                 # install the local CA (required before local)
# stop running sites first — mode flips recreate the edge
rip sites expose local               # LAN / Bonjour posture (stop+recreate)
rip sites expose loopback            # back to default
rip sites trust edge --export ca.crt # share the CA with a phone / peer
# phone bootstrap without temporary HTTPS accept:
#   http://rip.local/trust
rip sites expose public              # refuses until phase 2
```

`*.via.rip` names resolve only to `127.0.0.1` — by design, forever — so
phones on the LAN need `{name}.local` hosts (and the trusted local CA), not
the via.rip URLs. Catalog adds and `rip sites expose local` dual-claim every
`*.via.rip` host with a matching `*.local` twin; demos declare both in
`serve.rip`. After a mode flip, restart sites so managers re-register the
hosts.

Phone walkthrough (hello):

```bash
rip sites stop hello
rip sites trust edge && rip sites expose local
rip sites start hello
# http://rip.local/trust  → install CA on the phone
# https://hello.local/      → the app
# https://rip.local/      → Rip catalog (Start/Stop/Restart)
```

Overrides when needed:

```bash
rip sites start edge --caddy /path/to/janus --config /path/to/Caddyfile
# or: JANUS_CADDY=/path/to/janus rip sites start edge
```

`rip sites status edge` also reports an **external** edge Rip did not start — Rip
will not stop or reload a process it does not own.

### 2. Remember and start a demo site

```bash
rip sites add packages/sites/demos/hello --name hello --host hello.via.rip
rip sites start hello
rip sites open hello          # https://hello.via.rip/
rip sites list
# ● hello  running  https://hello.via.rip/
```

Packaged demos (hello → pulse → cart): [`demos/`](demos/README.md).

Pass `--host` when you want a stable URL in the catalog (needed for
`rip sites open` while stopped). Projects with `serve.rip` hosts still run
without it; the Agent stores hosts from `--host` / add options.

### 3. Stop cleanly

Stop sites **before** the edge — the edge refuses to die under a live manager:

```bash
rip sites stop hello
rip sites stop edge
```

```text
rip sites stop edge
# rip-sites: stop hello before stopping the edge   ← intentional
```

### Install into an app

```coffee
import { get, post, read, error, prefix, start } from 'rip/sites'

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

Then either use the catalog path (`rip sites add` / `start`) or a foreground
manager (`rip sites run`).

## Commands at a glance

One user CLI: **`rip sites <verb> [noun]`**. There is no `rip site` or `rip edge`.

**Grammar**

- Most spells are `<verb> <noun>`.
- Reserved nouns (never app names): **`edge`**, **`all`**, **`tray`**, **`agent`**.
- App selectors: catalog **id**, unique **name**, or canonical **root**.
- Path forms (`run`, `publish`, bare `stop`, path `status`) default to the
  **current directory** when the path is omitted.
- Durable catalog: `sites.json` (Rip-owned). Control starts with the edge /
  desired apps and exits when nothing remains to supervise.

### Catalog — remember projects

| Command | What it does |
| --- | --- |
| `rip sites list` | List remembered apps (file I/O when control is down; live probe when up). |
| `rip sites add [project]` | Remember a project (default: cwd). Options: `--name`, `--host` (repeatable), `--workers`, `--concurrency`, `--no-watch` / `--no-watch-app` / `--no-watch-api`, `--eager`. |
| `rip sites remove <app>` | Forget a stopped app (refuses if desired-running or a live manager is still up). |

### Lifecycle — start, stop, restart, status

| Command | What it does |
| --- | --- |
| `rip sites start <app\|all\|edge\|tray>` | Start a supervised app, every app, the shared edge, or the menubar tray. Apps need a reachable Janus control plane (normally: start the edge first). |
| `rip sites stop [noun]` | Stop a supervised app, `all`, `edge`, or `tray`. **Bare `stop`** stops the manager at cwd. A filesystem path stops that project’s manager without requiring catalog membership. |
| `rip sites restart <app\|all\|edge\|tray>` | Restart. For `edge` / `tray` this is a full recreate (stop then start), not a config reload. |
| `rip sites status` | Edge + apps summary (JSON: `{ edge, apps }`). |
| `rip sites status all` | Apps only. |
| `rip sites status <app\|edge\|tray>` | One target. |
| `rip sites status <path>` | Manager JSON for a project path (`.` or an existing directory not in the catalog). |

### Edge — TLS, Janus, reachability

| Command | What it does |
| --- | --- |
| `rip sites start edge` | Bring up Rip-owned Caddy+Janus (default loopback posture). Options: `--caddy`, `--config`, `--control`, `--base-url`, `--http-port`, `--https-port`. |
| `rip sites stop edge` | Stop a Rip-owned edge (refuses if sites are still running; never stops an external edge). |
| `rip sites reload edge` | Reload the Rip-owned Caddyfile without tearing down sockets. |
| `rip sites trust edge` | Install the local CA (required before LAN posture). |
| `rip sites trust edge --export [PATH]` | Write the CA PEM (default: `rip-edge-local-ca.crt`). |
| `rip sites expose local` | LAN / Bonjour posture (all interfaces, `rip.local` / `{app}.local`, `tls internal`). Recreates the edge — stop sites first. |
| `rip sites expose loopback` | Back to default loopback `*.via.rip` posture (same recreate rule). |
| `rip sites expose public` | Public internet posture — **refuses until phase 2**. |

External Janus (something else already listening on the control socket) shows as
`status edge` → running, unmanaged; Rip will not stop or reload it.

### Daily — open and logs

| Command | What it does |
| --- | --- |
| `rip sites open <app>` | Open the app URL in the default browser. |
| `rip sites open edge` | Open the status dashboard (`via.rip` or `rip.local`). |
| `rip sites logs <app> [--lines N] [-f]` | Print (or follow) a supervised app’s manager log. |
| `rip sites logs all [--lines N]` | Tail every remembered app’s log once. |
| `rip sites logs edge` | Print paths to the edge and control log files. |

### Manager — foreground, publish, deploy barriers

Supervised apps use the catalog lifecycle above. These forms are for foreground
work and explicit deploy ops (the manager module is internal — not a second CLI).

| Command | What it does |
| --- | --- |
| `rip sites run [project] …` | Foreground manager for a project (default: cwd). Blocks until Ctrl-C. Needs `--control` / `JANUS_CONTROL` (or an edge already up so control can be seeded). Flags: `--name`, `--host`, `--workers`, `--watch` / `--no-watch`, … |
| `rip sites publish [dir] …` | Publish one directory through Janus (default: cwd). Options include `--host`, `--control`, `--until-restart`. |
| `rip sites hold <app>` | Hold a remembered app’s manager (freeze App/API activation). |
| `rip sites release <app>` | Release hold — one coherent snapshot, then clear hold. |
| `rip sites migrate <app> [entry] [--dir DIR] [--id 32hex]` | Coordinated DB migrate for a remembered app (cwd = that app’s root). |
| `rip sites recover <app> <operation-id>` | Fix-forward recovery after a failed migrate activation. |

```bash
cd packages/sites/demos/hello
rip sites start edge
rip sites run --control "$(rip sites status edge --json | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).control)')"
# …or with the edge already up and JANUS_CONTROL set:
rip sites stop              # drain manager for cwd
rip sites status .          # manager JSON for cwd
```

### Tray — menubar host

| Command | What it does |
| --- | --- |
| `rip sites start tray` | Install/start the LaunchAgent that keeps the Sites menu alive. |
| `rip sites status tray` | Report whether the tray host is running. |
| `rip sites stop tray` | Stop the tray LaunchAgent. |

The menu drives the same `rip sites` spells. There is **no** Sites-specific
native binary — see [`tray-sites.rip`](tray-sites.rip) and
[packages/tray/README.md](../tray/README.md).

**Tray covers:** edge start/stop/reload, Open Dashboard, Trust CA, Use Local /
Use Default (`expose`), site start/stop/restart/open/log, Add Site.

**CLI-only for now:** `remove`, `trust edge --export`, `expose public`, port
overrides, custom `--config` / `--caddy`.

**Foreground (dev)** — build the host once, then from this package:

```bash
# from repo root
swift build -c release --package-path packages/tray/macos --product rip-tray-host

cd packages/sites
rip tray                  # discovers tray-sites.rip → launches rip-tray-host
```

Plist under `~/Library/LaunchAgents`; logs under `~/Library/Logs`.

**Using the menu**

1. **Edge → Start** if the shared edge is down
2. **Edge → Open Dashboard** for the Rip status page (`via.rip` or `rip.local`)
3. **Edge → Trust CA…** then **Use Local (LAN)…** when you want Bonjour (stop sites first)
4. **Add Site…** and pick a project directory
5. Site submenu → **Start** → **Open**
6. **Open Log** / **Restart** / **Stop** as needed

Provider alone (what the host spawns), without the menubar chrome:

```bash
rip packages/sites/tray-sites.rip
```

Output: add `--json` on most verbs for machine-readable responses.

## Typical sessions

**Happy path (catalog)**

```bash
rip sites start edge
rip sites add packages/sites/demos/pulse --name pulse --host pulse.via.rip
rip sites start pulse
rip sites open pulse
# …develop…
rip sites stop pulse
rip sites stop edge
```

**Several sites, one edge**

```bash
rip sites start edge
rip sites start hello
rip sites start pulse
rip sites start cart
# https://hello.via.rip/  https://pulse.via.rip/  https://cart.via.rip/
rip sites stop hello && rip sites stop pulse && rip sites stop cart
rip sites stop edge
```

**Tear down order**

```text
sites (running)  →  stop each
edge (Rip-owned) →  rip sites stop edge
tray LaunchAgent →  rip sites stop tray   (optional; independent of edge)
```

Control stays until idle/exit; you rarely need to kill it.
Stale state after renames or moved checkouts lives in
`~/Library/Application Support/Rip/` — remove obsolete sites with
`rip sites remove`, or clear that directory only when you intend a hard reset.

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
    ├── @rip/rip.min.js
    ├── @rip/rip.min.js.br
    ├── @rip/tailwind.min.js
    ├── @rip/tailwind.min.js.br
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
  using the shared `rip/validate` vocabulary.
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

Named validators come from `rip/validate` and are re-exported by this
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

`@cache` emits standard response headers for browsers and intermediary caches.

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
import { use, session } from 'rip/sites'
import {
  cors, csrf, htmlJson, secureHeaders, sessions, timeout
} from 'rip/sites/middleware'

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
- The browser runtime at `/@rip/rip.min.js`, including compiled `rip/app`
- Hub WebSockets

Workers serve API routes only. The manager writes files and publishes control
state but is never on the client data path.

The complete `rip/app` package is part of the versioned browser runtime,
not an App publication. `bundle.json` carries authored modules and any imported
non-core browser packages; it never duplicates App framework source. Authored
imports from `rip/app` resolve to the copy already active in
`/@rip/rip.min.js`.

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
A `reload` is also published when the regenerated browser runtime ship set
changes, not only on server-generation replacement.

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
paths such as `rip/http/index.rip`. Paths have no leading slash, query,
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
    ["rip/http/index.rip", "export class HTTPError ..."],
    ["data.rip", "export data = ..."],
    ["routes/index.rip", "export Index = component ..."]
  ]
}
```

The rules are:

- `hash` is the resulting complete App hash.
- `list` contains exactly `[modulePath, RipSource]` pairs.
- The list is sorted by module path and contains every browser Rip module once.
- `rip/app` is absent because `/@rip/rip.min.js` embeds it.
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
list. An unchanged watcher batch emits no message. A batch that changes the
browser runtime ship set delivers `reload` instead of `change`. WSS never
carries the complete `bundle.json`, ordinary asset bytes, or `latest.json`.

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

The complete browser surface still belongs to Rip App and ships in
`/@rip/rip.min.js`.
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
  access:
    log: 'pretty'
    format: '{local_time} {status} {method} {path}'
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
      { path: 'app', cache: 'revalidate' }
    ]
    proxyFirst: ['/api']
    shell: 'app/index.html'
```

Exact-host servers use `hosts` instead of `sites`. `hosts` and `sites` are
mutually exclusive.

`access.log` is `pretty` (default when omitted), `raw`, or `off`. `access.format`
is the pretty picture (same grammar as `--access-format`); it is only legal with
pretty logging. CLI `--access-log` / `--access-format` override `serve.rip` when
passed. You can edit `access.format` while the site is running; restart the
manager (`rip sites restart <app>`, or stop/start a foreground `rip sites run`) to
pick up the new picture — the access stream does not hot-reload `serve.rip`.

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
rip sites hold <app>
rip sites release <app>
rip sites migrate <app> [migration-entry] --dir migrations
rip sites recover <app> <operation-id>
rip sites status .          # manager JSON for cwd / path
rip sites stop              # drain manager for cwd / path
```

`status <path>` prints the manager's machine-readable JSON state. `stop` (bare
or with a path) asks that manager to drain its workers, deregister from Janus,
remove its local control artifacts, and exit cleanly.

`release` prepares one coherent API/App snapshot, exposes it, sends one
full-reload notification, and then clears hold.

## Per-User Catalog and Edge Internals

Day-to-day commands live under [Commands at a glance](#commands-at-a-glance).
This section is the ownership contract behind them.

Rip owns the durable catalog at `sites.json`
(`~/Library/Application Support/Rip/sites.json` on macOS; a one-time rename
from `agent.json` still applies). Catalog reads and writes (`list` / `add` /
`remove`) do not require a live control plane. A small control process starts
when the edge or a desired-running app needs supervision, adopts healthy
managers after a restart, and exits when the edge is stopped and no app
remains desired-running. Janus never writes the catalog.

`rip sites start edge` finds Caddy through `--caddy`, the remembered configuration,
`JANUS_CADDY`, the packaged `bin/janus`, or `PATH`, in that order, and
verifies that the binary contains Janus before starting it. `--config` selects
another Caddyfile; the packaged baseline beside this README is the default. An
external reachable edge is observable but never silently adopted as a
Rip-owned process.

On macOS, the packaged baselines remain both unprivileged and (in default
mode) loopback-only on standard HTTP and HTTPS. The control plane registers
per-user `launchd` sockets for `127.0.0.1:80` and `127.0.0.1:443` (or the
configured ports; `local` mode omits the loopback node name so launchd binds
all interfaces). The launchd listener activates both sockets and passes them
as `fd/3` (HTTP) and `fd/4` (HTTPS) to an ordinary user-owned Caddy process,
which serves HTTP/1.1 and HTTP/2 directly from the inherited TCP sockets. The
packaged Caddyfiles explicitly select `h1 h2` because HTTP/3 is QUIC over UDP
and cannot use stream descriptors. Adding HTTP/3 to this launch path requires
separately inherited loopback UDP sockets on the HTTPS port and Caddy
integration that assigns them to QUIC; enabling the protocol without that
datagram listener makes Caddy reject startup. Default posture has no Bonjour
and no side-door status port. Stop removes the launchd job and releases the
ports. A running edge survives a control-plane restart, and desired
`running` edge state reconciles after login when the control plane comes
back. Mode flips (`rip sites expose local` / `expose loopback`) stop and recreate
rather than reload, because the socket bind and Caddyfile change. An
explicitly selected Caddyfile runs directly as a Rip-owned child and retains
its own listener choices.

Migration is explicit. It never runs because the server started, a file
changed, or a worker booted. Coordinated migration enters Maintenance, drains
workers, runs the database-only child, records a durable outcome, and either
returns safely to Held or activates the candidate. Once the database may have
changed, activation failure stays in Maintenance for fix-forward recovery.

## Manager flags

Day-to-day spells are under [Commands at a glance](#commands-at-a-glance). Foreground `run` / `publish` accept:

```bash
rip sites run [project] [options]
rip sites publish [directory] [--host <host>] [--control <target>]
rip sites publish [directory] [--host <host>] [--until-restart]
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

`rip sites publish` resolves and publishes exactly the
named directory as one
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

```bash
rip sites logs hello
rip sites logs hello --follow
```

That reads the manager log
(`~/Library/Application Support/Rip/apps/<id>.log`). Agent-managed sites use
`--access-log=pretty` by default (or `serve.rip` `access.log` / `access.format`
when set). The packaged edge Caddyfile must include `log { format janus }` on
the site block — without that encoder Janus publishes nothing and the log stays
URL-only.

Caddy/Janus process diagnostics (TLS, Hub, dial failures) go to:

```bash
tail -f ~/Library/Application\ Support/Rip/edge.log
```

The foreground manager also subscribes to the registration's live access
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
`response_class`, `selected_upstream`, `retry_count`,
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

`test:janus` resolves an already-built Janus Caddy binary — `JANUS_CADDY`
first, then the packaged `bin/janus`, then `caddy` on `PATH`, erroring
if none exists — and asserts a non-replaced released Janus module. `bun run
test` discovers and runs every `test/*/test.rip` fixture.

Repository-wide certification additionally runs:

```bash
bun run test:all
bun run test:browser
```

The first command covers the compiler and generated browser bundle; Playwright
certifies the real browser App and Workspace path across Chromium, Firefox,
and WebKit.
