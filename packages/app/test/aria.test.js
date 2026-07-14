import { describe, expect, test } from 'bun:test';
import { ariaCurrent, buildRoutes, createRouter, ownsAnchor } from '@rip-lang/app';

const FILES = [
  '_route/index.rip',
  '_route/users/index.rip',
  '_route/users/[id].rip',
  '_route/about.rip',
];

const fakeAdapter = (initial = '/') => {
  const listeners = new Set();
  let url = initial;
  return {
    read: () => url,
    push(next) { url = next; },
    replace(next) { url = next; },
    go() {},
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
};

const anchor = (href, attrs = {}) => {
  const table = { href, ...attrs };
  return {
    attributes: table,
    getAttribute(name) { return table[name] ?? null; },
    hasAttribute(name) { return name in table; },
    setAttribute(name, value) { table[name] = value; },
    removeAttribute(name) { delete table[name]; },
  };
};

const makeRouter = (initial = '/') => {
  const router = createRouter({ routes: buildRoutes(FILES), adapter: fakeAdapter(initial) });
  router.init();
  return router;
};

describe('ownsAnchor', () => {
  test('claims app-relative matching anchors only', () => {
    const router = makeRouter();
    expect(ownsAnchor(router, anchor('/about'))).toBeTrue();
    expect(ownsAnchor(router, anchor('/users/7?tab=a#x'))).toBeTrue();
    expect(ownsAnchor(router, anchor('/nowhere'))).toBeFalse();
    expect(ownsAnchor(router, anchor('https://example.com/about'))).toBeFalse();
    expect(ownsAnchor(router, anchor('mailto:x@y.z'))).toBeFalse();
    expect(ownsAnchor(router, anchor('/about', { 'data-router-ignore': '' }))).toBeFalse();
    expect(ownsAnchor(router, anchor('/about', { download: '' }))).toBeFalse();
    expect(ownsAnchor(router, anchor('/about', { target: '_blank' }))).toBeFalse();
    expect(ownsAnchor(router, anchor('/about', { target: '_self' }))).toBeTrue();
  });
});

describe('ariaCurrent', () => {
  const host = anchors => ({ anchors: () => anchors });

  test('marks the exact route page and ancestors true', () => {
    const router = makeRouter('/users/7');
    const users = anchor('/users');
    const user = anchor('/users/7');
    const about = anchor('/about');
    const dispose = ariaCurrent(router, host([users, user, about]));
    expect(user.getAttribute('aria-current')).toBe('page');
    expect(users.getAttribute('aria-current')).toBe('true');
    expect(about.getAttribute('aria-current')).toBeNull();
    dispose();
  });

  test('navigation moves the marks and clears stale ones', () => {
    const router = makeRouter('/about');
    const about = anchor('/about');
    const users = anchor('/users');
    const dispose = ariaCurrent(router, host([about, users]));
    expect(about.getAttribute('aria-current')).toBe('page');
    router.push('/users');
    expect(about.getAttribute('aria-current')).toBeNull();
    expect(users.getAttribute('aria-current')).toBe('page');
    dispose();
  });

  test('application-managed marks are never disturbed', () => {
    const router = makeRouter('/about');
    const managed = anchor('/users', { 'aria-current': 'step' });
    const dispose = ariaCurrent(router, host([managed]));
    router.push('/about');
    expect(managed.getAttribute('aria-current')).toBe('step');
    dispose();
  });

  test('the root route never marks ancestors', () => {
    const router = makeRouter('/');
    const root = anchor('/');
    const about = anchor('/about');
    const dispose = ariaCurrent(router, host([root, about]));
    expect(root.getAttribute('aria-current')).toBe('page');
    expect(about.getAttribute('aria-current')).toBeNull();
    dispose();
  });

  test('an observed mutation re-walks new anchors', () => {
    const router = makeRouter('/about');
    const anchors = [anchor('/about')];
    let notify = null;
    const dispose = ariaCurrent(router, {
      anchors: () => anchors,
      observe(fn) { notify = fn; return () => { notify = null; }; },
    });
    const late = anchor('/about');
    anchors.push(late);
    notify();
    expect(late.getAttribute('aria-current')).toBe('page');
    dispose();
    expect(notify).toBeNull();
  });

  test('dispose removes its marks and stops tracking', () => {
    const router = makeRouter('/about');
    const about = anchor('/about');
    const dispose = ariaCurrent(router, host([about]));
    expect(about.getAttribute('aria-current')).toBe('page');
    dispose();
    dispose();
    expect(about.getAttribute('aria-current')).toBeNull();
    router.push('/users');
    expect(about.getAttribute('aria-current')).toBeNull();
  });

  test('a router is required and the browser host rejects under Node', () => {
    expect(() => ariaCurrent(null)).toThrow(TypeError);
    const router = makeRouter();
    expect(() => ariaCurrent(router)).toThrow(/browser or an injected host/);
  });
});

describe('aria reconciliation', () => {
  const host = anchors => ({ anchors: () => anchors });

  test('base-path routers own their real document hrefs', () => {
    const router = createRouter({ routes: buildRoutes(FILES), adapter: fakeAdapter('/app/about'), base: '/app' });
    router.init();
    expect(ownsAnchor(router, anchor('/app/users/7'))).toBeTrue();
    expect(ownsAnchor(router, anchor('/users/7'))).toBeFalse();
    const based = anchor('/app/about');
    const dispose = ariaCurrent(router, host([based]));
    expect(based.getAttribute('aria-current')).toBe('page');
    dispose();
  });

  test('hash-mode routers own fragment hrefs only', () => {
    const router = createRouter({ routes: buildRoutes(FILES), adapter: fakeAdapter('/i.html#/about'), hash: true });
    router.init();
    expect(ownsAnchor(router, anchor('#/about'))).toBeTrue();
    expect(ownsAnchor(router, anchor('/about'))).toBeFalse();
    const frag = anchor('#/about');
    const dispose = ariaCurrent(router, host([frag]));
    expect(frag.getAttribute('aria-current')).toBe('page');
    dispose();
  });

  test('protocol-relative and backslashed hrefs are never owned, even by a catch-all', () => {
    const router = createRouter({
      routes: buildRoutes(['_route/[...rest].rip']),
      adapter: fakeAdapter('/x'),
    });
    router.init();
    expect(ownsAnchor(router, anchor('//evil.com/x'))).toBeFalse();
    expect(ownsAnchor(router, anchor('/\\evil.com'))).toBeFalse();
    expect(router.push('//evil.com/x')).toBeFalse();
    expect(router.push('/\\evil.com')).toBeFalse();
    expect(router.path).toBe('/x');
  });

  test('a mark is removed when its anchor stops earning it', () => {
    const router = makeRouter('/about');
    const a = anchor('/about');
    let notify = null;
    const dispose = ariaCurrent(router, {
      anchors: () => [a],
      observe(fn) { notify = fn; return () => {}; },
    });
    expect(a.getAttribute('aria-current')).toBe('page');
    a.setAttribute('href', 'https://evil.example/phish');
    notify();
    expect(a.getAttribute('aria-current')).toBeNull();
    dispose();
  });

  test('a managed mark on the current route is never set over or removed', () => {
    const router = makeRouter('/about');
    const managed = anchor('/about', { 'aria-current': 'step' });
    const dispose = ariaCurrent(router, host([managed]));
    expect(managed.getAttribute('aria-current')).toBe('step');
    router.push('/users');
    expect(managed.getAttribute('aria-current')).toBe('step');
    dispose();
    expect(managed.getAttribute('aria-current')).toBe('step');
  });

  test('two walkers never fight over shared anchors', () => {
    const routerA = makeRouter('/about');
    const routerB = createRouter({ routes: buildRoutes(['_route/users/index.rip']), adapter: fakeAdapter('/users') });
    routerB.init();
    const about = anchor('/about');
    const users = anchor('/users');
    const shared = [about, users];
    const disposeA = ariaCurrent(routerA, host(shared));
    const disposeB = ariaCurrent(routerB, host(shared));
    expect(about.getAttribute('aria-current')).toBe('page');
    expect(users.getAttribute('aria-current')).toBe('page');
    routerB.rebuild();
    expect(about.getAttribute('aria-current')).toBe('page');
    disposeA();
    disposeB();
  });

  test('a throwing host never aborts the navigation that triggered it', () => {
    const router = makeRouter('/about');
    let boom = false;
    const dispose = ariaCurrent(router, {
      anchors() {
        if (boom) throw new Error('host down');
        return [];
      },
    });
    boom = true;
    expect(router.push('/users')).toBeTrue();
    expect(router.path).toBe('/users');
    dispose();
  });

  test('same-origin absolute hrefs resolve under a stubbed location', () => {
    globalThis.location = { origin: 'https://app.example' };
    try {
      const router = makeRouter('/about');
      expect(ownsAnchor(router, anchor('https://app.example/about'))).toBeTrue();
      expect(ownsAnchor(router, anchor('https://other.example/about'))).toBeFalse();
      expect(ownsAnchor(router, anchor('https://app.example.evil.com/about'))).toBeFalse();
    } finally {
      delete globalThis.location;
    }
  });
});
