// Pattern groups: '(A B)?' makes a run of symbols optional, '(A | B)'
// picks one alternative, and the two combine and nest. Variants expand
// absent-first with later groups varying fastest — the same order the
// single-token 'X?' sugar always used — and one action serves the whole
// family through bindings: '@x' is null where its label is absent, a
// spread '...@x' drops out (with its annotation part), and '@x?' is a
// presence flag that consumes the label.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';

const tiny = (rules, extra = {}) => new Generator({ start: 'Root', grammar: { Root: rules, ...extra } });
const patterns = (g) => g.rules.filter((r) => r.lhs === 'Root').map((r) => r.symbols.join(' '));
const roles = (g) => g.rules.filter((r) => r.lhs === 'Root')
  .map((r) => g.semantics[r.id].roles.map(({ name, grammarRef, literal, spread }) =>
    grammarRef == null ? `${name}=${JSON.stringify(literal)}` : `${name}:${spread ? '...' : ''}${grammarRef}`));

test('an optional group expands absent-first', () => {
  expect(patterns(tiny([['X (A B)? Y', 2]]))).toEqual(['X Y', 'X A B Y']);
});

test('an alternation expands to one rule per alternative, in order', () => {
  expect(patterns(tiny([['(A | B | C) Y', 2]]))).toEqual(['A Y', 'B Y', 'C Y']);
  expect(patterns(tiny([['(A | B)? Y', 2]]))).toEqual(['Y', 'A Y', 'B Y']);
});

test('groups nest, and stacked closers close them in order', () => {
  expect(patterns(tiny([['(A (B C)?)?', 1]]))).toEqual(['', 'A', 'A B C']);
  expect(patterns(tiny([['(A (B | C))? D', 2]]))).toEqual(['D', 'A B D', 'A C D']);
});

test('later groups vary fastest, matching the single-token sugar', () => {
  expect(patterns(tiny([['(A)? (B)?', 1]]))).toEqual(patterns(tiny([['A? B?', 1]])));
  expect(patterns(tiny([['(A)? (B)?', 1]]))).toEqual(['', 'B', 'A', 'A B']);
  expect(patterns(tiny([['(A B?)?', 1]]))).toEqual(['', 'A', 'A B']);
});

test('the paren and pipe terminals outside a group are ordinary symbols', () => {
  expect(patterns(tiny([['( Body )', 2]]))).toEqual(['( Body )']);
  expect(patterns(tiny([['A | B', '["|", 1, 3]', 'binary: operator, left, right']]))).toEqual(['A | B']);
  expect(patterns(tiny([['A ?? B', 2]]))).toEqual(['A ?? B']);
});

test('an unclosed or unbalanced group fails generation', () => {
  expect(() => tiny([['(A B', 1]])).toThrow(/unclosed '\(' group/);
  expect(() => tiny([['A B)?', 1]])).toThrow(/unbalanced '\)'/);
});

test('a binding whose label is absent becomes the literal null', () => {
  const g = tiny([['A[x]? B[y]', '["one", @x, @y]', 'one: _, x, y']]);
  expect(patterns(g)).toEqual(['B', 'A B']);
  expect(roles(g)).toEqual([['x=null', 'y:1'], ['x:1', 'y:2']]);
});

test('a presence binding is true or false and consumes the label', () => {
  const g = tiny([['(OWN[own])? A[x]', '["for", @own?, @x]', 'for: _, own, x']]);
  expect(patterns(g)).toEqual(['A', 'OWN A']);
  expect(roles(g)).toEqual([['own=false', 'x:1'], ['own=true', 'x:2']]);
});

test('an unbound label on a group symbol stays a side-band role where present', () => {
  const g = tiny([['(OWN[own])? A[x]', '["for", @x]', 'for: _, x']]);
  expect(roles(g)).toEqual([['x:1'], ['x:2', 'own:1']]);
});

test('an absent spread drops out of the template and the annotation', () => {
  const g = tiny([['A[x] (CALL_START ArgList[key] CALL_END)?', '["gate", @x, ...@key]', 'gate: _, x, ...key']],
    { ArgList: [['K']] });
  expect(patterns(g)).toEqual(['A', 'A CALL_START ArgList CALL_END']);
  expect(roles(g)).toEqual([['x:1'], ['x:1', 'key:...3']]);
  expect(g.ruleActions).toContain('return ["gate", $[$0]];');
});

test('a nested absent spread drops without touching the annotation', () => {
  const g = tiny([['A[x] (B[y])?', '["w", ["!", @x, ...@y], @x]', 'w: _, _, x']]);
  expect(roles(g)).toEqual([['x:1'], ['x:1']]);
  expect(g.ruleActions).toContain('return ["w", ["!", $[$0]], $[$0]];');
});

test('a binding to a label no variant carries still fails', () => {
  expect(() => tiny([['(A[x])? B', '["one", @nope]', 'one: _, x']]))
    .toThrow(/binding '@nope' has no matching pattern label/);
});
