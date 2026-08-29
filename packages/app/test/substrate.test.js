import { describe, expect, test } from 'bun:test';
import {
  createComponents,
  createStash,
  source,
  unwrapStash,
} from 'rip/app';
import { __effect } from '../../../src/runtime/reactive.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(next => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('singleton sources', () => {
  test('load lazily on first stash read', async () => {
    let calls = 0;
    const pending = deferred();
    const stash = createStash({
      user: source({
        fetch: async () => {
          calls++;
          return pending.promise;
        },
      }),
    });

    expect(calls).toBe(0);
    expect(stash.user).toBeNull();
    expect(calls).toBe(1);

    pending.resolve({ name: 'Ada' });
    await pending.promise;
    await Bun.sleep(0);
    expect(stash.user.name).toBe('Ada');
  });

  test('ensure deduplicates one in-flight load', async () => {
    let calls = 0;
    const pending = deferred();
    const stash = createStash({
      user: source({
        fetch: async () => {
          calls++;
          return pending.promise;
        },
      }),
    });
    const cell = unwrapStash(stash).user;

    const first = cell.ensure();
    const second = cell.ensure();
    expect(first).toBe(second);
    expect(calls).toBe(1);

    pending.resolve({ name: 'Ada' });
    await Promise.all([first, second]);
    expect(stash.user.name).toBe('Ada');
  });

  test('seeded writes are loaded and skip fetch', async () => {
    let calls = 0;
    const stash = createStash({
      user: source({
        fetch: async () => {
          calls++;
          return { name: 'network' };
        },
        staleTime: 'forever',
      }),
    });
    const cell = unwrapStash(stash).user;

    stash.user = { name: 'seeded' };
    expect(stash.user.name).toBe('seeded');
    expect(await cell.ensure()).toEqual({ name: 'seeded' });
    expect(calls).toBe(0);
  });

  test('reset unloads and the next ensure reloads', async () => {
    let calls = 0;
    const stash = createStash({
      user: source({
        fetch: async () => ({ version: ++calls }),
        staleTime: 'forever',
      }),
    });
    const cell = unwrapStash(stash).user;

    expect(await cell.ensure()).toEqual({ version: 1 });
    cell.reset();
    expect(cell.peek()).toBeNull();
    expect(await cell.ensure()).toEqual({ version: 2 });
    expect(calls).toBe(2);
  });

  test('peek reads without triggering a load', () => {
    let calls = 0;
    const stash = createStash({
      user: source({
        fetch: async () => {
          calls++;
          return { name: 'Ada' };
        },
      }),
      settings: { theme: 'dark' },
    });

    expect(stash.peek('user')).toBeNull();
    expect(stash.peek('settings.theme')).toBe('dark');
    expect(calls).toBe(0);
  });

  test('a null result remains loaded', async () => {
    let calls = 0;
    const stash = createStash({
      selected: source({
        fetch: async () => {
          calls++;
          return null;
        },
        staleTime: 'forever',
      }),
    });
    const cell = unwrapStash(stash).selected;

    expect(await cell.ensure()).toBeNull();
    expect(await cell.ensure()).toBeNull();
    expect(stash.selected).toBeNull();
    expect(calls).toBe(1);
  });

  test('preload freshness bridges exactly one stale-time-zero ensure', async () => {
    let calls = 0;
    const stash = createStash({
      user: source({
        fetch: async () => ({ version: ++calls }),
      }),
    });
    const cell = unwrapStash(stash).user;

    expect(await cell.preload()).toEqual({ version: 1 });
    expect(await cell.ensure()).toEqual({ version: 1 });
    await Bun.sleep(0);
    expect(calls).toBe(1);
  });

  test('a defaulted signal parameter stays singleton at runtime', async () => {
    let received;
    const stash = createStash({
      user: source({
        fetch: async (signal = null) => {
          received = signal;
          return { name: 'Ada' };
        },
      }),
    });

    expect(await unwrapStash(stash).user.ensure()).toEqual({ name: 'Ada' });
    expect(received).toBeInstanceOf(AbortSignal);
  });

  test('explicit singleton kind accepts a natural signal parameter', async () => {
    let received;
    const stash = createStash({
      user: source({
        kind: 'singleton',
        fetch: async signal => {
          received = signal;
          return { name: 'Ada' };
        },
      }),
    });

    expect(await unwrapStash(stash).user.ensure()).toEqual({ name: 'Ada' });
    expect(received).toBeInstanceOf(AbortSignal);
  });
});

describe('keyed source families', () => {
  test('reuse one cell identity per key', async () => {
    const calls = [];
    const stash = createStash({
      order: source({
        fetch: async id => {
          calls.push(id);
          return { id };
        },
        staleTime: 'forever',
      }),
    });
    const family = unwrapStash(stash).order;

    expect(family.cellFor('o1')).toBe(family.cellFor('o1'));
    expect(family.cellFor('o1')).not.toBe(family.cellFor('o2'));
    expect(stash.order('o1')).toBeNull();
    await family.cellFor('o1').ensure();
    expect(stash.order('o1')).toEqual({ id: 'o1' });
    expect(calls).toEqual(['o1']);
  });

  test('retries cap pruning when an in-flight cell settles', async () => {
    const loads = Array.from({ length: 65 }, deferred);
    const stash = createStash({
      item: source({
        fetch: async key => loads[key].promise,
        staleTime: 'forever',
      }),
    });
    const family = unwrapStash(stash).item;
    const cells = [];
    const pending = [];

    for (let key = 0; key < loads.length; key++) {
      const cell = family.cellFor(key);
      cells.push(cell);
      pending.push(cell.ensure());
    }

    loads[0].resolve({ key: 0 });
    await pending[0];
    expect(family.cellFor(0)).not.toBe(cells[0]);

    for (let key = 1; key < loads.length; key++) loads[key].resolve({ key });
    await Promise.all(pending.slice(1));
  });

  test('reset aborts the hidden keyed signal argument', async () => {
    let receivedKey;
    let receivedSignal;
    const stash = createStash({
      item: source({
        fetch: async function (key) {
          receivedKey = key;
          receivedSignal = arguments[1];
          return new Promise((resolve, reject) => {
            receivedSignal.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        },
      }),
    });
    const cell = unwrapStash(stash).item.cellFor('k1');
    const pending = cell.ensure();

    expect(receivedKey).toBe('k1');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    cell.reset();
    expect(receivedSignal.aborted).toBeTrue();
    expect(await pending).toBeUndefined();
  });

  test('explicit keyed kind accepts natural key and signal parameters', async () => {
    let receivedSignal;
    const stash = createStash({
      item: source({
        kind: 'keyed',
        fetch: async (key, signal) => {
          receivedSignal = signal;
          return { key };
        },
      }),
    });

    expect(await unwrapStash(stash).item.cellFor('k1').ensure()).toEqual({ key: 'k1' });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  test('reset retries cap pruning while many cells are loading', async () => {
    const loads = Array.from({ length: 65 }, deferred);
    const stash = createStash({
      item: source({
        fetch: async key => loads[key].promise,
        staleTime: 'forever',
      }),
    });
    const family = unwrapStash(stash).item;
    const cells = [];
    const pending = [];

    for (let key = 0; key < loads.length; key++) {
      const cell = family.cellFor(key);
      cells.push(cell);
      pending.push(cell.ensure());
    }

    cells[0].reset();
    expect(family.cellFor(0)).not.toBe(cells[0]);

    for (let key = 0; key < loads.length; key++) loads[key].resolve({ key });
    await Promise.all(pending);
  });
});

describe('stash structure', () => {
  test('own-key effects rerun for object and array structural changes', () => {
    const stash = createStash({ profile: { name: 'Ada' }, items: [] });
    const objectKeys = [];
    const arrayKeys = [];
    const stopObject = __effect(() => objectKeys.push(Object.keys(stash.profile).join(',')));
    const stopArray = __effect(() => arrayKeys.push(Object.keys(stash.items).join(',')));

    stash.profile.role = 'admin';
    stash.items.push('first');
    stash.items.length = 0;

    expect(objectKeys).toEqual(['name', 'name,role']);
    expect(arrayKeys).toEqual(['', '0', '']);
    stopObject();
    stopArray();
  });

  test('direct dotted and slashed paths read and write nested values', () => {
    const stash = createStash({ profile: { name: 'Ada' } });

    expect(stash['profile.name']).toBe('Ada');
    stash['profile.name'] = 'Grace';
    stash['profile/contact.email'] = 'grace@example.test';

    expect(stash.profile.name).toBe('Grace');
    expect(stash['profile/contact.email']).toBe('grace@example.test');
    expect(Object.hasOwn(unwrapStash(stash), 'profile.name')).toBeFalse();
    expect(Object.hasOwn(unwrapStash(stash), 'profile/contact.email')).toBeFalse();
  });

  test('bracket paths support numeric, negative, and quoted keys', () => {
    const stash = createStash({
      rows: [{ name: 'first' }, { name: 'last' }],
      meta: { 'display.name': 'Ada' },
      labels: { 'primary/key': 'one' },
    });

    expect(stash['rows[0].name']).toBe('first');
    expect(stash['rows[-1].name']).toBe('last');
    expect(stash['meta["display.name"]']).toBe('Ada');
    expect(stash["labels['primary/key']"]).toBe('one');

    stash['rows[-1].name'] = 'final';
    stash['meta["display.name"]'] = 'Grace';
    stash["labels['primary/key']"] = 'two';

    expect(stash.rows[1].name).toBe('final');
    expect(unwrapStash(stash).meta['display.name']).toBe('Grace');
    expect(unwrapStash(stash).labels['primary/key']).toBe('two');
  });

  test('bracket writes synthesize arrays only for numeric segments', () => {
    const stash = createStash({});

    stash['groups[0].name'] = 'first';
    stash['tails[-1].name'] = 'last';
    stash['lookup["0"].name'] = 'quoted';

    expect(Array.isArray(stash.groups)).toBeTrue();
    expect(stash.groups[0].name).toBe('first');
    expect(Array.isArray(stash.tails)).toBeTrue();
    expect(stash['tails[-1].name']).toBe('last');
    expect(Array.isArray(stash.lookup)).toBeFalse();
    expect(stash['lookup["0"].name']).toBe('quoted');
  });
});

describe('stash source handles', () => {
  test('handle members reflect the cell lifecycle, reactively', async () => {
    let mode = 'ok';
    let calls = 0;
    const stash = createStash({
      stats: source({
        fetch: async () => {
          calls++;
          if (mode === 'fail') throw new Error('boom');
          return { n: calls };
        },
      }),
    });
    const handle = stash.source('stats');
    const spinner = [];
    const stopSpinner = __effect(() => spinner.push(handle.loading));

    expect(handle.value).toBeNull(); // kicks the lazy load
    expect(handle.loading).toBeTrue();
    await Bun.sleep(0);
    expect(handle.value.n).toBe(1);
    expect(handle.loading).toBeFalse();
    expect(handle.error).toBeNull();
    expect(spinner).toEqual([false, true, false]);

    mode = 'fail';
    await handle.refetch().catch(() => {});
    expect(handle.error).toBeInstanceOf(Error);
    expect(handle.value.n).toBe(1); // a failed refetch keeps last-good
    stopSpinner();
  });

  test('refetch triggers a new fetch and reset restores baseline', async () => {
    let calls = 0;
    const stash = createStash({
      stats: source({
        fetch: async () => ({ n: ++calls }),
        staleTime: 'forever',
      }),
    });
    const handle = stash.source('stats');

    await unwrapStash(stash).stats.ensure();
    expect(handle.value.n).toBe(1);
    await handle.refetch();
    expect(handle.value.n).toBe(2);
    handle.reset();
    expect(unwrapStash(stash).stats.peek()).toBeNull();
    expect(calls).toBe(2);
  });

  test('keyed handles address one family member', async () => {
    const stash = createStash({
      order: source({ fetch: async id => ({ id }) }),
    });

    expect(() => stash.source('order')).toThrow('requires a key');
    const handle = stash.source('order', 'o1');
    handle.value = { id: 'seeded' };
    expect(stash.order('o1').id).toBe('seeded');
    expect(unwrapStash(stash).order.cellFor('o2').peek()).toBeNull();
    handle.reset();
    expect(unwrapStash(stash).order.cellFor('o1').peek()).toBeNull();
  });

  test('nested paths resolve the nearest source cell', async () => {
    const stash = createStash({
      session: {
        user: source({ fetch: async () => ({ name: 'Ada' }), staleTime: 'forever' }),
      },
    });

    await unwrapStash(stash).session.user.ensure();
    expect(stash.source('session.user').value.name).toBe('Ada');
  });

  test('non-source paths and misplaced keys are loud errors', () => {
    const stash = createStash({
      plain: 1,
      user: source({ fetch: async () => ({ name: 'Ada' }) }),
    });

    expect(() => stash.source('plain')).toThrow('does not resolve to a source key');
    expect(() => stash.source('missing')).toThrow('does not resolve to a source key');
    expect(() => stash.source('user', 'k')).toThrow('is not keyed');
  });

  test('source is reserved and shadows a data key, like peek and reset', () => {
    const stash = createStash({ source: 'plain data' });

    expect(typeof stash.source).toBe('function');
    expect(typeof stash.peek).toBe('function');
    expect(typeof stash.reset).toBe('function');
    expect(stash.peek('source')).toBe('plain data');
  });

  test("medlabs smoke: stash.source('user').reset() unloads a loaded user", async () => {
    const stash = createStash({
      user: source({ fetch: async () => ({ name: 'Ada' }), staleTime: 'forever' }),
    });

    await unwrapStash(stash).user.ensure();
    expect(stash.peek('user')).toEqual({ name: 'Ada' });
    stash.source('user').reset();
    expect(stash.peek('user')).toBeNull();
  });
});

describe('component registry', () => {
  test('writes and reads source and compiled modules', () => {
    const components = createComponents();
    const first = { App: class App {} };

    components.write('app.rip', 'export App = component');
    expect(components.read('app.rip')).toBe('export App = component');
    components.setCompiled('app.rip', first);
    expect(components.getCompiled('app.rip')).toBe(first);

    components.write('app.rip', 'export App = component\n  render null');
    expect(components.read('app.rip')).toContain('render null');
    expect(components.getCompiled('app.rip')).toBeUndefined();
  });

  test('rejects malformed and directory-shaped component paths', () => {
    const components = createComponents();
    for (const path of [
      '/app.rip',
      'routes//app.rip',
      'routes/app.rip/',
      './app.rip',
      'routes/../app.rip',
      'routes/admin',
      'routes/app.rip/child.rip',
    ]) {
      expect(() => components.write(path, 'source')).toThrow('invalid component path');
    }
  });
});

describe('stash path helpers', () => {
  test('inc / dec / flip / join / keys / has / del', () => {
    const stash = createStash({
      cart: { total: 1, meta: { open: false } },
      tags: { a: 1 },
    });
    expect(stash.inc('cart.total')).toBe(2);
    expect(stash.dec('cart.total', 2)).toBe(0);
    expect(stash.flip('cart.meta.open')).toBe(true);
    expect(stash.cart.meta.open).toBe(true);
    stash.join('tags', { b: 2 });
    expect(stash.tags).toEqual({ a: 1, b: 2 });
    expect(stash.keys('cart').sort()).toEqual(['meta', 'total']);
    expect(stash.has('cart.total')).toBe(true);
    expect(stash.has('cart.missing')).toBe(false);
    stash.del('tags.a');
    expect(stash.tags).toEqual({ b: 2 });
    expect(stash.peek('cart.total')).toBe(0);
  });
});

describe('invalid calls', () => {
  test('reject malformed substrate calls', () => {
    expect(() => source()).toThrow('options object');
    expect(() => source({})).toThrow('fetch function');
    expect(() => source({ fetch: async (key, second) => ({ key, second }) })).toThrow(
      'no parameters for a singleton or one key parameter',
    );
    expect(() => source({ kind: 'other', fetch: async () => ({}) })).toThrow('source kind');
    expect(() => source({ kind: 'singleton', fetch: async (first, second) => ({ first, second }) })).toThrow(
      'singleton source fetch accepts at most one',
    );
    expect(() => source({ kind: 'keyed', fetch: async () => ({}) })).toThrow(
      'keyed source fetch requires a key parameter',
    );
    expect(() => createStash([])).toThrow('plain object');

    const family = unwrapStash(createStash({
      order: source({ fetch: async id => ({ id }) }),
    })).order;
    expect(() => family.cellFor()).toThrow('requires a key');

    const components = createComponents();
    expect(() => components.write('', 'source')).toThrow('non-empty string');
    expect(() => components.write('app.rip', null)).toThrow('must be a string');
  });
});

// The duration language the `Duration` type describes, and what a
// duration MEANS once parsed. The type is a literal union and the
// parse is a regex; they accept the same set, so a spelling that
// belongs in one belongs in both. Anything the parse refuses must
// THROW rather than silently read as zero.
describe('staleTime durations', () => {
  const parse = value => source({ fetch: async () => ({}), staleTime: value });
  const accepts = value => expect(() => parse(value)).not.toThrow();
  const rejects = value => expect(() => parse(value)).toThrow('staleTime');

  // The vocabulary is behavioral, not just parsed: a fresh cell's
  // ensure() answers without refetching, a stale one refetches.
  // `'forever'` rides every suite above.
  const counting = staleTime => {
    let calls = 0;
    const stash = createStash({
      user: source({ fetch: async () => ({ n: ++calls }), staleTime }),
    });
    return { cell: unwrapStash(stash).user, calls: () => calls };
  };

  test("a duration string ('5 min') keeps a fresh cell from refetching", async () => {
    const { cell, calls } = counting('5 min');
    await cell.ensure();
    await cell.ensure();
    expect(calls()).toBe(1);
  });

  test('a millisecond number keeps the same freshness window', async () => {
    const { cell, calls } = counting(60_000);
    await cell.ensure();
    await cell.ensure();
    expect(calls()).toBe(1);
  });

  test('zero staleness refetches on the next ensure', async () => {
    const { cell, calls } = counting(0);
    await cell.ensure();
    await cell.ensure();
    await new Promise(next => setTimeout(next, 0));
    expect(calls()).toBe(2);
  });

  test('every unit spelling is accepted, spaced and unspaced', () => {
    for (const unit of [
      's', 'sec', 'second', 'seconds', 'm', 'min', 'minute', 'minutes',
      'h', 'hr', 'hour', 'hours', 'd', 'day', 'days',
      'w', 'week', 'weeks', 'y', 'year', 'years',
    ]) {
      accepts(`5${unit}`);
      accepts(`5 ${unit}`);
    }
  });

  test('numbers, bare numeric strings, and "forever" are accepted', () => {
    accepts(0);
    accepts(250);
    accepts(5000);
    accepts('5000');
    accepts('forever');
    accepts('2.5 min');
    accepts('1.5 days');
    accepts('1e3 sec');
  });

  test('a misspelled unit is refused, not read as zero', () => {
    rejects('5 minz');
    rejects('5 mins');
    rejects('5 mo');
    rejects('1 yr');
    rejects('nonsense');
    rejects('');
  });

  test('durations are case-sensitive — one canonical spelling', () => {
    // The single break this tightening makes, pinned in both
    // polarities: lowercase is the language, and the casings a
    // literal union could never describe are refused rather than
    // silently accepted into a dialect.
    accepts('5 min');
    rejects('5 Min');
    rejects('5 MIN');
    rejects('90 SEC');
    rejects('2H');
  });

  test('a negative or non-finite number is refused', () => {
    rejects(-1);
    rejects(Infinity);
    rejects(NaN);
  });
});
