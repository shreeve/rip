// F4 — the migration runner driven by the REAL harbor adapter.
//
// The runner (src/migrate.js) introspects by querying DuckDB's own
// catalog directly (information_schema + duckdb_constraints/indexes/
// sequences) over the adapter's `query` seam, applies each pending file
// under a PK-guarded lock, and wraps a file in harbor's session-based
// transaction when the adapter supports begin(). These tests wire the
// runner to `harborAdapter` from @rip-lang/db over a fetch double that
// speaks harbor's actual wire — object-column catalog results, the
// /sql/sessions lifecycle, and typed errors — proving the runner works
// end to end against the shipped adapter, with NO server. Migration
// files are written to real temp dirs.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harborAdapter } from '@rip-lang/db';
import { __schema, __SchemaRegistry } from '../../../src/runtime/schema.js';
import { __schemaSetAdapter } from '../../../src/runtime/schema-orm.js';
import * as mig from '../../../src/migrate.js';

// A harbor fetch double: object-column catalog answers synthesized from
// an (optionally non-empty) deployed catalog, an in-memory _rip_migrations
// history, the single-row lock, harbor's /sql/sessions lifecycle, and an
// optional failing statement. Every request is recorded.
const harborMigrate = ({ catalog = { tables: [] }, failSql = null, lockHeld = false } = {}) => {
  const history = [];
  const lock = { held: lockHeld };
  const res = (names, rows) => ({ ok: true, columns: names.map((name) => ({ name, duckdbType: 'VARCHAR' })), data: rows, rowCount: rows.length });
  const ack = { ok: true, columns: [], data: [], rowCount: 0 };

  // Synthesize DuckDB's catalog the way it actually reports rip-managed
  // schemas: a `@unique` field is a UNIQUE INDEX (`idx_<t>_<col>` in
  // duckdb_indexes), NOT a duckdb_constraints UNIQUE row — so the live
  // path (index → foldSpec collapse) is what these tests exercise.
  const answerCatalog = (sql) => {
    const tables = catalog.tables || [];
    if (sql.includes('information_schema.tables')) return res(['table_name'], tables.map((t) => [t.name]));
    if (sql.includes('information_schema.columns')) {
      const rows = [];
      for (const t of tables) for (const c of t.columns) rows.push([t.name, c.name, c.type, c.notNull ? 'NO' : 'YES', c.default ?? null]);
      return res(['table_name', 'column_name', 'data_type', 'is_nullable', 'column_default'], rows);
    }
    if (sql.includes('duckdb_constraints()')) {
      const rows = [];
      for (const t of tables) {
        if (t.primaryKey) rows.push([t.name, 'PRIMARY KEY', [t.primaryKey], 'PRIMARY KEY (' + t.primaryKey + ')']);
        for (const fk of t.foreignKeys || []) rows.push([t.name, 'FOREIGN KEY', [fk.column],
          'FOREIGN KEY (' + fk.column + ') REFERENCES ' + fk.refTable + '(' + fk.refColumn + ')']);
      }
      return res(['table_name', 'constraint_type', 'constraint_column_names', 'constraint_text'], rows);
    }
    if (sql.includes('duckdb_indexes()')) {
      const rows = [];
      for (const t of tables) for (const ix of t.indexes || []) rows.push([t.name, ix.name, ix.unique === true, ix.columns]);
      return res(['table_name', 'index_name', 'is_unique', 'expressions'], rows);
    }
    if (sql.includes('duckdb_sequences()')) {
      const rows = [];
      for (const t of tables) if (t.sequence) rows.push([t.sequence.name, t.sequence.start]);
      return res(['sequence_name', 'start_value'], rows);
    }
    return null;
  };

  const answer = (sql, params) => {
    if (failSql && failSql.test(sql)) return { ok: false, error: 'Parser Error: ' + sql.split('\n')[0], errorCode: 'PARSE_ERROR' };
    const cat = answerCatalog(sql);
    if (cat) return cat;
    if (sql.startsWith('DELETE FROM _rip_migration_lock')) { lock.held = false; return ack; }
    if (sql.startsWith('INSERT INTO _rip_migration_lock')) {
      if (lock.held) return { ok: false, error: 'Duplicate key "id: 1" violates primary key constraint', errorCode: 'CONSTRAINT' };
      lock.held = true; return ack;
    }
    if (sql.startsWith('SELECT version')) {
      return res(['version', 'name', 'checksum', 'applied_at'], history.map((h) => [h.version, h.name, h.checksum, null]));
    }
    if (sql.startsWith('INSERT INTO _rip_migrations')) {
      if (history.some((h) => h.version === params[0])) return { ok: false, error: 'Duplicate key "version: ' + params[0] + '"', errorCode: 'CONSTRAINT' };
      history.push({ version: params[0], name: params[1], checksum: params[2] }); return ack;
    }
    return ack; // CREATE TABLE, BEGIN/COMMIT/ROLLBACK, applied DDL
  };

  const calls = [];
  const fetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, sql: body?.sql ?? null, params: body?.params ?? null, sessionId: body?.sessionId ?? null });
    if (method === 'DELETE') return { ok: true, status: 200, statusText: '', json: async () => ({}) };
    if (url.endsWith('/sql/sessions/new')) return { ok: true, status: 200, statusText: '', json: async () => ({ sessionId: 'sess-1' }) };
    const reply = answer(body?.sql ?? '', body?.params ?? []);
    return { ok: reply.ok !== false, status: reply.ok === false ? 400 : 200, statusText: '', json: async () => reply };
  };
  fetch.calls = calls;
  fetch.history = history;
  fetch.lock = lock;
  return fetch;
};

let tmp = null;
const withDir = (files) => {
  tmp = mkdtempSync(join(tmpdir(), 'rip-mig-live-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(tmp, name), content);
  return tmp;
};
afterEach(() => { if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = null; } });

// Wire the runner to a harborAdapter over the double, inside a fresh
// registry scope, and hand the scenario the model factory and the fetch.
const withRunner = (fetch, scenario) =>
  __SchemaRegistry.scope(() => {
    __schemaSetAdapter(harborAdapter({ url: 'http://harbor', fetch }));
    return scenario({ define: (m) => __schema(m), fetch });
  });

const field = (name, typeName = 'string', opts = {}) => ({ tag: 'field', name, modifiers: opts.optional ? ['?'] : ['!'], typeName, ...(opts.unique ? { unique: true } : {}) });
const dir = (name, ...args) => ({ tag: 'directive', name, args });
const model = (name, ...entries) => ({ kind: 'model', name, entries });

describe('the runner introspects DuckDB directly over harbor', () => {
  test('plan() reads the catalog through /sql and proposes a create for an undeployed model', async () => {
    const fetch = harborMigrate({ catalog: { tables: [] } });
    const steps = await withRunner(fetch, async ({ define }) => {
      define(model('User', field('name')));
      return mig.plan();
    });
    expect(steps.map((s) => s.kind + ':' + s.table)).toEqual(['create-table:users']);
    // introspection went to DuckDB's own catalog, over harbor's /sql
    const sqls = fetch.calls.map((c) => c.sql).filter(Boolean);
    expect(sqls.some((s) => s.includes('information_schema.columns'))).toBe(true);
    expect(sqls.some((s) => s.includes('duckdb_constraints()'))).toBe(true);
  });

  test('a deployed schema matching the model plans nothing — the rich catalog round-trips (unique via index, sequence, defaults)', async () => {
    // The deployed catalog as real DuckDB reports a rip-managed table:
    // a UNIQUE field is a `idx_<t>_<col>` unique INDEX (no UNIQUE
    // constraint row), the PK rides a sequence default, and timestamps
    // carry their defaults. plan() must see zero drift.
    const usersDeployed = { tables: [{
      name: 'users',
      sequence: { name: 'users_seq', start: 1 },
      primaryKey: 'id',
      columns: [
        { name: 'id', type: 'INTEGER', notNull: true, default: "nextval('users_seq')" },
        { name: 'name', type: 'VARCHAR', notNull: true, default: null },
        { name: 'email', type: 'VARCHAR', notNull: true, default: null },
        { name: 'created_at', type: 'TIMESTAMP', notNull: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'TIMESTAMP', notNull: false, default: 'now()' },
      ],
      indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
      foreignKeys: [],
    }] };
    const fetch = harborMigrate({ catalog: usersDeployed });
    const steps = await withRunner(fetch, async ({ define }) => {
      define(model('User', field('name'), field('email', 'email', { unique: true }), dir('timestamps')));
      return mig.plan();
    });
    expect(steps).toEqual([]); // unique-index → foldSpec collapse, sequence, and defaults all round-trip
  });
});

describe('migrate applies through harbor sessions and the lock', () => {
  test('a pending file is applied in one session with the history row, then the lock releases', async () => {
    const fetch = harborMigrate();
    const dir = withDir({ '0001_users.sql': 'CREATE TABLE users (id INTEGER);\n' });
    const r = await withRunner(fetch, () => mig.migrate({ dir }));
    expect(r.ran).toEqual(['0001_users']);
    expect(r.transactional).toBe(true);
    // harbor session protocol: opened, the DDL carried the session, committed, dropped
    expect(fetch.calls.some((c) => c.url.endsWith('/sql/sessions/new'))).toBe(true);
    expect(fetch.calls.find((c) => c.sql === 'CREATE TABLE users (id INTEGER)')?.sessionId).toBe('sess-1');
    expect(fetch.calls.some((c) => c.sql === 'COMMIT' && c.sessionId === 'sess-1')).toBe(true);
    expect(fetch.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sql/sessions/sess-1'))).toBe(true);
    expect(fetch.history.map((h) => h.version)).toEqual(['0001']);
    // the lock rode /sql and was released
    expect(fetch.calls.some((c) => c.sql?.startsWith('INSERT INTO _rip_migration_lock'))).toBe(true);
    expect(fetch.lock.held).toBe(false);
  });

  test('a failing statement rolls the session back, drops it, and records no history', async () => {
    const fetch = harborMigrate({ failSql: /BROKEN/ });
    const dir = withDir({ '0001_bad.sql': 'CREATE TABLE ok (id INTEGER);\nCREATE BROKEN;\n' });
    let error = null;
    await withRunner(fetch, async () => { try { await mig.migrate({ dir }); } catch (e) { error = e; } });
    expect(error.message).toMatch(/0001_bad failed/);
    expect(error.message).toMatch(/ROLLED BACK whole/);
    expect(fetch.calls.some((c) => c.sql === 'ROLLBACK' && c.sessionId === 'sess-1')).toBe(true);
    expect(fetch.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sql/sessions/sess-1'))).toBe(true);
    expect(fetch.history.length).toBe(0); // nothing committed
    expect(fetch.lock.held).toBe(false); // lock still released on failure
  });

  test('a lock already held over harbor blocks a second migrate with the named remedy', async () => {
    const fetch = harborMigrate({ lockHeld: true });
    const dir = withDir({ '0001_users.sql': 'CREATE TABLE users (id INTEGER);\n' });
    await withRunner(fetch, async () => {
      await expect(mig.migrate({ dir })).rejects.toThrow(/migration lock is held.*--force/s);
    });
    expect(fetch.calls.some((c) => c.sql === 'CREATE TABLE users (id INTEGER)')).toBe(false); // never applied
  });
});
