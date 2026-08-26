// The migration layer — src/cli/migrate.js: the deterministic
// differ, the numbered-SQL artifacts with checksummed history, and
// the runner. Three tiers:
//
//   UNIT — every step kind, the determinism contract (byte-identical
//   steps under repeated runs and any registration order), the
//   rename-signal rejections (was:/@tableWas only, ambiguity is
//   loud), FK-topological ordering with loud cycles, the statement
//   splitter, make's gates, migrate's history machinery, and
//   interrupted-run recovery through the race-fixed transaction
//   machinery.
//
//   DEFECT BATTERY — the silent-failure classes this machinery
//   rejects loudly, each pinned beside its rejection.
import { test, expect, describe } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const rt4 = await import('../../src/runtime/schema.js');
const orm4 = await import('../../src/runtime/orm.js');
const mig = await import('../../src/cli/migrate.js');

// ── kits: one uniform handle per runtime ─────────────────────────────

const K4 = {
  name: 'rip',
  __schema: rt4.__schema,
  setAdapter: orm4.__schemaSetAdapter,
  scope: (fn) => rt4.SchemaRegistry.scope(fn),
  plan: () => mig.plan(),
  status: (o) => mig.status(o),
  make: (n, o) => mig.make(n, o),
  migrate: (o) => mig.migrate(o),
};

// ── descriptor + deployed-spec builders ──────────────────────────────

const field = (name, typeName = 'string', opts = {}) => ({
  tag: 'field', name,
  modifiers: opts.optional ? ['?'] : ['!'],
  typeName,
  array: false,
  ...(opts.unique ? { unique: true } : {}),
  ...(opts.attrs ? { attrs: opts.attrs } : {}),
  ...(opts.constraints ? { constraints: opts.constraints } : {}),
});
const dir = (name, ...args) => ({ tag: 'directive', name, args });
const model = (name, ...entries) => ({ kind: 'model', name, entries });

const pkCol = (seq) => ({ name: 'id', type: 'INTEGER', notNull: true, unique: false, primary: true, default: "nextval('" + seq + "')" });
const col = (name, type = 'VARCHAR', opts = {}) => ({
  name, type,
  notNull: opts.notNull ?? false,
  unique: opts.unique ?? false,
  default: opts.default ?? null,
  was: null,
});
const table = (name, cols, opts = {}) => ({
  name,
  sequence: opts.sequence !== undefined ? opts.sequence : { name: name + '_seq', start: opts.start ?? 1 },
  primaryKey: 'id',
  columns: [pkCol(name + '_seq'), ...cols],
  indexes: opts.indexes ?? [],
  foreignKeys: opts.foreignKeys ?? [],
  // Test-only routing for the fake's contract document: uniqueness the
  // deployed table declares as a CONSTRAINT (inline/table-level
  // UNIQUE) rather than as a unique index.
  ...(opts.uniqueConstraints ? { uniqueConstraints: opts.uniqueConstraints } : {}),
  tableWas: null,
});

// A Contract-v2 fake with the introspect() capability, a history
// store for `_rip_migrations`, and per-migration transactionality
// when built with {tx: true} — BEGIN/stmt/COMMIT/ROLLBACK land in
// the call log as sentinels, and history writes inside an open
// transaction stage until COMMIT (a rolled-back history row must
// not survive, or the interrupted-run pins would lie).
function migrateAdapter(deployed, opts = {}) {
  const history = [];
  const calls = [];
  // The single-row migration lock, PK-guarded: a second acquire while
  // held raises the duplicate-key error the runner classifies as
  // "lock held"; release clears it; --force deletes then re-acquires.
  const lock = { held: false };
  // Serve the deployed spec as the `GET /catalog` contract document —
  // the mapping duckdb-harbor performs — so the runner's introspect()
  // round-trips through the same document shape the live adapter
  // returns. A spec column's `unique` flag materializes as its
  // auto-named single-column unique index, the one shape the ORM's
  // DDL ever gives uniqueness (never inline column UNIQUE); a table's
  // `uniqueConstraints` (hand-written inline/table-level UNIQUE)
  // passes through as the contract's uniqueConstraints field.
  const res = (names, rows) => ({ columns: names.map((name) => ({ name })), data: rows, rowCount: rows.length });
  const contractDoc = () => {
    const tables = [...(deployed.tables || [])]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((t) => {
        const indexes = (t.indexes || []).map((ix) => ({
          name: ix.name, columns: [...ix.columns], unique: ix.unique === true,
        }));
        for (const c of t.columns) {
          const auto = 'idx_' + t.name + '_' + c.name;
          if (c.unique && !indexes.some((ix) => ix.name === auto)) {
            indexes.push({ name: auto, columns: [c.name], unique: true });
          }
        }
        return {
          name: t.name,
          schema: 'main',
          columns: t.columns.map((c) => ({
            name: c.name, type: c.type, notNull: c.notNull === true,
            default: c.default ?? null, primary: c.primary === true,
          })),
          primaryKey: t.primaryKey != null ? [t.primaryKey] : [],
          uniqueConstraints: (t.uniqueConstraints ?? []).map((uc) => ({ columns: [...uc.columns] })),
          indexes,
          foreignKeys: (t.foreignKeys || []).map((fk) => ({
            columns: fk.column.split(', '),
            refTable: fk.refTable,
            refSchema: 'main',
            refColumns: fk.refColumn != null ? fk.refColumn.split(', ') : [],
          })),
        };
      });
    const sequences = (deployed.tables || []).filter((t) => t.sequence)
      .map((t) => ({ name: t.sequence.name, start: t.sequence.start }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { harborVersion: '0.9.1', duckdbVersion: 'v1.5.5', tables, sequences };
  };
  const answer = (sql, params, staged) => {
    if (opts.failOn && opts.failOn.test(sql)) throw new Error(opts.failMessage || ('injected failure: ' + sql));
    if (sql.startsWith('DELETE FROM _rip_migration_lock')) {
      lock.held = false;
      return { columns: [], data: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO _rip_migration_lock')) {
      if (lock.held) throw new Error('Duplicate key "id: 1" violates primary key constraint');
      lock.held = true;
      return { columns: [], data: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT version')) {
      return {
        columns: ['version', 'name', 'checksum', 'applied_at'].map((n) => ({ name: n })),
        data: history.map((h) => [h.version, h.name, h.checksum, null]),
        rowCount: history.length,
      };
    }
    if (sql.startsWith('INSERT INTO _rip_migrations')) {
      const all = [...history, ...(staged || [])];
      if (all.some((h) => h.version === params[0])) {
        throw new Error('Duplicate key "version: ' + params[0] + '" violates primary key constraint');
      }
      (staged || history).push({ version: params[0], name: params[1], checksum: params[2] });
      return { columns: [], data: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE _rip_migrations')) {
      const h = history.find((x) => x.version === params[1]);
      if (h) h.checksum = params[0];
      return { columns: [], data: [], rowCount: h ? 1 : 0 };
    }
    return { columns: [], data: [], rowCount: 0 };
  };
  const adapter = {
    history, calls, lock,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return answer(sql, params, null);
    },
    async catalog() {
      calls.push({ sql: '<CATALOG>', params: [] });
      return contractDoc();
    },
  };
  if (opts.tx) {
    adapter.begin = async () => {
      calls.push({ sql: '<BEGIN>', params: [] });
      const staged = [];
      return {
        async query(sql, params = []) {
          calls.push({ sql, params, tx: true });
          return answer(sql, params, staged);
        },
        async commit() {
          history.push(...staged);
          calls.push({ sql: '<COMMIT>', params: [] });
        },
        async rollback() { calls.push({ sql: '<ROLLBACK>', params: [] }); },
      };
    };
    // ddlTransactional is declared unless the test withholds it — the
    // capability governs the runner's rollback CLAIM ;
    // {ddlTx: false} models a begin()-ful auto-commit-DDL engine.
    adapter.capabilities = { tx: true, ...(opts.ddlTx === false ? {} : { ddlTransactional: true }) };
  }
  return adapter;
}

const project = (steps) => steps.map((s) => ({
  table: s.table, kind: s.kind, class: s.class, sql: s.sql, notes: s.notes,
}));

// ════════════════════════════════════════════════════════════════════
// Unit tier — the differ
// ════════════════════════════════════════════════════════════════════

describe('migrate: the differ — step kinds and classes', () => {
  const run4 = (fn) => K4.scope(async () => {
    const deployedRef = { value: { tables: [] } };
    K4.setAdapter(migrateAdapter({ get tables() { return deployedRef.value.tables; } }));
    return fn(deployedRef);
  });

  test('empty database: CREATE for every model, safe, parent before child regardless of registration order', async () => {
    const r = await run4(async () => {
      // Child registered FIRST — the order that broke the old lowering (#109).
      K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
      K4.__schema(model('User', field('name')));
      return mig.plan();
    });
    expect(r.map((s) => s.kind + ':' + s.class + ':' + s.table)).toEqual([
      'create-table:safe:users', 'create-table:safe:orders',
    ]);
    expect(r[1].sql.join('\n')).toContain('"user_id" INTEGER NOT NULL');
    // No REFERENCES clause — @belongsTo mints the column, never the
    // constraint (DuckDB FK enforcement is a net loss; see renderColumn).
    expect(r[1].sql.join('\n')).not.toContain('REFERENCES');
  });

  test('matching database plans nothing (round-trip clean, unique fold included)', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User',
        field('name', 'string', { constraints: { min: 1, max: 100 } }),
        field('email', 'email', { unique: true }),
        dir('times'),
      ));
      deployedRef.value = { tables: [table('users', [
        col('name'), // VARCHAR — length hints never round-trip (DuckDB erases them)
        col('email', 'VARCHAR', { notNull: true, unique: true }),
        col('created_at', 'TIMESTAMP', { default: 'CURRENT_TIMESTAMP' }),
        col('updated_at', 'TIMESTAMP', { default: 'now()' }),
      ], { indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }] })] };
      deployedRef.value.tables[0].columns[1].notNull = true;
      return mig.plan();
    });
    expect(r.length).toBe(0);
  });

  test('added columns classify by shape: optional/default/unique safe, required-without-default LOSSY with the SET NOT NULL withheld', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User',
        field('name'),
        field('bio', 'text', { optional: true }),
        field('plan', 'string', { optional: true, constraints: { default: 'free' } }),
        field('code'),
        field('tag', 'string', { unique: true }),
      ));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    const byCol = {};
    for (const s of r) byCol[s.sql[0].match(/ADD COLUMN "([^"]+)"/)[1]] = s;
    expect(byCol.bio.sql).toEqual(['ALTER TABLE "users" ADD COLUMN "bio" TEXT;']);
    expect(byCol.bio.class).toBe('safe');
    expect(byCol.plan.sql[0]).toBe("ALTER TABLE \"users\" ADD COLUMN \"plan\" VARCHAR DEFAULT 'free';");
    expect(byCol.plan.class).toBe('safe');
    // Required with a DEFAULT: the executable SET NOT NULL is sound
    // (the default backfilled existing rows) and the step stays safe.
    expect(byCol.plan.sql.length).toBe(1);
    // Required with NO default: lossy (the classification rule),
    // and no executable SET NOT NULL hides behind a comment — the
    // manual step is stated, not executed.
    expect(byCol.code.class).toBe('lossy');
    expect(byCol.code.sql).toEqual([
      'ALTER TABLE "users" ADD COLUMN "code" VARCHAR;',
      '-- REQUIRED with no default: backfill users.code, then apply: ALTER TABLE users ALTER COLUMN code SET NOT NULL;',
    ]);
    expect(byCol.code.notes[0]).toContain('the SET NOT NULL is withheld');
    expect(mig.splitStatements(byCol.code.sql.join('\n')).some((s) => s.trimStart().startsWith('ALTER TABLE users ALTER COLUMN'))).toBe(false);
    expect(byCol.tag.sql).toContain('CREATE UNIQUE INDEX "idx_users_tag" ON "users" ("tag");');
    expect(r.every((s) => s.kind === 'add-column')).toBe(true);
  });

  test('drops are destructive; type/null/default/unique changes classify lossy/safe', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User',
        field('name'),
        field('age', 'integer', { optional: true }),
        field('plan', 'string', { optional: true, constraints: { default: 'pro' } }),
        field('tag', 'string', { optional: true, unique: true }),
      ));
      deployedRef.value = { tables: [
        table('users', [
          col('name'),                                      // declared required → set-not-null (lossy)
          col('age', 'VARCHAR', { notNull: true }),         // type change (lossy) + drop-not-null (safe)
          col('plan', 'VARCHAR', { default: "'free'" }),    // default change (safe)
          col('tag', 'VARCHAR', { unique: false }),         // add-unique (lossy)
          col('legacy'),                                    // drop-column (destructive)
        ]),
        table('ghosts', [], { sequence: null }),            // drop-table (destructive)
      ] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind + ':' + s.class).sort()).toEqual([
      'add-unique:lossy', 'alter-default:safe', 'alter-type:lossy', 'drop-column:destructive',
      'drop-not-null:safe', 'drop-table:destructive', 'set-not-null:lossy',
    ]);
    const dropTable = r.find((s) => s.kind === 'drop-table');
    expect(dropTable.sql).toEqual(['DROP TABLE "ghosts";']);
    const dropUnique = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('tag', 'string', { optional: true })));
      deployedRef.value = { tables: [table('users', [col('tag', 'VARCHAR', { unique: true })])] };
      return mig.plan();
    });
    expect(dropUnique.map((s) => s.kind + ':' + s.class)).toEqual(['drop-unique:safe']);
    expect(dropUnique[0].sql).toEqual(['DROP INDEX IF EXISTS "idx_users_tag";']);
  });

  test('index diffs: composite create, definition change (drop + recreate), stray drop', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User',
        field('a', 'string', { optional: true }),
        field('b', 'string', { optional: true }),
        dir('index', { fields: ['a', 'b'] }),
      ));
      deployedRef.value = { tables: [table('users', [
        col('a'), col('b'),
      ], { indexes: [
        { name: 'idx_users_a_b', columns: ['a'], unique: false },   // definition drifted
        { name: 'idx_users_stray', columns: ['b'], unique: false }, // not declared
      ] })] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind)).toEqual(['create-index', 'drop-index']);
    expect(r[0].sql).toEqual([
      'DROP INDEX "idx_users_a_b";',
      'CREATE INDEX "idx_users_a_b" ON "users" ("a", "b");',
    ]);
    expect(r[1].sql).toEqual(['DROP INDEX "idx_users_stray";']);
  });

  test('rename column and rename table ride the explicit signals', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Member', field('givenName', 'string', { attrs: { was: 'first_name' } }), dir('tableWas', { name: 'users' })));
      deployedRef.value = { tables: [table('users', [col('first_name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind)).toEqual(['rename-table', 'rename-column']);
    expect(r[0].sql).toEqual(['ALTER TABLE "users" RENAME TO "members";']);
    expect(r[0].notes[0]).toContain('@tableWas users can be removed');
    expect(r[1].sql).toEqual(['ALTER TABLE "members" RENAME COLUMN "first_name" TO "given_name";']);
    expect(r[1].notes[0]).toContain('can be removed once this migration lands');
  });

  // If the differ derived the table name from the MODEL name anywhere
  // instead of reading the spec, a `@table` override would read as "the
  // declared table is missing and this deployed one is undeclared" —
  // a destructive create + drop against live data. Pin both directions.
  test('@table: the differ targets the override, not the derived name', async () => {
    const deployed = async (deployedRef) => {
      K4.__schema(model('Profile', field('nick'), dir('table', { name: 'user_profile' })));
      deployedRef.value = { tables: [table('user_profile', [col('nick', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    };
    expect(await run4(deployed)).toEqual([]);

    const fresh = await run4(async (deployedRef) => {
      K4.__schema(model('Profile', field('nick'), dir('table', { name: 'user_profile' })));
      deployedRef.value = { tables: [] };
      return mig.plan();
    });
    expect(fresh.map((s) => s.kind)).toEqual(['create-table']);
    expect(fresh[0].table).toBe('user_profile');
    expect(fresh[0].sql.join('\n')).toContain('CREATE TABLE "user_profile"');
    expect(fresh[0].sql.join('\n')).not.toContain('profiles');
  });

  test('@table composes with @tableWas: rename from the deployed name to the override', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Client', field('name'),
        dir('table', { name: 'client_records' }), dir('tableWas', { name: 'customers' })));
      deployedRef.value = { tables: [table('customers', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind)).toEqual(['rename-table']);
    expect(r[0].sql).toEqual(['ALTER TABLE "customers" RENAME TO "client_records";']);
  });

  test('a consumed rename signal is inert: the new name deployed, the old gone', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Member', field('givenName', 'string', { attrs: { was: 'first_name' } }), dir('tableWas', { name: 'users' })));
      deployedRef.value = { tables: [table('members', [col('given_name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.length).toBe(0);
  });

  test('FK additions on existing tables are notes; new required column with FK carries the note', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
      K4.__schema(model('User', field('name')));
      deployedRef.value = { tables: [
        table('users', [col('name', 'VARCHAR', { notNull: true })]),
        table('orders', [col('total', 'INTEGER', { notNull: true })]),
      ] };
      return mig.plan();
    });
    const add = r.find((s) => s.kind === 'add-column');
    expect(add.table).toBe('orders');
    // A required FK column with no default carries BOTH notes: the
    // withheld SET NOT NULL (lossy) and the unenforceable constraint.
    expect(add.class).toBe('lossy');
    expect(add.notes.some((n) => n.includes('the SET NOT NULL is withheld'))).toBe(true);
    expect(add.notes.some((n) => n.includes('DuckDB cannot add FOREIGN KEY constraints'))).toBe(true);
    expect(r.some((s) => s.kind === 'note-fk')).toBe(false); // the add-column carries it; note-fk is for existing columns
  });

  test('note-fk fires for an EXISTING column that should gain a reference', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
      K4.__schema(model('User', field('name')));
      deployedRef.value = { tables: [
        table('users', [col('name', 'VARCHAR', { notNull: true })]),
        table('orders', [col('total', 'INTEGER', { notNull: true }), col('user_id', 'INTEGER', { notNull: true })]),
      ] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind)).toEqual(['note-fk']);
    expect(r[0].sql[0]).toContain('orders.user_id should reference users(id)');
  });

  test('sequence drift is a NOTE step, never silence: start mismatch and missing sequence', async () => {
    const drift = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name'), dir('idStart', { value: 5000 })));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })], { start: 1 })] };
      return mig.plan();
    });
    expect(drift.map((s) => s.kind + ':' + s.class)).toEqual(['note-sequence:safe']);
    expect(drift[0].sql[0]).toContain('users_seq starts at 1 in the database but the model declares 5000');
    const missing = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name')));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })], { sequence: null })] };
      return mig.plan();
    });
    expect(missing.map((s) => s.kind)).toEqual(['note-sequence']);
    expect(missing[0].sql[0]).toContain('has no users_seq sequence in the database');
  });

  // The deployed schema comes from the adapter's catalog() — one call,
  // zero SQL — and only its `main` schema reaches the differ: the
  // contract reports every schema in the served database, and a table
  // from another schema, being undeclared, would read as drop-table.
  test('introspect() is ONE catalog() call, no SQL; non-main schemas never reach the differ', async () => {
    const seen = [];
    let catalogCalls = 0;
    const recorder = {
      capabilities: { tx: true, ddlTransactional: true },
      begin: () => { throw new Error('not used'); },
      query: async (sql) => {
        seen.push(sql);
        return { columns: [], data: [], rowCount: 0 };
      },
      catalog: async () => {
        catalogCalls++;
        return {
          harborVersion: '0.9.0', duckdbVersion: 'v1.5.5',
          tables: [{
            name: 'tags', schema: 'app',
            columns: [{ name: 'id', type: 'INTEGER', notNull: true, default: null, primary: true }],
            primaryKey: ['id'], indexes: [], foreignKeys: [],
          }],
          sequences: [],
        };
      },
    };
    const deployed = await K4.scope(async () => {
      K4.setAdapter(recorder);
      return mig.introspect();
    });
    expect(catalogCalls).toBe(1);
    expect(seen).toEqual([]);
    expect(deployed.tables).toEqual([]);
  });

  test('the history table never enters the diff: filtered at the introspect() branch AND inside diffSchemas', async () => {
    const historySpec = {
      name: '_rip_migrations', sequence: null, primaryKey: 'version',
      columns: [
        { name: 'version', type: 'VARCHAR', notNull: true, unique: false, primary: true, default: null },
        { name: 'name', type: 'VARCHAR', notNull: false, unique: false, default: null },
        { name: 'checksum', type: 'VARCHAR', notNull: false, unique: false, default: null },
        { name: 'applied_at', type: 'TIMESTAMP', notNull: false, unique: false, default: 'CURRENT_TIMESTAMP' },
      ],
      indexes: [], foreignKeys: [], tableWas: null,
    };
    // An introspect()-capable adapter that faithfully reports the
    // runner's own state table must not see it planned as
    // drop-table:destructive.
    const r = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: [
        historySpec,
        table('users', [col('name', 'VARCHAR', { notNull: true })]),
      ] }));
      K4.__schema(model('User', field('name')));
      return mig.plan();
    });
    expect(r.length).toBe(0);
    // Belt and suspenders: a direct diffSchemas caller is covered
    // too.
    const steps = mig.diffSchemas({ tables: [] }, { tables: [historySpec] });
    expect(steps.length).toBe(0);
  });

  test('a model with its own on: adapter gets a loud note beside its create step', async () => {
    const r = await K4.scope(async () => {
      const own = migrateAdapter({ tables: [] });
      K4.setAdapter(migrateAdapter({ tables: [] }));
      K4.__schema({ ...model('Metric', field('name')), adapter: own });
      return mig.plan();
    });
    expect(r.map((s) => s.kind)).toEqual(['create-table', 'note-adapter']);
    expect(r[1].sql[0]).toContain('declares its own on: adapter');
  });

  test('the FK freeze: ALTERs on referenced tables classify blocked; ADD COLUMN and index DDL stay safe', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('fullName', 'string', { attrs: { was: 'name' } }), field('phone', 'string', { optional: true })));
      K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
      deployedRef.value = { tables: [
        table('users', [col('name', 'VARCHAR', { notNull: true })]),
        table('orders', [col('total', 'INTEGER', { notNull: true }), col('user_id', 'INTEGER', { notNull: true })],
          { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
      ] };
      return mig.plan();
    });
    const rename = r.find((s) => s.kind === 'rename-column');
    const add = r.find((s) => s.kind === 'add-column');
    expect(rename.class).toBe('blocked');
    expect(rename.notes.some((n) => n.includes('Dependency Error'))).toBe(true);
    expect(add.class).toBe('safe');
  });
});

// Every pin in this block is backed by a behavior measured against
// real DuckDB 1.5.5 (the shipped engine): the freeze surface of
// FK-referenced and indexed tables, the ALTERs the engine still
// permits on them, FK references to names that need quoting, and
// case-insensitive identifier matching.
describe('migrate: the differ — engine freezes and pk drift (DuckDB 1.5.5)', () => {
  const run4 = (fn) => K4.scope(async () => {
    const deployedRef = { value: { tables: [] } };
    K4.setAdapter(migrateAdapter({ get tables() { return deployedRef.value.tables; } }));
    return fn(deployedRef);
  });

  // ── the primary-key shape gate ────────────────────────────────────
  // The skip that hides the surrogate pk's fixed shape from the column
  // diff fires ONLY when both sides verify as agreeing surrogates; any
  // other pk disagreement has no in-place ALTER, so it blocks.

  test('a deployed pk of the wrong shape blocks: declared surrogate vs deployed VARCHAR pk with no default', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name')));
      const t = table('users', [col('name', 'VARCHAR', { notNull: true })]);
      t.columns[0] = { name: 'id', type: 'VARCHAR', notNull: false, unique: false, primary: true, default: null };
      deployedRef.value = { tables: [t] };
      return mig.plan();
    });
    expect(r.map((s) => [s.table, s.kind, s.class])).toEqual([['users', 'note-primary-key', 'blocked']]);
    expect(r[0].notes.join(' ')).toContain('a surrogate primary key (INTEGER + nextval');
    expect(r[0].notes.join(' ')).toContain('a VARCHAR primary key with no default');
  });

  test('a deployed pk whose PRIMARY KEY constraint is missing blocks', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name')));
      const t = table('users', [col('name', 'VARCHAR', { notNull: true })]);
      t.primaryKey = null;
      t.columns[0] = { name: 'id', type: 'INTEGER', notNull: false, unique: false, default: "nextval('users_seq')" };
      deployedRef.value = { tables: [t] };
      return mig.plan();
    });
    expect(r.map((s) => [s.table, s.kind, s.class])).toEqual([['users', 'note-primary-key', 'blocked']]);
    expect(r[0].notes.join(' ')).toContain('a non-primary INTEGER column');
  });

  test('a surrogate→natural posture flip on the same column name blocks', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', dir('primary', { name: 'id' }), field('id', 'string'), field('name')));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.map((s) => [s.table, s.kind, s.class])).toEqual([['users', 'note-primary-key', 'blocked']]);
    expect(r[0].notes.join(' ')).toMatch(/VARCHAR primary key.*surrogate primary key/);
  });

  test('the legitimate both-surrogate pair still plans nothing', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name')));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r).toEqual([]);
  });

  // ── the dependency-aware add-column builder ───────────────────────

  test('a required add with a default on an FK-referenced table withholds the SET NOT NULL; an unreferenced table keeps the composite', async () => {
    const frozen = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name'), field('role', 'string', { constraints: { default: 'user' } })));
      K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
      deployedRef.value = { tables: [
        table('users', [col('name', 'VARCHAR', { notNull: true })]),
        table('orders', [col('total', 'INTEGER', { notNull: true }), col('user_id', 'INTEGER', { notNull: true })],
          { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
      ] };
      return mig.plan();
    });
    const add = frozen.find((s) => s.kind === 'add-column');
    expect(add.class).toBe('safe');
    expect(add.sql[0]).toBe('ALTER TABLE "users" ADD COLUMN "role" VARCHAR DEFAULT \'user\';');
    // The withheld half is a comment, never an executable statement:
    // the splitter yields exactly the ADD.
    const statements = mig.splitStatements(add.sql.join('\n'));
    expect(statements.length).toBe(1);
    expect(statements[0].startsWith('ALTER TABLE "users" ADD COLUMN')).toBe(true);
    expect(add.sql.some((s) => s.startsWith('--') && s.includes('SET NOT NULL'))).toBe(true);
    expect(add.notes.some((n) => n.includes('the SET NOT NULL is withheld') && n.includes('orders.user_id'))).toBe(true);

    const free = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name'), field('role', 'string', { constraints: { default: 'user' } })));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(free.map((s) => s.kind + ':' + s.class)).toEqual(['add-column:safe']);
    expect(free[0].sql).toEqual([
      'ALTER TABLE "users" ADD COLUMN "role" VARCHAR DEFAULT \'user\';',
      'ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;',
    ]);
  });

  test('a required add with a default on an INDEXED table withholds the SET NOT NULL too', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('email', 'email', { unique: true }), field('role', 'string', { constraints: { default: 'user' } })));
      const t = table('users', [col('email', 'VARCHAR', { notNull: true, unique: true })],
        { indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }] });
      deployedRef.value = { tables: [t] };
      return mig.plan();
    });
    const add = r.find((s) => s.kind === 'add-column');
    expect(add.sql.filter((s) => !s.startsWith('--'))).toEqual(['ALTER TABLE "users" ADD COLUMN "role" VARCHAR DEFAULT \'user\';']);
    expect(add.notes.some((n) => n.includes('the SET NOT NULL is withheld') && n.includes('idx_users_email'))).toBe(true);
  });

  test('an added unique column WITH a default is lossy: the DEFAULT backfills duplicates under the unique index', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name'), field('code', 'string', { optional: true, unique: true, constraints: { default: 'x' } })));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind + ':' + s.class)).toEqual(['add-column:lossy']);
    expect(r[0].sql.some((s) => s.startsWith('CREATE UNIQUE INDEX'))).toBe(true);
    expect(r[0].notes.some((n) => n.includes('fails if existing rows hold duplicates') && n.includes('DEFAULT backfills'))).toBe(true);
  });

  // ── default comparison: literal payloads are data ─────────────────

  test("a default literal differing only in case plans alter-default; NOW() spellings still compare equal", async () => {
    const drift = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('status', 'string', { constraints: { default: 'Active' } })));
      deployedRef.value = { tables: [table('users', [col('status', 'VARCHAR', { notNull: true, default: "'active'" })])] };
      return mig.plan();
    });
    expect(drift.map((s) => s.kind + ':' + s.class)).toEqual(['alter-default:safe']);
    expect(drift[0].sql).toEqual(['ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT \'Active\';']);

    const noise = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name'), dir('times')));
      deployedRef.value = { tables: [table('users', [
        col('name', 'VARCHAR', { notNull: true }),
        col('created_at', 'TIMESTAMP', { default: 'NOW()' }),
        col('updated_at', 'TIMESTAMP', { default: 'now()' }),
      ])] };
      return mig.plan();
    });
    expect(noise).toEqual([]);
  });

  // ── FK-reference names that need quoting ──────────────────────────
  // The contract carries the referenced table as a STRUCTURAL field,
  // so a name holding spaces is data, never something split out of
  // constraint prose.

  test('a spaced referenced-table name arrives structurally: the freeze holds', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('UserAccount', dir('table', { name: 'User Accounts' }), field('name')));
      K4.__schema(model('OrderX', dir('table', { name: 'Orders' }), field('name', 'string', { optional: true }),
        dir('belongsTo', { target: 'UserAccount', foreignKey: 'owner_id', optional: true })));
      deployedRef.value = { tables: [
        table('User Accounts', [col('name', 'VARCHAR', { notNull: true }), col('stale')]),
        table('Orders', [col('name'), col('owner_id', 'INTEGER')],
          { foreignKeys: [{ column: 'owner_id', refTable: 'User Accounts', refColumn: 'id' }] }),
      ] };
      return mig.plan();
    });
    const drop = r.find((s) => s.kind === 'drop-column');
    expect(drop.table).toBe('User Accounts');
    expect(drop.class).toBe('blocked');
    expect(drop.notes.some((n) => n.includes('Orders.owner_id'))).toBe(true);
  });

  // The differ itself still fails CLOSED on a deployed spec whose FK
  // target is null — a caller-built deployed side can carry one even
  // though introspect()'s contract always names the target.
  test('a null FOREIGN KEY target in a caller-built deployed spec blocks rather than passes', () => {
    const declared = { tables: [
      table('User Accounts', [col('name', 'VARCHAR', { notNull: true }), col('phone')]),
      table('Orders', [col('name'), col('owner_id', 'INTEGER')],
        { foreignKeys: [{ column: 'owner_id', refTable: 'User Accounts', refColumn: 'id' }] }),
    ] };
    const deployed = { tables: [
      table('User Accounts', [col('name', 'VARCHAR', { notNull: true }), col('stale')]),
      table('Orders', [col('name'), col('owner_id', 'INTEGER')],
        { foreignKeys: [{ column: 'owner_id', refTable: null, refColumn: null }] }),
    ] };
    const r = mig.diffSchemas(declared, deployed);
    const drop = r.find((s) => s.kind === 'drop-column');
    expect(drop.class).toBe('blocked');
    expect(drop.notes.some((n) => n.includes('could not determine') && n.includes('Orders.owner_id'))).toBe(true);
    // The engine still permits ADD COLUMN on any table, known target or
    // not, so the exempt kind stays unblocked.
    const adds = r.filter((s) => s.kind === 'add-column');
    expect(adds.length).toBe(1);
    expect(adds[0].class).not.toBe('blocked');
  });

  // ── the index freeze ──────────────────────────────────────────────
  // Any index on a table freezes every in-place ALTER regardless of
  // which column it covers; ADD COLUMN, SET/DROP DEFAULT, and index
  // DDL stay permitted.

  test("an indexed table's column rename blocks with the index named; an index-free table's rename stays safe", async () => {
    const indexed = await run4(async (deployedRef) => {
      K4.__schema(model('Person', field('email', 'string', { unique: true }),
        field('nickName', 'string', { optional: true, attrs: { was: 'nick' } })));
      deployedRef.value = { tables: [table('people', [col('email', 'VARCHAR', { notNull: true, unique: true }), col('nick')],
        { indexes: [{ name: 'idx_people_email', columns: ['email'], unique: true }] })] };
      return mig.plan();
    });
    expect(indexed.map((s) => s.kind + ':' + s.class)).toEqual(['rename-column:blocked']);
    expect(indexed[0].notes.some((n) => n.includes('idx_people_email') &&
      n.includes('Drop the index(es), apply the change, then recreate'))).toBe(true);

    const free = await run4(async (deployedRef) => {
      K4.__schema(model('Person', field('nickName', 'string', { optional: true, attrs: { was: 'nick' } })));
      deployedRef.value = { tables: [table('people', [col('nick')])] };
      return mig.plan();
    });
    expect(free.map((s) => s.kind + ':' + s.class)).toEqual(['rename-column:safe']);
  });

  test("an indexed table's @tableWas rename blocks, and the recreate DDL in the note targets the NEW name", async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Member', dir('tableWas', { name: 'users' }), field('email', 'string', { unique: true })));
      deployedRef.value = { tables: [table('users', [col('email', 'VARCHAR', { notNull: true, unique: true })],
        { indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }] })] };
      return mig.plan();
    });
    const rename = r.find((s) => s.kind === 'rename-table');
    expect(rename.class).toBe('blocked');
    expect(rename.notes.some((n) => n.includes('idx_users_email') &&
      n.includes('CREATE UNIQUE INDEX "idx_users_email" ON "members" ("email");'))).toBe(true);
  });

  test('index DDL and default DDL stay unblocked on an indexed table', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User',
        field('email', 'email', { unique: true }),
        field('status', 'string', { optional: true, constraints: { default: 'new' } }),
        field('a', 'string', { optional: true }), field('b', 'string', { optional: true }),
        dir('index', { fields: ['a', 'b'] })));
      const t = table('users', [
        col('email', 'VARCHAR', { notNull: true, unique: true }),
        col('status', 'VARCHAR', { default: "'old'" }),
        col('a'), col('b'),
      ], { indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }] });
      deployedRef.value = { tables: [t] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind + ':' + s.class).sort()).toEqual(['alter-default:safe', 'create-index:safe']);
  });

  // ── the ALTERs the engine permits on an FK-referenced table ───────

  test('add-unique, drop-unique, and alter-default plan on an FK-referenced table instead of dead-ending blocked', async () => {
    const declared = { tables: [
      table('orders', [col('user_id', 'INTEGER')], { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
      table('users', [
        col('name', 'VARCHAR', { unique: true, default: "'x'" }),
        col('tag', 'VARCHAR'),
      ]),
    ] };
    const deployed = { tables: [
      table('orders', [col('user_id', 'INTEGER')], { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
      table('users', [
        col('name', 'VARCHAR'),
        col('tag', 'VARCHAR', { unique: true }),
      ]),
    ] };
    const steps = mig.diffSchemas(declared, deployed);
    expect(steps.map((s) => s.kind + ':' + s.class).sort()).toEqual([
      'add-unique:lossy', 'alter-default:safe', 'drop-unique:safe',
    ]);
  });

  // ── the adapter note on the matched-table diff path ───────────────

  test('a matched table on its own adapter carries the note-adapter step beside its diff steps', async () => {
    const r = await K4.scope(async () => {
      const own = migrateAdapter({ tables: [] });
      K4.setAdapter(migrateAdapter({ tables: [
        table('metrics', [col('value', 'VARCHAR'), col('legacy_note')]),
      ] }));
      K4.__schema({ ...model('Metric', field('value', 'integer')), adapter: own });
      return mig.plan();
    });
    expect(r.some((s) => s.kind === 'note-adapter' && s.table === 'metrics' &&
      s.sql[0].includes('declares its own on: adapter'))).toBe(true);
    expect(r.some((s) => s.kind !== 'note-adapter')).toBe(true);
  });

  // ── case-only column changes ──────────────────────────────────────

  test('a case-only column change blocks instead of planning an add + drop the engine refuses', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('name', 'string', { attrs: { column: 'NAME' } })));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.map((s) => [s.table, s.kind, s.class])).toEqual([['users', 'note-column-case', 'blocked']]);
    expect(r[0].notes.join(' ')).toContain('differ only by letter case');
    expect(r.some((s) => s.kind === 'add-column' || s.kind === 'drop-column')).toBe(false);
  });

  test('a {was:} naming its own live column rejects with wording that fits the self-claim', async () => {
    await expect(run4(async (deployedRef) => {
      K4.__schema(model('User', field('name', 'string', { attrs: { was: 'name' } })));
      deployedRef.value = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    })).rejects.toThrow(/names a column the model still declares[\s\S]*free the old name by renaming the field that declares it/);
  });
});

describe('migrate: the differ — determinism and ordering', () => {
  const declaredOf = (...specs) => ({ tables: specs });

  test('same pair, repeated runs: byte-identical steps and rendered plan', async () => {
    const declared = await K4.scope(() => {
      K4.__schema(model('User', field('name'), field('email', 'email', { unique: true }), dir('times')));
      K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
      return mig.canonicalDeclared();
    });
    const deployed = { tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] };
    const a = mig.diffSchemas(declared, deployed);
    const b = mig.diffSchemas(declared, deployed);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(mig.renderPlan(a)).toBe(mig.renderPlan(b));
  });

  test('registration order never reaches the plan: reversed registration, byte-identical output', async () => {
    const build = (order) => K4.scope(() => {
      const defs = {
        User: () => K4.__schema(model('User', field('name'))),
        Order: () => K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false }))),
        Coupon: () => K4.__schema(model('Coupon', field('code', 'string', { unique: true }))),
      };
      for (const n of order) defs[n]();
      return mig.canonicalDeclared();
    });
    const d1 = await build(['Coupon', 'Order', 'User']);
    const d2 = await build(['User', 'Coupon', 'Order']);
    const empty = { tables: [] };
    expect(mig.renderPlan(mig.diffSchemas(d1, empty))).toBe(mig.renderPlan(mig.diffSchemas(d2, empty)));
    expect(JSON.stringify(mig.diffSchemas(d1, empty))).toBe(JSON.stringify(mig.diffSchemas(d2, empty)));
  });

  test('create-table order is FK-topological with name-sorted ties: a three-level chain', () => {
    const t = (name, fkTo) => ({
      name, sequence: { name: name + '_seq', start: 1 }, primaryKey: 'id',
      columns: [pkCol(name + '_seq')], indexes: [],
      foreignKeys: fkTo ? [{ column: fkTo + '_x_id', refTable: fkTo, refColumn: 'id' }] : [],
      tableWas: null,
    });
    // zz_roots ← mid ← aa_leaves: name order alone would create the leaf first.
    const steps = mig.diffSchemas(declaredOf(t('aa_leaves', 'mid'), t('mid', 'zz_roots'), t('zz_roots', null)), { tables: [] });
    expect(steps.map((s) => s.table)).toEqual(['zz_roots', 'mid', 'aa_leaves']);
  });

  test('a self-referential FK does not constrain order (tree tables are legal)', () => {
    const spec = {
      name: 'categories', sequence: { name: 'categories_seq', start: 1 }, primaryKey: 'id',
      columns: [pkCol('categories_seq')], indexes: [],
      foreignKeys: [{ column: 'category_id', refTable: 'categories', refColumn: 'id' }],
      tableWas: null,
    };
    const steps = mig.diffSchemas(declaredOf(spec), { tables: [] });
    expect(steps.map((s) => s.kind)).toEqual(['create-table']);
  });

  test('an FK cycle among created tables rejects loudly with the members named', () => {
    const t = (name, fkTo) => ({
      name, sequence: { name: name + '_seq', start: 1 }, primaryKey: 'id',
      columns: [pkCol(name + '_seq')], indexes: [],
      foreignKeys: [{ column: fkTo + '_id', refTable: fkTo, refColumn: 'id' }],
      tableWas: null,
    });
    expect(() => mig.diffSchemas(declaredOf(t('alphas', 'betas'), t('betas', 'alphas')), { tables: [] }))
      .toThrow(/create-table order is impossible.*alphas, betas.*cycle/s);
  });

  test('drop-table order is reverse-topological: children drop before the parents they reference, and the parent drop is NOT blocked by a child dropped with it', () => {
    const deployed = { tables: [
      table('users', [col('name')]),
      table('orders', [col('user_id', 'INTEGER', { notNull: true })],
        { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
    ] };
    const steps = mig.diffSchemas({ tables: [] }, deployed);
    expect(steps.map((s) => s.kind + ':' + s.table)).toEqual(['drop-table:orders', 'drop-table:users']);
    expect(steps.every((s) => s.class === 'destructive')).toBe(true);
  });

  test('a parent dropped while its referencing child STAYS is blocked (the DuckDB wall)', () => {
    const deployed = { tables: [
      table('users', [col('name')]),
      table('orders', [col('total', 'INTEGER'), col('user_id', 'INTEGER')],
        { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
    ] };
    const declared = { tables: [table('orders', [col('total', 'INTEGER'), col('user_id', 'INTEGER')],
      { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] })] };
    declared.tables[0].columns[1].notNull = false;
    declared.tables[0].columns[2] = { ...declared.tables[0].columns[2], notNull: false };
    const steps = mig.diffSchemas(declared, deployed);
    const drop = steps.find((s) => s.kind === 'drop-table');
    expect(drop.table).toBe('users');
    expect(drop.class).toBe('blocked');
    expect(drop.notes[0]).toContain('orders.user_id');
  });

  test('rename-table steps block when the OLD name is FK-referenced', () => {
    const declared = { tables: [{
      ...table('members', [col('name', 'VARCHAR', { notNull: true })]),
      tableWas: 'users',
    }] };
    const deployed = { tables: [
      table('users', [col('name', 'VARCHAR', { notNull: true })]),
      table('orders', [col('user_id', 'INTEGER', { notNull: true })],
        { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
    ] };
    const steps = mig.diffSchemas(declared, deployed);
    const rename = steps.find((s) => s.kind === 'rename-table');
    expect(rename.class).toBe('blocked');
    // The stray deployed `orders` also plans a (blocked-exempt) drop —
    // only the rename's blocking is under test here.
  });
});

describe('migrate: the declared-schema dump', () => {
  const declare = () => {
    K4.__schema(model('User', field('name'), field('email', 'email', { unique: true })));
    K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
  };

  test('dump() renders with NO adapter configured: registry-side only', async () => {
    const text = await K4.scope(() => {
      declare();
      return mig.dump();
    });
    expect(text).toContain('CREATE TABLE "users"');
    expect(text).toContain('CREATE TABLE "orders"');
  });

  test('determinism: repeated renders and reversed registration order are byte-equal, and the bytes carry no timestamp', async () => {
    const build = (order) => K4.scope(() => {
      const defs = {
        User: () => K4.__schema(model('User', field('name'), field('email', 'email', { unique: true }))),
        Order: () => K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false }))),
      };
      for (const n of order) defs[n]();
      return mig.dump();
    });
    const a = await build(['User', 'Order']);
    const b = await build(['Order', 'User']);
    const c = await build(['Order', 'User']);
    expect(a).toBe(b);
    expect(b).toBe(c);
    // No timestamps, no dates: the header states present facts only,
    // so two dumps of one tree are reproducible byte-for-byte.
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/);
  });

  test('content: the generated header, then every table NAME-SORTED with its sequence/create/index shapes exactly as renderCreate emits them', async () => {
    const text = await K4.scope(() => {
      declare();
      return mig.dump();
    });
    const declared = await K4.scope(() => {
      declare();
      return mig.canonicalDeclared();
    });
    // The file IS: header + one section per table in FK-dependency
    // order (parents before children, name-tiebroken), each '-- name'
    // plus the renderCreate blocks, blank-line separated, trailing
    // newline.
    const byName = new Map(declared.tables.map((t) => [t.name, t]));
    const orderedNames = [...byName.keys()].sort();
    orderedNames.sort((a, b) => {
      const aDeps = (byName.get(a).foreignKeys ?? []).map((fk) => fk.refTable);
      const bDeps = (byName.get(b).foreignKeys ?? []).map((fk) => fk.refTable);
      if (aDeps.includes(b)) return 1;
      if (bDeps.includes(a)) return -1;
      return 0;
    });
    const sections = orderedNames.map((n) => ['-- ' + n, ...orm4.renderCreate(byName.get(n))].join('\n'));
    const header = text.slice(0, text.indexOf('\n\n'));
    expect(header).toContain('rip schema dump');
    expect(header).toContain('--check');
    expect(text).toBe([header, ...sections].join('\n\n') + '\n');
    // orders sorts before users by NAME, but users is orders' FK
    // parent — dependency order wins, so users renders first.
    expect(text.indexOf('-- users\n')).toBeLessThan(text.indexOf('-- orders\n'));
    expect(text).toContain('CREATE SEQUENCE "users_seq" START 1;');
    expect(text).toContain('"user_id" INTEGER NOT NULL');
    expect(text).not.toContain('REFERENCES');
    expect(text).toContain('CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");');
    expect(text.endsWith(');\n')).toBe(true);
  });

  test('zero registered models refuse loudly, never an empty file', async () => {
    await expect(K4.scope(async () => mig.dump())).rejects
      .toThrow(/schema\.dump: no :model schemas are registered/);
  });

  test('a model on its own on: adapter is included, annotated the way the plan annotates it', async () => {
    const text = await K4.scope(() => {
      const own = migrateAdapter({ tables: [] });
      K4.__schema({ ...model('Metric', field('value', 'integer')), adapter: own });
      K4.__schema(model('User', field('name')));
      return mig.dump();
    });
    expect(text).toContain('-- metrics\n-- NOTE: Metric declares its own on: adapter');
    expect(text).toContain('CREATE TABLE "metrics"');
    // The default-adapter table carries no such note.
    expect(text).not.toMatch(/-- users\n-- NOTE:/);
  });

  test('renderDump sorts by name itself (determinism is its own contract) and rejects duplicate tables', () => {
    const specs = [
      table('users', [col('name')]),
      table('orders', [col('total', 'INTEGER', { notNull: true })]),
    ];
    expect(mig.renderDump({ tables: specs })).toBe(mig.renderDump({ tables: [...specs].reverse() }));
    expect(() => mig.renderDump({ tables: [table('users', [col('name')]), table('users', [col('name')])] }))
      .toThrow(/table 'users' is declared twice/);
  });
});

describe('migrate: identifier ownership', () => {
  test('DDL quotes embedded punctuation in table, column, index, sequence, and FK identifiers', () => {
    const spec = {
      name: 'odd" table',
      sequence: { name: 'odd" sequence', start: 4 },
      primaryKey: 'id',
      columns: [
        { ...pkCol('odd" sequence'), name: 'id' },
        col('value"name', 'VARCHAR'),
        col('owner"id', 'INTEGER'),
      ],
      indexes: [{ name: 'idx" value', columns: ['value"name'], unique: false }],
      foreignKeys: [{ column: 'owner"id', refTable: 'owner" table', refColumn: 'key"id' }],
      notes: [],
      tableWas: null,
    };
    const sql = orm4.renderCreate(spec).join('\n');
    expect(sql).toContain('CREATE SEQUENCE "odd"" sequence" START 4;');
    expect(sql).toContain('CREATE TABLE "odd"" table"');
    expect(sql).toContain('"value""name" VARCHAR');
    expect(sql).not.toContain('REFERENCES');
    expect(sql).toContain('CREATE INDEX "idx"" value" ON "odd"" table" ("value""name");');
  });

  test('deployed rename identifiers quote safely and reject controls', () => {
    const declared = { tables: [{
      ...table('new" table', [col('new" column')]),
      tableWas: 'old" table',
    }] };
    declared.tables[0].columns[1].was = 'old" column';
    const deployed = { tables: [table('old" table', [col('old" column')])] };
    const steps = mig.diffSchemas(declared, deployed);
    expect(steps.find((s) => s.kind === 'rename-table').sql).toEqual([
      'ALTER TABLE "old"" table" RENAME TO "new"" table";',
    ]);
    expect(steps.find((s) => s.kind === 'rename-column').sql).toEqual([
      'ALTER TABLE "new"" table" RENAME COLUMN "old"" column" TO "new"" column";',
    ]);

    const badCreate = { ...declared.tables[0], name: 'bad\nname', tableWas: null };
    expect(() => orm4.renderCreate(badCreate)).toThrow(/control characters/);
    const badRename = {
      tables: [{ ...declared.tables[0], tableWas: 'bad\u0000name' }],
    };
    expect(() => mig.diffSchemas(badRename, {
      tables: [table('bad\u0000name', [col('old" column')])],
    })).toThrow(/control characters/);
  });

  test('NOTE identifiers reject controls before statement splitting can expose injected SQL', () => {
    const injected = '\nDROP TABLE audit; --';
    const cases = [
      () => {
        const declared = { tables: [table('users', [col('name')], {
          sequence: { name: 'users_seq' + injected, start: 2 },
        })] };
        return mig.diffSchemas(declared, { tables: [table('users', [col('name')], { sequence: null })] });
      },
      () => {
        const deployed = table('users', [col('name')], {
          sequence: { name: 'users_seq' + injected, start: 1 },
        });
        return mig.diffSchemas(
          { tables: [table('users', [col('name')], { start: 2 })] },
          { tables: [deployed] },
        );
      },
      ...['name', 'column', 'refTable', 'refColumn'].map((part) => () => {
        const fk = { column: 'user_id', refTable: 'users', refColumn: 'id' };
        const child = table('orders', [col('user_id', 'INTEGER')], { foreignKeys: [fk] });
        if (part === 'name') child.name += injected;
        else fk[part] += injected;
        return mig.diffSchemas(
          { tables: [child, table('users', [col('name')])] },
          { tables: [table('orders', [col('user_id', 'INTEGER')]), table('users', [col('name')])] },
        );
      }),
    ];

    for (const build of cases) {
      let statements = [];
      expect(() => {
        const rendered = mig.renderPlan(build());
        statements = mig.splitStatements(rendered);
      }).toThrow(/control characters/);
      expect(statements.some((sql) => /DROP TABLE audit/.test(sql))).toBe(false);
    }
  });
});

describe('migrate: the catalog contract — the one door to the deployed schema', () => {
  test('an adapter with no catalog() refuses plan and migrate, naming the upgrade', async () => {
    const bare = { query: async () => ({ columns: [], data: [], rowCount: 0 }) };
    await K4.scope(async () => {
      K4.setAdapter(bare);
      K4.__schema(model('User', field('name')));
      await expect(mig.plan()).rejects
        .toThrow(/has no catalog\(\)[\s\S]*GET \/catalog[\s\S]*duckdb-harbor >= v0\.9\.0/);
      await expect(mig.migrate({ dir: 'does-not-matter' })).rejects
        .toThrow(/schema\.migrate: the configured adapter has no catalog\(\)/);
    });
  });

  // A contract document with multi-column FK arrays folds onto the
  // spec's per-column shape — a joined column list, the first
  // referenced column — and the freeze evidence keeps working on it.
  test('a plan built from a contract document with multi-column FK arrays', async () => {
    const doc = {
      harborVersion: '0.9.0', duckdbVersion: 'v1.5.5',
      tables: [
        {
          name: 'links', schema: 'main',
          columns: [
            { name: 'a', type: 'INTEGER', notNull: false, default: null, primary: false },
            { name: 'b', type: 'INTEGER', notNull: false, default: null, primary: false },
          ],
          primaryKey: [],
          indexes: [],
          foreignKeys: [
            { columns: ['a', 'b'], refTable: 'users', refSchema: 'main', refColumns: ['id', 'id'] },
          ],
        },
        {
          name: 'users', schema: 'main',
          columns: [
            { name: 'id', type: 'INTEGER', notNull: true, default: "nextval('users_seq')", primary: true },
            { name: 'name', type: 'VARCHAR', notNull: false, default: null, primary: false },
          ],
          primaryKey: ['id'],
          indexes: [],
          foreignKeys: [],
        },
      ],
      sequences: [{ name: 'users_seq', start: 1 }],
    };
    const deployed = await K4.scope(async () => {
      K4.setAdapter({ query: async () => ({ columns: [], data: [], rowCount: 0 }), catalog: async () => doc });
      return mig.introspect();
    });
    expect(deployed.tables.find((t) => t.name === 'links').foreignKeys)
      .toEqual([{ column: 'a, b', refTable: 'users', refColumn: 'id' }]);
    expect(deployed.tables.find((t) => t.name === 'users').sequence)
      .toEqual({ name: 'users_seq', start: 1 });

    // The multi-column FK freezes its referenced table like any other:
    // an in-place ALTER on users blocks, named by the joined columns.
    const declared = { tables: [
      { name: 'links', sequence: null, primaryKey: null, tableWas: null, indexes: [],
        columns: [col('a', 'INTEGER'), col('b', 'INTEGER')],
        foreignKeys: [{ column: 'a, b', refTable: 'users', refColumn: 'id' }] },
      table('users', [col('name', 'VARCHAR', { notNull: true })]),
    ] };
    const steps = mig.diffSchemas(declared, deployed);
    expect(steps.map((s) => s.kind + ':' + s.class)).toEqual(['set-not-null:blocked']);
    expect(steps[0].notes.some((n) => n.includes('links.a, b'))).toBe(true);
  });

  // Uniqueness declared as a CONSTRAINT (a hand-written inline or
  // table-level UNIQUE) arrives in the contract's uniqueConstraints —
  // it is invisible to the indexes list, whose internal ART index is
  // not a `duckdb_indexes()` index. A single-column entry is the
  // column's unique flag, so the differ sees one fact either way the
  // database spells it.
  test("a single-column UNIQUE constraint is the column's unique flag: @unique plans nothing, dropping @unique plans drop-unique", async () => {
    const deployedTables = [table('users', [col('email', 'VARCHAR', { notNull: true })],
      { uniqueConstraints: [{ columns: ['email'] }] })];
    // Parity: the model's @unique and the deployed constraint are the
    // same fact — nothing to plan.
    const parity = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('User', field('email', 'email', { unique: true })));
      return mig.plan();
    });
    expect(parity).toEqual([]);
    // Dropping @unique against the constraint plans drop-unique, whose
    // note names the inline-UNIQUE limit.
    const dropped = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('User', field('email', 'email')));
      return mig.plan();
    });
    expect(dropped.map((s) => s.kind + ':' + s.class)).toEqual(['drop-unique:safe']);
    expect(dropped[0].notes.some((n) => n.includes('UNIQUE declared inline'))).toBe(true);
  });

  // A COMPOSITE entry has no per-column home — the unique flag is
  // per-column, and composite uniqueness is modeled as unique indexes
  // — so the database enforces it while diffing cannot see it. The
  // plan states that fact as a note-unique step: informational, never
  // silent, never a gate.
  test('a composite UNIQUE constraint plans a note-unique step naming the table and columns; no column flag is invented', async () => {
    const deployedTables = [table('links', [col('a', 'INTEGER'), col('b', 'INTEGER')],
      { uniqueConstraints: [{ columns: ['a', 'b'] }] })];
    const { deployed, steps } = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('Link', field('a', 'integer', { optional: true }), field('b', 'integer', { optional: true })));
      return { deployed: await mig.introspect(), steps: await mig.plan() };
    });
    // Neither member column carries the flag, and the constraint rides
    // the spec verbatim.
    const links = deployed.tables.find((t) => t.name === 'links');
    expect(links.columns.map((c) => c.name + ':' + c.unique)).toEqual(['id:false', 'a:false', 'b:false']);
    expect(links.compositeUniques).toEqual([['a', 'b']]);
    expect(steps.map((s) => s.kind + ':' + s.class + ':' + s.table)).toEqual(['note-unique:safe:links']);
    expect(steps[0].sql[0]).toContain('links carries a composite UNIQUE constraint on (a, b)');
    expect(steps[0].sql[0]).toContain('the model layer cannot express');
    expect(steps[0].sql[0]).toContain('invisible to declared-vs-deployed diffing');
    expect(steps[0].sql[0]).toContain('@unique [a, b]');
  });

  test('note-unique gates nothing: other steps on the table keep their kind and class', async () => {
    const deployedTables = [table('links', [col('a', 'INTEGER'), col('b', 'INTEGER'), col('legacy', 'INTEGER')],
      { uniqueConstraints: [{ columns: ['a', 'b'] }] })];
    const steps = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('Link',
        field('a', 'integer', { optional: true }),
        field('b', 'integer', { optional: true }),
        field('c', 'integer', { optional: true })));
      return mig.plan();
    });
    expect(steps.map((s) => s.kind + ':' + s.class)).toEqual([
      'add-column:safe', 'drop-column:destructive', 'note-unique:safe',
    ]);
  });

  test('multiple composite constraints: one note each, ordered by column list, columns named verbatim', async () => {
    const deployedTables = [table('links', [col('a', 'INTEGER'), col('b', 'INTEGER'), col('c', 'INTEGER')],
      { uniqueConstraints: [{ columns: ['c', 'b'] }, { columns: ['a', 'b'] }] })];
    const steps = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('Link',
        field('a', 'integer', { optional: true }),
        field('b', 'integer', { optional: true }),
        field('c', 'integer', { optional: true })));
      return mig.plan();
    });
    expect(steps.map((s) => s.kind)).toEqual(['note-unique', 'note-unique']);
    expect(steps[0].sql[0]).toContain('constraint on (a, b)');
    // Verbatim column order within the constraint — never re-sorted.
    expect(steps[1].sql[0]).toContain('constraint on (c, b)');
  });

  // The near-miss: the model declares the EXPRESSIBLE equivalent —
  // @unique [a, b] — over the same column set the deployed CONSTRAINT
  // covers. The differ sees no deployed index (the ART index behind a
  // constraint is not a duckdb_indexes() index), so it plans the
  // CREATE UNIQUE INDEX; measured on DuckDB v1.5.5 and v2.0.0-alpha,
  // that statement succeeds on a populated table (the constraint
  // guarantees no duplicates exist), so the step keeps its class and
  // the note states the redundancy.
  test('declared @unique over the deployed composite constraint: create-index keeps its class, the note names the redundancy', async () => {
    const deployedTables = [table('links', [col('a', 'INTEGER'), col('b', 'INTEGER')],
      { uniqueConstraints: [{ columns: ['a', 'b'] }] })];
    const steps = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('Link',
        field('a', 'integer', { optional: true }),
        field('b', 'integer', { optional: true }),
        dir('unique', { fields: ['a', 'b'] })));
      return mig.plan();
    });
    expect(steps.map((s) => s.kind + ':' + s.class)).toEqual(['create-index:lossy', 'note-unique:safe']);
    expect(steps[0].sql).toEqual(['CREATE UNIQUE INDEX "idx_links_a_b" ON "links" ("a", "b");']);
    const note = steps[1].sql[0];
    expect(note).toContain('idx_links_a_b');
    expect(note).toContain('redundant with this constraint');
    expect(note).toContain('succeeds harmlessly');
    expect(note).toContain('the plans converge');
  });

  test('declared @unique with its index ALSO deployed beside the constraint: only the note remains, naming the double enforcement', async () => {
    const deployedTables = [table('links', [col('a', 'INTEGER'), col('b', 'INTEGER')], {
      uniqueConstraints: [{ columns: ['a', 'b'] }],
      indexes: [{ name: 'idx_links_a_b', columns: ['a', 'b'], unique: true }],
    })];
    const steps = await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: deployedTables }));
      K4.__schema(model('Link',
        field('a', 'integer', { optional: true }),
        field('b', 'integer', { optional: true }),
        dir('unique', { fields: ['a', 'b'] })));
      return mig.plan();
    });
    expect(steps.map((s) => s.kind + ':' + s.class)).toEqual(['note-unique:safe']);
    expect(steps[0].sql[0]).toContain('redundant with this constraint');
    expect(steps[0].sql[0]).toContain('enforces this uniqueness twice');
  });

  test('a deployed table spec without compositeUniques (a caller-built or v0.9.0-derived spec) plans zero notes', () => {
    const declared = { tables: [table('users', [col('name')])] };
    const deployed = { tables: [table('users', [col('name')])] };
    expect(mig.diffSchemas(declared, deployed)).toEqual([]);
  });

  // Version tolerance, pinned: a v0.9.0 harbor serves documents with
  // no uniqueConstraints field at all, and the verbs require
  // catalog(), not the field — absent reads exactly as empty.
  test('a document without uniqueConstraints (v0.9.0) introspects exactly like one carrying the field empty', async () => {
    const tableDoc = (extra) => ({
      name: 'users', schema: 'main',
      columns: [
        { name: 'id', type: 'INTEGER', notNull: true, default: "nextval('users_seq')", primary: true },
        { name: 'email', type: 'VARCHAR', notNull: true, default: null, primary: false },
      ],
      primaryKey: ['id'], indexes: [], foreignKeys: [],
      ...extra,
    });
    const read = (t) => K4.scope(async () => {
      K4.setAdapter({
        query: async () => ({ columns: [], data: [], rowCount: 0 }),
        catalog: async () => ({
          harborVersion: '0.9.0', duckdbVersion: 'v1.5.5',
          tables: [t], sequences: [{ name: 'users_seq', start: 1 }],
        }),
      });
      return mig.introspect();
    });
    const absent = await read(tableDoc({}));
    const empty = await read(tableDoc({ uniqueConstraints: [] }));
    expect(absent).toEqual(empty);
    expect(absent.tables[0].columns.map((c) => c.unique)).toEqual([false, false]);
    expect(absent.tables[0].compositeUniques).toEqual([]);
  });
});

describe('migrate: rename-signal rejections — ambiguity is loud, never a silent add/drop', () => {
  const plan4 = (declare, deployedTables) => K4.scope(async () => {
    K4.setAdapter(migrateAdapter({ tables: deployedTables }));
    declare();
    return mig.plan();
  });

  test("duplicate {was:} targets: one deployed column claimed by two fields", async () => {
    await expect(plan4(
      () => K4.__schema(model('User',
        field('firstName', 'string', { attrs: { was: 'old_name' } }),
        field('lastName', 'string', { attrs: { was: 'old_name' } }))),
      [table('users', [col('old_name', 'VARCHAR', { notNull: true })])],
    )).rejects.toThrow(/\{was: 'old_name'\} is claimed by both users\.first_name and users\.last_name/);
  });

  test('{was:} naming a column the model still declares', async () => {
    await expect(plan4(
      () => K4.__schema(model('User',
        field('name'),
        field('displayName', 'string', { attrs: { was: 'name' } }))),
      [table('users', [col('name', 'VARCHAR', { notNull: true })])],
    )).rejects.toThrow(/\{was: 'name'\} on users\.display_name names a column the model still declares/);
  });

  test('{was:} with BOTH columns deployed (the rename already landed, something recreated the old)', async () => {
    await expect(plan4(
      () => K4.__schema(model('User', field('displayName', 'string', { attrs: { was: 'name' } }))),
      [table('users', [col('name'), col('display_name')])],
    )).rejects.toThrow(/BOTH columns exist in the database/);
  });

  test('@tableWas naming a table another model still claims', async () => {
    await expect(plan4(
      () => {
        K4.__schema(model('User', field('name')));
        K4.__schema(model('Member', field('name'), dir('tableWas', { name: 'users' })));
      },
      [table('users', [col('name', 'VARCHAR', { notNull: true })])],
    )).rejects.toThrow(/@tableWas 'users' on members names a table the models still declare/);
  });

  test('two models @tableWas one deployed table', async () => {
    await expect(plan4(
      () => {
        K4.__schema(model('Member', field('name'), dir('tableWas', { name: 'olds' })));
        K4.__schema(model('Person', field('name'), dir('tableWas', { name: 'olds' })));
      },
      [table('olds', [col('name', 'VARCHAR', { notNull: true })])],
    )).rejects.toThrow(/@tableWas 'olds' is claimed by both members and people/);
  });

  test('@tableWas with BOTH tables deployed', async () => {
    await expect(plan4(
      () => K4.__schema(model('Member', field('name'), dir('tableWas', { name: 'users' }))),
      [table('users', [col('name')]), table('members', [col('name')])],
    )).rejects.toThrow(/BOTH tables exist in the database/);
  });

  // Two models on one table used to fold into one map entry, so the
  // last declaration defined the table and the other's columns read as
  // drops — a plan whose contents changed with declaration order.
  test('two models mapping to one table — refused in BOTH declaration orders', async () => {
    for (const order of [['Alpha', 'Bravo'], ['Bravo', 'Alpha']]) {
      const defs = {
        Alpha: () => K4.__schema(model('Alpha', dir('table', { name: 'orders' }),
          field('total', 'integer'), field('amount', 'integer'))),
        Bravo: () => K4.__schema(model('Bravo', dir('table', { name: 'orders' }),
          field('total', 'integer'))),
      };
      await expect(plan4(
        () => { for (const n of order) defs[n](); },
        [table('orders', [col('total', 'INTEGER', { notNull: true })])],
      )).rejects.toThrow(/both map to table 'orders' — one table has one model/);
    }
  });

  test('a caller-built declared set with a duplicate table is refused too', () => {
    const dup = { tables: [table('orders', [col('total')]), table('orders', [col('total')])] };
    expect(() => mig.diffSchemas(dup, { tables: [] }))
      .toThrow(/table 'orders' is declared twice/);
  });

  // The column differ reads a moved primary key as one column added
  // and another dropped. The ADD carries the sequence default, so it
  // backfills fresh values over every row's identity — and it is
  // classed `safe`. There is no ALTER that moves a primary key.
  test('a primary-key rename is BLOCKED, not planned as add + drop', async () => {
    const steps = await plan4(
      () => K4.__schema(model('Patient', dir('primary', { name: 'patientId' }), field('name'))),
      [table('patients', [col('name', 'VARCHAR', { notNull: true })])],
    );
    expect(steps.map((x) => [x.table, x.kind, x.class]))
      .toEqual([['patients', 'note-primary-key', 'blocked']]);
    expect(steps[0].notes.join(' ')).toMatch(/deployed primary key is id and the model declares patient_id/);
  });

  // The pk-shape skip used to be unconditional, so a natural key's
  // drift from the deployed column was the one difference the differ
  // could not see: it reported no steps at all.
  test('a natural key that drifted from its deployed column still diffs', async () => {
    const steps = await plan4(
      () => K4.__schema(model('Country', dir('primary', { name: 'iso' }),
        field('iso', 'string', { constraints: { max: 2 } }), field('name'))),
      [{
        name: 'countries', sequence: null, primaryKey: 'iso', indexes: [], foreignKeys: [],
        columns: [
          { name: 'iso', type: 'INTEGER', notNull: true, unique: false, default: null, primary: true },
          col('name', 'VARCHAR', { notNull: true }),
        ],
      }],
    );
    expect(steps.map((x) => [x.table, x.kind, x.class]))
      .toEqual([['countries', 'alter-type', 'lossy']]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Unit tier — the statement splitter
// ════════════════════════════════════════════════════════════════════

describe('migrate: the statement splitter', () => {
  test('splits on ; outside quotes; single-quoted strings and doubled escapes pass through', () => {
    expect(mig.splitStatements("INSERT INTO t VALUES ('a;b');\nINSERT INTO t VALUES ('it''s; fine');\n"))
      .toEqual(["INSERT INTO t VALUES ('a;b')", "INSERT INTO t VALUES ('it''s; fine')"]);
  });

  test('double-quoted identifiers carrying semicolons stay whole', () => {
    expect(mig.splitStatements('CREATE TABLE t ("a;b" INTEGER);\n'))
      .toEqual(['CREATE TABLE t ("a;b" INTEGER)']);
  });

  test('comments attach to the following statement; comment-only fragments drop', () => {
    const out = mig.splitStatements(
      '-- header comment\n\n-- TODO: backfill first\nALTER TABLE t ALTER COLUMN c SET NOT NULL;\n-- trailing only\n');
    expect(out.length).toBe(1);
    expect(out[0]).toContain('-- TODO: backfill first');
    expect(out[0]).toContain('SET NOT NULL');
  });

  test('a final unterminated statement still emits; empty input yields nothing', () => {
    expect(mig.splitStatements('SELECT 1')).toEqual(['SELECT 1']);
    expect(mig.splitStatements('')).toEqual([]);
    expect(mig.splitStatements('-- nothing\n')).toEqual([]);
  });

  test('a semicolon inside a -- comment does not split', () => {
    expect(mig.splitStatements('SELECT 1 -- not a break; really\n+ 2;')).toEqual(['SELECT 1 -- not a break; really\n+ 2']);
  });

  test('block comments: semicolons inside stay whole; nesting per the dialect; comment-only fragments drop', () => {
    expect(mig.splitStatements('SELECT /* a; b */ 1;\nSELECT 2;'))
      .toEqual(['SELECT /* a; b */ 1', 'SELECT 2']);
    expect(mig.splitStatements('SELECT /* outer ; /* inner ; */ still outer ; */ 1;'))
      .toEqual(['SELECT /* outer ; /* inner ; */ still outer ; */ 1']);
    expect(mig.splitStatements('/* just; a; comment */')).toEqual([]);
    expect(mig.splitStatements('/* leading; */ SELECT 1;')).toEqual(['/* leading; */ SELECT 1']);
  });

  test('dollar-quoted strings: semicolons, quotes, and newlines inside stay whole; tags close only themselves', () => {
    expect(mig.splitStatements("SELECT $$a; 'b'; \"c\";\nd$$;SELECT 2;"))
      .toEqual(["SELECT $$a; 'b'; \"c\";\nd$$", 'SELECT 2']);
    expect(mig.splitStatements('SELECT $fn$ body; $$ not the end; $fn$;'))
      .toEqual(['SELECT $fn$ body; $$ not the end; $fn$']);
    // A tagged opener is closed only by ITS tag — an inner $other$
    // is content.
    expect(mig.splitStatements('SELECT $a$ x; $b$ y; $a$;'))
      .toEqual(['SELECT $a$ x; $b$ y; $a$']);
    // `$1` positional params never open a dollar quote.
    expect(mig.splitStatements('SELECT $1; SELECT $2;'))
      .toEqual(['SELECT $1', 'SELECT $2']);
  });

  test('quoted identifiers holding semicolons AND quote escapes; strings beside them', () => {
    expect(mig.splitStatements('CREATE TABLE t ("a;""b;" INTEGER);'))
      .toEqual(['CREATE TABLE t ("a;""b;" INTEGER)']);
    expect(mig.splitStatements(`INSERT INTO "t;1" VALUES ('x;''y');`))
      .toEqual([`INSERT INTO "t;1" VALUES ('x;''y')`]);
  });

  test('boundaries: semicolon at EOF, missing final semicolon, adjacent statements without whitespace', () => {
    expect(mig.splitStatements('SELECT 1;')).toEqual(['SELECT 1']);
    expect(mig.splitStatements('SELECT 1;SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(mig.splitStatements('SELECT 1;;SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

// ════════════════════════════════════════════════════════════════════
// Unit tier — make / migrate / status (files + history)
// ════════════════════════════════════════════════════════════════════

describe('migrate: make — gates, numbering, deterministic bytes', () => {
  const withDir = async (fn) => {
    const mdir = mkdtempSync(join(tmpdir(), 'rip-mig-make-'));
    try { return await fn(mdir); } finally { rmSync(mdir, { recursive: true, force: true }); }
  };

  test('writes NNNN_slug.sql from the plan; numbering continues from the max; slug normalizes', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0007_old.sql'), '-- placeholder\nSELECT 1;\n');
      const out = await K4.scope(async () => {
        K4.setAdapter(migrateAdapter({ tables: [] }));
        K4.__schema(model('User', field('name')));
        return mig.make('Add Users!', { dir: mdir });
      });
      expect(out.file).toBe(join(mdir, '0008_add_users.sql'));
      const content = readFileSync(out.file, 'utf8');
      expect(content).toContain('-- 0008_add_users.sql');
      expect(content).toContain('CREATE TABLE "users"');
      expect(content).toContain('-- [safe] create-table users');
    });
  });

  test('byte-determinism: two makes from identical state write identical bodies', async () => {
    const bodyOf = () => withDir(async (mdir) => {
      const out = await K4.scope(async () => {
        K4.setAdapter(migrateAdapter({ tables: [] }));
        K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
        K4.__schema(model('User', field('name'), field('email', 'email', { unique: true })));
        return mig.make('init', { dir: mdir });
      });
      return readFileSync(out.file, 'utf8');
    });
    expect(await bodyOf()).toBe(await bodyOf());
  });

  test('no steps → null, nothing written; a missing name rejects', async () => {
    await withDir(async (mdir) => {
      const out = await K4.scope(async () => {
        K4.setAdapter(migrateAdapter({ tables: [table('users', [col('name', 'VARCHAR', { notNull: true })])] }));
        K4.__schema(model('User', field('name')));
        return mig.make('noop', { dir: mdir });
      });
      expect(out).toBe(null);
      await expect(K4.scope(async () => {
        K4.setAdapter(migrateAdapter({ tables: [] }));
        K4.__schema(model('User', field('name')));
        return mig.make(undefined, { dir: mdir });
      })).rejects.toThrow(/a migration name is required/);
    });
  });

  test('gates: lossy and destructive refuse without their flags and pass with them; blocked never passes', async () => {
    const scenario = (opts) => withDir((mdir) => K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: [table('users', [
        col('name', 'VARCHAR', { notNull: true }), col('legacy'),
      ])] }));
      K4.__schema(model('User', field('name')));
      return mig.make('drop_legacy', { dir: mdir, ...opts });
    }));
    await expect(scenario({})).rejects.toThrow(/gated steps[\s\S]*\[destructive\] drop-column users[\s\S]*--allow-lossy \/ --allow-destructive/);
    const out = await scenario({ allowDestructive: true });
    expect(out.version).toBe('0001');

    await expect(withDir((mdir) => K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: [
        table('users', [col('name', 'VARCHAR', { notNull: true })]),
        table('orders', [col('user_id', 'INTEGER', { notNull: true })],
          { foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }] }),
      ] }));
      K4.__schema(model('User', field('fullName', 'string', { attrs: { was: 'name' } })));
      K4.__schema(model('Order', dir('belongsTo', { target: 'User', optional: false })));
      return mig.make('x', { dir: mdir, allowLossy: true, allowDestructive: true });
      // The refusal names dependent entries generically: a block can be
      // FK-caused or index-caused, and the message must not claim FKs
      // when an index is the wall.
    }))).rejects.toThrow(/cannot execute while other entries \(foreign keys, indexes\) depend on the table[\s\S]*no flag overrides this/);
  });
});

describe('migrate: migrate — history, checksums, conflicts, idempotence', () => {
  const withDir = async (fn) => {
    const mdir = mkdtempSync(join(tmpdir(), 'rip-mig-run-'));
    try { return await fn(mdir); } finally { rmSync(mdir, { recursive: true, force: true }); }
  };
  const scoped = (adapter, fn) => K4.scope(async () => {
    K4.setAdapter(adapter);
    K4.__schema(model('User', field('name')));
    return fn();
  });

  test('make + migrate: write, apply pending in order, record history, idempotent second run', async () => {
    await withDir(async (mdir) => {
      const adapter = migrateAdapter({ tables: [] });
      const r = await scoped(adapter, async () => {
        const out = await mig.make('init', { dir: mdir });
        const first = await mig.migrate({ dir: mdir });
        const second = await mig.migrate({ dir: mdir });
        return { out, first, second };
      });
      expect(r.out.file.endsWith('0001_init.sql')).toBe(true);
      expect(r.first.ran).toEqual(['0001_init']);
      expect(r.first.transactional).toBe(false);
      expect(r.second.ran).toEqual([]);
      expect(adapter.history.map((h) => h.version + '_' + h.name)).toEqual(['0001_init']);
      // The file's header comments attach to the FIRST statement (the
      // splitter's design: a leading TODO is visible in errors), so
      // the sequence statement carries them as a prefix.
      expect(adapter.calls.some((c) => c.sql.startsWith('CREATE TABLE "users"'))).toBe(true);
      expect(adapter.calls.some((c) => c.sql.includes('CREATE SEQUENCE "users_seq"'))).toBe(true);
    });
  });

  test('checksum mismatch on an applied file aborts; {repair: true} re-records', async () => {
    await withDir(async (mdir) => {
      const adapter = migrateAdapter({ tables: [] });
      await scoped(adapter, async () => {
        const out = await mig.make('init', { dir: mdir });
        await mig.migrate({ dir: mdir });
        appendFileSync(out.file, '\n-- edited after apply\n');
        await expect(mig.migrate({ dir: mdir })).rejects.toThrow(/checksum mismatch on applied migration 0001_init.*--repair/s);
        await mig.migrate({ dir: mdir, repair: true });
      });
      expect(adapter.calls.some((c) => c.sql.startsWith('UPDATE _rip_migrations SET checksum'))).toBe(true);
    });
  });

  test('conflicting version numbers reject BEFORE any SQL runs, naming both files', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0002_from_alice.sql'), 'CREATE TABLE a (x INTEGER);\n');
      writeFileSync(join(mdir, '0002_from_bob.sql'), 'CREATE TABLE b (x INTEGER);\n');
      const adapter = migrateAdapter({ tables: [] });
      await scoped(adapter, async () => {
        await expect(mig.migrate({ dir: mdir })).rejects.toThrow(/conflicting migration files share a version number[\s\S]*0002_from_alice[\s\S]*0002_from_bob[\s\S]*Renumber/);
      });
      expect(adapter.calls.length).toBe(0);
    });
  });

  test('transactional apply: each file is one BEGIN…COMMIT, history row inside it', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);\n');
      writeFileSync(join(mdir, '0002_b.sql'), 'CREATE TABLE b (x INTEGER);\n');
      const adapter = migrateAdapter({ tables: [] }, { tx: true });
      const r = await scoped(adapter, () => mig.migrate({ dir: mdir }));
      expect(r.ran).toEqual(['0001_a', '0002_b']);
      expect(r.transactional).toBe(true);
      const stream = adapter.calls
        .filter((c) => !/_rip_migration_lock/.test(c.sql)) // lock acquire/release is orthogonal infrastructure
        .map((c) => (c.sql.startsWith('<') ? c.sql : (c.tx ? 'stmt' : 'main')));
      // ensure-table + applied-select on main, then two clean transactions.
      expect(stream.join(' ')).toBe('main main <BEGIN> stmt stmt <COMMIT> <BEGIN> stmt stmt <COMMIT>');
      expect(adapter.history.length).toBe(2);
    });
  });

  test('interrupted transactional run: the failing file rolls back whole, no history row, earlier migrations stand — and a re-run after the fix applies cleanly', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0001_good.sql'), 'CREATE TABLE a (x INTEGER);\n');
      writeFileSync(join(mdir, '0002_bad.sql'), 'CREATE TABLE b (x INTEGER);\nCREATE BROKEN;\nCREATE TABLE c (x INTEGER);\n');
      const adapter = migrateAdapter({ tables: [] }, { tx: true, failOn: /BROKEN/, failMessage: 'Parser Error: syntax error near BROKEN' });
      let err = null;
      await scoped(adapter, async () => {
        try { await mig.migrate({ dir: mdir }); } catch (e) { err = e; }
      });
      expect(err.message).toContain('0002_bad failed at statement 2 of 3');
      expect(err.message).toContain('CREATE BROKEN');
      expect(err.message).toContain('Parser Error');
      expect(err.message).toContain('ROLLED BACK whole');
      expect(err.message).toContain('Migrations applied earlier in this run remain applied');
      expect(adapter.calls.map((c) => c.sql).filter((s) => s.startsWith('<'))).toEqual(['<BEGIN>', '<COMMIT>', '<BEGIN>', '<ROLLBACK>']);
      expect(adapter.history.map((h) => h.version)).toEqual(['0001']);

      // The fix: edit the failing statement. The file was never
      // applied, so its changed checksum trips nothing — re-run
      // applies it whole.
      writeFileSync(join(mdir, '0002_bad.sql'), 'CREATE TABLE b (x INTEGER);\nCREATE TABLE c (x INTEGER);\n');
      const r = await scoped(adapter, () => mig.migrate({ dir: mdir }));
      expect(r.ran).toEqual(['0002_bad']);
      expect(adapter.history.map((h) => h.version)).toEqual(['0001', '0002']);
    });
  });

  test('the rollback CLAIM follows capabilities.ddlTransactional: a begin()-ful adapter WITHOUT it gets the honest weaker report', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0001_bad.sql'), 'CREATE TABLE a (x INTEGER);\nCREATE BROKEN;\n');
      // begin() present, ddlTransactional withheld — the MySQL-class
      // shape: the engine auto-commits DDL, so "rolled back whole"
      // would overclaim.
      const adapter = migrateAdapter({ tables: [] }, { tx: true, ddlTx: false, failOn: /BROKEN/, failMessage: 'boom' });
      let err = null;
      await scoped(adapter, async () => {
        try { await mig.migrate({ dir: mdir }); } catch (e) { err = e; }
      });
      expect(err.message).toContain('0001_bad failed at statement 2 of 2');
      expect(err.message).toContain('A rollback was attempted');
      expect(err.message).toContain('does not declare capabilities.ddlTransactional');
      expect(err.message).toContain('engines that auto-commit DDL may retain earlier statements');
      expect(err.message).toContain('rip schema status');
      expect(err.message).not.toContain('ROLLED BACK whole');
      expect(adapter.calls.map((c) => c.sql).filter((s) => s.startsWith('<'))).toEqual(['<BEGIN>', '<ROLLBACK>']);
    });
  });

  test('interrupted NON-transactional run: the failure names the file, the statement, and the exact partial state', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0001_bad.sql'), 'CREATE TABLE a (x INTEGER);\nCREATE BROKEN;\nCREATE TABLE c (x INTEGER);\n');
      const adapter = migrateAdapter({ tables: [] }, { failOn: /BROKEN/, failMessage: 'Parser Error: syntax error near BROKEN' });
      let err = null;
      await scoped(adapter, async () => {
        try { await mig.migrate({ dir: mdir }); } catch (e) { err = e; }
      });
      expect(err.message).toContain('0001_bad failed at statement 2 of 3');
      expect(err.message).toContain('ran WITHOUT a transaction');
      expect(err.message).toContain('statements 1-1 of 0001_bad ARE applied');
      expect(err.message).toContain('history row was NOT recorded');
      expect(adapter.history.length).toBe(0);
      expect(adapter.calls.some((c) => c.sql === 'CREATE TABLE a (x INTEGER)')).toBe(true);
      expect(adapter.calls.some((c) => c.sql === 'CREATE TABLE c (x INTEGER)')).toBe(false);
    });
  });

  test('a history-row failure names the concurrency suspect', async () => {
    await withDir(async (mdir) => {
      writeFileSync(join(mdir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);\n');
      const adapter = migrateAdapter({ tables: [] });
      // Another process recorded 0001 between our applied-select and
      // our history INSERT.
      const origQuery = adapter.query.bind(adapter);
      let selected = false;
      adapter.query = async (sql, params) => {
        if (sql.startsWith('SELECT version') && !selected) {
          selected = true;
          return { columns: ['version', 'name', 'checksum', 'applied_at'].map((n) => ({ name: n })), data: [], rowCount: 0 };
        }
        if (sql.startsWith('INSERT INTO _rip_migrations')) {
          adapter.history.push({ version: '0001', name: 'a', checksum: 'other' });
        }
        return origQuery(sql, params);
      };
      let err = null;
      await scoped(adapter, async () => {
        try { await mig.migrate({ dir: mdir }); } catch (e) { err = e; }
      });
      expect(err.message).toContain('failed at recording its history row');
      expect(err.message).toContain('every statement applied');
      expect(err.message).toContain('another `rip schema migrate` running concurrently');
    });
  });

  test('status: applied / pending / mismatched / missing / duplicates all surface', async () => {
    await withDir(async (mdir) => {
      const adapter = migrateAdapter({ tables: [] });
      const st = await scoped(adapter, async () => {
        await mig.make('init', { dir: mdir });
        await mig.migrate({ dir: mdir });
        // Now: edit the applied file, add a pending one, a duplicate
        // pair, and a phantom history row.
        appendFileSync(join(mdir, '0001_init.sql'), '\n-- edited\n');
        writeFileSync(join(mdir, '0002_next.sql'), 'SELECT 1;\n');
        writeFileSync(join(mdir, '0003_x.sql'), 'SELECT 1;\n');
        writeFileSync(join(mdir, '0003_y.sql'), 'SELECT 2;\n');
        adapter.history.push({ version: '0099', name: 'ghost', checksum: 'zz' });
        return mig.status({ dir: mdir });
      });
      expect(st.applied.map((a) => a.version)).toEqual(['0001', '0099']);
      expect(st.pending.map((f) => f.version + '_' + f.name)).toEqual(['0002_next', '0003_x', '0003_y']);
      expect(st.mismatched).toEqual(['0001_init']);
      expect(st.missing).toEqual(['0099_ghost']);
      expect(st.duplicates).toEqual(['0003: x <-> y']);
    });
  });

  test('plan with no registered models rejects loudly', async () => {
    await K4.scope(async () => {
      K4.setAdapter(migrateAdapter({ tables: [] }));
      await expect(mig.plan()).rejects.toThrow(/no :model schemas are registered/);
    });
  });

  describe('the migration lock', () => {
    const lockCalls = (adapter) => adapter.calls.map((c) => c.sql).filter((s) => /_rip_migration_lock/.test(s));

    test('migrate acquires the lock and releases it after applying', async () => {
      await withDir(async (mdir) => {
        writeFileSync(join(mdir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);\n');
        const adapter = migrateAdapter({ tables: [] });
        await scoped(adapter, () => mig.migrate({ dir: mdir }));
        expect(lockCalls(adapter).some((s) => s.startsWith('INSERT INTO _rip_migration_lock'))).toBe(true);
        expect(lockCalls(adapter).some((s) => s.startsWith('DELETE FROM _rip_migration_lock'))).toBe(true);
        expect(adapter.lock.held).toBe(false); // released
      });
    });

    test('the lock is released even when a migration file fails', async () => {
      await withDir(async (mdir) => {
        writeFileSync(join(mdir, '0001_bad.sql'), 'CREATE BROKEN;\n');
        const adapter = migrateAdapter({ tables: [] }, { failOn: /BROKEN/ });
        await scoped(adapter, async () => {
          await expect(mig.migrate({ dir: mdir })).rejects.toThrow(/0001_bad failed/);
        });
        expect(adapter.lock.held).toBe(false); // released in the finally, not left stuck
      });
    });

    test('a held lock makes a concurrent migrate fail fast with a named remedy', async () => {
      await withDir(async (mdir) => {
        writeFileSync(join(mdir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);\n');
        const adapter = migrateAdapter({ tables: [] });
        adapter.lock.held = true; // a peer run holds it
        await scoped(adapter, async () => {
          await expect(mig.migrate({ dir: mdir })).rejects.toThrow(/migration lock is held.*--force/s);
        });
        // it never touched the migration files while locked out
        expect(adapter.calls.some((c) => /CREATE TABLE a/.test(c.sql))).toBe(false);
      });
    });

    test('--force takes over a stale lock and applies', async () => {
      await withDir(async (mdir) => {
        writeFileSync(join(mdir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);\n');
        const adapter = migrateAdapter({ tables: [] });
        adapter.lock.held = true; // a crashed run left it behind
        const r = await scoped(adapter, () => mig.migrate({ dir: mdir, force: true }));
        expect(r.ran).toEqual(['0001_a']);
        expect(adapter.lock.held).toBe(false); // cleared, applied, released
      });
    });

    test('coordinated runs reject unsafe overrides and durably bracket the outcome', async () => {
      await withDir(async (mdir) => {
        writeFileSync(join(mdir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);\n');
        const adapter = migrateAdapter({ tables: [] });
        await scoped(adapter, async () => {
          await expect(mig.migrate({ dir: mdir, coordinated: true })).rejects.toThrow(/requires an operation id/);
          await expect(mig.migrate({ dir: mdir, coordinated: true, operationId: 'op', force: true })).rejects.toThrow(/rejects --force and --repair/);
          const out = await mig.migrate({ dir: mdir, coordinated: true, operationId: '0123456789abcdef0123456789abcdef' });
          expect(out.outcome).toBe('committed');
        });
        const operationCalls = adapter.calls.filter((c) => /_rip_migration_operations/.test(c.sql));
        expect(operationCalls.some((c) => c.params?.includes('unknown'))).toBe(true);
        expect(operationCalls.some((c) => c.params?.includes('committed'))).toBe(true);
      });
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// The CLI-only delivery boundary
// ════════════════════════════════════════════════════════════════════

describe('migrate: the CLI-only boundary — no migration bytes in delivered output', () => {
  test('an inline model program carries the CLI-pointing stubs and NONE of the differ/runner', async () => {
    const { compile } = await import('../../src/compile.js');
    const { code } = compile('export User = schema :model\n  name! string\n', { path: 'm.rip', runtimeDelivery: 'inline' });
    expect(code).toContain('migrationStub');
    expect(code).toContain('CLI-only');
    // Markers that exist ONLY in src/cli/migrate.js — any of them in
    // delivered output means the machinery leaked past the boundary.
    for (const marker of ['diffSchemas', 'rename-table', 'conflicting migration files', '_rip_migrations', 'topoOrder']) {
      expect(code).not.toContain(marker);
    }
  });
});

// Run one scenario on both runtimes over identically-canned
// introspection; return both outcomes. Scenarios that throw record
// the message so pins can compare loudness classes.
async function onKit(kit, scenario) {
  return kit.scope(async () => {
    const adapter = migrateAdapter(scenario.deployed({ table, col, pkCol }));
    kit.setAdapter(adapter);
    scenario.declare(kit);
    const out = { adapter };
    try {
      out.value = await scenario.run(kit, adapter);
    } catch (e) {
      out.threw = e.message;
    }
    return out;
  });
}

