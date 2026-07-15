// The query client: parameterized execution, result materialization
// (columns+rows → row objects), the transaction runner (commit on
// return, rollback on throw), cancellation, and resource cleanup. It
// layers over any adapter, so a fake adapter drives every path here.
import { describe, expect, test } from 'bun:test';
import { CancelledError, createClient } from '@rip-lang/db';

// A recording fake adapter: each query is logged, replies are scripted
// by a queue, and its begin() returns a tx whose commit/rollback are
// observable.
const fakeAdapter = (replies = []) => {
  const log = [];
  const state = { committed: false, rolledBack: false, began: false };
  const next = (sql, params) => {
    log.push({ sql, params });
    const reply = replies.shift() ?? { columns: [], data: [], rowCount: 0 };
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(reply);
  };
  return {
    log,
    state,
    query: next,
    async begin() {
      state.began = true;
      return {
        query: next,
        async commit() { state.committed = true; },
        async rollback() { state.rolledBack = true; },
      };
    },
    introspect: async () => ({ tables: [] }),
    capabilities: { tx: true, ddlTransactional: true },
  };
};

describe('materialization', () => {
  test('query returns rows as objects keyed by column, with metadata', async () => {
    const adapter = fakeAdapter([{ columns: [{ name: 'id' }, { name: 'name' }], data: [[1, 'Ada'], [2, 'Bo']], rowCount: 2 }]);
    const result = await createClient(adapter).query('SELECT id, name FROM u');
    expect(result.rows).toEqual([{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }]);
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rowCount).toBe(2);
  });

  test('rows/one/value are the convenience projections', async () => {
    const adapter = fakeAdapter([
      { columns: [{ name: 'id' }], data: [[7], [8]], rowCount: 2 },
      { columns: [{ name: 'id' }], data: [[7]], rowCount: 1 },
      { columns: [{ name: 'n' }], data: [[42]], rowCount: 1 },
      { columns: [{ name: 'id' }], data: [], rowCount: 0 },
    ]);
    const db = createClient(adapter);
    expect(await db.rows('SELECT id FROM u')).toEqual([{ id: 7 }, { id: 8 }]);
    expect(await db.one('SELECT id FROM u LIMIT 1')).toEqual({ id: 7 });
    expect(await db.value('SELECT count(*) n FROM u')).toBe(42);
    expect(await db.one('SELECT id FROM u WHERE 0')).toBeNull();
  });

  test('value returns null (never undefined) when there is no scalar', async () => {
    const adapter = fakeAdapter([{ columns: [], data: [[]], rowCount: 1 }, { columns: [], data: [], rowCount: 0 }]);
    const db = createClient(adapter);
    expect(await db.value('SELECT')).toBeNull(); // empty row → null, not undefined
    expect(await db.value('SELECT WHERE 0')).toBeNull();
  });

  test('parameters pass straight through to the adapter', async () => {
    const adapter = fakeAdapter([{ columns: [], data: [], rowCount: 0 }]);
    await createClient(adapter).query('SELECT * FROM u WHERE id = ?', [42]);
    expect(adapter.log[0]).toEqual({ sql: 'SELECT * FROM u WHERE id = ?', params: [42] });
  });
});

describe('transactions', () => {
  test('a returning callback commits and yields its value', async () => {
    const adapter = fakeAdapter([
      { columns: [{ name: 'id' }], data: [[1]], rowCount: 1 },
    ]);
    const result = await createClient(adapter).transaction(async tx => {
      const row = await tx.one('INSERT INTO u (name) VALUES (?) RETURNING id', ['Ada']);
      return row.id;
    });
    expect(result).toBe(1);
    expect(adapter.state.committed).toBe(true);
    expect(adapter.state.rolledBack).toBe(false);
  });

  test('a throwing callback rolls back and rethrows', async () => {
    const adapter = fakeAdapter([]);
    await expect(createClient(adapter).transaction(async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect(adapter.state.committed).toBe(false);
    expect(adapter.state.rolledBack).toBe(true);
  });

  test('a failed statement inside the transaction rolls back', async () => {
    const adapter = fakeAdapter([Object.assign(new Error('constraint'), {})]);
    await expect(createClient(adapter).transaction(tx => tx.query('INSERT ...')))
      .rejects.toThrow('constraint');
    expect(adapter.state.rolledBack).toBe(true);
  });

  test('the tx client materializes exactly like the top-level client', async () => {
    const adapter = fakeAdapter([{ columns: [{ name: 'id' }, { name: 'name' }], data: [[1, 'Ada']], rowCount: 1 }]);
    const rows = await createClient(adapter).transaction(tx => tx.rows('SELECT id, name FROM u'));
    expect(rows).toEqual([{ id: 1, name: 'Ada' }]);
  });

  test('a failed COMMIT propagates its own error and does not trigger a rollback', async () => {
    const state = { rolledBack: false };
    const adapter = {
      query: async () => ({ columns: [], data: [], rowCount: 0 }),
      async begin() {
        return {
          query: async () => ({ columns: [], data: [], rowCount: 0 }),
          commit: async () => { throw new Error('COMMIT conflict'); },
          rollback: async () => { state.rolledBack = true; throw new Error('ROLLBACK on dead session'); },
        };
      },
    };
    await expect(createClient(adapter).transaction(async () => 'ok'))
      .rejects.toThrow('COMMIT conflict'); // the real error, not the rollback artifact
    expect(state.rolledBack).toBe(false); // no spurious rollback after a failed commit
  });

  test('a throwing rollback never masks the original callback error', async () => {
    const adapter = {
      query: async () => ({ columns: [], data: [], rowCount: 0 }),
      async begin() {
        return {
          query: async () => ({ columns: [], data: [], rowCount: 0 }),
          commit: async () => {},
          rollback: async () => { throw new Error('rollback also failed'); },
        };
      },
    };
    await expect(createClient(adapter).transaction(async () => { throw new Error('the real cause'); }))
      .rejects.toThrow('the real cause');
  });

  test('a nested transaction joins the outer one — no second begin', async () => {
    const adapter = fakeAdapter([{ columns: [{ name: 'id' }], data: [[1]], rowCount: 1 }]);
    let beginCount = 0;
    const wrapped = { ...adapter, begin: async (...a) => { beginCount += 1; return adapter.begin(...a); } };
    await createClient(wrapped).transaction(async tx => {
      await tx.transaction(async inner => { await inner.query('SELECT 1'); });
    });
    expect(beginCount).toBe(1); // no savepoints — the inner join uses the same session
  });
});

describe('cancellation', () => {
  test('an already-aborted signal rejects before the query runs', async () => {
    const adapter = fakeAdapter([{ columns: [], data: [], rowCount: 0 }]);
    const controller = new AbortController();
    controller.abort();
    await expect(createClient(adapter).query('SELECT 1', [], { signal: controller.signal }))
      .rejects.toBeInstanceOf(CancelledError);
    expect(adapter.log.length).toBe(0); // never dispatched
  });

  test('an abort while in flight rejects with a CancelledError', async () => {
    const controller = new AbortController();
    const adapter = {
      query: () => new Promise(() => {}), // never resolves
      capabilities: {},
    };
    const pending = createClient(adapter).query('SELECT pg_sleep(10)', [], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
  });

  test('a completed query is unaffected by a later abort', async () => {
    const adapter = fakeAdapter([{ columns: [{ name: 'n' }], data: [[1]], rowCount: 1 }]);
    const controller = new AbortController();
    const result = await createClient(adapter).query('SELECT 1', [], { signal: controller.signal });
    controller.abort();
    expect(result.rowCount).toBe(1);
  });
});

describe('shape', () => {
  test('createClient requires an adapter with a query method', () => {
    expect(() => createClient(null)).toThrow(/adapter/i);
    expect(() => createClient({})).toThrow(/adapter/i);
  });

  test('CancelledError is a distinct error type', () => {
    expect(new CancelledError('x') instanceof Error).toBe(true);
    expect(new CancelledError('x').name).toBe('CancelledError');
  });
});
