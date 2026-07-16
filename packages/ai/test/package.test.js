// Package posture pins for @rip-lang/ai.
import './helpers.js'; // pins HOME/keys before any package module loads
import { expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package is private, version 0.0.0, module type', () => {
  expect(pkg.name).toBe('@rip-lang/ai');
  expect(pkg.private).toBeTrue();
  expect(pkg.version).toBe('0.0.0');
  expect(pkg.type).toBe('module');
});

test('package has no dependency fields (bun:sqlite and fetch are built in)', () => {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
});

test('the entry is the MCP server module', () => {
  expect(pkg.exports).toEqual({ '.': './mcp.rip' });
});

test('the package does not claim browser safety (filesystem, sqlite, stdio)', () => {
  expect(pkg.rip).toBeUndefined();
});

test('the rip-ai bin is declared and executable', () => {
  expect(pkg.bin).toEqual({ 'rip-ai': './bin/rip-ai' });
  const mode = statSync(new URL('../bin/rip-ai', import.meta.url)).mode;
  expect(mode & 0o111).not.toBe(0);
});

test('importing the entry as a module starts nothing and exports nothing', async () => {
  // import.meta.main is false here, so the stdio loop must not start
  const mod = await import(new URL('../mcp.rip', import.meta.url).href);
  expect(Object.keys(mod)).toEqual([]);
});
