// Temporal ser/de regression tests for @rip-lang/db — the Date-at-the-
// wire design (owner ruling on PORT-AUDIT finding D2, ported from v3's
// packages/db/test/temporal.test.rip). DuckDB temporal columns decode
// to real JS `Date` objects at the adapter seam, keyed by each
// column's duckdbType; `Date` parameters encode symmetrically to
// explicit ISO-8601 UTC strings, nested values included; an Invalid
// Date throws loudly.
//
// The bug the decode makes impossible: naive TIMESTAMP arrives with no
// `Z`/offset, so `new Date(value)` in app code parses it as LOCAL and
// every read shifts by the host's UTC offset. That bug is invisible on
// a UTC host, so the shift-sensitive assertions run in a subprocess
// pinned to TZ=America/Los_Angeles (a non-zero offset), the same TZ v3
// pinned. Everything runs on fetch doubles — no server.
import { describe, expect, test } from 'bun:test';
import { harborAdapter } from '@rip-lang/db';

const UTC = Date.UTC(2024, 2, 15, 10, 30, 0);

// A fetch double answering /sql (and the session endpoints) with one
// scripted harbor envelope, recording every posted body.
const harborFetch = (columns, data) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
    if (init?.method === 'DELETE') return { ok: true, status: 200, statusText: '', json: async () => ({}) };
    if (url.endsWith('/sql/sessions/new')) return { ok: true, status: 200, statusText: '', json: async () => ({ sessionId: 'sx' }) };
    return { ok: true, status: 200, statusText: '', json: async () => ({ ok: true, columns, data, rowCount: data.length }) };
  };
  fetch.calls = calls;
  return fetch;
};

// Decode one cell through the full adapter wire: harbor answers a
// single column of `duckdbType` holding `value`.
const decoded = async (duckdbType, value) => {
  const fetch = harborFetch([{ name: 'v', duckdbType, lossless: true }], [[value]]);
  const result = await harborAdapter({ url: 'http://h', fetch }).query('SELECT v');
  return result.data[0][0];
};

// Encode params through the full adapter wire: what landed in the
// posted /sql body.
const posted = async (params) => {
  const fetch = harborFetch([], []);
  await harborAdapter({ url: 'http://h', fetch }).query('INSERT INTO t VALUES (?)', params);
  return fetch.calls[0].body.params;
};

describe('read path: temporal columns decode to real Date objects', () => {
  test('naive TIMESTAMP is UTC wall-clock, decoded to a Date', async () => {
    const ts = await decoded('TIMESTAMP', '2024-03-15T10:30:00');
    expect(ts instanceof Date).toBe(true);
    expect(ts.getTime()).toBe(UTC); // no host-offset shift
  });

  test('TIMESTAMP WITH TIME ZONE already carries its zone — decoded as the instant', async () => {
    const tstz = await decoded('TIMESTAMP WITH TIME ZONE', '2024-03-15T10:30:00Z');
    expect(tstz instanceof Date).toBe(true);
    expect(tstz.getTime()).toBe(UTC);
    expect((await decoded('TIMESTAMPTZ', '2024-03-15T10:30:00Z')).getTime()).toBe(UTC); // alias spelling
  });

  test('DATE is a civil date at UTC midnight', async () => {
    const d = await decoded('DATE', '2024-03-15');
    expect(d instanceof Date).toBe(true);
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(15);
  });

  test('engine-independent normalization: space separator and bare ±HHMM offset', async () => {
    expect((await decoded('TIMESTAMP', '2024-03-15 10:30:00')).getTime()).toBe(UTC);
    expect((await decoded('TIMESTAMP WITH TIME ZONE', '2024-03-15T10:30:00-0700')).getTime())
      .toBe(Date.UTC(2024, 2, 15, 17, 30, 0));
  });

  test('duckdbType casing is tolerated', async () => {
    expect((await decoded('timestamp', '2024-03-15T10:30:00')).getTime()).toBe(UTC);
  });

  test('microseconds truncate to millisecond precision', async () => {
    expect((await decoded('TIMESTAMP', '2024-03-15T10:30:00.123456')).getTime())
      .toBe(Date.UTC(2024, 2, 15, 10, 30, 0, 123));
  });

  test('TIME has no date component: stays a string', async () => {
    expect(await decoded('TIME', '10:30:00')).toBe('10:30:00');
  });

  test('odd / unparseable values pass through unchanged — one stray cell never crashes a result set', async () => {
    expect(await decoded('TIMESTAMP', 'infinity')).toBe('infinity');
    expect(await decoded('TIMESTAMP', null)).toBe(null);
    expect(await decoded('TIMESTAMP', 'not a date')).toBe('not a date');
  });

  test('non-temporal cells in a mixed row are untouched', async () => {
    const fetch = harborFetch(
      [{ name: 'id', duckdbType: 'INTEGER', lossless: true }, { name: 'ts', duckdbType: 'TIMESTAMP', lossless: true }],
      [[7, '2024-03-15T10:30:00']]);
    const { data } = await harborAdapter({ url: 'http://h', fetch }).query('SELECT id, ts FROM t');
    expect(data[0][0]).toBe(7);
    expect(data[0][1] instanceof Date).toBe(true);
  });

  test('fast path: a result with no temporal column keeps its rows untouched', async () => {
    const fetch = harborFetch([{ name: 'n', duckdbType: 'INTEGER', lossless: true }], [[42]]);
    const { data } = await harborAdapter({ url: 'http://h', fetch }).query('SELECT n');
    expect(data).toEqual([[42]]);
  });

  test('the decode is keyed by duckdbType alone — lossless rides along and never gates it', async () => {
    // v3 never branched on lossless; pin that a lossless:false temporal
    // still decodes and the flag survives on the normalized column.
    const fetch = harborFetch([{ name: 'ts', duckdbType: 'TIMESTAMP', lossless: false }], [['2024-03-15T10:30:00']]);
    const result = await harborAdapter({ url: 'http://h', fetch }).query('SELECT ts');
    expect(result.data[0][0] instanceof Date).toBe(true);
    expect(result.columns[0].lossless).toBe(false);
  });

  test('a transaction statement decodes through the same seam', async () => {
    const fetch = harborFetch([{ name: 'ts', duckdbType: 'TIMESTAMP', lossless: true }], [['2024-03-15T10:30:00']]);
    const tx = await harborAdapter({ url: 'http://h', fetch }).begin();
    const { data } = await tx.query('SELECT ts FROM t');
    await tx.commit();
    expect(data[0][0] instanceof Date).toBe(true);
    expect(data[0][0].getTime()).toBe(UTC);
  });
});

describe('write path: Date params encode to explicit ISO-8601 UTC', () => {
  test('a Date param becomes an ISO-Z string; other scalars are untouched', async () => {
    expect(await posted([new Date(UTC), 'hello', 42, null]))
      .toEqual(['2024-03-15T10:30:00.000Z', 'hello', 42, null]);
  });

  test('a Date nested in an array or plain-object param is normalized too', async () => {
    expect(await posted([[new Date(0)], { at: new Date(0) }]))
      .toEqual([['1970-01-01T00:00:00.000Z'], { at: '1970-01-01T00:00:00.000Z' }]);
  });

  test('an Invalid Date param throws loudly instead of serializing to null', async () => {
    const fetch = harborFetch([], []);
    const adapter = harborAdapter({ url: 'http://h', fetch });
    await expect(adapter.query('INSERT INTO t VALUES (?)', [new Date('nope')]))
      .rejects.toThrow(/Invalid Date/);
    expect((await adapter.query('INSERT INTO t VALUES (?)', [new Date('nope')]).catch((e) => e)) instanceof TypeError).toBe(true);
  });

  test('a transaction statement encodes through the same seam', async () => {
    const fetch = harborFetch([], []);
    const tx = await harborAdapter({ url: 'http://h', fetch }).begin();
    await tx.query('INSERT INTO t VALUES (?)', [new Date(UTC)]);
    await tx.commit();
    const insert = fetch.calls.find((c) => c.body?.sql?.startsWith('INSERT'));
    expect(insert.body.params).toEqual(['2024-03-15T10:30:00.000Z']);
  });
});

describe('under a non-UTC host TZ (subprocess pinned to America/Los_Angeles, like v3)', () => {
  test('naive TIMESTAMP decodes to the UTC wall-clock, correcting the local-parse shift; DATE stays civil', () => {
    const script = [
      "const { harborAdapter } = await import('@rip-lang/db');",
      "const fail = (msg) => { console.error(msg); process.exit(1); };",
      "// The pinned TZ must actually be off-UTC or the shift assertions are vacuous.",
      "if (new Date('2024-03-15T10:30:00').getTimezoneOffset() === 0) fail('TZ pin did not take: offset is 0');",
      "const fetch = async (url, init) => ({ ok: true, status: 200, statusText: '', json: async () => ({ ok: true,",
      "  columns: [{ name: 'ts', duckdbType: 'TIMESTAMP', lossless: true }, { name: 'd', duckdbType: 'DATE', lossless: true }],",
      "  data: [['2024-03-15T10:30:00', '2024-03-15']], rowCount: 1 }) });",
      "const { data } = await harborAdapter({ url: 'http://h', fetch }).query('SELECT ts, d FROM t');",
      "const [ts, d] = data[0];",
      "if (!(ts instanceof Date)) fail('TIMESTAMP did not decode to a Date');",
      "if (ts.getTime() !== Date.UTC(2024, 2, 15, 10, 30, 0)) fail('TIMESTAMP shifted by the host offset: ' + ts.toISOString());",
      "// Prove the decode corrected the shift a bare `new Date` makes here.",
      "if (ts.getTime() === new Date('2024-03-15T10:30:00').getTime()) fail('decode did not differ from the naive local parse');",
      "if (!(d instanceof Date)) fail('DATE did not decode to a Date');",
      "if (d.getUTCFullYear() !== 2024 || d.getUTCMonth() !== 2 || d.getUTCDate() !== 15) fail('DATE drifted off its civil day: ' + d.toISOString());",
      "console.log('ok');",
    ].join('\n');
    // The child is a bare `bun -e` importing a .rip entry, which compiles
    // only where a bunfig preload is visible: spawn from the repo root
    // (per-package bunfigs are gone; the root's is the one loader config).
    const run = Bun.spawnSync(['bun', '-e', script], {
      cwd: new URL('../../..', import.meta.url).pathname,
      env: { ...process.env, TZ: 'America/Los_Angeles' },
    });
    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe('ok');
  });
});
