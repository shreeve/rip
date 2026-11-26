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
  nodeOfKind(result, 'forof')[2] = null;
  expect(messages(result)).toEqual([
    expect.stringMatching(/^forof node fits no form; closest \("for-of" .*\): element 2 is null, the slot takes object:expr$/),
  ]);
});

test('a node of the wrong kind in a typed slot rejects', () => {
  // A try's third element is a catch handler or a finally block; a
  // call node is neither.
  const result = parse('try a() catch e then b()\n');
  const tryNode = nodeOfKind(result, 'try');
  tryNode[2] = nodeOfKind(result, 'call');
  expect(messages(result)).toEqual([
    expect.stringMatching(/^try node fits no form; closest \("try" body:expr\|block handler:catch\): element 2 is a call node, the slot takes handler:catch$/),
  ]);
});

test('a plumbing list where an expression belongs rejects', () => {
  // The when's conditions list is a real plumbing array with its own
  // NodeStore row.
  const result = parse('switch s\n  when a, b\n    p 1\nx = y\n');
  const conditions = nodeOfKind(result, 'when')[1];
  expect(result.stores.nodeIds.has(conditions)).toBe(true);
  nodeOfKind(result, 'assign')[2] = conditions;
  expect(messages(result)).toEqual([
    expect.stringMatching(/element 2 is an unkinded array, the slot takes value:expr$/),
  ]);
});

test('a part node where an expression belongs rejects', () => {
  const result = parse('try a() catch e then b()\nx = y\n');
  nodeOfKind(result, 'assign')[2] = nodeOfKind(result, 'catch');
  expect(messages(result)).toEqual([
    expect.stringMatching(/^assign node fits no form; closest .*: element 2 is a catch node, the slot takes value:expr$/),
  ]);
  const root = parse('x = y\n');
  nodeOfKind(root, 'assign')[2] = root.sexpr;
  expect(messages(root)).toEqual([expect.stringMatching(/element 2 is a program node, the slot takes value:expr$/)]);
});

test('a role row naming a different slot rejects', () => {
  // A finally block recorded as the handler: the value fits the
  // finalizer slot's type, but the RoleStore row names the wrong slot.
  const result = parse('try\n  a\nfinally\n  b\n');
  const id = result.stores.nodeIds.get(nodeOfKind(result, 'try'));
  result.stores.roles.find((r) => r.nodeId === id && r.role === 'finalizer').role = 'handler';
  expect(messages(result)).toEqual([
    "try node fits no form; closest (\"try\" body:expr|block finalizer:block): role 'handler' sits at element 2, which the form names 'finalizer'",
  ]);
});

test('an executable action value passes where an expression belongs', () => {
  // `(a; b)` is built by the Parenthetical rule's executable action.
  const result = parse('x = (a; b)\n');
  const value = nodeOfKind(result, 'assign')[2];
  expect(value[0]).toBe('block');
  expect(messages(result)).toEqual([]);
});

test('an element past the form arity rejects', () => {
  const result = parse('return 1\n');
  nodeOfKind(result, 'return').push('2');
  expect(messages(result)).toEqual([
    expect.stringMatching(/^return node fits no form; closest \("return" value:expr\): element 2 has no slot \(the form has 2\)$/),
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
  expect(messages({ ...result, sexpr: result.sexpr[1] })).toContain('the root is an assign node, not a program node');
});
