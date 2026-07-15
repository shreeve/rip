// The database adapter contract and the harbor adapter. The adapter
// speaks HTTP to a duckdb-harbor endpoint; every protocol behavior is
// exercised here over an injected fetch, so these tests run without a
// server. Live integration against a real harbor is a separate,
// endpoint-gated extended-tier suite.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ConnectionError, DbError, QueryError, harborAdapter, isDbError } from '@rip-lang/db';

// A fetch double: each call is recorded, and responses are scripted by
// URL suffix so a test can assert exactly what the adapter posted.
const fetchDouble = (script) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers ?? {} });
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

describe('config', () => {
  test('the url comes from options, defaulting to the local harbor', () => {
    const fetch = fetchDouble({ '/sql': { json: { columns: [], data: [], rowCount: 0 } } });
    const adapter = harborAdapter({ url: 'https://db.example:9494/', fetch });
    return adapter.query('SELECT 1').then(() => {
      expect(fetch.calls[0].url).toBe('https://db.example:9494/sql'); // trailing slash trimmed
    });
  });

  test('a token becomes a bearer authorization header', async () => {
    const fetch = fetchDouble({ '/sql': { json: { columns: [], data: [], rowCount: 0 } } });
    await harborAdapter({ url: 'http://h', token: 'secret', fetch }).query('SELECT 1');
    expect(fetch.calls[0].headers.Authorization).toBe('Bearer secret');
    expect(fetch.calls[0].headers['Content-Type']).toBe('application/json');
  });
});

describe('query', () => {
  test('returns { columns, data, rowCount } from the harbor response, with columns as { name, type } objects', async () => {
    // harbor sends per-column objects { name, duckdbType, lossless };
    // the adapter aliases duckdbType to a stable `type` and preserves
    // the extras, so the ORM can hydrate rows by column.name.
    const fetch = fetchDouble({ '/sql': { json: {
      columns: [{ name: 'id', duckdbType: 'INTEGER', lossless: true }, { name: 'name', duckdbType: 'VARCHAR', lossless: true }],
      data: [[1, 'Ada']], rowCount: 1,
    } } });
    const result = await harborAdapter({ url: 'http://h', fetch }).query('SELECT id, name FROM users');
    expect(result).toEqual({
      columns: [
        { name: 'id', duckdbType: 'INTEGER', lossless: true, type: 'INTEGER' },
        { name: 'name', duckdbType: 'VARCHAR', lossless: true, type: 'VARCHAR' },
      ],
      data: [[1, 'Ada']],
      rowCount: 1,
    });
    expect(fetch.calls[0].body).toEqual({ sql: 'SELECT id, name FROM users' });
  });

  test('parameters ride alongside the sql, omitted when empty', async () => {
    const fetch = fetchDouble({ '/sql': { json: { columns: [], data: [], rowCount: 0 } } });
    const adapter = harborAdapter({ url: 'http://h', fetch });
    await adapter.query('SELECT * FROM u WHERE id = ?', [42]);
    expect(fetch.calls[0].body).toEqual({ sql: 'SELECT * FROM u WHERE id = ?', params: [42] });
    await adapter.query('SELECT 1', []);
    expect(fetch.calls[1].body).toEqual({ sql: 'SELECT 1' }); // empty params omitted
  });
});

describe('transactions', () => {
  test('begin pins a session, carries it per statement, and drops it on commit', async () => {
    const fetch = fetchDouble({
      '/sql/sessions/new': { json: { sessionId: 'sess-1' } },
      '/sql': { json: { columns: [], data: [], rowCount: 0 } },
    });
    const tx = await harborAdapter({ url: 'http://h', fetch }).begin();
    await tx.query('INSERT INTO u VALUES (?)', ['x']);
    await tx.commit();
    const bodies = fetch.calls.filter(c => c.url.endsWith('/sql')).map(c => c.body);
    expect(bodies[0]).toEqual({ sql: 'BEGIN', sessionId: 'sess-1' });
    expect(bodies[1]).toEqual({ sql: 'INSERT INTO u VALUES (?)', params: ['x'], sessionId: 'sess-1' });
    expect(bodies[2]).toEqual({ sql: 'COMMIT', sessionId: 'sess-1' });
    expect(fetch.calls.some(c => c.method === 'DELETE' && c.url.endsWith('/sql/sessions/sess-1'))).toBe(true);
  });

  test('rollback issues ROLLBACK and still drops the session', async () => {
    const fetch = fetchDouble({
      '/sql/sessions/new': { json: { sessionId: 'sess-2' } },
      '/sql': { json: { columns: [], data: [], rowCount: 0 } },
    });
    const tx = await harborAdapter({ url: 'http://h', fetch }).begin();
    await tx.rollback();
    expect(fetch.calls.some(c => c.body?.sql === 'ROLLBACK')).toBe(true);
    expect(fetch.calls.some(c => c.method === 'DELETE')).toBe(true);
  });

  test('a failed session drop never masks the transaction outcome', async () => {
    const fetch = fetchDouble({
      '/sql/sessions/new': { json: { sessionId: 'sess-3' } },
      '/sql': { json: { columns: [], data: [], rowCount: 0 } },
      '/sql/sessions/sess-3': { status: 500, json: { error: 'gone' } },
    });
    const tx = await harborAdapter({ url: 'http://h', fetch }).begin();
    await expect(tx.commit()).resolves.toBeUndefined(); // drop failure swallowed
  });

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

  test('a failed COMMIT still drops the session, releasing the open transaction', async () => {
    const fetch = bySql({ COMMIT: { ok: false, json: { ok: false, error: 'conflict', errorCode: 'SERIALIZATION' } } });
    const tx = await harborAdapter({ url: 'http://h', fetch }).begin();
    await expect(tx.commit()).rejects.toThrow(/conflict/);
    expect(fetch.wasDropped()).toBe(true);
  });

  test('a session response missing its id refuses to run a fake transaction', async () => {
    const fetch = fetchDouble({ '/sql/sessions/new': { json: {} }, '/sql': { json: { columns: [], data: [], rowCount: 0 } } });
    await expect(harborAdapter({ url: 'http://h', fetch }).begin()).rejects.toThrow(/session id/i);
  });

  test('a failed BEGIN drops the orphaned session', async () => {
    const fetch = bySql({ BEGIN: { ok: false, json: { ok: false, error: 'begin failed', errorCode: 'X' } } });
    await expect(harborAdapter({ url: 'http://h', fetch }).begin()).rejects.toThrow(/begin failed/);
    expect(fetch.wasDropped()).toBe(true);
  });
});

describe('error taxonomy', () => {
  test('an HTTP failure becomes a typed DbError carrying the status', async () => {
    const fetch = fetchDouble({ '/sql': { status: 503, statusText: 'Service Unavailable', json: { error: 'harbor down' } } });
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT 1').catch(e => e);
    expect(isDbError(err)).toBe(true);
    expect(err.message).toContain('harbor down');
    expect(err.httpStatus).toBe(503);
  });

  test('a harbor SQL error becomes a QueryError with its code and details', async () => {
    const fetch = fetchDouble({ '/sql': { json: { ok: false, error: 'syntax error at "FRM"', errorCode: 'PARSE_ERROR', errorDetails: { line: 1 } } } });
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT * FRM u').catch(e => e);
    expect(err instanceof QueryError).toBe(true);
    expect(err.code).toBe('PARSE_ERROR');
    expect(err.details).toEqual({ line: 1 });
    expect(err.sql).toBe('SELECT * FRM u');
  });

  test('a network failure surfaces as a DbError, not a raw fetch throw', async () => {
    const fetch = async () => { throw new TypeError('fetch failed'); };
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT 1').catch(e => e);
    expect(isDbError(err)).toBe(true);
    expect(err.message).toMatch(/unreachable|connect|fetch/i);
  });

  test('a 5xx during a query is a ConnectionError, not a QueryError', async () => {
    const { ConnectionError } = await import('@rip-lang/db');
    const fetch = fetchDouble({ '/sql': { status: 503, json: { error: 'harbor down' } } });
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT 1').catch(e => e);
    expect(err instanceof ConnectionError).toBe(true); // retryable, distinct from a bad query
    expect(err.sql).toBe('SELECT 1'); // context still attached
  });
});

describe('timeouts and cancellation', () => {
  // A hung harbor: the fetch never settles on its own, but records the
  // signal it was handed so a test can observe the real abort.
  const hangingFetch = () => {
    const seen = { signal: null };
    const fetch = (url, init) => {
      seen.signal = init?.signal ?? null;
      return new Promise(() => {}); // a hung socket: never resolves
    };
    fetch.seen = seen;
    return fetch;
  };

  test('a hung harbor rejects with a TIMEOUT ConnectionError at the deadline', async () => {
    const fetch = hangingFetch();
    const err = await harborAdapter({ url: 'http://h', fetch, timeoutMs: 25 }).query('SELECT 1').catch(e => e);
    expect(err instanceof ConnectionError).toBe(true);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toContain('25ms');
    expect(fetch.seen.signal?.aborted).toBe(true); // the wire request was aborted, not abandoned
  });

  test('a caller signal aborts the in-flight request with an ABORTED ConnectionError', async () => {
    const fetch = hangingFetch();
    const controller = new AbortController();
    const pending = harborAdapter({ url: 'http://h', fetch, timeoutMs: 0 })
      .query('SELECT 1', [], { signal: controller.signal }).catch(e => e);
    controller.abort();
    const err = await pending;
    expect(err instanceof ConnectionError).toBe(true);
    expect(err.code).toBe('ABORTED');
    expect(fetch.seen.signal?.aborted).toBe(true); // threaded through to the fetch
  });

  test('an already-aborted signal never reaches a hung harbor for long', async () => {
    const fetch = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    const err = await harborAdapter({ url: 'http://h', fetch, timeoutMs: 0 })
      .query('SELECT 1', [], { signal: controller.signal }).catch(e => e);
    expect(err.code).toBe('ABORTED');
  });

  test('a transaction statement honors the caller signal too', async () => {
    const seen = { signal: null };
    const fetch = (url, init) => {
      if (url.endsWith('/sql/sessions/new')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ sessionId: 'sx' }) });
      const sql = init?.body ? JSON.parse(init.body).sql : null;
      if (sql === 'BEGIN') return Promise.resolve({ ok: true, status: 200, json: async () => ({ columns: [], data: [], rowCount: 0 }) });
      seen.signal = init?.signal ?? null;
      return new Promise(() => {}); // the statement hangs
    };
    const tx = await harborAdapter({ url: 'http://h', fetch, timeoutMs: 0 }).begin();
    const controller = new AbortController();
    const pending = tx.query('SELECT 1', [], { signal: controller.signal }).catch(e => e);
    controller.abort();
    const err = await pending;
    expect(err.code).toBe('ABORTED');
    expect(seen.signal?.aborted).toBe(true);
  });

  test('a fast response is untouched by the deadline', async () => {
    const fetch = fetchDouble({ '/sql': { json: { columns: [], data: [], rowCount: 0 } } });
    const result = await harborAdapter({ url: 'http://h', fetch, timeoutMs: 25 }).query('SELECT 1');
    expect(result.rowCount).toBe(0);
  });

  test('the default deadline is 30 seconds, matching v3 and mcp.rip', () => {
    // 30s is unobservable in a unit test without fake timers; pin the
    // constant in the source instead, next to its mcp.rip twin.
    const src = readFileSync(new URL('../adapter.rip', import.meta.url), 'utf8');
    expect(src).toMatch(/DEFAULT_TIMEOUT_MS = 30_000/);
  });
});

describe('capabilities', () => {
  test('capabilities declare transactional DDL', () => {
    const adapter = harborAdapter({ url: 'http://h', fetch: fetchDouble({}) });
    expect(adapter.capabilities).toEqual({ tx: true, ddlTransactional: true });
  });
});

describe('contract shape', () => {
  test('the adapter implements the query + begin contract with capabilities (no introspect)', () => {
    const adapter = harborAdapter({ url: 'http://h', fetch: fetchDouble({}) });
    for (const method of ['query', 'begin']) expect(typeof adapter[method]).toBe('function');
    expect(typeof adapter.capabilities).toBe('object');
    expect('introspect' in adapter).toBe(false); // introspection is the runner's job, via query
  });

  test('the error types form a hierarchy under DbError', () => {
    expect(new QueryError('x') instanceof DbError).toBe(true);
    expect(isDbError(new DbError('x'))).toBe(true);
    expect(isDbError(new Error('x'))).toBe(false);
  });
});
