import { describe, expect, test } from 'bun:test';
import { createStash, persistStash, source, unwrapStash } from 'rip/app';

const fakeStorage = (initial = {}) => {
  const table = new Map(Object.entries(initial));
  return {
    getItem: key => (table.has(key) ? table.get(key) : null),
    setItem(key, value) { table.set(key, String(value)); },
    removeItem(key) { table.delete(key); },
    table,
  };
};

describe('persistStash', () => {
  test('outside a browser an injected storage is required', () => {
    const stash = createStash({ n: 1 });
    expect(() => persistStash(stash)).toThrow(/injected storage/);
  });

  test('saves plain keys after the debounce, skipping sources at depth', async () => {
    const storage = fakeStorage();
    const stash = createStash({
      count: 1,
      nested: { user: source({ fetch: async () => ({ id: 1 }) }), label: 'x' },
    });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.count = 2;
    await Bun.sleep(30);
    const saved = JSON.parse(storage.table.get('__rip_app'));
    expect(saved.count).toBe(2);
    expect(saved.nested.label).toBe('x');
    expect('user' in saved.nested).toBeFalse();
    dispose();
  });

  test('restore merges saved plain values and leaves live cells alone', () => {
    const storage = fakeStorage({
      __rip_app: JSON.stringify({ count: 7, nested: { label: 'saved', user: { id: 9 } } }),
    });
    const stash = createStash({
      count: 0,
      nested: { user: source({ fetch: async () => ({ id: 1 }) }), label: 'x' },
    });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    expect(stash.count).toBe(7);
    expect(stash.nested.label).toBe('saved');
    const raw = unwrapStash(stash);
    expect(typeof raw.nested.user.read).toBe('function');
    dispose();
  });

  test('a double call is a no-op with a harmless disposer', () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const first = persistStash(stash, { storage, debounce: 5 });
    const second = persistStash(stash, { storage, debounce: 5 });
    expect(second()).toBeNull();
    first();
  });

  test('dispose flushes a final save', () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 60000 });
    stash.n = 42;
    dispose();
    expect(JSON.parse(storage.table.get('__rip_app')).n).toBe(42);
  });

  test('reset purges the persisted snapshot', async () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 5 });
    stash.n = 2;
    await Bun.sleep(20);
    expect(storage.table.has('__rip_app')).toBeTrue();
    stash.reset();
    expect(storage.table.has('__rip_app')).toBeFalse();
    dispose();
  });
});

describe('persistStash reconciliation', () => {
  test('a saved key over a live singleton is skipped without a write or a fetch', async () => {
    let fetches = 0;
    const storage = fakeStorage({
      __rip_app: JSON.stringify({ user: { id: 9, stale: true } }),
    });
    const stash = createStash({ user: source({ fetch: async () => { fetches += 1; return { id: 1 }; } }) });
    const dispose = persistStash(stash, { storage, debounce: 5 });
    const raw = unwrapStash(stash);
    expect(raw.user.peek()).toBeNull();
    expect(fetches).toBe(0);
    dispose();
  });

  test('a delete saves after the debounce', async () => {
    const storage = fakeStorage();
    const stash = createStash({ x: 1, y: 2 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.x = 1;
    await Bun.sleep(25);
    delete stash.y;
    await Bun.sleep(25);
    expect(JSON.parse(storage.table.get('__rip_app'))).toEqual({ x: 1 });
    dispose();
  });

  test('a purge stays purged past the debounce window', async () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.n = 2;
    await Bun.sleep(25);
    stash.reset();
    await Bun.sleep(30);
    expect(storage.table.has('__rip_app')).toBeFalse();
    dispose();
  });

  test('an untouched stash never writes storage', async () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    await Bun.sleep(30);
    expect(storage.table.has('__rip_app')).toBeFalse();
    dispose();
  });

  test('an array holding a live cell is never restored over', () => {
    const storage = fakeStorage({
      __rip_app: JSON.stringify({ list: [null, 'saved'] }),
    });
    const stash = createStash({ list: [source({ fetch: async () => ({ id: 1 }) }), 'a'] });
    const dispose = persistStash(stash, { storage, debounce: 5 });
    const raw = unwrapStash(stash);
    expect(typeof raw.list[0].read).toBe('function');
    expect(raw.list[1]).toBe('a');
    dispose();
  });
});
