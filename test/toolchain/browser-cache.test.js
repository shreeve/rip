// The page's compiled-module cache under Node: one entry per module path,
// used only when the source, compiler build, compiler script URL, hmr
// mode and (under debug) source map all match; a changed source
// recompiles and overwrites; a removed path is swept; a store that fails
// or never answers changes nothing but says so once. A HIT is proven by
// planting an entry whose code was compiled from different source than
// the one it is filed under: the module then evaluates the planted code.
// Unbundled source carries no compiler build, so these tests stamp one
// on globalThis. Real IndexedDB is pinned in
// test/browser/tests/cache.spec.mjs.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootApp, compile, openModuleCache } from '../../src/browser.js';
import { assembleRipBundle } from '../../packages/sites/bundle.rip';
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
  remove() {},
  querySelector: () => null,
  replaceChildren(...children) { this.children = children; },
});

const fakeAdapter = () => ({
  read: () => '/',
  readState: () => null,
  push() {},
  replace() {},
  go() {},
  listen: () => () => {},
});

const probe = value => `export value = -> '${value}'`;

const MODULES = {
  'probe.rip': probe('real'),
  'routes/index.rip': ['export Home = component', '  render', "    h1 'home'"].join('\n'),
};

const bundleFor = (modules = MODULES, hash = H1) => ({
  hash,
  list: assembleRipBundle({ modules, packagesDir: resolve(root, 'packages') }),
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await Bun.sleep(0);
};

// An in-memory store with the IndexedDB store's contract; entries are
// cloned in and out, as structured clone would.
const memoryStore = () => {
  const entries = new Map();
  const writes = [];
  return {
    entries,
    writes,
    async read() {
      return new Map([...entries].map(([path, entry]) => [path, structuredClone(entry)]));
    },
    async write(puts, removes = []) {
      for (const entry of puts.values()) entries.set(entry.path, structuredClone(entry));
      for (const path of removes) entries.delete(path);
      writes.push({ puts: [...puts.keys()].sort(), removes: [...removes].sort() });
    },
  };
};

const boot = async (store, { bundle = bundleFor(), ...opts } = {}) => {
  const result = await bootApp({ bundle, target: node('host'), adapter: fakeAdapter(), cache: store, ...opts });
  await settle();
  return result;
};

const probeValue = result => result.workspace.getCompiled('probe.rip').value();

const bootValue = async (store, opts) => {
  const result = await boot(store, opts);
  try {
    return probeValue(result);
  } finally {
    result.destroy();
  }
};

// Files code compiled from `fake` under probe.rip's real source, leaving
// every validator as the cache wrote it.
const plant = (store, fake, { hmr = false } = {}) => {
  const out = compile(probe(fake), { path: 'probe.rip', runtimeDelivery: 'import', browserModule: true, ...(hmr ? { hmr: true } : null) });
  const entry = store.entries.get('probe.rip');
  entry.code = out.code;
  entry.imports = out.imports.map(({ start, end, specifier }) => ({ start, end, specifier }));
  return entry;
};

const captureWarnings = async fn => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warnings;
};

beforeAll(() => { globalThis.RIP_COMPILER_BUILD = 'test-build-1'; });
afterAll(() => { delete globalThis.RIP_COMPILER_BUILD; });

describe('compiled-module cache', () => {
  test('a first boot stores every compiled module; a second boot reuses them', async () => {
    const store = memoryStore();
    expect(await bootValue(store)).toBe('real');
    expect([...store.entries.keys()].sort()).toEqual(['probe.rip', 'routes/index.rip']);
    const entry = store.entries.get('probe.rip');
    expect(entry.source).toBe(MODULES['probe.rip']);
    expect(entry.build).toBe('test-build-1');
    expect(entry.hmr).toBe(false);
    expect(entry.map).toBeUndefined();

    plant(store, 'cached');
    expect(await bootValue(store)).toBe('cached');
    // Every module hit: nothing new to write, nothing to sweep.
    expect(store.writes.length).toBe(1);
  });

  test('a changed source recompiles and overwrites its one entry', async () => {
    const store = memoryStore();
    await bootValue(store);
    plant(store, 'cached');
    expect(await bootValue(store, { bundle: bundleFor({ ...MODULES, 'probe.rip': probe('edited') }) })).toBe('edited');
    expect(store.entries.size).toBe(2);
    expect(store.entries.get('probe.rip').source).toBe(probe('edited'));
    expect(store.writes.at(-1)).toEqual({ puts: ['probe.rip'], removes: [] });
  });

  test('a stored entry that differs in any validator is a miss, and is rewritten', async () => {
    const cases = [
      ['build', 'another-build'],
      ['base', 'https://elsewhere/rip.js'],
      ['hmr', true],
      ['code', 42],
      ['imports', null],
    ];
    for (const [field, value] of cases) {
      const store = memoryStore();
      await bootValue(store);
      const written = store.entries.get('probe.rip')[field];
      plant(store, 'cached')[field] = value;
      expect(await bootValue(store)).toBe('real');
      const rewritten = store.entries.get('probe.rip')[field];
      expect(field === 'code' ? typeof rewritten : rewritten).toEqual(field === 'code' ? 'string' : written);
    }
  });

  test('a new compiler build misses every entry once', async () => {
    const store = memoryStore();
    await bootValue(store);
    plant(store, 'cached');
    globalThis.RIP_COMPILER_BUILD = 'test-build-2';
    try {
      expect(await bootValue(store)).toBe('real');
      expect(store.entries.get('probe.rip').build).toBe('test-build-2');
    } finally {
      globalThis.RIP_COMPILER_BUILD = 'test-build-1';
    }
  });

  test('a debug boot misses an entry without a source map, stores one, then hits', async () => {
    const store = memoryStore();
    await bootValue(store);
    plant(store, 'cached');
    expect(await bootValue(store, { debug: true })).toBe('real');
    expect(store.entries.get('probe.rip').map?.version).toBe(3);
    plant(store, 'cached with map');
    expect(await bootValue(store, { debug: true })).toBe('cached with map');
  });

  test('a failed boot stores nothing', async () => {
    const store = memoryStore();
    const broken = { hash: H1, list: [['probe.rip', probe('real')], ['routes/index.rip', 'x = ((']] };
    await expect(bootApp({ bundle: broken, target: node('host'), adapter: fakeAdapter(), cache: store }))
      .rejects.toThrow(/routes\/index\.rip/);
    await settle();
    expect(store.writes).toEqual([]);
  });

  test('a path the publication no longer carries is swept', async () => {
    const store = memoryStore();
    await bootValue(store, { bundle: bundleFor({ ...MODULES, 'gone.rip': 'export gone = 1' }) });
    expect(store.entries.has('gone.rip')).toBeTrue();
    await bootValue(store);
    expect(store.entries.has('gone.rip')).toBeFalse();
    expect(store.writes.at(-1)).toEqual({ puts: [], removes: ['gone.rip'] });
  });

  test('a store that cannot read or write leaves the page compiling and warns once', async () => {
    const failing = {
      read: async () => { throw new Error('read refused'); },
      write: async () => { throw new Error('write refused'); },
    };
    let value;
    const warnings = await captureWarnings(async () => { value = await bootValue(failing); });
    expect(value).toBe('real');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('compiled-module cache read');
    expect(warnings[0]).toContain('read refused');
  });

  test('a store that never answers costs one read deadline, then compiles', async () => {
    const silent = { read: () => new Promise(() => {}), write: async () => {} };
    let value;
    const started = performance.now();
    const warnings = await captureWarnings(async () => { value = await bootValue(silent); });
    expect(value).toBe('real');
    expect(performance.now() - started).toBeLessThan(2000);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('no answer within');
  });

  test('cache rejects anything but false or a store, by name', async () => {
    for (const cache of [true, 'idb', null, {}, { read() {} }]) {
      await expect(bootApp({ bundle: bundleFor(), target: node('host'), adapter: fakeAdapter(), cache }))
        .rejects.toThrow(/cache must be false or a store with read\(\) and write\(\)/);
    }
  });

  test('an explicit store needs a stamped compiler build', async () => {
    delete globalThis.RIP_COMPILER_BUILD;
    try {
      await expect(bootApp({ bundle: bundleFor(), target: node('host'), adapter: fakeAdapter(), cache: memoryStore() }))
        .rejects.toThrow(/stamped compiler build/);
    } finally {
      globalThis.RIP_COMPILER_BUILD = 'test-build-1';
    }
  });

  test('the IndexedDB default opens without a cache option, and never with cache: false', async () => {
    let opens = 0;
    // An IndexedDB whose open never answers: the default store is used,
    // and boot proceeds past the read deadline.
    globalThis.indexedDB = { open: () => (opens += 1, {}) };
    try {
      await captureWarnings(async () => {
        expect(await bootValue(undefined)).toBe('real');
        expect(opens).toBe(1);
        expect(await bootValue(false)).toBe('real');
        expect(opens).toBe(1);
      });
    } finally {
      delete globalThis.indexedDB;
    }
  });

  test('openModuleCache without IndexedDB rejects by name', () => {
    expect(() => openModuleCache({ indexedDB: undefined })).toThrow(/requires IndexedDB/);
  });
});

describe('compiled-module cache under watch', () => {
  beforeAll(() => installRecordingDOM());

  const watching = async store => {
    const sockets = [];
    const result = await boot(store, {
      watch: true,
      reload: () => {},
      feed: {
        hub: 'ws://test/hub',
        makeSocket: url => {
          const socket = { url, sent: [], send(text) { this.sent.push(text); }, close() { this.onclose?.(); } };
          sockets.push(socket);
          return socket;
        },
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ hash: H1 }) }),
        backoff: { min: 1, max: 2 },
        ackTimeout: 100,
        report: () => {},
      },
    });
    const socket = sockets[0];
    socket.onopen();
    socket.onmessage({ data: JSON.stringify({ '!': JSON.parse(socket.sent[0])['?'] }) });
    await settle();
    const send = async change => {
      socket.onmessage({ data: JSON.stringify({ change }) });
      await settle();
    };
    return { result, send };
  };

  test('a live change stores the recompiled module in hmr mode', async () => {
    const store = memoryStore();
    const { result, send } = await watching(store);
    try {
      expect(store.entries.get('probe.rip').hmr).toBe(true);
      await send({ from: H1, hash: H2, list: [['probe.rip', probe('live')]] });
      expect(result.workspace.hash()).toBe(H2);
      expect(probeValue(result)).toBe('live');
      expect(store.entries.get('probe.rip').source).toBe(probe('live'));
      expect(store.entries.get('probe.rip').hmr).toBe(true);
    } finally {
      result.destroy();
    }
  });

  test('a rejected candidate never stores its broken module', async () => {
    const store = memoryStore();
    const { result, send } = await watching(store);
    try {
      await send({ from: H1, hash: H2, list: [['probe.rip', probe('candidate')], ['routes/index.rip', 'x = ((']] });
      expect(result.workspace.hash()).toBe(H1);
      await send({ from: H2, hash: H3, list: [['probe.rip', probe('accepted')]] });
      expect(result.workspace.hash()).toBe(H3);
      expect(probeValue(result)).toBe('accepted');
      const sources = [...store.entries.values()].map(entry => entry.source);
      expect(sources).not.toContain('x = ((');
      expect(store.entries.get('routes/index.rip').source).toBe(MODULES['routes/index.rip']);
    } finally {
      result.destroy();
    }
  });
});
