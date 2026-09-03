// The kind-schema gate: grammar.rip ships a `kinds` registry naming
// every semantic kind and the role vocabulary each may carry, and
// Solar fails generation on drift in either direction. The
// registry-matches-inventory case rides generated.test.js (a full
// Generator construction that must not throw); these tests drive each
// drift shape against the real grammar.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

const withKinds = (kinds) => ({ ...grammar, kinds });

test('an annotation using an undeclared kind fails generation', () => {
  const { state, ...rest } = grammar.kinds;
  expect(() => new Generator(withKinds(rest)))
    .toThrow(/undeclared kind 'state'/);
});

test('a role outside its kind vocabulary fails generation', () => {
  const trimmed = { ...grammar.kinds, state: grammar.kinds.state.filter((r) => r !== 'value') };
  expect(() => new Generator(withKinds(trimmed)))
    .toThrow(/kind 'state' carries undeclared role 'value'/);
});

test('a declared kind no rule uses fails generation', () => {
  expect(() => new Generator(withKinds({ ...grammar.kinds, phantom: ['x'] })))
    .toThrow(/declared kind 'phantom' is used by no rule/);
});

test('the drift failure prints the actual inventory for review-and-paste', () => {
  let message = '';
  try {
    new Generator(withKinds({}));
  } catch (e) {
    message = e.message;
  }
  expect(message).toContain('Actual inventory:');
  expect(message).toContain("state: ['annotation', 'operator', 'optionalMarker', 'target', 'value']");
});

test('a grammar without a registry is not gated', () => {
  const { kinds, ...ungated } = grammar;
  expect(() => new Generator(ungated)).not.toThrow();
});
