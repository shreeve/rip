// The schema type story — the shared renderer's contract
// through BOTH consumers:
//
//   1. `.d.ts` SHAPES per kind: the pinned `declarations === ''` gap
//      is closed — intrinsics per-file , two tiers), aliases
//      + a typed `declare const` per schema, export prefixes, field
//      types faithful to the descriptor norm (optionals, arrays,
//      literal unions, coercions, same-file schema references,
//      unknown names as honest `unknown`).
//   2. FACE pins: the binding cast, callable `this` parameters per
//      the runtime's real calling conventions ), the
//      intrinsic block's synthetic mapping row, alias cover rows,
//      export prefixes, strip identity under every delivery.
//   3. COLLISION rejections ): intrinsic names, alias-vs-
//      alias, user type declarations — loud in both artifacts, JS
//      shipping output untouched.
//   4. NAMING DRIFT gates: the shared snake/camel/pluralize rules in
//      src/runtime/vocab.js derive the runtime's INSTALLED accessor
//      names. The renderer and the ORM both read vocab, so there are
//      no copies to license — these gates hold the shared rule to what
//      the ORM actually installs, which is the half a single
//      definition cannot prove on its own.
import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { compile, CompileError } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';
import { pluralize } from '../../src/runtime/vocab.js';

const rt4 = await import('../../src/runtime/schema.js');
await import('../../src/runtime/orm.js');

const dts = (src) => compile(src).declarations;
const face = (src, opts = {}) => compile(src, { runtimeDelivery: 'none', face: 'ts', ...opts });
const js = (src, opts = {}) => compile(src, { runtimeDelivery: 'none', ...opts });

// ── 1. `.d.ts` shapes per kind ───────────────────────────────────────

describe('schema declarations: the per-kind shapes', () => {
  test(':input — fields only, the bare name IS the parsed type', () => {
    const d = dts('S = schema :input\n  email! email\n  age? ~integer\n  tags? string[]\n  st? "a" | "b"');
    expect(d).toContain('type S = { email: string; age?: number; tags?: string[]; st?: "a" | "b" };');
    expect(d).toContain('declare const S: Schema<S, S>;');
  });

  test(':shape with behavior — Data split; computed readonly, methods honest fallbacks', () => {
    const d = dts('A = schema :shape\n  street! string\n  full: ~> @street\n  label: (p) -> p\n  size: !> @street.length');
    expect(d).toContain('type AData = { street: string };');
    expect(d).toContain('type A = AData & { size: unknown; readonly full: unknown; label: (...args: any[]) => unknown };');
    expect(d).toContain('declare const A: Schema<A, AData>;');
  });

  test(':shape without behavior collapses to one bare name', () => {
    const d = dts('B = schema :shape\n  x! integer');
    expect(d).toContain('type B = { x: number };');
    expect(d).toContain('declare const B: Schema<B, B>;');
  });

  test(':mixin — a fields type AND a binding typed by what the runtime actually serves', () => {
    const d = dts('T = schema :mixin\n  createdAt! datetime\nU = schema :shape\n  name! string\n  @mixin T');
    expect(d).toContain('type T = { createdAt: Date };');
    expect(d).toContain('declare const T: MixinSchema<T>;');
    expect(d).toContain('type U = { name: string } & T;');
    // Two rules, both the runtime's. The parse surface is ABSENT — a
    // mixin is not instantiable (`parse` throws, `safe` fails, `ok` is
    // false), so the checker refuses those instead of the runtime
    // throwing. The projection algebra is PRESENT — `derive`
    // refuses only :union and :enum, and a mixin derivation is a plain
    // instantiable :shape — so pick/omit/partial/required/extend answer,
    // and the merged Schema declaration lets `extend` take a mixin.
    expect(d).toContain('interface MixinSchema<Out> {');
    expect(d).toContain('  toJSONSchema(): Record<string, unknown>;');
    expect(d).toContain('  pick<K extends keyof Out>(...keys: K[]): Schema<Pick<Out, K>, Pick<Out, K>>;');
    expect(d).toContain('  partial(): Schema<Partial<Out>, Partial<Out>>;');
    expect(d).toContain('  extend<U>(other: Schema<U, any> | MixinSchema<U>): Schema<Out & U, Out & U>;');
    expect(d).toContain('  extend<U>(other: MixinSchema<U>): Schema<In & U, In & U>;');
    expect(d).not.toMatch(/interface MixinSchema<Out> \{[^}]*\bparse\(/);
  });

  test('the mixin tier emits only where a :mixin exists', () => {
    // The persistence tier's rule. Without it, every schema file in every
    // project carries an interface it has no use for.
    expect(dts('B = schema :shape\n  x! number')).not.toContain('MixinSchema');
  });

  test(':enum — bare members narrow (`data is`), valued members answer boolean (the runtime accepts names too)', () => {
    const bare = dts('R = schema :enum\n  :admin\n  :viewer');
    expect(bare).toContain('type R = "admin" | "viewer";');
    expect(bare).toContain('ok(data: unknown): data is R;');
    const valued = dts('St = schema :enum\n  :pending 0\n  :active 1');
    expect(valued).toContain('type St = 0 | 1;');
    expect(valued).toContain('ok(data: unknown): boolean;');
    expect(valued).not.toContain('data is St');
    // the async family and array combinator the compiler runtime serves
    expect(bare).toContain('parseAsync(data: unknown): Promise<R>;');
    expect(bare).toContain('array: ArraySchema<R>;');
  });

  test(':union — the constituent union; an out-of-module constituent degrades to unknown', () => {
    const d = dts('C = schema :shape\n  kind! "c"\nD = schema :shape\n  kind! "d"\nE = schema :union\n  @on :kind\n  C\n  D');
    expect(d).toContain('type E = C | D;');
    expect(d).toContain('declare const E: { parse(data: unknown): E;');
    const x = dts('C = schema :shape\n  kind! "c"\nE = schema :union\n  @on :kind\n  C\n  Elsewhere');
    expect(x).toContain('type E = C | unknown;');
  });

  test('unknown field-type names render `unknown`, never an unresolved identifier', () => {
    const d = dts('W = schema :shape\n  owner? Widget');
    expect(d).toContain('type W = { owner?: unknown };');
    expect(d).not.toContain('Widget');
  });

  test('same-file schema references (recursion included) render the alias name', () => {
    const d = dts('Tree = schema :shape\n  label! string\n  kids? Tree[]');
    expect(d).toContain('type Tree = { label: string; kids?: Tree[] };');
  });

  test(':model — implicit columns, create optionality, relations, scopes, softDelete', () => {
    const d = dts([
      'Org = schema :model',
      '  title! string',
      'M = schema :model',
      '  name! string',
      '  code? string, ["x"]',
      '  posted! boolean, [false]',
      '  @timestamps',
      '  @softDelete',
      '  @belongsTo Org?',
      '  @hasMany Person',
      '  @scope :live, -> @where(name: "a")',
    ].join('\n'));
    // Data: declared fields + id/FK/timestamps/deletedAt — timestamp
    // columns are real `Date`s per the runtime (the adapter decodes
    // temporal columns at the wire; owner ruling on PORT-AUDIT D2).
    // `posted` stays REQUIRED in Data (the `!` is the validation
    // contract; the default applies at parse) while Create relaxes it.
    expect(d).toContain('type MData = { name: string; code?: string; posted: boolean } & ' +
      '{ id: number; orgId: number | null; createdAt: Date; updatedAt: Date; deletedAt: Date | null };');
    // Create: `!` without default required; a DEFAULTED required
    // field is optional at insert; optional FK rides `| null`
    expect(d).toContain('type MCreate = { name: string; code?: string; posted?: boolean; orgId?: number | null };');
    // Instance: relation accessors (cross-file target honest unknown,
    // hasMany pluralized), the persistence surface incl. restore
    // (softDelete present), markDirty/savedChanges per the runtime
    expect(d).toContain('people(opts?: { reload?: boolean }): Promise<unknown[]>');
    expect(d).toContain('org(opts?: { reload?: boolean }): Promise<Org | null>');
    expect(d).toContain('restore(): Promise<M>');
    expect(d).toContain('markDirty(name: string): M');
    expect(d).toContain('savedChanges: Map<string, [unknown, unknown]>');
    expect(d).toContain('toJSON(): MData');
    // Scopes: the Query alias + the const intersection
    expect(d).toContain('type MQuery = SchemaQuery<M, MData> & { live(...args: any[]): MQuery };');
    expect(d).toContain('declare const M: ModelSchema<M, MData, number, MCreate> & { live(...args: any[]): MQuery };');
    // no @softDelete → no restore
    expect(dts('P = schema :model\n  a! string')).not.toContain('restore()');
  });

  test('exported schemas export their aliases AND the const', () => {
    const d = dts('export S = schema :shape\n  a! string');
    expect(d).toContain('export type S = { a: string };');
    expect(d).toContain('export declare const S: Schema<S, S>;');
  });

  test('the intrinsic tiers: validation always, persistence only where a :model exists', () => {
    const v = dts('S = schema :shape\n  a! string');
    expect(v).toContain('interface Schema<Out, In = unknown> {');
    expect(v).not.toContain('interface ModelSchema');
    expect(v).not.toContain('interface SchemaQuery');
    const m = dts('M = schema :model\n  a! string');
    expect(m).toContain('interface ModelSchema<Instance, Data = unknown, Id = number, Create = Partial<Data>> extends Schema<Instance, Data> {');
  });

  test('zero-cost holds: schema-free modules keep the trivial declaration', () => {
    expect(dts('x = 1')).toBe('');
    expect(dts('f = (a) -> a + 1')).toBe('');
  });

  test('a derived binding declares its projected shape AND its const', () => {
    // The const is the declaration road's own obligation: a .d.ts has
    // no algebra call to infer the value from, so a type name shipped
    // without it could be annotated but never called.
    const d = dts('Base = schema :shape\n  a! string\n  b? integer\nView = Base.omit("b")');
    expect(d).toContain('type Base = { a: string; b?: number };');
    expect(d).toContain('type View = { a: string };');
    expect(d).toContain('declare const View: Schema<View, View>;');
  });

  test('a REBOUND name gets no companion, and the module still compiles', () => {
    // A companion is a claim about one shape, and a name bound twice
    // holds two. Silence is the only honest answer — and the only safe
    // one: two claims on one type name meet the collision check and
    // would reject a program that compiles fine with no companion at
    // all. Each of these is legal code, so each must still compile.
    const twice = 'A = schema :shape\n  a! string\nB = schema :shape\n  b! integer\n' +
                  'View = A.pick("a")\nView = B.pick("b")\nconsole.log View\n';
    expect(dts(twice)).not.toContain('type View');
    expect(() => dts(twice)).not.toThrow();
    // Counted over EVERY assignment, not only the foldable ones: the
    // second write here cannot be projected, and a companion stating
    // the first would misdescribe what the binding ends up holding.
    const mixed = 'A = schema :shape\n  a! string\nk = "a"\n' +
                  'View = A.pick("a")\nView = A.pick(k)\nconsole.log View\n';
    expect(dts(mixed)).not.toContain('type View');
    // The control: bound once, companion emitted.
    expect(dts('A = schema :shape\n  a! string\nView = A.pick("a")'))
      .toContain('type View = { a: string };');
  });

  test('boundaries: an unprovable projection and function-local schemas declare nothing', () => {
    // Folding is what makes the projected shape knowable, and it
    // refuses to guess: dynamic keys and a base that is not a same-file
    // schema each leave the binding with the type its algebra call
    // infers and no companion. Emitting one here would state a shape
    // nothing computed.
    const dynamic = dts('Base = schema :shape\n  a! string\n  b? integer\nk = "b"\nView = Base.omit(k)');
    expect(dynamic).toContain('type Base = ');
    expect(dynamic).not.toContain('View');
    const foreign = dts('Base = schema :shape\n  a! string\nView = Imported.omit("b")');
    expect(foreign).not.toContain('View');
    // function-local schemas are not module-boundary surface
    const f = dts('mk = ->\n  S = schema :shape\n    a! string\n  S');
    expect(f).toBe('');
  });
});

// ── 2. face pins ─────────────────────────────────────────────────────

describe('schema type story on the TS face', () => {
  test('the binding cast: inference-independent typing under every delivery', () => {
    for (const runtimeDelivery of ['none', 'import', 'inline']) {
      const f = face('S = schema :shape\n  a! string', { runtimeDelivery });
      expect(f.code).toContain(') as unknown as Schema<S, S>;');
    }
  });

  test('callable this-params ride the runtime calling conventions', () => {
    const f = face([
      'M = schema :model',
      '  name! string',
      '  beforeSave: -> @name',
      '  slug: ~> @name',
      '  tag: !> @name',
      '  greet: (p) -> p + @name',
      '  @scope :live, -> @where(name: "a")',
      '  @defaultScope -> @order("id")',
      '  @ensure "named", (m) -> m.name.length > 0',
    ].join('\n'));
    // instance `this` for hook/computed/derived/method
    expect(f.code).toContain('{tag: "hook", name: "beforeSave", fn: (function(this: M) {');
    expect(f.code).toContain('{tag: "computed", name: "slug", fn: (function(this: M) {');
    expect(f.code).toContain('{tag: "derived", name: "tag", fn: (function(this: M) {');
    expect(f.code).toContain('{tag: "method", name: "greet", fn: (function(this: M, p) {');
    // query `this` for scope/defaultScope (the alias exists — a named scope does)
    expect(f.code).toContain('{tag: "scope", name: "live", fn: (function(this: MQuery) {');
    expect(f.code).toContain('{tag: "defaultScope", name: "defaultScope", fn: (function(this: MQuery) {');
    // ensure predicates are called UNBOUND — no this-param, honestly; their
    // one parameter is the data as BOTH validation paths hand it over:
    // declared fields plus Partial<> of the runtime-managed columns,
    // because the create path runs ensures before id/timestamps exist.
    expect(f.code).toMatch(/\{tag: "ensure",[^}]*fn: \(function\(m: MEnsure\)/);
    expect(f.code).toContain('type MEnsure = { name: string } & Partial<{ id: number }>;');
  });

  test('a defaultScope with no named scopes types `this` as the inline SchemaQuery', () => {
    const f = face('M = schema :model\n  name! string\n  @defaultScope -> @order("id")');
    expect(f.code).toContain('fn: (function(this: SchemaQuery<M, MData>) {');
    expect(f.code).not.toContain('MQuery');
  });

  test('field transforms stay uninjected (the runtime calls them unbound); `it` declares the raw-input boundary', () => {
    // No `this` param — the runtime calls transforms unbound. The
    // `it` param types face-only `any`: it receives the WHOLE raw
    // input pre-validation, whose wire shape is what the transform
    // exists to absorb — a declared boundary, not an omission
    // (`unknown` would reject this very probe's `it.trim()`).
    const f = face('S = schema :shape\n  a! string, -> it.trim()');
    expect(f.code).toContain('transform: (function(it: any) {');
    expect(f.code).not.toContain('this:');
  });

  test('a :shape callable gets the instance this too', () => {
    const f = face('A = schema :shape\n  street! string\n  label: (p) -> p + @street');
    expect(f.code).toContain('fn: (function(this: A, p) {');
  });

  test(':mixin bindings cast like every other kind — to what a mixin actually serves', () => {
    const f = face('T = schema :mixin\n  a! string');
    expect(f.code).toContain('type T = { a: string };');
    // On the BINDING's own line — the row this closes is that the mixin
    // binding was the one kind left uncast, falling to `SchemaDef`, the
    // schema runtime's own class, at a user declaration.
    const binding = f.code.split('\n').find((l) => l.startsWith('let T = __schema('));
    expect(binding).toBeDefined();
    expect(binding).toContain('as unknown as MixinSchema<T>;');
  });

  test('anonymous and function-local schemas decline the story (recorded boundary)', () => {
    const anon = face('check = (s) -> s\ncheck(schema :shape\n  a! string)');
    expect(anon.code).not.toContain('as unknown as');
    const local = face('mk = ->\n  S = schema :shape\n    a! string\n  S');
    expect(local.code).not.toContain('as unknown as');
    expect(local.code).not.toContain('interface Schema');
  });

  test('export prefixes reach the alias lines', () => {
    const f = face('export S = schema :shape\n  a! string');
    expect(f.code).toContain('export type S = { a: string };');
    expect(f.code).toContain('export const S = __schema(');
  });

  test('the intrinsic block records ONE synthetic schemaTypes row; alias blocks cover their schema nodes', () => {
    const src = 'M = schema :model\n  name! string';
    const { mappings, stores } = compile(src, { runtimeDelivery: 'none', face: 'ts' });
    const intrinsic = mappings.rows.filter((r) => r.role === 'schemaTypes');
    expect(intrinsic.length).toBe(1);
    expect(intrinsic[0].mappingKind).toBe('synthetic');
    // the alias block is a cover manifestation of the schema node —
    // its $self rows include one whose generated text is the aliases
    const schemaNode = stores.nodesByKind('schema')[0];
    const selfRows = mappings.rows.filter((r) => r.nodeId === schemaNode.nodeId && r.role === '$self');
    expect(selfRows.length).toBeGreaterThanOrEqual(2); // alias block + the __schema(...) emission
    expect(selfRows.every((r) => r.sourceStart === schemaNode.sourceStart)).toBe(true);
  });

  test('strip identity holds for the story under all three deliveries', () => {
    const src = [
      'export Org = schema :model',
      '  title! string',
      'M = schema :model',
      '  name! string',
      '  @belongsTo Org',
      '  beforeSave: -> @name',
      '  @scope :live, -> @where(name: "a")',
      'R = schema :enum',
      '  :a',
      'T = schema :mixin',
      '  z! integer',
      'S = schema :shape',
      '  q? T',
      '  m: -> @q',
    ].join('\n');
    for (const runtimeDelivery of ['none', 'import', 'inline']) {
      const f = compile(src, { runtimeDelivery, face: 'ts' });
      const p = compile(src, { runtimeDelivery });
      expect(stripFace(f.code, f.tsRegions)).toBe(p.code);
      expect(p.tsRegions).toEqual([]);
    }
  });
});

// ── 3. collision rejections ) ────────────────────────────────

describe('schema type-name collisions reject loudly on the typed artifacts', () => {
  const cases = [
    ['a schema named after an intrinsic', 'Schema = schema :shape\n  a! string', /reserved by the schema intrinsic declarations/],
    ['a schema colliding with a sibling model\'s Data alias', 'User = schema :model\n  a! string\nUserData = schema :shape\n  b! string', /which schema 'User' already emits/],
    ['the same schema name declared twice', 'S = schema :shape\n  a! string\nS = schema :shape\n  b! string', /already emits/],
    ['a user type alias on an emitted alias name', 'type SData = {k: number}\nS = schema :shape\n  a! string\n  m: -> @a', /collides with the type declaration 'SData'/],
    ['a user interface on the schema name', 'interface S\n  x: number\nS = schema :shape\n  a! string', /collides with the interface declaration 'S'/],
    ['a class on the schema name', 'class S\n  m: -> 1\nS = schema :shape\n  a! string', /collides with class S/],
    ['an enum companion on the schema name', 'enum S\n  a = 0\nS = schema :shape\n  a! string', /collides with enum S/],
  ];
  for (const [name, src, re] of cases) {
    test(name, () => {
      // JS shipping output is untouched by the collision…
      expect(() => compile(src).code).not.toThrow();
      // …the declarations artifact rejects…
      expect(() => compile(src).declarations).toThrow(re);
      // …and the face rejects positioned (a CompileError with a span).
      let caught = null;
      try {
        compile(src, { runtimeDelivery: 'none', face: 'ts' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CompileError);
      expect(caught.message).toMatch(re);
    });
  }

  test('non-colliding programs never trip the check', () => {
    expect(() => compile('type Extra = {k: number}\nS = schema :shape\n  a! string').declarations).not.toThrow();
  });

  // `${name}Ensure` joined the reserved family (`${name}Data`,
  // `${name}Create`, `${name}Query`) when @ensure grew its own alias —
  // a deliberate per-schema namespace reservation, breaking for a
  // main-era `type OrderEnsure`. The collision positions on the USER
  // declaration — the offender the user can rename — matching the
  // intrinsic-collision path, not on the schema that innocently emits.
  test('the Ensure alias reservation rejects positioned on the user declaration', () => {
    const src = 'type OrderEnsure = { note: string }\nOrder = schema :model\n  total! number\n  @ensure "positive", (m) -> m.total > 0\n';
    let caught = null;
    try { compile(src, { runtimeDelivery: 'none', face: 'ts' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CompileError);
    expect(caught.message).toMatch(/emits the type name 'OrderEnsure', which collides with the type declaration 'OrderEnsure'/);
    expect(caught.line).toBe(1); // the user's line, not the schema's
    // Without @ensure entries no alias emits and the name is free.
    expect(() => compile('type OrderEnsure = { note: string }\nOrder = schema :model\n  total! number\n').declarations).not.toThrow();
  });

  // The USER-vs-INTRINSIC direction:
  // when the story emits the intrinsic block, a user declaration
  // naming an EMITTED intrinsic would duplicate (aliases) or silently
  // merge (interfaces) with it — reject, positioned on the USER
  // declaration. Tier-scoped: only the tier that actually prints.
  test('a user type alias on an emitted validation intrinsic rejects (type Schema + any schema)', () => {
    const src = 'type Schema = number\nS = schema :shape\n  a! string';
    expect(() => compile(src).code).not.toThrow(); // JS untouched
    expect(() => compile(src).declarations).toThrow(/the type declaration 'Schema' collides with the schema intrinsic declarations/);
    let caught = null;
    try {
      compile(src, { runtimeDelivery: 'none', face: 'ts' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompileError);
    expect(caught.message).toMatch(/collides with the schema intrinsic declarations this module emits/);
    expect(caught.line).toBe(1); // positioned ON the user declaration
  });

  test('a user class on an emitted persistence intrinsic rejects (class ModelSchema + a :model)', () => {
    const src = 'class ModelSchema\n  m: -> 1\nM = schema :model\n  a! string';
    expect(() => compile(src).declarations)
      .toThrow(/class ModelSchema collides with the schema intrinsic declarations.*persistence tier/);
    expect(() => compile(src, { runtimeDelivery: 'none', face: 'ts' }))
      .toThrow(/class ModelSchema collides/);
  });

  test('the tier boundary: a user ModelSchema beside VALIDATION-ONLY schemas is legal (the tier never prints)', () => {
    const src = 'type ModelSchema = number\nS = schema :shape\n  a! string';
    const r = compile(src);
    expect(r.declarations).toContain('type ModelSchema = number;');
    expect(r.declarations).not.toContain('interface ModelSchema');
    expect(() => compile(src, { runtimeDelivery: 'none', face: 'ts' })).not.toThrow();
  });

  test('schema-free files stay untouched by the reserved vocabulary', () => {
    const src = 'type Schema = number\nx: Schema = 1\nx = 2';
    expect(compile(src).declarations).toContain('type Schema = number;');
    expect(() => compile(src, { runtimeDelivery: 'none', face: 'ts' })).not.toThrow();
  });
});

// ── the module marker ──────────────────────────────────────────
// A file with no import/export of its own would emit GLOBAL-SCRIPT
// artifacts: two such faces (or .d.ts) in one program redeclare every
// shared top-level name (TS2451) and — for schema files — duplicate
// the intrinsic aliases (TS2300), false diagnostics the loader's
// ES-module runtime never produces. EVERY non-module program's
// artifacts append `export {}` — TS-only in the face, so the strip
// gate holds; the final line of a non-empty .d.ts; module-shaped
// files are untouched (their own imports/exports already scope them).
describe('the module marker', () => {
  test('a non-module schema file gains export {} in BOTH artifacts; strip reproduces JS mode', () => {
    const src = 'S = schema :shape\n  a! string';
    expect(dts(src).endsWith('export {};\n')).toBe(true);
    for (const runtimeDelivery of ['none', 'inline']) {
      const f = compile(src, { runtimeDelivery, face: 'ts' });
      expect(f.code.endsWith('\nexport {};\n')).toBe(true);
      const p = compile(src, { runtimeDelivery });
      expect(stripFace(f.code, f.tsRegions)).toBe(p.code);
      expect(p.code).not.toContain('export {}'); // JS mode never carries it
    }
  });

  test('a PLAIN non-module file gains the marker in BOTH artifacts; JS mode stays byte-identical', () => {
    const src = 'total: number = 1\ntotal = 2';
    expect(dts(src)).toBe('declare let total: number;\nexport {};\n');
    for (const runtimeDelivery of ['none', 'inline']) {
      const f = compile(src, { runtimeDelivery, face: 'ts' });
      expect(f.code.endsWith('\nexport {};\n')).toBe(true);
      const p = compile(src, { runtimeDelivery });
      expect(stripFace(f.code, f.tsRegions)).toBe(p.code);
      expect(p.code).not.toContain('export {}'); // the marker is face-only
    }
  });

  test('a statement-position dynamic import is NOT module-making: the marker still appends', () => {
    // The dynamic-import CALL spells the module-import head, and the
    // shapes collide at three elements; isModuleShaped decides by
    // semanticKind. A file whose only import spelling is the call
    // form is a script by its own syntax — the face needs the marker.
    for (const src of [
      'import("./x.js", { with: { type: "json" } })\ntotal = 1',
      'import("./x.js")\ntotal = 1',
      'import!("./x.js")\ntotal = 1',
    ]) {
      const f = compile(src, { runtimeDelivery: 'none', face: 'ts' });
      expect(f.code.endsWith('\nexport {};\n')).toBe(true);
    }
  });

  test('a module-shaped file\'s FACE is untouched (its import/export bytes ride into the face)', () => {
    for (const src of [
      'export S = schema :shape\n  a! string',
      'import { x } from "./other.js"\nS = schema :shape\n  a! string\nx(S)',
      'export total = 1',
      'import { k } from "./other.js"\ntotal = k + 1',
    ]) {
      expect(face(src).code).not.toContain('export {};');
    }
  });

  test('the .d.ts gate reads the EMITTED artifact: exported declarations scope it, erased indicators do not', () => {
    // Emitted export lines make the artifact a module — no marker.
    expect(dts('export S = schema :shape\n  a! string')).not.toContain('export {};');
    expect(dts('export x: number = 5')).toBe('export declare let x: number;\n');
    // SOURCE module shape whose every indicator ERASES from the
    // artifact (import lines never emit; an untyped export
    // contributes no declaration): the shipped .d.ts would be a
    // global script — the marker appends.
    expect(dts('import { k } from "./other.js"\ntotal: number = k\ntotal = 2'))
      .toBe('declare let total: number;\nexport {};\n');
    expect(dts('export version = 1\ntotal: number = 5'))
      .toBe('declare let total: number;\nexport {};\n');
    expect(dts('import { x } from "./other.js"\nS = schema :shape\n  a! string\nx(S)').endsWith('export {};\n'))
      .toBe(true);
    // A file whose declarations erase ENTIRELY stays empty — nothing
    // to scope (the untyped-export-only shape).
    expect(dts('export version = 1')).toBe('');
    expect(dts('import { k } from "./other.js"\ntotal = k + 1')).toBe('');
  });

  test('zero-cost boundaries: an empty .d.ts stays empty; JS mode records no regions', () => {
    expect(dts('x = 1')).toBe(''); // no declarations → no artifact to scope
    const p = js('x = 1\ny = x + 1');
    expect(p.code).not.toContain('export {}');
    expect(p.tsRegions).toEqual([]);
  });
});

// ── 4. naming drift gates ────────────────────────────────────────────

// The shared naming rules (snake/camel/pluralize, src/runtime/vocab.js)
// must derive EXACTLY the accessor and FK names the runtime installs —
// checked through the runtime's public surface (prototype accessor
// names, markDirty's FK validation), so a rule changed in vocab without
// the ORM's use of it fails here by name.
describe('naming drift gates: the shared rules vs the runtime\'s installed names', () => {
  const TARGETS = ['Person', 'Box', 'City', 'Bus', 'Sheep', 'Order', 'MdmUser', 'Series'];

  test('hasMany accessors: pluralize() matches the runtime accessor for every rule class', () => {
    rt4.SchemaRegistry.scope(() => {
      for (const target of TARGETS) {
        const def = rt4.__schema({
          kind: 'model', name: 'Holder' + target,
          entries: [
            { tag: 'field', name: 'label', modifiers: ['!'], typeName: 'string', array: false },
            { tag: 'directive', name: 'hasMany', args: [{ target }] },
          ],
        });
        const expected = pluralize(target[0].toLowerCase() + target.slice(1));
        const protoNames = Object.getOwnPropertyNames(def._getClass().prototype);
        expect(protoNames, `runtime accessor for hasMany ${target}`).toContain(expected);
      }
    });
  });

  test('belongsTo FK property names: the shared camel(fkName(target)) matches markDirty\'s set', () => {
    rt4.SchemaRegistry.scope(() => {
      const def = rt4.__schema({
        kind: 'model', name: 'Fk',
        entries: [
          { tag: 'field', name: 'label', modifiers: ['!'], typeName: 'string', array: false },
          { tag: 'directive', name: 'belongsTo', args: [{ target: 'MdmUser' }] },
        ],
      });
      const inst = def._hydrate([{ name: 'id' }, { name: 'label' }], [1, 'x']);
      // The renderer declares `mdmUserId: number` — markDirty accepts
      // exactly that name (and rejects a wrong spelling), so the
      // declared property IS the runtime property.
      expect(() => inst.markDirty('mdmUserId')).not.toThrow();
      expect(() => inst.markDirty('mdmuserId')).toThrow(/not a declared field or belongsTo FK/);
    });
  });

  test('the timestamp columns the renderer types as Date ARE Dates at the runtime', async () => {
    await rt4.SchemaRegistry.scope(async () => {
      const orm = await import('../../src/runtime/orm.js');
      const calls = [];
      orm.__schemaSetAdapter({
        async query(sql, params) {
          calls.push({ sql, params });
          if (sql.startsWith('INSERT')) {
            return { columns: [{ name: 'id' }, { name: 'name' }], data: [[1, 'n']], rowCount: 1 };
          }
          return { columns: [], data: [], rowCount: 0 };
        },
      });
      const M = rt4.__schema({
        kind: 'model', name: 'Stamped',
        entries: [
          { tag: 'field', name: 'name', modifiers: ['!'], typeName: 'string', array: false },
          { tag: 'directive', name: 'timestamps' },
        ],
      });
      const inst = await M.create({ name: 'n' });
      inst.name = 'm';
      await inst.save();
      const update = calls.find((c) => c.sql.startsWith('UPDATE'));
      expect(update.sql).toContain('"updated_at" = ?');
      // A real Date, never an ISO string — the declared `Date` is
      // truthful (owner ruling on PORT-AUDIT D2: Date at the wire).
      expect(inst.updatedAt instanceof Date).toBe(true);
    });
  });
});
