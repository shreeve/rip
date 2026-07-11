// The pick operator `.{}`/`?.{}` — lexer PICK tokens
// (PICK_START/OPTPICK_START/PICK_END + the scan-time PROPERTY key
// tagging), the Pick grammar (PickList/PickItem/PickKey on
// SimpleAssignable and ObjSpreadExpr), and the emitter lowerings.
// Covers tokenization, valid-JS emission across the surface, runtime
// semantics (rename, defaults, single evaluation, optional
// short-circuit), loud rejections, and mapping spans.
import { describe, test, expect } from 'bun:test';
import parser from '../../src/parser.js';
import { tokenize, makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile } from '../../src/compile.js';

parser.lexer = makeParserLexer();

const compileOk = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

const parseFails = (src) => {
  const r = parser.parse(src);
  expect(r.sexpr).toBeNull();
  expect(r.diagnostics).not.toHaveLength(0);
};
const emitFails = (src, re) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  expect(() => emit(r, { source: src })).toThrow(re);
};
const kinds = (text) => tokenize(text).tokens.map(t => t.kind);

describe('pick token fixtures: the dotted-pick retag', () => {
  test('tight `.{` retags to PICK_START…PICK_END; the dot leaves the tape', () => {
    expect(kinds('x = o.{a}')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'PICK_START', 'PROPERTY', 'PICK_END']);
    expect(kinds('x = o?.{a}')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'OPTPICK_START', 'PROPERTY', 'PICK_END']);
  });

  test('keys lex PROPERTY only when the brace sits tight against its first key', () => {
    expect(kinds('x = o.{ a }')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'PICK_START', 'IDENTIFIER', 'PICK_END']);
  });

  test('keyword-named keys lex as plain key words in tight pick bodies', () => {
    expect(kinds('x = o.{type, class}')).toEqual([
      'IDENTIFIER', '=', 'IDENTIFIER', 'PICK_START', 'PROPERTY', ',', 'PROPERTY', 'PICK_END',
    ]);
  });

  test('a spaced or line-leading dot never retags; nested object braces stay raw', () => {
    expect(kinds('x = o. {a}')).toContain('.');
    expect(kinds('x = o. {a}')).not.toContain('PICK_START');
    expect(kinds('x = o.{a = {k: 1}}')).toEqual([
      'IDENTIFIER', '=', 'IDENTIFIER', 'PICK_START', 'PROPERTY', '=', '{', 'PROPERTY', ':', 'NUMBER', '}', 'PICK_END',
    ]);
  });

  test('non-INDEXABLE receivers keep the member dot (no pick)', () => {
    expect(kinds('x = +.{a}')).not.toContain('PICK_START');
  });
});

describe('pick emission and evaluation', () => {
  test('the full battery compiles clean and Function-validates', () => {
    for (const src of [
      'x = o.{a}',
      'x = o.{a, b}',
      'x = o.{a, b: c, d = 5}',
      'x = o.{a: b = 5}',
      'x = o?.{a, b}',
      'x = f().{a, b}',
      'x = f()?.{a}',
      'x = this.{a}',
      'x = @.{a}',
      'x = o.b.{c}',
      'x = a[0].{b}',
      'x = (a or b).{c}',
      'x = o.{a}.a',
      'x = o.{a}[k]',
      'x = o.{a = b or c}',
      'x = o.{a = b + 1}',
      'x = o.{a = {}}',
      'x = o.{a = [1]}',
      'x = o.{a,}',
      'x = o.{ a, b }',
      'x = u.{type, id}',
      'x = o.{class}',
      'x = [1].{length}',
      'x = "s".{length}',
      'x = o.{\n  a\n  b: c\n}',
      'y = {...o.{a, b}}',
      'y = {...f().{a}, c: 1}',
      'y = {...o?.{a}}',
      'f(o.{a})',
      'f o.{a}',
      'f(o?.{a})',
      'f(w.x.{a})',
      'x = new C(o.{a})',
      's = "v: #{o.{a}}"',
      'x = f(g(o.{a}))',
      'console.log o.{a}, o.{b}',
      'x = h?.(o.{a})',
      'class A extends B\n  constructor: ->\n    super(o.{a})',
      'return o.{a}',
      'x = o.{a} if c',
      'x = o.{a} or 1',
      '{p} = o.{a}',
    ]) {
      const code = compileOk(src);
      expect(() => new Function(code.replace(/^export /gm, ''))).not.toThrow();
    }
  });

  test('eval: rename maps dstKey to source.srcKey; defaults fire on NULLISH only', () => {
    const src = 'o = {a: 1, b: null, c: false}\nout = o.{a, b: bee = 9, c = 8, d = 7}';
    const code = compileOk(src);
    expect(new Function(`${code}\nreturn out;`)()).toEqual({ a: 1, bee: 9, c: false, d: 7 });
  });

  test('eval: complex sources evaluate ONCE through the IIFE', () => {
    const src = 'calls = []\nf = -> (calls.push(1); {a: 1, b: 2})\nout = f().{a, b}';
    const code = compileOk(src);
    expect(new Function(`${code}\nreturn [calls, out];`)()).toEqual([[1], { a: 1, b: 2 }]);
  });

  test('eval: optional picks short-circuit nullish sources to undefined', () => {
    const src = 'm = null\nhit = ({v: 1})?.{v}\nmiss = m?.{v}';
    const code = compileOk(src);
    expect(new Function(`${code}\nreturn [hit, miss];`)()).toEqual([{ v: 1 }, undefined]);
  });

  test('reactive sources unwrap per read (scope-aware)', () => {
    const src = 'count := {a: 1}\nx = count.{a}';
    const { code } = compile(src, { runtimeDelivery: 'none' });
    expect(code).toContain('x = ({a: count.value.a});');
  });
});

describe('pick rejections: loud where the lowering has no valid form', () => {
  test('a pick is not an assignment target', () => {
    emitFails('o.{a} = 5', /a pick expression is not an assignment target/);
  });

  test('await/yield in a default cannot cross the single-evaluation IIFE', () => {
    emitFails('main = -> f().{a = await g()}', /a pick default cannot await/);
    emitFails('gen = -> x = f().{a = yield 1}', /a pick default cannot yield/);
    // SIMPLE sources have no IIFE: awaits and yields stay legal.
    const code = compileOk('main = -> o.{a = await g()}');
    expect(code).toContain('async function');
    expect(() => new Function(code)).not.toThrow();
  });

  test('parse rejections: empty body, chained picks, super receivers, loop targets', () => {
    parseFails('x = o.{}');
    parseFails('x = o.{a}.{b}');
    parseFails('class A extends B\n  m: -> super.{a}');
    parseFails('for o.{a} in xs\n  1');
    parseFails('x = o.{"a"}');
    parseFails('x = o.{1}');
    // The spaced-brace keyword quirk: `{ class }` un-tags the key, the
    // keyword surfaces, and the parse rejects.
    parseFails('x = o.{ class }');
  });
});

describe('pick mapping: source/items/key/target/default roles land with real spans', () => {
  test('the pick node and its items carry NodeStore rows and role spans', () => {
    const src = 'x = user.{id, name: tag, role = "basic"}';
    const { stores, mappings } = compile(src);
    const [pick] = stores.nodesByKind('pick');
    expect(pick).toBeDefined();
    expect(src.slice(pick.sourceStart, pick.sourceEnd)).toBe('user.{id, name: tag, role = "basic"}');

    const sourceRows = mappings.of(pick.nodeId, 'source');
    expect(sourceRows.length).toBeGreaterThanOrEqual(1);
    expect(src.slice(sourceRows[0].sourceStart, sourceRows[0].sourceEnd)).toBe('user');

    const itemsRows = mappings.of(pick.nodeId, 'items');
    expect(itemsRows.length).toBeGreaterThanOrEqual(1);
    expect(src.slice(itemsRows[0].sourceStart, itemsRows[0].sourceEnd)).toBe('id, name: tag, role = "basic"');

    const items = stores.nodesByKind('pickitem');
    expect(items).toHaveLength(3);
    const rename = items[1];
    expect(src.slice(rename.sourceStart, rename.sourceEnd)).toBe('name: tag');
    const keyRole = stores.role(rename.nodeId, 'key');
    expect(src.slice(keyRole.sourceStart, keyRole.sourceEnd)).toBe('name');
    const targetRole = stores.role(rename.nodeId, 'target');
    expect(src.slice(targetRole.sourceStart, targetRole.sourceEnd)).toBe('tag');
    const defaulted = items[2];
    const defRole = stores.role(defaulted.nodeId, 'default');
    expect(src.slice(defRole.sourceStart, defRole.sourceEnd)).toBe('"basic"');
  });
});
