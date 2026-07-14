// @rip-lang/db — public type surface.

export class DbError extends Error {
  httpStatus?: number;
  cause?: unknown;
}

export class ConnectionError extends DbError {}

export class QueryError extends DbError {
  code?: string;
  details?: unknown;
  sql?: string;
}

export function isDbError(value: unknown): value is DbError;

export type QueryResult = {
  columns: string[];
  data: unknown[][];
  rowCount: number;
};

export type Transaction = {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

export type Capabilities = {
  tx: boolean;
  ddlTransactional: boolean;
};

export type IntrospectedColumn = { name: string; type: string };
export type IntrospectedTable = { schema: string; name: string; columns: IntrospectedColumn[] };
export type Introspection = { tables: IntrospectedTable[] };

export type Adapter = {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  begin(options?: unknown): Promise<Transaction>;
  introspect(): Promise<Introspection>;
  capabilities: Capabilities;
};

export type HarborOpts = {
  url?: string;
  token?: string;
  fetch?: typeof fetch;
};

export function harborAdapter(opts?: HarborOpts): Adapter;
