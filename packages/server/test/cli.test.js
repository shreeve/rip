// The `rip server` token grammar — v3's grammar, pinned form by form:
// w:/c:/r: worker tokens, http/https/port listener tokens, app tokens
// with @aliases, the --long flags (inline and spaced), and the RIP_*
// environment fallbacks with their precedence (token > env > default).
// Two declared departures from v3's PARSER (not its documented
// grammar): an option-shaped token is always an option even before
// the app token (v3 silently took `rip server w:4` as an app named
// "w:4"), and an unknown --flag rejects loudly instead of being
// silently ignored.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import {
  coerceInt, dispatchServer, getPidFilePath, parseServerFlags, resolveAppEntry, resolveServerAction, serverUsage,
} from '@rip-lang/server';

const cores = cpus().length;
const defaultWorkers = Math.max(1, Math.floor(cores / 2));

// Parse with a stable app anchor (a real temp dir), so assertions
// never depend on this repository's own layout.
let dirs = [];
const scratch = () => {
  const dir = mkdtempSync(join('/tmp', 'rip-cli-'));
  dirs.push(dir);
  return dir;
};
const anchor = () => scratch();
const parse = (tokens, extra = []) => parseServerFlags(['bun', 'server', ...tokens, ...extra]);
const parseAt = (tokens) => {
  const dir = anchor();
  return parseServerFlags(['bun', 'server', dir, ...tokens]);
};

const RIP_VARS = [
  'RIP_WORKER_CONCURRENCY', 'RIP_MAX_REQUESTS', 'RIP_MAX_SECONDS', 'RIP_STATIC',
  'RIP_MAX_QUEUE', 'RIP_QUEUE_TIMEOUT_MS', 'RIP_CONNECT_TIMEOUT_MS', 'RIP_READ_TIMEOUT_MS',
  'RIP_PUBLISH_SECRET', 'RIP_SECRET',
];
afterEach(() => {
  for (const name of RIP_VARS) delete process.env[name];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('worker tokens', () => {
  test('w:<n> and the named forms', () => {
    expect(parseAt(['w:4']).workers).toBe(4);
    expect(parseAt(['w:auto']).workers).toBe(Math.max(1, cores));
    expect(parseAt(['w:half']).workers).toBe(Math.max(1, Math.floor(cores / 2)));
    expect(parseAt(['w:2x']).workers).toBe(Math.max(1, cores * 2));
    expect(parseAt(['w:3x']).workers).toBe(Math.max(1, cores * 3));
    expect(parseAt(['w:bogus']).workers).toBe(defaultWorkers);
    expect(parseAt([]).workers).toBe(defaultWorkers);
  });

  test('c:<n>, its long form, its env fallback, and the floor of 1', () => {
    expect(parseAt(['c:8']).workerConcurrency).toBe(8);
    expect(parseAt(['c:0']).workerConcurrency).toBe(1);
    expect(parseAt(['--worker-concurrency=4']).workerConcurrency).toBe(4);
    process.env.RIP_WORKER_CONCURRENCY = '6';
    expect(parseAt([]).workerConcurrency).toBe(6);
    expect(parseAt(['c:2']).workerConcurrency).toBe(2); // token beats env
    expect(parseAt([]).workerConcurrency).toBe(6);
  });

  test('r:<n>,<s>s restart policy, with the env-backed defaults', () => {
    expect(parseAt(['r:500,60s'])).toMatchObject({ maxRequestsPerWorker: 500, maxSecondsPerWorker: 60 });
    expect(parseAt(['r:500'])).toMatchObject({ maxRequestsPerWorker: 500, maxSecondsPerWorker: 3600 });
    expect(parseAt(['r:90s'])).toMatchObject({ maxRequestsPerWorker: 10000, maxSecondsPerWorker: 90 });
    process.env.RIP_MAX_REQUESTS = '2000';
    process.env.RIP_MAX_SECONDS = '120';
    expect(parseAt([])).toMatchObject({ maxRequestsPerWorker: 2000, maxSecondsPerWorker: 120 });
    expect(parseAt(['r:5,9s'])).toMatchObject({ maxRequestsPerWorker: 5, maxSecondsPerWorker: 9 });
  });

  test('an option-shaped token is an option even before any app token (v3 divergence, declared)', () => {
    const flags = parse(['w:4', 'c:2']);
    expect(flags.workers).toBe(4);
    expect(flags.workerConcurrency).toBe(2);
    expect(flags.appName).not.toBe('w:4');
  });
});

describe('listener tokens', () => {
  test('the default is https intent with no explicit ask', () => {
    const flags = parseAt([]);
    expect(flags.httpsPort).toBe(0);
    expect(flags.httpPort).toBe(0);
    expect(flags.httpsExplicit).toBeFalse();
  });
  test('http and http:<port>', () => {
    expect(parseAt(['http'])).toMatchObject({ httpsPort: null, httpPort: 0 });
    expect(parseAt(['http:8080'])).toMatchObject({ httpsPort: null, httpPort: 8080 });
  });
  test('https, https:<port>, a bare port, and --https-port are explicit https', () => {
    expect(parseAt(['https'])).toMatchObject({ httpsPort: 0, httpsExplicit: true });
    expect(parseAt(['https:8443'])).toMatchObject({ httpsPort: 8443, httpsExplicit: true });
    expect(parseAt(['9443'])).toMatchObject({ httpsPort: 9443, httpsExplicit: true });
    expect(parseAt(['--https-port=9445'])).toMatchObject({ httpsPort: 9445, httpsExplicit: true });
    expect(parseAt(['--https-port='])).toMatchObject({ httpsPort: 443 });
  });
  test('http intent wins the bare port when both protocols are spelled', () => {
    expect(parseAt(['http', '8080'])).toMatchObject({ httpPort: 8080, httpsPort: null });
  });
});

describe('app tokens', () => {
  test('a path resolves to its directory, entry, and name', () => {
    const dir = scratch();
    const flags = parse([dir]);
    expect(flags.appBaseDir).toBe(dir);
    expect(flags.appEntry).toBe(dir); // no index.rip → the directory itself (static serving)
    expect(flags.appName).toBe(basename(dir));
    expect(flags.appAliases).toEqual([basename(dir)]);
  });
  test('a directory with index.rip resolves to that entry', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'index.rip'), 'export default {}\n');
    expect(parse([dir]).appEntry).toBe(join(dir, 'index.rip'));
  });
  test('path@alias renames and registers aliases', () => {
    const dir = scratch();
    const flags = parse([`${dir}@ola,dash`]);
    expect(flags.appName).toBe('ola');
    expect(flags.appAliases).toEqual(['ola', 'dash']);
    expect(flags.appBaseDir).toBe(dir);
  });
  test('a bare name is the app name; later bare words are aliases', () => {
    const flags = parse(['ola', 'extra']);
    expect(flags.appName).toBe('ola');
    expect(flags.appAliases).toEqual(['ola', 'extra']);
  });
  test('a missing path rejects loudly with exit code 2', () => {
    expect(() => parse(['./definitely-not-a-dir-xyz/'])).toThrow(/app path not found/);
    try {
      parse(['./definitely-not-a-dir-xyz/']);
    } catch (error) {
      expect(error.exitCode).toBe(2);
    }
  });
  test('the socket prefix follows the app name unless overridden', () => {
    expect(parse(['ola']).socketPrefix).toBe('rip_ola');
    expect(parse(['ola', '--socket-prefix=custom']).socketPrefix).toBe('custom');
    expect(getPidFilePath('rip_ola')).toBe('/tmp/rip_ola.pid');
  });
});

describe('--long flags, both spellings', () => {
  test('cert and key, inline and spaced', () => {
    expect(parseAt(['--cert=/a.pem', '--key=/b.pem'])).toMatchObject({ certPath: '/a.pem', keyPath: '/b.pem' });
    expect(parseAt(['--cert', '/a.pem', '--key', '/b.pem'])).toMatchObject({ certPath: '/a.pem', keyPath: '/b.pem' });
  });
  test('config file: -f and --file', () => {
    expect(parseAt(['--file=/x/serve.rip']).configPath).toBe('/x/serve.rip');
    expect(parseAt(['-f', '/x/serve.rip']).configPath).toBe('/x/serve.rip');
  });
  test('booleans: --static, --quiet, --hsts, --no-redirect-http, --debug, --json-logging, --no-access-log', () => {
    const flags = parseAt(['--static', '--quiet', '--hsts', '--no-redirect-http', '--debug', '--json-logging', '--no-access-log']);
    expect(flags).toMatchObject({
      reload: false, quiet: true, hsts: true, redirectHttp: false,
      debug: true, jsonLogging: true, accessLog: false,
    });
    const defaults = parseAt([]);
    expect(defaults).toMatchObject({ reload: true, quiet: false, hsts: false, redirectHttp: true, accessLog: true });
  });
  test('RIP_STATIC=1 disables reload like --static', () => {
    process.env.RIP_STATIC = '1';
    expect(parseAt([]).reload).toBeFalse();
  });
  test('numbers with env fallbacks: queue, timeouts, limits', () => {
    expect(parseAt([])).toMatchObject({
      maxQueue: 512, queueTimeoutMs: 30000, connectTimeoutMs: 2000, readTimeoutMs: 30000,
      rateLimit: 300, rateLimitWindow: 60000, idleTimeoutSec: 30, maxBodyMb: 10,
    });
    process.env.RIP_MAX_QUEUE = '64';
    process.env.RIP_QUEUE_TIMEOUT_MS = '5000';
    process.env.RIP_CONNECT_TIMEOUT_MS = '900';
    process.env.RIP_READ_TIMEOUT_MS = '8000';
    expect(parseAt([])).toMatchObject({ maxQueue: 64, queueTimeoutMs: 5000, connectTimeoutMs: 900, readTimeoutMs: 8000 });
    expect(parseAt(['--max-queue=8', '--queue-timeout-ms=100'])).toMatchObject({ maxQueue: 8, queueTimeoutMs: 100 });
    expect(parseAt(['--idle-timeout-sec=-5']).idleTimeoutSec).toBe(0);   // clamped at 0
    expect(parseAt(['--max-body-mb=0']).maxBodyMb).toBe(1);              // floor of 1
    expect(parseAt(['--rate-limit=0']).rateLimit).toBe(0);               // explicit 0 disables
  });
  test('watch glob, realtime path, env override', () => {
    expect(parseAt([]).watch).toBe('*.rip');
    expect(parseAt(['--watch=**/*.css']).watch).toBe('**/*.css');
    expect(parseAt([]).realtimePath).toBe('/realtime');
    expect(parseAt(['--realtime-path=/live']).realtimePath).toBe('/live');
    expect(parseAt(['--env=prod']).envOverride).toBe('production');
    expect(parseAt(['--env=dev']).envOverride).toBe('development');
    expect(parseAt(['--env=staging']).envOverride).toBe('staging');
  });
  test('secrets arrive from flags or the environment', () => {
    process.env.RIP_PUBLISH_SECRET = 'pub-secret';
    process.env.RIP_SECRET = 'a-session-secret-of-sufficient-length';
    const flags = parseAt([]);
    expect(flags.publishSecret).toBe('pub-secret');
    expect(flags.secret).toBe('a-session-secret-of-sufficient-length');
    expect(parseAt(['--publish-secret=cli-wins']).publishSecret).toBe('cli-wins');
  });
  test('acme flags parse (serving them is S5)', () => {
    expect(parseAt(['--acme=example.com'])).toMatchObject({ acme: true, acmeStaging: false, acmeDomain: 'example.com' });
    expect(parseAt(['--acme-staging=example.com'])).toMatchObject({ acme: true, acmeStaging: true });
    expect(parseAt(['--no-acme']).noAcme).toBeTrue();
  });
  test('an unknown --flag rejects loudly (v3 divergence, declared: v3 ignored it)', () => {
    expect(() => parseAt(['--bogus'])).toThrow(/unknown flag: --bogus/);
    expect(() => parseAt(['--static=1'])).toThrow(/unknown flag/);
  });
});

describe('actions', () => {
  test('every control flag resolves its action, in v3 dispatch order', () => {
    expect(resolveServerAction(parseAt(['-c']))).toBe('check');
    expect(resolveServerAction(parseAt(['--check']))).toBe('check');
    expect(resolveServerAction(parseAt(['--check-config']))).toBe('check');
    expect(resolveServerAction(parseAt(['--nginx']))).toBe('nginx');
    expect(resolveServerAction(parseAt(['--caddy']))).toBe('caddy');
    expect(resolveServerAction(parseAt(['-i']))).toBe('info');
    expect(resolveServerAction(parseAt(['-r']))).toBe('reload');
    expect(resolveServerAction(parseAt(['-l']))).toBe('list');
    expect(resolveServerAction(parseAt(['--restart']))).toBe('restart');
    expect(resolveServerAction(parseAt(['-s']))).toBe('stop');
    expect(resolveServerAction(parseAt([]))).toBe('serve');
    expect(resolveServerAction(parseAt(['-c', '-s']))).toBe('check'); // check precedes stop
  });
});

describe('dispatchServer', () => {
  const argv = (...tokens) => ['bun', 'server', ...tokens];

  test('help and version answer before any parse — even with no app present', async () => {
    const help = await dispatchServer(argv('--help'), {});
    expect(help.code).toBe(0);
    expect(help.message).toBe(serverUsage());
    const version = await dispatchServer(argv('-v'), {}, { version: '9.9.9' });
    expect(version).toEqual({ code: 0, message: 'rip-server v9.9.9' });
    // even when the remaining tokens would reject:
    const both = await dispatchServer(argv('--help', './missing-path-zzz/'), {});
    expect(both.code).toBe(0);
  });

  test('a parse rejection is exit code 2 with the message', async () => {
    const result = await dispatchServer(argv('--bogus'), {});
    expect(result.code).toBe(2);
    expect(result.message).toContain('unknown flag');
  });

  test('handlers receive the parsed flags; results map to exit codes', async () => {
    const dir = scratch();
    let seen = null;
    const result = await dispatchServer(argv(dir, 'w:3', '-c'), { check: (flags) => { seen = flags; return 0; } });
    expect(result).toEqual({ code: 0 });
    expect(seen.workers).toBe(3);
    expect((await dispatchServer(argv(dir, '-c'), { check: () => 3 })).code).toBe(3);
    expect(await dispatchServer(argv(dir, '-c'), { check: () => ({ code: 0, message: 'ok' }) })).toEqual({ code: 0, message: 'ok' });
  });

  test('a throwing handler becomes a non-zero result, never a crash', async () => {
    const dir = scratch();
    const result = await dispatchServer(argv(dir, '-c'), { check: () => { throw new Error('nope'); } });
    expect(result.code).toBe(1);
    expect(result.message).toContain('nope');
  });

  test('an unwired action names itself', async () => {
    const dir = scratch();
    const result = await dispatchServer(argv(dir, '-i'), {});
    expect(result.code).toBe(1);
    expect(result.message).toContain("'info' is not available here");
  });
});

describe('helpers', () => {
  test('coerceInt takes finite integers and falls back on everything else', () => {
    expect(coerceInt('42', 7)).toBe(42);
    expect(coerceInt('', 7)).toBe(7);
    expect(coerceInt(undefined, 7)).toBe(7);
    expect(coerceInt('abc', 7)).toBe(7);
  });
  test('resolveAppEntry prefers index.rip, then index.ts, then the directory', () => {
    const dir = scratch();
    expect(resolveAppEntry(dir).entryPath).toBe(dir);
    writeFileSync(join(dir, 'index.ts'), 'export {}\n');
    expect(resolveAppEntry(dir).entryPath).toBe(join(dir, 'index.ts'));
    writeFileSync(join(dir, 'index.rip'), 'export default {}\n');
    expect(resolveAppEntry(dir).entryPath).toBe(join(dir, 'index.rip'));
    expect(resolveAppEntry(dir).appName).toBe(basename(dir));
  });
});
