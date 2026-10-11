import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { createStash, persistStash as basePersistStash, source, unwrapStash } from 'rip/app';

// Saving debounces through setTimeout, so on the host clock a stall
// between steps or a timer answered late moves the save. The fake clock
// advances only when a test advances it: every save is asserted at its
// exact millisecond, and a save that must not exist is counted.
//
// Every stash shares one write-version signal, so a persistence a failed
// test never disposed would schedule saves inside the tests after it.
// Whatever is still live disposes after each test (dispose is idempotent).
const live = [];
const persistStash = (stash, opts) => {
  const dispose = basePersistStash(stash, opts);
  live.push(dispose);
  return dispose;
};
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  for (const dispose of live.splice(0)) dispose();
  jest.useRealTimers();
});

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

  test('saves plain keys after the debounce, skipping sources at depth', () => {
    const storage = fakeStorage();
    const stash = createStash({
      count: 1,
      nested: { user: source({ fetch: async () => ({ id: 1 }) }), label: 'x' },
    });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.count = 2;
    jest.advanceTimersByTime(9);
    expect(storage.table.has('__rip_app')).toBeFalse();
    jest.advanceTimersByTime(1);
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

  test('reset purges the persisted snapshot', () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 5 });
    stash.n = 2;
    jest.advanceTimersByTime(4);
    expect(storage.table.has('__rip_app')).toBeFalse();
    jest.advanceTimersByTime(1);
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

  test('a delete saves after the debounce', () => {
    const storage = fakeStorage();
    const stash = createStash({ x: 1, y: 2 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.x = 1;
    jest.advanceTimersByTime(9);
    expect(storage.table.has('__rip_app')).toBeFalse();
    jest.advanceTimersByTime(1);
    expect(JSON.parse(storage.table.get('__rip_app'))).toEqual({ x: 1, y: 2 });
    jest.advanceTimersByTime(15);
    delete stash.y;
    jest.advanceTimersByTime(9);
    expect(JSON.parse(storage.table.get('__rip_app'))).toEqual({ x: 1, y: 2 });
    jest.advanceTimersByTime(1);
    expect(JSON.parse(storage.table.get('__rip_app'))).toEqual({ x: 1 });
    dispose();
  });

  test('a purge stays purged past the debounce window', () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.n = 2;
    jest.advanceTimersByTime(10);
    expect(storage.table.has('__rip_app')).toBeTrue();
    jest.advanceTimersByTime(15);
    stash.reset();
    expect(storage.table.has('__rip_app')).toBeFalse();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10);
    expect(storage.table.has('__rip_app')).toBeFalse();
    dispose();
  });

  test('a reset inside the debounce window cancels the pending save', () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    stash.n = 2;
    jest.advanceTimersByTime(5);
    stash.reset();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(5);
    expect(storage.table.has('__rip_app')).toBeFalse();
    dispose();
  });

  test('an untouched stash never writes storage', () => {
    const storage = fakeStorage();
    const stash = createStash({ n: 1 });
    const dispose = persistStash(stash, { storage, debounce: 10 });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10);
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
