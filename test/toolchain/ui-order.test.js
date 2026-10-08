// packages/ui lists its components in four places; each stays in
// alphabetical order, so a component is added at its place, never at
// the end.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const read = (path) => readFileSync(join(ROOT, 'packages', 'ui', path), 'utf8');
const sorted = (names) => expect(names).toEqual([...names].sort());

describe('packages/ui component order', () => {
  test('package.json exports the entry first, then the modules in order, and files is the entry, the modules in order, then the README', () => {
    const { exports: ex, files } = JSON.parse(read('package.json'));
    const subpaths = Object.keys(ex);
    expect(subpaths[0]).toBe('.');
    sorted(subpaths.slice(1));
    expect(files[0]).toBe('ui.rip');
    expect(files.at(-1)).toBe('README.md');
    sorted(files.slice(1, -1));
  });

  test('ui.rip publishes the components in order', () => {
    const names = [...read('ui.rip').matchAll(/^export \* as (\w+) from/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(1);
    sorted(names);
  });

  test('the roadmap names every component ui.rip publishes, in order', () => {
    const published = [...read('ui.rip').matchAll(/^export \* as (\w+) from/gm)].map((m) => m[1]);
    const line = readFileSync(join(ROOT, 'docs', 'ROADMAP.md'), 'utf8').split('\n').find((l) => l.includes('`rip/ui` ships'));
    expect(line).toBeDefined();
    const named = [...line.matchAll(/`(\w+)`/g)].map((m) => m[1]).filter((n) => n !== 'rip/ui');
    expect(named).toEqual(published);
  });

  test('the demo catalog and the README sections keep the same order', () => {
    const keys = [...read('demo/app/components.rip').matchAll(/^  (\w+):\s+\{ href:/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(1);
    sorted(keys);
    const headings = [...read('README.md').matchAll(/^## (\w+)$/gm)].map((m) => m[1]);
    const first = headings.indexOf(keys[0][0].toUpperCase() + keys[0].slice(1));
    expect(first).toBeGreaterThan(-1);
    expect(headings.slice(first, first + keys.length)).toEqual(keys.map((k) => k[0].toUpperCase() + k.slice(1)));
  });
});
