// Emitter edge cases pinned byte-for-byte: array elisions, the
// nullish-chain line continuation, loop-binding rejections,
// statement-only arrow bodies, and loop-temporary naming.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emit/emitter.js';
import * as schemaRuntime from '../../src/runtime/schema.js';
import * as reactiveRuntime from '../../src/runtime/reactive.js';
import * as componentRuntime from '../../src/runtime/components.js';
import * as intrinsicRuntime from '../../src/runtime/intrinsics.js';
import * as stdlibRuntime from '../../src/runtime/stdlib.js';
import { emitterShape, isHeadless } from '../../src/emitter-shape.js';
import { compile as compileSource, parseSource, emitSource } from '../../src/compiler.js';
import { toSourceMap } from '../../src/sourcemap.js';
import { join } from 'node:path';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

const compileDelivered = (src, runtimeDelivery) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src, runtimeDelivery }).code;
};

// Compile with delivery 'none' and evaluate against already-imported
// runtime modules. Minted aliases (`__state_`, …) always bind; a
// public name binds only when the program references it and does not
// itself declare it (so source shadows stay source-owned).
const evalNone = (src, tail, modules) => {
  const code = compileDelivered(src, 'none');
  const env = {};
  for (const [name, value] of Object.entries(modules)) {
    const esc = name.replace(/\$/g, '\\$');
    for (const m of code.matchAll(new RegExp(`\\b${esc}_\\d*\\b`, 'g'))) env[m[0]] = value;
    const declared = new RegExp(`\\b(?:let|const|var|function|class)\\s+${esc}\\b`).test(code);
    if (!declared && new RegExp(`\\b${esc}\\b`).test(code)) env[name] = value;
  }
  const keys = Object.keys(env);
  return new Function(...keys, `${code}\n${tail}`)(...keys.map((k) => env[k]));
};

describe('trailing array elisions survive emission', () => {
  test('the trailing hole emits its own comma; interior holes ride the separators', () => {
    expect(compile('x = [,,1,2,,]')).toBe('let x = [, , 1, 2, ,];');
    expect(eval(compile('x = [,,1,2,,]') + '\nx.length')).toBe(5);
    expect(eval(compile('x = [1,,,]') + '\nx.length')).toBe(3);
    // One trailing comma is a separator, not a hole — unchanged.
    expect(compile('x = [1, 2, 3,]')).toBe('let x = [1, 2, 3];');
  });

});

describe('a for loop that binds no variable rejects loudly', () => {
  test('the statement form rejects, positioned, with the binding hint', () => {
    const r = parser.parse('for [1...3]\n  x = 1');
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: 'for [1...3]\n  x = 1' }))
      .toThrow(/a for loop binds no variable — spell a bare repeat with a binding/);
  });

  test('the comprehension form rejects at PARSE — no var-less clause exists in the grammar', () => {
    const r = parser.parse('y = (1 for [1...3])');
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });

  test('bound ranged loops are untouched', () => {
    expect(eval(compile('r = ""\nfor i in [1...5]\n  r += "x"\nr'))).toBe('xxxx');
  });
});

// The `...` gap already collects every argument between the head and the tail,
// so a SECOND rest after it has nothing left to bind. The grammar admits the
// spelling, and the extraction used to emit `const rest,more = _rest[…]` for it
// — a stringified tree node, which does not parse. Rejection is the honest
// answer: there is no lowering for a binding that can never receive anything.
describe('a rest parameter after the `...` gap rejects loudly', () => {
  const src = 'f = (first, ..., ...more) -> first';
  test('it rejects, positioned, naming what the gap already did', () => {
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: src }))
      .toThrow(/a rest parameter cannot follow the '\.\.\.' gap/);
  });

  test('an ordinary tail parameter is untouched', () => {
    expect(eval(compile('f = (a, ..., b) -> a + b\nf(1, 2, 3, 4)'))).toBe(5);
  });
});

describe("'??' continues across a line break", () => {
  test('a multi-line nullish chain is one logical line, identical to the single-line spelling', () => {
    const multi = parser.parse('v =\n  a ??\n  b ??\n  c');
    const single = parser.parse('v = a ?? b ?? c');
    expect(multi.diagnostics).toEqual([]);
    expect(JSON.stringify(multi.sexpr)).toBe(JSON.stringify(single.sexpr));
  });

  test('evaluation takes the first non-nullish arm', () => {
    expect(eval(compile('a = null\nb = undefined\nc = 3\nv =\n  a ??\n  b ??\n  c\nv'))).toBe(3);
  });

});

// A statement-only single-statement fat
// arrow body took the INLINE path and emitted its statement as a bare
// expression atom — `f = (e) => throw e` shipped `e => throw(e)` (a
// CALL of the keyword) and `h = => debugger` shipped `() => debugger`,
// both invalid JS, silently. Statement-only bodies now take the braced
// block form; every valid program's bytes are untouched (the inline
// path only ever misfired on programs that emitted invalid JS).
describe('statement-only fat-arrow bodies emit braced blocks', () => {
  test('a lone throw body braces instead of emitting a throw(...) call', () => {
    const code = compile('f = (e) => throw e');
    expect(code).toBe('let f = e => {\n  throw e;\n};');
    expect(() => new Function(code)).not.toThrow();
  });

  test('a lone debugger body braces instead of emitting an inline keyword', () => {
    const code = compile('h = => debugger');
    expect(code).toBe('let h = () => {\n  debugger;\n};');
    expect(() => new Function(code)).not.toThrow();
  });

  test('thin arrows were never affected — block bodies by construction', () => {
    expect(compile('g = (e) -> throw e')).toContain('function(e) {\n  throw e;\n}');
  });

  test('expression bodies keep their inline bytes', () => {
    expect(compile('g = (x) => x * 2')).toBe('let g = x => (x * 2);');
    expect(compile('o = => {a: 1}')).toBe('let o = () => ({a: 1});');
  });
});

// The freshTempName gap: loop machinery spelled its temporaries as
// bare literals — `_i` at the no-index stepped-loop sites, `_step`
// for runtime-sign steps — instead of dodging the module's spelled
// identifiers the way chain temps do. A user `_i` or `_step` was
// silently shadowed inside any stepped loop: `_i = 99` then
// `console.log _i` in the body printed the loop counter. The names
// now walk the numbered family (`_i` → `_i1` → `_i2`) past every
// identifier the module spells; programs that never spell the base
// names keep their bytes (the name is not reserved — each use is
// block-scoped to its own loop header).
describe('stepped-loop temporaries dodge user identifiers', () => {
  test('a user _i is not shadowed by the loop counter', () => {
    const code = compile('out = []\n_i = 99\nfor t in [1, 2, 3] by 2\n  out.push _i');
    expect(code).toBe(
      'let out = [];\nlet _i = 99;\n' +
      'for (let _i1 = 0; _i1 < [1, 2, 3].length; _i1 += 2) {\n' +
      'let t = [1, 2, 3][_i1];\nout.push(_i);\n}',
    );
    expect(new Function(code + '\nreturn out;')()).toEqual([99, 99]);
  });

  test('a user _step is not shadowed by the runtime-sign step temp', () => {
    const code = compile('out = []\ns = 2\n_step = 7\nfor t in [1, 2, 3] by s\n  out.push _step');
    expect(code).toContain('for (let _step1 = s, _i = _step1 > 0 ? 0 :');
    expect(new Function(code + '\nreturn out;')()).toEqual([7, 7]);
  });

  test('comprehension position dodges too', () => {
    const code = compile('_i = 99\nys = (t + _i for t in [1, 2, 3] by 2)');
    expect(code).toContain('for (let _i1 = 0; _i1 < [1, 2, 3].length; _i1 += 2) {');
    expect(new Function(code + '\nreturn ys;')()).toEqual([100, 102]);
  });

  test('the family walks past every spelled name', () => {
    const code = compile('_i = 1\n_i1 = 2\nfor t in [1, 2, 3] by 2\n  t');
    expect(code).toContain('for (let _i2 = 0;');
  });

  test('programs that never spell the temps keep their bytes', () => {
    expect(compile('for t in [1, 2, 3] by 2\n  console.log t')).toBe(
      'for (let _i = 0; _i < [1, 2, 3].length; _i += 2) {\n' +
      'let t = [1, 2, 3][_i];\nconsole.log(t);\n}',
    );
  });
});

describe('object-comprehension intrinsic delivery', () => {
  test('inline delivery does not capture module bindings named for host globals', () => {
    const src = 'Reflect = null\nObject = null\nglobalThis = null\nout = {k: v for k, v of {a: 9}}';
    const code = compileDelivered(src, 'inline');
    expect(code).toContain('const { __toPropertyKey, __defineOwnDataProperty } = (() => {');
    expect(code).not.toContain('Reflect.ownKeys');
    expect(code).not.toContain('Object.defineProperty');
    expect(new Function(`${code}\nreturn out.a;`)()).toBe(9);
  });

  test('import delivery requests only the compiler intrinsic seam', () => {
    const code = compileDelivered('out = {k: v for k, v of src}', 'import');
    expect(code).toStartWith(
      'import { __toPropertyKey, __defineOwnDataProperty } from '
    );
    expect(code).toContain('/src/runtime/intrinsics.js";');
  });

  test('a program without an object comprehension carries no intrinsic runtime', () => {
    expect(compileDelivered('out = {a: 1}', 'inline')).toBe('let out = {a: 1};');
  });

  test('generated helper aliases dodge module, parameter, and loop bindings in every delivery mode', () => {
    const moduleSource = [
      '__toPropertyKey = 10',
      '__defineOwnDataProperty = 20',
      'Reflect = 30',
      'Object = 40',
      'globalThis = 50',
      'out = {k: v for k, v of {a: 9}}',
    ].join('\n');
    const localSource = [
      'build = (__toPropertyKey, Reflect, Object, globalThis) ->',
      '  out = null',
      '  for __defineOwnDataProperty in [1]',
      '    out = {k: v for k, v of {a: 9}}',
      '  out',
      'result = build 1, 2, 3, 4',
    ].join('\n');

    for (const [source, resultExpr] of [
      [moduleSource, 'out.a'],
      [localSource, 'result.a'],
    ]) {
      for (const mode of ['none', 'import', 'inline']) {
        const code = compileDelivered(source, mode);
        expect(code).toMatch(/__toPropertyKey[_\d]+\(/);
        expect(code).toMatch(/__defineOwnDataProperty[_\d]+\(/);
        expect(code).not.toMatch(/const _k = __toPropertyKey\(/);
        expect(code).not.toMatch(/\n\s*__defineOwnDataProperty\(/);
        if (mode === 'import') {
          expect(code).toMatch(/__toPropertyKey as __toPropertyKey[_\d]+/);
          expect(code).toMatch(/__defineOwnDataProperty as __defineOwnDataProperty[_\d]+/);
        }
        if (mode === 'inline') {
          const value = new Function(`${code}\nreturn ${resultExpr};`)();
          expect(value).toBe(9);
        }
      }
    }
  });

  test('schema callable sub-emitters inherit minted intrinsic aliases', () => {
    const source = [
      'S = schema :shape',
      '  items! json',
      '  build: (__toPropertyKey) ->',
      '    __defineOwnDataProperty = 20',
      '    {k: v for k, v of @items}',
      's = S.parse({items: {a: 9}})',
      'result = s.build(1)',
    ].join('\n');
    for (const mode of ['none', 'import', 'inline']) {
      const code = compileDelivered(source, mode);
      expect(code).toMatch(/const _k = __toPropertyKey[_\d]+\(k\)/);
      expect(code).toMatch(/__defineOwnDataProperty[_\d]+\(result/);
      expect(code).not.toContain('const _k = __toPropertyKey(k)');
      if (mode === 'import') {
        expect(code).toMatch(/__toPropertyKey as __toPropertyKey[_\d]+/);
        expect(code).toMatch(/__defineOwnDataProperty as __defineOwnDataProperty[_\d]+/);
      }
      if (mode === 'inline') {
        expect(code).toMatch(/__toPropertyKey:\s*__toPropertyKey[_\d]+/);
        expect(code).toMatch(/__defineOwnDataProperty:\s*__defineOwnDataProperty[_\d]+/);
      }
    }
    schemaRuntime.SchemaRegistry.reset();
    const result = evalNone(source, 'return result;', {
      ...schemaRuntime,
      ...intrinsicRuntime,
    });
    expect(result.a).toBe(9);
  });
});

describe('compiler-generated runtime aliases', () => {
  const REACTIVE_GENERATED = ['__state', '__computed', '__effect', '__batch'];
  const COMPONENT_GENERATED = [
    'setContext', 'getContext', '__Component', '__pushComponent', '__popComponent',
    '__clsx', '__reconcile', '__transition', '__detach', '__ownerFrame',
    '__pushOwner', '__popOwner', '__detachRef',
  ];

  test('reactive sugar dodges module bindings in every delivery mode and runs through the real runtime', () => {
    const source = [
      'log = []',
      '__state = (v) -> "bad-state"',
      '__computed = (fn) -> "bad-computed"',
      '__effect = (fn) -> log.push("user"); "bad-effect"',
      'x := 1',
      'y ~= x * 2',
      '~> log.push("effect:" + y)',
    ].join('\n');
    for (const mode of ['none', 'import', 'inline']) {
      const code = compileDelivered(source, mode);
      for (const name of ['__state', '__computed', '__effect']) {
        expect(code).toMatch(new RegExp(`${name.replaceAll('$', '\\$&')}[_\\d]+\\(`));
      }
      if (mode === 'import') {
        for (const name of ['__state', '__computed', '__effect']) {
          expect(code).toMatch(new RegExp(`${name} as ${name}[_\\d]+`));
        }
      }
      if (mode === 'inline') {
        for (const name of ['__state', '__computed', '__effect']) {
          expect(code).toMatch(new RegExp(`${name}:\\s*${name}[_\\d]+`));
        }
      }
    }
    expect(evalNone(`${source}\nout = [x, y, log]`, 'return out;', reactiveRuntime))
      .toEqual([1, 2, ['effect:2']]);
  });

  test('schema callable sub-emitters inherit reactive aliases', () => {
    const source = [
      'S = schema :shape',
      '  n! integer',
      '  value: (__state, __computed, __effect) ->',
      '    local := @n',
      '    doubled ~= local * 2',
      '    ~> doubled',
      '    doubled',
    ].join('\n');
    for (const mode of ['none', 'import', 'inline']) {
      const code = compileDelivered(source, mode);
      expect(code).toMatch(/const local = __state[_\d]+\(this\.n\)/);
      expect(code).toMatch(/const doubled = __computed[_\d]+\(\(\) =>/);
      expect(code).toMatch(/__effect[_\d]+\(\(\) =>/);
    }
  });

  test('the complete component lowering surface dodges source bindings in every delivery mode', () => {
    const componentCorpus = readFileSync(new URL('../corpus/components.rip', import.meta.url), 'utf8');
    const shadows = [...REACTIVE_GENERATED, ...COMPONENT_GENERATED]
      .map((name) => `${name} = null`)
      .join('\n');
    const context = [
      'ContextChild = component',
      '  accept theme from ContextParent',
      'ContextParent = component',
      '  offer theme := "dark"',
    ].join('\n');
    const source = `${shadows}\n${context}\n${componentCorpus}`;

    for (const mode of ['none', 'import', 'inline']) {
      const code = compileDelivered(source, mode);
      for (const name of [...REACTIVE_GENERATED, ...COMPONENT_GENERATED]) {
        expect(code).toContain(`${name}_`);
        if (mode === 'import') expect(code).toMatch(new RegExp(`${name} as ${name}[_\\d]+`));
        if (mode === 'inline') expect(code).toMatch(new RegExp(`${name}:\\s*${name}[_\\d]+`));
      }
    }
    expect(() => evalNone(source, 'return null;', {
      ...reactiveRuntime,
      ...componentRuntime,
    })).not.toThrow();
  });
});

// A runtime is delivered for a reference to one of its names, and only
// a reference: a render tag word names an element, and a parameter
// shadows the runtime name throughout its function. A real read still
// delivers, in render text and under a function that binds another name.
describe('runtime delivery reads references, not spellings', () => {
  const stdlib = (src) => /const \{[^}]*\bpp\b[^}]*\}/.test(compileDelivered(src, 'inline'));
  test('a render tag `p` delivers nothing, in children, a class chain, and a branch', () => {
    expect(stdlib("export A = component\n  render\n    p 'hi'\n")).toBe(false);
    expect(stdlib("export A = component\n  render\n    div\n      p\n      p.intro 'x'\n      if true\n        p 'y'\n")).toBe(false);
  });
  test('a parameter named `p` shadows the runtime name in its body', () => {
    expect(stdlib('f = (p) -> p + 1\n')).toBe(false);
    expect(stdlib('f = ({ p }) -> p\n')).toBe(false);
    expect(stdlib('def g(p = 1)\n  p\n')).toBe(false);
    expect(stdlib('h = (p = 1) -> p\n')).toBe(false);
    expect(stdlib('h = (x = p) -> x\n')).toBe(true);
  });
  test('a real read delivers: a call, render text, and a read past a shadowing scope', () => {
    expect(stdlib('f = (x) -> p x\n')).toBe(true);
    expect(stdlib("export A = component\n  render\n    div\n      = p\n")).toBe(true);
    expect(stdlib('f = (p) -> p\ng = -> p 1\n')).toBe(true);
    expect(stdlib("r = do (p) -> p 'via do'\n")).toBe(true);
  });
});

describe('match reads deliver the stdlib runtime', () => {
  test('`=~` delivers toMatchable in both modes', () => {
    const src = 'm = "x42" =~ /x(\\d+)/\nconsole.log _[1]';
    expect(compileDelivered(src, 'import')).toMatch(/import \{[^}]*toMatchable[^}]*\} from/);
    expect(compileDelivered(src, 'inline')).toMatch(/const \{[^}]*toMatchable[^}]*\}/);
  });

  test('a regex index delivers toMatchable in both modes', () => {
    const src = 'id = "1234"[/^([1-9]\\d*)$/, 1]';
    expect(compileDelivered(src, 'import')).toMatch(/import \{[^}]*toMatchable[^}]*\} from/);
    expect(compileDelivered(src, 'inline')).toMatch(/const \{[^}]*toMatchable[^}]*\}/);
  });

  test('a bare regex index delivers toMatchable in both modes', () => {
    const src = 'hit = "abc"[/b/]';
    expect(compileDelivered(src, 'import')).toMatch(/import \{[^}]*toMatchable[^}]*\} from/);
    expect(compileDelivered(src, 'inline')).toMatch(/const \{[^}]*toMatchable[^}]*\}/);
  });

  test('a program-scope toMatchable binding gets a minted alias', () => {
    const src = 'toMatchable = 1\nm = "a1" =~ /(\\d)/\nconsole.log toMatchable, _[1]';
    const code = compileDelivered(src, 'inline');
    expect(code).toMatch(/toMatchable: toMatchable_/);
    expect(code).toContain('(_ = toMatchable_(');
    expect(code).toContain('let toMatchable = 1;');
    expect(compileDelivered(src, 'import')).toMatch(/import \{[^}]*toMatchable as toMatchable_[^}]*\} from/);
  });

  test('a match write declares `_` at its own function scope even when an outer scope has one', () => {
    // The last-match binding is per-function-invocation: a module-level
    // match hoists `_` at module scope AND a function containing its
    // own match re-declares `let _` in its body — sharing the outer
    // binding would let concurrent async invocations clobber each
    // other's match across await points.
    const code = compile('"m0" =~ /m(0)/\nf = (s) ->\n  s =~ /x(\\w+)/\n  _[1]');
    expect(code).toContain('let _;\n');
    expect(code).toMatch(/function\(s\) \{\n  let _;\n/);
  });

  test('a match inside a value-position lowering binds the SOURCE function `_`, not a generated scope', () => {
    // The if-expression lowers to a ternary and the comprehension to an
    // IIFE — both generated scopes assign the enclosing source
    // function's `_` (declared once at its top), never a binding
    // trapped inside the lowering.
    const iff = compile('f = (s) ->\n  r = if s =~ /q(\\d)/ then _[1] else "none"\n  r');
    expect(iff).toMatch(/function\(s\) \{\n  let _;\n/);
    const comp = compile('g = (xs) ->\n  ys = (x for x in xs when x =~ /a/)\n  ys.length');
    expect(comp).toMatch(/function\(xs\) \{\n  let _;\n/);
    expect(comp.match(/let _;/g)).toHaveLength(1);
  });

  test('a function with no match write declares no `_` of its own', () => {
    const code = compile('f = ->\n  "ab" =~ /a(b)/\n  read = -> _[1]\n  read()');
    expect(code.match(/let _;/g)).toHaveLength(1);
  });

  test('a single-statement schema body hoists its targets like a multi-statement one', () => {
    const src = [
      'X = schema :shape',
      '  name! string',
      '  tail: -> ("abc" =~ /b(c)/) and _[1]',
      '  five: -> (y = 5) and y',
      'x = X.parse({name: "n"})',
      'console.log x.tail(), x.five()',
    ].join('\n');
    const code = compileDelivered(src, 'none');
    expect(code).toMatch(/name: "tail", fn: \(function\(\) \{ let _; return/);
    expect(code).toMatch(/name: "five", fn: \(function\(\) \{ let y; return/);
  });

  test('a compiled match-op program runs standalone', () => {
    const src = [
      'v = "x42"',
      'a = v[/^x(\\d+)$/, 1]',
      'b = v[/x\\d+/]',
      'c = (("y7" =~ /(\\d)/) and _[1])',
      'toMatchable = "shadow"',
      'd = toMatchable',
    ].join('\n');
    expect(evalNone(src, 'return [a, b, c, d];', { toMatchable: stdlibRuntime.toMatchable }))
      .toEqual(['42', 'x42', '7', 'shadow']);
  });
});

describe("a postfix guard on a call's named arguments binds the CALL", () => {
  // The guard used to migrate into the argument when an implicit-return
  // object followed, emitting `f({a: cond ? v : undefined})` — so the
  // call fired unconditionally, with undefined, on the branch where
  // there was nothing to do. objectContinues looks PAST a line break, so
  // it is gated on startsLine exactly as the TERMINATOR rule is; a key
  // that opens an implicit call is never line-starting.
  test('the guard stays on the statement when an object literal follows', () => {
    const src = ['f = (p, r) ->', '  p.set a: r.v if p.a isnt r.v', '', '  m: 1', '  n: 2'].join('\n');
    expect(compile(src)).toBe([
      'let f = function(p, r) {',
      '  if (p.a !== r.v) p.set({a: r.v});',
      '  return {m: 1, n: 2};',
      '};',
    ].join('\n'));
  });

  test('the call really does not fire when the guard is false', () => {
    const src = [
      'calls = []',
      'p = { set: (o) -> calls.push o }',
      'f = (v) ->',
      '  p.set a: v if v',
      '',
      '  done: true',
      'f null',
      'f 7',
      'calls',
    ].join('\n');
    expect(eval(compile(src))).toEqual([{ a: 7 }]);
  });

  test('a line-starting object still lets the guard bind the VALUE', () => {
    expect(compile('x =\n  a: 1 if c\n  b: 2')).toBe('let x = {a: (c ? 1 : undefined), b: 2};');
  });

  test('with no continuation the guard already bound the statement', () => {
    expect(compile('y = f a: 1 if c')).toBe('let y;\n\nif (c) y = f({a: 1});');
  });
});

describe('expression dispatch', () => {
  // Every call is ["call", attrs, callee, …], so a node no expression
  // form claims is an emitter defect; it rejects rather than emitting
  // as a call of its head.
  test('a node no expression form claims rejects, naming its head', () => {
    parser.lexer = makeParserLexer();
    const result = parser.parse('x = 1\n');
    result.sexpr[2][3] = ['bogus', {}, '1'];
    expect(() => emit(result, { source: 'x = 1\n' })).toThrow(/no expression emission for a 'bogus' node/);
  });
});

// The emitter's input shape: src/emitter-shape.js rewrites the parser's
// tree (the shape grammar.rip's kind registry documents) into the shape
// src/emit/emitter.js reads. Each row pins one reshaped construct: the
// converted tree, its rows' kinds, and the flags that travel with it.
describe('the emitter shape', () => {
  // This file's own `compile` above is a test helper; this block's is the compiler's.
  const compile = compileSource;
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
    ["try a() catch then b()", "[\"program\",[\"try\",[\"call\",{},\"a\"],[\"catch\",null,[\"block\",[\"call\",{},\"b\"]]]]]"],
    ["try a() finally c()", "[\"program\",[\"try\",[\"call\",{},\"a\"],[\"block\",[\"call\",{},\"c\"]]]]"],
    ["try\n  a()\ncatch e\n  b()\nfinally\n  c()", "[\"program\",[\"try\",[\"block\",[\"call\",{},\"a\"]],[\"catch\",\"e\",[\"block\",[\"call\",{},\"b\"]]],[\"block\",[\"call\",{},\"c\"]]]]"],
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
    ["x = obj.{a, b: c, d = 1}", "[\"program\",[\"=\",\"x\",[\".{}\",\"obj\",[\"pickitem\",\"a\",\"a\",null],[\"pickitem\",\"b\",\"c\",null],[\"pickitem\",\"d\",\"d\",\"1\"]]]]"],
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

  // A headless array's first element is a child that can spell any head;
  // the shape records which arrays are headless, so no reader has to tell
  // a node from a list by the spelling of its first element.
  test('every headless array is recorded as headless, and no node is', () => {
    const r = parser.parse('y = (k for k in xs when object)\nblock if c\ns = "#{object}"\nx = o.{def = 1}\nz = {}\n');
    const out = emitterShape(r.sexpr, r.stores.nodeIds);
    const comp = out[1][2];
    expect(isHeadless(comp[2])).toBe(true);
    expect(isHeadless(comp[3])).toBe(true);
    expect(comp[3]).toEqual(['object']);
    expect(isHeadless(out[2][2])).toBe(true);
    expect(out[2][2]).toEqual(['block']);
    expect(isHeadless(out[3][2][2])).toBe(true);
    expect(isHeadless(out[4][2][2])).toBe(false);
    expect(out[4][2][2][0]).toBe('pickitem');
    expect(isHeadless(out[5][2])).toBe(false);
    expect(out[5][2]).toEqual(['object']);
    expect(isHeadless(comp)).toBe(false);
  });

  test('a catch handler is a headed node, whatever its binding spells', () => {
    const r = parser.parse('try\n  g()\ncatch block\n  p 1\n');
    const handler = emitterShape(r.sexpr, r.stores.nodeIds)[1][2];
    expect(handler[0]).toBe('catch');
    expect(handler[1]).toBe('block');
    expect(isHeadless(handler)).toBe(false);
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

  test('a comprehension clause answers to its own node id', () => {
    const r = parser.parse('y = (v for v in xs when v)\n');
    const clause = r.sexpr[2][3][3];
    expect(clause[0]).toBe('loop');
    const out = emitterShape(r.sexpr, r.stores.nodeIds);
    expect(r.stores.nodeIds.get(out[1][2][2][0])).toBe(r.stores.nodeIds.get(clause));
  });

  // The absent marker is ["none", {}], a node no list can spell: a list
  // that holds a name `none` (an interpolation chunk, a specifier list)
  // stays that list.
  const js = (src, face = 'js') => compile(src, { path: 'x.rip', runtimeDelivery: 'none', face }).code;

  test('a name `none` in an interpolation or a specifier list is never the absent marker', () => {
    expect(js('none = 1\ns = "a#{none}"\n')).toContain('`a${none}`');
    expect(js('none = 1\nr = ///a#{none}///\n')).toContain('none');
    expect(js('import {none} from "./x.js"\np none\n')).toContain("import { none } from './x.js';");
    expect(js('import d, {none} from "./x.js"\np d, none\n')).toContain("import d, { none } from './x.js';");
    expect(js('import type {none} from "./x.js"\nv: none = 1\n', 'ts')).toContain("import type { none } from './x.js';");
  });
});

// compile() is parseSource() then emitSource(). A caller may emit one parse
// more than once (rip check re-emits a probed file with pins), so emission
// must never change the parse it reads: every emission from one parse equals
// a fresh compile with the same options, field for field.
describe('parseSource and emitSource', () => {
  // This file's own `compile` above is a test helper; this block's is the compiler's.
  const compile = compileSource;
  const fields = (r) => JSON.stringify({
    code: r.code,
    map: r.map,
    mappings: r.mappings,
    pinnables: r.pinnables,
    pinSpans: r.pinSpans,
    echoSpans: r.echoSpans,
    runtimeRefs: r.runtimeRefs,
    imports: r.imports,
    declarations: r.declarations,
  });

  // A module binding read inside a function body: the TS face offers it as
  // a pinnable, so pins change what the emitter writes.
  const PINNABLE = "items = [{ name: 'duck', price: 399 }]\nexport def total()\n  items.length\n";

  describe('parseSource / emitSource', () => {
    test('emitting a parse equals compiling the source, on both faces', () => {
      for (const face of ['js', 'ts']) {
        const opts = { path: 'x.rip', face, runtimeDelivery: 'import' };
        expect(fields(emitSource(parseSource(PINNABLE, opts), opts))).toBe(fields(compile(PINNABLE, opts)));
      }
    });

    test('one parse emits unpinned and pinned faces exactly as fresh compiles do', () => {
      const opts = { path: 'x.rip', face: 'ts', runtimeDelivery: 'import' };
      const parsed = parseSource(PINNABLE, opts);
      const plain = emitSource(parsed, opts);
      expect(plain.pinnables.length).toBeGreaterThan(0);
      const pins = new Map(plain.pinnables.map((p) => [p.key, 'number']));
      const pinned = emitSource(parsed, { ...opts, pins });
      expect(pinned.code).not.toBe(plain.code);
      expect(fields(pinned)).toBe(fields(compile(PINNABLE, { ...opts, pins })));
      expect(fields(emitSource(parsed, { ...opts, pins }))).toBe(fields(pinned));
      expect(fields(emitSource(parsed, opts))).toBe(fields(plain));
    });

    test('map is built on first read and memoized, and equals the map serialized at emission', () => {
      const r = compile(PINNABLE, { path: 'x.rip' });
      expect(typeof Object.getOwnPropertyDescriptor(r, 'map').get).toBe('function');
      expect(Object.keys(r).indexOf('map')).toBe(Object.keys(r).indexOf('code') + 1);
      const map = r.map;
      expect(r.map).toBe(map);
      expect(JSON.stringify(map)).toBe(JSON.stringify(toSourceMap({ code: r.code, mappings: r.mappings }, { source: PINNABLE, sourcePath: 'x.rip', file: 'x.rip.js' })));
    });

    test('a map read after a later emission of the same parse is its own emission\'s map', () => {
      const opts = { path: 'x.rip', face: 'ts', runtimeDelivery: 'import' };
      const parsed = parseSource(PINNABLE, opts);
      const plain = emitSource(parsed, opts);
      const pins = new Map(plain.pinnables.map((p) => [p.key, 'number']));
      const pinned = emitSource(parsed, { ...opts, pins });
      expect(JSON.stringify(plain.map)).toBe(JSON.stringify(compile(PINNABLE, opts).map));
      expect(JSON.stringify(pinned.map)).toBe(JSON.stringify(compile(PINNABLE, { ...opts, pins }).map));
    });

    test('a schema function body re-emits from one parse', () => {
      // The body sub-parse runs the lexer's tail passes, which retag tokens in
      // place (a `then` becomes its block's INDENT); run over the parse's own
      // tokens, the second emission re-parsed the retagged body and threw.
      const src = 'User = schema\n  shippedAt? datetime, -> if it.shippedAt then Date.new(it.shippedAt) else null\n';
      for (const face of ['js', 'ts']) {
        const opts = { path: 'x.rip', face, runtimeDelivery: 'import' };
        const parsed = parseSource(src, opts);
        const first = emitSource(parsed, opts);
        expect(fields(emitSource(parsed, opts))).toBe(fields(first));
        expect(fields(first)).toBe(fields(compile(src, opts)));
      }
    });

    test('an emission whose face, tolerance or path differs from the parse rejects', () => {
      const parsed = parseSource('x = 1', { path: 'a.rip', face: 'ts' });
      expect(() => emitSource(parsed, { path: 'a.rip', face: 'js' })).toThrow('emitSource: emits the parse it was given');
      expect(() => emitSource(parsed, { path: 'a.rip', face: 'ts', tolerant: true })).toThrow('must match the parse');
      expect(() => emitSource(parsed, { path: 'b.rip', face: 'ts' })).toThrow('must match the parse');
    });
  });
});

// Emission never changes the parse it reads (src/compiler.js, parseSource):
// across the whole consumer corpus — every tracked package module and every
// language-suite row, on both faces — a second emission of one parse equals
// the first, and a rejection rejects again with the same message.
describe('one parse emits twice to identical output', () => {
  const ROOT = join(import.meta.dir, '../..');

  const emitted = (parsed, opts) => {
    try {
      const r = emitSource(parsed, opts);
      return JSON.stringify({ code: r.code, map: r.map, mappings: r.mappings, pinnables: r.pinnables });
    } catch (e) {
      return `ERR ${String(e?.message ?? e)}`;
    }
  };

  test('every consumer-corpus parse emits twice to identical output', async () => {
    const inputs = [...packageInputs(ROOT), ...await rowInputs(ROOT)];
    const drifted = [];
    for (const { key, src, path } of inputs) {
      for (const face of ['js', 'ts']) {
        const opts = { path, face, runtimeDelivery: 'none' };
        let parsed;
        try { parsed = parseSource(src, opts); } catch { continue; }
        const first = emitted(parsed, opts);
        const second = emitted(parsed, opts);
        if (second !== first) drifted.push(`${key} [${face}]${second.startsWith('ERR ') ? `: ${second.split('\n')[0]}` : ''}`);
      }
    }
    expect(drifted.join('\n')).toBe('');
  }, 120_000);
});
