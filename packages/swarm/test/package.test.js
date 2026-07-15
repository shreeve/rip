import { expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import * as swarm from '@rip-lang/swarm';

test('public entry exposes named exports only', () => {
  expect(Object.keys(swarm).sort()).toEqual([
    '_getPerform',
    'args',
    'init',
    'retry',
    'swarm',
    'todo',
  ]);
  expect('default' in swarm).toBeFalse();
});

test('package has no dependency fields', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    expect(pkg[field]).toBeUndefined();
  }
});

test('the package does not claim browser safety (it spawns worker threads and moves files)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
  const source = readFileSync(new URL('../swarm.rip', import.meta.url), 'utf8');
  expect(source).toContain("from 'worker_threads'");
  expect(source).toContain("from 'fs'");
});

test('the swarm bin is declared and executable', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.bin).toEqual({ swarm: './bin/swarm' });
  const mode = statSync(new URL('../bin/swarm', import.meta.url)).mode;
  expect(mode & 0o111).not.toBe(0);
});

test('the worker bootstrap ships with the package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.files).toContain('lib/');
  const bootstrap = readFileSync(new URL('../lib/worker.mjs', import.meta.url), 'utf8');
  expect(bootstrap).toContain("import(new URL('../swarm.rip', import.meta.url).href)");
});
