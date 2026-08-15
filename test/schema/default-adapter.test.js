// The core runtime's built-in harbor adapter — the default that
// schema-model apps get with no adapter installed (reached here via
// schema.connect / __schemaConnect). It must carry the same
// session-lifecycle guarantees PR #107 pinned on packages/db's
// harborAdapter: the session is dropped in a finally on the COMMIT
// and ROLLBACK paths (a failed COMMIT releases the open transaction
// now, not at the idle TTL), a failed BEGIN drops its freshly-created
// session instead of orphaning it, and a session response missing its
// id refuses loudly rather than running BEGIN/COMMIT as independent
// autocommit statements on the pool. Those guarantees now come from
// the ONE client in src/runtime/duckdb.js, which packages/db uses too —
// so this file is the schema tier's half of a single implementation
// rather than a parity check between two. Temporal columns decode to
// real Date objects and Date params encode to ISO-Z at that one seam.
// The adapter reads the global fetch, so each test swaps in a scripted
// double and restores it.
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';

const orm = await import('../../src/runtime/orm.js');
const hb = await import('../../src/runtime/duckdb.js');

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
    // Every statement is named so it can be cancelled; the name is fresh
    // per request and is not what this test is about.
    const bodies = fetch.calls.filter(c => c.url.endsWith('/sql'))
      .map(({ body: { queryId, ...rest } }) => rest);
    expect(fetch.calls.filter(c => c.url.endsWith('/sql')).every(c => typeof c.body.queryId === 'string')).toBe(true);
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

  // The unconfigured default has to reach the harbor a developer actually
  // started. `src/cli/schema.js` advertises the RIP_DB_URL-only path, so
  // this adapter is what a schema-model app gets with nothing installed —
  // and it was still pointing at harbor's pre-9495 port long after
  // packages/db and harbor itself had moved.
  // The fallback is only observable on a pristine module — sibling tests
  // install adapters on the shared one, and a second module instance
  // re-runs orm.js's globalThis publishing. So pin the source, the way
  // packages/db pins DEFAULT_TIMEOUT_MS.
  test('the unconfigured default targets harbor\'s own default port', () => {
    const src = readFileSync(new URL('../../src/runtime/duckdb.js', import.meta.url), 'utf8');
    expect(src).toContain("const DEFAULT_URL = 'http://127.0.0.1:9495'");
    expect(src).not.toContain('9494');
  });
});

// The wire client's error surface: a caller reads these fields to
// decide whether to retry, how long to wait, and what to log — so a
// field that is present when the server said nothing, or a message
// that carries the URL's password into a log, is a defect in the
// client rather than in the caller.
describe('harbor client: what an error is allowed to say', () => {
  // fetchDouble's response has no `headers`, which is exactly the
  // "server sent no Retry-After" case; a header-bearing reply overrides.
  const failWith = async (status, json, headers) => {
    const fetch = async () => ({
      ok: status < 400, status, statusText: '', json: async () => json,
      headers: headers ? { get: (k) => headers[k] ?? null } : undefined,
    });
    try { await hb.harborAdapter({ url: 'http://h', token: 't', fetch }).query('SELECT 1', []); }
    catch (e) { return e; }
    throw new Error('expected a rejection');
  };

  // `Number(null)` is 0, so an absent header used to stamp
  // retryAfterMs = 0 on EVERY error — and a caller testing
  // `if (e.retryAfterMs)` reads 0 as an instruction to retry now,
  // skipping the backoff it would otherwise have run.
  test('retryAfterMs appears only when the server actually sent one', async () => {
    const silent = await failWith(503, { error: 'no lease available', code: 'no_lease_available' });
    expect('retryAfterMs' in silent).toBe(false);
    const spoken = await failWith(503, { error: 'no lease available' }, { 'Retry-After': '2' });
    expect(spoken.retryAfterMs).toBe(2000);
    // A header that is present but not a number says nothing either.
    const junk = await failWith(503, { error: 'busy' }, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' });
    expect('retryAfterMs' in junk).toBe(false);
  });

  // Unreachable-harbor messages are the ones most likely to reach a
  // log or a bug report, and a URL is the one place a password sits in
  // plain text in a connection string.
  test('an unreachable harbor is named without the credentials in its URL', async () => {
    const fetch = async () => { throw new TypeError('fetch failed'); };
    const a = hb.harborAdapter({ url: 'http://admin:s3cret@db:9495', token: 't', fetch });
    await expect(a.query('SELECT 1', [])).rejects.toThrow(/http:\/\/<redacted>@db:9495/);
    await expect(a.query('SELECT 1', [])).rejects.not.toThrow(/s3cret/);
  });

  // A cancellation is its own event: a retry loop keyed on
  // ConnectionError must not catch it, and a caller that asked for the
  // cancellation must be able to tell its own request apart from a
  // server-side deadline.
  test('a cancelled statement carries harbor\'s own code, or ABORTED when it sent none', async () => {
    const named = await failWith(499, { error: 'the statement was cancelled', code: 'cancelled', harborCode: 'cancelled' });
    expect(named.name).toBe('CancelledError');
    expect(named.code).toBe('cancelled');
    const bare = await failWith(499, { error: 'the statement was cancelled' });
    expect(bare.name).toBe('CancelledError');
    expect(bare.code).toBe('ABORTED');
  });

  // A param that has no wire form must refuse here, where the caller's
  // stack is, rather than travel as null/"NaN" and land in a row.
  test('a parameter with no wire form refuses at the client', () => {
    for (const bad of [undefined, NaN, Infinity, -Infinity, 10n]) {
      expect(() => hb.encodeParam(bad)).toThrow();
    }
    expect(hb.encodeParams([null, 0, -0, 'a', true])).toEqual([null, 0, -0, 'a', true]);
  });
});

// The catalog door: one authenticated GET, one JSON document — and a
// 404 that names the upgrade instead of reading as an empty schema,
// because the endpoint's absence means the deployment predates it.
describe('harbor client: GET /catalog', () => {
  const doc = {
    harborVersion: '0.9.0', duckdbVersion: 'v1.5.5',
    tables: [{
      name: 'users', schema: 'main',
      columns: [{ name: 'id', type: 'INTEGER', notNull: true, default: null, primary: true }],
      primaryKey: ['id'], indexes: [], foreignKeys: [],
    }],
    sequences: [],
  };

  const catalogFetch = (reply) => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ?? null });
      return {
        ok: (reply.status ?? 200) < 400,
        status: reply.status ?? 200,
        statusText: '',
        text: async () => JSON.stringify(reply.json ?? {}),
      };
    };
    fetch.calls = calls;
    return fetch;
  };

  test('catalog() GETs /catalog with the bearer token and returns the document verbatim', async () => {
    const fetch = catalogFetch({ json: doc });
    const got = await hb.harborAdapter({ url: 'http://h', token: 'tok', fetch }).catalog();
    expect(got).toEqual(doc);
    expect(fetch.calls.length).toBe(1);
    expect(fetch.calls[0].url).toBe('http://h/catalog');
    expect(fetch.calls[0].method).toBe('GET');
    expect(fetch.calls[0].headers['Authorization']).toBe('Bearer tok');
    expect(fetch.calls[0].body).toBe(null);
  });

  test('a 404 names the fix — the deployment needs duckdb-harbor >= v0.9.0', async () => {
    const fetch = catalogFetch({ status: 404, json: { error: 'not found', code: 'not_found' } });
    const err = await hb.harborAdapter({ url: 'http://h', token: 't', fetch }).catalog().catch((e) => e);
    expect(err.name).toBe('ConnectionError');
    expect(err.message).toContain('/catalog');
    expect(err.message).toContain('duckdb-harbor >= v0.9.0');
    expect(err.httpStatus).toBe(404);
  });

  test('a non-404 failure keeps the ordinary taxonomy: a 401 is a ConnectionError, not an upgrade story', async () => {
    const fetch = catalogFetch({ status: 401, json: { error: 'unauthorized', code: 'unauthorized' } });
    const err = await hb.harborAdapter({ url: 'http://h', token: 'bad', fetch }).catalog().catch((e) => e);
    expect(err.name).toBe('ConnectionError');
    expect(err.message).toContain('unauthorized');
    expect(err.message).not.toContain('0.9.0');
    expect(err.httpStatus).toBe(401);
  });
});

// Harbor draws a distinction the client has to be able to express:
// an ABSENT timeoutMs takes the deployment default
// (HARBOR_STATEMENT_TIMEOUT_MS), while an EXPLICIT 0 means "no limit"
// (duckdb-harbor src/lib.rs, `None | Null => configured_statement_timeout()`).
// Those are the only two ways to have no client clock, and collapsing
// them means a deployment-wide deadline either cannot be set or cannot
// be escaped — the migration runner needs the escape, since a large
// CREATE INDEX runs for minutes while a request handler past ~30s is
// already lost.
describe('statement deadline: absent vs explicit zero', () => {
  const ok = { '/sql': { json: { columns: [], data: [], rowCount: 0 } } };
  const sent = async (adapterOpts, queryOpts) => {
    const fetch = fetchDouble(ok);
    await withFetch(fetch, () =>
      orm.__schemaConnect({ url: 'http://h', ...adapterOpts }).query('SELECT 1', null, queryOpts));
    return fetch.calls.find(c => c.url.endsWith('/sql')).body;
  };

  test('0 sends no field at all — inherit harbor\'s deployment default', async () => {
    expect(await sent({ timeoutMs: 0 })).not.toHaveProperty('timeoutMs');
  });

  test('null sends an explicit 0 — no deadline anywhere', async () => {
    expect((await sent({ timeoutMs: null })).timeoutMs).toBe(0);
  });

  test('a positive number rides to harbor as well as running here', async () => {
    expect((await sent({ timeoutMs: 4500 })).timeoutMs).toBe(4500);
  });

  test('a statement overrides the adapter, both directions', async () => {
    // harbor's protocol is per-request, so this is the same knob.
    expect((await sent({ timeoutMs: 0 }, { timeoutMs: null })).timeoutMs).toBe(0);
    expect(await sent({ timeoutMs: 9000 }, { timeoutMs: 0 })).not.toHaveProperty('timeoutMs');
    // An omitted override is not an override.
    expect((await sent({ timeoutMs: 4500 }, {})).timeoutMs).toBe(4500);
  });

  // The app default is deliberately 0 — protected by whatever the
  // operator configured — and every migration statement opts out.
  test('the ORM default inherits; the migration runner opts out', () => {
    const ormSrc = readFileSync(new URL('../../src/runtime/orm.js', import.meta.url), 'utf8');
    expect(ormSrc).toContain('timeoutMs: 0');
    const migrateSrc = readFileSync(new URL('../../src/cli/migrate.js', import.meta.url), 'utf8');
    expect(migrateSrc).toContain('const UNBOUNDED = { timeoutMs: null }');
    // Every statement goes through the one wrapper; the wrapper's own
    // definition is the single permitted mention of the raw funnel.
    const raw = migrateSrc.match(/__schemaRunSQL\(null,/g) ?? [];
    expect(raw.length).toBe(1);
    expect(migrateSrc).toContain('const runSQL = (sql, params = []) => __schemaRunSQL(null, sql, params, UNBOUNDED)');
  });
});
