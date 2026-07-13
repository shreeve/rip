// Emitter edge cases pinned byte-for-byte: array elisions, the
// nullish-chain line continuation, loop-binding rejections,
// statement-only arrow bodies, and loop-temporary naming.
import { describe, test, expect } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

const compileDelivered = (src, runtimeDelivery) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src, runtimeDelivery }).code;
};

describe('trailing array elisions survive emission', () => {
  test('the trailing hole emits its own comma; interior holes ride the separators', () => {
    expect(compile('x = [,,1,2,,]')).toBe('let x = [, , 1, 2, ,];');
    expect(eval(compile('x = [,,1,2,,]') + '\nx.length')).toBe(5);
    expect(eval(compile('x = [1,,,]') + '\nx.length')).toBe(3);
    // One trailing comma is a separator, not a hole — unchanged.
    expect(compile('x = [1, 2, 3,]')).toBe('let x = [1, 2, 3];');
  });

});

describe('a for loop that binds no variable rejects loudly', () => {
  test('the statement form rejects, positioned, with the binding hint', () => {
    const r = parser.parse('for [1...3]\n  x = 1');
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: 'for [1...3]\n  x = 1' }))
      .toThrow(/a for loop binds no variable — spell a bare repeat with a binding/);
  });

  test('the comprehension form rejects at PARSE — no var-less clause exists in the grammar', () => {
    const r = parser.parse('y = (1 for [1...3])');
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });

  test('bound ranged loops are untouched', () => {
    expect(eval(compile('r = ""\nfor i in [1...5]\n  r += "x"\nr'))).toBe('xxxx');
  });
});

describe("'??' continues across a line break", () => {
  test('a multi-line nullish chain is one logical line, identical to the single-line spelling', () => {
    const multi = parser.parse('v =\n  a ??\n  b ??\n  c');
    const single = parser.parse('v = a ?? b ?? c');
    expect(multi.diagnostics).toEqual([]);
    expect(JSON.stringify(multi.sexpr)).toBe(JSON.stringify(single.sexpr));
  });

  test('evaluation takes the first non-nullish arm', () => {
    expect(eval(compile('a = null\nb = undefined\nc = 3\nv =\n  a ??\n  b ??\n  c\nv'))).toBe(3);
  });

});

// A statement-only single-statement fat
// arrow body took the INLINE path and emitted its statement as a bare
// expression atom — `f = (e) => throw e` shipped `e => throw(e)` (a
// CALL of the keyword) and `h = => debugger` shipped `() => debugger`,
// both invalid JS, silently. Statement-only bodies now take the braced
// block form; every valid program's bytes are untouched (the inline
// path only ever misfired on programs that emitted invalid JS).
describe('statement-only fat-arrow bodies emit braced blocks', () => {
  test('a lone throw body braces instead of emitting a throw(...) call', () => {
    const code = compile('f = (e) => throw e');
    expect(code).toBe('let f = e => {\n  throw e;\n};');
    expect(() => new Function(code)).not.toThrow();
  });

  test('a lone debugger body braces instead of emitting an inline keyword', () => {
    const code = compile('h = => debugger');
    expect(code).toBe('let h = () => {\n  debugger;\n};');
    expect(() => new Function(code)).not.toThrow();
  });

  test('thin arrows were never affected — block bodies by construction', () => {
    expect(compile('g = (e) -> throw e')).toContain('function(e) {\n  throw e;\n}');
  });

  test('expression bodies keep their inline bytes', () => {
    expect(compile('g = (x) => x * 2')).toBe('let g = x => (x * 2);');
    expect(compile('o = => {a: 1}')).toBe('let o = () => ({a: 1});');
  });
});

// The freshTempName gap: loop machinery spelled its temporaries as
// bare literals — `_i` at the no-index stepped-loop sites, `_step`
// for runtime-sign steps — instead of dodging the module's spelled
// identifiers the way chain temps do. A user `_i` or `_step` was
// silently shadowed inside any stepped loop: `_i = 99` then
// `console.log _i` in the body printed the loop counter. The names
// now walk the numbered family (`_i` → `_i1` → `_i2`) past every
// identifier the module spells; programs that never spell the base
// names keep their bytes (the name is not reserved — each use is
// block-scoped to its own loop header).
describe('stepped-loop temporaries dodge user identifiers', () => {
  test('a user _i is not shadowed by the loop counter', () => {
    const code = compile('out = []\n_i = 99\nfor t in [1, 2, 3] by 2\n  out.push _i');
    expect(code).toBe(
      'let out = [];\nlet _i = 99;\n' +
      'for (let _i1 = 0; _i1 < [1, 2, 3].length; _i1 += 2) {\n' +
      'let t = [1, 2, 3][_i1];\nout.push(_i);\n}',
    );
    expect(new Function(code + '\nreturn out;')()).toEqual([99, 99]);
  });

  test('a user _step is not shadowed by the runtime-sign step temp', () => {
    const code = compile('out = []\ns = 2\n_step = 7\nfor t in [1, 2, 3] by s\n  out.push _step');
    expect(code).toContain('for (let _step1 = s, _i = _step1 > 0 ? 0 :');
    expect(new Function(code + '\nreturn out;')()).toEqual([7, 7]);
  });

  test('comprehension position dodges too', () => {
    const code = compile('_i = 99\nys = (t + _i for t in [1, 2, 3] by 2)');
    expect(code).toContain('for (let _i1 = 0; _i1 < [1, 2, 3].length; _i1 += 2) {');
    expect(new Function(code + '\nreturn ys;')()).toEqual([100, 102]);
  });

  test('the family walks past every spelled name', () => {
    const code = compile('_i = 1\n_i1 = 2\nfor t in [1, 2, 3] by 2\n  t');
    expect(code).toContain('for (let _i2 = 0;');
  });

  test('programs that never spell the temps keep their bytes', () => {
    expect(compile('for t in [1, 2, 3] by 2\n  console.log t')).toBe(
      'for (let _i = 0; _i < [1, 2, 3].length; _i += 2) {\n' +
      'let t = [1, 2, 3][_i];\nconsole.log(t);\n}',
    );
  });
});

describe('object-comprehension intrinsic delivery', () => {
  test('inline delivery does not capture module bindings named for host globals', () => {
    const src = 'Reflect = null\nObject = null\nglobalThis = null\nout = {k: v for k, v of {a: 9}}';
    const code = compileDelivered(src, 'inline');
    expect(code).toContain('const { __toPropertyKey, __defineOwnDataProperty } = (() => {');
    expect(code).not.toContain('Reflect.ownKeys');
    expect(code).not.toContain('Object.defineProperty');
    expect(new Function(`${code}\nreturn out.a;`)()).toBe(9);
  });

  test('import delivery requests only the compiler intrinsic seam', () => {
    const code = compileDelivered('out = {k: v for k, v of src}', 'import');
    expect(code).toStartWith(
      'import { __toPropertyKey, __defineOwnDataProperty } from '
    );
    expect(code).toContain('/src/runtime/intrinsics.js";');
  });

  test('a program without an object comprehension carries no intrinsic runtime', () => {
    expect(compileDelivered('out = {a: 1}', 'inline')).toBe('let out = {a: 1};');
  });
});
