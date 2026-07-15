import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

const moduleNames = ['source', 'stash', 'components', 'mutation', 'timing', 'routes', 'router', 'renderer', 'persist', 'launch', 'aria', 'index'];

test('app package TypeScript faces and declarations are valid', () => {
  const files = {
    'index.d.ts': readFileSync(new URL('../index.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { browserAdapter, buildRoutes, createComponents, createMutation, createRenderer, createRouter, createStash, debounce, delay, hold, launch, parseQuery, persistStash, source, throttle, unwrapStash } from './index';",
      'void launch; void persistStash;',
      "import { ariaCurrent, ownsAnchor } from './index';",
      'void ariaCurrent; void ownsAnchor;',
      "const saveUser = createMutation(async (name: string) => ({ name }), { onSuccess: r => { const s: string = r.name; void s; } });",
      "const saved: Promise<{ name: string } | undefined> = saveUser('Ada');",
      'const busy: boolean = saveUser.pending;',
      "const delayed = delay(100, { value: false });",
      'const shown: boolean = delayed.value;',
      'delayed.dispose();',
      "const settled = debounce(100, () => 'q');",
      "const held = hold(100, { value: true });",
      "held.value = true;",
      "const smooth = throttle(100, () => 0);",
      '// @ts-expect-error a function-source timed signal is read-only',
      'smooth.value = 1;',
      'void saved; void busy; void shown; void settled; void held; void smooth;',
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
      "const fake = { read: () => '/', push(u: string, s: unknown) {}, replace(u: string, s: unknown) {}, go(d: number) {}, listen: (fn: () => void) => () => {}, scroll: { save: () => ({ y: 0 }), watch: (fn: () => void) => () => {} } };",
      'const router = createRouter({ routes: routesManifest, adapter: fake });',
      "const pushed: boolean = router.init().push('/', { noScroll: true });",
      'const currentFile: string | undefined = router.current?.route.file;',
      'router.navigating = true;',
      '// @ts-expect-error current is read-only',
      'router.current = null;',
      'void browserAdapter;',
      "const routeFile: string | undefined = routesManifest.match('/')?.route.file;",
      "const query: Record<string, string> = parseQuery('?a=1');",
      '// @ts-expect-error manifest routes are read-only',
      'routesManifest.routes.push(routesManifest.routes[0]);',
      'const components = createComponents();',
      "components.write('app.rip', 'export App = component');",
      "const renderer = createRenderer({ router: { current: null }, app: { data }, components, target: { appendChild: node => node }, onError: failure => { const status: number = failure.status; void status; } });",
      "const mounted: Promise<unknown> = renderer.mount({ route: { file: 'app.rip' } });",
      'void maybeUser; void id; void maybeSignaled; void maybeKeyedSignaled; void ensured; void preloaded; void refetched; void peeked; void orderRead; void routeFile; void query; void pushed; void currentFile; void components; void mounted;',
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
  expect(files['index.d.ts']).toContain('function createRouter');
  expect(files['index.d.ts']).toContain('function browserAdapter');
  expect(files['index.d.ts']).toContain('function createMutation');
  expect(files['index.d.ts']).toContain('function delay');
});
