// The kind-registry gate: grammar.rip ships a `kinds` registry naming
// every semantic kind, the tree forms it takes (named, typed slots) and
// the side roles its labels may record, and Solar fails generation on
// drift in either direction. The registry-matches-grammar case rides
// generated.test.js (a full Generator construction that must not
// throw); these tests drive each drift shape against the real grammar.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

const withKinds = (kinds) => ({ ...grammar, kinds });
const withKind = (kind, entry) => withKinds({ ...grammar.kinds, [kind]: entry });
const state = grammar.kinds.state;

test('an annotation using an undeclared kind fails generation', () => {
  const { state: _, ...rest } = grammar.kinds;
  expect(() => new Generator(withKinds(rest))).toThrow(/undeclared kind 'state'/);
});

test('a template no form admits fails generation, naming the closest form', () => {
  const renamed = { ...state, forms: ['"state" target:expr init:expr'] };
  expect(() => new Generator(withKind('state', renamed)))
    .toThrow(/kind 'state' has no form for this template — closest is \("state" target:expr init:expr\): element 2: expected 'init', got 'value'/);
  // A misfitting template still counts as a use of its kind.
  expect(() => new Generator(withKind('state', renamed))).not.toThrow(/declared kind 'state' is used by no rule/);
});

test('a constant the form does not admit fails generation', () => {
  const head = { ...state, forms: ['"reactive" target:expr value:expr'] };
  expect(() => new Generator(withKind('state', head)))
    .toThrow(/element 0: expected the constant "reactive"/);
});

test('a literal the slot type does not admit fails generation', () => {
  // `for-of` writes its own-flag as a boolean literal.
  const forof = grammar.kinds.forof;
  const strict = { forms: forof.forms.map((f) => f.replace('own:bool', 'own:leaf')) };
  expect(() => new Generator(withKind('forof', strict)))
    .toThrow(/slot 'own' does not admit (true|false)/);
});

test('a scaffold in a slot that takes no array fails generation', () => {
  const func = grammar.kinds.func;
  const strict = { ...func, forms: ['kind:"->"|"=>" params:expr body:block'] };
  expect(() => new Generator(withKind('func', strict))).toThrow(/slot 'params' takes no array/);
});

test('a nested node is checked against its own kind', () => {
  // The comprehension's loop clause is a nested forin node.
  const forin = grammar.kinds.forin;
  const loopOnly = { forms: [forin.forms[0]] };
  expect(() => new Generator(withKind('forin', loopOnly)))
    .toThrow(/kind 'forin' has no form for this template/);
});

test('a label outside the side roles fails generation', () => {
  const trimmed = { ...state, side: state.side.filter((r) => r !== 'annotation') };
  expect(() => new Generator(withKind('state', trimmed)))
    .toThrow(/label '\[annotation\]' is not a side role of kind 'state'/);
});

test('a declared kind no rule uses fails generation', () => {
  expect(() => new Generator(withKind('phantom', { forms: ['"phantom"'] })))
    .toThrow(/declared kind 'phantom' is used by no rule/);
});

test('a declared form no rule builds fails generation', () => {
  const extra = { ...state, forms: [...state.forms, '"state" target:expr'] };
  expect(() => new Generator(withKind('state', extra)))
    .toThrow(/kind 'state' form 2 \("state" target:expr\) is built by no rule/);
});

test('a declared side role no rule records fails generation', () => {
  const extra = { ...state, side: [...state.side, 'phantom'] };
  expect(() => new Generator(withKind('state', extra)))
    .toThrow(/kind 'state' side role 'phantom' is recorded by no rule/);
});

test('malformed registry entries reject', () => {
  const bad = (entry) => () => new Generator(withKind('state', entry));
  expect(bad(['annotation', 'target'])).toThrow(/kind 'state' must be \{forms, side\?\}/);
  expect(bad({ forms: [] })).toThrow(/kind 'state' declares no forms/);
  expect(bad({ ...state, extra: 1 })).toThrow(/kind 'state' has an unknown key 'extra'/);
  expect(bad({ ...state, forms: ['"state" target'] })).toThrow(/malformed slot 'target'/);
  expect(bad({ ...state, forms: ['"state" ...target:expr value:expr'] })).toThrow(/slot 'value' follows a spread/);
  expect(bad({ ...state, forms: ['"state" target:expr target:expr'] })).toThrow(/duplicate slot 'target'/);
  expect(bad({ ...state, forms: ['"state" target:expr value:widget'] })).toThrow(/names undeclared kind 'widget'/);
  expect(bad({ ...state, forms: ['"state" target:expr value:[expr'] })).toThrow(/unbalanced/);
  expect(bad({ ...state, forms: ['"state" target:expr value:"x"y'] })).toThrow(/malformed literal/);
  expect(bad({ ...state, side: ['operator', 'operator'] })).toThrow(/repeats a side role/);
});

test('a grammar without a registry is not gated', () => {
  const { kinds, ...ungated } = grammar;
  expect(() => new Generator(ungated)).not.toThrow();
});
