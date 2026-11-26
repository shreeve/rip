// The s-expression contract: every tree the parser builds for a real
// program — each corpus file, tracked package module and language-suite
// row — fits the kind registry (grammar.rip `kinds`, shipped as
// `kinds` in src/parser.js), and every declared form is one some real
// tree takes. The negative cases pin the validator's rejections: a
// value of the wrong type, a part kind or plumbing list where an
// expression belongs, a role row naming the wrong slot, an arity or
// constant mismatch, an unknown kind, and a root that is not a program.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import parser, { kinds } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { parseSource } from '../../src/compiler.js';
import { validateSexpr } from '../../src/sexpr.js';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';

const ROOT = join(import.meta.dir, '../..');

// Leaves: the driver builds each token value as [kind, {}, raw].
const n = (raw) => ['name', {}, raw];
const num = (raw) => ['num', {}, raw];
const str = (raw) => ['string', {}, raw];

parser.lexer = makeParserLexer();

const parse = (src) => {
  const result = parser.parse(src);
  expect(result.diagnostics).toEqual([]);
  return result;
};

test('every corpus, package and language-suite tree fits the registry, and every form occurs', async () => {
  const corpusDir = join(ROOT, 'test/corpus');
  const inputs = [
    ...readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort()
      .map((f) => ({ key: `corpus ${f}`, src: readFileSync(join(corpusDir, f), 'utf8') })),
    ...packageInputs(ROOT),
    ...(await rowInputs(ROOT)),
  ];
  const coverage = new Map();
  const failures = [];
  let validated = 0;
  for (const { key, src } of inputs) {
    // Only a `fail` row may not parse: it pins a rejection, and builds
    // no tree the contract covers. Every other input must parse.
    let parsed;
    try {
      parsed = parseSource(src, { path: 'input.rip' });
    } catch (e) {
      if (!/ › fail /.test(key)) failures.push(`${key}: does not parse: ${String(e.message).split('\n')[0]}`);
      continue;
    }
    validated++;
    for (const issue of validateSexpr(parsed.result, { coverage })) {
      failures.push(`${key} @${issue.start}..${issue.end}: ${issue.message}`);
    }
  }
  expect(validated).toBeGreaterThan(4000);
  expect(failures.slice(0, 20)).toEqual([]);
  const unseen = [];
  for (const [kind, entry] of Object.entries(kinds)) {
    entry.forms.forEach((form, i) => {
      if (!coverage.get(kind)?.has(i)) unseen.push(`${kind} (${form.text})`);
    });
  }
  expect(unseen).toEqual([]);
}, 60_000);

// Find the first node of a kind in a parse result.
const nodeOfKind = (result, kind) => {
  const rows = new Map(result.stores.nodes.map((n) => [n.nodeId, n]));
  let found = null;
  const walk = (node) => {
    if (found || !Array.isArray(node)) return;
    if (rows.get(result.stores.nodeIds.get(node))?.semanticKind === kind) found = node;
    else node.forEach(walk);
  };
  walk(result.sexpr);
  return found;
};

const messages = (result, options) => validateSexpr(result, options).map((i) => i.message);

test('a null in a slot that does not admit null rejects', () => {
  const result = parse('for k, v of o\n  p k\n');
  nodeOfKind(result, 'forof')[3] = null;
  expect(messages(result)).toEqual([
    expect.stringMatching(/^forof node fits no form; closest \("loop" .*\): element 3 is null, the slot takes object:expr$/),
  ]);
});

test('a node of the wrong kind in a typed slot rejects', () => {
  // A try's handler slot holds a catch node or nothing; a call node is
  // neither.
  const result = parse('try a() catch e then b()\n');
  const tryNode = nodeOfKind(result, 'try');
  tryNode[3] = nodeOfKind(result, 'call');
  expect(messages(result)).toEqual([
    expect.stringMatching(/^try node fits no form; closest \("try" .*\): element 3 is a call node, the slot takes handler:catch\|none$/),
  ]);
});

test('a plumbing list where an expression belongs rejects', () => {
  // The when's conditions list is a real plumbing array with its own
  // NodeStore row.
  const result = parse('switch s\n  when a, b\n    p 1\nx = y\n');
  const conditions = nodeOfKind(result, 'when')[2];
  expect(result.stores.nodeIds.has(conditions)).toBe(true);
  nodeOfKind(result, 'assign')[3] = conditions;
  expect(messages(result)).toEqual([
    expect.stringMatching(/element 3 is an unkinded array, the slot takes value:expr$/),
  ]);
});

test('a part node where an expression belongs rejects', () => {
  const result = parse('try a() catch e then b()\nx = y\n');
  nodeOfKind(result, 'assign')[3] = nodeOfKind(result, 'catch');
  expect(messages(result)).toEqual([
    expect.stringMatching(/^assign node fits no form; closest .*: element 3 is a catch node, the slot takes value:expr$/),
  ]);
  const root = parse('x = y\n');
  nodeOfKind(root, 'assign')[3] = root.sexpr;
  expect(messages(root)).toEqual([expect.stringMatching(/element 3 is a program node, the slot takes value:expr$/)]);
});

test('a role row naming a different slot rejects', () => {
  // A finally block recorded as the handler: the value fits the
  // finalizer slot's type, but the RoleStore row names the wrong slot.
  const result = parse('try\n  a\nfinally\n  b\n');
  const id = result.stores.nodeIds.get(nodeOfKind(result, 'try'));
  result.stores.roles.find((r) => r.nodeId === id && r.role === 'finalizer').role = 'handler';
  expect(messages(result)).toEqual([
    "try node fits no form; closest (\"try\" attrs:{} body:expr|block handler:catch|none finalizer:block|none): role 'handler' sits at element 4, which the form names 'finalizer'",
  ]);
});

test('an executable action value passes where an expression belongs', () => {
  // `(a; b)` is built by the Parenthetical rule's executable action.
  const result = parse('x = (a; b)\n');
  const value = nodeOfKind(result, 'assign')[3];
  expect(value[0]).toBe('block');
  expect(messages(result)).toEqual([]);
});

test('an element past the form arity rejects', () => {
  const result = parse('return 1\n');
  nodeOfKind(result, 'return').push('2');
  expect(messages(result)).toEqual([
    expect.stringMatching(/^return node fits no form; closest \("return" attrs:\{\} value:expr\|none\): element 3 has no slot \(the form has 3\)$/),
  ]);
});

test('every token value is a leaf node with its own row over the token', () => {
  const src = 'x = f 1, "a", /b/, true, null, undefined, this\nloop\n  break\n';
  const result = parse(src);
  const rows = new Map(result.stores.nodes.map((row) => [row.nodeId, row]));
  const leaves = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    const row = rows.get(result.stores.nodeIds.get(node));
    if (row?.ruleId === 0) leaves.push([node, row.semanticKind, src.slice(row.sourceStart, row.sourceEnd)]);
    node.forEach(walk);
  };
  walk(result.sexpr);
  expect(leaves).toEqual([
    [n('x'), 'name', 'x'],
    [n('f'), 'name', 'f'],
    [num('1'), 'num', '1'],
    [str('"a"'), 'string', '"a"'],
    [['regex', {}, '/b/'], 'regex', '/b/'],
    [['lit', {}, 'true'], 'lit', 'true'],
    [['lit', {}, 'null'], 'lit', 'null'],
    [['lit', {}, 'undefined'], 'lit', 'undefined'],
    [['this', {}, 'this'], 'this', 'this'],
    [['statement', {}, 'break'], 'statement', 'break'],
  ]);
});

test('`@` alone is the this leaf spelled `@`; `@x` keeps the receiver word', () => {
  const result = parse('a = @\nb = @x\nc = @[k]\nd = @.y\n');
  const [, , first, second, third, fourth] = result.sexpr;
  const at = ['this', {}, '@'];
  expect(first[3]).toEqual(at);
  const id = result.stores.nodeIds.get(first[3]);
  const row = result.stores.nodes.find((r) => r.nodeId === id);
  expect([row.semanticKind, row.sourceStart, row.sourceEnd]).toEqual(['this', 4, 5]);
  // `@x` is one sigil spelling: the grammar writes its receiver.
  expect(second[3]).toEqual(['.', {}, 'this', n('x')]);
  // `@[k]` and `@.y` are `@` followed by an access: the receiver is the leaf.
  expect(third[3]).toEqual(['[]', {}, at, n('k')]);
  expect(fourth[3]).toEqual(['.', {}, at, n('y')]);
});

test('an expression slot never takes a raw string', () => {
  const result = parse('x = a + b\n');
  nodeOfKind(result, 'binary')[2] = 'a';
  expect(messages(result)).toEqual([
    expect.stringMatching(/^binary node fits no form; .*element 2 is leaf "a", the slot takes left:expr/),
  ]);
});

test('a leaf whose raw value its form does not list rejects', () => {
  const result = parse('x = true\n');
  nodeOfKind(result, 'lit')[2] = 'maybe';
  expect(messages(result)).toEqual([
    expect.stringMatching(/^lit node fits no form; closest \("lit" attrs:\{\} raw:"true"\|"false"\|"null"\|"undefined"\): element 2 is leaf "maybe"/),
  ]);
});

test('a wrong constant head rejects', () => {
  const result = parse('loop\n  p 1\n');
  nodeOfKind(result, 'loop')[0] = 'loop-x';
  expect(messages(result)[0]).toMatch(/element 0 is leaf "loop-x", the slot takes "loop"/);
});

test('a kind missing from the registry rejects', () => {
  const result = parse('x = y\n');
  const { assign, ...rest } = kinds;
  expect(messages(result, { kinds: rest })).toEqual(["kind 'assign' is not in the registry"]);
});

test('a root that is not a program rejects', () => {
  const result = parse('x = y\n');
  expect(messages({ ...result, sexpr: result.sexpr[2] })).toContain('the root is an assign node, not a program node');
});

test('every call is ["call", attrs, callee, ...args], and the attribute record carries opt and await', () => {
  const tree = (src) => parse(src).sexpr[2];
  expect(tree('f a')).toEqual(['call', {}, n('f'), n('a')]);
  expect(tree('f?.(a)')).toEqual(['call', { opt: true }, n('f'), n('a')]);
  expect(tree('f? a')).toEqual(['call', { opt: true }, n('f'), n('a')]);
  expect(tree('f!')).toEqual(['call', { await: true }, n('f')]);
  expect(tree('f?! a')).toEqual(['call', { opt: true, await: true }, n('f'), n('a')]);
  expect(tree('x = import("m")')[3]).toEqual(['call', {}, 'import', str('"m"')]);
  expect(tree('x = import!("m")')[3]).toEqual(['call', { await: true }, 'import', str('"m"')]);
  const ctor = parse('class A extends B\n  constructor: -> super(1)\n').sexpr[2][4][2][2][3][3][2];
  expect(ctor).toEqual(['call', {}, 'super', num('1')]);
});

test('a call of a construct name is a call, never the construct', () => {
  const tree = (src) => parse(src).sexpr[2];
  expect(tree('state a, 0')).toEqual(['call', {}, n('state'), n('a'), num('0')]);
  expect(tree('a := 0')).toEqual(['state', {}, n('a'), num('0')]);
  expect(tree('effect h, 5')).toEqual(['call', {}, n('effect'), n('h'), num('5')]);
  expect(tree('readonly x, 5')).toEqual(['call', {}, n('readonly'), n('x'), num('5')]);
  expect(tree('block 1, 2')).toEqual(['call', {}, n('block'), num('1'), num('2')]);
  // A zero-argument call and an interpolation chunk are distinct:
  // `c()` against `"#{c}"`.
  expect(tree('c()')).toEqual(['call', {}, n('c')]);
  expect(tree('"#{c}"')).toEqual(['str', {}, str('""'), [n('c')], str('""')]);
});

test('an attribute record must hold exactly its slot\'s flags', () => {
  const result = parse('f!\n');
  const call = nodeOfKind(result, 'dammit');
  call[1] = { await: true, opt: true };
  expect(messages(result)).toEqual([
    expect.stringMatching(/^dammit node fits no form; closest \("call" attrs:\{await\} callee:expr\): element 1 is the record \{"await":true,"opt":true\}, the slot takes attrs:\{await\}$/),
  ]);
  const flag = parse('f!\n');
  nodeOfKind(flag, 'dammit')[1] = { await: 'yes' };
  expect(messages(flag)[0]).toMatch(/element 1 is the record \{"await":"yes"\}/);
});

test('an absent slot is the none marker, and only a slot that admits none takes it', () => {
  const result = parse('return\n');
  expect(nodeOfKind(result, 'return')).toEqual(['return', {}, ['none', {}]]);
  expect(messages(result)).toEqual([]);
  const filled = parse('f()\ny = 1\n');
  nodeOfKind(filled, 'assign')[3] = ['none', {}];
  expect(messages(filled)).toEqual([expect.stringMatching(/element 3 is an unkinded array, the slot takes value:expr$/)]);
});

test('a loop record names its source exactly', () => {
  const result = parse('for k, v of o\n  p k\n');
  nodeOfKind(result, 'forof')[1] = { over: 'in' };
  expect(messages(result)[0]).toMatch(/element 1 is the record \{"over":"in"\}, the slot takes attrs:\{over:"of"\}\|\{over:"of" own\}/);
});
