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

An item that serves an inherited database is serving a user who does
not exist yet.

Measured ceilings that bound every performance and concurrency claim:
`WORKER_CONCURRENCY` defaults to `1` with a hard 503 gate, not a queue
(`worker.rip:6,57`), and apps run 2 workers (`manager.rip:27`). **A default
Rip app can have 2 statements in flight.** Harbor has 6 worker connections
and 10 lease connections. medlabs' SQL surface is point lookups, small
`LIKE` scans, one `nextval`, and two daily sweeps — zero `JOIN`, zero
`GROUP BY`, zero aggregate.

## Decisions parked — each needs an owner call before code

- [ ] **Full composite-UNIQUE modeling in the differ.** The plan now
      emits a loud `note-unique` step for every deployed composite
      constraint (landed; refuse-not-guess), but the differ still cannot
      DIFF them — the unique flag is per-column, and the model layer's
      expressible form is a unique index. Full modeling would
      rearchitect that for a constraint form the ORM never emits.
      Revive if hand-written composite-constraint tables become real.

## Landed

- **medlabs' schema dump is checked in and diffed on every run.**
  `api/schema.sql` is committed, and `test/api/schema.test.rip` runs
  `rip schema dump --check` as the first case of the suite — medlabs
  has no hosted CI, so its test suite is the build; a hosted CI, when
  it arrives, inherits the check by running the suite.

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
  property↔column mapping; `snakeCase`/`camelCase` survive only
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
  n = user.addTeams!    team, {role: 'member'}  # → 1  (links added)
  n = user.removeTeams! [red, blue]             # → 2  (links removed)
  r = user.setTeams!    [red], {role: 'member'} # → {added: 1, removed: 1}
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
  now forwards it — before, `defaultAdapter` hardcoded `0` and
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
  `serialize` stringifies objects written to them, so
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
  `canonicalInput` (`orm.js:1636-1638`) registers `name` and
  `snakeCase(name)` as writable input keys, so
  `User.create({first_name: 'x'})` succeeds today; `_hydrate`
  (`orm.js:2057-2065`) attaches non-enumerable snake aliases, so
  `user.first_name` reads today. The only place camelCase is forced is
  `toJSON`'s enumerable key set.
- **Raw SQL is never rewritten**, in either direction.
  docs/ORM.md ("Falling back to raw SQL") states the principle.
  Drizzle's refusal to touch `sql``` is the same line and it is right.
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
- `camelCase` is not total: `nickname_2` → `nickname_2`,
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

### The mapping ledger

What a `:model` can and cannot say about a table it did not create.
Bucket A is the set with **no workaround** — missing one disqualifies
the table entirely; raw `query!` still reads it, you just get rows
instead of instances.

**Shipped** (23): `@table`, `@tableWas`, `@primaryKey` (property +
column), natural keys, `@idStart`, `{column:}`, `{was:}`, nullability
(`!`/`?`), `[default]`, `@unique` (field and composite), `@index`,
`@timestamps`, `@softDelete`, the three relation kinds, `{foreignKey:}`,
`{as:}`, `{through:}`, `{targetKey:}`, relation optionality, `~type` /
`~:coercer` / literal-union coercion, `@mixin`, FK width following the
target's key, and cross-adapter FK suppression.

**Not shipped**, with what it costs:

| | why it is open |
|---|---|
| composite primary keys | every read path assumes a scalar identity (`_snapshot[pk]`, `find(id)`, `WHERE pk = ?`, the relation memo). A redesign, not an override. **No workaround** |
| polymorphic `belongsTo` | one FK plus a type column pointing at several models. **No workaround** |
| single-table inheritance | one table, a discriminator column, several models. **No workaround** |
| schema-qualified tables (`crm.accounts`) | refused with a positioned message — a dot would ride through the quoter as ONE identifier. Workaround: put the schema on the connection's search path and name the table bare |
| explicit SQL column type (`DECIMAL(10,2)`) | see **Money** below — the DDL is not the binding constraint, the wire is |
| `CHECK` constraints | deliberately deferred: `migrate.js` does not diff CHECKs, so adding one to the column spec creates permanent undetectable drift. **Revive with:** CHECK diffing in the planner |
| `ignored_columns` | a projection question, not a naming one — see above |

The three with no workaround each need a decision before any code.
Written out so they are not re-derived; **do not start one without
answering its open question.**

### Composite primary keys

```
Membership = schema :model
  @primaryKey [userId, teamId]
  userId! integer
  teamId! integer
```

A composite key is necessarily NATURAL — nothing generates a tuple —
so every part must be a declared required field, and the `@idStart`
rejection already written for natural keys carries over.

**Blast radius: 83 `primaryKey` references** across `orm.js` (63),
`schema.js` (9), `ts/schema.js` (7), `migrate.js` (4). Identity
stops being a value and becomes a tuple, which changes: `_snapshot`,
`persistedIdentity`, `find`/`findMany`, every
`WHERE pk = ?`, the relation memo's identity comparison (tuples need
`sameValue` element-wise), the `byId` maps in preload (keyed by
a joined tuple), the RETURNING check, `projectableFields`,
`jsonSchemaModelColumns`, and the DDL (a table-level
`PRIMARY KEY (a, b)` instead of an inline one).

**Open question: what happens to `@belongsTo` pointing AT such a
model?** A composite FK is two columns that must be written, read,
compared and constrained as a unit — a second feature at least as large
as this one. The cheap answer is to REFUSE it with a message, which
costs little because the classic composite-key table is a join table:
it points at others, and nothing points at it. Decide this first; it is
the difference between a contained change and an open-ended one.

**Revive when:** a table that is not a join table needs one.

### Polymorphic belongsTo

```
Comment = schema :model
  body! string
  @belongsTo Commentable, {polymorphic: true}   # commentable_id + commentable_type

Post = schema :model
  @hasMany Comment, {via: commentable}          # WHERE commentable_id = ? AND commentable_type = 'Post'
```

The target name becomes a ROLE rather than a model, and the `_type`
column holds a model name the registry resolves. The inverse side needs
its own option — `as:` already means "the accessor name", so Rails'
`has_many :comments, as: :commentable` cannot be spelled that way here;
`via:` is proposed above.

**Blast radius: ~17 relation sites, zero identity sites** — the
smallest of the three, and the only one that cannot destabilize what
has already shipped. Eager loading groups by `_type` and issues one
query per distinct type. No FK constraint is possible by nature, so the
DDL emits a NOTE the way cross-adapter relations already do.

**Open question: none blocking.** This one is ready to build.

### Single-table inheritance

```
Vehicle = schema :model
  @sti kind          # the discriminator column
  wheels! integer

Car = schema :model
  @inherits Vehicle  # same table, kind = 'Car'
  doors? integer
```

Subclass normalize = base fields ∪ own fields, base's table, base's pk.
Subclass queries add `WHERE kind = 'Car'`; base queries hydrate each row
into the subclass its `kind` names; INSERT writes the discriminator.

**Open question, and it is a real hazard: how does the base learn its
subclasses?** `Vehicle.toSQL()` must emit ONE table carrying the union
of every subclass's columns, with subclass-specific ones nullable. The
registry has no reverse lookup, and even with one, `Vehicle.toSQL()`
called before `Car` is declared would silently emit a table missing
Car's columns — a wrong table with no complaint, which is exactly the
failure class the column-type rejection above was just written to end.

Two candidate answers, neither free: declare the subclass columns on the
BASE (explicit, no ordering hazard, but then the subclass is only a
scope), or require the base to name its subtypes
(`@subtypes [Car, Truck]`) so the DDL is complete by declaration.
**Decide this before writing anything.**

**Note first:** `@mixin` plus a literal-typed `kind` field and a
`@defaultScope` already covers a good part of what STI is used for,
without one table's shape depending on another module's import order.

### Money

**Use integer cents.** Not a placeholder — it is the only exact
representation the current pipeline has end to end:

- `integer` → `INTEGER`, exact in the column, exact on the wire, exact
  in JS up to 2^53 cents (≈ $90 trillion), and the database can `SUM`,
  `ORDER BY`, and compare it.
- `number` → `DOUBLE`. Binary floating point; `0.1 + 0.2` is the whole
  argument.
- `~:Decimal` (from `rip/decimal`) validates and coerces exactly in JS,
  but `typeName` is `any`, so the column is **JSON** — the database
  cannot sum, index, or compare it.
- An explicit `{type: "DECIMAL(9,2)"}` escape hatch would be a **trap**,
  and this is the reason not to add one: `duckdb.js` decodes only
  temporal columns off `duckdbType` (`decodeRows`, `temporalKind`), so a
  DECIMAL comes back as a plain JSON number. The DDL would be right and
  every value would silently be a float. The DDL is not the binding
  constraint — the wire is.

**Revive when** more than two decimal places are needed (4dp unit
prices, tax rates) or the database must do the rounding. The fix is then
a real `decimal` field type mapping to `DECIMAL(p, s)` **and** a wire
decode that reconstructs a `Decimal` — a package + runtime + harbor
change, not a type override.
| `dependent: :destroy` / `ON DELETE CASCADE` | behavior, not mapping. A `beforeDestroy` hook or a DB constraint covers it |
| `belongsTo primary_key:` (FK to a non-pk column) | rare; the FK always references the target's declared key |
| HABTM with no join model | deliberate. There is always a join table; naming it as a model is the honest form, and it is what makes `{through:}` writable |

### Correctness items that are real but dormant

- **`json` fields never parse back.** `serialize` (`:1581`)
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
- **`CHECK` for literal-typed fields.** `SQL_TYPES` (`:2205`)
  renders a `literals` field as bare `VARCHAR`, and raw SQL over harbor
  is a first-class path that bypasses app-side validation. **But
  `migrate.js` does not diff CHECK constraints at all**, so adding one to
  the column spec creates permanent undetectable drift against every
  already-deployed table, with no plan step that can reconcile it. Net
  negative as specified. **Revive with:** CHECK diffing in the planner.
- **`validateAdapterRow`'s duplicate-canonical error** (`:1471`)
  names neither the table nor the two source columns.
- **`quoteIdent`'s error** (`:52`) lists *columns* when the caller
  typed *field names*.
- **`constraintIssue`** parses DuckDB's error *prose* for a
  column name. It now resolves that name through the model's
  `fieldOf` map when there is one, so a NOT NULL failure on a
  `{column:}`-mapped column reports the field. The unique-violation
  pattern still yields an INDEX name, which no map covers. Best fixed
  on the harbor side with structured errors.

### Runtime observations, unshipped paths

- **No cancellation plumbing in the ORM** — `grep -c signal
  src/runtime/orm.js` is `0`; `runSQL` (`:703-711`) passes no
  options. The adapter half works.
- **Transaction retry divergence.** `packages/db` retries
  `no_lease_available` / `no_such_session` / conflicts honoring
  `retryAfterMs` (db.rip `isRetryable` / `transaction`); the ORM
  receives `retryAfterMs` and discards it. **Do not "lift" it as-is:**
  the client's `transaction` puts `attempt! fn` *inside* the retry
  loop, so the user callback is replayed. Safe for `no_lease_available` (the failure
  precedes the callback) and for DB-only work (writes roll back), but a
  non-database side effect inside the callback — a charge, an email —
  runs twice. That is an API contract needing documentation and probably
  an opt-in, not a port. Unreachable today regardless: the 11th
  concurrent `begin()` triggers it and an app can produce 2.
- **`duckdb.js` buffers instead of streaming** — `await response.text()`
  (`:447`) reads the whole NDJSON body then re-parses it, materializing
  large results twice and forfeiting harbor's incremental delivery.
- **Lazy `currentAdapter`.** `orm.js:616` constructs at module
  evaluation, reading env at global scope. Note that laziness alone does
  not enable per-request configuration — that needs a factory or a
  request-context lookup.
- **`ttlMs` is never sent** on session open (`duckdb.js:540`), so every
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
transaction-scope identities. `duckdb.js` itself is runtime-portable (no
`node:`/`Bun.` references; both `process.env` reads guarded).

## Harbor (Rust)

- [x] **Ship v0.9.1.** Released — the `uniqueConstraints` catalog
      field, ten assets across five platforms; the rip-side mapping
      tolerates both 0.9.0 and 0.9.1 documents. The full check suite
      ran against a real v1.5.5 engine (official CLI + the
      v1.5.5-stamped extension) with every suite green, so the
      stable-engine precondition for deploying to `live` is met.
- [ ] Structured constraint errors (code, table, column, constraint), so
      the ORM stops parsing English.
- [ ] Reserve capacity for cancel/health requests so the control plane
      cannot be starved by data workers — the root cause of the wedge,
      of which a statement deadline is only containment.
- [ ] Multi-statement batch; cursor/chunked fetch; an Arrow content type
      (chunked fetch is what makes a true streaming `nextRow!` possible
      client-side — the JS API can be cursor-shaped today, but delivery
      is buffered until harbor can stream).
- [ ] `/catalog` sequences carry no schema field; two same-named
      sequences in different schemas are indistinguishable. Contrived
      under the `<table>_seq` convention, recorded so it is not
      re-discovered.
