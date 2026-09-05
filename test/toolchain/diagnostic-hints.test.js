// Parse diagnostics as the author reads them: the offending token
// names itself by its text, the expected list spells token kinds the
// way they are typed, and the rejections with an obvious intended
// spelling carry a hint naming it.
import { test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';

const rejection = (src) => {
  try { compile(src, { runtimeDelivery: 'none' }); } catch (e) { return e.message; }
  throw new Error(`compiled: ${src}`);
};

test('the offending token names itself by its text', () => {
  expect(rejection('a + * b')).toMatch(/Unexpected '\*'/);
  expect(rejection('f = (a...) -> a')).toMatch(/Unexpected '\.\.\.'/);
  expect(rejection('return v for v in a')).toMatch(/Unexpected 'for'/);
});

test('layout tokens and the expected list spell kinds in reader words', () => {
  const m = rejection('x = y +');
  expect(m).toMatch(/Unexpected end of input — expected .*a name/);
  expect(m).not.toMatch(/IDENTIFIER|TERMINATOR|CALL_END|UNARY_MATH/);
});

test.each([
  ['console.log x ?', "spelled x ?? y"],
  ['f = (a...) -> a', 'the dots lead the name'],
  ['return v for v in a', 'return (v for v in list)'],
  ["import! 'm'", "import!('mod')"],
  ['g()!', '`fn!()`, not `fn()!`'],
  ['if c\nthen 2', '`then` belongs on the `if` line'],
])('%s carries its hint', (src, hint) => {
  expect(rejection(src)).toContain(hint);
});

test('`is not` rejects with the isnt spelling', () => {
  expect(rejection('x is not null')).toContain('x isnt y');
  expect(rejection('x is not null')).toMatch(/:1:3:/);
});

test('`with` is contextual: import attributes only', () => {
  expect(compile("import d from './d.json' with { type: 'json' }").code).toContain("with {type: \"json\"}");
  expect(rejection('with x\n  1')).toContain("'with' is reserved");
});
