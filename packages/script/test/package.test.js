import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as mod from '@rip-lang/script';

test('public entry exposes the pinned surface', () => {
  expect(Object.keys(mod).sort()).toEqual([
    'Script',
    'default',
    'enter',
    'prompts',
    'quote',
    'replace',
  ]);
});

test('the default export is the Script class carrying the factories', () => {
  expect(mod.default).toBe(mod.Script);
  for (const name of ['spawn', 'ssh', 'tcp', 'connect', 'trace']) {
    expect(typeof mod.Script[name]).toBe('function');
  }
});

test('package has no dependency fields', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    expect(pkg[field]).toBeUndefined();
  }
});

test('the package does not claim browser safety (it spawns PTYs and sockets)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
  const source = readFileSync(new URL('../script.rip', import.meta.url), 'utf8');
  expect(source).toContain('Bun.spawn');
  expect(source).toContain('Bun.connect');
});

test('the public type surface carries no any', () => {
  const dts = readFileSync(new URL('../script.d.ts', import.meta.url), 'utf8');
  expect(dts.match(/\bany\b/g)).toBeNull();
});
