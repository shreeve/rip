import { expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import * as x12 from '@rip-lang/x12';

test('public entry exposes named exports only', () => {
  expect(Object.keys(x12).sort()).toEqual(['ISA_WIDTHS', 'SELECTOR', 'X12']);
  expect('default' in x12).toBeFalse();
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

test('the package does not claim browser safety (it reads the filesystem)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
  const source = readFileSync(new URL('../x12.rip', import.meta.url), 'utf8');
  expect(source).toContain("from 'fs'");
});

test('the rip-x12 bin is declared and executable', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.bin).toEqual({ 'rip-x12': './bin/rip-x12' });
  const mode = statSync(new URL('../bin/rip-x12', import.meta.url)).mode;
  expect(mode & 0o111).not.toBe(0);
});
