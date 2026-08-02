# TODO — Rip Server simplification

Ordered implementation checklist for `rip-server-fixes`. Remove each item when
it lands; the commits and PRs retain the completed record.

## 1. Pin the contracts before deleting code

- [ ] State one launch contract: public serving always enters Caddy+Janus;
      `start!` only hands an API handler to the private worker runtime.
- [ ] State one App contract: the manager discovers and publishes `app/`;
      API source never mounts browser routes.
- [ ] State one file contract: ordinary files and opt-in directory browse use
      registered Janus roots; API-authorized files use `X-Sendfile`.
- [ ] Choose and pin one pool readiness rule instead of branching on
      `RIP_ENV=production`.
- [ ] Choose and pin the manager switch surface: watching defaults on,
      `--no-watch` is the explicit opt-out, and no environment-named server
      mode changes lifecycle semantics.
- [ ] Pin the finite default file roots: `static/generated`, `public/`, and
      `app/`; the project directory is never an implicit public root.

## 2. Land edge policy before removing API middleware

- [ ] Pin one Caddy compression policy, including encodings, minimum size,
      already-encoded responses, streaming bodies, and MIME exclusions.
- [ ] Configure Caddy streaming compression for static, generated,
      `X-Sendfile`, and proxied API responses.
- [ ] Certify compression through the Janus data plane, including streaming
      and an already-encoded response.
- [ ] Pin application compression controls using standard response headers:
      `Cache-Control: no-transform` disables transformation and an existing
      `Content-Encoding` is preserved; no Rip-only compression header.
- [ ] Pin the baseline security-header set and fill-only precedence: explicit
      application headers win; the edge supplies only absent defaults.
- [ ] Apply the baseline to static files, generated files, SPA shells,
      `X-Sendfile`, proxied API responses, and Janus-generated errors.
- [ ] Certify header precedence and parity across every response class.
- [ ] Design and implement a real application `timeout` middleware: propagate
      an abort signal to downstream work, return `504` at the deadline, and
      recycle the worker when a handler ignores cancellation. Pin per-route
      control, streaming behavior, side-effect limits, and watchdog handoff.

## 3. Collapse manager modes

- [ ] Remove `--watch` and `--allow-watch`; retain `--no-watch` as the
      explicit opt-out.
- [ ] Make configured symlinked and workspace dependencies participate in
      watch invalidation instead of watching only `*.rip` project files.
- [ ] Bound control-plane writes during an outage so heartbeat retries cannot
      add one queued writer closure per tick.
- [ ] Re-pin concurrency rules against watch on/off without environment
      aliases.

## 4. Tighten the package surface

- [ ] Re-pin the exact named export surface after deletions.

## 5. Remove obsolete project usage

- [ ] Remove Cart's worker route for authored `app/styles.css`; Janus serves
      it from the live App root.
- [ ] Move Cart migration and seed setup out of worker import into an explicit
      one-off command.
- [ ] Add a negative integration test proving API source, configuration,
      package metadata, and database files are not publicly addressable.
- [ ] Update Cart, Pulse, ROADMAP, AGENTS, package metadata, and server docs
      to state only the final architecture.

## 6. Certification and landing

- [ ] Run `bun run test` in `packages/server` and inspect every remaining test
      name for present-tense product value.
- [ ] Run `bun run test:all` at the Rip repository root.
- [ ] Run `bunx playwright test` in `packages/browser-tests`.
- [ ] Run `go test ./...` and `./test.sh` in Janus.
- [ ] Run `git diff --check` in both repositories.
- [ ] Perform independent empirical verification of `X-Sendfile`, API reload,
      App delivery, and migration state transitions.
- [ ] Run one cold review over both complete branch diffs before landing.
