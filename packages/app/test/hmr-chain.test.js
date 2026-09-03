// A patched layout keeps its descendants: the layout's view is rebuilt
// with a fresh page slot, and the route below it — instance, DOM, and
// state — is reseated into that slot, so the page stays visible and the
// next navigation commits into the live slot, not the detached one.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createComponents, createRenderer, createStash } from 'rip/app';
import { __Component, __hmrEvents } from '../../../src/runtime/components.js';
import { installRecordingDOM } from '../../../test/support/recording-dom.js';

// The suite shares one process: the recording DOM is installed for this
// file only, and every global it sets is put back afterwards.
const globals = ['document', 'requestAnimationFrame', 'Node', 'SVGElement'];
const saved = Object.fromEntries(globals.map(name => [name, globalThis[name]]));
beforeAll(() => { installRecordingDOM(); });
afterAll(() => {
  for (const name of globals) {
    if (saved[name] === undefined) delete globalThis[name];
    else globalThis[name] = saved[name];
  }
});

const sig = (over = {}) => ({ shape: 'x', impl: 'y', state: [], computed: [], props: [], gates: 0, extends: null, ...over });

// A layout shaped like the App convention: a root with a `#content` page
// slot inside it. The recording DOM has no element querySelector, so the
// root answers the slot lookup itself.
const layoutClass = (generation) => class Layout extends __Component {
  static __hmrId = 'chain/layout.rip#Layout';
  static __hmrSig = sig();
  _create() {
    const root = document.createElement('div');
    root.setAttribute('data-generation', String(generation));
    const slot = document.createElement('div');
    slot.setAttribute('id', 'content');
    root.appendChild(slot);
    root.querySelector = (selector) => (selector === '#content' ? slot : null);
    return root;
  }
};

const pageClass = (id, text) => class Page extends __Component {
  static __hmrId = id;
  static __hmrSig = sig();
  _create() {
    const el = document.createElement('section');
    el.textContent = text;
    return el;
  }
};

const route = (file, layouts) => ({ route: { file }, layouts, params: {}, query: {} });

const registry = entries => {
  const components = createComponents();
  for (const [file, module] of Object.entries(entries)) {
    components.write(file, 'stub');
    components.setCompiled(file, module);
  }
  return components;
};

describe('layout patch reseats the route below it', () => {
  test('the page keeps its instance and DOM inside the rebuilt slot, and navigation lands there', async () => {
    const Page = pageClass('chain/page.rip#Page', 'page');
    const Other = pageClass('chain/other.rip#Other', 'other');
    const components = registry({
      'chain/layout.rip': { Layout: layoutClass(1) },
      'chain/page.rip': { Page },
      'chain/other.rip': { Other },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const info = route('chain/page.rip', ['chain/layout.rip']);
    const router = { current: info, navigating: false };
    const renderer = createRenderer({ router, stash: createStash({}), components, target });

    await renderer.mount(info);
    const page = renderer.current;
    const oldRoot = target.childNodes[0];
    const oldSlot = oldRoot.querySelector('#content');
    expect(page._root.parentNode).toBe(oldSlot);
    // What a top-level block mounts after the create phase: siblings
    // after the page's own nodes, owned by the page but not in `_nodes`.
    const blockNodes = [document.createElement('article'), document.createElement('article')];
    for (const node of blockNodes) oldSlot.appendChild(node);
    expect(page._nodes ?? [page._root]).not.toContain(blockNodes[0]);

    components.setCompiled('chain/layout.rip', { Layout: layoutClass(2) });
    const before = __hmrEvents().length;
    expect(await renderer.remountDirty(['chain/layout.rip'])).toBe('narrow');
    const events = __hmrEvents().slice(before).map(event => event.type);
    expect(events).toContain('patch');
    expect(events).not.toContain('remount');

    // The layout view was rebuilt in place...
    expect(target.childNodes).toHaveLength(1);
    const newRoot = target.childNodes[0];
    expect(newRoot).not.toBe(oldRoot);
    expect(newRoot.getAttribute('data-generation')).toBe('2');
    const newSlot = newRoot.querySelector('#content');
    expect(newSlot).not.toBe(oldSlot);

    // ...and the page — same instance, same DOM, block-mounted siblings
    // included, in order — lives in the new slot.
    expect(renderer.current).toBe(page);
    expect(page._root.parentNode).toBe(newSlot);
    expect(oldSlot.childNodes).toHaveLength(0);
    expect(newSlot.childNodes).toEqual([page._root, ...blockNodes]);

    // The next navigation keeps the layout and commits into the live slot.
    // (A block's own teardown removes its nodes when the page unmounts;
    // these stand-ins have no block, so the test removes them.)
    for (const node of blockNodes) node.remove();
    const next = route('chain/other.rip', ['chain/layout.rip']);
    router.current = next;
    await renderer.mount(next);
    expect(renderer.current).toBeInstanceOf(Other);
    expect(renderer.current._root.parentNode).toBe(newSlot);
    expect(newSlot.childNodes).toEqual([renderer.current._root]);
    expect(target.childNodes).toEqual([newRoot]);

    renderer.stop();
    target.remove();
  });

  // A top-level `for` mounts its rows BEFORE its anchor, so a page that
  // begins with one has rows ahead of its first create-phase node. The
  // reseat moves what the page owns in the slot, not what its create
  // phase produced.
  test('rows a top-level for mounted ahead of the page\'s anchor move too', async () => {
    class ListPage extends __Component {
      static __hmrId = 'chain/list.rip#ListPage';
      static __hmrSig = sig();
      _create() {
        const frag = document.createDocumentFragment();
        this._anchor = document.createComment('for');
        frag.appendChild(this._anchor);
        const h1 = document.createElement('h1');
        h1.textContent = 'list';
        frag.appendChild(h1);
        this._nodes = [...frag.childNodes];
        return frag;
      }
      _setup() {
        // What __reconcile does on first mount: rows go before the anchor.
        for (const name of ['a', 'b']) {
          const row = document.createElement('article');
          row.textContent = name;
          this._anchor.parentNode.insertBefore(row, this._anchor);
        }
      }
    }
    const components = registry({
      'chain/layout.rip': { Layout: layoutClass(1) },
      'chain/list.rip': { ListPage },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const info = route('chain/list.rip', ['chain/layout.rip']);
    const router = { current: info, navigating: false };
    const renderer = createRenderer({ router, stash: createStash({}), components, target });

    await renderer.mount(info);
    const oldSlot = target.childNodes[0].querySelector('#content');
    const names = (slot) => slot.childNodes.map(node => node.nodeType === 8 ? '#' : node.textContent);
    expect(names(oldSlot)).toEqual(['a', 'b', '#', 'list']);

    components.setCompiled('chain/layout.rip', { Layout: layoutClass(2) });
    expect(await renderer.remountDirty(['chain/layout.rip'])).toBe('narrow');
    const newSlot = target.childNodes[0].querySelector('#content');
    expect(newSlot).not.toBe(oldSlot);
    expect(names(newSlot)).toEqual(['a', 'b', '#', 'list']);
    expect(oldSlot.childNodes).toHaveLength(0);

    renderer.stop();
    target.remove();
  });

  // A layout route file that re-exports a component defined elsewhere is
  // found through the registry under the other file's prefix; it is still
  // a chain entry, and its descendants still reseat.
  test('a layout re-exported from another module reseats the page after a patch', async () => {
    const shell = (generation) => {
      const Shell = layoutClass(generation);
      Object.defineProperty(Shell, '__hmrId', { value: 'chain/shell.rip#Shell' });
      return Shell;
    };
    const Page = pageClass('chain/page.rip#Page', 'page');
    const components = registry({
      'chain/shell.rip': { Shell: shell(1) },
      'chain/layout.rip': { Layout: shell(1) },
      'chain/page.rip': { Page },
    });
    // The route file re-exports the very same class.
    components.setCompiled('chain/layout.rip', { Layout: components.getCompiled('chain/shell.rip').Shell });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const info = route('chain/page.rip', ['chain/layout.rip']);
    const router = { current: info, navigating: false };
    const renderer = createRenderer({ router, stash: createStash({}), components, target });

    await renderer.mount(info);
    const page = renderer.current;
    const oldSlot = target.childNodes[0].querySelector('#content');

    const next = shell(2);
    components.setCompiled('chain/shell.rip', { Shell: next });
    components.setCompiled('chain/layout.rip', { Layout: next });
    expect(await renderer.remountDirty(['chain/shell.rip', 'chain/layout.rip'])).toBe('narrow');
    const newSlot = target.childNodes[0].querySelector('#content');
    expect(newSlot).not.toBe(oldSlot);
    expect(renderer.current).toBe(page);
    expect(page._root.parentNode).toBe(newSlot);

    renderer.stop();
    target.remove();
  });

  // The remount floor from a middle layout commits into the KEPT parent's
  // outlet, never into the slot of the layout being replaced.
  test('a forced remount of a middle layout lands inside the kept layout', async () => {
    const outer = (generation) => class Outer extends __Component {
      _create() {
        const root = document.createElement('div');
        root.setAttribute('data-outer', String(generation));
        const slot = document.createElement('div');
        slot.setAttribute('id', 'content');
        root.appendChild(slot);
        root.querySelector = (selector) => (selector === '#content' ? slot : null);
        return root;
      }
    };
    const inner = (generation) => class Inner extends __Component {
      _create() {
        const root = document.createElement('section');
        root.setAttribute('data-inner', String(generation));
        const slot = document.createElement('div');
        slot.setAttribute('id', 'content');
        root.appendChild(slot);
        root.querySelector = (selector) => (selector === '#content' ? slot : null);
        return root;
      }
    };
    class Page extends __Component {
      _create() { const el = document.createElement('p'); el.textContent = 'page'; return el; }
    }
    const components = registry({
      'chain/outer.rip': { Outer: outer(1) },
      'chain/inner.rip': { Inner: inner(1) },
      'chain/leaf.rip': { Page },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const info = route('chain/leaf.rip', ['chain/outer.rip', 'chain/inner.rip']);
    const router = { current: info, navigating: false };
    const renderer = createRenderer({ router, stash: createStash({}), components, target });

    await renderer.mount(info);
    const outerRoot = target.childNodes[0];
    const outerSlot = outerRoot.querySelector('#content');
    expect(outerSlot.childNodes[0].getAttribute('data-inner')).toBe('1');

    // No HMR identity on the classes: the inner layout's edit takes the floor.
    components.setCompiled('chain/inner.rip', { Inner: inner(2) });
    expect(await renderer.remountDirty(['chain/inner.rip'])).toBe('narrow');
    expect(target.childNodes).toEqual([outerRoot]);
    expect(outerSlot.childNodes).toHaveLength(1);
    const innerRoot = outerSlot.childNodes[0];
    expect(innerRoot.getAttribute('data-inner')).toBe('2');
    expect(innerRoot.querySelector('#content').childNodes[0].textContent).toBe('page');

    // And the next navigation commits into the rebuilt inner layout's outlet.
    const Other = pageClass('chain/other-leaf.rip#Other', 'other');
    components.write('chain/other-leaf.rip', 'stub');
    components.setCompiled('chain/other-leaf.rip', { Other });
    const next = route('chain/other-leaf.rip', ['chain/outer.rip', 'chain/inner.rip']);
    router.current = next;
    await renderer.mount(next);
    expect(innerRoot.querySelector('#content').childNodes.map(node => node.textContent)).toEqual(['other']);

    renderer.stop();
    target.remove();
  });
});
