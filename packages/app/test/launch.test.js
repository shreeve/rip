import { afterEach, describe, expect, test } from 'bun:test';
import { launch, source, unwrapStash } from '@rip-lang/app';
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
    '_route/index.rip': 'export Home = component',
    '_route/about.rip': 'export About = component',
  },
  compiled: {
    '_route/index.rip': { Home },
    '_route/about.rip': { About },
  },
  ...extra,
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
    result.components.write('_route/late.rip', 'export Late = component');
    result.components.setCompiled('_route/late.rip', { Late: Home });
    expect(result.router.match('/late')).not.toBeNull();
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
