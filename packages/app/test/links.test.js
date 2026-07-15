import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildRoutes,
  createRouter,
  interceptClicks,
  launch,
  preloadLinks,
} from '@rip-lang/app';
import { __Component } from '../../../src/runtime/components.js';

const FILES = [
  '_route/index.rip',
  '_route/users/index.rip',
  '_route/users/[id].rip',
  '_route/about.rip',
];

const fakeAdapter = (initial = '/') => {
  const listeners = new Set();
  const entries = [{ url: initial, state: null }];
  let index = 0;
  const adapter = {
    tops: 0,
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
    scroll: { save: () => null, restore() {}, top() { adapter.tops += 1; } },
  };
  return adapter;
};

const anchor = (href, attrs = {}) => {
  const table = { href, ...attrs };
  const el = {
    tagName: 'A',
    parentElement: null,
    getAttribute(name) { return table[name] ?? null; },
    hasAttribute(name) { return name in table; },
    contains(other) { return other === el || other?.parentElement === el; },
  };
  return el;
};

const inside = parent => ({ tagName: 'SPAN', parentElement: parent });

const fakeHost = () => {
  const listeners = new Map();
  return {
    listen(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    fire(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    count() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
};

const click = (target, overrides = {}) => {
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    preventDefault() { event.defaultPrevented = true; },
  };
  return Object.assign(event, overrides);
};

const makeRouter = (initial = '/', opts = {}) => {
  const adapter = fakeAdapter(initial);
  const router = createRouter({ routes: buildRoutes(FILES), adapter, ...opts });
  router.init();
  return { router, adapter };
};

const intercepted = (host = fakeHost(), initial = '/', opts = {}) => {
  const { router, adapter } = makeRouter(initial, opts);
  const dispose = interceptClicks(router, host);
  return { router, adapter, host, dispose };
};

describe('interceptClicks', () => {
  test('a plain left click on an owned link is an SPA navigation', () => {
    const { router, adapter, host } = intercepted();
    const event = click(anchor('/about'));
    host.fire('click', event);
    expect(event.defaultPrevented).toBeTrue();
    expect(router.path).toBe('/about');
    expect(adapter.read()).toBe('/about');
    expect(adapter.tops).toBe(1);
  });

  test('the click walks up from markup inside the anchor', () => {
    const { router, host } = intercepted();
    const event = click(inside(anchor('/about')));
    host.fire('click', event);
    expect(event.defaultPrevented).toBeTrue();
    expect(router.path).toBe('/about');
  });

  test('the claimed query and fragment survive interception intact', () => {
    const { router, host } = intercepted();
    host.fire('click', click(anchor('/users/7?tab=queue#row')));
    expect(router.path).toBe('/users/7');
    expect(router.params).toEqual({ id: '7' });
    expect(router.query).toEqual({ tab: 'queue' });
    expect(router.hash).toBe('row');
  });

  test('the exclusion matrix falls through to the browser untouched', () => {
    const { router, host } = intercepted();
    const excluded = [
      click(anchor('/about'), { button: 1 }),
      click(anchor('/about'), { button: 2 }),
      click(anchor('/about'), { metaKey: true }),
      click(anchor('/about'), { ctrlKey: true }),
      click(anchor('/about'), { shiftKey: true }),
      click(anchor('/about'), { altKey: true }),
      click(anchor('/about', { target: '_blank' })),
      click(anchor('/about', { target: 'frame' })),
      click(anchor('/about', { download: '' })),
      click(anchor('/about', { 'data-router-ignore': '' })),
      click(anchor('https://example.com/about')),
      click(anchor('mailto:x@y.z')),
      click(anchor('//evil.com/about')),
      click(anchor('/\\evil.com')),
      click(anchor('/nowhere')),
      click({ tagName: 'DIV', parentElement: null }),
    ];
    for (const event of excluded) {
      host.fire('click', event);
      expect(event.defaultPrevented).toBeFalse();
    }
    expect(router.path).toBe('/');
    const owned = click(anchor('/about', { target: '_self' }));
    host.fire('click', owned);
    expect(owned.defaultPrevented).toBeTrue();
    expect(router.path).toBe('/about');
  });

  test('a click something else already handled is left alone', () => {
    const { router, host } = intercepted();
    let pushes = 0;
    const before = router.push;
    router.push = (...args) => { pushes += 1; return before.apply(router, args); };
    host.fire('click', click(anchor('/about'), { defaultPrevented: true }));
    expect(pushes).toBe(0);
    expect(router.path).toBe('/');
  });

  test('base-scoped routers intercept only their own document hrefs', () => {
    const { router, host } = intercepted(fakeHost(), '/app/about', { base: '/app' });
    const outside = click(anchor('/about'));
    host.fire('click', outside);
    expect(outside.defaultPrevented).toBeFalse();
    const owned = click(anchor('/app/users/7'));
    host.fire('click', owned);
    expect(owned.defaultPrevented).toBeTrue();
    expect(router.path).toBe('/users/7');
  });

  test('hash-mode routers intercept fragment hrefs only', () => {
    const { router, adapter, host } = intercepted(fakeHost(), '/index.html#/', { hash: true });
    const pathish = click(anchor('/about'));
    host.fire('click', pathish);
    expect(pathish.defaultPrevented).toBeFalse();
    const owned = click(anchor('#/about'));
    host.fire('click', owned);
    expect(owned.defaultPrevented).toBeTrue();
    expect(router.path).toBe('/about');
    expect(adapter.read()).toBe('/index.html#/about');
  });

  test('data-router-noscroll keeps the scroll position', () => {
    const { router, adapter, host } = intercepted();
    host.fire('click', click(anchor('/about', { 'data-router-noscroll': '' })));
    expect(router.path).toBe('/about');
    expect(adapter.tops).toBe(0);
  });

  test('dispose removes the listener and is idempotent', () => {
    const { router, host, dispose } = intercepted();
    expect(host.count()).toBe(1);
    dispose();
    dispose();
    expect(host.count()).toBe(0);
    const event = click(anchor('/about'));
    host.fire('click', event);
    expect(event.defaultPrevented).toBeFalse();
    expect(router.path).toBe('/');
  });

  test('a router is required and the browser host rejects under Node', () => {
    expect(() => interceptClicks(null)).toThrow(TypeError);
    const { router } = makeRouter();
    expect(() => interceptClicks(router)).toThrow(/browser or an injected host/);
  });
});

describe('preloadLinks', () => {
  const SETTLED = 80;

  const preloading = (initial = '/') => {
    const { router } = makeRouter(initial);
    const host = fakeHost();
    const calls = [];
    const renderer = { preload(info) { calls.push(info); } };
    const dispose = preloadLinks(router, renderer, host);
    return { router, host, calls, dispose };
  };

  test('a hover that settles preloads the claimed route', async () => {
    const { host, calls } = preloading();
    host.fire('pointerover', { target: inside(anchor('/users/7?tab=queue')) });
    expect(calls).toEqual([]);
    await Bun.sleep(SETTLED);
    expect(calls.length).toBe(1);
    expect(calls[0].route.file).toBe('_route/users/[id].rip');
    expect(calls[0].params).toEqual({ id: '7' });
    expect(calls[0].query).toEqual({ tab: 'queue' });
  });

  test('focus counts as intent', async () => {
    const { host, calls } = preloading();
    host.fire('focusin', { target: anchor('/about') });
    await Bun.sleep(SETTLED);
    expect(calls.length).toBe(1);
    expect(calls[0].route.file).toBe('_route/about.rip');
  });

  test('brushing past never fires', async () => {
    const { host, calls } = preloading();
    const a = anchor('/about');
    host.fire('pointerover', { target: a });
    host.fire('pointerout', { target: a, relatedTarget: null });
    await Bun.sleep(SETTLED);
    expect(calls).toEqual([]);
  });

  test('movement within the settling anchor never cancels', async () => {
    const { host, calls } = preloading();
    const a = anchor('/about');
    host.fire('pointerover', { target: a });
    host.fire('pointerout', { target: a, relatedTarget: inside(a) });
    host.fire('pointerover', { target: a });
    await Bun.sleep(SETTLED);
    expect(calls.length).toBe(1);
  });

  test('the same href re-preloads only after the repeat window', async () => {
    const { host, calls } = preloading();
    host.fire('pointerover', { target: anchor('/about') });
    await Bun.sleep(SETTLED);
    expect(calls.length).toBe(1);
    host.fire('pointerover', { target: anchor('/about') });
    await Bun.sleep(SETTLED);
    expect(calls.length).toBe(1);
    host.fire('pointerover', { target: anchor('/users/7') });
    await Bun.sleep(SETTLED);
    expect(calls.length).toBe(2);
  });

  test('an anchor the router does not own never preloads', async () => {
    const { host, calls } = preloading();
    host.fire('pointerover', { target: anchor('https://example.com/about') });
    host.fire('pointerover', { target: anchor('/about', { 'data-router-ignore': '' }) });
    host.fire('pointerover', { target: anchor('/nowhere') });
    await Bun.sleep(SETTLED);
    expect(calls).toEqual([]);
  });

  test('dispose cancels a pending settle and removes every listener', async () => {
    const { host, calls, dispose } = preloading();
    expect(host.count()).toBe(4);
    host.fire('pointerover', { target: anchor('/about') });
    dispose();
    dispose();
    expect(host.count()).toBe(0);
    await Bun.sleep(SETTLED);
    expect(calls).toEqual([]);
  });

  test('a router and a preloading renderer are required', () => {
    const { router } = makeRouter();
    expect(() => preloadLinks(null, { preload() {} })).toThrow(TypeError);
    expect(() => preloadLinks(router, {})).toThrow(/renderer with preload/);
    expect(() => preloadLinks(router, { preload() {} })).toThrow(/browser or an injected host/);
  });
});

describe('launch link wiring', () => {
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

  class Home extends __Component {
    _create() { return node('home'); }
  }
  class About extends __Component {
    _create() { return node('about'); }
  }

  const bundle = () => ({
    modules: {
      '_route/index.rip': 'export Home = component',
      '_route/about.rip': 'export About = component',
    },
    compiled: {
      '_route/index.rip': { Home },
      '_route/about.rip': { About },
    },
  });

  const running = [];
  afterEach(() => {
    while (running.length) running.pop().destroy();
  });

  test('launch installs both link listeners and a click navigates the app', async () => {
    const host = fakeHost();
    const target = node('host');
    const result = launch({ bundle: bundle(), target, adapter: fakeAdapter('/'), links: host });
    running.push(result);
    expect(host.count()).toBe(5);
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(target.children.map(child => child.name)).toEqual(['home']);
    const event = click(anchor('/about'));
    host.fire('click', event);
    expect(event.defaultPrevented).toBeTrue();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(target.children.map(child => child.name)).toEqual(['about']);
  });

  test('teardown removes every listener launch installed', () => {
    const host = fakeHost();
    const result = launch({ bundle: bundle(), target: node('host'), adapter: fakeAdapter('/'), links: host });
    result.destroy();
    expect(host.count()).toBe(0);
    result.destroy();
    expect(host.count()).toBe(0);
  });

  test('without a document or an injected host no listeners install', () => {
    const result = launch({ bundle: bundle(), target: node('host'), adapter: fakeAdapter('/') });
    running.push(result);
    expect(typeof document).toBe('undefined');
  });
});
