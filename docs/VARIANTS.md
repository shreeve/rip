# VARIANT — reading and writing typed documents

A `VARIANT` column holds a document the engine has typed: every value inside
it knows whether it is a string, a number, a boolean, a null, an object or
an array. That is what makes `doc.patient.firstName` reach into it from SQL
and what makes it compress and filter like a real column. It is not text.

Between the engine and you there are three surfaces, and each one has a
single rule:

| Surface | Rule |
|---|---|
| SQL | Reach in with dots. Cast only when a native type is required. |
| Rip | You never see a quote you did not write. Objects in, values out. |
| Harbor REPL | Display modes show values. csv keeps the JSON text. json modes give JSON. |

Everything below was measured against harbor 0.39.2 on DuckDB v2.0.0-alpha
(engine build 42289), the build live runs. Where a rule has an edge, the edge
is listed.

## Quick reference

**I want to…**

| … do this | write this |
|---|---|
| read a field | `doc.patient.firstName` |
| read an array element | `doc.orders[1].testCode` (1-based) |
| read a key with a dash or space | `doc."first-name"` |
| read several fields | `doc.{requisitionNumber visitDate}` (harbor expands it) |
| read nested fields | `doc.{requisitionNumber patient.{lastName firstName}}` |
| read several fields as typed columns | `unnest(doc::STRUCT(requisitionNumber VARCHAR, visitDate VARCHAR))` |
| filter on a string | `WHERE doc.patient.firstName = 'Steve'` |
| filter on a number | `WHERE doc.patient.age > 40` (see *ordering*) |
| filter on a boolean | `WHERE doc.patient.active` |
| join a field to a VARCHAR column | `ON p.lpid = doc.lpid::VARCHAR` |
| put a field in a VARCHAR column | `INSERT … SELECT doc.lpid::VARCHAR …` |
| convert a field safely | `TRY_CAST(doc.age AS INTEGER)` or `doc.age::VARCHAR::INTEGER` |
| get a string's length | `length(doc.name::VARCHAR)` |
| unnest an array of objects | `unnest(doc.orders::VARIANT[]) AS o(o)`, then `o.o.testCode` |
| unnest to typed columns | `unnest(doc.orders::STRUCT(testCode VARCHAR, testName VARCHAR)[]) AS o(o)` |
| count an array | `variant_array_length(doc.orders)` or `len(doc.orders::VARIANT[])` |
| ask whether a key exists | `variant_exists(doc.patient, 'note')` (top-level key of that value) |
| ask what something is | `variant_typeof(doc.patient.age)` → `UINT64` |
| list keys | `variant_keys(doc)` (sorted) or `json_keys(doc::JSON)` (document order) |
| search a document for a value | `variant_contains(doc, 'Steve'::VARIANT)` |
| use a `json_*` function | cast first: `json_extract_string(doc::JSON, '$.a')` |
| store a document (Rip model) | `Order.create! { rawRequest: payload }` |
| store a document (raw SQL) | `sql! 'INSERT … VALUES (?, ?::JSON)', [id, JSON.stringify(obj)]` |
| store a document (REPL) | `… VALUES ('{"a":1}'::JSON)` or `{'a': 1, 'b': [2]}` |
| replace a document | `UPDATE t SET doc = ?::JSON WHERE …` |
| set one path | `SET doc = json_set(doc::JSON, '$.patient.age', ?::JSON)::VARIANT` |
| merge a partial document | `SET doc = json_merge_patch(doc::JSON, ?::JSON)::VARIANT` |
| delete one key | `json_remove(doc::JSON, '$.patient.age')::VARIANT`, or `null` for it in a merge patch |
| see a value with its JSON quotes in a table | `doc.name::JSON` |

**Never**

| this | because |
|---|---|
| `doc->>'a'`, `doc->'a'`, `json_extract(doc, …)` | the JSON operators refuse VARIANT; `doc::JSON` first |
| `INSERT … VALUES ('{"a":1}')` (no cast) | a bare VARCHAR is stored as a VARIANT *string*; `doc.a` is then NULL, silently |
| `sql! 'INSERT … (?)', [obj]` (no cast) | same thing from Rip: the object arrives as text; write `?::JSON` |
| `Model.where(doc: { a: 1 })` | compiles to `"doc" = ?` against a text literal; use the string dialect with a path |
| `unnest(doc.orders)`, `len(doc.orders)`, `length(doc.name)` | no VARIANT overload; cast (`::VARIANT[]`, `::VARCHAR`) |
| `doc.age::INTEGER` under a `WHERE` that excludes bad rows | the cast runs in the scan, on every row; use `TRY_CAST` |
| `UPDATE t SET doc.a = 5` | not supported; rebuild the document with `json_set` |

## Reading

### In SQL

Dots reach into the document. A missing key is `NULL`, not an error, at any
depth. The result of a path is still `VARIANT`, and it compares against
literals and columns without a cast:

```sql
SELECT id, doc.patient.firstName AS first, doc.patient.age AS age
  FROM reports
 WHERE doc.patient.firstName = 'Steve'
   AND doc.patient.age > 40
```

**Equality is typed.** The engine encodes the other side as a VARIANT and
compares values, so the number 43 inside a document never equals the string
`'43'`, and `'42'` never equals 42. When the document's value and your
literal agree on type, the normal case, this is what you want. When they
might not, cast the path: `doc.age::VARCHAR = '43'`.

**Ordering crosses types.** VARIANT values sort booleans, then numbers
(numerically), then strings (lexically), then arrays, then objects. So
`doc.age > 40` matches a document whose age is the string `"abc"`, because
every string sorts after every number. A range filter on a path that might
hold a string needs a type guard: `variant_typeof(doc.age) = 'UINT64' AND
doc.age > 40`, or a `TRY_CAST`.

**Arithmetic and most string functions take a path directly.**
`doc.age + 1`, `upper(doc.name)`, `doc.name || '!'`, `doc.name LIKE 'S%'` all
work. `len` and `length` do not: they bind to the BIT overload and fail with
a confusing message. Cast for those.

Cast to a native type in exactly these situations:

- **Joins and inserts against a VARCHAR column.** Write `doc.lpid::VARCHAR`.
  Without it the planner casts the *VARCHAR column* to VARIANT and compares
  through `variant_comparator`, which loses every min/max and bloom-filter
  pushdown on the scan. Measured on 200k rows: the uncast join reads every
  row, the cast join reads under one percent of them.
- **`len`, `length`, and any function without a VARIANT overload.**
- **Arrays.** `unnest` needs a list type. `doc.orders::VARIANT[]` keeps each
  element a document (`o.o.testCode` works); `doc.orders::STRUCT(...)[]`
  gives typed columns.

**Several fields at once.** Harbor expands the shell's braces in a
statement before the engine sees it, from every client, Rip included:

```sql
SELECT id, doc.{requisitionNumber visitDate patient.{lastName firstName}}
  FROM orders
 WHERE doc.patient.lastName ILIKE 'morel'
```

is four path expressions. Items are separated by whitespace, commas, or
both; groups nest; a group can sit anywhere in a term and a cast suffix
distributes (`doc.{a b}::VARCHAR`). A struct literal, `{'a': 1}`, is never
touched. The result columns stay VARIANT. For typed columns, a struct cast
naming the fields you want, unnested:

```sql
SELECT id, unnest(doc::STRUCT(requisitionNumber VARCHAR, visitDate VARCHAR))
  FROM orders
 WHERE doc.patient.lastName ILIKE 'morel'
```

That yields columns `requisitionNumber` and `visitDate`. Two unnests sit
side by side, one per sub-object, or one nested struct with
`recursive := true` flattens the lot. Keys the document has and the struct
does not name are dropped; a key the struct names and the document lacks
is NULL at the top level of the cast. Below the top level, on a stored
column, it is an error (`is missing key`), and `TRY_CAST` gives NULL for
the whole struct rather than the field; a constant fills NULL at any depth.
Name only keys the documents carry when casting a nested value.

**A cast in the SELECT runs on every scanned row, not only the rows the
WHERE keeps.** The path is pushed into the scan, so `SELECT doc.age::INTEGER
FROM t WHERE id = 1` fails if *any other row* has a non-numeric age. This
does not happen on a VARCHAR column. Use `TRY_CAST(doc.age AS INTEGER)`,
`doc.age::VARCHAR::INTEGER`, or filter in a subquery first.

The JSON operators and functions do not accept VARIANT. Casting a VARIANT to
VARCHAR gives a Python-style rendering with single quotes, which is not
JSON, so `doc->>'a'` fails with a malformed-JSON error rather than a type
error. Cast the whole document to JSON first when you want them:

```sql
SELECT json_keys(doc::JSON), json_extract_string(doc::JSON, '$.patient.firstName')
```

**Types inside a document.** `variant_typeof(x)` reports `OBJECT(k1, k2)`
with keys in document order, `ARRAY(n)`, `VARCHAR`, `UINT64` (a JSON
integer at or above zero), `INT64` (a negative one), `DOUBLE`, `BOOL_TRUE`,
`BOOL_FALSE`, `VARIANT_NULL`. A document that came in from a struct literal
carries SQL's types instead (`INT32`, `DECIMAL`, `DATE`). A JSON integer too
large for 64 bits becomes a `DOUBLE` at the cast and loses precision then and
there; store such values as strings.

**Null is null.** A key holding JSON `null`, a missing key, and a SQL NULL all
read as NULL from a path. `variant_exists(doc.patient, 'note')` is the only
way to tell a null key from an absent one. The `variant_exists`, `variant_keys`
and `variant_array_length` functions take a *top-level key name* of the value
you hand them, never a JSONPath, so walk with dots first.

**A stored NULL cast to JSON is the text `null`, not SQL NULL.** `doc::JSON IS
NULL` is false on a NULL row (upstream duckdb/duckdb#25873). Test `doc IS
NULL` instead; the cast is fine on its own, and from Rip the text `null`
decodes to `null` anyway.

### In Rip

Every result column that carries JSON text arrives decoded. Harbor marks a
VARIANT column `encoding: json` and a JSON column by its type, and the driver
runs `JSON.parse` on those cells before you see them. So a path that is a
string is a JS string, a number is a number, an object is an object, and
there are no quotes to strip:

```rip
rows = findAll! 'SELECT doc.patient.firstName AS first, doc.patient AS patient FROM reports WHERE id = ?', [1]
rows[0].first          # 'Steve'
rows[0].patient.age    # 43

r = Report.find! 1
r.doc.patient.firstName   # 'Steve'
```

This holds for `sql`, `findAll`, `findOne`, `value`, `values`, model reads
and transactions alike. They all go through the same decode.

**What you cannot tell apart.** A SQL NULL and a document whose top-level
value is JSON `null` both arrive as `null`. Inside a document, `{"note":
null}` is `{ note: null }` as you would expect.

**What is not decoded.** A VARIANT nested inside a LIST, STRUCT or MAP in the
result (`SELECT [doc]`, `struct_pack(d := doc)`, `list(doc.name)`) is JSON
text inside the container. Select the document or a path directly, or
aggregate with `variant_group_array` instead of `list`.

**Numbers.** Integers above 2^53 lose precision in `JSON.parse`, and above
2^63 they were already a DOUBLE in the engine. Store identifiers that size as
strings.

**Dates.** A document holds strings. A Date you stored comes back as its ISO
string, not a Date.

**Keys.** `camel: true` renames result *columns* only. Keys inside a
document are exactly what was stored.

### In the harbor REPL

| mode | a VARIANT string `Steve` | a number `43` | an object | SQL NULL |
|---|---|---|---|---|
| duckbox, markdown, line, list | `Steve` | `43` | `{"a":1}` | `NULL` |
| csv | `"""Steve"""` | `43` | `"{""a"":1}"` | `NULL` |
| json, jsonlines | `"Steve"` | `43` | `{"a":1}` | `null` |

The display modes show a string's content, the way a VARCHAR always has.
csv carries the cell's JSON text and CSV-escapes it, so a program reading it
can still tell `42` from `"42"`; `"""Steve"""` is the JSON text `"Steve"`
inside CSV quotes. The json modes splice the cell in as JSON, so `age` is
`43` and a document is an object, exactly as `duckdb -json` emits a JSON
column. A JSON-typed column follows the same three rows.

To see the quotes in a table, cast the path: `doc.name::JSON`.

## Writing

There is one way to get a write wrong: handing the engine a **string** when
you meant a **document**. A bare string is a legal VARIANT value, so the
engine stores it as a VARIANT string, nothing complains, and every dot path
into it is NULL. The cast is what says "this text is a document".

### In Rip through a model

Hand the field an object. The model stringifies it and binds it through
`?::JSON`, in `create!`, `save!`, `upsert!` and `updateAll!`:

```rip
Report.create! { doc: { patient: { firstName: 'Dot', age: 5 } } }

r = Report.find! id
r.doc.patient.age = 6      # nested change; dirty tracking is deep
r.save!()
```

A `variant` field takes any value and gives it back: an object, an array,
a string, a number, a boolean. A string is stored as a VARIANT string, not
parsed as a document, so `doc: '{"a":1}'` is the seven-character text and
`doc.a` is NULL. Hand it the object.

### In Rip through raw SQL

The cast is yours. Stringify the object and bind it through `?::JSON`:

```rip
sql! 'INSERT INTO reports (id, doc) VALUES (?, ?::JSON)', [id, JSON.stringify(obj)]
sql! 'UPDATE reports SET doc = ?::JSON WHERE id = ?', [JSON.stringify(obj), id]
```

Without the cast the driver still delivers the object, harbor renders it as
text, and the engine stores that text as a VARIANT string.

### In the REPL

A document is JSON text with a cast, or a struct literal (which needs none):

```sql
INSERT INTO reports (doc) VALUES ('{"patient":{"firstName":"Bob","age":7}}'::JSON);
INSERT INTO reports (doc) VALUES ({'patient': {'firstName': 'Cat'}, 'flag': true});
UPDATE reports SET doc = '{"patient":{"firstName":"Bob","age":8}}'::JSON WHERE id = 2;
```

### Changing part of a document

VARIANT has no in-place mutation: `SET doc.a = 5` is refused. Go through
JSON and back. The value handed to `json_set` must itself be JSON, which is
the whole reason `?::JSON` appears twice:

```sql
UPDATE reports SET doc = json_set(doc::JSON, '$.patient.age', '44'::JSON)::VARIANT WHERE id = 1;
UPDATE reports SET doc = json_remove(doc::JSON, '$.patient.age')::VARIANT WHERE id = 1;
UPDATE reports SET doc = json_merge_patch(doc::JSON, '{"patient":{"age":44}}')::VARIANT WHERE id = 1;
```

From Rip, bind the value or the patch the same way as a document:

```rip
sql! "UPDATE reports SET doc = json_set(doc::JSON, '$.patient.age', ?::JSON)::VARIANT WHERE id = ?", [JSON.stringify(44), id]
sql! "UPDATE reports SET doc = json_merge_patch(doc::JSON, ?::JSON)::VARIANT WHERE id = ?", [JSON.stringify(patch), id]
```

`json_set` creates a missing path; `json_insert` only adds, `json_replace`
only overwrites. Merge patch is RFC 7396: objects merge recursively, any
other value replaces, and a `null` in the patch deletes that key. A key
that is set moves to the end of its object; key order is not meaningful.

### Scalars

A JSON string and a VARCHAR store the same VARIANT string: `'"Steve"'::JSON`
and `'Steve'` are one value. Quotes are only ever required *inside* a
document, because that is JSON syntax. They are never required around a whole
value. Note that `'42'::JSON` is the number 42 and `'42'` is the string.

## Filtering from Rip

`Model.where(field: value)` renders `"field" = ?`. For a `variant` field
that is right for a scalar comparison of the whole column and wrong for a
document, which arrives as a text literal and never matches. Filter by path
with the string dialect, which passes SQL through untouched:

```rip
Report.where('doc.patient.firstName = ?', 'Steve').all!
Report.where('doc.patient.age > ?', 40).all!
```

## Declaring and migrating

```rip
export Report = schema :model
  doc! variant    # the report, typed: doc.patient.firstName reaches in
```

A `json` column becomes `variant` with `ALTER TABLE t ALTER COLUMN doc SET
DATA TYPE VARIANT USING doc::VARIANT` (a TEXT column needs
`USING doc::JSON::VARIANT`). `rip schema make` classes this alter as lossy
and refuses it while the table carries any index, so an indexed table is
three statements across two migration files, because a dropped index cannot
be recreated in the same transaction:

```sql
-- 1: drop the index, convert
DROP INDEX "idx_reports_key";
ALTER TABLE "reports" ALTER COLUMN "doc" SET DATA TYPE VARIANT USING "doc"::VARIANT;
-- 2: recreate the index
CREATE UNIQUE INDEX "idx_reports_key" ON "reports" ("key");
```

## Why VARIANT rather than JSON

A JSON column is text. Every `->>` parses the whole document again, and the
storage engine cannot see inside it. A VARIANT column is shredded: common
fields become real columns under the hood, filters push down into the scan,
and `doc.patient.firstName` is a column read. DuckDB plans to back the JSON
type with VARIANT after 2.0, at which point the two converge, with VARIANT as
the surviving representation. Declaring `variant` today is declaring that
representation directly; the only thing given up is the `json_*` family on
the column itself, which `doc::JSON` gives back when it is wanted.
