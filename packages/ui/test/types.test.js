import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

const sources = {
  'email/dom.rip': readFileSync(new URL('../email/dom.rip', import.meta.url), 'utf8'),
  'email/compat.rip': readFileSync(new URL('../email/compat.rip', import.meta.url), 'utf8'),
  'email/render.rip': readFileSync(new URL('../email/render.rip', import.meta.url), 'utf8'),
  'email/email.rip': readFileSync(new URL('../email/email.rip', import.meta.url), 'utf8'),
  'email/components.rip': readFileSync(new URL('../email/components.rip', import.meta.url), 'utf8'),
  'shared/render.rip': readFileSync(new URL('../shared/render.rip', import.meta.url), 'utf8'),
  'shared/styles.rip': readFileSync(new URL('../shared/styles.rip', import.meta.url), 'utf8'),
  'tailwind/tailwind.rip': readFileSync(new URL('../tailwind/tailwind.rip', import.meta.url), 'utf8'),
};

// Minimal stubs for the plain-JS Tailwind helpers (their .d.ts companions were
// removed with the package typing deferral). Enough for the Rip face to check.
const supportDeclarations = {
  'tailwind/engine.d.ts': [
    'export type TailwindConfig = Record<string, unknown>;',
    'export interface TailwindCompilation { css: string; styleSheet: unknown }',
    'export function configCacheKey(config?: TailwindConfig): string;',
    'export function prepareConfig(config?: TailwindConfig): Promise<unknown>;',
    'export function compile(classes?: string[], config?: TailwindConfig): TailwindCompilation;',
  ].join('\n'),
  'tailwind/inline.d.ts': [
    'export function inlineEmailTree(tree: unknown, config?: Record<string, unknown>): unknown;',
    'export function registerEmailTailwindRoot(component: unknown, config?: Record<string, unknown>): void;',
    'export function takeEmailTailwindRoots(): Array<{ component: unknown, config: Record<string, unknown> }>;',
  ].join('\n'),
  'tailwind/serve.d.ts': [
    'export function generateBrowserCss(classes?: string[], config?: Record<string, unknown>): string;',
  ].join('\n'),
};

test.skip('email package TypeScript faces and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {
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
  for (const name of [
    'compile',
    'prepareConfig',
    'configKey',
    'inlineEmailTree',
    'registerEmailTailwindRoot',
    'takeEmailTailwindRoots',
    'generateBrowserCss',
  ]) {
    expect(files['tailwind/tailwind.d.ts']).toContain(`function ${name}`);
  }
});
