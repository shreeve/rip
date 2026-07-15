// The core runtime's built-in harbor adapter — the default that
// schema-model apps get with no adapter installed (reached here via
// schema.connect / __schemaConnect). It must carry the same
// session-lifecycle guarantees PR #107 pinned on packages/db's
// harborAdapter: the session is dropped in a finally on the COMMIT
// and ROLLBACK paths (a failed COMMIT releases the open transaction
// now, not at the idle TTL), a failed BEGIN drops its freshly-created
// session instead of orphaning it, and a session response missing its
// id refuses loudly rather than running BEGIN/COMMIT as independent
// autocommit statements on the pool. It must also carry the same
// temporal wire behavior (owner ruling on PORT-AUDIT D2): the design
// is ONE decode seam at the wire, and both adapters are wire seams, so
// temporal columns decode to real Date objects and Date params encode
// to ISO-Z identically here — pinned below against packages/db's
// temporal suite. The adapter reads the global fetch, so each test
// swaps in a scripted double and restores it.
import { test, expect, describe } from 'bun:test';

const orm = await import('../../src/runtime/schema-orm.js');

const adapter = () => orm.__schemaConnect({ url: 'http://h' });

// Run a scenario under a scripted global fetch, always restoring.
const withFetch = async (double, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = double;
  try { return await fn(); } finally { globalThis.fetch = real; }
};

// A fetch double: each call is recorded, and responses are scripted by
// URL suffix so a test can assert exactly what the adapter posted.
const fetchDouble = (script) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
    const key = Object.keys(script).find(suffix => url.endsWith(suffix));
    const reply = key ? script[key] : { status: 404, json: { error: 'no route' } };
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      statusText: reply.statusText ?? '',
      json: async () => reply.json ?? {},
    };
  };
  fetch.calls = calls;
  return fetch;
};

// A statement-scripted fetch: reply by the SQL body (BEGIN/COMMIT/etc.)
// and by whether it's the session-drop DELETE.
const bySql = (replies) => {
  let dropped = false;
  const fetch = async (url, init) => {
    if (init?.method === 'DELETE') { dropped = true; return { ok: true, status: 200, json: async () => ({}) }; }
    if (url.endsWith('/sql/sessions/new')) return { ok: true, status: 200, json: async () => ({ sessionId: 'sx' }) };
    const sql = init?.body ? JSON.parse(init.body).sql : null;
    const r = replies[sql] ?? { ok: true, json: {} };
    return { ok: r.ok !== false, status: r.status ?? 200, statusText: '', json: async () => r.json ?? {} };
  };
  fetch.wasDropped = () => dropped;
  return fetch;
};

describe('default adapter transactions (session lifecycle)', () => {
  test('begin pins a session, carries it per statement, and drops it on commit', async () => {
    const fetch = fetchDouble({
      '/sql/sessions/new': { json: { sessionId: 'sess-1' } },
      '/sql': { json: { columns: [], data: [], rowCount: 0 } },
    });
    await withFetch(fetch, async () => {
      const tx = await adapter().begin();
      await tx.query('INSERT INTO u VALUES (?)', ['x']);
      await tx.commit();
    });
    const bodies = fetch.calls.filter(c => c.url.endsWith('/sql')).map(c => c.body);
    expect(bodies[0]).toEqual({ sql: 'BEGIN', sessionId: 'sess-1' });
    expect(bodies[1]).toEqual({ sql: 'INSERT INTO u VALUES (?)', params: ['x'], sessionId: 'sess-1' });
    expect(bodies[2]).toEqual({ sql: 'COMMIT', sessionId: 'sess-1' });
    expect(fetch.calls.some(c => c.method === 'DELETE' && c.url.endsWith('/sql/sessions/sess-1'))).toBe(true);
  });

  test('a failed COMMIT still drops the session, releasing the open transaction', async () => {
    const fetch = bySql({ COMMIT: { ok: false, json: { ok: false, error: 'conflict', errorCode: 'SERIALIZATION' } } });
    await withFetch(fetch, async () => {
      const tx = await adapter().begin();
      await expect(tx.commit()).rejects.toThrow(/conflict/);
    });
    expect(fetch.wasDropped()).toBe(true);
  });

  test('a failed ROLLBACK still drops the session', async () => {
    const fetch = bySql({ ROLLBACK: { ok: false, json: { ok: false, error: 'rollback failed', errorCode: 'X' } } });
    await withFetch(fetch, async () => {
      const tx = await adapter().begin();
      await expect(tx.rollback()).rejects.toThrow(/rollback failed/);
    });
    expect(fetch.wasDropped()).toBe(true);
  });

  test('a failed BEGIN drops the orphaned session', async () => {
    const fetch = bySql({ BEGIN: { ok: false, json: { ok: false, error: 'begin failed', errorCode: 'X' } } });
    await withFetch(fetch, async () => {
      await expect(adapter().begin()).rejects.toThrow(/begin failed/);
    });
    expect(fetch.wasDropped()).toBe(true);
  });

  test('a session response missing its id refuses to run a fake transaction', async () => {
    const fetch = fetchDouble({
      '/sql/sessions/new': { json: {} },
      '/sql': { json: { columns: [], data: [], rowCount: 0 } },
    });
    await withFetch(fetch, async () => {
      await expect(adapter().begin()).rejects.toThrow(/session id/i);
    });
    // Refused before BEGIN: nothing ever ran unisolated on the pool.
    expect(fetch.calls.filter(c => c.url.endsWith('/sql')).length).toBe(0);
  });
});

describe('default adapter temporal wire (decodes identically to packages/db harborAdapter)', () => {
  const UTC = Date.UTC(2024, 2, 15, 10, 30, 0);
  const envelope = (columns, data) => ({
    '/sql': { json: { ok: true, columns, data, rowCount: data.length } },
  });

  test('temporal columns decode to real Date objects, keyed by duckdbType', async () => {
    const fetch = fetchDouble(envelope(
      [
        { name: 'id', duckdbType: 'INTEGER', lossless: true },
        { name: 'ts', duckdbType: 'TIMESTAMP', lossless: true },
        { name: 'tz', duckdbType: 'TIMESTAMP WITH TIME ZONE', lossless: true },
        { name: 'd', duckdbType: 'DATE', lossless: true },
        { name: 't', duckdbType: 'TIME', lossless: true },
      ],
      [[7, '2024-03-15T10:30:00', '2024-03-15T10:30:00Z', '2024-03-15', '10:30:00']]));
    const { data } = await withFetch(fetch, () => adapter().query('SELECT * FROM t'));
    const [id, ts, tz, d, t] = data[0];
    expect(id).toBe(7); // non-temporal untouched
    expect(ts instanceof Date).toBe(true);
    expect(ts.getTime()).toBe(UTC); // naive TIMESTAMP is UTC wall-clock — no host-offset shift
    expect(tz.getTime()).toBe(UTC);
    expect(d.getUTCDate()).toBe(15); // DATE stays civil (UTC midnight)
    expect(t).toBe('10:30:00'); // TIME has no date component: stays a string
  });

  test('odd values pass through; a no-temporal result is untouched', async () => {
    const fetch = fetchDouble(envelope(
      [{ name: 'ts', duckdbType: 'TIMESTAMP', lossless: true }], [['infinity'], [null]]));
    const { data } = await withFetch(fetch, () => adapter().query('SELECT ts FROM t'));
    expect(data).toEqual([['infinity'], [null]]);
  });

  test('Date params encode to ISO-Z, nested values included; Invalid Date throws loudly', async () => {
    const fetch = fetchDouble(envelope([], []));
    await withFetch(fetch, () => adapter().query(
      'INSERT INTO t VALUES (?, ?, ?)', [new Date(UTC), { at: new Date(0) }, 'x']));
    expect(fetch.calls[0].body.params).toEqual(
      ['2024-03-15T10:30:00.000Z', { at: '1970-01-01T00:00:00.000Z' }, 'x']);
    await withFetch(fetch, async () => {
      await expect(adapter().query('INSERT INTO t VALUES (?)', [new Date('nope')]))
        .rejects.toThrow(/Invalid Date/);
    });
  });

  test('transaction statements ride the same seam', async () => {
    const fetch = fetchDouble({
      '/sql/sessions/new': { json: { sessionId: 'sess-t' } },
      '/sql': { json: { ok: true, columns: [{ name: 'ts', duckdbType: 'TIMESTAMP', lossless: true }], data: [['2024-03-15T10:30:00']], rowCount: 1 } },
    });
    const { decodedCell } = await withFetch(fetch, async () => {
      const tx = await adapter().begin();
      await tx.query('INSERT INTO t VALUES (?)', [new Date(UTC)]);
      const res = await tx.query('SELECT ts FROM t');
      await tx.commit();
      return { decodedCell: res.data[0][0] };
    });
    const insert = fetch.calls.find(c => c.body?.sql?.startsWith('INSERT'));
    expect(insert.body.params).toEqual(['2024-03-15T10:30:00.000Z']);
    expect(decodedCell instanceof Date).toBe(true);
    expect(decodedCell.getTime()).toBe(UTC);
  });
});
