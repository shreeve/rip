// Process pins for the compile cache (src/cacher.js): a hit is
// byte-identical to a miss and to an uncached compile; the compiler
// fingerprint invalidates; torn entries, a disabled cache, and an
// unwritable directory all degrade to a plain compile; concurrent
// writers leave one whole entry; a compile error is never cached.
import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawn, spawnSync } from '../../support/spawn.js';

const ROOT = resolve(import.meta.dir, '../../..');
const LOADER = join(ROOT, 'src', 'loader.js');
const CACHE_MODULE = join(ROOT, 'src', 'cacher.js');

// Prints the cached triple for one module, so the bytes a hit hands
// back can be compared with a miss's and with compile()'s own.
const EMIT = `
const { compileCached } = await import(process.argv[2]);
const { readFileSync } = await import('fs');
const path = process.argv[3];
const { code, map, runtimes } = compileCached(readFileSync(path, 'utf8'), { path, runtimeDelivery: 'import' });
process.stdout.write(JSON.stringify({ code, map, runtimes: [...runtimes] }));
`;

let dir, emitScript, hello, big;
const baseEnv = () => {
  const env = { ...process.env };
  delete env.RIP_NO_CACHE;
  delete env.RIP_CACHE_DIR;
  delete env.RIP_CACHE_DEBUG;
  return env;
};
const withCache = (cacheDir, extra = {}) => ({ ...baseEnv(), RIP_CACHE_DIR: cacheDir, RIP_CACHE_DEBUG: '1', ...extra });
// Children run from the temp dir: the checkout's bunfig.toml would
// otherwise preload the loader (and its cache module) into every one.
const run = (file, env) => spawnSync('bun', [`--preload=${LOADER}`, file], { encoding: 'utf8', env, cwd: dir });
const emit = (module, file, env) => spawnSync('bun', [emitScript, module, file], { encoding: 'utf8', env, cwd: dir });
const entries = (cacheDir) => (existsSync(cacheDir) ? readdirSync(cacheDir) : []);
const jsonEntries = (cacheDir) => entries(cacheDir).filter((name) => name.endsWith('.json'));
const summary = (stderr) => stderr.match(/\[rip compile cache\] .*: (\d+) hits, (\d+) misses, (\d+) bypasses, (\d+) write failures/);
const fresh = (name) => { const at = join(dir, name); rmSync(at, { recursive: true, force: true }); return at; };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rip-compile-cache-'));
  emitScript = join(dir, 'emit.js');
  writeFileSync(emitScript, EMIT);
  hello = join(dir, 'hello.rip');
  writeFileSync(hello, 'greeting := "hi"\nconsole.log "#{greeting} from cache"\n');
  // Enough source that four concurrent compiles overlap in time.
  big = join(dir, 'big.rip');
  const lines = [];
  for (let i = 0; i < 400; i++) lines.push(`def f${i}(a, b)\n  c = a + b * ${i}\n  return [x * c for x in [1, 2, 3] when x > 1]`);
  lines.push('console.log f1(1, 2).length', '');
  writeFileSync(big, lines.join('\n'));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('compile cache: hit and miss', () => {
  test('a hit hands back the bytes of the miss it replaces, and of an uncached compile', () => {
    const cacheDir = fresh('identity');
    const miss = emit(CACHE_MODULE, hello, withCache(cacheDir));
    const hit = emit(CACHE_MODULE, hello, withCache(cacheDir));
    const plain = emit(CACHE_MODULE, hello, { ...baseEnv(), RIP_NO_CACHE: '1', RIP_CACHE_DEBUG: '1' });
    expect(miss.status).toBe(0);
    expect(summary(miss.stderr).slice(1, 5)).toEqual(['0', '1', '0', '0']);
    expect(summary(hit.stderr).slice(1, 5)).toEqual(['1', '0', '0', '0']);
    expect(summary(plain.stderr).slice(1, 5)).toEqual(['0', '0', '1', '0']);
    expect(plain.stderr).toContain('[rip compile cache] disabled:');
    expect(hit.stdout).toBe(miss.stdout);
    expect(plain.stdout).toBe(miss.stdout);
    const parsed = JSON.parse(hit.stdout);
    expect(parsed.runtimes).toEqual(['reactive']);
    expect(parsed.map.sources).toEqual([hello]);
    expect(jsonEntries(cacheDir)).toHaveLength(1);
    expect(entries(cacheDir).some((name) => name.endsWith('.tmp'))).toBeFalse();
  });

  test('under the loader a hit runs the module exactly as the miss did, without new output', () => {
    const cacheDir = fresh('loader');
    const miss = run(hello, { ...baseEnv(), RIP_CACHE_DIR: cacheDir });
    const hit = run(hello, { ...baseEnv(), RIP_CACHE_DIR: cacheDir });
    expect(miss.status).toBe(0);
    expect(miss.stdout).toBe('hi from cache\n');
    expect(miss.stderr).toBe('');
    expect(hit.status).toBe(0);
    expect(hit.stdout).toBe(miss.stdout);
    expect(hit.stderr).toBe('');
    expect(jsonEntries(cacheDir)).toHaveLength(1);
  });

  test('RIP_NO_CACHE=1 neither reads nor writes', () => {
    const cacheDir = fresh('disabled');
    const r = run(hello, { ...baseEnv(), RIP_CACHE_DIR: cacheDir, RIP_NO_CACHE: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('hi from cache\n');
    expect(r.stderr).toBe('');
    expect(existsSync(cacheDir)).toBeFalse();
  });
});

describe('compile cache: the fingerprint', () => {
  test('a byte changed in any compiler source, or a moved checkout, is a different key', () => {
    // A private copy of the compiler: its fingerprint covers ITS
    // src/**/*.js and ITS root, so the same source keyed through it
    // lands beside — never on top of — the real checkout's entry.
    const copy = join(dir, 'checkout');
    rmSync(copy, { recursive: true, force: true });
    mkdirSync(copy);
    cpSync(join(ROOT, 'src'), join(copy, 'src'), { recursive: true });
    const copiedModule = join(copy, 'src', 'cacher.js');
    const cacheDir = fresh('fingerprint');
    const real = emit(CACHE_MODULE, hello, withCache(cacheDir));
    const moved = emit(copiedModule, hello, withCache(cacheDir));
    expect(moved.status).toBe(0);
    expect(summary(moved.stderr).slice(1, 3)).toEqual(['0', '1']);
    // The two emissions differ, and only in the runtime import's
    // absolute path — which is why the root is part of the key.
    expect(moved.stdout).not.toBe(real.stdout);
    expect(moved.stdout.replaceAll(realpathSync(copy), ROOT)).toBe(real.stdout);
    expect(jsonEntries(cacheDir)).toHaveLength(2);
    // Touching one byte of a file the compile never even reaches
    // (the op counter) still invalidates: the fingerprint is coarse.
    appendFileSync(join(copy, 'src', 'counter.js'), '\n// touched\n');
    const touched = emit(copiedModule, hello, withCache(cacheDir));
    expect(touched.status).toBe(0);
    expect(summary(touched.stderr).slice(1, 3)).toEqual(['0', '1']);
    expect(touched.stdout).toBe(moved.stdout);
    expect(jsonEntries(cacheDir)).toHaveLength(3);
    const again = emit(copiedModule, hello, withCache(cacheDir));
    expect(summary(again.stderr).slice(1, 3)).toEqual(['1', '0']);
    expect(jsonEntries(cacheDir)).toHaveLength(3);
  });
});

describe('compile cache: degradation', () => {
  test('a torn entry is dropped and recompiled, then replaced whole', () => {
    const cacheDir = fresh('torn');
    const miss = run(hello, { ...baseEnv(), RIP_CACHE_DIR: cacheDir });
    expect(miss.status).toBe(0);
    const [name] = jsonEntries(cacheDir);
    const whole = readFileSync(join(cacheDir, name), 'utf8');
    writeFileSync(join(cacheDir, name), whole.slice(0, whole.length >> 1));
    const recovered = run(hello, withCache(cacheDir));
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toBe('hi from cache\n');
    expect(summary(recovered.stderr).slice(1, 3)).toEqual(['0', '1']);
    expect(readFileSync(join(cacheDir, name), 'utf8')).toBe(whole);
    // A foreign file of the right name but the wrong shape reads as a
    // miss too — validated by shape, not merely by parse.
    writeFileSync(join(cacheDir, name), JSON.stringify({ contents: 'console.log("impostor")' }));
    const shaped = run(hello, withCache(cacheDir));
    expect(shaped.stdout).toBe('hi from cache\n');
    expect(summary(shaped.stderr).slice(1, 3)).toEqual(['0', '1']);
    expect(readFileSync(join(cacheDir, name), 'utf8')).toBe(whole);
  });

  test('an unwritable directory degrades to a plain compile, silently', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const cacheDir = join(blocker, 'cache');
    const quiet = run(hello, { ...baseEnv(), RIP_CACHE_DIR: cacheDir });
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe('hi from cache\n');
    expect(quiet.stderr).toBe('');
    const loud = run(hello, withCache(cacheDir));
    expect(loud.stdout).toBe('hi from cache\n');
    expect(summary(loud.stderr).slice(1, 5)).toEqual(['0', '1', '0', '1']);
  });

  test('a compile error is reported identically every time and never cached', () => {
    const cacheDir = fresh('error');
    const broken = join(dir, 'broken.rip');
    writeFileSync(broken, 'ok = 1\nx = (\n');
    const first = run(broken, { ...baseEnv(), RIP_CACHE_DIR: cacheDir });
    const second = run(broken, { ...baseEnv(), RIP_CACHE_DIR: cacheDir });
    expect(first.status).not.toBe(0);
    expect(first.stderr).toContain('broken.rip:2:');
    expect(second.status).toBe(first.status);
    expect(second.stderr).toBe(first.stderr);
    expect(jsonEntries(cacheDir)).toHaveLength(0);
  });
});

describe('compile cache: concurrent writers', () => {
  test('four processes compiling one module leave one whole entry and no temp files', async () => {
    const cacheDir = fresh('race');
    const children = Array.from({ length: 4 }, () => {
      const child = spawn('bun', [emitScript, CACHE_MODULE, big], { env: withCache(cacheDir), cwd: dir });
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      return new Promise((done) => child.on('close', (status) => done({ status, stdout, stderr })));
    });
    const results = await Promise.all(children);
    for (const r of results) {
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(results[0].stdout);
      expect(summary(r.stderr)[4]).toBe('0');
    }
    const names = entries(cacheDir);
    expect(names.filter((name) => name.endsWith('.json'))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
    const entry = JSON.parse(readFileSync(join(cacheDir, names[0]), 'utf8'));
    expect(JSON.stringify({ code: entry.code, map: entry.map, runtimes: entry.runtimes })).toBe(results[0].stdout);
    const hit = emit(CACHE_MODULE, big, withCache(cacheDir));
    expect(summary(hit.stderr).slice(1, 3)).toEqual(['1', '0']);
    expect(hit.stdout).toBe(results[0].stdout);
  });
});
