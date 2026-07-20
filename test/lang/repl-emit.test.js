// The repl:true emit option — off by default with ZERO effect when
// off (the parser-regeneration and corpus gates hold that byte-for-
// byte). When on: (a) the final top-level EXPRESSION statement lands
// in a result slot MINTED against the used-name registry (a user may
// legally bind any fixed name), reported as result.replResultName;
// (b) top-level static imports lower to awaited dynamic imports so
// the program is evaluable inside an async function body.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';

const repl = (src, opts = {}) => compile(src, { runtimeDelivery: 'none', repl: true, ...opts });

describe('result capture: the final top-level expression statement', () => {
  test('a bare expression captures into the minted slot', () => {
    const r = repl('1 + 2');
    expect(r.replResultName).toBe('__result');
    expect(r.code).toBe('const __result = 1 + 2;');
  });

  test('an expression after statements captures; earlier lines are untouched', () => {
    const r = repl('x = 5\nx * 2');
    expect(r.code).toBe('let x = 5;\nconst __result = x * 2;');
    expect(r.replResultName).toBe('__result');
  });

  test('the slot is MINTED: a user binding __result pushes the slot off it', () => {
    const r = repl('__result = 1\n__result + 1');
    expect(r.replResultName).toBe('__result_');
    expect(r.code).toContain('const __result_ = __result + 1;');
  });

  test('a seeded ambient __result pushes the slot off it too', () => {
    const r = repl('1 + 2', { ambientBindings: [{ name: '__result', kind: 'plain' }] });
    expect(r.replResultName).toBe('__result_');
    expect(r.code).toBe('const __result_ = 1 + 2;');
  });

  test('statement-last emits no capture', () => {
    const r = repl('if x\n  1');
    expect(r.replResultName).toBe(null);
    expect(r.code).not.toContain('__result');
  });

  test('declaration-last emits no capture', () => {
    const r = repl('x := 5');
    expect(r.replResultName).toBe(null);
    expect(r.code).toBe('const x = __state(5);');
  });

  test('assignment-last and update-last emit no capture', () => {
    expect(repl('x = 5').replResultName).toBe(null);
    expect(repl('x = 1\nx += 5').replResultName).toBe(null);
    expect(repl('x = 1\nx++').replResultName).toBe(null);
  });

  test('a final statement-position comprehension captures (its value is the program result)', () => {
    const r = repl('x * 2 for x in [1, 2]');
    expect(r.replResultName).toBe('__result');
    expect(r.code).toStartWith('const __result = ');
  });

  test('a call expression captures', () => {
    const r = repl('console.log 1');
    expect(r.code).toBe('const __result = console.log(1);');
  });
});

describe('repl + ambientBindings together (the REPL combination)', () => {
  test('a seeded state read captures with signal access', () => {
    const r = repl('x * 2', { ambientBindings: [{ name: 'x', kind: 'state' }] });
    expect(r.code).toBe('const __result = x.value * 2;');
    expect(r.replResultName).toBe('__result');
  });

  test('a seeded state write stays uncaptured and unwraps', () => {
    const r = repl('x = 3', { ambientBindings: [{ name: 'x', kind: 'state' }] });
    expect(r.code).toBe('x.value = 3;');
    expect(r.replResultName).toBe(null);
  });
});

describe('static imports lower to awaited dynamic imports', () => {
  test('named specifiers destructure the namespace', () => {
    const r = repl('import { a, b as c } from "./m.js"');
    expect(r.code).toContain("const { a, b: c } = await import('./m.js');");
  });

  test('a default import destructures default', () => {
    const r = repl('import d from "./m.js"');
    expect(r.code).toContain("const { default: d } = await import('./m.js');");
  });

  test('a namespace import binds the module object whole', () => {
    const r = repl('import * as ns from "./m.js"');
    expect(r.code).toContain("const ns = await import('./m.js');");
  });

  test('a side-effect import awaits bare', () => {
    const r = repl('import "./side.js"');
    expect(r.code).toContain("await import('./side.js');");
    expect(r.code).not.toContain('const');
  });

  test('default + named share one destructure', () => {
    const r = repl('import d, { a } from "./m.js"');
    expect(r.code).toContain("const { default: d, a } = await import('./m.js');");
  });

  test('default + namespace bind through the namespace', () => {
    const r = repl('import d, * as ns from "./m.js"');
    expect(r.code).toContain("const ns = await import('./m.js'), { default: d } = ns;");
  });

  test('lowered bindings report kind import in the inventory', () => {
    const r = repl('import d, * as ns from "./m.js"\nimport { a } from "./n.js"');
    expect(Object.fromEntries(r.bindings.map(({ name, kind }) => [name, kind])))
      .toEqual({ d: 'import', ns: 'import', a: 'import' });
  });

  test('the lowered specifier span is recorded for splicing', () => {
    const r = repl('import { a } from "./m.js"');
    expect(r.imports.length).toBe(1);
    const { start, end, specifier } = r.imports[0];
    expect(r.code.slice(start, end)).toBe("'./m.js'");
    expect(specifier).toBe("'./m.js'");
  });

  test('an import above a captured expression keeps both behaviors', () => {
    const r = repl('import { a } from "./m.js"\na(1)');
    expect(r.code).toContain("const { a } = await import('./m.js');");
    expect(r.code).toContain('const __result = a(1);');
  });
});

describe('off by default: zero effect', () => {
  test('no capture, no lowering, no reported slot', () => {
    const r = compile('import { a } from "./m.js"\n1 + 2', { runtimeDelivery: 'none' });
    expect(r.replResultName).toBe(null);
    expect(r.code).toContain("import { a } from './m.js';");
    expect(r.code).toContain('1 + 2;');
    expect(r.code).not.toContain('__result');
  });
});
