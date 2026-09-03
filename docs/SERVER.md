# Rip Sites

Rip Sites publishes browser applications and runs API workers behind one
Caddy + Janus edge. The durable boundary is producer versus consumer:

```text
source files
    │
    ▼
Rip Manager ── publishes application files ──► Caddy / Janus ──► Rip App
    │                                              │
    └── supervises API workers ────────────────────┘
```

- **Rip Manager publishes applications.** It observes source, constructs and
  validates browser publications, commits them, announces confirmed changes,
  builds API generations, and supervises workers.
- **Caddy and Janus provide infrastructure.** Caddy owns TLS and HTTP. Janus
  owns registration, static files, API proxying, Hub transport (Bam: WSS at the
  edge, optional HTTP bridge to workers, control-plane publish), cache
  validators, and access streams. Neither interprets Rip source or Rip hashes.
- **Workers execute API code.** They do not compile browser Apps or serve App
  files.
- **Rip App consumes browser publications.** Its browser runtime fetches,
  compiles, activates, and updates the published Rip program.
- **The compiler is shared infrastructure.** Manager uses it to validate and
  traverse browser source; Rip App uses it to compile that source locally.

## Project shape

```text
project/
├── index.rip                  optional API entry
├── serve.rip                 optional App-local server declaration
├── app/                      browser App source and ordinary assets
│   ├── index.html
│   ├── routes/index.rip
│   ├── styles.css
│   ├── images/
│   └── fonts/
└── dist/                     Manager-owned publication output
    ├── @rip/rip.min.js       browser compiler and Rip App runtime
    ├── @rip/rip.min.js.br    Brotli sidecar (transparent via Accept-Encoding)
    ├── @rip/tailwind.min.js  optional Tailwind browser runtime
    ├── @rip/tailwind.min.js.br
    ├── bundle.json           complete browser Rip program
    ├── bundle.json.br        Brotli representation of the exact JSON bytes
    └── latest.json           current complete App hash
```

`app/` is the watched input root. `dist/` is outside that root, so generated
publication files cannot create watcher feedback.

Janus searches registered file roots without exposing their disk names.
`app/styles.css` is requested as `/styles.css`; `dist/bundle.json` is requested
as `/bundle.json`. The project root, API source, databases, configuration, and
private files are not public unless a file root explicitly exposes them.

## Browser publication

`bundle.json` has exactly two keys:

```json
{
  "hash": "APP123",
  "list": [
    ["rip/http/index.rip", "export class HTTPError ..."],
    ["seed.rip", "export seed = ..."],
    ["routes/index.rip", "export Index = component ..."]
  ]
}
```

`list` is the complete browser Rip program, sorted by canonical module path.
It contains:

- authored browser `.rip` modules;
- browser-safe package `.rip` modules;
- generated browser schema projections; and
- `seed.rip`, when the App defines it.

It does not contain CSS, HTML, images, fonts, videos, API implementation,
server-only packages, or `rip/app`. The complete App package is already
embedded in `/@rip/rip.min.js`.

Browser package roots normalize to `rip/<name>/index.rip`. Package
manifests are Manager inputs used for browser-safety validation and import
resolution; resolver metadata does not cross the wire. The published graph
uses static imports only. Missing targets, import cycles, and dynamic imports
reject before any publication is committed.

The one HTTP response gives Rip its startup optimization: many small source
modules share one request and one Brotli compression context. After parsing
and compiling the list, Rip App can release the source envelope. Ordinary
assets continue through the browser's normal HTTP cache.

## Hash authority

Manager privately retains a hash for each managed file:

```text
path → rash(exact bytes)
```

Those private hashes:

1. suppress idempotent filesystem events; and
2. produce the complete App hash from the canonical sorted
   `[[path, fileHash], ...]` identity list.

Individual file hashes never cross the publication protocol. The browser
remembers only the top-level App hash and never recalculates a Manager hash.
The value is a synchronization identity, not a browser integrity proof.

Janus's weak `W/"mtime-size"` ETag remains an independent HTTP transport
validator. Janus does not calculate or compare Rip hashes.

## Initial publication

Watch and non-watch modes use the same initial path:

```text
read and privately hash managed App files
→ construct and validate the browser Rip graph
→ calculate the complete App hash
→ serialize bundle.json
→ Brotli-compress those exact bytes
→ publish bundle.json and bundle.json.br
→ publish latest.json
→ register files and API upstreams with Janus
```

`latest.json` is deliberately tiny:

```json
{"hash":"APP123"}
```

Manager uses a correctness-first two-file commit:

```text
write hidden temporary JSON
write hidden temporary Brotli from those exact bytes
remove the old bundle.json.br
atomically rename temporary JSON → bundle.json
rename temporary Brotli → bundle.json.br
atomically replace latest.json
```

Removing the old sidecar first creates a brief uncompressed fallback window
but prevents new JSON from ever pairing with old compressed bytes. The JSON
rename is the canonical commit point. `latest.json` never leads it.

Released Janus (≥ v1.6.0) selects precompressed sidecars transparently:
the client requests `/bundle.json`; with `Accept-Encoding: br` and a same-root
`bundle.json.br`, Janus serves the sidecar bytes with `Content-Encoding: br`
and `Vary: Accept-Encoding`. Sites' packaged Caddyfile enables
`files { precompressed }` (default order `br`, `zstd`, `gzip`). Clients must
not request `/bundle.json.br` by name. Open work is Sites certification of
that path through the released binary, not missing Janus transport.

## Watch mode

Bun's recursive watcher wakes reconciliation; it never selects what gets
re-read. Events are invalidations, not mutations — filesystem contents are
truth, and the published hashes describe exactly what the browser was sent:

```text
watcher event (filename = relevance hint only)
→ 50ms trailing delay, capped at 250ms after the burst's first event
→ snapshot the whole App tree, hash every managed file
→ compare with the published hashes
→ identical: stop
→ different: construct one publication transition
→ re-snapshot; disk still differs → reconcile again (fixpoint)
```

The event's filename decides only whether to wake at all — hidden paths and
unmanaged suffixes are ignored. Reconciliation always re-reads the complete
managed tree, so a lost or misattributed notification can never strand one
file; and because publication repeats until disk and publication agree, a
write racing the read is caught by the next round. The delay is trailing so
a save-burst publishes once, but capped so sustained rapid writes cannot
postpone publication past 250ms. A slow sweep (default 2s,
`RIP_APP_SWEEP_MS`) runs the same disk comparison with no event at all —
covering the App tree, every assembled input (package sources outside the
App root) against hashes of the bytes the assembly actually consumed, and
package-root membership (a `.rip` file added or removed after enumeration
changes assembly output without touching any recorded per-file hash) —
and retries work left owed by a failed publication or a quarantined
assembly. That is the recovery path for total notification loss, which
every OS watcher admits (FSEvents drops and rescan flags, inotify queue
overflow). Normally the sweep is a snapshot-compare no-op.

The default `serve.rip` change policy is:

```coffee
app:
  root: 'app'
  changes:
    update: ['**/*.rip']
    css: ['**/*.css']
    reload: ['**/*']
```

`update` owns `.rip`; `css` owns `.css`; those suffixes do not fall through to
`reload` when excluded from their own category. `reload` covers every other
non-hidden App file by default. Explicit empty arrays disable a category.

One real watcher batch produces one message:

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

- `[path, source]` creates or replaces a Rip module.
- `[path]` invalidates an ordinary HTTP asset.
- `[path, null]` deletes any file.

Changed Rip source rides in the message because it is small and immediately
compilation-critical. Ordinary asset bytes never use WSS. CSS refreshes its
linked HTTP URL. HTML and unknown managed assets reload the page.

`from` must equal the browser's current hash. A duplicate whose `hash` is
already current is harmless. A gap, malformed transition, or ordering
uncertainty reloads the page rather than attempting delta reconstruction. A
compile or activation failure quarantines the candidate hash and leaves the
last committed App live. The browser ignores that same rejected generation;
the first newer hash reloads and obtains a complete bundle.

On reconnect, the browser subscribes before requesting `/latest.json`. Equal
active hashes require no work. A latest hash equal to the quarantined candidate
keeps the last committed App live; any other unequal hash reloads the page.
Initial HTTP boot does not require the Hub.

## Non-watch mode

App and API watching are independent. `--no-watch` disables both;
`--no-watch-app` / `--no-watch-api` disable one side. With App watching off,
Manager still constructs and publishes the same `bundle.json`,
`bundle.json.br`, and `latest.json`, creates no App watcher, and announces no
publication changes. With API watching off, Manager serves the admitted worker
pool and does not prepare replacement generations from source edits. A Hub used
for chat, presence, CRDTs, or collaboration does not implicitly enable file
publication.

## API generations and workers

API source follows validate-before-cut:

```text
source change
→ generation child builds one loader-free JavaScript artifact
→ candidate inputs are validated
→ fresh worker pool boots from the artifact
→ ready sockets replace old upstreams atomically
→ old workers drain admitted requests
```

Manager never imports API artifacts. Compilation memory dies with the
generation child. Workers import the same artifact, expose readiness, serve
requests, and drain on shutdown. A failed candidate leaves the admitted pool
unchanged.

Workers return ordinary Web `Response` objects. `X-Sendfile` authorizes a
specific local file; Janus opens and serves it with ranges, MIME type, cache
policy, and validators. Workers do not expose arbitrary project paths.

## Operational barriers

- `hold` freezes App publication and API replacement while admitted workers
  continue serving.
- `release` validates App and API candidates before replacing either live
  state, then emits a client reload message.
- `migrate` journals a coordinated database operation, cuts admission only at
  the required boundary, and activates the prepared API/App state.
- `recover` resumes a journaled migration by operation id.

Manager runtime sockets and operation journals are private to the current
POSIX user. A conflicting Manager, unsafe permissions, invalid configuration,
unknown package, browser import of server-only code, or malformed publication
rejects loudly before registration or activation.

## Edge ownership

The packaged macOS edge uses two launchd-owned loopback TCP sockets —
HTTP on `127.0.0.1:80` and HTTPS on `127.0.0.1:443` — inherited by
user-owned Caddy as `fd/3` and `fd/4`. The inherited streams serve
HTTP/1.1 and HTTP/2. HTTP/3 is disabled on those listeners because QUIC
requires a separately inherited UDP socket.

Caddy owns TLS and dispatches requests into Janus. Janus owns dynamic App
registration, root search, API proxying, Hub transport, access streams, and
weak file ETags. Rip Manager communicates with Janus through its private
control socket.

## Open leftovers

Architecture above is the shipped contract. Package-local open work
(logging, `public` posture, compression/security-header pins, Manager
defaults, distribution, Cart cleanups) lives in
[packages/sites/TODO.md](../packages/sites/TODO.md). Janus precompressed
sidecar selection is implemented; pin delivery of `bundle.json` under
`Accept-Encoding: br` in the Sites suite if that path is not already
covered.

## Verification

```bash
cd packages/sites
bun run test
```

The package suite covers publication, watcher no-op filtering, JSON/Brotli
identity, watch-off behavior, real released Janus file serving, App-only
projects, API generation, worker replacement, hold/release, migration,
middleware, access streaming, and the macOS edge.

Repository-wide certification is:

```bash
bun run test:all
```
