# TODO — Rip DB

Open work only. Delete a line when it lands or moves into docs/tests.

This file was rewritten after a five-person design panel and a three-person
adversarial review. The adversarial pass cut it from ~40 items to 3. The
cut list is kept below with the evidence that would revive each item —
the findings are real, they just have no victims yet.

## Who this serves

Non-test `schema :model` declarations in the whole ecosystem:

| App | Models | Backend |
|---|---|---|
| `medlabs/api/models.rip` | 10 | harbor/DuckDB — the production app |
| `packages/sites/demos/cart/api/models.rip` | 3 | `bun:sqlite` — never touches harbor |

The `Model 'users'` facade has zero real call sites outside its own
definition, docs, and tests. Anything below that serves an inherited
database is serving a user who does not exist yet.

Measured ceilings that bound every performance and concurrency claim:
`WORKER_CONCURRENCY` defaults to `1` with a hard 503 gate, not a queue
(`worker.rip:6,57`), and apps run 2 workers (`manager.rip:27`). **A default
Rip app can have 2 statements in flight.** Harbor has 6 worker connections
and 10 lease connections. medlabs' SQL surface is point lookups, small
`LIKE` scans, one `nextval`, and two daily sweeps — zero `JOIN`, zero
`GROUP BY`, zero aggregate.

## Do now

- [ ] **Set `HARBOR_STATEMENT_TIMEOUT_MS` where harbor starts.** The
      client side landed (see below), so this is now safe to deploy and
      is the only layer that can recover a wedged pool: harbor's reaper
      interrupts from its own thread, while the cancel endpoint itself
      needs a free worker. Measured: 8 concurrent runaways make `/sql`,
      session-open, and `DELETE /sql/queries/<id>` all unanswerable;
      restarting with `HARBOR_STATEMENT_TIMEOUT_MS=5000` and **no client
      change** resolved it completely — each runaway returned
      `code: "cancelled"` and the pool stayed responsive throughout.
      Suggested `30000`. Belongs in the deployment runbook, not this repo.
      Not urgent: the wedge needs ~6 concurrent long statements and a
      default app can have 2 in flight (`WORKER_CONCURRENCY=1`, 2
      workers), none of them long. It is worth doing because it is the
      one failure with no self-recovery path.
- [ ] **`rip schema dump`** — a checked-in file stating the current shape
      of every table, diffed in CI. Purely additive: touches no read
      path, changes no SQL, breaks none of the 323 schema tests.
      `canonicalDeclared()` (`migrate.js:185`) already returns the
      structure and `__schemaRenderCreate` already renders it.
      **This is the highest-value item in the document** because it buys
      *evidence*: if undeclared columns or naming drift are real, a
      diffed dump surfaces them the day they appear; if they never
      appear, the entire projection question is answered empirically for
      the price of one command. Buy information before buying a rewrite.
      It is also why `snake()` magic never bit Rails teams — `schema.rb`
      answers "is that column `email` or `email_addr`?" by opening a file.
- [ ] **Migrate the one demonstrated victim.**
      `medlabs/api/routes/patients.rip:14` writes
      `.order('last_name, first_name')` — snake_case column strings
      against a camelCase model — and `medlabs/api/db.rip:47-50`
      hand-rolls a second camelizer for raw-SQL rows. The first can now
      be `.order({lastName: 'asc'}, …)`; the second still wants an
      opt-in result projection for the raw path.

## Landed

- **A table Rip did not name is now addressable.** Six mapping slots,
  all obeying ONE rule — *quoting picks the namespace*: a bare
  identifier is a Rip name Rip converts, a quoted string is the
  database's own, used verbatim.

  | | writes | means |
  |---|---|---|
  | `@table UserProfile` / `@table "USER_MASTER"` | bare or quoted | the table |
  | `@primaryKey patientId, {column: "PATIENT_ID"}` | bare + quoted | the pk property and its column |
  | `{column: "MRN_NBR"}` on a field | quoted | the column that field reads |
  | `{as: author}` on a relation | bare | the accessor |
  | `{foreignKey: "author_id"}` | quoted | the FK column |
  | `{through: Membership, targetKey: "team_id"}` | bare + quoted | the join model and its column |

  The rule is declared once, as data, in `src/runtime/vocab.js` — each
  option key maps to its namespace (`property`/`model`/`column`/
  `literal`) and one shared validator judges it, so the compiler
  (source tokens) and the runtime (hand-built descriptors reaching
  `__schema({…})`) cannot drift.

  Two consequences worth naming. `{column:}` **deletes the
  bijectivity** that made `snake(name)` a safe default, so every column
  — pk, field, FK, `created_at` — now claims through one ownership gate
  in `finishModelNorm`, and two owners for one column is a positioned
  error in the compiler and a `SchemaError` in the runtime. And
  `norm.columnOf` / `norm.fieldOf` are now the authority on the
  property↔column mapping; `__schemaSnake`/`__schemaCamel` survive only
  as the default for a name no map has heard of.

  `@hasMany X, {through: J}` is deliberately **not** a JOIN: the join
  rows come back on their own, the distinct targets in one `findMany`,
  and the grouping happens in JS — the same two-query shape every other
  relation uses, so no row duplication and no join-table columns leak
  onto target instances. Preloading N owners is 3 queries, not N+1. The
  join columns resolve LATE, off the join model's own `@belongsTo`
  declarations, and ambiguity (two `@belongsTo` to one end) is refused
  with the option that settles it, never guessed.

- **Natural keys, `hasOne through`, and writing a join model.**

  **Declaring the pk as a field is what makes it caller-supplied** —
  alongside an explicit `@primaryKey` naming it. There is no third
  reading: a declared pk field with a surrogate posture would be a
  `string` field over an INTEGER sequence column, and an undeclared
  natural key would be a column with no type. So no separate flag
  states it.

  ```
  @primaryKey patientId        nothing declares it → the runtime's
                               INTEGER surrogate, unchanged
  @primaryKey mrn              mrn is declared, with a type and
  mrn! string                  constraints → the caller supplies it
  ```

  It takes BOTH declarations on purpose. A bare `id! integer` with no
  `@primaryKey` stays exactly the collision it always was, because the
  default name is precisely where a silent posture flip would go
  unnoticed — the error now names the escape instead of just refusing.

  Everything downstream follows the declaration: no `CREATE SEQUENCE`,
  the column takes the field's own type and length, the INSERT writes
  it, `@idStart` is refused (nothing to seed), an absent key is a
  `SchemaError` naming the posture rather than a NOT NULL violation
  from the database, and `find(id)` types as the key's own type. A
  `belongsTo` to such a model gets an FK **as wide as the key it
  points at** — `VARCHAR` referencing `countries(iso)`, not the
  surrogate's `INTEGER`.

  `through:` now also works on `@hasOne` — the same two queries, one
  target instead of a list. `@belongsTo` still refuses it, and the
  message says why: it holds its key in its own row, so there is
  nothing to read through.

  Writing goes **through the join model**, never around it:

  ```
  await user.addTeams! team, {role: 'member'}   # → 1  (links added)
  await user.removeTeams! [red, blue]           # → 2  (links removed)
  await user.setTeams! [red], {role: 'member'}  # → {added: 1, removed: 1}
  ```

  Named off the ACCESSOR (`{as: labels}` → `addLabels`), because the
  accessor is the only name unique per relation — two relations to one
  target share a target name, and depluralizing an arbitrary `as:`
  would be a guess. Links go in via the join's own `insertMany`, so its
  fields, defaults, `@timestamps`, and validation all apply and extra
  required columns are passable as `attrs`; they come out via its
  `deleteAll`, so a `@softDelete` join soft-deletes. Adding an existing
  link is a no-op, not a second row — duplicate join rows would read
  back as duplicate targets. Every write busts the relation memo.

  Still unbuilt: `has_and_belongs_to_many` without a join model (there
  is always a join model here, and naming it is the honest form), and
  composite keys.

- **One deadline knob, three states, one place.** `timeoutMs` on an
  adapter or on a single statement: `> 0` runs a client clock and sends
  the same deadline to harbor; `0` runs no client clock and **inherits**
  harbor's deployment default (sends no field); `null` sends an explicit
  `0`, which harbor documents as "no limit". Harbor's protocol is
  per-request, so `query(sql, params, {timeoutMs})` is the same knob
  rather than a second one. `schema.connect({url, token, timeoutMs})`
  now forwards it — before, `__schemaDefaultAdapter` hardcoded `0` and
  an app could not set a deadline at all.
  The migration runner opts out through one wrapper (`migrate.js`
  `runSQL`), so all 13 of its statements go through a single seam
  instead of naming the funnel each time. Pinned in
  `test/schema/default-adapter.test.js`.

- **A structured route to every predicate.** `where()`'s object form
  grew comparison operators — `eq ne gt gte lt lte like ilike in nin
  between` — so `{age: {gte: 18, lt: 65}}` reads as one AND range, and
  `order()` accepts `{createdAt: 'desc'}` or an array of such objects
  alongside its trusted string. Both structured paths resolve every
  identifier against the model's columns and quote it, so a sort key or
  filter key taken from a request can no longer reach SQL unchecked.
  `eq`/`ne` collapse to `IS [NOT] NULL` for `null`, because `= NULL` is
  never true; empty `in`/`nin` render `1 = 0` / `1 = 1` rather than the
  syntax error `IN ()`. Directions are a closed set (asc/desc, each with
  optional NULLS FIRST/LAST) since ORDER BY is interpolated, not bound.
  The operator reading is gated on the field's declared **type**, never
  the value's shape: `json`, `any`, and array fields render as JSON and
  `__schemaSerialize` stringifies objects written to them, so
  `where({prefs: {like: true}})` on a json column stays an equality test
  against that document. The O4 trusted-string overloads are untouched.

## Settled

- **camelCase field names stay.** Not for the aesthetic reason first
  offered — `first_name` beside `@computed fullName` reads fine, and
  Rails does it daily. The real reason is structural: one field-name rule
  spans four schema kinds and only one of them is a database.
  `requireCanonicalName` runs unconditionally in the shared `_normalize`
  switch (`schema.js:460-463`), and `.pick()` on a model always yields a
  `:shape` (`schema.js:1676-1680`) which `src/projections.js` lifts
  verbatim into browser bundles. snake_case fields would push database
  naming into pure-validation schemas and client form code for a reason
  that exists only in a table the browser never sees.
- **This was never coupled to the query surface.** An earlier draft made
  camelCase conditional on funding operators. That was a category error:
  under snake_case field names the two-dialect chain
  `.where(active: true).where('created_at > ?', c)` is character-for-
  character identical, because the string bypasses the allow-list either
  way. The dialect seam is caused by trusted-string passthrough (O4), not
  by naming. Operators are worth funding on safety and ergonomics
  grounds, independently.
- **Scale of the naming question:** ~16 camelCase field names exist
  repo-wide, several of them guard-rejection fixtures (`mdmID`,
  `XMLPath`). Everything else is single-word lowercase where both
  conventions agree. The mapping fires on roughly 8% of field references.
- **Both spellings already work on both doors.**
  `__schemaCanonicalInput` (`orm.js:1636-1638`) registers `name` and
  `__schemaSnake(name)` as writable input keys, so
  `User.create({first_name: 'x'})` succeeds today; `_hydrate`
  (`orm.js:2057-2065`) attaches non-enumerable snake aliases, so
  `user.first_name` reads today. The only place camelCase is forced is
  `toJSON`'s enumerable key set.
- **Raw SQL is never rewritten**, in either direction. `db.rip:349-353`
  states the principle correctly. Drizzle's refusal to touch `sql``` is
  the same line and it is right.
- [ ] **Document the O4 seam.** `docs/` contains zero mentions of
      camelCase, snake_case, or O4 — the reasoning lives in two code
      comments and a test name. An undocumented ratified decision is
      indistinguishable from drift, and drift is what produces "why does
      my chain have two dialects" as a bug report. This is the actual gap.

## Shelved — real findings, no victims

Each is verified. Each needs a trigger before it is worth the blast
radius. **Revive-trigger is written on every one; do not re-litigate
without it.**

### Projection

Object shape is derived from `SELECT *` plus the database catalog
(`orm.js:999`, `:1555`, `:1922`), camelized by regex (`:68`), attached
`enumerable: true` (`:2050-2056`), and published by `toJSON`
(`:2190`, `Object.keys(this)`). Consequences, all real:

- `toJSON` and `toJSONSchema` publish different vocabularies.
- Undeclared columns ship in API responses.
- `__schemaCamel` is not total: `nickname_2` → `nickname_2`,
  `_internal` → `Internal`, `legacy_ISO_CODE` unchanged.
- Eager-loaded relations never serialize (`_relMemo` is non-enumerable
  by design, `:273-281`), so `includes()` pays for the preload and
  `toJSON` drops every row.

**Why shelved.** Every consequence requires a column the model does not
declare, and both real apps generate their tables from their models. The
headline security benefit is *void* for the production app: medlabs'
secret is the OTP `code` field, which is **declared**, so it would stay
enumerable and keep serializing under any projection rework. The app
already defends correctly with an explicit `toPublic()`
(`models.rip:23-29`) — which is the right pattern and the one to
document. Cost is the whole read path plus 37 test assertions that spell
`SELECT *` literally, i.e. re-baselining the regression net during the
surgery, stacked on a month of continuous churn in these same files.

**Revive when:** `schema dump` shows real undeclared columns or drift in
a production database.

**When revived, these corrections apply** (from adversarial review):

- Do **not** auto-serialize eager relations. Making the API contract
  depend on whether a caller preloaded turns an N+1 optimization into a
  breaking change, admits cycles (`user → account → users`), and makes
  payload size a function of repository internals. The interface is
  explicit — `toJSON(include: [...])` or a declared projection.
- Do **not** attach unknown columns non-enumerably. That is not
  isolation; the name can still collide with `toJSON`, `save`, a
  relation accessor, or a future framework property. Either don't select
  them, reject them, or hold them behind a `Symbol`/`extras` container.
- `toJSON === toJSONSchema` is not a real invariant. Hydration, model
  state, and serialization policy answer different questions — a field
  can be declared and still be write-only, private, or role-dependent.
  Serialization policy must be specified on its own, not derived from
  which properties happen to be enumerable.
- Internal naming metadata (`field.column`, `norm.fieldByColumn`, a
  column-keyed collision check) is a **prerequisite** for projection, not
  a follow-on. The first draft had this backwards.

### Naming overrides — SHIPPED, see Landed

`ignored_columns` and composite primary keys are what remain of this
section. Composite keys wait on a real table that needs one; every read
path assumes a scalar identity (`_snapshot[pk]`, `find(id)`,
`WHERE pk = ?`, the relation memo's identity), so it is a genuine
redesign rather than an override. `ignored_columns` is a projection
question, not a naming one — it belongs to the section above.

### Correctness items that are real but dormant

- **`json` fields never parse back.** `__schemaSerialize` (`:1581`)
  stringifies on write; there is no `JSON.parse` in `orm.js` or
  `schema.js`. Since `create()` runs `INSERT … RETURNING *`, the field is
  already a string when `create()` returns. **Zero declared `json` fields
  on the harbor path.** The cart demo hits this and solved it *at the
  adapter seam* (`cart/api/db.rip:52-56`) — probably where the fix
  belongs. **Revive when:** a model declares a `json` field.
- **A `was:` naming nothing deployed degrades to ADD + DROP.**
  `migrate.js:538-556`: when `pCols.get(col.was)` is `undefined` the
  rename branch never fires. Same hole in the table half (`:431-444`).
  **Not silent, contrary to an earlier draft of this file** — the drop is
  `class: 'destructive'` (`:605`) and `schema.make` refuses to generate
  the migration at all without `--allow-destructive` (`:1029`), then
  emits a numbered `.sql` an operator reads. A worthwhile fourth
  rejection alongside the three at `test/schema/migrate.test.js:701,710,719`,
  not a correctness bug. Also reword the self-rename message at `:520`,
  which says "rename the other field" — wrong for that case.
- **`CHECK` for literal-typed fields.** `__SCHEMA_SQL_TYPES` (`:2205`)
  renders a `literals` field as bare `VARCHAR`, and raw SQL over harbor
  is a first-class path that bypasses app-side validation. **But
  `migrate.js` does not diff CHECK constraints at all**, so adding one to
  the column spec creates permanent undetectable drift against every
  already-deployed table, with no plan step that can reconcile it. Net
  negative as specified. **Revive with:** CHECK diffing in the planner.
- **`__schemaValidateAdapterRow`'s duplicate-canonical error** (`:1471`)
  names neither the table nor the two source columns.
- **`__schemaQuoteIdent`'s error** (`:52`) lists *columns* when the caller
  typed *field names*.
- **`__schemaConstraintIssue`** parses DuckDB's error *prose* for a
  column name. It now resolves that name through the model's
  `fieldOf` map when there is one, so a NOT NULL failure on a
  `{column:}`-mapped column reports the field. The unique-violation
  pattern still yields an INDEX name, which no map covers. Best fixed
  on the harbor side with structured errors.

### Runtime observations, unshipped paths

- **No cancellation plumbing in the ORM** — `grep -c signal
  src/runtime/orm.js` is `0`; `__schemaRunSQL` (`:703-711`) passes no
  options. The adapter half works.
- **Transaction retry divergence.** `packages/db` retries
  `no_lease_available` / `no_such_session` / conflicts honoring
  `retryAfterMs` (`db.rip:161-175`, `:228-245`); the ORM receives
  `retryAfterMs` and discards it. **Do not "lift" it as-is:**
  `db.rip:228-231` puts `attempt! fn` *inside* the retry loop, so the
  user callback is replayed. Safe for `no_lease_available` (the failure
  precedes the callback) and for DB-only work (writes roll back), but a
  non-database side effect inside the callback — a charge, an email —
  runs twice. That is an API contract needing documentation and probably
  an opt-in, not a port. Unreachable today regardless: the 11th
  concurrent `begin()` triggers it and an app can produce 2.
- **`harbor.js` buffers instead of streaming** — `await response.text()`
  (`:384`) reads the whole NDJSON body then re-parses it, materializing
  large results twice and forfeiting harbor's incremental delivery.
- **Lazy `__schemaAdapter`.** `orm.js:616` constructs at module
  evaluation, reading env at global scope. Note that laziness alone does
  not enable per-request configuration — that needs a factory or a
  request-context lookup.
- **`ttlMs` is never sent** on session open (`harbor.js:444`), so every
  session silently takes the 300s maximum.
- **`import` mode bakes an absolute path** into compiled output. Harmless
  when bundled or run through the loader; broken if raw compiled `.js`
  ever ships.

Non-issues, measured, so nobody re-opens them: runtime inlining costs
nothing in any shipped path — all use `import` (`loader.js:105`,
`generate.rip:86`, `bundle.rip:189`) and Bun.build dedupes to one copy
(30-model app: 158 KB). Inline mode is single-file standalone and
*cannot* ship a multi-model app — `schema.js:22-31` throws on two runtime
copies in one process, which is what prevents 30 separate adapter and
transaction-scope identities. `harbor.js` itself is runtime-portable (no
`node:`/`Bun.` references; both `process.env` reads guarded).

## Harbor (Rust)

- [ ] `GET /catalog` — one call for the shape a migration diff needs, so
      the five `information_schema` / `duckdb_*` reads in `migrate.js`
      collapse to one and 1.5.5-vs-2.0.0 differences stop being ours.
- [ ] Structured constraint errors (code, table, column, constraint), so
      the ORM stops parsing English.
- [ ] Reserve capacity for cancel/health requests so the control plane
      cannot be starved by data workers — the root cause of the wedge,
      of which a statement deadline is only containment.
- [ ] Multi-statement batch; cursor/chunked fetch; an Arrow content type.
- [ ] README "Known limitations" still claims no cancellation. Stale.
