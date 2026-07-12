// Defensive hardening pins — each asserts the CORRECT behavior for a
// place where the runtime's observed behavior diverged from its
// documented contract. Every test here is a regression net: it fails
// against the pre-fix code and passes once the fix lands. Mock
// recording adapters stand in for a database — no network, no real DB.
import { test, expect, describe } from 'bun:test';
import { recordingAdapter, row } from '../support/recording-adapter.js';

const rt = await import('../../src/runtime/schema.js');
const orm = await import('../../src/runtime/schema-orm.js');

const field = (name, typeName = 'string', opts = {}) => ({
  tag: 'field', name,
  modifiers: opts.optional ? ['?'] : ['!'],
  typeName, array: opts.array === true,
  ...(opts.unique ? { unique: true } : {}),
  ...(opts.constraints ? { constraints: opts.constraints } : {}),
});
const dir = (name, ...args) => ({ tag: 'directive', name, args });

function setup(...entries) {
  rt.__SchemaRegistry.reset();
  const adapter = recordingAdapter();
  orm.__schemaSetAdapter(adapter);
  return adapter;
}
function model(name, ...entries) {
  return rt.__schema({ kind: 'model', name, entries });
}

// ── SQL construction: identifiers, pagination, empty IN ──────────────

describe('ORM query builder never emits structurally-unsafe SQL', () => {
  test('an object filter key is quoted as ONE identifier — an embedded quote cannot break out', async () => {
    setup();
    const M = model('WhereProbe', field('name', 'string', { optional: true }));
    const adapter = orm.__schemaGetAdapter ? null : null;
    const a = recordingAdapter();
    orm.__schemaSetAdapter(a);
    await M.where({ ['x" OR 1=1 --']: 'v' }).all();
    const sql = a.calls[0].sql;
    // The embedded quote is doubled (SQL identifier escaping), so the
    // whole key stays inside one "..." — the injected text never
    // becomes SQL structure. Quotes are balanced (even count) and the
    // predicate stays a single parameterized comparison.
    expect(sql).toBe('SELECT * FROM "where_probes" WHERE "x"" or 1=1 --" = ?');
    expect((sql.match(/"/g) || []).length % 2).toBe(0);
    expect(a.calls[0].params).toEqual(['v']);
  });

  test('limit and offset require non-negative integers; raw text rejects', async () => {
    setup();
    const M = model('PageProbe', field('name'));
    expect(() => M.where({}).limit('1; DROP TABLE users; --')).toThrow();
    expect(() => M.where({}).offset('0 UNION SELECT secret FROM creds')).toThrow();
    expect(() => M.where({}).limit(-1)).toThrow();
    expect(() => M.where({}).limit(1.5)).toThrow();
    // Legal integers pass and interpolate as bare numbers.
    const a = recordingAdapter();
    orm.__schemaSetAdapter(a);
    await M.where({}).limit(10).offset(20).all();
    expect(a.calls[0].sql).toContain('LIMIT 10');
    expect(a.calls[0].sql).toContain('OFFSET 20');
  });

  test('an empty IN array becomes an always-false predicate, never "IN ()"', async () => {
    setup();
    const M = model('EmptyInProbe', field('name'));
    const a = recordingAdapter();
    orm.__schemaSetAdapter(a);
    await M.where({ id: [] }).all();
    const sql = a.calls[0].sql;
    expect(sql).not.toContain('IN ()');
    // Matches nothing — a constant-false condition.
    expect(sql).toMatch(/1 = 0|1=0|IN \(NULL\)/);
  });
});

// ── validation runs the FULL contract, not just field checks ─────────

describe('validation runs @ensure refinements everywhere it validates', () => {
  test('create() runs @ensure and refuses to persist a row safe() rejects', async () => {
    const a = setup();
    const M = model('EnsureModelProbe',
      field('start', 'integer'), field('finish', 'integer'),
      { tag: 'ensure', message: 'finish must follow start', fn: (x) => x.finish > x.start });
    // The schema's own safe() already rejects it.
    expect(M.safe({ start: 10, finish: 5 }).ok).toBe(false);
    // Persistence must apply the SAME contract — reject, and emit no SQL.
    await expect(M.create({ start: 10, finish: 5 })).rejects.toThrow(/finish must follow start/);
    expect(a.calls.length).toBe(0);
  });

  test('a nested schema value runs its own @ensure — a bad child fails the parent', () => {
    rt.__SchemaRegistry.reset();
    rt.__schema({ kind: 'shape', name: 'NestedChildProbe',
      entries: [field('a', 'integer'), { tag: 'ensure', message: 'a must be positive', fn: (x) => x.a > 0 }] });
    const Parent = rt.__schema({ kind: 'shape', name: 'NestedParentProbe',
      entries: [field('child', 'NestedChildProbe')] });
    const r = Parent.safe({ child: { a: -1 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /a must be positive/.test(e.message))).toBe(true);
  });
});

// ── persistence targets and instance state stay coherent ─────────────

describe('persistence uses the loaded identity, not mutable in-memory state', () => {
  test('destroy targets the hydrated key even after id is reassigned in memory', async () => {
    const a = setup();
    a.on(/^SELECT/, row(['id', 'name'], [1, 'A']));
    const M = model('DestroyPkProbe', field('name'));
    const m = await M.first();
    m.id = 999; m.name = 'B';
    await m.save();
    await m.destroy({ hard: true });
    const del = a.calls.find((c) => c.sql.startsWith('DELETE'));
    // The DELETE targets the row that was loaded (1), not the mutated id.
    expect(del.params).toEqual([1]);
  });

  test('a no-row upsert does not mark the instance persisted (no phantom key)', async () => {
    rt.__SchemaRegistry.reset();
    const a = recordingAdapter();
    orm.__schemaSetAdapter(a);
    // The DO NOTHING upsert hits a conflict and returns no row; a plain
    // follow-up INSERT gets a real id (first-match-wins rule order).
    a.on(/ON CONFLICT/, { columns: [], data: [], rowCount: 0 });
    a.on(/^INSERT/, row(['id'], [1]));
    const M = model('UpsertProbe', field('email', 'email', { unique: true }));
    const m = await M.upsert({ email: 'a@b.co' }, { on: 'email' });
    expect(m._persisted).toBe(false);
    // A follow-up save must never emit an UPDATE keyed on a null pk.
    m.email = 'b@b.co';
    await m.save();
    const nullWhere = a.calls.find((c) => /UPDATE/.test(c.sql) && c.params.includes(null));
    expect(nullWhere).toBeUndefined();
  });

  test('changing a belongs-to FK invalidates the memoized relation', async () => {
    rt.__SchemaRegistry.reset();
    const a = recordingAdapter();
    orm.__schemaSetAdapter(a);
    a.on(/FROM "users"/, (sql, params) => row(['id', 'name'], [params[0], params[0] === 1 ? 'One' : 'Two']));
    model('User', field('name'));
    const P = model('Post', dir('belongs_to', { target: 'User' }));
    const p = P._hydrate([{ name: 'id' }, { name: 'user_id' }], [10, 1]);
    expect((await p.user()).name).toBe('One');
    p.userId = 2;
    expect((await p.user()).name).toBe('Two');
  });
});

// ── legal-but-empty and unknown-field inputs ─────────────────────────

describe('inserts and inputs stay valid SQL / reject typos', () => {
  test('a model with no supplied values inserts DEFAULT VALUES, not "() VALUES ()"', async () => {
    const a = setup();
    a.on(/^INSERT/, row(['id'], [1]));
    const M = model('DefaultInsertProbe', field('note', 'string', { optional: true }));
    await M.create({});
    const ins = a.calls.find((c) => c.sql.startsWith('INSERT'));
    expect(ins.sql).toContain('DEFAULT VALUES');
    expect(ins.sql).not.toContain('() VALUES ()');
  });

  test('an unknown create field is rejected, not silently kept on the instance', async () => {
    setup();
    const M = model('TypoProbe', field('name'));
    await expect(M.create({ name: 'Alice', naem: 'typo' })).rejects.toThrow(/unknown field/i);
  });
});

// ── array length constraints are enforced, not only advertised ───────

describe('runtime validation enforces array length constraints', () => {
  test('a 1..2 array rejects lengths 0 and 3, accepts 1 and 2', () => {
    rt.__SchemaRegistry.reset();
    const S = rt.__schema({ kind: 'shape', name: 'ArrayRangeProbe',
      entries: [field('tags', 'string', { array: true, constraints: { min: 1, max: 2 } })] });
    expect(S.safe({ tags: [] }).ok).toBe(false);
    expect(S.safe({ tags: ['a', 'b', 'c'] }).ok).toBe(false);
    expect(S.safe({ tags: ['a'] }).ok).toBe(true);
    expect(S.safe({ tags: ['a', 'b'] }).ok).toBe(true);
  });
});
