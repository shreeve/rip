# rip/files — the plan

Application data as **entries in files with fields**, the way VA FileMan
described it: a person is an entry in the Person file; their clinics are
a list inside that entry; an order's patient is a field that points to
another entry. This document is the whole design: the words, how a file
is declared, how application code reads and writes entries, how they are
stored in DuckDB through Harbor, what the database enforces and what the
layer does, and the order to build it in.

The first application is MedLabs, a lab-ordering portal. Its files, the
mapping of its sixteen current tables and a worked example live in the
MedLabs repository (`v2/MEDLABS.md`, `v2/files.rip`).

Everything stated as a DuckDB behavior was measured on DuckDB
v2.0.0-alpha through Harbor; section 9 has the numbers.

---

## 1. The model

| Word | Meaning | Example |
|---|---|---|
| **file** | A kind of thing the application keeps. | Person, Order, Result |
| **entry** | One thing in a file: an `eid` if the outside world refers to it, a `version`, and its fields. | Ann Lee; order `ord_k2m9x0aa` |
| **field** | A named, typed value. A field that is not set costs nothing. | `lastName`, `born`, `status` |
| **group** | A field whose type is a shape: one value with parts, kept inside the entry. | `address`, read as `address.city` |
| **pointer** | A field whose type is a file. It holds the other entry, not a copy. | an order's `patient` |
| **multiple** | A field holding a list of **sub-entries**, each with fields of its own, living inside the entry. | a person's `clinics`, a result's `values` |
| **index** | A field, or set of fields, the file can be searched by. A unique index refuses a duplicate. | `tracker`; `clinic` + `mrn` |
| **history** | Every change to an entry, field by field: the value before, who, and when. Always kept. | who changed Ann's phone |

There is no separate idea of a relationship. Something that holds
between two things belongs to one of them as a multiple: a person's
clinics, a test's prices over time, a panel's tests, an order's
sign-offs. Something that merely refers to another thing is a pointer.

**Three kinds of list.** A multiple is one of:

- **part of the entry** (the default): it loads with the entry, and any
  change to it is a change to the entry. An order's lines.
- **lazy**: still part of the entry, but it may grow large, so it loads
  only when asked for. The emails allowed to sign in for a clinic.
- **a log**: only ever added to, and adding to it is not a change to the
  entry. Each time a clinic opens a result.

**One loading rule.** An entry loads with its multiples. A pointer, a
lazy multiple and a log load only when they are pulled. Reading one that
was not pulled is an error that names it, never a hidden query; pulling
for a list of entries is one query for the whole list.

**The entry is the unit of change.** It has one `version` and one
history. Changing a sub-entry is changing its entry.

---

## 2. Declaring files

An application declares its files in one Rip file (`files.rip`), in git.
The declaration is the single source for validation, the TypeScript face
editors read, the tables, the constraints and the history.

```coffee
import { schema } from 'rip/files'

export Address = schema :shape
  street  string
  city    string
  state   string
  zip     string

  formatted: ~> [@street, @city, [@state, @zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

export Person = schema :file
  @eid :per

  firstName  string
  lastName   string @index
  born       date @index
  email      email
  address    Address
  npi        string @unique, /^\d{10}$/

  clinics many
    @eid :pat
    clinic!  Clinic
    mrn      string
    since    date
    @unique  clinic, mrn

  lpids many
    lpid!  string @unique

export Clinic = schema :file
  @eid :cln

  name!   string
  slug!   string @unique

  access many @lazy
    email!  email @unique
    level   "admin" | ["user"]

export Test = schema :file
  code!  string @unique
  name!  string

  prices many
    from!    date @dated
    amount!  decimal

export Order = schema :file
  @eid :ord

  patient!  Person
  clinic    Clinic
  status    ["draft"] | "submitted" | "completed" | "cancelled" @index
  ordered   datetime @index

  lines many
    item!  Test | Panel
    price  decimal

export Result = schema :file
  @eid :res

  order     Order
  tracker!  string @unique

  values many
    testCode!  string
    value      string
    voided     datetime @index

  reads many @log
    reader!  Clinic
    format!  "pdf" | "json"
```

| Declaration | Means |
|---|---|
| `schema :file` | A file. Its entries get `version`, `created`, `updated` and history without saying so. |
| `@eid :per` | Entries have an outward id, `per_` and eight characters. On a multiple, its sub-entries do. Only what the outside world refers to has one. |
| `field type` | A field. `!` required, `[x]` a default, constraints after a comma, as in every Rip schema. |
| `field Shape` | A group: `address.city`, with the shape's computed fields (`address.formatted`). On an entry a group is never null. |
| `@mixin Shape` | The shape's fields join the entry itself. For fields that are facts about the thing, not parts of one value. |
| `field File` | A pointer. `Test \| Panel` points to an entry in either file. |
| `name many` | A multiple, its sub-entries' fields indented under it. |
| `name many @lazy` | A lazy multiple. |
| `name many @log` | A log. Its items never change, and each records when it was added. |
| `@index` | Searchable, not unique. |
| `@unique` | Unique across the whole file, sub-entries of every entry included. `@unique a, b` makes the pair unique. |
| `@distinct` | On a multiple's field: once within one entry. |
| `@dated` | On a multiple's day field: each sub-entry takes effect that day, so `on(day)` finds the one in force. |
| `@scope`, `@slice`, `~>`, hooks | As in `schema :model`. |
| `@upgrade n, fn` | Rewrites an entry stored under an older declaration when it is read. |

**Value types** are Rip's: `string`, `text`, `integer`, `number`,
`boolean`, `decimal` (an exact decimal string), `date` (a calendar day),
`datetime` (an instant, always UTC), `email` (trimmed and lower-cased
before it validates), `phone`, `url`, `variant` (a free document), and
literal unions (`"M" | "F"`). A shape makes a group, a file a pointer.

---

## 3. Working with entries

Application code never writes SQL for an entry.

| On | Verbs |
|---|---|
| a file | `add!`, `get!` (by `eid` or a unique index; one entry or null), `find` (then `where`, `order`, `limit`, `after`, `pull`, ending in `all!`, `first!` or `count!`) |
| an entry | `save!`, `set!` (assign and save), `pull!`, `history!`, `refresh!`, `remove!`; reactive `changed`, `errors`, `valid`, `version` |
| a multiple | `add`, `remove`, `current`, `find`; on a lazy multiple also `add!`, which writes without loading the list |
| a dated multiple | `on(day)` |
| a log | `add!` |

```coffee
ann = Person.add! firstName: 'Ann', lastName: 'Lee', born: '1958-04-12',
  clinics: [{ clinic: ola, mrn: 'P-1923' }]

ann  = Person.get! clinic: ola, mrn: 'P-1923'
lees = Person.find(lastName: { starts: 'le' }, born: { year: 1958 }).all!

order  = Order.get! 'ord_k2m9x0aa', pull: 'patient clinic'
recent = Order.find(clinic: ola).order('-ordered').limit(100).pull('patient').all!

wrong = result.values.current.find (v) -> v.testCode is '005009'
wrong.voided = time()
result.values.add { ...wrong, voided: null, value: '5.9' }
result.save!

result.reads.add! reader: ola, format: 'pdf'
ola.access.add! email: 'nurse@ola.example'

(Test.get! code: '005009').prices.on('2026-03-01').amount

for change in ann.history! 'phone'
  p change.at, change.by, change.from, change.to
```

**Saving.** `save!` sends only the changed fields, with the `version`
the entry was read at. If the entry has moved on, the layer reads the
history since that version: when the other changes touched different
fields it merges and saves; when the same field changed, the save fails
with the other change in hand, for "keep mine" or "use theirs".

**Finding.** `where` takes declared field names, never storage paths:

| App writes | Becomes |
|---|---|
| `lastName: { starts: 'le' }` | `lastName ILIKE 'le%'` on the indexed column |
| `born: { year: 1958 }` | `year(born) = 1958` |
| `'address.city': 'Tampa'` | `data.address.city::VARCHAR = ?` |
| `'clinics.mrn': 'P-1923'` | `EXISTS` into `person_clinics` |
| `clinic: ola` | `clinic = ?`, ola's id |

Operators are the ORM's: `eq ne gt gte lt lte starts like ilike in nin
between year`. An unknown field is refused by name, never interpolated.
A path compared in a join is cast (`data.x::VARCHAR`) or the planner
loses its pushdown. Every default read leaves out removed entries.

**Slices.** `@slice :public` names an outward view: an allowlist of
fields, computed values and slices of pulled entries. A slice emits
`eid`, never `id`; an `id` in a slice is refused at declaration.

**Bulk loads stay in SQL**, generated by the layer: a nightly feed of
thousands of lab values is one `INSERT … SELECT` with its history
written as one statement. The entry interface is for application logic.

---

## 4. Storage in DuckDB

**A file is a table** named for it. **A multiple is a table** named for
the file and the multiple. One sequence numbers everything.

```sql
CREATE SEQUENCE id START 2;

CREATE MACRO touch(t) AS
  struct_update(t, updated := greatest(now()::TIMESTAMP, t.updated + INTERVAL 1 MICROSECOND));

CREATE TABLE person (
  id        BIGINT  PRIMARY KEY DEFAULT nextval('id'),
  version   INTEGER NOT NULL,
  data      VARIANT,
  "time"    STRUCT(created TIMESTAMP, updated TIMESTAMP, deleted TIMESTAMP),
  eid       VARCHAR UNIQUE,
  lastName  VARCHAR,
  born      DATE,
  npi       VARCHAR UNIQUE
);

CREATE TABLE person_clinics (
  id      BIGINT  PRIMARY KEY DEFAULT nextval('id'),
  parent  BIGINT  NOT NULL,
  sub     INTEGER NOT NULL,
  data    VARIANT,
  eid     VARCHAR UNIQUE,
  clinic  BIGINT  NOT NULL,
  mrn     VARCHAR,
  UNIQUE (parent, sub),
  UNIQUE (clinic, mrn)
);

CREATE TABLE result_reads (
  id      BIGINT  PRIMARY KEY DEFAULT nextval('id'),
  parent  BIGINT  NOT NULL,
  data    VARIANT,
  "time"  STRUCT(created TIMESTAMP),
  reader  BIGINT  NOT NULL,
  format  VARCHAR NOT NULL CHECK (format IN ('pdf', 'json'))
);

CREATE TABLE history (
  id       BIGINT  PRIMARY KEY DEFAULT nextval('id'),
  file     VARCHAR NOT NULL,
  entry    BIGINT  NOT NULL,
  version  INTEGER NOT NULL,
  patch    VARIANT,
  "time"   STRUCT(changed TIMESTAMP),
  "by"     BIGINT
);

CREATE TABLE aliases (
  eid    VARCHAR PRIMARY KEY,
  entry  BIGINT  NOT NULL
);
```

| Table | Columns |
|---|---|
| a file | `id`, `version`, `data`, `time` (`created`, `updated`, `deleted`), `eid` if declared, then one column per pointer and indexed field |
| a multiple, lazy or not | `id`, `parent`, `sub` (its number in the entry: 1, 2, 3, never reused), `data`, `eid` if declared, then pointer and indexed columns; `UNIQUE (parent, sub)` |
| a log | `id`, `parent`, `data`, `time` (`created`), then pointer and indexed columns. No `sub`: items are in `id` order, so two writers adding at once cannot collide. |
| `history` | one row per change to an entry: the file, the entry, the `version` it replaced, a reverse patch of only what changed (`{"phone": "813-555-0100"}`, `{"values[8].voided": null}`), when, and who |
| `aliases` | an entry's earlier eids, after a merge or a migration, so old links still resolve |

**Rules the tables keep**

1. **Each field is stored once.** A pointer is a column holding the
   other entry's `id`; an indexed field is a typed column; both are
   named for the field. Every other field is in `data`, a group as one
   object (`data.address.city`). The layer puts an entry back together.
2. **One id sequence.** An `id` names one entry or sub-entry anywhere, so
   a pointer to `Test | Panel` is just an id. An `id` never leaves the
   system: not in a payload, a URL, a log line or a slice.
3. **`version` refuses stale saves.** 1 on insert; a save is
   `… SET version = version + 1 … WHERE id = ? AND version = ?`, and
   zero rows matched means the entry changed since it was read. It is
   also the HTTP `ETag`.
4. **`time` is never NULL,** and every save sets `"time" = touch("time")`.
   `touch()` keeps `updated` strictly increasing even when two saves
   share an instant or the clock steps back; as a macro it costs no
   per-row call and never blocks an `ALTER`. `updated` says when;
   `version` says which. `deleted` marks a removed entry.
5. **Indexes are `UNIQUE` constraints,** never `CREATE INDEX`, which
   blocks `ALTER TABLE`. A non-unique index is a typed column DuckDB
   scans quickly.
6. **Moments are UTC.** A source in another zone is converted once, on
   ingest. Inside `data` they are native timestamps; at the API edge,
   ISO strings with six fractional digits.

**Identity.** An `eid` is a prefix, an underscore, and eight random
characters of Crockford's base32 alphabet, lower-cased: `per_8fk3v2qz`.

```coffee
ALPHABET =! '0123456789abcdefghjkmnpqrstvwxyz'

export eid = (prefix = '', n = 2) ->
  throw Error.new "eid: n must be a positive integer, got #{n}" unless Number.isInteger(n) and n > 0
  hash = (ALPHABET[b & 0x1f] for b in crypto.getRandomValues Uint8Array.new(4 * n)).join('')
  if prefix then "#{prefix}_#{hash}" else hash
```

The prefix names the file, or the file and multiple (`pat_` is
`person_clinics`), before any lookup; the table's unique `eid` column,
then `aliases`, finds the entry. An `eid` is permanent and never reused.
Eight characters carry 40 bits; a collision fails the insert's unique
constraint, and the layer mints another and retries, telling it apart
from a real duplicate. A file expecting millions of entries may declare
`n = 3`.

### Writing

Every write goes through the layer, in one transaction.

| Write | Statements |
|---|---|
| add an entry | validate; mint `eid`; insert the entry with `version` 1 and `time.created`, taking `id` from `RETURNING`; insert its sub-entries |
| save an entry | the history row; the entry with `version + 1`, `touch("time")` and changed columns, `WHERE id = ? AND version = ?`; inserted, updated or removed sub-entry rows |
| add to a lazy multiple | the sub-entry with the next `sub`; the history row; `version + 1` without a version check, since the add depends on nothing else in the entry |
| add to a log | one insert. No version, no history, no `touch()`. |
| remove an entry | `struct_update("time", deleted := now())`, with its history row |

Transactions go through `rip/db`'s `transaction!`, which pins one Harbor
session and retries the whole callback on a write conflict or a lost
session, up to five times. A unique violation is not a conflict: it
fails at commit, even between two writers racing, and is reported by
the rule's name, never its value, which may be patient data. A document
is bound as JSON text through `?::JSON`; a bare string would be stored as
a VARIANT string with every path inside it NULL.

### Reading

An entry is one query for its row and one for each multiple that loads
with it. A pulled pointer, lazy multiple or log is one query for every
entry in the list. Numbers come back as numbers, `decimal` fields as
their strings, moments as ISO strings rather than JavaScript `Date`s,
which would drop DuckDB's microseconds.

### What the database enforces, and what the layer does

| DuckDB enforces | Only the layer does |
|---|---|
| every `@unique`, `@distinct` and `eid` | types, required fields and patterns inside `data` |
| one `sub` per position | the version check on a save |
| `NOT NULL` on required pointer and indexed columns | history, `touch()`, `sub` numbering, minting `eid`s |
| `CHECK` on a code-set column (`status`, `format`) | pointers that point at something; sub-entries whose parent exists |
| column types | a log's items never changing |
| a transaction all or nothing | assembling entries, loading, merging, error redaction |

Foreign keys cannot carry pointers: once a row is referenced, DuckDB
refuses to update it at all, so every save of a person with even one
LPID fails; and a foreign key cannot be added to an existing table.

Three things keep a layer-enforced rule safe:

1. **One write path.** Every write goes through one small, tested
   module; bulk loads use SQL it generates.
2. **The database does all it can:** `UNIQUE`, `NOT NULL`, `CHECK`.
3. **A checker** (`rip files check`) scans for dangling pointers,
   orphaned sub-entries, `data` that fails its declaration, and gaps in
   history. At thousands of entries it takes seconds; it runs nightly
   and after every migration.

---

## 5. Changing the shape

- **A new field** is one line in the declaration; existing entries read
  it as null. No migration.
- **A new index** is `ALTER TABLE … ADD COLUMN`, a copy out of `data`,
  and the field removed from `data`. A unique one adds `ALTER TABLE … ADD
  CONSTRAINT … UNIQUE`, which works on a populated table. DuckDB cannot
  drop a constraint, so removing a unique rule rebuilds the table.
- **A new multiple** is a new table; **a new file** one generated
  `CREATE TABLE`.
- **Lazy or not** is the declaration alone; the table is the same.
  Turning a multiple into a log, or back, changes its table.
- **Renaming or splitting a field** is an `@upgrade` step: an entry
  stored under the older declaration is rewritten when read, and a
  command rewrites them all.
- **Migrations** are generated from declaration changes and run through
  `rip schema migrate`: one transaction per file, a checksummed ledger,
  a lease lock against concurrent runs.

---

## 6. Decisions, and why

| Decided | Instead of | Because |
|---|---|---|
| A table per file and per multiple | one table for everything | Kinds interleave as written, inflating storage 2–8×, and re-clustering a live table lost writes. |
| Multiples as tables | lists inside `data` | Measured at a hundred times MedLabs' size: voiding a value and adding its correction 1.7 ms against 19 ms; a report over 900,000 values 4 ms against 15.8 s; storage 49 MB against 47 MB. DuckDB has no unique constraint on a list's members. |
| Each field stored once | a canonical document plus copies | Nothing to drift. |
| Reverse-patch history | whole versions kept as rows | 1.1× the storage of no history, against 15×. |
| An integer `version` | comparing `updated` | One integer comparison; `updated` stays a fact about time. |
| `time` as a STRUCT | VARIANT or MAP | Identical to plain columns in storage and speed; VARIANT measured 7× the storage, MAP 5.5×. |
| History always on | per field, as FileMan | Who changed what is worth the space, and merging saves depends on it. |
| `schema :file` | `schema :record` | The model's own word, and it reads well beside "entry". |

---

## 7. Later: emdb

The model fits emdb, the team's own B+ tree, more closely than DuckDB.
An entry and its multiples are one contiguous range of keys,
`^Person(id, "clinics", sub, field)`, read in one scan; an index is a
second ordered key, so a name prefix, the last price on or before a day
and history newest first are each one cursor move. Measured through em,
the MUMPS engine on emdb: 0.03 ms per point operation, against 0.35 ms
for a point read through Harbor. It lacks a Rip binding, SQL for
reports (a hand-written report over the values took 4.4 s, against
DuckDB's 4 ms), multi-process testing, and any constraints, so even
uniqueness would move into the layer. Because declarations and the entry
interface say nothing about tables, moving to emdb changes the layer,
not the application.

---

## 8. Build order

1. **`rip/db` fixes.** A `COMMIT` after a failed statement must throw,
   not report success; constraint errors must not carry values into
   logs.
2. **Declarations.** `schema :file` in the compiler: `@eid`, pointers
   and file unions, `many`, `@lazy`, `@log`, `@index`, compound
   `@unique`, `@distinct`, `@dated`, `@upgrade`; the TypeScript face;
   all three editor grammars.
3. **Tables.** DDL generated from declarations: tables, `UNIQUE`,
   `NOT NULL`, `CHECK`, the sequence, `touch()`, `history`, `aliases`.
4. **Writing.** `add!`, `save!` with the version check and history,
   sub-entries, lazy adds, logs, removal, `eid` minting and retry.
5. **Reading.** `get!`, `find` and its path renderer, `pull`, the
   loading rule's errors, slices.
6. **Merging** concurrent saves from history.
7. **The checker.**
8. **MedLabs.** Migrate a copy of the live data, compare every row and
   every uniqueness rule, run the application against it beside the
   current one, then switch.
9. **The workbench.** Files, entries, a document editor with Rip types,
   and each entry's history.

---

## 9. Measured

Storage and layout, on 2 million rows:

| Layout | Result |
|---|---|
| Eight empty spare columns | one extra storage block of 39 |
| `time` as a STRUCT against plain columns | identical storage and speed |
| `time` as a VARIANT, shapes varying by row | 7× the storage; `deleted IS NULL` 5× slower |
| `time` as a MAP | 5.5× the storage; filters 6–10× slower, no pruning |
| A filter on a `data` path, no index | 13 ms over a million rows |
| Moments inside `data` as timestamps against ISO strings | 2.35× smaller |

Multiples, at a hundred times MedLabs' size, as tables against lists
inside `data`:

| Operation | Tables | Lists |
|---|---|---|
| Void a value and add its correction | 1.7 ms | 19 ms |
| An order with its tests and their names | 3.5 ms | 143 ms |
| A report over 900,000 values | 4 ms | 15.8 s |
| Storage | 49 MB | 47 MB |

Round trip from Bun to Harbor: 107 µs; a point read through Harbor:
353 µs.

**DuckDB limits the design accounts for:**

- `CREATE INDEX` blocks `ALTER` on its table; table constraints do not.
  A dropped index cannot be recreated in the same transaction.
- A constraint cannot be dropped. A foreign key makes its referenced
  rows impossible to update, and cannot be added to an existing table.
- A struct field takes no `UNIQUE` or `NOT NULL`, and a `CHECK` on a
  struct freezes it against new fields. There is no empty struct.
- `struct_update` fails with an internal error when the whole column is
  NULL.
- Generated columns cannot be added after creation, and cannot be
  `STORED`.
- An `UPDATE` of a VARIANT costs the square of its nesting depth
  (duckdb/duckdb#25967); documents are limited to 100 levels.
- A number in a document is normalized on write: `100.0` is stored as
  `100`. Exact decimals belong in `decimal` fields, as strings.
- A constraint error carries the duplicate value.

---

## 10. Open questions

1. **The declaration syntax** settles by writing MedLabs in it and
   keeping what still reads well.
2. **Typed moments inside `data` through Harbor** are to be confirmed.
3. **Who may see and save what.** If browser components call `get!` and
   `save!` directly, each file needs server-side visibility rules.
4. **Releasable values:** whether removing an entry frees a unique value,
   as an account's email may be freed to sign up again.
5. **Two kinds of time:** a dated multiple records when something held;
   history records when we learned it. Whether a query ever needs both
   at once ("what did we believe the price was on March 1, as of
   April") is open; nothing here prevents it.
