import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test('decimal package TypeScript face and declarations are valid', () => {
  const files = {
    'decimal.d.ts': readFileSync(new URL('../decimal.d.ts', import.meta.url), 'utf8'),
    'coercers.d.ts': readFileSync(new URL('../coercers.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { D, Decimal, DecimalError, DecimalInexactError, type DecimalLike, type RoundingMode } from './decimal';",
      "import { registerDecimalCoercer } from './coercers';",
      "const price: Decimal = D`19.99`;",
      "const total: Decimal = price.mul(Decimal.from(3)).add('0.99');",
      "const mode: RoundingMode = 'HALF_EVEN';",
      "const cents: number = total.toCentsNumber(mode);",
      "const units: bigint = total.toScaledInteger(2, 'HALF_UP');",
      "const like: DecimalLike = 42n;",
      "const ordered: boolean = price.lt(like) || price.eq(like);",
      "const fits: boolean = total.fitsDecimal(38, 2);",
      "const err: DecimalError = new DecimalInexactError('inexact');",
      "registerDecimalCoercer();",
      "registerDecimalCoercer('Dec2');",
      '// @ts-expect-error rounding mode is a closed union',
      "total.toFixed(2, 'NEAREST');",
      '// @ts-expect-error divToScale requires a mode',
      "total.divToScale('3', 2);",
      '// @ts-expect-error parse takes a string',
      'Decimal.parse(42);',
      '// @ts-expect-error config keys are closed',
      'Decimal.config({ maxDigit: 2000 });',
      'void cents; void units; void ordered; void fits; void err;',
    ].join('\n'),
  };

  for (const module of ['decimal.rip', 'coercers.rip']) {
    const source = readFileSync(new URL(`../${module}`, import.meta.url), 'utf8');
    const result = compile(source, {
      path: module,
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
    throw new Error(`decimal package type check failed:\n${diagnostics.join('\n')}`);
  }

  for (const name of ['Decimal', 'DecimalError', 'D']) {
    expect(files['decimal.d.ts']).toContain(name);
  }
});
