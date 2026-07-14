// The browser bundle's structural gates: the committed artifact stays
// byte-fresh against the pinned toolchain, carries no Node reach, and
// the entry's import graph never touches a server-only module. Graph
// edges come from a real parser (Bun.Transpiler), so every import
// spelling — static, dynamic, re-export — is an edge, never a silent
// miss.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeExtended } from '../support/extended.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactPath = resolve(root, 'dist/browser/rip.js');

// Server-only surfaces that must never be reachable from the browser
// entry. config/loader/run own the filesystem and process; schema-orm
// owns persistence; migrate and the CLIs own operations.
const FORBIDDEN = new Set([
  'src/loader.js',
  'src/run.js',
  'src/config.js',
  'src/migrate.js',
  'src/schema-cli.js',
  'src/stackmap.js',
  'src/runtime/schema-orm.js',
]);

// The emitter imports fs for inline runtime delivery; the bundle stubs
// it to a loud throw. Nothing else may import a builtin.
const ALLOWED_BUILTINS = new Set(['fs']);

const transpiler = new Bun.Transpiler({ loader: 'js' });

const walkGraph = () => {
  const seen = new Set();
  const externals = new Set();
  const queue = ['src/browser.js'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const { path } of transpiler.scanImports(source)) {
      if (path.startsWith('.')) {
        queue.push(resolve('/', dirname(file), path).slice(1));
      } else {
        externals.add(path.replace(/^node:/, ''));
      }
    }
  }
  return { seen, externals };
};

describe('browser entry graph', () => {
  test('reaches no server-only module', () => {
    const { seen } = walkGraph();
    for (const file of FORBIDDEN) {
      expect(seen.has(file)).toBeFalse();
    }
    expect(seen.has('src/compile.js')).toBeTrue();
    expect(seen.has('src/runtime/reactive.js')).toBeTrue();
    expect(seen.has('src/runtime/components.js')).toBeTrue();
  });

  test('imports no external beyond the stubbed fs', () => {
    const { externals } = walkGraph();
    for (const name of externals) {
      expect(ALLOWED_BUILTINS.has(name)).toBeTrue();
    }
  });
});

describe('browser entry surface', () => {
  test('every browser-delivered runtime name is in the runtimes scope', async () => {
    const [entry, emitter] = await Promise.all([
      import(resolve(root, 'src/browser.js')),
      import(resolve(root, 'src/emitter.js')),
    ]);
    for (const rt of emitter._runtimeTable()) {
      if (rt.key === 'schema-orm') continue;
      for (const name of rt.names) {
        expect(name in entry.runtimes).toBeTrue();
      }
    }
  });

  test('runtime namespace overlaps are the same bindings', async () => {
    const modules = await Promise.all([
      import(resolve(root, 'src/runtime/intrinsics.js')),
      import(resolve(root, 'src/runtime/stdlib.js')),
      import(resolve(root, 'src/runtime/schema.js')),
      import(resolve(root, 'src/runtime/reactive.js')),
      import(resolve(root, 'src/runtime/components.js')),
    ]);
    const owners = new Map();
    for (const mod of modules) {
      for (const [name, value] of Object.entries(mod)) {
        if (owners.has(name)) {
          expect(Object.is(owners.get(name), value)).toBeTrue();
        }
        owners.set(name, value);
      }
    }
  });

  test('compileToJS rejects other delivery modes and keeps positions', async () => {
    const entry = await import(resolve(root, 'src/browser.js'));
    expect(() => entry.compileToJS('x = 1', { runtimeDelivery: 'inline' })).toThrow(/by scope/);
    let caught = null;
    try {
      entry.compileToJS('x = ((', { path: 'probe.rip' });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toContain('probe.rip');
    expect(typeof caught.line).toBe('number');
    expect(typeof caught.col).toBe('number');
  });
});

describe('browser bundle artifact', () => {
  test('exists and carries no Node reach', () => {
    expect(existsSync(artifactPath)).toBeTrue();
    const code = readFileSync(artifactPath, 'utf8');
    expect(code).not.toMatch(/from\s*['"]node:/);
    expect(code).not.toMatch(/require\(\s*['"]node:/);
    expect(code).not.toMatch(/import\(\s*['"]node:/);
    let at = code.indexOf('process.exit');
    while (at >= 0) {
      expect(code.slice(Math.max(0, at - 200), at)).toContain('typeof process');
      at = code.indexOf('process.exit', at + 1);
    }
    expect(code).toContain('rip: filesystem access is unavailable in the browser');
    expect(code).toContain('rip.runtime.reactive');
    expect(code).toContain('rip.runtime.components');
    expect(code).toContain('rip.runtime.schema');
  });

  test('loads standalone and compiles', () => {
    const probe = spawnSync('bun', ['-e', [
      `const mod = await import(${JSON.stringify(artifactPath)});`,
      "const out = mod.compileToJS('x = 41\\nx + 1');",
      "if (out.code !== 'let x = 41;\\nx + 1;') throw new Error('unexpected output: ' + out.code);",
      "if (typeof mod.runtimes.__state !== 'function') throw new Error('missing runtime');",
      "console.log('ok');",
    ].join('\n')], { cwd: root, encoding: 'utf8' });
    expect(probe.stderr).toBe('');
    expect(probe.stdout.trim()).toBe('ok');
  });
});

describeExtended('browser bundle freshness', () => {
  test('regeneration is byte-identical to the committed artifact', () => {
    const before = readFileSync(artifactPath);
    const run = spawnSync('bun', ['scripts/browser-bundle.mjs'], { cwd: root, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const after = readFileSync(artifactPath);
    expect(after.equals(before)).toBeTrue();
  });
});
