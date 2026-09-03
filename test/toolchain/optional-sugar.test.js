// 'SYMBOL?' pattern sugar: an optional pattern token expands the rule
// into every present/absent combination, absent-first in
// binary-counting order. Combined with named bindings, one rule line
// declares a whole marker-token family; the '?' and '??' terminals
// never read as sugar.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';

const tiny = (rules, extra = {}) => new Generator({ start: 'Root', grammar: { Root: rules, ...extra } });

const patterns = (g) => g.rules
  .filter((r) => r.lhs === 'Root')
  .map((r) => r.symbols.join(' '));

test('two optional tokens expand to four rules, absent-first', () => {
  const g = tiny([['A B? C?', 2]]);
  expect(patterns(g)).toEqual(['A', 'A C', 'A B', 'A B C']);
});

test('an all-optional pattern includes the empty rule', () => {
  const g = tiny([['A?', 1]]);
  expect(patterns(g)).toEqual(['', 'A']);
});

test('bindings resolve per variant, so one action serves the family', () => {
  const g = tiny([['A[x] M? B[y]', '["pair", @x, @y]', 'pair: _, x, y']]);
  const refs = g.rules.filter((r) => r.lhs === 'Root')
    .map((r) => g.semantics[r.id].roles.map((role) => role.grammarRef));
  expect(refs).toEqual([[1, 2], [1, 3]]);
});

test('a label on an optional symbol is side-band only where present', () => {
  const g = tiny([['A[x] M[mark]? B[y]', '["pair", @x, @y]', 'pair: _, x, y']]);
  const names = g.rules.filter((r) => r.lhs === 'Root')
    .map((r) => g.semantics[r.id].roles.map((role) => role.name));
  expect(names).toEqual([['x', 'y'], ['x', 'y', 'mark']]);
});

test("the '??' and '?' terminals are never sugar", () => {
  const g = tiny([['A ?? B', 2]]);
  expect(patterns(g)).toEqual(['A ?? B']);
});

test('a binding to an optional symbol fails generation in the absent variant', () => {
  expect(() => tiny([['A[x]? B', '["one", @x]', 'one: _, x']]))
    .toThrow(/binding '@x' has no matching pattern label/);
});
