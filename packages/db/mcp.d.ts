// @rip-lang/db/mcp — an MCP stdio server over a duckdb-harbor endpoint.

export type SqlRunner = (query: string, params?: unknown[] | null) => Promise<unknown>;

export type McpServer = {
  // One JSON-RPC message in; the string to write to stdout, or null for
  // a notification that produces no reply.
  dispatch(msg: unknown): Promise<string | null>;
};

export function createMcpServer(deps: { sql: SqlRunner }): McpServer;

export type McpSqlOptions = {
  url?: string;
  token?: string | null;
  fetch?: typeof fetch;
};

export function makeSql(opts?: McpSqlOptions): SqlRunner;

// Wire the server to stdin/stdout and harbor; runs until stdin closes.
export function startStdio(options?: unknown): Promise<void>;
