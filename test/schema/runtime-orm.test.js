// The persistence runtime — src/runtime/orm.js is
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
import { test, expect, describe, beforeEach } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit, _runtimeTable } from '../../src/emitter.js';
import { readFileSync } from 'node:fs';
import { Mappings } from '../../src/stores.js';
import { describeExtended } from '../support/extended.js';
import { recordingAdapter, row, rows } from '../support/recording-adapter.js';

const rt4 = await import('../../src/runtime/schema.js');
const orm4 = await import('../../src/runtime/orm.js');

// ── kits: one uniform handle per runtime ─────────────────────────────

const K4 = {
  name: 'rip',
  __schema: rt4.__schema,
  SchemaError: rt4.SchemaError,
  setAdapter: orm4.__schemaSetAdapter,
  transaction: orm4.transaction,
  scope: (fn) => rt4.SchemaRegistry.scope(fn),
};

// ── descriptor builders (the hand-built shape both runtimes read) ────

const field = (name, typeName = 'string', opts = {}) => ({
  tag: 'field', name,
  modifiers: opts.optional ? ['?'] : ['!'],
  typeName,
  array: opts.array === true,
  ...(opts.unique ? { unique: true } : {}),
  ...(opts.primary ? { primary: true } : {}),
  ...(opts.attrs ? { attrs: opts.attrs } : {}),
  ...(opts.literals ? { literals: opts.literals } : {}),
  ...(opts.constraints ? { constraints: opts.constraints } : {}),
  ...(opts.coerce ? { coerce: true } : {}),
  ...(opts.coercer ? { coerce: true, coercer: opts.coercer } : {}),
  ...(opts.transform ? { transform: opts.transform } : {}),
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

const update = (r) => r.calls.find((c) => c.sql.startsWith('UPDATE'));

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
// hasMany Order), Order (belongsTo User, optional belongsTo
// Coupon), Coupon.
function makeWorld(k) {
  const User = k.__schema(model('User',
    field('name'),
    field('email', 'email', { unique: true }),
    dir('times'),
    dir('hasMany', { target: 'Order', optional: false }),
  ));
  const Order = k.__schema(model('Order',
    field('total', 'integer'),
    dir('belongsTo', { target: 'User', optional: false }),
    dir('belongsTo', { target: 'Coupon', optional: true }),
  ));
  const Coupon = k.__schema(model('Coupon', field('code')));
  return { User, Order, Coupon };
}

// ════════════════════════════════════════════════════════════════════
// The paired reference tier
// ════════════════════════════════════════════════════════════════════

beforeEach(() => rt4.SchemaRegistry.reset());

describe('orm: paired reference — CRUD and the query builder', () => {
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

  // Before these landed, anything past `=` / `IN` / `IS NULL` had to go
  // through the O4 trusted-string hatch — where no identifier is
  // checked, so `.where(active: true).where('created_at > ?', c)` mixed
  // a validated field name and an unvalidated column string in one
  // chain. These cover the structured route to the same predicates.
  test('where: comparison operators render in clause order and bind alongside', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "users"/, rows(['id', 'name'], [1, 'A']));
      const { User } = makeWorld(k);
      await User.where({ createdAt: { gte: 5, lt: 9 } }).all();
      await User.where({ name: { like: 'A%' }, email: { ne: null } }).all();
      await User.where({ id: { in: [1, 2] } }).all();
      await User.where({ id: { between: [3, 7] } }).all();
      // Both empty cases have an exact constant answer, and neither may
      // emit `IN ()` — a syntax error at the database.
      await User.where({ id: { in: [] } }).all();
      await User.where({ id: { nin: [] } }).all();
      await User.where({ name: { ilike: 'a%' }, id: { ne: 4 } }).all();
      return null;
    });
    const seen = r.calls.map((c) => c.sql.replace('SELECT * FROM "users" WHERE ', ''));
    expect(seen).toEqual([
      '"created_at" >= ? AND "created_at" < ?',
      '"name" LIKE ? AND "email" IS NOT NULL',
      '"id" IN (?, ?)',
      '"id" BETWEEN ? AND ?',
      '1 = 0',
      '1 = 1',
      '"name" ILIKE ? AND "id" <> ?',
    ]);
    expect(r.calls.map((c) => c.params)).toEqual([
      [5, 9], ['A%'], [1, 2], [3, 7], [], [], ['a%', 4],
    ]);
  });

  test('where: a bad operator names itself and the known set; nothing reaches SQL', async () => {
    const r = await paired(async (k, adapter) => {
      const { User } = makeWorld(k);
      const said = [];
      const refuse = async (fn) => { try { await fn(); } catch (e) { said.push(e.message); } };
      await refuse(() => User.where({ name: { startsWith: 'A' } }).all());
      await refuse(() => User.where({ name: {} }).all());
      await refuse(() => User.where({ id: { in: 5 } }).all());
      await refuse(() => User.where({ id: { between: [1] } }).all());
      return said;
    });
    expect(r.value[0]).toMatch(/unknown where\(\) operator 'startsWith' on 'name'.*known operators: eq, ne, gt/);
    expect(r.value[1]).toMatch(/empty operator object/);
    expect(r.value[2]).toMatch(/where\(\) in on 'id' requires an array; got number/);
    expect(r.value[3]).toMatch(/between on 'id' requires a two-element/);
    expect(r.calls).toEqual([]);
  });

  // The gate is the field's declared TYPE, never the value's shape: a
  // json column stores objects, so an object written against one is the
  // document to match, not a map of operators.
  test('where: an object against a json field is a value, not operators', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "docs"/, rows(['id'], [1]));
      const Doc = k.__schema(model('Doc', field('prefs', 'json'), field('rank', 'integer')));
      await Doc.where({ prefs: { like: true, gte: 3 } }).all();
      await Doc.where({ rank: { gte: 3 } }).all();
      return null;
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM "docs" WHERE "prefs" = ?',
      'SELECT * FROM "docs" WHERE "rank" >= ?',
    ]);
    expect(r.calls[0].params).toEqual([{ like: true, gte: 3 }]);
  });

  test('order: structured forms quote and validate; the string form stays verbatim', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "users"/, rows(['id'], [1]));
      const { User } = makeWorld(k);
      await User.where({}).order({ createdAt: 'desc' }).all();
      await User.where({}).order({ name: 'asc', createdAt: 'DESC NULLS LAST' }).all();
      await User.where({}).order([{ name: 'asc' }, { id: 'desc' }]).all();
      await User.where({}).order('created_at DESC, name').all();
      const said = [];
      const refuse = async (fn) => { try { await fn(); } catch (e) { said.push(e.message); } };
      await refuse(() => User.where({}).order({ name: 'sideways' }).all());
      await refuse(() => User.where({}).order({ nope: 'asc' }).all());
      await refuse(() => User.where({}).order(7).all());
      return said;
    });
    expect(r.calls.map((c) => c.sql.replace('SELECT * FROM "users" ', ''))).toEqual([
      'ORDER BY "created_at" DESC',
      'ORDER BY "name" ASC, "created_at" DESC NULLS LAST',
      'ORDER BY "name" ASC, "id" DESC',
      'ORDER BY created_at DESC, name',
    ]);
    expect(r.value[0]).toMatch(/direction for 'name' must be one of/);
    // The rejection speaks the caller's namespace: the key as written,
    // and a property-name inventory (columns beside them where the
    // spellings differ) — never a snake_case derivation nobody wrote.
    expect(r.value[1]).toMatch(/unknown order\(\) key 'nope' — known: .*createdAt \(column created_at\)/);
    expect(r.value[2]).toMatch(/accepts a trusted SQL string, a \{field: direction\} object/);
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

  test('with: exactly-one conditions lookup — LIMIT 2, both where dialects, string pks stay with find', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "users"/, rows(['id', 'name'], [5, 'E']));
      const { User } = makeWorld(k);
      await User.with({ name: 'E' });
      await User.with('name = ?', 'E');
      await User.find('u-5');
      return null;
    });
    expect(r.calls.map((c) => ({ sql: c.sql, params: c.params }))).toEqual([
      { sql: 'SELECT * FROM "users" WHERE "name" = ? LIMIT 2', params: ['E'] },
      { sql: 'SELECT * FROM "users" WHERE name = ? LIMIT 2', params: ['E'] },
      { sql: 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1', params: ['u-5'] },
    ]);
  });

  test('with: two matches throw with keys only (no values); zero matches are a null miss', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/LIMIT 2$/, rows(['id', 'name'], [1, 'Ada'], [2, 'Ada']));
      const { User } = makeWorld(k);
      let ambiguous = null;
      try { await User.with({ name: 'Ada' }); } catch (e) { ambiguous = e.message; }
      return { ambiguous };
    });
    expect(r.value.ambiguous).toMatch(/matched more than one User for \{name\}/);
    expect(r.value.ambiguous).not.toContain('Ada');
    const miss = await paired(async (k, adapter) => {
      adapter.on(/LIMIT 2$/, { columns: [{ name: 'id' }], data: [], rowCount: 0 });
      const { User } = makeWorld(k);
      return { got: await User.with({ name: 'Zed' }) };
    });
    expect(miss.value.got).toBeNull();
  });

  test('set assigns and saves in one call; unknown keys throw before any assignment', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT INTO "users"/, row(['id', 'name', 'email', 'created_at', 'updated_at'],
        [1, 'A', 'a@b.c', '2024-01-01T00:00:00', '2024-01-01T00:00:00']));
      adapter.on(/^UPDATE "users"/, row(['id', 'name', 'email', 'created_at', 'updated_at'],
        [1, 'B', 'b@b.c', '2024-01-01T00:00:00', '2024-01-02T00:00:00']));
      const { User } = makeWorld(k);
      const u = await User.create({ name: 'A', email: 'a@b.c' });
      const back = await u.set({ name: 'B', email: 'b@b.c' });
      let bad = null;
      try { await u.set({ nope: 1 }); } catch (e) { bad = e.message; }
      let notObject = null;
      try { await u.set('name'); } catch (e) { notObject = e.message; }
      return { same: back === u, name: u.name, bad, notObject };
    });
    const update = r.calls.find((c) => c.sql.startsWith('UPDATE'));
    expect(update.sql).toContain('"name" = ?');
    expect(update.sql).toContain('"email" = ?');
    expect(r.value.same).toBe(true);
    expect(r.value.name).toBe('B');
    expect(r.value.bad).toMatch(/'nope' is not a declared field or belongsTo FK/);
    expect(r.value.notObject).toMatch(/plain object of field values/);
  });

  test('a RegExp value is a real regex match: regexp_matches, semantic flags carried', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "users"/, rows(['id', 'name'], [1, 'patel']));
      const { User } = makeWorld(k);
      await User.where({ name: /^pat/i }).all();
      await User.where({ name: /plain/gu }).all();   // g/u are JS mechanics — dropped
      await User.with({ name: /^pat/i });
      return null;
    });
    expect(r.calls.map((c) => ({ sql: c.sql, params: c.params }))).toEqual([
      { sql: 'SELECT * FROM "users" WHERE regexp_matches("name", ?, ?)', params: ['^pat', 'i'] },
      { sql: 'SELECT * FROM "users" WHERE regexp_matches("name", ?)', params: ['plain'] },
      { sql: 'SELECT * FROM "users" WHERE regexp_matches("name", ?, ?) LIMIT 2', params: ['^pat', 'i'] },
    ]);
  });

  test('find and with reject the wrong argument shapes loudly', async () => {
    await paired(async (k) => {
      const { User } = makeWorld(k);
      await expect(User.find(null)).rejects.toThrow(/find\(\) got null/);
      await expect(User.find(undefined)).rejects.toThrow(/find\(\) got undefined/);
      await expect(User.find([1, 2])).rejects.toThrow(/findMany\(ids\) is the batch lookup/);
      await expect(User.find({ name: 'E' })).rejects.toThrow(/a conditions lookup is with\(cond\)/);
      await expect(User.with(5)).rejects.toThrow(/a primary-key lookup is find\(pk\)/);
      await expect(User.with(null)).rejects.toThrow(/with\(\) got null/);
      await expect(User.with({ name: 'E' }, 7)).rejects.toThrow(/values belong inside the object/);
      return null;
    });
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

describe('orm: paired reference — dirty tracking and save', () => {
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
      const U = k.__schema(model('Stamp', field('name'), dir('times')));
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

  test('the updated_at bump binds a real Date — encoding it is the adapter\'s job', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name', 'created_at', 'updated_at'], [1, 'A', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z']));
      const U = k.__schema(model('Stamp', field('name'), dir('times')));
      const inst = await U.first();
      inst.name = 'B';
      await inst.save();
      return null;
    });
    // SET "name" = ?, "updated_at" = ? WHERE "id" = ? — the bump is params[1],
    // and it goes to the adapter as a Date, never pre-serialized. An adapter
    // over a driver that binds primitives only must encode it itself or every
    // save() of an existing row fails there (create() takes the column
    // default and so never shows it). See docs/ORM.md.
    expect(update(r).params[1]).toBeInstanceOf(Date);
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

  test('mutations marked during an awaited UPDATE remain dirty and persist on the next save', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'meta'], [1, { items: [1] }]));
      let release = null;
      let updates = 0;
      adapter.on(/^UPDATE/, () => {
        updates++;
        if (updates === 1) {
          return new Promise((resolve) => {
            release = () => resolve({ columns: [], data: [], rowCount: 1 });
          });
        }
        return { columns: [], data: [], rowCount: 1 };
      });
      const Doc = k.__schema(model('FlightDoc', field('meta', 'json')));
      const doc = await Doc.first();
      doc.meta.items.push(2);
      doc.markDirty('meta');
      const first = doc.save();
      while (release === null) await Promise.resolve();
      doc.meta.items.push(3);
      doc.markDirty('meta');
      release();
      await first;
      const dirtyAfterFirst = doc._dirty.has('meta');
      await doc.save();
      return { dirtyAfterFirst, dirtyAfterSecond: doc._dirty.has('meta') };
    });
    const updates = r.calls.filter((c) => c.sql.startsWith('UPDATE'));
    expect(updates.map((c) => c.params[0])).toEqual([
      '{"items":[1,2]}',
      '{"items":[1,2,3]}',
    ]);
    expect(r.value).toEqual({ dirtyAfterFirst: true, dirtyAfterSecond: false });
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

  test('every identity-dependent instance operation targets the hydrated PK, including reload', async () => {
    const r = await paired(async (k, adapter) => {
      let reads = 0;
      adapter.on(/^SELECT/, () => rows(
        ['id', 'name', 'deleted_at'],
        [1, reads++ === 0 ? 'A' : 'database', null]));
      const hooks = [];
      const U = k.__schema(model('Stable',
        field('name'),
        dir('softDelete'),
        hook('beforeUpdate', () => hooks.push('beforeUpdate')),
        hook('afterUpdate', () => hooks.push('afterUpdate')),
        hook('beforeDestroy', function () {
          hooks.push('beforeDestroy');
          this.id = 'hook-id';
        }),
        hook('afterDestroy', () => hooks.push('afterDestroy'))));
      const inst = await U.first();
      inst.id = 999;
      inst.name = 'B';
      await inst.save();
      await inst.destroy();
      await inst.restore();
      await inst.reload();
      inst.id = 'live-id';
      await inst.destroy({ hard: true });
      return {
        name: inst.name,
        id: inst.id,
        hooks,
        identityParams: adapter.calls
          .filter((c) => /(?:WHERE "id" = \?|SET .* WHERE "id" = \?)/.test(c.sql))
          .map((c) => c.params.at(-1)),
      };
    });
    expect(r.value.name).toBe('database');
    expect(r.value.id).toBe('hook-id');
    expect(r.value.identityParams).toEqual([1, 1, 1, 1, 1]);
    expect(r.value.hooks).toEqual([
      'beforeUpdate', 'afterUpdate',
      'beforeDestroy', 'afterDestroy',
      'beforeUpdate', 'afterUpdate',
      'beforeDestroy', 'afterDestroy',
    ]);
  });

  test('reload rejects duplicate canonical identity columns before mutating instance state', async () => {
    const r = await paired(async (k, adapter) => {
      let reads = 0;
      adapter.on(/^SELECT/, () => {
        if (reads++ === 0) return rows(['id', 'name'], [1, 'A']);
        return {
          columns: [{ name: 'id' }, { name: 'id' }, { name: 'name' }],
          data: [[1, 999, 'corrupt']],
          rowCount: 1,
        };
      });
      const U = k.__schema(model('ReloadDuplicate', field('name')));
      const inst = await U.first();
      let message = null;
      try { await inst.reload(); } catch (error) { message = error.message; }
      inst.name = 'B';
      await inst.save();
      return {
        message,
        id: inst.id,
        name: inst.name,
        updateIdentity: adapter.calls.find((c) => c.sql.startsWith('UPDATE')).params.at(-1),
      };
    });
    expect(r.value.message).toMatch(/duplicate canonical column 'id'/i);
    expect(r.value).toMatchObject({ id: 1, name: 'B', updateIdentity: 1 });
  });

  test('persisted instances with a missing or null snapshot identity reject before hooks or SQL', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'name', 'deleted_at'], [1, 'A', null]));
      const hooks = [];
      const U = k.__schema(model('Broken',
        field('name'),
        dir('softDelete'),
        hook('beforeSave', () => hooks.push('save')),
        hook('beforeDestroy', () => hooks.push('destroy')),
        hook('beforeUpdate', () => hooks.push('update'))));
      const operations = [
        (x) => { x.name = 'B'; return x.save(); },
        (x) => x.destroy(),
        (x) => x.restore(),
        (x) => x.reload(),
      ];
      const errors = [];
      for (const snapshot of [null, { id: null }]) {
        for (const operation of operations) {
          const inst = await U.first();
          inst._snapshot = snapshot;
          const before = adapter.calls.length;
          try { await operation(inst); } catch (error) {
            errors.push({
              loud: /persisted identity.*snapshot/i.test(error.message),
              extra: adapter.calls.length - before,
            });
          }
        }
      }
      return { errors, hooks };
    });
    expect(r.value.errors).toEqual(Array.from({ length: 8 }, () => ({ loud: true, extra: 0 })));
    expect(r.value.hooks).toEqual([]);
  });
});

describe('orm: paired reference — the hook lifecycle', () => {
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

describe('orm: paired reference — relations and eager loading', () => {
  test('accessor naming (belongsTo/hasOne/hasMany + pluralize), resolution SQL, nullable FK', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [7, 'Owner']));
      adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id', 'coupon_id'], [42, 100, 7, null]));
      adapter.on(/FROM "profiles"/, rows(['id', 'bio', 'person_id'], [1, 'hi', 7]));
      const Person = k.__schema(model('Person',
        field('name'),
        dir('hasMany', { target: 'Order', optional: false }),
        dir('hasOne', { target: 'Profile', optional: false }),
      ));
      k.__schema(model('Profile', field('bio'), dir('belongsTo', { target: 'Person', optional: false })));
      const { Order } = ((kk) => ({
        Order: kk.__schema(model('Order',
          field('total', 'integer'),
          dir('belongsTo', { target: 'User', optional: false }),
          dir('belongsTo', { target: 'Coupon', optional: true }),
        )),
      }))(k);
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Order', optional: false })));
      k.__schema(model('Coupon', field('code')));

      const order = await Order.first();
      const owner = await order.user();
      const coupon = await order.coupon();  // null FK → no query, null
      const person = { orders: typeof Person._getClass?.().prototype.orders, profile: typeof Person._getClass?.().prototype.profile };
      return { owner: owner && owner.name, coupon, accessors: person };
    });
    expect(r.value.coupon).toBe(null);
  });

  // A belongsTo's FK column derives from its ACCESSOR (`as:` if
  // present, else the target), so `author` and `reviewer` to User
  // each own their own column with no explicit keys. An explicit
  // `foreignKey:` names the column directly and always wins.
  test('as: / foreignKey: let two relations reach one model', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users" WHERE "id" = \?/, (sql, p) =>
        rows(['id', 'name'], [p[0], p[0] === 7 ? 'Ann' : 'Bob']));
      adapter.on(/FROM "posts"/, rows(['id', 'title', 'author_id', 'reviewer_id'], [1, 'T', 7, 9]));
      k.__schema(model('User', field('name')));
      const Post = k.__schema(model('Post',
        field('title'),
        dir('belongsTo', { target: 'User', as: 'author', foreignKey: 'author_id' }),
        dir('belongsTo', { target: 'User', as: 'reviewer', foreignKey: 'reviewer_id' }),
      ));
      const n = Post._normalize();
      const post = await Post.first();
      const author = await post.author();
      const reviewer = await post.reviewer();
      return {
        accessors: [...n.relations.keys()],
        fks: [...n.relations.values()].map((x) => x.foreignKey),
        author: author && author.name,
        reviewer: reviewer && reviewer.name,
        // the camelCase of each FK column lands on the instance
        ids: [post.authorId, post.reviewerId],
      };
    });
    expect(r.value.accessors).toEqual(['author', 'reviewer']);
    expect(r.value.fks).toEqual(['author_id', 'reviewer_id']);
    expect(r.value.author).toBe('Ann');
    expect(r.value.reviewer).toBe('Bob');
    expect(r.value.ids).toEqual([7, 9]);
  });

  // Assertions live OUTSIDE the paired callback: runOn catches scenario
  // throws into out.threw, so an inner expect failure is swallowed and
  // the test goes vacuously green (this test and its natural-key twin
  // below did exactly that for a while).
  test('as: / foreignKey: reach the DDL — both columns, derived and explicit', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name')));
      const Post = k.__schema(model('Post',
        field('title'),
        dir('belongsTo', { target: 'User', as: 'author', foreignKey: 'author_id' }),
        dir('belongsTo', { target: 'User', as: 'reviewer', foreignKey: 'reviewer_id' }),
      ));
      return Post.toSQL();
    });
    expect(r.threw).toBeUndefined();
    expect(r.value).toContain('"author_id" INTEGER NOT NULL');
    expect(r.value).toContain('"reviewer_id" INTEGER NOT NULL');
    expect(r.value).not.toContain('"user_id"');
    expect(r.value).not.toContain('REFERENCES');
  });

  test('{as:} alone derives the FK from the ACCESSOR — two relations to one target, no explicit keys', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users" WHERE "id" = \?/, (sql, p) =>
        rows(['id', 'name'], [p[0], p[0] === 7 ? 'Ann' : 'Bob']));
      adapter.on(/FROM "posts"/, rows(['id', 'title', 'author_id', 'reviewer_id'], [1, 'T', 7, 9]));
      k.__schema(model('User', field('name')));
      const Post = k.__schema(model('Post',
        field('title'),
        dir('belongsTo', { target: 'User', as: 'author' }),
        dir('belongsTo', { target: 'User', as: 'reviewer' }),
      ));
      const n = Post._normalize();
      const post = await Post.first();
      const author = await post.author();
      const reviewer = await post.reviewer();
      return {
        fks: [...n.relations.values()].map((x) => x.foreignKey),
        author: author && author.name,
        reviewer: reviewer && reviewer.name,
        ids: [post.authorId, post.reviewerId],
        sql: Post.toSQL(),
      };
    });
    expect(r.value.fks).toEqual(['author_id', 'reviewer_id']);
    expect(r.value.author).toBe('Ann');
    expect(r.value.reviewer).toBe('Bob');
    expect(r.value.ids).toEqual([7, 9]);
    expect(r.value.sql).toContain('"author_id" INTEGER NOT NULL');
    expect(r.value.sql).toContain('"reviewer_id" INTEGER NOT NULL');
    expect(r.value.sql).not.toContain('"user_id"');
  });

  test('the accessor-derived FK copies a natural target key: VARCHAR width in DDL', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('Country',
        field('code'),
        dir('primary', { name: 'code' })));
      const City = k.__schema(model('City', field('name'),
        dir('belongsTo', { target: 'Country', as: 'home' })));
      return City.toSQL();
    });
    expect(r.threw).toBeUndefined();
    // The FK column is as wide as the natural key it copies — VARCHAR,
    // not the surrogate INTEGER.
    expect(r.value).toContain('"home_id" VARCHAR NOT NULL');
  });

  test('explicit {foreignKey:} still wins over the accessor derivation', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name')));
      const Post = k.__schema(model('Post', field('title'),
        dir('belongsTo', { target: 'User', as: 'author', foreignKey: 'boss_id' })));
      return { fk: Post._normalize().relations.get('author').foreignKey, sql: Post.toSQL() };
    });
    expect(r.value.fk).toBe('boss_id');
    expect(r.value.sql).toContain('"boss_id" INTEGER NOT NULL');
    expect(r.value.sql).not.toContain('"author_id"');
  });

  test('hasMany/hasOne keep the OWNER-derived key under as: — the accessor never named their column', async () => {
    const r = await paired(async (k) => {
      const User = k.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Post', as: 'authored' }),
        dir('hasOne', { target: 'Profile', as: 'bio' })));
      k.__schema(model('Post', field('title'), dir('belongsTo', { target: 'User' })));
      k.__schema(model('Profile', field('body'), dir('belongsTo', { target: 'User' })));
      return [...User._normalize().relations.values()].map((x) => [x.kind, x.accessor, x.foreignKey]);
    });
    expect(r.value).toEqual([['hasMany', 'authored', 'user_id'], ['hasOne', 'bio', 'user_id']]);
  });

  test('hasMany takes as: / foreignKey: too, and the inverse side matches', async () => {
    const r = await paired(async (k) => {
      const User = k.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Post', as: 'authored', foreignKey: 'author_id' })));
      k.__schema(model('Post', field('title'),
        dir('belongsTo', { target: 'User', as: 'author', foreignKey: 'author_id' })));
      const rel = User._normalize().relations.get('authored');
      return { accessor: [...User._normalize().relations.keys()], kind: rel.kind, fk: rel.foreignKey };
    });
    expect(r.value).toEqual({ accessor: ['authored'], kind: 'hasMany', fk: 'author_id' });
  });

  test('relation options refuse what would silently mis-map', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name')));
      const said = [];
      // Distinct names: the registry refuses to rebind one name to a
      // different definition, which is its own (correct) error.
      let n = 0;
      const refuse = (entries) => {
        try { k.__schema(model('Post' + (++n), ...entries))._normalize(); said.push('NOT CAUGHT'); }
        catch (e) { said.push(e.message); }
      };
      // two relations to one model, no overrides at all → one accessor, twice
      refuse([field('title'),
        dir('belongsTo', { target: 'User' }),
        dir('belongsTo', { target: 'User' })]);
      // the as:-derived column collides like any owned column
      refuse([field('ownerId', 'integer'),
        dir('belongsTo', { target: 'User', as: 'owner' })]);
      // an accessor that shadows a declared field
      refuse([field('author'),
        dir('belongsTo', { target: 'User', as: 'author', foreignKey: 'a_id' })]);
      refuse([field('title'), dir('belongsTo', { target: 'User', as: 'Author' })]);
      refuse([field('title'), dir('belongsTo', { target: 'User', foreignKey: 'authorID' })]);
      return said;
    });
    expect(r.value[0]).toMatch(/user collides with relation/);
    expect(r.value[1]).toMatch(/both own column 'owner_id'/);
    expect(r.value[2]).toMatch(/author collides with field/);
    expect(r.value[3]).toMatch(/'as' is a property name — canonical camelCase/);
    expect(r.value[4]).toMatch(/'foreignKey' is a column name Rip generates/);
  });


  test('includes() preloads each custom accessor separately — no N+1, no cross-talk', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [7, 'Ann'], [9, 'Bob']));
      adapter.on(/FROM "posts"/, rows(['id', 'title', 'author_id', 'reviewer_id'], [1, 'T', 7, 9]));
      k.__schema(model('User', field('name')));
      const Post = k.__schema(model('Post', field('title'),
        dir('belongsTo', { target: 'User', as: 'author', foreignKey: 'author_id' }),
        dir('belongsTo', { target: 'User', as: 'reviewer', foreignKey: 'reviewer_id' })));
      const posts = await Post.includes('author', 'reviewer').all();
      const afterPreload = adapter.calls.length;
      // Two relations to ONE model: they must preload independently,
      // each keyed off its own FK, or one would answer for both.
      const author = await posts[0].author();
      const reviewer = await posts[0].reviewer();
      return {
        sqls: adapter.calls.map((c) => c.sql),
        followUps: adapter.calls.length - afterPreload,
        author: author && author.name,
        reviewer: reviewer && reviewer.name,
      };
    });
    expect(r.value.sqls).toEqual([
      'SELECT * FROM "posts"',
      'SELECT * FROM "users" WHERE "id" IN (?)',
      'SELECT * FROM "users" WHERE "id" IN (?)',
    ]);
    expect(r.value.followUps).toBe(0);
    expect(r.value.author).toBe('Ann');
    expect(r.value.reviewer).toBe('Bob');
  });

  test('relation memoization: second call answers from cache; reload re-queries', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [7, 'Owner']));
      adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id'], [42, 100, 7]));
      k.__schema(model('User', field('name')));
      const Order = k.__schema(model('Order',
        field('total', 'integer'),
        dir('belongsTo', { target: 'User', optional: false }),
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

  test('a relation request resolved after reload returns to its caller but cannot repopulate the memo', async () => {
    const r = await paired(async (k, adapter) => {
      let orderReads = 0;
      adapter.on(/FROM "race_orders"/, () =>
        rows(['id', 'race_user_id'], [10, orderReads++ === 0 ? 1 : 2]));
      let release = null;
      adapter.on(/FROM "race_users"/, (_sql, params) => {
        if (params[0] === 1) {
          return new Promise((resolve) => {
            release = () => resolve(rows(['id', 'name'], [1, 'old']));
          });
        }
        return rows(['id', 'name'], [2, 'fresh']);
      });
      k.__schema(model('RaceUser', field('name')));
      const Order = k.__schema(model('RaceOrder',
        dir('belongsTo', { target: 'RaceUser', optional: false })));
      const order = await Order.first();
      const pending = order.raceUser();
      while (release === null) await Promise.resolve();
      await order.reload();
      release();
      const old = await pending;
      const fresh = await order.raceUser();
      return { names: [old.name, fresh.name], identity: order.raceUserId };
    });
    expect(r.value).toEqual({ names: ['old', 'fresh'], identity: 2 });
    expect(r.calls.filter((c) => c.sql.includes('FROM "race_users"')).map((c) => c.params[0]))
      .toEqual([1, 2]);
  });

  test('an eager preload resolved after reload cannot repopulate the relation memo', async () => {
    const r = await paired(async (k, adapter) => {
      let exposed = null;
      let orderReads = 0;
      adapter.on(/FROM "race_eager_orders"/, () =>
        rows(['id', 'race_eager_user_id'], [10, orderReads++ === 0 ? 1 : 2]));
      let release = null;
      let userQueries = 0;
      adapter.on(/FROM "race_eager_users"/, (_sql, params) => {
        userQueries++;
        if (params[0] === 1) {
          return new Promise((resolve) => {
            release = () => resolve(rows(['id', 'name'], [1, 'stale']));
          });
        }
        return rows(['id', 'name'], [2, 'fresh']);
      });
      k.__schema(model('RaceEagerUser', field('name')));
      const Order = k.__schema(model('RaceEagerOrder',
        dir('belongsTo', { target: 'RaceEagerUser', optional: false }),
        { tag: 'derived', name: 'exposed', fn() { exposed = this; return true; } }));
      const pending = Order.includes('raceEagerUser').all();
      while (release === null) await Promise.resolve();
      await exposed.reload();
      release();
      await pending;
      const fresh = await exposed.raceEagerUser();
      return { name: fresh.name, userQueries };
    });
    expect(r.value).toEqual({ name: 'fresh', userQueries: 2 });
  });

  test('belongsTo memos are keyed by the exact current FK, including cached null and string/number IDs', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "orders"/, rows(['id', 'user_id'], [9, 1]));
      adapter.on(/FROM "users"/, (_sql, params) => {
        if (params[0] === 1) return rows(['id', 'name'], [1, 'number']);
        if (params[0] === '1') return rows(['id', 'name'], ['1', 'string']);
        return rows(['id', 'name']);
      });
      k.__schema(model('User', field('name')));
      const Order = k.__schema(model('Order',
        dir('belongsTo', { target: 'User', optional: true })));
      const order = await Order.first();
      const number = await order.user();
      order.userId = 2;
      const missing = await order.user();
      const afterNull = adapter.calls.length;
      await order.user();
      order.userId = '1';
      const string = await order.user();
      const beforeReload = adapter.calls.length;
      await order.user({ reload: true });
      return {
        names: [number.name, missing, string.name],
        cachedNull: adapter.calls.length === beforeReload + 1 && afterNull === beforeReload - 1,
        params: adapter.calls.filter((c) => c.sql.includes('FROM "users"')).map((c) => c.params[0]),
      };
    });
    expect(r.value.names).toEqual(['number', null, 'string']);
    expect(r.value.cachedNull).toBe(true);
    expect(r.value.params).toEqual([1, 2, '1', '1']);
  });

  test('inverse relation memos use stable persisted identity; eager loads and reload rewrite that memo', async () => {
    const r = await paired(async (k, adapter) => {
      let rootReads = 0;
      adapter.on(/FROM "users"/, () => rows(['id', 'name'], [7, rootReads++ ? 'reloaded' : 'A']));
      let relationReads = 0;
      adapter.on(/FROM "orders"/, (_sql, params) => {
        relationReads++;
        return rows(['id', 'user_id'], [40 + relationReads, params[0]]);
      });
      const User = k.__schema(model('User',
        field('name'),
        dir('hasMany', { target: 'Order', optional: false })));
      k.__schema(model('Order', dir('belongsTo', { target: 'User', optional: false })));
      const user = (await User.includes('orders').all())[0];
      const eager = await user.orders();
      user.id = 999;
      const stable = await user.orders();
      await user.reload();
      const refreshed = await user.orders();
      return {
        ids: [eager[0].id, stable[0].id, refreshed[0].id],
        relationParams: adapter.calls
          .filter((c) => c.sql.includes('FROM "orders"'))
          .map((c) => c.params[0]),
      };
    });
    expect(r.value.ids).toEqual([41, 41, 42]);
    expect(r.value.relationParams).toEqual([7, 7]);
  });

  test('inverse relation null and empty-array results are cached by identity', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id'], [7]));
      adapter.on(/FROM "(profiles|orders)"/, rows(['id', 'user_id']));
      const User = k.__schema(model('User',
        dir('hasOne', { target: 'Profile', optional: true }),
        dir('hasMany', { target: 'Order', optional: false })));
      k.__schema(model('Profile', dir('belongsTo', { target: 'User', optional: false })));
      k.__schema(model('Order', dir('belongsTo', { target: 'User', optional: false })));
      const user = await User.first();
      const first = [await user.profile(), await user.orders()];
      const afterFirst = adapter.calls.length;
      const second = [await user.profile(), await user.orders()];
      const afterSecond = adapter.calls.length;
      await user.profile({ reload: true });
      await user.orders({ reload: true });
      return {
        values: [first[0], first[1].length, second[0], second[1].length],
        cached: afterSecond === afterFirst,
        reloads: adapter.calls.length - afterSecond,
      };
    });
    expect(r.value).toEqual({
      values: [null, 0, null, 0],
      cached: true,
      reloads: 2,
    });
  });

  test('.includes preloads with one batched query per relation (no N+1); unknown relation is loud', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/FROM "users"/, rows(['id', 'name'], [1, 'A'], [2, 'B']));
      adapter.on(/FROM "orders"/, rows(['id', 'total', 'user_id'], [10, 5, 1], [11, 6, 1], [12, 7, 2]));
      const User = k.__schema(model('User', field('name'), dir('hasMany', { target: 'Order', optional: false })));
      k.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
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

describe('orm: paired reference — scopes', () => {
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

describe('orm: paired reference — soft delete', () => {
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

  // DuckDB answers a bulk mutation with a one-row `Count` result set, so
  // the envelope's own rowCount is 1 for every one of them — including a
  // statement that matched nothing. Both bulk paths reported "1 row
  // changed" whatever actually happened.
  test('bulk mutations report the rows DuckDB actually changed', async () => {
    const counted = (n) => ({ columns: [{ name: 'Count', duckdbType: 'BIGINT' }], data: [[n]], rowCount: 1 });
    const r = await paired(async (k, adapter) => {
      const U = k.__schema(model('Plain', field('body')));
      adapter.on(/^UPDATE/, counted(3));
      const updated = await U.where({ body: 'x' }).updateAll({ body: 'y' });
      adapter.on(/^DELETE/, counted(0));
      const deleted = await U.where({ body: 'gone' }).deleteAll();
      return { updated, deleted };
    });
    expect(r.value).toEqual({ updated: 3, deleted: 0 });
  });

  // DuckDB has no `DELETE ... LIMIT`; these clauses were assembled for a
  // SELECT and dropped here, so scoping a bulk mutation to one row
  // mutated every matching row instead.
  test('a bulk mutation refuses a scope DuckDB cannot honor', async () => {
    const r = await paired(async (k, adapter) => {
      const U = k.__schema(model('Plain', field('body')));
      const refused = [];
      for (const thunk of [
        () => U.where({ body: 'x' }).limit(1).updateAll({ body: 'y' }),
        () => U.where({ body: 'x' }).limit(1).deleteAll(),
        () => U.where({ body: 'x' }).offset(2).deleteAll(),
        () => U.where({ body: 'x' }).order('id').deleteAll(),
      ]) {
        try { await thunk(); refused.push(null); }
        catch (e) { refused.push(e.message.slice(0, 40)); }
      }
      return refused;
    });
    expect(r.value.every((m) => m && /cannot honor/.test(m))).toBe(true);
    // Nothing reached the database.
    expect(r.calls.length).toBe(0);
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

describe('orm: paired reference — upsert and insertMany', () => {
  test('upsert: ON CONFLICT DO UPDATE with EXCLUDED sets; timestamps ride; missing target is loud', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'name', 'email'], [1, 'Al', 'a@b.c']));
      const hooks = [];
      // The conflict target must be a column a conflict can arise on —
      // a real database rejects ON CONFLICT over a non-unique column.
      const U = k.__schema(model('User',
        field('name'),
        field('email', 'email', { unique: true }),
        dir('times'),
        hook('afterSave', () => hooks.push('afterSave')),
        hook('afterCommit', () => hooks.push('afterCommit'))));
      const written = await U.upsert({ email: 'a@b.c', name: 'Al' }, { on: 'email' });
      let missing = null;
      try { await U.upsert({ email: 'a@b.c' }); } catch (e) { missing = 'threw'; }
      return { missing, hooks, persisted: written._persisted, saved: written.savedChanges };
    });
    expect(r.calls[0].sql).toBe(
 'INSERT INTO "users" ("name", "email") VALUES (?, ?) ON CONFLICT ("email") ' +
 'DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = timezone(\'UTC\', now()) RETURNING *');
    expect(r.value.hooks).toEqual(['afterSave', 'afterCommit']);
    expect(r.value.persisted).toBe(true);
    expect([...r.value.saved]).toEqual([]);
  });

  test('DO NOTHING upsert resolves the authoritative row by canonical serialized composite targets', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, rows([]));
      adapter.on(/^SELECT/, rows(
        ['id', 'when', 'meta', 'state', 'note'],
        [8, new Date('2026-02-03'), '{"a":1}', 7, 'database']));
      k.__schema({
        kind: 'enum', name: 'UpsertState', entries: [
          { tag: 'enum-member', name: 'ready', value: 7 },
        ],
      });
      const hooks = [];
      const U = k.__schema(model('Composite',
        field('when', 'date'),
        field('meta', 'json'),
        field('state', 'UpsertState'),
        field('note', 'string', { optional: true }),
        dir('unique', { fields: ['when', 'meta', 'state'] }),
        hook('beforeValidation', () => hooks.push('beforeValidation')),
        hook('afterValidation', () => hooks.push('afterValidation')),
        hook('beforeSave', () => hooks.push('beforeSave')),
        hook('afterSave', () => hooks.push('afterSave')),
        hook('afterCommit', () => hooks.push('afterCommit'))));
      const inst = await U.upsert({
        when: '2026-02-03', meta: { a: 1 }, state: 'ready',
      }, { on: ['when', 'meta', 'state'] });
      const upsertHooks = [...hooks];
      const before = adapter.calls.length;
      await inst.save();
      return {
        fields: { id: inst.id, note: inst.note },
        persisted: inst._persisted,
        saved: inst.savedChanges,
        upsertHooks,
        saveHooks: hooks.slice(upsertHooks.length),
        noOp: adapter.calls.length === before,
      };
    });
    expect(r.calls[1].sql).toBe(
      'SELECT * FROM "composites" WHERE "when" = ? AND "meta" = ? AND "state" = ?');
    expect(r.calls[1].params[0]).toBeInstanceOf(Date);
    expect(r.calls[1].params.slice(1)).toEqual(['{"a":1}', 7]);
    expect(r.value).toMatchObject({
      fields: { id: 8, note: 'database' },
      persisted: true,
      upsertHooks: ['beforeValidation', 'afterValidation', 'beforeSave'],
      saveHooks: [
        'beforeValidation', 'afterValidation', 'beforeSave', 'afterSave', 'afterCommit',
      ],
      noOp: true,
    });
    expect([...r.value.saved]).toEqual([]);
  });

  test('DO NOTHING lookup stays on the ambient transaction and rejects zero or multiple rows', async () => {
    const transaction = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, rows([]));
      adapter.on(/^SELECT/, rows(['id', 'email'], [3, 'a@b.co']));
      const U = k.__schema(model('TxUpsert', field('email', 'email', { unique: true })));
      const inst = await k.transaction(() => U.upsert({ email: 'a@b.co' }, { on: 'email' }));
      return { id: inst.id };
    });
    expect(transaction.value.id).toBe(3);
    expect(transaction.calls.filter((c) => /^(INSERT|SELECT)/.test(c.sql)).map((c) => c.tx)).toEqual([true, true]);

    for (const answer of [rows(['id', 'email']), rows(['id', 'email'], [1, 'a@b.co'], [2, 'a@b.co'])]) {
      const r = await paired(async (k, adapter) => {
        adapter.on(/^INSERT/, rows([]));
        adapter.on(/^SELECT/, answer);
        const U = k.__schema(model('RaceUpsert', field('email', 'email', { unique: true })));
        await U.upsert({ email: 'a@b.co' }, { on: 'email' });
        return {};
      });
      expect(r.threw).toEqual({ error: true });
      expect(r.calls.length).toBe(2);
    }
  });

  test('upsert requires one exact declared unique tuple before hooks or SQL; tuple order is canonical', async () => {
    const rejected = await paired(async (k) => {
      const hooks = [];
      const U = k.__schema(model('Targeted',
        field('email', 'email', { optional: true, unique: true }),
        field('tenant', 'string', { optional: true }),
        field('slug', 'string', { optional: true }),
        dir('unique', { fields: ['tenant', 'slug'] }),
        hook('beforeValidation', () => hooks.push('beforeValidation'))));
      const outcomes = [];
      for (const [data, on] of [
        [{ tenant: 'x' }, 'email'],
        [{ email: null, tenant: 'x' }, 'email'],
        [{ email: 'a@b.co', tenant: 'x' }, ['email', 'email']],
        [{ tenant: 'x', slug: 's' }, 'tenant'],
        [{ email: 'a@b.co', tenant: 'x' }, ['email', 'tenant']],
        [{ email: 'a@b.co', tenant: 'x', slug: 's' }, ['email', 'tenant', 'slug']],
      ]) {
        try { await U.upsert(data, { on }); } catch (error) {
          outcomes.push(/conflict target/i.test(error.message));
        }
      }
      return { outcomes, hooks };
    });
    expect(rejected.value.outcomes).toEqual([true, true, true, true, true, true]);
    // Missing/null values belong to input validation; malformed tuple
    // shapes (duplicate, partial, superset, mixed) reject before hooks.
    expect(rejected.value.hooks).toEqual(['beforeValidation', 'beforeValidation']);
    expect(rejected.calls).toEqual([]);

    const ordered = await paired(async (k, adapter) => {
      adapter.on(/^INSERT/, row(['id', 'tenant', 'slug'], [4, 'x', 's']));
      const U = k.__schema(model('OrderedTarget',
        field('tenant'),
        field('slug'),
        dir('unique', { fields: ['tenant', 'slug'] })));
      return await U.upsert({ tenant: 'x', slug: 's' }, { on: ['slug', 'tenant'] });
    });
    expect(ordered.calls[0].sql).toContain('ON CONFLICT ("slug", "tenant") DO NOTHING');
    expect(ordered.value.id).toBe(4);
  });

  test('unique/index declarations reject duplicate canonical columns before upsert planning', async () => {
    const r = await paired(async (k) => {
      const outcomes = [];
      for (const fields of [
        ['tenant', 'tenant'],
        ['firstName', 'first_name'],
      ]) {
        try {
          const M = k.__schema(model('DuplicateTuple' + outcomes.length,
            field('tenant', 'string', { optional: true }),
            field('firstName', 'string', { optional: true }),
            dir('unique', { fields })));
          M._normalize();
          outcomes.push('accepted');
        } catch (error) {
          outcomes.push(/distinct/i.test(error.message));
        }
      }
      return outcomes;
    });
    expect(r.value).toEqual([true, true]);
    expect(r.calls).toEqual([]);
  });

  test('upsert RETURNING accepts one valid row only; failures precede completion hooks', async () => {
    for (const [data, answer] of [
      [
        { email: 'a@b.co', name: 'A' },
        rows(['id', 'email', 'name']),
      ],
      [
        { email: 'a@b.co', name: 'A' },
        rows(['id', 'email', 'name'], [1, 'a@b.co', 'A'], [2, 'a@b.co', 'A']),
      ],
      [
        { email: 'a@b.co' },
        rows(['id', 'email'], [1, 'a@b.co'], [2, 'a@b.co']),
      ],
      [
        { email: 'a@b.co', name: 'A' },
        { columns: null, data: [[1, 'a@b.co', 'A']], rowCount: 1 },
      ],
    ]) {
      const r = await paired(async (k, adapter) => {
        const hooks = [];
        adapter.on(/^INSERT/, answer);
        const U = k.__schema(model('ReturningUpsert',
          field('email', 'email', { unique: true }),
          field('name', 'string', { optional: true }),
          hook('afterSave', () => hooks.push('afterSave')),
          hook('afterCommit', () => hooks.push('afterCommit'))));
        try {
          await U.upsert(data, { on: 'email' });
        } catch {
          return { hooks };
        }
        return { accepted: true, hooks };
      });
      expect(r.value).toEqual({ hooks: [] });
      expect(r.calls.length).toBe(1);
    }
  });

  test('adapter rows reject duplicate canonical columns before identity absorption', async () => {
    for (const answer of [
      {
        columns: [{ name: 'id' }, { name: 'id' }, { name: 'email' }],
        data: [[1, 999, 'a@b.co']],
        rowCount: 1,
      },
      {
        columns: [{ name: 'user_id' }, { name: 'userId' }, { name: 'email' }],
        data: [[1, 999, 'a@b.co']],
        rowCount: 1,
      },
    ]) {
      const r = await paired(async (k, adapter) => {
        const hooks = [];
        adapter.on(/^INSERT/, answer);
        const U = k.__schema(model('DuplicateColumns',
          field('email', 'email', { unique: true }),
          hook('afterSave', () => hooks.push('afterSave'))));
        try {
          await U.upsert({ email: 'a@b.co' }, { on: 'email' });
        } catch (error) {
          return { message: error.message, hooks };
        }
        return { accepted: true, hooks };
      });
      expect(r.value.message).toMatch(/duplicate canonical column/i);
      expect(r.value.hooks).toEqual([]);
    }
  });

  test('DO NOTHING lookup verifies every returned target column and serialized value', async () => {
    for (const answer of [
      rows(['id', 'email'], [3, 'wrong@b.co']),
      rows(['id', 'name'], [3, 'database']),
      {
        columns: [{ name: 'id' }, { name: 'email' }, { name: 'email' }],
        data: [[3, 'a@b.co', 'wrong@b.co']],
        rowCount: 1,
      },
    ]) {
      const r = await paired(async (k, adapter) => {
        adapter.on(/^INSERT/, rows([]));
        adapter.on(/^SELECT/, answer);
        const U = k.__schema(model('LookupTarget', field('email', 'email', { unique: true })));
        await U.upsert({ email: 'a@b.co' }, { on: 'email' });
      });
      expect(r.threw).toEqual({ error: true });
      expect(r.calls.length).toBe(2);
    }

    for (const returnedTargetValues of [
      [new Date('2026-02-04'), '{"a":1}', 7],
      [new Date('2026-02-03'), '{"a":2}', 7],
      [new Date('2026-02-03'), '{"a":1}', 8],
    ]) {
      const r = await paired(async (k, adapter) => {
        adapter.on(/^INSERT/, rows([]));
        adapter.on(/^SELECT/, rows(
          ['id', 'when', 'meta', 'state'],
          [8, ...returnedTargetValues]));
        k.__schema({
          kind: 'enum', name: 'LookupState', entries: [
            { tag: 'enum-member', name: 'ready', value: 7 },
          ],
        });
        const U = k.__schema(model('CompositeMismatch',
          field('when', 'date'),
          field('meta', 'json'),
          field('state', 'LookupState'),
          dir('unique', { fields: ['when', 'meta', 'state'] })));
        await U.upsert({
          when: '2026-02-03', meta: { a: 1 }, state: 'ready',
        }, { on: ['when', 'meta', 'state'] });
      });
      expect(r.threw).toEqual({ error: true });
      expect(r.calls.length).toBe(2);
    }
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

describe('orm: refinements guard every persistence path (R9)', () => {
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

describe('orm: defensive structured SQL and canonical persistence', () => {
  test('create/upsert/insertMany share the caller-writable key policy before hooks or SQL', async () => {
    const r = await paired(async (k, adapter) => {
      k.__schema(model('Owner', field('name')));
      const hooks = [];
      const Account = k.__schema(model('Account',
        field('firstName'),
        field('email', 'email', { unique: true }),
        dir('times'),
        dir('softDelete'),
        dir('belongsTo', { target: 'Owner', optional: false }),
        hook('beforeValidation', () => hooks.push('hook'))));
      const inputs = [
        { typo: 'x', firstName: 'Ada', email: 'a@b.co' },
        { id: 1, firstName: 'Ada', email: 'a@b.co' },
        { createdAt: 'x', firstName: 'Ada', email: 'a@b.co' },
        { created_at: 'x', firstName: 'Ada', email: 'a@b.co' },
        { updatedAt: 'x', firstName: 'Ada', email: 'a@b.co' },
        { deleted_at: 'x', firstName: 'Ada', email: 'a@b.co' },
        { firstName: 'Ada', first_name: 'Grace', email: 'a@b.co' },
        { first_name: 'Grace', firstName: 'Ada', email: 'a@b.co' },
      ];
      const apis = [
        ['create', (data) => Account.create(data)],
        ['upsert', (data) => Account.upsert(data, { on: 'email' })],
        ['insertMany', (data) => Account.insertMany([data])],
      ];
      const rejected = [];
      for (const [api, call] of apis) {
        for (const data of inputs) {
          try { await call(data); }
          catch (error) {
            rejected.push([api, error.issues?.[0]?.field, error.issues?.[0]?.error]);
          }
        }
      }
      return { rejected, hooks, calls: adapter.calls.length };
    });
    expect(r.value.rejected.length).toBe(24);
    for (const api of ['create', 'upsert', 'insertMany']) {
      const rows = r.value.rejected.filter(([name]) => name === api);
      expect(rows.map((x) => x[2])).toEqual([
        'unknown', 'pk', 'managed', 'managed', 'managed', 'managed', 'alias', 'alias',
      ]);
      expect(rows[6][1].replace(/^\[0\]\./, '')).toBe('firstName');
      expect(rows[7][1].replace(/^\[0\]\./, '')).toBe('firstName');
    }
    expect(r.value.hooks).toEqual([]);
    expect(r.value.calls).toBe(0);
  });

  test('all persistence insert APIs accept belongsTo FKs in canonical camel or snake spelling', async () => {
    const r = await paired(async (k, adapter) => {
      let id = 0;
      adapter.on(/^INSERT/, (_sql, params) =>
        row(['id', 'name', 'email', 'owner_id'], [++id, params[0], params[1], params[2]]));
      k.__schema(model('Owner', field('name')));
      const Account = k.__schema(model('Account',
        field('name'),
        field('email', 'email', { unique: true }),
        dir('belongsTo', { target: 'Owner', optional: false })));
      for (const [suffix, fk] of [['camel', { ownerId: 7 }], ['snake', { owner_id: 8 }]]) {
        await Account.create({ name: suffix, email: suffix + '1@x.co', ...fk });
        await Account.upsert({ name: suffix, email: suffix + '2@x.co', ...fk }, { on: 'email' });
        await Account.insertMany([{ name: suffix, email: suffix + '3@x.co', ...fk }]);
      }
      return adapter.calls.map((call) => ({ sql: call.sql, params: call.params }));
    });
    expect(r.value.length).toBe(6);
    expect(r.value.every((call) => call.sql.includes('"owner_id"'))).toBe(true);
    expect(r.value.map((call) => call.params[2])).toEqual([7, 7, 7, 8, 8, 8]);
  });

  test('updateAll validates writable columns before SQL; empty is a zero-row no-op', async () => {
    const r = await paired(async (k, adapter) => {
      const U = k.__schema(model('User', field('name'), dir('times')));
      const empty = await U.where({}).updateAll({});
      const rejected = [];
      for (const values of [
        { 'name" = 1; DROP TABLE users; --': 'x' },
        { 'bad\nname': 'x' },
        { typo: 'x' },
        { id: 9 },
        { updatedAt: 'x' },
      ]) {
        try { await U.where({}).updateAll(values); } catch { rejected.push(true); }
      }
      await U.where({}).updateAll({ name: 'Ada' });
      return { empty, rejected, calls: adapter.calls.length };
    });
    expect(r.value).toEqual({ empty: 0, rejected: [true, true, true, true, true], calls: 1 });
    expect(r.calls[0]).toMatchObject({
      sql: 'UPDATE "users" SET "name" = ?, "updated_at" = ?',
    });
  });

  test('order is trusted-string-only and upsert targets reject empty/coercible objects before hooks or SQL', async () => {
    const r = await paired(async (k) => {
      const ran = [];
      const U = k.__schema(model('User',
        field('email', 'email', { unique: true }),
        hook('beforeValidation', () => ran.push('hook'))));
      const rejected = [];
      for (const action of [
        () => U.where({}).order({ toString: () => 'email' }).all(),
        () => U.upsert({ email: 'a@b.co' }, { on: [] }),
        () => U.upsert({ email: 'a@b.co' }, { on: { toString: () => 'email' } }),
      ]) {
        try { await action(); } catch { rejected.push(true); }
      }
      return { rejected, ran };
    });
    expect(r.value).toEqual({ rejected: [true, true, true], ran: [] });
    expect(r.calls).toEqual([]);
  });

  test('derived inverse relation keys must exist on the target before resolve or preload SQL', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "users"/, rows(['id', 'name'], [1, 'A']));
      const User = k.__schema(model('User', field('name'), dir('hasMany', { target: 'Order', optional: false })));
      k.__schema(model('Order', field('total', 'integer')));
      const u = await User.first();
      const before = adapter.calls.length;
      const rejected = [];
      try { await u.orders(); } catch { rejected.push('resolve'); }
      try { await User.includes('orders').all(); } catch { rejected.push('preload'); }
      return { rejected, extra: adapter.calls.length - before };
    });
    expect(r.value).toEqual({ rejected: ['resolve', 'preload'], extra: 0 });
    // Includes validates its whole relation tree before the root
    // query, so no adapter call occurs for an impossible preload.
    expect(r.calls.filter((c) => c.sql.includes('"user_id"')).length).toBe(0);
  });

  test('create/upsert/insertMany share transforms, coercions, defaults, dates, and normalized SQL params', async () => {
    const r = await paired(async (k, adapter) => {
      let transforms = 0;
      const entries = [
        field('name', 'string', { transform: (raw) => { transforms++; return raw.name.trim(); } }),
        field('age', 'integer', { coerce: true }),
        field('when', 'date'),
        field('role', 'string', { constraints: { default: 'reader' } }),
        field('email', 'email', { unique: true }),
      ];
      const U = k.__schema(model('User', ...entries));
      adapter.on(/^INSERT INTO "users".*ON CONFLICT/, row(
        ['id', 'name', 'age', 'when', 'role', 'email'],
        [2, 'Bob', 8, new Date('2026-01-02'), 'reader', 'b@b.co']));
      adapter.on(/^INSERT INTO "users"/, row(
        ['id', 'name', 'age', 'when', 'role', 'email'],
        [1, 'Ada', 7, new Date('2026-01-01'), 'reader', 'a@b.co']));
      await U.create({ name: ' Ada ', age: '7', when: '2026-01-01', email: 'a@b.co' });
      await U.upsert({ name: ' Bob ', age: '8', when: '2026-01-02', email: 'b@b.co' }, { on: 'email' });
      await U.insertMany([{ name: ' Cid ', age: '9', when: '2026-01-03', email: 'c@b.co' }]);
      return { transforms, params: adapter.calls.map((c) => c.params) };
    });
    expect(r.value.transforms).toBe(3);
    for (const params of r.value.params) {
      expect(params.some((v) => typeof v === 'string' && /^\s|\s$/.test(v))).toBe(false);
      expect(params.some((v) => v === '7' || v === '8' || v === '9')).toBe(false);
      expect(params.some((v) => v instanceof Date)).toBe(true);
      expect(params).toContain('reader');
    }
  });

  test('failed save stages nested async normalization atomically and runs no post hooks or SQL', async () => {
    const r = await paired(async (k, adapter) => {
      let transforms = 0;
      const Child = k.__schema({
        kind: 'shape', name: 'Child', entries: [
          field('name', 'string', { transform: (raw) => { transforms++; return raw.name.trim(); } }),
          field('n', 'integer', { coerce: true }),
          ensure('even', async (v) => v.n % 2 === 0, { async: true, field: 'n' }),
        ],
      });
      void Child;
      const ran = [];
      const U = k.__schema(model('User',
        field('child', 'Child'),
        hook('afterValidation', () => ran.push('afterValidation')),
        hook('beforeSave', () => ran.push('beforeSave'))));
      adapter.on(/^SELECT/, rows(['id', 'child'], [1, { name: 'Ada', n: 2 }]));
      const inst = await U.first();
      inst.child = { name: '  Ada  ', n: '3' };
      const before = structuredClone(inst.child);
      const calls = adapter.calls.length;
      let issue;
      try { await inst.save(); } catch (e) { issue = e.issues[0]; }
      return {
        transforms,
        before,
        after: inst.child,
        issue: [issue.field, issue.error],
        extra: adapter.calls.length - calls,
        ran,
      };
    });
    expect(r.value).toEqual({
      transforms: 0,
      before: { name: '  Ada  ', n: '3' },
      after: { name: '  Ada  ', n: '3' },
      issue: ['child.n', 'type'],
      extra: 0,
      ran: [],
    });
  });

  test('failed save runs no nested eager-derived side effect before the whole graph validates', async () => {
    const r = await paired(async (k, adapter) => {
      let derived = 0;
      k.__schema({
        kind: 'shape', name: 'Child', entries: [
          field('n', 'integer'),
          { tag: 'derived', name: 'doubled', fn() { derived++; return this.n * 2; } },
        ],
      });
      const U = k.__schema(model('User', field('child', 'Child'), field('later', 'integer')));
      adapter.on(/^SELECT/, rows(['id', 'child', 'later'], [1, { n: 1 }, 1]));
      const inst = await U.first();
      inst.child = { n: 2 };
      inst.later = 'bad';
      const before = structuredClone(inst.child);
      const calls = adapter.calls.length;
      let issue = null;
      try { await inst.save(); } catch (error) { issue = error.issues[0]; }
      return {
        derived,
        before,
        after: inst.child,
        issue: [issue.field, issue.error],
        extra: adapter.calls.length - calls,
      };
    });
    expect(r.value).toEqual({
      derived: 0,
      before: { n: 2 },
      after: { n: 2 },
      issue: ['later', 'type'],
      extra: 0,
    });
  });

  test('nested async refinements reject create/upsert/insertMany before SQL or hooks', async () => {
    const r = await paired(async (k) => {
      k.__schema({
        kind: 'shape', name: 'Child', entries: [
          field('n', 'integer'),
          ensure('even', async (v) => v.n % 2 === 0, { async: true, field: 'n' }),
        ],
      });
      const ran = [];
      const U = k.__schema(model('User',
        field('child', 'Child'),
        field('email', 'email', { unique: true }),
        hook('beforeSave', () => ran.push('beforeSave'))));
      const issues = [];
      for (const action of [
        () => U.create({ child: { n: 3 }, email: 'a@b.co' }),
        () => U.upsert({ child: { n: 3 }, email: 'a@b.co' }, { on: 'email' }),
        () => U.insertMany([{ child: { n: 3 }, email: 'a@b.co' }]),
      ]) {
        try { await action(); } catch (e) { issues.push(e.issues.map((i) => [i.field, i.error])); }
      }
      return { issues, ran };
    });
    expect(r.value).toEqual({
      issues: [
        [['child.n', 'ensure']],
        [['child.n', 'ensure']],
        [['[0].child.n', 'ensure']],
      ],
      ran: [],
    });
    expect(r.calls).toEqual([]);
  });

  test('nested enum normalization reaches persistence params and normalized nested no-op saves stay no-op', async () => {
    const r = await paired(async (k, adapter) => {
      k.__schema({
        kind: 'enum', name: 'State', entries: [
          { tag: 'enum-member', name: 'ready', value: 7 },
        ],
      });
      k.__schema({
        kind: 'shape', name: 'Child', entries: [
          field('name'),
          field('state', 'State'),
        ],
      });
      const U = k.__schema(model('User', field('child', 'Child')));
      adapter.on(/^INSERT/, row(['id', 'child'], [1, { name: 'Ada', state: 7 }]));
      await U.create({ child: { name: 'Ada', state: 'ready' } });
      adapter.on(/^SELECT/, rows(['id', 'child'], [2, { name: 'Bob', state: 7 }]));
      const loaded = await U.first();
      const before = adapter.calls.length;
      await loaded.save();
      return {
        persistedState: adapter.calls[0].params[0].state,
        noOpCalls: adapter.calls.length - before,
      };
    });
    expect(r.value).toEqual({ persistedState: 7, noOpCalls: 0 });
  });
});

describe('orm: paired reference — transactions', () => {
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

describe('orm: paired reference — DDL', () => {
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
        dir('times'),
        dir('softDelete'),
        dir('idStart', { value: 5000 }),
        dir('index', { fields: ['name'] }),
        dir('unique', { fields: ['name', 'email'] }),
        dir('belongsTo', { target: 'User', optional: false }),
        dir('belongsTo', { target: 'Coupon', optional: true }),
      ));
      return { sql: T.toSQL(), dropped: T.toSQL({ dropFirst: true, idStart: 9000 }) };
    });
    expect(r.value.sql).toContain('CREATE SEQUENCE "trades_seq" START 5000;');
    expect(r.value.sql).toContain('"name" VARCHAR(100) NOT NULL');
    expect(r.value.sql).toContain('"user_id" INTEGER NOT NULL');
    expect(r.value.sql).toContain('"coupon_id" INTEGER,');   // optional relation: nullable column, no constraint
    // single-column unique: inline constraint, no index object
    expect(r.value.sql).toMatch(/"email" [^\n]*UNIQUE/);
    expect(r.value.sql).not.toContain('idx_trades_email');
    // composite unique: still an index (the differ cannot see a composite constraint)
    expect(r.value.sql).toContain('CREATE UNIQUE INDEX "idx_trades_name_email" ON "trades" ("name", "email");');
    expect(r.value.dropped).toContain('DROP TABLE IF EXISTS "trades" CASCADE;');
    expect(r.value.dropped).toContain('START 9000');
  });

  // Single-column uniqueness renders INLINE, never as a separate index
  // object. In DuckDB an index is a catalog dependency that blocks
  // ALTER on the WHOLE table, so one unique index would freeze every
  // column against migration; an inline constraint enforces the same
  // invariant without the dependency. Composites have no such option —
  // a deployed composite CONSTRAINT is invisible to duckdb_indexes(),
  // so the differ would plan the index anyway and re-freeze the table.
  test('single-column uniqueness renders inline; composite stays an index; the pk is never doubled', async () => {
    const r = await paired(async (k) => {
      const T = k.__schema(model('Badge',
        field('code', 'string', { unique: true }),          // field-level @unique
        field('tag', 'string'),
        field('slot', 'integer'),
        dir('unique', { fields: ['tag'] }),                 // directive form, one column
        dir('unique', { fields: ['slot', 'tag'] }),         // composite
      ));
      return T.toSQL();
    });
    const sql = r.value;
    // both single-column spellings land inline, and neither leaves an index
    expect(sql).toMatch(/"code" [^\n]*UNIQUE/);
    expect(sql).toMatch(/"tag" [^\n]*UNIQUE/);
    expect(sql).not.toContain('idx_badges_code');
    expect(sql).not.toContain('idx_badges_tag ');
    // the composite is untouched
    expect(sql).toContain('CREATE UNIQUE INDEX "idx_badges_slot_tag" ON "badges" ("slot", "tag");');
    // PRIMARY KEY already implies uniqueness — never render both
    expect(sql).toContain('"id" INTEGER PRIMARY KEY');
    expect(sql).not.toMatch(/"id" [^\n]*PRIMARY KEY[^\n]*UNIQUE/);
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

  // A `{through: J}` declaration anywhere asserts J is a LINK table,
  // so J's DDL derives a unique index over the resolved (owner,
  // target) pair — the database arbitration addX's violation-handling
  // already leans on. Sorted column order; derived only when the pair
  // resolves; never doubled beside a declared @unique on the pair.
  test('a through-join model derives the unique link-pair index in its DDL', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Team', through: 'Membership' })));
      k.__schema(model('Team', field('label')));
      const M = k.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      return M.toSQL();
    });
    expect(r.value).toContain(
      'CREATE UNIQUE INDEX "idx_memberships_team_id_user_id" ON "memberships" ("team_id", "user_id");');
  });

  test('the derived link-pair index is registration-order independent', async () => {
    const userFirst = await paired(async (k) => {
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Team', through: 'Membership' })));
      k.__schema(model('Team', field('label')));
      return k.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' }))).toSQL();
    });
    const joinFirst = await paired(async (k) => {
      const M = k.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      k.__schema(model('Team', field('label')));
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Team', through: 'Membership' })));
      return M.toSQL();
    });
    expect(userFirst.value).toBe(joinFirst.value);
    expect(userFirst.value).toContain('CREATE UNIQUE INDEX "idx_memberships_team_id_user_id"');
  });

  test('a join model used as through from BOTH ends derives ONE pair index', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Team', through: 'Membership' })));
      k.__schema(model('Team', field('label'), dir('hasMany', { target: 'User', through: 'Membership' })));
      return k.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' }))).toSQL();
    });
    expect((r.value.match(/CREATE UNIQUE INDEX/g) || []).length).toBe(1);
    expect(r.value).toContain('"idx_memberships_team_id_user_id"');
  });

  test('an explicit @unique over the pair IS the index — no double emit, either column order', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Team', through: 'Membership' })));
      k.__schema(model('Team', field('label')));
      return k.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' }),
        dir('unique', { fields: ['userId', 'teamId'] }))).toSQL();
    });
    expect(r.value).toContain(
      'CREATE UNIQUE INDEX "idx_memberships_user_id_team_id" ON "memberships" ("user_id", "team_id");');
    expect(r.value).not.toContain('idx_memberships_team_id_user_id');
    expect((r.value.match(/CREATE UNIQUE INDEX/g) || []).length).toBe(1);
  });

  test('a plain @index over the link pair refuses — the through contract says unique', async () => {
    const r = await paired(async (k) => {
      k.__schema(model('User', field('name'), dir('hasMany', { target: 'Team', through: 'Membership' })));
      k.__schema(model('Team', field('label')));
      const M = k.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' }),
        dir('index', { fields: ['teamId', 'userId'] })));
      let err = null;
      try { M.toSQL(); } catch (e) { err = e; }
      return err?.message;
    });
    expect(r.value).toMatch(/link pair of a through-relation/);
    expect(r.value).toMatch(/User\.teams reads through Membership/);
    expect(r.value).toMatch(/@unique/);
  });

  test('no through user → no derived index; an unresolvable pair derives none', async () => {
    const r = await paired(async (k) => {
      // Membership-shaped, but nothing reads through it.
      const Plain = k.__schema(model('Attendance',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      k.__schema(model('User', field('name')));
      k.__schema(model('Team', field('label')));
      // A self-referential through whose single @belongsTo cannot say
      // which column is which end: the relation refuses at use; the
      // DDL simply derives nothing.
      k.__schema(model('Category', field('name'),
        dir('hasMany', { target: 'Category', as: 'children', through: 'CategoryLink' })));
      const Link = k.__schema(model('CategoryLink', dir('belongsTo', { target: 'Category' })));
      return { plain: Plain.toSQL(), link: Link.toSQL() };
    });
    expect(r.value.plain).not.toContain('CREATE UNIQUE INDEX');
    expect(r.value.link).not.toContain('CREATE UNIQUE INDEX');
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

describe('orm: paired reference — model algebra and wire shapes', () => {
  test('algebra projects over the implicit columns; the result is a :shape without ORM', async () => {
    const r = await paired(async (k) => {
      const U = k.__schema(model('User',
        field('name'),
        field('secret'),
        dir('times'),
        dir('belongsTo', { target: 'Org', optional: false }),
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
        dir('times'), dir('softDelete'),
        dir('belongsTo', { target: 'Org', optional: true }),
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

describe('orm: the defect battery (#102–#105)', () => {
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
    const noTarget = model('User', field('name'), { tag: 'directive', name: 'belongsTo', args: null });
    await loud4(noTarget, /@belongsTo: takes exactly one target name/);
    // trailing junk: a second arg — the old runtime reads args[0] and ignores the rest
    const junk = model('User', field('name'),
      dir('belongsTo', { target: 'Org', optional: false }, { target: 'Extra', optional: false }));
    await loud4(junk, /@belongsTo: takes exactly one target name/);
    // args on an argless directive
    await loud4(model('User', field('name'), dir('times', { target: 'yes', optional: false })), /@times: takes no arguments/);
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
        dir('times'), dir('softDelete'),
        dir('belongsTo', { target: 'Org', optional: false }),
        dir('index', { fields: ['createdAt'] }),
        dir('index', { fields: ['orgId'] }),
        dir('unique', { fields: ['deletedAt', 'name'] })));
      expect(() => ok._normalize()).not.toThrow();
    });
  });

  test('#108: a field and a relation owning one column reject at normalize', async () => {
    // the exact repro: `userId integer` + `@belongsTo User` — one
    // table column, two owners
    const collide = model('User',
      field('userId', 'integer'),
      field('name'),
      dir('belongsTo', { target: 'User', optional: false }));
    await loud4(collide, /field 'userId' and the @belongsTo User relation both own column 'user_id'/);
    // the mixin channel reaches the directive-managed columns (direct
    // declarations are caught by the reserved set first): a
    // mixin-included createdAt + @times is the same collision
    await K4.scope(() => {
      K4.__schema({ kind: 'mixin', name: 'Stamps', entries: [field('createdAt', 'datetime')] });
      const M = K4.__schema(model('Doc', field('name'), dir('mixin', { target: 'Stamps' }), dir('times')));
      expect(() => M._normalize()).toThrow(/field 'createdAt' and @times both own column 'created_at'/);
    });
    // the legal neighbor stays legal
    await K4.scope(() => {
      const ok = K4.__schema(model('Post', field('userName'), dir('belongsTo', { target: 'User', optional: false })));
      expect(() => ok._normalize()).not.toThrow();
    });
  });

  test('#105: acronym-style relation targets reject', async () => {
    const acro = model('Widget', field('name'), dir('belongsTo', { target: 'MDMUser', optional: false }));
    await loud4(acro, /not canonical PascalCase/);
    // the canonical spelling is fine
    await K4.scope(() => {
      K4.__schema(model('MdmUser', field('name')));
      const W = K4.__schema(model('Widget', field('name'), dir('belongsTo', { target: 'MdmUser', optional: false })));
      expect(W._normalize().relations.get('mdmUser').foreignKey).toBe('mdm_user_id');
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// this side-only unit tier (no reference dependence)
// ════════════════════════════════════════════════════════════════════

// _normalize() memoizes, and finishModelNorm — where every
// model-level rejection lives — used to run AFTER the memo was
// stored. So the first call threw and every call after it returned
// the half-built norm: a model the runtime had already refused went
// on to build SQL from it. A rejected model must keep rejecting.
describe('orm: a refused model stays refused', () => {
  const twoOwners = (k) => k.__schema(model('Bad',
    field('a', 'string', { attrs: { column: 'x' } }),
    field('b', 'string', { attrs: { column: 'x' } })));

  test('the second _normalize() throws the same error as the first', async () => {
    await K4.scope(() => {
      K4.setAdapter(recordingAdapter());
      const Bad = twoOwners(K4);
      const first = (() => { try { Bad._normalize(); } catch (e) { return e.message; } })();
      expect(first).toMatch(/both own column 'x'/);
      expect(() => Bad._normalize()).toThrow(first);
    });
  });

  test('a query on a refused model refuses instead of reaching the adapter', async () => {
    const r = await paired(async (k) => {
      const Bad = twoOwners(k);
      try { Bad._normalize(); } catch {}
      try { await Bad.where({ a: '1' }).all(); return 'accepted'; } catch { return 'rejected'; }
    });
    expect(r.value).toBe('rejected');
    expect(r.calls.length).toBe(0);
  });

  // A relation's key-type lookup normalizes its TARGET inside a
  // try/catch, so an unrelated model touching a broken one used to
  // swallow the error and leave the memo behind for everyone else.
  test('a third party touching it cannot swallow the refusal', async () => {
    await K4.scope(() => {
      K4.setAdapter(recordingAdapter());
      const Bad = twoOwners(K4);
      const Good = K4.__schema(model('Good', field('t'), dir('belongsTo', { target: 'Bad' })));
      Good.toJSONSchema();
      expect(() => Bad._normalize()).toThrow(/both own column 'x'/);
    });
  });
});

describe('orm: names that reach SQL as text, not as identifiers', () => {
  // Identifiers go through quoteIdent; the sequence name in a
  // column DEFAULT is the one name that reaches SQL as a string
  // LITERAL, where a quote of the other kind ends the string early.
  test("a table name containing ' escapes inside nextval()", async () => {
    await K4.scope(() => {
      K4.setAdapter(recordingAdapter());
      const sql = K4.__schema(model('O', dir('table', { name: "o'brien" }), field('n'))).toSQL();
      expect(sql).toContain(`CREATE SEQUENCE "o'brien_seq"`);
      expect(sql).toContain(`DEFAULT nextval('o''brien_seq')`);
    });
  });

  // A VARCHAR width is a count of characters. `..2.5` reads fine as a
  // validation bound and used to render as VARCHAR(2.5), which no
  // database accepts — and rounding it would silently redefine the
  // column.
  test('a fractional maximum length is refused, not rendered', async () => {
    await K4.scope(() => {
      K4.setAdapter(recordingAdapter());
      const V = K4.__schema(model('V', field('n', 'string', { constraints: { max: 2.5 } })));
      expect(() => V.toSQL()).toThrow(/VARCHAR width must be a positive whole number/);
      const W = K4.__schema(model('W', field('n', 'string', { constraints: { max: 2 } })));
      expect(W.toSQL()).toContain('VARCHAR(2)');
    });
  });

  // Column names canonicalize through the model's own map, so a
  // {column:} field and a same-named-after-camelCase sibling are two
  // distinct keys. Without `norm`, upsert's RETURNING validator
  // derived both names and called a correct row a duplicate column.
  test('upsert() canonicalizes its RETURNING row through the column map', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/INSERT/, rows(['id', 'MRN_NBR', 'mrn_nbr'], [1, 'A', 'B']));
      const P = k.__schema(model('P',
        field('mrn', 'string', { attrs: { column: 'MRN_NBR' } }),
        field('mrnNbr'),
        dir('unique', { fields: ['mrn'] })));
      const inst = await P.upsert({ mrn: 'A', mrnNbr: 'B' }, { conflict: ['mrn'] });
      return { id: inst.id, mrn: inst.mrn, mrnNbr: inst.mrnNbr };
    });
    expect(r.value).toEqual({ id: 1, mrn: 'A', mrnNbr: 'B' });
  });
});

// ONE sequence for the whole database: `schema.sequence 'id'` makes
// every surrogate key draw from the same counter, so an integer id
// names a row database-wide instead of only within its table. The
// setting is the DATABASE's, so these tests clear it again — it is
// module state, not registry state, and SchemaRegistry.scope does not
// unwind it.
describe('orm: the shared sequence', () => {
  const shared = (name, fn) => {
    orm4.schema.sequence(name);
    try { return fn(); } finally { orm4.schema.sequence(null); }
  };

  test('every table defaults from the one sequence, and no table creates it', async () => {
    await K4.scope(() => shared('id', () => {
      const U = K4.__schema(model('User', field('name')));
      const O = K4.__schema(model('Order', field('total', 'integer')));
      for (const sql of [U.toSQL(), O.toSQL()]) {
        expect(sql).toContain("DEFAULT nextval('id')");
        // The sequence outlives every table drawing from it, so a
        // table's own DDL never claims to own it...
        expect(sql).not.toContain('CREATE SEQUENCE "users_seq"');
        expect(sql).not.toContain('CREATE SEQUENCE "orders_seq"');
        // ...but standalone DDL still has to RUN, so it carries the
        // sequence guarded, never bare.
        expect(sql).toContain('CREATE SEQUENCE IF NOT EXISTS "id" START 1;');
      }
      expect(U._tableSpec().sequence).toEqual({ name: 'id', start: 1, shared: true });
    }));
  });

  test('dropFirst never drops the shared sequence out from under the other tables', async () => {
    await K4.scope(() => shared('id', () => {
      const U = K4.__schema(model('User', field('name')));
      expect(U.toSQL({ dropFirst: true })).not.toContain('DROP SEQUENCE');
    }));
    // the per-table default is unchanged: that sequence IS the table's
    await K4.scope(() => {
      const U = K4.__schema(model('User', field('name')));
      expect(U.toSQL({ dropFirst: true })).toContain('DROP SEQUENCE IF EXISTS "users_seq";');
    });
  });

  test('@idStart is refused under a shared sequence — one table cannot seed the database', async () => {
    await K4.scope(() => shared('id', () => {
      const U = K4.__schema(model('User', field('name'), dir('idStart', { value: 5000 })));
      expect(() => U.toSQL()).toThrow(/shares one sequence/);
      expect(() => U.toSQL()).toThrow(/schema\.sequence\('id', \{ start: 5000 \}\)/);
    }));
  });

  test('the seed rides the sequence, not the model', async () => {
    await K4.scope(() => {
      orm4.schema.sequence('id', { start: 10001 });
      try {
        const U = K4.__schema(model('User', field('name')));
        expect(U.toSQL()).toContain('CREATE SEQUENCE IF NOT EXISTS "id" START 10001;');
        expect(orm4.schema.sequence()).toEqual({ name: 'id', start: 10001 });
      } finally { orm4.schema.sequence(null); }
    });
  });

  test('declaring it twice agrees or throws; a bad name is refused', () => {
    try {
      expect(orm4.schema.sequence('id')).toEqual({ name: 'id', start: 1 });
      expect(orm4.schema.sequence('id')).toEqual({ name: 'id', start: 1 });   // idempotent
      expect(() => orm4.schema.sequence('seq')).toThrow(/already declared as 'id'/);
      expect(() => orm4.schema.sequence('id', { start: 7 })).toThrow(/already declared/);
    } finally { orm4.schema.sequence(null); }
    expect(orm4.schema.sequence()).toBe(null);
    expect(() => orm4.schema.sequence('')).toThrow(/takes the sequence name/);
    expect(() => orm4.schema.sequence('id', { start: 1.5 })).toThrow(/start must be an integer/);
    orm4.schema.sequence(null);
  });
});

describe('orm:  unit tier', () => {
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
      const U = K4.__schema(model('User', field('name'), dir('times')));
      const u = U.parse({ name: 'A' });
      expect(u.name).toBe('A');
      expect(u.ok()).toBe(true);
      expect(adapter.calls.length).toBe(0);
    });
  });

  test('the schema namespace: the M11-A surface plus the M11-C CLI-pointing migration stubs', () => {
    expect(Object.keys(orm4.schema).sort()).toEqual([
 'connect', 'introspect', 'make', 'migrate', 'plan', 'registerCoercer', 'sequence', 'setAdapter', 'status', 'transaction',
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
    const a = orm4.connect({ url: 'http://x.example:1' });
    expect(typeof a.query).toBe('function');
    expect(typeof a.begin).toBe('function');
    expect(a.capabilities.tx).toBe(true);
    expect(() => orm4.connect({})).toThrow(/url is required/);
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

describe('orm: runtime delivery', () => {
  const ORM_SRC = 'schema.setAdapter({query: (sql) -> {columns: [], data: [], rowCount: 0}})\nconsole.log "installed"';
  const BOTH_SRC = 'S = schema\n  a! integer\nschema.setAdapter({query: (sql) -> {columns: [], data: [], rowCount: 0}})\nconsole.log S.parse({a: 4}).a';

  test('referencing the schema namespace delivers the persistence runtime AND its validation dependency', () => {
    const { runtimes } = compile(ORM_SRC);
    expect([...runtimes].sort()).toEqual(['duckdb', 'orm', 'schema', 'vocab']);
  });

  test('a schema DECLARATION alone never delivers the persistence runtime', () => {
    const { runtimes, code } = compile('S = schema\n  a! integer', { runtimeDelivery: 'inline' });
    expect([...runtimes]).toEqual(['schema', 'vocab']);
    expect(code).not.toContain('async function transaction(');
    expect(code).not.toContain('PERSISTENCE');
    // import mode: only the validation runtime's module
    const imp = compile('S = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(imp.code).toContain('runtime/schema.js');
    expect(imp.code).not.toContain('runtime/orm.js');
  });

  test("'import' injects BOTH modules, validation first; names bound match inline mode", () => {
    const { code } = compile(BOTH_SRC, { runtimeDelivery: 'import' });
    const lines = code.split('\n');
    expect(lines[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*src\/runtime\/schema\.js";$/);
    expect(lines[1]).toMatch(/^import \{ schema, __schemaSetAdapter \} from ".*src\/runtime\/orm\.js";$/);
  });

  test("'inline' fuses the two bodies into ONE IIFE binding the union (the fragment-scope model)", () => {
    const { code } = compile(BOTH_SRC, { runtimeDelivery: 'inline' });
    expect(code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
    // one runtime IIFE, one sentinel, no import statements
    expect((code.match(/\(\(\) => \{\n\/\//g) ?? []).length).toBe(1);
    expect((code.match(/class SchemaError/g) ?? []).length).toBe(1);
    expect(/^import /m.test(code)).toBe(false);
    // the orm body made it in, its import line stripped
    expect(code).toContain('installPersistence({');
    expect(code).not.toContain("from './schema.js'");
  });

  // Inline delivery splices runtime bodies into one IIFE, so a surviving
  // top-level import/export is a syntax error in emitted code — and
  // nothing re-parses the output, so the compile used to SUCCEED and the
  // program failed to load. The strip is global (a runtime may carry
  // several sibling imports) and anything it cannot reach is refused.
  test('inline delivery strips EVERY sibling import, not just the first', () => {
    // orm.js already imports several siblings; one more must go the
    // same way. The exact count is not the point and pinning it just
    // breaks whenever a runtime gains a dependency — that there are
    // MULTIPLE, and that none survives, is the point.
    const raw = readFileSync(new URL('../../src/runtime/orm.js', import.meta.url), 'utf8');
    const before = (raw.match(/^import /gm) ?? []).length;
    expect(before).toBeGreaterThan(1);
    const twoImports = raw.replace(
      /^(import \{[^}]*\} from '\.\/schema\.js';)$/m,
      "$1\nimport { __schemaNothing } from './reactive.js';");
    expect((twoImports.match(/^import /gm) ?? []).length).toBe(before + 1);
    const stripped = twoImports
      .replace(/^export \{[^}]*\};\s*$/gm, '')
      .replace(/^import \{[^}]*\} from '\.\/[a-z-]+\.js';\s*$/gm, '');
    expect(/^[ \t]*import\b/m.test(stripped)).toBe(false);
    expect(/^[ \t]*export\b/m.test(stripped)).toBe(false);
  });

  test('every delivered runtime body is free of top-level import/export', () => {
    for (const rt of _runtimeTable()) {
      const body = readFileSync(rt.url, 'utf8')
        .replace(/^export \{[^}]*\};\s*$/gm, '')
        .replace(/^import \{[^}]*\} from '\.\/[a-z-]+\.js';\s*$/gm, '');
      const stray = /^[ \t]*(import|export)\b.*$/m.exec(body);
      expect(stray ? `${rt.key}: ${stray[0].trim()}` : null).toBe(null);
    }
  });

  test('a transaction-only module (no schema declaration) still gets the fused pair', () => {
    const { code, runtimes } = compile(ORM_SRC, { runtimeDelivery: 'inline' });
    expect([...runtimes].sort()).toEqual(['duckdb', 'orm', 'schema', 'vocab']);
    expect(code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
  });

  test('the fused inline block records ONE synthetic mapping row that never serializes', () => {
    const { code, mappings } = compile(BOTH_SRC, { runtimeDelivery: 'inline' });
    const runtimeRows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(runtimeRows.length).toBe(1);
    expect(runtimeRows[0].mappingKind).toBe('synthetic');
    expect(runtimeRows[0].sourceStart).toBe(runtimeRows[0].sourceEnd);
    expect(code.slice(runtimeRows[0].generatedStart, runtimeRows[0].generatedEnd)).toContain('installPersistence');
    expect(mappings.serializableRows().some((r) => r.role === 'runtime')).toBe(false);
  });

  test('program-scope bindings suppress per name (the bring-your-own hatch)', () => {
    // `schema` bound: no namespace injection; __schemaSetAdapter still delivers
    const a = compile('schema = {setAdapter: (x) -> x}\nschema.setAdapter 1\n__schemaSetAdapter 2', { runtimeDelivery: 'import' });
    const ormLine = a.code.split('\n').find((l) => l.includes('orm.js'));
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
    expect(imp.code).not.toContain('orm.js');
    const inl = compile('S = schema\n  a! integer', { runtimeDelivery: 'inline' });
    expect(inl.code).not.toContain('class SchemaQuery');
    expect(inl.code).not.toContain('async function transaction(');
    expect(inl.code).not.toContain('AsyncLocalStorage');
  });

  test('inline output RUNS standalone end-to-end: adapter install, hand-built model, create/save', async () => {
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
    ].join('\n');
    const { code } = compile(src, { runtimeDelivery: 'inline' });
    expect(code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
    const { code: none } = compile(src, { runtimeDelivery: 'none' });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await K4.scope(async () => {
      const out = await new AsyncFunction(
        '__schema', 'schema',
        `${none}\nreturn [u.id, calls.length];`,
      )(rt4.__schema, orm4.schema);
      expect(out).toEqual([1, 1]);
    });
  });

  test('import and inline modes agree observably (the same program, both deliveries, same output)', async () => {
    const src = 'schema.setAdapter({query: (s) -> {columns: [], data: [], rowCount: 0}})\nout = typeof schema.transaction';
    for (const mode of ['import', 'inline']) {
      const { code } = compile(src, { runtimeDelivery: mode });
      if (mode === 'import') expect(code).toMatch(/^import /);
      else expect(code).toMatch(/^const \{/);
    }
    const { code: none } = compile(src, { runtimeDelivery: 'none' });
    await K4.scope(async () => {
      const out = new Function('schema', `${none}\nreturn out;`)(orm4.schema);
      expect(out).toBe('function');
    });
  });

  test('dual delivery with the reactive runtime: separate blocks, rows keyed by range', () => {
    const src = 'count := 1\nschema.setAdapter({query: (s) -> {columns: [], data: [], rowCount: 0}})\ncount = count + 1';
    const { code, runtimes, mappings } = compile(src, { runtimeDelivery: 'inline' });
    expect([...runtimes].sort()).toEqual(['duckdb', 'orm', 'reactive', 'schema', 'vocab']);
    const runtimeRows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(runtimeRows.length).toBe(2);
    const [a, b] = runtimeRows.sort((x, y) => x.generatedStart - y.generatedStart);
    expect(a.generatedEnd).toBeLessThanOrEqual(b.generatedStart);
    expect(code.slice(a.generatedStart, a.generatedEnd)).toContain('installPersistence');
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
      expect([...runtimes].sort()).toEqual(['duckdb', 'orm', 'schema', 'vocab']);
    }
    const imp = compile(src, { runtimeDelivery: 'import' });
    const lines = imp.code.split('\n');
    expect(lines[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*src\/runtime\/schema\.js";$/);
    expect(lines[1]).toMatch(/^import \{ schema, __schemaSetAdapter \} from ".*src\/runtime\/orm\.js";$/);
    const inl = compile(src, { runtimeDelivery: 'inline' });
    expect(inl.code.startsWith('const { __schema, SchemaError, registerCoercer, schema, __schemaSetAdapter } = (() => {')).toBe(true);
    // a model nested inside a function body triggers from the tree
    // walk too
    const nested = compile('f = ->\n  T = schema :model\n    b! string\n  T', { runtimeDelivery: 'import' });
    expect([...nested.runtimes].sort()).toEqual(['duckdb', 'orm', 'schema', 'vocab']);
  });

  test('end to end from the compiled DSL: a model declared in Rip persists through a recording adapter and round-trips', async () => {
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
 '  @times',
 '  beforeSave: -> @name = @name.trim()',
 '  shout: -> @name.toUpperCase()',
 'u = await User.create({name: "  Al  ", email: "a@b.c"})',
 'again = await User.find(1)',
    ].join('\n');
    const { runtimes } = compile(src, { runtimeDelivery: 'inline' });
    expect([...runtimes].sort()).toEqual(['duckdb', 'orm', 'schema', 'vocab']);
    const { code: none } = compile(src, { runtimeDelivery: 'none' });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await K4.scope(async () => {
      const out = await new AsyncFunction(
        '__schema', 'schema',
        `${none}\nreturn [u.id, u.name, u.shout(), u.createdAt != null, again.name, calls];`,
      )(rt4.__schema, orm4.schema);
      const [id, name, shout, hasTs, againName, calls] = out;
      expect([id, name, shout, hasTs, againName]).toEqual([1, 'Al', 'AL', true, 'Al']);
      expect(calls).toEqual([
 'INSERT INTO "users" ("name", "email") VALUES (?, ?) RETURNING *',
 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1',
      ]);
    });
  });

  test("the `on:` adapter pins a DSL-declared model's SQL to its own adapter (declaration-time evaluation)", async () => {
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
    ].join('\n');
    const { code } = compile(src, { runtimeDelivery: 'inline' });
    expect(code).toContain('adapter: analytics');
    const { code: none } = compile(src, { runtimeDelivery: 'none' });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await K4.scope(async () => {
      const [pinned, global_] = await new AsyncFunction(
        '__schema', 'schema',
        `${none}\nreturn [pinnedCalls, globalCalls];`,
      )(rt4.__schema, orm4.schema);
      expect(pinned).toEqual(['SELECT COUNT(*) FROM "alphas"']);
      expect(global_).toEqual(['SELECT COUNT(*) FROM "betas"']);
    });
  });

  test('scopes, defaultScope, soft delete, and relations flow from the DSL to the runtime surface', async () => {
    // In-process: compile with delivery 'none' and evaluate against
    // the imported runtime modules (the schema.test.js eval pattern).
    const src = [
 'Item = schema :model',
 '  name!   string',
 '  active? boolean',
 '  @softDelete',
 '  @belongsTo Owner',
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
 '  @times',
 '  @idStart 5000',
 '  @tableWas "legacy_people"',
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
      expect(sql).toContain('CREATE SEQUENCE "ps_seq" START 5000;');
      expect(sql).toMatch(/"email" [^\n]*UNIQUE/);
      expect(sql).not.toContain('idx_ps_email');
      expect(sql).toContain('CREATE UNIQUE INDEX "idx_ps_first_name_email" ON "ps" ("first_name", "email");');
    });
  });

  // `@table` is a PERMANENT override; `@tableWas` is a one-time rename
  // signal the differ consumes and the author then deletes. Both live in
  // table-name space, so they compose — @tableWas names the deployed
  // table, @table the desired one — and the pluralizer is bypassed
  // entirely, including for the sequence and index names derived from it.
  test('@table overrides the derived table name everywhere it is derived', async () => {
    const src = [
 'Profile = schema :model',
 '  @table "user_profile"',
 '  nick!  string @unique',
 '  @idStart 7',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(() => {
      const P = new Function('__schema', `${code}\nreturn Profile;`)(rt4.__schema);
      expect(P._tableSpec().name).toBe('user_profile');
      const sql = P.toSQL();
      // pluralize(snake('Profile')) would have been "profiles"
      expect(sql).not.toContain('profiles');
      expect(sql).toContain('CREATE SEQUENCE "user_profile_seq" START 7;');
      expect(sql).toContain('CREATE TABLE "user_profile"');
      expect(sql).toContain("DEFAULT nextval('user_profile_seq')");
      expect(sql).toMatch(/"nick" [^\n]*UNIQUE/);
      expect(sql).not.toContain('idx_user_profile_nick');
    });
  });

  test('@table composes with @tableWas: the rename targets the override', async () => {
    const src = [
 'Client = schema :model',
 '  @table "client_records"',
 '  @tableWas "customers"',
 '  name! string',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(() => {
      const C = new Function('__schema', `${code}\nreturn Client;`)(rt4.__schema);
      const spec = C._tableSpec();
      expect(spec.name).toBe('client_records');
      expect(spec.tableWas).toBe('customers');
    });
  });

  test('@table drives the query builder, not just the DDL', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT \* FROM "user_profile"/, rows(['id', 'nick'], [1, 'a']));
      const P = k.__schema(model('Profile', field('nick'), dir('table', { name: 'user_profile' })));
      await P.where({ nick: 'a' }).all();
      await P.where({}).count();
      return null;
    });
    expect(r.calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM "user_profile" WHERE "nick" = ?',
      'SELECT COUNT(*) FROM "user_profile"',
    ]);
  });

  // ── @primary and {column:} ─────────────────────────────────────
  //
  // Both name the same pair — a PROPERTY and the COLUMN behind it —
  // and the split is what makes an inherited table addressable at all:
  // `PATIENT_ID`/`MRN_NBR` in the SQL, `patientId`/`mrn` in the code.

  test('@primary renames the pk property and its column, everywhere both are used', async () => {
    const src = [
 'Patient = schema :model',
 '  @table "MDM_PATIENT"',
 '  @primary patientId, {column: "PATIENT_ID"}',
 '  mrn! string, {column: "MRN_NBR"}',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const P = new Function('__schema', `${code}\nreturn Patient;`)(rt4.__schema);
      const spec = P._tableSpec();
      expect(spec.primaryKey).toBe('PATIENT_ID');
      expect(P.toSQL()).toContain('"PATIENT_ID" INTEGER PRIMARY KEY');

      adapter.on(/SELECT/, rows(['PATIENT_ID', 'MRN_NBR'], [7, 'M1']));
      const p = await P.where({ mrn: 'M1' }).first();
      // The property is Rip's; the column is the database's.
      expect(p.patientId).toBe(7);
      expect(p.mrn).toBe('M1');
      expect(Object.keys(p).sort()).toEqual(['mrn', 'patientId']);

      adapter.calls.length = 0;
      adapter.on(/UPDATE/, { columns: [], data: [], rowCount: 1 });
      p.mrn = 'M2';
      await p.save();
      expect(adapter.calls[0].sql).toBe(
        'UPDATE "MDM_PATIENT" SET "MRN_NBR" = ? WHERE "PATIENT_ID" = ?');
      expect(adapter.calls[0].params).toEqual(['M2', 7]);
    });
  });

  test('{column:} maps a field to a column Rip did not name, both directions', async () => {
    const r = await paired(async (k, adapter) => {
      adapter.on(/^SELECT/, rows(['id', 'USER_NAME'], [1, 'ann']));
      adapter.on(/^INSERT/, row(['id', 'USER_NAME'], [2, 'bea']));
      const U = k.__schema(model('User', field('name', 'string', { attrs: { column: 'USER_NAME' } })));
      const found = await U.where({ name: 'ann' }).order({ name: 'desc' }).all();
      const made = await U.create({ name: 'bea' });
      return [found[0].name, made.name, made.id];
    });
    expect(r.value).toEqual(['ann', 'bea', 2]);
    expect(r.calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM "users" WHERE "USER_NAME" = ? ORDER BY "USER_NAME" DESC',
      'INSERT INTO "users" ("USER_NAME") VALUES (?) RETURNING *',
    ]);
  });

  test('{column:} claims its column through the same gate as everything else', async () => {
    await K4.scope(() => {
      const said = (entries) => {
        try {
          K4.__schema(model('C' + (said.n = (said.n || 0) + 1), ...entries))._normalize();
          return 'no error';
        } catch (e) { return e.message; }
      };
      // two fields, one column
      expect(said([field('a', 'string', { attrs: { column: 'x' } }),
        field('b', 'string', { attrs: { column: 'x' } })]))
        .toMatch(/field 'a' and field 'b' both own column 'x'/);
      // a mapped column landing on a directive-managed one
      expect(said([field('a', 'string', { attrs: { column: 'created_at' } }), dir('times')]))
        .toMatch(/field 'a' and @times both own column 'created_at'/);
      // …and on the primary key
      expect(said([field('a', 'string', { attrs: { column: 'id' } })]))
        .toMatch(/the primary key and field 'a' both own column 'id'/);
      // a column name the quoter could not keep as one identifier
      expect(said([field('a', 'string', { attrs: { column: 'crm.users' } })]))
        .toMatch(/'column' is a database column name/);
    });
  });

  // ── @hasMany through: ─────────────────────────────────────────────
  //
  // Deliberately NOT a JOIN: the join rows come back on their own, the
  // targets in one findMany, and the grouping happens here — the same
  // two-query shape every other relation uses, so no row duplication
  // and no join-table columns leak onto target instances.

  test('@hasMany through: reads a many-to-many, three set-based queries for any number of owners', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/FROM "users"/, rows(['id', 'name'], [1, 'ann'], [2, 'bob']));
      adapter.on(/FROM "memberships"/, rows(['user_id', 'team_id'], [1, 10], [1, 11], [2, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red'], [11, 'blue']));
      const U = K4.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Team', through: 'Membership' })));
      K4.__schema(model('Team', field('label')));
      K4.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));

      const us = await U.includes('teams').all();
      expect(adapter.calls.map((c) => c.sql)).toEqual([
        'SELECT * FROM "users"',
        'SELECT "user_id", "team_id" FROM "memberships" WHERE "user_id" IN (?, ?)',
        'SELECT * FROM "teams" WHERE "id" IN (?, ?)',
      ]);
      // the accessors resolve from the memo — no fourth query
      expect((await us[0].teams()).map((t) => t.label)).toEqual(['red', 'blue']);
      expect((await us[1].teams()).map((t) => t.label)).toEqual(['red']);
      expect(adapter.calls.length).toBe(3);
      // a target instance is a Team and nothing else: the join row's
      // columns are never projected onto it
      expect(Object.keys((await us[0].teams())[0]).sort()).toEqual(['id', 'label']);
    });
  });

  test('@hasMany through: the lone accessor reads two queries and owns no column', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/FROM "memberships"/, rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red']));
      const U = K4.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Team', through: 'Membership' })));
      K4.__schema(model('Team', field('label')));
      K4.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      // a through relation adds nothing to the owner's table
      expect([...U._normalize().columns].sort()).toEqual(['id', 'name']);
      expect(U.toSQL()).not.toContain('team');

      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      expect((await u.teams()).map((t) => t.label)).toEqual(['red']);
      expect(adapter.calls.map((c) => c.sql)).toEqual([
        'SELECT "user_id", "team_id" FROM "memberships" WHERE "user_id" IN (?)',
        'SELECT * FROM "teams" WHERE "id" IN (?)',
      ]);
    });
  });

  // The join columns resolve LATE — the registry fills in whatever
  // order the modules load — and each side is whichever @belongsTo on
  // the join model points at that end. Ambiguity is refused rather
  // than guessed: picking one of two would wire the relation to the
  // wrong column and nothing would ever say so.
  test('@hasMany through: refuses to guess a join column, and says which option settles it', async () => {
    // Owner + target + join, then the read that forces resolution.
    const read = async (tag, joinEntries, relArgs) => {
      let out = 'ok';
      await K4.scope(async () => {
        const adapter = recordingAdapter();
        K4.setAdapter(adapter);
        adapter.on(/FROM/, rows(['a', 'b'], [1, 10]));
        const U = K4.__schema(model('Owner' + tag, field('n'),
          dir('hasMany', { target: 'Team' + tag, through: 'Join' + tag, ...relArgs })));
        K4.__schema(model('Team' + tag, field('label')));
        K4.__schema(model('Join' + tag, ...joinEntries));
        const u = U._hydrate([{ name: 'id' }, { name: 'n' }], [1, 'x']);
        try { await u['team' + tag + 's'](); } catch (e) { out = e.message; }
      });
      return out;
    };
    // the join model never points back at the owner
    expect(await read('A', [dir('belongsTo', { target: 'TeamA' })], {}))
      .toMatch(/declares no @belongsTo OwnerA — add one, or name the column: \{through: JoinA, foreignKey: "owner_a_id"\}/);
    // two @belongsTo to the target — no single right answer
    expect(await read('B', [
      dir('belongsTo', { target: 'OwnerB' }),
      dir('belongsTo', { target: 'TeamB', as: 'primary', foreignKey: 'primary_id' }),
      dir('belongsTo', { target: 'TeamB', as: 'backup', foreignKey: 'backup_id' }),
    ], {})).toMatch(/declares 2 @belongsTo TeamB \(primary, backup\) — name the column to say which/);
    // …and naming it settles it
    expect(await read('C', [
      dir('belongsTo', { target: 'OwnerC' }),
      dir('belongsTo', { target: 'TeamC', as: 'primary', foreignKey: 'primary_id' }),
      dir('belongsTo', { target: 'TeamC', as: 'backup', foreignKey: 'backup_id' }),
    ], { targetKey: 'primary_id' })).toBe('ok');
  });

  // A `through` @hasOne is the same read with a different SHAPE — the
  // owner reaches at most one target. @belongsTo is the one that
  // cannot: it holds its key in its own row.
  test('@hasOne through: the same two queries, answering with one target', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/FROM "memberships"/, rows(['user_id', 'badge_id'], [1, 99]));
      adapter.on(/FROM "badges"/, rows(['id', 'kind'], [99, 'gold']));
      const U = K4.__schema(model('User', field('name'),
        dir('hasOne', { target: 'Badge', through: 'Membership' })));
      K4.__schema(model('Badge', field('kind')));
      K4.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Badge' })));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      const badge = await u.badge();
      expect(badge.kind).toBe('gold');
      expect(adapter.calls.map((c) => c.sql)).toEqual([
        'SELECT "user_id", "badge_id" FROM "memberships" WHERE "user_id" IN (?)',
        'SELECT * FROM "badges" WHERE "id" IN (?)',
      ]);
      // …and the batched path agrees with the lone accessor
      adapter.calls.length = 0;
      adapter.on(/FROM "users"/, rows(['id', 'name'], [1, 'ann'], [2, 'bob']));
      const us = await U.includes('badge').all();
      expect((await us[0].badge()).kind).toBe('gold');
      expect(await us[1].badge()).toBeNull();
      expect(adapter.calls.length).toBe(3);
    });
  });

  test('@belongsTo refuses through: it holds its key in its own row', async () => {
    await K4.scope(() => {
      expect(() => K4.__schema(model('P', field('t'),
        dir('belongsTo', { target: 'U', through: 'J' })))._normalize())
        .toThrow(/'through' is for @hasMany\/@hasOne/);
    });
  });

  // ── writing a through relation ────────────────────────────────────
  //
  // The link is a ROW, so linking goes THROUGH the join model —
  // insertMany validates it and honors its own fields and defaults,
  // deleteAll honors its @softDelete. Three verbs named off the
  // accessor, because the accessor is the only per-relation-unique name.

  test('add/remove/set write the join model, and are named off the accessor', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Team', as: 'labels', through: 'Membership' })));
      K4.__schema(model('Team', field('label')));
      K4.__schema(model('Membership', field('role'),
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      // `{as: labels}` names the accessor, so it names the writers too
      expect(typeof u.addLabels).toBe('function');
      expect(typeof u.removeLabels).toBe('function');
      expect(typeof u.setLabels).toBe('function');

      adapter.on(/SELECT "user_id"/, rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/INSERT/, rows(['id', 'user_id', 'team_id', 'role'], [5, 1, 11, 'member']));
      // 10 is already linked, so only 11 is written — linking twice is
      // a no-op, never a second row (which would read as a duplicate)
      expect(await u.addLabels([{ id: 10 }, 11], { role: 'member' })).toBe(1);
      expect(adapter.calls.map((c) => c.sql)).toEqual([
        'SELECT "user_id", "team_id" FROM "memberships" WHERE "user_id" IN (?)',
        'INSERT INTO "memberships" ("role", "user_id", "team_id") VALUES (?, ?, ?) RETURNING *',
      ]);
      expect(adapter.calls[1].params).toEqual(['member', 1, 11]);
      // adding nothing new costs no INSERT at all
      adapter.calls.length = 0;
      expect(await u.addLabels(10)).toBe(0);
      expect(adapter.calls.length).toBe(1);

      adapter.calls.length = 0;
      adapter.on(/DELETE/, { columns: [], data: [], rowCount: 1 });
      expect(await u.removeLabels(10)).toBe(1);
      expect(adapter.calls[0].sql).toBe(
        'DELETE FROM "memberships" WHERE "user_id" = ? AND "team_id" IN (?)');
      expect(adapter.calls[0].params).toEqual([1, 10]);

      // set = both halves off ONE read of the current set
      adapter.calls.length = 0;
      expect(await u.setLabels([11, 12], { role: 'member' })).toEqual({ added: 2, removed: 1 });
      expect(adapter.calls.map((c) => c.sql)).toEqual([
        'SELECT "user_id", "team_id" FROM "memberships" WHERE "user_id" IN (?)',
        'DELETE FROM "memberships" WHERE "user_id" = ? AND "team_id" IN (?)',
        'INSERT INTO "memberships" ("role", "user_id", "team_id") VALUES (?, ?, ?), (?, ?, ?) RETURNING *',
      ]);
    });
  });

  test('a through write refuses what it cannot link, and busts the memo', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Team', through: 'Membership' })));
      const T = K4.__schema(model('Team', field('label')));
      K4.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);

      // an unsaved target has no identity to link to
      let err = null;
      try { await u.addTeams(new (T._getClass())({ label: 'new' })); } catch (e) { err = e; }
      expect(err?.message).toMatch(/addTeams\(\) received an unsaved Team at \[0\] — it has no id to link to/);
      // …and neither does an unsaved owner
      err = null;
      const fresh = new (U._getClass())({ name: 'new' });
      try { await fresh.addTeams(1); } catch (e) { err = e; }
      expect(err?.message).toMatch(/requires a persisted instance/);
      expect(adapter.calls.length).toBe(0);

      // a write invalidates the accessor's memo — the relation changed
      adapter.on(/SELECT "user_id"/, rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red']));
      expect((await u.teams()).map((t) => t.label)).toEqual(['red']);
      adapter.on(/DELETE/, { columns: [], data: [], rowCount: 1 });
      await u.removeTeams(10);
      adapter.calls.length = 0;
      await u.teams();
      // the memo would have answered with 0 queries; it re-read instead
      expect(adapter.calls.length).toBeGreaterThan(0);
    });
  });

  // ── natural primary keys ──────────────────────────────────────────
  //
  // Declaring the pk as a field — alongside an explicit @primary
  // naming it — is what makes it caller-supplied. It takes BOTH: a
  // bare `id! integer` stays the collision it always was, because the
  // default name is exactly where a silent posture flip would go
  // unnoticed.

  test('a natural key is the caller\'s to supply, and the whole write path follows', async () => {
    const src = [
 'Patient = schema :model',
 '  @primary mrn',
 '  mrn!  string, {column: "MRN_NBR"}',
 '  name! string',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const P = new Function('__schema', `${code}\nreturn Patient;`)(rt4.__schema);
      const spec = P._tableSpec();
      // no sequence exists, because nothing generates the key
      expect(spec.sequence).toBeNull();
      expect(spec.primaryKey).toBe('MRN_NBR');
      const sql = P.toSQL({ dropFirst: true });
      expect(sql).toContain('"MRN_NBR" VARCHAR PRIMARY KEY');
      expect(sql).not.toContain('nextval');
      expect(sql).not.toContain('SEQUENCE');

      // the INSERT writes the key like any other column
      adapter.on(/INSERT/, row(['MRN_NBR', 'name'], ['M1', 'Ann']));
      const p = await P.create({ mrn: 'M1', name: 'Ann' });
      expect(adapter.calls[0].sql).toBe(
        'INSERT INTO "patients" ("MRN_NBR", "name") VALUES (?, ?) RETURNING *');
      expect(adapter.calls[0].params).toEqual(['M1', 'Ann']);
      expect(p.mrn).toBe('M1');

      // …and identity still targets the originally-loaded row
      adapter.calls.length = 0;
      adapter.on(/UPDATE/, { columns: [], data: [], rowCount: 1 });
      p.name = 'Bea';
      await p.save();
      expect(adapter.calls[0].sql).toBe(
        'UPDATE "patients" SET "name" = ? WHERE "MRN_NBR" = ?');
      expect(adapter.calls[0].params).toEqual(['Bea', 'M1']);

      // an absent key is refused HERE, naming the posture — not left
      // to surface as a NOT NULL violation from the database
      adapter.calls.length = 0;
      let err = null;
      try { await P.create({ name: 'NoKey' }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(rt4.SchemaError);
      expect(err.issues.some((i) => i.field === 'mrn' && i.error === 'required')).toBe(true);
      expect(adapter.calls.length).toBe(0);

      // the JSON-Schema export says string, not the surrogate's integer
      expect(P.toJSONSchema().properties.mrn).toEqual({ type: 'string' });
    });

    // The inline spelling reaches the runtime as a field flag and
    // lands in the identical natural-key posture.
    const inline = compile('Country = schema :model\n  iso! string @primary\n  name! string').code;
    await K4.scope(async () => {
      K4.setAdapter(recordingAdapter());
      const C = new Function('__schema', `${inline}\nreturn Country;`)(rt4.__schema);
      const spec = C._tableSpec();
      expect(spec.sequence).toBeNull();
      expect(spec.primaryKey).toBe('iso');
      expect(C.toSQL()).toContain('"iso" VARCHAR PRIMARY KEY');
    });
  });

  test('a foreign key is as wide as the key it points at', async () => {
    const src = [
 'Country = schema :model',
 '  @primary iso',
 '  iso!  string',
 '  name! string',
 '',
 'City = schema :model',
 '  name! string',
 '  @belongsTo Country',
    ].join('\n');
    const { code } = compile(src);
    await K4.scope(() => {
      K4.setAdapter(recordingAdapter());
      const [, C] = new Function('__schema', `${code}\nreturn [Country, City];`)(rt4.__schema);
      const sql = C.toSQL();
      // the surrogate's INTEGER would be wrong: this key is a string
      expect(sql).toContain('"country_id" VARCHAR NOT NULL');
      expect(C.toJSONSchema().properties.countryId).toEqual({ type: 'string' });
    });
  });

  test('it takes BOTH declarations — a bare pk field is still a collision', async () => {
    // no @primary: `id` is the runtime's, and saying otherwise is
    // an error that names the escape
    expect(() => compile('U = schema :model\n  id! integer\n  n! string'))
      .toThrow(/field 'id' collides with the runtime-managed primary key.*write '@primary id' to make it a caller-supplied natural key/s);
    // …and the escape works
    expect(() => compile('U = schema :model\n  @primary id\n  id! uuid\n  n! string')).not.toThrow();
    // a caller-supplied key has nothing generating it, so it is
    // required, scalar, and has no sequence to seed
    expect(() => compile('U = schema :model\n  @primary mrn\n  mrn? string'))
      .toThrow(/primary key 'mrn' is declared optional/);
    expect(() => compile('U = schema :model\n  @primary mrn\n  mrn! string\n  @idStart 5'))
      .toThrow(/there is no sequence to seed/);
    // and the column is stated once, on the field
    expect(() => compile('U = schema :model\n  @primary mrn, {column: "A"}\n  mrn! string, {column: "B"}'))
      .toThrow(/state the column once, on the field/);
  });

  test('the runtime holds the same natural-key line on a hand-built descriptor', async () => {
    await K4.scope(() => {
      const said = (entries) => {
        try {
          K4.__schema(model('N' + (said.n = (said.n || 0) + 1), ...entries))._normalize();
          return 'no error';
        } catch (e) { return e.message; }
      };
      expect(said([dir('primary', { name: 'mrn' }), field('mrn', 'string', { optional: true })]))
        .toMatch(/primary key 'mrn' is declared optional/);
      expect(said([dir('primary', { name: 'mrn' }), field('mrn'), dir('idStart', { value: 5 })]))
        .toMatch(/there is no sequence to seed/);
      expect(said([field('id', 'integer')]))
        .toMatch(/id collides with the runtime-managed primary key/);
      // the legal shape stays legal
      expect(said([dir('primary', { name: 'mrn' }), field('mrn'), field('name')])).toBe('no error');
    });
  });

  // Every column type is a DELIBERATE answer. The catch-all used to be
  // VARCHAR, which turned a typo'd type name into a shipped column
  // that nothing complained about at either layer.
  test('a field type with no column form is refused, not rendered VARCHAR', async () => {
    await K4.scope(() => {
      K4.setAdapter(recordingAdapter());
      K4.__schema(model('Addr', field('city')));         // a :model, for the relation case
      K4.__schema({ kind: 'shape', name: 'Point', entries: [field('x', 'integer')] });
      K4.__schema({ kind: 'enum', name: 'Role', entries: [{ tag: 'enum-member', name: 'admin' }] });
      K4.__schema({ kind: 'mixin', name: 'Mx', entries: [field('y')] });
      const ddl = (f) => {
        try { return K4.__schema(model('T' + (ddl.n = (ddl.n || 0) + 1), f)).toSQL(); }
        catch (e) { return e.message; }
      };
      // the typo: nothing declares it, and it is not intrinsic
      expect(ddl(field('a', 'stirng')))
        .toMatch(/unknown field type 'stirng'.*no schema declares it, and it is not one of: any, boolean/s);
      // an Object.prototype name is not an intrinsic either: the column
      // table is keyed by the user's type name, so an inherited member
      // must never pass for one (a `constructor` column would otherwise
      // render the function's source text as its type)
      expect(ddl(field('a', 'constructor'))).toMatch(/unknown field type 'constructor'/);
      expect(ddl(field('a', 'toString'))).toMatch(/unknown field type 'toString'/);
      // a nested schema is an object, so it is a JSON document — the
      // same answer the array form has always given
      expect(ddl(field('a', 'Point'))).toContain('"a" JSON');
      expect(ddl(field('a', 'Point', { array: true }))).toContain('"a" JSON');
      // an enum materializes to its member values, as the closed set
      // the column is allowed to hold
      expect(ddl(field('a', 'Role'))).toContain(`"a" ENUM('admin')`);
      // a row does not nest inside a column
      expect(ddl(field('a', 'Addr'))).toMatch(/is a :model.*@belongsTo Addr/s);
      expect(ddl(field('a', 'Mx'))).toMatch(/is a :mixin, which has no column form/);
      // the intrinsics still map as they did
      expect(ddl(field('a', 'uuid'))).toContain('"a" UUID');
      expect(ddl(field('a', 'string', { constraints: { max: 24 } }))).toContain('"a" VARCHAR(24)');
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Scaling gates (extended tier, ) — count-based and deterministic:
// query counts and iteration counts, never wall-clock.
// ════════════════════════════════════════════════════════════════════

describeExtended('orm: scaling gates', () => {
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
          dir('hasMany', { target: 'Order', optional: false }),
          dir('hasOne', { target: 'Profile', optional: false })));
        K4.__schema(model('Order', field('total', 'integer'), dir('belongsTo', { target: 'User', optional: false })));
        K4.__schema(model('Profile', field('bio'), dir('belongsTo', { target: 'User', optional: false })));

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
          K4.__schema(model('Spoke' + i, field('name', 'string', { optional: true }), dir('belongsTo', { target: 'Hub', optional: false })));
          rels.push(dir('hasMany', { target: 'Spoke' + i, optional: false }));
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
        [field('name'), ...Array.from({ length: r }, (_, i) => dir('hasMany', { target: 'Tgt' + i, optional: false }))],
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

describe('orm: SQL structure ownership', () => {
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

// ════════════════════════════════════════════════════════════════════
// mapping gates, through-write integrity, and memo races
// ════════════════════════════════════════════════════════════════════

// An adapter with hold(re, times): the first `times` matching
// statements PAUSE until release(), so a test can force the exact
// interleavings the relation memo must survive. Handlers receive a
// per-rule call counter; answers compute at issue time.
function holdableAdapter() {
  const calls = [];
  const rules = [];
  const holds = [];
  const answer = (sql, params) => {
    for (const r of rules) {
      if (r.re.test(sql)) {
        r.count = (r.count || 0) + 1;
        return typeof r.handler === 'function' ? r.handler(sql, params, r.count) : r.handler;
      }
    }
    return { columns: [], data: [], rowCount: 0 };
  };
  const adapter = {
    calls,
    on(re, handler) { rules.push({ re, handler }); return adapter; },
    hold(re, times = 1) {
      const h = {
        re, remaining: times, waiters: [],
        release() { h.remaining = 0; const w = h.waiters; h.waiters = []; for (const r of w) r(); },
      };
      holds.push(h);
      return h;
    },
    async query(sql, params = []) {
      calls.push({ sql, params });
      const res = answer(sql, params);
      for (const h of holds) {
        if (h.remaining > 0 && h.re.test(sql)) {
          h.remaining--;
          await new Promise((r) => h.waiters.push(r));
        }
      }
      return res;
    },
  };
  return adapter;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// User —hasMany through Membership→ Team, with the join declaring the
// two @belongsTo the key resolution reads. `joinExtras` adds entries
// to Membership (a required field, a defaultScope).
function throughWorld(k, ...joinExtras) {
  const U = k.__schema(model('User', field('name'),
    dir('hasMany', { target: 'Team', through: 'Membership' })));
  k.__schema(model('Team', field('label')));
  k.__schema(model('Membership', ...joinExtras,
    dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
  return U;
}

describe('orm: the column-mapping gates', () => {
  test('an inline literal-union field renders ENUM and still validates', async () => {
    await K4.scope(() => {
      const T = K4.__schema(model('Ticket',
        field('state', 'literal-union', { literals: ['open', 'closed'] })));
      // the closed set reaches the column, so the database enforces
      // the same membership the parse does — a VARCHAR would have
      // taken any string
      expect(T.toSQL()).toContain(`"state" ENUM('open', 'closed') NOT NULL`);
      expect(T.parse({ state: 'open' }).state).toBe('open');
      expect(() => T.parse({ state: 'nope' })).toThrow();
    });
  });

  test('an ENUM column renders DuckDB\'s own spelling, escapes included', async () => {
    await K4.scope(() => {
      // matches what duckdb_columns() reports back verbatim —
      // comma-space between members, a doubled quote for an embedded
      // one — so an unchanged column never reads as changed
      const T = K4.__schema(model('Odd',
        field('state', 'literal-union', { literals: ["it's", 'a, b'], constraints: { default: 'a, b' } })));
      expect(T.toSQL()).toContain(`"state" ENUM('it''s', 'a, b') NOT NULL DEFAULT 'a, b'`);
    });
  });

  test('an enum whose members are not strings stays VARCHAR', async () => {
    await K4.scope(() => {
      // DuckDB enum members are strings; restating 1 and 2 as
      // ENUM('1','2') would name a set the values are not in
      const L = K4.__schema({ kind: 'enum', name: 'Level', entries: [
        { tag: 'enum-member', name: 'low', value: 1 },
        { tag: 'enum-member', name: 'high', value: 2 },
      ] });
      expect([...L._normalize().enumMembers.values()]).toEqual([1, 2]);
      const T = K4.__schema(model('Alarm', field('level', 'Level')));
      expect(T.toSQL()).toContain('"level" VARCHAR');
    });
  });

  test("a {column:} field beside a belongsTo deriving the same property rejects, naming both columns", async () => {
    await K4.scope(() => {
      K4.__schema(model('User', field('name')));
      const Post = K4.__schema(model('Post',
        field('title'),
        field('userId', 'integer', { attrs: { column: 'USER_REF' } }),
        dir('belongsTo', { target: 'User' })));
      let err = null;
      try { Post._normalize(); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(rt4.SchemaError);
      expect(err?.message).toMatch(/field 'userId' and the @belongsTo User relation both own property 'userId'/);
      expect(err?.message).toMatch(/'USER_REF' and 'user_id'/);
    });
  });

  test('hydrate validates adapter rows exactly as reload() does', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      // A legacy table carrying BOTH the mapped column and a sibling
      // spelling of the same canonical key.
      adapter.on(/^SELECT \* FROM "recs"/, rows(['id', 'MRN_NBR', 'mrn'], [1, 'mapped', 'legacy']));
      const Rec = K4.__schema(model('Rec', field('mrn', 'string', { attrs: { column: 'MRN_NBR' } })));
      let err = null;
      try { await Rec.all(); } catch (e) { err = e; }
      expect(err?.message).toMatch(/row hydration adapter invariant — duplicate canonical column 'mrn'/);
      err = null;
      try { await Rec.find(1); } catch (e) { err = e; }
      expect(err?.message).toMatch(/duplicate canonical column 'mrn'/);
    });
  });
});

describe('orm: through-write integrity', () => {
  test('a set() whose insert half cannot validate leaves the links intact — no DELETE issues', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT "user_id", "team_id"/, rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red']));
      const U = throughWorld(K4, field('role')); // role is REQUIRED on the join
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      expect((await u.teams()).map((t) => t.id)).toEqual([10]);
      let err = null;
      try { await u.setTeams([20]); } catch (e) { err = e; } // no {role:} attr
      expect(err).toBeInstanceOf(rt4.SchemaError);
      expect(err?.issues?.some((i) => i.field === '[0].role')).toBe(true);
      expect(adapter.calls.some((c) => /^DELETE/.test(c.sql))).toBe(false);
      expect(adapter.calls.some((c) => /^INSERT/.test(c.sql))).toBe(false);
      // The links really are intact, so the memo's answer stays true.
      expect((await u.teams()).map((t) => t.id)).toEqual([10]);
    });
  });

  test('a successful set() invalidates the memo even when the adapter under-reports affected rows', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      let unlinked = false;
      adapter.on(/^SELECT "user_id", "team_id"/, () =>
        unlinked ? rows(['user_id', 'team_id']) : rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red']));
      // A bun:sqlite-shaped adapter: the DELETE really lands but its
      // envelope reports zero affected rows.
      adapter.on(/^DELETE FROM "memberships"/, () => {
        unlinked = true;
        return { columns: [], data: [], rowCount: 0 };
      });
      const U = throughWorld(K4);
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      expect((await u.teams()).map((t) => t.id)).toEqual([10]);
      await u.setTeams([]);
      const before = adapter.calls.length;
      expect(await u.teams()).toEqual([]); // re-queried: the memo is gone
      expect(adapter.calls.length).toBeGreaterThan(before);
    });
  });

  test('setX refuses non-object attrs, exactly as addX does', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = throughWorld(K4);
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      let err = null;
      try { await u.setTeams([10], 'admin'); } catch (e) { err = e; }
      expect(err?.message).toMatch(/setTeams\(\) attrs must be a plain object of Membership columns/);
      expect(adapter.calls.length).toBe(0);
    });
  });

  test('a through-write invalidates sibling relations over the same join model', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT "user_id", "team_id"/, rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red']));
      adapter.on(/^INSERT INTO "memberships"/, row(['id', 'user_id', 'team_id'], [7, 1, 11]));
      const U = K4.__schema(model('User', field('name'),
        dir('hasMany', { target: 'Team', through: 'Membership' }),
        dir('hasMany', { target: 'Team', as: 'squads', through: 'Membership' })));
      K4.__schema(model('Team', field('label')));
      K4.__schema(model('Membership',
        dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      await u.teams();
      await u.squads(); // both memoized over the same join table
      await u.addTeams(11);
      const before = adapter.calls.length;
      await u.teams();
      const afterTeams = adapter.calls.length;
      expect(afterTeams).toBeGreaterThan(before); // own accessor re-queries
      await u.squads();
      expect(adapter.calls.length).toBeGreaterThan(afterTeams); // the sibling does too
    });
  });

  test('a through resolving owner and target to ONE column refuses, naming the options', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const Category = K4.__schema(model('Category', field('name'),
        dir('hasMany', { target: 'Category', as: 'children', through: 'CategoryLink' }),
        dir('hasMany', { target: 'Category', as: 'selves', through: 'CategoryLink', foreignKey: 'category_id', targetKey: 'category_id' })));
      K4.__schema(model('CategoryLink', dir('belongsTo', { target: 'Category' })));
      const c = Category._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'root']);
      // ONE @belongsTo to the shared model answers BOTH sides — refused.
      let err = null;
      try { await c.children(); } catch (e) { err = e; }
      expect(err?.message).toMatch(/one column cannot hold both ends of a link/);
      expect(err?.message).toMatch(/foreignKey/);
      expect(err?.message).toMatch(/targetKey/);
      // The explicitly degenerate pair takes the same refusal.
      err = null;
      try { await c.selves(); } catch (e) { err = e; }
      expect(err?.message).toMatch(/one column cannot hold both ends of a link/);
      expect(adapter.calls.length).toBe(0);
    });
  });

  test('a two-@belongsTo join with explicit keys still resolves', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT "user_id", "friend_id"/, rows(['user_id', 'friend_id'], [1, 2]));
      adapter.on(/FROM "users" WHERE "id" IN/, rows(['id', 'name'], [2, 'b']));
      const U = K4.__schema(model('User', field('name'),
        dir('hasMany', { target: 'User', as: 'friends', through: 'Friendship', foreignKey: 'user_id', targetKey: 'friend_id' })));
      K4.__schema(model('Friendship',
        dir('belongsTo', { target: 'User', as: 'user', foreignKey: 'user_id' }),
        dir('belongsTo', { target: 'User', as: 'friend', foreignKey: 'friend_id' })));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'a']);
      const friends = await u.friends();
      expect(adapter.calls[0].sql).toBe(
        'SELECT "user_id", "friend_id" FROM "friendships" WHERE "user_id" IN (?)');
      expect(friends.map((f) => f.name)).toEqual(['b']);
    });
  });

  test("the pair read applies the join's @defaultScope, matching the unlink", async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT "user_id", "team_id"/, rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red']));
      adapter.on(/^DELETE/, { columns: [{ name: 'Count' }], data: [[1]], rowCount: 1 });
      const U = throughWorld(K4, field('kind'),
        defaultScopeEntry(function () { return this.where({ kind: 'active' }); }));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      await u.teams();
      expect(adapter.calls[0].sql).toBe(
        'SELECT "user_id", "team_id" FROM "memberships" WHERE "user_id" IN (?) AND "kind" = ?');
      expect(adapter.calls[0].params).toEqual([1, 'active']);
      await u.removeTeams(10);
      const del = adapter.calls.find((c) => /^DELETE/.test(c.sql));
      expect(del.sql).toBe(
        'DELETE FROM "memberships" WHERE "user_id" = ? AND "team_id" IN (?) AND "kind" = ?');
      expect(del.params).toEqual([1, 10, 'active']);
    });
  });
});

describe('orm: the accessor memo under races', () => {
  function shopperWorld(k) {
    const U = k.__schema(model('Shopper', field('name'),
      dir('hasMany', { target: 'Purchase', foreignKey: 'shopper_id' })));
    k.__schema(model('Purchase', field('total', 'integer'),
      dir('belongsTo', { target: 'Shopper', foreignKey: 'shopper_id' })));
    return U;
  }

  test('{reload: true} supersedes an earlier in-flight plain read', async () => {
    await K4.scope(async () => {
      const adapter = holdableAdapter();
      K4.setAdapter(adapter);
      adapter.on(/FROM "purchases"/, (sql, params, count) =>
        count === 1
          ? rows(['id', 'total', 'shopper_id'], [10, 5, 1])
          : rows(['id', 'total', 'shopper_id'], [10, 5, 1], [11, 6, 1]));
      const h = adapter.hold(/FROM "purchases"/, 1);
      const U = shopperWorld(K4);
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'a']);
      const stale = u.purchases();                       // held in flight
      await tick();
      const fresh = await u.purchases({ reload: true }); // resolves second query
      expect(fresh.length).toBe(2);
      h.release();
      expect((await stale).length).toBe(1);              // the old read still answers its caller
      const before = adapter.calls.length;
      expect((await u.purchases()).length).toBe(2);      // the memo holds the reload image
      expect(adapter.calls.length).toBe(before);
    });
  });

  test('a hard destroy landing mid-read: the read resolves and memoizes nothing', async () => {
    await K4.scope(async () => {
      const adapter = holdableAdapter();
      K4.setAdapter(adapter);
      adapter.on(/FROM "purchases"/, rows(['id', 'total', 'shopper_id'], [10, 5, 1]));
      const h = adapter.hold(/FROM "purchases"/, 1);
      const U = shopperWorld(K4);
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'a']);
      const p = u.purchases();           // query in flight, held
      await tick();
      await u.destroy({ hard: true });   // _persisted flips false mid-read
      h.release();
      const out = await p;               // the data already arrived: no throw
      expect(out.length).toBe(1);
      expect(u._relMemo?.get('purchases')).toBeUndefined();
    });
  });

  test('lazy and eager through-reads agree: pair order, same hasOne pick', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT "user_id", "team_id"/, rows(['user_id', 'team_id'], [1, 11], [1, 10]));
      adapter.on(/FROM "teams"/, rows(['id', 'label'], [10, 'red'], [11, 'blue']));
      adapter.on(/FROM "users"/, rows(['id', 'name'], [1, 'a']));
      const U = throughWorld(K4);
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'a']);
      const lazy = await u.teams();
      const us = await U.includes('teams').all();
      const eager = await us[0].teams();
      expect(lazy.map((t) => t.id)).toEqual([11, 10]);   // pair order on BOTH paths
      expect(eager.map((t) => t.id)).toEqual([11, 10]);
      // hasOne through: the same pick on both paths.
      adapter.on(/^SELECT "owner_id", "badge_id"/, rows(['owner_id', 'badge_id'], [1, 99], [1, 42]));
      adapter.on(/FROM "badges"/, rows(['id', 'kind'], [42, 'silver'], [99, 'gold']));
      adapter.on(/FROM "owners"/, rows(['id', 'name'], [1, 'a']));
      const O = K4.__schema(model('Owner', field('name'),
        dir('hasOne', { target: 'Badge', through: 'Award' })));
      K4.__schema(model('Badge', field('kind')));
      K4.__schema(model('Award',
        dir('belongsTo', { target: 'Owner' }), dir('belongsTo', { target: 'Badge' })));
      const o = O._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'a']);
      expect((await o.badge()).kind).toBe('gold');       // first pair's target
      const os = await O.includes('badge').all();
      expect((await os[0].badge()).kind).toBe('gold');
    });
  });
});

describe('orm: chain starters and structured where', () => {
  test('order/limit/offset start a chain as model statics', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT/, rows(['id', 'title'], [1, 'A']));
      const Post = K4.__schema(model('Post', field('title'), dir('times')));
      await Post.order({ createdAt: 'desc' }).limit(2).offset(1).all();
      await Post.limit(2).all();
      await Post.offset(3).all();
      expect(adapter.calls.map((c) => c.sql)).toEqual([
        'SELECT * FROM "posts" ORDER BY "created_at" DESC LIMIT 2 OFFSET 1',
        'SELECT * FROM "posts" LIMIT 2',
        'SELECT * FROM "posts" OFFSET 3',
      ]);
    });
  });

  test('structured where refuses undefined values and keeps null → IS NULL', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^SELECT/, rows(['id', 'title'], [1, 'A']));
      const Post = K4.__schema(model('Post', field('title')));
      let err = null;
      try { await Post.where({ title: undefined }).all(); } catch (e) { err = e; }
      expect(err?.message).toMatch(/where\(\) value for 'title' is undefined/);
      expect(err?.message).toMatch(/pass null to match IS NULL/);
      expect(adapter.calls.length).toBe(0);
      await Post.where({ title: null }).all();
      expect(adapter.calls[0].sql).toBe('SELECT * FROM "posts" WHERE "title" IS NULL');
    });
  });
});

describe('orm: write-path honesty', () => {
  test("upsert whose RETURNING lacks the pk rejects with _persisted still false", async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^INSERT INTO "users"/, row(['name', 'email'], ['A', 'a@b.c']));
      let seen = null;
      const U = K4.__schema(model('User', field('name'), field('email', 'email', { unique: true }),
        hook('beforeSave', function () { seen = this; })));
      let err = null;
      try { await U.upsert({ name: 'A', email: 'a@b.c' }, { on: 'email' }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/upsert\(\) RETURNING for User produced no id/);
      expect(err?.message).not.toMatch(/on persisted/);
      expect(seen?._persisted).toBe(false);
    });
  });

  test('a refused UPDATE restores savedChanges and the managed timestamp', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      let fail = false;
      adapter.on(/^UPDATE "users"/, () => {
        if (fail) throw new Error('duckdb: IO Error: disk full');
        return { columns: [], data: [], rowCount: 1 };
      });
      const U = K4.__schema(model('User', field('name'), dir('times')));
      const t0 = new Date('2026-01-01T00:00:00Z');
      const u = U._hydrate(
        [{ name: 'id' }, { name: 'name' }, { name: 'created_at' }, { name: 'updated_at' }],
        [1, 'ann', t0, t0]);
      u.name = 'bea';
      await u.save();
      const goodChanges = u.savedChanges;
      const goodTs = u.updatedAt;
      expect(goodChanges.get('name')).toEqual(['ann', 'bea']);
      fail = true;
      u.name = 'cyd';
      let err = null;
      try { await u.save(); } catch (e) { err = e; }
      expect(err?.message).toMatch(/disk full/);
      // The DB refused the write: the instance reports the last save
      // that actually happened, matching the untouched snapshot.
      expect(u.savedChanges).toBe(goodChanges);
      expect(u.savedChanges.get('name')).toEqual(['ann', 'bea']);
      expect(u.updatedAt).toBe(goodTs);
      expect(u._snapshot.name).toBe('bea');
    });
  });

  test('an unreachable, never-configured default adapter names the fix', async () => {
    await K4.scope(async () => {
      const hadUrl = Object.prototype.hasOwnProperty.call(process.env, 'RIP_DB_URL');
      const priorUrl = process.env.RIP_DB_URL;
      delete process.env.RIP_DB_URL;
      try {
        // The at-import default carries the implicit marker; model it
        // with an adapter failing the way harbor's client does.
        const unreachable = {
          __schemaImplicitDefault: true,
          async query() {
            const e = new Error('db: harbor at http://127.0.0.1:4213 is unreachable: Unable to connect');
            e.name = 'ConnectionError';
            throw e;
          },
        };
        const M = K4.__schema({ kind: 'model', name: 'Lone', entries: [field('name')], adapter: unreachable });
        let err = null;
        try { await M.count(); } catch (e) { err = e; }
        expect(err?.message).toMatch(/no database is configured/);
        expect(err?.message).toMatch(/schema\.setAdapter/);
        expect(err?.message).toMatch(/RIP_DB_URL/);
        expect(err?.cause?.name).toBe('ConnectionError');
        // An explicitly-configured adapter keeps the connection message.
        const explicit = {
          async query() {
            const e = new Error('db: harbor at http://db.internal:4213 is unreachable');
            e.name = 'ConnectionError';
            throw e;
          },
        };
        const N = K4.__schema({ kind: 'model', name: 'Named', entries: [field('name')], adapter: explicit });
        err = null;
        try { await N.count(); } catch (e) { err = e; }
        expect(err?.message).toMatch(/is unreachable/);
        expect(err?.message).not.toMatch(/no database is configured/);
      } finally {
        if (hadUrl) process.env.RIP_DB_URL = priorUrl;
      }
    });
  });
});

describe('orm: zero-affected-row honesty', () => {
  test('concurrent destroy then save: the UPDATE affirms zero rows and save() throws stale', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      // DuckDB answers UPDATE/DELETE with a one-row Count column.
      adapter.on(/^UPDATE "users"/, rows(['Count'], [0]));
      adapter.on(/^DELETE FROM "users"/, rows(['Count'], [1]));
      const fired = [];
      const U = K4.__schema(model('User', field('name'), dir('times'),
        hook('afterUpdate', () => fired.push('afterUpdate')),
        hook('afterSave', () => fired.push('afterSave')),
        hook('afterCommit', () => fired.push('afterCommit'))));
      const t0 = new Date('2026-01-01T00:00:00Z');
      const cols = [{ name: 'id' }, { name: 'name' }, { name: 'created_at' }, { name: 'updated_at' }];
      const a = U._hydrate(cols, [1, 'ann', t0, t0]);
      const b = U._hydrate(cols, [1, 'ann', t0, t0]);
      await b.destroy();                      // request B deletes the row
      fired.length = 0;
      a.name = 'zoe';
      let err = null;
      try { await a.save(); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(K4.SchemaError);
      expect(err.issues).toMatchObject([{ field: 'id', error: 'stale' }]);
      expect(err.message).toMatch(/save\(\) on User id=1 matched no row — the row no longer exists/);
      // No completion hooks (was: silent success + afterCommit); state
      // restored per the failed-UPDATE path, _persisted dropped.
      expect(fired).toEqual([]);
      expect(a._persisted).toBe(false);
      expect(a.updatedAt).toBe(t0);
      expect([...a.savedChanges]).toEqual([]);
      expect(a._snapshot.name).toBe('ann');
    });
  });

  test('destroy honesty: a vanished row throws stale; a row soft-deleted elsewhere still takes the write', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^DELETE FROM "users"/, rows(['Count'], [0]));
      const U = K4.__schema(model('User', field('name')));
      const gone = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      let err = null;
      try { await gone.destroy(); } catch (e) { err = e; }
      expect(err?.issues).toMatchObject([{ field: 'id', error: 'stale' }]);
      expect(err?.message).toMatch(/destroy\(\) on User id=1 matched no row/);
      expect(gone._persisted).toBe(false);
      // A soft-deleted-elsewhere row still EXISTS, so this UPDATE
      // matches it and re-stamps deleted_at — a landed write, honestly
      // reported as one, never a stale verdict.
      adapter.on(/^UPDATE "notes"/, rows(['Count'], [1]));
      const N = K4.__schema(model('Note', field('body'), dir('softDelete')));
      const n = N._hydrate([{ name: 'id' }, { name: 'body' }, { name: 'deleted_at' }], [1, 'hi', null]);
      await n.destroy();
      expect(n.deletedAt).toBeInstanceOf(Date);
      expect(n._persisted).toBe(true);
    });
  });

  test('restore() whose UPDATE affirms zero rows throws stale', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^UPDATE "notes"/, rows(['Count'], [0]));
      const N = K4.__schema(model('Note', field('body'), dir('softDelete')));
      const t0 = new Date('2026-01-01T00:00:00Z');
      const n = N._hydrate([{ name: 'id' }, { name: 'body' }, { name: 'deleted_at' }], [1, 'hi', t0]);
      let err = null;
      try { await n.restore(); } catch (e) { err = e; }
      expect(err?.issues).toMatchObject([{ field: 'id', error: 'stale' }]);
      expect(err?.message).toMatch(/restore\(\) on Note id=1 matched no row/);
      expect(n._persisted).toBe(false);
      expect(n.deletedAt).toBe(t0);       // the un-delete never landed
    });
  });

  test('a truthless mutation answer (bare rowCount, empty result set) is "did not say", never a stale verdict', async () => {
    await K4.scope(async () => {
      // The recording adapter's default answer is the cart-style shape:
      // {columns: [], data: [], rowCount: 0}. Contract v2's rowCount
      // counts RESULT rows, and a no-RETURNING UPDATE legitimately
      // answers an empty set whatever it matched — only DuckDB's
      // affirmative Count shape can prove "zero rows affected".
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const U = K4.__schema(model('User', field('name')));
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      u.name = 'bea';
      await u.save();
      expect(u._persisted).toBe(true);
      expect(u._snapshot.name).toBe('bea');
    });
  });
});

describe('orm: transaction integrity', () => {
  test('restore() settles afterCommit like save and destroy — immediately outside a transaction, at COMMIT inside one', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^UPDATE "notes"/, rows(['Count'], [1]));
      const log = [];
      const N = K4.__schema(model('Note', field('body'), dir('softDelete'),
        hook('afterCommit', function () { log.push('commit'); })));
      const n = N._hydrate([{ name: 'id' }, { name: 'body' }, { name: 'deleted_at' }], [1, 'hi', new Date()]);
      await n.restore();
      expect(log).toEqual(['commit']);
      log.length = 0;
      await K4.transaction(async () => {
        await n.destroy();
        await n.restore();
        log.push('inside');
      });
      // destroy + restore on one instance dedupe to ONE callback, at COMMIT
      expect(log).toEqual(['inside', 'commit']);
    });
  });

  test('a throwing afterRollback never replaces the transaction error; it rides the cause chain', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^INSERT/, row(['id', 'name'], [1, 'a']));
      const U = K4.__schema(model('User', field('name'),
        hook('afterRollback', function () { throw new Error('hook exploded'); })));
      let err = null;
      try {
        await K4.transaction(async () => {
          await U.create({ name: 'a' });
          throw new Error('the real error');
        });
      } catch (e) { err = e; }
      expect(err?.message).toBe('the real error');
      expect(err?.cause?.message).toBe('hook exploded');
    });
  });

  test('one throwing afterCommit cancels none of the rest; several failures aggregate after the flush', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      let n = 0;
      adapter.on(/^INSERT/, (sql, params) => row(['id', 'name'], [++n, params[0]]));
      const ran = [];
      const U = K4.__schema(model('User', field('name'),
        hook('afterCommit', function () {
          if (this.name.startsWith('boom')) throw new Error(this.name);
          ran.push(this.name);
        })));
      let err = null;
      try {
        await K4.transaction(async () => {
          await U.create({ name: 'boom1' });
          await U.create({ name: 'ok' });
          await U.create({ name: 'boom2' });
        });
      } catch (e) { err = e; }
      expect(ran).toEqual(['ok']);
      expect(err).toBeInstanceOf(AggregateError);
      expect(err.errors.map((e) => e.message)).toEqual(['boom1', 'boom2']);
      // a single failure rethrows itself, un-wrapped
      ran.length = 0;
      err = null;
      try {
        await K4.transaction(async () => {
          await U.create({ name: 'boom3' });
          await U.create({ name: 'ok2' });
        });
      } catch (e) { err = e; }
      expect(ran).toEqual(['ok2']);
      expect(err?.message).toBe('boom3');
      expect(err instanceof AggregateError).toBe(false);
    });
  });

  test('ROLLBACK restores enqueued instance state before afterRollback runs; a post-rollback save() re-creates', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      let n = 0;
      adapter.on(/^INSERT INTO "users"/, () => row(['id', 'name'], [++n === 1 ? 42 : 43, 'ann']));
      const observed = [];
      const U = K4.__schema(model('User', field('name'),
        hook('afterRollback', function () {
          observed.push({ persisted: this._persisted, id: this.id, snapshot: this._snapshot });
        })));
      let leaked = null;
      let err = null;
      try {
        await K4.transaction(async () => {
          leaked = await U.create({ name: 'ann' });
          throw new Error('later step failed');
        });
      } catch (e) { err = e; }
      expect(err?.message).toBe('later step failed');
      // The hook observed the revoked-write truth, never the phantom row.
      expect(observed).toEqual([{ persisted: false, id: undefined, snapshot: null }]);
      expect(leaked._persisted).toBe(false);
      expect('id' in leaked).toBe(false);
      // Active-Record semantics: a post-rollback save() takes the
      // INSERT arm and re-creates under a fresh identity.
      await leaked.save();
      expect(leaked._persisted).toBe(true);
      expect(leaked.id).toBe(43);
      const tail = adapter.calls.slice(-2).map((c) => c.sql.split(' ')[0]);
      expect(tail).toEqual(['<ROLLBACK>', 'INSERT']);
    });
  });

  test('a failing COMMIT is indeterminate: neither hook family runs, state stays, the error says so', async () => {
    await K4.scope(async () => {
      const handleCalls = [];
      const adapter = {
        async query() { return { columns: [], data: [], rowCount: 0 }; },
        async begin() {
          return {
            async query(sql) {
              handleCalls.push(sql);
              return { columns: [{ name: 'id' }, { name: 'name' }], data: [[1, 'a']], rowCount: 1 };
            },
            async commit() { throw new Error('network dropped mid-COMMIT'); },
            async rollback() { handleCalls.push('<ROLLBACK>'); },
          };
        },
      };
      K4.setAdapter(adapter);
      const log = [];
      const U = K4.__schema(model('User', field('name'),
        hook('afterCommit', () => log.push('commit')),
        hook('afterRollback', () => log.push('rollback'))));
      let leaked = null;
      let err = null;
      try {
        await K4.transaction(async () => { leaked = await U.create({ name: 'a' }); });
      } catch (e) { err = e; }
      expect(err?.message).toMatch(/COMMIT failed — the transaction outcome is indeterminate/);
      expect(err?.message).toMatch(/writes to User may or may not have been applied/);
      expect(err?.message).toMatch(/Neither afterCommit nor afterRollback hooks ran/);
      expect(err?.cause?.message).toBe('network dropped mid-COMMIT');
      expect(log).toEqual([]);
      // Unknown is not rolled-back: the instance keeps its written state.
      expect(leaked._persisted).toBe(true);
      expect(leaked.id).toBe(1);
      expect(handleCalls).not.toContain('<ROLLBACK>');
    });
  });

  test('an adopted transaction settles hooks with the ambience unbound: autocommit statements, never the dead handle', async () => {
    await K4.scope(async () => {
      const calls = [];
      let committed = false;
      const answer = () => ({ columns: [{ name: 'id' }, { name: 'name' }], data: [[calls.length, 'x']], rowCount: 1 });
      const adapter = {
        async query(sql) { calls.push({ where: 'autocommit', post: committed, sql }); return answer(); },
        capabilities: { tx: true },
      };
      K4.setAdapter(adapter);
      const handle = {
        async query(sql) { calls.push({ where: 'tx-handle', post: committed, sql }); return answer(); },
      };
      let hookRuns = 0;
      const U = K4.__schema(model('User', field('name'),
        hook('afterCommit', async function () {
          hookRuns++;
          if (hookRuns <= 2) await U.create({ name: 'cascade-' + hookRuns });
        })));
      await orm4.adoptTransaction(adapter, handle, async (settle) => {
        await U.create({ name: 'seed' });   // enrolls on the adopted handle
        committed = true;                   // the owner's COMMIT lands here
        await settle('afterCommit');
      });
      // The seed rode the handle; every hook write ran autocommit and
      // settled immediately — identical to the native path, and the
      // flush stayed finite because nothing re-enqueued onto the store.
      expect(calls.filter((c) => c.where === 'tx-handle').length).toBe(1);
      expect(calls.filter((c) => c.where === 'tx-handle' && c.post).length).toBe(0);
      expect(calls.filter((c) => c.where === 'autocommit' && c.post).length).toBe(2);
      expect(hookRuns).toBe(3);
    });
  });
});

describe('orm: addX under the unique-pair race', () => {
  const duplicateKey = () =>
    new Error('Constraint Error: Duplicate key "user_id: 1, team_id: 10" violates unique constraint');
  const throughWorld = () => {
    const U = K4.__schema(model('User', field('name'),
      dir('hasMany', { target: 'Team', through: 'Membership' })));
    K4.__schema(model('Team', field('label')));
    K4.__schema(model('Membership',
      dir('belongsTo', { target: 'User' }), dir('belongsTo', { target: 'Team' })));
    return U;
  };

  test('a unique violation for the racing tuple is the no-op it means: honest added-count, no throw', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      let reads = 0;
      adapter.on(/^SELECT "user_id", "team_id" FROM "memberships"/, () =>
        ++reads === 1 ? rows(['user_id', 'team_id']) : rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/^INSERT INTO "memberships"/, () => { throw duplicateKey(); });
      const U = throughWorld();
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      expect(await u.addTeams(10)).toBe(0);
      expect(adapter.calls.filter((c) => c.sql.startsWith('INSERT')).length).toBe(1);
      expect(reads).toBe(2);
    });
  });

  test('a partial race retries only the still-missing tuples and reports what it actually wrote', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      let reads = 0;
      let inserts = 0;
      adapter.on(/^SELECT "user_id", "team_id" FROM "memberships"/, () =>
        ++reads === 1 ? rows(['user_id', 'team_id']) : rows(['user_id', 'team_id'], [1, 10]));
      adapter.on(/^INSERT INTO "memberships"/, () => {
        if (++inserts === 1) throw duplicateKey();   // the two-tuple statement loses to the race
        return rows(['id', 'user_id', 'team_id'], [7, 1, 11]);
      });
      const U = throughWorld();
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      expect(await u.addTeams([10, 11])).toBe(1);
      const insertCalls = adapter.calls.filter((c) => c.sql.startsWith('INSERT'));
      expect(insertCalls.length).toBe(2);
      expect(insertCalls[1].params).toEqual([1, 11]);   // only the still-missing tuple retried
    });
  });

  test('a unique violation that is NOT the race rethrows untouched', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      // the re-read shows nothing linked: no shrink, so the violation
      // was some other constraint (an attrs column, say)
      adapter.on(/^SELECT "user_id", "team_id" FROM "memberships"/, rows(['user_id', 'team_id']));
      adapter.on(/^INSERT INTO "memberships"/, () => { throw duplicateKey(); });
      const U = throughWorld();
      const u = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      let err = null;
      try { await u.addTeams(10); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(K4.SchemaError);
      expect(err.issues).toMatchObject([{ error: 'unique' }]);
    });
  });

  test('the runtime alone cannot close the race — the unique pair index the DDL derives is the closer', async () => {
    await K4.scope(async () => {
      const pending = [];
      const calls = [];
      const adapter = {
        calls,
        async query(sql, params = []) {
          calls.push({ sql, params });
          return new Promise((resolve) => pending.push({ sql, resolve }));
        },
      };
      K4.setAdapter(adapter);
      const U = throughWorld();
      const u1 = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      const u2 = U._hydrate([{ name: 'id' }, { name: 'name' }], [1, 'ann']);
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const p1 = u1.addTeams(10);
      const p2 = u2.addTeams(10);
      await tick();
      // both linked-set reads answer "no links" before either insert
      pending.splice(0).forEach((p) => p.resolve(rows(['user_id', 'team_id'])));
      await tick();
      pending.splice(0).forEach((p, i) => p.resolve(rows(['id', 'user_id', 'team_id'], [100 + i, 1, 10])));
      expect(await p1).toBe(1);
      expect(await p2).toBe(1);
      expect(calls.filter((c) => c.sql.startsWith('INSERT')).length).toBe(2);
    });
  });
});

describe('orm: temporal columns hydrate as instants', () => {
  const eventCols = ['id', 'title', 'starts_on', 'at', 'created_at', 'updated_at'].map((name) => ({ name }));
  const eventModel = () => K4.__schema(model('Event',
    field('title'), field('startsOn', 'date'), field('at', 'datetime'), dir('times')));

  test('declared date/datetime columns coerce wire strings and epoch numbers to the codec instants; a string field never', async () => {
    await K4.scope(async () => {
      K4.setAdapter(recordingAdapter());
      const E = eventModel();
      const e = E._hydrate(eventCols,
        [1, '2026-08-01', '2026-08-01', '2026-08-01 10:30:00', '2026-08-01T10:30:00.123Z', 1754994600000]);
      expect(e.title).toBe('2026-08-01');                                  // string-declared: untouched
      expect(e.startsOn).toBeInstanceOf(Date);
      expect(e.startsOn.getTime()).toBe(Date.UTC(2026, 7, 1));             // bare date = UTC midnight
      expect(e.at.getTime()).toBe(Date.UTC(2026, 7, 1, 10, 30, 0));        // naive wall-clock = UTC
      expect(e.createdAt.getTime()).toBe(Date.UTC(2026, 7, 1, 10, 30, 0, 123));
      expect(e.updatedAt.getTime()).toBe(1754994600000);                   // epoch milliseconds
      // toJSON now emits ISO consistently, whatever the wire spelled
      expect(JSON.parse(JSON.stringify(e))).toMatchObject({
        startsOn: '2026-08-01T00:00:00.000Z',
        at: '2026-08-01T10:30:00.000Z',
      });
    });
  });

  test('harbor-delivered Dates pass through identically; a string hydration then no-op saves', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const E = eventModel();
      const d = new Date('2026-08-01T10:30:00Z');
      const fromHarbor = E._hydrate(eventCols, [1, 't', d, d, d, d]);
      expect(fromHarbor.at).toBe(d);                    // no double conversion
      const fromStrings = E._hydrate(eventCols,
        [2, 't', '2026-08-01', '2026-08-01 10:30:00', '2026-08-01 10:30:00', '2026-08-01 10:30:00']);
      const before = adapter.calls.length;
      await fromStrings.save();                         // snapshot saw the coerced value
      expect(adapter.calls.length).toBe(before);        // no-op: no SQL
    });
  });

  test('an unparseable value in a declared temporal column is adapter breakage, named', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      const E = eventModel();
      let err = null;
      try {
        E._hydrate(eventCols, [1, 't', 'not-a-date', '2026-08-01 10:30:00', null, null]);
      } catch (e) { err = e; }
      expect(err?.message).toMatch(/row hydration adapter invariant — column 'starts_on' is declared date/);
      expect(err?.message).toMatch(/"not-a-date"/);
      // The absorption path holds the same line on RETURNING rows.
      adapter.on(/^INSERT INTO "events"/, row(['id', 'title', 'at', 'created_at', 'updated_at'],
        [1, 't', '2026-08-01 10:30:00', 'garbage', 'garbage']));
      err = null;
      try { await E.create({ title: 't', startsOn: '2026-08-01', at: '2026-08-01T10:30:00Z' }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/row absorption adapter invariant — column 'created_at' is declared datetime/);
    });
  });

  test('RETURNING absorption coerces the same way: create() lands Dates on the instance', async () => {
    await K4.scope(async () => {
      const adapter = recordingAdapter();
      K4.setAdapter(adapter);
      adapter.on(/^INSERT INTO "events"/, row(['id', 'title', 'starts_on', 'at', 'created_at', 'updated_at'],
        [1, 't', '2026-08-01', '2026-08-01 10:30:00', '2026-08-01 10:30:00.123', 1754994600000]));
      const E = eventModel();
      const e = await E.create({ title: 't', startsOn: '2026-08-01', at: '2026-08-01T10:30:00Z' });
      expect(e.startsOn.getTime()).toBe(Date.UTC(2026, 7, 1));
      expect(e.at.getTime()).toBe(Date.UTC(2026, 7, 1, 10, 30, 0));
      expect(e.createdAt.getTime()).toBe(Date.UTC(2026, 7, 1, 10, 30, 0, 123));
      expect(e.updatedAt).toBeInstanceOf(Date);
    });
  });
});

describe('orm: errors speak the caller namespace', () => {
  test('structured where()/updateAll() rejections echo the key as written over a property inventory', async () => {
    await K4.scope(async () => {
      K4.setAdapter(recordingAdapter());
      const U = K4.__schema(model('User', field('firstName'), dir('times')));
      let err = null;
      try { await U.where({ firstNme: 'x' }).all(); } catch (e) { err = e; }
      expect(err?.message).toMatch(
        /unknown where\(\) key 'firstNme' — known: createdAt \(column created_at\), firstName \(column first_name\), id, updatedAt \(column updated_at\)/);
      // updateAll inventories only the caller-writable set — the
      // managed timestamp is named nowhere because it is not writable.
      err = null;
      try { await U.where({}).updateAll({ createdAt: new Date() }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/unknown updateAll\(\) key 'createdAt' — known: firstName \(column first_name\)/);
    });
  });

  test('a duplicate canonical column names the table and both source columns', async () => {
    await K4.scope(async () => {
      K4.setAdapter(recordingAdapter());
      const U = K4.__schema(model('User', field('firstName')));
      let err = null;
      try { U._hydrate([{ name: 'first_name' }, { name: 'firstName' }], ['a', 'b']); } catch (e) { err = e; }
      expect(err?.message).toMatch(
        /duplicate canonical column 'firstName' on table "users": columns 'first_name' and 'firstName' both canonicalize to it/);
    });
  });
});

describe('orm: once-directives (runtime layer)', () => {
  test('@times and @softDelete declared twice reject as once-directives', async () => {
    await K4.scope(() => {
      const T = K4.__schema(model('Stamped', field('name'), dir('times'), dir('times')));
      expect(() => T._normalize()).toThrow(/duplicate '@times' — declared twice; a :model declares it once/);
      const S = K4.__schema(model('Softened', field('name'), dir('softDelete'), dir('softDelete')));
      expect(() => S._normalize()).toThrow(/duplicate '@softDelete' — declared twice; a :model declares it once/);
    });
  });
});
