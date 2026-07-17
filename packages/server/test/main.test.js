// The rip-server composition: the serve-time merge of the parsed
// token grammar with a loaded serve.rip (the pinned precedence:
// token > RIP_* env > serve.rip > default), the terminal actions
// (check, nginx/caddy, stop), the S1 stage boundaries refused loudly,
// and — at the end — the real bin as a subprocess: it starts, serves
// a request over a real socket, and exits cleanly on SIGTERM.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildServeOptions, loadConfig, parseServerFlags, runCheck, runServe, runStop,
} from '@rip-lang/server';

const roots = [];
const handles = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-main-'));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  for (const handle of handles) await handle.stop().catch(() => {});
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const flagsFor = (...tokens) => parseServerFlags(['bun', 'server', ...tokens]);

const staticSite = () => {
  const dir = scratch();
  writeFileSync(join(dir, 'index.html'), 'hello from disk');
  return dir;
};

const configDir = (source) => {
  const dir = scratch();
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'public', 'index.html'), 'config-served');
  writeFileSync(join(dir, 'serve.rip'), source);
  return dir;
};

describe('buildServeOptions — the serve-time merge', () => {
  test('a plain directory serves statically with the flags-resolved envelope', () => {
    const dir = staticSite();
    const opts = buildServeOptions(flagsFor(dir, 'http:8080', 'w:3', 'c:2', '--static'));
    expect(opts).toMatchObject({
      root: dir, httpPort: 8080, workers: 3, concurrency: 2,
      watch: false, hsts: false,
    });
    expect(opts.bundle).toBeUndefined();
    expect(opts.sites).toBeUndefined();
  });

  test('a directory holding bundle.json serves through the App preset', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify({ data: { boot: true } }));
    const opts = buildServeOptions(flagsFor(dir, 'http'));
    expect(opts.root).toBe(dir);
    expect(opts.bundle).toEqual({ data: { boot: true } });
  });

  test('a Rip application entry is the S2 boundary, refused loudly', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'index.rip'), 'export default {}\n');
    expect(() => buildServeOptions(flagsFor(dir, 'http'))).toThrow(/S2/);
  });

  test('serve.rip sites win over the app path; static routes carry root, mount, and spa', async () => {
    const dir = configDir([
      'export default',
      '  sites:',
      "    home: 'example.test'",
      '  apps:',
      "    home: './public home spa'",
      '',
    ].join('\n'));
    const loaded = await loadConfig(join(dir, 'serve.rip'));
    const opts = buildServeOptions(flagsFor(dir, 'http'), loaded);
    expect(opts.sites).toEqual([
      { host: 'example.test', routes: [{ mountPath: '/', root: join(dir, 'public'), spa: true }] },
    ]);
    expect(opts.root).toBeUndefined();
  });

  test('a serve.rip naming unavailable features refuses by stage', async () => {
    const dir = configDir([
      'export default',
      '  sites:',
      "    api: 'api.test'",
      '  apps:',
      "    api: 'https://upstream.test api'",
      '',
    ].join('\n'));
    const loaded = await loadConfig(join(dir, 'serve.rip'));
    expect(() => buildServeOptions(flagsFor(dir, 'http'), loaded)).toThrow(/S3/);
  });

  test('TLS precedence: --cert/--key tokens beat serve.rip server.cert/key, which beat nothing', async () => {
    const dir = configDir([
      'export default',
      '  server:',
      "    cert: '/file/cert.pem'",
      "    key: '/file/key.pem'",
      '',
    ].join('\n'));
    const loaded = await loadConfig(join(dir, 'serve.rip'));
    const fromFile = buildServeOptions(flagsFor(dir, 'https:8443'), loaded);
    expect(fromFile.tls).toEqual({ certPath: '/file/cert.pem', keyPath: '/file/key.pem' });
    expect(fromFile.httpsPort).toBe(8443);
    const fromTokens = buildServeOptions(
      flagsFor(dir, 'https:8443', '--cert=/tok/c.pem', '--key=/tok/k.pem'), loaded);
    expect(fromTokens.tls).toEqual({ certPath: '/tok/c.pem', keyPath: '/tok/k.pem' });
  });

  test('explicit https with no material is a loud failure; the https DEFAULT falls back to plaintext, declared', () => {
    const dir = staticSite();
    expect(() => buildServeOptions(flagsFor(dir, 'https'))).toThrow(/certificate material/);
    expect(() => buildServeOptions(flagsFor(dir, '9443'))).toThrow(/certificate material/);
    const defaulted = buildServeOptions(flagsFor(dir)); // no protocol spelled
    expect(defaulted.tls).toBeUndefined();
    expect(defaulted.httpPort).toBe(80);
    expect(defaulted.downgradedFromHttps).toBeTrue();
  });

  test('hsts comes from the token or the file', async () => {
    const dir = configDir('export default { hsts: true }\n');
    const loaded = await loadConfig(join(dir, 'serve.rip'));
    expect(buildServeOptions(flagsFor(dir, 'http'), loaded).hsts).toBeTrue();
    expect(buildServeOptions(flagsFor(staticSite(), 'http', '--hsts')).hsts).toBeTrue();
    expect(buildServeOptions(flagsFor(staticSite(), 'http')).hsts).toBeFalse();
  });
});

describe('runServe — config-driven serving end to end', () => {
  test('a serve.rip static site serves by host over a real listener', async () => {
    const dir = configDir([
      'export default',
      '  sites:',
      "    home: 'example.test'",
      '  apps:',
      "    home: './public home'",
      '',
    ].join('\n'));
    // Find a free port for the token, tolerating the scan moving it.
    const probe = Bun.serve({ port: 0, fetch: () => new Response('x') });
    const port = probe.port;
    probe.stop(true);
    const handle = await runServe(flagsFor(dir, `http:${port}`, '--quiet'));
    handles.push(handle);
    expect(handle.configPath).toBe(join(dir, 'serve.rip'));
    const res = await handle.fetchHandler(new Request(`http://example.test/index.html`));
    expect(await res.text()).toBe('config-served');
    expect((await handle.fetchHandler(new Request('http://other.test/index.html'))).status).toBe(404);
    await handle.stop();
  });

  test('a broken serve.rip stops the start with its E_* diagnostics', async () => {
    const dir = configDir('export default { bogus: 1 }\n');
    const error = await runServe(flagsFor(dir, '--quiet', 'http')).then(() => null, (e) => e);
    expect(error.validationErrors[0].code).toBe('E_UNKNOWN_KEY');
  });
});

describe('terminal actions', () => {
  test('runCheck validates a good file and reports a bad one with its codes', async () => {
    const good = configDir([
      'export default',
      '  sites:',
      "    home: 'example.test'",
      '  apps:',
      "    home: './public home'",
      '',
    ].join('\n'));
    const ok = await runCheck(flagsFor(good, 'http'));
    expect(ok.code).toBe(0);
    expect(ok.message).toContain('serve.rip OK');
    expect(ok.message).toContain('hosts: 1  routes: 1');

    const bad = configDir('export default { bogus: 1 }\n');
    const rejected = await runCheck(flagsFor(bad, 'http'));
    expect(rejected.code).toBe(1);
    expect(rejected.message).toContain('[E_UNKNOWN_KEY]');

    const missing = await runCheck(flagsFor(staticSite(), 'http'));
    expect(missing.code).toBe(1);
    expect(missing.message).toContain('no serve.rip found');
  });

  test('runStop signals the PID file owner and reports a missing file', () => {
    const killed = [];
    const proc = { kill: (pid, signal) => killed.push([pid, signal]) };
    const flags = flagsFor(staticSite(), '--socket-prefix=rip_s1_test_stop');
    writeFileSync('/tmp/rip_s1_test_stop.pid', '12345');
    try {
      const result = runStop(flags, proc);
      expect(result.code).toBe(0);
      expect(killed).toEqual([[12345, 'SIGTERM']]);
    } finally {
      rmSync('/tmp/rip_s1_test_stop.pid', { force: true });
    }
    const missing = runStop(flagsFor(staticSite(), '--socket-prefix=rip_s1_test_gone'), proc);
    expect(missing.code).toBe(1);
    expect(missing.message).toContain('no PID file');
  });
});

describe('the bin, as a real subprocess', () => {
  const binPath = new URL('../bin/rip-server', import.meta.url).pathname;
  const ripPath = new URL('../../../bin/rip', import.meta.url).pathname;

  // Read the child's stdout until the URL line appears.
  const urlOf = async (child) => {
    const decoder = new TextDecoder();
    let seen = '';
    for await (const chunk of child.stdout) {
      seen += decoder.decode(chunk);
      const match = seen.match(/rip-server: (http:\/\/[^\s]+)/);
      if (match) return match[1];
    }
    throw new Error(`server never printed its URL; stdout was: ${seen}`);
  };

  test('rip-server starts, serves one request, and exits cleanly on SIGTERM', async () => {
    const dir = staticSite();
    // A random high port; the server's own scan absorbs a collision
    // and the printed URL names the port it actually bound.
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = Bun.spawn(['bun', binPath, dir, `http:${port}`, '--socket-prefix=rip_s1_smoke'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'inherit',
    });
    try {
      const url = await urlOf(child);
      const res = await fetch(`${url}/index.html`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('hello from disk');
      child.kill('SIGTERM');
      expect(await child.exited).toBe(0);
    } finally {
      child.kill();
      rmSync('/tmp/rip_s1_smoke.pid', { force: true });
    }
  }, 20000);

  test('`rip server` dispatches through the repository bin', async () => {
    const dir = staticSite();
    const version = Bun.spawnSync(['bun', ripPath, 'server', '--version'], { cwd: dir });
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString()).toContain('rip-server v');

    const bogus = Bun.spawnSync(['bun', ripPath, 'server', '--bogus'], { cwd: dir });
    expect(bogus.exitCode).toBe(2);
    expect(bogus.stderr.toString()).toContain('unknown flag');
  }, 20000);

  test('the check action works through the bin with a real config', () => {
    const dir = configDir([
      'export default',
      '  sites:',
      "    home: 'example.test'",
      '  apps:',
      "    home: './public home'",
      '',
    ].join('\n'));
    const check = Bun.spawnSync(['bun', binPath, '-c', '-f', join(dir, 'serve.rip')], { cwd: dir });
    expect(check.exitCode).toBe(0);
    expect(check.stdout.toString()).toContain('serve.rip OK');

    const nginx = Bun.spawnSync(['bun', binPath, '--nginx', '-f', join(dir, 'serve.rip')], { cwd: dir });
    expect(nginx.exitCode).toBe(0);
    expect(nginx.stdout.toString()).toContain('server_name example.test;');
  }, 20000);
});
