import { describe, expect, test } from 'bun:test';
import {
  createComponents,
  createRenderer,
  createStash,
} from 'rip/app';
import { __Component, __hmrEvents } from '../../../src/runtime/components.js';

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

const liveRenderer = (entries, info) => {
  const router = { current: info, navigating: false };
  const renderer = createRenderer({
    router,
    stash: createStash({}),
    components: registry(entries),
    target: target(),
  });
  return { router, renderer };
};

describe('renderer remountDirty', () => {
  test('returns noop for empty paths and when no route is live', async () => {
    class Page extends __Component {
      _create() { return null; }
    }
    const info = route('page.rip');
    const { renderer } = liveRenderer({ 'page.rip': { Page } }, info);

    expect(await renderer.remountDirty([])).toBe('noop');
    expect(await renderer.remountDirty(null)).toBe('noop');
    expect(await renderer.remountDirty(undefined)).toBe('noop');
    expect(await renderer.remountDirty('page.rip')).toBe('noop');
    expect(await renderer.remountDirty(['page.rip'])).toBe('noop');

    await renderer.mount(info);
    renderer.stop();
    expect(await renderer.remountDirty(['page.rip'])).toBe('noop');
  });

  test('escapes stash and data paths before the live-route guard', async () => {
    class Page extends __Component {
      _create() { return null; }
    }
    const info = route('page.rip');
    const { renderer } = liveRenderer({ 'page.rip': { Page } }, null);

    expect(await renderer.remountDirty(['stash.rip'])).toBe('escape');
    expect(await renderer.remountDirty(['stash/foo.rip'])).toBe('escape');
    expect(await renderer.remountDirty(['seed.rip'])).toBe('escape');
    expect(await renderer.remountDirty(['page.rip', 'stash.rip'])).toBe('escape');

    await renderer.mount(info);
    renderer.stop();
    expect(await renderer.remountDirty(['stash/cart.rip'])).toBe('escape');
    expect(await renderer.remountDirty(['seed.rip'])).toBe('escape');
  });

  test('narrow-remounts when the live page file is dirty', async () => {
    let pages = 0;
    class Page extends __Component {
      _init() { pages++; }
      _create() { return null; }
    }
    const info = route('page.rip');
    const { renderer } = liveRenderer({ 'page.rip': { Page } }, info);

    await renderer.mount(info);
    expect(pages).toBe(1);
    const first = renderer.current;

    expect(await renderer.remountDirty(['page.rip'])).toBe('narrow');
    expect(pages).toBe(2);
    expect(renderer.current).toBeInstanceOf(Page);
    expect(renderer.current).not.toBe(first);
  });

  test('narrow-remounts from the first dirty layout down through the page', async () => {
    let layouts = 0;
    let pages = 0;
    class Layout extends __Component {
      _init() { layouts++; }
      _create() { return node('layout'); }
    }
    class Page extends __Component {
      _init() { pages++; }
      _create() { return node('page'); }
    }
    const info = route('page.rip', { layouts: ['layout.rip'] });
    const { renderer } = liveRenderer({
      'layout.rip': { Layout },
      'page.rip': { Page },
    }, info);

    await renderer.mount(info);
    expect(layouts).toBe(1);
    expect(pages).toBe(1);
    const firstLayout = renderer.current._parent;
    const firstPage = renderer.current;

    expect(await renderer.remountDirty(['layout.rip'])).toBe('narrow');
    expect(layouts).toBe(2);
    expect(pages).toBe(2);
    expect(renderer.current).not.toBe(firstPage);
    expect(renderer.current._parent).not.toBe(firstLayout);
    expect(renderer.current._parent).toBeInstanceOf(Layout);
  });

  test('a module without HMR-identified components and no living instance is a noop', async () => {
    let layouts = 0;
    let pages = 0;
    class Layout extends __Component {
      _init() { layouts++; }
      _create() { return node('layout'); }
    }
    class Page extends __Component {
      _init() { pages++; }
      _create() { return node('page'); }
    }
    const info = route('page.rip', { layouts: ['layout.rip'] });
    const { renderer } = liveRenderer({
      'layout.rip': { Layout },
      'page.rip': { Page },
      'shared/format.rip': { format: (value) => String(value) },
    }, info);

    await renderer.mount(info);
    expect(layouts).toBe(1);
    expect(pages).toBe(1);

    // A helper reaches the page only through importers, and the dirty
    // set carries those; alone it touches nothing mounted.
    expect(await renderer.remountDirty(['shared/format.rip'])).toBe('noop');
    expect(layouts).toBe(1);
    expect(pages).toBe(1);
  });

  test('a mounted chain entry without HMR identity takes the floor', async () => {
    let pages = 0;
    class Page extends __Component {
      _init() { pages++; }
      _create() { return node('page'); }
    }
    const info = route('plain/page.rip');
    const { renderer } = liveRenderer({ 'plain/page.rip': { Page } }, info);

    await renderer.mount(info);
    expect(await renderer.remountDirty(['plain/page.rip'])).toBe('narrow');
    expect(pages).toBe(2);
    renderer.stop();
  });

  // HMR-identified modules account for their own living instances: a
  // dirty set with none leaves the mounted page alone.
  const sig = (over = {}) => ({ shape: 'x', impl: 'y', state: [], computed: [], props: [], gates: 0, extends: null, ...over });

  test('a dirty module with HMR identity and no living instance is a noop', async () => {
    let pages = 0;
    class Page extends __Component {
      static __hmrId = 'noop/page.rip#Page';
      static __hmrSig = sig();
      _init() { pages++; }
      _create() { return node('page'); }
    }
    class Orders extends __Component {
      static __hmrId = 'noop/orders.rip#Orders';
      static __hmrSig = sig();
      _create() { return node('orders'); }
    }
    const info = route('noop/page.rip');
    const { renderer } = liveRenderer({
      'noop/page.rip': { Page },
      'noop/orders.rip': { Orders },
    }, info);

    await renderer.mount(info);
    const mounted = renderer.current;
    const before = __hmrEvents().length;

    expect(await renderer.remountDirty(['noop/orders.rip'])).toBe('noop');
    expect(pages).toBe(1);
    expect(renderer.current).toBe(mounted);
    const events = __hmrEvents().slice(before);
    expect(events.map(event => event.type)).toEqual(['noop']);
    expect(events[0].paths).toEqual(['noop/orders.rip']);
    renderer.stop();
  });

  test('a deleted module with no living instance is a noop', async () => {
    let pages = 0;
    class Page extends __Component {
      static __hmrId = 'gone/page.rip#Page';
      static __hmrSig = sig();
      _init() { pages++; }
      _create() { return node('page'); }
    }
    const info = route('gone/page.rip');
    const { renderer } = liveRenderer({ 'gone/page.rip': { Page } }, info);

    await renderer.mount(info);
    // The registry holds no such path: it reads as deleted.
    expect(await renderer.remountDirty(['gone/orders.rip'])).toBe('noop');
    expect(pages).toBe(1);
    renderer.stop();
  });

  test('a living shared child whose signature forbids a patch remounts the page', async () => {
    let pages = 0;
    class Page extends __Component {
      static __hmrId = 'live/page.rip#Page';
      static __hmrSig = sig();
      _init() { pages++; }
      _create() { return node('page'); }
    }
    class Widget extends __Component {
      static __hmrId = 'live/widget.rip#Widget';
      static __hmrSig = sig();
      _create() { return node('widget'); }
    }
    class WidgetNext extends __Component {
      static __hmrId = 'live/widget.rip#Widget';
      static __hmrSig = sig({ props: ['label'] });
      _create() { return node('widget'); }
    }
    const info = route('live/page.rip');
    const components = registry({ 'live/page.rip': { Page }, 'live/widget.rip': { Widget } });
    const router = { current: info, navigating: false };
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
    });

    await renderer.mount(info);
    const widget = new Widget({}).mount(node('host'));
    components.setCompiled('live/widget.rip', { Widget: WidgetNext });

    expect(await renderer.remountDirty(['live/widget.rip'])).toBe('narrow');
    expect(pages).toBe(2);
    widget.unmount();
    renderer.stop();
  });

  test('uses the candidate registry for the remounted modules', async () => {
    class LivePage extends __Component {
      _create() { return null; }
    }
    class StagedPage extends __Component {
      _create() { return null; }
    }
    const info = route('page.rip');
    const components = registry({ 'page.rip': { LivePage } });
    const candidate = registry({ 'page.rip': { StagedPage } });
    const router = { current: info, navigating: false };
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
    });

    await renderer.mount(info);
    expect(renderer.current).toBeInstanceOf(LivePage);

    expect(await renderer.remountDirty(['page.rip'], candidate)).toBe('narrow');
    expect(renderer.current).toBeInstanceOf(StagedPage);
  });

  test('rethrows a remount mount failure', async () => {
    class Page extends __Component {
      _create() { return null; }
    }
    class Boom extends __Component {
      _init() { throw new Error('remount boom'); }
      _create() { return null; }
    }
    const info = route('page.rip');
    const components = registry({ 'page.rip': { Page } });
    const router = { current: info, navigating: false };
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
    });

    await renderer.mount(info);
    components.setCompiled('page.rip', { Boom });

    const failure = await renderer.remountDirty(['page.rip']).catch(error => error);
    expect(failure).toMatchObject({
      name: 'GateFailure',
      message: 'remount boom',
      file: 'page.rip',
    });
    expect(renderer.current).toBeInstanceOf(Page);
  });

  test('returns reload when committed teardown fails', async () => {
    class Fragile extends __Component {
      _create() { return null; }
      unmount() { throw new Error('old teardown'); }
    }
    class Next extends __Component {
      _create() { return null; }
    }
    const info = route('page.rip');
    const components = registry({ 'page.rip': { Fragile } });
    const router = { current: info, navigating: false };
    const failures = [];
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
      onError: failure => failures.push(failure),
    });

    await renderer.mount(info);
    components.setCompiled('page.rip', { Next });

    expect(await renderer.remountDirty(['page.rip'])).toBe('reload');
    expect(renderer.current).toBeInstanceOf(Next);
    expect(failures.at(-1)).toMatchObject({
      path: '<teardown>',
      file: '<renderer>',
      message: 'old teardown',
    });
  });

  // A dirty set with no living instance is idle only while the current
  // route is the mounted one. After a navigation whose mount failed the
  // previous screen is still up, and the fix to the failed route must
  // mount it rather than be ignored.
  test('the fix to a route whose mount failed mounts it instead of reading as idle', async () => {
    class A extends __Component {
      static __hmrId = 'retry/a.rip#A';
      static __hmrSig = sig();
      _create() { return node('a'); }
    }
    class Broken extends __Component {
      static __hmrId = 'retry/b.rip#B';
      static __hmrSig = sig();
      _create() { throw new Error('not yet'); }
    }
    class Fixed extends __Component {
      static __hmrId = 'retry/b.rip#B';
      static __hmrSig = sig();
      _create() { return node('b'); }
    }
    const a = route('retry/a.rip');
    const b = route('retry/b.rip');
    const components = registry({ 'retry/a.rip': { A }, 'retry/b.rip': { B: Broken } });
    const router = { current: a, navigating: false };
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
    });

    await renderer.mount(a);
    router.current = b;
    await expect(renderer.mount(b)).rejects.toMatchObject({ message: 'not yet' });
    expect(renderer.current).toBeInstanceOf(A);

    components.setCompiled('retry/b.rip', { B: Fixed });
    expect(await renderer.remountDirty(['retry/b.rip'])).toBe('narrow');
    expect(renderer.current).toBeInstanceOf(Fixed);
    renderer.stop();
  });

  test('a chain entry left failed by an earlier round takes the floor on the fix', async () => {
    class Page extends __Component {
      static __hmrId = 'failed/page.rip#Page';
      static __hmrSig = sig();
      _create() { return node('page'); }
    }
    class Breaks extends __Component {
      static __hmrId = 'failed/page.rip#Page';
      static __hmrSig = sig();
      _create() { throw new Error('broken render'); }
    }
    class Mended extends __Component {
      static __hmrId = 'failed/page.rip#Page';
      static __hmrSig = sig();
      _create() { return node('mended'); }
    }
    const info = route('failed/page.rip');
    const components = registry({ 'failed/page.rip': { Page } });
    const router = { current: info, navigating: false };
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
    });

    await renderer.mount(info);
    components.setCompiled('failed/page.rip', { Page: Breaks });
    // The patch fails, then the floor fails: the chain keeps a failed instance.
    await expect(renderer.remountDirty(['failed/page.rip'])).rejects.toBeDefined();
    expect(renderer.current._state).toBe('failed');

    components.setCompiled('failed/page.rip', { Page: Mended });
    expect(await renderer.remountDirty(['failed/page.rip'])).toBe('narrow');
    expect(renderer.current).toBeInstanceOf(Mended);
    expect(renderer.current._state).toBe('mounted');
    renderer.stop();
  });

  test('a registered instance that was never mounted takes the floor', async () => {
    let pages = 0;
    class Modal extends __Component {
      static __hmrId = 'held/modal.rip#Modal';
      static __hmrSig = sig();
      _create() { return node('modal'); }
    }
    class ModalNext extends __Component {
      static __hmrId = 'held/modal.rip#Modal';
      static __hmrSig = sig();
      _create() { return node('modal-next'); }
    }
    let held = null;
    class Page extends __Component {
      static __hmrId = 'held/page.rip#Page';
      static __hmrSig = sig();
      _init() { pages++; held = new Modal({}); }
      _create() { return node('page'); }
    }
    const info = route('held/page.rip');
    const components = registry({ 'held/page.rip': { Page }, 'held/modal.rip': { Modal } });
    const router = { current: info, navigating: false };
    const renderer = createRenderer({
      router,
      stash: createStash({}),
      components,
      target: target(),
    });

    await renderer.mount(info);
    expect(held._state).toBe('new');
    components.setCompiled('held/modal.rip', { Modal: ModalNext });
    expect(await renderer.remountDirty(['held/modal.rip'])).toBe('narrow');
    expect(pages).toBe(2);
    renderer.stop();
  });
});
