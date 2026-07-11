// Schema evolution: introspect → diff → status / make / migrate.
//
// CLI-ONLY by decision: this module rides the `rip schema`
// commands and is NEVER delivered into compiled user output — the
// delivered `schema` namespace carries loud pointers here, nothing
// more. It consumes the persistence runtime's public seam
// (src/runtime/schema-orm.js): the registry for declared models,
// `_tableSpec()` for the canonical table shape, the SQL funnel for
// adapter routing, and the race-fixed transaction machinery for
// per-file transactional apply.
//
// `toSQL()` solves greenfield CREATE; this module solves evolution:
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

import { __SchemaRegistry } from './runtime/schema.js';
import {
  __schemaRunSQL, __schemaAdapterFor, __schemaAdapterConfigured,
  __schemaTransaction, __schemaRenderCreate, __schemaRenderIndex,
} from './runtime/schema-orm.js';

const MIGRATIONS_TABLE = '_rip_migrations';

export { __schemaAdapterConfigured as adapterConfigured };

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

// Build the DeployedSchema — an array of canonical table specs in the
// same shape `_tableSpec()` produces — from the live database. Uses
// the adapter's `introspect()` capability when present (Contract v2);
// otherwise falls back to DuckDB catalog queries through `query()`.
export async function introspect() {
  const adapter = __schemaAdapterFor(null);
  if (typeof adapter.introspect === 'function') {
    // The history table is the runner's own state, never part of the
    // schema under management — an adapter reporting it must not put
    // it in the diff (where "not declared" reads as drop-table).
    const raw = await adapter.introspect();
    return { ...raw, tables: (raw.tables || []).filter((t) => t.name !== MIGRATIONS_TABLE) };
  }
  const q = (sql) => __schemaRunSQL(null, sql, []);
  const tablesRes = await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE'");
  const columnsRes = await q("SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position");
  const constraintsRes = await q("SELECT table_name, constraint_type, constraint_column_names, constraint_text FROM duckdb_constraints() WHERE schema_name = 'main'");
  const indexesRes = await q("SELECT table_name, index_name, is_unique, expressions FROM duckdb_indexes() WHERE schema_name = 'main'");
  const sequencesRes = await q("SELECT sequence_name, start_value FROM duckdb_sequences() WHERE schema_name = 'main'");

  const tables = new Map();
  for (const r of migrateRows(tablesRes)) {
    if (r.table_name === MIGRATIONS_TABLE) continue;
    tables.set(r.table_name, {
      name: r.table_name,
      sequence: null,
      primaryKey: null,
      columns: [],
      indexes: [],
      foreignKeys: [],
      tableWas: null,
    });
  }

  for (const r of migrateRows(columnsRes)) {
    const t = tables.get(r.table_name);
    if (!t) continue;
    t.columns.push({
      name: r.column_name,
      type: r.data_type,
      notNull: r.is_nullable === 'NO',
      unique: false,
      default: r.column_default != null && r.column_default !== '' ? r.column_default : null,
      was: null,
    });
  }

  // constraint_column_names arrives as a JSON array over harbor, or as
  // a "[a, b]" string from other transports. Normalize to string[].
  const listOf = (v) => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') {
      const inner = v.replace(/^\[/, '').replace(/\]$/, '').trim();
      return inner ? inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
    }
    return [];
  };

  for (const r of migrateRows(constraintsRes)) {
    const t = tables.get(r.table_name);
    if (!t) continue;
    const cols = listOf(r.constraint_column_names);
    if (r.constraint_type === 'PRIMARY KEY' && cols.length === 1) {
      t.primaryKey = cols[0];
      const col = t.columns.find((c) => c.name === cols[0]);
      if (col) col.primary = true;
    } else if (r.constraint_type === 'UNIQUE' && cols.length === 1) {
      const col = t.columns.find((c) => c.name === cols[0]);
      if (col) col.unique = true;
    } else if (r.constraint_type === 'FOREIGN KEY') {
      const m = String(r.constraint_text || '').match(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\S+?)\s*\(([^)]+)\)/i);
      if (m) {
        t.foreignKeys.push({ column: m[1].trim(), refTable: m[2].trim(), refColumn: m[3].trim() });
      } else if (cols.length === 1) {
        t.foreignKeys.push({ column: cols[0], refTable: null, refColumn: null });
      }
    }
  }

  for (const r of migrateRows(indexesRes)) {
    const t = tables.get(r.table_name);
    if (!t) continue;
    t.indexes.push({
      name: r.index_name,
      columns: listOf(r.expressions),
      unique: r.is_unique === true || r.is_unique === 'true',
    });
  }

  for (const r of migrateRows(sequencesRes)) {
    // Attach by the `<table>_seq` naming convention the DDL emitter
    // uses.
    const tableName = String(r.sequence_name).replace(/_seq$/, '');
    const t = tables.get(tableName);
    if (t && String(r.sequence_name).endsWith('_seq')) {
      t.sequence = { name: r.sequence_name, start: Number(r.start_value) };
    }
  }

  return { tables: [...tables.values()] };
}

// Canonical declared schema: one table spec per registered :model,
// NAME-SORTED — the determinism contract's first leg (registration
// order never reaches the diff). A model carrying its own `on:`
// adapter still plans here (the introspection reads the DEFAULT
// adapter's database only) — flagged per table by `ownAdapter` so
// the plan can say so out loud.
export function canonicalDeclared() {
  const tables = [];
  for (const [, entry] of __SchemaRegistry._entries) {
    if (entry.kind !== 'model') continue;
    const spec = entry.def._tableSpec();
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
  const k = String(t || '').toUpperCase().replace(/\(.*\)\s*$/, '').trim();
  return TYPE_ALIASES[k] || k;
}

// Tolerant default comparison: deployed defaults round-trip through
// the catalog with cosmetic differences (CAST wrappers, now() for
// CURRENT_TIMESTAMP, case). Don't emit ALTERs for representation
// noise.
function defaultKey(d) {
  if (d == null) return '';
  let s = String(d).trim();
  const cast = s.match(/^CAST\s*\(\s*(.*?)\s+AS\s+[A-Za-z0-9_ ()]+\)$/i);
  if (cast) s = cast[1].trim();
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
//     everything except ADD COLUMN and index DDL ("Dependency Error:
//     cannot alter entry") — even DROP TABLE … CASCADE is refused.
//     Steps that hit this wall classify as `blocked`: the change
//     requires dropping/rebuilding the referencing tables around it.
//   - No ALTER SEQUENCE RESTART → sequence-start drift is a NOTE
//     step, never silence.

// Step kinds DuckDB executes even when the table is FK-referenced.
const UNBLOCKED_KINDS = new Set([
  'create-table', 'add-column', 'create-index', 'drop-index',
  'note-fk', 'note-sequence', 'note-adapter',
]);

// Mark steps that DuckDB will refuse because the target table is
// referenced by other tables' FOREIGN KEYs. A drop-table step is
// exempt from blocking by FKs whose OWNING table is itself dropped in
// this plan: drops order children-first, so by the time the parent's
// DROP runs its referencing tables are gone.
function applyFkBlocks(steps, deployed) {
  const droppedTables = new Set(steps.filter((s) => s.kind === 'drop-table').map((s) => s.table));
  const referencedBy = new Map(); // table → [{from, ref: 'child.fk_col'}]
  for (const t of deployed.tables) {
    for (const fk of t.foreignKeys) {
      if (!fk.refTable) continue;
      if (!referencedBy.has(fk.refTable)) referencedBy.set(fk.refTable, []);
      referencedBy.get(fk.refTable).push({ from: t.name, ref: t.name + '.' + fk.column });
    }
  }
  for (const s of steps) {
    if (UNBLOCKED_KINDS.has(s.kind)) continue;
    let refs = referencedBy.get(s.table) ||
      (s.kind === 'rename-table' && s.oldName ? referencedBy.get(s.oldName) : null);
    if (refs && s.kind === 'drop-table') {
      refs = refs.filter((r) => !droppedTables.has(r.from));
    }
    if (!refs || !refs.length) continue;
    s.class = 'blocked';
    s.notes.push(
      'DuckDB refuses this ALTER while ' + refs.map((r) => r.ref).join(', ') + ' reference(s) this table ' +
      '("Dependency Error"). Rebuild the referencing table(s) around this change, or ' +
      'apply it manually with the referencing tables dropped and recreated.');
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
        'CREATE TABLE, so no statement order satisfies this; break the cycle (drop one @belongs_to, ' +
        'or move one side behind its own adapter).');
    }
  }
  return out;
}

export function diffSchemas(declared, deployed) {
  const steps = [];
  // Tables process NAME-SORTED here regardless of the caller's
  // ordering — determinism is this function's own contract, not a
  // property it borrows from canonicalDeclared().
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const declaredSorted = [...declared.tables].sort(byName);
  // The fold is a COMPARISON normalization only — create-table steps
  // render from the raw spec, or the folded-away single-column
  // unique indexes would silently vanish from migration-created
  // tables.
  const dRaw = new Map(declaredSorted.map((t) => [t.name, t]));
  const dTables = new Map(declaredSorted.map((t) => [t.name, foldSpec(t)]));
  // Belt and suspenders with introspect()'s filter: the history table
  // must never enter the diff from ANY caller — a plan proposing
  // `drop-table _rip_migrations` is the data-loss cousin of a silent
  // acceptance.
  const pTables = new Map(deployed.tables
    .filter((t) => t.name !== MIGRATIONS_TABLE)
    .map((t) => [t.name, foldSpec(t)]));

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
        sql: ['ALTER TABLE ' + d.tableWas + ' RENAME TO ' + name + ';'],
        notes: ['@tableWas ' + d.tableWas + ' can be removed once this migration lands'],
      });
      pTables.delete(d.tableWas);
      pTables.set(name, { ...old, name });
    }
  }

  // Matched tables next: column / index / FK diffs. Alters run BEFORE
  // create-table steps on purpose — a new child table's FOREIGN KEY
  // freezes its parent the moment it exists, so a migration that both
  // alters `orders` and creates `invoices REFERENCES orders` must
  // alter first.
  for (const [name, d] of dTables) {
    const p = pTables.get(name);
    if (!p) continue;
    diffTable(d, p, steps);
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
      sql: __schemaRenderCreate(dRaw.get(name)),
      notes: [],
    });
    if (d.ownAdapter) {
      steps.push({
        table: name, kind: 'note-adapter', class: 'safe',
        sql: ['-- NOTE: ' + d.ownAdapter + ' declares its own on: adapter; this plan reads and writes the ' +
              'DEFAULT adapter\'s database only — apply this table\'s DDL against its own database yourself'],
        notes: [],
      });
    }
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
    const sql = ['DROP TABLE ' + name + ';'];
    if (p.sequence) sql.push('DROP SEQUENCE ' + p.sequence.name + ';');
    steps.push({ table: name, kind: 'drop-table', class: 'destructive', sql, notes: [] });
  }

  return applyFkBlocks(steps, deployed);
}

function diffTable(d, p, steps) {
  const t = d.name;
  const dCols = new Map(d.columns.map((c) => [c.name, c]));
  const pCols = new Map(p.columns.map((c) => [c.name, c]));

  // Rename-signal validation (the column half of the rename rule):
  // duplicates, still-declared old names, and old-and-new-both-
  // deployed all reject before anything degrades silently.
  const wasClaims = new Map();
  for (const [name, col] of dCols) {
    if (!col.was) continue;
    if (dCols.has(col.was)) {
      throw new Error(
        "schema.plan: {was: '" + col.was + "'} on " + t + '.' + name + ' names a column the model still ' +
        'declares — a rename\'s old column cannot also be live. Remove the was:, or rename the other field.');
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
        sql: ['ALTER TABLE ' + t + ' RENAME COLUMN ' + col.was + ' TO ' + name + ';'],
        notes: ['{was: "' + col.was + '"} on ' + name + ' can be removed once this migration lands'],
      });
      pCols.delete(col.was);
      pCols.set(name, { ...old, name });
    }
  }

  // Added columns.
  for (const [name, col] of dCols) {
    if (pCols.has(name)) continue;
    const sql = [];
    const notes = [];
    let cls = 'safe';
    // DuckDB: ADD COLUMN cannot carry constraints. DEFAULT is allowed
    // (and backfills existing rows), so add with the default when one
    // is declared, then tighten with SET NOT NULL.
    let add = 'ALTER TABLE ' + t + ' ADD COLUMN ' + name + ' ' + col.type;
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
      } else {
        sql.push('ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' SET NOT NULL;');
      }
    }
    if (col.unique) {
      sql.push('CREATE UNIQUE INDEX idx_' + t + '_' + name + ' ON ' + t + ' ("' + name + '");');
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
      sql: ['ALTER TABLE ' + t + ' DROP COLUMN ' + name + ';'],
      notes: [],
    });
  }

  // Altered columns.
  for (const [name, dc] of dCols) {
    const pc = pCols.get(name);
    if (!pc) continue;
    if (dc.primary || pc.primary) continue; // pk shape is fixed (INTEGER + nextval)
    if (typeKey(dc.type) !== typeKey(pc.type)) {
      steps.push({
        table: t, kind: 'alter-type', class: 'lossy',
        sql: ['ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' TYPE ' + dc.type + ';'],
        notes: [pc.type + ' -> ' + dc.type + ' casts existing values; rows that cannot cast will fail the migration'],
      });
    }
    if (dc.notNull !== pc.notNull) {
      if (dc.notNull) {
        steps.push({
          table: t, kind: 'set-not-null', class: 'lossy',
          sql: ['ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' SET NOT NULL;'],
          notes: ['fails if existing rows hold NULLs — backfill first'],
        });
      } else {
        steps.push({
          table: t, kind: 'drop-not-null', class: 'safe',
          sql: ['ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' DROP NOT NULL;'],
          notes: [],
        });
      }
    }
    if (defaultKey(dc.default) !== defaultKey(pc.default)) {
      steps.push({
        table: t, kind: 'alter-default', class: 'safe',
        sql: [dc.default != null
          ? 'ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' SET DEFAULT ' + dc.default + ';'
          : 'ALTER TABLE ' + t + ' ALTER COLUMN ' + name + ' DROP DEFAULT;'],
        notes: [],
      });
    }
    if (dc.unique !== pc.unique) {
      if (dc.unique) {
        steps.push({
          table: t, kind: 'add-unique', class: 'lossy',
          sql: ['CREATE UNIQUE INDEX idx_' + t + '_' + name + ' ON ' + t + ' ("' + name + '");'],
          notes: ['fails if existing rows hold duplicates'],
        });
      } else {
        steps.push({
          table: t, kind: 'drop-unique', class: 'safe',
          sql: ['DROP INDEX IF EXISTS idx_' + t + '_' + name + ';'],
          notes: ['a UNIQUE declared inline in CREATE TABLE cannot be dropped by index name; recreate the table if this fails'],
        });
      }
    }
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
    if (ex) sql.push('DROP INDEX ' + name + ';');
    sql.push(__schemaRenderIndex(d, ix));
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
      sql: ['DROP INDEX ' + name + ';'],
      notes: [],
    });
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
  if (dSeq && !pSeq) {
    steps.push({
      table: t, kind: 'note-sequence', class: 'safe',
      sql: ['-- NOTE: ' + t + ' has no ' + dSeq.name + ' sequence in the database (the model expects one, START ' +
            dSeq.start + '); id assignment via nextval will fail — recreate the sequence manually'],
      notes: [],
    });
  } else if (dSeq && pSeq && dSeq.start !== pSeq.start) {
    steps.push({
      table: t, kind: 'note-sequence', class: 'safe',
      sql: ['-- NOTE: ' + pSeq.name + ' starts at ' + pSeq.start + ' in the database but the model declares ' +
            dSeq.start + ' (@idStart); DuckDB has no ALTER SEQUENCE RESTART — recreate the sequence manually if the start matters'],
      notes: [],
    });
  }
}

// ── plan rendering ────────────────────────────────────────────────────

export function renderPlan(steps) {
  const lines = [];
  for (const s of steps) {
    lines.push('-- [' + s.class + '] ' + s.kind + ' ' + s.table);
    for (const n of s.notes) lines.push('--   ' + n);
    lines.push(...s.sql);
    lines.push('');
  }
  return lines.join('\n');
}

// ── migration files & history ─────────────────────────────────────────

const MIGRATION_FILE_RE = /^(\d{4,})_(.+)\.sql$/;

export async function migrationFiles(dir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(MIGRATION_FILE_RE);
    if (!m) continue;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push({
      version: m[1],
      name: m[2],
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
    const res = await __schemaRunSQL(null,
      'SELECT version, name, checksum, applied_at FROM ' + MIGRATIONS_TABLE + ' ORDER BY version', []);
    return migrateRows(res);
  } catch (e) {
    // History table doesn't exist yet — nothing applied. Anything
    // else (connection refused, auth) should propagate.
    if (/does not exist|Catalog Error/i.test(e?.message || '')) return [];
    throw e;
  }
}

async function ensureMigrationsTable() {
  await __schemaRunSQL(null,
    'CREATE TABLE IF NOT EXISTS ' + MIGRATIONS_TABLE +
    ' (version VARCHAR PRIMARY KEY, name VARCHAR, checksum VARCHAR, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)', []);
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

export async function make(name, opts = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error("schema.make: a migration name is required, e.g. `rip schema make add_orders`");
  }
  const dir = opts.dir || 'migrations';
  const steps = await plan();
  if (!steps.length) return null;

  const blocked = steps.filter((s) => s.class === 'blocked');
  if (blocked.length) {
    const list = blocked.map((s) => '  [blocked] ' + s.kind + ' ' + s.table + '\n    ' + s.notes.join('\n    ')).join('\n');
    throw new Error(
      'schema.make: the plan contains steps DuckDB cannot execute while foreign keys reference the table:\n' +
      list + '\nThese need a manual rebuild of the referencing tables; no flag overrides this.');
  }
  const gated = [];
  for (const s of steps) {
    if (s.class === 'lossy' && !opts.allowLossy) gated.push(s);
    if (s.class === 'destructive' && !opts.allowDestructive) gated.push(s);
  }
  if (gated.length) {
    const list = gated.map((s) => '  [' + s.class + '] ' + s.kind + ' ' + s.table).join('\n');
    throw new Error(
      'schema.make: the plan contains gated steps:\n' + list +
      '\nPass --allow-lossy / --allow-destructive to include them.');
  }

  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = await migrationFiles(dir);
  const next = files.length ? Math.max(...files.map((f) => parseInt(f.version, 10))) + 1 : 1;
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

export async function migrate(opts = {}) {
  const dir = opts.dir || 'migrations';
  const files = await migrationFiles(dir);
  rejectDuplicateVersions(files, 'schema.migrate');
  await ensureMigrationsTable();
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
      await __schemaRunSQL(null,
        'UPDATE ' + MIGRATIONS_TABLE + ' SET checksum = ? WHERE version = ?',
        [f.checksum, f.version]);
    } else {
      throw new Error(
        'schema.migrate: checksum mismatch on applied migration ' + f.version + '_' + f.name +
        ' — the file changed after it was applied. Restore the original file, or re-record with --repair.');
    }
  }

  const adapter = __schemaAdapterFor(null);
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
        await __schemaRunSQL(null, statements[at], []);
      }
      await __schemaRunSQL(null,
        'INSERT INTO ' + MIGRATIONS_TABLE + ' (version, name, checksum) VALUES (?, ?, ?)',
        [f.version, f.name, f.checksum]);
    };
    // Transactional apply when the adapter supports it (the adapter
    // race-fixed machinery): a failed statement leaves neither
    // earlier statements nor the history row. Without begin(), a
    // failure names EXACTLY what state the database holds — an
    // interrupted run must be recoverable from its report, never a
    // bare DB error.
    try {
      if (transactional) await __schemaTransaction(apply);
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
      throw err;
    }
    ran.push(f.version + '_' + f.name);
  }
  return { ran, pending: [], transactional };
}
