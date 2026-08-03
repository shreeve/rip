// Every explicit test.skip call is an acceptance-contract exception. Keep the
// complete set visible in one reviewed inventory so a new dormant test cannot
// enter through an otherwise-green suite. Conditional describe.skipIf gates
// are a different class: test:all's preflight makes their missing tool a hard
// failure before the package suite starts.
import { expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const CODE = /\.(cjs|js|mjs|rip|ts|tsx)$/;
// The pattern and expected call spellings avoid writing the matched token
// contiguously, so the tracked-file sweep can include this file without
// inventorying its own assertions.
const SKIP_CALL = /\btest\.skip[ \t]*\(/g;

const trackedCode = () =>
  execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0')
    .filter((rel) => rel && CODE.test(rel))
    .map((rel) => join(ROOT, rel))
    .filter((path) => existsSync(path));

const inventory = () => {
  const calls = [];
  for (const file of trackedCode()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SKIP_CALL)) {
      const lineEnd = source.indexOf('\n', match.index);
      calls.push({
        file: relative(ROOT, file).split(sep).join('/'),
        call: source.slice(match.index, lineEnd < 0 ? source.length : lineEnd).trim(),
      });
    }
  }
  return calls.sort((a, b) => a.file.localeCompare(b.file) || a.call.localeCompare(b.call));
};

test('every explicit test skip is named in the intentional inventory', () => {
  expect(inventory()).toEqual([
    {
      file: 'packages/app/test/types.test.js',
      call: "test." + "skip('app package TypeScript faces and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {",
    },
    {
      file: 'packages/browser-tests/tests/app.spec.mjs',
      call: "test." + "skip(browserName !== 'chromium', 'script-parse metadata arrives over CDP');",
    },
    {
      file: 'packages/ui/test/types.test.js',
      call: "test." + "skip('email package TypeScript faces and declarations are valid (deferred: package .d.ts removed until typing pass)', () => {",
    },
    {
      file: 'test/support/extended.js',
      call: "test." + "skip('SKIPPED: extended tier (`bun run test:all` runs it; CI always does)', () => {});",
    },
  ]);
});
