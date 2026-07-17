import { test, expect } from 'bun:test';
import { BasicEmail, lifecycle } from './fixtures/basic-email.rip';
import { toEmail, toHTML, toText } from '../email/render.rip';
import { _renderComponent } from '../shared/render.rip';

test('email SSR mounts, serializes, disposes, and restores globals', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousDocument = globalThis.document;
  lifecycle.length = 0;

  const html = toHTML(BasicEmail, { message: 'welcome' });
  expect(html).toContain('<!DOCTYPE');
  expect(html).toContain('<h1>Title</h1>');
  expect(html).toContain('<p>welcome</p>');
  expect(lifecycle).toEqual(['effect', 'cleanup']);

  expect(toText(BasicEmail, { message: 'plain' })).toBe('Title\n\nplain');
  expect(toEmail(BasicEmail, { message: 'both' })).toEqual({
    html: expect.stringContaining('<p>both</p>'),
    text: 'Title\n\nboth',
  });

  expect(Object.hasOwn(globalThis, 'document')).toBe(hadDocument);
  expect(globalThis.document).toBe(previousDocument);
});

test('email SSR rejects nested render ownership', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousDocument = globalThis.document;
  globalThis.document = { __ripRenderActive: true };
  try {
    expect(() => toHTML(BasicEmail)).toThrow(/nested or concurrent Rip SSR/);
  } finally {
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});

test('email SSR restores exact globals when teardown throws', () => {
  const keys = ['document', 'Node', 'SVGElement'];
  const before = new Map(keys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));

  class BadCleanup {
    constructor() {
      this._state = 'new';
    }

    mount() {
      this._state = 'mounted';
    }

    unmount() {
      throw new Error('cleanup boom');
    }
  }

  expect(() => _renderComponent(BadCleanup, {}, () => 'unused'))
    .toThrow('cleanup boom');
  for (const key of keys) {
    expect(Object.getOwnPropertyDescriptor(globalThis, key)).toEqual(before.get(key));
  }
});

test('email SSR preserves accessor-backed global descriptors', () => {
  const keys = ['document', 'Node', 'SVGElement'];
  const before = new Map(keys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const sentinel = {};
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    enumerable: false,
    get: () => sentinel,
    set: () => {
      throw new Error('Node assignment blocked');
    },
  });
  const expected = Object.getOwnPropertyDescriptor(globalThis, 'Node');

  class Clean {
    constructor() {
      this._state = 'new';
    }

    mount() {
      this._state = 'mounted';
    }

    unmount() {
      this._state = 'unmounted';
    }
  }

  try {
    expect(_renderComponent(Clean, {}, () => 'done')).toBe('done');
    expect(Object.getOwnPropertyDescriptor(globalThis, 'Node')).toEqual(expected);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'document')).toEqual(before.get('document'));
    expect(Object.getOwnPropertyDescriptor(globalThis, 'SVGElement')).toEqual(before.get('SVGElement'));
  } finally {
    for (const key of keys) {
      const descriptor = before.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('email SSR rolls back a genuine partial global install', () => {
  const renderUrl = new URL('../shared/render.rip', import.meta.url).href;
  const source = `
    import { _renderComponent } from ${JSON.stringify(renderUrl)};
    Object.defineProperty(globalThis, 'Node', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: 'sentinel',
    });
    try {
      _renderComponent(class {}, {}, () => 'unused');
    } catch (error) {
      console.log(
        Object.hasOwn(globalThis, 'document'),
        globalThis.Node,
        error instanceof TypeError,
      );
    }
  `;
  // The child is a bare `bun -e`, so the .rip import compiles only if a
  // bunfig preload is visible from its cwd. Per-package bunfigs are gone
  // (the repo root's is the one loader config), so spawn from the root.
  const result = Bun.spawnSync(['bun', '-e', source], {
    cwd: new URL('../../..', import.meta.url).pathname,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe('false sentinel true');
});
