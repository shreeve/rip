# The Rip schema / ORM / migration system — a review brief

**Audience:** Claude Fable 5 and its subagents, performing a deep independent
analysis of this subsystem. You have not seen this code before. This document
is the map: what exists, where it lives, how the work is split, which
algorithms are non-obvious, and which invariants the whole thing rests on.

**Repository root:** `/Users/shreeve/Data/Code/rip`
All paths below are relative to that root. Line numbers are accurate as of
this writing but will drift; function names are stable, so prefer them.

**Read this first, then read code.** Every section names the exact functions
worth opening. The design rationale is unusually dense *in the source
comments* — this codebase treats comments as the design record, so a function
you find surprising almost certainly explains itself above its own body. If a
comment and this document disagree, the comment is newer.

---

## 0. What the system is

Rip is a CoffeeScript-descended language with its own compiler, running on
Bun. `schema` is a first-class declaration form in the language:

```rip
User = schema :model
  name!   string
  email!  email @unique
  handle? string, 2..24
  @timestamps
  @belongsTo Organization
  @hasMany Order
  beforeSave: -> @name = @name.trim()
  greet: (prefix) -> prefix + " " + @name
```

A `schema :model` declaration is simultaneously:

1. **a validating type** (`User.parse(data)` — runtime validation, coercion,
   refinements, nested schemas, enums, unions),
2. **a TypeScript type** (the compiler emits a `.d.ts` face),
3. **a persisted table** (DDL, a query builder, relations, lifecycle hooks,
   transactions, migrations).

Other `schema` kinds — `:shape`, `:input`, `:enum`, `:union` — are
validation-only. `:model` is the one that reaches a database.

The database is **DuckDB**, reached over HTTP through `duckdb-harbor`, a
separate Rust service in this monorepo (`../duckdb-harbor`). There is no
connection pool in JS: harbor owns connections and leases.

**Non-goals, deliberately.** No lazy relation graph, no identity map, no
migration DSL, no query AST users can build. The system prefers *refusing*
to *guessing* — a plan it cannot produce correctly is emitted as a `blocked`
step with an explanation, never as an approximate one.

---

## 1. The layer map

| File | Lines | Runs at | Owns |
|---|---:|---|---|
| `src/runtime/vocab.js` | 220 | both | **The single vocabulary.** Directive names, argument shapes, option keys, namespace rules, the snake↔camel bijection, name predicates. |
| `src/schema.js` | 2216 | compile | The `schema` grammar: tokens → descriptor. Positioned rejections. Descriptor serialization into emitted JS. Compile-time projection folding. |
| `src/runtime/schema.js` | 1787 | run | The validation runtime: `__schema()`, `_normalize()`'s base layer, `parse`, coercion, refinements, `SchemaError`, the registry. Kind-agnostic. |
| `src/runtime/orm.js` | 3173 | run | The persistence runtime: model normalization, property↔column mapping, query builder, relations, save/upsert/destroy, transactions, DDL. |
| `src/runtime/harbor.js` | 583 | run | The duckdb-harbor HTTP client: sessions, NDJSON, temporal wire, error taxonomy. |
| `src/cli/migrate.js` | 1241 | CLI | Introspection, the differ, step classification, migration files, history, the lock. |
| `src/cli/schema.js` | 236 | CLI | `rip schema` verbs. |
| `src/types/schemas.js` | 859 | compile | The TypeScript face: `Schema` / `SchemaQuery` / `ModelSchema` emission. |
| `src/emitter.js` | 15384 | compile | Everything; `RUNTIME_TABLE` (line ~14469) is the part that matters here. |

Plus `packages/db/` — a *separate, older* tier: `db.rip` (1224 lines) is a
standalone SQL client with its own `Model` facade. **It is not the ORM.** The
two tiers now share exactly one implementation (`src/runtime/harbor.js`), and
`packages/db/TODO.md` records that the `Model 'users'` facade has zero real
call sites. Do not confuse them; if a reviewer reports "two ORMs," that is the
known-and-documented split, not a finding.

### Delivery: how runtime code reaches the user's program

`src/emitter.js:RUNTIME_TABLE` lists runtime modules with `names` (the
user-facing bindings they provide), `requires`, and a `triggers` predicate.
The compiler either imports a module or **splices its source inline**.

Entries relevant here:

```js
{ key: 'vocab',  names: [],                          triggers: () => false }
{ key: 'schema', names: ['__schema','SchemaError','registerCoercer'],
                 requires: ['vocab'],  triggers: containsSchema }
{ key: 'harbor', names: [],                          triggers: () => false }
{ key: 'orm',    names: ['schema','__schemaSetAdapter'],
                 requires: ['schema','harbor','vocab'], triggers: containsModelSchema }
```

`vocab` and `harbor` bind **no** user-facing name: they ship only as
dependencies, fused ahead of whatever requires them. A program that declares
no `:model` carries none of the ORM or the HTTP client.

**The consequence that constrains all editing:** in inline mode, fused units
share **one scope** and the `import` line is **stripped**. So:

- every name in a runtime module is `__schema`-prefixed and globally unique;
- consumers must import each name **unaliased**, spelled exactly as declared;
- `vocab.js` must remain a leaf — **no imports at all**.

Violating any of these produces a program that works in import mode and fails
in inline mode, or vice versa. `test/schema/runtime-orm.test.js` has a
"runtime delivery" block that pins the set.

---

## 2. The vocabulary, and the one namespace rule

`src/runtime/vocab.js` exists because three layers need the same facts at
three different times:

- `src/schema.js` validates source **tokens** at build time,
- `src/runtime/schema.js` validates declared **names** at construction,
- `src/runtime/orm.js` validates hand-built **descriptor objects**, because
  `__schema({...})` is a second entry point that cannot trust its caller.

Different inputs, genuinely different jobs, **one vocabulary**. It previously
lived in all three, and they agreed by luck and review.

### The namespace rule: *quoting picks the namespace*

```
bare identifier   → a Rip name. Rip converts it (snake_cases, pluralizes).
quoted string     → the database's own name. Used verbatim.
```

Encoded as **data**, not as per-site argument:

```js
const __SCHEMA_FIELD_ATTRS    = { column: 'literal', was: 'column' };
const __SCHEMA_RELATION_ATTRS = { as: 'property', foreignKey: 'column',
                                  through: 'model', targetKey: 'column' };
```

Four namespaces, one validator (`__schemaAttrValueError(kind, key, value)`)
that returns *the middle of an error sentence* so each layer can frame it its
own way (the compiler names a source position; the runtime names a model):

| kind | written | example | predicate |
|---|---|---|---|
| `property` | BARE | `{as: author}` | `__schemaIsCanonicalName` |
| `model` | BARE | `{through: Membership}` | `__schemaIsCanonicalTarget` |
| `column` | QUOTED | `{foreignKey: "author_id"}` | `__schemaIsColumnName` |
| `literal` | QUOTED | `{column: "USER_NAME"}` | `__schemaIsLiteralColumn` |

The bare/quoted *distinction itself* is a token fact, so only the compiler can
enforce it (`parseOptionsBracket`, `src/schema.js:837`). The runtime enforces
shape only.

### Why the name predicates are not stylistic

`__schemaSnake` / `__schemaCamel` must be **total and reversible** on any name
Rip derives one identifier from another with. `mdmID` snakes to `mdm_id` and
camels back to `mdmId` — a *different name*. So consecutive capitals are
refused wherever a name is DERIVED (`__schemaIsCanonicalName`,
`__schemaIsCanonicalTarget`).

`__schemaIsLiteralColumn` is the deliberate escape hatch: a column that
already exists under a name Rip did not choose. Nothing round-trips through
it (the property name comes from the *field*), so it only forbids what would
break SQL or silently name the wrong thing — control characters, an embedded
`"`, and a **dot** (because `"crm.users"` through the quoter is one identifier
named that, not a qualified name).

### The full mapping surface

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

A worked example lives in `test/corpus/model.rip` (see `Patient`, `Country`,
`Post`).

---

## 3. The compile pipeline

```
source text
  → tokens
  → rewriteSchema()            src/schema.js:170   — finds `X = schema :kind`
  → collapseSchemaAt()                :288   — consumes the block
  → parseSchemaBody()                 :430   — per-line dispatch
      parseFieldedLine()              :516   — `name! type, constraints, {attrs}, @unique`
      parseModelDirectiveArgs()       :1097  — one directive's tokens → args, BY SHAPE
      parseOptionsBracket()           :837   — `{key: value}`, BY NAMESPACE
      parseCallableLine() / parseEnsurePairs() / parseUnionLine() / parseEnumLine()
  → finishModelBody()                 :984   — whole-model checks
  → descriptorSegments()              :1699  — descriptor → emitted JS
```

The descriptor is a plain object: `{kind, name, entries: [...]}` where each
entry is `{tag: 'field'|'directive'|'method'|'computed'|'derived'|'hook'|'scope'|...}`.
It is emitted as a literal into the compiled output and handed to
`__schema()` at runtime.

**`finishModelBody` (compiler) and `finishModelNorm` (runtime) are twins.**
They enforce the same model-level rules against different evidence. The
compiler can name a source position and can see bare-vs-quoted; the runtime
sees only the object. Both must reject the same programs. **This duplication
is intentional and is a prime review target** — divergence is the failure
mode the vocabulary was extracted to prevent, and the vocabulary only covers
the *table*, not the *checks*.

Also in `src/schema.js`, largely orthogonal: **compile-time projection
folding** (`foldDerivedSchemas`, `:2204`), an opt-in optimization that
resolves `User.pick(...)`-style derivations at compile time.

---

## 4. Model normalization — the core algorithm

`__SchemaDef.prototype._normalize()` in `src/runtime/schema.js` builds the
base norm (fields, methods, computed, derived, hooks, scopes, enums, ensures,
unions) and then, for `kind === 'model'` only, calls
`finishModelNorm(def, norm)` — `src/runtime/orm.js:562`.

**Caching rule (recently fixed):** `_norm` is assigned **only after
`finishModelNorm` succeeds**. Every model-level rejection lives in
`finishModelNorm`, and it used to run *after* the memo was stored, so the
first call threw and every subsequent call returned the half-built norm — a
model the runtime had already refused went on to build SQL. Worse,
`__schemaRelationKeyType` normalizes a relation's *target* inside a
`try/catch`, so an unrelated model touching a broken one could swallow the
error and leave the memo behind for everyone. Tests:
`test/schema/runtime-orm.test.js` → "orm: a refused model stays refused".

### 4.1 The column-ownership gate

Before `{column:}` existed, `property → __schemaSnake(property)` was
**injective**, so two fields could not collide and each site could inline the
derivation. `{column:}` deletes that bijectivity. So `finishModelNorm` builds
three maps through **one gate**:

```js
const columnOf = new Map();   // property → column
const fieldOf  = new Map();   // column   → property
const ownerOf  = new Map();   // column   → who claimed it (for the message)

const claim = (property, col, owner) => {
  if (fieldOf.has(col)) throw ... ownerOf.get(col) + ' and ' + owner +
    " both own column '" + col + "' — every table column has exactly one owner";
  columnOf.set(property, col); fieldOf.set(col, property); ownerOf.set(col, owner);
};
```

Claimants, in order: the surrogate primary key (if any), every declared field
(`f.attrs?.column ?? __schemaSnake(n)`), every `belongsTo` FK,
`@timestamps` → `created_at`/`updated_at`, `@softDelete` → `deleted_at`.

Without the gate, a `userId` field beside `@belongsTo User`, or a mixin's
`createdAt` beside `@timestamps`, emits duplicate-column DDL and
duplicate-column INSERTs that fail only at the database.

`__schemaColumnFor(norm, key)` and `__schemaFieldFor(norm, column)`
(`orm.js:365`, `:372`) are the **only** sanctioned translations. They consult
the map first and fall back to `__schemaSnake`/`__schemaCamel` only for a name
no map has heard of. **Any remaining direct `__schemaSnake(x)` at a
column-producing site is a bug** — that class of site is worth grepping for.

### 4.2 Derived column sets

Four sets fall out, and every structured SQL position validates against
exactly one:

- `norm.columns` — every persisted column. Filters and ORDER BY.
- `norm.callerWritableColumns` — declared fields + belongsTo FKs. INSERT/UPDATE
  column lists. Narrower: excludes `created_at` etc.
- `norm.conflictTargets` — an array of *tuples*, one per unique constraint the
  database can arbitrate: the pk, each unique field, each `@unique` index.
- `norm.conflictColumns` / `norm.conflictTargetKeys` — flattened forms for
  membership and exact-tuple checks (the latter joins a sorted tuple with
  ` `).

### 4.3 Surrogate vs natural primary key

There are exactly two coherent readings, and the *declaration* settles which:

```
@primaryKey patientId       nothing declares patientId → INTEGER surrogate:
                            sequence default, RETURNING absorption,
                            caller-supplied value REFUSED

@primaryKey mrn             mrn IS declared, with a type and constraints →
mrn! string                 a NATURAL key the caller supplies; the INSERT
                            writes it like any other column
```

There is no third case: a declared pk field with a surrogate posture would be
a `string` field over an INTEGER sequence column, and an undeclared natural
key would be a column with no type. **The two facts are one fact, so no
separate flag states it** — `norm.naturalKey` is literally
`norm.fields.get(norm.primaryKey) !== null`.

It takes **both** declarations. A bare `id! integer` with no `@primaryKey`
keeps colliding as it always did, because someone writing that means "I have
an id," not "turn off the sequence," and the default name is exactly where a
silent posture flip would go unnoticed. (This was caught by an existing test
when the first implementation made natural keys implicit.)

Natural keys then reject: an optional pk, an array pk, `@idStart` (there is no
sequence to seed), and a `{column:}` on the directive that disagrees with the
field's.

The mirrored error pair: `__schemaCallerPkError` (surrogate, caller supplied
one) and `__schemaMissingPkError` (natural, caller supplied none).

---

## 5. Query construction and identifier safety

### The two `where` overloads

```js
q.where({ lastName: 'Smith', status: ['open','paid'] })   // STRUCTURED
q.where('created_at > ?', d)                              // caller-authored SQL
```

The **string** form is a ratified owner decision (recorded as "O4"): it is
trusted, caller-authored SQL, passed through verbatim with its parameters.
Same for the string overload of `order()`. **This is not a finding.** A
reviewer flagging it as injection should instead ask whether any *internal*
call site routes untrusted input into it.

The **object** form validates every key against `norm.columns` and quotes
through `__schemaQuoteIdent`. Operators are supported structurally
(`__schemaInFragment`, `__schemaOrderDir`).

### The identifier/literal quoters

```js
__schemaQuoteIdent(name, allowed, what)   // orm.js:44
__schemaQuoteLiteral(text, what)          // orm.js:61
```

`__schemaQuoteIdent` rejects non-strings and control characters, checks
membership in `allowed` (or skips the check when `allowed === null`, e.g. a
table name), and returns `"` + doubled-quote-escaped + `"`.

`__schemaQuoteLiteral` is its **string-literal twin**, and exists for exactly
one site: `nextval('<sequence>')` in a column DEFAULT. That is the only place
a name reaches SQL as a string rather than an identifier, and a `'` in a
`@table` name used to terminate the literal early. Both exist so that no name
is ever pasted raw.

`__schemaPageInt` guards LIMIT/OFFSET: only an actual `number` that is a safe
non-negative integer, no coercion and no numeric strings, because a
request-derived string is exactly the injection surface.

### The single SQL funnel

Every statement goes through `__schemaRunSQL(def, sql, params, opts)`
(`orm.js:1043`): resolve the def's adapter, route through that adapter's
ambient transaction if one exists, translate DB constraint violations into
structured `SchemaError`s (`__schemaTranslateDBError`,
`__schemaConstraintIssue`).

### Terminal methods

`_buildSQL` / `all` / `first` / `count` / `updateAll` / `deleteAll`
(`orm.js:1403–1490`). `deleteAll` honors `@softDelete` (issues an UPDATE);
`updateAll` and `deleteAll` read affected rows via `__schemaAffectedRows`,
which exists because **DuckDB answers a bulk UPDATE/DELETE with a one-row
result whose single `Count` column carries the number** — the envelope's own
`rowCount` is 1 for every such statement, including one that matched nothing.

---

## 6. Relations

Three kinds, each declared as a directive with options:

```rip
@belongsTo User, {as: author, foreignKey: "author_id"}
@hasOne  Insurer, {as: payer, through: Enrollment}
@hasMany Study, {through: Enrollment, targetKey: "study_id"}
```

`__schemaNormalizeDirectiveRelation` (`orm.js:376`) derives `{kind, target,
accessor, foreignKey, through, targetKey, optional}`. Without `{as:}` the
accessor derives from the target, which is why two relations to one model
collide — `{as:}` is what lets `author` and `reviewer` both reach `User`.

### `through` — deliberately not a JOIN

`__schemaThroughPairs` (`orm.js:1563`) selects **only the two key columns**
from the join table for a batch of owner identities, and returns
`[ownerId, targetId]` pairs. Then one `findMany` over the distinct targets.
Then grouping in JS.

Preloading N owners through a join model is **3 queries, not N+1** — and not
a JOIN, so there is no row duplication and no join-table column leaks onto a
target instance. It is the same two-query shape every other relation uses,
with one extra step.

The join columns resolve **late**, off the join model's own `@belongsTo`
declarations (`__schemaThroughKeys`, `orm.js:432`):

- exactly one `@belongsTo Owner` → that's the owner key;
- zero → error naming the option that fixes it;
- two or more → error listing them and naming the option that disambiguates.

**Ambiguity is refused, never guessed.** `{foreignKey:}` names the owner side,
`{targetKey:}` the target side. `{through:}` on a `@belongsTo` is refused
(it holds its key in its own row, so there is nothing to read through);
`{targetKey:}` without `{through:}` is refused.

### Writing through a join model

`addX` / `removeX` / `setX` accessors, implemented by `__schemaThroughAdd` /
`Remove` / `Set` / `Unlink` over a shared `__schemaThroughPlan`
(`orm.js:1674–1800`).

The link is a **row**, not a column, so writes go **through the join model**,
not around it: `insertMany` validates every row and respects the join's own
fields, defaults, and `@timestamps`; `deleteAll` respects its `@softDelete`.
A join model with required columns of its own is therefore usable — pass them
as the `attrs` argument. Hooks are skipped, which is `insertMany`'s documented
bulk-path contract.

`add` is idempotent (reads the current set first; duplicate join rows would
surface as duplicate targets on the read side, which nothing else produces).
`set` computes both halves from **one** read.

In Rip source these are **dammit calls**: `user.addTeams! team` — the postfix
`!` on a call means *call-and-await*. Writing `await user.addTeams! team`
compiles to `await await` and is wrong. (The `!` is position-disambiguated in
Rip: after a call it is the dammit operator, after a schema field name it is
the required modifier, before an expression it is logical not.)

### Eager loading

`__schemaPreload(def, instances, specs)` (`orm.js:1579`). One query per
relation per nesting level, `WHERE fk IN (…)`, never a JOIN. Results land in
a per-instance relation memo so accessors resolve with no query.

The subtle part is the **memo eligibility check**. Before any `await`, the
preloader captures, per instance, `{generation, identity}`. After the rows
come back it re-checks both:

```js
const current = (inst, request) =>
  inst._relGeneration === request.generation &&
  __schemaSameValue(__schemaRelationIdentity(def, inst, rel), request.identity);
```

A reload or a RETURNING absorption bumps `_relGeneration`; a mutable FK can
change identity independently. Either change makes the in-flight result
ineligible, and it is dropped rather than memoized against a row it no longer
describes.

Dangling join rows (a pair whose target row is absent) are skipped silently on
the read side — worth deciding whether you agree with that.

---

## 7. Persistence: snapshot, dirty tracking, and the write paths

### Instance state

- `_persisted` — has this row been written?
- `_snapshot` — a deep copy of every persisted column's value at
  hydrate/save time, keyed **camelCase**.
- `_dirty` — explicit marks, for in-place mutation of object-valued fields
  where value identity cannot see the change.
- `savedChanges` — `property → [before, after]` for the last save.
- `_relMemo` / `_relGeneration` — the relation cache.

`__schemaSnapshotValue` deep-copies with cycle handling (`seen` map),
preserving `Date`, `Array`, `Map`, `Set` semantics, and flattening custom
instances to **enumerable own data only** so model bookkeeping and prototypes
never enter persistence state. `__schemaSnapshotEqual` is its structural
comparator. `__schemaSameValue` is SameValueZero — NaN equals NaN, so a
persisted NaN does not trigger a wasted UPDATE on every save; ±0 stay equal
because the database does not distinguish them.

**The pk is captured in the snapshot deliberately**, so `save()`'s
`UPDATE … WHERE` targets the originally-loaded row even if `inst[pk]` is
reassigned in memory. `__schemaPersistedIdentity` reads the *snapshot*, never
the live property.

### INSERT

Only non-null values are written; a row with nothing to write emits
`INSERT INTO t DEFAULT VALUES RETURNING *` (empty `(…) VALUES (…)` is a
syntax error). The RETURNING row is absorbed by `__schemaAbsorbRow`, which
writes camelCase own properties plus non-enumerable snake_case aliases.

Then a **hard check**: if `inst[pk]` is still null after absorption, throw and
describe the adapter's response shape. Otherwise a malformed adapter response
would mark the instance persisted with an undefined id and a later `save()`
would issue `UPDATE … WHERE id = undefined`.

Ordering matters and is commented: `_applyEagerDerived` → snapshot →
`_persisted = true`. Snapshotting *before* flipping `_persisted` means a later
`save()` can never observe `_persisted = true, _snapshot = null`, which would
fall through to a full-row UPDATE.

### UPDATE

Column-targeted: write only fields that changed since hydrate/last save
(snapshot comparison) or were explicitly marked dirty. **No-op saves issue no
SQL.** `nextSnap` is built from the values about to be written, *before* the
await, and installed only on success — capturing after the await would let a
concurrent mutation mark itself clean without ever being persisted.

### `upsert`

Builds `INSERT … ON CONFLICT (targets) DO UPDATE SET … RETURNING *`, or
`DO NOTHING` when there is nothing to update. Conflict targets validate as an
**exact tuple** against `norm.conflictTargetKeys`. `DO NOTHING` can
legitimately return zero rows, so `upsert` then issues a lookup by the
conflict target and verifies the returned target values match what was
requested.

### Adapter-row validation

`__schemaValidateAdapterRow(columns, row, operation, norm)` (`orm.js:2060`)
runs on **every** row before any caller reads or absorbs it: shape check, then
canonicalize each column name and reject duplicate canonical keys — two
spellings for one canonical key would let the later value silently overwrite
an identity or a conflict target.

The `norm` argument is load-bearing: with it, names canonicalize through
`columnOf`/`fieldOf`; without it, they derive via `__schemaCamel`. A model
with `{column: "MRN_NBR"}` **and** a sibling field `mrnNbr` produces two
distinct canonical keys with `norm` and one collision without it. `upsert`'s
`__schemaReturnedRow` was the last call site missing it (fixed; see §11).

---

## 8. Transactions

`schema.transaction! -> …` propagates **ambiently** via `AsyncLocalStorage`:
every ORM call inside the block routes through the transaction's handle, so
model code is unchanged inside the block. Throw → ROLLBACK + `afterRollback`
hooks. Return → COMMIT + `afterCommit` hooks (which run *outside* the
transaction and cannot roll anything back).

Nesting on the **same** adapter joins the ambient transaction; a **different**
adapter is independent — each adapter has its own slot in the store map.
Cross-adapter atomicity is impossible and the runtime never pretends
otherwise.

**The ALS singleton initializes through a memoized promise**, and this is
subtle enough to call out: a per-caller `new AsyncLocalStorage()` would let
the second cold-start transaction overwrite the first's instance, silently
routing the first transaction's statements to autocommit — *writes escaping
the transaction with no error*. Hosts without `node:async_hooks` reject
loudly at every attempt, because the rejected init promise **is** the memo.

Store binding is **copy-on-run**: `new Map(als.getStore() || [])` then set this
adapter's slot, so other adapters' ambient contexts stay visible inside.

Two bridges exist for the other tier:

- `__schemaAdoptTransaction` — bind an already-open handle (opened by
  `packages/db`) as this adapter's ambient transaction, so schema-model
  statements inside enroll on it instead of committing on another connection.
  The caller owns begin/commit/rollback; this owns only the ambience and the
  outcome-dependent hooks, and is handed a `settle` to call once the commit or
  rollback actually lands, so `afterCommit` never fires ahead of its COMMIT.
- the mirror, so a raw statement issued inside a transaction *we* opened joins
  it.

**Known gaps here (shelved, not fixed):** `restore()` does not call
`__schemaSettleTxHooks`; a **failing COMMIT** fires neither hook and leaves
`_persisted = true`; a throwing `afterRollback` replaces the real error; one
throwing `afterCommit` cancels the rest. These were found in an adversarial
review, triaged, and deliberately not addressed in the current batch. **They
are real and open — a reviewer rediscovering them is confirming, not
finding.**

---

## 9. The wire: `src/runtime/harbor.js`

One client, used by both tiers. Exports `harborAdapter`, `resolveUrl`,
`toResult`, the error classes, the temporal codecs, `encodeParam(s)`,
`parseNdjson`/`parseBody`, `abortable`, `DEFAULT_URL`, `DEFAULT_TIMEOUT_MS`.

**Error taxonomy** — classified by *domain*, not by whether SQL was present:

| condition | class | why |
|---|---|---|
| status 499 or `harborCode === 'cancelled'` | `CancelledError` | someone stopped this statement |
| `data.errorCode != null` | `QueryError` | the engine rejected the statement |
| `!response.ok` with no engine code | `ConnectionError` | availability |

So a retry loop keyed on `ConnectionError` catches a 5xx during a query and
does **not** catch a cancellation.

**Three-state statement timeout.** Harbor distinguishes an *absent*
`timeoutMs` (take the deployment default, `HARBOR_STATEMENT_TIMEOUT_MS`) from
an *explicit 0* (no limit). The client exposes all three:

```
timeoutMs: 4500   client clock + wire deadline
timeoutMs: 0      inherit harbor's default — sends NO field
timeoutMs: null   explicit 0 on the wire — no limit anywhere
```

`??` would fold `null` into the default, so the code uses an explicit
`=== undefined` test. The migration runner uses `null` (a large CREATE INDEX
runs for minutes); the ORM default is `0`.

**Temporal wire.** Only temporal columns are decoded off `duckdbType` into
real `Date`s; `Date` params encode to ISO-Z. This has a design consequence
worth understanding: a `DECIMAL(9,2)` escape hatch would come back as a
**float, silently**, which is why money is integer cents in this system and
not a decimal column. See `packages/db/TODO.md` § Money.

**Recent hardening (see §11):** `Retry-After` is read from the header before
stamping `retryAfterMs`; URL userinfo is redacted from error messages via
`displayUrl`; `encodeParam` throws on `undefined`, non-finite numbers, and
`bigint`.

---

## 10. Migrations — `src/cli/migrate.js`

```
canonicalDeclared()   :196   registry → declared table specs (via _tableSpec)
introspect()          :94    DuckDB catalog → deployed table specs
foldSpec()            :260   comparison normalization
diffSchemas()         :401   the differ
  validateSchemaIdentifiers()
  rename-signal validation (@tableWas / {was:})
  topoOrder()         :378   FK-aware create/drop ordering
  diffTable()         :541   per-table column/index/constraint diff
  applyFkBlocks()     :346   mark steps DuckDB will refuse
renderPlan()          :795
make / migrate / status / the lock            :807–1241
```

### Step classification

```js
{ table, kind, class: 'safe'|'lossy'|'destructive'|'blocked', sql: [], notes: [] }
```

`make` refuses `lossy`/`destructive` without the matching allow flag, and
refuses `blocked` outright. The printed plan always shows everything.

### What DuckDB's ALTER limits force

- `ADD COLUMN` cannot carry NOT NULL / UNIQUE / REFERENCES → a required add
  becomes add + backfill + `SET NOT NULL`; a unique add gets a separate
  `CREATE UNIQUE INDEX`; **FK constraints cannot be added to an existing table
  at all** (a note step is emitted).
- A table referenced by another table's FOREIGN KEY is **frozen** for
  everything except `ADD COLUMN` and index DDL — even `DROP TABLE … CASCADE`
  is refused. `applyFkBlocks` marks those steps `blocked`, with the
  referencing columns named. `UNBLOCKED_KINDS` is the exempt set.
- No `ALTER SEQUENCE RESTART` → sequence-start drift is a NOTE step, never
  silence.

### `topoOrder`

Stable topological order where `depsOf(name)` lists what must come first, ties
breaking by input order (name-sorted upstream). A **cycle rejects loudly with
its members named**: DuckDB cannot add FK constraints after CREATE TABLE, so
no statement order satisfies an FK cycle, and the error says how to break it.

### Determinism

`diffSchemas` sorts tables by name itself rather than borrowing ordering from
`canonicalDeclared` — determinism is that function's own contract. Migration
files are byte-deterministic and checksummed; `test/schema/migrate.test.js`
pins that.

### Rename signals

`@tableWas` (table) and `{was:}` (column) are one-time signals the differ
consumes and the author then deletes. Every ambiguity is a **rejection**, not
a silent fall-through to create+drop:

- two fields claiming one deployed column via `{was:}`;
- a `{was:}` naming a column the model still declares;
- both columns deployed (the rename already landed and something recreated
  the old one);
- the same three, at table granularity, for `@tableWas`.

Recently added to that family: **two models mapping to one table**, and **a
primary-key rename** (§11).

---

## 11. Recent, uncommitted changes

Everything below is **working tree only**; the last commit is `9436b1b3`.
Three batches, all applied and individually verified. Tests were added for
every one. The full suite has **not** yet been re-run end to end (`bun run
test:all`, `bun run audit`) — that was interrupted to write this document.

**Batch 0 — the norm cache.** `src/runtime/schema.js`: assign `this._norm`
only after `finishModelNorm(this, norm)` returns. A rejected model must keep
rejecting, with the same message, forever.

**Batch 1 — the wire client.** `src/runtime/harbor.js`:
1. `retryAfterMs` is stamped only when the `Retry-After` header is actually
   present. `Number(null)` is `0`, which passed the finite check and stamped
   `retryAfterMs = 0` on *every* error; a caller testing
   `if (e.retryAfterMs)` reads 0 as "retry now" and skips its own backoff.
2. `displayUrl(url)` strips userinfo; all three connection-error messages use
   it, so a password in a connection string never reaches a log. The timeout
   message also now interpolates the deadline rather than `timeoutMs`.
3. `encodeParam` throws for `undefined`, non-finite numbers, and `bigint`
   rather than letting them travel as `null`/`"NaN"` and land in a row.
4. `CancelledError` takes a code: `new CancelledError(message,
   data.harborCode ?? 'ABORTED')`.

**Batch 2 — six mapping/migration defects.**
1. `migrate.js`: the pk-shape skip in `diffTable` was unconditional, so a
   **natural key**'s drift from its deployed column was invisible — the plan
   reported no steps at all. Now only *surrogate* pks (`primary` +
   `nextval(` in the default) are skipped.
2. `migrate.js`: a **primary-key rename** now emits a `blocked`
   `note-primary-key` step. The column differ read it as one column added and
   another dropped, so the ADD (classed **safe**) backfilled fresh sequence
   values over every row's identity while child FKs kept pointing at the old
   ones. There is no ALTER that moves a primary key.
3. `schema.js`: `@index`/`@unique` now resolve through the column map from
   *either* side. `@index [:USER_NAME]` was rejected by a message that listed
   `USER_NAME` as present — the message arguing with itself. The runtime
   accepted it and emitted correct DDL all along.
4. `orm.js`: `__schemaReturnedRow` now takes and forwards `norm`; `upsert`
   was the only `__schemaValidateAdapterRow` call site without it (§7).
5. `orm.js`: `__schemaQuoteLiteral` — the sequence name in
   `DEFAULT nextval('…')` is escaped. `@table "o'brien"` previously produced
   `nextval('o'brien_seq')`.
6. `orm.js`: a fractional `max` (`..2.5`) now refuses rather than rendering
   `VARCHAR(2.5)`. Rounding would silently redefine the column.
7. `migrate.js`: **two models mapping to one table** is refused, in
   `canonicalDeclared` (with both model names) and again in `diffSchemas` for
   caller-built inputs. They previously folded into one map entry, so the last
   declaration defined the table and the other's columns read as drops — a
   plan whose contents changed with declaration order.

New tests: `test/schema/migrate.test.js` (+4), `test/schema/runtime-orm.test.js`
(+6), `test/schema/schema.test.js` (+1), `test/schema/default-adapter.test.js`
(+4). All four files pass.

---

## 12. Invariants — the best review targets

These are the properties the system rests on. Each is a good place to look for
a counterexample.

1. **One column, one owner.** No column is claimed twice, in either layer.
2. **The compiler and the runtime reject the same programs.** Different
   evidence, same verdict. `finishModelBody` ↔ `finishModelNorm`.
3. **Every column name reaching SQL goes through `columnOf`/`fieldOf`**, not
   through `__schemaSnake` at the call site.
4. **Every identifier reaching SQL goes through `__schemaQuoteIdent`**, with
   the *right* `allowed` set for its position; every name reaching SQL as text
   goes through `__schemaQuoteLiteral`.
5. **A refused model stays refused**, no matter who touches it or in what
   order.
6. **A plan is correct or it is `blocked`.** Never approximately right.
7. **Ambiguity is refused, never guessed** — join keys, rename signals, table
   claims.
8. **No `await` between capturing state and acting on it** without
   re-validating (preload memo, `nextSnap`).
9. **Delivery symmetry**: inline and import modes produce the same program.
10. **`vocab.js` is a leaf** with globally unique `__schema`-prefixed names.

---

## 13. Deliberate non-features

Designs written up, implementation deferred by owner decision. Each has its
open question recorded in `packages/db/TODO.md`. **Do not report these as
missing** — report anything that makes them *harder to add later*.

- **Composite primary keys.** Open question: whether `find()` takes a tuple or
  an object.
- **Polymorphic `belongsTo`.** Open question: how the type column's values map
  to model names without a global registry lookup at write time.
- **Single-table inheritance.** Open question: how the discriminator interacts
  with `defaultScope`.
- **Decimal/money columns.** Decided *against*: integer cents. A
  `DECIMAL(9,2)` escape hatch would return floats silently, because the wire
  decodes only temporal columns off `duckdbType`.

Also open, in `packages/db/TODO.md` § Do now: `rip schema dump` (a checked-in
schema file, diffed in CI — "buy information before buying a rewrite"), and
setting `HARBOR_STATEMENT_TIMEOUT_MS` in the deployment runbook.

---

## 14. Tests and how to run them

| File | Lines | Covers |
|---|---:|---|
| `test/schema/schema.test.js` | 1193 | the compiler: positioned rejections, the DSL surface, delivery machinery |
| `test/schema/runtime-orm.test.js` | 3505 | the ORM: paired reference suites, the defect battery, SQL structure ownership, delivery |
| `test/schema/migrate.test.js` | 1297 | the differ, rename rejections, the splitter, `make`/`migrate`, the lock |
| `test/schema/default-adapter.test.js` | 322 | the harbor client: temporal wire, session lifecycle, the timeout tri-state, the error surface |
| `test/schema/schema-types.test.js` | 608 | the TypeScript face |
| `test/schema/extract.test.js` | 117 | descriptor extraction |
| `test/corpus/model.rip` | — | the DSL through every corpus layer (byte-level emission pins) |

```
bun test test/schema           # this subsystem
bun run corpus                 # regenerate/verify corpus artifacts
bun scripts/browser-bundle.mjs # the browser bundle must still build
bun run test:all               # everything
bun run audit                  # the audit runner
```

A **known intermittent flake** exists in the full suite under `--parallel`:
the *failing lane varies*, which points at cross-lane contention rather than
a bad assertion. It is open and unrelated to this work.

---

## 15. Suggested review assignments

Independent lanes, roughly equal in size. Each names its entry points.

1. **The two-layer twin.** Diff `finishModelBody` (`src/schema.js:984`)
   against `finishModelNorm` (`src/runtime/orm.js:562`) rule by rule. Find a
   program one accepts and the other rejects, in either direction.
2. **Column-name flow.** Grep every producer of a column name and prove it
   routes through `__schemaColumnFor`/`__schemaFieldFor`. Then every SQL
   position and prove it quotes with the correct `allowed` set. Include
   `_tableSpec`/DDL and `migrate.js`'s re-emission of `col.default`.
3. **Write paths under concurrency.** `save` (INSERT and UPDATE), `upsert`,
   `insertMany`, `destroy`/`restore`. Look for state captured before an
   `await` and acted on after it. The transaction gaps in §8 are known; look
   for *others*.
4. **The differ.** Feed `diffSchemas` adversarial declared/deployed pairs.
   Target: a plan that is silently wrong (not blocked, not lossy-flagged) and
   would lose or rewrite data. The pk-rename and natural-key cases in §11 are
   the shape of what to look for.
5. **The wire client.** `harbor.js` end to end: session lifecycle on every
   error path, NDJSON parsing, the timeout tri-state, the error taxonomy,
   `abortable`. Does a failure anywhere orphan a session?
6. **Relations.** `__schemaThroughKeys` resolution, `__schemaPreload` memo
   eligibility, accessor invalidation after a through-write, dangling join
   rows, and self-referential relations (a model `through` itself).

For each finding, please state: the exact input, the observed behavior, the
expected behavior, and whether it is reachable from Rip source or only from a
hand-built `__schema({...})` descriptor. That last distinction matters — the
descriptor entry point is deliberately validated as untrusted, but a defect
only reachable that way ranks lower than one a `.rip` file can trigger.
