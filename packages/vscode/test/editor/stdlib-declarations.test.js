// A stdlib face's relative import of a JavaScript runtime module resolves
// to the declaration beside it from ANY workspace: the checkout's
// src/runtime/duckdb.d.ts types rip/db's re-exported error classes and
// predicate for a consumer outside the checkout as it does inside.
import { test, expect, describe } from 'bun:test';
import { tsgoAvailable, inWorkspace } from './support/harness.mjs';

const PKG = JSON.stringify({ name: 'stdlib-declarations', rip: { strict: true } });

// One deliberate error (2322) marks the publish that carries the file's
// types; without it an empty diagnostics list looks like success before
// tsgo has answered.
const APP = [
  "import { DbError, CancelledError, isDbError } from 'rip/db'",
  'export def shapes(err: unknown): string | undefined',
  "  c = CancelledError.new 'stop'",
  '  code: string = c.code',
  '  # @ts-expect-error code is a string, not a number',
  '  n: number = c.code',
  "  d = DbError.new 'x'",
  '  # @ts-expect-error no such field on DbError',
  '  nope: number = d.nonexistent',
  "  sentinel: number = 'a'",
  '  return err.code if isDbError err',
  '  undefined',
  '',
].join('\n');

// rip/sites/configs has no file: it is generated when a site is served, so
// its declaration is the one thing a consumer can resolve.
const CONFIGS_APP = [
  "import configs from 'rip/sites/configs'",
  'export def brand(site: string): unknown',
  '  # @ts-expect-error a tenant\'s field is unknown, never a string',
  '  name: string = configs.common.name',
  "  sentinel: number = 'a'",
  '  configs[site]',
  '',
].join('\n');

describe.skipIf(!tsgoAvailable)('stdlib runtime declarations reach a consumer', () => {
  test('rip/db error classes and isDbError arrive typed in a workspace outside the checkout', async () => {
    await inWorkspace({ 'package.json': PKG }, async (api) => {
      await api.open('app.rip', APP);
      await api.until('app.rip', (codes) => codes.includes(2322) && !codes.includes(2307));
      // Untyped, the directives go unused (2578) and the predicate
      // narrows nothing (18046).
      expect(api.codes('app.rip')).toEqual([2322]);
    });
  }, 30000);

  test('the generated rip/sites/configs module arrives typed in a workspace outside the checkout', async () => {
    await inWorkspace({ 'package.json': PKG }, async (api) => {
      await api.open('configs.rip', CONFIGS_APP);
      await api.until('configs.rip', (codes) => codes.includes(2322) && !codes.includes(2307));
      expect(api.codes('configs.rip')).toEqual([2322]);
    });
  }, 30000);
});
