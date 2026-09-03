// The declared-ambiguity gate: grammar.rip ships an expectedConflicts
// manifest naming every reduce-reduce and ambiguous default the parse
// table may contain, and Solar fails generation on any drift. These
// tests drive the gate through each drift shape against the real
// grammar; the manifest-matches-table case rides generated.test.js
// (a full Generator construction that must not throw).
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

const withManifest = (expectedConflicts) => ({ ...grammar, expectedConflicts });

test('an undeclared conflict fails generation and names the rule', () => {
  const short = grammar.expectedConflicts.filter(([, rule]) => rule !== 'Statement → Return');
  expect(() => new Generator(withManifest(short))).toThrow(/undeclared: \[reduce-reduce\] Statement → Return/);
});

test('a resolution-count drift fails generation with both counts', () => {
  const bumped = grammar.expectedConflicts.map(([category, rule, count]) =>
    [category, rule, rule === 'Try → TRY Expression' ? count + 1 : count]);
  expect(() => new Generator(withManifest(bumped))).toThrow(/count drift: \[ambiguous\] Try → TRY Expression — declared 24, actual 23/);
});

test('a declared conflict the table no longer has fails generation', () => {
  const extra = [...grammar.expectedConflicts, ['reduce-reduce', 'Phantom → GHOST', 3]];
  expect(() => new Generator(withManifest(extra))).toThrow(/declared but absent: \[reduce-reduce\] Phantom → GHOST/);
});

test('a duplicate manifest entry fails generation', () => {
  const doubled = [...grammar.expectedConflicts, grammar.expectedConflicts[0]];
  expect(() => new Generator(withManifest(doubled))).toThrow(/duplicate entry/);
});

test('the drift failure prints the actual manifest for review-and-paste', () => {
  let message = '';
  try {
    new Generator(withManifest([]));
  } catch (e) {
    message = e.message;
  }
  expect(message).toContain('Actual manifest:');
  for (const [category, rule, count] of grammar.expectedConflicts) {
    expect(message).toContain(`['${category}', '${rule}', ${count}]`);
  }
});

test('a grammar without a manifest is not gated', () => {
  const { expectedConflicts, ...ungated } = grammar;
  expect(() => new Generator(ungated)).not.toThrow();
});
