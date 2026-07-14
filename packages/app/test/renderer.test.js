import { describe, expect, test } from 'bun:test';
import {
  createComponents,
  createRenderer,
  createStash,
  source,
} from '@rip-lang/app';
import { __state } from '../../../src/runtime/reactive.js';
import {
  __Component,
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
