import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as server from '@rip-lang/server';

test('public entry exposes named exports only', () => {
  expect(Object.keys(server).sort()).toEqual([
    'compose',
    'cors',
    'createContext',
    'createMatcher',
    'errorEnvelope',
    'logger',
    'openapi',
    'parseQuery',
    'reading',
    'respond',
    'withInput',
  ]);
  expect('default' in server).toBeFalse();
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

test('the package is server-only: browser safety is never declared', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
});

test('the pure modules use no host APIs', () => {
  for (const module of ['router.rip', 'context.rip', 'middleware.rip', 'builtin.rip', 'input.rip', 'openapi.rip', 'index.rip']) {
    const source = readFileSync(new URL(`../${module}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bBun\.|node:|process\.|fetch\(/);
  }
});
