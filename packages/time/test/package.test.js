import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as mod from '@rip-lang/time';

test('public entry exposes the pinned surface', () => {
  expect(Object.keys(mod).sort()).toEqual([
    'Duration',
    'Time',
    'age',
    'default',
    'isDuration',
    'isTime',
    'time',
  ]);
});

test('the default export is the callable factory carrying the statics', () => {
  expect(mod.default).toBe(mod.time);
  expect(mod.default('2026-04-19')).toBeInstanceOf(mod.Time);
  for (const name of [
    'utc',
    'parse',
    'tz',
    'unix',
    'isTime',
    'isDuration',
    'duration',
    'min',
    'max',
  ]) {
    expect(typeof mod.default[name]).toBe('function');
  }
  expect(mod.default.Time).toBe(mod.Time);
  expect(mod.default.Duration).toBe(mod.Duration);
  expect(typeof mod.default.tz.guess).toBe('function');
  expect(typeof mod.default.tz.aliases).toBe('object');
  expect(mod.default.version).toBe('1.0.0');
});

test('the package carries no runtime dependencies; dayjs is the test oracle only', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
  expect(pkg.devDependencies).toEqual({ dayjs: '1.11.20' });
  expect(pkg.files).not.toContain('test');
});

test('the package declares browser safety and earns it', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toEqual({ browser: true });
  const source = readFileSync(new URL('../time.rip', import.meta.url), 'utf8');
  expect(source).not.toMatch(/^\s*import\b/m);
  expect(source).not.toMatch(/\bBun\.|node:|process\.|globalThis/);
});

test('the public surface carries no any', () => {
  const dts = readFileSync(new URL('../index.d.ts', import.meta.url), 'utf8');
  expect(dts).not.toMatch(/\bany\b/);
});
