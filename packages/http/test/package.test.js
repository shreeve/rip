import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as pkg from '@rip-lang/http';

test('public entry exposes named exports only', () => {
  expect(Object.keys(pkg).sort()).toEqual(['HTTPError', 'TimeoutError', 'http']);
  expect('default' in pkg).toBeFalse();
});

test('package has no dependency fields', () => {
  const meta = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    expect(meta[field]).toBeUndefined();
  }
});

test('the package declares browser safety', () => {
  const meta = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(meta.rip).toEqual({ browser: true });
});
