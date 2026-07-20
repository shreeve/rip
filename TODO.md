# TODO — open design / correctness notes

Scratchpad for decisions and footguns we must not lose. Not a roadmap;
permanent product docs live under `docs/`. Strike items when fixed or
moved into real docs/tests.

---

## Rip last-match binding `_` under concurrency

`text =~ /re/` (and related) assign last-match `_`, later read as `_[1]`,
etc. If `_` is a **module-level singleton**, then under worker `c > 1`
(or any overlapping async in one process):

```text
request A:  x =~ /pat/     → sets module _
request A:  await …       → yields
request B:  y =~ /other/   → overwrites module _
request A:  use _[1]       → WRONG capture (B’s match)
```

Silent corruption. v3 `@rip-lang/validate` does many match→`_` uses;
**today those validators are sync**, so production `read()` is OK while
they stay sync. A custom `registerValidator` that `await`s between match
and `_` would be unsafe with module-scoped `_`.

**Wrong fix:** put `_` in ALS — hot-path tax, odd “last match in this
HTTP request” semantics, wrong tool for Perl-style match sugar.

**Right fix:** lexical / scope-local `_` — hoist in the enclosing
function/scope (v4 emitter already describes this intent), never a
module singleton. Concurrent requests do not clobber; no ALS.

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

## Deferred findings — 2026-07-19 exit-gate reviews

Three deep reviews (Janus Go, rip server package, docs coherence) ran
before Phase 7. A-list defects were fixed/pinned the same day; these are
B-list real-but-deferrable items (janus included — no scratchpad there).

### rip packages/server

- [ ] Middleware wraps only MATCHED routes: `logger` never logs 404s,
      and unmatched requests never run the chain. Either document the
      non-Koa semantics or route unmatched requests through the chain.
      (Narrowed 2026-07-20: `cors({preflight: true})` now answers
      OPTIONS before route matching, and `use(path, mw)` path scoping
      works — `603ee80`. The unmatched-request/404 half remains open.)
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
- [ ] `rip-mark` access log: surfacing the mark in an access log is
      unbuilt future work. (The scrub itself is done and documented:
      Janus's `ModifyResponse` deletes `Rip-Mark` from every client
      response, and the micro-cache stores post-scrub bytes.)

### janus (tracked here; see janus/docs perf doc for measured levers)

- [ ] `dp.state` grows across reload epochs (fresh socket paths per
      pool → one entry per worker per save in dev watch). GC entries
      no app references, minding lock order in setUpstreams. (The
      separate `dp.proxies` map is gone — folded into `upstreamState`
      by the lock collapse, `fd1fe2f` — but the state map still only
      grows.)
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

---

## Related pointers

- Janus repo: control `/1.0` + cold capabilities **ping**, **control**,
  **cache** (micro-cache + coalescing).
- **Pool protocol:** `janus/docs/20260719-002000-pool-protocol.md`
- Server pool sizing / `-c`: `packages/server/README.md` (default `c:1`
  with watch; higher `c` opt-in when reload off). ALS covers framework
  request context; app module-level per-request vars remain unsafe at
  `c > 1`.

---

## Done / refuted

- Component `_init` drops parenthetical multi-stmt member initializers
  from hoist → bare assigns — **fixed** on this branch (`d3c59d1`); pin
  in `test/battery/components.rip`.
- if-expr on `=!` leaves IIFE temp undeclared — **refuted** (module
  hoist present; truncated inspection). Re-probed 2026-07-20:
  `printf 'x =! if a\n  b = 1\n  b + 1\nelse\n  2\n' | ./bin/rip -c`
  emits `let b;` at module scope and a correct
  `const x = (() => { … })()` IIFE.
- `-c` / `WORKER_CONCURRENCY` knob — **landed** (refused with watch).
