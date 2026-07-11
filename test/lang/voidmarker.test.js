// The void-marker family: a trailing `!` on a function's NAME at any
// DEFINITION site (def, arrow assignment, export, method key) makes the
// function VOID — implicit return suppressed, the function returns
// undefined. The lexer carries a real VOID_MARKER token and the tree
// carries structural heads (`void-def`/`void-assign`/`void-pair`);
// sexprs are pinned in the corpus (test/corpus/voidmarker.rip,
// canonicalized heads). THIS file owns the emitted-byte pins, the
// eval checks, the disambiguation-boundary token fixtures, the
// mapping pins, and the negative surface.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

const emitOf = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src });
};

const kinds = (src) => tokenize(src).tokens.map((t) => t.kind);

// Load compiled code as a real ES module and return its default export.
let seq = 0;
async function loadDefault(code) {
  const dir = mkdtempSync(join(tmpdir(), 'rip-void-'));
  const file = join(dir, `m${seq++}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)).default;
}

describe('void definitions: emitted bytes', () => {
  test('binary body: the statement stays bare and the void tail appends `return;`', () => {
    expect(compile('def save!(x)\n  x + 1')).toBe(
      'function save(x) {\n  x + 1;\n  return;\n}',
    );
  });
});

describe('void definitions: the function returns undefined', () => {
  const rows = [
    ['def save!(x)\n  x + 1\nexport default save(1)'],
    ['save! = (x) -> x + 1\nexport default save(1)'],
    ['save! = (x) => x + 1\nexport default save(1)'],
    ['def tick!\n  1 + 1\nexport default tick()'],
  ];
  for (const [src] of rows) {
    test(JSON.stringify(src.split('\n')[0]), async () => {
      expect(await loadDefault(compile(src))).toBeUndefined();
    });
  }

  test('async void def resolves to undefined; the awaits still run', async () => {
    const src = [
      'ran = []',
      'def save!(u)',
      '  ran.push(await Promise.resolve(u))',
      'export default save(7).then(-> ran)',
    ].join('\n');
    expect(await loadDefault(compile(src))).toEqual([7]);
  });
});

describe('void method keys', () => {
  test('class body `fn!: ->` voids the method', async () => {
    const src = 'class A\n  fn!: -> 42\nexport default (new A).fn()';
    const code = compile(src);
    expect(code).toContain('fn() {\n    42;\n    return;\n  }');
    expect(await loadDefault(code)).toBeUndefined();
  });

  test('static `@fn!: ->` voids too', async () => {
    const src = 'class A\n  @fn!: -> 42\nexport default A.fn()';
    const code = compile(src);
    expect(code).toContain('static fn() {\n    42;\n    return;\n  }');
    expect(await loadDefault(code)).toBeUndefined();
  });

  test('bound `fn!: =>` in a class voids with the bind (constructor required)', async () => {
    const src = 'class A\n  constructor: ->\n    @x = 2\n  fn!: => @x + 1\nexport default (new A).fn()';
    expect(await loadDefault(compile(src))).toBeUndefined();
  });

  test('object literal `fn!: ->` emits a void shorthand method', async () => {
    const src = 'obj = {\n  fn!: -> 42\n}\nexport default obj.fn()';
    const code = compile(src);
    expect(code).toContain('fn() {\n  42;\n  return;\n}');
    expect(await loadDefault(code)).toBeUndefined();
  });

  test('object literal `fn!: =>` voids the arrow', async () => {
    const src = 'obj = { fn!: => 42 }\nexport default obj.fn()';
    const code = compile(src);
    expect(code).toContain('fn: () => {\n  42;\n  return;\n}');
    expect(await loadDefault(code)).toBeUndefined();
  });

  test('the implicit-object spelling voids too (`obj =` + indented `fn!:` pairs)', async () => {
    const src = 'obj =\n  fire!: -> 9\n  peek: -> 1\nexport default [obj.fire(), obj.peek()]';
    expect(await loadDefault(compile(src))).toEqual([undefined, 1]);
  });

  test('void method bodies RUN: a side effect is observed AND the return is undefined', async () => {
    // `undefined` alone cannot distinguish ran-and-returned-undefined
    // from a dropped body — the pushes prove both bodies executed.
    const src = [
      'ran = []',
      'class A',
      '  fn!: (v) ->',
      '    ran.push(v)',
      'obj = {',
      '  go!: (v) -> ran.push(v * 10)',
      '}',
      'r1 = (new A).fn(7)',
      'r2 = obj.go(3)',
      'export default {ran, r1, r2}',
    ].join('\n');
    const out = await loadDefault(compile(src));
    expect(out.ran).toEqual([7, 30]);
    expect(out.r1).toBeUndefined();
    expect(out.r2).toBeUndefined();
  });
});

describe('disambiguation boundary: token fixtures', () => {
  test('definition-site bang before `=` is VOID_MARKER; call-site stays DAMMIT', () => {
    expect(kinds('save! = (x) -> x')).toEqual([
      'IDENTIFIER', 'VOID_MARKER', '=', 'PARAM_START', 'IDENTIFIER', 'PARAM_END', '->',
      'INDENT', 'IDENTIFIER', 'OUTDENT',
    ]);
    expect(kinds('x = save!')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'DAMMIT']);
  });

  test('`save! == y` compares an awaited call: the bang stays DAMMIT (`==` is one COMPARE token)', () => {
    expect(kinds('r = save! == y')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'DAMMIT', 'COMPARE', 'IDENTIFIER']);
    expect(compile('r = save! == y')).toBe('let r = await save() === y;');
  });

  test('def-name bang is VOID_MARKER (parenful, paramless, and return-typed)', () => {
    expect(kinds('def save!(x)\n  f(x)').slice(0, 4)).toEqual(['DEF', 'IDENTIFIER', 'VOID_MARKER', 'CALL_START']);
    expect(kinds('def tick!\n  f()').slice(0, 4)).toEqual(['DEF', 'IDENTIFIER', 'VOID_MARKER', 'INDENT']);
    expect(kinds('def save!(x): Number\n  f(x)')).toContain('TYPE');
    expect(kinds('def tick!: Number\n  f()')).toContain('TYPE');
  });

  test('key-position bang resolves to VOID_MARKER inside braces; a ternary branch keeps DAMMIT', () => {
    expect(kinds('o = { fn!: v }')).toEqual(['IDENTIFIER', '=', '{', 'IDENTIFIER', 'VOID_MARKER', ':', 'IDENTIFIER', '}']);
    // Spaced colon: `fn! :` pairs the same way as `fn!:`.
    expect(kinds('o = { fn! : v }')).toEqual(['IDENTIFIER', '=', '{', 'IDENTIFIER', 'VOID_MARKER', ':', 'IDENTIFIER', '}']);
    // `c ? f!: g` — the colon is the ternary's; the bang is call-site
    // dammit.
    expect(kinds('r = c ? f!: g')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'TERNARY', 'IDENTIFIER', 'DAMMIT', ':', 'IDENTIFIER']);
  });

  test('class-body key bang: the implicit brace wraps the KEY, not the marker', () => {
    expect(kinds('class A\n  fn!: -> 42')).toEqual([
      'CLASS', 'IDENTIFIER', 'INDENT', '{', 'IDENTIFIER', 'VOID_MARKER', ':', '->',
      'INDENT', 'NUMBER', 'OUTDENT', '}', 'OUTDENT',
    ]);
    expect(kinds('class A\n  @fn!: -> 42')).toEqual([
      'CLASS', 'IDENTIFIER', 'INDENT', '{', '@', 'PROPERTY', 'VOID_MARKER', ':', '->',
      'INDENT', 'NUMBER', 'OUTDENT', '}', 'OUTDENT',
    ]);
  });

  test("unspaced '!=' after a name still rejects at scan (the sigil guard)", () => {
    expect(() => tokenize('f!= 1')).toThrow(/cannot use the '!' sigil in an assignment/);
  });
});

describe('void marker: negative surface (reject loudly, never tolerate silently)', () => {
  const parseFails = (src) => {
    const r = parser.parse(src);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    return r.diagnostics[0].message;
  };
  const emitFails = (src, re) => {
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: src })).toThrow(re);
  };

  test('void marker on a non-function value rejects', () => {
    emitFails('save! = 42', /requires a function value/);
    emitFails("save! = 'hi'", /requires a function value/);
    emitFails('save! = if c then 1 else 2', /requires a function value/);
  });

  test('void marker on a non-function OBJECT value rejects', () => {
    emitFails('o = { save!: 5 }', /requires a function value/);
  });

  test('void marker on a non-function CLASS member rejects', () => {
    emitFails('class A\n  fn!: 5', /requires a function value/);
  });

  test('a constructor cannot be void', () => {
    emitFails('class A\n  constructor!: -> f()', /constructor cannot carry the void marker/);
  });

  test('returning a value from a void function rejects (bare return stays legal)', () => {
    emitFails('def f!(x)\n  if x\n    return 5\n  f(x)', /cannot return a value from a void function/);
    emitFails('save! = ->\n  return 3', /cannot return a value from a void function/);
    expect(compile('def f!(x)\n  return')).toBe('function f(x) {\n  return;\n}');
    // A NESTED plain function inside a void body keeps its returns.
    expect(compile('def f!(x)\n  g = -> 7\n  g()')).toContain('return 7;');
  });

  test('member targets take no void marker (parse-rejected)', () => {
    parseFails('obj.save! = -> 5');
  });

  test('compound assignment takes no void marker (parse-rejected)', () => {
    parseFails('save! ||= -> 5');
    parseFails('save! ?= -> 5');
  });

  test('shorthand and destructuring bangs reject at parse', () => {
    parseFails('o = {f!}');
    parseFails('{save!} = o');
  });

  test('a void-key pair in a destructuring pattern rejects at the emitter', () => {
    emitFails('{k!: v} = o', /void marker has no meaning in a destructuring pattern/);
  });

  test('typed void declarations are a pinned gap (`save!: Number = -> 5` — loud)', () => {
    // The TYPE claim does not read through a void marker yet, so the
    // spelling lands in the object-pair rules and rejects.
    emitFails('save!: Number = -> 5', /requires a function value/);
  });

  test('def-valued void assign rides the expression-def gap (loud)', () => {
    emitFails('save! = def f(x)\n  f(x)', /'def' is not supported in expression position/);
  });

  test('class `=!` fields reject (a void field is not a member form)', () => {
    emitFails('class A\n  f! = -> 5', /unsupported class member/);
  });
});

describe('void definitions do not async-infect their enclosing function', () => {
  test('an enclosing function with a void definition inside stays sync', () => {
    const src = 'w = ->\n  save! = (x) -> f(x)\n  save';
    // The definition-site bang is a marker, not an await: the OUTER
    // function stays sync (w() is no Promise).
    expect(compile(src)).toContain('w = function() {');
  });
});

describe('void marker mapping pins (the bang is a side-band role: exact source span, cover mapping)', () => {
  const compileFull = (src) => {
    const out = emitOf(src);
    return { code: out.code, mappings: new Mappings(out.mappings), stores: out.stores };
  };

  test('assign form: voidMarker role spans the `!`; its mapping covers the whole definition', () => {
    const src = 'save! = (x) ->\n  f(x)';
    const { code, mappings, stores } = compileFull(src);
    const [assign] = stores.nodesByKind('assign');
    const role = stores.role(assign.nodeId, 'voidMarker');
    expect(role).not.toBeNull();
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('!');
    expect(role.childSlot).toBeNull(); // side-band: no tree slot
    const [row] = mappings.of(assign.nodeId, 'voidMarker');
    expect(row.mappingKind).toBe('cover');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toContain('return;');
    // Reverse: the bang's source offset resolves (through the cover)
    // into the emitted definition.
    const back = mappings.bestAtSource(role.sourceStart);
    expect(back).not.toBeNull();
  });

  test('def form: node kind stays `def` (head void-def); the marker role rides the def node', () => {
    const src = 'def save!(x)\n  f(x)';
    const { code, mappings, stores } = compileFull(src);
    const [def] = stores.nodesByKind('def');
    expect(def).toBeDefined();
    const role = stores.role(def.nodeId, 'voidMarker');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('!');
    const [row] = mappings.of(def.nodeId, 'voidMarker');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('function save(x) {\n  f(x);\n  return;\n}');
  });

  test('method-key form: the pair node carries the marker role', () => {
    const src = 'class A\n  fn!: -> g()';
    const { code, mappings, stores } = compileFull(src);
    const pair = stores.nodes.find((n) => n.semanticKind === 'pair' && stores.role(n.nodeId, 'voidMarker'));
    expect(pair).toBeDefined();
    const role = stores.role(pair.nodeId, 'voidMarker');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('!');
    const [row] = mappings.of(pair.nodeId, 'voidMarker');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toContain('return;');
  });

  test('plain definitions carry NO voidMarker role', () => {
    const { stores } = compileFull('save = (x) ->\n  f(x)');
    const [assign] = stores.nodesByKind('assign');
    expect(stores.role(assign.nodeId, 'voidMarker')).toBeNull();
  });

  test('the void operator row is DELIBERATELY exact and serialized; plain assigns stay synthetic', () => {
    // The void-assign operator role is a label on the real `=` token:
    // glyphs match, so the row classifies EXACT and enters the
    // serialized map — a real source-map behavior, pinned here as
    // intended.
    const src = 'save! = (x) ->\n  f(x)';
    const { code, mappings, stores } = compileFull(src);
    const [assign] = stores.nodesByKind('assign');
    const [op] = mappings.of(assign.nodeId, 'operator');
    expect(op.mappingKind).toBe('exact');
    expect(src.slice(op.sourceStart, op.sourceEnd)).toBe('=');
    expect(code.slice(op.generatedStart, op.generatedEnd)).toBe('=');
    expect(mappings.serializableRows().some(
      (r) => r.role === 'operator' && r.generatedStart === op.generatedStart)).toBe(true);

    // The asymmetry, held knowingly: a PLAIN assign's operator role is
    // head-literal — synthetic, zero-width source anchor, never
    // serialized.
    const plain = compileFull('save = (x) ->\n  f(x)');
    const [pAssign] = plain.stores.nodesByKind('assign');
    const [pOp] = plain.mappings.of(pAssign.nodeId, 'operator');
    expect(pOp.mappingKind).toBe('synthetic');
    expect(pOp.sourceStart).toBe(pOp.sourceEnd);
    expect(plain.mappings.serializableRows().some((r) => r.role === 'operator')).toBe(false);

    // The void-pair's operator role records the real `:` span but has
    // NO generated manifestation (the method lowering emits no colon)
    // — a RoleStore row with zero mapping rows.
    const pairOut = compileFull('class A\n  fn!: -> g()');
    const pair = pairOut.stores.nodes.find(
      (n) => n.semanticKind === 'pair' && pairOut.stores.role(n.nodeId, 'voidMarker'));
    const pairRole = pairOut.stores.role(pair.nodeId, 'operator');
    expect('class A\n  fn!: -> g()'.slice(pairRole.sourceStart, pairRole.sourceEnd)).toBe(':');
    expect(pairOut.mappings.of(pair.nodeId, 'operator')).toHaveLength(0);
  });
});
