// Nested-template annotations: a nested array element of an action
// template takes '_' (opaque scaffold), '_(part, ...)' (transparent —
// its parts are roles of the enclosing node), or 'role(kind: part, ...)'
// (a node of its own that the enclosing node's `role` points at). At
// parse time the nested array registers as a NodeStore row of that
// kind, bottom-up, spanning the matched symbols it carries; the parent
// gets a nested role row (null grammarRef, real span, childNodeId).
// A nested template with no annotation at all now fails generation
// like any other constructor rule.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { Stores } from '../../src/stores.js';

const g = (rule) => ({ start: 'Root', grammar: { Root: [rule] } });
const sem = (rule) => new Generator(g(rule)).semantics[1];

test('a transparent scaffold names its elements as roles of the enclosing node', () => {
  expect(sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, _(then)'])).toEqual({
    kind: 'if',
    roles: [
      { name: 'condition', grammarRef: 2, childSlot: 1, spread: false },
      { name: 'then', grammarRef: 3, childSlot: null, spread: false },
    ],
  });
});

test('a named sub-annotation describes a nested node and its parent role', () => {
  expect(sem(['UNTIL ID ID', '["while", ["!", 2], 3]', 'while: _, condition(unary: operator, operand), body'])).toEqual({
    kind: 'while',
    roles: [{ name: 'body', grammarRef: 3, childSlot: 2, spread: false }],
    nested: [{
      role: 'condition', path: [1], kind: 'unary',
      roles: [
        { name: 'operator', grammarRef: null, childSlot: 0, literal: '!' },
        { name: 'operand', grammarRef: 2, childSlot: 1, spread: false },
      ],
      nested: [],
    }],
  });
});

test('sub-annotations nest, and a scaffold path reaches a nested node', () => {
  const s = sem(['E FOR V IN E', '["comp", 1, [["for-in", 3, 5]], []]', 'comp: _, value, _(loop(forin: _, vars, iterable)), _']);
  expect(s.nested).toEqual([{
    role: 'loop', path: [2, 0], kind: 'forin',
    roles: [
      { name: 'vars', grammarRef: 3, childSlot: 1, spread: false },
      { name: 'iterable', grammarRef: 5, childSlot: 2, spread: false },
    ],
    nested: [],
  }]);
  const deep = sem(['NEW ID BANG ARGS', '["await", ["new", [2, ...4]]]', 'await: _, value(unary: operator, operand(call: callee, ...args))']);
  expect(deep.nested[0].nested[0]).toEqual({
    role: 'operand', path: [1], kind: 'call',
    roles: [
      { name: 'callee', grammarRef: 2, childSlot: 0, spread: false },
      { name: 'args', grammarRef: 4, childSlot: 1, spread: true },
    ],
    nested: [],
  });
});

test('the old opaque spelling still works and a bare name still rejects', () => {
  expect(sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, _'])).toEqual({
    kind: 'if', roles: [{ name: 'condition', grammarRef: 2, childSlot: 1, spread: false }],
  });
  expect(() => sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, then']))
    .toThrow(/nested structural element must be named '_'/);
});

test('malformed sub-annotations fail generation with the rule named', () => {
  expect(() => sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, _(then, extra)']))
    .toThrow(/template has 1 element\(s\) but annotation names 2 part\(s\)/);
  expect(() => sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, then(']))
    .toThrow(/unbalanced parentheses/);
  expect(() => sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition(x), _']))
    .toThrow(/position ref 2 takes no sub-annotation/);
  expect(() => sem(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, _(condition)']))
    .toThrow(/duplicate role 'condition'/);
  expect(() => sem(['A B C', '["x", ...1, [2]]', 'x: _, ...items, _(tail)']))
    .toThrow(/follows a spread — its element cannot be located/);
});

test('a nested kind and its parent role count as uses in the kinds registry', () => {
  const grammar = {
    start: 'Root',
    grammar: { Root: [['UNTIL ID ID', '["while", ["!", 2], 3]', 'while: _, condition(unary: operator, operand), body']] },
    kinds: { while: ['body', 'condition'], unary: ['operand', 'operator'] },
  };
  expect(() => new Generator(structuredClone(grammar))).not.toThrow();
  expect(() => new Generator({ ...structuredClone(grammar), kinds: { while: ['body', 'condition'] } }))
    .toThrow(/undeclared kind 'unary'/);
  expect(() => new Generator({ ...structuredClone(grammar), kinds: { while: ['body'], unary: ['operand', 'operator'] } }))
    .toThrow(/kind 'while' carries undeclared role 'condition'/);
});

test('a nested template without an annotation fails generation', () => {
  expect(() => new Generator(g(['UNTIL ID ID', '["while", ["!", 2], 3]'])))
    .toThrow(/constructor rule\(s\) lack annotations[\s\S]*Root → UNTIL ID ID/);
});

// ---- runtime, on the real grammar ----
const parse = (src) => {
  parser.lexer = makeParserLexer('<nested>');
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return new Stores(r.stores);
};

test('an until loop registers its negation as a unary node the condition role points at', () => {
  const stores = parse('until done\n  step()');
  const [loop] = stores.nodesByKind('while');
  const [neg] = stores.nodesByKind('unary');
  const condition = stores.role(loop.nodeId, 'condition');
  expect(condition.grammarRef).toBeNull();
  expect(condition.childNodeId).toBe(neg.nodeId);
  expect([condition.sourceStart, condition.sourceEnd]).toEqual([6, 10]);
  expect([neg.sourceStart, neg.sourceEnd]).toEqual([6, 10]);
  expect(neg.nodeId).toBeLessThan(loop.nodeId);
  expect(stores.role(neg.nodeId, 'operator').literal).toBe('!');
  expect([stores.role(neg.nodeId, 'operand').sourceStart, stores.role(neg.nodeId, 'operand').sourceEnd]).toEqual([6, 10]);
});

test('a comprehension registers its loop clause as a forin node and the guard through the scaffold', () => {
  const stores = parse('x = (v * 2 for v in list when v > 1)');
  const [comp] = stores.nodesByKind('comprehension');
  const [clause] = stores.nodesByKind('forin');
  expect(stores.role(comp.nodeId, 'loop').childNodeId).toBe(clause.nodeId);
  expect([clause.sourceStart, clause.sourceEnd]).toEqual([15, 24]);
  expect([stores.role(clause.nodeId, 'iterable').sourceStart, stores.role(clause.nodeId, 'iterable').sourceEnd]).toEqual([20, 24]);
  expect(stores.role(clause.nodeId, 'step').literal).toBeNull();
  const guard = stores.role(comp.nodeId, 'guard');
  expect(guard.childSlot).toBeNull();
  expect([guard.sourceStart, guard.sourceEnd]).toEqual([30, 35]);
});

test('a postfix conditional keeps its statement as the then role', () => {
  const stores = parse('run() unless quiet');
  const [cond] = stores.nodesByKind('if');
  const then = stores.role(cond.nodeId, 'then');
  expect([then.sourceStart, then.sourceEnd]).toEqual([0, 5]);
  expect(stores.role(cond.nodeId, 'condition').childNodeId).toBe(stores.nodesByKind('unary')[0].nodeId);
});

test('an awaited construction nests unary and call nodes under the await', () => {
  const stores = parse('y = new Foo!(1)');
  const [aw] = stores.nodesByKind('await');
  const [ctor] = stores.nodesByKind('unary');
  expect(stores.role(aw.nodeId, 'value').childNodeId).toBe(ctor.nodeId);
  expect(stores.role(ctor.nodeId, 'operator').literal).toBe('new');
  const call = stores.node(stores.role(ctor.nodeId, 'operand').childNodeId);
  expect(call.semanticKind).toBe('call');
  expect([call.sourceStart, call.sourceEnd]).toEqual([8, 15]);
});
