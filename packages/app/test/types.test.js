import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

const moduleNames = ['source', 'stash', 'components', 'routes', 'renderer', 'index'];

test('app package TypeScript faces and declarations are valid', () => {
  const files = {
    'index.d.ts': readFileSync(new URL('../index.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { buildRoutes, createComponents, createRenderer, createStash, parseQuery, source, unwrapStash } from './index';",
      "const user = source({ fetch: async () => ({ name: 'Ada' }) });",
      "const order = source({ fetch: async (id: string) => ({ id }) });",
      "const signaled = source({ kind: 'singleton', fetch: async (signal?: AbortSignal) => ({ ok: !signal?.aborted }) });",
      "const keyedSignaled = source({ kind: 'keyed', fetch: async (id: string, signal?: AbortSignal) => ({ id, ok: !signal?.aborted }) });",
      'const data = createStash({ user, order, signaled, keyedSignaled });',
      'const maybeUser: { name: string } | null = data.user;',
      "const id: string | undefined = data.order('o1')?.id;",
      'const maybeSignaled: { ok: boolean } | null = data.signaled;',
      "const maybeKeyedSignaled: { id: string, ok: boolean } | null = data.keyedSignaled('o1');",
      '// @ts-expect-error explicit keyed source preserves its string key',
      'data.keyedSignaled(123);',
      'const raw = unwrapStash(data);',
      'const ensured: Promise<{ name: string } | undefined> = raw.user.ensure();',
      'const preloaded: Promise<{ name: string } | null | undefined> = raw.user.preload();',
      'const refetched: Promise<{ name: string } | undefined> = raw.user.refetch();',
      'const peeked: { name: string } | null = raw.user.peek();',
      "const orderCell = raw.order.cellFor('o1');",
      'const orderRead: { id: string } | null = orderCell.read();',
      '// @ts-expect-error reset or supersession can resolve ensure without a value',
      'const dishonestEnsure: Promise<{ name: string }> = raw.user.ensure();',
      '// @ts-expect-error reset or supersession can resolve preload without a value',
      'const dishonestPreload: Promise<{ name: string }> = raw.user.preload();',
      '// @ts-expect-error reset or supersession can resolve refetch without a value',
      'const dishonestRefetch: Promise<{ name: string }> = raw.user.refetch();',
      '// @ts-expect-error normal stash reads expose values, not cells',
      'data.user.ensure();',
      '// @ts-expect-error optional syntax has runtime arity one and would be keyed',
      'source({ fetch: async (signal?: AbortSignal) => ({ aborted: signal?.aborted }) });',
      '// @ts-expect-error explicit singleton accepts zero or one signal parameter',
      "source({ kind: 'singleton', fetch: async (first: string, second: number) => ({ first, second }) });",
      '// @ts-expect-error explicit keyed source requires a key parameter',
      "source({ kind: 'keyed', fetch: async () => ({ id: 'missing' }) });",
      '// @ts-expect-error source fetch supports only [] or [K]',
      'source({ fetch: async (first: string, second: number) => ({ first, second }) });',
      "const routesManifest = buildRoutes(['_route/index.rip']);",
      "const routeFile: string | undefined = routesManifest.match('/')?.route.file;",
      "const query: Record<string, string> = parseQuery('?a=1');",
      '// @ts-expect-error manifest routes are read-only',
      'routesManifest.routes.push(routesManifest.routes[0]);',
      'const components = createComponents();',
      "components.write('app.rip', 'export App = component');",
      "const renderer = createRenderer({ router: { current: null }, app: { data }, components, target: { appendChild: node => node }, onError: failure => { const status: number = failure.status; void status; } });",
      "const mounted: Promise<unknown> = renderer.mount({ route: { file: 'app.rip' } });",
      'void maybeUser; void id; void maybeSignaled; void maybeKeyedSignaled; void ensured; void preloaded; void refetched; void peeked; void orderRead; void routeFile; void query; void components; void mounted;',
    ].join('\n'),
  };

  for (const name of moduleNames) {
    const path = `${name}.rip`;
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const result = compile(source, {
      path,
      face: 'ts',
      runtimeDelivery: 'none',
    });
    expect(result.code.length).toBeGreaterThan(0);
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
    throw new Error(`app package type check failed:\n${diagnostics.join('\n')}`);
  }

  expect(files['index.d.ts']).toContain('function source');
  expect(files['index.d.ts']).toContain('function createStash');
  expect(files['index.d.ts']).toContain('function unwrapStash');
  expect(files['index.d.ts']).toContain('function createComponents');
  expect(files['index.d.ts']).toContain('function createRenderer');
  expect(files['index.d.ts']).toContain('function buildRoutes');
  expect(files['index.d.ts']).toContain('function parseQuery');
});
