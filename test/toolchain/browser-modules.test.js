// The browser module graph: emitter-recorded specifier splicing,
// relative and bare resolution, runtime bridges keeping one copy,
// loud server-only rejection, cycles, and assembly's browser-safety
// gate.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleLoader } from '../../src/browser-modules.js';
import { assembleBundle } from '../../src/bundle.js';
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
        '_app/util.rip': 'export tally = { count: 0 }\nexport bump = -> tally.count += 1',
        '_route/a.rip': "import { bump } from '../_app/util.rip'\nbump()\nexport A = 1",
        '_route/b.rip': "import { bump, tally } from '../_app/util.rip'\nbump()\nexport total = -> tally.count",
      }),
    });
    await loader.import('_route/a.rip');
    const b = await loader.import('_route/b.rip');
    expect(b.total()).toBe(2);
  });

  test('bare package imports resolve through the packages table', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_pkg/demo/index.rip': 'export greet = (name) -> "hi #{name}"',
        '_route/page.rip': "import { greet } from '@rip-lang/demo'\nexport message = greet 'rip'",
      }),
      packages: { '@rip-lang/demo': { root: '_pkg/demo', entry: 'index.rip' } },
    });
    const page = await loader.import('_route/page.rip');
    expect(page.message).toBe('hi rip');
  });

  test('runtime imports bridge to the one page copy', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_pkg/demo/cell.rip': "import { __state } from '../../src/runtime/reactive.js'\nexport cell = __state 41",
      }),
    });
    const mod = await loader.import('_pkg/demo/cell.rip');
    const { __state } = await import(resolve(root, 'src/runtime/reactive.js'));
    const probe = __state(0);
    expect(typeof mod.cell.read).toBe('function');
    expect(mod.cell.value + 1).toBe(42);
    expect(Object.getPrototypeOf(mod.cell)).toBe(Object.getPrototypeOf(probe));
  });

  test('unknown bare and server-only imports reject naming the importer', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_route/bad.rip': "import { x } from 'left-pad'",
        '_route/worse.rip': "import { readFileSync } from 'node:fs'",
        '_route/missing.rip': "import { y } from '@rip-lang/nope'",
      }),
    });
    await expect(loader.import('_route/bad.rip')).rejects.toThrow(/'_route\/bad.rip' imports 'left-pad'/);
    await expect(loader.import('_route/worse.rip')).rejects.toThrow(/never travel to the browser/);
    await expect(loader.import('_route/missing.rip')).rejects.toThrow(/no such package/);
  });

  test('a missing relative module and an import cycle reject loudly', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_route/a.rip': "import { b } from './b.rip'\nexport a = 1",
        '_route/b.rip': "import { a } from './a.rip'\nexport b = 2",
        '_route/lost.rip': "import { gone } from './gone.rip'",
      }),
    });
    await expect(loader.import('_route/lost.rip')).rejects.toThrow(/not in the bundle/);
    await expect(loader.import('_route/a.rip')).rejects.toThrow(/cycle/);
  });

  test('loaded namespaces land in the registry for the renderer', async () => {
    const registry = registryOf({ '_route/page.rip': 'export Page = 42' });
    const loader = createModuleLoader({ components: registry });
    await loader.import('_route/page.rip');
    expect(registry.getCompiled('_route/page.rip').Page).toBe(42);
  });

  test('invalidation is transitive through importers', async () => {
    const registry = registryOf({
      '_app/util.rip': "export tag = 'one'",
      '_route/page.rip': "import { tag } from '../_app/util.rip'\nexport Page = -> tag",
    });
    const loader = createModuleLoader({ components: registry });
    const first = await loader.import('_route/page.rip');
    expect(first.Page()).toBe('one');
    registry.write('_app/util.rip', "export tag = 'two'");
    loader.invalidate('_app/util.rip');
    const second = await loader.import('_route/page.rip');
    expect(second.Page()).toBe('two');
    expect(registry.getCompiled('_route/page.rip').Page()).toBe('two');
  });

  test('a debug loader appends inline source maps without disturbing the module', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_app/util.rip': 'export base = 2',
        '_route/page.rip': "import { base } from '../_app/util.rip'\nexport Page = base + 40",
      }),
      debug: true,
    });
    const page = await loader.import('_route/page.rip');
    expect(page.Page).toBe(42);
  });
});

describe('assembleBundle', () => {
  test('collects browser-safe packages and rejects the rest', () => {
    const bundle = assembleBundle({
      modules: {
        '_route/index.rip': "import { check } from '@rip-lang/validate'\nexport ok = check('a@b.co', 'email')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    expect(bundle.packages['@rip-lang/validate'].root).toBe('_pkg/validate');
    expect(bundle.modules['_pkg/validate/index.rip']).toContain('registry.rip');
    expect(() => assembleBundle({
      modules: { '_route/index.rip': "import { x } from '@rip-lang/nope'" },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/not a known package/);
    expect(() => assembleBundle({
      modules: { '_route/index.rip': "import { s } from 'node:fs'" },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/stay on the server/);
  });

  test('a package without browser safety is refused by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-pkg-'));
    try {
      // The stand-in packages dir carries the app package (every
      // bundle's boot substrate) and one package with no browser flag.
      for (const name of ['app', 'serveronly']) {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, 'package.json'), JSON.stringify({
          name: `@rip-lang/${name}`,
          main: 'index.rip',
          rip: name === 'app' ? { browser: true } : {},
        }));
        writeFileSync(join(dir, name, 'index.rip'), 'export ok = 1');
      }
      expect(() => assembleBundle({
        modules: { '_route/index.rip': "import { x } from '@rip-lang/serveronly'" },
        packagesDir: dir,
      })).toThrow(/'@rip-lang\/serveronly', which does not declare browser safety/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('end to end: assembled validate package loads in the browser graph', async () => {
    const bundle = assembleBundle({
      modules: {
        '_route/page.rip': "import { check } from '@rip-lang/validate'\nexport ok = check('2024-02-29', 'date')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    const loader = createModuleLoader({
      components: registryOf(bundle.modules),
      packages: bundle.packages,
    });
    const page = await loader.import('_route/page.rip');
    expect(page.ok).toBe('2024-02-29');
  });
});

describe('package graph reconciliation', () => {
  test('concurrent imports of a shared dependency never read as a cycle', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_app/shared.rip': 'export hits = { n: 0 }\nhits.n += 1',
        '_route/a.rip': "import { hits } from '../_app/shared.rip'\nexport a = -> hits.n",
        '_route/b.rip': "import { hits } from '../_app/shared.rip'\nexport b = -> hits.n",
      }),
    });
    const [a, b] = await Promise.all([loader.import('_route/a.rip'), loader.import('_route/b.rip')]);
    expect(a.a()).toBe(1);
    expect(b.b()).toBe(1);
  });

  test('subpaths resolve through the manifest exports map and never double the suffix', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_pkg/demo/util.rip': 'export u = 1',
        '_pkg/demo/deep.rip': 'export d = 2',
        '_route/p.rip': "import { u } from '@rip-lang/demo/util.rip'\nimport { d } from '@rip-lang/demo/tools'\nexport sum = u + d",
      }),
      packages: {
        '@rip-lang/demo': { root: '_pkg/demo', entry: 'index.rip', exports: { './tools': 'deep.rip' } },
      },
    });
    const page = await loader.import('_route/p.rip');
    expect(page.sum).toBe(3);
  });

  test('multi-span splicing: delivery imports and user imports in one module', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_app/base.rip': 'export base = 2',
        '_route/heavy.rip': [
          "import { base } from '../_app/base.rip'",
          'count := base * 10',
          'double ~= count * 2',
          "S = schema\n  n! int",
          'export read = -> { doubled: double, parsed: S.parse({ n: 1 }).n }',
        ].join('\n'),
      }),
    });
    const heavy = await loader.import('_route/heavy.rip');
    expect(heavy.read()).toEqual({ doubled: 40, parsed: 1 });
  });

  test('traversal and extensionless imports reject with the importer voiced', async () => {
    const loader = createModuleLoader({
      components: registryOf({
        '_route/t.rip': "import { s } from '_pkg/demo/../../secret.rip'",
        '_route/e.rip': "import { x } from './x'",
        '_route/x.rip': 'export x = 1',
      }),
    });
    await expect(loader.import('_route/t.rip')).rejects.toThrow(/'_route\/t.rip' imports/);
    await expect(loader.import('_route/e.rip')).rejects.toThrow(/did you mean '\.\/x\.rip'/);
  });

  test('a :model schema rejects at assembly, named honestly', () => {
    expect(() => assembleBundle({
      modules: { '_route/m.rip': 'U = schema :model\n  name! string' },
      packagesDir: resolve(root, 'packages'),
    })).toThrow(/persistence is server-only/);
  });

  test('assembled subpath exports travel into the packages table', () => {
    const bundle = assembleBundle({
      modules: { '_route/p.rip': "import '@rip-lang/validate/coercers'" },
      packagesDir: resolve(root, 'packages'),
    });
    expect(bundle.packages['@rip-lang/validate'].exports['./coercers']).toBe('coercers.rip');
  });
});
