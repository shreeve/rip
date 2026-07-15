// The rip-db CLI logic — pure helpers, the /sql runner, and the
// dump/load/checkpoint commands driven over injected host seams (fetch,
// filesystem, tar, clock), so every decision path tests without a
// server or a real filesystem.
import { describe, expect, test } from 'bun:test';
import {
  resolveUrl, sqlString, safeFileStem, stamp, humanSize, unsafeTarPath,
  makeSql, currentDatabase, assertEmptyDatabase, dump, load, checkpoint,
} from '../cli.rip';

describe('pure helpers', () => {
  test('resolveUrl: explicit wins, then env, then default; slashes trimmed', () => {
    expect(resolveUrl('http://h:9494/', {})).toBe('http://h:9494');
    expect(resolveUrl(null, { RIP_DB_URL: 'http://env:9494///' })).toBe('http://env:9494');
    expect(resolveUrl(null, {})).toBe('http://127.0.0.1:9494');
  });

  test('sqlString: single-quotes and doubles embedded quotes; rejects NUL', () => {
    expect(sqlString('/tmp/x')).toBe("'/tmp/x'");
    expect(sqlString("a'b")).toBe("'a''b'");
    expect(() => sqlString('a\0b')).toThrow(/NUL/);
  });

  test('safeFileStem: sanitizes and never empties', () => {
    expect(safeFileStem('my db!')).toBe('my_db');
    expect(safeFileStem('///')).toBe('rip-db');
    expect(safeFileStem('ok.name-1')).toBe('ok.name-1');
  });

  test('stamp: YYYYMMDD-HHMMSS from an injected date', () => {
    expect(stamp(new Date(2026, 6, 14, 9, 5, 3))).toBe('20260714-090503'); // month is 0-based
  });

  test('humanSize: unit thresholds', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.0 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  test('unsafeTarPath: blocks absolute and traversal, allows normal entries', () => {
    expect(unsafeTarPath('schema.sql')).toBe(false);
    expect(unsafeTarPath('./data/x.csv')).toBe(false);
    expect(unsafeTarPath('/etc/passwd')).toBe(true);
    expect(unsafeTarPath('..')).toBe(true);
    expect(unsafeTarPath('../x')).toBe(true);
    expect(unsafeTarPath('a/../../etc')).toBe(true);
  });
});

// A fetch double scripted by SQL substring → harbor envelope (or error).
const sqlDouble = (rules = []) => {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.sql);
    const rule = rules.find(([re]) => re.test(body.sql));
    const reply = rule ? rule[1] : { ok: true, columns: [], data: [], rowCount: 0 };
    return { ok: reply.ok !== false, status: reply.ok === false ? 400 : 200, statusText: '', json: async () => reply };
  };
  fetch.calls = calls;
  return fetch;
};

describe('the /sql runner', () => {
  test('posts to /sql with the bearer token and returns the envelope', async () => {
    let seen = null;
    const fetch = async (url, init) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ ok: true, data: [[1]] }) }; };
    const sql = makeSql({ url: 'http://h:9494/', token: 'secret', fetch });
    const r = await sql('SELECT 1');
    expect(seen.url).toBe('http://h:9494/sql');
    expect(seen.headers.Authorization).toBe('Bearer secret');
    expect(seen.body).toEqual({ sql: 'SELECT 1' });
    expect(r.data).toEqual([[1]]);
  });

  test('a harbor error envelope becomes a flat message with the code', async () => {
    const fetch = sqlDouble([[/./, { ok: false, error: 'boom', errorCode: 'X' }]]);
    const sql = makeSql({ url: 'http://h', fetch });
    await expect(sql('SELECT 1')).rejects.toThrow(/\/sql failed \(X\): boom/);
  });

  test('a transport failure names the unreachable harbor', async () => {
    const fetch = async () => { throw new Error('ECONNREFUSED'); };
    const sql = makeSql({ url: 'http://h', fetch });
    await expect(sql('SELECT 1')).rejects.toThrow(/could not reach harbor at http:\/\/h/);
  });
});

describe('prechecks', () => {
  test('currentDatabase reads the scalar, defaulting to rip-db', async () => {
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/current_database/, { ok: true, data: [['shop']] }]]) });
    expect(await currentDatabase(sql)).toBe('shop');
    const empty = makeSql({ url: 'http://h', fetch: sqlDouble([[/current_database/, { ok: true, data: [] }]]) });
    expect(await currentDatabase(empty)).toBe('rip-db');
  });

  test('assertEmptyDatabase throws when any user table/view exists', async () => {
    const nonEmpty = makeSql({ url: 'http://h', fetch: sqlDouble([[/count/, { ok: true, data: [[3]] }]]) });
    await expect(assertEmptyDatabase(nonEmpty)).rejects.toThrow(/not empty \(3 user table/);
    const empty = makeSql({ url: 'http://h', fetch: sqlDouble([[/count/, { ok: true, data: [[0]] }]]) });
    await expect(assertEmptyDatabase(empty)).resolves.toBeUndefined();
  });
});

// A filesystem + tar double over an in-memory set of paths.
const hostDouble = ({ present = new Set(), dirs = new Set(), sizes = {}, tarEntries = ['schema.sql', 'load.sql'], staged = ['schema.sql', 'load.sql'] } = {}) => {
  const log = [];
  const fs = {
    exists: (p) => present.has(p),
    isDir: (p) => dirs.has(p),
    statSize: (p) => sizes[p] ?? 0,
    read: () => '', write: () => {},
    rm: (p) => log.push('rm ' + p),
  };
  const tar = {
    create: (archive, dir) => { log.push('tar.create ' + archive); present.add(archive); },
    extract: (archive, dir) => { for (const e of staged) present.add(`${dir}/${e}`); },
    list: () => tarEntries,
  };
  let n = 0;
  const tmp = () => { const d = `/tmp/ripdb-${n++}`; for (const e of staged) present.add(`${d}/${e}`); return d; };
  return { present, log, deps: (sql) => ({ sql, fs, tar, tmp, now: () => new Date(2026, 6, 14, 1, 2, 3), join: (a, b) => `${a}/${b}`, log: (m) => log.push(m) }) };
};

describe('dump', () => {
  test('auto-names <db>-<stamp>.tar.gz, EXPORTs, and tars', async () => {
    const h = hostDouble({ sizes: {} });
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/current_database/, { ok: true, data: [['shop']] }]]) });
    const msg = await dump(null, h.deps(sql));
    expect(msg).toMatch(/^wrote shop-20260714-010203\.tar\.gz/);
    expect(h.log.some((l) => l.startsWith('tar.create shop-20260714-010203.tar.gz'))).toBe(true);
  });

  test('refuses to overwrite an existing archive', async () => {
    const h = hostDouble({ present: new Set(['out.tar.gz']) });
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble() });
    await expect(dump('out.tar.gz', h.deps(sql))).rejects.toThrow(/refusing to overwrite/);
  });

  test('rejects a non-archive, non-directory path', async () => {
    const h = hostDouble();
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble() });
    await expect(dump('backup.zip', h.deps(sql))).rejects.toThrow(/must end in \.tar\.gz/);
  });

  test('fails loudly when harbor wrote its EXPORT elsewhere (empty staging)', async () => {
    const h = hostDouble({ staged: [] }); // harbor produced no local files
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/current_database/, { ok: true, data: [['s']] }]]) });
    await expect(dump('out.tar.gz', h.deps(sql))).rejects.toThrow(/expected DuckDB export files/);
  });

  test('cleans the staging dir even when EXPORT fails (harbor down)', async () => {
    const h = hostDouble();
    const sql = async () => { throw new Error('could not reach harbor at http://h'); };
    await expect(dump('out.tar.gz', h.deps(sql))).rejects.toThrow(/could not reach harbor/);
    expect(h.log.some((l) => l.startsWith('rm /tmp/ripdb-'))).toBe(true); // staging removed in the finally
  });
});

describe('load', () => {
  test('extracts and IMPORTs into an empty database', async () => {
    const h = hostDouble({ present: new Set(['snap.tar.gz']) });
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/count/, { ok: true, data: [[0]] }]]) });
    expect(await load('snap.tar.gz', h.deps(sql))).toBe('loaded snap.tar.gz');
  });

  test('refuses when the target database is not empty', async () => {
    const h = hostDouble({ present: new Set(['snap.tar.gz']) });
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/count/, { ok: true, data: [[2]] }]]) });
    await expect(load('snap.tar.gz', h.deps(sql))).rejects.toThrow(/not empty/);
  });

  test('rejects an archive containing a traversal path before extracting', async () => {
    const h = hostDouble({ present: new Set(['evil.tar.gz']), tarEntries: ['schema.sql', '../../etc/passwd'] });
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/count/, { ok: true, data: [[0]] }]]) });
    await expect(load('evil.tar.gz', h.deps(sql))).rejects.toThrow(/unsafe path in archive: \.\.\/\.\.\/etc\/passwd/);
  });

  test('rejects a missing archive', async () => {
    const h = hostDouble();
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble() });
    await expect(load('gone.tar.gz', h.deps(sql))).rejects.toThrow(/no such file/);
  });
});

describe('checkpoint', () => {
  const clock = () => new Date(2026, 0, 1, 0, 0, 0); // fixed → 0 ms elapsed

  test('plain CHECKPOINT reports completion with an elapsed time', async () => {
    const fetch = sqlDouble([[/CHECKPOINT/, { ok: true }]]);
    const sql = makeSql({ url: 'http://h', fetch });
    expect(await checkpoint(false, { sql, now: clock })).toBe('checkpoint complete (0 ms)');
    expect(fetch.calls).toEqual(['CHECKPOINT']);
  });

  test('--force runs FORCE CHECKPOINT', async () => {
    const fetch = sqlDouble([[/CHECKPOINT/, { ok: true }]]);
    const sql = makeSql({ url: 'http://h', fetch });
    expect(await checkpoint(true, { sql, now: clock })).toBe('force checkpoint complete (0 ms)');
    expect(fetch.calls).toEqual(['FORCE CHECKPOINT']);
  });

  test('a concurrent-writer failure escalates to a --force hint', async () => {
    const sql = makeSql({ url: 'http://h', fetch: sqlDouble([[/CHECKPOINT/, { ok: false, error: 'Cannot CHECKPOINT: there is an active transaction' }]]) });
    await expect(checkpoint(false, { sql, now: clock })).rejects.toThrow(/Re-run with --force/);
  });
});
