// @rip-lang/db — public type surface.

export class DbError extends Error {
  httpStatus?: number;
  cause?: unknown;
}

export class ConnectionError extends DbError {
  /** 'TIMEOUT' when the adapter's deadline fired, 'ABORTED' when the
   *  caller's AbortSignal did; absent for plain transport failures. */
  code?: 'TIMEOUT' | 'ABORTED';
}

export class QueryError extends DbError {
  code?: string;
  details?: unknown;
  sql?: string;
}

export function isDbError(value: unknown): value is DbError;

export type Column = {
  name: string;
  type?: string;
};

export type QueryResult = {
  columns: Column[];
  data: unknown[][];
  rowCount: number;
};

export type Transaction = {
  query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

export type Capabilities = {
  tx: boolean;
  ddlTransactional: boolean;
};

export type Adapter = {
  query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult>;
  begin(options?: unknown): Promise<Transaction>;
  capabilities: Capabilities;
};

export type HarborOpts = {
  url?: string;
  token?: string;
  fetch?: typeof fetch;
  /** Per-request deadline in milliseconds; default 30_000, 0 disables. */
  timeoutMs?: number;
};

export function harborAdapter(opts?: HarborOpts): Adapter;

export class CancelledError extends Error {}

export type QueryOptions = { signal?: AbortSignal };

export type Row = Record<string, unknown>;

export type MaterializedResult = {
  rows: Row[];
  columns: string[];
  rowCount: number;
};

export type Client = {
  query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<MaterializedResult>;
  rows(sql: string, params?: unknown[], opts?: QueryOptions): Promise<Row[]>;
  one(sql: string, params?: unknown[], opts?: QueryOptions): Promise<Row | null>;
  value(sql: string, params?: unknown[], opts?: QueryOptions): Promise<unknown>;
  transaction<T>(fn: (tx: Client) => Promise<T> | T): Promise<T>;
};

export function createClient(adapter: Adapter): Client;
