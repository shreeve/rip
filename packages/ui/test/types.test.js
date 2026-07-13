import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

const sources = {
  'email/dom.rip': readFileSync(new URL('../email/dom.rip', import.meta.url), 'utf8'),
  'email/compat.rip': readFileSync(new URL('../email/compat.rip', import.meta.url), 'utf8'),
  'email/render.rip': readFileSync(new URL('../email/render.rip', import.meta.url), 'utf8'),
  'shared/render.rip': readFileSync(new URL('../shared/render.rip', import.meta.url), 'utf8'),
};

test('email package TypeScript faces and declarations are valid', () => {
  const files = {};
  for (const [name, source] of Object.entries(sources)) {
    const result = compile(source, {
      path: name,
      face: 'ts',
      runtimeDelivery: 'none',
    });
    files[`${name}.ts`] = result.code;
    files[name.replace(/\.rip$/, '.d.ts')] = result.declarations;
  }

  const checked = tscBatch(process.env.RIP_TSC ?? 'tsc', files, [
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--allowImportingTsExtensions',
    '--strict',
    '--skipLibCheck',
  ]);
  const diagnostics = [...checked.unattributed, ...[...checked.byFile.values()].flat()];
  if (checked.status !== 0) {
    throw new Error(`email package type check failed:\n${diagnostics.join('\n')}`);
  }
  expect(checked.status).toBe(0);
  expect(checked.unattributed).toEqual([]);
  expect([...checked.byFile.values()].flat()).toEqual([]);
});
