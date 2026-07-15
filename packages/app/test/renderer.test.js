import { describe, expect, test } from 'bun:test';
import {
  createComponents,
  createRenderer,
  createStash,
  source,
  unwrapStash,
} from '@rip-lang/app';
import { __state } from '../../../src/runtime/reactive.js';
import {
  __Component,
  __claimGateConstructor,
  __gateBind,
  __popComponent,
  __pushComponent,
  getContext,
  setContext,
} from '../../../src/runtime/components.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const target = () => ({
  children: [],
  appendChild(node) {
    this.children.push(node);
    return node;
  },
});

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
  querySelector(selector) {
    if (selector === '#content') return this.content ?? null;
    return null;
  },
});

const route = (file, { layouts = [], params = {}, query = {} } = {}) => ({
  route: { file },
  layouts,
  params,
  query,
});

const registry = entries => {
  const components = createComponents();
  for (const [file, module] of Object.entries(entries)) {
    components.write(file, 'stub');
    components.setCompiled(file, module);
  }
  return components;
};

describe('renderer render gates', () => {
  test('the renderer owns the one gate-construction capability', () => {
    expect(() => __claimGateConstructor()).toThrow('already claimed');
  });

  test('dedupes nearest-source subpath gates and constructs only after ensure', async () => {
    const pending = deferred();
    let calls = 0;
    let constructed;

    class Page extends __Component {
      static __gates = ['settings.theme', 'settings.theme'];
      _init() {
        this.theme = __gateBind(this, 0);
        this.themeAgain = __gateBind(this, 1);
        constructed = [this.theme.value, this.themeAgain.value];
      }
      _create() { return null; }
    }

    const app = {
      data: createStash({
        settings: source({
          fetch: async () => {
            calls++;
            return pending.promise;
          },
        }),
      }),
    };
    const renderer = createRenderer({
      router: { current: null, navigating: false },
      app,
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });

    const mounting = renderer.mount(route('page.rip'));
    await Bun.sleep(0);
    expect(constructed).toBeUndefined();
    expect(calls).toBe(1);

    pending.resolve({ theme: 'dark' });
    await mounting;
    expect(constructed).toEqual(['dark', 'dark']);
    expect(renderer.current).toBeInstanceOf(Page);
    expect('_gateApp' in renderer.current).toBeFalse();
    expect('_gateParams' in renderer.current).toBeFalse();
    expect('_gateQuery' in renderer.current).toBeFalse();
  });

  test('fetch failure is structured, reported, and prevents construction', async () => {
    let constructed = false;
    const problem = Object.assign(new Error('unavailable'), { status: 503 });

    class Page extends __Component {
      static __gates = ['user'];
      _init() {
        constructed = true;
        this.user = __gateBind(this, 0);
      }
      _create() { return null; }
    }

    const failures = [];
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({ user: source({ fetch: async () => { throw problem; } }) }) },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
      onError: failure => failures.push(failure),
    });

    const failure = await renderer.mount(route('page.rip')).catch(error => error);
    expect(failure).toMatchObject({
      name: 'GateFailure',
      status: 503,
      path: 'user',
      file: 'page.rip',
      message: 'unavailable',
      error: problem,
    });
    expect(failures).toEqual([failure]);
    expect(constructed).toBeFalse();
  });

  test('plain paths and source key mismatches reject with identifying paths', async () => {
    class Plain extends __Component {
      static __gates = ['plain'];
      _create() { return null; }
    }
    class MissingKey extends __Component {
      static __gates = ['order'];
      _create() { return null; }
    }
    class ExtraKey extends __Component {
      static __gates = [{ path: 'user', key: params => params.id }];
      _create() { return null; }
    }

    const app = {
      data: createStash({
        plain: { value: 1 },
        order: source({ kind: 'keyed', fetch: async key => ({ key }) }),
        user: source({ fetch: async () => ({ name: 'Ada' }) }),
      }),
    };
    const components = registry({
      'plain.rip': { Plain },
      'missing.rip': { MissingKey },
      'extra.rip': { ExtraKey },
    });
    const renderer = createRenderer({
      router: { current: null },
      app,
      components,
      target: target(),
    });

    for (const [file, path, text] of [
      ['plain.rip', 'plain', 'does not resolve to a source'],
      ['missing.rip', 'order', 'requires a key function'],
      ['extra.rip', 'user', 'does not accept a key function'],
    ]) {
      const failure = await renderer.mount(route(file, { params: { id: 'o1' } })).catch(error => error);
      expect(failure.path).toBe(path);
      expect(failure.message).toContain(text);
    }
  });

  test('a null source result rejects and prevents construction', async () => {
    let constructed = false;
    class Page extends __Component {
      static __gates = ['selection'];
      _init() { constructed = true; }
      _create() { return null; }
    }

    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({ selection: source({ fetch: async () => null }) }) },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });

    const failure = await renderer.mount(route('page.rip')).catch(error => error);
    expect(failure.path).toBe('selection');
    expect(failure.message).toContain('resolved to null');
    expect(constructed).toBeFalse();
  });

  test('missing and null singleton/keyed tails reject before construction', async () => {
    let constructed = 0;
    class SingletonPage extends __Component {
      static __gates = ['profile.name'];
      _init() { constructed++; }
      _create() { return null; }
    }
    class KeyedPage extends __Component {
      static __gates = [{ path: 'order.detail.total', key: params => params.id }];
      _init() { constructed++; }
      _create() { return null; }
    }

    for (const profile of [{}, { name: null }]) {
      const renderer = createRenderer({
        router: { current: null },
        app: { data: createStash({ profile: source({ fetch: async () => profile }) }) },
        components: registry({ 'page.rip': { SingletonPage } }),
        target: target(),
      });
      const failure = await renderer.mount(route('page.rip')).catch(error => error);
      expect(failure.path).toBe('profile.name');
      expect(failure.message).toContain('every gated subpath must exist and be non-null');
    }

    const keyedRenderer = createRenderer({
      router: { current: null },
      app: {
        data: createStash({
          order: source({ kind: 'keyed', fetch: async id => ({ id, detail: {} }) }),
        }),
      },
      components: registry({ 'page.rip': { KeyedPage } }),
      target: target(),
    });
    const keyedFailure = await keyedRenderer.mount(route('page.rip', {
      params: { id: 'o1' },
    })).catch(error => error);
    expect(keyedFailure.path).toBe('order.detail.total');
    expect(constructed).toBe(0);
  });

  test('keyed params and query gates load their addressed cells', async () => {
    const calls = [];
    let snapshot;

    class Page extends __Component {
      static __gates = [
        { path: 'order', key: params => params.id },
        { path: 'search', key: (_params, query) => query.term },
      ];
      _init() {
        this.order = __gateBind(this, 0);
        this.search = __gateBind(this, 1);
        snapshot = [this.order.value.id, this.search.value.term];
      }
      _create() { return null; }
    }

    const renderer = createRenderer({
      router: { current: null },
      app: {
        data: createStash({
          order: source({ kind: 'keyed', fetch: async id => {
            calls.push(['order', id]);
            return { id };
          } }),
          search: source({ kind: 'keyed', fetch: async term => {
            calls.push(['search', term]);
            return { term };
          } }),
        }),
      },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });

    await renderer.mount(route('page.rip', {
      params: { id: 'o1' },
      query: { term: 'rip' },
    }));
    expect(calls).toEqual([['order', 'o1'], ['search', 'rip']]);
    expect(snapshot).toEqual(['o1', 'rip']);
  });

  test('evaluates a keyed subpath once and binds the addressed cell tail', async () => {
    let keyCalls = 0;
    let binding;
    class Page extends __Component {
      static __gates = [{
        path: 'order.detail.total',
        key: params => {
          keyCalls++;
          return params.id;
        },
      }];
      _init() {
        this.total = __gateBind(this, 0);
        binding = this.total;
      }
      _create() { return null; }
    }

    const app = {
      data: createStash({
        order: source({
          kind: 'keyed',
          fetch: async id => ({ detail: { total: id === 'o1' ? 42 : 0 } }),
          staleTime: 'forever',
        }),
      }),
    };
    const renderer = createRenderer({
      router: { current: null },
      app,
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });

    await renderer.mount(route('page.rip', { params: { id: 'o1' } }));
    expect(binding.value).toBe(42);
    expect(binding.value).toBe(42);
    expect(keyCalls).toBe(1);
    unwrapStash(app.data).order.cellFor('o1').write({ detail: { total: 43 } });
    expect(binding.value).toBe(43);
    expect(keyCalls).toBe(1);
  });

  test('prefetched subpath getters evaluate once before initial binding', async () => {
    let reads = 0;
    let seen;
    let profile;
    class Page extends __Component {
      static __gates = ['user.profile'];
      _init() {
        this.profile = __gateBind(this, 0);
        profile = this.profile;
        seen = this.profile.value.name;
      }
      _create() { return null; }
    }
    const app = {
      data: createStash({
        user: source({
          fetch: async () => ({
            get profile() {
              reads++;
              return { name: 'Ada' };
            },
          }),
        }),
      }),
    };
    const renderer = createRenderer({
      router: { current: null },
      app,
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });
    await renderer.mount(route('page.rip'));
    expect(reads).toBe(1);
    expect(seen).toBe('Ada');
    unwrapStash(app.data).user.write({
      get profile() {
        reads++;
        return { name: 'Grace' };
      },
    });
    expect(profile.value.name).toBe('Grace');
    expect(reads).toBe(2);
  });

  test('reserved stash paths bind through renderer-resolved raw cells', async () => {
    let values;
    class Page extends __Component {
      static __gates = ['peek', 'reset'];
      _init() {
        this.peekValue = __gateBind(this, 0);
        this.resetValue = __gateBind(this, 1);
        values = [this.peekValue.value.name, this.resetValue.value.name];
      }
      _create() { return null; }
    }

    const renderer = createRenderer({
      router: { current: null },
      app: {
        data: createStash({
          peek: source({ fetch: async () => ({ name: 'peek' }) }),
          reset: source({ fetch: async () => ({ name: 'reset' }) }),
        }),
      },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });

    await renderer.mount(route('page.rip'));
    expect(values).toEqual(['peek', 'reset']);
  });

  test('builds layout ancestry before init and composes through content slots', async () => {
    const host = node('host');
    const outerLead = node('outer-lead');
    const outerRoot = node('outer');
    const outerContent = node('outer-content');
    outerRoot.content = outerContent;
    outerRoot.appendChild(outerContent);
    outerLead.appendChild(outerRoot);
    const innerRoot = node('inner');
    const innerContent = node('inner-content');
    innerRoot.content = innerContent;
    innerRoot.appendChild(innerContent);
    const pageRoot = node('page');
    let outer;
    let inner;
    let page;
    const accepted = [];

    class Outer extends __Component {
      _init() {
        outer = this;
        setContext('theme', 'dark');
      }
      _create() {
        this._nodes = [outerLead, outerRoot];
        return outerLead;
      }
    }
    class Inner extends __Component {
      _init() {
        inner = this;
        accepted.push(getContext('theme'));
      }
      _create() { return innerRoot; }
    }
    class Page extends __Component {
      _init() {
        page = this;
        accepted.push(getContext('theme'));
      }
      _create() { return pageRoot; }
    }

    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({
        'outer.rip': { Outer },
        'inner.rip': { Inner },
        'page.rip': { Page },
      }),
      target: host,
    });
    await renderer.mount(route('page.rip', { layouts: ['outer.rip', 'inner.rip'] }));

    expect(inner._parent).toBe(outer);
    expect(page._parent).toBe(inner);
    expect(accepted).toEqual(['dark', 'dark']);
    expect(host.children).toEqual([outerLead]);
    expect(outerContent.children).toEqual([innerRoot]);
    expect(innerContent.children).toEqual([pageRoot]);
  });

  test('a layout without #content uses its first root as the documented mount point', async () => {
    const host = node('host');
    const layoutRoot = node('layout');
    const pageRoot = node('page');
    class Layout extends __Component {
      _create() { return layoutRoot; }
    }
    class Page extends __Component {
      _create() { return pageRoot; }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({
        'layout.rip': { Layout },
        'page.rip': { Page },
      }),
      target: host,
    });
    await renderer.mount(route('page.rip', { layouts: ['layout.rip'] }));
    expect(host.children).toEqual([layoutRoot]);
    expect(layoutRoot.children).toEqual([pageRoot]);
  });

  test('multiple layout content slots choose the first in top-level root order', async () => {
    const host = node('host');
    const first = node('first');
    const firstContent = node('first-content');
    first.content = firstContent;
    first.appendChild(firstContent);
    const second = node('second');
    const secondContent = node('second-content');
    second.content = secondContent;
    second.appendChild(secondContent);
    const pageRoot = node('page');
    class Layout extends __Component {
      _create() {
        this._nodes = [first, second];
        return first;
      }
    }
    class Page extends __Component {
      _create() { return pageRoot; }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({
        'layout.rip': { Layout },
        'page.rip': { Page },
      }),
      target: host,
    });
    await renderer.mount(route('page.rip', { layouts: ['layout.rip'] }));
    expect(firstContent.children).toEqual([pageRoot]);
    expect(secondContent.children).toEqual([]);
  });

  test('replacement stages transactionally and cleans constructor and mount failures', async () => {
    const host = node('host');
    const oldRoot = node('old');
    const stagedRoot = node('staged-layout');
    let partialUnmounts = 0;

    class Good extends __Component {
      _create() { return oldRoot; }
    }
    class PartialLayout extends __Component {
      _create() { return stagedRoot; }
      unmounted() { partialUnmounts++; }
    }
    class BadConstructor extends __Component {
      _init() { throw new Error('constructor failed'); }
      _create() { return null; }
    }
    class BadMount extends __Component {
      _create() { throw new Error('mount failed'); }
    }

    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({
        'good.rip': { Good },
        'layout.rip': { PartialLayout },
        'bad-constructor.rip': { BadConstructor },
        'bad-mount.rip': { BadMount },
      }),
      target: host,
    });
    await renderer.mount(route('good.rip'));
    const oldInstance = renderer.current;
    expect(host.children).toEqual([oldRoot]);

    const ctorFailure = await renderer.mount(route('bad-constructor.rip', {
      layouts: ['layout.rip'],
    })).catch(error => error);
    expect(ctorFailure.message).toContain('constructor failed');
    expect(renderer.current).toBe(oldInstance);
    expect(host.children).toEqual([oldRoot]);
    expect(partialUnmounts).toBe(1);

    const mountFailure = await renderer.mount(route('bad-mount.rip')).catch(error => error);
    expect(mountFailure.message).toContain('mount failed');
    expect(renderer.current).toBe(oldInstance);
    expect(host.children).toEqual([oldRoot]);
  });

  test('teardown failures never stop rollback, replacement cleanup, or stop', async () => {
    const host = node('host');
    const oldRoot = node('old');
    const nextRoot = node('next');
    const attempts = [];
    const failures = [];
    class Old extends __Component {
      _create() { return oldRoot; }
    }
    class Next extends __Component {
      _create() { return nextRoot; }
    }
    const throwing = (name, root) => class extends __Component {
      _create() { return root; }
      unmount() {
        attempts.push(name);
        throw new Error(`${name} teardown`);
      }
    };
    const First = throwing('first', node('first'));
    const Second = throwing('second', node('second'));
    class Bad extends __Component {
      _init() { throw new Error('build failed'); }
      _create() { return null; }
    }

    const components = registry({
      'old.rip': { Old },
      'next.rip': { Next },
      'first.rip': { First },
      'second.rip': { Second },
      'bad.rip': { Bad },
    });
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components,
      target: host,
      onError: failure => failures.push(failure),
    });
    await renderer.mount(route('old.rip'));
    const old = renderer.current;

    const replacement = await renderer.mount(route('bad.rip', {
      layouts: ['first.rip', 'second.rip'],
    })).catch(error => error);
    expect(replacement.message).toContain('build failed');
    expect(attempts).toEqual(['second', 'first']);
    expect(renderer.current).toBe(old);
    expect(host.children).toEqual([oldRoot]);

    old.unmount = () => {
      attempts.push('old');
      throw new Error('old teardown');
    };
    attempts.length = 0;
    const commitFailure = await renderer.mount(route('next.rip')).catch(error => error);
    expect(commitFailure.message).toContain('old teardown');
    expect(commitFailure.path).toBe('<teardown>');
    expect(commitFailure.file).toBe('<renderer>');
    expect(attempts).toEqual(['old']);
    expect(renderer.current).toBeInstanceOf(Next);
    expect(host.children).toEqual([nextRoot]);

    attempts.length = 0;
    class StopFirst extends First {}
    class StopSecond extends Second {}
    components.write('stop-first.rip', 'stub');
    components.setCompiled('stop-first.rip', { StopFirst });
    components.write('stop-second.rip', 'stub');
    components.setCompiled('stop-second.rip', { StopSecond });
    await renderer.mount(route('stop-second.rip', { layouts: ['stop-first.rip'] }));
    expect(() => renderer.stop()).toThrow('second teardown');
    expect(attempts).toEqual(['second', 'first']);
    expect(renderer.current).toBeNull();
    expect(failures.at(-1)).toMatchObject({ path: '<teardown>', message: 'second teardown' });
  });

  test('prefers a component default export and rejects ambiguous named components', async () => {
    class Page extends __Component {
      _create() { return null; }
    }
    class Helper extends __Component {
      _create() { return null; }
    }
    class Other extends __Component {
      _create() { return null; }
    }

    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({
        'default.rip': { default: Page, Helper },
        'ambiguous.rip': { Helper, Other },
      }),
      target: target(),
    });

    await renderer.mount(route('default.rip'));
    expect(renderer.current).toBeInstanceOf(Page);
    const failure = await renderer.mount(route('ambiguous.rip')).catch(error => error);
    expect(failure.message).toContain('exactly one component class');
    expect(renderer.current).toBeInstanceOf(Page);
  });

  test('start reacts to injectable route state', async () => {
    let constructed = false;
    class Page extends __Component {
      _init() { constructed = true; }
      _create() { return null; }
    }

    const state = __state(null);
    const router = {
      get current() { return state.value; },
      navigating: false,
      init() {},
    };
    const renderer = createRenderer({
      router,
      app: { data: createStash({}) },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    }).start();

    state.value = route('page.rip');
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(constructed).toBeTrue();
    renderer.stop();
  });

  test('stale and stopped navigation failures resolve silently', async () => {
    const staleLoad = deferred();
    const stopLoad = deferred();
    const failures = [];
    class Slow extends __Component {
      static __gates = ['slow'];
      _create() { return null; }
    }
    class Stopped extends __Component {
      static __gates = ['stopped'];
      _create() { return null; }
    }
    class Fast extends __Component {
      _create() { return null; }
    }

    const renderer = createRenderer({
      router: { current: null, navigating: false },
      app: {
        data: createStash({
          slow: source({ fetch: async () => staleLoad.promise }),
          stopped: source({ fetch: async () => stopLoad.promise }),
        }),
      },
      components: registry({
        'slow.rip': { Slow },
        'stopped.rip': { Stopped },
        'fast.rip': { Fast },
      }),
      target: target(),
      onError: failure => failures.push(failure),
    });

    const staleMount = renderer.mount(route('slow.rip'));
    await Bun.sleep(0);
    await renderer.mount(route('fast.rip'));
    staleLoad.reject(new Error('stale failed'));
    expect(await staleMount).toBeNull();
    expect(renderer.current).toBeInstanceOf(Fast);
    expect(failures).toEqual([]);

    const stoppedMount = renderer.mount(route('stopped.rip'));
    await Bun.sleep(0);
    renderer.stop();
    stopLoad.reject(new Error('stopped failed'));
    expect(await stoppedMount).toBeNull();
    expect(failures).toEqual([]);
  });

  test('embedded gated children still reject outside a route constructor', () => {
    class Parent extends __Component {
      _create() { return null; }
    }
    class Child extends __Component {
      static __gates = ['user'];
      _create() { return null; }
    }

    const parent = new Parent();
    const previous = __pushComponent(parent);
    try {
      expect(() => new Child()).toThrow('render gates');
    } finally {
      __popComponent(previous);
    }
  });

  test('renderer authorization is consumed before gated init can re-enter', async () => {
    let nestedError;
    class Page extends __Component {
      static __gates = ['user'];
      _init() {
        this.user = __gateBind(this, 0);
        try {
          new Page();
        } catch (error) {
          nestedError = error;
        }
      }
      _create() { return null; }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({ user: source({ fetch: async () => ({ name: 'Ada' }) }) }) },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });
    await renderer.mount(route('page.rip'));
    expect(nestedError?.message).toContain('cannot be constructed directly');
  });

  test('direct gated construction rejects even without a parent component', () => {
    class Page extends __Component {
      static __gates = ['user'];
      _create() { return null; }
    }
    expect(() => new Page()).toThrow('cannot be constructed directly');
  });

  test('plain components reject renderer-only prop names', () => {
    class Plain extends __Component {
      _create() { return null; }
    }
    for (const key of ['app', 'params', 'query']) {
      expect(() => new Plain({ [key]: {} })).toThrow(`unknown prop '${key}'`);
    }
  });
});

describe('renderer navigation integration', () => {
  const chrome = () => {
    const host = node('host');
    const layoutRoot = node('layout');
    const content = node('layout-content');
    layoutRoot.content = content;
    layoutRoot.appendChild(content);
    return { host, layoutRoot, content };
  };

  test('an unchanged layout chain is reused, not re-gated', async () => {
    const { host, layoutRoot, content } = chrome();
    let layoutFetches = 0;
    let layoutInits = 0;
    const data = createStash({
      nav: source({ fetch: async () => { layoutFetches += 1; return { ok: true }; } }),
    });
    class Layout extends __Component {
      static __gates = ['nav'];
      _init() { layoutInits += 1; this.nav = __gateBind(this, 0); }
      _create() { return layoutRoot; }
    }
    class A extends __Component { _create() { return node('a'); } }
    class B extends __Component { _create() { return node('b'); } }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'a.rip': { A }, 'b.rip': { B } }),
      target: host,
    });
    await renderer.mount(route('a.rip', { layouts: ['layout.rip'] }));
    await renderer.mount(route('b.rip', { layouts: ['layout.rip'] }));
    expect(layoutInits).toBe(1);
    expect(layoutFetches).toBe(1);
    expect(host.children).toEqual([layoutRoot]);
    expect(content.children.map(child => child.name)).toEqual(['b']);
  });

  test('a changed layout chain rebuilds from scratch', async () => {
    const { host, layoutRoot, content } = chrome();
    const other = node('other-layout');
    let inits = 0;
    class Layout extends __Component {
      _init() { inits += 1; }
      _create() { return layoutRoot; }
    }
    class Other extends __Component { _create() { return other; } }
    class A extends __Component { _create() { return node('a'); } }
    class B extends __Component { _create() { return node('b'); } }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({ 'layout.rip': { Layout }, 'other.rip': { Other }, 'a.rip': { A }, 'b.rip': { B } }),
      target: host,
    });
    await renderer.mount(route('a.rip', { layouts: ['layout.rip'] }));
    await renderer.mount(route('b.rip', { layouts: ['other.rip'] }));
    expect(host.children).toEqual([other]);
    expect(other.children.map(child => child.name)).toEqual(['b']);
  });

  test('a query-only navigation calls load instead of remounting', async () => {
    const host = node('host');
    let inits = 0;
    const loads = [];
    class Page extends __Component {
      _init() { inits += 1; }
      _create() { return node('page'); }
      load(params, query) { loads.push(query.tab); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({ 'page.rip': { Page } }),
      target: host,
    });
    const first = await renderer.mount(route('page.rip', { params: { id: '1' }, query: { tab: 'a' } }));
    const second = await renderer.mount(route('page.rip', { params: { id: '1' }, query: { tab: 'b' } }));
    expect(inits).toBe(1);
    expect(second).toBe(first);
    expect(renderer.current).toBe(first);
    expect(loads).toEqual(['b']);
  });

  test('a params change constructs a fresh instance', async () => {
    const host = node('host');
    let inits = 0;
    class Page extends __Component {
      _init() { inits += 1; }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({ 'page.rip': { Page } }),
      target: host,
    });
    await renderer.mount(route('page.rip', { params: { id: '1' } }));
    await renderer.mount(route('page.rip', { params: { id: '2' } }));
    expect(inits).toBe(2);
  });

  test('a query-keyed gate addressing a new cell forces a remount', async () => {
    const host = node('host');
    let inits = 0;
    const data = createStash({
      search: source({ kind: 'keyed', fetch: async term => ({ term }) }),
    });
    class Page extends __Component {
      static __gates = [{ path: 'search', key: (params, query) => query.term }];
      _init() { inits += 1; this.search = __gateBind(this, 0); }
      _create() { return node('page'); }
      load() {}
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'page.rip': { Page } }),
      target: host,
    });
    await renderer.mount(route('page.rip', { query: { term: 'a' } }));
    await renderer.mount(route('page.rip', { query: { term: 'b' } }));
    expect(inits).toBe(2);
  });

  test('a query-keyed gate holding its cell keeps the fast path', async () => {
    const host = node('host');
    let inits = 0;
    const loads = [];
    const data = createStash({
      order: source({ kind: 'keyed', fetch: async id => ({ id }) }),
    });
    class Page extends __Component {
      static __gates = [{ path: 'order', key: params => params.id }];
      _init() { inits += 1; this.order = __gateBind(this, 0); }
      _create() { return node('page'); }
      load(params, query) { loads.push(query.tab); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'page.rip': { Page } }),
      target: host,
    });
    await renderer.mount(route('page.rip', { params: { id: '5' }, query: { tab: 'a' } }));
    await renderer.mount(route('page.rip', { params: { id: '5' }, query: { tab: 'b' } }));
    expect(inits).toBe(1);
    expect(loads).toEqual(['b']);
  });

  test('a gate failure routes to the nearest layout onError as control flow', async () => {
    const { host, layoutRoot } = chrome();
    const failures = [];
    let handled = null;
    const data = createStash({
      broken: source({ fetch: async () => { throw Object.assign(new Error('down'), { status: 503 }); } }),
    });
    class Layout extends __Component {
      _create() { return layoutRoot; }
      onError(failure) { handled = failure; }
    }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'page.rip': { Page } }),
      target: host,
      onError: failure => failures.push(failure),
    });
    const result = await renderer.mount(route('page.rip', { layouts: ['layout.rip'] }));
    expect(result).toBeNull();
    expect(handled.status).toBe(503);
    expect(handled.path).toBe('broken');
    expect(failures).toEqual([]);
    expect(host.children).toEqual([layoutRoot]);
  });

  test('a handled failure replaces the previous screen with the boundary chain', async () => {
    const { host, layoutRoot } = chrome();
    let handled = null;
    const data = createStash({
      broken: source({ fetch: async () => { throw new Error('down'); } }),
    });
    class Layout extends __Component {
      _create() { return layoutRoot; }
      onError(failure) { handled = failure; }
    }
    class Home extends __Component { _create() { return node('home'); } }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'home.rip': { Home }, 'page.rip': { Page } }),
      target: host,
    });
    await renderer.mount(route('home.rip'));
    expect(host.children.map(child => child.name)).toEqual(['home']);
    await renderer.mount(route('page.rip', { layouts: ['layout.rip'] }));
    expect(handled).not.toBeNull();
    expect(host.children).toEqual([layoutRoot]);
  });

  test('an unhandled gate failure retains the previous screen and throws', async () => {
    const host = node('host');
    const failures = [];
    const data = createStash({
      broken: source({ fetch: async () => { throw new Error('down'); } }),
    });
    class Home extends __Component { _create() { return node('home'); } }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'home.rip': { Home }, 'page.rip': { Page } }),
      target: host,
      onError: failure => failures.push(failure),
    });
    const home = await renderer.mount(route('home.rip'));
    await expect(renderer.mount(route('page.rip'))).rejects.toMatchObject({ path: 'broken' });
    expect(failures.length).toBe(1);
    expect(host.children.map(child => child.name)).toEqual(['home']);
    expect(renderer.current).toBe(home);
  });
});

describe('renderer boundary reconciliation', () => {
  const failingSource = () => source({ fetch: async () => { throw new Error('down'); } });

  test('a boundary mount never poisons layout reuse', async () => {
    const host = node('host');
    const aRoot = node('a-layout');
    const aContent = node('a-content');
    aRoot.content = aContent;
    aRoot.appendChild(aContent);
    const bRoot = node('b-layout');
    const bContent = node('b-content');
    bRoot.content = bContent;
    bRoot.appendChild(bContent);
    const data = createStash({ broken: failingSource() });
    class A extends __Component {
      _create() { return aRoot; }
      onError() {}
    }
    class B extends __Component { _create() { return bRoot; } }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    class Other extends __Component { _create() { return node('other'); } }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'a.rip': { A }, 'b.rip': { B }, 'page.rip': { Page }, 'other.rip': { Other } }),
      target: host,
    });
    await renderer.mount(route('page.rip', { layouts: ['a.rip', 'b.rip'] }));
    expect(host.children).toEqual([aRoot]);
    await renderer.mount(route('other.rip', { layouts: ['a.rip'] }));
    const reachable = [];
    const walk = n => { reachable.push(n.name); (n.children ?? []).forEach(walk); };
    walk(host);
    expect(reachable).toContain('other');
  });

  test('a boundary layout with its own gates sees its values', async () => {
    const host = node('host');
    const layoutRoot = node('layout');
    let seen = 'unset';
    const data = createStash({
      nav: source({ fetch: async () => ({ label: 'ready' }) }),
      broken: failingSource(),
    });
    class Layout extends __Component {
      static __gates = ['nav'];
      _init() { this.nav = __gateBind(this, 0); seen = this.nav.value; }
      _create() { return layoutRoot; }
      onError() {}
    }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'page.rip': { Page } }),
      target: host,
    });
    const result = await renderer.mount(route('page.rip', { layouts: ['layout.rip'] }));
    expect(result).toBeNull();
    expect(seen).toEqual({ label: 'ready' });
  });

  test('a failing page swap under a reused chain routes to the living layout', async () => {
    const host = node('host');
    const layoutRoot = node('layout');
    const content = node('content');
    layoutRoot.content = content;
    layoutRoot.appendChild(content);
    let handled = null;
    let layoutInits = 0;
    const failures = [];
    const data = createStash({ broken: failingSource() });
    class Layout extends __Component {
      _init() { layoutInits += 1; }
      _create() { return layoutRoot; }
      onError(failure) { handled = failure; }
    }
    class A extends __Component { _create() { return node('a'); } }
    class Broken extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('broken'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'a.rip': { A }, 'broken.rip': { Broken } }),
      target: host,
      onError: failure => failures.push(failure),
    });
    await renderer.mount(route('a.rip', { layouts: ['layout.rip'] }));
    const result = await renderer.mount(route('broken.rip', { layouts: ['layout.rip'] }));
    expect(result).toBeNull();
    expect(handled.path).toBe('broken');
    expect(failures).toEqual([]);
    expect(layoutInits).toBe(1);
    expect(content.children).toEqual([]);
  });

  test('a kept layout whose keyed gate retargets forces a rebuild', async () => {
    const host = node('host');
    let layoutInits = 0;
    const keys = [];
    const data = createStash({
      user: source({ kind: 'keyed', fetch: async id => { keys.push(id); return { id }; } }),
    });
    class Layout extends __Component {
      static __gates = [{ path: 'user', key: params => params.id }];
      _init() { layoutInits += 1; this.user = __gateBind(this, 0); }
      _create() {
        const root = node(`layout-${layoutInits}`);
        const content = node('content');
        root.content = content;
        root.appendChild(content);
        return root;
      }
    }
    class Profile extends __Component { _create() { return node('profile'); } }
    class Settings extends __Component { _create() { return node('settings'); } }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'profile.rip': { Profile }, 'settings.rip': { Settings } }),
      target: host,
    });
    await renderer.mount(route('profile.rip', { layouts: ['layout.rip'], params: { id: '1' } }));
    await renderer.mount(route('settings.rip', { layouts: ['layout.rip'], params: { id: '2' } }));
    expect(layoutInits).toBe(2);
    expect(keys).toEqual(['1', '2']);
  });

  test('the nearest of two onError ancestors wins', async () => {
    const host = node('host');
    const outerRoot = node('outer');
    const outerContent = node('outer-content');
    outerRoot.content = outerContent;
    outerRoot.appendChild(outerContent);
    const innerRoot = node('inner');
    const order = [];
    const data = createStash({ broken: failingSource() });
    class Outer extends __Component {
      _create() { return outerRoot; }
      onError() { order.push('outer'); }
    }
    class Inner extends __Component {
      _create() { return innerRoot; }
      onError() { order.push('inner'); }
    }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'outer.rip': { Outer }, 'inner.rip': { Inner }, 'page.rip': { Page } }),
      target: host,
    });
    await renderer.mount(route('page.rip', { layouts: ['outer.rip', 'inner.rip'] }));
    expect(order).toEqual(['inner']);
  });

  test('a cell shared with a failing layout offers no boundary below it', async () => {
    const host = node('host');
    const failures = [];
    const data = createStash({ broken: failingSource() });
    class Layout extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('layout'); }
      onError() { throw new Error('never reached'); }
    }
    class Page extends __Component {
      static __gates = ['broken'];
      _init() { this.broken = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'page.rip': { Page } }),
      target: host,
      onError: failure => failures.push(failure),
    });
    await expect(renderer.mount(route('page.rip', { layouts: ['layout.rip'] }))).rejects.toMatchObject({ path: 'broken' });
    expect(failures.length).toBe(1);
    expect(host.children).toEqual([]);
  });

  test('an identical navigation constructs a fresh instance', async () => {
    const host = node('host');
    let inits = 0;
    class Page extends __Component {
      _init() { inits += 1; }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({ 'page.rip': { Page } }),
      target: host,
    });
    await renderer.mount(route('page.rip', { query: { a: '1' } }));
    await renderer.mount(route('page.rip', { query: { a: '1' } }));
    expect(inits).toBe(2);
  });

  test('consecutive page swaps keep reusing the chain', async () => {
    const host = node('host');
    const layoutRoot = node('layout');
    const content = node('content');
    layoutRoot.content = content;
    layoutRoot.appendChild(content);
    let layoutInits = 0;
    class Layout extends __Component {
      _init() { layoutInits += 1; }
      _create() { return layoutRoot; }
    }
    class A extends __Component { _create() { return node('a'); } }
    class B extends __Component { _create() { return node('b'); } }
    class C extends __Component { _create() { return node('c'); } }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({ 'layout.rip': { Layout }, 'a.rip': { A }, 'b.rip': { B }, 'c.rip': { C } }),
      target: host,
    });
    await renderer.mount(route('a.rip', { layouts: ['layout.rip'] }));
    await renderer.mount(route('b.rip', { layouts: ['layout.rip'] }));
    await renderer.mount(route('c.rip', { layouts: ['layout.rip'] }));
    expect(layoutInits).toBe(1);
    expect(content.children.map(child => child.name)).toEqual(['c']);
  });

  test('a throwing load keeps the mounted page and surfaces the failure', async () => {
    const host = node('host');
    const failures = [];
    class Page extends __Component {
      _create() { return node('page'); }
      load() { throw new Error('load blew up'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data: createStash({}) },
      components: registry({ 'page.rip': { Page } }),
      target: host,
      onError: failure => failures.push(failure),
    });
    const first = await renderer.mount(route('page.rip', { query: { a: '1' } }));
    await expect(renderer.mount(route('page.rip', { query: { a: '2' } }))).rejects.toMatchObject({ name: 'GateFailure' });
    expect(failures.length).toBe(1);
    expect(renderer.current).toBe(first);
  });
});

describe('renderer link-intent preloading', () => {
  test('preload warms an unmounted chain once and the navigation reuses it', async () => {
    let fetches = 0;
    const data = createStash({
      user: source({ fetch: async () => ({ version: ++fetches }) }),
    });
    class Page extends __Component {
      static __gates = ['user'];
      _init() { this.user = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });
    renderer.preload(route('page.rip'));
    await Bun.sleep(0);
    expect(fetches).toBe(1);
    await renderer.mount(route('page.rip'));
    await Bun.sleep(0);
    expect(fetches).toBe(1);
    expect(renderer.current).toBeInstanceOf(Page);
  });

  test('a destination already fully mounted warms nothing', async () => {
    let fetches = 0;
    const data = createStash({
      user: source({ fetch: async () => ({ version: ++fetches }) }),
    });
    class Page extends __Component {
      static __gates = ['user'];
      _init() { this.user = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'page.rip': { Page } }),
      target: target(),
    });
    await renderer.mount(route('page.rip'));
    expect(fetches).toBe(1);
    renderer.preload(route('page.rip'));
    await Bun.sleep(0);
    expect(fetches).toBe(1);
  });

  test('an unchanged layout chain warms only the page', async () => {
    const layoutRoot = node('layout');
    const content = node('layout-content');
    layoutRoot.content = content;
    layoutRoot.appendChild(content);
    let navFetches = 0;
    let userFetches = 0;
    const data = createStash({
      nav: source({ fetch: async () => { navFetches += 1; return { ok: true }; } }),
      user: source({ fetch: async () => { userFetches += 1; return { name: 'Ada' }; } }),
    });
    class Layout extends __Component {
      static __gates = ['nav'];
      _init() { this.nav = __gateBind(this, 0); }
      _create() { return layoutRoot; }
    }
    class A extends __Component { _create() { return node('a'); } }
    class B extends __Component {
      static __gates = ['user'];
      _init() { this.user = __gateBind(this, 0); }
      _create() { return node('b'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'a.rip': { A }, 'b.rip': { B } }),
      target: node('host'),
    });
    await renderer.mount(route('a.rip', { layouts: ['layout.rip'] }));
    expect(navFetches).toBe(1);
    renderer.preload(route('b.rip', { layouts: ['layout.rip'] }));
    await Bun.sleep(0);
    expect(userFetches).toBe(1);
    expect(navFetches).toBe(1);
  });

  test('an unmounted layout chain warms layouts and page together', async () => {
    const layoutRoot = node('layout');
    let navFetches = 0;
    let userFetches = 0;
    const data = createStash({
      nav: source({ fetch: async () => { navFetches += 1; return { ok: true }; } }),
      user: source({ fetch: async () => { userFetches += 1; return { name: 'Ada' }; } }),
    });
    class Layout extends __Component {
      static __gates = ['nav'];
      _init() { this.nav = __gateBind(this, 0); }
      _create() { return layoutRoot; }
    }
    class B extends __Component {
      static __gates = ['user'];
      _init() { this.user = __gateBind(this, 0); }
      _create() { return node('b'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'layout.rip': { Layout }, 'b.rip': { B } }),
      target: node('host'),
    });
    renderer.preload(route('b.rip', { layouts: ['layout.rip'] }));
    await Bun.sleep(0);
    expect(navFetches).toBe(1);
    expect(userFetches).toBe(1);
  });

  test('a preload failure never surfaces', async () => {
    const data = createStash({
      user: source({ fetch: async () => { throw new Error('down'); } }),
    });
    class Page extends __Component {
      static __gates = ['user'];
      _init() { this.user = __gateBind(this, 0); }
      _create() { return node('page'); }
    }
    class Bare extends __Component {
      static __gates = ['missing.cell'];
      _init() { this.value = __gateBind(this, 0); }
      _create() { return node('bare'); }
    }
    const renderer = createRenderer({
      router: { current: null },
      app: { data },
      components: registry({ 'page.rip': { Page }, 'bare.rip': { Bare } }),
      target: target(),
    });
    expect(() => renderer.preload(route('page.rip'))).not.toThrow();
    expect(() => renderer.preload(route('bare.rip'))).not.toThrow();
    expect(() => renderer.preload(route('unregistered.rip'))).not.toThrow();
    await Bun.sleep(0);
    expect(unwrapStash(data).user.error).toBeInstanceOf(Error);
  });
});
