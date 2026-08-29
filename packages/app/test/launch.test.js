import { afterEach, describe, expect, test } from 'bun:test';
import { createComponents, launch, source, unwrapStash } from 'rip/app';
import { __Component } from '../../../src/runtime/components.js';

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

class Home extends __Component {
  _create() { return node('home'); }
}
class About extends __Component {
  _create() { return node('about'); }
}

const bundle = (extra = {}) => ({
  modules: {
    'routes/index.rip': 'export Home = component',
    'routes/about.rip': 'export About = component',
  },
  compiled: {
    'routes/index.rip': { Home },
    'routes/about.rip': { About },
  },
  ...extra,
});

const withStash = module => bundle({
  compiled: {
    'routes/index.rip': { Home },
    'routes/about.rip': { About },
    'stash.rip': module,
  },
});

const running = [];
const boot = opts => {
  const result = launch({
    bundle: bundle(),
    target: node('host'),
    adapter: fakeAdapter('/'),
    ...opts,
  });
  running.push(result);
  return result;
};

afterEach(() => {
  while (running.length) running.pop().destroy();
});

describe('launch', () => {
  test('malformed options and bundles reject loudly', () => {
    expect(() => launch()).toThrow(/options object/);
    expect(() => launch({ bundle: null, target: node('t'), adapter: fakeAdapter() })).toThrow(/bundle object/);
    expect(() => launch({ bundle: { modules: [] }, target: node('t'), adapter: fakeAdapter() })).toThrow(/store paths/);
    expect(() => launch({ bundle: { data: [] }, target: node('t'), adapter: fakeAdapter() })).toThrow(/data must be an object/);
  });

  test('boots the app end to end and mounts the initial route', async () => {
    const host = node('host');
    const result = launch({ bundle: bundle(), target: host, adapter: fakeAdapter('/') });
    running.push(result);
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(host.children.map(child => child.name)).toEqual(['home']);
    result.router.push('/about');
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(host.children.map(child => child.name)).toEqual(['about']);
  });

  test('clears a static placeholder (e.g. #app-loader) before the first mount', async () => {
    const host = node('host');
    const loader = node('loader');
    host.appendChild(loader);
    const result = launch({ bundle: bundle(), target: host, adapter: fakeAdapter('/') });
    running.push(result);
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(host.children.map(child => child.name)).toEqual(['home']);
    expect(host.children).not.toContain(loader);
  });

  test('installs the app globals and a second launch rejects', () => {
    const result = boot();
    expect(globalThis.__ripApp).toBe(result.app);
    expect(globalThis.__ripRouter).toBe(result.router);
    expect(() => boot()).toThrow(/already launched/);
  });

  test('destroy restores every global and is idempotent', () => {
    const result = boot();
    result.destroy();
    result.destroy();
    expect(globalThis.__ripApp).toBeUndefined();
    expect(globalThis.__ripRouter).toBeUndefined();
    boot();
  });

  test('destroy clears globals even when a disposer throws, and the next launch succeeds', () => {
    // destroy latches `destroyed` before work; a mid-teardown throw must
    // still clear __ripApp/__ripRouter or every future launch bricks.
    const result = boot();
    result.renderer.stop = () => { throw new Error('teardown boom'); };
    expect(() => result.destroy()).toThrow(/teardown boom/);
    expect(globalThis.__ripApp).toBeUndefined();
    expect(globalThis.__ripRouter).toBeUndefined();
    boot();
  });

  test('seed data overlays the stash without touching source cells', () => {
    let fetches = 0;
    const result = boot({
      stash: {
        user: source({ fetch: async () => { fetches += 1; return { name: 'live' }; } }),
        theme: 'dark',
      },
      bundle: bundle({ data: { user: { name: 'stale-json' }, theme: 'light', extra: 1 } }),
    });
    const raw = unwrapStash(result.app.data);
    expect(typeof raw.user.read).toBe('function');
    expect(result.app.data.theme).toBe('light');
    expect(result.app.data.extra).toBe(1);
    expect(fetches).toBe(0);
  });

  test('the stash arrives from the bundle stash module', () => {
    let fetches = 0;
    const result = boot({
      bundle: withStash({
        stash: {
          user: source({ fetch: async () => { fetches += 1; return { name: 'live' }; } }),
          theme: 'dark',
        },
      }),
    });
    const raw = unwrapStash(result.app.data);
    expect(typeof raw.user.read).toBe('function');
    expect(result.app.data.theme).toBe('dark');
    expect(fetches).toBe(0);
  });

  test('an explicit stash option overrides the bundle stash module', () => {
    const result = boot({
      stash: { theme: 'light' },
      bundle: withStash({ stash: { theme: 'dark' } }),
    });
    expect(result.app.data.theme).toBe('light');
  });

  test('a stash module without stash and a malformed stash reject loudly', () => {
    expect(() => boot({ bundle: withStash({ helpers: 1 }) }))
      .toThrow(/'stash\.rip' module must export 'stash'/);
    expect(() => boot({ bundle: withStash({ stash: ['not', 'a', 'stash'] }) }))
      .toThrow(/stash must be a plain object/);
    expect(globalThis.__ripApp).toBeUndefined();
  });

  test('reset returns to the seeded baseline', () => {
    const result = boot({ bundle: bundle({ data: { count: 5 } }) });
    result.app.data.count = 99;
    result.app.data.junk = true;
    result.app.data.reset();
    expect(result.app.data.count).toBe(5);
    expect(result.app.data.junk).toBeUndefined();
  });

  test('writing a new route file rebuilds the manifest', async () => {
    const result = boot();
    expect(result.router.match('/late')).toBeNull();
    result.components.write('routes/late.rip', 'export Late = component');
    result.components.setCompiled('routes/late.rip', { Late: Home });
    expect(result.router.match('/late')).not.toBeNull();
  });

  test('an injected components store is used as-is and drives the app', async () => {
    const store = createComponents();
    const host = node('host');
    const result = launch({
      bundle: bundle(),
      components: store,
      target: host,
      adapter: fakeAdapter('/'),
    });
    running.push(result);
    expect(result.components).toBe(store);
    expect(store.read('routes/index.rip')).toBe('export Home = component');
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(host.children.map(child => child.name)).toEqual(['home']);
    store.write('routes/late.rip', 'export Late = component');
    store.setCompiled('routes/late.rip', { Late: Home });
    expect(result.router.match('/late')).not.toBeNull();
  });

  test('a malformed injected components store rejects loudly', () => {
    expect(() => boot({ components: [] })).toThrow(/components must be an object/);
    expect(() => boot({ components: { read: () => {} } })).toThrow(/missing 'write'/);
    expect(globalThis.__ripApp).toBeUndefined();
  });
});

describe('launch reconciliation', () => {
  test('a seed never touches nested sources or keyed families', () => {
    let fetches = 0;
    const result = boot({
      stash: {
        users: source({ kind: 'keyed', fetch: async id => { fetches += 1; return { id }; } }),
        settings: {
          user: source({ fetch: async () => ({ live: true }) }),
          theme: 'dark',
        },
      },
      bundle: bundle({
        data: {
          users: 'clobber',
          settings: { theme: 'light', user: { stale: true } },
        },
      }),
    });
    const raw = unwrapStash(result.app.data);
    expect(typeof raw.users).toBe('function');
    expect(typeof raw.settings.user.read).toBe('function');
    expect(result.app.data.settings.theme).toBe('light');
    expect(fetches).toBe(0);
  });

  test('relaunch from a shared stash declaration starts from the declared baseline', () => {
    const cell = source({ fetch: async () => ({ id: 1 }) });
    const declaration = { stash: { user: cell, theme: 'dark', profile: { name: 'anon' } } };
    const first = boot({ bundle: withStash(declaration) });
    first.app.data.theme = 'light';
    first.app.data.profile.name = 'steve';
    first.destroy();
    const second = boot({ bundle: withStash(declaration) });
    expect(second.app.data.theme).toBe('dark');
    expect(second.app.data.profile.name).toBe('anon');
    expect(unwrapStash(second.app.data).user).toBe(cell);
    second.app.data.theme = 'blue';
    second.app.data.reset();
    expect(second.app.data.theme).toBe('dark');
  });

  test('a __proto__ seed key becomes inert own data', () => {
    const result = boot({ bundle: bundle({ data: JSON.parse('{"__proto__":{"polluted":"yes"}}') }) });
    expect(result.app.data.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  test('reset preserves nested sources and never aliases the baseline', () => {
    const result = boot({
      stash: { settings: { user: source({ fetch: async () => ({ id: 1 }) }), theme: 'dark' } },
      bundle: bundle({ data: { count: 5 } }),
    });
    result.app.data.settings.theme = 'mutated';
    result.app.data.reset();
    const raw = unwrapStash(result.app.data);
    expect(typeof raw.settings.user.read).toBe('function');
    expect(result.app.data.settings.theme).toBe('dark');
    result.app.data.settings.theme = 'corrupted';
    result.app.data.reset();
    expect(result.app.data.settings.theme).toBe('dark');
    expect(result.app.data.count).toBe(5);
  });

  test('a start-time failure tears down and never wedges relaunch', () => {
    const adapter = fakeAdapter('/');
    adapter.read = () => { throw new Error('adapter down'); };
    expect(() => launch({ bundle: bundle(), target: node('host'), adapter })).toThrow('adapter down');
    expect(globalThis.__ripApp).toBeUndefined();
    expect(globalThis.__ripRouter).toBeUndefined();
    boot();
  });
});

describe('aria-current installs with launch', () => {
  // launch owns the walker's lifetime the way it owns link
  // interception: present whenever a usable document exists, gone with
  // destroy(). The walker's own semantics (exact vs ancestor marks,
  // rewritten hrefs) are pinned in aria.test.js; here the contract is
  // the INSTALLATION — and that an app-managed mark stays app-managed
  // through a full launch/destroy cycle.
  const anchor = (href, managed = null) => {
    const attrs = new Map([['href', href]]);
    if (managed) attrs.set('aria-current', managed);
    return {
      getAttribute: key => (attrs.has(key) ? attrs.get(key) : null),
      setAttribute: (key, value) => attrs.set(key, String(value)),
      removeAttribute: key => attrs.delete(key),
      hasAttribute: key => attrs.has(key),
      attrs,
    };
  };

  const withDocument = (anchors, fn, { observer = true } = {}) => {
    const prevDocument = globalThis.document;
    const prevObserver = globalThis.MutationObserver;
    globalThis.document = {
      querySelectorAll: () => anchors,
      addEventListener: () => {},
      removeEventListener: () => {},
      documentElement: {},
    };
    if (observer) {
      globalThis.MutationObserver = class {
        observe() {}
        disconnect() {}
      };
    } else {
      delete globalThis.MutationObserver;
    }
    try {
      return fn();
    } finally {
      if (prevDocument === undefined) delete globalThis.document;
      else globalThis.document = prevDocument;
      if (prevObserver === undefined) delete globalThis.MutationObserver;
      else globalThis.MutationObserver = prevObserver;
    }
  };

  test('anchors mark on launch, follow navigation, and clear on destroy', () => {
    const home = anchor('/');
    const about = anchor('/about');
    const foreign = anchor('/nowhere');
    withDocument([home, about, foreign], () => {
      const result = boot();
      expect(home.getAttribute('aria-current')).toBe('page');
      expect(about.getAttribute('aria-current')).toBeNull();
      expect(foreign.getAttribute('aria-current')).toBeNull();

      result.router.push('/about');
      expect(about.getAttribute('aria-current')).toBe('page');
      expect(home.getAttribute('aria-current')).toBeNull();

      result.destroy();
      running.pop();
      expect(about.getAttribute('aria-current')).toBeNull();
    });
  });

  test('an app-managed mark is never set over and never removed', () => {
    const managed = anchor('/about', 'step');
    withDocument([managed], () => {
      const result = boot();
      result.router.push('/about');
      expect(managed.getAttribute('aria-current')).toBe('step');
      result.destroy();
      running.pop();
      expect(managed.getAttribute('aria-current')).toBe('step');
    });
  });

  test('a mark the app sets AFTER the walker claimed the anchor is theirs too', () => {
    // The walker claims `home` at boot; the app then takes the anchor
    // over. Navigation must neither remove nor rewrite the app's mark
    // — and destroy must leave it standing.
    const home = anchor('/');
    withDocument([home], () => {
      const result = boot();
      expect(home.getAttribute('aria-current')).toBe('page');
      home.setAttribute('aria-current', 'step');
      result.router.push('/about');
      expect(home.getAttribute('aria-current')).toBe('step');
      result.router.push('/');
      expect(home.getAttribute('aria-current')).toBe('step');
      result.destroy();
      running.pop();
      expect(home.getAttribute('aria-current')).toBe('step');
    });
  });

  test('a document without MutationObserver still boots and marks on navigation', () => {
    // A partial DOM shim — querySelectorAll but no observer — hosted
    // launch on main (no walker existed); the default install must not
    // turn it into a boot-time throw. Marks follow navigation; only
    // the between-navigation mutation chasing is absent.
    const home = anchor('/');
    const about = anchor('/about');
    withDocument([home, about], () => {
      const result = boot();
      expect(home.getAttribute('aria-current')).toBe('page');
      result.router.push('/about');
      expect(about.getAttribute('aria-current')).toBe('page');
      expect(home.getAttribute('aria-current')).toBeNull();
      result.destroy();
      running.pop();
      expect(about.getAttribute('aria-current')).toBeNull();
    }, { observer: false });
  });

  test('without a document the walker simply does not install', () => {
    const result = boot();
    expect(typeof result.destroy).toBe('function');
    result.destroy();
    running.pop();
  });
});
