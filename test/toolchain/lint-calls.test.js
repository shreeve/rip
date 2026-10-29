// `rip.lint.calls` — every call with arguments is spelled with parentheses,
// and every object argument with braces. The grammar has one call rule for
// every spelling, so the form is read from the token tape: the implicit-call
// pass mints a zero-width CALL_START with `generated: true` at the first
// argument, and the implicit-object pass mints a generated `{` at the first
// pair. The rule reads tokens and the node spans `compile()` returns, never
// the generated code.
//
// Two shapes stay implicit: a multi-line trailing block (`run ->` with its
// body below), and everything inside a render tree except a handler body.
//
// Fixtures are inline strings: package-rip-style.test.js lints every .rip
// file under packages/, so a fixture file there would be audited as
// authored Rip.
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../../src/compiler.js';
import { readProjectConfig } from '../../src/config.js';
import { applyEdits, lintFindingsOf, lintRulesOf, parentsOf } from '../../src/lint.js';

const RULES = lintRulesOf({ calls: 'explicit' });

function findings(source, rules = RULES) {
  const r = compile(source, { face: 'js', path: 'lint.rip' });
  return lintFindingsOf(r.tokens, r.stores, source, rules);
}

// The fixed text, which must compile to the same JavaScript as the original:
// a spelling change that moves the program is not a fix.
function fixed(source) {
  const out = applyEdits(source, findings(source).flatMap((f) => f.edits ?? []));
  expect(compile(out, { face: 'js', path: 'lint.rip' }).code).toBe(compile(source, { face: 'js', path: 'lint.rip' }).code);
  return out;
}

const FLAGGED = [
  ['an implicit call', 'f a, b\n', 'f(a, b)\n'],
  ['an implicit call on a right-hand side', 'x = f a\n', 'x = f(a)\n'],
  ['nested implicit calls in an array', 'xs = [f a, g b]\n', 'xs = [f(a, g(b))]\n'],
  ['an implicit call in a condition', 'if f a\n  g()\n', 'if f(a)\n  g()\n'],
  ['an implicit call ahead of a chain', 'f a\n.then (r) -> r\n', 'f(a)\n.then((r) -> r)\n'],
  ['a single parenthesized argument', 'f (a)\n', 'f(a)\n'],
  ['a parenthesized first argument', 'f (a), b\n', 'f((a), b)\n'],
  ['a construction', 'x = new X a\n', 'x = new X(a)\n'],
  ['an optional call', 'f? x\n', 'f?(x)\n'],
  ['an optional call whose argument has a logical operator', 'f? a or b\n', 'f?(a or b)\n'],
  ['a dammit call', 'x = load! id\n', 'x = load!(id)\n'],
  ['a maybe-dammit call', 'x = load?! id\n', 'x = load?!(id)\n'],
  ['a one-line function argument', 'doubled = items.map (x) -> x * 2\n', 'doubled = items.map((x) -> x * 2)\n'],
  ['a function argument that is not last', 'f a, (-> x), b\n', 'f(a, -> x, b)\n'],
  ['a parenthesized one-line function ahead of more arguments', 'x = lines.reduce ((sum, line) -> sum + line.price), 0\n', 'x = lines.reduce((sum, line) -> sum + line.price, 0)\n'],
  ['a one-line triple-quoted string', 'f """x"""\n', 'f("""x""")\n'],
  ['keyword arguments', 'f key: v\n', 'f({ key: v })\n'],
  ['keyword arguments in parentheses', 'f(key: v)\n', 'f({ key: v })\n'],
  ['keyword arguments after a positional one', 'f w, key: v\n', 'f(w, { key: v })\n'],
  ['keyword arguments whose value is an implicit call', 'f key: g x\n', 'f({ key: g(x) })\n'],
  ['keyword arguments with a logical operator in the value', 'x = f key: v or d\n', 'x = f({ key: v or d })\n'],
  ['keyword arguments in a condition', 'if p and not P.with! partnerId: 1, providerId: 2\n  go()\n', 'if p and not P.with!({ partnerId: 1, providerId: 2 })\n  go()\n'],
  ['an implicit call inside a trailing keyword block', "api = http.create\n  prefixUrl: '/api'\n  hooks: makeHooks x\n", "api = http.create\n  prefixUrl: '/api'\n  hooks: makeHooks(x)\n"],
  ['an indented keyword block in explicit parentheses', 'f(\n  key: 1\n  other: 2\n)\n', 'f({\n  key: 1\n  other: 2\n})\n'],
  ['keyword arguments ahead of an exempt trailing block', "test 'x', timeout: 5, ->\n  go()\n", "test 'x', { timeout: 5 }, ->\n  go()\n"],
  ['a render handler body', 'C = component\n  render\n    button @click: (-> go 1), "Go"\n', 'C = component\n  render\n    button @click: (-> go(1)), "Go"\n'],
  ['a super call', 'class A extends B\n  constructor: (a) ->\n    super a\n', 'class A extends B\n  constructor: (a) ->\n    super(a)\n'],
  ['a call the author wrapped in grouping parens, as an argument', "x = dig((body! res), 'eid')\n", "x = dig(body!(res), 'eid')\n"],
  ['a call the author wrapped in grouping parens, ahead of more arguments', "eq (seenBy! x, w.tag), ['A']\n", "eq(seenBy!(x, w.tag), ['A'])\n"],
  ['a keyword call the author wrapped in grouping parens, ahead of an operator', 'y = (P.with! slug: s) or d\n', 'y = P.with!({ slug: s }) or d\n'],
  ['a call the author wrapped in grouping parens, ahead of a chain', 'x = (f a).b\n', 'x = f(a).b\n'],
  ['a sole parenthesized argument holding an implicit call', "answer = body! (client().get! '/x')\n", "answer = body!(client().get!('/x'))\n"],
  ['an implicit call whose last argument is an explicit call holding a heredoc', "n = count db.sql!(\"\"\"\n  SELECT 1\n\"\"\")\n", "n = count(db.sql!(\"\"\"\n  SELECT 1\n\"\"\"))\n"],
  ['an indented keyword block after a positional argument in explicit parentheses, closing on its last line', "run = launch(['rip', x],\n  cwd: cwd\n  stdout: 'ignore')\n", "run = launch(['rip', x], {\n  cwd: cwd\n  stdout: 'ignore'\n})\n"],
];

const KEPT = [
  ['an explicit call', 'f(a, b)\n'],
  ['an explicit call with a braced object', 'f({ key: v })\n'],
  ['a bare dammit', 'x = load!\n'],
  ['a dammit with parentheses', 'x = load!(id)\n'],
  ['an optional call with parentheses', 'f?(x)\n'],
  ['a multi-line trailing block', 'run ->\n  x\n'],
  ['a multi-line trailing block after arguments', "describe 'math', ->\n  test 'adds', ->\n    expect(1 + 1).toBe(2)\n"],
  ['a dammit call with a multi-line trailing block', 'db.transaction! ->\n  save!(a)\n'],
  ['a chained call with a multi-line trailing block', 'f(a).then (r) ->\n  r\n'],
  ['a render tree', 'C = component\n  render\n    div "hi"\n    p class: \'x\', "yo"\n'],
  ['a render tree under an if', "C = component\n  @on: boolean\n  render\n    div\n      if on\n        p class: 'x', 'yes'\n"],
  ['a render tree under a loop', "C = component\n  @xs: string[]\n  render\n    ul\n      for x in xs\n        li class: 'x', x\n"],
  ['a render tree under a switch', "C = component\n  @name: string\n  render\n    svg\n      switch name\n        when 'a'\n          path d: 'x'\n"],
  ['an object that is not an argument', 'x =\n  a: 1\n  b: 2\n'],
  ['grouping parens around an explicit call', 'x = (f(a)) or b\n'],
  ['a trailing indented keyword block', 'f\n  key: 1\n  other: 2\n'],
  ['a trailing indented keyword block under a dammit, inside a function', 'go = ->\n  makeUser!\n    email: e\n    role: r\n'],
  ['a trailing indented keyword block as a pair value', "s =\n  config: source\n    fetch: -> load!\n    staleTime: '5 min'\n"],
  ['positional arguments ahead of a trailing indented keyword block', "go = ->\n  res = fetch! url,\n    method: 'POST'\n    body: b\n"],
  ['a parenthesized function ahead of a trailing indented keyword block', 'save = createMutation (-> go()),\n  onSuccess: (u) -> done(u)\n  onError: (e) -> fail(e)\n'],
  ['a trailing indented keyword block holding one pair', "s =\n  orders: source\n    fetch: -> Order.parse(load!)\n"],
  ['a trailing heredoc', "rows = sql! \"\"\"\n  SELECT 1\n\"\"\"\n"],
  ['a trailing heredoc with interpolation', "rows = sql! \"\"\"\n  SELECT #{a}\n\"\"\"\n"],
  ['a trailing single-quoted heredoc', "throw Error.new '''\n  bad\n'''\n"],
  ['a trailing heredoc after positional arguments', "rows = query! db, \"\"\"\n  SELECT 1\n\"\"\"\n"],
  ['an implicit call whose last argument is an implicit call ending in a heredoc', "n = count db.sql! \"\"\"\n  SELECT 1\n\"\"\"\n"],
  ['an implicit call whose last argument is an implicit call ending in a function body', 'm = wrap make ->\n  go()\n'],
  ['an implicit call whose last argument is an implicit call ending in a keyword block', 'j = outer inner x,\n  a: 1\n  b: 2\n'],
  ['a trailing indented keyword block with nested values', "export api = http.create\n  prefixUrl: '/api'\n  retry: 0\n  hooks:\n    afterResponse: [authGuard]\n"],
];

describe('rip.lint.calls — the spellings it rewrites', () => {
  for (const [name, before, after] of FLAGGED) {
    test(name, () => {
      expect(findings(before).length).toBeGreaterThan(0);
      expect(fixed(before)).toBe(after);
      expect(findings(after)).toEqual([]);
    });
  }
});

describe('rip.lint.calls — the spellings it keeps', () => {
  for (const [name, src] of KEPT) {
    test(`${name} is clean`, () => {
      expect(findings(src)).toEqual([]);
    });
  }
});

describe('rip.lint.calls — findings', () => {
  test('a finding stands on the call, names the rule, and names the fixed form', () => {
    const src = 'x = f a, b\n';
    const [f] = findings(src);
    expect(f.rule).toBe('calls');
    expect(src.slice(f.start, f.end)).toBe('f a, b');
    expect(f.message).toBe('implicit call — write `f(a, b)`');
  });

  test('an explicit call with an unbraced object is named for the object', () => {
    expect(findings('f(key: v)\n').map((f) => f.message)).toEqual(['keyword arguments without braces — write `f({ key: v })`']);
  });

  test('nested calls each report, and each message shows its own call fixed', () => {
    expect(findings('xs = [f a, g b]\n').map((f) => f.message)).toEqual(['implicit call — write `f(a, g(b))`', 'implicit call — write `g(b)`']);
  });

  test('a fix that drops grouping parens stands on them, and its message shows the text it replaces', () => {
    const src = 'x = (client.parentId and (Partner.find! client.parentId)?.providerId)\n';
    const [f] = findings(src);
    expect(src.slice(f.start, f.end)).toBe('(Partner.find! client.parentId)');
    expect(f.message).toBe('implicit call — write `Partner.find!(client.parentId)` in place of `(Partner.find! client.parentId)`');
    expect(fixed(src)).toBe('x = (client.parentId and Partner.find!(client.parentId)?.providerId)\n');
  });

  test('a finding over several lines stands on its first line, and its message shows both ends of the fix', () => {
    const src = 'f(\n  key: 1\n  other: 2\n)\n';
    const [f] = findings(src);
    expect(src.slice(f.start, f.end)).toBe('f(');
    expect(f.message).toBe('keyword arguments without braces — write `f({` … `})`');
  });
});

describe('rip.lint — configuration', () => {
  test('a package without the key reads lint null, and null rules report nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-lint-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ rip: { strict: true } }));
    const cfg = readProjectConfig(dir);
    expect(cfg.strict).toBe(true);
    expect(cfg.lint).toBeNull();
    expect(lintRulesOf(cfg.lint)).toBeNull();
    expect(findings('f a, b\n', null)).toEqual([]);
  });

  test('the key is read as written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-lint-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ rip: { lint: { calls: 'explicit' } } }));
    expect(readProjectConfig(dir).lint).toEqual({ calls: 'explicit' });
  });

  test('a rule the block leaves out is off', () => {
    expect(lintRulesOf({})).toEqual({ calls: null, construction: null, await: null, dammit: null });
    expect(findings('f a\n', lintRulesOf({}))).toEqual([]);
  });

  test('a malformed block rejects, naming the key', () => {
    expect(() => lintRulesOf({ cals: true })).toThrow('rip.lint: unknown rule `cals`');
    expect(() => lintRulesOf({ calls: true })).toThrow('rip.lint.calls: expected "explicit"');
    expect(() => lintRulesOf({ calls: 'implicit' })).toThrow('rip.lint.calls: expected "explicit"');
    expect(() => lintRulesOf([])).toThrow('rip.lint: expected an object');
  });
});

describe('the parent index the rule walks', () => {
  test('agrees with every role row that names an annotated child', () => {
    const src = 'if provider and not P.with! partnerId: partner.id, providerId: 2\n  xs = [f key: v, g(1)]\n  run a, (r) ->\n    r.then (q) -> q\n';
    const r = compile(src, { face: 'js', path: 'lint.rip' });
    const parents = parentsOf(r.stores);
    let checked = 0;
    for (const row of r.stores.roles) {
      if (row.childNodeId == null || r.stores.node(row.childNodeId).semanticKind === null) continue;
      expect(parents.get(row.childNodeId)).toBe(row.nodeId);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
