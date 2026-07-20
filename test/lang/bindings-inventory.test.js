// The binding inventory on the compile result: `result.bindings` is
// `[{name, kind}]` for the program's top-level scope, lifted from the
// emitter's own scope walks (programScopeNames' constituents) — never
// scanned out of generated JS. This is the REPL's `.vars` data and
// the ambient seed for its next line, so the kind vocabulary is
// exactly the ambientBindings vocabulary.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';

const bindingsOf = (src) => compile(src, { runtimeDelivery: 'none' }).bindings;
const byName = (list) => Object.fromEntries(list.map(({ name, kind }) => [name, kind]));

describe('result.bindings reports every top-level binding with its kind', () => {
  test('one program exercising every kind', () => {
    const src = [
      'import { z, w as v } from "./m.js"',
      'import * as ns from "./n.js"',
      'import dflt from "./d.js"',
      'count := 0',
      'doubled ~= count * 2',
      'watcher ~> console.log(count)',
      'frozen =! 42',
      'class Foo',
      'def g(n)',
      '  n',
      'enum Color',
      '  red = 1',
      'plainOne = 9',
      '[a, b] = [1, 2]',
    ].join('\n');
    expect(byName(bindingsOf(src))).toEqual({
      z: 'import', v: 'import', ns: 'import', dflt: 'import',
      count: 'state',
      doubled: 'computed',
      watcher: 'effect',
      frozen: 'readonly',
      Foo: 'class',
      g: 'def',
      Color: 'enum',
      plainOne: 'plain',
      a: 'plain', b: 'plain',
    });
  });

  test('exported declarations report the same kinds', () => {
    const src = [
      'export count := 0',
      'export doubled ~= count * 2',
      'export frozen =! 1',
      'export h ~> console.log(count)',
      'export class Bar',
      'export def f(x)',
      '  x',
      'export q = 5',
    ].join('\n');
    expect(byName(bindingsOf(src))).toEqual({
      count: 'state', doubled: 'computed', frozen: 'readonly', h: 'effect',
      Bar: 'class', f: 'def', q: 'plain',
    });
  });

  test('a nested-position write still reports its plain binding', () => {
    expect(byName(bindingsOf('if x\n  y = 1'))).toEqual({ y: 'plain' });
  });

  test('function-scope bindings never leak into the program inventory', () => {
    expect(byName(bindingsOf('f = ->\n  inner = 1\n  inner'))).toEqual({ f: 'plain' });
  });

  test('unconditional: an empty program reports an empty inventory', () => {
    expect(bindingsOf('1 + 1')).toEqual([]);
  });

  test('reads bind nothing', () => {
    expect(bindingsOf('console.log(x)')).toEqual([]);
  });

  test('the inventory round-trips as the next line ambient seed', () => {
    const first = compile('x := 5', { runtimeDelivery: 'none' });
    const next = compile('x + 1', { runtimeDelivery: 'none', ambientBindings: first.bindings });
    expect(next.code).toBe('x.value + 1;');
  });

  test('a plain WRITE to an ambient name binds nothing — the seed keeps its kind', () => {
    // The write targets the seeded binding (its hoist is suppressed);
    // reporting it as a plain binding would downgrade a state seed on
    // the round-trip and silently sever the signal two lines later.
    const w = compile('x = 3', { runtimeDelivery: 'none', ambientBindings: [{ name: 'x', kind: 'state' }] });
    expect(w.bindings).toEqual([]);
    // A REDECLARATION of the ambient name is a real shadow and reports.
    const d = compile('x =! 3', { runtimeDelivery: 'none', ambientBindings: [{ name: 'x', kind: 'state' }] });
    expect(d.bindings).toEqual([{ name: 'x', kind: 'readonly' }]);
    const e = compile('export x = 3', { runtimeDelivery: 'none', ambientBindings: [{ name: 'x', kind: 'state' }] });
    expect(e.bindings).toEqual([{ name: 'x', kind: 'plain' }]);
  });
});
