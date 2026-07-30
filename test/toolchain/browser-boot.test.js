// Application boot through the browser entry, end to end under Node:
// bundle fetch with ETag revalidation, the module graph compiling the
// app package and every route, launch wiring, navigation, and render
// gates — the same path the real-browser certification drives.
import { beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootApp, fetchBundle } from '../../src/browser.js';
import { assembleBundle } from '../../src/bundle.js';
import { installRecordingDOM } from '../support/recording-dom.js';

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
  'app/stash.rip': [
    "import { source } from '@rip-lang/app'",
    'export stash = {',
    '  user: source fetch: -> Promise.resolve { name: "Ada" }',
    '}',
  ].join('\n'),
  'app/routes/index.rip': [
    'export Home = component',
    '  render',
    '    h1 "home"',
  ].join('\n'),
  'app/routes/about.rip': [
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
      expect(result.router.current.route.file).toBe('app/routes/index.rip');
      expect(globalThis.__ripApp).toBe(result.app);
      result.router.push('/about');
      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(result.router.current.route.file).toBe('app/routes/about.rip');
      expect(result.app.data.title).toBe('probe');
    } finally {
      result.destroy();
    }
  });

  test('the app stash flows from app/stash.rip and gates prefetch through it', async () => {
    const bundle = assemble();
    bundle.modules['app/routes/profile.rip'] = [
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
      expect(result.router.current.route.file).toBe('app/routes/profile.rip');
      expect(user).toEqual({ name: 'Ada' });
      expect(failures.map(f => f.path)).not.toContain('user');
    } finally {
      result.destroy();
    }
  });

  test('a route that fails to compile rejects the boot at its own position', async () => {
    const bundle = assemble();
    bundle.modules['app/routes/broken.rip'] = 'x = ((';
    await expect(bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') }))
      .rejects.toThrow(/app\/routes\/broken\.rip/);
  });

  test('render gates prefetch through the boot path', async () => {
    const bundle = assembleBundle({
      modules: {
        'app/routes/index.rip': [
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
        'app/util.rip': `export tag = '${tag}'`,
        'app/routes/index.rip': "import { tag } from '../util.rip'\nexport Home = -> tag",
      },
      packagesDir: resolve(root, 'packages'),
    });
    const first = await bootOf(make('one'));
    expect(first.components.getCompiled('app/routes/index.rip').Home()).toBe('one');
    first.destroy();
    const second = await bootOf(make('two'));
    try {
      expect(second.components.getCompiled('app/routes/index.rip').Home()).toBe('two');
    } finally {
      second.destroy();
    }
  });

  test('a module a later bundle does not carry stops resolving', async () => {
    const modules = {
      'app/routes/index.rip': "import { x } from '../helper.rip'\nexport Home = -> x",
    };
    const withHelper = assembleBundle({
      modules: { ...modules, 'app/helper.rip': 'export x = 1' },
      packagesDir: resolve(root, 'packages'),
    });
    const without = assembleBundle({ modules, packagesDir: resolve(root, 'packages') });
    const first = await bootOf(withHelper);
    first.destroy();
    await expect(bootOf(without)).rejects.toThrow(/'\.\.\/helper\.rip', which is not in the bundle/);
  });

  test('a later bundle may carry packages the first did not', async () => {
    const first = await bootOf(assemble());
    first.destroy();
    const withValidate = assembleBundle({
      modules: {
        ...APP_MODULES,
        'app/routes/check.rip': "import { check } from '@rip-lang/validate'\nexport ok = -> check('a@b.co', 'email')",
      },
      packagesDir: resolve(root, 'packages'),
    });
    const second = await bootOf(withValidate);
    try {
      expect(second.components.getCompiled('app/routes/check.rip').ok()).toBe('a@b.co');
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

// The Workspace door (docs/WORKSPACE.md, Probe 0): populate from the
// manifest, ding → HTTP → set → passport mutation → visible update,
// with remount labeled escape. The feed's seams (hub socket, fetch)
// are hand-driven fakes; the recording DOM makes the update visible.
describe('bootApp workspace mode', () => {
  let doc;
  beforeAll(() => {
    doc = installRecordingDOM();
  });

  // Mirrors the manager's shortHash / workspace etagOf — 16 hex of sha256.
  const etagOf = s => new Bun.CryptoHasher('sha256').update(s).digest('hex').slice(0, 16);

  const routeSource = (name, text) => [
    `export ${name} = component`,
    '  render',
    `    h1 "${text}"`,
  ].join('\n');

  const WS_MODULES = {
    'app/routes/index.rip': routeSource('Home', 'home v1'),
    'app/routes/about.rip': routeSource('About', 'about v1'),
  };

  const MANIFEST = {
    files: [
      { id: 'app/routes/index.rip', etag: etagOf(WS_MODULES['app/routes/index.rip']) },
      { id: 'app/routes/about.rip', etag: etagOf(WS_MODULES['app/routes/about.rip']) },
    ],
  };

  // The workspace rides the app package (Q9): plain assembly carries
  // createWorkspace and connectFeed with no extra claim.
  const assembleWorkspace = () => assembleBundle({
    modules: WS_MODULES,
    packagesDir: resolve(root, 'packages'),
  });

  const fakeFetch = table => {
    const calls = [];
    const impl = async url => {
      calls.push(url);
      const body = table.get(url);
      if (body === undefined) {
        return { ok: false, status: 404, json: async () => null, text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    };
    impl.calls = calls;
    return impl;
  };

  const fakeHub = () => {
    const sockets = [];
    return {
      sockets,
      makeSocket: url => {
        const socket = { url, close() { this.onclose?.(); } };
        sockets.push(socket);
        return socket;
      },
    };
  };

  const until = async (predicate, tries = 500) => {
    for (let i = 0; i < tries; i += 1) {
      if (predicate()) return;
      await Bun.sleep(1);
    }
    throw new Error('until: the condition never became true');
  };

  // Slightly above the escape's 25ms coalesce window, so a settled
  // remount is deterministic to await.
  const settleEscape = () => Bun.sleep(40);

  const manifestTable = (manifest = MANIFEST) => new Map([
    ['/manifest.json', JSON.stringify(manifest)],
  ]);

  const bootWorkspace = async ({ table, hub, reports = [], bundle = null, fetchImpl = null }) => {
    const target = doc.createElement('div');
    const fetch = fetchImpl ?? fakeFetch(table);
    const result = await bootApp({
      bundle: bundle ?? assembleWorkspace(),
      target,
      adapter: fakeAdapter('/'),
      workspace: true,
      manifestUrl: '/manifest.json',
      feed: {
        hub: 'ws://test/dev',
        makeSocket: hub.makeSocket,
        fetch,
        report: (...args) => reports.push(args.map(String).join(' ')),
        backoff: { min: 1, max: 2 },
      },
    });
    return { result, target, fetch };
  };

  test('without opts.workspace the boot is untouched: no bag, no feed, no manifest fetch (D1)', async () => {
    const fetch = fakeFetch(manifestTable());
    const hub = fakeHub();
    const result = await bootApp({
      bundle: assembleWorkspace(),
      target: doc.createElement('div'),
      adapter: fakeAdapter('/'),
      manifestUrl: '/manifest.json',
      feed: { hub: 'ws://test/dev', makeSocket: hub.makeSocket, fetch },
    });
    try {
      expect(result.workspace).toBeUndefined();
      expect(result.feed).toBeUndefined();
      expect(fetch.calls).toEqual([]);
      expect(hub.sockets).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('a workspace boot from a bundle object without a manifest url rejects by name', async () => {
    const hub = fakeHub();
    await expect(bootApp({
      bundle: assembleWorkspace(),
      target: doc.createElement('div'),
      adapter: fakeAdapter('/'),
      workspace: true,
      feed: { hub: 'ws://test/dev', makeSocket: hub.makeSocket, fetch: fakeFetch(manifestTable()) },
    })).rejects.toThrow(/manifestUrl/);
  });

  test('populate seeds one passport per manifest file the bundle carries, at the manifest etag', async () => {
    const manifest = {
      files: [...MANIFEST.files, { id: 'app/routes/extra.rip', etag: 'aaaaaaaaaaaaaaaa' }],
    };
    const hub = fakeHub();
    const { result } = await bootWorkspace({ table: manifestTable(manifest), hub });
    try {
      expect(result.workspace.passport('app/routes/index.rip').etag).toBe(etagOf(WS_MODULES['app/routes/index.rip']));
      expect(result.workspace.passport('app/routes/about.rip').etag).toBe(etagOf(WS_MODULES['app/routes/about.rip']));
      // A manifest file the bundle does not carry is skipped; the
      // feed's open resync owns it.
      expect(result.workspace.passport('app/routes/extra.rip')).toBeUndefined();
      expect(result.workspace.paths().sort()).toEqual(['app/routes/about.rip', 'app/routes/index.rip']);
    } finally {
      result.destroy();
    }
  });

  test('a ding fetches the etag-keyed module and advances the passport (D3/D4)', async () => {
    const table = manifestTable();
    const v2 = routeSource('Home', 'home v2');
    const e2 = etagOf(v2);
    table.set(`/app/routes/index.rip?etag=${e2}`, v2);
    const hub = fakeHub();
    const { result, fetch } = await bootWorkspace({ table, hub });
    try {
      const socket = hub.sockets[0];
      socket.onopen();
      await until(() => fetch.calls.includes('/manifest.json'));
      socket.onmessage({ data: JSON.stringify({ ding: { id: 'app/routes/index.rip', etag: e2 } }) });
      await until(() => result.workspace.passport('app/routes/index.rip').etag === e2);
      expect(fetch.calls).toContain(`/app/routes/index.rip?etag=${e2}`);
      const passport = result.workspace.passport('app/routes/index.rip');
      expect(passport.source).toBe(v2);
      expect(passport.compiled).toBeDefined();
      await settleEscape();
    } finally {
      result.destroy();
    }
  });

  test('a cell that fails to compile reports and leaves the last good generation live (S10)', async () => {
    const table = manifestTable();
    const bad = 'x = ((';
    const eBad = etagOf(bad);
    table.set(`/app/routes/index.rip?etag=${eBad}`, bad);
    const hub = fakeHub();
    const reports = [];
    const { result } = await bootWorkspace({ table, hub, reports });
    try {
      const before = result.workspace.passport('app/routes/index.rip');
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/routes/index.rip', etag: eBad } }) });
      await until(() => reports.some(line => line.includes('app/routes/index.rip')));
      const after = result.workspace.passport('app/routes/index.rip');
      expect(after.etag).toBe(etagOf(WS_MODULES['app/routes/index.rip']));
      expect(after.source).toBe(before.source);
      expect(after.compiled).toBe(before.compiled);
      expect(reports.join('\n')).toContain('failed to compile');
    } finally {
      result.destroy();
    }
  });

  test('a route ding remounts, the target shows the new content, and the remount is labeled escape', async () => {
    const table = manifestTable();
    const v2 = routeSource('Home', 'home v2');
    const e2 = etagOf(v2);
    table.set(`/app/routes/index.rip?etag=${e2}`, v2);
    const hub = fakeHub();
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => void logs.push(args.join(' '));
    let boot = null;
    try {
      boot = await bootWorkspace({ table, hub });
      const { result, target } = boot;
      await until(() => target.textContent.includes('home v1'));
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/routes/index.rip', etag: e2 } }) });
      await until(() => result.workspace.passport('app/routes/index.rip').etag === e2);
      await settleEscape();
      await until(() => target.textContent.includes('home v2'));
      // The applied-log is user-facing: it names the file that changed
      // and is honest that the remount resets component state.
      const appliedLines = logs.filter(line => line.includes('applied'));
      expect(appliedLines).toEqual(['[Rip] applied app/routes/index.rip — remounted (component state reset)']);
      expect(result.router.current.route.file).toBe('app/routes/index.rip');
    } finally {
      console.log = originalLog;
      boot?.result.destroy();
    }
  });

  test('a ding to a DEPENDENCY recompiles its importers: the remount shows the new value through the importing route', async () => {
    // The loader invalidates importers transitively; the remount must
    // read its projections THROUGH the loader, or the route keeps the
    // stale module that closed over the old dependency.
    const modules = {
      'app/badge.rip': "export LABEL = 'badge v1'",
      'app/routes/index.rip': [
        "import { LABEL } from '../badge.rip'",
        'export Home = component',
        '  render',
        '    h1 "#{LABEL}"',
      ].join('\n'),
    };
    const manifest = {
      files: [
        { id: 'app/badge.rip', etag: etagOf(modules['app/badge.rip']) },
        { id: 'app/routes/index.rip', etag: etagOf(modules['app/routes/index.rip']) },
      ],
    };
    const bundle = assembleBundle({
      modules,
      packagesDir: resolve(root, 'packages'),
    });
    const table = new Map([['/manifest.json', JSON.stringify(manifest)]]);
    const v2 = "export LABEL = 'badge v2'";
    const e2 = etagOf(v2);
    table.set(`/app/badge.rip?etag=${e2}`, v2);
    const hub = fakeHub();
    const { result, target } = await bootWorkspace({ table, hub, bundle });
    try {
      await until(() => target.textContent.includes('badge v1'));
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/badge.rip', etag: e2 } }) });
      await until(() => result.workspace.passport('app/badge.rip').etag === e2);
      await settleEscape();
      await until(() => target.textContent.includes('badge v2'));
    } finally {
      result.destroy();
    }
  });

  test('a remount whose importer fails keeps the page interactive (compile barrier)', async () => {
    // A shared cell can compile while its importer cannot (export
    // removed). The remount must stage every projection first and
    // abort with ZERO bag.setCompiled / destroy / relaunch — otherwise
    // the page tears down into a version-mixed launch (S10).
    const modules = {
      'app/badge.rip': "export LABEL = 'badge v1'",
      'app/routes/index.rip': [
        "import { LABEL } from '../badge.rip'",
        'export Home = component',
        '  render',
        '    h1 "#{LABEL}"',
      ].join('\n'),
    };
    const manifest = {
      files: [
        { id: 'app/badge.rip', etag: etagOf(modules['app/badge.rip']) },
        { id: 'app/routes/index.rip', etag: etagOf(modules['app/routes/index.rip']) },
      ],
    };
    const bundle = assembleBundle({
      modules,
      packagesDir: resolve(root, 'packages'),
    });
    const table = new Map([['/manifest.json', JSON.stringify(manifest)]]);
    const broken = "export OTHER = 'no LABEL'";
    const v3 = "export LABEL = 'badge v3'";
    const e2 = etagOf(broken);
    const e3 = etagOf(v3);
    table.set(`/app/badge.rip?etag=${e2}`, broken);
    table.set(`/app/badge.rip?etag=${e3}`, v3);
    const hub = fakeHub();
    const reports = [];
    const { result, target } = await bootWorkspace({ table, hub, bundle, reports });
    try {
      await until(() => target.textContent.includes('badge v1'));
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/badge.rip', etag: e2 } }) });
      await until(() => result.workspace.passport('app/badge.rip').etag === e2);
      await settleEscape();
      await until(() => reports.some(line => line.includes('failed to compile') && line.includes('app/routes/index.rip')));
      expect(target.textContent).toContain('badge v1');
      expect(target.textContent).not.toContain('badge v3');
      // The next good generation recovers through the same path.
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/badge.rip', etag: e3 } }) });
      await until(() => result.workspace.passport('app/badge.rip').etag === e3);
      await settleEscape();
      await until(() => target.textContent.includes('badge v3'));
    } finally {
      result.destroy();
    }
  });

  test('a workspace boot fetches the manifest BEFORE the bundle (etag-over-bytes correlation)', async () => {
    // The manager writes the manifest AFTER the bundle; the boot
    // fetches it BEFORE. The only pairing a boot racing a save can
    // observe is "manifest etags name generations the bundle already
    // carries (or older)", which the feed's resync heals forward —
    // a manifest ahead of bundle bytes would strand the bag. The URL
    // derives from the bundle the same way (…/bundle.json →
    // …/manifest.json) — no explicit manifestUrl.
    const order = [];
    const bundleText = JSON.stringify(assembleWorkspace());
    const fetchText = async url => {
      order.push(`bundle:${url}`);
      return { fresh: true, text: bundleText, etag: null };
    };
    const table = manifestTable();
    const fetchImpl = async url => {
      order.push(`feed:${url}`);
      const body = table.get(url);
      if (body === undefined) return { ok: false, status: 404, json: async () => null, text: async () => '' };
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    };
    const hub = fakeHub();
    const result = await bootApp({
      url: '/bundle.json',
      fetchText,
      bundleStorage: null,
      target: doc.createElement('div'),
      adapter: fakeAdapter('/'),
      workspace: true,
      feed: {
        hub: 'ws://test/dev',
        makeSocket: hub.makeSocket,
        fetch: fetchImpl,
        report: () => {},
        backoff: { min: 1, max: 2 },
      },
    });
    try {
      expect(order[0]).toBe('feed:/manifest.json');
      expect(order).toContain('bundle:/bundle.json');
      expect(order).not.toContain('feed:/@rip/manifest');
    } finally {
      result.destroy();
    }
  });

  test('an out-of-order stale fetch never touches the module graph: the newest content (etag) survives via 409', async () => {
    // Two dings in flight resolve out of order: the newer etag's fetch
    // completes first and applies; the older etag's completes after.
    // The door answers a superseded etag with 409 + current ETag; the
    // feed refetches once at the current generation, and etag equality
    // is a no-op. The module graph must stay untouched too, or the NEXT
    // remount silently recompiles stale bytes while the passport still
    // names the newer etag (the silent-stale class).
    const table = manifestTable();
    const v2 = routeSource('Home', 'home v2');
    const v3 = routeSource('Home', 'home v3');
    const e2 = etagOf(v2);
    const e3 = etagOf(v3);
    const aboutV2 = routeSource('About', 'about v2');
    const aboutE2 = etagOf(aboutV2);
    table.set(`/app/routes/about.rip?etag=${aboutE2}`, aboutV2);
    let releaseV2 = null;
    const gate = new Promise(resolve => { releaseV2 = resolve; });
    const base = fakeFetch(table);
    const etagHeader = etag => ({
      get: name => (String(name).toLowerCase() === 'etag' ? `"${etag}"` : null),
    });
    const fetchImpl = async url => {
      if (url === `/app/routes/index.rip?etag=${e2}`) {
        await gate;
        // Latest representation is v3 — superseded generation (Q8′).
        return {
          ok: false,
          status: 409,
          headers: etagHeader(e3),
          json: async () => null,
          text: async () => '',
        };
      }
      if (url === `/app/routes/index.rip?etag=${e3}`) {
        return {
          ok: true,
          status: 200,
          headers: etagHeader(e3),
          json: async () => null,
          text: async () => v3,
        };
      }
      return base(url);
    };
    fetchImpl.calls = base.calls;
    const hub = fakeHub();
    const { result, target } = await bootWorkspace({ table, hub, fetchImpl });
    try {
      await until(() => target.textContent.includes('home v1'));
      const socket = hub.sockets[0];
      socket.onmessage({ data: JSON.stringify({ ding: { id: 'app/routes/index.rip', etag: e2 } }) });
      socket.onmessage({ data: JSON.stringify({ ding: { id: 'app/routes/index.rip', etag: e3 } }) });
      await until(() => result.workspace.passport('app/routes/index.rip').etag === e3);
      await settleEscape();
      await until(() => target.textContent.includes('home v3'));
      releaseV2();
      await settleEscape();
      // A ding to ANOTHER file forces the next remount; index.rip must
      // recompile to the newest content, never the late-arriving stale etag.
      socket.onmessage({ data: JSON.stringify({ ding: { id: 'app/routes/about.rip', etag: aboutE2 } }) });
      await until(() => result.workspace.passport('app/routes/about.rip').etag === aboutE2);
      await settleEscape();
      expect(result.workspace.passport('app/routes/index.rip').etag).toBe(e3);
      expect(result.workspace.passport('app/routes/index.rip').source).toBe(v3);
      expect(target.textContent).toContain('home v3');
      expect(target.textContent).not.toContain('home v2');
    } finally {
      result.destroy();
    }
  });

  test('a remount whose relaunch throws reports loudly and the next good change recovers the page', async () => {
    // A cell can compile cleanly and still break launch (the stash
    // contract: 'app/stash.rip' must export stash). The remount's
    // teardown-plus-relaunch must not die as an unhandled rejection
    // with the page silently unmounted — it reports, and a following
    // good generation relaunches.
    const table = manifestTable();
    const badStash = 'export nothing = 1';
    const goodStash = 'export stash = {}';
    const e1 = etagOf(badStash);
    const e2 = etagOf(goodStash);
    table.set(`/app/stash.rip?etag=${e1}`, badStash);
    table.set(`/app/stash.rip?etag=${e2}`, goodStash);
    const hub = fakeHub();
    const reports = [];
    const { result, target } = await bootWorkspace({ table, hub, reports });
    try {
      await until(() => target.textContent.includes('home v1'));
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/stash.rip', etag: e1 } }) });
      await until(() => result.workspace.passport('app/stash.rip')?.etag === e1);
      await settleEscape();
      await until(() => reports.some(line => line.includes('remount failed')));
      hub.sockets[0].onmessage({ data: JSON.stringify({ ding: { id: 'app/stash.rip', etag: e2 } }) });
      await until(() => result.workspace.passport('app/stash.rip')?.etag === e2);
      await settleEscape();
      await until(() => target.textContent.includes('home v1'));
    } finally {
      result.destroy();
    }
  });

  test('a delete ding removes the passport and the remount survives against the shrunken bag', async () => {
    const hub = fakeHub();
    const { result } = await bootWorkspace({ table: manifestTable(), hub });
    try {
      expect(result.workspace.passport('app/routes/about.rip')).toBeDefined();
      const aboutEtag = etagOf(WS_MODULES['app/routes/about.rip']);
      hub.sockets[0].onmessage({
        data: JSON.stringify({ ding: { id: 'app/routes/about.rip', etag: aboutEtag, kind: 'delete' } }),
      });
      await until(() => result.workspace.passport('app/routes/about.rip') === undefined);
      expect(result.workspace.paths()).toEqual(['app/routes/index.rip']);
      await settleEscape();
      await until(() => result.router.current?.route?.file === 'app/routes/index.rip');
    } finally {
      result.destroy();
    }
  });
});
