// The emitter's input shape: src/emitter-shape.js rewrites the parser's
// tree (the shape grammar.rip's kind registry documents) into the shape
// src/emitter.js reads. Each row pins one reshaped construct: the
// converted tree, its rows' kinds, and the flags that travel with it.
import { test, expect } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emitterShape } from '../../src/emitter-shape.js';

parser.lexer = makeParserLexer();

const ROWS = [
  ["f = (a) -> a", "[\"program\",[\"=\",\"f\",[\"->\",[\"a\"],[\"block\",\"a\"]]]]"],
  ["g =! -> 1", "[\"program\",[\"readonly\",\"g\",[\"->\",[],[\"block\",\"1\"]]]]"],
  ["def h!()\n  1", "[\"program\",[\"void-def\",\"h\",[],[\"block\",\"1\"]]]"],
  ["o = {m!: -> 1, k, d: 1}", "[\"program\",[\"=\",\"o\",[\"object\",[\"void-pair\",\"m\",[\"->\",[],[\"block\",\"1\"]]],[null,\"k\",\"k\"],[\":\",\"d\",\"1\"]]]]"],
  ["x =! -> 1", "[\"program\",[\"readonly\",\"x\",[\"->\",[],[\"block\",\"1\"]]]]"],
  ["for v, i in xs by 2 when v\n  p v", "[\"program\",[\"for-in\",[\"v\",\"i\"],\"xs\",\"2\",\"v\",[\"block\",[\"call\",{},\"p\",\"v\"]]]]"],
  ["for own k, v of o\n  p k", "[\"program\",[\"for-of\",[\"k\",\"v\"],\"o\",true,null,[\"block\",[\"call\",{},\"p\",\"k\"]]]]"],
  ["for await v as it\n  p v", "[\"program\",[\"for-as\",[\"v\"],\"it\",true,null,[\"block\",[\"call\",{},\"p\",\"v\"]]]]"],
  ["loop\n  p 1", "[\"program\",[\"loop\",[\"block\",[\"call\",{},\"p\",\"1\"]]]]"],
  ["loop 3\n  p 1", "[\"program\",[\"loop-n\",\"3\",[\"block\",[\"call\",{},\"p\",\"1\"]]]]"],
  ["y = (v for v in xs when v)", "[\"program\",[\"=\",\"y\",[\"comprehension\",\"v\",[[\"for-in\",[\"v\"],\"xs\",null]],[\"v\"]]]]"],
  ["y = (k for own k of o)", "[\"program\",[\"=\",\"y\",[\"comprehension\",\"k\",[[\"for-of\",[\"k\"],\"o\",true]],[]]]]"],
  ["y = (v for await v as it when v)", "[\"program\",[\"=\",\"y\",[\"comprehension\",\"v\",[[\"for-as\",[\"v\"],\"it\",true,null]],[\"v\"]]]]"],
  ["try a()", "[\"program\",[\"try\",[\"call\",{},\"a\"]]]"],
  ["try a() catch then b()", "[\"program\",[\"try\",[\"call\",{},\"a\"],[null,[\"block\",[\"call\",{},\"b\"]]]]]"],
  ["try a() finally c()", "[\"program\",[\"try\",[\"call\",{},\"a\"],[\"block\",[\"call\",{},\"c\"]]]]"],
  ["try\n  a()\ncatch e\n  b()\nfinally\n  c()", "[\"program\",[\"try\",[\"block\",[\"call\",{},\"a\"]],[\"e\",[\"block\",[\"call\",{},\"b\"]]],[\"block\",[\"call\",{},\"c\"]]]]"],
  ["if a then b else c", "[\"program\",[\"if\",\"a\",[\"block\",\"b\"],[\"block\",\"c\"]]]"],
  ["p 1 if a", "[\"program\",[\"if\",\"a\",[[\"call\",{},\"p\",\"1\"]]]]"],
  ["while a when b\n  c()", "[\"program\",[\"while\",\"a\",\"b\",[\"block\",[\"call\",{},\"c\"]]]]"],
  ["p 1 until a", "[\"program\",[\"while\",[\"!\",\"a\"],[[\"call\",{},\"p\",\"1\"]]]]"],
  ["class", "[\"program\",[\"class\",null,null]]"],
  ["class A extends B", "[\"program\",[\"class\",\"A\",\"B\"]]"],
  ["switch\n  when a then 1", "[\"program\",[\"switch\",null,[[\"when\",[\"a\"],[\"block\",\"1\"]]],null]]"],
  ["switch x\n  when 1 then 2\n  else 3", "[\"program\",[\"switch\",\"x\",[[\"when\",[\"1\"],[\"block\",\"2\"]]],[\"block\",\"3\"]]]"],
  ["e = ~> p 1", "[\"program\",[\"=\",\"e\",[\"effect\",null,[\"call\",{},\"p\",\"1\"]]]]"],
  ["C = component\n  accept t\n  render\n    div \"x\"", "[\"program\",[\"=\",\"C\",[\"component\",null,[\"block\",[\"accept\",\"t\"],[\"render\",[\"block\",[\"call\",{},\"div\",\"\\\"x\\\"\"]]]]]]]"],
  ["s = a[1..]\nt = a[..2]\nu = [1..3]", "[\"program\",[\"=\",\"s\",[\"[]\",\"a\",[\"..\",\"1\",null]]],[\"=\",\"t\",[\"[]\",\"a\",[\"..\",null,\"2\"]]],[\"=\",\"u\",[\"..\",\"1\",\"3\"]]]"],
  ["i++\n--j", "[\"program\",[\"++\",\"i\",true],[\"--\",\"j\",false]]"],
  ["f = ->\n  return\ng = ->\n  yield", "[\"program\",[\"=\",\"f\",[\"->\",[],[\"block\",[\"return\"]]]],[\"=\",\"g\",[\"->\",[],[\"block\",[\"yield\"]]]]]"],
  ["import \"x\"\nimport {} from \"y\"\nimport d, * as n from \"z\"\nimport { a } from \"w\" with { type: \"json\" }", "[\"program\",[\"import\",\"\\\"x\\\"\"],[\"import\",\"{}\",\"\\\"y\\\"\"],[\"import\",\"d\",[\"*\",\"n\"],\"\\\"z\\\"\"],[\"import\",[\"a\"],[\"with\",[\"object\",[\":\",\"type\",\"\\\"json\\\"\"]]],\"\\\"w\\\"\"]]"],
  ["export {}\nexport * as m from \"x\"\nexport * from \"y\"", "[\"program\",[\"export\",\"{}\"],[\"export-all\",\"\\\"x\\\"\",\"m\"],[\"export-all\",\"\\\"y\\\"\"]]"],
  ["f = (a?) -> a", "[\"program\",[\"=\",\"f\",[\"->\",[[\"typed-var\",\"a\",\"\"]],[\"block\",\"a\"]]]]"],
  ["x = [a, , b,]", "[\"program\",[\"=\",\"x\",[\"array\",\"a\",\",\",\"b\"]]]"],
  ["x = \"#{}a\"", "[\"program\",[\"=\",\"x\",[\"str\",\"\\\"\\\"\",\"\",\"\\\"a\\\"\"]]]"],
  ["x = obj.{a, b: c, d = 1}", "[\"program\",[\"=\",\"x\",[\".{}\",\"obj\",[\"a\",\"a\",null],[\"b\",\"c\",null],[\"d\",\"d\",\"1\"]]]]"],
  ["return x if c else y", "[\"program\",[\"return\",[\"?:\",\"c\",\"x\",\"y\"]]]"],
  ["z = (a; b)", "[\"program\",[\"=\",\"z\",[\"block\",\"a\",\"b\"]]]"],
];

for (const [src, expected] of ROWS) {
  test(`emitter shape: ${JSON.stringify(src)}`, () => {
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(JSON.stringify(emitterShape(r.sexpr, r.stores.nodeIds))).toBe(expected);
  });
}

test('a converted node answers to its original node id; a scaffold stays without one', () => {
  const r = parser.parse('p 1 if a\n');
  const out = emitterShape(r.sexpr, r.stores.nodeIds);
  const ifNode = out[1];
  expect(r.stores.nodeIds.get(ifNode)).toBe(r.stores.nodeIds.get(r.sexpr[2]));
  expect(r.stores.nodeIds.has(ifNode[2])).toBe(false);
});

test('the parenthesized flag travels with its node', () => {
  const r = parser.parse('x = (a + b) * c\n');
  const out = emitterShape(r.sexpr, r.stores.nodeIds);
  expect(out[1][2][1].parenthesized).toBe(true);
});

test('a loop over an unknown source has no emitter shape', () => {
  const r = parser.parse('loop\n  p 1\n');
  r.sexpr[2][1] = { over: 'sideways' };
  expect(() => emitterShape(r.sexpr, r.stores.nodeIds)).toThrow(/a loop over 'sideways' has no emitter shape/);
});
