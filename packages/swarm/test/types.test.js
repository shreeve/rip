import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test.skip('swarm package TypeScript face and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {
  const files = {
    'swarm.d.ts': readFileSync(new URL('../swarm.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { swarm, init, retry, todo, args, _getPerform, type SwarmOptions, type Context, type Perform } from './swarm';",
      'init();',
      'const queued: boolean = retry();',
      "todo('task-1');",
      "todo(42, { a: 1 });",
      "todo('task-2', 'payload');",
      'const rest: string[] = args();',
      'const perform: Perform = (taskPath: string, ctx: Context) => {',
      '  const safe: boolean = ctx.safe;',
      '  void safe; void taskPath;',
      '};',
      "const opts: SwarmOptions = { perform, setup: () => ({ token: 'x' }), workers: 4, bar: 30, char: '#' };",
      'const running: Promise<void> = swarm(opts);',
      'const registered: Perform | null = _getPerform();',
      '// @ts-expect-error perform is required',
      'const bad: SwarmOptions = { setup: () => null };',
      '// @ts-expect-error a task name is a string or number',
      'todo({});',
      '// @ts-expect-error args takes no arguments',
      "args('x');",
      'void queued; void rest; void running; void registered; void bad;',
    ].join('\n'),
  };

  const source = readFileSync(new URL('../swarm.rip', import.meta.url), 'utf8');
  const result = compile(source, {
    path: 'swarm.rip',
    face: 'ts',
    runtimeDelivery: 'none',
  });
  expect(result.code.length).toBeGreaterThan(0);

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
    throw new Error(`swarm package type check failed:\n${diagnostics.join('\n')}`);
  }
});
