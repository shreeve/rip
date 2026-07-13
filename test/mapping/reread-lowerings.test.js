import { describe, expect, test } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { toSourceMap } from '../../src/sourcemap.js';
import { Mappings, Stores } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (source) => {
  const parsed = parser.parse(source);
  expect(parsed.diagnostics).toEqual([]);
  const out = emit(parsed, { source });
  return {
    source,
    ...out,
    map: toSourceMap(out, { source }),
    mappings: new Mappings(out.mappings),
    stores: new Stores(parsed.stores),
  };
};

const slices = (r, node, role) => r.mappings.of(node.nodeId, role)
  .map((row) => [row.mappingKind, r.source.slice(row.sourceStart, row.sourceEnd),
    r.code.slice(row.generatedStart, row.generatedEnd)]);

const exactOperand = (r, text) => {
  const start = r.source.indexOf(text);
  const rows = r.mappings.rows.filter((row) =>
    row.mappingKind === 'exact' &&
    row.sourceStart === start &&
    row.sourceEnd === start + text.length &&
    r.code.slice(row.generatedStart, row.generatedEnd) === text);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(r.mappings.atGenerated(row.generatedStart)).toContain(row);
  }
};

const coveredAt = (r, generated, source) => {
  const offsets = [];
  for (let at = r.code.indexOf(generated); at !== -1; at = r.code.indexOf(generated, at + 1)) offsets.push(at);
  expect(offsets.length).toBeGreaterThan(0);
  expect(offsets.some((at) => r.mappings.atGenerated(at).some((row) =>
    row.mappingKind === 'cover' &&
    r.source.slice(row.sourceStart, row.sourceEnd) === source &&
    row.generatedStart <= at && at < row.generatedEnd))).toBe(true);
};

const syntheticDot = (r, memberSource) => {
  const member = r.stores.nodesByKind('member').find((node) =>
    slices(r, node, '$self').some(([, source]) => source === memberSource));
  expect(member).toBeDefined();
  expect(slices(r, member, 'operator').some(([kind, source, generated]) =>
    kind === 'synthetic' && source === '' && generated === '.')).toBe(true);
};

const noMintedNames = (r) => {
  expect(r.map.names.some((name) => /^_(?:ref|o|k|key|n)\d*$/.test(name))).toBe(false);
};

describe('optional-assignment reread mappings', () => {
  test('statement synthesized compound maps receiver, base, key, read, write, and RHS', () => {
    const r = compile('get()?.box[key()] //= rhs()');
    const [assign] = r.stores.nodesByKind('assign');
    const [index] = r.stores.nodesByKind('index');

    exactOperand(r, 'get()');
    exactOperand(r, 'key()');
    exactOperand(r, 'rhs()');
    expect(slices(r, index, 'object')).toEqual([
      ['cover', 'get()?.box', '_ref.box'],
      ['cover', 'get()?.box', '_o'],
      ['cover', 'get()?.box', '_o'],
    ]);
    expect(slices(r, index, 'key')).toEqual([
      ['exact', 'key()', 'key()'],
      ['cover', 'key()', '_k'],
      ['cover', 'key()', '_k'],
    ]);
    expect(slices(r, assign, 'target')).toEqual([
      ['cover', 'get()?.box[key()]', '_o[_k]'],
      ['cover', 'get()?.box[key()]', '_o[_k]'],
    ]);
    expect(slices(r, assign, 'value')).toEqual([['exact', 'rhs()', 'rhs()']]);
    expect(slices(r, assign, 'operator')).toEqual([
      ['cover', '//=', '='],
      ['cover', '//=', 'Math.floor(_o[_k] / rhs())'],
    ]);
    coveredAt(r, '_ref', 'get()');
    coveredAt(r, '_o', 'get()?.box');
    coveredAt(r, '_k', 'key()');
    syntheticDot(r, 'get()?.box');
    noMintedNames(r);
  });

  test('value assignment keeps receiver capture while key and RHS remain exact', () => {
    const r = compile('result = (get()?.box[key()] = rhs())');
    const inner = r.stores.nodesByKind('assign').find((node) =>
      slices(r, node, '$self').some(([, source]) => source === 'get()?.box[key()] = rhs()'));
    expect(inner).toBeDefined();
    exactOperand(r, 'get()');
    exactOperand(r, 'key()');
    exactOperand(r, 'rhs()');
    expect(slices(r, inner, 'target')).toEqual([
      ['cover', 'get()?.box[key()]', '_ref.box[key()]'],
    ]);
    expect(slices(r, inner, 'value')).toEqual([['exact', 'rhs()', 'rhs()']]);
    expect(slices(r, inner, 'operator')).toEqual([['synthetic', '', '=']]);
    coveredAt(r, '_ref', 'get()');
    syntheticDot(r, 'get()?.box');
    noMintedNames(r);
  });
});

describe('loop and destructuring reread mappings', () => {
  const cases = [
    {
      name: 'range endpoint',
      source: 'for i in [0...get().limit]\n  use i',
      operand: 'get().limit',
      scaffold: '_ref',
      owner: 'for i in [0...get().limit]\n  use i',
    },
    {
      name: 'loop count',
      source: 'loop get().count\n  use it',
      operand: 'get().count',
      scaffold: '_n',
      owner: 'loop get().count\n  use it',
    },
    {
      name: 'indexed source',
      source: 'for x, i in get().items\n  use x',
      operand: 'get().items',
      scaffold: '_ref',
      owner: 'for x, i in get().items\n  use x',
    },
    {
      name: 'own source',
      source: 'for own k of get().obj\n  use k',
      operand: 'get().obj',
      scaffold: '_ref',
      owner: 'for own k of get().obj\n  use k',
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const r = compile(c.source);
      exactOperand(r, c.operand);
      coveredAt(r, c.scaffold, c.owner);
      syntheticDot(r, c.operand);
      noMintedNames(r);
    });
  }

  test('middle rest maps its source exactly and every generated reread through the assignment cover', () => {
    const source = '[a, ...mid, b] = get().items';
    const r = compile(source);
    const [assign] = r.stores.nodesByKind('assign');
    expect(slices(r, assign, 'value')).toEqual([['exact', 'get().items', 'get().items']]);
    for (const generated of ['_ref[0]', '_ref.slice(1, -1)', '_ref[_ref.length - 1]']) {
      coveredAt(r, generated, source);
    }
    exactOperand(r, 'get().items');
    syntheticDot(r, 'get().items');
    noMintedNames(r);
  });
});

describe('assignment and class-field capture mappings', () => {
  test('method assignment maps the captured write/read expression as target and value covers', () => {
    const source = 'get().name .= trim()';
    const r = compile(source);
    const [assign] = r.stores.nodesByKind('assign');
    exactOperand(r, 'get()');
    expect(slices(r, assign, 'target')).toEqual([['cover', 'get().name', '_ref.name']]);
    expect(slices(r, assign, 'value')).toEqual([['cover', 'trim()', '_ref.name.trim()']]);
    expect(slices(r, assign, 'operator')).toEqual([['synthetic', '', '=']]);
    coveredAt(r, '_ref', source);
    noMintedNames(r);
  });

  test('merge assignment maps both target manifestations and the RHS exactly', () => {
    const source = '*>get().inner = rhs()';
    const r = compile(source);
    const [assign] = r.stores.nodesByKind('assign');
    exactOperand(r, 'get()');
    exactOperand(r, 'rhs()');
    expect(slices(r, assign, 'target')).toEqual([
      ['cover', 'get().inner', '_ref.inner'],
      ['cover', 'get().inner', '_ref.inner'],
    ]);
    expect(slices(r, assign, 'value')).toEqual([['exact', 'rhs()', 'rhs()']]);
    expect(slices(r, assign, 'operator')).toEqual([['synthetic', '', '=']]);
    coveredAt(r, '_ref', source);
    noMintedNames(r);
  });

  test('class-field captures are covered by the field value and exact inside each activation', () => {
    const source = 'class Box\n  value = get().x //= 2';
    const r = compile(source);
    const field = r.stores.nodesByKind('assign').find((node) =>
      slices(r, node, '$self').some(([, sourceText]) => sourceText === 'value = get().x //= 2'));
    const compound = r.stores.nodesByKind('assign').find((node) =>
      slices(r, node, '$self').some(([, sourceText]) => sourceText === 'get().x //= 2'));
    expect(field).toBeDefined();
    expect(compound).toBeDefined();
    exactOperand(r, 'get()');
    exactOperand(r, '2');
    expect(slices(r, field, 'value')).toEqual([
      ['cover', 'get().x //= 2', '(() => { let _o; return (_o = get(), _o.x = Math.floor(_o.x / 2)); })()'],
    ]);
    expect(slices(r, compound, 'target')).toEqual([
      ['cover', 'get().x', '_o.x'],
      ['cover', 'get().x', '_o.x'],
    ]);
    coveredAt(r, '_o', 'get().x //= 2');
    syntheticDot(r, 'get().x');
    noMintedNames(r);
  });

  test('UTF-16 source spans and names preserve non-ASCII operands without minted names', () => {
    const r = compile('préfixe = "😀"\nrésultat = obtenir()?.boîte[clé()] //= droite()');
    for (const text of ['obtenir()', 'boîte', 'clé()', 'droite()']) exactOperand(r, text);
    expect(r.map.names).toEqual(expect.arrayContaining(['préfixe', 'résultat', 'obtenir', 'boîte', 'clé', 'droite']));
    noMintedNames(r);
    const keyStart = r.source.indexOf('clé()');
    const key = r.mappings.rows.find((row) =>
      row.mappingKind === 'exact' && row.sourceStart === keyStart &&
      r.code.slice(row.generatedStart, row.generatedEnd) === 'clé()');
    expect(key.sourceEnd - key.sourceStart).toBe('clé()'.length);
    expect(r.mappings.bestAtGenerated(key.generatedStart)?.sourceStart).toBe(keyStart);
  });

  test('Unicode globals capture at reread sites while bound Unicode locals remain bare', () => {
    const unresolved = compile([
      'résultat?.x = 1',
      'for i in [0...limité]',
      '  use i',
      'for élément, index in éléments',
      '  use élément',
    ].join('\n'));
    expect(unresolved.code).toMatch(/_ref = résultat/);
    expect(unresolved.code).toMatch(/_ref\d* = limité/);
    expect(unresolved.code).toMatch(/_ref\d* = éléments/);
    expect(unresolved.map.names).toContain('résultat');
    noMintedNames(unresolved);

    const bound = compile([
      'résultat = {x: 0}',
      'limité = 2',
      'éléments = [1, 2]',
      'résultat?.x = 1',
      'for i in [0...limité]',
      '  use i',
      'for élément, index in éléments',
      '  use élément',
    ].join('\n'));
    expect(bound.code).not.toMatch(/_ref\d* = (?:résultat|limité|éléments)/);
    expect(bound.code).toContain('let élément = éléments[');
    expect(bound.map.names).toEqual(expect.arrayContaining([
      'résultat', 'limité', 'éléments',
    ]));
    noMintedNames(bound);
  });
});
