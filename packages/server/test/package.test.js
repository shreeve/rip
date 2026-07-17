import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as server from '@rip-lang/server';

test('public entry exposes named exports only', () => {
  expect(Object.keys(server).sort()).toEqual([
    'appServer',
    'appShell',
    'assertServable',
    'buildServeOptions',
    'certSpecificity',
    'checkConfigFile',
    'coerceInt',
    'compatConfig',
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
    'findConfigFile',
    'formatConfigErrors',
    'generateCaddy',
    'generateNginx',
    'getPidFilePath',
    'harden',
    'lanIP',
    'loadConfig',
    'logger',
    'main',
    'matchCert',
    'mdnsService',
    'mimeType',
    'normalizeConfig',
    'openapi',
    'orderCerts',
    'parseQuery',
    'parseServerFlags',
    'reading',
    'renderDashboard',
    'resolveAppEntry',
    'resolveConfigSource',
    'resolveServerAction',
    'resolveTls',
    'respond',
    'runCheck',
    'runServe',
    'runStop',
    'scanListen',
    'secureHeaders',
    'serveStatic',
    'serverUsage',
    'sessions',
    'startServer',
    'summarizeConfig',
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
  // serving.rip is pure over an injected host. The runnable layer —
  // host.rip, cli.rip (v3's token grammar resolves app paths against
  // the real filesystem and reads RIP_* environment variables),
  // config.rip, serve.rip, and main.rip — owns the host edges.
  for (const module of ['router.rip', 'context.rip', 'middleware.rip', 'builtin.rip', 'input.rip', 'openapi.rip', 'security.rip', 'serving.rip', 'watch.rip', 'pool.rip', 'tls.rip', 'upstream.rip', 'compat.rip', 'mdns.rip', 'index.rip']) {
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
