// Schema migration: introspect → diff → status / make / migrate.
//
// CLI-ONLY by decision: this module rides the `rip schema`
// commands and is NEVER delivered into compiled user output — the
// delivered `schema` namespace carries loud pointers here, nothing
// more. It consumes the persistence runtime's public seam
// (src/runtime/orm.js): the registry for declared models,
// `_tableSpec()` for the canonical table shape, the SQL funnel for
// adapter routing, and the race-fixed transaction machinery for
// per-file transactional apply.
//
// `toSQL()` solves greenfield CREATE; this module solves migration:
// diff the declared models against the deployed database and emit
// ALTER migrations, with history, checksums, and destructive-change
// gates.
//
//   plan()                 → classified diff steps (pure, no files)
//   status(opts)           → steps + applied/pending/mismatched/missing/duplicates
//   make(name, opts)       → write migrations/<UTC>_name.sql from the diff
//   migrate(opts)          → apply pending migration files in order
//   introspect()           → DeployedSchema (canonical table specs)
//
// Migration FILES are plain SQL — numbered, hand-editable, checked
// into git. The generator writes them; humans may amend them;
// migrate() applies them and records (version, name, checksum,
// applied_at) in the `schema` table. A checksum mismatch on
// an applied file aborts (someone edited history) unless
// {repair: true} re-records checksums.
//
// DETERMINISM is the differ's contract: the same declared/deployed
// pair produces byte-identical steps — and therefore byte-identical
// migration files — on every run and under every model REGISTRATION
// order. Tables process name-sorted; create-table steps order
// FK-topologically (a child's REFERENCES needs its parent to exist);
// drop-table steps reverse-topologically; column steps follow
// declaration order (itself part of the descriptor). Rename
// detection rides the explicit `was:` / `@tableWas` signals ONLY —
// no similarity heuristics (the never-list ethos) — and a rename
// signal the differ cannot consume coherently REJECTS loudly
//.

import { SchemaRegistry } from '../runtime/schema.js';
import {
  runSQL as rawSQL, adapterFor, adapterConfigured,
  transaction, quoteIdent, renderCreate, renderIndex, sqlEnumType, sqlEnumMembers,
} from '../runtime/orm.js';

// ONE table holds everything the runner knows, and it is called what it
// is about: `schema`. Three kinds of row, told apart by the key, which
// is why the reserved ones wear an '@' no version string can produce:
//
//   '0001', '0002', …   an applied migration — the history, and the
//                       only kind anybody reads back
//   '@lock'             the mutex, present ONLY while a migrate runs.
//                       Its arbitration is the PRIMARY KEY itself:
//                       exactly one racer's INSERT lands, the rest hit
//                       the constraint and fail fast.
//   '@op:<id>'          a coordinated run's outcome, recorded durably
//                       so a child that dies before reporting still
//                       leaves evidence a human can find.
//
// A lock is not history and an outcome is not history, so `@` earns its
// keep: appliedMigrations() filters on it in the one place the table is
// ever read, and no caller can forget.
const STATE_TABLE = 'schema';

// The one character that separates bookkeeping from history, spelled
// ONCE. Every reserved key derives from it and so does the filter that
// hides them, so the three can never drift apart.
//
// It is sound because a version can never begin with it: both file
// patterns below (MIGRATION_FILE_RE, PUSH_FILE_RE) start with a digit.
// That is the guarantee this whole scheme rests on — if either regex
// ever admits a leading '@', a migration disappears from its own
// history.
const RESERVED = '@';
const LOCK_KEY = RESERVED + 'lock';
const OP_PREFIX = RESERVED + 'op:';
const NOT_RESERVED = "version NOT LIKE '" + RESERVED + "%'";

// Everything the `detail` column holds, in ONE shape: a JSON object
// carrying its own version tag. It used to hold three — a bare English
// sentence, a JSON array, and a raw multi-line error — sharing one
// column, so no reader could json_extract() a row without first guessing
// which of the three it had, and two of the three did not parse as JSON
// at all. One shape means reading a run outcome is a query, not a
// parser.
//
// `v` is not ceremony: these rows outlive the runner that wrote them, so
// a reader meeting a shape it does not know must be able to SAY so
// rather than mis-read it.
const detailJSON = (fields) => JSON.stringify({ v: 1, ...fields });

// How long a run outcome is worth keeping. The row exists for one job —
// a child died before it could report, and a human is looking for the
// evidence — and that search happens within days. A constant and not a
// flag: a retention window operators can vary per invocation is a window
// nobody can state, and being able to state it is the point.
const OP_RETENTION_DAYS = 90;

// What the runner used to be called. Kept for two jobs: adopting a
// database that predates the rename, and keeping the old names out of
// diffs until every database has been adopted — a plan proposing
// `drop-table _rip_migrations` is the data-loss cousin of silence.
const LEGACY_STATE_TABLE = '_rip_migrations';
const LEGACY_LOCK_TABLE = '_rip_migration_lock';
const LEGACY_OPS_TABLE = '_rip_migration_operations';

// The runner's own state is never part of the schema under management,
// so it must never reach a diff (where "not declared" reads as
// drop-table).
const RUNNER_TABLES = new Set([
  STATE_TABLE, LEGACY_STATE_TABLE, LEGACY_LOCK_TABLE, LEGACY_OPS_TABLE,
]);

export { adapterConfigured as adapterConfigured };

// Every statement the runner issues opts out of harbor's deployment-wide
// statement deadline (HARBOR_STATEMENT_TIMEOUT_MS). `timeoutMs: null`
// sends an explicit 0, which harbor documents as "no limit"; a plain 0
// would send nothing and inherit the default instead. A migration is the
// one workload where a long statement is expected rather than a runaway
// — a 200M-row CREATE INDEX is ~26s on a laptop and minutes on a small
// cloud VM, so a deadline sized for request handlers would kill it with
// no escape. The app path keeps the default and stays protected.
const UNBOUNDED = { timeoutMs: null };
const runSQL = (sql, params = []) => rawSQL(null, sql, params, UNBOUNDED);

// ── row materializer ──────────────────────────────────────────────────

function migrateRows(res) {
  const cols = (res.columns || []).map((c) => c.name);
  return (res.data || []).map((row) => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
    return obj;
  });
}

// ── introspection ─────────────────────────────────────────────────────

// Every verb that touches the database requires a catalog-capable
// adapter, presence-tested exactly like begin(): plan/status/make read
// the deployed schema through it, and migrate's own recovery story
// ("verify with `rip schema status`") is dead on an adapter that
// cannot answer status. The refusal names the fix.
function requireCatalog(who) {
  const adapter = adapterFor(null);
  if (typeof adapter?.catalog !== 'function') {
    throw new Error(
      who + ': the configured adapter has no catalog() — the deployed schema is read in one ' +
      'GET /catalog call, which needs duckdb-harbor >= v0.9.0. Upgrade the deployment your ' +
      'adapter (or RIP_DB_URL) points at, or configure an adapter that implements catalog().');
  }
  return adapter;
}

// `nextval('id')` — the sequence a surrogate primary key draws from,
// as DuckDB reports the column default.
const NEXTVAL_RE = /nextval\(\s*'((?:[^']|'')*)'\s*\)/i;

// Build the DeployedSchema — an array of canonical table specs in the
// same shape `_tableSpec()` produces — from the adapter's `catalog()`:
// one authenticated `GET /catalog` on duckdb-harbor, one stable JSON
// contract (`{harborVersion, duckdbVersion, tables, sequences}`) that
// never varies with the DuckDB version harbor links. Foreign keys
// arrive as structural fields (`columns`/`refTable`/`refColumns`),
// so a referenced table is never recovered from constraint prose.
// The `schema` table is the runner's own state and is filtered out
// below.
export async function introspect() {
  const adapter = requireCatalog('schema.introspect');
  const doc = await adapter.catalog(UNBOUNDED);

  // Only `main` holds tables under management: the contract reports
  // every schema in the served database, and a schema-qualified table
  // cannot even be declared (`crm.accounts` is refused at the model),
  // so tables outside `main` must never reach the differ — undeclared
  // there reads as drop-table.
  const tables = new Map();
  for (const t of doc?.tables ?? []) {
    if (t.schema !== 'main' || RUNNER_TABLES.has(t.name)) continue;
    const columns = (t.columns ?? []).map((c) => ({
      name: c.name,
      type: c.type,
      notNull: c.notNull === true,
      unique: false,
      default: c.default != null && c.default !== '' ? c.default : null,
      was: null,
    }));
    // The contract's uniqueConstraints carry uniqueness declared as a
    // CONSTRAINT (inline column UNIQUE and table-level UNIQUE alike) —
    // uniqueness the indexes list never reports, because the internal
    // ART index behind a constraint is not a `duckdb_indexes()` index.
    // A single-column entry is the column's unique flag. A COMPOSITE
    // entry has no per-column home — the spec models composite
    // uniqueness as unique indexes — so it rides the spec verbatim in
    // `compositeUniques` for the differ to state out loud (note-unique),
    // never silently dropped. A v0.9.0 harbor serves documents without
    // the field, which reads as none — the verbs require catalog(), not
    // this field.
    const compositeUniques = [];
    for (const uc of t.uniqueConstraints ?? []) {
      const cols = uc.columns ?? [];
      if (cols.length === 1) {
        const col = columns.find((c) => c.name === cols[0]);
        if (col) col.unique = true;
      } else if (cols.length > 1) {
        compositeUniques.push([...cols]);
      }
    }
    // The spec's primaryKey is a single-column identity. The contract
    // reports a composite PRIMARY KEY as its full column list; the
    // spec has no representation for one, so it stays null and its
    // member columns stay unmarked — the pk-shape gate then compares
    // the columns as ordinary columns.
    const pk = t.primaryKey ?? [];
    let primaryKey = null;
    if (pk.length === 1) {
      primaryKey = pk[0];
      const col = columns.find((c) => c.name === pk[0]);
      if (col) col.primary = true;
    }
    tables.set(t.name, {
      name: t.name,
      sequence: null,
      primaryKey,
      columns,
      // The contract's indexes are exactly duckdb_indexes(): the ones
      // CREATE INDEX made, never the internal ART indexes behind
      // PRIMARY KEY / UNIQUE constraints.
      indexes: (t.indexes ?? []).map((ix) => ({
        name: ix.name,
        columns: [...(ix.columns ?? [])],
        unique: ix.unique === true,
      })),
      // Multi-column FK arrays fold onto the spec's per-column shape:
      // a joined column list, and the first referenced column.
      foreignKeys: (t.foreignKeys ?? []).map((fk) => {
        const cols = fk.columns ?? [];
        return {
          column: cols.length === 1 ? cols[0] : cols.join(', '),
          refTable: fk.refTable,
          refColumn: (fk.refColumns ?? [])[0] ?? null,
        };
      }),
      compositeUniques,
      tableWas: null,
    });
  }

  // A table's sequence is the one its primary key actually DEFAULTS
  // from — read out of `nextval('…')` rather than guessed from a name.
  // The `<table>_seq` convention held only while each table owned its
  // own sequence; under a shared one (`schema.sequence 'id'`) every
  // table defaults from the same name, and a convention lookup would
  // report all of them as missing.
  const sequences = new Map();
  for (const s of doc?.sequences ?? []) {
    sequences.set(String(s.name), { name: String(s.name), start: Number(s.start) });
  }
  for (const t of tables.values()) {
    const pk = t.primaryKey && t.columns.find((c) => c.name === t.primaryKey);
    // The default names the sequence outright. Falling back to the
    // convention keeps a table matched to its own `<table>_seq` when
    // the pk carries no default to read — the sequence is in the
    // database either way, and saying it is missing would be false.
    const named = NEXTVAL_RE.exec(String(pk?.default ?? ''))?.[1]?.replace(/''/g, "'");
    const seqName = named ?? t.name + '_seq';
    const seq = sequences.get(seqName);
    // `shared` is what the drop-table path reads: a sequence named for
    // this table dies with it, one named anything else is the
    // database's and other tables still default from it.
    if (seq) t.sequence = { ...seq, shared: seq.name !== t.name + '_seq' };
  }

  return { tables: [...tables.values()], sequences: [...sequences.values()] };
}


// Canonical declared schema: one table spec per registered :model,
// NAME-SORTED — the determinism contract's first leg (registration
// order never reaches the diff). A model carrying its own `on:`
// adapter still plans here (the introspection reads the DEFAULT
// adapter's database only) — flagged per table by `ownAdapter` so
// the plan can say so out loud.
export function canonicalDeclared() {
  const tables = [];
  // One table, one model. Two models naming the same table would fold
  // into a single map entry downstream, so whichever declared last
  // would define the table and the other's columns would read as
  // drops — a plan that changes with declaration order.
  const claimedBy = new Map();
  for (const [, entry] of SchemaRegistry._entries) {
    if (entry.kind !== 'model') continue;
    const spec = entry.def._tableSpec();
    if (claimedBy.has(spec.name)) {
      throw new Error(
        "schema.plan: models " + claimedBy.get(spec.name) + ' and ' + entry.def.name +
        " both map to table '" + spec.name + "' — one table has one model. " +
        'Give one of them an @table naming a different table.');
    }
    claimedBy.set(spec.name, entry.def.name);
    if (entry.def._adapter) spec.ownAdapter = entry.def.name;
    tables.push(spec);
  }
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { tables };
}

// ── comparison normalizers ────────────────────────────────────────────

// DuckDB does not persist VARCHAR length hints, and reports several
// type aliases under canonical names. Compare under those
// equivalences.
const TYPE_ALIASES = {
  'TEXT': 'VARCHAR', 'CHARACTER VARYING': 'VARCHAR', 'CHAR': 'VARCHAR', 'BPCHAR': 'VARCHAR', 'STRING': 'VARCHAR',
  'INT': 'INTEGER', 'INT4': 'INTEGER', 'SIGNED': 'INTEGER',
  'INT8': 'BIGINT', 'LONG': 'BIGINT',
  'FLOAT8': 'DOUBLE', 'DOUBLE PRECISION': 'DOUBLE',
  'BOOL': 'BOOLEAN', 'LOGICAL': 'BOOLEAN',
  'DATETIME': 'TIMESTAMP', 'TIMESTAMP WITHOUT TIME ZONE': 'TIMESTAMP',
};

function typeKey(t) {
  // An ENUM is the exception: its member list is not a width hint to
  // be stripped, it IS the type — `ENUM('draft','sent')` and
  // `ENUM('draft','sent','void')` are two different column types, and
  // folding them together would let a new union member ship with no
  // migration. Re-render the members canonically so spelling and
  // spacing don't matter, but compare their payloads case-sensitively:
  // a member is string data, the same rule defaultKey applies to a
  // literal default.
  const members = sqlEnumMembers(t);
  if (members) return sqlEnumType(members);
  const k = String(t || '').toUpperCase().replace(/\(.*\)\s*$/, '').trim();
  return TYPE_ALIASES[k] || k;
}

// Tolerant default comparison: deployed defaults round-trip through
// the catalog with cosmetic differences (CAST wrappers, now() for
// CURRENT_TIMESTAMP, case). Don't emit ALTERs for representation
// noise. Case-folding applies to function/keyword spellings ONLY: a
// string literal's payload is data, so 'Active' and 'active' are two
// different defaults and compare case-sensitively.
function defaultKey(d) {
  if (d == null) return '';
  let s = String(d).trim();
  const cast = s.match(/^CAST\s*\(\s*(.*?)\s+AS\s+[A-Za-z0-9_ ()]+\)$/i);
  if (cast) s = cast[1].trim();
  if (/^'(?:[^']|'')*'$/.test(s)) return s;
  s = s.toLowerCase();
  if (s === 'now()' || s === 'current_timestamp()' || s === 'get_current_timestamp()') s = 'current_timestamp';
  return s;
}

// Fold the unique-field pattern: a UNIQUE column plus its auto-named
// single-column unique index (`idx_<table>_<col>`) count as ONE fact
// — the column's unique flag. Applies to both sides so the differ
// never sees the pair as two separate diffs. Pure: the caller's spec
// (an adapter's canned introspection included) is never mutated —
// diffing must be repeatable on the same inputs (the determinism
// contract).
function foldSpec(spec) {
  const columns = spec.columns.map((c) => ({ ...c }));
  const columnsByName = new Map(columns.map((c) => [c.name, c]));
  const indexes = [];
  for (const ix of spec.indexes) {
    const autoName = ix.columns.length === 1 && ix.name === 'idx_' + spec.name + '_' + ix.columns[0];
    if (ix.unique && autoName) {
      const col = columnsByName.get(ix.columns[0]);
      if (col) { col.unique = true; continue; }
    }
    indexes.push(ix);
  }
  return { ...spec, columns, indexes };
}

function validateSchemaIdentifiers(schema, side) {
  for (const table of schema.tables || []) {
    quoteIdent(table.name, null, side + ' table');
    if (table.primaryKey != null) {
      quoteIdent(table.primaryKey, null, side + ' primary key');
    }
    if (table.tableWas != null) {
      quoteIdent(table.tableWas, null, side + ' previous table');
    }
    if (table.sequence?.name != null) {
      quoteIdent(table.sequence.name, null, side + ' sequence');
    }
    for (const column of table.columns || []) {
      quoteIdent(column.name, null, side + ' column');
      if (column.was != null) {
        quoteIdent(column.was, null, side + ' previous column');
      }
    }
    for (const index of table.indexes || []) {
      quoteIdent(index.name, null, side + ' index');
      for (const column of index.columns || []) {
        quoteIdent(column, null, side + ' index column');
      }
    }
    for (const constraint of table.compositeUniques || []) {
      for (const column of constraint) {
        quoteIdent(column, null, side + ' unique-constraint column');
      }
    }
    for (const fk of table.foreignKeys || []) {
      quoteIdent(fk.column, null, side + ' foreign-key column');
      if (fk.refTable != null) {
        quoteIdent(fk.refTable, null, side + ' foreign-key table');
      }
      if (fk.refColumn != null) {
        quoteIdent(fk.refColumn, null, side + ' foreign-key target column');
      }
    }
  }
}

// ── the differ ────────────────────────────────────────────────────────
//
// Returns classified steps:
//
//   { table, kind, class: 'safe' | 'lossy' | 'destructive' | 'blocked',
//     sql: [statements/comments], notes: [strings] }
//
// Classes gate generation (`make` refuses lossy/destructive without
// the matching allow flag, and refuses `blocked` outright); the
// printed plan always shows everything.
//
// DuckDB ALTER constraints shape several decisions:
//   - ADD COLUMN cannot carry NOT NULL / UNIQUE / REFERENCES →
//     required adds become add + (backfill) + SET NOT NULL; unique
//     adds get a separate CREATE UNIQUE INDEX; FK constraints cannot
//     be added to an existing table at all (note emitted).
//   - A table referenced by another table's FOREIGN KEY is frozen for
//     everything except ADD COLUMN, SET/DROP DEFAULT, and index DDL
//     ("Dependency Error: cannot alter entry") — even DROP TABLE …
//     CASCADE is refused. Steps that hit this wall classify as
//     `blocked`: the change requires dropping/rebuilding the
//     referencing tables around it. A SELF-referencing FK does not
//     freeze its own table.
//   - A table carrying ANY index is frozen the same way for every
//     in-place ALTER except ADD COLUMN, SET/DROP DEFAULT, and index
//     DDL — regardless of which column the index covers or the
//     statement touches. The remedy is manual: drop the index(es),
//     apply, recreate.
//   - No ALTER SEQUENCE RESTART → sequence-start drift is a NOTE
//     step, never silence.
//   - A composite UNIQUE constraint has no spec representation (the
//     unique flag is per-column; composite uniqueness is modeled as
//     unique indexes) → a NOTE step per deployed constraint, never
//     silence.

// Step kinds DuckDB executes even when the table is FK-referenced or
// carries indexes: ADD COLUMN, index DDL (add-unique/drop-unique are
// index DDL under the fold), SET/DROP DEFAULT — plus the note kinds,
// which execute nothing.
const UNBLOCKED_KINDS = new Set([
  'create-table', 'create-sequence', 'add-column', 'create-index', 'drop-index',
  'alter-default',
  'note-fk', 'note-sequence', 'note-adapter', 'note-primary-key', 'note-column-case', 'note-unique',
]);

// Steps on a renamed table carry the NEW name; deployed evidence is
// keyed by the OLD one. Map new → old off the plan's own rename steps.
const renamedFrom = (steps) =>
  new Map(steps.filter((s) => s.kind === 'rename-table' && s.oldName).map((s) => [s.table, s.oldName]));

// Mark steps that DuckDB will refuse because the target table is
// referenced by other tables' FOREIGN KEYs. A drop-table step is
// exempt from blocking by FKs whose OWNING table is itself dropped in
// this plan: drops order children-first, so by the time the parent's
// DROP runs its referencing tables are gone. A self-referencing FK
// never freezes its own table. A FOREIGN KEY whose referenced table
// is UNKNOWN (the catalog evidence resolved to nothing) may reference
// ANY table, so it blocks every non-exempt step — unknown fails
// closed, never open.
function applyFkBlocks(steps, deployed) {
  const droppedTables = new Set(steps.filter((s) => s.kind === 'drop-table').map((s) => s.table));
  const oldNames = renamedFrom(steps);
  const referencedBy = new Map(); // table → [{from, ref: 'child.fk_col'}]
  const unknownRefs = []; // [{from, ref}] — FKs with an undetermined target
  for (const t of deployed.tables) {
    for (const fk of t.foreignKeys) {
      if (fk.refTable === t.name) continue;
      if (fk.refTable == null) {
        unknownRefs.push({ from: t.name, ref: t.name + '.' + fk.column });
        continue;
      }
      if (!referencedBy.has(fk.refTable)) referencedBy.set(fk.refTable, []);
      referencedBy.get(fk.refTable).push({ from: t.name, ref: t.name + '.' + fk.column });
    }
  }
  for (const s of steps) {
    if (UNBLOCKED_KINDS.has(s.kind)) continue;
    const dropFilter = (list) =>
      (s.kind === 'drop-table' ? list.filter((r) => !droppedTables.has(r.from)) : list);
    const refs = dropFilter(referencedBy.get(s.table) ||
      (oldNames.has(s.table) ? referencedBy.get(oldNames.get(s.table)) : null) || []);
    if (refs.length) {
      s.class = 'blocked';
      s.notes.push(
        'DuckDB refuses this ALTER while ' + refs.map((r) => r.ref).join(', ') + ' reference(s) this table ' +
        '("Dependency Error"). Rebuild the referencing table(s) around this change, or ' +
        'apply it manually with the referencing tables dropped and recreated.');
    }
    const unknowns = dropFilter(unknownRefs);
    if (unknowns.length) {
      s.class = 'blocked';
      s.notes.push(
        'the FOREIGN KEY on ' + unknowns.map((r) => r.ref).join(', ') + ' has a referenced table this ' +
        'introspection could not determine, so it may reference this one — an unknown reference blocks, ' +
        'never passes. Fix the catalog evidence (or drop the constraint), then re-plan.');
    }
  }
  return steps;
}

// The index twin of applyFkBlocks: DuckDB refuses every in-place
// ALTER except ADD COLUMN, SET/DROP DEFAULT, and index DDL on a table
// carrying ANY index ("Dependency Error", regardless of which column
// the index covers or the statement touches) — and the ORM's own DDL
// creates an index for every @unique field and @index. The remedy
// stays manual by design: drop the index(es), apply the change,
// recreate them — auto-planning that sandwich would silently widen a
// migration's blast radius, so the plan blocks and names it instead.
const INDEX_BLOCKED_KINDS = new Set([
  'rename-table', 'rename-column', 'set-not-null', 'drop-not-null', 'alter-type', 'drop-column',
]);

function applyIndexBlocks(steps, deployed) {
  const oldNames = renamedFrom(steps);
  const indexesOn = new Map(deployed.tables
    .filter((t) => (t.indexes || []).length)
    .map((t) => [t.name, t.indexes]));
  for (const s of steps) {
    if (!INDEX_BLOCKED_KINDS.has(s.kind)) continue;
    const ixs = indexesOn.get(s.table) ||
      (oldNames.has(s.table) ? indexesOn.get(oldNames.get(s.table)) : null);
    if (!ixs) continue;
    s.class = 'blocked';
    s.notes.push(
      'DuckDB refuses this ALTER while index(es) ' + ixs.map((ix) => ix.name).join(', ') + ' exist on this ' +
      'table ("Dependency Error"). Drop the index(es), apply the change, then recreate: ' +
      ixs.map((ix) => renderIndex({ name: s.table }, ix)).join(' '));
  }
  return steps;
}

// Stable topological order over `names` (already deterministic on
// input) where `depsOf(name)` lists the names that must come FIRST.
// Ties break by input order (name-sorted upstream). A cycle rejects
// loudly with its members named — an unorderable FK cycle can never
// silently emit unexecutable DDL.
function topoOrder(names, depsOf, what) {
  const remaining = new Set(names);
  const out = [];
  while (remaining.size) {
    let placed = false;
    for (const n of names) {
      if (!remaining.has(n)) continue;
      if (depsOf(n).some((d) => remaining.has(d))) continue;
      out.push(n);
      remaining.delete(n);
      placed = true;
    }
    if (!placed) {
      throw new Error(
        'schema.plan: ' + what + ' order is impossible — tables ' + [...remaining].join(', ') +
        ' reference each other via FOREIGN KEY (a cycle). DuckDB cannot add FK constraints after ' +
        'CREATE TABLE, so no statement order satisfies this; break the cycle (drop one @belongsTo, ' +
        'or move one side behind its own adapter).');
    }
  }
  return out;
}

export function diffSchemas(declared, deployed) {
  // Identifiers also appear in readable migration comments. Quoting
  // protects executable SQL positions, but a control character could
  // terminate a `-- NOTE` line, so validate the complete identifier
  // surface before either steps or comments are rendered.
  validateSchemaIdentifiers(declared, 'declared');
  validateSchemaIdentifiers(deployed, 'deployed');
  const steps = [];
  // Tables process NAME-SORTED here regardless of the caller's
  // ordering — determinism is this function's own contract, not a
  // property it borrows from canonicalDeclared().
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const declaredSorted = [...declared.tables].sort(byName);
  // canonicalDeclared() refuses this at the model level; a
  // caller-built `declared` reaches the same maps without passing
  // through it, and the maps below would silently keep the last one.
  for (let i = 1; i < declaredSorted.length; i++) {
    if (declaredSorted[i].name === declaredSorted[i - 1].name) {
      throw new Error("schema.plan: table '" + declaredSorted[i].name +
        "' is declared twice — one table has one declaration.");
    }
  }
  // The fold is a COMPARISON normalization only — create-table steps
  // render from the raw spec, or the folded-away single-column
  // unique indexes would silently vanish from migration-created
  // tables.
  const dRaw = new Map(declaredSorted.map((t) => [t.name, t]));
  const dTables = new Map(declaredSorted.map((t) => [t.name, foldSpec(t)]));
  // Belt and suspenders with introspect()'s filter: the runner's own
  // state must never enter the diff from ANY caller — a plan proposing
  // `drop-table schema` is the data-loss cousin of a silent acceptance.
  const pTables = new Map(deployed.tables
    .filter((t) => !RUNNER_TABLES.has(t.name))
    .map((t) => [t.name, foldSpec(t)]));

  // Deployed dependency evidence, per table: the FK references and
  // (raw, unfolded) index lists under which the engine refuses
  // in-place ALTERs. diffTable consults these where a step would
  // otherwise piggyback a statement the engine refuses on such a
  // table; the block passes over applyFkBlocks / applyIndexBlocks.
  const fkRefsOn = new Map();     // table → ['child.fk_col', …]
  const unknownFkRefs = [];       // FKs whose referenced table is undetermined
  const indexNamesOn = new Map(); // table → [index name, …]
  for (const t of deployed.tables) {
    if (RUNNER_TABLES.has(t.name)) continue;
    for (const fk of t.foreignKeys || []) {
      if (fk.refTable === t.name) continue;
      if (fk.refTable == null) { unknownFkRefs.push(t.name + '.' + fk.column); continue; }
      if (!fkRefsOn.has(fk.refTable)) fkRefsOn.set(fk.refTable, []);
      fkRefsOn.get(fk.refTable).push(t.name + '.' + fk.column);
    }
    if ((t.indexes || []).length) indexNamesOn.set(t.name, t.indexes.map((ix) => ix.name));
  }

  // Rename-signal validation, BEFORE anything consumes them: a
  // `@tableWas` the differ cannot act on coherently is a rejection,
  // never a silent fall-through to create + drop.
  const wasClaims = new Map(); // old table name → claiming new name
  for (const [name, d] of dTables) {
    if (!d.tableWas) continue;
    if (dTables.has(d.tableWas)) {
      throw new Error(
        "schema.plan: @tableWas '" + d.tableWas + "' on " + name + ' names a table the models still declare — ' +
        'a rename\'s old name cannot also be a live table. Remove the @tableWas, or rename the other model.');
    }
    if (wasClaims.has(d.tableWas)) {
      throw new Error(
        "schema.plan: @tableWas '" + d.tableWas + "' is claimed by both " + wasClaims.get(d.tableWas) +
        ' and ' + name + ' — one deployed table cannot rename to two. Remove one @tableWas.');
    }
    wasClaims.set(d.tableWas, name);
    if (pTables.has(name) && pTables.has(d.tableWas)) {
      throw new Error(
        'schema.plan: ' + name + " declares @tableWas '" + d.tableWas + "', but BOTH tables exist in the " +
        'database — the rename already landed and something recreated ' + d.tableWas + ', or the signal is ' +
        'stale. Remove the @tableWas, or drop the leftover table manually.');
    }
  }

  // Table renames first: declared table missing from deployed, with a
  // @tableWas pointing at a deployed table.
  for (const [name, d] of dTables) {
    if (pTables.has(name) || !d.tableWas) continue;
    const old = pTables.get(d.tableWas);
    if (old) {
      steps.push({
        table: name, kind: 'rename-table', class: 'safe', oldName: d.tableWas,
        sql: ['ALTER TABLE ' + quoteIdent(d.tableWas, null, 'rename source table') +
          ' RENAME TO ' + quoteIdent(name, null, 'rename target table') + ';'],
        notes: ['@tableWas ' + d.tableWas + ' can be removed once this migration lands'],
      });
      pTables.delete(d.tableWas);
      pTables.set(name, { ...old, name });
      // The dependency evidence follows the rename with the spec.
      for (const m of [fkRefsOn, indexNamesOn]) {
        if (m.has(d.tableWas)) { m.set(name, m.get(d.tableWas)); m.delete(d.tableWas); }
      }
    }
  }

  // Shared sequences the database does not have yet. A per-table
  // sequence rides its table's CREATE; a shared one is the database's
  // own object, outliving every table that draws from it, so it is
  // created up front — ahead of the create-table steps whose id
  // columns default from it, and equally for a table that already
  // exists and lost it. `madeSequences` then tells diffTable which
  // "sequence missing" facts this plan already fixes, so the note
  // states what the plan does NOT handle.
  const pSeqNames = new Set([
    ...(deployed.sequences ?? []).map((q) => String(q.name)),
    ...deployed.tables.map((t) => t.sequence?.name).filter((n) => n != null),
  ]);
  const madeSequences = new Map();
  for (const [, d] of dTables) {
    const seq = d.sequence;
    if (!seq?.shared || pSeqNames.has(seq.name) || madeSequences.has(seq.name)) continue;
    madeSequences.set(seq.name, seq);
    steps.push({
      table: seq.name, kind: 'create-sequence', class: 'safe',
      sql: ['CREATE SEQUENCE ' + quoteIdent(seq.name, null, 'sequence') + ' START ' + seq.start + ';'],
      notes: [],
    });
  }

  // Matched tables next: column / index / FK diffs. Alters run BEFORE
  // create-table steps on purpose — a new child table's FOREIGN KEY
  // freezes its parent the moment it exists, so a migration that both
  // alters `orders` and creates `invoices REFERENCES orders` must
  // alter first. A matched table on its own adapter still diffs
  // against the DEFAULT adapter's same-named table (introspection
  // reads only that database), so its steps carry the note-adapter
  // step the create path already emits — the plan says out loud whose
  // database the DDL would hit.
  for (const [name, d] of dTables) {
    const p = pTables.get(name);
    if (!p) continue;
    const before = steps.length;
    diffTable(d, p, steps, {
      fkRefs: fkRefsOn.get(name) || [],
      indexNames: indexNamesOn.get(name) || [],
      unknownFkRefs,
      madeSequences,
    });
    if (d.ownAdapter && steps.length > before) steps.push(adapterNote(name, d.ownAdapter));
  }

  // New tables, FK-topologically ordered: a created child's
  // REFERENCES needs its parent created first (only dependencies on
  // OTHER tables created in this same plan constrain the order;
  // self-references and references to already-deployed tables do
  // not).
  const newNames = [...dTables.keys()].filter((n) => !pTables.has(n));
  const created = new Set(newNames);
  const orderedNew = topoOrder(newNames, (n) =>
    dTables.get(n).foreignKeys
      .map((fk) => fk.refTable)
      .filter((ref) => ref !== n && created.has(ref)), 'create-table');
  for (const name of orderedNew) {
    const d = dTables.get(name);
    steps.push({
      table: name, kind: 'create-table', class: 'safe',
      sql: renderCreate(dRaw.get(name)),
      notes: [],
    });
    if (d.ownAdapter) steps.push(adapterNote(name, d.ownAdapter));
  }

  // Dropped tables (deployed but not declared) — the "someone ran
  // manual SQL" detector doubles as the model-deletion path.
  // Destructive; children drop before the parents they reference.
  const droppedNames = [...pTables.keys()].filter((n) => !dTables.has(n)).sort();
  const orderedDrops = topoOrder(droppedNames, (n) => {
    // A parent waits for every dropped child that references it.
    const waits = [];
    for (const child of droppedNames) {
      if (child === n) continue;
      if (pTables.get(child).foreignKeys.some((fk) => fk.refTable === n)) waits.push(child);
    }
    return waits;
  }, 'drop-table');
  for (const name of orderedDrops) {
    const p = pTables.get(name);
    const sql = ['DROP TABLE ' + quoteIdent(name, null, 'table') + ';'];
    // A sequence named for this table dies with it; a shared one is
    // the database's and other tables still default from it.
    if (p.sequence && !p.sequence.shared) {
      sql.push('DROP SEQUENCE ' + quoteIdent(p.sequence.name, null, 'sequence') + ';');
    }
    steps.push({ table: name, kind: 'drop-table', class: 'destructive', sql, notes: [] });
  }

  return applyIndexBlocks(applyFkBlocks(steps, deployed), deployed);
}

// The step that names whose database a table's DDL would hit: a model
// with its own on: adapter plans here against the DEFAULT adapter's
// database (introspection reads only that one). Emitted beside the
// table's create step and beside any matched-table diff steps.
const adapterNote = (table, ownAdapter) => ({
  table, kind: 'note-adapter', class: 'safe',
  sql: ['-- NOTE: ' + ownAdapter + ' declares its own on: adapter; this plan reads and writes the ' +
        'DEFAULT adapter\'s database only — apply this table\'s DDL against its own database yourself'],
  notes: [],
});

// Uniqueness on an EXISTING table is a table REBUILD, not an index.
//
// DuckDB offers no working instrument for either direction:
// `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` reports success and then
// CORRUPTS the table — every following statement, INSERT / ALTER / even
// `SELECT count(*)`, throws `INTERNAL Error: Attempted to access index N
// within vector of size N`, and the catalog stops reporting the table's
// constraints. Measured on v2.0.0-alpha38195 over CLEAN data as well as
// duplicate, so it is total breakage, not a validation gap.
// `DROP CONSTRAINT` throws the same error outright.
//
// A unique INDEX does work, and was what this planner emitted — but an
// index is a catalog object the table DEPENDS on, and DuckDB then
// refuses to ALTER that table at all: the WHOLE table, not merely the
// indexed column, for DROP, RENAME and type changes alike. Buying
// uniqueness with an index costs every future migration on that table.
//
// So: create the table in its target shape, copy, drop, rename,
// recreate the surviving indexes. Rendered from the DEPLOYED shape with
// only the unique flags moved, so it changes exactly uniqueness and
// nothing else; spliced AHEAD of this table's other steps so those
// still apply, in order, to the rebuilt table.
//
// The duplicate check comes free and stays loud: the INSERT ... SELECT
// lands in a table that already carries the constraint, so existing
// duplicates fail the copy the same way CREATE UNIQUE INDEX failed.
function rebuildForUnique(p, wanted) {
  const tmp = p.name + '__rip_rebuild';
  const columns = p.columns.map((c) => (wanted.has(c.name) ? { ...c, unique: wanted.get(c.name) } : c));
  // Every column named on BOTH sides of the copy: same-typed columns
  // cannot silently transpose the way `INSERT ... SELECT *` allows.
  const names = columns.map((c) => quoteIdent(c.name, null, 'column')).join(', ');
  return [
    ...renderCreate({ ...p, name: tmp, sequence: null, indexes: [], notes: [], columns }),
    'INSERT INTO ' + quoteIdent(tmp, null, 'table') + ' (' + names + ') SELECT ' + names +
      ' FROM ' + quoteIdent(p.name, null, 'table') + ';',
    'DROP TABLE ' + quoteIdent(p.name, null, 'table') + ';',
    'ALTER TABLE ' + quoteIdent(tmp, null, 'table') +
      ' RENAME TO ' + quoteIdent(p.name, null, 'table') + ';',
    ...p.indexes.map((ix) => renderIndex(p, ix)),
  ];
}

function diffTable(d, p, steps, deps) {
  const t = d.name;
  const dCols = new Map(d.columns.map((c) => [c.name, c]));
  const pCols = new Map(p.columns.map((c) => [c.name, c]));
  // Where this table's steps start — the uniqueness rebuild is spliced
  // in here at the end, ahead of everything else planned for the table.
  const mark = steps.length;
  const uniqueChanges = [];

  // A moved PRIMARY KEY is not a column diff, and the column diff's
  // answer to it is actively wrong: it reads as one column added and
  // another dropped, so the ADD backfills fresh sequence values and
  // every row's identity silently changes while child FKs keep
  // pointing at the old ones. There is no ALTER that moves a primary
  // key, so say so and stop — a blocked step an operator reads beats
  // a plan that rewrites identities and calls the rewriting half safe.
  if (d.primaryKey && p.primaryKey && d.primaryKey !== p.primaryKey) {
    steps.push({
      table: t, kind: 'note-primary-key', class: 'blocked',
      sql: ['-- BLOCKED: ' + t + ' primary key ' + p.primaryKey + ' -> ' + d.primaryKey],
      notes: ['the deployed primary key is ' + p.primaryKey + ' and the model declares ' +
        d.primaryKey + '. Moving a primary key is not an ALTER: the values must be copied, ' +
        'the constraint moved, and every referencing foreign key updated in step. Do it as a ' +
        'hand-written migration, or keep the deployed column name.'],
    });
    return;
  }

  // Rename-signal validation (the column half of the rename rule):
  // duplicates, still-declared old names, and old-and-new-both-
  // deployed all reject before anything degrades silently.
  const wasClaims = new Map();
  for (const [name, col] of dCols) {
    if (!col.was) continue;
    if (dCols.has(col.was)) {
      throw new Error(
        "schema.plan: {was: '" + col.was + "'} on " + t + '.' + name + ' names a column the model still ' +
        'declares — a rename\'s old column cannot also be live. Remove the was:, or free the old name by ' +
        'renaming the field that declares it.');
    }
    if (wasClaims.has(col.was)) {
      throw new Error(
        "schema.plan: {was: '" + col.was + "'} is claimed by both " + t + '.' + wasClaims.get(col.was) +
        ' and ' + t + '.' + name + ' — one deployed column cannot rename to two. Remove one was:.');
    }
    wasClaims.set(col.was, name);
    if (pCols.has(name) && pCols.has(col.was)) {
      throw new Error(
        'schema.plan: ' + t + '.' + name + " declares {was: '" + col.was + "'}, but BOTH columns exist in " +
        'the database — the rename already landed and something recreated ' + col.was + ', or the signal ' +
        'is stale. Remove the was:, or drop the leftover column manually.');
    }
  }

  // Column renames: declared column missing from deployed whose `was`
  // names a deployed column.
  for (const [name, col] of dCols) {
    if (pCols.has(name) || !col.was) continue;
    const old = pCols.get(col.was);
    if (old) {
      steps.push({
        table: t, kind: 'rename-column', class: 'safe',
        sql: ['ALTER TABLE ' + quoteIdent(t, null, 'table') +
          ' RENAME COLUMN ' + quoteIdent(col.was, null, 'rename source column') +
          ' TO ' + quoteIdent(name, null, 'rename target column') + ';'],
        notes: ['{was: "' + col.was + '"} on ' + name + ' can be removed once this migration lands'],
      });
      pCols.delete(col.was);
      pCols.set(name, { ...old, name });
    }
  }

  // What the engine's dependency tracking holds over this table — the
  // conditions under which every in-place ALTER (SET NOT NULL
  // included) draws "Dependency Error": FK references from other
  // tables, any index, or a FOREIGN KEY whose target is unknown
  // (which may reference this table, so it counts — fail closed).
  const holds = [];
  if (deps.fkRefs.length) holds.push('FOREIGN KEY ' + deps.fkRefs.join(', '));
  if (deps.indexNames.length) holds.push('index(es) ' + deps.indexNames.join(', '));
  if (deps.unknownFkRefs.length) holds.push('FOREIGN KEY(s) with an undetermined target (' + deps.unknownFkRefs.join(', ') + ')');

  // Added columns.
  for (const [name, col] of dCols) {
    if (pCols.has(name)) continue;
    // DuckDB matches identifiers case-insensitively, so a declared
    // column differing from a deployed one only by letter case is
    // neither an add (the ADD collides with the existing column) nor
    // a rename (RENAME cannot change only case). The pair is stated
    // and blocked, and the deployed column is withheld from the drop
    // list — an add + drop here would fail at apply and read as a
    // data-destroying rewrite besides.
    const cased = [...pCols.keys()].find((n2) => n2.toLowerCase() === name.toLowerCase());
    if (cased && !dCols.has(cased)) {
      steps.push({
        table: t, kind: 'note-column-case', class: 'blocked',
        sql: ['-- BLOCKED: ' + t + '.' + cased + ' -> ' + name + ' changes only letter case'],
        notes: ['the declared column ' + name + ' and the deployed column ' + cased + ' differ only by ' +
          'letter case, which DuckDB cannot express: identifiers match case-insensitively, so the ADD ' +
          'collides with the existing column and no RENAME applies. Declare {column: "' + cased + '"} to ' +
          'keep the deployed spelling, or rebuild the table.'],
      });
      pCols.delete(cased);
      continue;
    }
    const sql = [];
    const notes = [];
    let cls = 'safe';
    // DuckDB: ADD COLUMN cannot carry constraints. DEFAULT is allowed
    // (and backfills existing rows), so add with the default when one
    // is declared, then tighten with SET NOT NULL.
    let add = 'ALTER TABLE ' + quoteIdent(t, null, 'table') +
      ' ADD COLUMN ' + quoteIdent(name, null, 'column') + ' ' + col.type;
    if (col.default != null) add += ' DEFAULT ' + col.default;
    sql.push(add + ';');
    if (col.notNull) {
      if (col.default == null) {
        // A required column with no default cannot SET NOT NULL on a
        // populated table until rows are backfilled — the executable
        // half is WITHHELD, stated as the manual step, and the step
        // classifies lossy (the lossy-classification rule;
        // #116). After the backfill, the next plan emits set-not-null
        // as its own step, so the workflow converges.
        cls = 'lossy';
        sql.push('-- REQUIRED with no default: backfill ' + t + '.' + name +
          ', then apply: ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' SET NOT NULL;');
        notes.push('the SET NOT NULL is withheld — it fails on any populated table until ' + t + '.' + name +
          ' is backfilled; after the backfill, the next plan emits it as its own step');
      } else if (holds.length) {
        // The default backfills, but DuckDB refuses SET NOT NULL
        // outright while anything depends on the table — piggybacking
        // it here would ship a step that fails at apply, riding around
        // the FK/index blocks by kind. The executable half is WITHHELD
        // like the no-default case; the ADD (with its backfilling
        // DEFAULT) is permitted and stays. The next plan emits
        // set-not-null as its own step, which blocks with the remedy.
        sql.push('-- REQUIRED, but ' + holds.join(' and ') + ' depend(s) on ' + t + ' and DuckDB refuses ' +
          'SET NOT NULL while they exist; after clearing them, apply: ALTER TABLE ' + t +
          ' ALTER COLUMN ' + name + ' SET NOT NULL;');
        notes.push('the SET NOT NULL is withheld — DuckDB refuses it ("Dependency Error") while ' +
          holds.join(' and ') + ' depend(s) on ' + t + '; the next plan emits it as its own step');
      } else {
        sql.push('ALTER TABLE ' + quoteIdent(t, null, 'table') +
          ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' SET NOT NULL;');
      }
    }
    if (col.unique) {
      // ADD COLUMN cannot carry UNIQUE, and uniqueness after the fact
      // is a table rebuild (see rebuildForUnique) — which cannot be
      // planned here, because this column does not exist in the
      // deployed shape the rebuild is rendered from. So the uniqueness
      // is WITHHELD, the way SET NOT NULL is withheld above: the column
      // lands now, the next plan sees the flag differ and emits
      // add-unique as its own rebuilding step. The workflow converges.
      sql.push('-- UNIQUE withheld: ADD COLUMN cannot carry it and adding it needs a table ' +
        'rebuild; the next plan emits add-unique for ' + t + '.' + name + '.');
      notes.push('the UNIQUE is withheld — ADD COLUMN cannot carry a constraint, and adding one to a ' +
        'live table means rebuilding it; the next plan emits add-unique as its own step');
    }
    const fk = d.foreignKeys.find((f) => f.column === name);
    if (fk) {
      notes.push('DuckDB cannot add FOREIGN KEY constraints to an existing table; ' +
        name + ' -> ' + fk.refTable + '(' + fk.refColumn + ') is unenforced until the table is recreated');
    }
    steps.push({ table: t, kind: 'add-column', class: cls, sql, notes });
  }

  // Dropped columns.
  for (const [name] of pCols) {
    if (dCols.has(name)) continue;
    steps.push({
      table: t, kind: 'drop-column', class: 'destructive',
      sql: ['ALTER TABLE ' + quoteIdent(t, null, 'table') +
        ' DROP COLUMN ' + quoteIdent(name, null, 'column') + ';'],
      notes: [],
    });
  }

  // Altered columns.
  for (const [name, dc] of dCols) {
    const pc = pCols.get(name);
    if (!pc) continue;
    // A SURROGATE pk has a fixed shape (INTEGER + nextval), so when
    // BOTH sides verify as that shape and agree there is nothing to
    // diff — the skip fires there and ONLY there. A NATURAL pk is an
    // ordinary column that happens to be the identity — its type,
    // length and nullability are the field's, and they drift like any
    // other, so two natural sides fall through to the normal column
    // diff. Every OTHER pk disagreement — a deployed pk of the wrong
    // shape, a missing PRIMARY KEY constraint, a surrogate↔natural
    // posture flip on the same column name — has no ALTER that fixes
    // a primary key in place, and the column diff's answer (add +
    // drop) rewrites row identities; so it blocks and says so.
    const surrogate = (c) => c.primary === true && /nextval\(/i.test(String(c.default ?? ''));
    const seqOf = (c) => NEXTVAL_RE.exec(String(c.default ?? ''))?.[1]?.replace(/''/g, "'") ?? null;
    const dPk = dc.primary === true;
    const pPk = pc.primary === true;
    if (dPk || pPk) {
      const dSur = surrogate(dc);
      const pSur = surrogate(pc);
      if (dSur && pSur && typeKey(dc.type) === typeKey(pc.type) && dc.notNull === pc.notNull) {
        // Same shape, but two surrogates can still draw from DIFFERENT
        // sequences — a database moving its tables onto one shared
        // counter. Repointing the default is an ordinary ALTER (DuckDB
        // allows SET DEFAULT even on a frozen table), so it plans
        // rather than blocking.
        //
        // Only toward a SHARED sequence, which is a database-level
        // object this plan creates or already found. A per-table name
        // that differs is a RENAMED table — `ALTER TABLE … RENAME` does
        // not rename the sequence, so the table rightly keeps drawing
        // from the old one and there is nothing to repoint it to.
        const dSeqName = d.sequence?.shared ? seqOf(dc) : null;
        const pSeqName = seqOf(pc);
        if (dSeqName != null && dSeqName !== pSeqName) {
          steps.push({
            table: t, kind: 'alter-default', class: 'safe',
            sql: ['ALTER TABLE ' + quoteIdent(t, null, 'table') +
              ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' SET DEFAULT ' + dc.default + ';'],
            notes: ['new rows draw from ' + dSeqName + ' instead of ' + pSeqName +
              '; ids ALREADY assigned keep the values the old sequence gave them, so a shared ' +
              'sequence makes ids unique from here forward, not retroactively'],
          });
        }
        continue;
      }
      if (dPk !== pPk || dSur || pSur) {
        const pkShape = (c, sur, isPk) => sur
          ? 'a surrogate primary key (' + c.type + ' + ' + c.default + ')'
          : (isPk ? 'a ' + c.type + ' primary key' : 'a non-primary ' + c.type + ' column') +
            (c.default != null ? ' with DEFAULT ' + c.default : ' with no default');
        steps.push({
          table: t, kind: 'note-primary-key', class: 'blocked',
          sql: ['-- BLOCKED: ' + t + '.' + name + ' primary-key shape differs from the model'],
          notes: ['the model declares ' + t + '.' + name + ' as ' + pkShape(dc, dSur, dPk) +
            ' but the database holds ' + pkShape(pc, pSur, pPk) + '. No ALTER changes a primary key in ' +
            'place: fix it as a hand-written migration (copy the values, move the constraint, update every ' +
            'referencing foreign key in step), or align the model with the deployed shape.'],
        });
        continue;
      }
    }
    if (typeKey(dc.type) !== typeKey(pc.type)) {
      steps.push({
        table: t, kind: 'alter-type', class: 'lossy',
        sql: ['ALTER TABLE ' + quoteIdent(t, null, 'table') +
          ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' TYPE ' + dc.type + ';'],
        notes: [pc.type + ' -> ' + dc.type + ' casts existing values; rows that cannot cast will fail the migration'],
      });
    }
    if (dc.notNull !== pc.notNull) {
      if (dc.notNull) {
        steps.push({
          table: t, kind: 'set-not-null', class: 'lossy',
          sql: ['ALTER TABLE ' + quoteIdent(t, null, 'table') +
            ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' SET NOT NULL;'],
          notes: ['fails if existing rows hold NULLs — backfill first'],
        });
      } else {
        steps.push({
          table: t, kind: 'drop-not-null', class: 'safe',
          sql: ['ALTER TABLE ' + quoteIdent(t, null, 'table') +
            ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' DROP NOT NULL;'],
          notes: [],
        });
      }
    }
    if (defaultKey(dc.default) !== defaultKey(pc.default)) {
      steps.push({
        table: t, kind: 'alter-default', class: 'safe',
        sql: [dc.default != null
          ? 'ALTER TABLE ' + quoteIdent(t, null, 'table') +
            ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' SET DEFAULT ' + dc.default + ';'
          : 'ALTER TABLE ' + quoteIdent(t, null, 'table') +
            ' ALTER COLUMN ' + quoteIdent(name, null, 'column') + ' DROP DEFAULT;'],
        notes: [],
      });
    }
    if (dc.unique !== pc.unique) uniqueChanges.push({ name, adding: !!dc.unique });
  }

  // Index diffs (auto-unique indexes already folded into column
  // flags).
  const dIdx = new Map(d.indexes.map((i) => [i.name, i]));
  const pIdx = new Map(p.indexes.map((i) => [i.name, i]));
  for (const [name, ix] of dIdx) {
    const ex = pIdx.get(name);
    if (ex && ex.unique === ix.unique &&
        ex.columns.join(',') === ix.columns.join(',')) continue;
    const sql = [];
    if (ex) sql.push('DROP INDEX ' + quoteIdent(name, null, 'index') + ';');
    sql.push(renderIndex(d, ix));
    steps.push({
      table: t, kind: 'create-index', class: ix.unique ? 'lossy' : 'safe',
      sql,
      notes: ix.unique ? ['unique index creation fails if existing rows hold duplicates'] : [],
    });
  }
  for (const [name] of pIdx) {
    if (dIdx.has(name)) continue;
    steps.push({
      table: t, kind: 'drop-index', class: 'safe',
      sql: ['DROP INDEX ' + quoteIdent(name, null, 'index') + ';'],
      notes: [],
    });
  }

  // Composite UNIQUE constraints (hand-written `UNIQUE (a, b)` DDL)
  // have no spec representation — the unique flag is per-column, and
  // composite uniqueness is modeled as unique indexes — so the
  // database enforces them while declared-vs-deployed diffing cannot
  // see them. A fact the planner sees but cannot act on is a NOTE
  // step (the sequence-drift rule), one per constraint, ordered by
  // column list; it gates nothing and reclassifies nothing. When the
  // model declares a unique index over the same column set, the note
  // also states the redundancy — and any planned CREATE UNIQUE INDEX
  // stays as classed: measured on DuckDB v1.5.5 and v2.0.0-alpha,
  // a unique index over an already-constrained column
  // set creates successfully on a populated table (the constraint
  // guarantees no duplicates exist), lands in duckdb_indexes(), and
  // drops cleanly with the constraint still enforcing.
  const composites = [...(p.compositeUniques ?? [])]
    .map((cols) => [...cols])
    .sort((a, b) => {
      const ka = a.join(', ');
      const kb = b.join(', ');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  for (const cols of composites) {
    const list = cols.join(', ');
    const set = new Set(cols);
    const twin = d.indexes.find((ix) =>
      ix.unique && ix.columns.length === set.size && ix.columns.every((c) => set.has(c)));
    const twinDeployed = twin && p.indexes.some((ix) =>
      ix.name === twin.name && ix.unique === twin.unique &&
      ix.columns.join(',') === twin.columns.join(','));
    let text = '-- NOTE: ' + t + ' carries a composite UNIQUE constraint on (' + list + ') that the model ' +
      'layer cannot express — the database enforces it, but it is invisible to declared-vs-deployed ' +
      'diffing; the expressible equivalent is a unique index (@unique [' + list + '])';
    if (twin) {
      text += '. The declared unique index ' + twin.name + ' (' + twin.columns.join(', ') + ') covers the ' +
        'same columns and is redundant with this constraint' +
        (twinDeployed
          ? ' — the database enforces this uniqueness twice'
          : '; its CREATE UNIQUE INDEX succeeds harmlessly — DuckDB accepts a unique index over an ' +
            'already-constrained column set, and the constraint guarantees no duplicates exist — after ' +
            'which the index is visible to diffing and the plans converge');
    }
    steps.push({ table: t, kind: 'note-unique', class: 'safe', sql: [text], notes: [] });
  }

  // FK diffs are notes only — DuckDB has no ALTER TABLE ADD/DROP
  // CONSTRAINT.
  const pFks = new Set(p.foreignKeys.map((f) => f.column));
  for (const fk of d.foreignKeys) {
    if (pFks.has(fk.column) || !pCols.has(fk.column)) continue;
    steps.push({
      table: t, kind: 'note-fk', class: 'safe',
      sql: ['-- NOTE: ' + t + '.' + fk.column + ' should reference ' + fk.refTable + '(' + fk.refColumn + ') ' +
           'but DuckDB cannot add FK constraints to an existing table'],
      notes: [],
    });
  }

  // Sequence-start drift: DuckDB has no ALTER SEQUENCE RESTART, so
  // the drift is a NOTE step — a fact the plan states out loud, never
  // silence. Fires when the starts differ or the
  // deployed sequence is missing outright.
  const dSeq = d.sequence || null;
  const pSeq = p.sequence || null;
  const made = dSeq && deps.madeSequences?.has(dSeq.name);
  if (dSeq && !pSeq && !made) {
    steps.push({
      table: t, kind: 'note-sequence', class: 'safe',
      sql: ['-- NOTE: ' + t + ' has no ' + dSeq.name + ' sequence in the database (the model expects one, START ' +
            dSeq.start + '); id assignment via nextval will fail — recreate the sequence manually'],
      notes: [],
    });
  } else if (dSeq && pSeq && dSeq.name === pSeq.name && dSeq.start !== pSeq.start) {
    const seed = dSeq.shared
      ? "schema.sequence('" + dSeq.name + "', { start: " + dSeq.start + ' })'
      : '@idStart';
    steps.push({
      table: t, kind: 'note-sequence', class: 'safe',
      sql: ['-- NOTE: ' + pSeq.name + ' starts at ' + pSeq.start + ' in the database but the model declares ' +
            dSeq.start + ' (' + seed + '); DuckDB has no ALTER SEQUENCE RESTART — recreate the sequence manually if the start matters'],
      notes: [],
    });
  }

  // The uniqueness rebuild, spliced AHEAD of everything else planned
  // for this table: it is rendered from the deployed shape, so any
  // add-column / drop-column / alter-type that follows must apply to
  // the rebuilt table, never the other way round.
  //
  // One rebuild serves every uniqueness change on the table, so it
  // rides the FIRST step and the rest carry a comment naming it —
  // running the same rebuild twice would be redundant, not wrong, but
  // a plan that says what it does beats one that repeats itself.
  // Adds sort first so the SQL always rides the strongest class: an
  // add can fail on existing duplicates (lossy), a drop cannot (safe).
  if (uniqueChanges.length) {
    uniqueChanges.sort((a, b) => (a.adding === b.adding ? 0 : a.adding ? -1 : 1));
    const wanted = new Map(uniqueChanges.map((u) => [u.name, u.adding]));
    const rebuild = rebuildForUnique(p, wanted);
    const cols = uniqueChanges.map((u) => u.name).join(', ');
    steps.splice(mark, 0, ...uniqueChanges.map((u, i) => ({
      table: t,
      kind: u.adding ? 'add-unique' : 'drop-unique',
      class: u.adding ? 'lossy' : 'safe',
      sql: i === 0
        ? rebuild
        : ['-- ' + t + '.' + u.name + ': UNIQUE ' + (u.adding ? 'added' : 'dropped') +
           ' by the table rebuild in the step above'],
      notes: i === 0
        ? ['DuckDB cannot add or drop a constraint on a live table (ALTER TABLE ADD CONSTRAINT ' +
           'corrupts it; DROP CONSTRAINT throws), so this REBUILDS ' + t + ' around the change to ' +
           cols + ': create, copy, drop, rename, recreate indexes' +
           (u.adding ? '. The copy fails if existing rows hold duplicates' : '')]
        : ['carried by the ' + t + ' rebuild in the first uniqueness step'],
    })));
  }
}

// ── plan rendering ────────────────────────────────────────────────────

export function renderPlan(steps) {
  const lines = [];
  for (const s of steps) {
    quoteIdent(s.table, null, 'plan table');
    lines.push('-- [' + s.class + '] ' + s.kind + ' ' + s.table);
    for (const n of s.notes) lines.push('--   ' + n);
    lines.push(...s.sql);
    lines.push('');
  }
  return lines.join('\n');
}

// ── the declared-schema dump ──────────────────────────────────────────
//
// `rip schema dump` writes the DECLARED shape of every registered
// :model into one file — the checked-in answer to "is that column
// email or email_addr?", and the CI seam (--check) that surfaces
// naming drift the day it appears. Registry-side only: no adapter and
// no catalog — the file states what the models declare, never what a
// database holds.

const DUMP_HEADER =
  "-- The declared schema: every registered :model's table, rendered by\n" +
  '-- `rip schema dump`. Generated — change the models and re-run the dump;\n' +
  '-- CI verifies this file with `rip schema dump --check`.';

// Render a declared schema as the dump file's complete text.
// DETERMINISM is this function's own contract, not a property it
// borrows from canonicalDeclared(): tables render NAME-SORTED
// regardless of the caller's ordering, duplicates reject, and the
// bytes carry no timestamps — one declared schema, one byte sequence.
export function renderDump(declared) {
  // Table names also head each section as a `-- name` comment, where a
  // control character could terminate the line — validate the complete
  // identifier surface before any text is rendered (renderPlan's rule).
  validateSchemaIdentifiers(declared, 'declared');
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const tables = [...declared.tables].sort(byName);
  for (let i = 1; i < tables.length; i++) {
    if (tables[i].name === tables[i - 1].name) {
      throw new Error("schema.dump: table '" + tables[i].name +
        "' is declared twice — one table has one declaration.");
    }
  }
  // FK-dependency order, name-tiebroken: the dump is executable DDL
  // (a collapsed baseline runs it verbatim), so a referenced table must
  // be created before its referrer — the same rule the planner's
  // create-table steps follow. Pure name order put order_items before
  // orders and the baseline failed on the forward reference.
  const byTableName = new Map(tables.map((t) => [t.name, t]));
  const ordered = topoOrder(tables.map((t) => t.name), (n) =>
    (byTableName.get(n).foreignKeys ?? [])
      .map((fk) => fk.refTable)
      .filter((ref) => ref !== n && byTableName.has(ref)), 'dump');
  const sections = [DUMP_HEADER];
  // A shared sequence (`schema.sequence 'id'`) is the database's own
  // object, not any table's, so it heads the file once — before every
  // table whose id column defaults from it. Per-table sequences stay
  // inside their table's section, where renderCreate emits them.
  const shared = new Map();
  for (const t of tables) {
    if (t.sequence?.shared && !shared.has(t.sequence.name)) shared.set(t.sequence.name, t.sequence);
  }
  for (const name of [...shared.keys()].sort()) {
    const seq = shared.get(name);
    sections.push('-- ' + name + ' — one sequence for every table: an id is unique database-wide\n' +
      'CREATE SEQUENCE ' + quoteIdent(name, null, 'sequence') + ' START ' + seq.start + ';');
  }
  for (const name of ordered) {
    const t = byTableName.get(name);
    const lines = ['-- ' + t.name];
    // The cross-adapter annotation the plan output carries as its
    // note-adapter step: this table's DDL targets its own database,
    // not the default adapter's.
    if (t.ownAdapter) {
      lines.push('-- NOTE: ' + t.ownAdapter +
        ' declares its own on: adapter — this table lives in that adapter\'s database, not the default one');
    }
    lines.push(...renderCreate(t));
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n') + '\n';
}

export function dump() {
  const declared = canonicalDeclared();
  if (!declared.tables.length) {
    throw new Error('schema.dump: no :model schemas are registered — import your model files first');
  }
  return renderDump(declared);
}

// ── migration files & history ─────────────────────────────────────────

// A migration is named for the UTC second it was made:
//
//   20260829174501_add_partner_emails.sql
//
// UTC, always, because the version IS the sort key and the sort is the
// apply order. Local time would reorder a directory the moment two
// people in different zones — or one laptop crossing a DST boundary —
// generated migrations the same afternoon.
//
// Fixed width is what makes a plain lexicographic sort correct forever;
// sequential numbering was not, since '0010' sorts before '0009' only
// by the padding nobody can widen later. Timestamps also never collide
// across branches, so two people generating migrations the same day
// merge without renumbering.
//
// The pattern still admits the legacy NNNN_name files, and it must:
// they are recorded in history under those versions, and renaming one
// would read as a deleted migration plus a pending one. They sort
// first, which is where they belong — '0' precedes '2' — so old and
// new coexist in one directory with the order still correct.
// The description is OPTIONAL. The timestamp alone is already unique
// and already sorts, so requiring a slug would be the tool insisting on
// prose it cannot check — `20260829175839.sql` is a complete name. It
// stays the normal thing to write, because it is the only part of the
// filename a human reads.
const MIGRATION_FILE_RE = /^(\d{4,})(?:_(.+))?\.sql$/;
// Retired: push used to write a dashed, description-less
// 20260827-063412.sql. The dash existed only to keep timestamps out of
// the NNNN_name namespace, and that namespace is gone. Still READ, so
// databases that applied one keep matching their file.
const PUSH_FILE_RE = /^(\d{8}-\d{6})\.sql$/;

// The version, and the only thing that mints one. UTC to the second,
// via toISOString so there is no arithmetic to get the zone wrong in.
function migrationVersion(now = new Date()) {
  return now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// A description the filesystem and the sort key can both hold: lowercase,
// words joined by underscores. `make add partner emails` and
// `make "Add Partner Emails"` land on the same slug.
function migrationSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'migration';
}

// version_description, or just the version when there is no
// description. Spelled once so no message ever prints a dangling '_'.
export const migrationLabel = (f) => f.name ? f.version + '_' + f.name : f.version;

export async function migrationFiles(dir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    // Order matters only for the name: a dashed push file cannot match
    // MIGRATION_FILE_RE (a '-' is neither '_' nor '.'), so the two
    // patterns partition the directory rather than overlap on it.
    const m = f.match(MIGRATION_FILE_RE);
    const p = m ? null : f.match(PUSH_FILE_RE);
    if (!m && !p) continue;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push({
      version: (m ?? p)[1],
      // '' is a real answer — a migration with no description. The
      // retired dashed form had no slot for one, so those read as
      // 'push', which is what they were.
      name: m ? (m[2] ?? '') : 'push',
      file: path.join(dir, f),
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
      content,
    });
  }
  return out;
}

// Two files under one version number are CONFLICTING migrations (two
// branches numbered independently): applying both would execute both
// SQL bodies and then die on the history table's version PRIMARY KEY
// — state applied, history missing. Detected
// upfront, before any SQL.
function duplicateVersions(files) {
  const byVersion = new Map();
  const dupes = [];
  for (const f of files) {
    if (byVersion.has(f.version)) dupes.push([byVersion.get(f.version), f]);
    else byVersion.set(f.version, f);
  }
  return dupes;
}

function rejectDuplicateVersions(files, who) {
  const dupes = duplicateVersions(files);
  if (!dupes.length) return;
  const list = dupes.map(([a, b]) => '  ' + a.file + '  <->  ' + b.file).join('\n');
  throw new Error(
    who + ': conflicting migration files share a version number:\n' + list +
    '\nRenumber one of each pair (two branches generated migrations independently) before applying anything.');
}

// "That table isn't there" is the only failure these swallow. A refused
// connection or a bad credential must still reach the caller — a
// migrate that silently believes nothing is applied would re-apply
// everything.
//
// NARROW ON PURPOSE, and it took two near-misses to get here. This
// used to also match /Catalog Error/ and /not found/, and DuckDB puts
// both phrasings on failures that are the OPPOSITE of absent:
//
//   Catalog Error: Could not rename "_rip_migrations" to ""schema"":
//                  another entry with this name already exists!
//   Binder Error: Referenced column "version" not found in FROM clause!
//
// The first is the collision that means somebody else owns the table —
// swallowed, adoption silently never happened. The second is a
// wrong-shaped table — swallowed, appliedMigrations() answers "nothing
// is applied" and every migration re-runs against a populated
// database. /not found/ additionally matched the harbor adapter's own
// "db request failed: 404 Not Found", turning an unreachable database
// into an empty history.
//
// Absence has exactly one phrasing here — "… does not exist!" — so
// that is the whole pattern. Anything else reaches the caller.
const ABSENT = /\bdoes not exist\b/i;

async function tryRun(sql, params = []) {
  try {
    await runSQL(sql, params);
    return true;
  } catch (e) {
    if (ABSENT.test(e?.message || '')) return false;
    throw e;
  }
}

// The history, and ONLY the history: the reserved '@' keys are a lock
// and a run outcome, neither of which is a migration. This is the one
// place the table is read, which is what makes the filter safe to state
// once.
async function appliedMigrations() {
  const read = async (table) => {
    const res = await runSQL(
      'SELECT version, name, checksum, applied_at FROM ' + table +
      ' WHERE ' + NOT_RESERVED + ' ORDER BY version', []);
    return migrateRows(res);
  };
  try {
    return await read(STATE_TABLE);
  } catch (e) {
    if (!ABSENT.test(e?.message || '')) throw e;
  }
  // Not renamed yet. status and plan are read-only and take no lock, so
  // they must still see the history where it actually lives — reading
  // an unadopted database as "nothing applied" would report every
  // migration as pending.
  try {
    return await read(LEGACY_STATE_TABLE);
  } catch (e) {
    if (ABSENT.test(e?.message || '')) return [];
    throw e;
  }
}

// The run outcomes, and only those. This is the SECOND reader of the
// table, which is worth saying out loud: appliedMigrations() used to be
// the one place it was read, and that is what made NOT_RESERVED safe to
// state once. The invariant that replaces it is narrower and still
// checkable — history and operations PARTITION the non-lock rows, and
// this filter is the exact complement of that one. Neither reader can
// see the other's rows, and neither ever sees '@lock'.
//
// Newest first: whoever runs this is looking for what just happened.
export async function operations(opts = {}) {
  const res = await runSQL(
    'SELECT version, name, detail, applied_at FROM ' + STATE_TABLE +
    " WHERE version LIKE '" + OP_PREFIX + "%'" +
    (opts.id ? ' AND version = ?' : '') +
    ' ORDER BY applied_at DESC',
    opts.id ? [OP_PREFIX + opts.id] : []);
  return migrateRows(res).map((r) => {
    // A row written by a newer runner, or by hand — say so rather than
    // mis-read it. That is what the `v` tag is for.
    let detail = null;
    try { detail = JSON.parse(r.detail ?? 'null'); } catch { detail = null; }
    const known = detail != null && typeof detail === 'object' && detail.v === 1;
    return {
      id: r.version.slice(OP_PREFIX.length),
      outcome: r.name,
      // `recordedAt`, not `at`: the detail payload carries its own
      // fields, and a name collision here would let a spread quietly
      // drop one of them.
      recordedAt: r.applied_at,
      ...(known ? detail : {}),
      ...(known ? {} : { unreadable: r.detail ?? null }),
    };
  });
}

// Idempotent, and the only writer of the table's shape. It also adopts
// a database from before the rename: the columns are unchanged, so the
// rename carries the whole history across and nothing is re-applied.
// The old lock and operations tables have no successor to inherit —
// a lock is meaningless once the process holding it is gone, and
// nothing has ever read an operation row back.
//
// THE RENAME GOES FIRST, and the order is not cosmetic. Create `schema`
// before renaming and the CREATE wins: the legacy table keeps the
// history, the new one is empty, and the very next run reads no applied
// migrations and re-applies every file against a populated database.
//
// Called ONCE per migrate, before the lock — everything downstream
// (the lock row, the history rows, the '@op:…' rows) assumes the table
// is already there.
async function ensureMigrationsTable() {
  // BEFORE the rename, because the rename is the destructive half.
  if (await legacyLockHeld()) {
    throw new Error(
      'schema.migrate: an older `rip schema migrate` holds the lock in ' + LEGACY_LOCK_TABLE +
      ' — this database has not been adopted yet, and adopting it now would take that run\'s ' +
      'history table away mid-apply. Wait for it to finish (or clear that row if it crashed), then ' +
      'run again. Nothing was adopted and nothing was applied.');
  }
  try {
    await tryRun('ALTER TABLE ' + LEGACY_STATE_TABLE + ' RENAME TO ' + STATE_TABLE);
  } catch (e) {
    // The legacy table is there AND something already holds the new
    // name. Adoption cannot proceed and must not be swallowed: the
    // history is in one table and every write would go to the other.
    if (/already exists/i.test(e?.message || '')) {
      throw new Error(
        'schema.migrate: cannot adopt ' + LEGACY_STATE_TABLE + ' — a table named ' + STATE_TABLE +
        ' already exists. If it is a leftover from an interrupted adoption, compare the two and ' +
        'drop the empty one; if it is your own table, rename it — ' + STATE_TABLE +
        ' is the migration runner\'s state.', { cause: e });
    }
    throw e;
  }
  await runSQL('CREATE TABLE IF NOT EXISTS ' + STATE_TABLE +
    ' (version VARCHAR PRIMARY KEY, name VARCHAR, checksum VARCHAR, detail VARCHAR,' +
    ' applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)', []);
  // BEFORE the ADD COLUMN below, and that order is the whole point:
  // the check exists to stop us writing to a table that is not ours,
  // so it has to run before the first write.
  await assertStateTableIsOurs();
  // An adopted table predates `detail`; already-there is not an error.
  try {
    await runSQL('ALTER TABLE ' + STATE_TABLE + ' ADD COLUMN detail VARCHAR', []);
  } catch (e) {
    if (!/already exists|duplicate column/i.test(e?.message || '')) throw e;
  }
  // Retention, and it belongs here for the same reason the ADD COLUMN
  // does: this is the one function that owns the table's lifecycle, and
  // it runs AFTER assertStateTableIsOurs, so this DELETE can never land
  // in a stranger's table.
  //
  // A run outcome is evidence for a search that happens in days. It is
  // not history — history rows are never pruned, because a missing one
  // reads as an unapplied migration. So the outcomes age out and the
  // history does not, which is the whole reason the '@' prefix exists.
  //
  // QUALIFIED on the '@op:' prefix and nothing else: '@lock' does not
  // match it, and no migration version can begin with '@'.
  await runSQL('DELETE FROM ' + STATE_TABLE + " WHERE version LIKE '" + OP_PREFIX +
    "%' AND applied_at < now() - INTERVAL " + OP_RETENTION_DAYS + ' DAY', []);
}

// The legacy tables outlive adoption ON PURPOSE, until the lock is
// held. Dropping them here — before anything is locked — is how a new
// binary destroys an OLD binary's live mutex mid-apply during a
// rollout, which is the one window where two runners are guaranteed to
// exist. migrate() calls this under '@lock' instead.
async function dropLegacyTables() {
  await tryRun('DROP TABLE ' + LEGACY_LOCK_TABLE);
  await tryRun('DROP TABLE ' + LEGACY_OPS_TABLE);
}

// Is a runner from before the rename holding its own mutex right now?
//
// Adoption renames the history table and (later, under the lock) drops
// the legacy lock table, and BOTH of those are destructive to a run
// already in flight under the old code: the rename takes its history
// table away mid-apply, so it applies every statement and then cannot
// record a single one, and the drop takes its mutex. The two runners
// arbitrate through different tables and cannot see each other at all,
// so nothing else in this file would notice.
//
// One SELECT closes it. A row in the legacy lock table means an older
// `rip schema migrate` is mid-flight, and the only safe move is to
// refuse before touching anything.
async function legacyLockHeld() {
  try {
    const res = await runSQL('SELECT count(*) AS n FROM ' + LEGACY_LOCK_TABLE, []);
    return Number(migrateRows(res)[0]?.n ?? 0) > 0;
  } catch (e) {
    // No legacy table is the normal case and means nobody holds it.
    if (ABSENT.test(e?.message || '')) return false;
    throw e;
  }
}

// Every column the runner ever names, and the one that has to be the
// PRIMARY KEY.
const STATE_COLUMNS = ['version', 'name', 'checksum', 'detail', 'applied_at'];

// `schema` is a name a stranger could plausibly own — a form builder's
// JSON-Schema registry, a data catalog, a hand-rolled migration tool
// that got here first — and CREATE TABLE IF NOT EXISTS cannot tell
// "mine, already made" from "someone else's, same name". Every
// statement downstream assumes the first. Measured against DuckDB
// v2.0.0, all four consequences of assuming wrong are SILENT:
//
//   · ALTER TABLE schema ADD COLUMN detail  mutates their table
//   · SELECT version, … FROM schema         raises a Binder Error that
//                                           used to read as "absent",
//                                           so every migration re-ran
//   · INSERT '@lock'                        succeeds for EVERY racer,
//                                           because their `version` is
//                                           no PRIMARY KEY — the mutex
//                                           quietly stops being one
//   · the history                           lands in their rows
//
// The PRIMARY KEY is the load-bearing half: it IS the mutex
// (acquireMigrationLock leans on exactly one INSERT landing), so a
// table without it is not a table this runner can be safe in.
//
// A catalog that does not report the table at all is not an error —
// only a document that predates the CREATE above, or an adapter whose
// catalog omits it. There is nothing to verify and nothing to warn
// about; the writes below fail loudly on their own if it is truly
// missing.
async function assertStateTableIsOurs() {
  const doc = await adapterFor(null).catalog(UNBOUNDED);
  const t = (doc?.tables ?? []).find((x) => x.schema === 'main' && x.name === STATE_TABLE);
  if (!t) return;
  const columns = new Set((t.columns ?? []).map((c) => c.name));
  const missing = STATE_COLUMNS.filter((c) => !columns.has(c));
  const pk = t.primaryKey ?? [];
  const pkOk = pk.length === 1 && pk[0] === 'version';
  if (!missing.length && pkOk) return;
  const why = [];
  if (missing.length) why.push('missing column' + (missing.length > 1 ? 's' : '') + ' ' + missing.join(', '));
  if (!pkOk) why.push('its primary key is ' + (pk.length ? pk.join(', ') : 'not set') + ', not version');
  throw new Error(
    'schema.migrate: the table named ' + STATE_TABLE + ' in this database is not the migration ' +
    'runner\'s (' + why.join('; ') + '). ' + STATE_TABLE + ' holds the migration history, the lock ' +
    'and run outcomes; writing to somebody else\'s table would corrupt it and would leave the lock ' +
    'unenforced, so nothing has been applied. Rename that table (or point RIP_DB_URL at the right ' +
    'database) and run again.');
}

// What survives when a coordinated child dies before it can report. The
// manager normally learns an outcome from the child's stdout; this row
// is the answer when the child never got that far — and `operations()`
// below is how a human reads it, which is what makes the row worth
// writing at all. A durable record nobody can read is not a safety net,
// it is a liability with a retention question attached.
//
// `fields`, never a string: the one-shape rule is enforced by the
// signature, so no caller can drift back to prose.
async function recordMigrationOperation(id, outcome, fields = {}) {
  if (!id) return;
  // No ensure here: every caller is inside migrate(), which ensured the
  // table before it took the lock. Re-running the adoption dance per
  // write would triple the statements a migration issues for nothing.
  // ONE statement. It used to be DELETE-then-INSERT, which leaves a
  // window where a crash loses the previous outcome and records nothing
  // in its place — in the one function whose entire reason to exist is
  // surviving a crash.
  //
  // `now()` and not CURRENT_TIMESTAMP: inside DO UPDATE SET, DuckDB
  // binds the bare keyword as a column name and fails.
  await runSQL('INSERT INTO ' + STATE_TABLE + ' (version, name, detail, applied_at)' +
    ' VALUES (?, ?, ?, now()) ON CONFLICT (version) DO UPDATE' +
    ' SET name = excluded.name, detail = excluded.detail, applied_at = excluded.applied_at',
    [OP_PREFIX + id, outcome, detailJSON(fields)]);
}

// ── the migration lock ────────────────────────────────────────────────
//
// One reserved row serializes concurrent `migrate` runs so two processes
// never both compute "pending" and apply the same files. It is a LEASE,
// not a flag: the holder renews it every few seconds for as long as it
// is working, so a lock nobody has renewed is a lock whose holder is
// gone. That one property is what makes everything below small.
//
// The alternative — a lock row that is simply present or absent — cannot
// tell a crashed run from a working one, so it makes every stale lock a
// judgement call for a human, and gives them nothing to judge with but a
// pid that may have been recycled on a machine they cannot see. This
// runner used to do exactly that.
//
// The renewal is measured, not assumed: against a 12M-row UPDATE running
// server-side, 120 consecutive beats came back with a worst round trip of
// 4ms, and beats also pass cleanly through an open transaction that has
// already written to this same table.

// Renew often, expire slowly. Six missed beats before a lease is
// considered dead — enough that a stalled network or a busy database
// never costs a live run its lock, short enough that a crashed deploy
// clears itself while somebody is still looking at the terminal.
const LEASE_BEAT_MS = 5000;
const LEASE_STALE_SECONDS = 30;

// The tag says "this holder renews its lease", and it is the whole
// rollout story. A runner from before leases never renews, so its lock
// would look expired the instant it was taken — and taking it would put
// two migrations on one database, which is the failure this file exists
// to prevent. So expiry applies ONLY to holders that advertise the
// contract; anything older falls back to needing a human, exactly as it
// did before.
const LEASE_TAG = 'rip2';

// A lock's job, once a run has crashed, is to answer one question for
// the next human: is the thing that took me still alive? The LEASE
// answers it — `applied_at` is when the holder was last seen, so the
// answer is a number and not an inference.
//
// The token therefore carries no mechanism, only the address of the
// thing holding the lock:
//
//   rip2 host=pop pid=50487 run=9f3a1c7e
//
//   host  which machine to go look at
//   pid   what to look for when you get there
//   run   a random nonce, and the one field correctness depends on:
//         renewal and release both match on the whole token, so a crash
//         followed by a reused pid — which containers manage in seconds
//         — must still mint a distinguishable token, or one run renews
//         or releases another run's lease.
//
// host and pid are INFORMATION, not machinery. Nothing branches on them.
// An earlier version of this file ran `process.kill(pid, 0)` to guess
// whether the holder lived, which worked only when the holder happened
// to be on this same machine — and the holder is usually a CI runner
// somewhere else.
//
// DELIBERATELY ABSENT — the username and the migrations path:
// `rip-db dump` is EXPORT DATABASE with no table filter, so whatever is
// in this row is in every backup tarball, and the same database is
// reachable through an MCP SQL tool and an auth-gated web UI. This
// toolchain migrates medical-lab schemas. A hostname is the minimum that
// makes a pid actionable; an operator's account name is not.
const tokenField = (v) => String(v ?? '?').replace(/[\s=]+/g, '-') || '?';

async function makeOwnerToken() {
  // The nonce is the only field correctness depends on, so it is minted
  // first and unconditionally; the rest is best-effort context that must
  // never be able to fail an acquire.
  const run = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const fields = [];
  try {
    const os = await import('node:os');
    fields.push('host=' + tokenField(os.hostname()));
    if (typeof process !== 'undefined' && process.pid) fields.push('pid=' + process.pid);
  } catch {
    // No node:os here (a browser, an edge runtime) — fewer fields, and
    // the token is still unique, which is the part that matters.
  }
  fields.push('run=' + tokenField(run));
  return LEASE_TAG + ' ' + fields.join(' ');
}

// Tolerant on purpose: the row may hold a lease token, a pre-lease
// `rip1` token, a bare UUID from before either, or something written by
// hand. Every one of those still has to PRINT, so an unparseable token
// comes back with `tag: null` and gets reported verbatim.
function parseOwnerToken(token) {
  const raw = String(token ?? '');
  const out = { raw, tag: null, host: null, pid: null, run: null };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts[0] !== LEASE_TAG && parts[0] !== 'rip1') return out;
  out.tag = parts[0];
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const k = part.slice(0, eq);
    if (k === 'host' || k === 'pid' || k === 'run') out[k] = part.slice(eq + 1);
  }
  return out;
}

const leaseCapable = (holder) => holder?.fields?.tag === LEASE_TAG;
const leaseExpired = (holder) =>
  leaseCapable(holder) && holder.ageSeconds != null && holder.ageSeconds > LEASE_STALE_SECONDS;

// EVERY comparison of "when" happens inside the database, and that is
// structural rather than stylistic. `applied_at` is a naive TIMESTAMP,
// so DuckDB stores the DATABASE host's local wall clock — measured on
// v2.0.0-alpha38195 in America/Denver, a row stamped at true UTC
// 18:56:50Z stores 12:56:50 — and the adapter's decode seam then calls a
// naive TIMESTAMP UTC and appends a `Z`. Comparing that against the CLI
// host's clock is wrong by the database host's offset: a lock renewed
// one second ago reads as six hours stale. Both operands of every
// comparison below come from `now()` on one machine, so that class of
// bug has nowhere to live.
const LOCK_READ_SQL =
  'SELECT name AS owner, applied_at,' +
  " date_diff('second', applied_at, now()) AS age_seconds" +
  ' FROM ' + STATE_TABLE + ' WHERE version = ?';

function lockHolderFrom(row) {
  if (!row) return null;
  return {
    owner: row.owner,
    appliedAt: row.applied_at,
    ageSeconds: row.age_seconds == null ? null : Number(row.age_seconds),
    fields: parseOwnerToken(row.owner),
  };
}

async function readLockHolder() {
  return lockHolderFrom(migrateRows(await runSQL(LOCK_READ_SQL, [LOCK_KEY]))[0]);
}

// Coarse above a minute on purpose: the question is "a moment ago, or
// long enough that nobody is coming back", and spurious precision
// invites the reader to treat the number as policy.
function humanAge(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'at an unknown time';
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return s + ' second' + (s === 1 ? '' : 's') + ' ago';
  const m = Math.round(s / 60);
  if (m < 90) return m + ' minutes ago';
  const h = Math.floor(s / 3600);
  if (h < 48) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  return Math.floor(s / 86400) + ' days ago';
}

// What a human needs in order to decide, and nothing they would have to
// go and check themselves. A lease answers "is it alive" here, in one
// line, for a holder on any machine.
export function describeLockHolder(holder) {
  if (!holder) return 'nothing holds it';
  const f = holder.fields;
  const who = f.tag
    ? ['host ' + (f.host ?? '?'), f.pid && 'pid ' + f.pid].filter(Boolean).join(', ')
    : holder.owner;
  if (!leaseCapable(holder)) {
    // A pre-lease holder never renews, so its timestamp is when it
    // STARTED and says nothing about whether it is still going. Saying
    // that plainly beats printing an age that reads like evidence.
    return 'held by ' + who + ', taken ' + humanAge(holder.ageSeconds) +
      ' — that runner predates leases and never renews, so its age is not evidence it is gone; ' +
      'nothing here will take this lock over on its own';
  }
  return leaseExpired(holder)
    ? 'held by ' + who + ', last renewed ' + humanAge(holder.ageSeconds) +
      ' — its lease has EXPIRED, so the next migrate takes it over'
    : 'held by ' + who + ', renewed ' + humanAge(holder.ageSeconds) + ' — its lease is LIVE';
}

// ONE statement, and it settles all three cases the acquire can be in:
//
//   no lock row       the INSERT lands                → acquired
//   expired lease     the DO UPDATE fires             → taken over
//   live lease        the WHERE fails, zero rows back → somebody is running
//
// There is no collide-then-read, so there is no window between them —
// and the 24%-of-the-time race that window used to produce (the peer
// releasing before the diagnostic ran, so the report named a holder that
// was already gone) cannot happen. There is also no DELETE anywhere near
// it: the row is never momentarily absent, so no third party can slip in
// and no crash can leave the lock vacant.
//
// The expiry gate is what replaces `--force`. A crashed run's lease runs
// out and the next migrate simply takes it, saying so out loud — the
// commonest incident in this whole subsystem stops needing a human.
//
// `now()` on both halves so one clock stamps the row either way; inside
// DO UPDATE SET, DuckDB binds bare CURRENT_TIMESTAMP as a column name.
const ACQUIRE_LOCK_SQL =
  'INSERT INTO ' + STATE_TABLE + ' (version, name, applied_at) VALUES (?, ?, now())' +
  ' ON CONFLICT (version) DO UPDATE SET name = excluded.name, applied_at = excluded.applied_at' +
  ' WHERE ' + STATE_TABLE + '.applied_at < now() - INTERVAL ' + LEASE_STALE_SECONDS + ' SECOND' +
  " AND " + STATE_TABLE + ".name LIKE '" + LEASE_TAG + " %'" +
  ' RETURNING version';

// Losing the race wears more than one face — DuckDB's optimistic
// concurrency when two acquires commit into one tuple, and the primary
// key when two INSERT halves land together. Both mean the same thing.
const LOCK_TAKEN = /Conflict on tuple|violates (unique|primary key) constraint|constraint violation|Duplicate key/i;

// Returns {owner, tookOver}: the token this run holds, and the holder
// whose expired lease it inherited, if any.
async function acquireMigrationLock(opts = {}) {
  if (opts.coordinated && opts.repair) {
    throw new Error('schema.migrate: coordinated migration rejects --repair');
  }
  const owner = opts.ownerToken || await makeOwnerToken();

  // Read first, and ONLY to have something to say. The acquire below is
  // gated on the database's own clock, so nothing here is trusted for a
  // decision — a holder that changes between this read and that
  // statement changes the message, never the outcome.
  let before = null;
  try { before = await readLockHolder(); } catch { /* the acquire is what matters */ }

  let acquired = false;
  try {
    acquired = migrateRows(await runSQL(ACQUIRE_LOCK_SQL, [LOCK_KEY, owner])).length > 0;
  } catch (e) {
    if (!LOCK_TAKEN.test(e?.message || '')) throw e;
    acquired = false;
  }
  if (acquired) {
    return { owner, tookOver: before && leaseExpired(before) ? before : null };
  }

  // Somebody's lease is live. Re-read rather than report `before`: the
  // whole point of failing here is that the holder is CURRENT, and the
  // operator is about to decide what to do about it.
  let holder = before;
  try { holder = (await readLockHolder()) ?? before; } catch { /* keep what we have */ }
  const err = new Error(
    'schema.migrate: the migration lock is held.\n  ' + describeLockHolder(holder) + '\n' +
    (leaseCapable(holder)
      ? 'Wait for it — if that run dies, its lease expires within ' + LEASE_STALE_SECONDS +
        ' seconds and the next migrate takes over on its own. To end it now, stop that process, ' +
        'or break the lock deliberately with `rip schema unlock --force`.'
      : 'If nothing is running, break the lock with `rip schema unlock` — it applies nothing and ' +
        'prints exactly what it displaced — then migrate again.'));
  err.cause = null;
  err.lockHolder = holder;
  throw err;
}

// Renewal, for as long as this process is applying. Missing a beat is
// not an error — a slow network or a busy database costs one of six
// before anything expires — so a failed renewal is swallowed exactly the
// way release is.
//
// A renewal that matches NO ROW is different, and worth carrying out:
// this run's lease is gone, which means somebody took the lock while it
// was still working. Nothing is aborted on that news (stopping midway
// through a DDL statement is worse than finishing it, and the history
// row's PRIMARY KEY still refuses a double-record), but the run says so
// rather than reporting a clean success.
//
// unref'd: a pending renewal must never be the reason a finished process
// stays alive.
function startLeaseRenewal(owner) {
  const lease = { lost: false, stop: () => {} };
  if (typeof setInterval !== 'function') return lease;
  const timer = setInterval(async () => {
    try {
      const res = await runSQL(
        'UPDATE ' + STATE_TABLE + ' SET applied_at = now() WHERE version = ? AND name = ?' +
        ' RETURNING version', [LOCK_KEY, owner]);
      if (!migrateRows(res).length) lease.lost = true;
    } catch {
      // A missed beat is affordable; see above.
    }
  }, LEASE_BEAT_MS);
  if (typeof timer?.unref === 'function') timer.unref();
  lease.stop = () => clearInterval(timer);
  return lease;
}

// ── unlock ────────────────────────────────────────────────────────────
//
// Breaking a stale lock and deploying every pending migration used to be
// the same button, and that is how a jammed deploy at 2am becomes an
// unplanned one. They are different decisions, so they are different
// verbs — this one applies NOTHING.
//
// With leases it is also the RARE verb. A crashed run's lock expires by
// itself, so the ordinary stale lock never reaches a human at all. What
// is left is the case worth deliberating over: a lease that is being
// actively renewed by a process somebody wants stopped. That refuses
// without --force, and the refusal is grounded in a measurement rather
// than a guess about a pid on a machine this process cannot see.
//
// One DELETE … RETURNING, so "nothing was held" is an OBSERVATION: a
// read-then-delete pair would report a holder that is not necessarily
// the one it deleted.
export async function unlock(opts = {}) {
  // Deliberately NOT ensureMigrationsTable(): unlocking must not create
  // a table, adopt a legacy database, or drop anything. It is the
  // narrowest verb in this file and its side effects should match. The
  // ownership check still runs, because this DELETEs from `schema` and
  // `schema` is a name a stranger could own.
  requireCatalog('schema.unlock');
  await assertStateTableIsOurs();

  let holder = null;
  try {
    holder = await readLockHolder();
  } catch (e) {
    // An ABSENT state table is NOT "no lock is held" — on a database
    // that predates the rename the real lock is in the legacy table, and
    // reporting "nothing held" there would be a lie the operator acts on.
    if (!ABSENT.test(e?.message || '')) throw e;
    throw new Error(
      'schema.unlock: this database has no ' + STATE_TABLE + ' table, so there is no lock here to ' +
      'break. If it predates the rename, its lock lives in ' + LEGACY_LOCK_TABLE + ' — clear that ' +
      'row instead, or run `rip schema migrate` once to adopt the database.');
  }
  if (!holder) return { released: false, holder: null };

  // Refuse only what is provably alive. Never on age alone: a 200M-row
  // CREATE INDEX legitimately runs for forty minutes, and a lease that
  // is being renewed says it is fine — which is exactly the case a
  // staleness timeout would have got wrong.
  if (leaseCapable(holder) && !leaseExpired(holder) && !opts.force) {
    throw new Error(
      'schema.unlock: refusing — ' + describeLockHolder(holder) + '\n' +
      'Something is renewing this lease right now, so a migration is running. Breaking a LIVE ' +
      'lock lets a second migration start beside it, and on an adapter that does not declare ' +
      'capabilities.ddlTransactional the two can each apply half a file with no history row to ' +
      'show for it. Stop that process and its lease expires within ' + LEASE_STALE_SECONDS +
      ' seconds on its own — or, if you know it is wedged, re-run with `rip schema unlock --force`.');
  }

  // QUALIFIED, and it must stay that way: an unqualified DELETE here
  // would take the entire migration history with the lock.
  const res = await runSQL(
    'DELETE FROM ' + STATE_TABLE + ' WHERE version = ?' +
    " RETURNING name AS owner, applied_at, date_diff('second', applied_at, now()) AS age_seconds",
    [LOCK_KEY]);
  const gone = lockHolderFrom(migrateRows(res)[0]);
  return gone
    ? { released: true, holder: gone, describe: describeLockHolder(gone) }
    : { released: false, holder: null };
}

async function releaseMigrationLock(owner) {
  // Best-effort, and it must STAY that way. Measured: a release racing
  // a concurrent force on the same row throws DuckDB's "Conflict on
  // tuple deletion" 35 times in 100 — after a fully successful
  // migration. Letting that escape would turn a successful migrate into
  // a reported failure. A stale lock is what the next run's `unlock`
  // is for.
  //
  // Owner-scoped, and the token's `run=` nonce is what makes that
  // sound: a run whose lock was stolen mid-apply deletes nothing here,
  // which is right — the row belongs to the thief now, and taking it
  // would leave the live run unlocked.
  try {
    await runSQL('DELETE FROM ' + STATE_TABLE + ' WHERE version = ? AND name = ?', [LOCK_KEY, owner]);
  } catch {
    // swallowed on purpose — see above
  }
}

// Split a migration file into statements: ';' terminates, except
// inside single-quoted strings, double-quoted identifiers
//, `--` line comments, `/* … */` block comments
// (NESTED, the PostgreSQL-family lexing DuckDB follows), and
// dollar-quoted strings (`$$…$$` and tagged `$tag$…$tag$`; a tag is
// `[A-Za-z_][A-Za-z0-9_]*` or empty, closed only by ITS OWN tag —
// so `$1` positional params never open one). Comments pass through
// attached to the following statement (a leading TODO is visible in
// errors but never executed alone); fragments with no executable
// text outside comments are dropped.
// ── redaction: SQL as evidence, with the row data taken out ───────────
//
// A failure report names the failing statement, and for a DATA migration
// — an INSERT or UPDATE carrying literal values — that text IS the row.
// This toolchain migrates medical-lab schemas, so "the text" can be a
// patient's name, date of birth and record number, and it used to land
// in a permanent database row with no retention policy, inside every
// `rip-db dump` tarball.
//
// Two things leak it, and fixing either alone fixes nothing:
//
//   1. the runner's own report, which quoted the failing statement
//   2. the ENGINE, which echoes the whole statement under a trailing
//      "LINE n: … ^^^" and quotes offending values inline. Measured on
//      DuckDB v2.0.0-alpha38195:
//        Constraint Error: Duplicate key "mrn: MRN-88213" violates …
//        Conversion Error: invalid date field format: "not-a-date", …
//
// So the redaction happens where the message is BUILT, not where it is
// stored — one place, and every channel it feeds is covered at once:
// the `detail` column, stderr, the RIP_MIGRATION_OUTCOME line, and the
// manager's on-disk operation journal.
//
// Nothing diagnostic is lost, because the report was never the record.
// The migration FILE is, it is in git, and the report names the version
// that finds it. What survives here is WHICH statement and WHAT the
// engine objected to; the bytes stay where bytes belong.

const SQL_SKELETON_MAX = 200;

// Every literal becomes '?'. Comments are dropped whole — prose in a
// data migration can say anything, and a leading comment was what the
// old `split('\n')[0]` showed instead of the statement. Double-quoted
// IDENTIFIERS survive: they are the schema, which is the part being
// diagnosed.
//
// UNIFORMLY, with no attempt to tell a DDL statement's harmless
// DEFAULT 'active' from a patient's name. A classifier that gets that
// distinction wrong retains PHI silently, so unknown fails closed here
// the way it does everywhere else in this file. The cost is that
// `nextval('id')` reads as `nextval(?)`, which is a fine price.
export function sqlSkeleton(sql) {
  const src = String(sql ?? '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // `--` to end of line: gone, and the newline with it.
    if (ch === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // `/* … */`, NESTED — the PostgreSQL-family lexing DuckDB follows,
    // matching splitStatements above.
    if (ch === '/' && src[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    // A single-quoted string, '' escaping included.
    if (ch === "'") {
      i++;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += '?';
      continue;
    }
    // `$$…$$` and `$tag$…$tag$`, closed only by their own tag.
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      if (m) {
        const end = src.indexOf(m[0], i + m[0].length);
        i = end < 0 ? src.length : end + m[0].length;
        out += '?';
        continue;
      }
    }
    // A quoted identifier is schema, not data — kept whole.
    if (ch === '"') {
      out += ch;
      i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '"') {
          if (src[i + 1] === '"') { out += '"'; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // A numeric literal — but only where a number can START, so the
    // `3` in `col3` and the `1` in `"t1"` are left alone.
    if (ch >= '0' && ch <= '9' && !/[A-Za-z0-9_"$]/.test(src[i - 1] ?? ' ')) {
      while (i < src.length && /[0-9._eE]/.test(src[i])) i++;
      out += '?';
      continue;
    }
    out += /\s/.test(ch) ? ' ' : ch;
    i++;
  }
  const line = out.replace(/\s+/g, ' ').trim();
  return line.length > SQL_SKELETON_MAX ? line.slice(0, SQL_SKELETON_MAX) + '…' : line;
}

const ENGINE_COMPLAINT_MAX = 240;

// The engine's complaint, same rule. First line only, which drops the
// "LINE n:" echo of the whole statement; then every double-quoted
// payload is replaced, because here — unlike in SQL text — a quoted run
// may be an identifier ("version" not found) or a value ("mrn:
// MRN-88213"), and telling those apart is exactly the classifier this
// refuses to build. The error CLASS is what diagnoses, and it survives
// intact: "Constraint Error: Duplicate key "?" violates unique
// constraint." still says everything an operator acts on.
export function engineComplaint(e) {
  const line = String(e?.message ?? e ?? '')
    .split('\n')[0]
    .trim()
    .replace(/"(?:[^"]|"")*"/g, '"?"');
  return line.length > ENGINE_COMPLAINT_MAX ? line.slice(0, ENGINE_COMPLAINT_MAX) + '…' : line;
}

export function splitStatements(sql) {
  const out = [];
  let cur = '';
  // Whether the fragment in progress holds any non-whitespace text
  // OUTSIDE comments — the executability test (a pure-comment
  // fragment must not reach the database as a statement).
  let hasExec = false;
  const push = () => {
    const s = cur.trim();
    if (s && hasExec) out.push(s);
    cur = '';
    hasExec = false;
  };
  let inLine = false;
  let blockDepth = 0;
  let inString = false;
  let inIdent = false;
  let dollarTag = null;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (inLine) {
      cur += ch;
      if (ch === '\n') inLine = false;
      i++;
      continue;
    }
    if (blockDepth > 0) {
      if (ch === '*' && sql[i + 1] === '/') { cur += '*/'; i += 2; blockDepth--; continue; }
      if (ch === '/' && sql[i + 1] === '*') { cur += '/*'; i += 2; blockDepth++; continue; }
      cur += ch;
      i++;
      continue;
    }
    if (inString) {
      cur += ch;
      i++;
      if (ch === "'") {
        if (sql[i] === "'") { cur += "'"; i++; }
        else inString = false;
      }
      continue;
    }
    if (inIdent) {
      cur += ch;
      i++;
      if (ch === '"') {
        if (sql[i] === '"') { cur += '"'; i++; }
        else inIdent = false;
      }
      continue;
    }
    if (dollarTag !== null) {
      if (ch === '$' && sql.startsWith(dollarTag, i)) {
        cur += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === "'") { inString = true; hasExec = true; cur += ch; i++; continue; }
    if (ch === '"') { inIdent = true; hasExec = true; cur += ch; i++; continue; }
    if (ch === '-' && sql[i + 1] === '-') { inLine = true; cur += '--'; i += 2; continue; }
    if (ch === '/' && sql[i + 1] === '*') { blockDepth = 1; cur += '/*'; i += 2; continue; }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        hasExec = true;
        cur += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === ';') { push(); i++; continue; }
    if (!/\s/.test(ch)) hasExec = true;
    cur += ch;
    i++;
  }
  push();
  return out;
}

// ── public verbs ──────────────────────────────────────────────────────

export async function plan() {
  const declared = canonicalDeclared();
  if (!declared.tables.length) {
    throw new Error('schema.plan: no :model schemas are registered — import your model files first');
  }
  const deployed = await introspect();
  return diffSchemas(declared, deployed);
}

export async function status(opts = {}) {
  const dir = opts.dir || 'migrations';
  const steps = await plan();
  const files = await migrationFiles(dir);
  const applied = await appliedMigrations();
  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));
  const fileByVersion = new Map(files.map((f) => [f.version, f]));
  const pending = files.filter((f) => !appliedByVersion.has(f.version));
  const mismatched = files.filter((f) => {
    const a = appliedByVersion.get(f.version);
    return a && a.checksum !== f.checksum;
  }).map(migrationLabel);
  // Applied history rows whose file is gone: deleted history —
  // reported, never silently absent.
  const missing = applied.filter((a) => !fileByVersion.has(a.version))
    .map(migrationLabel);
  const duplicates = duplicateVersions(files)
    .map(([a, b]) => a.version + ': ' + a.name + ' <-> ' + b.name);
  // Read-only, and best-effort: a lock is worth seeing in status —
  // it is the difference between "the deploy is stuck" and "the deploy
  // is running" — but a database that cannot answer must still be able
  // to report its migrations.
  let lock = null;
  try { lock = await readLockHolder(); } catch { /* nothing to say */ }
  return { steps, files, applied, pending, mismatched, missing, duplicates, lock };
}

// The shared safety gate: blocked steps never pass, lossy/destructive
// need their flags. `who` keeps every message naming the verb that hit
// the gate (schema.make vs schema.push).
function gatePlan(steps, opts, who) {
  const blocked = steps.filter((s) => s.class === 'blocked');
  if (blocked.length) {
    const list = blocked.map((s) => '  [blocked] ' + s.kind + ' ' + s.table + '\n    ' + s.notes.join('\n    ')).join('\n');
    throw new Error(
      who + ': the plan contains steps DuckDB cannot execute while other entries (foreign keys, ' +
      'indexes) depend on the table:\n' +
      list + '\nThese need the dependent entries dropped or rebuilt around the change by hand; no flag overrides this.');
  }
  const gated = [];
  for (const s of steps) {
    if (s.class === 'lossy' && !opts.allowLossy) gated.push(s);
    if (s.class === 'destructive' && !opts.allowDestructive) gated.push(s);
  }
  if (gated.length) {
    const list = gated.map((s) => '  [' + s.class + '] ' + s.kind + ' ' + s.table).join('\n');
    throw new Error(
      who + ': the plan contains gated steps:\n' + list +
      '\nPass --allow-lossy / --allow-destructive to include them.');
  }
}

export async function make(name, opts = {}) {
  const dir = opts.dir || 'migrations';
  const steps = await plan();
  if (!steps.length) return null;
  gatePlan(steps, opts, 'schema.make');

  const fs = await import('node:fs');
  const path = await import('node:path');
  // The clock names the file — nothing is read from the directory to
  // pick it. That is the point of timestamps: two branches generating
  // migrations the same week produce two versions that merge, where
  // `max + 1` produced the same number twice.
  const version = migrationVersion(opts.now ? new Date(opts.now) : new Date());
  const slug = name ? migrationSlug(name) : '';
  const stem = slug ? version + '_' + slug : version;
  const file = path.join(dir, stem + '.sql');
  if (fs.existsSync(file)) {
    throw new Error('schema.make: ' + file + ' already exists (two makes inside one second) — try again');
  }

  const body =
    '-- ' + stem + '.sql\n' +
    '-- Generated by `rip schema make` — review (and edit) before applying.\n' +
    '-- Apply with `rip schema migrate`.\n\n' +
    renderPlan(steps);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body);
  return { file, version, steps };
}

// push: plan → timestamped file → apply, one motion. The rapid-iteration
// verb — nothing to ponder when the plan is clean. Unlike Prisma/Drizzle
// `push`, the artifact is still written: history stays continuous, so a
// push session never ends with "now reconcile your migrations". Any
// conflict (pending files, edited history, missing files, duplicate
// versions) refuses BEFORE anything is written or applied — push never
// guesses about a directory in an unclear state.
export async function push(opts = {}) {
  const dir = opts.dir || 'migrations';
  const st = await status({ dir });
  const conflicts = [];
  if (st.pending.length) {
    conflicts.push('pending migrations: ' + st.pending.map(migrationLabel).join(', ') +
      ' — apply them first with `rip schema migrate`');
  }
  if (st.mismatched.length) {
    conflicts.push('edited after apply: ' + st.mismatched.join(', ') +
      ' — restore the files or run `rip schema migrate --repair`');
  }
  if (st.missing.length) {
    conflicts.push('applied but file missing: ' + st.missing.join(', '));
  }
  if (st.duplicates.length) {
    conflicts.push('conflicting versions: ' + st.duplicates.join('; '));
  }
  if (conflicts.length) {
    throw new Error('schema.push: the migration state is not clean:\n  ' + conflicts.join('\n  '));
  }
  const steps = st.steps;
  if (!steps.length) return null;
  gatePlan(steps, opts, 'schema.push');
  // Note steps are facts, not migrations (FKs DuckDB cannot add, sequence
  // starts it cannot alter) — they never resolve, so writing them would
  // mint a fresh comment-only migration on every push forever. A plan
  // that is ALL notes pushes nothing; the notes still print.
  if (steps.every((s) => s.kind.startsWith('note-'))) {
    return { file: null, version: null, steps, ran: [] };
  }

  const fs = await import('node:fs');
  const path = await import('node:path');
  // Same naming as make, optional description and all: a push you named
  // keeps its name, a push you didn't is just the timestamp. It does NOT
  // get a stand-in slug — 'push' would be the tool writing a description
  // on your behalf, and one that says how the file was made rather than
  // what it does. The retired dashed form still reads back as 'push',
  // because those files genuinely had nowhere else to put it.
  const version = migrationVersion(opts.now ? new Date(opts.now) : new Date());
  const slug = opts.name ? migrationSlug(opts.name) : '';
  const stem = slug ? version + '_' + slug : version;
  const file = path.join(dir, stem + '.sql');
  if (fs.existsSync(file)) {
    throw new Error('schema.push: ' + file + ' already exists (two pushes inside one second) — try again');
  }
  const body =
    '-- ' + stem + '.sql\n' +
    '-- Generated and applied by `rip schema push`.\n\n' +
    renderPlan(steps);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body);
  try {
    const out = await migrate({ dir });
    return { file, version, steps, ran: out.ran };
  } catch (e) {
    e.message = (e?.message || String(e)) +
      '\n(the migration file ' + file + ' was written; fix and apply with `rip schema migrate`, or delete it)';
    throw e;
  }
}

export async function migrate(opts = {}) {
  // Applying without the ability to introspect afterwards would leave
  // every failure remedy ("verify with `rip schema status`") dead —
  // so the capability is required up front, before any file is read.
  requireCatalog('schema.migrate');
  const dir = opts.dir || 'migrations';
  const files = await migrationFiles(dir);
  rejectDuplicateVersions(files, 'schema.migrate');
  await ensureMigrationsTable();
  // Applies run under the migration lock; it is released even when a
  // file fails, so a stuck lock always means a crashed process, not a
  // caught error.
  const { owner, tookOver } = await acquireMigrationLock(opts);
  // Renewal starts the moment the lease is held and stops in the finally
  // below — so the window in which this lock looks alive is exactly the
  // window in which this process is working.
  const lease = startLeaseRenewal(owner);
  try {
    // Under the lock, never before it: dropping the legacy lock table
    // is destructive to an OLD runner mid-apply, and holding '@lock'
    // is the only thing that establishes no such run is in flight.
    await dropLegacyTables();
    if (opts.coordinated) {
      if (!opts.operationId) throw new Error('schema.migrate: coordinated migration requires an operation id');
      await recordMigrationOperation(opts.operationId, 'unknown', { phase: 'started' });
    }
    try {
      const result = await migrateApply(opts, files);
      if (opts.coordinated) {
        await recordMigrationOperation(opts.operationId, result.outcome,
          { phase: 'finished', ran: result.ran });
      }
      // Taking over an expired lease is never silent: it means a
      // previous run died partway, and the operator is entitled to know
      // that this run inherited its lock rather than started clean.
      return { ...result, tookOver: tookOver?.owner ?? null, leaseLost: lease.lost };
    } catch (e) {
      if (opts.coordinated) {
        try {
          await recordMigrationOperation(opts.operationId, e?.migrationOutcome || 'unknown',
            e?.migrationFailure
              ? { phase: 'failed', ran: e.migrationRan ?? [], ...e.migrationFailure }
              // Not a per-statement failure — a held lock, a checksum
              // mismatch, an unreachable database. Those are the
              // runner's own prose and carry no row data, but they go
              // through the same redactor anyway: one rule, with no
              // exception a future message can quietly fall into.
              : { phase: 'failed', ran: [], err: engineComplaint(e) });
        } catch (markerError) {
          e.migrationOutcome = 'unknown';
          e.message += '\nCould not durably record the migration outcome: ' + (markerError?.message || String(markerError));
        }
      }
      throw e;
    }
  } finally {
    lease.stop();
    await releaseMigrationLock(owner);
  }
}

// Verify history integrity, then apply each pending file in order —
// transactionally when the adapter supports begin() — recording its
// history row. Runs under the migration lock held by migrate().
async function migrateApply(opts, files) {
  const applied = await appliedMigrations();
  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));

  // History integrity: an applied file whose content changed is an
  // edited-history error — abort unless {repair: true} re-records.
  // Applied IDENTITY is version + bytes (the checksum); the name
  // slug is cosmetic — renaming a file with identical bytes is
  // accepted and invisible here.
  for (const f of files) {
    const a = appliedByVersion.get(f.version);
    if (!a || a.checksum === f.checksum) continue;
    if (opts.repair) {
      await runSQL('UPDATE ' + STATE_TABLE + ' SET checksum = ? WHERE version = ?',
        [f.checksum, f.version]);
    } else {
      throw new Error(
        'schema.migrate: checksum mismatch on applied migration ' + migrationLabel(f) +
        ' — the file changed after it was applied. Restore the original file, or re-record with --repair.');
    }
  }

  const adapter = adapterFor(null);
  const transactional = typeof adapter.begin === 'function';
  // The ROLLED-BACK-whole CLAIM is made only where the adapter
  // declares it true (Adapter Contract v2: capabilities.
  // ddlTransactional ). A begin()-ful adapter over an
  // engine that auto-commits DDL rolls back nothing DDL-shaped, so
  // begin() alone earns only the weaker "attempted" report.
  const ddlTransactional = transactional && adapter.capabilities?.ddlTransactional === true;
  const pending = files.filter((f) => !appliedByVersion.has(f.version));
  const ran = [];
  for (const f of pending) {
    const statements = splitStatements(f.content);
    let at = -1; // index of the statement in flight; statements.length = the history row
    const apply = async () => {
      for (at = 0; at < statements.length; at++) {
        await runSQL(statements[at], []);
      }
      await runSQL('INSERT INTO ' + STATE_TABLE + ' (version, name, checksum) VALUES (?, ?, ?)',
        [f.version, f.name, f.checksum]);
    };
    // Transactional apply when the adapter supports it (the adapter
    // race-fixed machinery): a failed statement leaves neither
    // earlier statements nor the history row. Without begin(), a
    // failure names EXACTLY what state the database holds — an
    // interrupted run must be recoverable from its report, never a
    // bare DB error.
    try {
      if (transactional) await transaction(apply);
      else await apply();
    } catch (e) {
      const label = migrationLabel(f);
      const where = at >= statements.length
        ? 'recording its history row (every statement applied' +
          (/violates (unique|primary key) constraint|already taken/i.test(e?.message || '')
            ? '; the version already exists in ' + STATE_TABLE + ' — was another `rip schema migrate` running concurrently?'
            : '') + ')'
        : 'statement ' + (at + 1) + ' of ' + statements.length + ':\n  ' + sqlSkeleton(statements[at]);
      const posture = ddlTransactional
        ? 'This migration ROLLED BACK whole: nothing from ' + label + ' is applied and no history row was ' +
          'recorded. Migrations applied earlier in this run remain applied and recorded. Fix the failing ' +
          'statement (or the schema) and re-run `rip schema migrate`.'
        : transactional
          ? 'A rollback was attempted for ' + label + ', but the adapter does not declare ' +
            'capabilities.ddlTransactional (Adapter Contract v2) — engines that auto-commit DDL may retain ' +
            'earlier statements from this file; its history row was not recorded. Verify the actual state ' +
            'with `rip schema status`, then fix the failing statement and re-run. Migrations applied earlier ' +
            'in this run remain applied and recorded.'
          : 'The adapter has no begin(), so this migration ran WITHOUT a transaction: statements 1-' +
            Math.max(at, 0) + ' of ' + label + ' ARE applied and its history row was NOT recorded — the ' +
            'database holds partial state. Repair manually (finish or undo the applied statements), then ' +
            're-run; already-applied statements will fail if re-executed as-is.';
      // Built once and used twice: this message and the structured
      // record below say the same thing, so they cannot drift into two
      // different accounts of one failure.
      const engine = engineComplaint(e);
      const err = new Error(
        'schema.migrate: ' + label + ' failed at ' + where + '\n' + engine + '\n' + posture);
      // The unredacted original stays reachable IN MEMORY for a
      // debugger, and nothing serializes it — the CLI prints
      // `e.message` only. Redaction is about what gets WRITTEN DOWN.
      err.cause = e;
      // Fields, not prose: migrate() turns these straight into the
      // recorded outcome, so a run outcome is a SELECT rather than a
      // parse of English.
      err.migrationRan = [...ran];
      err.migrationFailure = {
        failed: label,
        stmtNo: at >= statements.length ? null : at + 1,
        of: statements.length,
        stmt: at >= statements.length ? null : sqlSkeleton(statements[at]),
        err: engine,
      };
      err.migrationOutcome = ran.length
        ? 'committed'
        : ddlTransactional
          ? 'confirmed-none'
          : (!transactional && at > 0)
            ? 'partial'
            : 'unknown';
      throw err;
    }
    ran.push(migrationLabel(f));
  }
  return {
    outcome: ran.length ? 'committed' : 'confirmed-none',
    ran,
    pending: [],
    transactional,
  };
}
