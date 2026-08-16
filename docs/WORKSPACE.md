# Rip Workspace

The Workspace is Rip App's browser-side view of a published application. It
holds the active Rip module program, remembers one complete App hash, and
provides the mutation boundary used by live development and HMR.

**Status:** the publication and reconnect contract below is shipped and
CI-certified (Sites Manager + Rip App browser boot +
`bun run test:browser`). Framework refresh on top of this wire is
[HMR.md](HMR.md) (product Cart bars done). Open edge/browser leftovers
live in [ROADMAP.md](ROADMAP.md) and
[packages/sites/TODO.md](../packages/sites/TODO.md) — not as missing
Workspace milestones.

The durable architecture is producer versus consumer:

```text
Rip Manager publishes an application
            │
            ├── HTTP: bundle.json / latest.json / ordinary assets
            └── WSS:  ordered change notifications in watch mode
                                      │
                                      ▼
                         Rip App consumes the publication
                                      │
                                      ▼
                                  Workspace
```

Janus transports HTTP and Hub messages without interpreting Rip source,
module graphs, or hashes. The browser does not watch disk, build a
publication, or calculate Manager hashes.

## Publication contract

The initial publication is `/bundle.json`:

```json
{
  "hash": "APP123",
  "list": [
    ["rip/http/index.rip", "export class HTTPError ..."],
    ["routes/index.rip", "export Index = component ..."]
  ]
}
```

`hash` identifies the complete managed App state. `list` is the complete
browser Rip program as canonical `[modulePath, source]` pairs. It includes
authored browser Rip modules, browser-safe package source, generated browser
schema projections, and `data.rip` when present. `rip/app` is already
embedded in `/@rip/rip.min.js` and is absent from the list.

CSS, HTML, images, fonts, videos, and other ordinary assets are absent from
the source list. They remain normal HTTP resources and use the browser's HTTP
cache. Their private Manager hashes still contribute to the complete App hash
when the change policy manages them.

There is no `manifest.json`, public per-file hash list, or browser hash
verification step.

## Membership and content

The Workspace holds the active Rip module membership, source, compiled result,
and one complete App hash. Source remains available for coherent restaging of
a later module change. The fetched JSON envelope itself is released after
activation, and ordinary asset bytes remain owned only by the HTTP cache.

An internal module record may temporarily carry source while compilation is
in progress:

```text
module path → active Rip source + active compiled module
App          → one Manager-declared complete hash
```

The App-facing launch/runtime layer receives prepared compiled state. It does
not parse bundle syntax, open WebSockets, fetch HTTP resources, resolve
package manifests, or know how the publication was constructed.

## Initial activation

Browser boot follows one path in watch and non-watch modes:

```text
fetch /bundle.json
→ validate its two-key structure
→ stage every Rip module source
→ resolve and compile the complete program
→ activate it atomically
→ remember bundle.hash
→ release the fetched JSON envelope
```

Failure before initial activation leaves no partially active App. A live Rip
compile or activation failure quarantines its candidate hash and leaves the
last committed App running. A malformed or disconnected transition reloads
when coherence cannot be proven.

`bundle.json.br` is a server-side precompressed representation of the exact
JSON bytes. The browser requests `/bundle.json`; transparent HTTP content
negotiation selects Brotli when the edge supports it.

## Live changes

File publication changes exist only when Server watch mode is enabled. One
confirmed Manager transition produces one ordered message:

```json
{
  "change": {
    "from": "APP123",
    "hash": "APP124",
    "list": [
      ["routes/index.rip", "updated Rip source"],
      ["styles.css"],
      ["images/old.png", null]
    ]
  }
}
```

The tuple forms are:

| Form | Meaning |
|---|---|
| `[path, source]` | create or replace a Rip module |
| `[path]` | ordinary HTTP asset changed |
| `[path, null]` | file was deleted |

Changed Rip source rides in WSS during watch mode because it is small,
textual, and immediately compilation-critical. Ordinary asset bytes never
ride in the publication channel.

The transition applies only when `change.from` equals the Workspace's current
App hash. The Workspace stages the complete list, applies one coherent
transaction, then records `change.hash`. A duplicate whose final hash is
already active is harmless. A gap, malformed transition, or uncertain ordering
reloads the page instead of guessing at missing state.

A failed Rip compilation or activation records the candidate hash as rejected
without committing it. The active App continues running, duplicate delivery of
that rejected hash is ignored, and reconnect confirmation of the same hash
waits without fetching the same bad bundle. A newer live generation after
quarantine applies in place: when `change.from` is the rejected hash, the
browser rebases the delta onto the living last-known-good App. Reconnect that
observes a still-newer `latest.json` (a missed recovery while disconnected)
reloads and obtains a complete publication.

A validated transition that requires whole-App reconstruction is different
from a failed candidate. A stash change or deletion of the mounted route or
layout requests a document reload and activates the complete bundle through
normal HTTP.

The path determines the basic apply verdict:

| Managed path | Verdict |
|---|---|
| `*.rip` | compile and update |
| `*.css` | refresh the linked stylesheet through HTTP |
| HTML or another managed asset | reload |

Framework-aware HMR can refine the Rip `update` verdict without changing the
publication protocol. See [HMR.md](HMR.md).

Browser boot activates the publication feed explicitly with `watch: true`.
Manager's generated shell supplies that option from the active Server mode;
an authored shell owns the same choice. Merely having an application Hub does
not activate file publication.

## Reconnect

Reconnect recovery does not replay an unbounded change history:

```text
subscribe to /hub
→ GET /latest.json
→ latest.hash equals active hash: continue
→ latest.hash differs: reload and obtain the complete bundle
```

Subscribing first closes the normal check-then-listen race: a publication
committed during the probe is either reflected by `latest.json` or arrives as
a live transition. If ordering remains ambiguous, reload is the honest
fallback.

The probe begins only after the exact outstanding Janus acknowledgement.
Client-origin Hub frames carry sender provenance and cannot acknowledge a
subscription or enter the publication stream.

`latest.json` is a cache-revalidated probe containing only the latest complete
App hash. It is not a manifest and carries no source or file inventory.

## Watch policy

Rip Manager watches the complete App root and applies the strict `serve.rip`
policy before accepting a candidate path:

```coffee
app:
  root: 'app'
  changes:
    update: ['**/*.rip']
    css: ['**/*.css']
    reload: ['**/*']
```

These are the defaults. Hidden paths are excluded. Explicit arrays replace a
default; `[]` disables that category. `.rip` and `.css` files belong to their
specific categories and do not fall through to `reload` when excluded.

Watcher events are invalidations, not mutations: the event's filename decides
only whether to wake reconciliation at all — hidden paths and unmanaged
suffixes are ignored. Reconciliation re-reads and privately hashes the
complete managed tree, so identical bytes stop before publication and a lost
or misattributed notification can never strand one file.

## Watch-off and production

App watch-off publishes the same initial bundle and latest probe, creates no
App watcher, and announces no file changes. API watch-off leaves admitted
workers in place and does not prepare replacement generations from source
edits. An application may still use the same Hub for chat, presence, CRDTs,
collaborative editing, or other realtime features. Those messages are
application data and do not enable publication watching.

Production content uses HTTP. Production does not require source deltas over
WSS, a service worker, OPFS, or RipFS. Those storage mechanisms may be added as
optional optimizations without becoming publication authority.

## Ownership

| Responsibility | Owner |
|---|---|
| observe, validate, construct, hash, commit, announce | Rip Manager |
| TLS, HTTP files, cache validators, range requests | Caddy / Janus |
| reliable Hub message transport | Janus |
| fetch, compile, activate, reconnect, apply verdicts | Rip App browser boot |
| active module state and mutation boundary | Workspace |
| application launch/render behavior from prepared state | Rip App core |
| compilation implementation | shared compiler infrastructure |

The ownership test is simple: Rip Sites publishes applications; Caddy serves
published files; Janus announces published changes; Rip App consumes published
applications.

## Acceptance contract

The complete implementation is pinned by tests for:

1. initial boot from the two-key bundle with no manifest;
2. one declared App hash remembered without browser recalculation;
3. canonical module resolution including browser-safe package source;
4. idempotent saves producing no publication;
5. ordered Rip, CSS, HTML, create, delete, and rename changes;
6. no ordinary asset bytes over WSS;
7. last-known-good behavior after compile or activation failure;
8. duplicate, missing, racing, and reconnect transitions;
9. watch-off boot with no file-publication channel requirement; and
10. real-browser Chromium, Firefox, and WebKit coverage.

The Server/Manager half and browser half are separate test boundaries. The
wire contract has one format; there is no compatibility adapter or dual
protocol between them.
