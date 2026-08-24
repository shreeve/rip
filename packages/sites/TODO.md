# TODO — Rip Sites

Open work only. Delete a line when it lands or moves into docs/tests.

## Edge

- [ ] **`public` posture:** ACME / real DNS; keep `expose public` refusing
      until Caddyfile + mode exist. Do not persist `public` in state first.
- [ ] Behavioral appliance pins for trust gate, mode flip (stop sites
      first), and `.local` host registration (today: static string pins).
- [ ] After control-plane / Caddyfile changes, document or automate
      restart so launchd dual-socket listeners cannot race a stale
      in-memory process writing an old plist.
- [ ] Pin `GET /bundle.json` + `Accept-Encoding: br` → Manager
      `bundle.json.br` bytes (`Content-Encoding: br`, `Vary:
      Accept-Encoding`) through released Janus. Packaged Caddyfiles
      already have `files { precompressed }`; the janus test fixture
      still uses bare `files`.
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

- [ ] Signed/notarized tray host, Janus-enabled Caddy, and local edge
      assets. Control plane stays edge-scoped (no idle forever
      LaunchAgent for a separate Agent product).

## Cart demo

- [ ] Drop worker `get '/styles.css'` if Janus App-root serving covers
      it.
- [ ] Move migrate/seed off worker import (`setup!` in `index.rip`)
      into an explicit one-off command.
