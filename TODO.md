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
B-list real-but-deferrable items.

### rip packages/server

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
      unbuilt future work, and it is inherently Janus-side work — the
      edge writes access logs (the logging contract in
      packages/server/README.md). (The scrub itself is done and
      documented: Janus's `ModifyResponse` deletes `Rip-Mark` from
      every client response, and the micro-cache stores post-scrub
      bytes.)

### workspace feed (PR #188 re-review, 2026-07-29)

- [ ] Want retirement can drop a retry it should keep: a ding for a
      brand-new id whose cell fetch misses WHILE the manifest is held
      back (a bundle-rewrite failure) gets its want retired — the
      held-back manifest does not name the id yet. Needs two
      simultaneous failures, dev-only, heals on the next save.
- [ ] When an editor producer lands (M2), `crossRun` cannot distinguish
      "another run" from "another producer": a local write over a
      server-owned id bumps the rev with local bytes, and the next
      resync would reload and discard the local edit. Unreachable
      today — nothing writes server-owned ids locally.

### janus

Janus items moved to `janus/TODO.md`.

---

## Related pointers

- Janus repo: control `/1.0` + cold capabilities **ping**, **control**,
  **cache** (micro-cache + coalescing).
- **Pool protocol:** `janus/docs/20260719-002000-pool-protocol.md`
- Server pool sizing / `-c`: `packages/server/README.md` (default `c:1`
  with watch; higher `c` opt-in when reload off). ALS covers framework
  request context; app module-level per-request vars remain unsafe at
  `c > 1`.
