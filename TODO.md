# TODO — open design / correctness notes

Scratchpad for decisions and footguns we must not lose. Not a roadmap;
permanent product docs live under `docs/`. Strike items when fixed or
moved into real docs/tests.

---

## Rip Server concurrency (`c:N`) and hot reload

**Context:** Janus-era Rip Server will keep Unicorn-shaped workers
(process + unix socket). Capacity = `w × c` (worker processes ×
per-worker concurrent requests). v3 default is `c:1`.

### Recommendation (locked for now)

- Default **`c:1`**, especially with file watch / hot reload.
- Higher `c` (e.g. `c:10` / `c:20`) is an opt-in for I/O-bound apps
  when hot reload is off (or when longer drains are acceptable).
- **`c:1` is the recommended pairing** with watch mode (simple drains,
  Sinatra mental model).

### What `c` does and does not change

| Concern | `c:1` | `c:10` / `c:20` |
| --- | --- | --- |
| Process isolation | Crash kills **1** in-flight request in that worker | Crash kills **up to N** in-flight in that worker; **other workers still fine** |
| In-process interference | No concurrent handlers in that process | Event-loop interleaving; safe if state is ALS/`@` context; **unsafe** if app uses module-level per-request vars |
| Hot reload drain | At most **1** in-flight to finish when retiring a worker | Up to **N** in-flight must finish before that process can exit |
| Throughput | High enough with enough `w` (v3 saw ~20k RPS at `c:1`) | Higher mainly for **I/O-bound** handlers; little win for pure CPU |

**Important:** Isolation is **per process**, not per `c`. Raising `c`
does not make one worker’s crash take down the pool — it only enlarges
the blast radius *inside* the crashing worker.

### Hot reload — never serve known-stale code (LOCKED)

A file update can rename tables, change config, break contracts, etc.
**Knowingly routing *new* requests to workers that loaded old code is
asking for corruption.** Prefer a short unroutable window while a new
generation boots over serving stale. If you do not want that pause,
**do not edit files in that environment** (and/or turn hot reload off).

**Invariant (admission):** once Rip knows the app is dirty → Janus must
**not** admit *new* traffic to that gen until a **newer** gen’s socks
are published. Completing an already-accepted in-flight on the old gen
is allowed (finishing a commitment); admitting a *new* request to it
is not.

Rejected: keep old socks selectable for new traffic across saves
(zero-downtime stale window).

Adversarial review (2026-07) tightened the protocol below — PREPARE-as-
Janus-RPC was cut (edge stays generic), and “relaunch on every save”
was cut in favor of note-dirty + relaunch-on-demand via the doorbell.

#### Control plane: empty upstreams, not a Janus PREPARE verb

Janus stays a generic edge: hosts, `upstreams[]`, heartbeat, LB /
`max_conn`, health. **No** READY enum, **no** Janus→Rip `PREPARE` RPC.

| Signal | Meaning |
| --- | --- |
| `upstreams = [socks…]` | Routable (ready) |
| `upstreams = []` | Not routable (down on purpose / failed) |
| Heartbeat from Rip supervisor | App **registered / alive** — independent of worker socks |

**No generation fencing on the wire.** Rip is the single writer of its
upstream list and awaits each PUT's 200 before the next control
message — sequential awaited writes cannot reorder, so the registry
always holds the last write in intended order. "Files changed again
mid-boot → scrap, don't publish" is Rip's **private** dirty flag,
checked before the socks PUT — never a protocol field.

**Data plane while `[]`:** fail-fast **503** (+ `Retry-After` if useful).
Do **not** hold application requests open across a Rip boot (goroutine /
memory cliff under load). Optional later: generic “wait ≤ T for any
healthy upstream” — still not a prepare RPC.

**Heartbeat vs reload:** clearing upstreams must **not** look like
“app dead” for cert allow / hub / registry TTL. Supervisor heartbeats
continue through reload; only missing supervisor heartbeat expires the
app. Per-app state only — one dirty app must not tear down another.

#### Rip control loop (watch on) — saves note dirty; demand relaunches

A save must NOT relaunch workers. It only notes dirtiness; the pool
relaunches on **demand** via the **doorbell**: a Rip-owned socket
published as the app's only upstream while dirty (flagged
`doorbell: true` in the PUT). The client's request is NEVER forwarded
to the doorbell — Janus **rings** it with its own tiny synthetic
request, waits for ready, then proxies the untouched original request
to the fresh pool. No buffering, no replay, no redirect anywhere.

```text
fs events → settle (trailing ~100–150ms) → content-hash gate
         → if bytes unchanged: no-op
         → else dirty epoch:

  first dirty since last publish:
    Rip → Janus: PUT upstreams [{doorbell, doorbell: true}]
                                                    ← admission cut
    OLD: no new checkout; short drain grace → kill → unlink
  further saves: note locally (dirty flag) — no Janus traffic, NO spawn

  client request → Janus sees doorbell flag at upstream selection:
    do NOT forward; send own `GET /ring` down the doorbell sock;
    client request waits in hand, body unread (TCP backpressure)

  ring received (someone actually wants the app):
    single-flight spawn from current files; hold rings (~15s cap,
    capped waiters); concurrent rings join the same wait

  pool ready, no saves since spawn began?
    yes → PUT upstreams [socks…], AWAIT the 200, THEN answer
          rings 204 (empty — pure wake-up) → Janus re-reads the app's
          socket list from its own registry, picks a worker, proxies
          the original request: normal, FIRST-time, streaming
    saved mid-boot → scrap (never publish), boot again from latest;
          repeat while saves land (clients bounded by their hold caps)
    boot failed → doorbell STAYS published; cache error; rings get
          503 + boot error immediately, NO respawn (no crash loops);
          next content-changing save clears the failure
```

**Socks travel ONLY on the PUT, never in the ring response.** The PUT is needed anyway (doorbell retirement, eager mode
has no ring, /1.0 introspection); socks-in-the-204 would be a second
registry write path with its own fencing/auth/races. The 204 carries
nothing — it is an advisory wake-up; Janus trusts only its own
registry, and every post-wake state is handled (socks → proxy;
doorbell again → ring again, capped; empty → 503), so there is no
cross-channel ordering to verify.

**Eager opt-in:** `reload: eager` spawns at settle instead of waiting
for a ring (instant post-save refresh, background spawns). The
default is on-demand — 200 saves = one doorbell PUT, zero spawns.

**Overlap, not teardown-then-idle:** admission cut is immediate;
process teardown is **retire after drain**. Old gen never receives
*new* work; next pool is always fresh files for the latest gen.

**Janus side of the ring (`doorbell: true` upstreams):** the flag is
known at upstream selection — before the request is touched — so
nothing is buffered and nothing replays: the request is delivered
exactly once (fresh pool or nowhere), so no body caps, no marked-307
interception, no idempotency questions. Exclude the doorbell from
health accounting; ring cap ~3 (re-dirty mid-boot rings again; past
cap → 503 + Retry-After); Janus request-read timeouts must exceed the
ring hold cap (client connection idles during boot); client disconnect
during hold abandons that waiter but the single-flight spawn finishes
(warm pool for the next request); `Expect: 100-continue` clients get
their `100` only once the pool is ready.

**In-flight:** best-effort complete during grace, then hard cut. Watch
mode will sever slow uploads / SSE after grace — document that; prod
uses watch off. Prefer unique sock paths per gen; kill → wait exit →
unlink before reusing a path.

**Watch hygiene:** rename-safe (port v3 temp+rename handling); allowlist
(`*.rip` + config), ignore `.git` / `node_modules` / caches / editor junk.

#### Defaults (recommended)

| Knob | Dev (watch on) | Prod |
| --- | --- | --- |
| watch | ON | OFF (`--static` / env); loud reject or `--allow-watch` if on |
| `w` | **2** (snappy loop) | sized for RPS; not tied to reload |
| `c` | **1** | 1 default; raise only with watch off |
| settle | **100–150ms** trailing | n/a |
| reload trigger | **on-demand (doorbell)**; `eager` opt-in; single-flight | n/a |
| doorbell hold | **~15s** cap, capped waiters, then 503 | n/a |
| ready gate | **≥1** worker then PUT socks; scale rest | all `w` before PUT |
| drain grace | **~2–5s** then kill | n/a |
| not-ready clients (bare `[]`) | **503** fail-fast at Janus | n/a |

Steady state (watch off): no fs watch / dirty machine; Janus hot path
is host lookup → atomic upstream pointer → `reverse_proxy` only — no
gen checks, no Rip calls (reject v3-style `ensureFresh` on every request).

#### Option: hot reload OFF

Ship an explicit opt-out (v3: `--static` / no file watch). When off:

- file changes do **not** clear upstreams
- no spawn cycle on save
- operators restart / redeploy to pick up code (normal prod posture)

### ALS vs app module state

v3 `@rip-lang/server` wraps each request in `AsyncLocalStorage`
(`requestContext.run`) so `read()`, `session`, `ctx()`, `mark()`, etc.
are request-scoped and safe at `c > 1` **for that API surface**.

ALS is **not** magic for all app code:

```coffee
# UNSAFE at c > 1 — module slot shared by concurrent handlers
currentUser = null
get '/x' ->
  currentUser = loadUser!
  …
```

Safe patterns: keep per-request data on the request context / ALS
(`@`, `read()`, `session`), or stay at `c:1`.

Framework audit (v3): no classic “current request in a module `let`”
bugs in the server package itself; examples looked clean. Residual
app-level risk remains.

### Data plane (Janus)

Do **not** put Rip Server on the hot path. Preferred shape:

```text
Client → Janus → worker unix sockets (least_conn / similar)
Rip Server → spawn / register upstreams / heartbeat / reload only
```

macOS `SO_REUSEPORT` is **not** a substitute for this (see proof notes
below if we archive them). Sticky last-binder + no pause-while-busy
membership — verified live on Darwin 25 / macOS 26 (2026-07).

---

## Rip last-match binding `_` under concurrency

### The issue

`text =~ /re/` and related forms compile to assignments of a last-match
binding `_`, later read as `_[1]`, etc.

If `_` is a **module-level singleton**, then under worker `c > 1`
(or any overlapping async in one process):

```text
request A:  x =~ /pat/     → sets module _
request A:  await …       → yields
request B:  y =~ /other/   → overwrites module _
request A:  use _[1]       → WRONG capture (B’s match)
```

That is silent corruption — the worst defect class.

v3 `@rip-lang/validate` (used by `read()`) does many match→`_` uses.
**Today those validators are synchronous**, so the event loop cannot
interleave between match and `_` use — so production `read()` is OK
**while validators stay sync**. A custom `registerValidator` that
`await`s between match and `_` would be unsafe with module-scoped `_`.

### Wrong fix: put `_` in ALS

AsyncLocalStorage *could* hold the last match per request, but:

- Every match would pay `getStore` — hot path in validation.
- Semantics become “last match in this HTTP request,” which is odd for
  nested sync helpers and non-server Rip.
- ALS is the right tool for **request context** (`read` / `session` /
  `ctx`), not for Perl-style match sugar.

### Right fix: lexical / scope-local `_`

Emit `_` as a normal binding **hoisted in the enclosing function/scope**
(v4 emitter already describes this intent: “`_` declares at the scope
like any assigned name”), never as a module singleton.

Then each call activation has its own `_`; concurrent requests do not
clobber each other. Cheap, language-correct, no ALS.

### TODO

- [ ] Audit Rip emit of `=~` / regex-index / `v[/re/]` in **this**
      checkout: confirm `_` is always scope-local, never a shared
      module binding (including compiled output of `packages/validate`
      and any `api.rip`-style explicit `_: … = null`).
- [ ] Add a negative/concurrency pin: two overlapping async paths in
      one process that match then await then read `_` must not cross
      captures (or reject awaiting between match and `_` use if we
      choose a stricter rule).
- [ ] Document in language/server docs: custom validators must not
      await between `=~` and use of `_` unless `_` is proven lexical.
- [ ] When rebuilding `@rip-lang/server` (Janus-era): keep ALS for
      request context; do not invent ALS for `_`.

---

## v4 @rip-lang/server architecture (three concepts, one package)

v3 (~9k lines) maps mostly to **Janus**, not to Rip code:
`server.rip` + `serving/*` + `streams/*` + `acme/*` + `compat/*`
(~5.6k lines: TLS, listener, static, proxy, health, queue, rate
limit, hub, mDNS, nginx/caddy compat) are **deleted as a concept** —
Janus owns the edge. What remains is one package, three concepts:

| Concept | File | Origin | Size |
| --- | --- | --- | --- |
| DSL (Sinatra surface) | `server.rip` (entry) | v3 `api.rip` ports ~verbatim; ALS ctx, `read()` via @rip-lang/validate, `error!/notice!/bail!`, OpenAPI | ~800 |
| Manager (the process you run) | `manager.rip` | v3 `control/{manager,workers,watchers,cli}` rewritten small: watch → doorbell → spawn → /1.0 client → heartbeats; NO data plane | ~350 |
| Worker (UDS runtime) | `worker.rip` | v3 `control/worker.rip` minus busy-checkout (Janus least_conn + c:1 replaces it): load app, bind UDS, `/ready`, drain on SIGTERM | ~150 |

Plus `middleware.rip` (cors/logger/serve), `test.rip`, README — per
the packages mold. **No `bin/` folder**: package.json declares
`"bin": {"rip-server": "./server.rip"}` (x12/swarm pattern);
`server.rip` opens `#!/usr/bin/env rip` and ends with an
`if import.meta.main` block — library when imported, CLI when
executed. The main-guard loads the manager **dynamically**
(`import!('./manager.rip')`) so DSL importers never load manager code.

**CLI dispatch:** v3 `bin/rip` had a 7-step `rip <name>` → `rip-<name>`
cascade (sibling bin → repo bin/rip-<name> → repo bin/<name> →
packages/*/bin → repo node_modules/.bin → nearest node_modules/.bin
walking up from cwd → PATH → loud error). v4 `bin/rip` lacks it —
only hardcoded `schema` + a reserved `server` error branch. Port the
generic cascade (minus the packages/*/bin probe; `"bin"` entries land
in node_modules/.bin via bun install), then delete the hardcoded
`server` branch when the package lands.

Key property: **the DSL doesn't know Janus exists.** `start()` inside
a worker (env-detected) registers the fetch handler; standalone
(`bun app.rip`) serves a port directly. Same app file both ways.

"Rip Server" = product/package name; in the protocol doc it means the
manager process. Spawn mechanism stays v3's: `Bun.spawn ['bun',
worker.rip]` with env (`APP_ENTRY`, `SOCKET_PATH`, `WORKER_ID`, …).

Build order: DSL (+tests, standalone mode) → worker → manager →
meet Janus Phase 8. Protocol: `janus/docs/20260719-002000-pool-protocol.md`.

## Related pointers

- v3 reference (working product): `rip-lang/packages/server` (leave alone
  as the Sinatra + workers reference).
- Discarded v4 scaffolding (local only, gitignored `misc/`): 
  `misc/server-v4-discarded/` on machines that kept the corpse.
- Partition: `misc/janus-vs-rip-partition.html` — Janus owns edge;
  Rip Server orchestrates; workers serve.
- Janus repo: control `/1.0` + cold capabilities **ping** then **control**.
- **Pool protocol (permanent home):** `janus/docs/20260719-002000-pool-protocol.md`
  — the Janus↔Rip contract distilled from the 2026-07 adversarial review;
  the hot-reload section above is the scratch version of the same design.
