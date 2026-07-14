import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as validate from '@rip-lang/validate';

test('public entry exposes named exports only', () => {
  expect(Object.keys(validate).sort()).toEqual([
    'check',
    'formatMoney',
    'getValidator',
    'isBlank',
    'registerValidator',
    'toName',
    'toPhone',
    'validatorNames',
  ]);
  expect('default' in validate).toBeFalse();
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

test('the vocabulary uses no host APIs', () => {
  for (const module of ['registry.rip', 'index.rip']) {
    const source = readFileSync(new URL(`../${module}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\bBun\.|node:|process\.|globalThis/);
  }
});
