// Model.factory() — schema-driven fabrication with fake data.
// Sign convention: positive persists, zero/negative builds unsaved,
// pipe-table strings create exact rows.
import { test, expect, describe, beforeEach } from 'bun:test';
import { __schema, __SchemaRegistry } from '../../src/runtime/schema.js';
import { __schemaSetAdapter } from '../../src/runtime/orm.js';
import { fake } from '../../src/runtime/fake.js';
import { recordingAdapter, row } from '../support/recording-adapter.js';

const field = (name, typeName = 'string', opts = {}) => ({
  tag: 'field', name,
  modifiers: opts.optional ? ['?'] : ['!'],
  typeName,
  array: false,
  ...(opts.unique ? { unique: true } : {}),
  ...(opts.literals ? { literals: opts.literals } : {}),
  ...(opts.constraints ? { constraints: opts.constraints } : {}),
});
const dir = (name, ...args) => ({ tag: 'directive', name, args });
const method = (name, fn) => ({ tag: 'method', name, fn });
const model = (name, ...entries) => ({ kind: 'model', name, entries });

let adapter;
beforeEach(() => {
  __SchemaRegistry.reset();
  adapter = recordingAdapter();
  adapter.on(/INSERT INTO/i, (sql, params) => row(['id'], [42]));
  __schemaSetAdapter(adapter);
});

const definePatient = () =>
  __schema(model('FactoryPatient',
    field('firstName'),
    field('lastName'),
    field('sex', 'string', { optional: true, literals: ['M', 'F', 'O', 'U'] }),
    field('email', 'email', { optional: true }),
    field('phone', 'phone', { optional: true }),
    field('dob', 'string', { optional: true }),
  ));

describe('factory: sign convention', () => {
  test('factory(0) and factory(-1) build one unsaved instance', async () => {
    const P = definePatient();
    for (const n of [0, -1]) {
      adapter.calls.length = 0;
      const p = await P.factory(n);
      expect(typeof p.firstName).toBe('string');
      expect(p.firstName.length).toBeGreaterThan(0);
      expect(typeof p.lastName).toBe('string');
      expect(adapter.calls.filter((c) => /INSERT/i.test(c.sql)).length).toBe(0);
    }
  });

  test('factory(-3) builds three unsaved instances', async () => {
    const P = definePatient();
    const ary = await P.factory(-3);
    expect(ary.length).toBe(3);
    expect(adapter.calls.filter((c) => /INSERT/i.test(c.sql)).length).toBe(0);
  });

  test('factory(1) creates one, factory(3) creates three', async () => {
    const P = definePatient();
    const one = await P.factory(1);
    expect(Array.isArray(one)).toBe(false);
    const ary = await P.factory(3);
    expect(ary.length).toBe(3);
    expect(adapter.calls.filter((c) => /INSERT/i.test(c.sql)).length).toBe(4);
  });
});

describe('factory: schema-derived values', () => {
  test('enum literals are sampled, email/phone types produce valid shapes', async () => {
    fake.seed(7);
    const P = definePatient();
    const ps = await P.factory(-10);
    for (const p of ps) {
      if (p.sex != null) expect(['M', 'F', 'O', 'U']).toContain(p.sex);
      if (p.email != null) expect(p.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
      if (p.phone != null) expect(p.phone).toMatch(/^\(\d{3}\) \d{3}-\d{4}/);
    }
    fake.seed();
  });

  test('fake.seed makes runs reproducible', async () => {
    const P = definePatient();
    fake.seed(1234);
    const a = await P.factory(-2);
    fake.seed(1234);
    const b = await P.factory(-2);
    expect(a.map((x) => x.firstName)).toEqual(b.map((x) => x.firstName));
    expect(a.map((x) => x.email)).toEqual(b.map((x) => x.email));
    fake.seed();
  });

  test('plain-object argument overrides derived values', async () => {
    const P = definePatient();
    const p = await P.factory(0, { firstName: 'Zed', sex: 'M' });
    expect(p.firstName).toBe('Zed');
    expect(p.sex).toBe('M');
  });

  test('a declared seed method wins over derivation', async () => {
    const S = __schema(model('FactorySeeded',
      field('firstName'),
      field('lastName'),
      method('seed', (opts = {}) => ({ firstName: 'Recipe', ...(opts || {}) })),
    ));
    const s = await S.factory(0);
    expect(s.firstName).toBe('Recipe');
    const s2 = await S.factory(0, { lastName: 'Override' });
    expect(s2.lastName).toBe('Override');
  });
});

describe('factory: pipe tables', () => {
  test('creates exact rows from a pipe-table literal, typed by schema', async () => {
    const T = __schema(model('FactoryTest',
      field('code'),
      field('name'),
      field('price', 'integer'),
    ));
    const made = await T.factory(`
      code   | name                 | price
      005009 | Complete Blood Count | 2800
      322000 | Basic Metabolic      | 4200
    `);
    expect(made.length).toBe(2);
    const inserts = adapter.calls.filter((c) => /INSERT/i.test(c.sql));
    expect(inserts.length).toBe(2);
    expect(inserts[0].params).toContain('005009');
    expect(inserts[0].params).toContain(2800);
  });
});

describe('factory: foreign keys are never invented', () => {
  test('persisting without a required belongsTo FK throws a named error', async () => {
    __schema(model('FactoryOwner', field('name')));
    const C = __schema(model('FactoryChild',
      field('label'),
      dir('belongs_to', { target: 'FactoryOwner', optional: false }),
    ));
    await expect(C.factory(1)).rejects.toThrow(/factoryOwnerId.*explicitly|required foreign key/);
    const built = await C.factory(0, { factoryOwnerId: 7 });
    expect(built.label).toBeDefined();
  });
});
