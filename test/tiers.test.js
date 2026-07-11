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
import { compile } from '../src/compile.js';

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

  test('destructuring pattern targets (v1: patterns keep the hoist)', () => {
    expect(js('[a, b] = pair')).toBe('let a, b;\n\n[a, b] = pair;');
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

  test('branch-first names with no nested references are NOT pinnable (evolving reads win)', () => {
    const { pinnables } = compile('if y\n  x = 1\nconsole.log x', { path: 't.rip', face: 'ts' });
    expect(pinnables).toHaveLength(0);
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
