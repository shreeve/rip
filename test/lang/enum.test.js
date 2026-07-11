// Enum codegen: `enum Name` lowers to ONE const object mapping
// forward (member → value) and reverse (value → member) — real
// codegen, not erasure. Every incorrect form rejects loudly: bare
// members, expression values, and colliding keys have no enum form.
import { describe, test, expect } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Stores, Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const { code, mappings } = emit(r, { source: src });
  return { code, mappings: new Mappings(mappings), stores: new Stores(r.stores), sexpr: r.sexpr };
};

const parseFails = (src) => {
  let r;
  try {
    r = parser.parse(src);
  } catch (err) {
    expect(err.message).toBeTruthy();
    return;
  }
  expect(r.diagnostics).not.toEqual([]);
};

// ── Runtime behavior: both directions work ──────────────────────────

describe('enum: runtime behavior', () => {
  test('forward and reverse lookups', () => {
    const { code } = compile('enum Color\n  red = 0\n  green = 1\n  blue = 2');
    const [f, r1, r2] = new Function(`${code} return [Color.red, Color[1], Color[Color.blue]];`)();
    expect(f).toBe(0);
    expect(r1).toBe('green');
    expect(r2).toBe('blue');
  });

  test('string-valued members round-trip', () => {
    const { code } = compile('enum Tier\n  free = "f"\n  pro = "p"');
    const [v, k] = new Function(`${code} return [Tier.pro, Tier["f"]];`)();
    expect(v).toBe('p');
    expect(k).toBe('free');
  });

  test('negative values key through their quoted form', () => {
    const { code } = compile('enum Dir\n  up = 1\n  down = -1');
    expect(code).toBe('const Dir = {up: 1, down: -1, 1: "up", "-1": "down"};');
    const [v, k] = new Function(`${code} return [Dir.down, Dir[-1]];`)();
    expect(v).toBe(-1);
    expect(k).toBe('down');
  });

  test('enum inside a function body stays function-scoped', () => {
    const { code } = compile('f = ->\n  enum C\n    a = 7\n  C.a\nf()');
    expect(new Function(`let out; const capture = (v) => { out = v; }; ${code.replace('f();', 'capture(f());')} return out;`)()).toBe(7);
  });
});

// ── Zero-cost: enum output is self-contained ────────────────────────

test('enum output carries no imports and no preamble', () => {
  const { code } = compile('enum Color\n  red = 0');
  expect(code).toBe('const Color = {red: 0, 0: "red"};');
});

// ── Statement discipline + rejections ───────────────────────────────

describe('enum: statement discipline and rejections', () => {
  test('expression position is a parse error', () => {
    parseFails('x = enum C\n  a = 0');
  });

  test('tail position emits a plain statement, never a returned declaration', () => {
    const { code } = compile('f = ->\n  enum C\n    a = 0');
    expect(code).toContain('  const C = {a: 0, 0: "a"};\n');
    expect(code).not.toContain('return const');
  });

  test('bare members reject — a bare member has no value for the reverse mapping', () => {
    const src = 'enum Color\n  red\n  green';
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: src })).toThrow(/bare member has no value/);
  });

  test('expression values reject — the reverse mapping needs a literal key', () => {
    for (const src of ['enum C\n  a = 1 + 2', 'enum C\n  a = f()', 'enum C\n  a = x', 'enum C\n  a = [1]', 'enum C\n  a = -x']) {
      const r = parser.parse(src);
      expect(r.diagnostics).toEqual([]);
      expect(() => emit(r, { source: src })).toThrow(/number or string literal value/);
    }
  });

  test('colliding keys reject — forward and reverse entries share one object', () => {
    for (const src of [
      'enum C\n  a = 0\n  b = 0',        // duplicate value
      'enum C\n  a = 0\n  a = 1',        // duplicate member
      'enum C\n  a = 1\n  b = "a"',      // value collides with a member name
      'enum C\n  a = 0x10\n  b = 16',    // same numeric key, different spelling
    ]) {
      const r = parser.parse(src);
      expect(r.diagnostics).toEqual([]);
      expect(() => emit(r, { source: src })).toThrow(/used more than once/);
    }
  });

  test('no member `let` leaks into function hoists', () => {
    const { code } = compile('f = ->\n  enum C\n    a = 0\n  C.a');
    expect(code).not.toContain('let a;');
  });

  test('enum requires a name and a block', () => {
    parseFails('enum\n  a = 0');
    parseFails('enum Color');
    parseFails('enum = 5');
  });

  test('prototype-named members are real own properties', () => {
    // A literal `__proto__:` key — bare or quoted — is the
    // prototype-SET form; only the computed spelling creates an own
    // property. The emitter spells `["__proto__"]:` for exactly that
    // name, in both directions.
    const asMember = compile('enum C\n  __proto__ = 1\n  a = 2');
    expect(asMember.code).toBe('const C = {["__proto__"]: 1, a: 2, 1: "__proto__", 2: "a"};');
    const C1 = new Function(`${asMember.code} return C;`)();
    expect(Object.getPrototypeOf(C1)).toBe(Object.prototype);
    expect([C1.__proto__, C1[1], C1.a]).toEqual([1, '__proto__', 2]);

    const asValue = compile('enum D\n  a = "__proto__"');
    expect(asValue.code).toBe('const D = {a: "__proto__", ["__proto__"]: "a"};');
    const D1 = new Function(`${asValue.code} return D;`)();
    expect(Object.getPrototypeOf(D1)).toBe(Object.prototype);
    expect([D1.a, D1.__proto__]).toEqual(['__proto__', 'a']);

    // every OTHER Object.prototype name is an ordinary own property in
    // literal form — verbatim keys
    const others = compile('enum E\n  constructor = 1\n  hasOwnProperty = 2\n  toString = 3');
    const E1 = new Function(`${others.code} return E;`)();
    expect(Object.getOwnPropertyNames(E1).sort()).toEqual(['1', '2', '3', 'constructor', 'hasOwnProperty', 'toString']);
    expect([E1.constructor, E1[2], E1.toString]).toEqual([1, 'hasOwnProperty', 3]);
  });

  test('an escape spelling that DECODES to __proto__ gets the computed key too', () => {
    // The own-key decision reads the DECODED key, not the literal
    // text — the `\u005f` spelling is the same dangerous key.
    const src = 'enum C\n  a = "\\u005f_proto__"';
    const { code } = compile(src);
    expect(code).toBe('const C = {a: "\\u005f_proto__", ["__proto__"]: "a"};');
    const C1 = new Function(`${code} return C;`)();
    expect(Object.getPrototypeOf(C1)).toBe(Object.prototype);
    expect([C1.a, C1.__proto__]).toEqual(['__proto__', 'a']);
    // and the duplicate check sees through spellings: a plain
    // "__proto__" value plus the escape spelling is ONE key twice
    const dup = 'enum D\n  a = "__proto__"\n  b = "\\u005f_proto__"';
    const r = parser.parse(dup);
    expect(() => emit(r, { source: dup })).toThrow(/used more than once/);
  });

  test('JS-only string escapes reject with the member and escape named', () => {
    // `\x5f` is a valid JS escape with no JSON decoding — the
    // rejection identifies the enum, the member, and the escape
    // (never a raw parser error).
    const bad = 'enum C\n  a = "\\x5f_proto__"';
    const r = parser.parse(bad);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: bad }))
      .toThrow(/enum 'C' member 'a' — its string value uses the '\\x' escape.*JSON escapes only/);
    // JSON-decodable escapes stay legal, both directions
    const { code } = compile('enum E\n  a = "b\\nc"');
    expect(code).toBe('const E = {a: "b\\nc", "b\\nc": "a"};');
    const E1 = new Function(`${code} return E;`)();
    expect([E1.a, E1['b\nc']]).toEqual(['b\nc', 'a']);
  });

  test('bracket-spelled members reject with the form named', () => {
    const src = 'enum C\n  ["__proto__"] = 1';
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: src }))
      .toThrow(/member names are plain identifiers.*not an enum form/);
  });

  test('template-valued members reject (no literal key form)', () => {
    const src = "enum C\n  a = '''\n  t\n  '''";
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: src })).toThrow(/number or string literal value/);
  });
});

// ── Side tables + mapping pins ───────────────────────────────────────

describe('enum: stores and mappings', () => {
  test('enum roles land in the side tables and round-trip', () => {
    const src = 'enum Color\n  red = 0\n  green = 1';
    const { stores, mappings } = compile(src);
    const enums = stores.nodesByKind('enum');
    expect(enums.length).toBe(1);
    const id = enums[0].nodeId;
    const name = stores.role(id, 'name');
    expect(src.slice(name.sourceStart, name.sourceEnd)).toBe('Color');
    const body = stores.role(id, 'body');
    expect(src.slice(body.sourceStart, body.sourceEnd)).toBe('red = 0\n  green = 1');

    // the name maps exactly: source `Color` → generated `Color`
    const gen = mappings.bestAtSource(name.sourceStart);
    expect(gen).not.toBeNull();
    expect(gen.mappingKind).toBe('exact');

    // member target/value rows map exactly on the forward entries
    const redAt = src.indexOf('red');
    const row = mappings.bestAtSource(redAt);
    expect(row).not.toBeNull();
  });

  test('the reverse entries are second manifestations (one-to-many)', () => {
    const src = 'enum C\n  a = 0';
    const { mappings, code } = compile(src);
    // the member's source span has generated rows on BOTH the forward
    // and the reverse entry
    const aAt = src.indexOf('a = 0');
    const rows = mappings.rows.filter((r) => r.sourceStart <= aAt && aAt < r.sourceEnd && r.role === '$self');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(code).toBe('const C = {a: 0, 0: "a"};');
  });
});

// ── Declarations ─────────────────────────────────────────────────────

describe('enum: declaration emission', () => {
  test('enums declare as TS enum declarations with the declare prefix', async () => {
    const { compile: fullCompile } = await import('../../src/compile.js');
    const src = 'enum Color\n  red = 0\n  green = 1\nexport enum Tier\n  free = "f"\n  pro = "p"';
    const dts = fullCompile(src).declarations;
    expect(dts).toBe(
      'declare enum Color {\n  red = 0,\n  green = 1\n}\n' +
      'export declare enum Tier {\n  free = "f",\n  pro = "p"\n}\n',
    );
  });
});

// ── Token stream: `enum` is a keyword ────────────────────────────────

describe('enum: token stream', () => {
  test('enum keyword tokenizes as ENUM', () => {
    const kinds = tokenize('enum Color\n  red = 0').tokens.map((t) => t.kind);
    expect(kinds).toEqual(['ENUM', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', '=', 'NUMBER', 'OUTDENT']);
  });

  test('property and key positions stay identifiers', () => {
    expect(tokenize('a.enum').tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', '.', 'PROPERTY']);
    expect(tokenize('x = {enum: 1}').tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', '=', '{', 'PROPERTY', ':', 'NUMBER', '}']);
  });

  test('ENUM token carries exact spans', () => {
    const [t] = tokenize('enum C\n  a = 0').tokens;
    expect([t.kind, t.start, t.end]).toEqual(['ENUM', 0, 4]);
  });
});
