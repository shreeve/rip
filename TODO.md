# TODO — open design / correctness notes

Scratchpad for decisions and footguns we must not lose. Not a roadmap;
permanent product docs live under `docs/`. Remove items when fixed or
moved into real docs/tests — git history and PR bodies are the record
of completed work.

---

## Documentation

- [ ] Write the REAL syntax reference: drill down from
      `src/grammar/grammar.rip`, the lexer's context-sensitive behavior
      (retags like `POST_IF`), and the battery (the syntax contract)
      into an authoritative document. It takes the `docs/SYNTAX.md`
      name when it exists. Cross-check the three editor grammars for
      drift while at it.

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
- [ ] `rip-mark` access log: surfacing the mark in an access log is
      unbuilt future work. (The scrub itself is done and documented:
      Janus's `ModifyResponse` deletes `Rip-Mark` from every client
      response, and the micro-cache stores post-scrub bytes.)

### 2026-07-20 bench incident observations

- [ ] A production rip-server exiting cleanly (exit 0) logs nothing
      about why — no shutdown reason, no signal note. The manager
      should say what ended it on the way out.
- [ ] The 409 stale-claim retry gives up before the claim TTL expires,
      despite logging "retrying until the stale claim expires" — retry
      deadline and claim TTL are misaligned.

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

---

## Related pointers

- Janus repo: control `/1.0` + cold capabilities **ping**, **control**,
  **cache** (micro-cache + coalescing).
- **Pool protocol:** `janus/docs/20260719-002000-pool-protocol.md`
- Server pool sizing / `-c`: `packages/server/README.md` (default `c:1`
  with watch; higher `c` opt-in when reload off). ALS covers framework
  request context; app module-level per-request vars remain unsafe at
  `c > 1`.
