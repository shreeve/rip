// The Schema DSL: kinds :input/:shape/:mixin/:enum/:union/:model — the
// persistence spellings (:model directives, attrs, scopes, hooks,
// `on:`) are :model-only, and malformed spellings reject at parse
// time, positioned. Also the FIRST feature runtime through the
// delivery machinery: injected import on toolchain paths,
// inlined-once standalone output, the duplicate-runtime sentinel,
// scope-aware suppression, and the zero-cost gate as a TEST for the
// injection machinery. (The persistence runtime's own delivery
// batteries live in runtime-schema-orm.test.js beside this file.)
import { describe, test, expect, beforeEach } from 'bun:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit, stripFace } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src, ...opts });
  return { ...out, mappings: new Mappings(out.mappings), stores: out.stores, sexpr: r.sexpr };
};

const lexFails = (src, pattern) => expect(() => tokenize(src)).toThrow(pattern);
const emitFails = (src, pattern) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  expect(() => emit(r, { source: src })).toThrow(pattern);
};

// The runtime module, imported ONCE for eval-tier tests (its sentinel
// permits exactly one copy per process; the standalone-copy tests run
// in subprocesses).
const rt = await import('../../src/runtime/schema.js');
const { __schema, SchemaError, __SchemaRegistry, registerCoercer } = rt;

// Compile with delivery 'none' and evaluate against the imported
// runtime — the binding-passing form.
const run = (src, tail) => {
  const { code } = compile(src);
  return new Function('__schema', 'SchemaError', 'registerCoercer', `${code}\n${tail}`)(__schema, SchemaError, registerCoercer);
};

beforeEach(() => __SchemaRegistry.reset());

// ════════════════════════════════════════════════════════════════════
// The compiled schemas VALIDATE through the runtime
// ════════════════════════════════════════════════════════════════════

describe('schema runtime: the validation pipeline', () => {
  test('parse/safe/ok on an input schema', () => {
    const out = run(
      'S = schema\n  email!    email\n  password! string, 8..100',
      `return [
        S.ok({email: "a@b.co", password: "longenough"}),
        S.ok({email: "nope", password: "longenough"}),
        S.safe({password: "x"}).errors.map((e) => e.error),
        S.parse({email: "a@b.co", password: "longenough"}).email,
      ];`,
    );
    expect(out).toEqual([true, false, ['required', 'min'], 'a@b.co']);
  });

  test('defaults, ranges, and regex constraints', () => {
    const out = run(
      'S = schema\n  n! integer, [5]\n  s? string, 2..4, /^[a-z]+$/',
      `return [S.parse({}).n, S.ok({s: "toolong"}), S.ok({s: "UP"}), S.ok({s: "ok"})];`,
    );
    expect(out).toEqual([5, false, false, true]);
  });

  test('~type coercion is strict (coerce, then validate)', () => {
    const out = run(
      'S = schema\n  n! ~integer\n  b? ~boolean',
      `return [
        S.parse({n: "42"}).n,
        S.parse({n: 7, b: "true"}).b,
        S.safe({n: "12.5"}).errors[0].error,
        S.safe({n: "nan"}).errors[0].error,
      ];`,
    );
    expect(out).toEqual([42, true, 'coerce', 'coerce']);
  });

  test('~:name coercion resolves through the registry; missing registration is loud', () => {
    registerCoercer('money', (v) => {
      const n = Number(String(v).replace(/[$,]/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    });
    const out = run(
      'S = schema\n  price! ~:money',
      `return [S.parse({price: "$12.34"}).price, S.safe({price: "x"}).errors[0].error];`,
    );
    expect(out).toEqual([1234, 'coerce']);
    expect(() => run('T = schema\n  q! ~:nosuch', 'return T.parse({q: "1"});'))
      .toThrow(/no coercer registered for '~:nosuch'/);
  });

  test('transforms see the whole raw input as `it`', () => {
    const out = run(
      'S = schema :shape\n  full! string, -> it.first + " " + it.last',
      `return S.parse({first: "Ada", last: "L"}).full;`,
    );
    expect(out).toBe('Ada L');
  });

  test('methods, computed getters, and eager-derived fields', () => {
    const out = run(
      'S = schema :shape\n  street! string\n  full: ~> @street + "!"\n  shout: -> @street.toUpperCase()\n  len: !> @street.length',
      `const i = S.parse({street: "elm"});
       return [i.full, i.shout(), i.len, Object.keys(i).sort()];`,
    );
    expect(out).toEqual(['elm!', 'ELM', 3, ['len', 'street']]);
  });

  test(':enum kind validates and materializes members', () => {
    const out = run(
      'R = schema :enum\n  :pending 0\n  :active 1',
      `return [R.parse("pending"), R.parse(1), R.ok("nope"), R.safe("zz").errors[0].error];`,
    );
    expect(out).toEqual([0, 1, false, 'enum']);
  });

  test(':union dispatches on the discriminator', () => {
    const out = run(
      'Click = schema :shape\n  kind! "click"\n  x! integer\nScroll = schema :shape\n  kind! "scroll"\n  dy! integer\nEvent = schema :union\n  @on :kind\n  Click\n  Scroll',
      `return [
        Event.parse({kind: "click", x: 1}).x,
        Event.parse({kind: "scroll", dy: 2}).dy,
        Event.safe({kind: "wat"}).errors[0].message,
        Event.ok(null),
      ];`,
    );
    expect(out).toEqual([1, 2, 'expected one of click | scroll', false]);
  });

  test('@mixin folds fields in; mixins are not instantiable; cycles are loud', () => {
    const out = run(
      'Stamps = schema :mixin\n  createdAt! datetime\nS = schema :shape\n  name! string\n  @mixin Stamps',
      `return [S.ok({name: "x", createdAt: new Date()}), S.ok({name: "x"}), Stamps.safe({}).errors[0].error];`,
    );
    expect(out).toEqual([true, false, 'mixin']);
  });

  test('@ensure refinements run after field validation, in order', () => {
    const out = run(
      'S = schema :input\n  pw! string\n  pw2! string\n  @ensure "match", :pw2, (u) -> u.pw is u.pw2',
      `const bad = S.safe({pw: "a", pw2: "b"});
       return [S.ok({pw: "a", pw2: "a"}), bad.errors[0].message, bad.errors[0].field];`,
    );
    expect(out).toEqual([true, 'match', 'pw2']);
  });

  test('@ensure! makes the schema async-validating; sync entries refuse', async () => {
    const { code } = compile('S = schema :input\n  e! email\n  @ensure! "taken", (u) -> Promise.resolve(u.e != "x@y.co")');
    const S = new Function('__schema', `${code}\nreturn S;`)(__schema);
    expect(() => S.parse({ e: 'a@b.co' })).toThrow(/async refinements.*parseAsync/);
    expect((await S.safeAsync({ e: 'a@b.co' })).ok).toBe(true);
    expect((await S.safeAsync({ e: 'x@y.co' })).errors[0].message).toBe('taken');
  });

  test('nested schema field types resolve through the registry', () => {
    const out = run(
      'Address = schema :shape\n  street! string\nUser = schema :shape\n  name! string\n  addr! Address\n  addrs? Address[]',
      `return [
        User.ok({name: "a", addr: {street: "s"}}),
        User.safe({name: "a", addr: {street: 7}}).errors[0].field,
        User.safe({name: "a", addr: {street: "s"}, addrs: [{street: "t"}, {nope: 1}]}).errors[0].field,
      ];`,
    );
    expect(out).toEqual([true, 'addr.street', 'addrs[1].street']);
  });

  test('the projection algebra: pick/omit/partial/required/extend', () => {
    const out = run(
      'User = schema :shape\n  name! string\n  email! email\n  bio? text',
      `const View = User.pick("name");
       const NoBio = User.omit("bio");
       const Soft = User.partial();
       const Hard = Soft.required("name");
       return [
         View.ok({name: "a"}),
         NoBio.ok({name: "a", email: "a@b.co"}),
         Soft.ok({}),
         Hard.ok({}),
         Hard.ok({name: "a"}),
       ];`,
    );
    expect(out).toEqual([true, true, true, false, true]);
  });

  test('the array combinator aggregates item failures by index', () => {
    const out = run(
      'S = schema\n  n! integer',
      `const r = S.array.safe([{n: 1}, {n: "x"}]);
       return [S.array.ok([{n: 1}, {n: 2}]), r.errors[0].field, S.array.safe({}).errors[0].error];`,
    );
    expect(out).toEqual([true, '[1].n', 'not_array']);
  });

  test('toJSONSchema exports the wire contract', () => {
    const out = run(
      'S = schema\n  email! email\n  age? ~integer, 18..120',
      `return S.toJSONSchema();`,
    );
    expect(out.type).toBe('object');
    expect(out.required).toEqual(['email']);
    expect(out.properties.email).toEqual({ type: 'string', format: 'email' });
    expect(out.properties.age.minimum).toBe(18);
  });

  test('SchemaError carries structured issues', () => {
    const out = run(
      'S = schema\n  n! integer',
      `try { S.parse({}); return null; }
       catch (e) { return [e instanceof SchemaError, e.name, e.schemaName, e.issues[0].field]; }`,
    );
    expect(out).toEqual([true, 'SchemaError', 'S', 'n']);
  });

  test('registry: same-name different-definition collides loudly; identical re-registration rebinds', () => {
    run('A = schema :shape\n  x! string', 'return A;');
    run('A2 = schema :shape\n  x! string', 'return A2;');
    expect(() => run('A = schema :shape\n  x! integer', 'return A;'))
      .toThrow(/already registered with a different definition/);
  });

  test('non-canonical field names are loud at normalization', () => {
    expect(() => run('S = schema\n  mdmID! string', 'return S.parse({mdmID: "x"});'))
      .toThrow(/not canonical camelCase/);
  });
});

// ════════════════════════════════════════════════════════════════════
// The DSL's negative battery (all rejections positioned and loud)
// ════════════════════════════════════════════════════════════════════

describe('schema DSL: loud rejections', () => {
  test('the persistence spellings stay :model-only on the other kinds (the completed matrix)', () => {
    lexFails('S = schema :shape\n  a! string, {was: "b"}', /persistence metadata.*:model\/:mixin-only/);
    lexFails('S = schema :shape\n  a! string @unique', /persistence metadata.*:model\/:mixin-only/);
    lexFails('I = schema :input\n  a! string\n  @timestamps', /:model-only/);
    lexFails('S = schema :shape\n  a! string\n  @belongs_to User', /:model-only/);
    lexFails('S = schema :shape\n  a! string\n  @scope :hot, -> @where(a: 1)', /query scopes.*:model-only/);
    lexFails('M = schema :mixin\n  a! string\n  @defaultScope -> @where(a: 1)', /query scopes.*:model-only/);
    lexFails('S = schema :shape, on: analytics\n  a! string', /'on:'.*applies to :model only/);
    lexFails('E = schema :enum, on: analytics\n  :a\n  :b', /'on:'.*applies to :model only/);
  });

  test('unknown :model directives reject by name at parse time, positioned', () => {
    lexFails('U = schema :model\n  name! string\n  @timestamp', /unknown directive '@timestamp' on :model — legal: @mixin, @timestamps/);
    lexFails('U = schema :model\n  name! string\n  @bogus', /unknown directive '@bogus' on :model/);
    lexFails('U = schema :model\n  name! string\n  @belongs_too Order', /unknown directive '@belongs_too' on :model/);
    // positioned at the directive name, not the schema head
    try {
      tokenize('U = schema :model\n  name! string\n  @timestamp');
      throw new Error('unreachable');
    } catch (e) {
      expect(e.start).toBe('U = schema :model\n  name! string\n  @'.length);
    }
  });

  test('malformed or junk-bearing directive args reject at their own position', () => {
    lexFails('U = schema :model\n  name! string\n  @belongs_to User Order junk 42', /@belongs_to: takes exactly one target name/);
    lexFails('U = schema :model\n  name! string\n  @timestamps yes please', /@timestamps: takes no arguments/);
    lexFails('U = schema :model\n  name! string\n  @softDelete now', /@softDelete: takes no arguments/);
    lexFails('U = schema :model\n  name! string\n  @belongs_to', /@belongs_to requires a target name/);
    lexFails('U = schema :model\n  name! string\n  @idStart soon', /@idStart requires an integer literal/);
    lexFails('U = schema :model\n  name! string\n  @idStart 1.5', /integer literal; got 1\.5/);
    lexFails('U = schema :model\n  name! string\n  @idStart 10 20', /unexpected NUMBER after the integer/);
    lexFails('U = schema :model\n  name! string\n  @unique', /@unique requires a field name or list/);
    lexFails('U = schema :model\n  name! string\n  @index', /@index requires a field name or list/);
    lexFails('U = schema :model\n  name! string\n  @unique [:name] extra', /unexpected IDENTIFIER after the column list/);
    lexFails('U = schema :model\n  name! string\n  @tableWas', /@tableWas requires the previous table name/);
    lexFails('U = schema :model\n  name! string\n  @tableWas a b', /takes one prior table name/);
  });

  test('@unique/@index columns must exist on the table (mixin-free models)', () => {
    lexFails('U = schema :model\n  name! string\n  @unique [nope, missing]', /@unique: unknown column 'nope' — the table has: id, name/);
    lexFails('U = schema :model\n  name! string\n  @index bogus_column', /@index: unknown column 'bogus_column'/);
    // implicit columns count as known
    const ok = 'U = schema :model\n  name! string\n  @timestamps\n  @softDelete\n  @belongs_to Org\n  @index createdAt\n  @index [org_id, deleted_at]\n  @unique :name';
    expect(() => tokenize(ok)).not.toThrow();
    // a @mixin defers the whole check to the runtime root (its fields
    // are not parse-visible; normalize re-checks the expanded set)
    expect(() => tokenize('U = schema :model\n  name! string\n  @mixin Stamps\n  @index createdAt')).not.toThrow();
  });

  test('relation targets must be canonical PascalCase', () => {
    lexFails('U = schema :model\n  name! string\n  @belongs_to MDMUser', /target 'MDMUser' is not canonical PascalCase/);
    lexFails('U = schema :model\n  name! string\n  @has_many APIKey', /not canonical PascalCase/);
    lexFails('U = schema :model\n  name! string\n  @has_one profile', /not canonical PascalCase/);
    expect(() => tokenize('U = schema :model\n  name! string\n  @belongs_to MdmUser')).not.toThrow();
  });

  test('model-only field spellings: attrs and inline @unique errors', () => {
    lexFails('U = schema :model\n  a! string, {wat: "b"}', /unknown field attr 'wat' — known attrs: was/);
    lexFails('U = schema :model\n  a! string, {was: 5}', /'was' requires a string column name/);
    lexFails('U = schema :model\n  a! string, {was: "x"}, {was: "y"}', /more than one '\{…\}' attrs bracket/);
    lexFails('U = schema :model\n  a! string @uniq', /unknown inline attribute '@uniq'.*only inline attribute is '@unique'/);
    lexFails('U = schema :model\n  a! string, @unique, @unique', /more than one '@unique'/);
  });

  test('a field and a directive owning one column collide (mixin-free models)', () => {
    // the exact repro: the field's snake column IS the relation's FK
    lexFails('U = schema :model\n  userId! integer\n  name! string\n  @belongs_to User',
      /field 'userId' and the @belongs_to User relation both own column 'user_id'/);
    lexFails('U = schema :model\n  createdAt! datetime\n  @timestamps',
      /field 'createdAt' and @timestamps both own column 'created_at'/);
    lexFails('U = schema :model\n  deletedAt? datetime\n  @softDelete',
      /field 'deletedAt' and @softDelete both own column 'deleted_at'/);
    // duplicate relations claim one column too — directive-vs-directive
    lexFails('U = schema :model\n  name! string\n  @belongs_to Org\n  @belongs_to Org',
      /an earlier directive and the @belongs_to Org relation both own column 'org_id'/);
    // the legal neighbors stay legal
    expect(() => tokenize('U = schema :model\n  userName! string\n  @belongs_to User')).not.toThrow();
  });

  test('duplicate @idStart / @tableWas reject at the second occurrence (the silent last-wins family)', () => {
    lexFails('U = schema :model\n  name! string\n  @idStart 100\n  @idStart 200',
      /duplicate '@idStart' — a :model declares it at most once/);
    lexFails('U = schema :model\n  name! string\n  @tableWas old_users\n  @tableWas older_users',
      /duplicate '@tableWas'/);
    // positioned at the SECOND occurrence
    try {
      tokenize('U = schema :model\n  name! string\n  @idStart 100\n  @idStart 200');
      throw new Error('unreachable');
    } catch (e) {
      expect(e.start).toBe('U = schema :model\n  name! string\n  @idStart 100\n  @'.length);
    }
  });

  test("a :model's `id` field collides with the runtime-managed primary key", () => {
    lexFails('U = schema :model\n  id! integer\n  name! string', /field 'id' collides with the runtime-managed primary key/);
    // non-model kinds keep `id` as an ordinary field
    expect(() => tokenize('S = schema :shape\n  id! integer')).not.toThrow();
  });

  test('@scope / @defaultScope grammar errors', () => {
    lexFails('U = schema :model\n  a! string\n  @scope active, -> @where(a: 1)', /@scope name must be a :symbol/);
    lexFails('U = schema :model\n  a! string\n  @scope :active', /missing its body/);
    lexFails('U = schema :model\n  a! string\n  @scope :Active, -> @where(a: 1)', /lowercase-first alphanumeric/);
    lexFails('U = schema :model\n  a! string\n  @scope :hot, @where(a: 1)', /expected '->' to start the body/);
    lexFails('U = schema :model\n  a! string\n  @defaultScope (d) -> @where(a: d)', /@defaultScope takes no parameters/);
    lexFails('U = schema :model\n  a! string\n  @defaultScope ->', /function body is empty/);
  });

  test("hook binding: lifecycle hooks take no parameters; 'on:' body-shape errors", () => {
    lexFails('U = schema :model\n  a! string\n  beforeSave: (x) -> x', /lifecycle hooks take no parameters — only methods do/);
    lexFails('U = schema :model, on:\n  a! string', /'on:' requires an adapter expression/);
    lexFails('U = schema :model; a!; @scope :hot, -> @where(a: 1)', /inline schema bodies do not support '->'/);
  });

  test('kind and body-shape errors', () => {
    lexFails('U = schema :wat\n  a! string', /unknown schema kind :wat/);
    lexFails('S = schema :shape', /expected an indented schema body/);
    lexFails('S = schema :shape;', /inline schema body is empty/);
    lexFails('S = schema :shape; m: -> 1', /inline schema bodies do not support/);
  });

  test('nested array types reject — one `[]` validates element-wise, deeper nesting never silently flattens', () => {
    lexFails('X = schema :shape\n  tags! string[][]', /nested array types.*not supported/);
    lexFails('X = schema :shape\n  m! integer[][][]', /nested array types/);
  });

  test('field-line errors', () => {
    lexFails('U = schema\n  name: string', /space, no colon/);
    lexFails('S = schema\n  a! string -> 1', /comma is required before '->'/);
    lexFails('S = schema\n  a! string, 1..2, 3..4', /more than one range/);
    lexFails('S = schema\n  a! string, 9..2', /reversed/);
    lexFails('S = schema\n  a! ~text', /is not coercible/);
    lexFails('S = schema\n  a! ~integer[]', /does not apply to array types/);
    lexFails('S = schema\n  a! ~integer, -> 5', /transform replaces coercion/);
    lexFails('S = schema\n  a! "x" | 5', /literal unions contain string literals only/);
    lexFails('S = schema\n  a! string, [/re/]', /written bare, not in brackets/);
  });

  test('capability matrix by kind', () => {
    lexFails('M = schema :mixin\n  a! string\n  m: -> 1', /:mixin schemas are fields-only/);
    lexFails('M = schema :mixin\n  a! string\n  @ensure "m", (u) -> u.a', /don't accept @ensure/);
    lexFails('I = schema :input\n  a! string\n  m: -> 1', /:input schemas are fields-only/);
    // `!>` on a :mixin rejects too — mixin expansion copies fields
    // only, so a derived entry would silently vanish on inclusion.
    lexFails('M = schema :mixin\n  base! integer\n  dbl: !> @base * 2', /:mixin schemas are fields-only/);
  });

  test('@ensure grammar errors', () => {
    lexFails('S = schema :input\n  a! string\n  @ensure "msg"', /did you forget the comma/);
    lexFails('S = schema :input\n  a! string\n  @ensure "msg", -> 1', /declare their parameter explicitly/);
    lexFails('S = schema :input\n  a! string\n  @ensure 5, (u) -> u.a', /string literal message/);
  });

  test(':enum and :union body errors', () => {
    lexFails('E = schema :enum\n  admin', /must be a :symbol/);
    lexFails('E = schema :enum\n  :a : 1', /drop the ':' before the value/);
    lexFails('E = schema :enum\n  @on :x', /don't accept/);
    lexFails('U = schema :union\n  A\n  B', /requires an '@on :field' discriminator/);
    lexFails('U = schema :union\n  @on :k\n  A', /at least two constituent/);
    lexFails('U = schema :union\n  @on :k\n  @on :j\n  A\n  B', /exactly one/);
  });

  test("keyword-named fields: `when!` works; `when?` is a scan-level rejection", () => {
    // `when`, `loop`, `for` are legitimate column names. The `!`
    // modifier scans fine after a keyword word; `?` trips the scanner's
    // postfix-existence guard BEFORE the schema pass sees it — loud.
    expect(compile('W = schema\n  when! date').code).toContain('__schema(');
    lexFails('W = schema\n  when? date', /unspaced '\?' needs a value/);
  });

  test('pragma errors', () => {
    lexFails('schema.defaultMacString = 100', /unknown schema pragma/);
    lexFails('f = ->\n  schema.defaultMaxString = 5', /file top level/);
    lexFails('schema.defaultMaxString = "x"', /number literal/);
  });

  test('callable param and method-shape errors', () => {
    lexFails('S = schema :shape\n  m: => 1', /must be followed by '->'/);
    emitFails('S = schema :shape\n  m: ({a}) -> a', /plain identifiers/);
    lexFails('S = schema :shape\n  full: (x) ~> @a', /take no parameters/);
    // …but a computed whose BODY is a function value stays legal
    // (`full: ~> (x) -> x` — the getter returns a function).
    const r = parser.parse('S = schema :shape\n  full: ~> (x) -> x');
    expect(r.diagnostics).toEqual([]);
  });

  test("a stray `!>` outside a schema body is a loud parse error; `~>` is the reactive effect head", () => {
    // Both scan as single tokens (so a trailing one never reads as a
    // line-continuing COMPARE); `!>` has no grammar rule outside a
    // schema body, while `~>` is the reactive effect head everywhere
    // the main grammar sees it (test/ui/effects.test.js owns it).
    let failed = false;
    try {
      const r = parser.parse('x = !> 1');
      failed = r.diagnostics.length > 0;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(parser.parse('x = ~> 1').diagnostics).toEqual([]);
    expect(parser.parse('a ~> b').diagnostics).toEqual([]);
  });

  test('`schema` stays an ordinary identifier outside declarations', () => {
    const { code } = compile('schema = 42\nx = schema + 1');
    expect(code).toContain('schema + 1');
    expect(code).not.toContain('__schema');
    expect(compile('x = a.schema').code).toContain('x = a.schema;');
    expect(compile('x = {schema: 1}').code).toContain('x = {schema: 1};');
  });
});

// ════════════════════════════════════════════════════════════════════
// Runtime delivery: the three paths, suppression, sentinel, zero cost
// ════════════════════════════════════════════════════════════════════

describe('runtime delivery: injection machinery', () => {
  const SRC = 'S = schema\n  a! integer\nconsole.log(S.parse({a: 4}).a)';

  test("the zero-cost gate: no schema → no import, no preamble, no runtime bytes", () => {
    // Every mode compiles a schema-free program to the SAME bytes.
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = compile('x = 1 + 2\nf = (a) -> a * x', { runtimeDelivery: mode });
      expect(code).toBe('let x = 1 + 2;\nlet f = function(a) {\n  return (a * x);\n};');
      expect([...runtimes]).toEqual([]);
      expect(code).not.toContain('import');
      expect(code).not.toContain('__schema');
    }
    // And the full pipeline agrees (compile() defaults to 'inline').
    const full = fullCompile('x = 1 + 2');
    expect(full.code).toBe('let x = 1 + 2;');
    expect([...full.runtimes]).toEqual([]);
  });

  test("emit() default is 'none': undecorated output with __schema free", () => {
    const { code, runtimes } = compile(SRC);
    expect(code).not.toContain('import');
    expect(code.startsWith('let S = __schema(')).toBe(true);
    expect([...runtimes]).toEqual(['schema']);
  });

  test("'import' injects ONE import of the shared runtime module, mapped synthetic", () => {
    const { code, mappings } = compile(SRC, { runtimeDelivery: 'import' });
    expect(code.split('\n')[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*src\/runtime\/schema\.js";$/);
    // the injected line's mapping row: synthetic, zero-width source
    const row = mappings.rows.find((r) => r.role === 'runtime');
    expect(row.mappingKind).toBe('synthetic');
    expect(row.sourceStart).toBe(row.sourceEnd);
    expect(row.generatedStart).toBe(0);
    expect(code.slice(row.generatedStart, row.generatedEnd)).toContain('import { __schema');
    // synthetic rows never serialize into the source map
    expect(mappings.serializableRows().some((r) => r.role === 'runtime')).toBe(false);
  });

  test("'inline' emits the runtime ONCE, IIFE-wrapped, self-contained", () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    expect(code.startsWith('const { __schema, SchemaError, registerCoercer } = (() => {')).toBe(true);
    expect((code.match(/class SchemaError/g) ?? []).length).toBe(1);
    // and it RUNS standalone (fresh subprocess — the sentinel permits
    // one standalone copy per process)
    const dir = mkdtempSync(join(tmpdir(), 'rip-schema-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      const r = spawnSync('bun', [join(dir, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the sentinel: two standalone copies in one process reject loudly', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-sentinel-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'two.js'), code);
      writeFileSync(join(dir, 'main.js'), `import './one.js';\nimport './two.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip schema runtime');
      expect(r.stderr).toContain('rip CLI/loader');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the sentinel: a standalone copy meeting the shared module rejects too', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const runtimePath = new URL('../../src/runtime/schema.js', import.meta.url).pathname;
    const dir = mkdtempSync(join(tmpdir(), 'rip-sentinel2-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'main.js'), `import ${JSON.stringify(runtimePath)};\nimport './one.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip schema runtime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── the shadowing battery (suppression decided statically) ─────────

  test('program-scope shadowing suppresses injection per name', () => {
    // __schema bound by the user: the user's binding wins — no
    // injection of that name (the other names still inject).
    const a = compile('__schema = (d) => d\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(a.code.split('\n')[0]).toMatch(/^import \{ SchemaError, registerCoercer \} from/);
    // SchemaError bound: the others inject.
    const b = compile('SchemaError = 1\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(b.code.split('\n')[0]).toMatch(/^import \{ __schema, registerCoercer \} from/);
    // all bound: nothing injects.
    const c = compile('__schema = (d) => d\nSchemaError = 1\nregisterCoercer = 2\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(c.code).not.toContain('import');
    // inline mode: the IIFE destructuring names only the non-shadowed
    const d = compile('SchemaError = 1\nS = schema\n  a! integer', { runtimeDelivery: 'inline' });
    expect(d.code.startsWith('const { __schema, registerCoercer } = (() => {')).toBe(true);
    // a shadowed __schema in inline mode: the IIFE still delivers the
    // un-shadowed names, and the schema call reaches the USER's binding
    const e = compile('__schema = (d) => d.name\nS = schema\n  a! integer', { runtimeDelivery: 'inline' });
    expect(e.code.startsWith('const { SchemaError, registerCoercer } = (() => {')).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'rip-shadow-'));
    try {
      writeFileSync(join(dir, 'shadow.js'), `${e.code}\nconsole.log(S);`);
      const r = spawnSync('bun', [join(dir, 'shadow.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('S'); // the user's (d) => d.name ran
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('import bindings suppress (the user already imports the name)', () => {
    const { code } = compile('import { __schema } from "./mine.js"\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    const lines = code.split('\n');
    expect(lines[0]).toMatch(/^import \{ SchemaError, registerCoercer \} from ".*runtime\/schema\.js";$/);
    expect(lines[1]).toBe("import { __schema } from './mine.js';");
  });

  test('destructuring at program scope suppresses', () => {
    const { code } = compile('{__schema, SchemaError, registerCoercer} = pkg\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(code).not.toContain('runtime/schema.js');
  });

  test('class/def/export-declared module-scope names suppress', () => {
    // Statement forms that bind WITHOUT hoisting must suppress too —
    // an injected import of the same name would be a duplicate
    // declaration with no source position.
    const a = compile('class SchemaError\n  m: -> 1\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(a.code.split('\n')[0]).toMatch(/^import \{ __schema, registerCoercer \} from/);
    const b = compile('def __schema(d)\n  d\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(b.code.split('\n')[0]).toMatch(/^import \{ SchemaError, registerCoercer \} from/);
    const c = compile('export class SchemaError\n  m: -> 1\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(c.code.split('\n')[0]).toMatch(/^import \{ __schema, registerCoercer \} from/);
    const d = compile('export def registerCoercer(n, f)\n  f\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(d.code.split('\n')[0]).toMatch(/^import \{ __schema, SchemaError \} from/);
    // and the suppressed output is valid, RUNNING JS — no duplicate
    // declaration anywhere
    const compiled = compile('class SchemaError\n  m: -> 1\nS = schema\n  a! integer', { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-classshadow-'));
    try {
      writeFileSync(join(dir, 'cs.js'), compiled.code + '\nconsole.log(S.kind);');
      const r = spawnSync('bun', [join(dir, 'cs.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('input');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('function-scope shadowing does NOT suppress module-level injection', () => {
    const { code } = compile('f = ->\n  __schema = 1\n  __schema\nS = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(code.split('\n')[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from/);
  });

  test("a schema INSIDE a function that locally shadows '__schema' rejects at compile", () => {
    // The accidental case: the local binding shadows the runtime
    // exactly where the emitted __schema(...) call needs it — no
    // working reading exists, so it rejects with the module-scope
    // hatch named.
    emitFails('f = ->\n  __schema = 7\n  S = schema\n    a! integer\n  S', /function-scope binding of '__schema' shadows the schema runtime/);
    // module-level schemas with an unrelated function-local __schema
    // stay fine (the local shadows only its own scope)
    const src = 'f = ->\n  __schema = 7\n  __schema\nS = schema\n  a! integer';
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: src })).not.toThrow();
  });

  test('registerCoercer is reachable from Rip source — register-then-parse end to end', () => {
    const src = [
      'registerCoercer "cents", (v) ->',
      '  n = Number(v)',
      '  if isNaN(n) then null else Math.round(n * 100)',
      'Price = schema',
      '  amount! ~:cents',
      'console.log(Price.parse({amount: "12.34"}).amount)',
    ].join('\n');
    const { code } = compile(src, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-coercer-'));
    try {
      writeFileSync(join(dir, 'c.js'), code);
      const r = spawnSync('bun', [join(dir, 'c.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('1234');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── the trigger rule: reference a runtime name → get the runtime ───

  test('a registration-only module (no schema) triggers delivery — the general trigger rule', () => {
    const SRC_REG = 'registerCoercer "cents", (v) -> Math.round(Number(v) * 100)';
    // import mode: the one injected import arrives
    const a = compile(SRC_REG, { runtimeDelivery: 'import' });
    expect(a.code.split('\n')[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*runtime\/schema\.js";$/);
    expect([...a.runtimes]).toEqual(['schema']);
    // inline mode: self-contained, and it RUNS — no bare ReferenceError
    const b = compile(SRC_REG, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-regonly-'));
    try {
      writeFileSync(join(dir, 'reg.js'), b.code + '\nconsole.log("registered");');
      const r = spawnSync('bun', [join(dir, 'reg.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('registered');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // 'none' stays undecorated, but the module still reports its
    // runtime use
    const c = compile(SRC_REG, { runtimeDelivery: 'none' });
    expect(c.code).not.toContain('import');
    expect([...c.runtimes]).toEqual(['schema']);
  });

  test('a SchemaError-only module (catch handler) triggers delivery too', () => {
    const src = 'try\n  f()\ncatch e\n  throw e if e instanceof SchemaError';
    const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
    expect(code.split('\n')[0]).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from/);
    expect([...runtimes]).toEqual(['schema']);
  });

  test('NAME occurrences that are not references never trigger (zero-cost holds)', () => {
    // property name, object key, string literal, own module-scope
    // binding, import binding — none is a free reference
    for (const src of [
      'x = obj.registerCoercer',
      'x = obj?.SchemaError',
      'x = {registerCoercer: 1, SchemaError: 2}',
      'x = "registerCoercer __schema SchemaError"',
      'registerCoercer = (n, f) -> 0\nregisterCoercer "x", (v) -> v',
      'import { registerCoercer } from "./mine.js"\nregisterCoercer "x", (v) -> v',
    ]) {
      const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
      expect(code).not.toContain('runtime/schema.js');
      expect([...runtimes]).toEqual([]);
    }
  });

  test('pattern shorthand is a BINDING, never a reference — no trigger, byte-identical output in every mode', () => {
    // Every pattern context: object/array param patterns, nested
    // patterns, shorthand-with-default, loop heads, function-local
    // destructures, catch bindings. All binding-only — none may pull
    // the runtime (an unused import, or ~1.2k inlined lines, into an
    // effectively schema-free file would break the zero-cost
    // guarantee).
    const bindingOnly = [
      'f = ({SchemaError}) -> 1',
      'f = ({SchemaError: aliased}) -> aliased',
      'f = ([SchemaError, registerCoercer]) -> 1',
      'def d({__schema})\n  1',
      'f = ({a: {SchemaError}}) -> 1',
      'f = ({SchemaError = 1}) -> 1',
      'f = ([first, ...registerCoercer]) -> first',
      'fn = ->\n  {SchemaError} = obj\n  1',
      'fn = ->\n  [registerCoercer] = arr\n  1',
      'fn = ->\n  for {SchemaError} in xs\n    g()',
      'fn = ->\n  try\n    g()\n  catch {SchemaError}\n    h()',
      // comprehension clauses carry the same loop heads at arity 4
      // (postfix-for lowers to a comprehension) — still bindings
      'x = (1 for {SchemaError} in [{}])',
      'z = f() for {SchemaError} in xs',
      'y = (g() for k, {SchemaError} of obj)',
    ];
    for (const src of bindingOnly) {
      const none = compile(src, { runtimeDelivery: 'none' });
      for (const mode of ['import', 'inline']) {
        const { code, runtimes } = compile(src, { runtimeDelivery: mode });
        expect(code).toBe(none.code);
        expect([...runtimes]).toEqual([]);
      }
    }
    // The contrast: EXPRESSION slots inside a pattern are references
    // — a default value or computed key naming a runtime name still
    // triggers, as does object shorthand in expression position.
    for (const src of [
      'f = ({a = SchemaError}) -> a',
      'f = ([a = registerCoercer("x", g)]) -> a',
      'f = ({[registerCoercer]: v}) -> v',
      'x = {SchemaError}',
      'x = (v for v in xs when v is SchemaError)',
    ]) {
      const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
      expect(code).toContain('runtime/schema.js');
      expect([...runtimes]).toEqual(['schema']);
    }
  });

  test('registration-only module feeds a schema-using module through the loader (end to end)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-regmod-'));
    try {
      writeFileSync(join(dir, 'coercers.rip'), 'registerCoercer "cents", (v) ->\n  n = Number(v)\n  if isNaN(n) then null else Math.round(n * 100)\n');
      writeFileSync(join(dir, 'main.rip'), 'import "./coercers.rip"\nPrice = schema\n  amount! ~:cents\nconsole.log(Price.parse({amount: "12.34"}).amount)\n');
      const rip = join(import.meta.dir, '../../bin/rip');
      const r = spawnSync('bun', [rip, join(dir, 'main.rip')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('1234');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path runs schemas through the shared module (end to end)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-loader-'));
    try {
      writeFileSync(join(dir, 'mod.rip'), 'export Point = schema :shape\n  x! integer\n  y! integer\n');
      writeFileSync(join(dir, 'main.rip'), 'import { Point } from "./mod.rip"\np = Point.parse({x: 1, y: 2})\nconsole.log(p.x + p.y)\n');
      const rip = join(import.meta.dir, '../../bin/rip');
      const r = spawnSync('bun', [rip, join(dir, 'main.rip')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('3');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the runtime module itself is inject-free plain JavaScript', () => {
    const text = readFileSync(new URL('../../src/runtime/schema.js', import.meta.url).pathname, 'utf8');
    // no import statements (the runtime cannot depend on its own
    // injection or anything else), one single-line export tail (the
    // seam the inliner strips)
    expect(/^import /m.test(text)).toBe(false);
    expect(text).toMatch(/^export \{ __schema, SchemaError, __SchemaRegistry, registerCoercer, __SchemaDef, __schemaInstallPersistence \};$/m);
  });
});

// ════════════════════════════════════════════════════════════════════
// Side tables + mappings: schema DSL spans reach the stores
// ════════════════════════════════════════════════════════════════════

describe('schema: stores and mappings', () => {
  test('the schema node and its body role land in the side tables', () => {
    const src = 'S = schema :shape\n  a! string\n  b? integer';
    const { stores, mappings } = compile(src);
    const nodes = stores.nodesByKind('schema');
    expect(nodes.length).toBe(1);
    const id = nodes[0].nodeId;
    // $self spans `schema` through the body's end
    expect(src.slice(nodes[0].sourceStart, nodes[0].sourceEnd)).toBe('schema :shape\n  a! string\n  b? integer');
    const body = stores.role(id, 'body');
    expect(src.slice(body.sourceStart, body.sourceEnd)).toBe(':shape\n  a! string\n  b? integer');
    // both round-trip: the whole emitted __schema(...) is the cover
    const gen = mappings.bestAtSource(body.sourceStart);
    expect(gen).not.toBeNull();
    expect(gen.mappingKind).toBe('cover');
  });

  test('schemas project into the declaration surface (.d.ts)', () => {
    // Schema-declaring modules ship real declarations (intrinsics +
    // aliases + a typed const), and reading them changes nothing else
    // (declarations never change the compile). The full shape
    // batteries live in schema-types.test.js beside this file and in
    // test/toolchain/dts.test.js.
    const result = fullCompile('S = schema :shape\n  a! string');
    expect(result.declarations).toContain('type S = { a: string };');
    expect(result.declarations).toContain('declare const S: Schema<S, S>;');
    expect(result.declarations).toContain('interface Schema<Out, In = unknown> {');
    expect(result.declarations).not.toContain('interface ModelSchema'); // no :model → no persistence tier
    const model = fullCompile('M = schema :model\n  a! string\n  @timestamps');
    expect(model.declarations).toContain('type MData = { a: string } & { id: number; createdAt: string; updatedAt: string };');
    expect(model.declarations).toContain('declare const M: ModelSchema<M, MData, number, MCreate>;');
  });

  test('a model declaration gets the standard store rows: $self, body role, cover mapping', () => {
    const src = 'M = schema :model, on: analytics\n  a! string\n  @timestamps\n  beforeSave: -> @a';
    const { stores, mappings } = compile(src);
    const nodes = stores.nodesByKind('schema');
    expect(nodes.length).toBe(1);
    const id = nodes[0].nodeId;
    expect(src.slice(nodes[0].sourceStart, nodes[0].sourceEnd))
      .toBe('schema :model, on: analytics\n  a! string\n  @timestamps\n  beforeSave: -> @a');
    const body = stores.role(id, 'body');
    expect(src.slice(body.sourceStart, body.sourceEnd))
      .toBe(':model, on: analytics\n  a! string\n  @timestamps\n  beforeSave: -> @a');
    const gen = mappings.bestAtSource(body.sourceStart);
    expect(gen).not.toBeNull();
    expect(gen.mappingKind).toBe('cover');
  });

  test('the model sexpr carries the kind string through toJSON', () => {
    const { sexpr } = compile('M = schema :model\n  a! string');
    expect(JSON.stringify(sexpr)).toBe('["program",["=","M",["schema","model"]]]');
  });

  test('the TS face carries the schema type story as TS-only bytes; strip reproduces JS mode', () => {
    // A model program's face carries the intrinsic block, the alias
    // cluster, the binding cast, and the hook's `this` parameter —
    // every byte a recorded TS-only region, so stripping is exactly
    // the JS emission by construction.
    const src = 'M = schema :model\n  a! string\n  beforeSave: -> @a';
    const r = parser.parse(src);
    const js = emit(r, { source: src });
    const ts = emit(parser.parse(src), { source: src, face: 'ts' });
    expect(ts.tsRegions.length).toBeGreaterThan(0);
    expect(ts.code).toContain('type MData = ');
    expect(ts.code).toContain('fn: (function(this: M) {');
    expect(ts.code).toContain(') as unknown as ModelSchema<M, MData, number, MCreate>');
    expect(stripFace(ts.code, ts.tsRegions)).toBe(js.code);
  });

  test('the sexpr carries the kind string through toJSON', () => {
    const { sexpr } = compile('S = schema :shape\n  a! string');
    expect(JSON.stringify(sexpr)).toBe('["program",["=","S",["schema","shape"]]]');
  });
});

// ════════════════════════════════════════════════════════════════════
// Wave D — the canonical validation pipeline: one value-returning
// pipeline behind every entry point; nested schemas run their FULL
// contract and their normalized values flow into the parent; array
// length bounds are enforced; async status is transitive.
// ════════════════════════════════════════════════════════════════════

describe('schema pipeline: array length bounds (R14)', () => {
  test('array min/max on length are enforced and agree with JSON Schema', () => {
    const out = run(
      'S = schema :shape\n  tags! string[], 1..2',
      `return [
        S.safe({tags: []}).errors[0].error,
        S.safe({tags: ["a", "b", "c"]}).errors[0].error,
        S.ok({tags: ["a"]}),
        S.ok({tags: ["a", "b"]}),
        S.toJSONSchema().properties.tags,
      ];`,
    );
    expect(out[0]).toBe('min');
    expect(out[1]).toBe('max');
    expect(out[2]).toBe(true);
    expect(out[3]).toBe(true);
    expect(out[4]).toEqual({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 });
  });

  test('array length failure carries the field path and precedes nothing spurious', () => {
    const out = run(
      'S = schema :shape\n  xs! integer[], 2..3',
      `const r = S.safe({xs: [1]}); return [r.errors.length, r.errors[0].field, r.errors[0].error];`,
    );
    expect(out).toEqual([1, 'xs', 'min']);
  });
});

describe('schema pipeline: nested normalization and write-back (R10)', () => {
  test('a nested default is applied and written into the parent value', () => {
    const out = run(
      'Child = schema :shape\n  a? integer, [7]\nParent = schema :shape\n  child! Child',
      `return Parent.parse({child: {}}).child.a;`,
    );
    expect(out).toBe(7);
  });

  test('a nested transform is applied and written back', () => {
    const out = run(
      'Child = schema :shape\n  full! string, -> it.first + " " + it.last\nParent = schema :shape\n  child! Child',
      `return Parent.parse({child: {first: "Ada", last: "L"}}).child.full;`,
    );
    expect(out).toBe('Ada L');
  });

  test('a nested coercion is applied and written back', () => {
    const out = run(
      'Child = schema :shape\n  n! ~integer\nParent = schema :shape\n  child! Child',
      `return [Parent.parse({child: {n: "42"}}).child.n, Parent.safe({child: {n: "nan"}}).errors[0].field];`,
    );
    expect(out).toEqual([42, 'child.n']);
  });

  test('a nested @ensure refinement is enforced through the parent', () => {
    const out = run(
      'Child = schema :shape\n  a! integer\n  @ensure "positive", (c) -> c.a > 0\nParent = schema :shape\n  child! Child',
      `return [Parent.ok({child: {a: 1}}), Parent.safe({child: {a: -1}}).errors[0].error, Parent.safe({child: {a: -1}}).errors[0].field];`,
    );
    expect(out).toEqual([true, 'ensure', 'child']);
  });

  test('nested date strings coerce to Date and write back', () => {
    const out = run(
      'Child = schema :shape\n  when! date\nParent = schema :shape\n  child! Child',
      `return Parent.parse({child: {when: "2026-07-12"}}).child.when instanceof Date;`,
    );
    expect(out).toBe(true);
  });

  test('array-of-nested normalizes every element and writes them back', () => {
    const out = run(
      'Child = schema :shape\n  a? integer, [5]\nParent = schema :shape\n  kids! Child[]',
      `return Parent.parse({kids: [{}, {a: 9}]}).kids.map((k) => k.a);`,
    );
    expect(out).toEqual([5, 9]);
  });

  test('two-level nesting normalizes and prefixes issue paths correctly', () => {
    const out = run(
      'Leaf = schema :shape\n  v! integer\n  @ensure "pos", (l) -> l.v > 0\nMid = schema :shape\n  leaf! Leaf\nTop = schema :shape\n  mid! Mid',
      `return [Top.parse({mid: {leaf: {v: 3}}}).mid.leaf.v, Top.safe({mid: {leaf: {v: -1}}}).errors[0].field];`,
    );
    expect(out).toEqual([3, 'mid.leaf']);
  });

  test('a discriminated-union nested member runs its full contract', () => {
    const out = run(
      'Click = schema :shape\n  kind! "click"\n  x! integer, [0]\nScroll = schema :shape\n  kind! "scroll"\n  dy! integer\nEvent = schema :union\n  @on :kind\n  Click\n  Scroll\nWrap = schema :shape\n  ev! Event',
      `return [Wrap.parse({ev: {kind: "click"}}).ev.x, Wrap.safe({ev: {kind: "scroll", dy: "x"}}).errors[0].field];`,
    );
    expect(out).toEqual([0, 'ev.dy']);
  });
});

describe('schema pipeline: transitive async status (E2)', () => {
  test('a parent with a nested @ensure! child refuses sync and validates async', async () => {
    const src = 'Child = schema :shape\n  e! string\n  @ensure! "taken", (c) -> Promise.resolve(c.e != "x")\nParent = schema :shape\n  child! Child';
    expect(() => run(src, 'return Parent.parse({child: {e: "ok"}});'))
      .toThrow(/async refinements/);
    const good = await run(src, 'return Parent.safeAsync({child: {e: "ok"}});');
    expect(good.ok).toBe(true);
    const bad = await run(src, 'return Parent.safeAsync({child: {e: "x"}});');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].field).toBe('child');
  });

  test('array-of-nested with async refinement is transitively async', async () => {
    const src = 'Child = schema :shape\n  n! integer\n  @ensure! "even", (c) -> Promise.resolve(c.n % 2 is 0)\nParent = schema :shape\n  kids! Child[]';
    expect(() => run(src, 'return Parent.ok({kids: [{n: 2}]});')).toThrow(/async refinements/);
    const bad = await run(src, 'return Parent.safeAsync({kids: [{n: 2}, {n: 3}]});');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].field).toBe('kids[1]');
  });
});
