import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as db from '@rip-lang/db';

test('public entry exposes named exports only', () => {
  expect(Object.keys(db).sort()).toEqual([
    'ConnectionError',
    'DbError',
    'QueryError',
    'harborAdapter',
    'isDbError',
  ]);
  expect('default' in db).toBeFalse();
});

test('package has no dependency fields — the harbor endpoint is external', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
});

test('the adapter is server-only: browser safety is never declared', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
});

test('the adapter reaches the harbor only through the injectable fetch', () => {
  const source = readFileSync(new URL('../adapter.rip', import.meta.url), 'utf8');
  // No hard-coded host runtime — fetch is injected, nothing else touches the network.
  expect(source).not.toMatch(/\bBun\.|node:|import .* from/);
});
