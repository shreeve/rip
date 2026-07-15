import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

test.skip('http package TypeScript face and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {
  const face = compile(readFileSync(new URL('../index.rip', import.meta.url), 'utf8'), {
    path: 'index.rip',
    face: 'ts',
    runtimeDelivery: 'none',
  });
  expect(face.code.length).toBeGreaterThan(0);
  expect(face.declarations.length).toBeGreaterThan(0);

  const files = {
    'index.d.ts': face.declarations,
    'consumer.ts': [
      "import { HTTPError, TimeoutError, http, type BeforeRetryInfo, type Hooks, type HttpInstance, type HttpOptions, type RetryOption } from './index';",
      "const api: HttpInstance = http.create({ prefixUrl: 'https://api.example.com/v1', retry: 0 });",
      "const admin: HttpInstance = api.extend({ headers: { 'X-Admin': 'true' } });",
      "const listed: Promise<Response> = admin.get('users', { searchParams: { page: 1 }, timeout: false });",
      "const posted: Promise<Response> = http.post(new URL('https://api.example.com'), { json: { name: 'Alice' } });",
      'const retry: RetryOption = { limit: 3, delay: (attempt: number) => attempt * 100 };',
      'const hooks: Hooks = { beforeRetry: [(info: BeforeRetryInfo) => { void info.retryCount; }] };',
      'const opts: HttpOptions = { retry, hooks, signal: null };',
      "const err = new HTTPError(new Response(), new Request('https://x'), opts);",
      'const status: number = err.response.status;',
      "const slow = new TimeoutError(new Request('https://x'));",
      'const request: Request = slow.request;',
      '// @ts-expect-error retry is a number, a config object, or false',
      "void http('https://x', { retry: 'lots' });",
      '// @ts-expect-error the DELETE shortcut is `del`',
      "void http.delete('https://x');",
      'void listed; void posted; void status; void request;',
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
    throw new Error(`http package type check failed:\n${diagnostics.join('\n')}`);
  }

  for (const name of ['export class HTTPError', 'export class TimeoutError', 'export const http']) {
    expect(files['index.d.ts']).toContain(name);
  }
});
