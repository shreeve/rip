// The browser module graph: emitter-recorded specifier splicing,
// relative and bare resolution, runtime bridges keeping one copy,
// loud server-only rejection, cycles, and assembly's browser-safety
// gate.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleLoader } from '../../src/browser.js';
import { assembleBundle, assembleRipBundle } from '../../packages/sites/bundle.rip';
// The store comes from its own module, not the package entry: the
// entry evaluates renderer.rip, which claims the process's one
// render-gate construction capability — and that claim belongs to the
// browser-boot suite's module graph in this test process.
import { createComponents } from '../../packages/app/components.rip';
import { compile } from '../../src/compiler.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const registryOf = modules => {
  const components = createComponents();
  components.load(modules);
  return components;
};

describe('recorded import spans', () => {
  test('static and re-export specifiers record with exact offsets', () => {
    const out = compile("import { a } from './x.rip'\nexport { b } from './y.rip'", { runtimeDelivery: 'none' });
    expect(out.imports.length).toBe(2);
    for (const span of out.imports) {
      expect(out.code.slice(span.start, span.end)).toBe(span.specifier);
    }
  });
});

describe('createModuleLoader', () => {
  test('loads a module graph with relative imports and shared instances', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'util.rip': 'export tally = { count: 0 }\nexport bump = -> tally.count += 1',
        'routes/a.rip': "import { bump } from '../util.rip'\nbump()\nexport A = 1",
        'routes/b.rip': "import { bump, tally } from '../util.rip'\nbump()\nexport total = -> tally.count",
      }),
    });
    await loader.import('routes/a.rip');
    const b = await loader.import('routes/b.rip');
    expect(b.total()).toBe(2);
  });

  test('bare package imports resolve through the canonical index.rip convention', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'rip/demo/index.rip': 'export greet = (name) -> "hi #{name}"',
        'routes/page.rip': "import { greet } from 'rip/demo'\nexport message = greet 'rip'",
      }),
    });
    const page = await loader.import('routes/page.rip');
    expect(page.message).toBe('hi rip');
  });

  test('embedded package imports resolve without bundle source or metadata', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'routes/page.rip': "import { answer } from 'rip/core'\nexport value = answer + 1",
      }),
      embeddedPackages: {
        'rip/core': Object.freeze({ answer: 41 }),
      },
    });
    const page = await loader.import('routes/page.rip');
    expect(page.value).toBe(42);
  });

  test('runtime imports bridge to the one page copy', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'rip/demo/cell.rip': "import { __state } from '../../src/runtime/reactive.js'\nexport cell = __state 41",
      }),
    });
    const mod = await loader.import('rip/demo/cell.rip');
    const { __state } = await import(resolve(root, 'src/runtime/reactive.js'));
    const probe = __state(0);
    expect(typeof mod.cell.read).toBe('function');
    expect(mod.cell.value + 1).toBe(42);
    expect(Object.getPrototypeOf(mod.cell)).toBe(Object.getPrototypeOf(probe));
  });

  test('unknown bare and server-only imports reject naming the importer', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'routes/bad.rip': "import { x } from 'left-pad'",
        'routes/worse.rip': "import { readFileSync } from 'node:fs'",
        'routes/missing.rip': "import { y } from 'rip/nope'",
      }),
    });
    await expect(loader.import('routes/bad.rip')).rejects.toThrow(/'routes\/bad.rip' imports 'left-pad'/);
    await expect(loader.import('routes/worse.rip')).rejects.toThrow(/never travel to the browser/);
    await expect(loader.import('routes/missing.rip')).rejects.toThrow(/rip\/nope\/index\.rip.*not in the bundle/);
  });

  test('a missing relative module and an import cycle reject loudly', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'routes/a.rip': "import { b } from './b.rip'\nexport a = 1",
        'routes/b.rip': "import { a } from './a.rip'\nexport b = 2",
        'routes/lost.rip': "import { gone } from './gone.rip'",
      }),
    });
    await expect(loader.import('routes/lost.rip')).rejects.toThrow(/not in the bundle/);
    await expect(loader.import('routes/a.rip')).rejects.toThrow(/cycle/);
  });

  test('loaded namespaces land in the registry for the renderer', async () => {
    const registry = registryOf({ 'routes/page.rip': 'export Page = 42' });
    const loader = createModuleLoader({ components: registry });
    await loader.import('routes/page.rip');
    expect(registry.getCompiled('routes/page.rip').Page).toBe(42);
  });

  test('invalidation is transitive through importers', async () => {
    const registry = registryOf({
      'util.rip': "export tag = 'one'",
      'routes/page.rip': "import { tag } from '../util.rip'\nexport Page = -> tag",
    });
    const loader = createModuleLoader({ components: registry });
    const first = await loader.import('routes/page.rip');
    expect(first.Page()).toBe('one');
    registry.write('util.rip', "export tag = 'two'");
    loader.invalidate('util.rip');
    const second = await loader.import('routes/page.rip');
    expect(second.Page()).toBe('two');
    expect(registry.getCompiled('routes/page.rip').Page()).toBe('two');
  });

  test('reloading an importer replaces its dependency edges', async () => {
    const registry = registryOf({
      'util.rip': "export tag = 'one'",
      'routes/page.rip': "import { tag } from '../util.rip'\nexport Page = -> tag",
    });
    const loader = createModuleLoader({ components: registry });
    await loader.import('routes/page.rip');

    registry.write('routes/page.rip', "export Page = -> 'independent'");
    loader.invalidate('routes/page.rip');
    const page = await loader.import('routes/page.rip');
    expect(page.Page()).toBe('independent');
    expect([...loader.invalidate('util.rip')]).toEqual(['util.rip']);
  });

  test('superseded Blob modules are revoked after replacement loads', async () => {
    const registry = registryOf({
      'util.rip': "export tag = 'one'",
      'routes/page.rip': "import { tag } from '../util.rip'\nexport Page = -> tag",
    });
    const revoked = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = url => {
      revoked.push(url);
      original.call(URL, url);
    };
    const loader = createModuleLoader({ components: registry });
    try {
      await loader.import('routes/page.rip');
      registry.write('util.rip', "export tag = 'two'");
      loader.invalidate('util.rip');
      await loader.import('routes/page.rip');
      await loader.collect();
      expect(revoked.length).toBeGreaterThanOrEqual(2);
      expect(revoked.every(url => url.startsWith('blob:'))).toBeTrue();
    } finally {
      loader.dispose();
      URL.revokeObjectURL = original;
    }
  });

  test('a debug loader appends inline source maps without disturbing the module', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'util.rip': 'export base = 2',
        'routes/page.rip': "import { base } from '../util.rip'\nexport Page = base + 40",
      }),
      debug: true,
    });
    const page = await loader.import('routes/page.rip');
    expect(page.Page).toBe(42);
  });
});

describe('assembleBundle', () => {
  test('collects browser-safe packages and rejects the rest', () => {
    const bundle = assembleBundle({
      modules: {
        'routes/index.rip': "import { check } from 'rip/validate'\nexport ok = check('a@b.co', 'email')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    expect(bundle.packages['rip/validate'].root).toBe('rip/validate');
    expect(bundle.packages['rip/app']).toBeUndefined();
    expect(Object.keys(bundle.modules).some(path => path.startsWith('rip/app/'))).toBeFalse();
    expect(bundle.modules['rip/validate/validate.rip']).toContain('registerValidator');
    // Runnable verb files (root test.rip etc.) are dev-only, never bundled.
    expect(bundle.modules['rip/validate/test.rip']).toBeUndefined();
    expect(() => assembleBundle({
      modules: { 'routes/index.rip': "import { x } from 'rip/nope'" },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/not a known package/);
    expect(() => assembleBundle({
      modules: { 'routes/index.rip': "import { s } from 'node:fs'" },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/stay on the server/);
  });

  test('a package without browser safety is refused by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-pkg-'));
    try {
      for (const name of ['serveronly']) {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, 'package.json'), JSON.stringify({
          name: `rip/${name}`,
          main: 'index.rip',
          rip: {},
        }));
        writeFileSync(join(dir, name, 'index.rip'), 'export ok = 1');
      }
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { x } from 'rip/serveronly'" },
        packagesDir: dir,
      })).toThrow(/'rip\/serveronly', which does not declare browser safety/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dot-prefixed package files stay outside the browser publication', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-pkg-'));
    try {
      const pkg = join(dir, 'demo');
      mkdirSync(pkg);
      mkdirSync(join(pkg, '.private'));
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({
        name: 'rip/demo',
        exports: { '.': './index.rip' },
        rip: { browser: true },
      }));
      writeFileSync(join(pkg, 'index.rip'), 'export ok = 1');
      writeFileSync(join(pkg, '.internal.rip'), 'export hidden = 1');
      writeFileSync(join(pkg, '.private', 'secret.rip'), 'export secret = 1');
      const bundle = assembleBundle({
        modules: { 'routes/index.rip': "import { ok } from 'rip/demo'\nexport value = ok" },
        packagesDir: dir,
      });
      expect(Object.keys(bundle.modules).sort()).toEqual([
        'rip/demo/index.rip',
        'routes/index.rip',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a package contributes the modules its imports reach and nothing else under its root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-pkg-'));
    try {
      const pkg = join(dir, 'kit');
      mkdirSync(join(pkg, 'tmp-corpus'), { recursive: true });
      mkdirSync(join(pkg, 'test'));
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({
        name: 'rip/kit',
        exports: { '.': './kit.rip', './tools': './tools.rip' },
        rip: { browser: true },
      }));
      writeFileSync(join(pkg, 'kit.rip'), "import { a } from './lib/a.rip'\nexport ok = a");
      mkdirSync(join(pkg, 'lib'));
      writeFileSync(join(pkg, 'lib', 'a.rip'), "import { b } from '../b.rip'\nexport a = b");
      writeFileSync(join(pkg, 'b.rip'), 'export b = 1');
      writeFileSync(join(pkg, 'tools.rip'), 'export tools = 2');
      writeFileSync(join(pkg, 'unreached.rip'), 'export unreached = 3');
      writeFileSync(join(pkg, 'test.rip'), "import { readFileSync } from 'node:fs'");
      writeFileSync(join(pkg, 'tmp-corpus', 'stray.rip'), "import { readFileSync } from 'node:fs'\nexport bytes = readFileSync('x')");
      writeFileSync(join(pkg, 'test', 'helper.rip'), 'export helper = 4');
      writeFileSync(join(pkg, 'escape.rip'), "import { x } from '../x.rip'\nexport escape = x");
      writeFileSync(join(pkg, 'bare.rip'), "import { b } from './b'\nexport bare = b");

      // The bare import admits the entry and its relative closure; the
      // stray server-only file is never read, so it cannot fail assembly.
      const bare = assembleBundle({
        modules: { 'routes/index.rip': "import { ok } from 'rip/kit'\nexport value = ok" },
        packagesDir: dir,
      });
      expect(Object.keys(bare.modules).sort()).toEqual([
        'rip/kit/b.rip',
        'rip/kit/kit.rip',
        'rip/kit/lib/a.rip',
        'routes/index.rip',
      ]);
      expect(bare.inputHashes.map(entry => entry.path).sort()).toEqual([
        join(pkg, 'b.rip'),
        join(pkg, 'kit.rip'),
        join(pkg, 'lib', 'a.rip'),
        join(pkg, 'package.json'),
      ]);
      expect(bare.watchRoots).toEqual([pkg]);

      // A subpath admits exactly its own closure, and the published
      // program resolves it by path with the entry under its canonical name.
      const list = assembleRipBundle({
        modules: { 'routes/index.rip': "import { tools } from 'rip/kit/tools'\nexport value = tools" },
        packagesDir: dir,
      });
      expect(list.map(([path]) => path)).toEqual(['rip/kit/tools.rip', 'routes/index.rip']);

      // A reached path under a skipped tree or a hidden segment, a missing
      // file, and a relative import that leaves the package each reject at
      // the import.
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { helper } from 'rip/kit/test/helper'" },
        packagesDir: dir,
      })).toThrow(/'rip\/kit\/test\/helper\.rip', which 'rip\/kit' does not serve/);
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { secret } from 'rip/kit/.private/secret'" },
        packagesDir: dir,
      })).toThrow(/'rip\/kit\/\.private\/secret\.rip', which 'rip\/kit' does not serve/);
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { nope } from 'rip/kit/nope'" },
        packagesDir: dir,
      })).toThrow(/'rip\/kit\/nope\.rip', which 'rip\/kit' does not hold/);
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { bare } from 'rip/kit/bare'" },
        packagesDir: dir,
      })).toThrow(/'rip\/kit\/bare\.rip' imports '\.\/b', which is not a Rip module — did you mean '\.\/b\.rip'\?/);
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { escape } from 'rip/kit/escape'" },
        packagesDir: dir,
      })).toThrow(/'rip\/kit\/escape\.rip' imports '\.\.\/x\.rip', which leaves package 'rip\/kit'/);
      // Reached, the stray file fails as it should: by name, at its import.
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { bytes } from 'rip/kit/tmp-corpus/stray'" },
        packagesDir: dir,
      })).toThrow(/'rip\/kit\/tmp-corpus\/stray\.rip' imports 'node:fs'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a root-relative App id cannot collide with the embedded App package', () => {
    expect(() => assembleBundle({
      modules: { 'rip/app/index.rip': 'export page = 1' },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/collides with embedded browser package 'rip\/app'/);
  });

  test('the embedded App package never enters an assembled bundle', () => {
    const bundle = assembleBundle({
      modules: {
        'stash.rip': "import { source } from 'rip/app'\nexport stash = { value: source fetch: -> 1 }",
        'probe.rip': "import { rash } from 'rip/app/rash'\nexport probe = rash",
      },
      packagesDir: resolve(root, 'packages'),
    });
    expect(bundle.packages['rip/app']).toBeUndefined();
    expect(Object.keys(bundle.modules).sort()).toEqual(['probe.rip', 'stash.rip']);
  });

  test('end to end: the published validate package loads with no resolver metadata', async () => {
    const list = assembleRipBundle({
      modules: {
        'routes/page.rip': "import { check } from 'rip/validate'\nexport ok = check('2024-02-29', 'date')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    const loader = createModuleLoader({ components: registryOf(Object.fromEntries(list)) });
    const page = await loader.import('routes/page.rip');
    expect(page.ok).toBe('2024-02-29');
  });
});

describe('package graph reconciliation', () => {
  test('concurrent imports of a shared dependency never read as a cycle', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'shared.rip': 'export hits = { n: 0 }\nhits.n += 1',
        'routes/a.rip': "import { hits } from '../shared.rip'\nexport a = -> hits.n",
        'routes/b.rip': "import { hits } from '../shared.rip'\nexport b = -> hits.n",
      }),
    });
    const [a, b] = await Promise.all([loader.import('routes/a.rip'), loader.import('routes/b.rip')]);
    expect(a.a()).toBe(1);
    expect(b.b()).toBe(1);
  });

  test('package subpaths resolve through the canonical .rip convention', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'rip/demo/util.rip': 'export u = 1',
        'rip/demo/tools.rip': 'export d = 2',
        'routes/p.rip': "import { u } from 'rip/demo/util.rip'\nimport { d } from 'rip/demo/tools'\nexport sum = u + d",
      }),
    });
    const page = await loader.import('routes/p.rip');
    expect(page.sum).toBe(3);
  });

  test('multi-span splicing: delivery imports and user imports in one module', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'base.rip': 'export base = 2',
        'routes/heavy.rip': [
          "import { base } from '../base.rip'",
          'count := base * 10',
          'double ~= count * 2',
          // The registry is process-global and keyed by name, so the schema
          // takes a name no other suite in the run registers.
          "HeavyInput = schema\n  n! integer",
          'export read = -> { doubled: double, parsed: HeavyInput.parse({ n: 1 }).n }',
        ].join('\n'),
      }),
    });
    const heavy = await loader.import('routes/heavy.rip');
    expect(heavy.read()).toEqual({ doubled: 40, parsed: 1 });
  });

  test('traversal and extensionless imports reject with the importer voiced', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'routes/t.rip': "import { s } from 'rip/demo/../../secret.rip'",
        'routes/e.rip': "import { x } from './x'",
        'routes/x.rip': 'export x = 1',
      }),
    });
    await expect(loader.import('routes/t.rip')).rejects.toThrow(/'routes\/t.rip' imports/);
    await expect(loader.import('routes/e.rip')).rejects.toThrow(/did you mean '\.\/x\.rip'/);
  });

  test('a :model schema rejects at assembly, named honestly', () => {
    expect(() => assembleBundle({
      modules: { 'routes/m.rip': 'U = schema :model\n  name! string' },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/persistence is server-only/);
  });

  test('cross-boundary Public projections resolve through the hidden physical App mount', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-proj-'));
    try {
      mkdirSync(join(dir, 'app'));
      mkdirSync(join(dir, 'api'));
      writeFileSync(join(dir, 'api', 'models.rip'), `export User = schema :model
  firstName! string
  @times
export UserPublic = User.pick("id", "firstName")
`);
      writeFileSync(
        join(dir, 'app', 'types.rip'),
        "export { UserPublic as User } from '../api/models.rip'\n",
      );
      const typesPath = join(dir, 'app', 'types.rip');
      const typesSrc = readFileSync(typesPath, 'utf8');
      const bundle = assembleBundle({
        modules: { 'types.rip': typesSrc },
        moduleFiles: { 'types.rip': typesPath },
        appDir: dir,
        packagesDir: resolve(root, 'packages'),
      });
      expect(bundle.modules['api/models.rip']).toMatch(/export UserPublic = __schema/);
      expect(bundle.modules['api/models.rip']).not.toMatch(/kind:\s*"model"/);
      // Author spelling stays while every public App identity is root-relative.
      expect(bundle.modules['types.rip']).toBe(typesSrc);
      expect(bundle.modules['types.rip']).toContain("from '../api/models.rip'");
      const loader = createModuleLoader({ components: registryOf(bundle.modules) });
      const types = await loader.import('types.rip');
      expect(types.User).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('importing a bare :model name across the boundary refuses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-proj-'));
    try {
      mkdirSync(join(dir, 'app'));
      mkdirSync(join(dir, 'api'));
      writeFileSync(join(dir, 'api', 'models.rip'), 'export User = schema :model\n  name! string\n');
      const typesPath = join(dir, 'app', 'types.rip');
      writeFileSync(typesPath, "export { User } from '../api/models.rip'\n");
      expect(() => assembleBundle({
        modules: { 'types.rip': readFileSync(typesPath, 'utf8') },
        moduleFiles: { 'types.rip': typesPath },
        appDir: dir,
        packagesDir: resolve(root, 'packages'),
      })).toThrow(/:model/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('publication rejects package subpaths that violate the filename convention', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-pkg-'));
    try {
      for (const name of ['app', 'demo']) {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, 'package.json'), JSON.stringify({
          name: `rip/${name}`,
          exports: name === 'demo'
            ? { '.': './index.rip', './tools': './deep.rip' }
            : { '.': './index.rip' },
          rip: { browser: true },
        }));
        writeFileSync(join(dir, name, 'index.rip'), 'export ok = 1');
      }
      writeFileSync(join(dir, 'demo', 'deep.rip'), 'export d = 2');
      expect(() => assembleRipBundle({
        modules: { 'routes/p.rip': "import { d } from 'rip/demo/tools'" },
        packagesDir: dir,
      })).toThrow(/must target '.\/tools\.rip'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
