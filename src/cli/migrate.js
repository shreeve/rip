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
//   make(name, opts)       → write migrations/NNNN_name.sql from the diff
//   migrate(opts)          → apply pending migration files in order
//   introspect()           → DeployedSchema (canonical table specs)
//
// Migration FILES are plain SQL — numbered, hand-editable, checked
// into git. The generator writes them; humans may amend them;
// migrate() applies them and records (version, name, checksum,
// applied_at) in the `_rip_migrations` table. A checksum mismatch on
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

const MIGRATIONS_TABLE = '_rip_migrations';
const LOCK_TABLE = '_rip_migration_lock';
const OPERATIONS_TABLE = '_rip_migration_operations';

// The runner's own state tables — history and lock — are never part of
// the schema under management, so they must never reach a diff (where
// "not declared" would read as drop-table).
const RUNNER_TABLES = new Set([MIGRATIONS_TABLE, LOCK_TABLE, OPERATIONS_TABLE]);

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
// The `_rip_migrations` history table is the runner's own state and
// is filtered out below.
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
  // state tables (history and lock) must never enter the diff from ANY
  // caller — a plan proposing `drop-table _rip_migrations` is the
  // data-loss cousin of a silent acceptance.
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

const MIGRATION_FILE_RE = /^(\d{4,})_(.+)\.sql$/;
// Push migrations are named by the second they were made:
// 20260827-063412.sql. The dash keeps the timestamp out of the
// NNNN_name namespace, so make's sequential numbering never mistakes
// a push for migration number twenty million.
const PUSH_FILE_RE = /^(\d{8}-\d{6})\.sql$/;

export async function migrationFiles(dir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(MIGRATION_FILE_RE) || f.match(PUSH_FILE_RE);
    if (!m) continue;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push({
      version: m[1],
      name: m[2] ?? 'push',
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

async function appliedMigrations() {
  try {
    const res = await runSQL('SELECT version, name, checksum, applied_at FROM ' + MIGRATIONS_TABLE + ' ORDER BY version', []);
    return migrateRows(res);
  } catch (e) {
    // History table doesn't exist yet — nothing applied. Anything
    // else (connection refused, auth) should propagate.
    if (/does not exist|Catalog Error/i.test(e?.message || '')) return [];
    throw e;
  }
}

async function ensureMigrationsTable() {
  await runSQL('CREATE TABLE IF NOT EXISTS ' + MIGRATIONS_TABLE +
    ' (version VARCHAR PRIMARY KEY, name VARCHAR, checksum VARCHAR, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)', []);
}

async function recordMigrationOperation(id, outcome, detail = null) {
  if (!id) return;
  await runSQL('CREATE TABLE IF NOT EXISTS ' + OPERATIONS_TABLE +
    ' (id VARCHAR PRIMARY KEY, outcome VARCHAR, detail VARCHAR, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)', []);
  await runSQL('DELETE FROM ' + OPERATIONS_TABLE + ' WHERE id = ?', [id]);
  await runSQL('INSERT INTO ' + OPERATIONS_TABLE + ' (id, outcome, detail) VALUES (?, ?, ?)',
    [id, outcome, detail]);
}

// ── the migration lock ────────────────────────────────────────────────
//
// A single-row lock table serializes concurrent `migrate` runs so two
// processes never both compute "pending" and apply the same files. The
// PRIMARY KEY on the lone id=1 row is the atomic gate: exactly one
// racer's INSERT succeeds, the rest hit the constraint and fail fast
// with a named remedy rather than racing. A crashed run leaves the row
// behind — `--force` clears a stale lock before acquiring. Applies run
// UNDER the lock; status/plan are read-only and take none.
async function ensureLockTable() {
  await runSQL('CREATE TABLE IF NOT EXISTS ' + LOCK_TABLE +
    ' (id INTEGER PRIMARY KEY, acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, owner VARCHAR)', []);
}

async function acquireMigrationLock(opts = {}) {
  await ensureLockTable();
  // --force takes over a lock a crashed run never released. It deletes
  // unconditionally, so it also steals a LIVE peer's lock — the CLI
  // documents it as safe only when no migration is running.
  if (opts.coordinated && (opts.force || opts.repair)) {
    throw new Error('schema.migrate: coordinated migration rejects --force and --repair');
  }
  if (opts.force) await runSQL('DELETE FROM ' + LOCK_TABLE, []);
  const owner = opts.ownerToken || (
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : ((typeof process !== 'undefined' && process.pid) ? 'pid:' + process.pid + ':' + Date.now() : 'rip-schema:' + Date.now())
  );
  try {
    await runSQL('INSERT INTO ' + LOCK_TABLE + ' (id, owner) VALUES (1, ?)', [owner]);
  } catch (e) {
    if (/violates (unique|primary key) constraint|already taken|Duplicate key/i.test(e?.message || '')) {
      const err = new Error(
        'schema.migrate: the migration lock is held — another `rip schema migrate` is running, ' +
        'or a previous run crashed before releasing it. If no migration is running, clear the stale ' +
        'lock and retry with `rip schema migrate --force`.');
      err.cause = e;
      throw err;
    }
    throw e;
  }
  return owner;
}

async function releaseMigrationLock(owner) {
  // Best-effort: a failed release (e.g. the connection dropped after a
  // successful apply) leaves a stale lock the next run clears with
  // --force; it must never mask the migration's own outcome.
  try {
    await runSQL('DELETE FROM ' + LOCK_TABLE + ' WHERE id = 1 AND owner = ?', [owner]);
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
  }).map((f) => f.version + '_' + f.name);
  // Applied history rows whose file is gone: deleted history —
  // reported, never silently absent.
  const missing = applied.filter((a) => !fileByVersion.has(a.version))
    .map((a) => a.version + '_' + a.name);
  const duplicates = duplicateVersions(files)
    .map(([a, b]) => a.version + ': ' + a.name + ' <-> ' + b.name);
  return { steps, files, applied, pending, mismatched, missing, duplicates };
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
  if (!name || typeof name !== 'string') {
    throw new Error("schema.make: a migration name is required, e.g. `rip schema make add_orders`");
  }
  const dir = opts.dir || 'migrations';
  const steps = await plan();
  if (!steps.length) return null;
  gatePlan(steps, opts, 'schema.make');

  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = await migrationFiles(dir);
  // Sequential numbering counts only NNNN_name files: a timestamped
  // push in the directory must not turn the next make into 20260828.
  const sequential = files.filter((f) => !f.version.includes('-'));
  const next = sequential.length ? Math.max(...sequential.map((f) => parseInt(f.version, 10))) + 1 : 1;
  const version = String(next).padStart(4, '0');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'migration';
  const file = path.join(dir, version + '_' + slug + '.sql');

  const body =
    '-- ' + version + '_' + slug + '.sql\n' +
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
    conflicts.push('pending migrations: ' + st.pending.map((f) => f.version + '_' + f.name).join(', ') +
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
  const now = opts.now ? new Date(opts.now) : new Date();
  const two = (n) => String(n).padStart(2, '0');
  const version = '' + now.getFullYear() + two(now.getMonth() + 1) + two(now.getDate()) +
    '-' + two(now.getHours()) + two(now.getMinutes()) + two(now.getSeconds());
  const file = path.join(dir, version + '.sql');
  if (fs.existsSync(file)) {
    throw new Error('schema.push: ' + file + ' already exists (two pushes inside one second) — try again');
  }
  const body =
    '-- ' + version + '.sql\n' +
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
  const owner = await acquireMigrationLock(opts);
  try {
    if (opts.coordinated) {
      if (!opts.operationId) throw new Error('schema.migrate: coordinated migration requires an operation id');
      await recordMigrationOperation(opts.operationId, 'unknown', 'migration started');
    }
    try {
      const result = await migrateApply(opts, files);
      if (opts.coordinated) await recordMigrationOperation(opts.operationId, result.outcome, JSON.stringify(result.ran));
      return result;
    } catch (e) {
      if (opts.coordinated) {
        try {
          await recordMigrationOperation(opts.operationId, e?.migrationOutcome || 'unknown', e?.message || String(e));
        } catch (markerError) {
          e.migrationOutcome = 'unknown';
          e.message += '\nCould not durably record the migration outcome: ' + (markerError?.message || String(markerError));
        }
      }
      throw e;
    }
  } finally {
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
      await runSQL('UPDATE ' + MIGRATIONS_TABLE + ' SET checksum = ? WHERE version = ?',
        [f.checksum, f.version]);
    } else {
      throw new Error(
        'schema.migrate: checksum mismatch on applied migration ' + f.version + '_' + f.name +
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
      await runSQL('INSERT INTO ' + MIGRATIONS_TABLE + ' (version, name, checksum) VALUES (?, ?, ?)',
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
      const label = f.version + '_' + f.name;
      const where = at >= statements.length
        ? 'recording its history row (every statement applied' +
          (/violates (unique|primary key) constraint|already taken/i.test(e?.message || '')
            ? '; the version already exists in ' + MIGRATIONS_TABLE + ' — was another `rip schema migrate` running concurrently?'
            : '') + ')'
        : 'statement ' + (at + 1) + ' of ' + statements.length + ':\n  ' + statements[at].split('\n')[0];
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
      const err = new Error(
        'schema.migrate: ' + label + ' failed at ' + where + '\n' + (e?.message || String(e)) + '\n' + posture);
      err.cause = e;
      err.migrationOutcome = ran.length
        ? 'committed'
        : ddlTransactional
          ? 'confirmed-none'
          : (!transactional && at > 0)
            ? 'partial'
            : 'unknown';
      throw err;
    }
    ran.push(f.version + '_' + f.name);
  }
  return {
    outcome: ran.length ? 'committed' : 'confirmed-none',
    ran,
    pending: [],
    transactional,
  };
}
