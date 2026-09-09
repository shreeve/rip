// The evolving-let tiers — the declare-in-place decision procedure
// pinned as behavior. Tier 0: annotated (inline at the declaring
// write). Tier 1: straight-line locals declare at their first write.
// Tier 2: branch-confined writes keep the hoist (evolving reads are
// the right checking). Tier 3: still-hoisted nested-referenced names
// report as pinnables and accept probe-supplied pins. The capture
// rule is defs-only: a hoisted `def` is the one construct callable
// before its own statement, so any name its body touches keeps the
// hoist — every other early-execution vector is closed by the
// execution-order first-occurrence rule.
import { test, expect, describe } from 'bun:test';
import { compile } from '../../src/compile.js';

const js = (src, opts = {}) => compile(src, { path: 't.rip', runtimeDelivery: 'none', ...opts }).code;
const ts = (src, opts = {}) => js(src, { face: 'ts', ...opts });

describe('Tier 1: straight-line locals declare at the first write', () => {
  test('plain top-level assign', () => {
    expect(js('x = 1')).toBe('let x = 1;');
  });

  test('closures defined AFTER the first write do not block — even writers (relaxed rule)', () => {
    expect(js('count = 0\nbump = ->\n  count = count + 1')).toBe(
      'let count = 0;\nlet bump = function() {\n  return (count = count + 1);\n};',
    );
  });

  test('null-first keeps TS evolving via the native carve-out but still declares in place', () => {
    expect(js('x = null\nx = 5')).toBe('let x = null;\nx = 5;');
  });
});

describe('what stays hoisted — each early-execution/expression vector', () => {
  test('def-touched: the hoisted-def early-call counterexample', () => {
    // f() runs before total = 5; a moved declaration would turn the
    // legal undefined read into a TDZ ReferenceError.
    const code = js('f()\ntotal = 5\ndef f()\n  console.log total');
    expect(code).toStartWith('let total;');
    expect(code).toContain('\ntotal = 5;');
  });

  test('branch-first write (Tier 2): block-scoped let would not reach the outer read', () => {
    expect(js('if something\n  x = 10\nconsole.log x')).toBe(
      'let x;\n\nif (something) {\n  x = 10;\n}\nconsole.log(x);',
    );
  });

  test('read textually before the write', () => {
    expect(js('console.log x\nx = 5')).toBe('let x;\n\nconsole.log(x);\nx = 5;');
  });

  test('closure defined BEFORE the first write hoists the CAPTURED name (its body read is textually earlier) — the closure binding itself still declares in place', () => {
    const code = js('f = -> x\nx = 5');
    expect(code).toStartWith('let x;');
    expect(code).toContain('let f = function()');
    expect(code).toContain('\nx = 5;');
  });

  test('self-referential first write reads before it writes', () => {
    expect(js('x = x + 1')).toBe('let x;\n\nx = x + 1;');
  });

  test('compound first write reads its target', () => {
    expect(js('x += 1')).toBe('let x;\n\nx += 1;');
  });

  test('a pattern whose every name is a fresh straight-line local declares in place, as one statement', () => {
    expect(js('[a, b] = pair')).toBe('let [a, b] = pair;');
    expect(js('{ host, port: portNumber } = config')).toBe('let {host, port: portNumber} = config;');
    expect(js('{ mode = "manual", ...rest } = meta')).toBe('let {mode = "manual", ...rest} = meta;');
    expect(js('{ meta: { retries } } = config')).toBe('let {meta: {retries}} = config;');
  });

  test('a pattern declares all of its names or none — one name that is not a fresh local keeps the whole pattern hoisted', () => {
    // `a` is a parameter: `let {a, b}` would shadow it.
    expect(js('f = (a) ->\n  { a, b } = source()\n  a + b')).toContain('  let b;\n  ({a, b} = source());');
    // `c` is read before the pattern writes it.
    expect(js('console.log c\n{ c, d } = source()')).toStartWith('let c, d;');
    // A default reads a sibling bound AFTER it — a `let` pattern would throw there.
    expect(js('{ b = a, a } = source()')).toStartWith('let a, b;');
    // A def body reads one name.
    expect(js('{ e, f } = source()\ndef g()\n  e')).toStartWith('let e, f;');
  });

  test('a pattern no `let` can spell keeps the hoist: a member element, a middle rest', () => {
    expect(js('{ p: obj.p, q } = source()')).toBe('let q;\n\n({p: obj.p, q} = source());');
    expect(js('[h, ...mid, t] = src')).toStartWith('let h, mid, t;');
  });

  test('a pattern in an expression or branch position keeps the hoist like a plain name', () => {
    expect(js('f = ->\n  { r } = source()')).toContain('  let r;\n  return (({r} = source()));');
    expect(js('if ok\n  { x, y } = source()\nconsole.log x')).toStartWith('let x, y;');
  });

  test('an annotated write to a name a pattern declares is rejected in both faces — TypeScript annotates a pattern only whole, so the annotation would manifest nowhere', () => {
    const src = '{ id, rows } = parse(text)\nrows: Row[] = rows.map(fix)';
    const message = /'rows' is declared by a destructuring pattern, which cannot carry this annotation/;
    expect(() => js(src)).toThrow(message);
    expect(() => ts(src)).toThrow(message);
    // A bare typed forward is the same annotation in its other spelling.
    const forward = '{ id, rows } = parse(text)\nrows: Row[]\nrows = rows.map(fix)';
    expect(() => js(forward)).toThrow(message);
    expect(() => ts(forward)).toThrow(message);
    // The canonical spelling: rename the element, declare the typed name from it.
    expect(ts('{ id, rows: raw } = parse(text)\nrows: Row[] = raw.map(fix)')).toContain('let {id, rows: raw} = parse(text);\nlet rows: Row[] = raw.map(fix);');
    // A pattern hoisted for another reason is a plain assignment, and the
    // hoist line carries the annotation as before.
    expect(ts('console.log rows\n{ id, rows } = parse(text)\nrows: Row[] = rows.map(fix)')).toContain('let id, rows: Row[];');
  });

  test('a pattern declaration is the same bytes in both faces (strip parity)', () => {
    const src = '{ host, port: portNumber } = config\nconsole.log host';
    expect(js(src)).toBe(ts(src).replace(/\nexport \{\};\n?$/, ''));
  });

  test('function-body tail is implicit-return expression position — never `return (let …)`', () => {
    expect(js('f = ->\n  r = 5')).toBe('let f = function() {\n  let r;\n  return (r = 5);\n};');
  });
});

describe('Tier 0: annotations ride the declaring write inline (TS face only)', () => {
  test('annotated assign — typed/stripped twins ship identical JS', () => {
    expect(ts('typed: number = 5')).toContain('let typed: number = 5;');
    expect(js('typed: number = 5')).toBe(js('typed = 5'));
  });

  test('bare typed forward re-homes inline at the declaring write', () => {
    expect(ts('r: number\nr = 5')).toContain('let r: number = 5;');
    expect(js('r: number\nr = 5')).toBe(js('r = 5'));
  });

  test('use-before-write forward keeps the hoist-line manifestation, `!` by default', () => {
    expect(ts('y: number\nconsole.log y\ny = 5')).toContain('let y!: number;');
  });

  test('rip.strict drops the `!` so use-before-assign is checked (presentation-only)', () => {
    expect(ts('y: number\nconsole.log y\ny = 5', { strict: true })).toContain('let y: number;');
    expect(js('y: number\nconsole.log y\ny = 5', { strict: true })).toBe(js('y: number\nconsole.log y\ny = 5'));
  });
});

describe('Tier 3: pinnables and pins', () => {
  const SRC = "items = ['a', 'b']\ndef use()\n  items.join('-')";

  test('a def-referenced hoisted name reports as pinnable with a value-hash key', () => {
    const { pinnables } = compile(SRC, { path: 't.rip', face: 'ts' });
    expect(pinnables).toHaveLength(1);
    expect(pinnables[0].name).toBe('items');
    expect(pinnables[0].key).toMatch(/^items@[a-z0-9]+$/);
  });

  test('the key is stable across offset shifts and changes with the defining expression', () => {
    const key = (src) => compile(src, { path: 't.rip', face: 'ts' }).pinnables[0].key;
    expect(key('# shifted\n' + SRC)).toBe(key(SRC));
    expect(key(SRC.replace("['a', 'b']", "['a', 'b', 'c']"))).not.toBe(key(SRC));
  });

  test('a pin annotates the hoist line in the TS face only, `!` strict-gated', () => {
    const { pinnables } = compile(SRC, { path: 't.rip', face: 'ts' });
    const pins = new Map([[pinnables[0].key, 'string[]']]);
    expect(ts(SRC, { pins })).toContain('let items!: string[];');
    expect(ts(SRC, { pins, strict: true })).toContain('let items: string[];');
    expect(js(SRC, { pins })).toStartWith('let items;');
  });

  test('under rip.strict a pinned first write is severed from the pin as a contextual type', () => {
    const src = 'use = -> later(1, 2)\nlater = (a, b) -> a + b';
    const { pinnables } = compile(src, { path: 't.rip', face: 'ts' });
    const pins = new Map([[pinnables[0].key, '(a?: any, b?: any) => any']]);
    expect(ts(src, { pins, strict: true })).toContain('later = (function(a?, b?) {\n  return (a + b);\n}) satisfies unknown;');
    expect(ts(src, { pins })).toContain('later = function(a?, b?) {\n  return (a + b);\n};');
    expect(ts(src, { strict: true })).toContain('later = function(a?, b?) {\n  return (a + b);\n};');
    expect(js(src, { pins, strict: true })).toBe(js(src));
  });

  test('branch-first names with no nested references are NOT pinnable (evolving reads win)', () => {
    const { pinnables } = compile('if y\n  x = 1\nconsole.log x', { path: 't.rip', face: 'ts' });
    expect(pinnables).toHaveLength(0);
  });
});

describe('binding inventory', () => {
  test('the all-scope inventory covers every declaring shape', () => {
    const src = [
      'export sent = 1',
      'fixed =! 2',
      'typed: number = 3',
      '[left, right] = [4, 5]',
      'use = (param, {nested}) -> param + nested',
    ].join('\n');
    expect(new Set(compile(src).bindingNames)).toEqual(new Set([
      'sent', 'fixed', 'typed', 'left', 'right', 'use', 'param', 'nested',
    ]));
  });
});

describe('runtime semantics are unchanged', () => {
  test('the def counterexample still prints undefined, not a TDZ throw', () => {
    const code = js('f()\ntotal = 5\ndef f()\n  seen = total\n  globalThis.__tier_probe = seen');
    new Function(code)();
    expect(globalThis.__tier_probe).toBeUndefined();
    delete globalThis.__tier_probe;
  });

  test('declare-in-place closures still share the binding', () => {
    const code = js('count = 0\nbump = ->\n  count = count + 1\nbump()\nbump()\nglobalThis.__tier_count = count');
    new Function(code)();
    expect(globalThis.__tier_count).toBe(2);
    delete globalThis.__tier_count;
  });
});
