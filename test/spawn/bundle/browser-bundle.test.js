// The browser bundle's structural gates: the committed artifact stays
// byte-fresh against the pinned toolchain, carries no Node reach, and
// the entry's import graph never touches a server-only module. Graph
// edges come from a real parser (Bun.Transpiler), so every import
// spelling — static, dynamic, re-export — is an edge, never a silent
// miss.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from '../../support/spawn.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { describeExtended } from '../../support/extended.js';
import { compile } from '../../../src/compile.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifactPath = resolve(root, 'dist/@rip/rip.js');
const minPath = resolve(root, 'dist/@rip/rip.min.js');
const brPath = resolve(root, 'dist/@rip/rip.min.js.br');

// Server-only surfaces that must never be reachable from the browser
// entry. config/loader/run own the filesystem and process; orm
// owns persistence; migrate and the CLIs own operations.
const FORBIDDEN = new Set([
  'src/loader.js',
  'src/cli/run.js',
  'src/cli/check.js',
  'src/config.js',
  'src/cli/migrate.js',
  'src/cli/schema.js',
  'src/stackmap.js',
  'src/runtime/orm.js',
]);

// The emitter imports fs for inline runtime delivery; the bundle stubs
// it to a loud throw. Nothing else may import a builtin.
const ALLOWED_BUILTINS = new Set(['fs']);

const transpiler = new Bun.Transpiler({ loader: 'js' });

const walkGraph = () => {
  const seen = new Set();
  const externals = new Set();
  const queue = [resolve(root, 'src/browser.js')];
  while (queue.length) {
    const absolute = queue.pop();
    const file = absolute.slice(root.length + 1);
    if (seen.has(file)) continue;
    seen.add(file);
    let source = readFileSync(absolute, 'utf8');
    if (file.endsWith('.rip')) {
      source = compile(source, { path: absolute, runtimeDelivery: 'import' }).code;
    }
    for (const { path } of transpiler.scanImports(source)) {
      if (path.startsWith('.') || path.startsWith('/')) {
        const target = path.startsWith('/') ? path : resolve(dirname(absolute), path);
        if (target.startsWith(`${root}/`)) queue.push(target);
        else externals.add(path);
      } else {
        externals.add(path.replace(/^node:/, ''));
      }
    }
  }
  return { seen, externals };
};

const smokeCompile = (path) => {
  const probe = spawnSync('bun', ['-e', [
    `const mod = await import(${JSON.stringify(path)});`,
    "const out = mod.compileToJS('x = 41\\nx + 1');",
    "if (out.code !== 'let x = 41;\\nx + 1;') throw new Error('unexpected output: ' + out.code);",
    "if (typeof mod.runtimes.__state !== 'function') throw new Error('missing runtime');",
    "const files = new Map([['probe.rip', \"import { rash } from 'rip/app/rash'\\nexport value = rash(new TextEncoder().encode('probe'))\"]]);",
    "const compiled = new Map();",
    "const loader = mod.createModuleLoader({ components: { read: p => files.get(p), exists: p => files.has(p), setCompiled: (p, v) => compiled.set(p, v) } });",
    "const probe = await loader.import('probe.rip');",
    "if (!/^[A-Za-z0-9_]{6}$/.test(probe.value)) throw new Error('embedded App package did not resolve');",
    "console.log('ok');",
  ].join('\n')], { cwd: root, encoding: 'utf8' });
  expect(probe.stderr).toBe('');
  expect(probe.stdout.trim()).toBe('ok');
};

describe('browser entry graph', () => {
  test('reaches no server-only module', () => {
    const { seen } = walkGraph();
    for (const file of FORBIDDEN) {
      expect(seen.has(file)).toBeFalse();
    }
    expect(seen.has('src/compile.js')).toBeTrue();
    expect(seen.has('packages/app/index.rip')).toBeTrue();
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
      if (rt.key === 'orm') continue;
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

  test('browser compile rejects the TypeScript face', async () => {
    const entry = await import(resolve(root, 'src/browser.js'));
    expect(() => entry.compile('x = 1', { face: 'ts' })).toThrow(/TypeScript face/);
    expect(() => entry.compileToJS('x = 1', { face: 'ts' })).toThrow(/TypeScript face/);
  });
});

// Strings that exist only inside IDE / type-face module bodies — never as
// identifiers the JS-face emitter references. Their absence proves the
// browser artifact received the bundle stubs, not the real modules.
const IDE_ONLY_MARKERS = [
  'schemaIntrinsicLines',
  'INTRINSIC_FIELD_TYPES',
  'collectSchemaDecls',
  'unsupported object-pattern member',
  "the '...' expansion parameter has no declaration form",
  'isBehaviorProjected',
  'DtsError',
  'declaration emission: class',
];

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
    expect(code).toContain('launch requires an options object');
  });

  test('excludes IDE type-face module bodies', () => {
    expect(existsSync(artifactPath)).toBeTrue();
    expect(existsSync(minPath)).toBeTrue();
    const code = readFileSync(artifactPath, 'utf8');
    const min = readFileSync(minPath, 'utf8');
    for (const marker of IDE_ONLY_MARKERS) {
      expect(code.includes(marker)).toBeFalse();
      expect(min.includes(marker)).toBeFalse();
    }
    // Unminified artifact keeps the stub throw messages verbatim.
    expect(code).toContain('rip: declaration emission is unavailable in the browser');
    expect(code).toContain('rip: schema type story is unavailable in the browser');
    expect(code).toContain('rip: component type story is unavailable in the browser');
    // JS-face helpers that remain after the IDE split.
    expect(code).toContain('__${name}__behavior');
    expect(code).toContain('beforeMount');
    expect(min).toContain('beforeMount');
  });

  test('loads standalone and compiles', () => {
    smokeCompile(artifactPath);
  });

  test('min and brotli artifacts exist', () => {
    expect(existsSync(minPath)).toBeTrue();
    expect(existsSync(brPath)).toBeTrue();
  });

  test('brotli decompresses to exact min bytes', () => {
    const minBytes = readFileSync(minPath);
    const brBytes = readFileSync(brPath);
    expect(brotliDecompressSync(brBytes).equals(minBytes)).toBeTrue();
  });

  test('min loads standalone and compiles', () => {
    smokeCompile(minPath);
  });
});

describeExtended('browser bundle freshness', () => {
  test('regeneration is byte-identical across rip.js / rip.min.js / rip.min.js.br', () => {
    const beforeJs = readFileSync(artifactPath);
    const beforeMin = readFileSync(minPath);
    const beforeBr = readFileSync(brPath);
    const run = spawnSync('bun', ['scripts/browser-bundle.mjs'], { cwd: root, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const afterJs = readFileSync(artifactPath);
    const afterMin = readFileSync(minPath);
    const afterBr = readFileSync(brPath);
    // A mismatch means a src/ change shipped without a bundle regen.
    // The spawn above has ALREADY refreshed dist/@rip — so the remedy
    // is to review and commit those files, and the message says so.
    const fresh = (name, before, after) => {
      if (!after.equals(before)) {
        throw new Error(
          `${name} was stale (a src/ change without a bundle regen) — ` +
          'this test has already refreshed dist/@rip; review and commit those files');
      }
    };
    fresh('rip.js', beforeJs, afterJs);
    fresh('rip.min.js', beforeMin, afterMin);
    fresh('rip.min.js.br', beforeBr, afterBr);
    expect(brotliDecompressSync(afterBr).equals(afterMin)).toBeTrue();
  });
});
