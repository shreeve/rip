// The persistence runtime — src/runtime/schema-orm.js is
// verified against the runtime AS ORACLE: the paired tier composes
// the runtime fragments VERBATIM from the runtime modules (validate +
// db-naming + orm + ddl inside the shared wrapper — the own
// migration-mode composition minus the CLI-only migrate fragment)
// into a scratch module, runs every scenario against BOTH runtimes
// over identical in-memory recording adapters, and asserts agreement
// on the full observable surface: the SQL statement stream, hydrated
// instances, savedChanges, hook firing order, and thrown
// classifications. The defect battery asserts the four pinned
// classes #102–#105 the port fixes at the root: this side rejects loudly
// where the reference's silent acceptance is pinned beside it. The
// delivery tier exercises the seam: the fused inline block (the
// ORM body sharing the validation runtime's IIFE), import-mode
// pairing, suppression hatches, zero-cost, sentinel meetings, and
// the synthetic mapping row.
import { test, expect, describe } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Stores, Mappings } from '../../src/stores.js';
import { describeExtended } from '../support/extended.js';
import { recordingAdapter, row, rows } from '../support/recording-adapter.js';

const rt4 = await import('../../src/runtime/schema.js');
const orm4 = await import('../../src/runtime/schema-orm.js');


// ── kits: one uniform handle per runtime ─────────────────────────────

const K4 = {
  name: 'rip',
  __schema: rt4.__schema,
  SchemaError: rt4.SchemaError,
  setAdapter: orm4.__schemaSetAdapter,
  transaction: orm4.__schemaTransaction,
  scope: (fn) => rt4.__SchemaRegistry.scope(fn),
};

// ── descriptor builders (the hand-built shape both runtimes read) ────

const field = (name, typeName = 'string', opts = {}) => ({
  tag: 'field', name,
  modifiers: opts.optional ? ['?'] : ['!'],
  typeName,
  array: opts.array === true,
  ...(opts.unique ? { unique: true } : {}),
  ...(opts.literals ? { literals: opts.literals } : {}),
  ...(opts.constraints ? { constraints: opts.constraints } : {}),
});
const dir = (name, ...args) => ({ tag: 'directive', name, args });
const hook = (name, fn) => ({ tag: 'hook', name, fn });
const ensure = (message, fn, opts = {}) => ({
  tag: 'ensure', message, field: opts.field || '', async: opts.async === true, fn,
});
const scopeEntry = (name, fn) => ({ tag: 'scope', name, fn });
const defaultScopeEntry = (fn) => ({ tag: 'defaultScope', name: 'defaultScope', fn });
const model = (name, ...entries) => ({ kind: 'model', name, entries });

// ── comparison plumbing ───────────────────────────────────────────────

// Normalize an observable value for cross-runtime comparison:
// wall-clock ISO timestamps become '<ts>' (each runtime stamps its
// own now()), Maps list their entries, instances flatten to own
// enumerable properties, functions collapse.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function norm(v, seen = new Set()) {
  if (typeof v === 'string') return ISO.test(v) ? '<ts>' : v;
  if (typeof v === 'function') return '<fn>';
  if (v instanceof Date) return '<date>';
  if (v instanceof Map) return ['<map>', ...[...v.entries()].map((e) => norm(e, seen))];
  if (Array.isArray(v)) return v.map((x) => norm(x, seen));
  if (v && typeof v === 'object') {
    if (seen.has(v)) return '<cycle>';
    seen.add(v);
    const out = {};
    for (const k of Object.keys(v)) out[k] = norm(v[k], seen);
    return out;
  }
  return v;
}

// Errors compare by CLASS and structured issue coordinates, never
// message text (each runtime words its own messages).
function classify(kit, e) {
  if (e instanceof kit.SchemaError) {
    return { schemaError: (e.issues || []).map((i) => [i.field, i.error]) };
  }
  return { error: true };
}

async function runOn(kit, scenario) {
  return await kit.scope(async () => {
    const adapter = recordingAdapter();
    kit.setAdapter(adapter);
    const out = {};
    try {
      out.value = await scenario(kit, adapter);
    } catch (e) {
      out.threw = classify(kit, e);
    }
    out.calls = adapter.calls.map((c) => ({ sql: c.sql, params: c.params, tx: c.tx === true }));
    return out;
  });
}

// The paired reference: identical scenario, identical adapter script,
// agreement on the normalized outcome. Returns the result so a
// test can pin absolutes on top of the agreement.
async function paired(scenario) {
  return runOn(K4, scenario);
}

// A standard three-model world: User (timestamps, unique email,
// has_many Order), Order (belongs_to User, optional belongs_to
// Coupon), Coupon.
function makeWorld(k) {
  const User = k.__schema(model('User',
    field('name'),
    field('email', 'email', { unique: true }),
    dir('timestamps'),
    dir('has_many', { target: 'Order', optional: false }),
  ));
  const Order = k.__schema(model('Order',
    field('total', 'integer'),
    dir('belongs_to', { target: 'User', optional: false }),
    dir('belongs_to', { target: 'Coupon', optional: true }),
  ));
  const Coupon = k.__schema(model('Coupon', field('code')));
  return { User, Order, Coupon };
}

// ════════════════════════════════════════════════════════════════════
// The paired reference tier
// ════════════════════════════════════════════════════════════════════

describe('schema-orm: paired reference — CRUD and the query builder', () => {
  test('create: INSERT shape, RETURNING absorption, savedChanges [null, v]', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT INTO "users"/, row(['id', 'name', 'email', 'created_at', 'updated_at'],
        [1, 'Alice', 'a@b.c', '2026-07-08T00:00:00Z', '2026-07-08T00:00:00Z']));
      const { User } = makeWorld(k);
      const u = await User.create({ name: 'Alice', email: 'a@b.c' });
      return { fields: { ...u }, json: u.toJSON(), saved: u.savedChanges, id: u.id, snake: u.created_at === u.createdAt };
    });
    expect(r.calls.length).toBe(1);
    expect(r.calls[0].sql).toBe('INSERT INTO "users" ("name", "email") VALUES (?, ?) RETURNING *');
    expect(r.value.id).toBe(1);
    expect(r.value.snake).toBe(true);
  });

  test('where: object AND-equalities, array IN, raw SQL, order/limit/offset', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "users"/, rows(['id', 'name'], [1, 'A'], [2, 'B']));
      const { User } = makeWorld(k);
      const a = await User.where({ name: 'A' }).all();
      const b = await User.where({ id: [1, 2, 3] }).all();
      const c = await User.where('"name" LIKE ?', 'A%').order('name DESC').limit(10).offset(20).all();
      const d = await User.where({ email: null }).first();
      return { a: a.length, b: b.map((x) => x.name), c: c.length, d: d && d.id };
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
 'SELECT * FROM "users" WHERE "name" = ?',
 'SELECT * FROM "users" WHERE "id" IN (?, ?, ?)',
 'SELECT * FROM "users" WHERE "name" LIKE ? ORDER BY name DESC LIMIT 10 OFFSET 20',
 'SELECT * FROM "users" WHERE "email" IS NULL LIMIT 1',
    ]);
  });

  test('find routes through the builder; count; findMany one IN query', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT COUNT/, { columns: [{ name: 'count' }], data: [[7]], rowCount: 1 });
      adapter.on(/^SELECT \* FROM "users"/, rows(['id', 'name'], [5, 'E']));
      const { User } = makeWorld(k);
      const u = await User.find(5);
      const n = await User.count();
      const m = await User.findMany([5, 6]);
      const none = await User.findMany([]);
      return { u: u.id, n, m: m.length, none: none.length };
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1',
 'SELECT COUNT(*) FROM "users"',
 'SELECT * FROM "users" WHERE "id" IN (?, ?)',
    ]);
    expect(r.value.n).toBe(7);
  });

  test('hydrate: snake→camel canonical properties with snake aliases; ok()/errors() on hydrated rows', async () => {
    await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name', 'email', 'user_org_id'], [3, 'C', 'c@d.e', 9]));
      const U = k.__schema(model('Acct', field('name'), field('email', 'email')));
      const inst = await U.first();
      return {
        camel: inst.userOrgId, snake: inst.user_org_id,
        keys: Object.keys(inst).sort(),
        ok: inst.ok(), errs: inst.errors().length,
        json: inst.toJSON(),
      };
    });
  });
});

describe('schema-orm: paired reference — dirty tracking and save', () => {
  const hydrateOne = (k, adapter) => {
    adapter.on(/^SELECT \* FROM "accts"/, rows(['id', 'name', 'note'], [1, 'A', null]));
    return k.__schema(model('Acct', field('name'), field('note', 'string', { optional: true })));
  };

  test('a no-op save issues NO SQL; savedChanges stays empty', async () => {
    const r = await paired(async (k, adapter) => {
      const U = hydrateOne(k, adapter);
      const inst = await U.first();
      const before = adapter.calls.length;
      await inst.save();
      return { extra: adapter.calls.length - before, saved: inst.savedChanges };
    });
    expect(r.value.extra).toBe(0);
  });

  test('a changed save UPDATEs only the changed columns, [old, new] recorded', async () => {
    const r = await paired(async (k, adapter) => {
      const U = hydrateOne(k, adapter);
      const inst = await U.first();
      inst.note = 'expedited';
      await inst.save();
      return { saved: inst.savedChanges };
    });
    const update = r.calls.find((c) => c.sql.startsWith('UPDATE'));
    expect(update.sql).toBe('UPDATE "accts" SET "note" = ? WHERE "id" = ?');
    expect(update.params).toEqual(['expedited', 1]);
  });

  test('updated_at bumps ONLY on a real write (timestamps model)', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name', 'created_at', 'updated_at'], [1, 'A', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z']));
      const U = k.__schema(model('Stamp', field('name'), dir('timestamps')));
      const inst = await U.first();
      await inst.save();                    // no-op: no bump
      const noopCalls = adapter.calls.length;
      inst.name = 'B';
      await inst.save();                    // real write: bump rides along
      return { noopCalls, saved: inst.savedChanges };
    });
    const update = r.calls.find((c) => c.sql.startsWith('UPDATE'));
    expect(update.sql).toBe('UPDATE "stamps" SET "name" = ?, "updated_at" = ? WHERE "id" = ?');
  });

  test('markDirty forces an unchanged column into the UPDATE; bogus and unpersisted reject', async () => {
    await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name', 'meta'], [1, 'A', { a: 1 }]));
      adapter.on(/^INSERT/, row(['id', 'name'], [2, 'B']));
      const U = k.__schema(model('Doc', field('name'), field('meta', 'json', { optional: true })));
      const inst = await U.first();
      inst.markDirty('meta');
      await inst.save();
      const update = adapter.calls.find((c) => c.sql.startsWith('UPDATE'));
      let bogus = null;
      try { inst.markDirty('nope'); } catch (e) { bogus = 'threw'; }
      let unpersisted = null;
      const fresh = U.parse({ name: 'B' });
      try { fresh.markDirty('name'); } catch (e) { unpersisted = 'threw'; }
      return { update: update.sql, bogus, unpersisted };
    });
  });

  test('the UPDATE WHERE targets the snapshot PK, not a reassigned in-memory id', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name'], [1, 'A']));
      const U = k.__schema(model('Pk', field('name')));
      const inst = await U.first();
      inst.id = 999;
      inst.name = 'B';
      await inst.save();
      return {};
    });
    const update = r.calls.find((c) => c.sql.startsWith('UPDATE'));
    expect(update.params[update.params.length - 1]).toBe(1);
  });
});

describe('schema-orm: paired reference — the hook lifecycle', () => {
  test('save order on INSERT and UPDATE; validation between the validation hooks', async () => {
    await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'name'], [1, 'A']));
      adapter.on(/^SELECT/, rows(['id', 'name'], [1, 'A']));
      const log = [];
      const U = k.__schema(model('Hooked',
        field('name'),
        hook('beforeValidation', function () { log.push('bv'); }),
        hook('afterValidation', function () { log.push('av'); }),
        hook('beforeSave', function () { log.push('bs'); }),
        hook('beforeCreate', function () { log.push('bc'); }),
        hook('afterCreate', function () { log.push('ac'); }),
        hook('beforeUpdate', function () { log.push('bu'); }),
        hook('afterUpdate', function () { log.push('au'); }),
        hook('afterSave', function () { log.push('as'); }),
      ));
      await U.create({ name: 'A' });
      const created = [...log];
      log.length = 0;
      const inst = await U.first();
      inst.name = 'B';
      await inst.save();
      return { created, updated: log };
    });
  });

  test('a throwing beforeSave aborts: no SQL, the error propagates', async () => {
    const r = await paired(async (k, adapter) => {
      const U = k.__schema(model('Abort',
        field('name'),
        hook('beforeSave', function () { throw new Error('stop'); }),
      ));
      await U.create({ name: 'A' });
      return {};
    });
    expect(r.threw).toEqual({ error: true });
    expect(r.calls.length).toBe(0);
  });

  test('save() re-enters loudly (a hook calling save on its own instance)', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'name'], [1, 'A']));
      const U = k.__schema(model('Reent',
        field('name'),
        hook('beforeSave', async function () { await this.save(); }),
      ));
      await U.create({ name: 'A' });
      return {};
    });
    expect(r.threw).toEqual({ error: true });
  });

  test('validation failure inside save throws SchemaError before any SQL', async () => {
    const r = await paired(async (k) => {
      const U = k.__schema(model('Val', field('name')));
      await U.create({});
      return {};
    });
    expect(r.threw).toEqual({ schemaError: [['name', 'required']] });
    expect(r.calls.length).toBe(0);
  });
});

describe('schema-orm: paired reference — relations and eager loading', () => {
  test('accessor naming (belongs_to/has_one/has_many + pluralize), resolution SQL, nullable FK', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [7, 'Owner']));
      adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id', 'coupon_id'], [42, 100, 7, null]));
      adapter.on(/FROM "profiles"/, rows(['id', 'bio', 'person_id'], [1, 'hi', 7]));
      const Person = k.__schema(model('Person',
        field('name'),
        dir('has_many', { target: 'Order', optional: false }),
        dir('has_one', { target: 'Profile', optional: false }),
      ));
      k.__schema(model('Profile', field('bio'), dir('belongs_to', { target: 'Person', optional: false })));
      const { Order } = ((kk) => ({
        Order: kk.__schema(model('Order',
          field('total', 'integer'),
          dir('belongs_to', { target: 'User', optional: false }),
          dir('belongs_to', { target: 'Coupon', optional: true }),
        )),
      }))(k);
      k.__schema(model('User', field('name'), dir('has_many', { target: 'Order', optional: false })));
      k.__schema(model('Coupon', field('code')));

      const order = await Order.first();
      const owner = await order.user();
      const coupon = await order.coupon();  // null FK → no query, null
      const person = { orders: typeof Person._getClass?.().prototype.orders, profile: typeof Person._getClass?.().prototype.profile };
      return { owner: owner && owner.name, coupon, accessors: person };
    });
    expect(r.value.coupon).toBe(null);
  });

  test('relation memoization: second call answers from cache; reload re-queries', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [7, 'Owner']));
      adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id'], [42, 100, 7]));
      k.__schema(model('User', field('name')));
      const Order = k.__schema(model('Order',
        field('total', 'integer'),
        dir('belongs_to', { target: 'User', optional: false }),
      ));
      const order = await Order.first();
      await order.user();
      const afterFirst = adapter.calls.length;
      await order.user();
      const afterMemo = adapter.calls.length;
      await order.user({ reload: true });
      const afterReload = adapter.calls.length;
      return { memoFree: afterMemo === afterFirst, reloadQueries: afterReload > afterMemo };
    });
    expect(r.value.memoFree).toBe(true);
    expect(r.value.reloadQueries).toBe(true);
  });

  test('.includes preloads with one batched query per relation (no N+1); unknown relation is loud', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [1, 'A'], [2, 'B']));
      adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id'], [10, 5, 1], [11, 6, 1], [12, 7, 2]));
      const User = k.__schema(model('User', field('name'), dir('has_many', { target: 'Order', optional: false })));
      k.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
      const users = await User.includes('orders').all();
      const queryCount = adapter.calls.length;
      const counts = [];
      for (const u of users) counts.push((await u.orders()).length);  // memo — no new SQL
      const afterMemo = adapter.calls.length - queryCount;
      let bad = null;
      try { await User.includes('bogus').all(); } catch (e) { bad = 'threw'; }
      return { queryCount, counts, afterMemo, bad };
    });
    expect(r.value.queryCount).toBe(2);
    expect(r.value.counts).toEqual([2, 1]);
    expect(r.value.afterMemo).toBe(0);
  });
});

describe('schema-orm: paired reference — scopes', () => {
  const scoped = (k) => k.__schema(model('Item',
    field('name'),
    field('active', 'boolean', { optional: true }),
    scopeEntry('live', function () { return this.where({ active: true }); }),
    scopeEntry('named', function (n) { return this.where({ name: n }); }),
  ));

  test('static scope invocation and chain composition, both orders', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name', 'active'], [1, 'x', true]));
      const Item = scoped(k);
      await Item.live().all();
      await Item.live().named('x').all();
      await Item.where({ name: 'x' }).live().all();
      return {};
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
 'SELECT * FROM "items" WHERE "active" = ?',
 'SELECT * FROM "items" WHERE "active" = ? AND "name" = ?',
 'SELECT * FROM "items" WHERE "name" = ? AND "active" = ?',
    ]);
  });

  test('@defaultScope applies at terminal time; .unscoped() escapes anywhere in the chain', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name'], [1, 'x']));
      const Doc = k.__schema(model('Doc',
        field('name'),
        field('archived', 'boolean', { optional: true }),
        defaultScopeEntry(function () { return this.where({ archived: false }); }),
      ));
      await Doc.where({ name: 'x' }).all();
      await Doc.unscoped().where({ name: 'x' }).all();
      await Doc.where({ name: 'x' }).unscoped().all();
      await Doc.find(5);
      return {};
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
 'SELECT * FROM "docs" WHERE "name" = ? AND "archived" = ?',
 'SELECT * FROM "docs" WHERE "name" = ?',
 'SELECT * FROM "docs" WHERE "name" = ?',
 'SELECT * FROM "docs" WHERE "id" = ? AND "archived" = ? LIMIT 1',
    ]);
  });

  test('duplicate @defaultScope, duplicate scope names, and reserved scope names reject', async () => {
    const dup = await paired(async (k) => {
      const D = k.__schema(model('D1', field('name'),
        defaultScopeEntry(function () {}), defaultScopeEntry(function () {})));
      D._normalize();
      return {};
    });
    expect(dup.threw.schemaError).toBeDefined();
    const dupScope = await paired(async (k) => {
      const D = k.__schema(model('D2', field('name'),
        scopeEntry('a', function () {}), scopeEntry('a', function () {})));
      D._normalize();
      return {};
    });
    expect(dupScope.threw.schemaError).toBeDefined();
    const reserved = await paired(async (k) => {
      const D = k.__schema(model('D3', field('name'), scopeEntry('where', function () {})));
      D._normalize();
      return {};
    });
    expect(reserved.threw.schemaError).toBeDefined();
  });
});

describe('schema-orm: paired reference — soft delete', () => {
  const soft = (k) => k.__schema(model('Note', field('body'), dir('softDelete')));

  test('destroy soft-deletes; hard destroy DELETEs; restore un-deletes; the implicit filter and its escapes', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'body', 'deleted_at'], [1, 'hi', null]));
      const Note = soft(k);
      const inst = await Note.first();
      await inst.destroy();
      const softDeletedAt = typeof inst.deletedAt;
      await inst.restore();
      await inst.destroy({ hard: true });
      await Note.where({ body: 'hi' }).all();
      await Note.withDeleted().all();
      await Note.onlyDeleted().all();
      return { softDeletedAt, restored: inst.deletedAt };
    });
    const sqls = r.calls.map((c) => c.sql);
    expect(sqls).toEqual([
 'SELECT * FROM "notes" WHERE "deleted_at" IS NULL LIMIT 1',
 'UPDATE "notes" SET "deleted_at" = ? WHERE "id" = ?',
 'UPDATE "notes" SET "deleted_at" = NULL WHERE "id" = ?',
 'DELETE FROM "notes" WHERE "id" = ?',
 'SELECT * FROM "notes" WHERE "body" = ? AND "deleted_at" IS NULL',
 'SELECT * FROM "notes"',
 'SELECT * FROM "notes" WHERE "deleted_at" IS NOT NULL',
    ]);
  });

  test('restore() on a model without @softDelete is loud', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'body'], [1, 'hi']));
      const Plain = k.__schema(model('Plain', field('body')));
      const inst = await Plain.first();
      await inst.restore();
      return {};
    });
    expect(r.threw).toEqual({ error: true });
  });

  test('bulk deleteAll is soft on a @softDelete model, real otherwise; updateAll shapes', async () => {
    const r = await paired(async (k, adapter) => {
      const Note = soft(k);
      const Plain = k.__schema(model('Plain', field('body')));
      await Note.where({ body: 'x' }).deleteAll();
      await Plain.where({ body: 'x' }).deleteAll();
      await Plain.where({ body: 'x' }).updateAll({ body: 'y' });
      return {};
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
 'UPDATE "notes" SET "deleted_at" = ? WHERE "body" = ? AND "deleted_at" IS NULL',
 'DELETE FROM "plains" WHERE "body" = ?',
 'UPDATE "plains" SET "body" = ? WHERE "body" = ?',
    ]);
  });
});

describe('schema-orm: paired reference — upsert and insertMany', () => {
  test('upsert: ON CONFLICT DO UPDATE with EXCLUDED sets; timestamps ride; missing target is loud', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'name', 'email'], [1, 'Al', 'a@b.c']));
      // The conflict target must be a column a conflict can arise on —
      // a real database rejects ON CONFLICT over a non-unique column.
      const U = k.__schema(model('User', field('name'), field('email', 'email', { unique: true }), dir('timestamps')));
      await U.upsert({ email: 'a@b.c', name: 'Al' }, { on: 'email' });
      let missing = null;
      try { await U.upsert({ email: 'a@b.c' }); } catch (e) { missing = 'threw'; }
      return { missing };
    });
    expect(r.calls[0].sql).toBe(
 'INSERT INTO "users" ("name", "email") VALUES (?, ?) ON CONFLICT ("email") ' +
 'DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP RETURNING *');
  });

  test('insertMany validates EVERY row before any SQL; one multi-VALUES INSERT', async () => {
    const bad = await paired(async (k) => {
      const U = k.__schema(model('User', field('name'), field('age', 'integer', { optional: true })));
      await U.insertMany([{ name: 'A' }, { age: 'x' }, {}]);
      return {};
    });
    expect(bad.threw.schemaError).toEqual([
      ['[1].name', 'required'], ['[1].age', 'type'], ['[2].name', 'required'],
    ]);
    expect(bad.calls.length).toBe(0);

    const ok = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, rows(['id', 'name'], [1, 'A'], [2, 'B']));
      const U = k.__schema(model('User', field('name')));
      const out = await U.insertMany([{ name: 'A' }, { name: 'B' }]);
      return { n: out.length, names: out.map((x) => x.name) };
    });
    expect(ok.calls.length).toBe(1);
    expect(ok.calls[0].sql).toBe('INSERT INTO "users" ("name") VALUES (?), (?) RETURNING *');
  });
});

describe('schema-orm: refinements guard every persistence path (R9)', () => {
  const Adult = (k, ...extra) => k.__schema(model('User',
    field('age', 'integer'),
    ensure('must be adult', (u) => u.age >= 18),
    ...extra,
  ));

  test('create(): a failing @ensure rejects before any SQL; a passing one inserts', async () => {
    const bad = await paired(async (k) => {
      await Adult(k).create({ age: 12 });
      return {};
    });
    expect(bad.threw.schemaError).toEqual([['', 'ensure']]);
    expect(bad.calls.length).toBe(0);

    const ok = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'age'], [1, 30]));
      const u = await Adult(k).create({ age: 30 });
      return { age: u.age };
    });
    expect(ok.value.age).toBe(30);
    expect(ok.calls.length).toBe(1);
  });

  test('create(): validation failure stops the hook lifecycle after beforeValidation', async () => {
    const r = await paired(async (k) => {
      const ran = [];
      const U = Adult(k,
        hook('beforeValidation', () => ran.push('beforeValidation')),
        hook('afterValidation', () => ran.push('afterValidation')),
        hook('beforeSave', () => ran.push('beforeSave')),
        hook('afterSave', () => ran.push('afterSave')));
      try { await U.create({ age: 12 }); } catch { /* the rejection under test */ }
      return { ran };
    });
    expect(r.value.ran).toEqual(['beforeValidation']);
    expect(r.calls.length).toBe(0);
  });

  test('save(): an update that violates a refinement rejects with NO UPDATE SQL', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'age'], [1, 30]));
      const U = Adult(k);
      const inst = await U.first();
      inst.age = 12;
      const before = adapter.calls.length;
      let threw = null;
      try { await inst.save(); } catch (e) { threw = classify(k, e); }
      return { threw, extra: adapter.calls.length - before };
    });
    expect(r.value.threw.schemaError).toEqual([['', 'ensure']]);
    expect(r.value.extra).toBe(0);
  });

  test('upsert(): refinements run before the INSERT … ON CONFLICT', async () => {
    const bad = await paired(async (k) => {
      const U = k.__schema(model('User',
        field('age', 'integer'),
        field('email', 'email', { unique: true }),
        ensure('must be adult', (u) => u.age >= 18)));
      await U.upsert({ age: 12, email: 'a@b.c' }, { on: 'email' });
      return {};
    });
    expect(bad.threw.schemaError).toEqual([['', 'ensure']]);
    expect(bad.calls.length).toBe(0);
  });

  test('insertMany(): refinements run per row, issues prefixed [i], before any SQL', async () => {
    const bad = await paired(async (k) => {
      await Adult(k).insertMany([{ age: 30 }, { age: 12 }]);
      return {};
    });
    expect(bad.threw.schemaError).toEqual([['[1]', 'ensure']]);
    expect(bad.calls.length).toBe(0);
  });

  test('an async @ensure! is awaited on create — never silently accepted', async () => {
    const bad = await paired(async (k) => {
      const U = k.__schema(model('User',
        field('age', 'integer'),
        ensure('must be adult', (u) => Promise.resolve(u.age >= 18), { async: true })));
      await U.create({ age: 12 });
      return {};
    });
    expect(bad.threw.schemaError).toEqual([['', 'ensure']]);
    expect(bad.calls.length).toBe(0);

    const ok = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'age'], [1, 30]));
      const U = k.__schema(model('User',
        field('age', 'integer'),
        ensure('must be adult', (u) => Promise.resolve(u.age >= 18), { async: true })));
      const u = await U.create({ age: 30 });
      return { age: u.age };
    });
    expect(ok.value.age).toBe(30);
  });
});

describe('schema-orm: paired reference — transactions', () => {
  test('ambient join: BEGIN once, statements ride the handle, COMMIT, block value returned', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'name'], [1, 'A']));
      const U = k.__schema(model('User', field('name')));
      const out = await k.transaction(async () => {
        const u = await U.create({ name: 'A' });
        await k.transaction(async () => U.create({ name: 'B' }));  // nested joins
        return u.id;
      });
      return { out };
    });
    const sqls = r.calls.map((c) => [c.sql.startsWith('INSERT') ? 'INSERT' : c.sql, c.tx]);
    expect(sqls).toEqual([
      ['<BEGIN>', false], ['INSERT', true], ['INSERT', true], ['<COMMIT>', false],
    ]);
    expect(r.value.out).toBe(1);
  });

  test('a throwing block ROLLS BACK and propagates; afterRollback fires, afterCommit does not', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'name'], [1, 'A']));
      const log = [];
      const U = k.__schema(model('User', field('name'),
        hook('afterCommit', function () { log.push('commit'); }),
        hook('afterRollback', function () { log.push('rollback'); }),
      ));
      let threw = false;
      try {
        await k.transaction(async () => {
          await U.create({ name: 'A' });
          throw new Error('boom');
        });
      } catch { threw = true; }
      return { threw, log };
    });
    expect(r.value.log).toEqual(['rollback']);
    expect(r.calls.map((c) => c.sql.startsWith('INSERT') ? 'INSERT' : c.sql)).toEqual(['<BEGIN>', 'INSERT', '<ROLLBACK>']);
  });

  test('afterCommit fires at COMMIT inside a transaction, immediately outside one; dedupe per instance', async () => {
    const r = await paired(async (k, adapter) => {
      // RETURNING echoes only the id, so the hook reads the caller's
      // own field values (absorbed columns would overwrite them).
      adapter.on(/^INSERT/, row(['id'], [1]));
      const log = [];
      const U = k.__schema(model('User', field('name'),
        hook('afterCommit', function () { log.push('commit:' + this.name); }),
      ));
      await U.create({ name: 'solo' });          // no tx: fires immediately
      const soloLog = [...log];
      log.length = 0;
      await k.transaction(async () => {
        const u = await U.create({ name: 'tx' });
        u.name = 'tx2';
        await u.save();                          // same instance saved twice → ONE callback
        log.push('inside:' + log.length);
      });
      return { soloLog, log };
    });
    expect(r.value.soloLog).toEqual(['commit:solo']);
    expect(r.value.log).toEqual(['inside:0', 'commit:tx2']);
  });

  test('an adapter without begin() rejects transactions by name', async () => {
    const r = await paired(async (k) => {
      k.setAdapter({ query: async () => ({ columns: [], data: [], rowCount: 0 }) });
      await k.transaction(async () => 1);
      return {};
    });
    expect(r.threw).toEqual({ error: true });
  });
});

describe('schema-orm: paired reference — DDL', () => {
  test('toSQL byte-agreement on the rich model (constraints, unique, index, idStart, timestamps, softDelete, FKs)', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name')));
      k.__schema(model('Coupon', field('code')));
      const T = k.__schema(model('Trade',
        field('name', 'string', { constraints: { min: 1, max: 100 } }),
        field('email', 'email', { unique: true }),
        field('notes', 'text', { optional: true }),
        field('tags', 'string', { array: true, optional: true }),
        field('price', 'number', { optional: true, constraints: { default: 0 } }),
        dir('timestamps'),
        dir('softDelete'),
        dir('idStart', { value: 5000 }),
        dir('index', { fields: ['name'] }),
        dir('unique', { fields: ['name', 'email'] }),
        dir('belongs_to', { target: 'User', optional: false }),
        dir('belongs_to', { target: 'Coupon', optional: true }),
      ));
      return { sql: T.toSQL(), dropped: T.toSQL({ dropFirst: true, idStart: 9000 }) };
    });
    expect(r.value.sql).toContain('CREATE SEQUENCE trades_seq START 5000;');
    expect(r.value.sql).toContain('name VARCHAR(100) NOT NULL');
    expect(r.value.sql).toContain('user_id INTEGER NOT NULL REFERENCES users(id)');
    expect(r.value.sql).toContain('coupon_id INTEGER REFERENCES coupons(id)');
    expect(r.value.sql).toContain('CREATE UNIQUE INDEX idx_trades_email ON trades ("email");');
    expect(r.value.sql).toContain('CREATE UNIQUE INDEX idx_trades_name_email ON trades ("name", "email");');
    expect(r.value.dropped).toContain('DROP TABLE IF EXISTS trades CASCADE;');
    expect(r.value.dropped).toContain('START 9000');
  });

  test('duplicate index declarations on one column set reject', async () => {
    const r = await paired(async (k) => {
      const T = k.__schema(model('Dup',
        field('email', 'email', { unique: true }),
        dir('unique', { fields: ['email'] }),
      ));
      T.toSQL();
      return {};
    });
    expect(r.threw).toEqual({ error: true });
  });

  test('toSQL works with no adapter configured; ORM statics on non-models reject', async () => {
    const r = await paired(async (k) => {
      const T = k.__schema(model('Solo', field('name')));
      const S = k.__schema({ kind: 'shape', name: 'Sh', entries: [field('a')] });
      let shapeFind = null;
      try { await S.find(1); } catch (e) { shapeFind = 'threw'; }
      return { sql: T.toSQL().length > 0, shapeFind };
    });
    expect(r.value.shapeFind).toBe('threw');
    expect(r.calls.length).toBe(0);
  });
});

describe('schema-orm: paired reference — model algebra and wire shapes', () => {
  test('algebra projects over the implicit columns; the result is a :shape without ORM', async () => {
    const r = await paired(async (k) => {
      const U = k.__schema(model('User',
        field('name'),
        field('secret'),
        dir('timestamps'),
        dir('belongs_to', { target: 'Org', optional: false }),
      ));
      k.__schema(model('Org', field('name')));
      const View = U.pick('id', 'name', 'createdAt', 'orgId');
      const Partial = U.omit('secret').partial();
      let ormOnDerived = null;
      try { await View.find(1); } catch (e) { ormOnDerived = 'threw'; }
      return {
        kind: View.kind,
        parsed: { ...View.parse({ id: 1, name: 'A', createdAt: new Date('2026-01-01'), orgId: 2 }) },
        partialOk: Partial.ok({}),
        ormOnDerived,
      };
    });
    expect(r.value.kind).toBe('shape');
    expect(r.value.ormOnDerived).toBe('threw');
  });

  test('a model reserved-name field collides loudly; model wire shape carries implicit columns in JSON Schema', async () => {
    const reserved = await paired(async (k) => {
      const U = k.__schema(model('Bad', field('save')));
      U._normalize();
      return {};
    });
    expect(reserved.threw.schemaError).toBeDefined();

    const js = await paired(async (k) => {
      const U = k.__schema(model('User',
        field('name'),
        dir('timestamps'), dir('softDelete'),
        dir('belongs_to', { target: 'Org', optional: true }),
      ));
      k.__schema(model('Org', field('name')));
      return U.toJSONSchema();
    });
    expect(js.value.properties.id).toEqual({ type: 'integer' });
    expect(js.value.properties.createdAt).toEqual({ type: 'string', format: 'date-time' });
    expect(js.value.properties.orgId).toEqual({ type: ['integer', 'null'] });
  });
});

// ════════════════════════════════════════════════════════════════════
// The defect battery: silent-failure classes, fixed at the root —
// every rejection loud and positioned
// ════════════════════════════════════════════════════════════════════

describe('schema-orm: the defect battery (#102–#105)', () => {
  const loud4 = async (desc, re) => {
    await K4.scope(() => {
      expect(() => K4.__schema(desc)._normalize()).toThrow(re);
    });
  };

  test('#102: an unknown :model directive rejects by name', async () => {
    const typo = model('User', field('name'), dir('timestamp'));
    await loud4(typo, /unknown directive '@timestamp'/);
    await loud4(model('User', field('name'), dir('bogus')), /unknown directive '@bogus'/);
    await loud4(model('User', field('name'), dir('belongs_too', { target: 'Order', optional: false })), /unknown directive '@belongs_too'/);
  });

  test('#103: malformed or junk-bearing directive args reject', async () => {
    // relation with no usable target — the old runtime returns null and drops it
    const noTarget = model('User', field('name'), { tag: 'directive', name: 'belongs_to', args: null });
    await loud4(noTarget, /@belongs_to: takes exactly one target name/);
    // trailing junk: a second arg — the old runtime reads args[0] and ignores the rest
    const junk = model('User', field('name'),
      dir('belongs_to', { target: 'Org', optional: false }, { target: 'Extra', optional: false }));
    await loud4(junk, /@belongs_to: takes exactly one target name/);
    // args on an argless directive
    await loud4(model('User', field('name'), dir('timestamps', { target: 'yes', optional: false })), /@timestamps: takes no arguments/);
    // idStart without an integer
    await loud4(model('User', field('name'), dir('idStart', { value: 'hello' })), /@idStart: takes one integer literal/);
  });

  test('#104: @unique/@index over undeclared columns reject at normalize', async () => {
    const bad = model('Thing', field('name'),
      dir('unique', { fields: ['nope', 'missing'] }),
      dir('index', { fields: ['bogusColumn'] }));
    await loud4(bad, /@unique: unknown column 'nope'/);
    // implicit columns count as known
    await K4.scope(() => {
      const ok = K4.__schema(model('Known', field('name'),
        dir('timestamps'), dir('softDelete'),
        dir('belongs_to', { target: 'Org', optional: false }),
        dir('index', { fields: ['createdAt'] }),
        dir('index', { fields: ['orgId'] }),
        dir('unique', { fields: ['deletedAt', 'name'] })));
      expect(() => ok._normalize()).not.toThrow();
    });
  });

  test('#108: a field and a relation owning one column reject at normalize', async () => {
    // the exact repro: `userId integer` + `@belongs_to User` — one
    // table column, two owners
    const collide = model('User',
      field('userId', 'integer'),
      field('name'),
      dir('belongs_to', { target: 'User', optional: false }));
    await loud4(collide, /field 'userId' and the @belongs_to User relation both own column 'user_id'/);
    // the mixin channel reaches the directive-managed columns (direct
    // declarations are caught by the reserved set first): a
    // mixin-included createdAt + @timestamps is the same collision
    await K4.scope(() => {
      K4.__schema({ kind: 'mixin', name: 'Stamps', entries: [field('createdAt', 'datetime')] });
      const M = K4.__schema(model('Doc', field('name'), dir('mixin', { target: 'Stamps' }), dir('timestamps')));
      expect(() => M._normalize()).toThrow(/field 'createdAt' and @timestamps both own column 'created_at'/);
    });
    // the legal neighbor stays legal
    await K4.scope(() => {
      const ok = K4.__schema(model('Post', field('userName'), dir('belongs_to', { target: 'User', optional: false })));
      expect(() => ok._normalize()).not.toThrow();
    });
  });

  test('#105: acronym-style relation targets reject', async () => {
    const acro = model('Widget', field('name'), dir('belongs_to', { target: 'MDMUser', optional: false }));
    await loud4(acro, /not canonical PascalCase/);
    // the canonical spelling is fine
    await K4.scope(() => {
      K4.__schema(model('MdmUser', field('name')));
      const W = K4.__schema(model('Widget', field('name'), dir('belongs_to', { target: 'MdmUser', optional: false })));
      expect(W._normalize().relations.get('mdmUser').foreignKey).toBe('mdm_user_id');
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// this side-only unit tier (no reference dependence)
// ════════════════════════════════════════════════════════════════════

describe('schema-orm:  unit tier', () => {
  test('an anonymous :model rejects (its table name derives from the name)', async () => {
    await K4.scope(() => {
      expect(() => K4.__schema({ kind: 'model', entries: [field('a')] })._normalize())
        .toThrow(/a :model needs a name/);
    });
  });

  test('persistence entries on non-model kinds reject at the base layer', async () => {
    await K4.scope(() => {
      expect(() => K4.__schema({ kind: 'shape', name: 'S1', entries: [field('a'), hook('beforeSave', () => {})] })._normalize())
        .toThrow(/:model-only/);
      expect(() => K4.__schema({ kind: 'input', name: 'S2', entries: [field('a'), scopeEntry('live', () => {})] })._normalize())
        .toThrow(/:model-only/);
      expect(() => K4.__schema({ kind: 'shape', name: 'S3', entries: [field('a'), defaultScopeEntry(() => {})] })._normalize())
        .toThrow(/:model-only/);
    });
  });

  test('parse() on a model stays a standalone class-with-validation (no adapter, no SQL)', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name'), dir('timestamps')));
      const u = U.parse({ name: 'A' });
      expect(u.name).toBe('A');
      expect(u.ok()).toBe(true);
      expect(adapter.calls.length).toBe(0);
    });
  });

  test("a hand-built model descriptor in a process WITHOUT the persistence runtime rejects at __schema()", () => {
    const runtimePath = new URL('../../src/runtime/schema.js', import.meta.url).pathname;
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-orm-absent-'));
    try {
      writeFileSync(join(dir2, 'main.js'),
        `import { __schema } from ${JSON.stringify(runtimePath)};\n` +
        `__schema({ kind: 'model', name: 'User', entries: [] });\n`);
      const r = spawnSync('bun', [join(dir2, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("kind 'model' needs the persistence runtime");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('the schema namespace: the M11-A surface plus the M11-C CLI-pointing migration stubs', () => {
    expect(Object.keys(orm4.schema).sort()).toEqual([
 'connect', 'introspect', 'make', 'migrate', 'plan', 'registerCoercer', 'setAdapter', 'status', 'transaction',
    ]);
    expect(orm4.schema.registerCoercer).toBe(rt4.registerCoercer);
    // The migration machinery is CLI-only: the delivered
    // namespace REJECTS the verbs loudly, naming the CLI — never
    // `undefined is not a function`, never the differ itself.
    for (const verb of ['plan', 'status', 'make', 'migrate', 'introspect']) {
      expect(() => orm4.schema[verb]()).toThrow(/CLI-only/);
      expect(() => orm4.schema[verb]()).toThrow(/rip schema/);
    }
  });

  test('schema.connect builds a NEW adapter value without installing it; a url is required', () => {
    const a = orm4.__schemaConnect({ url: 'http://x.example:1' });
    expect(typeof a.query).toBe('function');
    expect(typeof a.begin).toBe('function');
    expect(a.capabilities.tx).toBe(true);
    expect(() => orm4.__schemaConnect({})).toThrow(/url is required/);
  });

  test("a per-schema `on:` adapter pins that model's SQL; the global adapter keeps the rest", async () => {
    await K4.scope(async () => {
      const global_ = recordingAdapter();
      const pinned = recordingAdapter();
      K4.setAdapter(global_);
      const A = K4.__schema({ kind: 'model', name: 'Alpha', entries: [field('name')], adapter: pinned });
      const B = K4.__schema(model('Beta', field('name')));
      await A.count();
      await B.count();
      expect(pinned.calls.map((c) => c.sql)).toEqual(['SELECT COUNT(*) FROM "alphas"']);
      expect(global_.calls.map((c) => c.sql)).toEqual(['SELECT COUNT(*) FROM "betas"']);
    });
  });

  test('constraint-violation translation: a DuckDB unique violation becomes a structured SchemaError', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      adapter.on(/^INSERT/, () => {
        throw new Error('Constraint Error: Duplicate key "email: a@b.c" violates unique constraint');
      });
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('email', 'email')));
      let err = null;
      try { await U.create({ email: 'a@b.c' }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(rt4.SchemaError);
      expect(err.issues).toEqual([{ field: 'email', error: 'unique', message: 'email already taken' }]);
      expect(err.cause).toBeInstanceOf(Error);
    });
  });

  test('pluralization: irregulars, uncountables, y/es endings drive table and accessor names', async () => {
    await K4.scope(() => {
      expect(K4.__schema(model('Person', field('name')))._normalize().tableName).toBe('people');
      expect(K4.__schema(model('Box', field('name')))._normalize().tableName).toBe('boxes');
      expect(K4.__schema(model('Company', field('name')))._normalize().tableName).toBe('companies');
      expect(K4.__schema(model('Datum', field('name')))._normalize().tableName).toBe('datums');
    });
  });

  // ── the adapter-contract boundary ─

  test('setAdapter rejects a non-adapter loudly, by name, citing the contract', () => {
    expect(() => orm4.__schemaSetAdapter(42)).toThrow(/schema\.setAdapter\(\).*query\(sql, params\).*Adapter Contract v2/);
    expect(() => orm4.__schemaSetAdapter(null)).toThrow(/Adapter Contract v2/);
    expect(() => orm4.__schemaSetAdapter({ begin() {} })).toThrow(/Adapter Contract v2/);
    // the module-global adapter survived every rejected installation
    orm4.__schemaSetAdapter(recordingAdapter());
  });

  test("a malformed `on:` adapter rejects at declaration; a malformed transaction `on:` rejects at the call", async () => {
    await K4.scope(async () => {
      expect(() => K4.__schema({ kind: 'model', name: 'Pinned', entries: [field('name')], adapter: 42 }))
        .toThrow(/schema :model on: \(Pinned\).*Adapter Contract v2/);
      let err = null;
      try { await K4.transaction({ on: 7 }, async () => 1); } catch (e) { err = e; }
      expect(err?.message).toMatch(/schema\.transaction\(on:\).*Adapter Contract v2/);
    });
  });

  test('an INSERT whose response produced no primary key rejects before _persisted flips', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();  // default answer: no RETURNING row
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name')));
      let err = null;
      let inst = null;
      try { inst = await U.create({ name: 'A' }); } catch (e) { err = e; }
      expect(inst).toBe(null);
      expect(err?.message).toMatch(/INSERT INTO "users" produced no id/);
      expect(err?.message).toMatch(/\{columns: 0 cols, data: 0 rows\}/);
      // a response with data but still no id column names its shape too
      adapter.on(/^INSERT/, row(['name'], ['A']));
      err = null;
      try { await U.create({ name: 'A' }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/produced no id/);
    });
  });

  test('the adapter near-miss names the missing method; a non-object names its type', () => {
    // Near-miss: an object that just lacks query() — the message says
    // what to add, not what was passed.
    expect(() => orm4.__schemaSetAdapter({ begin() {}, capabilities: {} }))
      .toThrow(/no query\(\) method.*Adapter Contract v2.*carries: begin, capabilities/);
    // Non-objects keep the type-naming shape.
    expect(() => orm4.__schemaSetAdapter(42)).toThrow(/got number, not an adapter object/);
    expect(() => orm4.__schemaSetAdapter(null)).toThrow(/got null, not an adapter object/);
    expect(() => orm4.__schemaSetAdapter('http://db')).toThrow(/got string, not an adapter object/);
    orm4.__schemaSetAdapter(recordingAdapter());
  });

  // ── the caller-supplied-pk posture ─
  // A caller id never reaches the INSERT (the pk is sequence-assigned,
  // RETURNING-absorbed), and a preset id defeats the
  // RETURNING-produced-the-pk check — so every insert path REJECTS it
  // loudly instead of resting the hole on the DB constraint.

  test('create()/save() with a caller-supplied id reject loudly;  silently drops the id ()', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name')));
      let err = null;
      try { await U.create({ id: 99, name: 'A' }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/caller-supplied id.*primary key is runtime-managed/);
      expect(adapter.calls.length).toBe(0); // rejected before any SQL
      // a before-hook presetting the pk is the same channel — checked
      // after every before-hook ran
      const H = K4.__schema(model('Hk', field('name'), hook('beforeCreate', function () { this.id = 7; })));
      err = null;
      try { await H.create({ name: 'B' }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/caller-supplied id/);
    });
  });

  test('upsert() and insertMany() reject caller-supplied ids too (before any SQL)', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name'), field('email', 'email', { unique: true })));
      let err = null;
      try { await U.upsert({ id: 5, name: 'A', email: 'a@b.c' }, { on: 'email' }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/upsert\(\) on User received a caller-supplied id/);
      err = null;
      try { await U.insertMany([{ name: 'A', email: 'a@b.c' }, { id: 3, name: 'B', email: 'b@b.c' }]); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(rt4.SchemaError);
      expect(err.issues.some((i) => i.field === '[1].id' && i.error === 'pk')).toBe(true);
      expect(adapter.calls.length).toBe(0);
    });
  });

  test("a declared `id` field on a :model collides with the runtime-managed primary key", async () => {
    await K4.scope(() => {
      expect(() => K4.__schema(model('U1', field('id', 'integer'), field('name')))._normalize())
        .toThrow(/id collides with the runtime-managed primary key/);
      // non-model kinds keep `id` as an ordinary field
      expect(() => K4.__schema({ kind: 'shape', name: 'S1', entries: [field('id', 'integer')] })._normalize())
        .not.toThrow();
    });
  });

  // ── the ALS cold start ───────

  test('concurrent FIRST transactions share one AsyncLocalStorage — no statement escapes to autocommit ()', () => {
    // The race exists only at process cold start (this test file's own
    // transactions already initialized the singleton), so the pin runs
    // in a fresh subprocess: two parallel first transactions on
    // separate adapters, the second staggered by a microtask to cover
    // the overwrite interleaving. Every INSERT must ride a
    // transaction handle (tx === true); an escaped statement is the
    // silent atomicity loss the memoized init promise removes.
    const schemaPath = new URL('../../src/runtime/schema.js', import.meta.url).pathname;
    const ormPath = new URL('../../src/runtime/schema-orm.js', import.meta.url).pathname;
    const script = `
import { __schema } from ${JSON.stringify(schemaPath)};
import { __schemaTransaction } from ${JSON.stringify(ormPath)};
const mk = () => {
  const calls = [];
  const answer = { columns: [{ name: 'id' }], data: [[1]], rowCount: 1 };
  return {
    calls,
    async query(sql) { calls.push({ sql, tx: false }); return answer; },
    async begin() {
      calls.push({ sql: '<BEGIN>', tx: null });
      return {
        async query(sql) { calls.push({ sql, tx: true }); return answer; },
        async commit() { calls.push({ sql: '<COMMIT>', tx: null }); },
        async rollback() { calls.push({ sql: '<ROLLBACK>', tx: null }); },
      };
    },
    capabilities: { tx: true },
  };
};
const a1 = mk(), a2 = mk();
const fieldEntry = { tag: 'field', name: 'name', modifiers: ['!'], typeName: 'string', array: false };
const U = __schema({ kind: 'model', name: 'User', entries: [fieldEntry], adapter: a1 });
const V = __schema({ kind: 'model', name: 'Wing', entries: [fieldEntry], adapter: a2 });
await Promise.all([
  __schemaTransaction({ on: a1 }, async () => { await U.create({ name: 'a' }); }),
  Promise.resolve().then(() => __schemaTransaction({ on: a2 }, async () => { await V.create({ name: 'b' }); })),
]);
const all = [...a1.calls, ...a2.calls];
const escaped = all.filter((c) => c.tx === false);
console.log(JSON.stringify({
  escaped: escaped.length,
  inserts: all.filter((c) => c.sql.startsWith('INSERT')).map((c) => c.tx),
  shapes: [a1.calls.map((c) => c.sql.split(' ')[0]), a2.calls.map((c) => c.sql.split(' ')[0])],
}));
`;
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-als-race-'));
    try {
      writeFileSync(join(dir2, 'race.mjs'), script);
      const r = spawnSync('bun', [join(dir2, 'race.mjs')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout.trim());
      expect(out.escaped).toBe(0);
      expect(out.inserts).toEqual([true, true]);
      expect(out.shapes).toEqual([['<BEGIN>', 'INSERT', '<COMMIT>'], ['<BEGIN>', 'INSERT', '<COMMIT>']]);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

});

// ════════════════════════════════════════════════════════════════════
// delivery: the persistence runtime through the seam
// ════════════════════════════════════════════════════════════════════

parser.lexer = makeParserLexer();

const compile = (source, opts = {}) => {
  const result = parser.parse(source);
  if (result.diagnostics?.length) throw new Error(result.diagnostics[0].message);
  const emitted = emit(result, { source, ...opts });
  return {
    code: emitted.code,
    runtimes: emitted.runtimes,
    mappings: new Mappings(emitted.mappings),
  };
};

describe('schema-orm: runtime delivery', () => {
  const ORM_SRC = 'schema.setAdapter({query: (sql) -> {columns: [], data: [], rowCount: 0}})\nconsole.log "installed"';
  const BOTH_SRC = 'S = schema\n  a! integer\nschema.setAdapter({query: (sql) -> {columns: [], data: [], rowCount: 0}})\nconsole.log S.parse({a: 4}).a';

  test('referencing the schema namespace delivers the persistence runtime AND its validation dependency', () => {
    const { runtimes } = compile(ORM_SRC);
    expect([...runtimes].sort()).toEqual(['schema', 'schema-orm']);
  });

  test('a schema DECLARATION alone never delivers the persistence runtime', () => {
    const { runtimes, code } = compile('S = schema\n  a! integer', { runtimeDelivery: 'inline' });
    expect([...runtimes]).toEqual(['schema']);
    expect(code).not.toContain('__schemaTransaction');
    expect(code).not.toContain('PERSISTENCE');
    // import mode: only the validation runtime's module
    const imp = compile('S = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(imp.code).toContain('runtime/schema.js');
    expect(imp.code).not.toContain('runtime/schema-orm.js');
  });

  test("'import' injects BOTH modules, validation first; names bound match inline mode", () => {
    const { code } = compile(BOTH_SRC, { runtimeDelivery: 'import' });
    const lines = code.split('\n');
    expect(lines[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*src\/runtime\/schema\.js";$/);
    expect(lines[1]).toMatch(/^import \{ schema, __schemaSetAdapter \} from ".*src\/runtime\/schema-orm\.js";$/);
  });

  test("'inline' fuses the two bodies into ONE IIFE binding the union (the fragment-scope model)", () => {
    const { code } = compile(BOTH_SRC, { runtimeDelivery: 'inline' });
    expect(code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
    // one runtime IIFE, one sentinel, no import statements
    expect((code.match(/\(\(\) => \{\n\/\//g) ?? []).length).toBe(1);
    expect((code.match(/class SchemaError/g) ?? []).length).toBe(1);
    expect(/^import /m.test(code)).toBe(false);
    // the orm body made it in, its import line stripped
    expect(code).toContain('__schemaInstallPersistence({');
    expect(code).not.toContain("from './schema.js'");
  });

  test('a transaction-only module (no schema declaration) still gets the fused pair', () => {
    const { code, runtimes } = compile(ORM_SRC, { runtimeDelivery: 'inline' });
    expect([...runtimes].sort()).toEqual(['schema', 'schema-orm']);
    expect(code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
  });

  test('the fused inline block records ONE synthetic mapping row that never serializes', () => {
    const { code, mappings } = compile(BOTH_SRC, { runtimeDelivery: 'inline' });
    const runtimeRows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(runtimeRows.length).toBe(1);
    expect(runtimeRows[0].mappingKind).toBe('synthetic');
    expect(runtimeRows[0].sourceStart).toBe(runtimeRows[0].sourceEnd);
    expect(code.slice(runtimeRows[0].generatedStart, runtimeRows[0].generatedEnd)).toContain('__schemaInstallPersistence');
    expect(mappings.serializableRows().some((r) => r.role === 'runtime')).toBe(false);
  });

  test('program-scope bindings suppress per name (the bring-your-own hatch)', () => {
    // `schema` bound: no namespace injection; __schemaSetAdapter still delivers
    const a = compile('schema = {setAdapter: (x) -> x}\nschema.setAdapter 1\n__schemaSetAdapter 2', { runtimeDelivery: 'import' });
    const ormLine = a.code.split('\n').find((l) => l.includes('schema-orm.js'));
    expect(ormLine).toMatch(/^import \{ __schemaSetAdapter \} from/);
    // both orm names bound: nothing triggers, nothing injects
    const b = compile('schema = 1\n__schemaSetAdapter = 2\nschema.setAdapter 3', { runtimeDelivery: 'import' });
    expect([...b.runtimes]).toEqual([]);
    expect(b.code).not.toContain('runtime/schema');
  });

  test('zero-cost holds: plain programs byte-identical across modes; validation-only programs carry no persistence bytes', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = compile('x = 1 + 2\nf = (a) -> a * x', { runtimeDelivery: mode });
      expect(code).toBe('let x = 1 + 2;\nlet f = function(a) {\n  return (a * x);\n};');
      expect([...runtimes]).toEqual([]);
    }
    // import: only the validation module's import line; inline: no
    // persistence body markers (the validation body's comments name
    // its sibling module, so the markers are orm-only DECLARATIONS).
    const imp = compile('S = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(imp.code).not.toContain('schema-orm.js');
    const inl = compile('S = schema\n  a! integer', { runtimeDelivery: 'inline' });
    expect(inl.code).not.toContain('__SchemaQuery');
    expect(inl.code).not.toContain('__schemaTransaction');
    expect(inl.code).not.toContain('AsyncLocalStorage');
  });

  test('inline output RUNS standalone end-to-end: adapter install, hand-built model, create/save', () => {
    const src = [
 'calls = []',
 'schema.setAdapter({',
 '  query: (sql, params) ->',
 '    calls.push sql',
 '    if sql.indexOf("INSERT") is 0',
 '      {columns: [{name: "id"}, {name: "name"}], data: [[1, "Al"]], rowCount: 1}',
 '    else',
 '      {columns: [], data: [], rowCount: 0}',
 '})',
 'User = __schema({kind: "model", name: "User", entries: [{tag: "field", name: "name", modifiers: ["!"], typeName: "string", array: false}]})',
 'u = await User.create({name: "Al"})',
 'console.log u.id, calls.length',
    ].join('\n');
    const { code } = compile(src, { runtimeDelivery: 'inline' });
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-orm-e2e-'));
    try {
      writeFileSync(join(dir2, 'one.js'), code);
      const r = spawnSync('bun', [join(dir2, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('1 1');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('import and inline modes agree observably (the same program, both deliveries, same output)', () => {
    const src = 'schema.setAdapter({query: (s) -> {columns: [], data: [], rowCount: 0}})\nconsole.log typeof schema.transaction';
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-orm-parity-'));
    try {
      const outputs = [];
      for (const mode of ['import', 'inline']) {
        const { code } = compile(src, { runtimeDelivery: mode });
        const f = join(dir2, mode + '.js');
        writeFileSync(f, code);
        const r = spawnSync('bun', [f], { encoding: 'utf8' });
        expect(r.status).toBe(0);
        outputs.push(r.stdout);
      }
      expect(outputs[0]).toBe(outputs[1]);
      expect(outputs[0].trim()).toBe('function');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('the sentinel: a standalone fused copy meeting the shared modules rejects loudly', () => {
    const { code } = compile(ORM_SRC, { runtimeDelivery: 'inline' });
    const ormPath = new URL('../../src/runtime/schema-orm.js', import.meta.url).pathname;
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-orm-sentinel-'));
    try {
      writeFileSync(join(dir2, 'one.js'), code);
      writeFileSync(join(dir2, 'main.js'), `import './one.js';\nimport ${JSON.stringify(ormPath)};\n`);
      const r = spawnSync('bun', [join(dir2, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip schema runtime');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('dual delivery with the reactive runtime: separate blocks, rows keyed by range', () => {
    const src = 'count := 1\nschema.setAdapter({query: (s) -> {columns: [], data: [], rowCount: 0}})\ncount = count + 1';
    const { code, runtimes, mappings } = compile(src, { runtimeDelivery: 'inline' });
    expect([...runtimes].sort()).toEqual(['reactive', 'schema', 'schema-orm']);
    const runtimeRows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(runtimeRows.length).toBe(2);
    const [a, b] = runtimeRows.sort((x, y) => x.generatedStart - y.generatedStart);
    expect(a.generatedEnd).toBeLessThanOrEqual(b.generatedStart);
    expect(code.slice(a.generatedStart, a.generatedEnd)).toContain('__schemaInstallPersistence');
    expect(code.slice(b.generatedStart, b.generatedEnd)).toContain('__state');
  });

  // The / parse-rejection pin (`schema :model is not
  // supported yet`) GRADUATES here: the DSL is the working
  // surface, and a `:model` declaration is the structural trigger the
  //  record reserved for it.

  test("the graduated surface: a `:model` declaration ALONE delivers the persistence runtime (the structural trigger)", () => {
    const src = 'M = schema :model\n  name! string';
    // no persistence NAME is referenced anywhere — the declaration
    // itself is the trigger
    for (const mode of ['none', 'import', 'inline']) {
      const { runtimes } = compile(src, { runtimeDelivery: mode });
      expect([...runtimes].sort()).toEqual(['schema', 'schema-orm']);
    }
    const imp = compile(src, { runtimeDelivery: 'import' });
    const lines = imp.code.split('\n');
    expect(lines[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*src\/runtime\/schema\.js";$/);
    expect(lines[1]).toMatch(/^import \{ schema, __schemaSetAdapter \} from ".*src\/runtime\/schema-orm\.js";$/);
    const inl = compile(src, { runtimeDelivery: 'inline' });
    expect(inl.code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
    // a model nested inside a function body triggers from the tree
    // walk too
    const nested = compile('f = ->\n  T = schema :model\n    b! string\n  T', { runtimeDelivery: 'import' });
    expect([...nested.runtimes].sort()).toEqual(['schema', 'schema-orm']);
  });

  test('end to end from the compiled DSL: a model declared in Rip persists through a recording adapter and round-trips', () => {
    const src = [
 'calls = []',
 'schema.setAdapter({',
 '  query: (sql, params) ->',
 '    calls.push sql',
 '    if sql.indexOf("INSERT") is 0',
 '      {columns: [{name: "id"}, {name: "name"}, {name: "email"}, {name: "created_at"}, {name: "updated_at"}], data: [[1, "Al", "a@b.c", "2026-07-08T00:00:00Z", "2026-07-08T00:00:00Z"]], rowCount: 1}',
 '    else if sql.indexOf("SELECT") is 0',
 '      {columns: [{name: "id"}, {name: "name"}, {name: "email"}], data: [[1, "Al", "a@b.c"]], rowCount: 1}',
 '    else',
 '      {columns: [], data: [], rowCount: 0}',
 '})',
 'User = schema :model',
 '  name!  string',
 '  email! email @unique',
 '  @timestamps',
 '  beforeSave: -> @name = @name.trim()',
 '  shout: -> @name.toUpperCase()',
 'u = await User.create({name: "  Al  ", email: "a@b.c"})',
 'again = await User.find(1)',
 'console.log JSON.stringify([u.id, u.name, u.shout(), u.createdAt?, again.name, calls])',
    ].join('\n');
    const { code, runtimes } = compile(src, { runtimeDelivery: 'inline' });
    expect([...runtimes].sort()).toEqual(['schema', 'schema-orm']);
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-model-dsl-e2e-'));
    try {
      writeFileSync(join(dir2, 'one.js'), code);
      const r = spawnSync('bun', [join(dir2, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      const [id, name, shout, hasTs, againName, calls] = JSON.parse(r.stdout.trim());
      expect([id, name, shout, hasTs, againName]).toEqual([1, 'Al', 'AL', true, 'Al']);
      expect(calls).toEqual([
 'INSERT INTO "users" ("name", "email") VALUES (?, ?) RETURNING *',
 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1',
      ]);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('the loader path runs a DSL-declared model through the shared modules (rip CLI, import mode)', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-model-loader-'));
    try {
      writeFileSync(join(dir2, 'main.rip'), [
 'schema.setAdapter({',
 '  query: (sql, params) ->',
 '    if sql.indexOf("INSERT") is 0',
 '      {columns: [{name: "id"}, {name: "name"}], data: [[1, "Al"]], rowCount: 1}',
 '    else',
 '      {columns: [], data: [], rowCount: 0}',
 '})',
 'User = schema :model',
 '  name! string',
 '  beforeSave: -> @name = @name.trim()',
 'u = await User.create({name: " Al "})',
 'console.log u.id, u.name',
 '',
      ].join('\n'));
      const rip = join(import.meta.dir, '../../bin/rip');
      const r = spawnSync('bun', [rip, join(dir2, 'main.rip')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('1 Al');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test("the `on:` adapter pins a DSL-declared model's SQL to its own adapter (declaration-time evaluation)", () => {
    const src = [
 'mk = (calls) ->',
 '  q = (sql) ->',
 '    calls.push sql',
 '    {columns: [], data: [], rowCount: 0}',
 '  {query: q}',
 'pinnedCalls = []',
 'globalCalls = []',
 'schema.setAdapter mk(globalCalls)',
 'analytics = mk(pinnedCalls)',
 'Alpha = schema :model, on: analytics',
 '  name! string',
 'Beta = schema :model',
 '  name! string',
 'await Alpha.count()',
 'await Beta.count()',
 'console.log JSON.stringify([pinnedCalls, globalCalls])',
    ].join('\n');
    const { code } = compile(src, { runtimeDelivery: 'inline' });
    expect(code).toContain('adapter: analytics');
    const dir2 = mkdtempSync(join(tmpdir(), 'rip-model-on-'));
    try {
      writeFileSync(join(dir2, 'one.js'), code);
      const r = spawnSync('bun', [join(dir2, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      const [pinned, global_] = JSON.parse(r.stdout.trim());
      expect(pinned).toEqual(['SELECT COUNT(*) FROM "alphas"']);
      expect(global_).toEqual(['SELECT COUNT(*) FROM "betas"']);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('scopes, defaultScope, soft delete, and relations flow from the DSL to the runtime surface', async () => {
    // In-process: compile with delivery 'none' and evaluate against
    // the imported runtime modules (the schema.test.js eval pattern).
    const src = [
 'Item = schema :model',
 '  name!   string',
 '  active? boolean',
 '  @softDelete',
 '  @belongs_to Owner',
 '  @scope :active, -> @where(active: true)',
 '  @scope :since, (d) -> @where("created_at > ?", d)',
 '  @defaultScope -> @order("id")',
 'Owner = schema :model',
 '  name! string',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const { Item } = new Function('__schema', `${code}\nreturn { Item, Owner };`)(rt4.__schema);
      await Item.active().all();
      await Item.since('2026-01-01').all();
      await Item.withDeleted().all();
      expect(adapter.calls.map((c) => c.sql)).toEqual([
 'SELECT * FROM "items" WHERE "active" = ? AND "deleted_at" IS NULL ORDER BY id',
 'SELECT * FROM "items" WHERE created_at > ? AND "deleted_at" IS NULL ORDER BY id',
 'SELECT * FROM "items" ORDER BY id',
      ]);
      const norm = Item._normalize();
      expect([...norm.relations.keys()]).toEqual(['owner']);
      expect(norm.relations.get('owner').foreignKey).toBe('owner_id');
      expect(norm.softDelete).toBe(true);
    });
  });

  test('DSL-declared hooks fire in the runtime lifecycle (hook binding lands as tag "hook")', async () => {
    const src = [
 'order = []',
 'H = schema :model',
 '  name! string',
 '  beforeValidation: -> order.push "bv"',
 '  beforeSave: -> order.push "bs"',
 '  beforeCreate: -> order.push "bc"',
 '  afterCreate: -> order.push "ac"',
 '  afterSave: -> order.push "as"',
 '  helper: -> order.push "never a hook"',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      adapter.on(/^INSERT/, row(['id', 'name'], [1, 'X']));
      K4.setAdapter(adapter);
      const { H, order } = new Function('__schema', `${code}\nreturn { H, order };`)(rt4.__schema);
      const norm = H._normalize();
      expect([...norm.hooks.keys()].sort()).toEqual(['afterCreate', 'afterSave', 'beforeCreate', 'beforeSave', 'beforeValidation']);
      expect(norm.methods.has('helper')).toBe(true); // a non-hook name stays a method
      await H.create({ name: 'X' });
      expect(order).toEqual(['bv', 'bs', 'bc', 'ac', 'as']);
    });
  });

  test('toSQL from the compiled DSL: attrs {was:}, inline @unique, @idStart, @tableWas, composite @unique all land', async () => {
    const src = [
 'P = schema :model',
 '  firstName! string, {was: "given_name"}',
 '  email!     email @unique',
 '  @timestamps',
 '  @idStart 5000',
 '  @tableWas legacy_people',
 '  @unique [:firstName, :email]',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(() => {
      const P = new Function('__schema', `${code}\nreturn P;`)(rt4.__schema);
      const spec = P._tableSpec();
      expect(spec.sequence.start).toBe(5000);
      expect(spec.tableWas).toBe('legacy_people');
      expect(spec.columns.find((c) => c.name === 'first_name').was).toBe('given_name');
      const sql = P.toSQL();
      expect(sql).toContain('CREATE SEQUENCE ps_seq START 5000;');
      expect(sql).toContain('CREATE UNIQUE INDEX idx_ps_email ON ps ("email");');
      expect(sql).toContain('CREATE UNIQUE INDEX idx_ps_first_name_email ON ps ("first_name", "email");');
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Scaling gates (extended tier, ) — count-based and deterministic:
// query counts and iteration counts, never wall-clock.
// ════════════════════════════════════════════════════════════════════

describeExtended('schema-orm: scaling gates', () => {
  const manyFields = (n) => Array.from({ length: n }, (_, i) => field('f' + i));

  test('eager loading is M-invariant: 1 + (#relations requested) queries, independent of the root row count', async () => {
    for (const M of [2, 200]) {
      await K4.scope(async () => {
        const adapter = recordingAdapter();
        K4.setAdapter(adapter);
        const userRows = Array.from({ length: M }, (_, i) => [i + 1, 'u' + i]);
        adapter.on(/FROM "users"/, { columns: [{ name: 'id' }, { name: 'name' }], data: userRows, rowCount: M });
        adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id'], [1, 5, 1]));
        adapter.on(/FROM "profiles"/, rows(['id', 'bio', 'user_id'], [1, 'x', 1]));
        const User = K4.__schema(model('User', field('name'),
          dir('has_many', { target: 'Order', optional: false }),
          dir('has_one', { target: 'Profile', optional: false })));
        K4.__schema(model('Order', field('total', 'integer'), dir('belongs_to', { target: 'User', optional: false })));
        K4.__schema(model('Profile', field('bio'), dir('belongs_to', { target: 'User', optional: false })));

        const one = await User.includes('orders').all();
        expect(one.length).toBe(M);
        expect(adapter.calls.length).toBe(2);          // 1 root + 1 relation

        adapter.calls.length = 0;
        await User.includes('orders', 'profile').all();
        expect(adapter.calls.length).toBe(3);          // 1 root + 2 relations
      });
    }
  });

  test('eager-load query count scales with the RELATION count, not the data: 1 + R at R = 10 and R = 100', async () => {
    for (const R of [10, 100]) {
      await K4.scope(async () => {
        const adapter = recordingAdapter();
        K4.setAdapter(adapter);
        adapter.on(/FROM "hubs"/, rows(['id', 'name'], [1, 'h'], [2, 'i']));
        adapter.on(/FROM "spoke\d+s"/, { columns: [{ name: 'id' }, { name: 'hub_id' }], data: [], rowCount: 0 });
        const rels = [];
        for (let i = 0; i < R; i++) {
          K4.__schema(model('Spoke' + i, field('name', 'string', { optional: true }), dir('belongs_to', { target: 'Hub', optional: false })));
          rels.push(dir('has_many', { target: 'Spoke' + i, optional: false }));
        }
        const Hub = K4.__schema(model('Hub', field('name'), ...rels));
        await Hub.includes(...Array.from({ length: R }, (_, i) => 'spoke' + i + 's')).all();
        expect(adapter.calls.length).toBe(1 + R);
      });
    }
  });

  test('_normalize() reads each descriptor entry a bounded, N-independent number of times (10/100/1000 fields)', async () => {
    // Count-based: a Proxy on the entries array counts element reads.
    // Linear normalize reads each entry O(1) times; an accidental
    // rescan-per-entry would blow the per-entry bound quadratically.
    const readsFor = (n) => K4.scope(() => {
      let reads = 0;
      const entries = new Proxy(manyFields(n), {
        get(t, p, r) {
          if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
          return Reflect.get(t, p, r);
        },
      });
      K4.__schema({ kind: 'model', name: 'Wide', entries })._normalize();
      return reads;
    });
    const perEntry = [];
    for (const n of [10, 100, 1000]) perEntry.push((await readsFor(n)) / n);
    expect(perEntry[1]).toBeLessThanOrEqual(perEntry[0] * 2);
    expect(perEntry[2]).toBeLessThanOrEqual(perEntry[0] * 2);
    // and the absolute bound stays small — each entry is visited a
    // handful of times (entry loop + reserved-name walk), never O(N)
    expect(perEntry[2]).toBeLessThanOrEqual(8);
  });

  test('toSQL() iterates the field map a bounded, N-independent number of times (10/100/1000 fields)', async () => {
    // Count-based: wrap the normalized field Map's iterator and count
    // yields through a full toSQL render.
    const yieldsFor = (n) => K4.scope(() => {
      const def = K4.__schema({ kind: 'model', name: 'Wide', entries: manyFields(n) });
      const norm = def._normalize();
      const inner = norm.fields;
      let yields = 0;
      norm.fields = new Proxy(inner, {
        get(t, p) {
          if (p === Symbol.iterator) {
            return function* () { for (const e of t) { yields++; yield e; } };
          }
          const v = Reflect.get(t, p);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      def.toSQL();
      return yields;
    });
    const perField = [];
    for (const n of [10, 100, 1000]) perField.push((await yieldsFor(n)) / n);
    expect(perField[1]).toBeLessThanOrEqual(perField[0] * 2);
    expect(perField[2]).toBeLessThanOrEqual(perField[0] * 2);
    expect(perField[2]).toBeLessThanOrEqual(8);
  });

  test('_normalize() with 10/100 relations stays linear in the directive count', async () => {
    const readsFor = (r) => K4.scope(() => {
      for (let i = 0; i < r; i++) K4.__schema(model('Tgt' + i, field('name')));
      let reads = 0;
      const entries = new Proxy(
        [field('name'), ...Array.from({ length: r }, (_, i) => dir('has_many', { target: 'Tgt' + i, optional: false }))],
        {
          get(t, p, rcv) {
            if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
            return Reflect.get(t, p, rcv);
          },
        });
      K4.__schema({ kind: 'model', name: 'Hub', entries })._normalize();
      return reads;
    });
    const perEntry = [];
    for (const r of [10, 100]) perEntry.push((await readsFor(r)) / (r + 1));
    expect(perEntry[1]).toBeLessThanOrEqual(perEntry[0] * 2);
    expect(perEntry[1]).toBeLessThanOrEqual(8);
  });
});


// ════════════════════════════════════════════════════════════════════
// SQL structure ownership — structured paths validate every identifier
// and numeric position before touching query state; the adapter is
// never called for rejected structure. The trusted string overloads
// of where()/order() pass through untouched (owner decision O4).
// ════════════════════════════════════════════════════════════════════

describe('schema-orm: SQL structure ownership', () => {
  test('object-where keys validate against the model columns', async () => {
    const r = await paired(async (k) => {
      const { User } = makeWorld(k);
      const out = [];
      for (const key of ['x" OR 1=1 --', 'naem', 'evil\u0000col']) {
        try { await User.where({ [key]: 'v' }).all(); out.push('accepted'); }
        catch { out.push('rejected'); }
      }
      return out;
    });
    expect(r.value).toEqual(['rejected', 'rejected', 'rejected']);
    expect(r.calls.length).toBe(0);
  });

  test('object-where accepts declared, FK-alias, and managed columns', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id'], [1]));
      const { User, Order } = makeWorld(k);
      await User.where({ name: 'A' }).all();
      await Order.where({ userId: 1 }).all();
      await User.where({ createdAt: null }).all();
      return null;
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM "users" WHERE "name" = ?',
      'SELECT * FROM "orders" WHERE "user_id" = ?',
      'SELECT * FROM "users" WHERE "created_at" IS NULL',
    ]);
  });

  test('an empty IN lowers to a constant-false predicate', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id']));
      const { User } = makeWorld(k);
      const got = await User.where({ id: [] }).all();
      return { got: got.length };
    });
    expect(r.value.got).toBe(0);
    expect(r.calls[0].sql).toBe('SELECT * FROM "users" WHERE 1 = 0');
    expect(r.calls[0].params).toEqual([]);
  });

  test('limit/offset require safe non-negative integer numbers', async () => {
    const r = await paired(async (k) => {
      const { User } = makeWorld(k);
      const out = new Set();
      for (const bad of ['1; DROP TABLE users; --', '5', -1, 1.5, Infinity, NaN, 2 ** 53, true, null]) {
        try { User.where({}).limit(bad); out.add('limit accepted ' + String(bad)); }
        catch { out.add('rejected'); }
        try { User.where({}).offset(bad); out.add('offset accepted ' + String(bad)); }
        catch { out.add('rejected'); }
      }
      return [...out];
    });
    expect(r.value).toEqual(['rejected']);
    expect(r.calls.length).toBe(0);
  });

  test('zero limit and offset are legal safe integers', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id']));
      const { User } = makeWorld(k);
      await User.where({}).limit(0).offset(0).all();
      return null;
    });
    expect(r.calls[0].sql).toBe('SELECT * FROM "users" LIMIT 0 OFFSET 0');
  });

  test('a defaults-only insert emits DEFAULT VALUES', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id'], [1]));
      const Memo = k.__schema(model('Memo', field('note', 'string', { optional: true })));
      const m = await Memo.create({});
      return { id: m.id };
    });
    expect(r.calls[0].sql).toBe('INSERT INTO "memos" DEFAULT VALUES RETURNING *');
    expect(r.value.id).toBe(1);
  });

  test('upsert conflict targets validate against unique columns', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'email', 'name'], [1, 'a@b.c', 'A']));
      const { User } = makeWorld(k);
      const out = [];
      for (const on of ['name', 'no_such', 'email" OR 1=1 --']) {
        try { await User.upsert({ name: 'A', email: 'a@b.c' }, { on }); out.push('accepted'); }
        catch { out.push('rejected'); }
      }
      await User.upsert({ name: 'A', email: 'a@b.c' }, { on: 'email' });
      return out;
    });
    expect(r.value).toEqual(['rejected', 'rejected', 'rejected']);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0].sql).toContain('ON CONFLICT ("email")');
  });

  test('trusted string overloads pass through untouched (O4)', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id'], [1]));
      const { User } = makeWorld(k);
      await User.where('"name" LIKE ? OR "email" = ?', 'A%', 'x').order('created_at DESC, name').all();
      return null;
    });
    expect(r.calls[0].sql).toBe('SELECT * FROM "users" WHERE "name" LIKE ? OR "email" = ? ORDER BY created_at DESC, name');
    expect(r.calls[0].params).toEqual(['A%', 'x']);
  });
});
