// F3 — the schema ORM driven by the REAL harbor adapter.
//
// The ORM (src/runtime/schema-orm.js) hydrates rows from an adapter's
// { columns, data, rowCount }, where each column is an object read by
// `column.name` — harbor's own wire shape. These tests wire the ORM's
// Contract-v2 seam (`__schemaSetAdapter`) to `harborAdapter` from
// @rip-lang/db, backed by a fetch double that returns harbor-shaped
// envelopes (object columns), and assert the real adapter drives every
// representative ORM path: RETURNING/SELECT hydration and find-by-
// primary-key, the harbor session-based transaction protocol with
// afterCommit/afterRollback hooks, eager loading (the relation-cache
// memo — one batched query), bulk operations, constraint-error
// translation, and soft delete. A final case runs the higher-level
// `createClient` stack over the same adapter, materializing harbor's
// object-columns into row objects keyed by name. No server runs; live
// integration against a real harbor is a separate endpoint-gated tier.
import { describe, expect, test } from 'bun:test';
import { harborAdapter, createClient, QueryError } from '@rip-lang/db';
import { __schema, __SchemaRegistry, SchemaError } from '../../../src/runtime/schema.js';
import { __schemaSetAdapter, __schemaTransaction } from '../../../src/runtime/schema-orm.js';

// ── harbor-shaped fetch double ────────────────────────────────────────

// A result column as harbor sends it: { name, duckdbType, lossless }.
const hcols = (names) => names.map((name) => ({ name, duckdbType: 'VARCHAR', lossless: true }));
// A harbor success envelope with object columns and positional rows.
const hrows = (names, ...data) => ({ ok: true, kind: 'select', columns: hcols(names), data, rowCount: data.length });
// A harbor write ack (no result set).
const hack = (rowCount = 1) => ({ ok: true, kind: 'write', columns: [], data: [], rowCount });
// A harbor failure envelope: the adapter turns this into a typed error.
const hfail = (error, errorCode) => ({ ok: false, error, errorCode });

// Routes POST /sql by matching the SQL against rules (first match wins),
// answers the session lifecycle, and records every request so a test can
// assert the exact statement stream and the session protocol.
const harborDouble = (rules = []) => {
  const calls = [];
  const fetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body, sql: body?.sql ?? null, params: body?.params ?? null, sessionId: body?.sessionId ?? null });
    if (method === 'DELETE') return { ok: true, status: 200, statusText: '', json: async () => ({}) };
    if (url.endsWith('/sql/sessions/new')) return { ok: true, status: 200, statusText: '', json: async () => ({ sessionId: 'sess-1' }) };
    const sql = body?.sql ?? '';
    const rule = rules.find(([re]) => re.test(sql));
    const reply = rule ? (typeof rule[1] === 'function' ? rule[1]() : rule[1]) : hrows([]);
    const ok = reply.ok !== false;
    return { ok, status: ok ? 200 : 400, statusText: '', json: async () => reply };
  };
  fetch.calls = calls;
  return fetch;
};

// Descriptor builders (the hand-built shape the ORM reads).
const field = (name, typeName = 'string', opts = {}) => ({
  tag: 'field', name, modifiers: opts.optional ? ['?'] : ['!'], typeName,
  ...(opts.unique ? { unique: true } : {}),
});
const dir = (name, ...args) => ({ tag: 'directive', name, args });
const model = (name, ...entries) => ({ kind: 'model', name, entries });

// Wire the ORM to a harborAdapter over a scripted double, inside an
// isolated registry scope, and hand the scenario the model factory,
// the recorded fetch, and the sql statement stream.
const withHarbor = (rules, scenario) =>
  __SchemaRegistry.scope(async () => {
    const fetch = harborDouble(rules);
    __schemaSetAdapter(harborAdapter({ url: 'http://harbor', fetch }));
    const sqls = () => fetch.calls.filter((c) => c.url.endsWith('/sql')).map((c) => c.sql);
    return scenario({ define: (m) => __schema(m), fetch, sqls });
  });

// ── contract compatibility ────────────────────────────────────────────

describe('the harbor adapter satisfies the ORM Contract-v2', () => {
  test('setAdapter accepts a harborAdapter (it implements query + begin)', () => {
    const adapter = harborAdapter({ url: 'http://harbor', fetch: harborDouble() });
    expect(typeof adapter.query).toBe('function');
    expect(typeof adapter.begin).toBe('function');
    expect(() => __SchemaRegistry.scope(() => __schemaSetAdapter(adapter))).not.toThrow();
  });
});

// ── row hydration through real object-columns ─────────────────────────

describe('row hydration reads harbor object-columns by name', () => {
  test('create() hydrates the instance from an INSERT ... RETURNING result', async () => {
    const value = await withHarbor(
      [[/^INSERT INTO "users"/, hrows(['id', 'name', 'email'], [1, 'Ada', 'a@b.c'])]],
      async ({ define }) => {
        const User = define(model('User', field('name'), field('email')));
        const u = await User.create({ name: 'Ada', email: 'a@b.c' });
        return { id: u.id, name: u.name, email: u.email };
      });
    expect(value).toEqual({ id: 1, name: 'Ada', email: 'a@b.c' });
  });

  test('where().all() hydrates each row keyed by column.name', async () => {
    const value = await withHarbor(
      [[/^SELECT \* FROM "users"/, hrows(['id', 'name'], [1, 'Ada'], [2, 'Bo'])]],
      async ({ define, sqls }) => {
        const User = define(model('User', field('name')));
        const found = await User.where({ id: [1, 2] }).all();
        return { rows: found.map((u) => ({ id: u.id, name: u.name })), sql: sqls().find((s) => s.startsWith('SELECT')) };
      });
    expect(value.rows).toEqual([{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }]);
    expect(value.sql).toBe('SELECT * FROM "users" WHERE "id" IN (?, ?)');
  });

  test('find(id) targets the primary key and hydrates the row from the result', async () => {
    const value = await withHarbor(
      [[/^SELECT \* FROM "users"/, hrows(['id', 'name'], [7, 'Ada'])]],
      async ({ define, fetch }) => {
        const User = define(model('User', field('name')));
        const u = await User.find(7);
        const select = fetch.calls.find((c) => c.sql?.startsWith('SELECT'));
        return { id: u.id, name: u.name, sql: select.sql, params: select.params };
      });
    expect(value).toEqual({ id: 7, name: 'Ada', sql: 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1', params: [7] });
  });
});

// ── transactions over the harbor session protocol ─────────────────────

describe('transactions ride the harbor session protocol', () => {
  test('a committing transaction opens a session, carries it per statement, and drops it', async () => {
    const trace = await withHarbor(
      [[/^INSERT INTO "users"/, hrows(['id', 'name'], [1, 'Ada'])]],
      async ({ define, fetch }) => {
        const User = define(model('User', field('name')));
        const id = await __schemaTransaction(async () => {
          const u = await User.create({ name: 'Ada' });
          return u.id;
        });
        return {
          id,
          opened: fetch.calls.some((c) => c.url.endsWith('/sql/sessions/new')),
          insertCarriedSession: fetch.calls.find((c) => c.sql?.startsWith('INSERT'))?.sessionId,
          committed: fetch.calls.some((c) => c.sql === 'COMMIT'),
          dropped: fetch.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sql/sessions/sess-1')),
        };
      });
    expect(trace).toEqual({ id: 1, opened: true, insertCarriedSession: 'sess-1', committed: true, dropped: true });
  });

  test('a throwing transaction rolls back and still drops the session', async () => {
    const trace = await withHarbor(
      [[/^INSERT INTO "users"/, hrows(['id', 'name'], [1, 'Ada'])]],
      async ({ define, fetch }) => {
        const User = define(model('User', field('name')));
        let threw = false;
        try {
          await __schemaTransaction(async () => {
            await User.create({ name: 'Ada' });
            throw new Error('boom');
          });
        } catch { threw = true; }
        return {
          threw,
          rolledBack: fetch.calls.some((c) => c.sql === 'ROLLBACK'),
          committed: fetch.calls.some((c) => c.sql === 'COMMIT'),
          dropped: fetch.calls.some((c) => c.method === 'DELETE'),
        };
      });
    expect(trace).toEqual({ threw: true, rolledBack: true, committed: false, dropped: true });
  });
});

// ── eager loading ─────────────────────────────────────────────────────

describe('eager loading batches a second query through the adapter', () => {
  test('include() loads a has_many relation with one IN query', async () => {
    const value = await withHarbor(
      [
        [/^SELECT \* FROM "users"/, hrows(['id', 'name'], [1, 'Ada'], [2, 'Bo'])],
        [/^SELECT \* FROM "orders"/, hrows(['id', 'user_id'], [10, 1], [11, 1], [12, 2])],
      ],
      async ({ define, sqls }) => {
        define(model('Order', field('total'), dir('belongs_to', { target: 'User', optional: false })));
        const User = define(model('User', field('name'), dir('has_many', { target: 'Order', optional: false })));
        const users = await User.where({}).includes('orders').all();
        // After eager loading, the relation accessor resolves from the
        // memo — no further query beyond the single batched IN.
        const counts = [];
        for (const u of users) counts.push((await u.orders()).length);
        return {
          counts,
          orderQuery: sqls().find((s) => s.startsWith('SELECT * FROM "orders"')),
          orderQueryCount: sqls().filter((s) => s.startsWith('SELECT * FROM "orders"')).length,
        };
      });
    expect(value.counts).toEqual([2, 1]);
    expect(value.orderQuery).toMatch(/^SELECT \* FROM "orders" WHERE "user_id" IN \(\?, \?\)/);
    expect(value.orderQueryCount).toBe(1); // one batched query, not N+1
  });
});

// ── constraint translation ────────────────────────────────────────────

describe('a harbor constraint error translates to a structured SchemaError', () => {
  test('a unique violation becomes a SchemaError on the offending field', async () => {
    const outcome = await withHarbor(
      [[/^INSERT INTO "users"/, () => hfail('Duplicate key "email: a@b.c" violates unique constraint', 'CONSTRAINT')]],
      async ({ define }) => {
        const User = define(model('User', field('email', 'email', { unique: true })));
        try {
          await User.create({ email: 'a@b.c' });
          return { threw: false };
        } catch (e) {
          return {
            isSchemaError: e instanceof SchemaError,
            issues: (e.issues || []).map((i) => [i.field, i.error]),
            causeIsQueryError: e.cause instanceof QueryError,
          };
        }
      });
    expect(outcome.isSchemaError).toBe(true);
    expect(outcome.issues).toEqual([['email', 'unique']]);
    expect(outcome.causeIsQueryError).toBe(true);
  });
});

// ── soft delete ───────────────────────────────────────────────────────

describe('soft delete issues an UPDATE through the adapter', () => {
  test('destroy() on a softDelete model sets deleted_at rather than deleting the row', async () => {
    const value = await withHarbor(
      [
        [/^SELECT \* FROM "posts"/, hrows(['id', 'title', 'deleted_at'], [1, 'Hi', null])],
        [/^UPDATE "posts"/, hack(1)],
      ],
      async ({ define, sqls }) => {
        const Post = define(model('Post', field('title'), dir('softDelete')));
        const post = await Post.first();
        await post.destroy();
        const update = sqls().find((s) => s.startsWith('UPDATE'));
        return { update, deletedNothing: sqls().every((s) => !s.startsWith('DELETE')) };
      });
    expect(value.update).toMatch(/^UPDATE "posts" SET "deleted_at" = \? WHERE "id" = \?/);
    expect(value.deletedNothing).toBe(true);
  });
});

// ── bulk operations ───────────────────────────────────────────────────

describe('bulk operations run one statement through the adapter', () => {
  test('insertMany issues a single multi-row INSERT', async () => {
    const value = await withHarbor(
      [[/^INSERT INTO "users"/, hrows(['id', 'name'], [1, 'Ada'], [2, 'Bo'])]],
      async ({ define, fetch }) => {
        const User = define(model('User', field('name')));
        await User.insertMany([{ name: 'Ada' }, { name: 'Bo' }]);
        const inserts = fetch.calls.filter((c) => c.sql?.startsWith('INSERT'));
        return { count: inserts.length, sql: inserts[0].sql, params: inserts[0].params };
      });
    expect(value.count).toBe(1); // one statement, not one-per-row
    expect(value.sql).toBe('INSERT INTO "users" ("name") VALUES (?), (?) RETURNING *');
    expect(value.params).toEqual(['Ada', 'Bo']);
  });

  test('updateAll and deleteAll issue set-based statements, bypassing per-row hooks', async () => {
    const value = await withHarbor(
      [[/^(UPDATE|DELETE)/, hack(3)]],
      async ({ define, sqls }) => {
        const User = define(model('User', field('name')));
        await User.where({ name: 'x' }).updateAll({ name: 'y' });
        await User.where({ name: 'y' }).deleteAll();
        return { sqls: sqls() };
      });
    expect(value.sqls).toEqual([
      'UPDATE "users" SET "name" = ? WHERE "name" = ?',
      'DELETE FROM "users" WHERE "name" = ?',
    ]);
  });
});

// ── transaction commit/rollback hooks ─────────────────────────────────

describe('transaction hooks fire around the harbor commit and rollback', () => {
  test('afterCommit fires after COMMIT for a row saved inside the transaction', async () => {
    const trace = await withHarbor(
      [[/^INSERT INTO "users"/, hrows(['id', 'name'], [1, 'Ada'])]],
      async ({ define, fetch }) => {
        const fired = [];
        const User = define(model('User', field('name'),
          { tag: 'hook', name: 'afterCommit', fn() { fired.push('afterCommit'); } }));
        await __schemaTransaction(async () => { await User.create({ name: 'Ada' }); });
        // afterCommit runs only once the harbor COMMIT has been sent.
        const committedBeforeHook = fetch.calls.some((c) => c.sql === 'COMMIT');
        return { fired, committedBeforeHook };
      });
    expect(trace.fired).toEqual(['afterCommit']);
    expect(trace.committedBeforeHook).toBe(true);
  });

  test('afterRollback fires (and afterCommit does not) when the transaction throws', async () => {
    const trace = await withHarbor(
      [[/^INSERT INTO "users"/, hrows(['id', 'name'], [1, 'Ada'])]],
      async ({ define, fetch }) => {
        const fired = [];
        const User = define(model('User', field('name'),
          { tag: 'hook', name: 'afterCommit', fn() { fired.push('afterCommit'); } },
          { tag: 'hook', name: 'afterRollback', fn() { fired.push('afterRollback'); } }));
        try {
          await __schemaTransaction(async () => {
            await User.create({ name: 'Ada' });
            throw new Error('boom');
          });
        } catch { /* expected */ }
        return { fired, rolledBack: fetch.calls.some((c) => c.sql === 'ROLLBACK') };
      });
    expect(trace.fired).toEqual(['afterRollback']);
    expect(trace.rolledBack).toBe(true);
  });
});

// ── the createClient stack over the same adapter ──────────────────────

describe('createClient materializes harbor object-columns by name', () => {
  // This guards the client fix at the integration level: an unfixed
  // materialize (keying rows by the whole column object) would key every
  // row by '[object Object]' against these real harbor columns.
  test('rows come back as objects keyed by column.name', async () => {
    const fetch = harborDouble([[/^SELECT/, hrows(['id', 'name'], [1, 'Ada'], [2, 'Bo'])]]);
    const db = createClient(harborAdapter({ url: 'http://harbor', fetch }));
    const result = await db.query('SELECT id, name FROM users');
    expect(result.rows).toEqual([{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }]);
    expect(result.columns).toEqual(['id', 'name']); // the client reports names
    expect(await db.value('SELECT count(*) FROM users')).toBe(1);
  });
});
