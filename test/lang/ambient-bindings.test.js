// The ambientBindings compile option — the REPL's cross-line seam.
// Each REPL line compiles as a fresh program; without seeding, a line
// after `x := 5` reads a plain `x` (no signal access) and `x = 3`
// silently severs the signal — the silent-miscompile class. Seeding
// `[{name, kind}]` from prior lines makes reads/writes emit exactly
// as if the declaration were in-file: reactive names unwrap `.value`,
// readonly writes reject positioned, seeded names never re-hoist, and
// minted temps dodge them.
import { describe, test, expect } from 'bun:test';
import { compile, CompileError } from '../../src/compile.js';

const seeded = (src, bindings, opts = {}) =>
  compile(src, { runtimeDelivery: 'none', ambientBindings: bindings, ...opts });

describe('seeded state: reads and writes emit signal access', () => {
  test('x + 1 under a seeded state x reads x.value', () => {
    const r = seeded('x + 1', [{ name: 'x', kind: 'state' }]);
    expect(r.code).toBe('x.value + 1;');
  });

  test('x = 3 under a seeded state x writes x.value (never a fresh let)', () => {
    const r = seeded('x = 3', [{ name: 'x', kind: 'state' }]);
    expect(r.code).toBe('x.value = 3;');
  });

  test('seeded emission matches the in-file emission byte-for-byte', () => {
    const inFile = compile('x := 5\nx + 1\nx = 3', { runtimeDelivery: 'none' }).code;
    const line2 = seeded('x + 1\nx = 3', [{ name: 'x', kind: 'state' }]).code;
    expect(inFile.endsWith(line2)).toBe(true);
  });

  test('compound write and update unwrap the container', () => {
    expect(seeded('x += 2', [{ name: 'x', kind: 'state' }]).code).toBe('x.value += 2;');
    expect(seeded('x++', [{ name: 'x', kind: 'state' }]).code).toBe('(x.value++);');
  });

  test('a nested function sees the seeded state (no shadow-hoist)', () => {
    const r = seeded('f = -> x = 3', [{ name: 'x', kind: 'state' }]);
    expect(r.code).toContain('x.value = 3');
    expect(r.code).not.toMatch(/let x\b/);
  });
});

describe('seeded computed and readonly: writes reject positioned', () => {
  test('a seeded computed write rejects', () => {
    expect(() => seeded('b = 9', [{ name: 'b', kind: 'computed' }]))
      .toThrow(/cannot assign to computed 'b'/);
  });

  test('a seeded readonly write rejects positioned', () => {
    let err = null;
    try {
      seeded('k = 9', [{ name: 'k', kind: 'readonly' }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err.message).toMatch(/cannot assign to readonly 'k'/);
    expect(err.start).toBe(0);
    expect(err.line).toBe(1);
  });

  test('seeded readonly compound and update writes reject too', () => {
    expect(() => seeded('k += 1', [{ name: 'k', kind: 'readonly' }]))
      .toThrow(/cannot assign to readonly 'k'/);
    expect(() => seeded('k++', [{ name: 'k', kind: 'readonly' }]))
      .toThrow(/cannot assign to readonly 'k'/);
  });

  test('a seeded readonly READ stays a plain read', () => {
    expect(seeded('k + 1', [{ name: 'k', kind: 'readonly' }]).code).toBe('k + 1;');
  });
});

describe('seeded plain/class/def/import: bindings persist, never re-hoist', () => {
  test('a write to a seeded plain name emits bare (no let hoist)', () => {
    const r = seeded('q = 3', [{ name: 'q', kind: 'plain' }]);
    expect(r.code).toBe('q = 3;');
  });

  test('a read of a seeded plain name stays plain', () => {
    expect(seeded('q + 1', [{ name: 'q', kind: 'plain' }]).code).toBe('q + 1;');
  });

  test('seeded class/def/import names read plain and suppress hoisting', () => {
    const r = seeded('r = new Foo(g(z))', [
      { name: 'Foo', kind: 'class' },
      { name: 'g', kind: 'def' },
      { name: 'z', kind: 'import' },
    ]);
    expect(r.code).toContain('r = new Foo(g(z));');
    expect(r.code).not.toMatch(/let (Foo|g|z)\b/);
  });
});

describe('in-file redeclaration shadows the seed', () => {
  test('x := 5 in-file wins over a seeded plain x', () => {
    const r = seeded('x := 5\nx + 1', [{ name: 'x', kind: 'plain' }]);
    expect(r.code).toContain('const x = __state(5);');
    expect(r.code).toContain('x.value + 1;');
  });

  test('a plain redeclaration (k =! 5) shadows a seeded state k', () => {
    const r = seeded('k =! 5\nk + 1', [{ name: 'k', kind: 'state' }]);
    expect(r.code).toContain('const k = 5;');
    expect(r.code).toContain('k + 1;');
    expect(r.code).not.toContain('k.value');
  });
});

describe('seeded names join the used-name registry and the bound set', () => {
  test('a minted chain temp dodges a seeded name', () => {
    // A chained comparison with a non-repeat-safe middle mints _ref.
    const free = compile('1 < f() < 3', { runtimeDelivery: 'none' }).code;
    expect(free).toMatch(/\b_ref\b/);
    const r = seeded('1 < f() < 3', [{ name: '_ref', kind: 'plain' }]);
    expect(r.code).not.toMatch(/\b_ref\b/);
    expect(r.code).toMatch(/\b_ref1\b/);
  });

  test('a seeded binding of a runtime name suppresses the injection shadow', () => {
    // In-file, a user binding named __state forces the delivered alias
    // to dodge (`__state_`); a seeded binding must behave identically.
    const inFile = compile('__state = 5\ny := 1', { runtimeDelivery: 'inline' }).code;
    expect(inFile).toContain('__state: __state_');
    const r = seeded('y := 1', [{ name: '__state', kind: 'plain' }], { runtimeDelivery: 'inline' });
    expect(r.code).toContain('__state: __state_');
    expect(r.code).toContain('const y = __state_(1);');
  });
});

describe('identifier vocabulary and the readonly contract', () => {
  test('a Unicode identifier seeds — the lexer identifier vocabulary, never an ASCII-only guess', () => {
    const r = seeded('café + 1', [{ name: 'café', kind: 'state' }]);
    expect(r.code).toBe('café.value + 1;');
    // The full REPL round-trip: declare, inventory, reseed.
    const first = compile('café := 1', { runtimeDelivery: 'none' });
    expect(first.bindings).toEqual([{ name: 'café', kind: 'state' }]);
    const next = compile('café = 2', { runtimeDelivery: 'none', ambientBindings: first.bindings });
    expect(next.code).toBe('café.value = 2;');
  });

  test('the readonly contract: direct writes reject at compile time; pattern writes keep the const-restore backstop', () => {
    // Deliberately stricter than in-file for DIRECT writes (the
    // positioned rejection fires before any entry side effect); a
    // PATTERN element emits bare and relies on the environment
    // restoring readonly kinds as const — JS's own TypeError, the
    // same backstop in-file readonly writes use.
    expect(() => seeded('k = 1', [{ name: 'k', kind: 'readonly' }]))
      .toThrow(/cannot assign to readonly 'k'/);
    const r = seeded('[k, y] = pair', [{ name: 'k', kind: 'readonly' }]);
    expect(r.code).toContain('[k, y] = pair');
  });
});

describe('option validation rejects loudly', () => {
  test('an unknown kind rejects', () => {
    expect(() => seeded('1', [{ name: 'x', kind: 'bogus' }]))
      .toThrow(/ambientBindings/);
  });

  test('a non-identifier name rejects', () => {
    expect(() => seeded('1', [{ name: 'not a name', kind: 'plain' }]))
      .toThrow(/ambientBindings/);
  });

  test('a duplicate name rejects', () => {
    expect(() => seeded('1', [{ name: 'x', kind: 'plain' }, { name: 'x', kind: 'state' }]))
      .toThrow(/ambientBindings/);
  });
});
