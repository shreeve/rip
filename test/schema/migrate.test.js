// The migration layer — src/migrate.js: the deterministic
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
const orm4 = await import('../../src/runtime/schema-orm.js');
const mig = await import('../../src/migrate.js');

// ── kits: one uniform handle per runtime ─────────────────────────────

const K4 = {
  name: 'rip',
  __schema: rt4.__schema,
  setAdapter: orm4.__schemaSetAdapter,
  scope: (fn) => rt4.__SchemaRegistry.scope(fn),
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
  const answer = (sql, params, staged) => {
    if (opts.failOn && opts.failOn.test(sql)) throw new Error(opts.failMessage || ('injected failure: ' + sql));
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
    history, calls,
    introspect: async () => deployed,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return answer(sql, params, null);
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
      K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
      K4.__schema(model('User', field('name')));
      return mig.plan();
    });
    expect(r.map((s) => s.kind + ':' + s.class + ':' + s.table)).toEqual([
      'create-table:safe:users', 'create-table:safe:orders',
    ]);
    expect(r[1].sql.join('\n')).toContain('user_id INTEGER NOT NULL REFERENCES users(id)');
  });

  test('matching database plans nothing (round-trip clean, unique fold included)', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('User',
        field('name', 'string', { constraints: { min: 1, max: 100 } }),
        field('email', 'email', { unique: true }),
        dir('timestamps'),
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
    for (const s of r) byCol[s.sql[0].match(/ADD COLUMN (\w+)/)[1]] = s;
    expect(byCol.bio.sql).toEqual(['ALTER TABLE users ADD COLUMN bio TEXT;']);
    expect(byCol.bio.class).toBe('safe');
    expect(byCol.plan.sql[0]).toBe("ALTER TABLE users ADD COLUMN plan VARCHAR DEFAULT 'free';");
    expect(byCol.plan.class).toBe('safe');
    // Required with a DEFAULT: the executable SET NOT NULL is sound
    // (the default backfilled existing rows) and the step stays safe.
    expect(byCol.plan.sql.length).toBe(1);
    // Required with NO default: lossy (the classification rule),
    // and no executable SET NOT NULL hides behind a comment — the
    // manual step is stated, not executed.
    expect(byCol.code.class).toBe('lossy');
    expect(byCol.code.sql).toEqual([
      'ALTER TABLE users ADD COLUMN code VARCHAR;',
      '-- REQUIRED with no default: backfill users.code, then apply: ALTER TABLE users ALTER COLUMN code SET NOT NULL;',
    ]);
    expect(byCol.code.notes[0]).toContain('the SET NOT NULL is withheld');
    expect(mig.splitStatements(byCol.code.sql.join('\n')).some((s) => s.trimStart().startsWith('ALTER TABLE users ALTER COLUMN'))).toBe(false);
    expect(byCol.tag.sql).toContain('CREATE UNIQUE INDEX idx_users_tag ON users ("tag");');
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
    expect(dropTable.sql).toEqual(['DROP TABLE ghosts;']);
    const dropUnique = await run4(async (deployedRef) => {
      K4.__schema(model('User', field('tag', 'string', { optional: true })));
      deployedRef.value = { tables: [table('users', [col('tag', 'VARCHAR', { unique: true })])] };
      return mig.plan();
    });
    expect(dropUnique.map((s) => s.kind + ':' + s.class)).toEqual(['drop-unique:safe']);
    expect(dropUnique[0].sql).toEqual(['DROP INDEX IF EXISTS idx_users_tag;']);
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
      'DROP INDEX idx_users_a_b;',
      'CREATE INDEX idx_users_a_b ON users ("a", "b");',
    ]);
    expect(r[1].sql).toEqual(['DROP INDEX idx_users_stray;']);
  });

  test('rename column and rename table ride the explicit signals', async () => {
    const r = await run4(async (deployedRef) => {
      K4.__schema(model('Member', field('givenName', 'string', { attrs: { was: 'first_name' } }), dir('tableWas', { name: 'users' })));
      deployedRef.value = { tables: [table('users', [col('first_name', 'VARCHAR', { notNull: true })])] };
      return mig.plan();
    });
    expect(r.map((s) => s.kind)).toEqual(['rename-table', 'rename-column']);
    expect(r[0].sql).toEqual(['ALTER TABLE users RENAME TO members;']);
    expect(r[0].notes[0]).toContain('@tableWas users can be removed');
    expect(r[1].sql).toEqual(['ALTER TABLE members RENAME COLUMN first_name TO given_name;']);
    expect(r[1].notes[0]).toContain('can be removed once this migration lands');
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
      K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
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
      K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
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
      K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
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

describe('migrate: the differ — determinism and ordering', () => {
  const declaredOf = (...specs) => ({ tables: specs });

  test('same pair, repeated runs: byte-identical steps and rendered plan', async () => {
    const declared = await K4.scope(() => {
      K4.__schema(model('User', field('name'), field('email', 'email', { unique: true }), dir('timestamps')));
      K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
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
        Order: () => K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false }))),
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
      expect(content).toContain('CREATE TABLE users');
      expect(content).toContain('-- [safe] create-table users');
    });
  });

  test('byte-determinism: two makes from identical state write identical bodies', async () => {
    const bodyOf = () => withDir(async (mdir) => {
      const out = await K4.scope(async () => {
        K4.setAdapter(migrateAdapter({ tables: [] }));
        K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
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
      K4.__schema(model('Order', dir('belongs_to', { target: 'User', optional: false })));
      return mig.make('x', { dir: mdir, allowLossy: true, allowDestructive: true });
    }))).rejects.toThrow(/cannot execute while foreign keys reference the table[\s\S]*no flag overrides this/);
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
      expect(adapter.calls.some((c) => c.sql.startsWith('CREATE TABLE users'))).toBe(true);
      expect(adapter.calls.some((c) => c.sql.includes('CREATE SEQUENCE users_seq'))).toBe(true);
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
      const stream = adapter.calls.map((c) => (c.sql.startsWith('<') ? c.sql : (c.tx ? 'stmt' : 'main')));
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
});

// ════════════════════════════════════════════════════════════════════
// The CLI-only delivery boundary
// ════════════════════════════════════════════════════════════════════

describe('migrate: the CLI-only boundary — no migration bytes in delivered output', () => {
  test('an inline model program carries the CLI-pointing stubs and NONE of the differ/runner', async () => {
    const { compile } = await import('../../src/compile.js');
    const { code } = compile('export User = schema :model\n  name! string\n', { path: 'm.rip', runtimeDelivery: 'inline' });
    expect(code).toContain('__schemaMigrationStub');
    expect(code).toContain('CLI-only');
    // Markers that exist ONLY in src/migrate.js — any of them in
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

