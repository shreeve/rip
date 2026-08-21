// UI restore across a refresh: the focused element is replaced by the
// rebuilt view, so focus comes back by locator (id, else the element
// path from document.body), selection rides along, and scroll is put
// back first and never moved by the focus. A hand-rolled document is the
// instrument — the recording DOM models no focus at all.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { __hmrRestoreUi, __hmrSnapshotUi } from '../../src/runtime/components.js';

let doc;
let win;
const saved = {};

const element = (tagName, { id = '', children = [], value = '' } = {}) => {
  const el = {
    tagName,
    id,
    value,
    children,
    parentElement: null,
    isConnected: true,
    focusCalls: [],
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: 'none',
    focus(options) {
      this.focusCalls.push(options);
      doc.activeElement = this;
    },
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
  };
  for (const child of children) child.parentElement = el;
  return el;
};

const detach = (el) => {
  const walk = (node) => {
    node.isConnected = false;
    for (const child of node.children) walk(child);
  };
  walk(el);
  const siblings = el.parentElement.children;
  siblings.splice(siblings.indexOf(el), 1);
  el.parentElement = null;
};

const attach = (parent, el, index = parent.children.length) => {
  parent.children.splice(index, 0, el);
  el.parentElement = parent;
};

const installDocument = () => {
  const body = element('BODY');
  doc = {
    body,
    documentElement: element('HTML', { children: [body] }),
    activeElement: body,
    contains(node) {
      for (let at = node; at; at = at.parentElement) if (at === body) return true;
      return false;
    },
    getElementById(id) {
      const walk = (node) => {
        for (const child of node.children) {
          if (child.id === id) return child;
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      return walk(body);
    },
  };
  win = { scrollX: 40, scrollY: 300, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; this.calls.push([x, y]); }, calls: [] };
};

beforeEach(() => {
  saved.document = globalThis.document;
  saved.window = globalThis.window;
  installDocument();
  globalThis.document = doc;
  globalThis.window = win;
});

afterEach(() => {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
});

// body > main > form > [input, input]: the second input is focused.
const formPage = () => {
  const first = element('INPUT', { value: 'John' });
  const second = element('INPUT', { value: 'Smith' });
  const form = element('FORM', { children: [first, second] });
  const main = element('MAIN', { children: [form] });
  attach(doc.body, main);
  return { main, form, first, second };
};

describe('__hmrSnapshotUi / __hmrRestoreUi', () => {
  test('restores focus to the successor at the same element path after the view is replaced', () => {
    const { main, form, second } = formPage();
    second.focus();
    second.setSelectionRange(2, 4, 'forward');
    const snap = __hmrSnapshotUi();
    expect(snap.locator).toEqual({
      identity: { tag: 'INPUT', name: null, type: null, placeholder: null, label: null, value: 'Smith' },
      id: null,
      path: [0, 0, 1],
    });
    expect(snap.selection).toEqual({ start: 2, end: 4, direction: 'forward' });

    // The refresh: the form is rebuilt — new elements, same shape.
    detach(form);
    doc.activeElement = doc.body;
    const rebuilt = element('FORM', { children: [element('INPUT', { value: 'John' }), element('INPUT', { value: 'Smith' })] });
    attach(main, rebuilt);

    __hmrRestoreUi(snap);
    const successor = rebuilt.children[1];
    expect(doc.activeElement).toBe(successor);
    expect(successor).not.toBe(second);
    expect([successor.selectionStart, successor.selectionEnd, successor.selectionDirection]).toEqual([2, 4, 'forward']);
    // Scroll goes back first, and the focus does not move it.
    expect(win.calls).toEqual([[40, 300]]);
    expect(successor.focusCalls).toEqual([{ preventScroll: true }]);
  });

  test('prefers the id when the element has one, even after siblings shift', () => {
    const { main, form } = formPage();
    const named = element('INPUT', { id: 'email', value: 'a@b.c' });
    attach(form, named);
    named.focus();
    const snap = __hmrSnapshotUi();
    expect(snap.locator.id).toBe('email');

    detach(form);
    doc.activeElement = doc.body;
    const successor = element('INPUT', { id: 'email', value: 'a@b.c' });
    // A new sibling ahead of it: the path would now name the wrong node.
    const rebuilt = element('FORM', { children: [element('P'), element('INPUT'), element('INPUT'), successor] });
    attach(main, rebuilt);

    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(successor);
  });

  test('keeps focus on an element the refresh left connected', () => {
    const { second } = formPage();
    second.focus();
    const snap = __hmrSnapshotUi();
    doc.activeElement = doc.body;
    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(second);
  });

  test('focuses nothing when the successor at the path is a different kind of element', () => {
    const { main, form, second } = formPage();
    second.focus();
    const snap = __hmrSnapshotUi();

    detach(form);
    doc.activeElement = doc.body;
    const rebuilt = element('FORM', { children: [element('INPUT'), element('BUTTON')] });
    attach(main, rebuilt);

    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(doc.body);
    expect(win.calls).toEqual([[40, 300]]);
  });

  test('records no focus when nothing beyond the body is active', () => {
    formPage();
    const snap = __hmrSnapshotUi();
    expect(snap.active).toBeNull();
    expect(snap.locator).toBeNull();
    expect(snap.selection).toBeNull();
    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(doc.body);
  });

  // Identity, not position, decides: the path names a different field
  // once the edit inserted one ahead of the focused input.
  test('follows the field by identity and value when an element is inserted ahead of it', () => {
    const { main, form, second } = formPage();
    second.focus();
    const snap = __hmrSnapshotUi();

    detach(form);
    doc.activeElement = doc.body;
    const inserted = element('INPUT', { value: '' });
    const successor = element('INPUT', { value: 'Smith' });
    const rebuilt = element('FORM', { children: [element('INPUT', { value: 'John' }), inserted, successor] });
    attach(main, rebuilt);

    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(successor);
    expect(inserted.focusCalls).toEqual([]);
  });

  test('focuses nothing when the path misses and several siblings carry the same identity and value', () => {
    const { main, form, second } = formPage();
    second.focus();
    const snap = __hmrSnapshotUi();

    detach(form);
    doc.activeElement = doc.body;
    const rebuilt = element('FORM', { children: [
      element('INPUT', { value: 'Smith' }), element('P'), element('INPUT', { value: 'Smith' }),
    ] });
    attach(main, rebuilt);

    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(doc.body);
  });

  test('falls back to the path when the id now sits on a different kind of element', () => {
    const { main, form } = formPage();
    const named = element('INPUT', { id: 'q', value: 'x' });
    attach(form, named);
    named.focus();
    const snap = __hmrSnapshotUi();
    expect(snap.locator.id).toBe('q');

    detach(form);
    doc.activeElement = doc.body;
    const successor = element('INPUT', { value: 'x' });
    const rebuilt = element('FORM', { children: [element('INPUT', { value: 'John' }), element('INPUT', { value: 'Smith' }), successor] });
    attach(main, rebuilt);
    attach(main, element('DIV', { id: 'q' }));

    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(successor);
  });

  test('does not let a same-tag field with a different name claim the focus', () => {
    const { main, form } = formPage();
    const named = element('INPUT', { value: 'x' });
    named.name = 'email';
    attach(form, named);
    named.focus();
    const snap = __hmrSnapshotUi();
    expect(snap.locator.identity.name).toBe('email');

    detach(form);
    doc.activeElement = doc.body;
    const impostor = element('INPUT', { value: 'x' });
    impostor.name = 'phone';
    const rebuilt = element('FORM', { children: [element('INPUT', { value: 'John' }), element('INPUT', { value: 'Smith' }), impostor] });
    attach(main, rebuilt);

    __hmrRestoreUi(snap);
    expect(doc.activeElement).toBe(doc.body);
  });
});
