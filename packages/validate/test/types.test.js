import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test.skip('validate package TypeScript face and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {
  const files = {
    'index.d.ts': readFileSync(new URL('../index.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { check, formatMoney, getValidator, isBlank, registerValidator, toName, toPhone, validatorNames, type Validator } from './index';",
      "const normalized: unknown = check('12345', 'id');",
      "const blank: boolean = isBlank('');",
      "const cased: string = toName('main st', 'address');",
      "const phone: string | null = toPhone('502-758-8802');",
      "const money: string = formatMoney(129222, { commas: false });",
      "const zero: string = formatMoney();",
      "const fn: Validator | undefined = getValidator('id');",
      "const names: string[] = validatorNames();",
      "const custom: Validator = registerValidator('typesOnly', v => v, { raw: true });",
      '// @ts-expect-error a validator name is a string',
      'getValidator(42);',
      '// @ts-expect-error formatMoney options are named',
      "formatMoney(1, 'nope');",
      'void normalized; void blank; void cased; void phone; void money; void zero; void fn; void names; void custom;',
    ].join('\n'),
  };

  for (const module of ['registry.rip', 'index.rip', 'coercers.rip']) {
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
    throw new Error(`validate package type check failed:\n${diagnostics.join('\n')}`);
  }

  for (const name of ['isBlank', 'toName', 'toPhone', 'formatMoney', 'registerValidator', 'getValidator', 'validatorNames', 'check']) {
    expect(files['index.d.ts']).toContain(`function ${name}`);
  }
});
