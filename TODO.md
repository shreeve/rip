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

## Related pointers

- Janus repo: control `/1.0` + cold capabilities **ping** then **control**.
- **Pool protocol (permanent home):** `janus/docs/20260719-002000-pool-protocol.md`
  — the Janus↔Rip contract distilled from the 2026-07 adversarial review.
