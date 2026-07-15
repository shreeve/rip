import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as csv from '@rip-lang/csv';

test('public entry exposes named exports only', () => {
  expect(Object.keys(csv).sort()).toEqual(['CSV']);
  expect('default' in csv).toBeFalse();
});

test('the CSV surface carries exactly the documented members', () => {
  expect(Object.keys(csv.CSV).sort()).toEqual([
    'formatRow',
    'load',
    'read',
    'save',
    'write',
    'writer',
  ]);
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

test('the package does not claim browser safety: load/save use Bun file APIs', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
});
