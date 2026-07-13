import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const bin = join(root, 'bin/rip');
let dir;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rip-generated-validity-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const run = (name, source) => {
  const file = join(dir, name);
  writeFileSync(file, source);
  return spawnSync('bun', [bin, file], { cwd: root, encoding: 'utf8' });
};

describe('generated JavaScript validity under composed lowerings', () => {
  test('generator control composes with optional compounds and nested comprehensions', () => {
    const r = run('generator-composition.rip', [
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
      'p JSON.stringify([first, last])',
      '',
    ].join('\n'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe('[3,[3,3,[[11,12],[21,22]],1]]\n');
  });

  test('async functions compose with value lowerings and class-field captures', () => {
    const r = run('async-class-composition.rip', [
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
      'p JSON.stringify(out)',
      '',
    ].join('\n'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe('[7,7,1]\n');
  });

  test('effects compose with class fields and comprehension values in one runtime process', () => {
    const r = run('effect-composition.rip', [
      'source := 2',
      'seen = []',
      'class Scale',
      '  values = ((x * y for x in [1, 2]) for y in [source, source + 1])',
      'box = Scale.new()',
      'dispose = ~> seen.push([source, box.values])',
      'source = 4',
      'dispose()',
      'p JSON.stringify(seen)',
      '',
    ].join('\n'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe('[[2,[[2,4],[3,6]]],[4,[[2,4],[3,6]]]]\n');
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
      const r = run(c.name, c.source);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain(`${c.name}:${c.line}:${c.col}`);
      expect(r.stderr).toMatch(c.message);
      expect(r.stderr).not.toMatch(/SyntaxError|Cannot use ['"]?(?:yield|await)/);
    });
  }
});
