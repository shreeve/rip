// The schema entry: a SCHEMA_BODY token's payload is one SCHEMA_CODE
// token per code site, and each SCHEMA_CODE token's payload is that
// embedded Rip, which the driver parses from the program's own start
// symbol on the same stack. These pins hold what the corpus gates
// cannot name one by one: the payload tapes, the value a schema body
// token takes, nested frames, the loud rejection, the program table the
// entries leave alone, and the generator's checks.
import { test, expect, describe } from 'bun:test';
import { Parser, parser as shipped, ruleNames } from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

const parse = (src, opts = {}) => {
  const p = Parser();
  p.lexer = makeParserLexer('<schema-entry>', { tolerant: opts.tolerant ?? false });
  return p.parse(src, opts);
};
const bodies = (src) => parse(src).stores.entryValues.filter((v) => v[0] === 'schema-body');

describe('the payload tapes', () => {
  test('one SCHEMA_CODE per code site, in entry order, then the adapter', () => {
    const src = 'M = schema :model, on: db\n  a! string, -> it.trim()\n  beforeSave: -> 1\n  @scope :active, -> @where(a: 1)\n  @ensure "m", (x) -> x';
    const { tokens, payloads } = tokenize(src);
    const body = tokens.find((t) => t.kind === 'SCHEMA_BODY');
    expect(payloads.get(body).map((t) => [t.kind, t.value])).toEqual([
      ['SCHEMA_CODE', 'it.trim()'], ['SCHEMA_CODE', '1'], ['SCHEMA_CODE', '@where(a: 1)'], ['SCHEMA_CODE', 'x'], ['SCHEMA_CODE', 'db'],
    ]);
  });

  test('a code slice runs every lexer pass and keeps its symbols', () => {
    const { tokens, payloads } = tokenize('S = schema :shape\n  m: -> f :a, b');
    const [code] = payloads.get(tokens.find((t) => t.kind === 'SCHEMA_BODY'));
    expect(payloads.get(code).map((t) => t.kind)).toEqual(['IDENTIFIER', 'CALL_START', 'SYMBOL', ',', 'IDENTIFIER', 'CALL_END']);
  });

  test("a block body's own INDENT and OUTDENT stay outside its payload", () => {
    const { tokens, payloads } = tokenize('S = schema :shape\n  m: ->\n    a\n    b');
    const [code] = payloads.get(tokens.find((t) => t.kind === 'SCHEMA_BODY'));
    expect(payloads.get(code).map((t) => t.kind)).toEqual(['IDENTIFIER', 'TERMINATOR', 'IDENTIFIER']);
  });

  test('the descriptor keeps each code site its unsplit slice', () => {
    const { tokens } = tokenize('S = schema :shape\n  m: -> [:a]');
    const { entries } = tokens.find((t) => t.kind === 'SCHEMA_BODY').value;
    expect(entries[0].bodyTokens.map((t) => t.kind)).toEqual(['[', 'SYMBOL', ']']);
  });

  test("code slices mint after the tape, so the tape's own minted ids never move", () => {
    const { tokens, payloads } = tokenize('f x\nS = schema :shape\n  m: -> g y\nh z');
    const [code] = payloads.get(tokens.find((t) => t.kind === 'SCHEMA_BODY'));
    const tapeMax = Math.max(...tokens.map((t) => t.id));
    const minted = payloads.get(code).filter((t) => t.generated).map((t) => t.id);
    expect(minted.length).toBeGreaterThan(0);
    expect(Math.min(...minted, code.id)).toBeGreaterThan(tapeMax);
  });
});

describe('the value a schema body token takes', () => {
  test('["schema-body", {}, descriptor, ["schema-codes", {}, ...codes]], each code a program', () => {
    const [v] = bodies('S = schema :shape\n  m: -> [:a]');
    expect(v[2].kind).toBe('shape');
    expect(JSON.stringify(v[3])).toBe('["schema-codes",{},["code",{},"[:a]",["program",{},["array",{},["symbol",{},"a"]]]]]');
  });

  test('a body without code takes an empty schema-codes', () => {
    const [v] = bodies('S = schema :shape\n  a string');
    expect(v[3]).toEqual(['schema-codes', {}]);
  });

  test('a schema nested in a method body is a nested frame: its body value sits inside the code tree', () => {
    const r = parse('S = schema :shape\n  m: ->\n    T = schema :shape\n      v number\n    T');
    // Values close innermost first: the inner body, the code holding it,
    // then the outer body.
    expect(r.stores.entryValues.map((v) => v[0])).toEqual(['schema-body', 'code', 'schema-body']);
    const [inner, code, outer] = r.stores.entryValues;
    expect(outer[3][2]).toBe(code);
    expect(JSON.stringify(code[3])).toContain(JSON.stringify(inner));
  });

  test('the schema node keeps its primitive occurrences', () => {
    const r = parse('S = schema :shape\n  name string\n  m: -> name', { primitives: true });
    expect(r.stores.primitives.map((p) => p.value)).toEqual(['shape', 'name', 'string', 'm', 'name', 'S']);
  });
});

describe('a payload the program grammar rejects', () => {
  test('is the parse error at its token, strict', () => {
    const r = parse('S = schema :shape\n  m: -> 1 2');
    expect(r.sexpr).toBe(null);
    expect([r.diagnostics[0].message.split(' —')[0], r.diagnostics[0].start]).toEqual(["Unexpected '2'", 28]);
  });

  test('is recorded and repaired in tolerant mode', () => {
    const r = parse('S = schema :shape\n  m: -> 1 2', { tolerant: true });
    expect(r.sexpr).not.toBe(null);
    expect(r.diagnostics[0].start).toBe(28);
  });

  test('names the payload at its end', () => {
    const r = parse('S = schema :model, on: (a; b)\n  name string');
    expect(r.diagnostics[0].message).toStartWith("Unexpected end of a schema body's code");
  });
});

describe('the driver and the generator', () => {
  test('the program table is the table without the schema entries, row for row', () => {
    const bare = structuredClone(grammar);
    delete bare.entries.SchemaBody;
    delete bare.entries.Root;
    delete bare.grammar.SchemaBody;
    delete bare.grammar.SchemaCodes;
    delete bare.kinds;
    delete bare.displays.SCHEMA_CODE;
    const gen = new Generator(bare);
    expect(gen.parseTable.length).toBeLessThan(shipped.parseTable.length);
    const rows = gen.parseTable.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([, a]) => a != null).map(([k, a]) => [k, Array.isArray(a) ? (a[0] === 1 ? a[1] : a[0] === 2 ? -a[1] : 0) : a]))));
    expect(rows).toEqual(shipped.parseTable.slice(0, rows.length).map((row) => JSON.stringify(row)));
  });

  test('the program start symbol as an entry starts at state 0 and adds no rule or state', () => {
    const gen = new Generator(structuredClone(grammar));
    const root = gen.entries.find((e) => e.start === 'Root');
    expect([root.state, root.rule]).toEqual([0, null]);
    // With SCHEMA_CODE a plain terminal instead, the table and the rules
    // are the same size.
    const without = structuredClone(grammar);
    delete without.entries.Root;
    delete without.kinds;
    const plain = new Generator(without);
    expect(plain.parseTable.length).toBe(gen.parseTable.length);
    expect(plain.rules.length).toBe(gen.rules.length);
  });

  test('entry rejection policy: types are opaque, schema entries are not', () => {
    expect(shipped.entries[shipped.symbolIds.TYPE]).toEqual([shipped.entries[shipped.symbolIds.TYPE][0], 'type', true]);
    expect(shipped.entries[shipped.symbolIds.SCHEMA_BODY].slice(1)).toEqual(['schema-body', false]);
    expect(shipped.entries[shipped.symbolIds.SCHEMA_CODE]).toEqual([0, 'code', false]);
  });

  test('an entry is checked against the grammar', () => {
    const variant = (edit) => { const g = structuredClone(grammar); edit(g); return () => new Generator(g); };
    expect(variant((g) => { g.entries.SchemaBody.opaque = 'yes'; })).toThrow(/entries: 'SchemaBody' opaque must be true when present/);
    expect(variant((g) => { g.grammar.SchemaCodes.push(['Expression']); })).toThrow(/entries: 'Expression' is reached from both 'Root' and 'SchemaBody'/);
  });

  test('reductions inside nested frames reach onReduce once each, when the outermost entry accepts', () => {
    const p = Parser();
    p.lexer = makeParserLexer('<schema-entry>');
    const seen = [];
    p.ctx = { onReduce: (r) => seen.push(ruleNames[r]) };
    p.parse('S = schema :shape\n  m: -> [:a]');
    expect(seen.filter((n) => n === 'SchemaCodes → SCHEMA_CODE')).toHaveLength(1);
    expect(seen.filter((n) => n === 'Atom → SYMBOL')).toHaveLength(1);
    expect(seen.indexOf('Atom → SYMBOL')).toBeLessThan(seen.indexOf('SchemaCodes → SCHEMA_CODE'));
  });
});
