// In-memory Contract-v2 recording adapter — the persistence test
// seam (no database, no dependency; ). Records every statement
// (`calls`: {sql, params, tx?}) and answers from rule handlers
// (first regex match wins) or the empty default. `begin()` returns a
// TxHandle whose statements record with `tx: true` and whose
// COMMIT/ROLLBACK land in the call log as sentinel rows, so
// transaction tests can assert the full statement stream.
export function recordingAdapter() {
  const calls = [];
  const rules = [];
  const answer = (sql, params) => {
    for (const r of rules) {
      if (r.re.test(sql)) return typeof r.handler === 'function' ? r.handler(sql, params) : r.handler;
    }
    return { columns: [], data: [], rowCount: 0 };
  };
  const adapter = {
    calls,
    on(re, handler) { rules.push({ re, handler }); return adapter; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      return answer(sql, params);
    },
    async begin() {
      calls.push({ sql: '<BEGIN>', params: [] });
      return {
        async query(sql, params = []) {
          calls.push({ sql, params, tx: true });
          return answer(sql, params);
        },
        async commit() { calls.push({ sql: '<COMMIT>', params: [] }); },
        async rollback() { calls.push({ sql: '<ROLLBACK>', params: [] }); },
      };
    },
    capabilities: { tx: true },
  };
  return adapter;
}

// A {columns, data, rowCount} response echoing one row — the shape
// INSERT … RETURNING and SELECT answers share.
export const row = (cols, values) => ({
  columns: cols.map((name) => ({ name })),
  data: [values],
  rowCount: 1,
});

export const rows = (cols, ...valueRows) => ({
  columns: cols.map((name) => ({ name })),
  data: valueRows,
  rowCount: valueRows.length,
});
