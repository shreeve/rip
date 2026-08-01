# TODO — Rip Server simplification

Ordered implementation checklist for `rip-server-fixes`. Remove each item when
it lands; the commits and PRs retain the completed record.

## 1. Pin the contracts before deleting code

- [ ] State one launch contract: public serving always enters Caddy+Janus;
      `start!` only hands an API handler to the private worker runtime.
- [ ] State one App contract: the manager discovers and publishes `app/`;
      API source never mounts browser routes.
- [ ] State one file contract: ordinary files use registered Janus roots;
      API-authorized files use `X-Sendfile`.
- [ ] Choose and pin one pool readiness rule instead of branching on
      `RIP_ENV=production`.
- [ ] Choose and pin the manager switch surface: watching defaults on,
      `--no-watch` is the explicit opt-out, and no environment-named server
      mode changes lifecycle semantics.
- [ ] Pin the finite default file roots: `static/generated`, `public/`, and
      `app/`; the project directory is never an implicit public root.

## 2. Janus `X-Sendfile`

- [ ] Release a Janus version containing Capability 8 before changing Rip
      `@send`; an unknown private instruction header must never reach a client.

## 3. Rip `@send`

- [ ] Change `@send` to emit an absolute-path `X-Sendfile` instruction.
- [ ] Preserve explicit type, disposition, cache, ETag, and Last-Modified
      headers for Janus.
- [ ] Remove worker-side `Bun.file` response delivery from `@send`.
- [ ] Remove the server MIME table and public `mimeType` export.
- [ ] Remove worker-side file ETag and `If-None-Match` handling.
- [ ] Replace file-byte tests with instruction-header and header-precedence
      tests; leave delivery semantics in Janus tests.
- [ ] Update the response-helper documentation to distinguish `@body` bytes
      from `@send` edge-offloaded files.

## 4. Remove the standalone browser/server path

- [ ] Remove the public `client()` export.
- [ ] Remove standalone App walking, bundle assembly, generated boot HTML,
      runtime route, bundle route, and SPA fallback from `server.rip`.
- [ ] Remove the string/path overload of `start()` and the `start! 'app'`
      call shape.
- [ ] Remove direct public `Bun.serve` host/port/silent behavior; keep
      `start!` as worker handler handoff.
- [ ] Remove browser-delivery-only filesystem/compiler imports from
      `server.rip`.
- [ ] Remove `RIP_API_ONLY` from manager worker environments and server code.
- [ ] Delete the standalone start and `client()` test groups.
- [ ] Remove `client!` from package export pins and repository style examples.

## 5. Make worker tests use the production boot path

- [ ] Remove `APP_ENTRY` and loader-backed source imports from `worker.rip`.
- [ ] Require `APP_ARTIFACT` for every worker boot.
- [ ] Build fixture artifacts before worker lifecycle tests.
- [ ] Remove the fixture `node_modules/@rip-lang` symlink farm needed only by
      `APP_ENTRY`.
- [ ] Remove package-directory `tmp-*` cleanup now that every fixture lives
      under the OS temporary directory.
- [ ] Preserve readiness, boot failure, concurrency, drain, watchdog, and
      orphan tests against generated artifacts.
- [ ] Respawn a worker that crashes during boot under the readiness floor.
- [ ] Kill a worker that remains alive after its readiness deadline instead
      of leaving it live, unready, and unpublished.

## 6. Land edge policy before removing API middleware

- [ ] Pin one Caddy compression policy, including encodings, minimum size,
      already-encoded responses, streaming bodies, and MIME exclusions.
- [ ] Configure Caddy streaming compression for static, generated,
      `X-Sendfile`, and proxied API responses.
- [ ] Certify compression through the Janus data plane, including streaming
      and an already-encoded response.
- [ ] Remove `compress` and its buffering/encoding tests from server
      middleware.
- [ ] Write the Janus access-log contract for final status, cache result,
      selected upstream, retries, tenant, and `rip-mark`.
- [ ] Capture `Rip-Mark` from the response that Janus actually returns while
      stripping it before both the client and micro-cache.
- [ ] Expose the captured mark through the Caddy access-log placeholder used
      by the configured JSON log.
- [ ] Certify access logs for file hits, cache hits, API success, marked busy
      retry, unknown host, and responses with and without `rip-mark`.
- [ ] Remove the generic worker request `logger` and its formatting tests.
- [ ] Pin the baseline security-header set and fill-only precedence: explicit
      application headers win; the edge supplies only absent defaults.
- [ ] Apply the baseline to static files, generated files, SPA shells,
      `X-Sendfile`, proxied API responses, and Janus-generated errors.
- [ ] Certify header precedence and parity across every response class.
- [ ] Remove `secureHeaders`; document `@header` for application-specific CSP
      and response policy.
- [ ] Remove the non-cancelling `timeout` middleware; retain Janus transport
      bounds and the worker hung-handler watchdog.
- [ ] Remove `htmlJson`; API representation never changes from user-agent
      sniffing.
- [ ] Keep and re-certify `cors`, `sessions`, and `csrf` as application
      middleware.

## 7. Collapse manager modes

- [ ] Remove `--eager` and settle-time pool boot; the doorbell remains the
      single lazy activation path.
- [ ] Remove `RIP_ENV=production` branches from watch and readiness behavior.
- [ ] Remove `--watch` and `--allow-watch`; retain `--no-watch` as the
      explicit opt-out.
- [ ] Make configured symlinked and workspace dependencies participate in
      watch invalidation instead of watching only `*.rip` project files.
- [ ] Replace `readyWhen` environment branching with the pinned readiness
      rule.
- [ ] Bound control-plane writes during an outage so heartbeat retries cannot
      add one queued writer closure per tick.
- [ ] Remove eager/production-only state, help text, status output, and tests.
- [ ] Re-pin concurrency rules against watch on/off without environment
      aliases.

## 8. Tighten the package surface

- [ ] Remove the test-only public `App(fn)` helper.
- [ ] Make `startHandler` private or call `fetch` directly from `start()`.
- [ ] Decide whether `before` and `after` earn a distinct contract beyond
      ordered `use()` middleware; remove them if not.
- [ ] Move `resetGlobals` and direct `requestContext` access behind an
      internal test seam instead of the package entry.
- [ ] Re-pin the exact named export surface after deletions.

## 9. Remove obsolete project usage

- [ ] Change Cart and Pulse from `start! 'app'` to bare `start!`.
- [ ] Remove Cart's worker route for authored `app/styles.css`; Janus serves
      it from the live App root.
- [ ] Move Cart migration and seed setup out of worker import into an explicit
      one-off command.
- [ ] Remove the implicit project-directory live root from
      `configureEdgeFiles`.
- [ ] Add a negative integration test proving API source, configuration,
      package metadata, and database files are not publicly addressable.
- [ ] Update Cart, Pulse, ROADMAP, AGENTS, package metadata, and server docs
      to state only the final architecture.

## 10. Certification and landing

- [ ] Run `bun run test` in `packages/server` and inspect every remaining test
      name for present-tense product value.
- [ ] Run `bun run test:all` at the Rip repository root.
- [ ] Run `bunx playwright test` in `packages/browser-tests`.
- [ ] Run `go test ./...` and `./test.sh` in Janus.
- [ ] Run `git diff --check` in both repositories.
- [ ] Perform independent empirical verification of `X-Sendfile`, API reload,
      App delivery, and migration state transitions.
- [ ] Run one cold review over both complete branch diffs before landing.
