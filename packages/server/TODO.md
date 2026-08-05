# TODO — Rip Server

Open work only. Remove an item when it lands; commits and test fixtures
retain completed history.

## 1. Finish edge policy

- [ ] Pin one Caddy compression policy: encodings, minimum size, MIME
      exclusions, streaming bodies, pre-encoded responses, and
      `Cache-Control: no-transform`.
- [ ] Configure Caddy streaming compression for static, generated,
      `X-Sendfile`, and proxied API responses.
- [ ] Certify compression through released Janus, including streaming,
      `no-transform`, and an already encoded response.
- [ ] Pin the edge security-header baseline and fill-only precedence so
      explicit application headers win.
- [ ] Apply and certify that baseline across static files, generated files,
      SPA shells, `X-Sendfile`, proxied API responses, redirects, and
      Janus-generated errors.

## 2. Finish manager policy

- [ ] Make watching the default, remove `--watch`, keep `--no-watch` /
      `--no-watch-app` / `--no-watch-api` as explicit opt-outs.
- [ ] Make configured symlinked and workspace dependencies participate in API
      invalidation.
- [ ] Bound heartbeat and re-registration requests so a stalled control plane
      cannot accumulate overlapping requests.
- [ ] Pin one concurrency policy independent of environment-named modes.

## 3. Finish the per-user appliance

- [ ] Register the Rip Agent as a macOS LaunchAgent so desired edge and app
      state reconciles immediately at login, before the first CLI request.
- [ ] Build the native SwiftUI menu-bar client over the private agent protocol.
- [ ] Add a signed/notarized distribution pipeline for the menu app, agent,
      Janus-enabled Caddy binary, and local edge assets.

## 4. Remove obsolete project usage

- [ ] Remove Cart's worker route for authored `app/styles.css`; Janus serves
      it from the App root.
- [ ] Move Cart migration and seed setup out of worker import into an explicit
      one-off command.

## 5. Certify and land

- [ ] Run every `test:*` script, including released-Janus verification.
- [ ] Run `go test ./...` and `./test.sh` in Janus.
- [ ] Run `git diff --check` in both repositories.
- [ ] Perform independent empirical verification of `X-Sendfile`, API reload,
      App delivery, and migration state transitions.
- [ ] Run one cold review over both complete branch diffs.
