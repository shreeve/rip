// Named template bindings: an action references a labeled pattern
// symbol as '@name' ('...@name' for spreads) instead of a 1-based
// position. Bindings resolve to positions before template
// classification; a consumed label is a binding (the ref carries the
// value and span), an unconsumed label keeps its side-band role. The
// real grammar proves the equivalence at scale — generated.test.js
// pins parser.js, whose ReactiveAssign rows all share one bound
// template — while these tests drive the resolver's own contract
// through a minimal grammar.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';

const tiny = (rules) => new Generator({ start: 'Root', grammar: { Root: rules } });

test('bindings resolve to the labeled positions, in any pattern layout', () => {
  const g = tiny([['A[x] SEP B[y]', '["pair", @y, @x]', 'pair: _, y, x']]);
  const roles = g.semantics[1].roles;
  expect(roles).toEqual([
    { name: 'y', grammarRef: 3, childSlot: 1, spread: false },
    { name: 'x', grammarRef: 1, childSlot: 2, spread: false },
  ]);
});

test('a spread binding resolves as a spread ref', () => {
  const g = tiny([['A[head] REST[rest]', '["all", @head, ...@rest]', 'all: _, head, ...rest']]);
  const roles = g.semantics[1].roles;
  expect(roles[1]).toEqual({ name: 'rest', grammarRef: 2, childSlot: 2, spread: true });
});

test('a consumed label is a binding, not a side-band role', () => {
  const g = tiny([['A[x] MARK[flag] B[y]', '["pair", @x, @y]', 'pair: _, x, y']]);
  const names = g.semantics[1].roles.map((r) => r.name);
  expect(names).toEqual(['x', 'y', 'flag']); // flag stays side-band; x and y ride the template
  expect(g.semantics[1].roles[2].childSlot).toBe(null);
});

test('an @ inside a string literal is text, not a binding', () => {
  const g = tiny([['A[x]', '["tag", @x, "@x"]', 'tag: _, x, _']]);
  expect(g.semantics[1].roles).toEqual([{ name: 'x', grammarRef: 1, childSlot: 1, spread: false }]);
  expect(g.primitiveRefs[1]).toEqual([1]);
});

test('a non-template action takes executable $n refs', () => {
  const g = tiny([['NUM[n]', '@n + 7']]);
  expect(g.generate()).toContain('return $[$0] + 7;');
});

test('an unknown binding name fails generation', () => {
  expect(() => tiny([['A[x] B', '["pair", @x, @y]', 'pair: _, x, y']]))
    .toThrow(/binding '@y' has no matching pattern label/);
});

test("a bare '@' in an action fails generation", () => {
  expect(() => tiny([['A[x]', '["pair", @ x]', 'pair: _, x']]))
    .toThrow(/'@' in an action must spell a binding/);
});
