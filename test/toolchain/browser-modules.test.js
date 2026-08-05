// The browser module graph: emitter-recorded specifier splicing,
// relative and bare resolution, runtime bridges keeping one copy,
// loud server-only rejection, cycles, and assembly's browser-safety
// gate.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleLoader } from '../../src/browser-modules.js';
import { assembleBundle, assembleRipBundle } from '../../packages/sites/bundle.rip';
// The store comes from its own module, not the package entry: the
// entry evaluates renderer.rip, which claims the process's one
// render-gate construction capability — and that claim belongs to the
// browser-boot suite's module graph in this test process.
import { createComponents } from '../../packages/app/components.rip';
import { compile } from '../../src/compile.js';

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
        '@rip-lang/demo/index.rip': 'export greet = (name) -> "hi #{name}"',
        'routes/page.rip': "import { greet } from '@rip-lang/demo'\nexport message = greet 'rip'",
      }),
    });
    const page = await loader.import('routes/page.rip');
    expect(page.message).toBe('hi rip');
  });

  test('embedded package imports resolve without bundle source or metadata', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'routes/page.rip': "import { answer } from '@rip-lang/core'\nexport value = answer + 1",
      }),
      embeddedPackages: {
        '@rip-lang/core': Object.freeze({ answer: 41 }),
      },
    });
    const page = await loader.import('routes/page.rip');
    expect(page.value).toBe(42);
  });

  test('runtime imports bridge to the one page copy', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '@rip-lang/demo/cell.rip': "import { __state } from '../../src/runtime/reactive.js'\nexport cell = __state 41",
      }),
    });
    const mod = await loader.import('@rip-lang/demo/cell.rip');
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
        'routes/missing.rip': "import { y } from '@rip-lang/nope'",
      }),
    });
    await expect(loader.import('routes/bad.rip')).rejects.toThrow(/'routes\/bad.rip' imports 'left-pad'/);
    await expect(loader.import('routes/worse.rip')).rejects.toThrow(/never travel to the browser/);
    await expect(loader.import('routes/missing.rip')).rejects.toThrow(/@rip-lang\/nope\/index\.rip.*not in the bundle/);
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
        'routes/index.rip': "import { check } from '@rip-lang/validate'\nexport ok = check('a@b.co', 'email')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    expect(bundle.packages['@rip-lang/validate'].root).toBe('@rip-lang/validate');
    expect(bundle.packages['@rip-lang/app']).toBeUndefined();
    expect(Object.keys(bundle.modules).some(path => path.startsWith('@rip-lang/app/'))).toBeFalse();
    expect(bundle.modules['@rip-lang/validate/validate.rip']).toContain('registerValidator');
    // Runnable verb files (root test.rip etc.) are dev-only, never bundled.
    expect(bundle.modules['@rip-lang/validate/test.rip']).toBeUndefined();
    expect(() => assembleBundle({
      modules: { 'routes/index.rip': "import { x } from '@rip-lang/nope'" },
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
          name: `@rip-lang/${name}`,
          main: 'index.rip',
          rip: {},
        }));
        writeFileSync(join(dir, name, 'index.rip'), 'export ok = 1');
      }
      expect(() => assembleBundle({
        modules: { 'routes/index.rip': "import { x } from '@rip-lang/serveronly'" },
        packagesDir: dir,
      })).toThrow(/'@rip-lang\/serveronly', which does not declare browser safety/);
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
        name: '@rip-lang/demo',
        exports: { '.': './index.rip' },
        rip: { browser: true },
      }));
      writeFileSync(join(pkg, 'index.rip'), 'export ok = 1');
      writeFileSync(join(pkg, '.internal.rip'), 'export hidden = 1');
      writeFileSync(join(pkg, '.private', 'secret.rip'), 'export secret = 1');
      const bundle = assembleBundle({
        modules: { 'routes/index.rip': "import { ok } from '@rip-lang/demo'\nexport value = ok" },
        packagesDir: dir,
      });
      expect(Object.keys(bundle.modules).sort()).toEqual([
        '@rip-lang/demo/index.rip',
        'routes/index.rip',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a root-relative App id cannot collide with the embedded App package', () => {
    expect(() => assembleBundle({
      modules: { '@rip-lang/app/index.rip': 'export page = 1' },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/collides with embedded browser package '@rip-lang\/app'/);
  });

  test('the embedded App package never enters an assembled bundle', () => {
    const bundle = assembleBundle({
      modules: {
        'stash.rip': "import { source } from '@rip-lang/app'\nexport stash = { value: source fetch: -> 1 }",
        'probe.rip': "import { rash } from '@rip-lang/app/rash'\nexport probe = rash",
      },
      packagesDir: resolve(root, 'packages'),
    });
    expect(bundle.packages['@rip-lang/app']).toBeUndefined();
    expect(Object.keys(bundle.modules).sort()).toEqual(['probe.rip', 'stash.rip']);
  });

  test('end to end: the published validate package loads with no resolver metadata', async () => {
    const list = assembleRipBundle({
      modules: {
        'routes/page.rip': "import { check } from '@rip-lang/validate'\nexport ok = check('2024-02-29', 'date')",
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
        '@rip-lang/demo/util.rip': 'export u = 1',
        '@rip-lang/demo/tools.rip': 'export d = 2',
        'routes/p.rip': "import { u } from '@rip-lang/demo/util.rip'\nimport { d } from '@rip-lang/demo/tools'\nexport sum = u + d",
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
          "S = schema\n  n! int",
          'export read = -> { doubled: double, parsed: S.parse({ n: 1 }).n }',
        ].join('\n'),
      }),
    });
    const heavy = await loader.import('routes/heavy.rip');
    expect(heavy.read()).toEqual({ doubled: 40, parsed: 1 });
  });

  test('traversal and extensionless imports reject with the importer voiced', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        'routes/t.rip': "import { s } from '@rip-lang/demo/../../secret.rip'",
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
  @timestamps
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
          name: `@rip-lang/${name}`,
          exports: name === 'demo'
            ? { '.': './index.rip', './tools': './deep.rip' }
            : { '.': './index.rip' },
          rip: { browser: true },
        }));
        writeFileSync(join(dir, name, 'index.rip'), 'export ok = 1');
      }
      writeFileSync(join(dir, 'demo', 'deep.rip'), 'export d = 2');
      expect(() => assembleRipBundle({
        modules: { 'routes/p.rip': "import { d } from '@rip-lang/demo/tools'" },
        packagesDir: dir,
      })).toThrow(/must target '.\/tools\.rip'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
