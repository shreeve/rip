# TODO — Rip Sites

Open work only. Remove an item when it lands or moves into real docs/tests;
commits and PR bodies retain completed history.

## Edge postures (follow-ups)

Default / local / trust / dual-port launchd / Rip status / tray mode
controls landed. Remaining:

- [ ] Land uncommitted LAN dual-claim + status-page Start/Stop/Restart
      (working tree: `agent.rip`, demos `serve.rip`, `Caddyfile.local`
      `mdns { apps on }`, README walkthrough).
- [ ] **`public` posture (phase 2):** ACME / real DNS hosts; keep
      `rip sites expose public` refusing until the Caddyfile and mode
      exist. Do not persist `public` in state before that.
- [ ] Behavioral appliance pins for trust gate, mode flip (stop sites
      first), and `.local` host registration — today only static string
      pins.
- [ ] After control-plane / Caddyfile changes, document (or automate)
      restart so launchd dual-socket listeners cannot race a stale
      in-memory process writing an old plist.

## Opt-in file logging

Roadmap still cites a README Planned contract that no longer exists.
Re-lock before coding:

- [ ] Decide knob shape: `serve.rip` `logs: '<dir>'` and/or
      `RIP_LOG_DIR`; env vs serve precedence; foreground-only vs also
      remembered apps (control already writes `apps/<id>.log`).
- [ ] Implement merged stream → `<dir>/server.log` (0600); stdout
      remains the default when unset. Edge `access.log` stays
      Caddy/operator-owned.
- [ ] Drop or rewrite the stale “Planned section” pointer in
      `docs/ROADMAP.md`.

## Edge policy

- [ ] Pin one Caddy compression policy: encodings, minimum size, MIME
      exclusions, streaming bodies, pre-encoded responses, and
      `Cache-Control: no-transform`.
- [ ] Certify compression through released Janus (streaming,
      `no-transform`, already-encoded response).
- [ ] Pin the edge security-header baseline and fill-only precedence so
      explicit application headers win; certify across static files,
      generated files, SPA shells, `X-Sendfile`, proxied API, redirects,
      and Janus-generated errors.

## Manager policy

- [ ] Make watching the default; remove `--watch`; keep `--no-watch` /
      `--no-watch-app` / `--no-watch-api` as explicit opt-outs.
- [ ] Make configured symlinked and workspace dependencies participate
      in API invalidation.
- [ ] Bound heartbeat and re-registration so a stalled control plane
      cannot accumulate overlapping requests.
- [ ] Pin one concurrency policy independent of environment-named modes.

## Appliance / distribution

- [ ] Signed/notarized distribution for tray host, Janus-enabled Caddy,
      and local edge assets. Control plane is edge-scoped (no idle
      forever LaunchAgent for a separate Agent product).

## Project cleanups

- [ ] Remove Cart’s worker route for authored `app/styles.css` if Janus
      already serves it from the App root.
- [ ] Move Cart migration and seed setup out of worker import into an
      explicit one-off command.
