import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as db from '@rip-lang/db';

test('public entry exposes named exports only', () => {
  expect(Object.keys(db).sort()).toEqual([
    'CancelledError',
    'ConnectionError',
    'DbError',
    'QueryError',
    'createClient',
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

test('the package modules touch no host runtime beyond the injectable fetch', () => {
  for (const module of ['adapter.rip', 'client.rip', 'index.rip']) {
    const source = readFileSync(new URL(`../${module}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bBun\.|node:/);
  }
  // adapter.rip is self-contained; client.rip imports only from the package itself.
  expect(readFileSync(new URL('../adapter.rip', import.meta.url), 'utf8')).not.toMatch(/import .* from/);
});
