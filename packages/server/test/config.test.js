// The serve.rip config loader: the v3 grammar (sites, apps with
// mounts/flags/targets, ssl, server settings) normalizes with
// positioned E_* diagnostics — every problem in one pass, and a file
// with any error never half-loads. Loading imports a REAL config
// module; the S1 availability judgment (assertServable) refuses, by
// stage, what a valid file names but this server cannot serve yet.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertServable, checkConfigFile, compatConfig, findConfigFile, formatConfigErrors,
  generateCaddy, generateNginx, loadConfig, normalizeConfig, resolveConfigSource, summarizeConfig,
} from '@rip-lang/server';

const roots = [];
const scratch = (prefix = 'rip-config-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

// Normalize an in-memory config against a real base dir, collecting
// the E_* codes of a rejection.
const codesOf = (config, baseDir = '/base') => {
  try {
    normalizeConfig(config, baseDir);
    return [];
  } catch (error) {
    expect(error.code).toBe('RIP_CONFIG_INVALID');
    return error.validationErrors.map((e) => e.code);
  }
};

describe('normalizeConfig — the valid shapes', () => {
  test('sites and a static app bind hosts to routes', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'public'));
    const normalized = normalizeConfig({
      sites: { home: 'example.test', www: 'www.example.test' },
      apps: { home: './public home www' },
    }, dir);
    expect(Object.keys(normalized.sites).sort()).toEqual(['example.test', 'www.example.test']);
    const route = normalized.sites['example.test'].routes[0];
    expect(route.static).toBe('.');
    expect(route.root).toBe(join(dir, 'public'));
    expect(route.mountPath).toBe('/');
    expect(route.path).toBe('/*');
    expect(Object.keys(normalized.apps)).toEqual([]); // no index.rip → static, not a managed app
  });

  test('a directory holding index.rip is a managed app, not a static mount', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'api'));
    writeFileSync(join(dir, 'api', 'index.rip'), 'export default {}\n');
    const normalized = normalizeConfig({
      sites: { api: 'api.example.test' },
      apps: { api: './api api' },
    }, dir);
    expect(normalized.apps.api.entry).toBe(join(dir, 'api', 'index.rip'));
    expect(normalized.sites['api.example.test'].routes[0].app).toBe('api');
    expect(normalized.sites['api.example.test'].routes[0].static).toBeNull();
  });

  test('mount paths canonicalize: /*, a trailing slash, and @ spellings', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'docs'));
    const normalized = normalizeConfig({
      sites: { main: 'example.test' },
      apps: { docs: './docs main@/docs/' },
    }, dir);
    const route = normalized.sites['example.test'].routes[0];
    expect(route.mountPath).toBe('/docs');
    expect(route.path).toBe('/docs/*');
  });

  test('the spa flag rides the route; unknown flags are site names (unknown site rejects)', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'app'));
    const normalized = normalizeConfig({
      sites: { main: 'example.test' },
      apps: { app: './app main spa' },
    }, dir);
    expect(normalized.sites['example.test'].routes[0].spa).toBeTrue();
    expect(codesOf({ sites: { main: 'x.test' }, apps: { app: './app main sap' } }, dir)).toEqual(['E_APP_UNKNOWN_SITE']);
  });

  test('http and tcp proxy targets parse into proxies and streams', () => {
    const normalized = normalizeConfig({
      sites: { api: 'api.test', mq: 'mq.test' },
      apps: {
        api: 'https://upstream.internal:8443 api',
        mq: 'tcp://127.0.0.1:1883 mq',
      },
    }, '/base');
    expect(normalized.proxies['proxy-api'].targets).toEqual(['https://upstream.internal:8443']);
    expect(normalized.sites['api.test'].routes[0].proxy).toBe('proxy-api');
    expect(normalized.streams[0]).toMatchObject({ listen: 443, sni: ['mq.test'], proxy: 'tcp-mq' });
    expect(normalized.streamUpstreams['tcp-mq'].targets).toEqual([{ host: '127.0.0.1', port: 1883 }]);
  });

  test('server settings normalize: cert/key pair, hsts, acme domains, timeouts, verify', () => {
    const normalized = normalizeConfig({
      hsts: true,
      server: {
        cert: './tls/cert.pem', key: './tls/key.pem',
        acme: ['Example.COM'],
        timeouts: { connectMs: 1500 },
        verify: { requireHealthyProxies: false },
      },
    }, '/base');
    expect(normalized.server.hsts).toBeTrue();
    expect(normalized.server.cert.endsWith('/tls/cert.pem')).toBeTrue();
    expect(normalized.server.acme).toBeTrue();
    expect(normalized.server.acmeDomains).toEqual(['example.com']);
    expect(normalized.server.timeouts).toEqual({ connectMs: 1500, readMs: 30000 });
    expect(normalized.server.verify.requireHealthyProxies).toBeFalse();
    expect(normalized.server.verify.requireReadyApps).toBeTrue();
  });
});

describe('normalizeConfig — the E_* diagnostic table', () => {
  const site = { sites: { main: 'example.test' } };

  test('unknown top-level keys', () => {
    expect(codesOf({ bogus: 1 })).toEqual(['E_UNKNOWN_KEY']);
  });
  test('sites shape errors', () => {
    expect(codesOf({ sites: [] })).toEqual(['E_SITES_TYPE']);
    expect(codesOf({ sites: { a: 42 } })).toEqual(['E_SITE_HOST_TYPE']);
    expect(codesOf({ sites: { a: '  ' } })).toEqual(['E_SITE_EMPTY']);
    expect(codesOf({ sites: { a: 'x.test', b: 'x.test' } })).toEqual(['E_SITE_DUPLICATE_HOST']);
  });
  test('apps shape errors', () => {
    expect(codesOf({ apps: [] })).toEqual(['E_APPS_TYPE']);
    expect(codesOf({ ...site, apps: { a: {} } })).toEqual(['E_APP_OBJECT']);
    expect(codesOf({ ...site, apps: { a: 42 } })).toEqual(['E_APP_INVALID']);
    expect(codesOf({ ...site, apps: { a: '   ' } })).toEqual(['E_APP_EMPTY']);
    expect(codesOf({ ...site, apps: { a: './x ./y main' } })).toEqual(['E_APP_MULTI_TARGET']);
    expect(codesOf({ ...site, apps: { a: './x spa' } })).toEqual(['E_APP_NO_SITES']);
    expect(codesOf({ ...site, apps: { a: './x @/mnt' } })).toEqual(['E_APP_SITE_MISSING']);
    expect(codesOf({ ...site, apps: { a: './x nowhere' } })).toEqual(['E_APP_UNKNOWN_SITE']);
  });
  test('mount path spelling errors', () => {
    expect(codesOf({ ...site, apps: { a: './x main@' } })).toEqual(['E_APP_PATH_FORMAT']);
    expect(codesOf({ ...site, apps: { a: './x main@docs' } })).toEqual(['E_APP_PATH_FORMAT']);
    expect(codesOf({ ...site, apps: { a: './x main@/a//b' } })).toEqual(['E_APP_PATH_FORMAT']);
    expect(codesOf({ ...site, apps: { a: './x main@/a?b' } })).toEqual(['E_APP_PATH_FORMAT']);
  });
  test('a site@mount bound twice rejects', () => {
    expect(codesOf({ ...site, apps: { a: './x main', b: './y main' } })).toEqual(['E_SITE_MULTI_BIND']);
  });
  test('tcp proxies reject path mounts and portless targets', () => {
    expect(codesOf({ ...site, apps: { a: 'tcp://h:99 main@/x' } })).toEqual(['E_APP_TCP_PATH']);
    expect(codesOf({ ...site, apps: { a: 'tcp://h main' } })).toEqual(['E_APP_TCP_PORT']);
  });
  test('server-block errors: half a TLS pair, wildcard acme, bad numbers', () => {
    expect(codesOf({ server: { cert: './c.pem' } })).toEqual(['E_TLS_PAIR']);
    expect(codesOf({ server: { acme: ['*.example.com'] } })).toEqual(['E_ACME_WILDCARD']);
    expect(codesOf({ server: { acme: ['  '] } })).toEqual(['E_ACME_DOMAIN_VALUE']);
    expect(codesOf({ server: { timeouts: { connectMs: 'soon' } } })).toEqual(['E_NUMBER_TYPE']);
    expect(codesOf({ server: { timeouts: 'fast' } })).toEqual(['E_TIMEOUTS_TYPE']);
    expect(codesOf({ server: { verify: 'always' } })).toEqual(['E_VERIFY_TYPE']);
    expect(codesOf({ server: { trustedProxies: 'lb.test' } })).toEqual(['E_HOSTS_TYPE']);
    expect(codesOf({ server: { trustedProxies: ['*.com'] } })).toEqual(['E_HOST_WILDCARD_BASE']);
  });
  test('a missing ssl directory rejects (and is tolerated under lenient)', () => {
    expect(codesOf({ ssl: './no-such-dir' }, scratch())).toEqual(['E_SSL_DIR']);
    const normalized = normalizeConfig({ ssl: './no-such-dir' }, scratch(), { lenient: true });
    expect(normalized.resolvedCerts).toEqual({});
  });
  test('every error reports in one pass, and formatConfigErrors names them all', () => {
    const errors = (() => {
      try {
        normalizeConfig({ bogus: 1, sites: { a: 42 }, apps: { x: '   ' } }, '/base');
      } catch (error) { return error.validationErrors; }
    })();
    expect(errors.map((e) => e.code)).toEqual(['E_UNKNOWN_KEY', 'E_SITE_HOST_TYPE', 'E_APP_EMPTY']);
    const text = formatConfigErrors('serve.rip', errors);
    expect(text).toContain('serve.rip validation failed (3 errors)');
    expect(text).toContain('- [E_UNKNOWN_KEY] bogus:');
  });
});

describe('loadConfig — real serve.rip modules', () => {
  test('loads and normalizes a config module; summarize counts what it found', async () => {
    const dir = scratch();
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'serve.rip'), [
      'export default',
      "  sites:",
      "    home: 'example.test'",
      "  apps:",
      "    home: './public home'",
      '',
    ].join('\n'));
    const normalized = await loadConfig(join(dir, 'serve.rip'));
    expect(normalized.kind).toBe('serve');
    const summary = summarizeConfig(join(dir, 'serve.rip'), normalized);
    expect(summary.counts).toEqual({ proxies: 0, apps: 0, hosts: 1, routes: 1, streams: 0 });
  });

  test('a missing file loads as null; a non-object default rejects as E_CONFIG_TYPE', async () => {
    const dir = scratch();
    expect(await loadConfig(join(dir, 'serve.rip'))).toBeNull();
    writeFileSync(join(dir, 'serve.rip'), "export default 'not a config'\n");
    const error = await loadConfig(join(dir, 'serve.rip')).then(() => null, (e) => e);
    expect(error.validationErrors[0].code).toBe('E_CONFIG_TYPE');
  });

  test('a promise-valued default rejects as E_CONFIG_ASYNC', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'serve.rip'), 'export default Promise.resolve({})\n');
    const error = await loadConfig(join(dir, 'serve.rip')).then(() => null, (e) => e);
    expect(error.validationErrors[0].code).toBe('E_CONFIG_ASYNC');
  });

  test('checkConfigFile returns the normalized config with its summary', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'serve.rip'), "export default { sites: { a: 'a.test' } }\n");
    const checked = await checkConfigFile(join(dir, 'serve.rip'));
    expect(checked.kind).toBe('serve');
    expect(checked.summary.counts.hosts).toBe(0); // a site with no app binds no routes
  });

  test('findConfigFile prefers the app directory; resolveConfigSource honors an explicit path', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'serve.rip'), 'export default {}\n');
    expect(findConfigFile(dir)).toBe(join(dir, 'serve.rip'));
    expect(resolveConfigSource(dir).path).toBe(join(dir, 'serve.rip'));
    expect(resolveConfigSource('/nowhere/app', join(dir, 'serve.rip')).path).toBe(join(dir, 'serve.rip'));
    expect(resolveConfigSource(join(scratch(), 'app'))).toBeNull(); // no file anywhere → no source
  });
});

describe('assertServable — the S1 availability judgment', () => {
  const blockersOf = (config, baseDir = '/base') => {
    try {
      assertServable(normalizeConfig(config, baseDir));
      return [];
    } catch (error) {
      expect(error.code).toBe('RIP_CONFIG_UNAVAILABLE');
      return error.blockers;
    }
  };

  test('a static-only config serves', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'public'));
    expect(blockersOf({ sites: { a: 'a.test' }, apps: { a: './public a' } }, dir)).toEqual([]);
  });
  test('http proxies are S3', () => {
    expect(blockersOf({ sites: { a: 'a.test' }, apps: { a: 'https://up.test a' } })[0]).toContain('S3');
  });
  test('tcp streams are S3', () => {
    expect(blockersOf({ sites: { a: 'a.test' }, apps: { a: 'tcp://h:99 a' } })[0]).toContain('S3');
  });
  test('managed Rip apps are S2', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'api'));
    writeFileSync(join(dir, 'api', 'index.rip'), 'export default {}\n');
    expect(blockersOf({ sites: { a: 'a.test' }, apps: { a: './api a' } }, dir)[0]).toContain('S2');
  });
  test('ACME is S5', () => {
    expect(blockersOf({ acme: true })[0]).toContain('S5');
  });
  test('directory browsing has no v4 unit', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'pub'));
    expect(blockersOf({ sites: { a: 'a.test' }, apps: { a: './pub a browse' } }, dir)[0]).toContain('browsing');
  });
  test('every blocker reports at once, by stage', () => {
    const blockers = blockersOf({
      sites: { a: 'a.test', b: 'b.test' },
      apps: { a: 'https://up.test a', b: 'tcp://h:99 b' },
    });
    expect(blockers.length).toBe(2);
  });
});

describe('compatConfig — serve.rip into the nginx/caddy shape', () => {
  test('static and proxy routes translate; generation is injection-checked', () => {
    const dir = scratch('rip-compat-');
    mkdirSync(join(dir, 'public'));
    const normalized = normalizeConfig({
      sites: { home: 'example.test', api: 'api.example.test' },
      apps: { home: './public home spa', api: 'https://127.0.0.1:9000 api' },
    }, dir);
    const compat = compatConfig(normalized);
    expect(compat.sites.length).toBe(2);
    const nginx = generateNginx(compat);
    expect(nginx).toContain('server_name example.test;');
    expect(nginx).toContain(`root ${join(dir, 'public')};`);
    expect(nginx).toContain('try_files $uri /index.html;');
    expect(nginx).toContain('proxy_pass https://127.0.0.1:9000;');
    const caddy = generateCaddy(compat);
    expect(caddy).toContain('example.test {');
    expect(caddy).toContain('reverse_proxy https://127.0.0.1:9000');
  });
});
