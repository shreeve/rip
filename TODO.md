# TODO — open design / correctness notes

Scratchpad for decisions and footguns we must not lose. Not a roadmap;
permanent product docs live under `docs/`. Strike items when fixed or
moved into real docs/tests.

---

## Possible emitter bug: if-expression on `=!` leaves an IIFE temp undeclared

- [x] ~~Possible emitter bug: multi-line `if` on `=!` leaves IIFE temp
      undeclared (reported 2026-07-20 during `-c` knob work)~~ —
      refuted. Shape was real (`CONCURRENCY =! if rawC? … n =
      parseInt …`); emit has module-scoped `let n` on enclosing hoist
      line above the IIFE. Misread was truncated inspection (`rg`/sed
      window skipped hoist). `=!` not load-bearing vs `=`/`:=`. No
      pin/fix needed. Related: see below.

## Component `_init` drops parenthetical multi-stmt member initializers

- [ ] Component `_init` drops parenthetical multi-statement member
      initializers from hoist collection → bare assigns (strict-mode
      throw). Not if→IIFE, not `=!`-specific. Guilty filter
      (`src/emitter.js` ~6231–6236): `initValues` filters out
      `isBlock(v) && v.length > 2`, intended for multi-stmt computed
      bodies, but also drops parenthetical blocks on `=!` / `=`
      members. Repro: `C = component` / `x =! (` / `a = 1` / `a` /
      `)` / `render` / `div` (or `x = (…)` twin) → `_init` has
      `this.x = (a = 1, a)` without `let a`. Multi-line `if` on the
      same member hoists correctly. Fix: narrow filter to multi-stmt
      **computed** values only; keep collecting hoist targets for
      readonly/plain/state block initializers. Pin in battery.

## Rip Server concurrency (`c:N`) and hot reload

**Context:** Janus-era Rip Server will keep Unicorn-shaped workers
(process + unix socket). Capacity = `w × c` (worker processes ×
per-worker concurrent requests). v3 default is `c:1`.

### Recommendation (locked for now)

**Status:** the knob is built — `rip server -c <n>` (workers receive
`WORKER_CONCURRENCY`); `c > 1` with watch on (or `--eager`) is refused
loudly at startup, pinned in `packages/server/test.rip`. The
recommendation below stands.

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

### Hot reload — never serve known-stale code

Designed, landed, and pinned; the permanent contract is the pool
protocol doc (see Related pointers).

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

## Deferred findings — 2026-07-19 exit-gate reviews (fix some day)

Three deep reviews (Janus Go, rip server package, docs coherence) ran
before Phase 7. All A-list defects were fixed and pinned the same day;
these are the B-list items judged real-but-deferrable. Tracked here so
they are not lost (janus items included — janus has no scratchpad).

### rip packages/server

- [ ] Middleware wraps only MATCHED routes: `use cors()` alone never
      answers preflights (its OPTIONS branch is unreachable without an
      OPTIONS route) and `logger` never logs 404s. Either document the
      non-Koa semantics or route unmatched requests through the chain.
- [ ] CSRF form-field token: `fieldName` option is read, never checked
      (header path only). Wire to `c._body[fieldName]` or delete the
      option. Fails closed today.
- [ ] Inline route patterns `:id{\d+}` can never match — the escape
      pass runs before the param pass, so the brace group arrives
      pre-escaped. Fix the pass order or reject the syntax loudly.
- [ ] Malformed %-encoding in a matched param (`/u/%zz`) throws
      URIError out of the exported fetch → should be a 400.
- [ ] Single-empty-field form heuristic rewrites `subscribe=` to
      `{body: 'subscribe'}` — corrupts a legit form clearing its only
      field. Trigger should check whether the raw body contained `=`.
- [ ] Manager 409 on re-register within the heartbeat TTL aborts
      immediately — restart-under-supervisor flaps until TTL expiry.
      A bounded 409 retry (~TTL + margin) removes the papercut.
- [ ] Drain constants disagree: worker `DRAIN_DEADLINE_MS` 30s vs
      manager grace 2.5s + SIGKILL 5s — an in-flight response >~7.5s
      is severed while the worker believes it has 30s. Align, or
      comment the supervised ceiling.
- [ ] No hung-handler watchdog at c:1 — a never-returning handler
      leaves the worker busy-bouncing forever while `/ready` stays
      green. Design a worker-side in-flight-age deadline.
- [ ] Respawn edges: (a) a worker crashing MID-BOOT under readyWhen:1
      is never respawned (pool degraded until next save); (b) a
      deadline-expired-but-alive worker is neither killed nor
      published (live, unready, invisible).
- [ ] Watcher blind spots: symlinked/workspace deps never trigger
      dirty; the protocol's "explicit config" allowlist half is
      unimplemented (`*.rip` only).
- [ ] Writer chain grows unboundedly during a long control-plane
      outage (one heartbeat closure per tick behind the blocked retry
      loop). Memory only, bounded by outage length.
- [ ] Style: middleware.rip uses raw `await next()` (7 sites) where
      `next!()` is the idiom.
- [ ] Implemented but unpinned: WAITER_CAP, hold-cap timeout 503,
      crash respawn, `--eager`, heartbeat-404 re-register + re-PUT,
      prod readyWhen:all, `--allow-watch` gate, logger/timeout
      middleware.
- [ ] `rip-mark`: Janus scrubs it from client responses; surfacing it
      in an access log is unbuilt future work.
- [x] ~~`c` opt-in knob is unbuilt (perf lever #1 — 4x measured headroom
      on I/O-bound handlers; worker hardcodes `inflight >= 1`)~~ —
      landed as `-c, --concurrency` / `WORKER_CONCURRENCY`, refused
      with watch on, pinned in `packages/server/test.rip`.

### janus (tracked here; see janus/docs perf doc for measured levers)

- [ ] `dp.state`/`dp.proxies` grow across reload epochs (fresh socket
      paths per pool → one entry per worker per save in dev watch).
      GC entries no app references, minding lock order in setUpstreams.
- [ ] `replayable()` is narrower than the protocol wording: "no body
      at all" vs "no body streamed to the worker". Safe (never double
      delivery), just more client-visible 503s for bodied requests —
      tighten the doc or widen the check.
- [ ] A worker dying mid-response (ErrAbortHandler panic path) skips
      `markUnhealthy` — the next request pays one extra failed dial.
- [ ] Transient waiter-cap overshoot: the flight is deleted before
      `done` closes, so a gap arrival can start a second flight while
      holders are parked (briefly up to 2× cap).
- [ ] Control TLS cert paths are hardcoded cwd-relative — needs a
      Caddyfile knob before `control public` is used in anger.
- [ ] No scoping on host claims or socket paths within the trust
      domain (any control client can claim any host first-wins).
      Pull INTO the Phase 7 / multi-tenant design.
- [ ] Wording drift: heartbeat failures retry next-tick (doc says
      "with backoff"); manager accepts 200 or 201 from POST /apps
      (protocol says 201); rip README ties readyWhen:1 to "watch on"
      while code keys off RIP_ENV.

## Related pointers

- Janus repo: control `/1.0` + cold capabilities **ping** then **control**.
- **Pool protocol (permanent home):** `janus/docs/20260719-002000-pool-protocol.md`
  — the Janus↔Rip contract distilled from the 2026-07 adversarial review.
