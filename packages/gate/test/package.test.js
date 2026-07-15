import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as pkg from '@rip-lang/gate';

test('public entry exposes named exports only', () => {
  expect(Object.keys(pkg).sort()).toEqual(['gate']);
  expect('default' in pkg).toBeFalse();
});

test('package has no dependency fields', () => {
  // v3 declared "@rip-lang/server": "workspace:^"; in v4 the middleware is
  // pure over the server's context contract and imports nothing at runtime.
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

test('the package does not claim browser safety (it owns a session dir on disk)', () => {
  const meta = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(meta.rip).toBeUndefined();
  const source = readFileSync(new URL('../index.rip', import.meta.url), 'utf8');
  expect(source).toContain("from 'node:fs'");
});
