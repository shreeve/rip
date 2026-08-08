import { describe, expect, test } from 'bun:test';
import { compile } from '../../src/compile.js';
import * as reactive from '../../src/runtime/reactive.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const run = (source, tail = 'return undefined;') => {
  const { code } = compile(source, { runtimeDelivery: 'none' });
  const names = Object.keys(reactive);
  const body = `${code}\n${tail}`;
  if (/\bawait\b/.test(body)) {
    return new AsyncFunction(...names, body)(...names.map((n) => reactive[n]));
  }
  return new Function(...names, body)(...names.map((n) => reactive[n]));
};

describe('generated JavaScript validity under composed lowerings', () => {
  test('generator control composes with optional compounds and nested comprehensions', () => {
    const out = run([
      'calls = 0',
      'get = ->',
      '  calls += 1',
      '  {nums: [9]}',
      'build = ->',
      '  box = get()',
      '  written = (box?.nums[0] //= yield 3)',
      '  nested = ((x + y for x in [1, 2]) for y in [10, 20])',
      '  [written, box.nums[0], nested, calls]',
      'g = build()',
      'first = g.next().value',
      'last = g.next(3).value',
      '',
    ].join('\n'), 'return [first, last];');
    expect(out).toEqual([3, [3, 3, [[11, 12], [21, 22]], 1]]);
  });

  test('async functions compose with value lowerings and class-field captures', async () => {
    const out = await run([
      'reads = 0',
      'make = ->',
      '  reads += 1',
      '  {x: 9}',
      'class Box',
      '  value = make().x //= 2',
      'choose = ->',
      '  box = Box.new()',
      '  assigned = (box?.value = Promise.resolve!(7))',
      '  if assigned > 0',
      '    [assigned, box.value, reads]',
      '  else',
      '    []',
      'out = choose!',
      '',
    ].join('\n'), 'return out;');
    expect(out).toEqual([7, 7, 1]);
  });

  test('effects compose with class fields and comprehension values in one runtime process', () => {
    const out = run([
      'source := 2',
      'seen = []',
      'class Scale',
      '  values = ((x * y for x in [1, 2]) for y in [source, source + 1])',
      'box = Scale.new()',
      'dispose = ~> seen.push([source, box.values])',
      'source = 4',
      'dispose()',
      '',
    ].join('\n'), 'return seen;');
    expect(out).toEqual([[2, [[2, 4], [3, 6]]], [4, [[2, 4], [3, 6]]]]);
  });
});

describe('illegal generated-scope compositions reject before JavaScript execution', () => {
  const cases = [
    {
      name: 'yield-value-comprehension.rip',
      source: 'build = ->\n  out = (yield x for x in [1, 2])\n  out\n',
      line: 2,
      col: 10,
      message: /yield inside an expression-lowered construct cannot cross the IIFE boundary/,
    },
    {
      name: 'await-computed.rip',
      source: 'load = -> Promise.resolve(1)\nvalue ~= load!\n',
      line: 2,
      col: 1,
      message: /computed .* body cannot await/,
    },
    {
      name: 'yield-effect.rip',
      source: 'build = ->\n  ~> yield 1\n',
      line: 2,
      col: 3,
      message: /effect .* body cannot yield/,
    },
    {
      name: 'await-render.rip',
      source: 'load = -> Promise.resolve("x")\nApp = component\n  render\n    div = load!\n',
      line: 4,
      col: 11,
      message: /render body evaluates synchronously/,
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const error = (() => {
        let caught;
        try {
          compile(c.source, { path: c.name, runtimeDelivery: 'none' });
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeDefined();
        return caught;
      })();
      expect(error.message).toContain(`${c.name}:${c.line}:${c.col}`);
      expect(error.message).toMatch(c.message);
      expect(error.message).not.toMatch(/SyntaxError|Cannot use ['"]?(?:yield|await)/);
    });
  }
});
