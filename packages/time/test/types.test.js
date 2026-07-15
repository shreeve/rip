import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test.skip('time package TypeScript face and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {
  const face = compile(readFileSync(new URL('../time.rip', import.meta.url), 'utf8'), {
    path: 'time.rip',
    face: 'ts',
    runtimeDelivery: 'none',
  });
  expect(face.code.length).toBeGreaterThan(0);
  expect(face.declarations.length).toBeGreaterThan(0);

  const files = {
    'index.d.ts': face.declarations,
    'consumer.ts': [
      "import time, { Time, Duration, age, isTime, isDuration, type TimeInput, type UnitInput } from './index';",
      "const d: Time = time('2026-04-19');",
      "const later: Time = d.add(1, 'day').add(2, Symbol.for('hour'));",
      "const shown: string = later.tz('HT').format('YYYY-MM-DD h:mm A z');",
      "const days: number = later.diff(d, 'day');",
      "const dur: Duration = time.duration({ hours: 1, minutes: 30 });",
      'const total: number = dur.asMinutes();',
      "const iso: string = dur.toISOString();",
      "const viaDur: Time = d.add(dur);",
      "const utc: Time = time.utc('2026-04-19T00:00:00Z');",
      "const parsed: Time = time.parse('04/19/2026 3:45 PM', 'MM/DD/YYYY h:mm A');",
      "const zoned: Time = time.tz('2026-04-19 09:00', 'ET');",
      'const guessed: string = time.tz.guess();',
      'const earliest: Time = time.min(d, later);',
      'const years: number | null = age(\'2000-01-01\');',
      'const isIt: boolean = isTime(d) && isDuration(dur);',
      'const dow: number = d.weekday();',
      'const moved: Time = d.weekday(1);',
      '// @ts-expect-error set takes a numeric value',
      "d.set('year', 'nope');",
      '// @ts-expect-error format takes a string',
      'd.format(42);',
      '// @ts-expect-error tz.guess takes no arguments',
      "time.tz.guess('America/Denver');",
      'void shown; void days; void total; void iso; void viaDur; void utc; void parsed;',
      'void zoned; void guessed; void earliest; void years; void isIt; void dow; void moved;',
    ].join('\n'),
  };

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
    throw new Error(`time package type check failed:\n${diagnostics.join('\n')}`);
  }

  for (const name of ['isTime', 'isDuration', 'age', 'time']) {
    expect(files['index.d.ts']).toContain(`function ${name}`);
  }
  for (const name of ['class Time', 'class Duration', 'export default timeFactory']) {
    expect(files['index.d.ts']).toContain(name);
  }
});
