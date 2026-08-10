import { describe, expect, test } from 'bun:test';
import {
  createComponents,
  createRenderer,
  createStash,
} from 'rip/app';
import { __Component } from '../../../src/runtime/components.js';

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
    app: { data: createStash({}) },
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
    expect(await renderer.remountDirty(['data.rip'])).toBe('escape');
    expect(await renderer.remountDirty(['page.rip', 'stash.rip'])).toBe('escape');

    await renderer.mount(info);
    renderer.stop();
    expect(await renderer.remountDirty(['stash/cart.rip'])).toBe('escape');
    expect(await renderer.remountDirty(['data.rip'])).toBe('escape');
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

  test('a shared child path outside the chain still remounts only the page', async () => {
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
    const keptLayout = renderer.current._parent;

    expect(await renderer.remountDirty(['shared/widget.rip'])).toBe('narrow');
    expect(layouts).toBe(1);
    expect(pages).toBe(2);
    expect(renderer.current._parent).toBe(keptLayout);
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
      app: { data: createStash({}) },
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
      app: { data: createStash({}) },
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
      app: { data: createStash({}) },
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
});
