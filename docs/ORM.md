# The Rip ORM — `schema :model`

`schema` is a first-class declaration form in Rip. Most kinds (`:shape`,
`:input`, `:enum`, `:union`, `:mixin`) are validation-only; `:model` is
the one that reaches a database. One declaration is simultaneously:

1. **a validating type** — `User.parse data` / `User.safe data` run
   runtime validation, coercion, defaults, and refinements;
2. **a TypeScript type** — the compiler emits a typed face for editors
   and `tsc`;
3. **a persisted table** — DDL (`toSQL`), a query builder, relations,
   lifecycle hooks, transactions, and migrations.

The default database is DuckDB, reached over HTTP through
`duckdb-harbor`. Any database can be substituted through the adapter
contract (see [Bring your own database](#bring-your-own-database)).

A complete, working pair:

```rip
export User = schema :model
  firstName! string, 1..
  lastName!  string, 1..
  email!     email @unique
  phone?     string
  @times
  @hasMany Order

  beforeValidation: ->
    @email = @email.toLowerCase().trim() if typeof @email is 'string'

  fullName: ~> "#{@firstName} #{@lastName}".trim()

export Order = schema :model
  status  "draft" | "submitted" | "completed", ["draft"]
  total!  integer, 0..
  @belongsTo User
  @times
```

```rip
schema.setAdapter schema.connect url: 'http://127.0.0.1:9495'

u = User.create! firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com'
o = Order.create! userId: u.id, total: 4200

drafts = Order.where(status: 'draft').order(createdAt: 'desc').limit(10).all!
```

The postfix `!` on a call is Rip's *dammit* operator — call-and-await.
`User.create! data` is the awaited call; never write `await` in front of
it.

## Declaring fields

A field line is `name`, a modifier, a type, then optional constraints,
options, and markers, comma-separated:

```rip
name!    string                # required — absence is a validation error, column is NOT NULL
handle?  string, 2..24         # optional — nullable column
status   "open" | "closed", ["open"]   # unmarked, with a default
bio?     text
tags?    string[]              # array — stored as a JSON column
```

- `!` — required. Missing or `null` fails validation; the column is
  `NOT NULL`.
- `?` — optional. Nullable, and optional in the TypeScript face.
- unmarked — not presence-checked; pair it with a `[default]` and the
  default fills any absent value before validation runs.
- The type defaults to `string` when omitted (`label!`).

Field types and their columns: `string`/`email`/`url`/`phone`/`zip` →
`VARCHAR`, `text` → `TEXT`, `integer` → `INTEGER`, `number` → `DOUBLE`,
`boolean` → `BOOLEAN`, `date` → `DATE`, `datetime` → `TIMESTAMP`,
`uuid` → `UUID`, `json`/`any` → `JSON`. Arrays and nested schemas are
`JSON`. An unknown type name is a loud error, never a silent `VARCHAR`.

### Constraints

```rip
password! string, 8..100, /[A-Z]/    # length range + regex
price!    integer, 0..               # minimum only
iso!      string, 2..2               # exact length
slug!     string @unique, /^[a-z][a-z0-9]*$/
```

Ranges bound string length, numeric value, or array length. A string
field's `max` also renders as the column width (`VARCHAR(100)`). A regex
is written bare, not in brackets.

### Defaults

Defaults go in brackets: `[0]`, `[true]`, `[null]`, `[:draft]` (a
symbol is its string, so `[:draft]` defaults to `'draft'`). A default
fills in when the incoming value is `undefined` or `null`, before
validation.

### Enums and literal unions

Inline literal unions live on the field:

```rip
sex? "M" | "F" | "O" | "U"
```

Named enums are their own schema kind, referenced by name:

```rip
Role = schema :enum
  :admin
  :editor
  :viewer

User = schema :model
  role! Role, [:viewer]
```

Enum members may carry values (`:pending 0`); either the name or the
value validates, and parsing materializes the value. Both enum-typed and
literal-union fields render as `VARCHAR` columns; validation is the
app-side gate.

### Coercion and transforms

```rip
qty!    ~integer          # coerce the wire value ("5" → 5) before validation
ssn?    ~:ssn             # named coercer, registered with schema.registerCoercer
full!   string, -> it.first + " " + it.last   # transform: receives the whole raw input as `it`
```

A field has coercion or a transform, never both.

### Computed properties, methods, hooks

```rip
fullName: ~> "#{@firstName} #{@lastName}".trim()   # computed — evaluated on access, not persisted
size:     !> @firstName.length                     # eager-derived — computed at construction/hydrate, serializes
greet:    (prefix) -> "#{prefix} #{@fullName}"     # method
beforeSave: -> @name = @name.trim()                # lifecycle hook
```

Computed properties (`~>`) and methods live on the prototype and do not
serialize; eager-derived fields (`!>`) become own enumerable properties
and do.

The lifecycle hooks, in firing order:

| hook | fires |
|---|---|
| `beforeValidation` | before validation, on `save`/`create`/`upsert` |
| `afterValidation` | after validation succeeds |
| `beforeSave` | before the INSERT or UPDATE |
| `beforeCreate` / `beforeUpdate` | before the INSERT / the UPDATE (never on `upsert` — the branch is the database's to decide) |
| `afterCreate` / `afterUpdate` | after the INSERT / the UPDATE |
| `afterSave` | after either write completes |
| `beforeDestroy` / `afterDestroy` | around `destroy` |
| `afterCommit` / `afterRollback` | after the outermost COMMIT / ROLLBACK when a transaction is open; `afterCommit` fires immediately after the write otherwise |

On `create`/`upsert`, the caller's input is canonicalized and
field-validated once before the instance exists; `beforeValidation`
runs after that, ahead of the validation pass that judges refinements
(`@ensure`). The hook canonicalizes values that already parse — it
cannot rescue input that fails field validation.

`restore()` fires `beforeUpdate`/`afterUpdate`. Bulk paths —
`updateAll`, `deleteAll`, `insertMany`, and the through-write verbs —
skip per-instance hooks by contract.

### `@ensure` — refinements

Whole-record predicates, with an optional field to attribute the failure
to:

```rip
Signup = schema :model
  pw!  string, 8..
  pw2! string
  @ensure "passwords must match", :pw2, (u) -> u.pw is u.pw2
```

### `@mixin` — shared fields

```rip
Stamps = schema :mixin
  createdAt! datetime
  updatedAt! datetime

Event = schema :model
  name! string
  @mixin Stamps
```

A mixin's fields fold into the model. Declaring `createdAt`/`updatedAt`
through a mixin is the explicit-control alternative to `@times`
(declaring them as ordinary fields is otherwise rejected — they are
runtime-managed names).

### `@scope` and `@defaultScope`

```rip
Coupon = schema :model
  code!   string @unique
  active? boolean, [true]
  @scope :active, -> @where(active: true)
  @scope :since, (d) -> @where('created_at > ?', d)
  @defaultScope -> @order('code')
```

A scope's body runs with `this` bound to a query builder, so scopes
chain with everything else, starting from the model or mid-chain:

```rip
fresh = Coupon.active().since(cutoff).limit(20).all!
```

`@defaultScope` applies once, lazily, when the chain executes;
`.unscoped()` anywhere in the chain suppresses it. Scope names may not
shadow the query API (`where`, `limit`, `find`, …).

Field, method, computed, and scope names may not collide with the model
API (`save`, `find`, `toJSON`, `errors`, …) — the collision is rejected
at declaration.

## Directives

### `@table` and `@tableWas`

Without `@table`, the table name derives from the model name —
snake_cased and pluralized (`UserProfile` → `user_profiles`). `@table`
overrides it:

```rip
@table AccountEntry        # bare: a Rip name, snake_cased → "account_entry"
@table "USER_MASTER"       # quoted: the database's own name, verbatim
```

`@tableWas "legacy_orders"` is a one-time rename signal: the migration
differ reads it, plans `ALTER TABLE RENAME`, and you delete the
directive once the migration lands. It composes with `@table` —
`@tableWas` names the deployed table, `@table` the desired one.

### `@primaryKey` — surrogate or natural

Every model has a primary key; the default is an INTEGER surrogate named
`id`, fed by a sequence. `@primaryKey` renames it:

```rip
@primaryKey patientId                          # still a surrogate — just renamed
@primaryKey patientId, {column: "PATIENT_ID"}  # …reading a legacy column
```

**Declaring the primary key as a field is what makes it a natural key**
— a value the caller supplies. It takes both declarations:

```rip
Country = schema :model
  @primaryKey iso
  iso!  string, 2..2
  name! string
```

- Surrogate posture: the runtime owns the key. A caller-supplied value
  is refused; the real id arrives via `RETURNING`. `@idStart 10001`
  seeds the sequence.
- Natural posture: the caller owns the key. The INSERT writes it like
  any other column; an absent value is a structured validation error;
  `@idStart` is refused (there is no sequence); the field must be
  required (`!`) and scalar. A `@belongsTo` pointing at such a model
  gets a foreign-key column as wide as the key it copies (`VARCHAR`
  referencing `countries(iso)`, not `INTEGER`).

A bare `id! integer` with no `@primaryKey` does not flip the posture —
it is rejected as a collision with the runtime-managed key, and the
error names the natural-key form.

### `@times`

Adds `created_at` / `updated_at` (`createdAt` / `updatedAt` on
instances). Both are set on INSERT; `updated_at` bumps on every UPDATE
that actually writes something — a no-op save touches nothing. Callers
may not write them.

### `@softDelete`

Adds `deleted_at` and changes what "delete" means:

```rip
order.destroy!                  # UPDATE … SET deleted_at = now — the row stays
order.restore!                  # deleted_at = NULL
order.destroy! hard: true       # real DELETE

Order.all!                      # live rows only — every query filters deleted_at IS NULL
Order.withDeleted().all!        # live + deleted
Order.onlyDeleted().all!        # deleted only
Order.where(...).deleteAll!     # bulk soft delete (UPDATE)
Order.withDeleted().where(...).deleteAll!   # bulk hard delete (real DELETE)
```

`find` honors the filter too — a soft-deleted row is not found unless
the chain says `withDeleted()`. `restore()` is loud on models without
`@softDelete`.

### `@unique` and `@index`

```rip
email! email @unique                 # single-column unique index, on the field
@unique [:partnerId, :mrn]           # composite unique index
@index total                         # plain index
@index [:USER_NAME]                  # columns resolve through the mapping — either side works
```

Column lists take bare names or `:symbols` in field space; each resolves
through the model's property↔column map. Unique tuples are also what
`upsert` conflict targets validate against.

### `@idStart`

```rip
@idStart 10001
```

Seeds the surrogate-key sequence. Refused on natural keys, and refused
under a shared sequence (see below) — there the seed belongs to the
sequence, not to any one table.

### `schema.sequence` — one counter for the whole database

By default each table's surrogate key draws from its own
`<table>_seq`, so ids collide across tables: patient 1 and order 1 both
exist, and an integer alone never says which row it names. A database
can declare one counter for all of them instead:

```rip
schema.sequence 'id'                 # once, beside the models
schema.sequence 'id', start: 10001   # …with a seed
```

Every surrogate key then defaults from `nextval('id')` and no two rows
in the database share an id. The column stays `INTEGER`, each table
still has its own `id`, and the values are merely sparse per table —
they were never a count of anything.

It is stated once, for the database, and deliberately not as a
per-model directive: a shared counter holds only if every table draws
from it, and a per-model spelling would offer a way to get that half
right. Declaring it twice with the same name is idempotent; with a
different one it throws. `schema.sequence()` reads it back;
`schema.sequence null` clears it.

The sequence is the database's object, not any table's, so `rip schema
dump` states it once at the top of the file and `rip schema plan`
creates it in its own `create-sequence` step ahead of the tables that
default from it. Dropping a table never drops it. Moving an EXISTING
database onto a shared sequence plans one `alter-default` per table —
which governs new rows only, so ids become unique from that point
forward, not retroactively.

#### After a load that supplied its own ids

A sequence is an object in its own right, independent of the rows in
the tables that draw from it, so an INSERT carrying an explicit id does
not advance it:

```
sequence before                     305
INSERT … VALUES (999999, …)         305    ← unchanged
next default-assigned id            306
```

Any restore, import, or bulk load that supplies ids therefore leaves
the counter sitting behind them, and the next ordinary insert collides.
A shared sequence makes this better, not worse: one counter covers the
whole load, so there is one thing to put right rather than one per
table.

Putting it right is not a reset. DuckDB refuses to drop or replace a
sequence while a column still defaults from it:

```
CREATE OR REPLACE SEQUENCE id START 10002
→ Dependency Error: Cannot drop entry "id" because there are entries
  that depend on it
```

Advance it instead — one statement, nothing dropped:

```sql
SELECT max(nextval('id')) FROM range(500);   -- 306 becomes 806
```

`range(N)` draws N values and throws them away; size N at or above
`highest id the load wrote − where the counter sits`. The gap that
leaves costs nothing, because ids under a shared sequence were never a
count of anything.

The alternative is to not supply ids at all: insert in dependency
order, let the sequence assign each row, and carry an old→new map to
rewrite the foreign keys with. That leaves the counter correctly
positioned for free, and is usually the better shape for a renumbering
load.

### Relations: `@belongsTo`, `@hasOne`, `@hasMany`

```rip
@belongsTo User                                    # fk user_id on THIS table; accessor `user`
@belongsTo Partner?                                # optional — nullable FK, accessor may resolve null
@belongsTo User, {as: author, foreignKey: "author_id"}
@hasOne  Profile                                   # fk on the TARGET table; accessor `profile`
@hasMany Order                                     # accessor `orders` (pluralized)
@hasMany Team, {through: Membership}               # via a join model
@hasOne  Insurer, {as: payer, through: Enrollment}
@hasMany Study, {through: Enrollment, targetKey: "study_id"}
```

Options (note the quoting — see the namespace rule below): `{as:}`
renames the accessor (a bare Rip name); `{foreignKey:}` names the FK
column (a quoted database name); `{through:}` names the join model (a
bare model name); `{targetKey:}` names the target-side column on the
join table (quoted; requires `through`). A trailing `?` on the target
(`Partner?`) makes the relation optional — the FK column is nullable.

Accessor names default off the target model; `{as:}` names the role,
and on a `@belongsTo` the FK column follows the role — `{as: reviewer}`
derives `reviewer_id`, so two relations to one model each carry their
own column with no further spelling:

```rip
@belongsTo User, {as: author}      # author_id
@belongsTo User, {as: reviewer}    # reviewer_id
```

An explicit `{foreignKey: "..."}` always wins — it is the door for a
column the database already owns under another name.

Accessors are async and memoized per instance:

```rip
user   = order.user!                 # one query, then cached
orders = user.orders!
orders = user.orders! reload: true   # bust the cache
```

For a `through` relation, both key columns live on the join model and
resolve late, from the join model's own `@belongsTo` declarations:
exactly one `@belongsTo` per end is the automatic answer; zero or two is
refused with the option that settles it (`foreignKey:` for the owner
side, `targetKey:` for the target side). A self-referential relation
whose join model declares only one `@belongsTo` to the shared target is
refused too — one column cannot hold both ends of a link:

```rip
Follow = schema :model
  @belongsTo User, {as: follower, foreignKey: "follower_id"}
  @belongsTo User, {as: followed, foreignKey: "followed_id"}

User = schema :model
  name! string
  @hasMany User, {as: followers, through: Follow,
                  foreignKey: "followed_id", targetKey: "follower_id"}
```

`{through:}` on a `@belongsTo` is refused — it holds its key in its own
row, so there is nothing to read through.

## Naming: quoting picks the namespace

One rule governs every name a model writes:

> A **bare identifier** is a Rip name — Rip converts it (snake_cases,
> pluralizes). A **quoted string** is the database's own name — used
> verbatim.

| writes | means |
|---|---|
| `@table UserProfile` / `@table "USER_MASTER"` | the table |
| `@tableWas "legacy_orders"` | a one-time rename signal the differ consumes |
| `@primaryKey patientId, {column: "PATIENT_ID"}` | the pk property and its column |
| `{column: "MRN_NBR"}` on a field | the column that field reads |
| `{was: "given_name"}` on a field | a column-rename signal |
| `{as: author}` on a relation | the accessor name |
| `{foreignKey: "author_id"}` | the FK column |
| `{through: Membership, targetKey: "team_id"}` | the join model and its column |

Properties stay camelCase in Rip (`firstName`), columns snake_case in
SQL (`first_name`); the conversion is automatic and bidirectional, and
`{column:}` overrides it per field. Every column has exactly one owner —
a field whose column collides with a `@belongsTo` FK, a `@times`
column, or another field's `{column:}` is rejected at declaration.

This is how you address a table you did not create — declare only the
columns you touch:

```rip
Patient = schema :model
  @table "MDM_PATIENT"
  @primaryKey patientId, {column: "PATIENT_ID"}
  mrn!       string, {column: "MRN_NBR"}, @unique
  firstName! string
```

Reads select `*`, so columns the model does not declare still hydrate
onto instances (and appear in `toJSON`) under their camelized names;
writes only ever touch declared fields and relation FKs. Rip names with
consecutive capitals (`mdmID`, `XMLPath`) are refused wherever a name is
derived — the snake/camel round-trip cannot reproduce them; spell them
`mdmId`-style, or name the column exactly by quoting it.

## Reading: the query surface

Reads start on the model — `find`, `with`, `findMany`, `where`,
`order`, `limit`, `offset`, `includes`, `withDeleted`, `onlyDeleted`,
`unscoped`, any `@scope` — and chain until a terminal executes:

```rip
user   = User.find! 7                       # by primary key → instance or null
user   = User.with! email: e                # by conditions → THE match (null if none, 2+ throws)
user   = User.with! 'phone IS NULL AND name = ?', name    # SQL text + params, same contract
users  = User.findMany! [1, 2, 3]           # by primary keys → array
one    = User.where(email: e).first!        # → whichever row sorts first — ambiguity tolerated
all    = Order.where(status: 'draft').all!  # → array of instances
n      = Order.where(status: 'draft').count!
page   = Order.order(createdAt: 'desc').limit(20).offset(40).all!
```

The three lookups split by what the caller means, one meaning per name:

- **`find(pk)`** — primary keys only. Unique by construction, so it
  needs no ambiguity story. `null`/`undefined` are loud errors, not a
  silent `WHERE pk IS NULL` miss.
- **`with(cond)`** — the exactly-one conditions lookup, in either
  `where` dialect (a conditions object, or SQL text with params). It
  fetches with `LIMIT 2`, so the uniqueness check is free: zero rows
  is a normal miss (`null`), one is the answer, and two means the
  condition the caller assumed unique is not — a broken invariant,
  thrown loudly (keys only in the message, never values) instead of
  silently picking a winner.
- **`where(cond).first!`** — the explicit "whichever comes first"
  read, for when ambiguity is genuinely acceptable.

All three route through the builder, so they honor `@defaultScope` and
the soft-delete filter; `Model.unscoped().where(id: n).first!` is the
escape hatch.

### `where` — two dialects, by design

`where` has two overloads, and the split is a ratified owner decision
(recorded as **O4**):

**The structured object form** speaks Rip's namespace. Keys are field
names (either spelling — `firstName` or `first_name` both reach the
same column); every key is validated against the model's columns and
quoted; values bind as parameters. It is safe for request-derived keys
and values.

```rip
User.where(lastName: 'Smith')                     # equality
Order.where(status: ['draft', 'submitted'])       # IN (…); [] matches nothing
User.where(phone: null)                           # IS NULL
User.where(lastName: /pat/i)                      # a real regex — regexp_matches, flags carry (i, m, s)
Order.where(total: {gte: 100, lt: 5000})          # operators — several read as AND
User.where(firstName: {ilike: 'ada%'})
Order.where(createdAt: {between: [monday, friday]})
```

The operator set: `eq ne gt gte lt lte like ilike in nin between`.
`eq`/`ne` collapse to `IS [NOT] NULL` for `null`; empty `in`/`nin`
render constant predicates rather than the syntax error `IN ()`. On
fields whose declared type is itself an object (`json`, `any`, arrays)
an object value is an equality test against the document, never an
operator map — the field's declared type decides, not the value's
shape. An `undefined` value is refused loudly: an absent parameter is
not a filter, and rendering it would turn a missing request param into
a silent empty result. Pass `null` to match `IS NULL`, or omit the key.

**The trusted string form** is caller-authored SQL in the *database's*
namespace — snake_case column names, `?` placeholders — passed through
verbatim with its parameters:

```rip
Patient.where('dob BETWEEN ? AND ?', "#{y}-01-01", "#{y}-12-31")
Patient.where('(LOWER(first_name) LIKE ? OR LOWER(mrn) LIKE ?)', "#{q}%", "#{q}%")
```

The string is trusted: nothing validates or rewrites it. That is the
point — it is the door to any predicate the structured form cannot
spell. Never interpolate untrusted input into the string itself; values
always ride as `?` parameters. The same two-dialect seam applies to
`order`.

Successive `where` calls AND together, in either dialect, mixed freely.

### `order`, `limit`, `offset`

```rip
Order.order(createdAt: 'desc')                       # structured — validated and quoted
Patient.order(lastName: 'asc', firstName: 'asc')     # several keys, in order
Order.order([{status: 'asc'}, {total: 'desc nulls last'}])
Patient.order('last_name, first_name')               # trusted string, database namespace
```

Structured directions are a closed set: `asc`, `desc`, each optionally
with `nulls first` / `nulls last`. `limit` and `offset` accept only
actual non-negative safe integers — no numeric strings, because a
request-derived string is exactly the injection surface they close.

### Bulk writes: `updateAll`, `deleteAll`

```rip
n = Order.where(status: 'draft').where('created_at < ?', cutoff).updateAll! status: 'cancelled'
n = Session.where('expires_at < ?', now).deleteAll!
```

Both return the number of affected rows, bypass validation and
per-instance hooks (the bulk contract), and honor `@defaultScope`,
`@times` (`updateAll` bumps `updated_at`), and `@softDelete`
(`deleteAll` soft-deletes unless the chain says otherwise). Both refuse
a chain carrying `order`/`limit`/`offset` — DuckDB's UPDATE and DELETE
accept only a WHERE, and silently widening a scoped mutation is worse
than refusing.

### Eager loading: `includes`

```rip
users  = User.includes('orders').all!
orders = Order.includes('user', 'partner').where(status: 'open').all!
users  = User.includes(orders: 'items').all!         # nested, any depth
```

Preloading fills the same per-instance memo the accessors use, so
`user.orders!` afterwards costs no query. The strategy is one query per
relation per nesting level (`WHERE fk IN (…)`) — never a JOIN, so there
is no row duplication and no join-table columns leak onto target
instances. A `through` relation preloads in two queries (the join
rows, then the distinct targets) plus a JS grouping step, for any
number of owners.

## Instances and persistence

### `create` and `save`

```rip
u = User.create! firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com'
```

`create` canonicalizes input (either key spelling works; unknown keys
and runtime-managed keys — the surrogate pk, timestamps, `deletedAt` —
are refused loudly), validates, runs the full hook lifecycle, issues
`INSERT … RETURNING *`, and absorbs the returned row, so the instance
carries its id and timestamps immediately.

`save` on a loaded instance is dirty-tracked: every instance snapshots
its column values at hydrate/save time, and `save` writes only the
fields that changed. **A no-op save issues no SQL.**

```rip
u = User.find! 7
u.firstName = 'Grace'
u.save!            # UPDATE "users" SET "first_name" = ?, "updated_at" = ? WHERE "id" = ?
u.save!            # nothing changed — no SQL
u.savedChanges     # Map { 'firstName' → ['Ada', 'Grace'], 'updatedAt' → […] }
```

`set` is assign-and-save in one call — the same dirty tracking, hooks,
and validation as the assignments-then-`save!` spelling, just fused.
Every key must name a declared field or belongsTo FK (either
spelling); an unknown key throws before anything is assigned, so a
typo can never become a silently-unsaved property:

```rip
u.set! firstName: 'Grace', phone: null    # one UPDATE
```

`savedChanges` is a `Map` of `property → [before, after]` for the most
recent save — an INSERT records `[null, value]` per written field. The
`afterCreate`/`afterUpdate`/`afterSave` hooks read the just-completed
diff.

Snapshots are deep copies and the comparison is structural, so even an
in-place mutation of an object-valued field (`order.items.push item`)
is caught. `markDirty` is the override for the opposite case — it
forces a column into the next UPDATE when its value compares clean:

```rip
order.markDirty 'items'   # rewrite items even though nothing changed
order.save!
```

Database constraint violations translate into the same structured
`SchemaError` a validation failure throws — a save tripping a UNIQUE
index reports `{field: 'email', error: 'unique', message: 'email
already taken'}` in `error.issues`, with the raw database error as
`error.cause`.

A `save`, `destroy`, or `restore` whose row has vanished — the
statement targeted the instance's primary key and the database
affirmed zero rows — throws the same structured `SchemaError` with
`{error: 'stale'}`, and the instance drops its persisted state: it
stops claiming a row the database revoked. (Only an affirmative
zero triggers this — a bare `rowCount: 0` from an adapter means "the
adapter did not say", not "zero rows".)

### `upsert`

```rip
user = User.upsert! {email: 'ada@example.com', firstName: 'Ada'}, on: :email
link = PanelItem.upsert! {panelId: p.id, testId: t.id, position: 3}, on: [:panelId, :testId]
```

`INSERT … ON CONFLICT (…) DO UPDATE … RETURNING *`. The conflict target
must **exactly** match a declared unique tuple — the primary key, a
`@unique` field, or a `@unique [...]` index; a subset, superset, or
merely-indexed column is refused, because the database could not
arbitrate it. When every written column is part of the target the
statement degrades to `DO NOTHING`, and `upsert` then reads back the
authoritative row by the conflict target. `beforeCreate`/`beforeUpdate`
never fire (the branch is decided in the database); validation,
`beforeValidation`/`beforeSave`, and — when a row was written —
`afterSave` do.

### `insertMany`

```rip
items = OrderItem.insertMany! [
  {orderId: o.id, testId: 1, price: 4200}
  {orderId: o.id, testId: 2, price: 1300}
]
```

The bulk path: every row is canonicalized and validated first — all
failures collect into one `SchemaError`, issues prefixed `[i].field`,
before any SQL — then one multi-VALUES `INSERT … RETURNING *` returns
hydrated instances. **Per-instance lifecycle hooks are skipped**; that
is the documented bulk contract (it is also what the through-write
verbs build on).

### `reload`

```rip
order.reload!
```

Re-reads the row by primary key, resets the snapshot, dirty set,
`savedChanges`, and the relation cache. Loud if the row is gone.

### Serialization: `toJSON` and the `toPublic` pattern

`toJSON` mirrors the instance's enumerable own properties: the primary
key, declared fields that hold values, timestamp columns, `deletedAt`,
FK columns, and eager-derived (`!>`) values. Internal state and the
snake_case aliases are non-enumerable; methods and computed properties
live on the prototype. Keys are camelCase.

Preloaded relations are deliberately **not** serialized — the relation
cache is non-enumerable. An API payload whose shape depends on whether
some caller happened to preload would turn an N+1 optimization into a
breaking change (and admits cycles: `user → orders → user`).
Serialization is explicit.

The way to shape API responses is a `toPublic` method on the model —
the canonical projection every route returns, with server-side fields
left out:

```rip
export User = schema :model
  email!         email @unique
  firstName?     string
  lastName?      string
  code?          string        # OTP — server-side only
  codeExpiresAt? datetime
  @times

  fullName: ~> "#{@firstName ?? ''} #{@lastName ?? ''}".trim() or @email

  toPublic: ->
    id:        @id
    email:     @email
    firstName: @firstName
    lastName:  @lastName
    fullName:  @fullName
```

Validation-only projections (`User.pick 'id', 'email'`) derive `:shape`
schemas for inputs and browser bundles; they do not change what an
instance serializes.

## Writing a `through` relation

A `through` link is a row in the join table, not a column — so it is
the one relation the owner can write. Each `through` relation gets
three verbs, named off the **accessor** (`teams` → `addTeams`;
`{as: labels}` → `addLabels`):

```rip
n = user.addTeams!    team, {role: 'member'}   # → 1   links added
n = user.removeTeams! [red, blue]              # → 2   links removed
r = user.setTeams!    [red], {role: 'member'}  # → {added: 1, removed: 1}
```

These are dammit calls — the postfix `!` *is* the await; writing
`await user.addTeams! team` compiles to a double await and is wrong.
Arguments are instances or bare identities, one or an array; an unsaved
instance is refused by name.

Writes go **through the join model**, never around it: links insert via
the join's own `insertMany`, so its fields, defaults, `@times`,
and validation all apply — a join model with required columns of its
own works by passing them as the second (`attrs`) argument, and a
missing required attr is a structured validation error. Links remove
via the join's `deleteAll`, so a `@softDelete` join model soft-deletes
its links. Per-row hooks are skipped (the `insertMany` bulk contract).

`add` is idempotent — linking something already linked is a no-op, not
a second row. `set` computes both halves from one read of the current
set and validates the fresh rows *before* deleting anything, so a `set`
whose insert half cannot succeed has not destroyed the links it was
replacing. Every write invalidates the owner's relation cache,
including sibling accessors reading through the same join model.

A model used as `{through:}` is a **link table by declaration**, and its
DDL says so: `toSQL()` derives a unique index over the link pair
(`idx_memberships_team_id_user_id`), so the same link cannot exist
twice — even when two processes race to add it, which no client-side
check can prevent. `addX` treats the resulting unique violation as the
no-op it means. Declaring `@unique [ownerFk, targetFk]` yourself is the
same index (no double emit); a plain `@index` over the pair is refused —
the pair must be unique.

## Transactions

```rip
schema.transaction! ->
  order = Order.create! { ...orderAttrs, totalPrice: total }
  for item in items
    OrderItem.create! orderId: order.id, testId: item.testId, price: item.price
  order
```

The transaction propagates **ambiently** (via `AsyncLocalStorage`):
every ORM call inside the block routes through the transaction's
connection with no changes to model code. The block returning commits;
the block throwing rolls back and rethrows. The block's return value is
the transaction's.

- Nesting on the same adapter joins the ambient transaction (no
  savepoints — one commit, one rollback).
- A different adapter is independent: each adapter has its own ambient
  slot, and cross-adapter atomicity is never pretended.
  `schema.transaction! {on: otherAdapter}, -> …` targets a specific
  adapter.
- `afterCommit` hooks run after the outermost COMMIT — **outside** the
  transaction, so they can no longer roll anything back;
  `afterRollback` runs after a ROLLBACK. A row saved twice in one
  transaction gets one callback.
- A ROLLBACK first restores each written instance (on models declaring
  `afterCommit`/`afterRollback`) to its pre-write state, so the hooks
  observe what the database now holds — an instance created inside the
  transaction returns to unpersisted with no id, and a later `save!`
  re-creates it.
- A COMMIT that itself fails is **indeterminate**: the writes may or
  may not be durable, so neither hook family runs and instance state
  is not restored — the error says to verify the rows before retrying.
- The adapter must implement `begin()` (see the contract below);
  `schema.transaction` is loud when it does not.

## Connecting

The ORM routes every statement through an adapter. Three ways to
install one:

```rip
# 1. Explicitly, in the models entry:
schema.setAdapter schema.connect url: 'http://127.0.0.1:9495', token: process.env.RIP_DB_TOKEN

# 2. Environment only — nothing installed, the default duckdb-harbor
#    adapter reads RIP_DB_URL and RIP_DB_TOKEN.

# 3. Per model, for a second database:
analytics = schema.connect url: 'http://analytics:9495'
Event = schema :model, on: analytics
  name! string
```

`schema.connect {url, token, timeoutMs}` **builds** an adapter without
installing it (a bare URL string also works); `schema.setAdapter`
installs one process-wide. A model's `on:` adapter wins over the global
one. A first ORM call with nothing configured anywhere fails naming the
fix, not with a mystery connection error. (`rip/db`'s `connect!` also
routes the ORM through its adapter, so an app using both tiers
configures once.)

`timeoutMs` is one knob with three states:

| value | meaning |
|---|---|
| `> 0` | a client-side clock, and the same deadline sent to harbor |
| `0` (the default) | no client clock; **inherit** harbor's deployment default (`HARBOR_STATEMENT_TIMEOUT_MS`) |
| `null` | no limit anywhere — the documented opt-out for long statements (the migration runner uses it) |

Direct adapter callers can override per statement:
`adapter.query sql, params, {timeoutMs}`.

## Bring your own database

The storage boundary is **Adapter Contract v2** — the cart demo runs
these same models on `bun:sqlite` with a ~20-line adapter and no other
changes.

One method is required:

```
query(sql, params) → { columns, data, rowCount }
```

- `columns` — `[{name}, …]`, one per result column, `name` a non-empty
  string (the database's own spelling; harbor also carries `type` for
  its temporal decode).
- `data` — an array of **row arrays**, values positionally matching
  `columns`.
- `rowCount` — for mutations, the number of rows the statement actually
  affected. It must be truthful: `updateAll`, `deleteAll`, and the
  through-write remove/set counts are read from it, so an adapter that
  reports 1 for everything makes every bulk operation claim one row.
  DuckDB itself answers a bulk UPDATE/DELETE with a one-row result
  whose single `Count` column carries the number — the ORM reads that
  shape first and falls back to `rowCount`. On write results, `rows` is
  accepted as an alias for `rowCount`.

The database must support `INSERT … RETURNING` — `create`, `save`,
`upsert`, and `insertMany` require the returned row (the create path
refuses to mark an instance persisted when the returned row carries no
primary key).

Optional, feature-detected:

- `begin()` → `{query, commit, rollback}` — a handle whose `query` has
  the same contract, pinned to one connection. Without it,
  `schema.transaction` refuses and `rip schema migrate` warns that
  migrations apply non-transactionally.
- `catalog()` → the deployed schema as one document —
  `{harborVersion, duckdbVersion, tables, sequences}`, the
  duckdb-harbor `GET /catalog` contract (harbor ≥ 0.9.0): tables with
  columns, primary keys, genuine `CREATE INDEX` indexes, structural
  foreign keys, and (harbor ≥ 0.9.1) unique constraints — a document
  without that field reads as none. The migration verbs (`plan` / `status` /
  `make` / `migrate`) require it and refuse loudly without it; the
  ORM's runtime read/write path never calls it.
- `capabilities` — a truthful object; harbor declares
  `{tx: true, ddlTransactional: true}` (DuckDB rolls DDL back with the
  transaction, so the migration runner may claim whole-file rollback).

**The adapter owns value decoding — with one temporal backstop.** The
harbor adapter decodes temporal columns to real `Date`s keyed off each
column's `duckdbType` (and encodes `Date` params to ISO-8601 UTC on
the way out). For an adapter that skips that, the ORM coerces the
columns whose *declared* type is temporal (`date`/`datetime` fields,
plus the `@times`/`@softDelete` columns) through the same codec
on hydrate: `Date`s pass through untouched, ISO-8601 / SQL-timestamp
text and epoch-millisecond numbers become the same instant, and a
value that cannot be read as an instant rejects loudly naming the
column. Every other column stores whatever the adapter returned,
verbatim. The same goes for JSON columns — the ORM stringifies objects
written to `json` fields but never parses on read.

The worked example is the cart demo's adapter, condensed from
`packages/sites/demos/cart/api/db.rip`, including that json-decode
step:

```rip
import { Database } from 'bun:sqlite'
import { User, Product, Order } from './models.rip'

db = Database.new "#{import.meta.dir}/cart.sqlite"

# Columns the schema declares as JSON — only these decode on read, so a
# VARCHAR value that merely looks like JSON is left untouched.
jsonCols = Set.new([...(User.toSQL() + Product.toSQL() + Order.toSQL())
  .matchAll(/"?(\w+)"?\s+JSON\b/g)].map((m) -> m[1]))

globalThis.__ripSchema.__schemaSetAdapter
  query: (sql, params) ->
    bound = (params or []).map (p) ->
      if p? and typeof p is 'object' and not (p instanceof Date) then JSON.stringify(p) else p
    stmt = db.query(sql)
    names = stmt.columnNames
    data = stmt.values(...bound) or []
    decode = (v, i) ->
      if jsonCols.has(names[i]) and typeof v is 'string'
        try return JSON.parse(v) catch then return v
      v
    {
      columns:  names.map((n) -> { name: n })
      data:     data.map((row) -> row.map(decode))
      rows:     data.length
    }
```

## Falling back to raw SQL

Aggregates, window functions, analytics — anything the builder does not
spell — belong in raw SQL, which is a first-class path, never rewritten
in either direction:

```rip
import { sql } from 'rip/db'

result = sql! 'SELECT partner_id, COUNT(*) AS n FROM orders GROUP BY partner_id'
result.rows    # [{partner_id: 3, n: 17}, …]
```

Raw rows are the database's own spellings — snake_case keys, plain
objects, not instances: no hooks, no dirty tracking, no accessors.
Rows headed straight for a camelCase frontend can opt into a projection
— per call with `sql! text, params, {camel: true}`, or once for the
whole client with `connect {url, camel: true}` (a per-call `camel:`
still wins). Either way it camelizes row keys and the `columns` list
together (opt-in only; the transform matches the runtime's own
camelizer, with the same non-total edges: `nickname_2` and `ALL_CAPS`
stay put). Positional params are always an array, so a call with no
params may pass options second: `sql! text, {camel: true}`. Bridge
back to instances by primary key when you need them:

```rip
ids = (sql! 'SELECT id FROM orders WHERE total > ? ORDER BY total DESC LIMIT 10', floor)
  .rows.map (r) -> r.id
top = Order.findMany! ids
```

## Migrations

The models file **is** the schema. `rip schema` diffs the declarations
against the live database and manages numbered SQL files:

```
rip schema status                 applied / pending / drift + the current plan
rip schema plan                   print the classified diff (no files touched)
rip schema dump                   write schema.sql — the declared shape of every
                                  table (no database touched; --check verifies
                                  instead of writing, the CI seam)
rip schema make add partners      write migrations/<UTC>_add_partners.sql from the
                                  diff; bare words are joined into the description,
                                  which is optional — with none the file is just
                                  migrations/<UTC>.sql
rip schema migrate                apply pending files in order
rip schema unlock                 break a migration lock — applies NOTHING, and prints exactly
                                  whom it displaced; refuses a lease still being renewed
                                  (--force overrides). Rarely needed — see below
rip schema push [name…]           diff, write migrations/<UTC>_<name>.sql (the name
                                  optional, as for make), and apply
                                  it — one motion, for rapid iteration; refuses when
                                  pending/edited/conflicting migrations make the state
                                  unclear, and gates lossy/destructive exactly like make

Migration files are named `YYYYMMDDHHMMSS_description.sql` — the timestamp in **UTC**,
the description optional (`20260829175839.sql` is a complete name; the timestamp is
already unique, so a description is there for whoever reads the directory).
The version is the sort key and the sort is the apply order, so the clock has to be one
everybody shares: local time reorders a directory the moment two people in different
zones, or one laptop crossing a DST boundary, generate migrations the same afternoon.
Fixed width means a plain lexicographic sort stays correct forever, and two branches
never mint the same version, so a merge needs no renumbering.

The migration lock is a **lease**, not a flag. Whichever process is applying renews it
every few seconds, so a lock nobody has renewed for 30 seconds is one whose holder is
gone — and the next `migrate` takes it over on its own, saying whose it was. A crashed
deploy therefore clears itself, and `unlock` exists only for the rarer case where a lease
IS being renewed and you want that run stopped anyway.

That makes liveness a measurement rather than a guess. There is no `migrate --force`: with
a lease there is nothing to force. A holder from a runner too old to renew is never expired
out — it never renews, so an expired-looking lease would be indistinguishable from a live
one — and those still need `unlock`.

Legacy `NNNN_name.sql` files still apply. Do not rename them — the version is the
identity recorded in the `schema` table, so a rename reads as one deleted migration
plus one pending. They sort ahead of every timestamp (`'0'` precedes `'2'`), which is
where they belong, so both shapes coexist in one directory with the order still right.
```

`push` is the rapid-iteration verb: edit the model, `rip schema push`,
keep working. Unlike Prisma's `db push` / Drizzle's `drizzle-kit push`,
it still writes the migration artifact — the timestamped file joins the
same checksummed history `make` uses, so a push session leaves no drift
to reconcile and teammates just `rip schema migrate`. A plan that is
only informational notes (FK facts, sequence starts) pushes nothing.

Every planned step is classified: `safe` applies freely; `lossy` (type
changes, `SET NOT NULL`) and `destructive` (`DROP TABLE`,
`DROP COLUMN`) require `--allow-lossy` / `--allow-destructive` on
`make`; `blocked` steps — plans the differ cannot produce correctly,
such as a primary-key rename — are refused outright with the reason.
The printed plan always shows everything.

`@tableWas "old_name"` and `{was: "old_column"}` are one-time rename
signals: the differ plans a RENAME instead of a drop-and-create, and
you delete the signal once the migration lands. Any ambiguity — two
fields claiming one deployed column, a `was:` naming a column the model
still declares — is a rejection, never a guess.

This guide is not the migration reference — `rip schema --help` covers
the directory layout, checksummed history, the lock, and repair.

## Money

Store money as **integer cents** (`price! integer, 0..`). The reason
is the wire, not the column: only
temporal columns decode by database type on the way back, so a
`DECIMAL(9,2)` column would return every value as a plain JSON number —
a silent float, with `0.1 + 0.2` arithmetic — while the DDL looked
exactly right. `INTEGER` is exact in the column, exact on the wire,
exact in JS to 2^53 cents, and the database can `SUM`, compare, and
index it.
