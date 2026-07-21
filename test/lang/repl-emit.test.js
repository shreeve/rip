// The repl:true emit option — off by default with ZERO effect when
// off (the parser-regeneration and corpus gates hold that byte-for-
// byte). When on: (a) the final top-level EXPRESSION statement lands
// in a result slot MINTED against the used-name registry (a user may
// legally bind any fixed name), reported as result.replResultName;
// (b) top-level static imports lower to awaited dynamic imports so
// the program is evaluable inside an async function body.
import { describe, test, expect } from 'bun:test';
import { compile, CompileError } from '../../src/compile.js';

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
    expect(repl('class Foo').replResultName).toBe(null);
    expect(repl('def f(n)\n  n').replResultName).toBe(null);
  });

  test('declaration-last echoes the bound value, reactive containers unwrapped', () => {
    expect(repl('x := 5').code).toBe('const x = __state(5);\nconst __result = x.value;');
    expect(repl('a := 1\nb ~= a * 2').code)
      .toEndWith('const b = __computed(() => (a.value * 2));\nconst __result = b.value;');
    expect(repl('k =! 7').code).toBe('const k = 7;\nconst __result = k;');
    // A bound effect echoes its dispose handle; a bare one binds
    // nothing and echoes nothing.
    expect(repl('a := 1\nh ~> a').code).toEndWith('\nconst __result = h;');
    expect(repl('a := 1\n~> a').replResultName).toBe(null);
  });

  test('assignment-last and update-last capture their expression value', () => {
    // The tail keeps its hoist-line declaration (a `let` is invalid
    // in the capture's expression position — the function-tail rule).
    expect(repl('x = 5').code).toBe('let x;\n\nconst __result = x = 5;');
    expect(repl('x = 1\nx += 5').code).toBe('let x = 1;\nconst __result = x += 5;');
    expect(repl('x = 1\nx++').code).toBe('let x = 1;\nconst __result = x++;');
  });

  test('a destructuring assignment echoes the full RHS value', () => {
    expect(repl('[a, b] = [1, 2]').code).toBe('let a, b;\n\nconst __result = [a, b] = [1, 2];');
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

  test('a seeded state write captures its value and unwraps the container', () => {
    const r = repl('x = 3', { ambientBindings: [{ name: 'x', kind: 'state' }] });
    expect(r.code).toBe('const __result = x.value = 3;');
    expect(r.replResultName).toBe('__result');
  });
});

describe('static imports lower to awaited dynamic imports through the minted resolver', () => {
  test('named specifiers destructure the namespace', () => {
    const r = repl('import { a, b as c } from "./m.js"');
    expect(r.code).toContain("const { a, b: c } = await import(__resolveImport('./m.js'));");
    expect(r.replImportResolver).toBe('__resolveImport');
  });

  test('a default import destructures default', () => {
    const r = repl('import d from "./m.js"');
    expect(r.code).toContain("const { default: d } = await import(__resolveImport('./m.js'));");
  });

  test('a namespace import binds the module object whole', () => {
    const r = repl('import * as ns from "./m.js"');
    expect(r.code).toContain("const ns = await import(__resolveImport('./m.js'));");
  });

  test('a side-effect import awaits bare', () => {
    const r = repl('import "./side.js"');
    expect(r.code).toContain("await import(__resolveImport('./side.js'));");
    expect(r.code).not.toContain('const {');
  });

  test('default + named share one destructure', () => {
    const r = repl('import d, { a } from "./m.js"');
    expect(r.code).toContain("const { default: d, a } = await import(__resolveImport('./m.js'));");
  });

  test('default + namespace bind through the namespace', () => {
    const r = repl('import d, * as ns from "./m.js"');
    expect(r.code).toContain("const ns = await import(__resolveImport('./m.js')), { default: d } = ns;");
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
    expect(r.code).toContain("const { a } = await import(__resolveImport('./m.js'));");
    expect(r.code).toContain('const __result = a(1);');
  });
});

describe('user-spelled dynamic imports route through the minted resolver', () => {
  test('a literal specifier wraps', () => {
    const r = repl('m = await import("./m.js")');
    expect(r.code).toContain('await import(__resolveImport("./m.js"))');
    expect(r.replImportResolver).toBe('__resolveImport');
  });

  test('a COMPUTED specifier wraps too — the operand still evaluates once', () => {
    const r = repl('spec = "./m.js"\nm = await import(spec)');
    expect(r.code).toContain('await import(__resolveImport(spec))');
  });

  test('import options ride outside the resolver call', () => {
    const r = repl('m = await import("./m.js", opts)');
    expect(r.code).toContain('await import(__resolveImport("./m.js"), opts)');
  });

  test('the resolver name is MINTED: a user binding pushes it off', () => {
    const r = repl('__resolveImport = 1\nm = await import("./m.js")');
    expect(r.replImportResolver).toBe('__resolveImport_');
    expect(r.code).toContain('await import(__resolveImport_("./m.js"))');
  });

  test('off by default: no resolver, no wrapping', () => {
    const r = compile('m = await import("./m.js")', { runtimeDelivery: 'none' });
    expect(r.replImportResolver).toBe(null);
    expect(r.code).toBe('let m = await import("./m.js");');
  });

  test('a program with no import reports a null resolver', () => {
    expect(repl('1 + 1').replImportResolver).toBe(null);
  });
});

describe('export rejects positioned in repl mode', () => {
  test('every export form rejects with a positioned message', () => {
    for (const src of ['export q = 5', 'export class Foo', 'export default 1', 'q = 1\nexport { q }']) {
      let err = null;
      try {
        repl(src);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CompileError);
      expect(err.message).toMatch(/'export' has no meaning in a REPL entry/);
      expect(typeof err.start).toBe('number');
    }
  });

  test('off by default: export emits untouched', () => {
    expect(compile('export q = 5', { runtimeDelivery: 'none' }).code).toContain('export const q = 5;');
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
