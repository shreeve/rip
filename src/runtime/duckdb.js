// The DuckDB substrate — the ONE way anything in Rip talks to DuckDB.
// This is its driver section: the HTTP wire to duckdb-harbor, the
// session lifecycle, NDJSON reading, the typed error taxonomy, and the
// temporal codec. The module is named for what it gives upstream code
// (the database), not for how it reaches it (the harbor wire service).
//
// It owns everything from the socket up to `{ columns, data, rowCount }`
// with temporals decoded and a typed error thrown: URL and token
// resolution, headers, NDJSON reading, error classification, timeouts,
// caller aborts, statement cancellation, and the session lifecycle. It
// owns nothing above that line — how a statement's TEXT is built and
// what a ROW becomes belong to whoever called it.
//
// Two consumers, one implementation: `src/runtime/orm.js` (the
// `schema :model` runtime) and `packages/db/db.rip` (the rip/db client,
// CLI and MCP server) both call into this file, so there is exactly one
// wire client — one default port, one cancellation story, one decode
// seam — across both tiers.
//
// Constraint: this is a RUNTIME module, spliced into compiled output by
// the emitter, so it may only import siblings via the './name.js' form
// and must run without the compiler present.

const DEFAULT_URL = 'http://127.0.0.1:9495';
const DEFAULT_TIMEOUT_MS = 30_000;
// How long to spend telling harbor to stop a statement we have already
// given up on. Short on purpose: the caller is owed its error now, and a
// cancel that does not land is collected by harbor's own deadline anyway.
const CANCEL_TIMEOUT_MS = 2_000;

// Explicit url wins, then RIP_DB_URL, then the default. Trailing slashes
// trimmed so `${url}/sql` never doubles.
function resolveUrl(url, env) {
  if (arguments.length < 2) env = (typeof process !== 'undefined' && process.env) || {};
  return String(url || (env || {}).RIP_DB_URL || DEFAULT_URL).replace(/\/+$/, '');
}

// The URL as it may be SAID. `http://user:secret@host` is a legal
// harbor URL and it reaches error messages, which reach logs — so
// userinfo is stripped for display. Only the display form is redacted;
// the URL that is dialled is untouched.
function displayUrl(url) {
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1<redacted>@');
}

function envToken() {
  return (typeof process !== 'undefined' && process.env) ? process.env.RIP_DB_TOKEN : null;
}

// ── The typed error hierarchy ────────────────────────────────────────
//
// Extra fields — httpStatus on any DbError, and code/details/sql on a
// QueryError — are stamped at the throw site. CancelledError is a
// DbError too, so one `isDbError` catch covers transport, engine, and
// cancellation alike.

class DbError extends Error {
  constructor(message) { super(message); this.name = 'DbError'; }
}
class ConnectionError extends DbError {
  constructor(message) { super(message); this.name = 'ConnectionError'; }
}
class QueryError extends DbError {
  constructor(message) { super(message); this.name = 'QueryError'; }
}
// `code` says WHO cancelled: 'ABORTED' is the caller's own signal,
// and harbor's own code (e.g. 'cancelled' from a statement deadline)
// wins when harbor supplied one — the two are different events and a
// deployment with HARBOR_STATEMENT_TIMEOUT_MS set needs to tell them
// apart to diagnose anything.
class CancelledError extends DbError {
  constructor(message, code = 'ABORTED') {
    super(message);
    this.name = 'CancelledError';
    this.code = code;
  }
}

function isDbError(value) { return value instanceof DbError; }

// ── Temporal values at the wire ──────────────────────────────────────
//
// DuckDB temporal columns decode to real JS `Date` objects here — the
// ONE decode seam. A naive TIMESTAMP is defined as UTC wall-clock and
// gets its `Z` appended, so a result never shifts with the host's
// offset. On the way out a `Date` becomes an ISO-8601 UTC string
// (nested Dates inside arrays and structs included), because JSON has
// no date type; DuckDB's implicit VARCHAR cast reads it back.

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
const HAS_ZONE = /([Zz]|[+-]\d{2}:?\d{2})$/;

// 'utc' naive wall-clock we define as UTC -> append `Z`, then parse
// 'instant' already carries `Z`/offset (TIMESTAMPTZ) -> parse as-is
// 'civil' date-only -> parse as-is (UTC midnight)
// null not a type we decode (TIME, INTERVAL, scalars, nested) -> leave
function temporalKind(duckdbType) {
  switch (String(duckdbType ?? '').trim().toUpperCase()) {
    case 'TIMESTAMP': case 'TIMESTAMP_S': case 'TIMESTAMP_MS':
    case 'TIMESTAMP_NS': case 'DATETIME':
      return 'utc';
    case 'TIMESTAMP WITH TIME ZONE': case 'TIMESTAMPTZ':
      return 'instant';
    case 'DATE':
      return 'civil';
    default:
      return null;
  }
}

// Null, non-strings, non-ISO shapes, and anything that fails to parse
// return unchanged, so a column's type stays stable except for genuine
// temporal values. Sub-millisecond precision is not preserved.
function decodeTemporal(value, kind) {
  if (!kind || typeof value !== 'string' || !ISO_SHAPE.test(value)) return value;
  // Canonicalize to ISO 8601 so parsing is engine-independent: ` ` ->
  // `T` date/time separator, a bare `±HHMM` offset -> `±HH:MM`.
  let iso = value.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (kind === 'utc' && !HAS_ZONE.test(iso)) iso = `${iso}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date;
}

// Whole-result decode in one pass. Fast path: when no column is
// temporal the rows are returned untouched, with no row copy.
function decodeRows(columns, rows) {
  const kinds = (columns ?? []).map((c) => temporalKind(c?.duckdbType ?? c?.type));
  if (!kinds.some((k) => k)) return rows;
  return rows.map((row) => row.map((v, i) => (kinds[i] ? decodeTemporal(v, kinds[i]) : v)));
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

// A value JSON would silently turn into `null` is a caller bug, and
// binding NULL for it means writing something the caller never asked
// for. All of them throw loudly here, for the one reason: an Invalid
// Date, NaN, ±Infinity, and `undefined` all serialize to `null`, and
// the difference between "no value" and "the value NULL" is not
// something a database can recover afterwards.
function encodeParam(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) {
      throw new TypeError('db: cannot bind an Invalid Date as a query parameter');
    }
    return v.toISOString();
  }
  if (v === undefined) {
    throw new TypeError(
      'db: cannot bind `undefined` as a query parameter — JSON drops it to null; ' +
      'pass null if the value really is SQL NULL');
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new TypeError(
      'db: cannot bind ' + (Number.isNaN(v) ? 'NaN' : String(v)) +
      ' as a query parameter — JSON turns it into null, which would write ' +
      'SQL NULL for a number the caller computed');
  }
  if (typeof v === 'bigint') {
    throw new TypeError(
      'db: cannot bind a BigInt as a query parameter — JSON cannot serialize it. ' +
      'Bind a Number if the value is within 2^53, or a string for an exact ' +
      'BIGINT/HUGEINT literal');
  }
  if (Array.isArray(v)) return v.map(encodeParam);
  if (isPlainObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) out[k] = encodeParam(v[k]);
    return out;
  }
  return v;
}

function encodeParams(params) { return params.map(encodeParam); }

// ── Reading harbor's wire ────────────────────────────────────────────
//
// `/sql` answers in newline-delimited JSON, not one JSON document: a
// `schema` line, one `row` line per row, then `end` — or a single
// `error` line, which is also the body of every non-200. Streaming is
// the point (harbor writes rows as DuckDB produces them), and it means
// `response.json()` cannot read a result at all: two lines in, the
// parse fails.
//
// Only `sql_error` and `unsupported_type` are engine domains and travel
// as `errorCode`, so they classify as QueryError; `unauthorized`,
// `not_found` and the rest are availability problems and fall through
// to ConnectionError.

const ENGINE_ERROR_CODES = ['sql_error', 'unsupported_type'];

function parseNdjson(text) {
  const env = { columns: [], data: [] };
  let sawEnd = false;
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg = null;
    try { msg = JSON.parse(trimmed); } catch { msg = null; }
    if (!isPlainObject(msg)) continue;
    switch (msg.type) {
      case 'schema':
        env.columns = msg.columns ?? [];
        break;
      case 'row':
        env.data.push(msg.values ?? []);
        break;
      case 'end':
        sawEnd = true;
        env.rowCount = msg.rowCount;
        break;
      case 'error':
        env.error = msg.message ?? 'db request failed';
        // Two fields, because they answer different questions.
        // `errorCode` decides the error CLASS and is engine-only.
        // `harborCode` is whatever harbor said, and rides along so a
        // caller can tell a busy pool from a bad token without parsing
        // prose.
        if (msg.code != null) env.harborCode = msg.code;
        if (ENGINE_ERROR_CODES.includes(msg.code)) env.errorCode = msg.code;
        break;
      default:
        break;
    }
  }
  // A result ends with `end`, and harbor omits it in exactly one case:
  // the stream broke. That omission is the only signal that can survive
  // a dead socket, so its absence IS the truncation report. Without
  // this the rows that did arrive would be handed back as though they
  // were all of them — the one failure a result reader must never have.
  // An `error` line is its own terminator and already says what happened.
  if (!sawEnd && env.error == null) {
    env.error = 'db: the result stream ended without its terminator, so the result is incomplete';
    env.harborCode = 'truncated';
  }
  env.rowCount ??= env.data.length;
  return env;
}

// One JSON object with no `type` is a body to read verbatim — `/ready`,
// a session open, and every fetch double in the test suites. Anything
// else is NDJSON.
function parseBody(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return {};
  let once;
  try { once = JSON.parse(trimmed); } catch { once = undefined; }
  if (isPlainObject(once) && once.type == null) return once;
  return parseNdjson(trimmed);
}

// Await a promise while honoring an AbortSignal: reject with the abort
// reason the moment it fires, even when the injected fetch ignores its
// signal — a hung socket can never outlive the deadline.
function abortable(signal, promise) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn) => (value) => {
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    promise.then(settle(resolve), settle(reject));
    if (signal.aborted) onAbort();
  });
}

// ── Naming a statement so it can be stopped ──────────────────────────
//
// A statement that has entered DuckDB does not come back until it is
// done, and harbor runs a bounded number at once — so abandoning a
// query locally releases nothing. The wire abort only stops us
// listening; the connection stays out of service until the statement
// finishes on its own. Naming it is what makes it stoppable.
//
// Harbor takes the id from the caller rather than issuing one, and it
// has to: its reply does not begin until the statement is streaming or
// done, so an id in the response would arrive far too late to cancel
// anything. It answers 409 while a statement of that name is running,
// so the id must be fresh per request rather than stable per caller.
let _queryN = 0;
function newQueryId() {
  _queryN = (_queryN + 1) % 1_000_000;
  return `rip-${_queryN.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Harbor's success envelope → the public result shape. Each column is
// normalized to `{ name, type }` (aliasing `duckdbType`) with harbor's
// per-column extras preserved; a bare-string column degrades to
// `{ name }` rather than spreading into char indices; temporal cells
// decode per the column type. A write with no result set arrives as
// empty columns and data.
function toColumn(c) {
  return typeof c === 'string' ? { name: c } : { ...c, type: c.duckdbType ?? c.type };
}

function toResult(env) {
  const columns = (env?.columns ?? []).map(toColumn);
  return {
    columns,
    data: decodeRows(columns, env?.data ?? []),
    rowCount: env?.rowCount ?? (env?.data?.length ?? 0),
  };
}

/**
 * An Adapter Contract v2 value — `{ query, begin, catalog,
 * capabilities }` — speaking to duckdb-harbor over HTTP.
 *
 * @param {object} [opts]
 * @param {string} [opts.url]        harbor base URL; else RIP_DB_URL, else the default
 * @param {string} [opts.token]      bearer token; else RIP_DB_TOKEN
 * @param {Function} [opts.fetch]    injected fetch (tests)
 * @param {number|null} [opts.timeoutMs] per-statement deadline, ours AND harbor's.
 *   Three states, and the difference between the last two matters:
 *     > 0   — run a client clock and send the same deadline to harbor
 *     0     — no client clock; INHERIT harbor's deployment default
 *             (HARBOR_STATEMENT_TIMEOUT_MS), by sending no field at all
 *     null  — no client clock and NO deadline anywhere: sends an
 *             explicit 0, which harbor reads as "no limit". This is the
 *             documented way to opt a long statement (a migration) out
 *             of a deployment-wide default.
 *   Any statement may override the adapter's choice per call:
 *   `query(sql, params, { timeoutMs })` — harbor's own protocol is
 *   per-request, so this is the same knob, not a second one.
 */
function harborAdapter(opts = {}) {
  const base = resolveUrl(opts.url);
  // What error messages may say — never the credentials in the URL.
  const shown = displayUrl(base);
  const token = opts.token ?? envToken();
  const fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  // `??` would fold `null` into the default, and `null` is meaningful
  // here — it is the opt-out. Only an absent option takes the default.
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;

  // `Accept: application/x-ndjson`, explicitly, even though the reader
  // handles either shape. Harbor also offers the whole result as one
  // JSON document — but that shape cannot be flushed as it is built, so
  // it carries a size ceiling and refuses past it with a 406. Streaming
  // has no ceiling. This adapter buffers the response anyway, so
  // one-shot would buy it nothing but a query that works until the day
  // the table gets big.
  const headers = () => {
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  // Best effort, and deliberately not awaited by the caller's error
  // path: the caller is owed its failure now. Cancelling a statement
  // that already finished is `{"cancelled":false}`, not an error, so a
  // late cancel costs nothing. Never rejects.
  const stopStatement = async (queryId) => {
    if (queryId == null) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CANCEL_TIMEOUT_MS);
      try {
        await abortable(ctrl.signal, fetchFn(`${base}/sql/queries/${encodeURIComponent(queryId)}`, {
          method: 'DELETE',
          headers: headers(),
          signal: ctrl.signal,
        }));
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // nothing to do: the deadline on harbor's side collects it
    }
  };

  const request = async (method, path, body, sql = null, signal = null, timeoutOverride) => {
    // Every statement is named, and carries our deadline to the server
    // as well as enforcing it here. A client that times out without
    // telling harbor leaves behind exactly the runaway a deadline
    // exists to kill.
    //
    // `undefined` means the caller did not override, so the adapter's
    // own setting applies. Absent-vs-explicit-zero on the wire is a
    // real distinction harbor draws (an absent field takes the
    // deployment default, an explicit 0 means no limit), so the two
    // "no client clock" states must not collapse into one here.
    const deadline = timeoutOverride === undefined ? timeoutMs : timeoutOverride;
    let queryId = null;
    if (path === '/sql') {
      queryId = newQueryId();
      body = { ...body, queryId };
      if (deadline > 0) body.timeoutMs = deadline;
      else if (deadline === null) body.timeoutMs = 0;
    }
    const ctrl = new AbortController();
    let timedOut = false;
    let timer = null;
    if (deadline > 0) {
      timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, deadline);
    }
    const relay = () => ctrl.abort(signal.reason);
    if (signal) {
      if (signal.aborted) relay();
      else signal.addEventListener('abort', relay, { once: true });
    }
    try {
      let response = null;
      try {
        response = await abortable(ctrl.signal, fetchFn(`${base}${path}`, {
          method,
          headers: headers(),
          ...(body != null ? { body: JSON.stringify(body) } : {}),
          signal: ctrl.signal,
        }));
      } catch (cause) {
        // Classify: our own timer fired (TIMEOUT), the caller's signal
        // fired (ABORTED), or the transport itself failed. All are
        // ConnectionError so a retry loop catches the family; `code`
        // tells them apart.
        let error;
        if (timedOut) {
          error = new ConnectionError(`db: harbor at ${shown} timed out after ${deadline}ms`);
          error.code = 'TIMEOUT';
        } else if (signal?.aborted) {
          error = new ConnectionError('db: harbor request aborted by the caller');
          error.code = 'ABORTED';
        } else {
          error = new ConnectionError(`db: harbor at ${shown} is unreachable: ${cause.message}`);
        }
        // We stopped listening; the statement did not stop running. Say
        // so to harbor, or the connection stays out of service until
        // the query finishes on its own. Not awaited.
        if (timedOut || signal?.aborted) stopStatement(queryId);
        error.cause = cause;
        throw error;
      }
      // `text` then parse, because a result is NDJSON. A double that
      // only implements `json` is still read that way.
      //
      // A body that cannot be read at all is not an empty result:
      // reading it is the whole of how a complete answer is told from a
      // truncated one. But only raise when the status claimed success,
      // since a non-2xx already has its own story.
      let data = {};
      let unread = null;
      try {
        data = typeof response.text === 'function'
          ? parseBody(await response.text())
          : await response.json();
      } catch (cause) {
        data = {};
        unread = cause;
      }
      if (unread != null && response.ok) {
        const error = new ConnectionError(
          `db: harbor at ${shown} sent a response that could not be read: ${unread.message}`);
        error.cause = unread;
        error.httpStatus = response.status;
        throw error;
      }
      if (!response.ok || data.ok === false || data.error != null) {
        const message = (data.error || `db request failed: ${response.status} ${response.statusText ?? ''}`).trim();
        // Classify by DOMAIN, not by whether SQL was present: the engine
        // rejecting a statement carries an errorCode (a QueryError),
        // while an HTTP failure with no engine code is an availability
        // problem (a ConnectionError) — so a retry loop keyed on
        // ConnectionError catches a 5xx during a query.
        let error;
        if (response.status === 499 || data.harborCode === 'cancelled') {
          // Someone stopped this statement — our deadline reaching
          // harbor, this caller's signal, or another client holding the
          // same id. Same event as a local abort, same type.
          error = new CancelledError(message, data.harborCode ?? 'ABORTED');
        } else if (data.errorCode != null) {
          error = new QueryError(message);
          error.code = data.errorCode;
          if (data.errorDetails != null) error.details = data.errorDetails;
        } else if (!response.ok) {
          error = new ConnectionError(message);
        } else {
          error = new QueryError(message);
        }
        if (sql != null) error.sql = sql;
        error.httpStatus = response.status;
        if (data.harborCode != null) error.code ??= data.harborCode;
        // Harbor sends Retry-After when the wait is knowable — a
        // transaction pool with nothing free. Honouring the server's
        // number beats inventing a backoff that is either too eager or
        // too patient.
        // ABSENT is not zero. `Number(null)` is 0, which passed the
        // finite check and stamped `retryAfterMs = 0` on EVERY error —
        // and a client testing `if error.retryAfterMs?` sees 0 as
        // present, so it obeys a server instruction the server never
        // gave and skips its own backoff entirely. Read the header
        // first; only a header that is actually there speaks.
        let raw = null;
        try { raw = response.headers?.get?.('Retry-After') ?? null; } catch { raw = null; }
        if (raw != null && String(raw).trim() !== '') {
          const after = Number(raw);
          if (Number.isFinite(after) && after >= 0) error.retryAfterMs = after * 1000;
        }
        throw error;
      }
      return data;
    } finally {
      if (timer != null) clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  };

  const query = async (sql, params = null, opts = {}) =>
    toResult(await request('POST', '/sql', params?.length ? { sql, params: encodeParams(params) } : { sql },
      sql, opts?.signal, opts?.timeoutMs));

  // The deployed schema in ONE authenticated call — `GET /catalog`
  // (duckdb-harbor >= 0.9.0): tables with columns, primary keys,
  // genuine CREATE INDEX indexes, STRUCTURAL foreign keys, and
  // sequences, as a stable JSON contract that never varies with the
  // DuckDB version harbor links. The read rides the same bearer
  // headers, body machinery, and error taxonomy as every other
  // request. A 404 gets its own words, because it means the
  // deployment predates the endpoint — the fix is an upgrade, never
  // a retry.
  const catalog = async (opts = {}) => {
    try {
      return await request('GET', '/catalog', null, null, opts?.signal, opts?.timeoutMs);
    } catch (error) {
      if (error?.httpStatus === 404) {
        const upgrade = new ConnectionError(
          `db: harbor at ${shown} has no /catalog endpoint — reading the deployed schema takes ` +
          'one GET /catalog call, which needs duckdb-harbor >= v0.9.0. Upgrade that deployment.');
        upgrade.httpStatus = 404;
        upgrade.cause = error;
        throw upgrade;
      }
      throw error;
    }
  };

  const begin = async (options = {}) => {
    const session = await request('POST', '/sql/sessions/new', {});
    const sessionId = session.sessionId;
    // No session id means no isolation — refuse loudly rather than run
    // BEGIN/COMMIT as independent autocommit statements on the pool.
    if (sessionId == null) {
      throw new DbError('db: harbor returned no session id for the transaction');
    }
    const run = async (sql, params = null, opts = {}) => toResult(await request(
      'POST', '/sql',
      params?.length ? { sql, params: encodeParams(params), sessionId } : { sql, sessionId },
      sql, opts?.signal, opts?.timeoutMs));
    const drop = async () => {
      // Best-effort: harbor's idle TTL reaps an abandoned session, so a
      // failed DELETE only delays cleanup, never leaks a transaction.
      // The same deadline applies — a hung harbor must not wedge the
      // finally block of a COMMIT that already timed out.
      try {
        const ctrl = new AbortController();
        const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        try {
          await abortable(ctrl.signal, fetchFn(`${base}/sql/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: headers(),
            signal: ctrl.signal,
          }));
        } finally {
          if (timer != null) clearTimeout(timer);
        }
      } catch {
        // the idle TTL collects it
      }
    };
    // A failed BEGIN would otherwise orphan the freshly-created session
    // with no handle for the caller to clean up — drop it here.
    try {
      await run('BEGIN');
    } catch (error) {
      await drop();
      throw error;
    }
    return {
      query: run,
      // drop in a finally on both paths: a failed COMMIT still releases
      // the open transaction now, not at the idle TTL.
      commit: async () => {
        try { await run('COMMIT'); } finally { await drop(); }
      },
      rollback: async () => {
        try { await run('ROLLBACK'); } finally { await drop(); }
      },
    };
  };

  return {
    query,
    begin,
    // Presence IS the capability, exactly as with begin(): the
    // migration runner tests `typeof adapter.catalog === 'function'`.
    catalog,
    // DuckDB rolls DDL back with the transaction, so the migration
    // runner may claim a whole-file rollback.
    capabilities: { tx: true, ddlTransactional: true },
  };
}

export {
  harborAdapter, resolveUrl, envToken, toResult,
  DbError, ConnectionError, QueryError, CancelledError, isDbError,
  temporalKind, decodeTemporal, decodeRows, encodeParam, encodeParams,
  parseNdjson, parseBody, isPlainObject, abortable,
  DEFAULT_URL, DEFAULT_TIMEOUT_MS,
};
