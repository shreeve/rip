import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test.skip('csv package TypeScript face and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {
  const files = {
    'csv.d.ts': readFileSync(new URL('../csv.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { CSV, type ReadOptions, type WriteOptions, type Writer } from './csv';",
      "const rows: string[][] = CSV.read('a,b\\n1,2\\n');",
      "const objs: Array<Record<string, string>> = CSV.read('a,b\\n1,2\\n', { headers: true });",
      "const count: number = CSV.read('a,b\\n1,2\\n', { each: (row, index) => index < 10 });",
      "const out: string = CSV.write([['a', 'b'], [1, null]]);",
      "const line: string = CSV.formatRow(['a', 'b,c']);",
      "const w: Writer = CSV.writer({ sep: '\\t', mode: 'full' });",
      "const one: string = w.row(['1', '2']);",
      "const all: string = w.rows([['1'], ['2']]);",
      "const loaded: Promise<string[][]> = CSV.load('data.csv');",
      "const saved: Promise<number> = CSV.save('out.csv', [['a']], { zeros: true });",
      "const opts: ReadOptions = { sep: ';', relax: true, excel: true, strip: true };",
      '// @ts-expect-error mode is compact or full',
      "const bad: WriteOptions = { mode: 'nope' };",
      '// @ts-expect-error read takes a string',
      'CSV.read(42);',
      'void rows; void objs; void count; void out; void line; void one; void all;',
      'void loaded; void saved; void opts; void bad;',
    ].join('\n'),
  };

  const result = compile(readFileSync(new URL('../csv.rip', import.meta.url), 'utf8'), {
    path: 'csv.rip',
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
    throw new Error(`csv package type check failed:\n${diagnostics.join('\n')}`);
  }
});
