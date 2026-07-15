// The MCP protocol core: createMcpServer({ sql }) → dispatch(msg),
// exercised with a fake sql runner (no stdio, no server). Covers the
// JSON-RPC methods, the three tools, result shaping/truncation, and the
// error paths.
import { describe, expect, test } from 'bun:test';
import { createMcpServer } from '@rip-lang/db/mcp';

// A fake sql runner scripted by SQL substring → harbor envelope.
const fakeSql = (rules = []) => async (query) => {
  const rule = rules.find(([re]) => re.test(query));
  return rule ? rule[1] : { ok: true, columns: [], data: [] };
};
const parse = (s) => JSON.parse(s);
const toolResult = (reply) => JSON.parse(parse(reply).result.content[0].text);

describe('JSON-RPC methods', () => {
  test('initialize returns the protocol version, capabilities, and server info', async () => {
    const { dispatch } = createMcpServer({ sql: fakeSql() });
    const r = parse(await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    expect(r.result.protocolVersion).toBe('2024-11-05');
    expect(r.result.capabilities).toEqual({ tools: {} });
    expect(r.result.serverInfo).toEqual({ name: 'rip-db-mcp', version: '2.1.0' });
    expect(typeof r.result.instructions).toBe('string');
  });

  test('tools/list returns the three tools with their schemas', async () => {
    const { dispatch } = createMcpServer({ sql: fakeSql() });
    const r = parse(await dispatch({ id: 2, method: 'tools/list' }));
    expect(r.result.tools.map((t) => t.name)).toEqual(['execute_query', 'list_tables', 'list_columns']);
    expect(r.result.tools[0].inputSchema.required).toEqual(['sql']);
  });

  test('notifications/initialized produces no reply', async () => {
    const { dispatch } = createMcpServer({ sql: fakeSql() });
    expect(await dispatch({ method: 'notifications/initialized' })).toBeNull();
  });

  test('an unknown method with an id is a -32601 error; without an id it is silent', async () => {
    const { dispatch } = createMcpServer({ sql: fakeSql() });
    const r = parse(await dispatch({ id: 9, method: 'ping' }));
    expect(r.error).toEqual({ code: -32601, message: 'Unknown method: ping' });
    expect(await dispatch({ method: 'some/notification' })).toBeNull();
  });
});

describe('execute_query', () => {
  const call = (dispatch, args) => dispatch({ id: 1, method: 'tools/call', params: { name: 'execute_query', arguments: args } });

  test('shapes a successful result with columns, types, rows, and rowCount', async () => {
    const sql = fakeSql([[/SELECT/, { ok: true, columns: [{ name: 'id', duckdbType: 'INTEGER' }, { name: 'n', duckdbType: 'VARCHAR' }], data: [[1, 'a'], [2, 'b']] }]]);
    const { dispatch } = createMcpServer({ sql });
    const out = toolResult(await call(dispatch, { sql: 'SELECT id, n FROM t' }));
    expect(out).toMatchObject({ success: true, columns: ['id', 'n'], columnTypes: ['INTEGER', 'VARCHAR'], rows: [[1, 'a'], [2, 'b']], rowCount: 2 });
  });

  test('missing sql parameter is a tool error (isError true)', async () => {
    const { dispatch } = createMcpServer({ sql: fakeSql() });
    const reply = parse(await call(dispatch, {}));
    expect(reply.result.isError).toBe(true);
    expect(toolResult(await call(dispatch, {})).error).toMatch(/Missing sql/);
  });

  test('a harbor error envelope surfaces as a failed tool result', async () => {
    const sql = fakeSql([[/./, { ok: false, error: 'syntax error', errorCode: 'PARSE_ERROR' }]]);
    const { dispatch } = createMcpServer({ sql });
    const raw = await call(dispatch, { sql: 'SELCT 1' });
    expect(parse(raw).result.isError).toBe(true);
    expect(toolResult(raw)).toEqual({ success: false, error: 'syntax error', errorCode: 'PARSE_ERROR' });
  });

  test('a result over the row cap is truncated with a warning', async () => {
    const data = Array.from({ length: 2000 }, (_, i) => [i]);
    const sql = fakeSql([[/SELECT/, { ok: true, columns: [{ name: 'id' }], data }]]);
    const { dispatch } = createMcpServer({ sql });
    const out = toolResult(await call(dispatch, { sql: 'SELECT id FROM big' }));
    expect(out.rowCount).toBe(1024);
    expect(out.truncated).toBe(true);
    expect(out.warning).toMatch(/limited to 1024 rows/);
  });

  test('a result over the byte cap is shrunk until it fits', async () => {
    const wide = 'x'.repeat(500);
    const data = Array.from({ length: 500 }, () => [wide]); // ~250KB
    const sql = fakeSql([[/SELECT/, { ok: true, columns: [{ name: 'c' }], data }]]);
    const { dispatch } = createMcpServer({ sql });
    const out = toolResult(await call(dispatch, { sql: 'SELECT c FROM wide' }));
    expect(out.rowCount).toBeLessThan(500);
    expect(out.truncated).toBe(true);
    expect(out.warning).toMatch(/50KB/);
  });

  test('a single row that alone exceeds the byte cap is returned but flagged truncated', async () => {
    const huge = 'x'.repeat(200000); // one ~200KB row, unshrinkable
    const sql = fakeSql([[/SELECT/, { ok: true, columns: [{ name: 'c' }], data: [[huge]] }]]);
    const { dispatch } = createMcpServer({ sql });
    const out = toolResult(await call(dispatch, { sql: 'SELECT c FROM one' }));
    expect(out.rowCount).toBe(1);
    expect(out.truncated).toBe(true); // honest flag, not a silent over-budget payload
    expect(out.warning).toMatch(/single row exceeds/);
  });
});

describe('list_tables and list_columns', () => {
  test('list_tables maps rows to objects and counts tables vs views', async () => {
    const sql = fakeSql([[/duckdb_tables/, {
      ok: true,
      columns: [{ name: 'schema' }, { name: 'name' }, { name: 'type' }, { name: 'comment' }],
      data: [['main', 'users', 'table', null], ['main', 'active', 'view', 'a view']],
    }]]);
    const { dispatch } = createMcpServer({ sql });
    const out = toolResult(await dispatch({ id: 1, method: 'tools/call', params: { name: 'list_tables' } }));
    expect(out.tables).toEqual([{ schema: 'main', name: 'users', type: 'table', comment: null }, { schema: 'main', name: 'active', type: 'view', comment: 'a view' }]);
    expect(out.tableCount).toBe(1);
    expect(out.viewCount).toBe(1);
  });

  test('list_columns requires a table and maps the column rows', async () => {
    const sql = fakeSql([[/duckdb_columns/, {
      ok: true,
      columns: [{ name: 'name' }, { name: 'type' }, { name: 'nullable' }, { name: 'comment' }],
      data: [['id', 'INTEGER', false, null], ['email', 'VARCHAR', true, null]],
    }]]);
    const { dispatch } = createMcpServer({ sql });
    const out = toolResult(await dispatch({ id: 1, method: 'tools/call', params: { name: 'list_columns', arguments: { table: 'users' } } }));
    expect(out).toMatchObject({ success: true, table: 'users', columnCount: 2 });
    expect(out.columns[0]).toEqual({ name: 'id', type: 'INTEGER', nullable: false, comment: null });

    const missing = toolResult(await dispatch({ id: 2, method: 'tools/call', params: { name: 'list_columns', arguments: {} } }));
    expect(missing.error).toMatch(/Missing table/);
  });

  test('list_columns splits a schema.table qualifier and binds both parts', async () => {
    let boundTo = null;
    const sql = async (query, params) => { boundTo = params; return { ok: true, columns: [{ name: 'name' }], data: [] }; };
    const { dispatch } = createMcpServer({ sql });
    await dispatch({ id: 1, method: 'tools/call', params: { name: 'list_columns', arguments: { table: 'analytics.events' } } });
    expect(boundTo).toEqual(['analytics', 'events']);
  });
});

describe('tools/call routing', () => {
  test('an unknown tool name is a failed result', async () => {
    const { dispatch } = createMcpServer({ sql: fakeSql() });
    const raw = await dispatch({ id: 1, method: 'tools/call', params: { name: 'nope' } });
    expect(parse(raw).result.isError).toBe(true);
    expect(toolResult(raw).error).toMatch(/Unknown tool: nope/);
  });
});
