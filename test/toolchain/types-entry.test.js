// The types entry: every TYPE, CAST and SATISFIES token's run parses from
// the grammar's TypeAnnotation start symbol, and the token's value is
// ["type", {}, raw, body]. These pins hold the pieces the corpus gates
// cannot name one by one: the payload tape (src/types.js typeTape), the
// tree each type form builds, the opaque fallback and its roll-back, how a
// rule that erases an annotation still reaches its tree, the table the
// entry leaves alone, and the conflict gate an entry's states answer to.
import { test, expect, describe } from 'bun:test';
import { Parser, parser as shipped, ruleNames } from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { Stores } from '../../src/stores.js';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';
import { splitData } from '../../src/compiler.js';
import { join } from 'node:path';

const parse = (src, opts = {}) => {
  const p = Parser();
  p.lexer = makeParserLexer('<types-entry>', { tolerant: opts.tolerant ?? false });
  return p.parse(src, opts);
};
const values = (src, opts) => parse(src, opts).stores.entryValues;
const bodyOf = (src) => {
  const [v] = values(src);
  return v[3];
};
const tape = (src) => {
  const { tokens, payloads } = tokenize(src);
  return tokens.filter((t) => payloads.has(t)).map((t) => payloads.get(t).map((p) => (p.kind === 'IDENTIFIER' ? p.value : p.kind)).join(' '));
};
const name = (raw) => ['name', {}, raw];
const none = ['none', {}];

describe('the payload tape', () => {
  test('a shift spelling closes one generic per character, each its own span', () => {
    const { tokens, payloads } = tokenize('x: A<B<C>> = 1');
    const run = payloads.get(tokens[1]);
    expect(run.map((t) => t.kind)).toEqual(['IDENTIFIER', '<', 'IDENTIFIER', '<', 'IDENTIFIER', '>', '>']);
    expect(run.slice(5).map((t) => [t.start, t.end])).toEqual([[8, 9], [9, 10]]);
    expect(tape('y = x as A<B<C<D>>>')).toEqual(['A < B < C < D > > >']);
  });

  test('a `?` directly before a `:` fuses into OPTIONAL_COLON; elsewhere it stays itself', () => {
    expect(tape('x: { a?: A, b ?: B } = 1')).toEqual(['{ a OPTIONAL_COLON A , b OPTIONAL_COLON B }']);
    expect(tape('x: [A?] = 1')).toEqual(['[ A ? ]']);
    expect(tape('x: T extends U ? A : B = 1')).toEqual(['T EXTENDS U ? A : B']);
  });

  test('a contextual type word is an operator only where it acts as one', () => {
    expect(tape('x: keyof T = 1')).toEqual(['KEYOF T']);
    expect(tape('x: keyof = 1')).toEqual(['keyof']);
    expect(tape('x: { readonly: boolean, readonly a: A } = 1')).toEqual(['{ readonly : boolean , READONLY a : A }']);
    expect(tape('x: unique symbol = 1')).toEqual(['UNIQUE symbol']);
    expect(tape('x: unique = 1')).toEqual(['unique']);
    expect(tape('y = x as typeof z')).toEqual(['TYPEOF z']);
    expect(tape('def f(v: unknown): v is T\n  v')).toEqual(['unknown', 'v IS T']);
    expect(tape('x: { [K in keyof T]: V } = 1')).toEqual(['{ [ K IN KEYOF T ] : V }']);
  });

  test('a member name that opens a line a `>` kept from breaking gets its separator', () => {
    expect(tape('x: {\n  a: Array<number>\n  b: string\n} = 1')).toEqual(['{ a : Array < number > TERMINATOR b : string }']);
  });

  test('a modifier that opens a line a `>` kept from breaking takes the separator before it', () => {
    const { tokens } = tokenize('x: {\n  a: Foo<X>\n  readonly b: B\n} = 1');
    expect(tokens[1].value).toBe('{ a: Foo<X>; readonly b: B }');
    expect(tape('x: {\n  a: Foo<X>\n  readonly b: B\n} = 1')).toEqual(['{ a : Foo < X > TERMINATOR READONLY b : B }']);
    expect(tape('x: {a: readonly string[], b: B} = 1')).toEqual(['{ a : READONLY string [ ] , b : B }']);
  });

  test('a line break after a trailing comma separates nothing more', () => {
    const { tokens } = tokenize('x: {\n  a: A,\n  b: B\n} = 1');
    expect(tokens[1].value).toBe('{ a: A, b: B }');
    expect(tape('x: {\n  a: A,\n  b: B\n} = 1')).toEqual(['{ a : A , b : B }']);
    expect(tape('x: [\n  A,\n  B\n] = 1')).toEqual(['[ A , B ]']);
  });

  test('a member modifier opens its row: no seam falls between `readonly` and the name', () => {
    const { tokens } = tokenize('x: {readonly a: A} = v');
    expect(tokens[1].value).toBe('{ readonly a: A }');
    expect(bodyOf('x: {readonly a: A} = v')).toEqual(['type-object', {}, ['type-prop', { readonly: true }, name('a'), name('A')]]);
  });
});

describe('the trees type forms build', () => {
  const cases = [
    ['x: string = 1', name('string')],
    ['x: A | B | C = 1', ['type-union', {}, name('A'), name('B'), name('C')]],
    ['x: A & B = 1', ['type-intersection', {}, name('A'), name('B')]],
    ['x: A | B & C = 1', ['type-union', {}, name('A'), ['type-intersection', {}, name('B'), name('C')]]],
    ['x: Map<K, V[]> = 1', ['type-apply', {}, name('Map'), name('K'), ['type-array', {}, name('V')]]],
    ['x: A.B = 1', ['type-member', {}, name('A'), name('B')]],
    ['x: T["k"] = 1', ['type-index', {}, name('T'), ['string', {}, '"k"']]],
    ['x: keyof T[] = 1', ['type-keyof', {}, ['type-array', {}, name('T')]]],
    ['x: (A | B)[] = 1', ['type-array', {}, ['type-union', {}, name('A'), name('B')]]],
    ['x: 0 | -1 = 1', ['type-union', {}, ['num', {}, '0'], ['type-negative', {}, ['num', {}, '1']]]],
    ['x: null | undefined | true = 1', ['type-union', {}, ['lit', {}, 'null'], ['lit', {}, 'undefined'], ['lit', {}, 'true']]],
    ['x: T extends U ? A : B = 1', ['type-conditional', {}, name('T'), name('U'), name('A'), name('B')]],
    ['x: (a: A, b?: B) => R = 1', ['type-function', {}, none, [['type-param', {}, name('a'), name('A')], ['type-param', { optional: true }, name('b'), name('B')]], name('R')]],
    ['x: <T extends U = V>(a: T) => T = 1', ['type-function', {}, [['type-var', {}, name('T'), name('U'), name('V')]], [['type-param', {}, name('a'), name('T')]], name('T')]],
    ['x: new () => Foo = 1', ['type-constructor', {}, none, [], name('Foo')]],
    ['x: { a: A, b?: B } = 1', ['type-object', {}, ['type-prop', {}, name('a'), name('A')], ['type-prop', { optional: true }, name('b'), name('B')]]],
    ['x: { m<T>(a: T): T } = 1', ['type-object', {}, ['type-method', {}, name('m'), [['type-var', {}, name('T'), none, none]], [['type-param', {}, name('a'), name('T')]], name('T')]]],
    ['x: { a?(n: N): R } = 1', ['type-object', {}, ['type-method', { optional: true }, name('a'), none, [['type-param', {}, name('n'), name('N')]], name('R')]]],
    ['x: { (a: A): R, new (): Foo } = 1', ['type-object', {}, ['type-call-signature', {}, none, [['type-param', {}, name('a'), name('A')]], name('R')], ['type-construct-signature', {}, none, [], name('Foo')]]],
    ['x: Foo<A, B,> = 1', ['type-apply', {}, name('Foo'), name('A'), name('B')]],
    ['x: { [k: string]: V } = 1', ['type-object', {}, ['type-index-signature', {}, name('k'), name('string'), name('V')]]],
    ['x: { [K in keyof T]?: V } = 1', ['type-object', {}, ['type-mapped', { optional: true }, name('K'), ['type-keyof', {}, name('T')], name('V')]]],
    ['x: [A, b?: B, ...C[]] = 1', ['type-tuple', {}, name('A'), ['type-element', { optional: true }, name('b'), name('B')], ['type-element', { rest: true }, none, ['type-array', {}, name('C')]]]],
    ['y = x as typeof z', ['type-query', {}, name('z')]],
    ['x: import("./m").T = 1', ['type-member', {}, ['type-import', {}, ['string', {}, '"./m"']], name('T')]],
    ['def f(v: unknown): asserts v is T\n  v', null],
  ];
  for (const [src, body] of cases) {
    test(JSON.stringify(src), () => {
      const vs = values(src);
      expect(vs.every((v) => v[3][0] !== 'none')).toBe(true);
      if (body !== null) expect(vs[vs.length - 1][3]).toEqual(body);
    });
  }

  test('a predicate is a return type\'s claim', () => {
    const [, ret] = values('def f(v: unknown): asserts v is T\n  v');
    expect(ret[3]).toEqual(['type-predicate', { asserts: true }, name('v'), name('T')]);
  });

  test('each type value records its node row with the annotation token\'s span', () => {
    const r = parse('y = x as A | B');
    const [v] = r.stores.entryValues;
    const row = r.stores.nodes[r.stores.nodeIds.get(v) - 1];
    expect([row.semanticKind, row.ruleId, row.sourceStart, row.sourceEnd]).toEqual(['type', 0, 6, 14]);
    expect(v[2]).toBe('A | B');
    const union = r.stores.nodes[r.stores.nodeIds.get(v[3]) - 1];
    expect([union.semanticKind, union.sourceStart, union.sourceEnd]).toEqual(['type-union', 9, 14]);
  });
});

describe('a rule that erases an annotation still reaches its tree', () => {
  test('the side-band role\'s childNodeId names the value stores.entryValue returns', () => {
    const r = parse('x: Map<K, V> = 1');
    expect(r.sexpr).toEqual(['program', {}, ['=', {}, name('x'), ['num', {}, '1']]]);
    const stores = new Stores(r.stores);
    const assign = stores.idOf(r.sexpr[2]);
    const role = stores.role(assign, 'annotation');
    const value = stores.entryValue(role.childNodeId);
    expect(value).toEqual(['type', {}, 'Map<K, V>', ['type-apply', {}, name('Map'), name('K'), name('V')]]);
  });
});

describe('a run the grammar cannot read stays opaque', () => {
  test('its body is none, its raw text intact, and the parse reports nothing', () => {
    for (const src of ['f = (a: T: U) -> a', 'get: () => Foo<T = number> = -> 5']) {
      const r = parse(src);
      expect(r.diagnostics).toEqual([]);
      const opaque = r.stores.entryValues.filter((v) => v[3][0] === 'none');
      expect(opaque.length).toBe(1);
    }
    expect(values('f = (a: T: U) -> a')[0]).toEqual(['type', {}, 'T: U', none]);
  });

  test('the rows the rejected sub-parse built are rolled back', () => {
    const r = parse('get: () => Foo<T = number> = -> 5');
    const kinds = r.stores.nodes.map((n) => n.semanticKind);
    expect(kinds.filter((k) => k?.startsWith('type-'))).toEqual([]);
    expect(r.stores.nodes.every((n, i) => n.nodeId === i + 1)).toBe(true);
    expect(r.stores.roles.every((row) => row.nodeId <= r.stores.nodes.length)).toBe(true);
  });

  test('a rejected payload reports none of its reductions to onReduce', () => {
    const reduced = (src) => {
      const seen = [];
      const p = Parser({ onReduce: (id) => seen.push(ruleNames[id]) });
      p.lexer = makeParserLexer('<types-entry>');
      p.parse(src);
      return seen.filter((n) => /^Type(?!Decl|dParamVar)/.test(n));
    };
    expect(reduced('f = (a: {m<T>(x: T): T, b: B c}) -> a')).toEqual([]);
    expect(reduced('f = (a: {m<T>(x: T): T}) -> a')).toContain('TypeGenerics → < TypeVars >');
  });

  test('the tolerant parse reads the same values', () => {
    for (const src of ['f = (a: T: U) -> a', 'x: { a: A, b?: B } = 1']) {
      expect(values(src, { tolerant: true, primitives: true })).toEqual(values(src));
    }
  });

  test('the consumer corpus holds exactly the pinned opaque runs', async () => {
    // Each entry: the run's raw text, and why it is no type the grammar reads.
    const PINNED = new Map([
      ['() => Foo<T = number>', 'a default inside type arguments: the mutation-audit pin in test/rip/types.rip keeps it compiling, and the checker owns the verdict'],
    ]);
    const root = join(import.meta.dir, '../..');
    const found = new Set();
    for (const { src, path } of [...packageInputs(root), ...(await rowInputs(root))]) {
      const p = Parser();
      p.lexer = makeParserLexer(path);
      let r;
      try { r = p.parse(splitData(src).text); } catch { continue; }
      for (const v of r.stores?.entryValues ?? []) if (v[3][0] === 'none') found.add(v[2]);
    }
    expect([...found].sort()).toEqual([...PINNED.keys()].sort());
  });
});

describe('the driver and the generator', () => {
  test('a lexer that supplies no payload for an entry token is a protocol violation, loudly', () => {
    const p = Parser();
    const lexer = makeParserLexer('<types-entry>');
    lexer.payload = () => null;
    p.lexer = lexer;
    expect(() => p.parse('y = x as T')).toThrow(/supplied no payload for a 'as' token — lexer protocol violation/);
  });

  test('the program\'s table is the table without the entry, row for row', () => {
    const bare = structuredClone(grammar);
    delete bare.entries;
    for (const lhs of Object.keys(bare.grammar)) if (/^Type(?!Decl|dParamVar)/.test(lhs)) delete bare.grammar[lhs];
    // The table never reads the kind registry; without one the gate it
    // drives is off, so the registry's type kinds need no unwinding.
    delete bare.kinds;
    for (const word of ['OPTIONAL_COLON', 'KEYOF', 'TYPEOF', 'INFER', 'READONLY', 'UNIQUE', 'ASSERTS', 'IS', 'IN', 'NEW', 'ABSTRACT']) delete bare.displays[word];
    const gen = new Generator(bare);
    expect(gen.parseTable.length).toBeLessThan(shipped.parseTable.length);
    const rows = gen.parseTable.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([, a]) => a != null).map(([k, a]) => [k, Array.isArray(a) ? (a[0] === 1 ? a[1] : a[0] === 2 ? -a[1] : 0) : a]))));
    const shippedRows = shipped.parseTable.slice(0, rows.length).map((row) => JSON.stringify(row));
    expect(rows).toEqual(shippedRows);
  });

  test('an entry is checked against the grammar and the registry', () => {
    const variant = (edit) => { const g = structuredClone(grammar); edit(g); return () => new Generator(g); };
    expect(variant((g) => { g.entries.Nope = { kind: 'type', terminals: ['TYPE'] }; })).toThrow(/entries: 'Nope' is not a nonterminal/);
    expect(variant((g) => { g.entries.TypeAnnotation.terminals = ['IDENTIFIER']; })).toThrow(/entries: 'IDENTIFIER' is a leaf/);
    expect(variant((g) => { g.entries.TypeAnnotation.terminals = ['TYPE', 'TYPE']; })).toThrow(/entries: 'TYPE' heads two entries/);
    expect(variant((g) => { delete g.kinds.type; })).toThrow(/kind registry/);
    expect(variant((g) => { g.grammar.TypePrimary.push(['Identifier']); })).toThrow(/entries: 'Identifier' is reached from both 'Root' and 'TypeAnnotation'/);
    expect(variant((g) => { g.kinds.type = { forms: ['"type" attrs:{} raw:leaf'] }; })).toThrow(/entry kind 'type' form .* is not "type" attrs:\{\} raw:leaf body:<type>/);
  });

  test('an entry whose states hold competing actions fails generation', () => {
    const broken = structuredClone(grammar);
    broken.grammar.TypePredicate.push(['IDENTIFIER']);
    expect(() => new Generator(broken)).toThrow(/an entry's states hold competing actions/);
  });
});
