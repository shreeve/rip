# TODO — Rip Sites

Open work only. Delete a line when it lands or moves into docs/tests.

## Edge

- [ ] **wan routing:** ACME / real DNS for `janus mode wan`; `rip.caddy`
      and Janus's local sites route the local-CA families only.
- [ ] Behavioral appliance pins for `.local` host registration (the
      pins are static strings).
- [ ] Pin `GET /bundle.json` + `Accept-Encoding: br` → Manager
      `bundle.json.br` bytes (`Content-Encoding: br`, `Vary:
      Accept-Encoding`) through released Janus. Janus's seed carries
      `files { precompressed }`; the janus test fixture uses bare
      `files`.
- [ ] Pin one Caddy compression policy (encodings, min size, MIME
      exclusions, streaming, pre-encoded, `no-transform`) and certify
      through released Janus.
- [ ] Pin edge security-header baseline + fill-only precedence;
      certify static, generated, SPA shell, X-Sendfile, proxied API,
      redirects, Janus errors.

## Logging

- [ ] Opt-in merged file log: decide `serve.rip` `logs:` vs
      `RIP_LOG_DIR` (precedence; foreground vs remembered apps —
      control already writes `apps/<id>.log`), then
      `<dir>/server.log` (0600). Stdout when unset. Edge `access.log`
      stays Caddy/operator-owned.

## Manager

- [ ] Drop `--watch` (watch is already on by default); keep
      `--no-watch` / `--no-watch-app` / `--no-watch-api`.
- [ ] Symlinked / workspace API deps participate in invalidation.
- [ ] Bound heartbeat / re-registration so a stalled control plane
      cannot pile overlapping requests.
- [ ] One concurrency policy, not environment-named modes.

## Distribution

- [ ] Signed/notarized Janus-enabled Caddy and local edge
      assets. Control plane stays edge-scoped (no idle forever
      LaunchAgent for a separate Agent product).

## Cart demo

- [ ] Drop worker `get '/styles.css'` if Janus App-root serving covers
      it.
- [ ] Move migrate/seed off worker import (`setup!` in `index.rip`)
      into an explicit one-off command.
