import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as rsx from '@rip-lang/rsx';

test('public entry exposes named exports only', () => {
  expect(Object.keys(rsx).sort()).toEqual(['RsxError', 'parse', 'stringify']);
  expect('default' in rsx).toBeFalse();
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

test('the package declares browser safety and earns it', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toEqual({ browser: true });
  const source = readFileSync(new URL('../rsx.rip', import.meta.url), 'utf8');
  expect(source).not.toMatch(/\bimport\b/);
  expect(source).not.toMatch(/\bBun\.|node:|process\.|globalThis/);
});
