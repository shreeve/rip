// The schema entry: the scanner reads a schema body in the schema
// alphabet and cuts it from the tape into SCHEMA_BODY's payload, which
// the driver parses from SchemaBody; each embedded Rip island inside it is
// a SCHEMA_CODE token whose own payload the driver parses from the
// program's start symbol on the same stack. These pins hold what the
// corpus gates cannot name one by one: the payload tapes and their
// islands, the value a schema body token takes, nested frames, the loud
// and the explained rejections, the program table the entries leave
// alone, mode coherence, the scanner's opener set, and the generator's
// checks.
import { test, expect, describe } from 'bun:test';
import { Parser, parser as shipped, ruleNames } from '../../src/parser.js';
import { makeParserLexer, tokenize, SCHEMA_OPENERS, SCHEMA_BARE_OPENERS } from '../../src/lexer.js';
import { classifyCompleteness, compile } from '../../src/compiler.js';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

const parse = (src, opts = {}) => {
  const p = Parser();
  p.lexer = makeParserLexer('<schema-entry>', { tolerant: opts.tolerant ?? false });
  return p.parse(src, opts);
};
const bodies = (src) => parse(src).stores.entryValues.filter((v) => v[0] === 'schema-body');
const bodyTape = (src) => {
  const { tokens, payloads } = tokenize(src);
  return { payload: payloads.get(tokens.find((t) => t.kind === 'SCHEMA_BODY')), payloads, tokens };
};
const islandsOf = (payload) => payload.filter((t) => t.kind === 'SCHEMA_CODE');

describe('the payload tapes', () => {
  test('a body is its schema alphabet: names, modifiers, symbols, directive families', () => {
    const { payload } = bodyTape('M = schema :model\n  else? string, [:a]\n  @belongsTo User?\n  @ensure! "m", (x) -> x');
    expect(payload.map((t) => [t.kind, typeof t.value === 'string' ? t.value : t.kind])).toEqual([
      ['S_KIND', 'model'], ['INDENT', 'INDENT'],
      ['S_WORD', 'else'], ['S_OPT', '?'], ['S_WORD', 'string'], [',', ','], ['[', '['], ['S_SYMBOL', 'a'], [']', ']'], ['TERMINATOR', '\n'],
      ['S_DIRECTIVE', 'belongsTo'], ['S_WORD', 'User'], ['S_OPT', '?'], ['TERMINATOR', '\n'],
      ['S_ENSURE', 'ensure'], ['S_BANG', '!'], ['STRING', '"m"'], [',', ','], ['S_PARAMS', '(x)'], ['->', '->'], ['SCHEMA_CODE', 'x'],
      ['OUTDENT', 'OUTDENT'],
    ]);
  });

  test('one island per code site, in source order', () => {
    const { payload } = bodyTape('M = schema :model, on: db\n  a! string, -> it.trim()\n  beforeSave: -> 1\n  @scope :active, -> @where(a: 1)\n  @ensure "m", (x) -> x');
    expect(islandsOf(payload).map((t) => t.value)).toEqual(['db', 'it.trim()', '1', '@where(a: 1)', 'x']);
  });

  test('an island runs every lexer pass and keeps its symbols', () => {
    const { payload, payloads } = bodyTape('S = schema :shape\n  m: -> f :a, b');
    expect(payloads.get(islandsOf(payload)[0]).map((t) => t.kind)).toEqual(['IDENTIFIER', 'CALL_START', 'SYMBOL', ',', 'IDENTIFIER', 'CALL_END']);
  });

  test("a block body's own INDENT and OUTDENT stay outside its island's payload", () => {
    const { payload, payloads } = bodyTape('S = schema :shape\n  m: ->\n    a\n    b');
    expect(payloads.get(islandsOf(payload)[0]).map((t) => t.kind)).toEqual(['IDENTIFIER', 'TERMINATOR', 'IDENTIFIER']);
  });

  test('an empty island is an empty payload, zero-width at its entry', () => {
    const { payload, payloads } = bodyTape('S = schema :shape\n  m: ->\n  a string');
    const [code] = islandsOf(payload);
    expect([code.value, code.start, code.end, payloads.get(code)]).toEqual(['', 20, 20, []]);
  });

  test('the exit rules: a line, a part, an element, the head line', () => {
    // A transform ends at a comma at its own level; a method body keeps
    // its commas; a predicate inside `@ensure […]` ends at a comma or a
    // line; the adapter ends at the `;` that opens an inline body.
    expect(islandsOf(bodyTape('S = schema :shape\n  a string, -> f a, [1]').payload).map((t) => t.value)).toEqual(['f a']);
    expect(islandsOf(bodyTape('S = schema :shape\n  m: -> f a, b').payload).map((t) => t.value)).toEqual(['f a, b']);
    expect(islandsOf(bodyTape('S = schema :shape\n  @ensure ["a", (u) -> f u, "b", (u) -> g u]').payload).map((t) => t.value)).toEqual(['f u', 'g u']);
    expect(islandsOf(bodyTape('S = schema :model, on: (a; b); x!').payload).map((t) => t.value)).toEqual(['(a; b)']);
  });

  test("the descriptor keeps each island's tokens", () => {
    const r = parse('S = schema :shape\n  m: -> [:a]');
    const { entries } = r.stores.entryValues.find((v) => v[0] === 'schema-body')[2];
    expect(entries[0].bodyTokens.map((t) => t.kind)).toEqual(['[', 'SYMBOL', ']']);
  });

  test("islands run their passes after the tape, so the tape's own minted ids never move", () => {
    const { payload, payloads, tokens } = bodyTape('f x\nS = schema :shape\n  m: -> g y\nh z');
    const tapeMinted = tokens.filter((t) => t.generated).map((t) => t.id);
    const minted = payloads.get(islandsOf(payload)[0]).filter((t) => t.generated).map((t) => t.id);
    expect(minted.length).toBeGreaterThan(0);
    expect(Math.min(...minted)).toBeGreaterThan(Math.max(...tapeMinted));
  });
});

describe('the value a schema body token takes', () => {
  test('["schema-body", {}, descriptor, ["schema-dsl", …]], each island a program', () => {
    const [v] = bodies('S = schema :shape\n  m: -> [:a]');
    expect(v[2].kind).toBe('shape');
    expect(JSON.stringify(v[3])).toBe('["schema-dsl",{},["sym",{},"shape"],["none",{}],["schema-callable",{},["name",{},"m"],["none",{}],"->",["code",{},"[:a]",["program",{},["array",{},["symbol",{},"a"]]]]]]');
  });

  test('a schema nested in a method body is a nested frame: its body value sits inside the code tree', () => {
    const r = parse('S = schema :shape\n  m: ->\n    T = schema :shape\n      v number\n    T');
    // Values close innermost first: the inner body, the code holding it,
    // then the outer body.
    expect(r.stores.entryValues.map((v) => v[0])).toEqual(['schema-body', 'code', 'schema-body']);
    const [inner, code] = r.stores.entryValues;
    expect(JSON.stringify(code[3])).toContain(JSON.stringify(inner));
  });

  test('the schema node keeps its primitive occurrences', () => {
    const r = parse('S = schema :shape\n  name string\n  m: -> name', { primitives: true });
    expect(r.stores.primitives.map((p) => p.value)).toEqual(['shape', 'name', 'string', 'm', 'name', 'S']);
  });
});

describe('a payload a grammar rejects', () => {
  test('island code: the parse error at its token, strict', () => {
    const r = parse('S = schema :shape\n  m: -> 1 2');
    expect(r.sexpr).toBe(null);
    expect([r.diagnostics[0].message.split(' —')[0], r.diagnostics[0].start]).toEqual(["Unexpected '2'", 28]);
  });

  test('island code: recorded and repaired in tolerant mode', () => {
    const r = parse('S = schema :shape\n  m: -> 1 2', { tolerant: true });
    expect(r.sexpr).not.toBe(null);
    expect(r.diagnostics[0].start).toBe(28);
  });

  test('the DSL: the line names what it needed', () => {
    const r = parse('M = schema :model\n  a! string\n  @scope :hot, @where(a: 1)');
    expect([r.diagnostics[0].message, r.diagnostics[0].start]).toEqual(["@scope :hot: expected '->' to start the body", 45]);
    expect(parse('E = schema :enum\n  :a : 1').diagnostics[0].message).toBe("enum member ':a' — drop the ':' before the value; use ':a value'");
  });

  test('the DSL: a shape no rule explains keeps the parser message', () => {
    const r = parse('S = schema :shape\n  @ensure "m" "n"');
    expect(r.diagnostics[0].message).toStartWith("Unexpected 'a string'");
  });

  test('a field line ending in a comma at the end of input is complete, strict or tolerant', () => {
    expect(classifyCompleteness('S = schema :shape\n  a! string,').status).toBe('complete');
    for (const tolerant of [false, true]) {
      const r = compile('S = schema :shape\n  a! string,', { tolerant, runtimeDelivery: 'none' });
      expect(r.code).toContain('{tag: "field", name: "a"');
    }
  });

  test("a half-typed member's line is the tolerant scan's repair unit", () => {
    const { lexDiagnostics, payloads, tokens } = tokenize('S = schema :shape\n  a! string\n  greet: \n  b! string', '<t>', { tolerant: true });
    expect(lexDiagnostics.map((d) => d.start)).toEqual([37]);
    const words = payloads.get(tokens.find((t) => t.kind === 'SCHEMA_BODY')).filter((t) => t.kind === 'S_WORD').map((t) => t.value);
    expect(words).toEqual(['a', 'string', 'b', 'string']);
  });
});

describe('the driver and the generator', () => {
  const withoutSchema = () => {
    const bare = structuredClone(grammar);
    delete bare.entries.SchemaBody;
    delete bare.entries.Root;
    for (const nt of Object.keys(bare.grammar)) if (nt.startsWith('Schema') && nt !== 'Schema') delete bare.grammar[nt];
    for (const t of Object.keys(bare.displays)) if (t.startsWith('S_') || t === 'SCHEMA_CODE') delete bare.displays[t];
    for (const t of Object.keys(bare.leaves)) if (t.startsWith('S_')) delete bare.leaves[t];
    delete bare.kinds;
    return bare;
  };

  test('the program table is the table without the schema entries, row for row', () => {
    const gen = new Generator(withoutSchema());
    expect(gen.parseTable.length).toBeLessThan(shipped.parseTable.length);
    const rows = gen.parseTable.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([, a]) => a != null).map(([k, a]) => [k, Array.isArray(a) ? (a[0] === 1 ? a[1] : a[0] === 2 ? -a[1] : 0) : a]))));
    expect(rows).toEqual(shipped.parseTable.slice(0, rows.length).map((row) => JSON.stringify(row)));
  });

  test('mode coherence: no state reads both a schema-only and a program-only terminal', () => {
    const { parseTable, symbolIds, tokenNames } = shipped;
    const name = Object.fromEntries(Object.entries(symbolIds).map(([n, id]) => [id, n]));
    const terminalsOf = (row) => Object.keys(row ?? {}).filter((id) => tokenNames[id] !== undefined).map((id) => name[id]);
    const schemaOnly = new Set(Object.keys(symbolIds).filter((n) => n.startsWith('S_') || n === 'SCHEMA_CODE' || n === '!>'));
    // The terminals the schema alphabet shares with programs: its
    // punctuation, literals and layout.
    const shared = new Set(['INDENT', 'OUTDENT', 'TERMINATOR', ',', '[', ']', '{', '}', '|', '..', '-', ':', '.', '->', 'EFFECT', 'NUMBER', 'STRING', 'REGEX', '$end']);
    const schemaStates = new Set();
    parseTable.forEach((row, k) => { if (terminalsOf(row).some((t) => schemaOnly.has(t))) schemaStates.add(k); });
    expect(schemaStates.size).toBeGreaterThan(20);
    for (const [k, row] of parseTable.entries()) {
      const ts = terminalsOf(row);
      if (schemaStates.has(k)) expect([k, ts.filter((t) => !schemaOnly.has(t) && !shared.has(t))]).toEqual([k, []]);
    }
    // And no program state shifts a schema-only terminal but SCHEMA_CODE's
    // own states (the program's start symbol is its entry).
    for (const [k, row] of parseTable.entries()) {
      if (schemaStates.has(k)) continue;
      expect([k, terminalsOf(row).filter((t) => schemaOnly.has(t))]).toEqual([k, []]);
    }
  });

  test("the scanner's opener set is the table's: every terminal SCHEMA follows, in scan-time spelling", () => {
    const { parseTable, symbolIds } = shipped;
    const name = Object.fromEntries(Object.entries(symbolIds).map(([n, id]) => [id, n]));
    // A state's accessing symbol: the one every edge into it carries.
    const accessing = [];
    parseTable.forEach((row) => { for (const [x, a] of Object.entries(row ?? {})) if (typeof a === 'number' && a > 0) (accessing[a] ??= new Set()).add(name[x]); });
    const SCAN_TIME = { POST_IF: 'IF', POST_UNLESS: 'UNLESS', LOOSE_ELSE: 'ELSE', RangeDots: '..' };
    // Nonterminal edges with a scan-time reading of their own: the start
    // of input is a null previous token, and an elision's last token is
    // the comma already in the set.
    const NO_TOKEN = new Set(['<start>', 'Elisions']);
    const table = new Set();
    parseTable.forEach((row, k) => {
      if (!(row?.[symbolIds.SCHEMA] > 0)) return;
      for (const x of accessing[k] ?? ['<start>']) if (!NO_TOKEN.has(x)) table.add(SCAN_TIME[x] ?? x);
    });
    // An arrow's block is the INDENT the implicit passes open after it.
    const SCAN_ONLY = new Set(['->', '=>']);
    expect(table.size).toBeGreaterThan(40);
    expect([...SCHEMA_OPENERS].filter((t) => !table.has(t) && !SCAN_ONLY.has(t)).sort()).toEqual([]);
    expect([...table].filter((t) => !SCHEMA_OPENERS.has(t)).sort()).toEqual([]);
    expect([...SCHEMA_BARE_OPENERS].filter((t) => !SCHEMA_OPENERS.has(t))).toEqual([]);
  });

  test('the program start symbol as an entry starts at state 0 and adds no rule or state', () => {
    const gen = new Generator(structuredClone(grammar));
    const root = gen.entries.find((e) => e.start === 'Root');
    expect([root.state, root.rule]).toEqual([0, null]);
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
    expect(variant((g) => { g.grammar.SchemaLine.push(['Expression']); })).toThrow(/entries: 'Expression' is reached from both 'Root' and 'SchemaBody'/);
  });

  test('reductions inside nested frames reach onReduce once each, when the outermost entry accepts', () => {
    const p = Parser();
    p.lexer = makeParserLexer('<schema-entry>');
    const seen = [];
    p.ctx = { onReduce: (r) => seen.push(ruleNames[r]) };
    p.parse('S = schema :shape\n  m: -> [:a]');
    expect(seen.filter((n) => n.startsWith('SchemaCallable →'))).toHaveLength(1);
    expect(seen.filter((n) => n === 'Atom → SYMBOL')).toHaveLength(1);
    expect(seen.indexOf('Atom → SYMBOL')).toBeLessThan(seen.findIndex((n) => n.startsWith('SchemaCallable →')));
  });
});
