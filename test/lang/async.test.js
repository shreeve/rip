// Async/await, the dammit operator, and generators. The dammit
// operator is an explicit DAMMIT token and an explicit
// ["dammit!", target] node — the compiler has no hidden channels.
// The contract here is the emitted JS and its behavior under the
// module-loader eval (top-level await needs a real module context).
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

// Load compiled code as a real ES module and return its default
// export (awaited).
let seq = 0;
async function loadDefault(code) {
  const dir = mkdtempSync(join(tmpdir(), 'rip-async-'));
  const file = join(dir, `m${seq++}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)).default;
}

describe('dammit tokenization: the explicit DAMMIT token', () => {
  test('unspaced ! after a name is DAMMIT; spaced is unary not', () => {
    expect(tokenize('x = f!').tokens.map(t => t.kind)).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'DAMMIT']);
    expect(tokenize('x = f !ok').tokens.map(t => t.kind)).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'CALL_START', 'UNARY_MATH', 'IDENTIFIER', 'CALL_END']);
    expect(tokenize('r = a.b!').tokens.map(t => t.kind)).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', '.', 'PROPERTY', 'DAMMIT']);
  });

  test('sexpr shape: an explicit ["dammit!", target] node with a non-spellable head', () => {
    expect(JSON.stringify(parser.parse('x = f!').sexpr)).toBe(JSON.stringify(['program', ['=', 'x', ['dammit!', 'f']]]));
    expect(JSON.stringify(parser.parse('x = f! 1').sexpr)).toBe(JSON.stringify(['program', ['=', 'x', [['dammit!', 'f'], '1']]]));
  });

  test('collision impossible: a user function named `dammit` compiles as a CALL', () => {
    // The head is `dammit!` — not a spellable identifier — so the
    // 1-arg call shape ["dammit", arg] can never be mistaken for the
    // operator node.
    for (const src of ['dammit = (a) -> a\nr = dammit f', 'dammit = (a) -> a\nr = dammit(5)']) {
      expect(compile(src)).toContain('dammit(');
    }
  });

  test("unspaced '!=' after a name rejects (the sigil-assignment error)", () => {
    expect(() => tokenize('f!= 1')).toThrow(/cannot use the '!' sigil in an assignment/);
    expect(tokenize('a != b').tokens.map(t => t.kind)).toEqual(['IDENTIFIER', 'COMPARE', 'IDENTIFIER']);
  });

  test('dammit after a call result rejects', () => {
    const r = parser.parse('y = f()!');
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('maybe dammit disambiguation', () => {
  test('the shared ?! token becomes a call only when arguments follow', () => {
    expect(tokenize('fn?!').tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', 'PRESENCE']);
    expect(tokenize('fn?!()').tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', 'PRESENCE', 'CALL_START', 'CALL_END']);
    expect(tokenize('fn?! arg').tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', 'PRESENCE', 'CALL_START', 'IDENTIFIER', 'CALL_END']);
  });

  test('bare ?! is presence; empty, parenthesized, and juxta args are maybe dammit', () => {
    expect(parser.parse('x = fn?!').sexpr)
      .toEqual(['program', ['=', 'x', ['presence', 'fn']]]);
    expect(parser.parse('x = fn?!()').sexpr)
      .toEqual(['program', ['=', 'x', ['dammit?', 'fn']]]);
    expect(parser.parse('x = fn?!(arg)').sexpr)
      .toEqual(['program', ['=', 'x', ['dammit?', 'fn', 'arg']]]);
    expect(parser.parse('x = fn?! arg').sexpr)
      .toEqual(['program', ['=', 'x', ['dammit?', 'fn', 'arg']]]);
  });
});

describe('async behavior through the module loader', () => {
  const rows = [
    // [source, expected default export]
    ['fetchOne = -> await Promise.resolve(41)\nexport default await fetchOne() + 1', 42],
    ['f = -> Promise.resolve(5)\nr = f!\nexport default r', 5],
    ['obj = {get: -> Promise.resolve("hi")}\nexport default obj.get!', 'hi'],
    ['add = (a, b) -> Promise.resolve(a + b)\nexport default add! 2, 3', 5],
    ['f = -> Promise.resolve("chain")\nexport default f!.length', 5],
    ['vals = (await Promise.resolve(i * 2) for i in [1, 2, 3])\nexport default vals', [2, 4, 6]],
    ['v = try\n  await Promise.reject(new Error("x"))\ncatch e\n  "caught"\nexport default v', 'caught'],
    ['gen = ->\n  yield 1\n  yield 2\nexport default [...gen()]', [1, 2]],
    ['inner = -> yield from [7, 8].values()\nexport default [...inner()]', [7, 8]],
    ['pick = if await Promise.resolve(true) then "T" else "F"\nexport default pick', 'T'],
  ];
  for (const [src, expected] of rows) {
    test(JSON.stringify(src.split('\n')[0]), async () => {
      expect(await loadDefault(compile(src))).toEqual(expected);
    });
  }
});

describe('composition matrix: async constructs in HEAD positions (eval-pinned)', () => {
  const rows = [
    ['r = (await Promise.resolve(42)).toString()\nexport default r', '42'],
    ['r = (await Promise.resolve([9]))[0]\nexport default r', 9],
    ['f = -> Promise.resolve({n: 3})\nexport default f!.n', 3],
    ['f = -> Promise.resolve([4, 5])\nexport default f![1]', 5],
  ];
  for (const [src, expected] of rows) {
    test(JSON.stringify(src.split('\n')[0]), async () => {
      expect(await loadDefault(compile(src))).toEqual(expected);
    });
  }

  test('await in INDEX-head position keeps its grouping', () => {
    // Dropping the parens would index the PROMISE and then await
    // undefined — a different program.
    expect(compile('r = (await Promise.resolve([9]))[0]')).toContain('(await Promise.resolve([9]))[0]');
  });
});

describe('dammit mapping surfaces', () => {
  const compileFull = (src) => {
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    const out = emit(r, { source: src });
    return { code: out.code, mappings: new Mappings(out.mappings), stores: out.stores };
  };

  test('["dammit!", target] role spans: $self covers `name!`, target is exact on the name', () => {
    const src = 'x = fetchUsers!';
    const { code, mappings, stores } = compileFull(src);
    const [dammit] = stores.nodesByKind('dammit');
    expect(dammit).toBeDefined();
    // $self spans the full sugar (`fetchUsers!`, offsets 4..15).
    expect([dammit.sourceStart, dammit.sourceEnd]).toEqual([4, 15]);
    const [target] = mappings.of(dammit.nodeId, 'target');
    expect(src.slice(target.sourceStart, target.sourceEnd)).toBe('fetchUsers');
    expect(code.slice(target.generatedStart, target.generatedEnd)).toBe('fetchUsers');
    expect(target.mappingKind).toBe('exact');
  });

  test('dammit bidirectional round-trip: source name → generated → back', () => {
    const src = 'r = obj.method!';
    const { code, mappings } = compileFull(src);
    // Forward: the source `method` name resolves to its generated slice.
    const srcAt = src.indexOf('method');
    const fwd = mappings.bestAtSource(srcAt);
    expect(fwd).not.toBeNull();
    expect(code.slice(fwd.generatedStart, fwd.generatedEnd)).toContain('method');
    // Reverse: the generated `method` position resolves back into the
    // real source extent.
    const genAt = code.indexOf('method');
    const back = mappings.bestAtGenerated(genAt);
    expect(back).not.toBeNull();
    expect(back.sourceStart).toBeGreaterThanOrEqual(0);
    expect(src.slice(back.sourceStart, back.sourceEnd)).toContain('method');
    // The emitter-added `await `/`()` scaffolding resolves to a cover
    // row, never a fake exact position.
    const scaffold = mappings.bestAtGenerated(code.indexOf('await '));
    expect(scaffold).not.toBeNull();
    expect(scaffold.mappingKind).not.toBe('exact');
  });

  test('maybe dammit owns its full source span and callee/operator/args roles', () => {
    const src = 'x = fn?!(arg)';
    const { code, mappings, stores } = compileFull(src);
    const [maybe] = stores.nodesByKind('maybe-dammit');
    expect(maybe).toBeDefined();
    expect([maybe.sourceStart, maybe.sourceEnd]).toEqual([4, 13]);
    expect(stores.nodesByKind('presence')).toEqual([]);

    const [callee] = mappings.of(maybe.nodeId, 'callee');
    expect(src.slice(callee.sourceStart, callee.sourceEnd)).toBe('fn');
    expect(code.slice(callee.generatedStart, callee.generatedEnd)).toBe('fn');
    expect(callee.mappingKind).toBe('exact');

    // TWO manifestations of the operator, in generated order: the
    // awaiting keyword rides the role first (TS80007's landing — the
    // `?!` is this spelling's await operator), then the `?.` the call
    // lowers through. Both are covers onto the same token.
    const opRows = mappings.of(maybe.nodeId, 'operator');
    expect(opRows).toHaveLength(2);
    for (const [row, gen] of [[opRows[0], 'await'], [opRows[1], '?.']]) {
      expect(src.slice(row.sourceStart, row.sourceEnd)).toBe('?!');
      expect(code.slice(row.generatedStart, row.generatedEnd)).toBe(gen);
      expect(row.mappingKind).toBe('cover');
    }

    const [args] = mappings.of(maybe.nodeId, 'args');
    expect(src.slice(args.sourceStart, args.sourceEnd)).toBe('(arg)');
    expect(code.slice(args.generatedStart, args.generatedEnd)).toBe('(arg)');
    expect(args.mappingKind).toBe('exact');

    const scaffold = mappings.bestAtGenerated(code.indexOf('await '));
    expect(scaffold).not.toBeNull();
    expect(scaffold.mappingKind).toBe('cover');
  });
});

describe('invalid async/generator forms reject loudly', () => {
  test('a fat-arrow generator rejects: fat arrows cannot contain yield', () => {
    const src = 'gen = => yield 1';
    expect(() => emit(parser.parse(src), { source: src })).toThrow(/fat arrows cannot contain yield/);
  });

  test('yield cannot cross an IIFE lowering boundary', () => {
    const src = 'g = ->\n  ys = (yield i for i in [1, 2])\n  ys';
    expect(() => emit(parser.parse(src), { source: src })).toThrow(/cannot cross the IIFE boundary/);
  });

  test('yield as an operand keeps its grouping', () => {
    // Dropping the parens would yield OF the sum — a different program.
    const src = 'g = ->\n  x = (yield 1) + 2\n  x';
    const code = compile(src);
    expect(code).toContain('(yield 1) + 2');
    new Function(code); // valid JS
  });

  test('for-await compiles with the for-as family', () => {
    // Both spellings (`for await u as users`, `for u as! users`) lower
    // to `for await (…)`; the flag makes an enclosing function async.
    for (const src of ['for await u as users\n  log u', 'for u as! users\n  log u']) {
      expect(compile(src)).toContain('for await (let u of users) {');
    }
    const fn = compile('f = ->\n  for await u as users\n    log u\n  0');
    expect(fn).toContain('f = async function() {');
  });
});
