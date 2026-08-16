# TODO — Rip App

Open work only. Delete a line when it lands or moves into docs/tests.

## Gleanings from trust/sinatra/api (Aug 2026 survey)

The old Sinatra toolbox was trolled for helpers worth reviving. Most of
it already lives here under better names — `read` + the validator
vocabulary (rip/validate), `toName`/`toPhone`/`formatMoney`, `error!`/
`bail!` (rip/sites), `with`/`set`/`show`/`sql`/`factory` (rip/db + the
ORM), `age` (rip/time), `biject` (rip/googlesheets), `schemazing` →
`rip schema`. What remains, in rough value order:

- [ ] **`glean`** — multiline string → array of entries, comments
      (`# …`) and blank lines stripped. Pairs beautifully with `'''`
      heredocs for seeds, fixtures, and config lists. Likely home:
      rip/validate (the zero-dependency text vocabulary; browser-safe),
      optionally registered as a `lines` validator so `read 'codes',
      'lines'` works too.
- [ ] **Magic-link signin** — a self-authenticating slug
      (`time-code-hmac`) so the signin email carries a clickable link,
      not just a type-me code; verifies the HMAC before any DB hit.
      Plus: generate access codes from an alphabet excluding
      confusable letters (I/L/O). Medlabs-facing; pairs with the
      OTP-rate-limit open item from the Aug 2026 review.
- [ ] **Admin impersonation** — `session.adminId` distinct from
      `session.userId`, with `auth.proxying?` / `auth.onlyAdmin?`
      predicates, so support staff can act as a user first-class and
      auditably. Extension of the existing `auth.*` namespace.
- [ ] **Nested-attribute writes** — the one real gap `ingest` exposed:
      saving a parent with child rows (`{a,b}` permit lists, `edited`
      flags, `parent_attributes`-style) in one validated write.
      `schema :input` covers the validation half; the ORM has no
      nested-write half yet.
- [ ] **Request logging** — per-request line with elapsed ms, session,
      and parsed body — with the careful touch of scrubbing tempfile
      binary out of the logged payload before it hits the log.
- [ ] **Balanced array split** — divide a list into n groups where the
      leading groups absorb the remainder (`[1..10] / 3 → [4,3,3]`);
      smarter than each-slice for layouts and batching. And `probe` —
      the first non-null *result* of a mapping (find-map in one pass).
