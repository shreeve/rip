// Browser publication consumer, end to end under Node: the two-key bundle,
// canonical package resolution, prepared App launch, ordered watch changes,
// and latest.json reconnect recovery.
import { beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootApp, fetchBundle } from '../../src/browser.js';
import { assembleRipBundle } from '../../packages/server/bundle.rip';
import { installRecordingDOM } from '../support/recording-dom.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const H1 = 'AAAAAA';
const H2 = 'BBBBBB';
const H3 = 'CCCCCC';

const node = name => ({
  name,
  children: [],
  parentNode: null,
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  },
  querySelector: () => null,
  replaceChildren(...children) { this.children = children; },
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

const route = (name, text) => [
  `export ${name} = component`,
  '  render',
  `    h1 '${text}'`,
].join('\n');

const APP_MODULES = {
  'data.rip': "export data = { title: 'probe' }",
  'stash.rip': [
    "import { source } from '@rip-lang/app'",
    'export stash = {',
    '  user: source fetch: -> Promise.resolve { name: "Ada" }',
    '}',
  ].join('\n'),
  'routes/index.rip': route('Home', 'home'),
  'routes/about.rip': route('About', 'about'),
};

const bundleFor = (modules = APP_MODULES, hash = H1) => ({
  hash,
  list: assembleRipBundle({ modules, packagesDir: resolve(root, 'packages') }),
});

const settle = async () => {
  await Bun.sleep(0);
  await Bun.sleep(0);
  await Bun.sleep(0);
};

describe('fetchBundle', () => {
  test('parses fetched JSON and leaves caching to HTTP', async () => {
    const calls = [];
    const bundle = await fetchBundle('/bundle.json', {
      fetchText: async url => (calls.push(url), JSON.stringify({ hash: H1, list: [] })),
    });
    expect(bundle).toEqual({ hash: H1, list: [] });
    expect(calls).toEqual(['/bundle.json']);
  });

  test('rejects missing URLs, non-text fetches, and invalid JSON loudly', async () => {
    await expect(fetchBundle()).rejects.toThrow(/requires a url/);
    await expect(fetchBundle('/bundle.json', { fetchText: async () => ({}) })).rejects.toThrow(/did not return text/);
    await expect(fetchBundle('/bundle.json', { fetchText: async () => 'nope' })).rejects.toThrow(/not valid JSON/);
    await expect(bootApp({})).rejects.toThrow(/bundle or a url/);
  });
});

describe('bootApp publication', () => {
  test('compiles, launches, navigates, and reads data.rip seed data', async () => {
    const result = await bootApp({ bundle: bundleFor(), target: node('host'), adapter: fakeAdapter('/') });
    try {
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.router.current.route.file).toBe('routes/index.rip');
      expect(result.app.data.title).toBe('probe');
      result.router.push('/about');
      await settle();
      expect(result.router.current.route.file).toBe('routes/about.rip');
    } finally {
      result.destroy();
    }
  });

  test('trusts the declared complete hash without calculating browser hashes', async () => {
    const bundle = bundleFor({ 'routes/index.rip': route('Home', 'arbitrary bytes') }, H3);
    const result = await bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') });
    try {
      expect(result.workspace.hash()).toBe(H3);
      expect(result.workspace.read('routes/index.rip')).toContain('arbitrary bytes');
    } finally {
      result.destroy();
    }
  });

  test('resolves browser-safe package roots by canonical index.rip convention', async () => {
    const modules = {
      'routes/index.rip': "import { check } from '@rip-lang/validate'\nexport value = -> check('a@b.co', 'email')",
    };
    const bundle = bundleFor(modules);
    expect(bundle.list.some(([path]) => path === '@rip-lang/validate/index.rip')).toBeTrue();
    const result = await bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') });
    try {
      expect(result.workspace.getCompiled('routes/index.rip').value()).toBe('a@b.co');
    } finally {
      result.destroy();
    }
  });

  test('a broken module rejects at its own Rip path', async () => {
    const bundle = { hash: H1, list: [['routes/index.rip', 'x = ((']] };
    await expect(bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') }))
      .rejects.toThrow(/routes\/index\.rip/);
    const dynamic = { hash: H1, list: [['routes/index.rip', "export load = -> import('./other.rip')"]] };
    await expect(bootApp({ bundle: dynamic, target: node('host'), adapter: fakeAdapter('/') }))
      .rejects.toThrow(/dynamic import is not supported in a browser App module/);
  });

  test('a failed initial program disposes module URLs already staged', async () => {
    const revoked = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = url => {
      revoked.push(url);
      original.call(URL, url);
    };
    try {
      const bundle = { hash: H1, list: [
        ['probe.rip', 'export probe = 1'],
        ['routes/index.rip', 'x = (('],
      ] };
      await expect(bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') }))
        .rejects.toThrow(/routes\/index\.rip/);
      await Promise.resolve();
      expect(revoked.some(url => url.startsWith('blob:'))).toBeTrue();
    } finally {
      URL.revokeObjectURL = original;
    }
  });

  test('requires exactly hash and canonical Rip source list', async () => {
    const boot = bundle => bootApp({ bundle, target: node('host'), adapter: fakeAdapter('/') });
    await expect(boot({ hash: H1, list: [], files: [] })).rejects.toThrow(/exactly one hash and one source list/);
    await expect(boot({ hash: 'bad', list: [] })).rejects.toThrow(/source list/);
    await expect(boot({ hash: H1, list: [['styles.css', 'x']] })).rejects.toThrow(/malformed/);
    await expect(boot({ hash: H1, list: [['b.rip', 'b'], ['a.rip', 'a']] })).rejects.toThrow(/unsorted/);
    await expect(boot({ hash: H1, list: [['@rip-lang/app/index.rip', 'x']] })).rejects.toThrow(/collides/);
  });

  test('watch-off boot creates no publication socket', async () => {
    let sockets = 0;
    const result = await bootApp({
      bundle: bundleFor(),
      target: node('host'),
      adapter: fakeAdapter('/'),
      makeSocket: () => (sockets += 1),
    });
    try {
      expect(result.feed).toBeNull();
      expect(sockets).toBe(0);
    } finally {
      result.destroy();
    }
  });
});

describe('bootApp watch changes', () => {
  beforeAll(() => installRecordingDOM());

  const fakeHub = () => {
    const sockets = [];
    const makeSocket = url => {
      const socket = { url, sent: [], onopen: null, onmessage: null, onclose: null, onerror: null };
      socket.send = text => socket.sent.push(text);
      socket.close = () => socket.onclose?.();
      sockets.push(socket);
      return socket;
    };
    return { sockets, makeSocket };
  };

  const open = async ({ latest = H1, reloads = [], modules = APP_MODULES } = {}) => {
    const hub = fakeHub();
    const latestState = { hash: latest };
    const reports = [];
    const result = await bootApp({
      bundle: bundleFor(modules, H1),
      target: node('host'),
      adapter: fakeAdapter('/'),
      watch: true,
      reload: reason => reloads.push(reason),
      feed: {
        hub: 'ws://test/hub',
        makeSocket: hub.makeSocket,
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ hash: latestState.hash }) }),
        backoff: { min: 1, max: 2 },
        ackTimeout: 100,
        report: (...args) => reports.push(args),
      },
    });
    return { result, hub, reloads, latestState, reports };
  };

  const subscribe = async socket => {
    socket.onopen();
    const token = JSON.parse(socket.sent[0])['?'];
    socket.onmessage({ data: JSON.stringify({ '!': token }) });
    await settle();
  };

  test('an ordered Rip change advances source, compiled state, and App hash', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      const source = route('Home', 'home v2');
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['routes/index.rip', source]] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H2);
      expect(result.workspace.read('routes/index.rip')).toBe(source);
      expect(result.workspace.getCompiled('routes/index.rip')).toBeDefined();
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('a narrow change does not reevaluate unchanged Rip modules', async () => {
    globalThis.__ripUnchangedRuns = 0;
    const modules = {
      ...APP_MODULES,
      'probe.rip': [
        'globalThis.__ripUnchangedRuns = globalThis.__ripUnchangedRuns + 1',
        'export runs = globalThis.__ripUnchangedRuns',
      ].join('\n'),
    };
    const { result, hub } = await open({ modules });
    try {
      await subscribe(hub.sockets[0]);
      expect(globalThis.__ripUnchangedRuns).toBe(1);
      const source = route('Home', 'home v2');
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['routes/index.rip', source]] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H2);
      expect(globalThis.__ripUnchangedRuns).toBe(1);
      expect(result.workspace.getCompiled('probe.rip').runs).toBe(1);
    } finally {
      result.destroy();
      delete globalThis.__ripUnchangedRuns;
    }
  });

  test('a duplicate final hash is harmless', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      const source = route('Home', 'home v2');
      const change = { from: H1, hash: H2, list: [['routes/index.rip', source]] };
      hub.sockets[0].onmessage({ data: JSON.stringify({ change }) });
      await settle();
      hub.sockets[0].onmessage({ data: JSON.stringify({ change }) });
      await settle();
      expect(result.workspace.hash()).toBe(H2);
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('a missed transition reloads instead of applying a disconnected delta', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H2, hash: H3, list: [] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(reloads.length).toBe(1);
    } finally {
      result.destroy();
    }
  });

  test('a failed changed program quarantines its generation and keeps the prior publication', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['routes/index.rip', 'x = ((']] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.workspace.read('routes/index.rip')).toBe(APP_MODULES['routes/index.rip']);
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('a failed live activation rolls back Workspace and keeps the live App', async () => {
    const { result, hub, reloads } = await open();
    const liveApp = result.app;
    try {
      await subscribe(hub.sockets[0]);
      const invalidStash = 'export nope = 1';
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['stash.rip', invalidStash]] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.workspace.read('stash.rip')).toBe(APP_MODULES['stash.rip']);
      expect(globalThis.__ripApp).toBe(liveApp);
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('an ambiguous candidate route manifest is quarantined before commit', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: {
        from: H1,
        hash: H2,
        list: [
          ['routes/[id].rip', route('ById', 'id')],
          ['routes/[name].rip', route('ByName', 'name')],
        ],
      } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.workspace.exists('routes/[id].rip')).toBeFalse();
      expect(result.workspace.exists('routes/[name].rip')).toBeFalse();
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('a valid stash change reloads instead of quarantining the generation', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      const nextStash = APP_MODULES['stash.rip'].replace('Ada', 'Grace');
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['stash.rip', nextStash]] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H2);
      expect(result.workspace.read('stash.rip')).toBe(nextStash);
      expect(reloads.length).toBe(1);
    } finally {
      result.destroy();
    }
  });

  test('a malformed Rip candidate quarantines before a mixed asset reload', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: {
        from: H1,
        hash: H2,
        list: [['index.html'], ['stash.rip', 'export nope = 1']],
      } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.workspace.read('stash.rip')).toBe(APP_MODULES['stash.rip']);
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('a valid mixed Rip and asset batch reloads the complete bundle', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      const nextStash = APP_MODULES['stash.rip'].replace('Ada', 'Grace');
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: {
        from: H1,
        hash: H2,
        list: [['index.html'], ['stash.rip', nextStash]],
      } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.workspace.read('stash.rip')).toBe(APP_MODULES['stash.rip']);
      expect(reloads.length).toBe(1);
    } finally {
      result.destroy();
    }
  });

  test('a generation after a quarantined candidate reloads into the newer complete bundle', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['routes/index.rip', 'x = ((']] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(reloads).toEqual([]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H2, hash: H3, list: [['routes/index.rip', route('Home', 'recovered')]] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(reloads.length).toBe(1);
    } finally {
      result.destroy();
    }
  });

  test('CSS changes use HTTP identity while HTML and other assets reload', async () => {
    const cssRun = await open();
    try {
      await subscribe(cssRun.hub.sockets[0]);
      cssRun.hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['styles.css']] } }) });
      await settle();
      expect(cssRun.result.workspace.hash()).toBe(H2);
      expect(cssRun.reloads).toEqual([]);
    } finally {
      cssRun.result.destroy();
    }

    for (const path of ['index.html', 'images/rip.png']) {
      const run = await open();
      try {
        await subscribe(run.hub.sockets[0]);
        run.hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [[path]] } }) });
        await settle();
        expect(run.result.workspace.hash()).toBe(H1);
        expect(run.reloads.length).toBe(1);
      } finally {
        run.result.destroy();
      }
    }
  });

  test('a nested CSS change refreshes every exact link and no basename sibling', async () => {
    const run = await open();
    const makeLink = href => ({
      href,
      disabled: false,
      getAttribute(name) { return name === 'href' ? this.href : null; },
      setAttribute(name, value) { if (name === 'href') this.href = value; },
    });
    const legacy = makeLink('/legacy/styles.css');
    const adminA = makeLink('/admin/styles.css');
    const adminB = makeLink('/base/admin/styles.css?old=1#theme');
    const cdn = makeLink('https://cdn.example/admin/styles.css');
    const priorQuery = document.querySelectorAll;
    document.querySelectorAll = () => [legacy, adminA, adminB, cdn];
    try {
      await subscribe(run.hub.sockets[0]);
      run.hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['admin/styles.css']] } }) });
      await settle();
      expect(legacy.href).toBe('/legacy/styles.css');
      expect(adminA.href).toBe(`/admin/styles.css?hash=${H2}`);
      expect(adminB.href).toBe(`/base/admin/styles.css?hash=${H2}#theme`);
      expect(cdn.href).toBe('https://cdn.example/admin/styles.css');
      expect(run.result.workspace.hash()).toBe(H2);
    } finally {
      document.querySelectorAll = priorQuery;
      run.result.destroy();
    }
  });

  test('CSS refresh uses browser URL-path encoding without escaping valid raw path characters', async () => {
    const run = await open();
    const link = {
      href: '/styles/theme+dark[1]%20%C3%BC%23%3F%20100%25.css',
      disabled: false,
      getAttribute(name) { return name === 'href' ? this.href : null; },
      setAttribute(name, value) { if (name === 'href') this.href = value; },
    };
    const priorQuery = document.querySelectorAll;
    document.querySelectorAll = () => [link];
    try {
      await subscribe(run.hub.sockets[0]);
      run.hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['styles/theme+dark[1] ü#? 100%.css']] } }) });
      await settle();
      expect(link.href).toBe(`/styles/theme+dark[1]%20%C3%BC%23%3F%20100%25.css?hash=${H2}`);
      expect(run.result.workspace.hash()).toBe(H2);
      expect(run.reloads).toEqual([]);
    } finally {
      document.querySelectorAll = priorQuery;
      run.result.destroy();
    }
  });

  test('Rip create and delete commit as source membership changes', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      const born = route('New', 'new');
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['routes/new.rip', born]] } }) });
      await settle();
      expect(result.workspace.exists('routes/new.rip')).toBeTrue();
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H2, hash: H3, list: [['routes/new.rip', null]] } }) });
      await settle();
      expect(result.workspace.exists('routes/new.rip')).toBeFalse();
      expect(result.workspace.hash()).toBe(H3);
      expect(reloads).toEqual([]);
    } finally {
      result.destroy();
    }
  });

  test('deleting the mounted route reloads instead of quarantining the generation', async () => {
    const { result, hub, reloads } = await open();
    try {
      await subscribe(hub.sockets[0]);
      hub.sockets[0].onmessage({ data: JSON.stringify({ change: { from: H1, hash: H2, list: [['routes/index.rip', null]] } }) });
      await settle();
      expect(result.workspace.hash()).toBe(H1);
      expect(result.workspace.exists('routes/index.rip')).toBeTrue();
      expect(reloads.length).toBe(1);
    } finally {
      result.destroy();
    }
  });

  test('reconnect latest mismatch reloads; a matching probe does not', async () => {
    const { result, hub, reloads, latestState } = await open();
    try {
      await subscribe(hub.sockets[0]);
      expect(reloads).toEqual([]);
      hub.sockets[0].onclose();
      latestState.hash = H2;
      await Bun.sleep(10);
      expect(hub.sockets.length).toBe(2);
      await subscribe(hub.sockets[1]);
      expect(reloads.length).toBe(1);
    } finally {
      result.destroy();
    }
  });
});
