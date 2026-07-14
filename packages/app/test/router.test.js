import { describe, expect, test } from 'bun:test';
import { buildRoutes, createRouter } from '@rip-lang/app';
import { __effect } from '../../../src/runtime/reactive.js';

const FILES = [
  '_route/_layout.rip',
  '_route/index.rip',
  '_route/about.rip',
  '_route/users/[id].rip',
  '_route/docs/[...rest].rip',
];

const manifest = () => buildRoutes(FILES);

const fakeAdapter = (initial = '/') => {
  const listeners = new Set();
  const entries = [{ url: initial, state: null }];
  let index = 0;
  const calls = { push: [], replace: [], saves: 0, restores: [], tops: 0 };
  return {
    read: () => entries[index].url,
    readState: () => entries[index].state,
    push(url, state) {
      calls.push.push(url);
      entries.splice(index + 1);
      entries.push({ url, state });
      index += 1;
    },
    replace(url, state) {
      calls.replace.push(url);
      entries[index] = { url, state };
    },
    go(delta) {
      const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
      if (next === index) return;
      index = next;
      for (const fn of [...listeners]) fn();
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    scroll: {
      save() { calls.saves += 1; return { y: 7 }; },
      restore(position) { calls.restores.push(position); },
      top() { calls.tops += 1; },
    },
    calls,
    entries,
    listeners,
  };
};

const makeRouter = (opts = {}) => {
  const adapter = opts.adapter ?? fakeAdapter(opts.initial ?? '/');
  const router = createRouter({ routes: manifest(), adapter, ...opts.router });
  return { adapter, router };
};

describe('construction', () => {
  test('routes and adapter are required and validated', () => {
    expect(() => createRouter()).toThrow(TypeError);
    expect(() => createRouter({ routes: manifest() })).toThrow(TypeError);
    expect(() => createRouter({ routes: {}, adapter: fakeAdapter() })).toThrow(TypeError);
    expect(() => createRouter({ routes: manifest(), adapter: { read: () => '/' } })).toThrow(TypeError);
  });

  test('current is null before init', () => {
    const { router } = makeRouter();
    expect(router.current).toBeNull();
    expect(router.navigating).toBeFalse();
  });
});

describe('init and route state', () => {
  test('init resolves the adapter URL into renderer route state', () => {
    const { router } = makeRouter({ initial: '/users/7?tab=posts#bio' });
    expect(router.init()).toBe(router);
    expect(router.current.route.file).toBe('_route/users/[id].rip');
    expect(router.current.layouts).toEqual(['_route/_layout.rip']);
    expect(router.current.params).toEqual({ id: '7' });
    expect(router.current.query).toEqual({ tab: 'posts' });
    expect(router.path).toBe('/users/7');
    expect(router.hash).toBe('bio');
  });

  test('init is idempotent', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.init();
    expect(adapter.listeners.size).toBe(1);
  });

  test('an unmatched initial URL reports 404 and leaves current null', () => {
    const seen = [];
    const adapter = fakeAdapter('/nope');
    const router = createRouter({
      routes: manifest(),
      adapter,
      onError: failure => seen.push(failure),
    });
    router.init();
    expect(router.current).toBeNull();
    expect(seen).toEqual([{ status: 404, path: '/nope' }]);
  });
});

describe('push and replace', () => {
  test('push resolves, records history, and scrolls to top', () => {
    const { adapter, router } = makeRouter();
    router.init();
    expect(router.push('/about')).toBeTrue();
    expect(router.current.route.file).toBe('_route/about.rip');
    expect(adapter.calls.push).toEqual(['/about']);
    expect(adapter.calls.saves).toBe(1);
    expect(adapter.calls.tops).toBe(1);
  });

  test('push saves the outgoing scroll position into the outgoing entry', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.push('/about');
    expect(adapter.entries[0].state).toEqual({ __ripScroll: { y: 7 } });
    expect(adapter.entries[1].state).toBeNull();
  });

  test('history state merges instead of clobbering', () => {
    const { adapter, router } = makeRouter();
    adapter.entries[0].state = { host: 'kept' };
    router.init();
    router.push('/about');
    expect(adapter.entries[0].state).toEqual({ host: 'kept', __ripScroll: { y: 7 } });
  });

  test('the pushed URL carries its query and hash into history', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.push('/users/9?x=1#top');
    expect(adapter.calls.push).toEqual(['/users/9?x=1#top']);
  });

  test('noScroll keeps the viewport still', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.push('/about', { noScroll: true });
    expect(adapter.calls.tops).toBe(0);
  });

  test('replace rewrites the current entry', () => {
    const { adapter, router } = makeRouter();
    router.init();
    expect(router.replace('/about')).toBeTrue();
    expect(adapter.calls.replace).toEqual(['/about']);
    expect(adapter.calls.push).toEqual([]);
    expect(adapter.entries.length).toBe(1);
  });

  test('replace honors noScroll', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.replace('/about', { noScroll: true });
    expect(adapter.calls.tops).toBe(0);
  });

  test('navigation works after a 404 start', () => {
    const adapter = fakeAdapter('/nowhere');
    const router = createRouter({ routes: manifest(), adapter });
    router.init();
    expect(router.push('/about')).toBeTrue();
    expect(router.current.route.file).toBe('_route/about.rip');
  });

  test('pushing the identical URL still resolves and scrolls', () => {
    const { adapter, router } = makeRouter({ initial: '/about' });
    router.init();
    router.push('/about');
    expect(adapter.calls.push).toEqual(['/about']);
    expect(adapter.calls.tops).toBe(1);
  });

  test('an unmatched push reports 404 and changes nothing', () => {
    const seen = [];
    const adapter = fakeAdapter('/');
    const router = createRouter({ routes: manifest(), adapter, onError: f => seen.push(f) });
    router.init();
    expect(router.push('/missing')).toBeFalse();
    expect(router.current.route.file).toBe('_route/index.rip');
    expect(adapter.calls.push).toEqual([]);
    expect(seen).toEqual([{ status: 404, path: '/missing' }]);
  });
});

describe('history traversal', () => {
  test('back and forward resolve through the adapter and restore scroll', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.push('/about');
    router.back();
    expect(router.current.route.file).toBe('_route/index.rip');
    expect(adapter.calls.restores).toEqual([{ y: 7 }]);
    router.forward();
    expect(router.current.route.file).toBe('_route/about.rip');
  });
});

describe('onNavigate', () => {
  test('callbacks receive a navigation snapshot after each successful resolve', () => {
    const { router } = makeRouter();
    const seen = [];
    router.onNavigate(info => seen.push(info));
    router.init();
    router.push('/users/9?x=1');
    expect(seen.length).toBe(2);
    expect(seen[1].path).toBe('/users/9');
    expect(seen[1].route.file).toBe('_route/users/[id].rip');
    expect(seen[1].params).toEqual({ id: '9' });
    expect(seen[1].query).toEqual({ x: '1' });
  });

  test('a throwing callback cannot break navigation or its siblings', () => {
    const { router } = makeRouter();
    const seen = [];
    router.onNavigate(() => { throw new Error('boom'); });
    router.onNavigate(() => seen.push('ok'));
    router.init();
    expect(seen).toEqual(['ok']);
    expect(router.current).not.toBeNull();
  });

  test('the disposer removes the callback', () => {
    const { router } = makeRouter();
    const seen = [];
    const dispose = router.onNavigate(() => seen.push(1));
    router.init();
    dispose();
    router.push('/about');
    expect(seen).toEqual([1]);
  });

  test('a callback added during dispatch waits for the next navigation', () => {
    const { router } = makeRouter();
    const seen = [];
    router.onNavigate(() => {
      if (seen.length === 0) router.onNavigate(info => seen.push(info.path));
    });
    router.init();
    expect(seen).toEqual([]);
    router.push('/about');
    expect(seen).toEqual(['/about']);
  });

  test('a redirect from onNavigate leaves history and state agreeing', () => {
    const { adapter, router } = makeRouter();
    router.onNavigate(info => {
      if (info.path === '/about') router.push('/users/9');
    });
    router.init();
    router.push('/about');
    expect(router.path).toBe('/users/9');
    expect(adapter.read()).toBe('/users/9');
    expect(adapter.entries.map(e => e.url)).toEqual(['/', '/about', '/users/9']);
  });

  test('an unconditional redirect loop is cut loudly and stays coherent', () => {
    const { adapter, router } = makeRouter();
    let flips = 0;
    router.onNavigate(() => {
      flips += 1;
      router.push(flips % 2 ? '/about' : '/users/1');
    });
    router.init();
    expect(adapter.entries.length).toBeLessThan(15);
    expect(adapter.read().startsWith('/')).toBeTrue();
    expect(router.path).not.toBeNull();
  });
});

describe('match', () => {
  test('match is pure and complete', () => {
    const { router } = makeRouter();
    router.init();
    const hit = router.match('/users/3?tab=a&tab=b#top');
    expect(hit.route.file).toBe('_route/users/[id].rip');
    expect(hit.params).toEqual({ id: '3' });
    expect(hit.query).toEqual({ tab: 'b' });
    expect(hit.hash).toBe('top');
    expect(router.current.route.file).toBe('_route/index.rip');
    expect(router.match('/missing')).toBeNull();
  });

  test('a fragment owns everything after the first #', () => {
    const { router } = makeRouter();
    const hit = router.match('/about#f?x=1');
    expect(hit.hash).toBe('f?x=1');
    expect(hit.query).toEqual({});
  });

  test('match takes app-relative URLs even under a base', () => {
    const adapter = fakeAdapter('/app/about');
    const router = createRouter({ routes: manifest(), adapter, base: '/app' });
    expect(router.match('/about')).not.toBeNull();
    expect(router.match('/app/about')).toBeNull();
  });
});

describe('stability and reactivity', () => {
  test('unchanged params and query keep their identity', () => {
    const { router } = makeRouter();
    router.init();
    router.push('/users/7?a=1');
    const { params, query } = router.current;
    router.push('/users/7?a=1#other');
    expect(router.current.params).toBe(params);
    expect(router.current.query).toBe(query);
    router.push('/users/8?a=1');
    expect(router.current.params).not.toBe(params);
    expect(router.current.query).toBe(query);
  });

  test('current is one reactive dependency', () => {
    const { router } = makeRouter();
    router.init();
    let runs = 0;
    const dispose = __effect(() => { void router.current; runs += 1; });
    expect(runs).toBe(1);
    router.push('/about');
    expect(runs).toBe(2);
    dispose();
  });

  test('a fragment-only navigation never looks like a route change', () => {
    const { router } = makeRouter();
    router.init();
    router.push('/about');
    let runs = 0;
    const dispose = __effect(() => { void router.current; runs += 1; });
    router.push('/about#section');
    expect(runs).toBe(1);
    expect(router.hash).toBe('section');
    dispose();
  });

  test('navigating is a writable flag', () => {
    const { router } = makeRouter();
    expect('navigating' in router).toBeTrue();
    router.navigating = true;
    expect(router.navigating).toBeTrue();
  });
});

describe('base paths', () => {
  test('a base prefix strips on read and joins on write', () => {
    const adapter = fakeAdapter('/app/users/7');
    const router = createRouter({ routes: manifest(), adapter, base: '/app' });
    router.init();
    expect(router.current.params).toEqual({ id: '7' });
    router.push('/about');
    expect(adapter.calls.push).toEqual(['/app/about']);
    router.push('/');
    expect(adapter.calls.push).toEqual(['/app/about', '/app']);
  });

  test('the base boundary is segment-aware', () => {
    const seen = [];
    const adapter = fakeAdapter('/apple/users/7');
    const router = createRouter({ routes: manifest(), adapter, base: '/app', onError: f => seen.push(f) });
    router.init();
    expect(router.current).toBeNull();
    expect(seen[0].status).toBe(404);
  });

  test('invalid bases and base-with-hash reject', () => {
    const adapter = fakeAdapter();
    expect(() => createRouter({ routes: manifest(), adapter, base: '/' })).toThrow(TypeError);
    expect(() => createRouter({ routes: manifest(), adapter, base: 'app' })).toThrow(TypeError);
    expect(() => createRouter({ routes: manifest(), adapter, base: '/app/' })).toThrow(TypeError);
    expect(() => createRouter({ routes: manifest(), adapter, base: '/app', hash: true })).toThrow(TypeError);
  });
});

describe('hash mode', () => {
  test('routes read from and write to the fragment', () => {
    const adapter = fakeAdapter('/site/index.html#/users/7?x=1');
    const router = createRouter({ routes: manifest(), adapter, hash: true });
    router.init();
    expect(router.current.params).toEqual({ id: '7' });
    expect(router.current.query).toEqual({ x: '1' });
    router.push('/about');
    expect(adapter.calls.push).toEqual(['/site/index.html#/about']);
  });

  test('an empty fragment is the root route', () => {
    const adapter = fakeAdapter('/site/index.html');
    const router = createRouter({ routes: manifest(), adapter, hash: true });
    router.init();
    expect(router.current.route.file).toBe('_route/index.rip');
  });

  test('a second # inside the fragment is the route hash', () => {
    const adapter = fakeAdapter('/i.html#/users/7#bio');
    const router = createRouter({ routes: manifest(), adapter, hash: true });
    router.init();
    expect(router.current.params).toEqual({ id: '7' });
    expect(router.hash).toBe('bio');
  });

  test('the outer search survives fragment writes', () => {
    const adapter = fakeAdapter('/index.html?v=1#/about');
    const router = createRouter({ routes: manifest(), adapter, hash: true });
    router.init();
    router.push('/');
    expect(adapter.calls.push).toEqual(['/index.html?v=1#/']);
  });
});

describe('minimal adapters', () => {
  test('scroll and readState are optional', () => {
    const listeners = new Set();
    const entries = ['/'];
    let index = 0;
    const adapter = {
      read: () => entries[index],
      push(url) { entries.splice(index + 1); entries.push(url); index += 1; },
      replace(url) { entries[index] = url; },
      go(delta) { index = Math.min(Math.max(index + delta, 0), entries.length - 1); for (const fn of [...listeners]) fn(); },
      listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    const router = createRouter({ routes: manifest(), adapter });
    router.init();
    router.push('/about');
    router.back();
    expect(router.current.route.file).toBe('_route/index.rip');
  });
});

describe('rebuild and destroy', () => {
  test('rebuild swaps the manifest thunk and re-resolves', () => {
    let files = ['_route/index.rip'];
    const adapter = fakeAdapter('/late');
    const seen = [];
    const router = createRouter({
      routes: () => buildRoutes(files),
      adapter,
      onError: f => seen.push(f),
    });
    router.init();
    expect(router.current).toBeNull();
    files = ['_route/index.rip', '_route/late.rip'];
    router.rebuild();
    expect(router.current.route.file).toBe('_route/late.rip');
  });

  test('rebuild with a static manifest re-resolves in place', () => {
    const { router } = makeRouter({ initial: '/about' });
    const seen = [];
    router.onNavigate(info => seen.push(info.path));
    router.init();
    router.rebuild();
    expect(seen).toEqual(['/about', '/about']);
  });

  test('traversal to a URL the manifest no longer claims keeps prior state', () => {
    let files = FILES;
    const errors = [];
    const adapter = fakeAdapter('/');
    const router = createRouter({ routes: () => buildRoutes(files), adapter, onError: f => errors.push(f) });
    router.init();
    router.push('/about');
    files = FILES.filter(f => f !== '_route/about.rip');
    router.back();
    router.rebuild();
    expect(router.current.route.file).toBe('_route/index.rip');
    router.forward();
    expect(router.current.route.file).toBe('_route/index.rip');
    expect(errors).toEqual([{ status: 404, path: '/about' }]);
    expect(adapter.read()).toBe('/about');
  });

  test('destroy unsubscribes, is idempotent, and init re-subscribes', () => {
    const { adapter, router } = makeRouter();
    router.init();
    router.push('/about');
    router.destroy();
    router.destroy();
    expect(adapter.listeners.size).toBe(0);
    adapter.go(-1);
    expect(router.current.route.file).toBe('_route/about.rip');
    router.init();
    expect(adapter.listeners.size).toBe(1);
    adapter.go(1);
    expect(router.current.route.file).toBe('_route/about.rip');
  });
});
