import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as server from '@rip-lang/server';

test('public entry exposes named exports only', () => {
  expect(Object.keys(server).sort()).toEqual([
    'appServer',
    'appShell',
    'certSpecificity',
    'compose',
    'cors',
    'createContext',
    'createMatcher',
    'createPool',
    'createUpstream',
    'createWatch',
    'csrf',
    'diskHost',
    'dispatchServer',
    'errorEnvelope',
    'generateCaddy',
    'generateNginx',
    'harden',
    'logger',
    'matchCert',
    'mimeType',
    'openapi',
    'orderCerts',
    'parseQuery',
    'parseServerArgs',
    'reading',
    'resolveTls',
    'respond',
    'secureHeaders',
    'serveStatic',
    'serverUsage',
    'sessions',
    'trustProxy',
    'watchClient',
    'withInput',
  ]);
  expect('default' in server).toBeFalse();
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

test('the package is server-only: browser safety is never declared', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.rip).toBeUndefined();
});

test('the pure modules use no host APIs', () => {
  // serving.rip is pure over an injected host; host.rip is the ONE
  // module allowed to touch the filesystem.
  for (const module of ['router.rip', 'context.rip', 'middleware.rip', 'builtin.rip', 'input.rip', 'openapi.rip', 'security.rip', 'serving.rip', 'watch.rip', 'pool.rip', 'tls.rip', 'upstream.rip', 'cli.rip', 'compat.rip', 'index.rip']) {
    const source = readFileSync(new URL(`../${module}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bBun\.|node:|process\.|fetch\(/);
  }
});

test('host.rip is the sole filesystem seam', () => {
  const source = readFileSync(new URL('../host.rip', import.meta.url), 'utf8');
  expect(source).toMatch(/node:fs/);
  expect(source).toMatch(/Bun\.file/);
});

test('the security module leans only on WebCrypto and web-standard globals', () => {
  const source = readFileSync(new URL('../security.rip', import.meta.url), 'utf8');
  expect(source).toContain('crypto.subtle');
  expect(source).not.toMatch(/\brequire\(|import .* from|node:crypto/);
});
