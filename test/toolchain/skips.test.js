// A skipped package contract still leaves its test lane green. Keep every
// unconditional deferral in one reviewed inventory so adding, renaming, or
// reactivating one is an explicit change rather than quiet coverage drift.
// Capability-dependent skips are not deferrals and do not enter this set.
import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const SOURCE_FILE = /\.(?:cjs|js|mjs|rip|ts|tsx)$/;
const UNCONDITIONAL_SKIP = /\b(test|it|describe)\.skip\([\t \r\n]*(?:'((?:\\.|[^'\\\r\n])*)'|"((?:\\.|[^"\\\r\n])*)"|`((?:\\.|[^`\\\r\n])*)`)/g;

const APPROVED = [
  {
    file: 'packages/app/test/types.test.js',
    kind: 'test',
    title: 'app package TypeScript faces and declarations are valid (deferred: package .d.ts removed until typing pass)',
  },
  {
    file: 'packages/ui/test/types.test.js',
    kind: 'test',
    title: 'email package TypeScript faces and declarations are valid (deferred: package .d.ts removed until typing pass)',
  },
];

export function unconditionalSkips(source) {
  return [...source.matchAll(UNCONDITIONAL_SKIP)].map((match) => ({
    kind: match[1],
    title: match[2] ?? match[3] ?? match[4],
  }));
}

// Tracked files are the contract. Editor mirrors, package-local scratch files,
// and other untracked state cannot turn this repository gate red or green.
const packageSources = () =>
  execSync('git ls-files -z -- packages', { cwd: ROOT }).toString().split('\0')
    .filter((file) => file && SOURCE_FILE.test(file))
    .map((file) => join(ROOT, file))
    .filter((file) => existsSync(file));

describe('intentional package test deferrals', () => {
  test('the scanner distinguishes unconditional skips from capability conditions', () => {
    expect(unconditionalSkips("test.skip('fixed deferral', () => {})")).toEqual([
      { kind: 'test', title: 'fixed deferral' },
    ]);
    expect(unconditionalSkips('prefix(); describe.skip("suite deferral", () => {})')).toEqual([
      { kind: 'describe', title: 'suite deferral' },
    ]);
    expect(unconditionalSkips("test.skip(browserName !== 'chromium', 'conditional')")).toEqual([]);
    expect(unconditionalSkips("describe.skipIf(!toolAvailable)('conditional', () => {})")).toEqual([]);
  });

  test('the repository carries exactly the reviewed deferrals', () => {
    const found = [];
    for (const file of packageSources()) {
      for (const skip of unconditionalSkips(readFileSync(file, 'utf8'))) {
        found.push({ file: relative(ROOT, file).split(sep).join('/'), ...skip });
      }
    }
    found.sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
    expect(found).toEqual(APPROVED);
  });
});
