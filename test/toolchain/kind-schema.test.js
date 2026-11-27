// The kind-registry gate: grammar.rip ships a `kinds` registry naming
// every semantic kind, the tree forms it takes (named, typed slots) and
// the side roles its labels may record, and Solar fails generation on
// drift in either direction. The registry-matches-grammar case rides
// generated.test.js (a full Generator construction that must not
// throw); these tests drive each drift shape against the real grammar.
import { describe, test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import parser, { kinds } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { parseSource } from '../../src/compiler.js';
import { validateSexpr } from '../../src/sexpr.js';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';

const withKinds = (kinds) => ({ ...grammar, kinds });
const withKind = (kind, entry) => withKinds({ ...grammar.kinds, [kind]: entry });
const state = grammar.kinds.state;

test('an annotation using an undeclared kind fails generation', () => {
  const { state: _, ...rest } = grammar.kinds;
  expect(() => new Generator(withKinds(rest))).toThrow(/undeclared kind 'state'/);
});

test('a template no form admits fails generation, naming the closest form', () => {
  const renamed = { ...state, forms: ['"state" attrs:{} target:expr init:expr'] };
  expect(() => new Generator(withKind('state', renamed)))
    .toThrow(/kind 'state' has no form for this template — closest is \("state" attrs:\{\} target:expr init:expr\): element 3: expected 'init', got 'value'/);
  // A misfitting template still counts as a use of its kind.
  expect(() => new Generator(withKind('state', renamed))).not.toThrow(/declared kind 'state' is used by no rule/);
});

test('a constant the form does not admit fails generation', () => {
  const head = { ...state, forms: ['"reactive" attrs:{} target:expr value:expr'] };
  expect(() => new Generator(withKind('state', head)))
    .toThrow(/element 0: expected the constant "reactive"/);
});

test('a literal the slot type does not admit fails generation', () => {
  // A bare `class` writes the absent marker for its name.
  const klass = grammar.kinds.class;
  const strict = { forms: klass.forms.map((f) => f.replace('name:name|member|none', 'name:name|member')) };
  expect(() => new Generator(withKind('class', strict)))
    .toThrow(/slot 'name' does not admit \["none",\{\}\]/);
});

test('a slot is a spread only where the form writes `...`', () => {
  for (const [kind, entry] of Object.entries(new Generator(grammar).kindRegistry)) {
    for (const form of entry.forms) {
      for (const slot of form.slots) {
        if (slot.role) expect(slot.spread === true, `${kind} ${slot.role}`).toBe(form.text.includes(`...${slot.role}:`));
      }
    }
  }
});

test('an empty list in a slot that takes no array fails generation', () => {
  const func = grammar.kinds.func;
  const strict = { ...func, forms: ['kind:"->"|"=>" attrs:{} params:expr body:block'] };
  expect(() => new Generator(withKind('func', strict))).toThrow(/slot 'params' does not admit \[\]/);
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
  const extra = { ...state, forms: [...state.forms, '"state" attrs:{} target:expr'] };
  expect(() => new Generator(withKind('state', extra)))
    .toThrow(/kind 'state' form 2 \("state" attrs:\{\} target:expr\) is built by no rule/);
});

test('a declared side role no rule records fails generation', () => {
  const extra = { ...state, side: [...state.side, 'phantom'] };
  expect(() => new Generator(withKind('state', extra)))
    .toThrow(/kind 'state' side role 'phantom' is recorded by no rule/);
});

test('malformed registry entries reject', () => {
  const bad = (entry) => () => new Generator(withKind('state', entry));
  expect(bad(['annotation', 'target'])).toThrow(/kind 'state' must be \{forms, side\?, part\?\}/);
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

// A one-rule grammar under a registry, for the gate's element rules.
const tiny = (action, annotation, kinds) => new Generator({
  start: 'Root',
  grammar: { Root: [['ID ID', action, annotation]] },
  kinds,
});

test('an opaque scaffold with elements fails generation', () => {
  expect(() => tiny('["x", [1]]', 'x: _, _', { x: { forms: ['"x" items:[leaf]'] } }))
    .toThrow(/an opaque scaffold of 1 element\(s\) fills slot 'items'/);
  expect(() => tiny('["x", []]', 'x: _, _', { x: { forms: ['"x" items:[leaf]'] } })).not.toThrow();
});

test('a literal in a transparent scaffold must fit the list element type', () => {
  expect(() => tiny('["x", [null]]', 'x: _, _(items)', { x: { forms: ['"x" items:[leaf]'] } }))
    .toThrow(/slot 'items' holds no null/);
});

test('a scaffold nested in a scaffold fails generation', () => {
  expect(() => tiny('["x", [[1]]]', 'x: _, _(_(items))', { x: { forms: ['"x" items:[[leaf]]'] } }))
    .toThrow(/a scaffold nested in a scaffold fills slot 'items'/);
});

test('a missing constant is named in the misfit', () => {
  expect(() => tiny('[1]', 'x: name', { x: { forms: ['name:leaf "end"'] } }))
    .toThrow(/the constant "end" has no element/);
});

test('expr does not admit a part kind; a slot naming it does', () => {
  const nested = '["x", ["y", 1]]';
  const annotation = 'x: _, inner(y: _, name)';
  const y = { forms: ['"y" name:leaf'], part: true };
  expect(() => tiny(nested, annotation, { x: { forms: ['"x" inner:expr'] }, y }))
    .toThrow(/slot 'inner' does not admit a y node/);
  expect(() => tiny(nested, annotation, { x: { forms: ['"x" inner:y'] }, y })).not.toThrow();
  expect(() => tiny(nested, annotation, { x: { forms: ['"x" inner:y'] }, y: { ...y, part: 'yes' } }))
    .toThrow(/kind 'y' part must be true when present/);
});

test('a repeated form fails generation', () => {
  expect(() => new Generator(withKind('state', { ...state, forms: [...state.forms, ...state.forms] })))
    .toThrow(/kind 'state' form 2 repeats form 1/);
});

test('an attribute record is a template literal the registry types by its exact flags', () => {
  const kinds = (attrs) => ({ x: { forms: [`"x" attrs:${attrs} name:leaf`] } });
  expect(() => tiny('["x", {opt: true}, 1]', 'x: _, _, name', kinds('{opt}'))).not.toThrow();
  expect(() => tiny('["x", {}, 1]', 'x: _, _, name', kinds('{}'))).not.toThrow();
  expect(() => tiny('["x", {opt: true, await: true}, 1]', 'x: _, _, name', kinds('{await opt}'))).not.toThrow();
  expect(() => tiny('["x", {opt: true}, 1]', 'x: _, _, name', kinds('{}')))
    .toThrow(/slot 'attrs' does not admit \{"opt":true\}/);
  expect(() => tiny('["x", {}, 1]', 'x: _, _, name', kinds('{opt}')))
    .toThrow(/slot 'attrs' does not admit \{\}/);
});

test('a braced element other than a record of true flags is not a template', () => {
  expect(() => tiny('["x", {opt: false}, 1]', 'x: _, _, name', { x: { forms: ['"x" attrs:{opt} name:leaf'] } }))
    .toThrow(/only flat array construction templates can be annotated/);
  expect(() => tiny('["x", {n: 1}, 1]', 'x: _, _, name', { x: { forms: ['"x" attrs:{n} name:leaf'] } }))
    .toThrow(/only flat array construction templates can be annotated/);
  expect(() => tiny('["x", {opt: true, opt: true}, 1]', 'x: _, _, name', { x: { forms: ['"x" attrs:{opt} name:leaf'] } }))
    .toThrow(/only flat array construction templates can be annotated/);
});

test('malformed attribute-record types reject', () => {
  const bad = (type) => () => tiny('["x", 1]', 'x: _, name', { x: { forms: [`"x" name:${type}`] } });
  expect(bad('{a a}')).toThrow(/repeats a key/);
  expect(bad('{a-b}')).toThrow(/malformed attribute record/);
  expect(bad('{a')).toThrow(/unbalanced/);
});

test('an attribute record may hold words, typed by the values the registry lists', () => {
  const kinds = (attrs) => ({ x: { forms: [`"x" attrs:${attrs} name:leaf`] } });
  expect(() => tiny('["x", {over: "in"}, 1]', 'x: _, _, name', kinds('{over:"in"|"of"}'))).not.toThrow();
  expect(() => tiny('["x", {over: "as"}, 1]', 'x: _, _, name', kinds('{over:"in"|"of"}')))
    .toThrow(/slot 'attrs' does not admit \{"over":"as"\}/);
  expect(() => tiny('["x", {over: "in"}, 1]', 'x: _, _, name', kinds('{over}')))
    .toThrow(/slot 'attrs' does not admit \{"over":"in"\}/);
});

test('a presence flag in an attribute record is the key when present and nothing when absent', () => {
  const g = new Generator({
    start: 'Root',
    grammar: { Root: [['(OWN[own])? ID[n]', '["x", {over: "of", own: @own?}, @n]', 'x: _, _, name']] },
    kinds: { x: { forms: ['"x" attrs:{over:"of"}|{over:"of" own} name:leaf'] } },
  });
  expect(g.ruleActions).toContain('{over: "of"}');
  expect(g.ruleActions).toContain('{over: "of", own: true}');
});

test('the absent marker fits only a slot that admits none; unnamed, it records no role', () => {
  expect(() => tiny('["x", {}, ["none", {}]]', 'x: _, _, name', { x: { forms: ['"x" attrs:{} name:leaf|none'] } })).not.toThrow();
  expect(() => tiny('["x", {}, ["none", {}]]', 'x: _, _, name', { x: { forms: ['"x" attrs:{} name:leaf'] } }))
    .toThrow(/slot 'name' does not admit \["none",\{\}\]/);
  const unnamed = tiny('["x", {}, ["none", {}]]', 'x: _, _, _', { x: { forms: ['"x" attrs:{} name:leaf|none'] } });
  expect(Object.values(unnamed.semantics)[0].roles).toEqual([]);
});

test('a grammar without a registry is not gated', () => {
  const { kinds, ...ungated } = grammar;
  expect(() => new Generator(ungated)).not.toThrow();
});

test('a leaves entry that is not a terminal fails generation', () => {
  expect(() => new Generator({ ...grammar, leaves: { ...grammar.leaves, Expression: 'name' } }))
    .toThrow(/leaves: 'Expression' is not a terminal of the grammar/);
});

test('a leaf kind missing from the registry fails generation', () => {
  // `statement` is a leaf kind no other kind's slot names, so the
  // registry parses and the leaf check is the one that fails.
  const { statement: _, ...rest } = grammar.kinds;
  expect(() => new Generator(withKinds(rest))).toThrow(/leaf kind 'statement' is not in the registry/);
});

test('a leaf kind whose form is not a leaf shape fails generation', () => {
  expect(() => new Generator(withKind('num', { forms: ['"num" attrs:{} raw:expr'] })))
    .toThrow(/leaf kind 'num' form \("num" attrs:\{\} raw:expr\) is not "num" attrs:\{\} raw:<leaf or words>/);
  expect(() => new Generator(withKind('num', { forms: ['"num" attrs:{opt} raw:leaf'] })))
    .toThrow(/leaf kind 'num' form/);
});

// The s-expression contract: every tree the parser builds for a real
// program — each corpus file, tracked package module and language-suite
// row — fits the kind registry (grammar.rip `kinds`, shipped as
// `kinds` in src/parser.js), and every declared form is one some real
// tree takes. The negative cases pin the validator's rejections: a
// value of the wrong type, a part kind or plumbing list where an
// expression belongs, a role row naming the wrong slot, an arity or
// constant mismatch, an unknown kind, and a root that is not a program.
describe('the tree registry over every tree', () => {
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
});
