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

### janus

Janus items moved to `janus/TODO.md`.

---

## Workspace dev feed — open edges

- [ ] Epoch-path dings: a full reload (server or mixed save under
      `RIP_WORKSPACE=1`) rebuilds cells in `buildApp` but publishes no
      dings, and hub sockets survive app reloads at Janus — so connected
      browsers hear nothing about client cells that changed in that
      epoch until their next reconnect resync. Decide in Phase C
      (apply policy for server changes is likely a full page reload
      anyway); if the door keeps in-place apply for these, the manager
      must ding after the pool swap.
- [ ] One unexplained missed ding (2026-07-28, live Janus run): a
      `app/mood.rip` rev-2 ding published ~15s after a manager
      re-registration (409 host-claim retry window) never applied in a
      freshly booted tab — no report was captured (console hook was
      installed later); hub counters showed publishes 1 / deliveries 2 /
      conns 2, so delivery-vs-enrollment is ambiguous. Six consecutive
      dings applied cleanly afterward. If it recurs with a hooked
      console, capture the feed report verbatim. Structural note: an
      applyDing whose cell fetch AND resync both miss has no retry
      timer — the feed stays silent until the next ding or reconnect.
- [ ] Cold-review should-fixes (PR #187 review, 2026-07-29; all inside
      the experimental `RIP_WORKSPACE=1` surface, none reachable flag
      off). The two silent-stale items head the list — they are the
      defect class the doctrine exists to kill:
  - [ ] The browser door mutates the loader BEFORE the bag's rev
        verdict (`src/browser-boot.js` door.set/delete): two dings in
        flight can land out of order — the pre-fetch staleness check
        passes for both, the older fetch completes second, and its
        `files.set` + `invalidate` poison the module graph while
        `bag.set` rejects it without error. Check
        `bag.passport(id)?.rev` before touching `files`/`loader`.
  - [ ] Boot pairs the manifest's rev with the bundle's source without
        correlation (`src/browser-boot.js`): the bundle is fetched
        before the manifest, and the manager writes the manifest before
        rewriting the pool bundle — a save between the two fetches makes
        `populate` claim rev N+1 over rev-N bytes, and the rev cursor
        then blocks the healing ding until the NEXT save. Needs a
        correlation fact (per-cell hash, or fetch order + epoch check).
  - [ ] The feed's default `cellUrl` never percent-encodes the id
        (`packages/workspace/feed.rip`): a legal filename containing
        `%`, `#`, or `?` builds a URL the server 400s or truncates —
        and the miss path has no retry (see above). One-line
        `encodeURIComponent` on the id.
  - [ ] Overlapping `onCellChange` runs share fixed tmp paths
        (`packages/server/manager.rip`): a second save's run races the
        first on `manifest.json.tmp` and the pool bundle's `.tmp` —
        interleaved writes can land a torn manifest via rename, or the
        rename throws and that run's dings abort. Chain cell-path runs
        on a promise queue.
  - [ ] The remount's teardown-plus-relaunch has no guard
        (`src/browser-boot.js`): a throw from `launch` inside the
        timer-driven remount leaves the page unmounted with only an
        unhandled rejection as evidence. Wrap and route through
        `report`.
  - [ ] Nits from the same review: `client()`'s SPA fallback silently
        replaces a notFound the app registered BEFORE calling it
        (warn or document the ordering); `DEV_CHANNEL` is a two-site
        hand-mirrored constant (pin their equality); the Pulse post
        handler ignores `res.ok` and can `send` on a CONNECTING socket.

---

## Related pointers

- Janus repo: control `/1.0` + cold capabilities **ping**, **control**,
  **cache** (micro-cache + coalescing).
- **Pool protocol:** `janus/docs/20260719-002000-pool-protocol.md`
- Server pool sizing / `-c`: `packages/server/README.md` (default `c:1`
  with watch; higher `c` opt-in when reload off). ALS covers framework
  request context; app module-level per-request vars remain unsafe at
  `c > 1`.
