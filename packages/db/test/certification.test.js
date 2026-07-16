// @rip-lang/db — certification (F6). One suite asserting the completion
// definition for the whole DB stage: the public surface is exactly what
// is documented, the typed contracts hold, the adapter conforms to the
// Contract-v2 the ORM and migration runner depend on, and the
// concurrency/failure behaviors (session isolation, rollback, typed
// transport errors, cancellation) hold under adversarial doubles. The
// per-module behavior is proved in adapter/client/orm-integration/
// migrate-integration; this suite pins the stage as a whole.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as db from '@rip-lang/db';
import * as embed from '@rip-lang/db/embed';
import * as mcp from '@rip-lang/db/mcp';
import { ConnectionError, QueryError, CancelledError, harborAdapter, createClient } from '@rip-lang/db';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

describe('public surface', () => {
  test('the root entry exports exactly the documented named surface', () => {
    expect(Object.keys(db).sort()).toEqual([
      'CancelledError', 'ConnectionError', 'DbError', 'QueryError',
      'createClient', 'harborAdapter', 'isDbError',
    ]);
    expect('default' in db).toBeFalse();
    expect('introspect' in db).toBeFalse(); // introspection is the runner's job, via query
  });

  test('the subpath entries export exactly their surfaces', () => {
    expect(Object.keys(embed).sort()).toEqual(['assertReachable', 'ensureRunning']);
    expect(Object.keys(mcp).sort()).toEqual(['createMcpServer', 'makeSql', 'startStdio']);
  });

  test('every public entry is a Rip module', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.exports).toEqual({
      '.': './index.rip',
      './embed': './embed.rip',
      './mcp': './mcp.rip',
    });
  });
});

describe('package hygiene', () => {
  const pkg = () => JSON.parse(read('package.json'));

  test('no dependency fields — the harbor endpoint is external and never vendored', () => {
    for (const f of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(pkg()[f]).toBeUndefined();
    }
  });

  test('server-only: browser safety is never declared', () => {
    expect(pkg().rip).toBeUndefined();
  });

  test('the pure lane touches no host runtime beyond the injectable fetch', () => {
    // adapter/client/index are the library core; the operational entries
    // (cli/mcp/embed/bin) are host-coupled by design and excluded.
    for (const module of ['adapter.rip', 'client.rip', 'index.rip']) {
      expect(read(module)).not.toMatch(/\bBun\.|node:|process\./);
    }
    expect(read('adapter.rip')).not.toMatch(/import .* from/); // self-contained
  });

  test('no certificate or private key is committed to the package', () => {
    // The harbor endpoint owns TLS; the client never carries key material.
    const combined = ['adapter.rip', 'client.rip', 'cli.rip', 'mcp.rip', 'embed.rip'].map(read).join('\n');
    expect(combined).not.toMatch(/BEGIN (RSA |EC )?PRIVATE KEY|BEGIN CERTIFICATE/);
  });
});

// A fetch double speaking harbor's wire: sessions get distinct ids, /sql
// is scripted by SQL, and a status can be forced.
const harborFetch = (opts = {}) => {
  const { status = 200, reply = { ok: true, columns: [], data: [], rowCount: 0 }, onError } = opts;
  let session = 0;
  const calls = [];
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? 'GET', sql: body?.sql ?? null, sessionId: body?.sessionId ?? null });
    if (init?.method === 'DELETE') return { ok: true, status: 200, json: async () => ({}) };
    if (url.endsWith('/sql/sessions/new')) return { ok: true, status: 200, json: async () => ({ sessionId: `sess-${++session}` }) };
    if (onError) return onError(body?.sql ?? '');
    return { ok: status < 400, status, statusText: '', json: async () => reply };
  };
  fetch.calls = calls;
  return fetch;
};

describe('adapter contract (Contract-v2)', () => {
  test('harborAdapter implements query + begin + capabilities, and NOT introspect', () => {
    const a = harborAdapter({ url: 'http://h', fetch: harborFetch() });
    expect(typeof a.query).toBe('function');
    expect(typeof a.begin).toBe('function');
    expect(a.capabilities).toEqual({ tx: true, ddlTransactional: true });
    expect('introspect' in a).toBe(false);
  });

  test('the error taxonomy is one hierarchy under DbError', async () => {
    expect(new QueryError('x') instanceof db.DbError).toBe(true);
    expect(new ConnectionError('x') instanceof db.DbError).toBe(true);
    expect(db.isDbError(new QueryError('x'))).toBe(true);
    expect(db.isDbError(new Error('x'))).toBe(false);
  });
});

describe('concurrency and failure', () => {
  test('two transactions each pin their own harbor session — no cross-talk', async () => {
    const fetch = harborFetch();
    const adapter = harborAdapter({ url: 'http://h', fetch });
    const [txA, txB] = await Promise.all([adapter.begin(), adapter.begin()]);
    await txA.query('INSERT INTO a VALUES (1)');
    await txB.query('INSERT INTO b VALUES (2)');
    const sidA = fetch.calls.find((c) => c.sql === 'INSERT INTO a VALUES (1)').sessionId;
    const sidB = fetch.calls.find((c) => c.sql === 'INSERT INTO b VALUES (2)').sessionId;
    expect(sidA).not.toBe(sidB); // isolated sessions
    await txA.commit();
    await txB.rollback();
    expect(fetch.calls.filter((c) => c.method === 'DELETE').length).toBe(2); // both sessions dropped
  });

  test('a 5xx during a query is a retryable ConnectionError, not a QueryError', async () => {
    const fetch = harborFetch({ status: 503, reply: { error: 'harbor down' } });
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT 1').catch((e) => e);
    expect(err instanceof ConnectionError).toBe(true);
    expect(err.httpStatus).toBe(503);
  });

  test('an engine error is a QueryError carrying its code and offending sql', async () => {
    const fetch = harborFetch({ reply: { ok: false, error: 'boom', errorCode: 'PARSE_ERROR' } });
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT bad').catch((e) => e);
    expect(err instanceof QueryError).toBe(true);
    expect(err.code).toBe('PARSE_ERROR');
    expect(err.sql).toBe('SELECT bad');
  });

  test('a transport failure surfaces as a typed DbError, never a raw fetch throw', async () => {
    const fetch = async () => { throw new TypeError('ECONNREFUSED'); };
    const err = await harborAdapter({ url: 'http://h', fetch }).query('SELECT 1').catch((e) => e);
    expect(db.isDbError(err)).toBe(true);
  });

  test('an in-flight cancellation rejects the client with a CancelledError', async () => {
    const controller = new AbortController();
    const adapter = { query: () => new Promise(() => {}), capabilities: {} };
    const pending = createClient(adapter).query('SELECT pg_sleep(9)', [], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
  });
});
