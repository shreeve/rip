import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

const sources = {
  'email/dom.rip': readFileSync(new URL('../email/dom.rip', import.meta.url), 'utf8'),
  'email/compat.rip': readFileSync(new URL('../email/compat.rip', import.meta.url), 'utf8'),
  'email/render.rip': readFileSync(new URL('../email/render.rip', import.meta.url), 'utf8'),
  'email/email.rip': readFileSync(new URL('../email/email.rip', import.meta.url), 'utf8'),
  'shared/render.rip': readFileSync(new URL('../shared/render.rip', import.meta.url), 'utf8'),
  'shared/styles.rip': readFileSync(new URL('../shared/styles.rip', import.meta.url), 'utf8'),
  'tailwind/tailwind.rip': readFileSync(new URL('../tailwind/tailwind.rip', import.meta.url), 'utf8'),
};

const supportDeclarations = {
  'tailwind/engine.d.ts': readFileSync(new URL('../tailwind/engine.d.ts', import.meta.url), 'utf8'),
  'tailwind/inline.d.ts': readFileSync(new URL('../tailwind/inline.d.ts', import.meta.url), 'utf8'),
  'tailwind/serve.d.ts': readFileSync(new URL('../tailwind/serve.d.ts', import.meta.url), 'utf8'),
};

test('email package TypeScript faces and declarations are valid', () => {
  const files = {
    'ambient.d.ts': [
      'declare const __state: any, __computed: any, __effect: any, __batch: any;',
      'declare const __Component: any, __pushComponent: any, __popComponent: any;',
      'declare const __clsx: any, __reconcile: any, __transition: any;',
      'declare const __ownerFrame: any, __pushOwner: any, __popOwner: any;',
      'declare const __detach: any, __detachRef: any;',
      'declare const setContext: any, getContext: any;',
    ].join('\n'),
    ...supportDeclarations,
  };
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
    '--noImplicitAny',
    'false',
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
