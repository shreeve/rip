import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as decimal from '@rip-lang/decimal';

test('public entry exposes named exports only', () => {
  expect(Object.keys(decimal).sort()).toEqual([
    'D',
    'Decimal',
    'DecimalDivisionByZeroError',
    'DecimalError',
    'DecimalInexactError',
    'DecimalInvalidOperationError',
    'DecimalNonTerminatingError',
    'DecimalParseError',
    'DecimalRangeError',
    'DecimalResourceLimitError',
    'DecimalUnsafeConversionError',
  ]);
  expect('default' in decimal).toBeFalse();
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
});

test('the value core uses no host APIs and no imports', () => {
  const source = readFileSync(new URL('../decimal.rip', import.meta.url), 'utf8');
  expect(source).not.toMatch(/\bimport\b/);
  expect(source).not.toMatch(/\bBun\.|node:|process\.|globalThis/);
});
