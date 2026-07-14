// Application boot through the browser entry, end to end under Node:
// bundle fetch with ETag revalidation, the module graph compiling the
// app package and every route, launch wiring, navigation, and render
// gates — the same path the real-browser certification drives.
import { describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootApp, fetchBundle } from '../../src/browser.js';
import { assembleBundle } from '../../src/bundle.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const node = name => ({
  name,
  children: [],
  parentNode: null,
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  },
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  },
  querySelector: () => null,
});

const fakeAdapter = (initial = '/') => {
  const listeners = new Set();
  const entries = [{ url: initial, state: null }];
  let index = 0;
  return {
    read: () => entries[index].url,
    readState: () => entries[index].state,
    push(url, state) { entries.splice(index + 1); entries.push({ url, state }); index += 1; },
    replace(url, state) { entries[index] = { url, state }; },
    go(delta) {
      const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
      if (next === index) return;
      index = next;
      for (const fn of [...listeners]) fn();
    },
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
};

const APP_MODULES = {
  '_app/stash.rip': [
    "import { source } from '@rip-lang/app'",
    'export appStash = {',
    '  user: source fetch: -> Promise.resolve { name: "Ada" }',
    '}',
  ].join('\n'),
  '_route/index.rip': [
    'export Home = component',
    '  render',
    '    h1 "home"',
  ].join('\n'),
  '_route/about.rip': [
    'export About = component',
    '  render',
    '    h1 "about"',
  ].join('\n'),
};

const assemble = () => assembleBundle({
  modules: APP_MODULES,
  packagesDir: resolve(root, 'packages'),
  data: { title: 'probe' },
});

describe('fetchBundle', () => {
  test('caches by ETag and serves 304 revalidations from storage', async () => {
    const table = new Map();
    const storage = {
      getItem: key => table.get(key) ?? null,
      setItem: (key, value) => void table.set(key, value),
    };
    let calls = 0;
    const fetchText = async (url, etag) => {
      calls += 1;
      if (etag === 'v1') return { fresh: false };
      return { fresh: true, text: JSON.stringify({ modules: {}, packages: { x: 1 }, n: calls }), etag: 'v1' };
    };
    const first = await fetchBundle('/app', { fetchText, storage });
    expect(first.n).toBe(1);
    const second = await fetchBundle('/app', { fetchText, storage });
    expect(second.n).toBe(1);
    expect(calls).toBe(2);
  });

  test('a failed fetch and a bodyless 304 reject loudly', async () => {
    await expect(fetchBundle('/app', {
      fetchText: async () => { throw new Error('rip: failed to fetch bundle'); },
      storage: null,
    })).rejects.toThrow(/failed to fetch/);
    await expect(fetchBundle('/app', {
      fetchText: async () => ({ fresh: false }),
      storage: null,
    })).rejects.toThrow(/no cached body/);
  });
});

describe('fetchBundle reconciliation', () => {
  test('a poisoned cache self-heals with one unconditional refetch', async () => {
    const table = new Map([
      ['__rip_bundle_etag:/app', 'v1'],
      ['__rip_bundle_body:/app', 'not json'],
    ]);
    const storage = {
      getItem: key => table.get(key) ?? null,
      setItem: (key, value) => void table.set(key, value),
      removeItem: key => void table.delete(key),
    };
    const etags = [];
    const fetchText = async (url, etag) => {
      etags.push(etag);
      if (etag === 'v1') return { fresh: false };
      return { fresh: true, text: '{"ok":1}', etag: 'v2' };
    };
    const bundle = await fetchBundle('/app', { fetchText, storage });
    expect(bundle.ok).toBe(1);
    expect(etags).toEqual(['v1', null]);
    expect(table.get('__rip_bundle_body:/app')).toBe('{"ok":1}');
    expect(table.get('__rip_bundle_etag:/app')).toBe('v2');
  });

  test('an invalid fresh body rejects by name and never caches', async () => {
    const table = new Map();
    const storage = {
      getItem: key => table.get(key) ?? null,
      setItem: (key, value) => void table.set(key, value),
    };
    await expect(fetchBundle('/app', {
      fetchText: async () => ({ fresh: true, text: 'nope', etag: 'v1' }),
      storage,
    })).rejects.toThrow(/'\/app' is not valid JSON/);
    expect(table.size).toBe(0);
  });

  test('a missing url rejects by name', async () => {
    await expect(fetchBundle()).rejects.toThrow(/requires a url/);
    await expect(bootApp({})).rejects.toThrow(/bundle or a url/);
  });
});

describe('bootApp', () => {
  test('a bundle without the app package rejects by name', async () => {
    await expect(bootApp({ bundle: { modules: {}, packages: {} } })).rejects.toThrow(/@rip-lang\/app/);
  });

  test('boots the assembled app, mounts the route, and navigates', async () => {
    const bundle = assemble();
    expect(bundle.packages['@rip-lang/app'].root).toBe('_pkg/app');
    const host = node('host');
    const adapter = fakeAdapter('/');
    const result = await bootApp({ bundle, target: host, adapter });
    try {
      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(result.router.current.route.file).toBe('_route/index.rip');
      expect(globalThis.__ripApp).toBe(result.app);
      result.router.push('/about');
      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(result.router.current.route.file).toBe('_route/about.rip');
      expect(result.app.data.title).toBe('probe');
    } finally {
      result.destroy();
    }
  });

  test('the app stash flows from _app/stash.rip and gates prefetch through it', async () => {
    const bundle = assemble();
    bundle.modules['_route/profile.rip'] = [
      'export Profile = component',
      '  user <~ @app.data.user',
      '  render',
      '    h1 user.name',
    ].join('\n');
    const failures = [];
    const result = await bootApp({
      bundle,
      target: node('host'),
      adapter: fakeAdapter('/'),
      onError: failure => failures.push(failure),
    });
    try {
      result.router.push('/profile');
      let user = null;
      for (let tries = 0; tries < 50 && !user; tries += 1) {
        await Bun.sleep(1);
        user = result.app.data.user;
      }
      expect(result.router.current.route.file).toBe('_route/profile.rip');
      expect(user).toEqual({ name: 'Ada' });
      expect(failures.map(f => f.path)).not.toContain('user');
    } finally {
      result.destroy();
    }
  });

  test('a route that fails to compile rejects the boot at its own position', async () => {
    const bundle = assemble();
    bundle.modules['_route/broken.rip'] = 'x = ((';
    await expect(bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') }))
      .rejects.toThrow(/_route\/broken\.rip/);
  });

  test('render gates prefetch through the boot path', async () => {
    const bundle = assembleBundle({
      modules: {
        '_route/index.rip': [
          'export Profile = component',
          '  user <~ @app.data.user',
          '  render',
          '    h1 user.name',
        ].join('\n'),
      },
      packagesDir: resolve(root, 'packages'),
    });
    const host = node('host');
    const failures = [];
    const result = await bootApp({
      bundle,
      target: host,
      adapter: fakeAdapter('/'),
      onError: failure => failures.push(failure),
    });
    try {
      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(failures.map(f => f.path)).toEqual(['user']);
    } finally {
      result.destroy();
    }
  });
});

// One page, one cached graph per app fingerprint: reboots must see
// exactly their own bundle — no stale importers, no leftover modules,
// no frozen packages table.
describe('boot graph reconciliation', () => {
  const bootOf = bundle => bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') });

  test('a reboot recompiles unchanged importers of a changed module', async () => {
    const make = tag => assembleBundle({
      modules: {
        '_app/util.rip': `export tag = '${tag}'`,
        '_route/index.rip': "import { tag } from '../_app/util.rip'\nexport Home = -> tag",
      },
      packagesDir: resolve(root, 'packages'),
    });
    const first = await bootOf(make('one'));
    expect(first.components.getCompiled('_route/index.rip').Home()).toBe('one');
    first.destroy();
    const second = await bootOf(make('two'));
    try {
      expect(second.components.getCompiled('_route/index.rip').Home()).toBe('two');
    } finally {
      second.destroy();
    }
  });

  test('a module a later bundle does not carry stops resolving', async () => {
    const modules = {
      '_route/index.rip': "import { x } from '../_app/helper.rip'\nexport Home = -> x",
    };
    const withHelper = assembleBundle({
      modules: { ...modules, '_app/helper.rip': 'export x = 1' },
      packagesDir: resolve(root, 'packages'),
    });
    const without = assembleBundle({ modules, packagesDir: resolve(root, 'packages') });
    const first = await bootOf(withHelper);
    first.destroy();
    await expect(bootOf(without)).rejects.toThrow(/'\.\.\/_app\/helper\.rip', which is not in the bundle/);
  });

  test('a later bundle may carry packages the first did not', async () => {
    const first = await bootOf(assemble());
    first.destroy();
    const withValidate = assembleBundle({
      modules: {
        ...APP_MODULES,
        '_route/check.rip': "import { check } from '@rip-lang/validate'\nexport ok = -> check('a@b.co', 'email')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    const second = await bootOf(withValidate);
    try {
      expect(second.components.getCompiled('_route/check.rip').ok()).toBe('a@b.co');
    } finally {
      second.destroy();
    }
  });

  test('the bundle cache storage is its own option, apart from persist storage', async () => {
    const table = new Map();
    const bundleStorage = {
      getItem: key => table.get(key) ?? null,
      setItem: (key, value) => void table.set(key, value),
    };
    const persistReads = [];
    const result = await bootApp({
      url: '/app.json',
      fetchText: async () => ({ fresh: true, text: JSON.stringify(assemble()), etag: 'v1' }),
      bundleStorage,
      storage: { getItem: key => (persistReads.push(key), null), setItem: () => {}, removeItem: () => {} },
      target: node('host'),
      adapter: fakeAdapter('/'),
    });
    try {
      expect(table.get('__rip_bundle_etag:/app.json')).toBe('v1');
      expect([...table.keys()].every(key => key.startsWith('__rip_bundle_'))).toBe(true);
    } finally {
      result.destroy();
    }
  });
});
