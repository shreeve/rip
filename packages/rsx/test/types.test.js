import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test('rsx package TypeScript face and declarations are valid', () => {
  const files = {
    'rsx.d.ts': readFileSync(new URL('../rsx.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { RsxError, parse, stringify, type ParseOptions, type RsxNode, type StringifyOptions } from './rsx';",
      "const doc: RsxNode = parse('<a>x</a>');",
      "const strict: RsxNode = parse('<a/>', { allowDoctype: false, forceArray: ['i'], maxBytes: 1024 });",
      "const opts: ParseOptions = { forceArray: (name: string) => name === 'i' };",
      'void parse("<a/>", opts);',
      "const xml: string = stringify('a', { b: 'x' }, { indent: 2, cdata: ['p'] });",
      "const flat: string = stringify('a', null);",
      "const sopts: StringifyOptions = { indent: '\\t', newline: '', cdata: new Set(['p']) };",
      'void stringify("a", doc, sopts);',
      "const err = new RsxError('boom', 3);",
      'const offset: number | undefined = err.offset;',
      'const isError: Error = err;',
      '// @ts-expect-error parse input is a string',
      'parse(42);',
      '// @ts-expect-error indent is a string or number',
      "stringify('a', {}, { indent: true });",
      'void doc; void strict; void xml; void flat; void offset; void isError;',
    ].join('\n'),
  };

  const source = readFileSync(new URL('../rsx.rip', import.meta.url), 'utf8');
  const face = compile(source, { path: 'rsx.rip', face: 'ts', runtimeDelivery: 'none' });
  expect(face.code.length).toBeGreaterThan(0);

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
    throw new Error(`rsx package type check failed:\n${diagnostics.join('\n')}`);
  }

  for (const name of ['parse', 'stringify']) {
    expect(files['rsx.d.ts']).toContain(`function ${name}`);
  }
  expect(files['rsx.d.ts']).toContain('class RsxError extends Error');
});
