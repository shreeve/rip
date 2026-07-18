// Identifier READs must carry their own exact mapping rows. Without one,
// byte-arithmetic remap collapses to the enclosing cover's start — wrong
// hover, null definition, fat diagnostics, dropped tokens. The three
// loss categories (call-arg list elements, annotation names, type-decl
// internals) share one fix: emit-time `read` markSpan rows from an
// anchored bare-word scan (the shorthandProp precedent).
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';

const ts = (src) => compile(src, { runtimeDelivery: 'none', face: 'ts' });
const js = (src) => compile(src, { runtimeDelivery: 'none' });

const exactNameAt = (src, rows, at, name) =>
  rows.filter((m) =>
    m.mappingKind === 'exact'
    && m.sourceStart <= at && at + name.length <= m.sourceEnd
    && src.slice(m.sourceStart, m.sourceEnd) === name);

describe('call-argument identifier reads (trigger table)', () => {
  // Each trigger alone was sufficient to lose the read. All six must
  // land an exact row on the argument `total`.
  const cases = [
    ['parens + no literal', 'total = 1\nconsole.log(total)\n'],
    ['parens + double-quoted', 'total = 1\nconsole.log("total:", total)\n'],
    ['parens + single-quoted', "total = 1\nconsole.log('total:', total)\n"],
    ['paren-less + no literal', 'total = 1\nconsole.log total\n'],
    ['paren-less + double-quoted', 'total = 1\nconsole.log "total:", total\n'],
    ['paren-less + single-quoted', "total = 1\nconsole.log 'total:', total\n"],
  ];

  for (const [label, src] of cases) {
    test(label, () => {
      const r = ts(src);
      expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
      const assignEnd = src.indexOf('\n') + 1;
      let at = -1;
      for (let from = assignEnd; ;) {
        const i = src.indexOf('total', from);
        if (i < 0) break;
        at = i;
        from = i + 1;
      }
      expect(at).toBeGreaterThan(0);
      expect(exactNameAt(src, r.mappings.rows, at, 'total').length).toBeGreaterThan(0);
      // Face-only — JS-mode corpus maps stay untouched.
      expect(js(src).mappings.rows.filter((m) => m.role === 'read')).toEqual([]);
    });
  }
});

describe('annotation and type-decl identifier reads', () => {
  test('annotation type name gets an exact read row', () => {
    const src = 'x: number = 5\n';
    const r = ts(src);
    const at = src.indexOf('number');
    const rows = exactNameAt(src, r.mappings.rows, at, 'number');
    expect(rows.some((m) => m.role === 'read')).toBe(true);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('type-decl internals (alias + object members) get exact read rows', () => {
    const src = "type Circle = { kind: 'circle', radius: number }\n";
    const r = ts(src);
    for (const name of ['Circle', 'kind', 'radius', 'number']) {
      const at = src.indexOf(name);
      expect(exactNameAt(src, r.mappings.rows, at, name).length).toBeGreaterThan(0);
    }
    expect(js(src).mappings.rows.filter((m) => m.role === 'read')).toEqual([]);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('import specifiers get exact read rows across quote-normalized from', () => {
    const src = 'import { add, greet } from "./m"\nconsole.log add\n';
    const r = ts(src);
    for (const name of ['add', 'greet']) {
      const at = src.indexOf(name);
      expect(exactNameAt(src, r.mappings.rows, at, name).length).toBeGreaterThan(0);
    }
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });
});

describe('render and param identifier reads (path-3 failure modes)', () => {
  test('defaulted param name is not stolen by a same-named body read', () => {
    const src = 'export C = component\n  set: (val = \'x\') -> p val\n  render null\n';
    const r = ts(src);
    const at = src.indexOf('val =');
    expect(exactNameAt(src, r.mappings.rows, at, 'val').some((m) => m.role === 'read')).toBe(true);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('label label text child is not stolen by a later opt.label', () => {
    const src = [
      'export Select = component',
      '  @label?: string',
      '  @options?: { value: string, label: string }[] := []',
      '  render',
      '    div',
      '      label label',
      '      for opt in options',
      '        span opt.label',
      '',
    ].join('\n');
    const r = ts(src);
    const line = src.split('\n').find((l) => l.includes('label label'));
    const lineAt = src.indexOf(line);
    const tagAt = lineAt + line.indexOf('label');
    const textAt = lineAt + line.indexOf('label', line.indexOf('label') + 1);
    expect(exactNameAt(src, r.mappings.rows, tagAt, 'label').length).toBeGreaterThan(0);
    expect(exactNameAt(src, r.mappings.rows, textAt, 'label').length).toBeGreaterThan(0);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('child prop key loading: loading marks the key, not only the RHS', () => {
    const src = [
      'export B = component',
      '  @loading?: boolean',
      '  render',
      '    button',
      'export C = component',
      '  loading := false',
      '  render',
      '    B loading: loading',
      '',
    ].join('\n');
    const r = ts(src);
    const pair = 'loading: loading';
    const pairAt = src.indexOf(pair);
    const keyAt = pairAt;
    const valAt = pairAt + 'loading: '.length;
    // Census asks for any exact row (role `key` or `read`); both ends
    // of `loading: loading` must have one so path-3 cannot leave the
    // key covering only by a verbatim cover prefix.
    expect(exactNameAt(src, r.mappings.rows, keyAt, 'loading').length).toBeGreaterThan(0);
    expect(exactNameAt(src, r.mappings.rows, valAt, 'loading').length).toBeGreaterThan(0);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('DOM attr key title: title marks the key, not a stolen RHS', () => {
    const src = [
      'export C = component',
      '  title := "x"',
      '  render',
      '    div title: title',
      '',
    ].join('\n');
    const r = ts(src);
    const pair = 'title: title';
    const pairAt = src.indexOf(pair);
    const keyAt = pairAt;
    const valAt = pairAt + 'title: '.length;
    const keyRows = exactNameAt(src, r.mappings.rows, keyAt, 'title');
    const valRows = exactNameAt(src, r.mappings.rows, valAt, 'title');
    expect(keyRows.length).toBeGreaterThan(0);
    expect(valRows.length).toBeGreaterThan(0);
    // Distinct generated spans — dual exacts collapsed onto the RHS
    // would still pass an existence-only census.
    const keyGen = keyRows.map((m) => `${m.generatedStart}:${m.generatedEnd}`);
    const valGen = valRows.map((m) => `${m.generatedStart}:${m.generatedEnd}`);
    expect(keyGen.some((g) => !valGen.includes(g))).toBe(true);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('two-way value <=> value marks both ends distinctly', () => {
    const src = [
      'export C = component',
      '  value := ""',
      '  render',
      '    input value <=> value',
      '',
    ].join('\n');
    const r = ts(src);
    const pair = 'value <=> value';
    const pairAt = src.indexOf(pair);
    const keyAt = pairAt;
    const valAt = pairAt + 'value <=> '.length;
    const keyRows = exactNameAt(src, r.mappings.rows, keyAt, 'value');
    const valRows = exactNameAt(src, r.mappings.rows, valAt, 'value');
    expect(keyRows.length).toBeGreaterThan(0);
    expect(valRows.length).toBeGreaterThan(0);
    const keyGen = keyRows.map((m) => `${m.generatedStart}:${m.generatedEnd}`);
    const valGen = valRows.map((m) => `${m.generatedStart}:${m.generatedEnd}`);
    expect(keyGen.some((g) => !valGen.includes(g))).toBe(true);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('same-named event key and bare method handler map distinctly', () => {
    const src = [
      'export C = component',
      '  click: -> p 1',
      '  render',
      '    button @click: click',
      '',
    ].join('\n');
    const r = ts(src);
    const pairAt = src.indexOf('@click: click');
    const keyAt = pairAt + 1;
    const valAt = pairAt + '@click: '.length;
    const keyRows = exactNameAt(src, r.mappings.rows, keyAt, 'click');
    const valRows = exactNameAt(src, r.mappings.rows, valAt, 'click');
    expect(keyRows.length).toBeGreaterThan(0);
    expect(valRows.length).toBeGreaterThan(0);
    const keyGen = keyRows.map((m) => `${m.generatedStart}:${m.generatedEnd}`);
    const valGen = valRows.map((m) => `${m.generatedStart}:${m.generatedEnd}`);
    expect(keyGen.some((g) => !valGen.includes(g))).toBe(true);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('own-line bare boolean attribute gets an exact read', () => {
    const src = [
      'export C = component',
      '  render',
      '    button',
      '      disabled',
      '',
    ].join('\n');
    const r = ts(src);
    const at = src.indexOf('disabled');
    expect(exactNameAt(src, r.mappings.rows, at, 'disabled').length).toBeGreaterThan(0);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });
});
