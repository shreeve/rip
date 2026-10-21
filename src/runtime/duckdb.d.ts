export type Target = {
  base: string
  unix: string | null
  shown: string
}

export type Column = {
  name: string
  type?: string
  duckdbType?: string
  encoding?: string
}

export type QueryResult = {
  columns: Column[]
  data: unknown[][]
  rowCount: number
}

export type Envelope = {
  columns: (Column | string)[]
  data: unknown[][]
  rowCount?: number
  error?: string
  errorCode?: string
  harborCode?: string
}

export type QueryOptions = {
  signal?: AbortSignal | null
  timeoutMs?: number | null
}

export type Query = (sql: string, params?: unknown[] | null, opts?: QueryOptions) => Promise<QueryResult>

export type TxHandle = {
  query: Query
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

export type ResponseLike = {
  ok: boolean
  status: number
  statusText?: string
  text?: () => Promise<string>
  json?: () => unknown
  headers?: { get?: (name: string) => string | null }
}

export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  unix?: string
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<ResponseLike>

export type HarborOptions = {
  url?: string | null
  fetch?: FetchLike
  timeoutMs?: number | null
}

export type HarborAdapter = {
  query: Query
  begin: (options?: unknown) => Promise<TxHandle>
  catalog: (opts?: QueryOptions) => Promise<Record<string, unknown>>
  capabilities: { tx: boolean, ddlTransactional: boolean }
}

export type TemporalKind = 'utc' | 'instant' | 'civil'

export type Env = Record<string, string | undefined>

export declare class DbError extends Error {
  constructor(message?: string)
  code?: string
  httpStatus?: number
  sql?: string
  columnName?: string
  row?: number
  retryAfterMs?: number
  cause?: unknown
}
export declare class ConnectionError extends DbError {}
export declare class QueryError extends DbError {
  details?: unknown
}
export declare class CancelledError extends DbError {
  constructor(message?: string, code?: string)
  code: string
}

export declare function isDbError(value: unknown): value is DbError
export declare function harborAdapter(opts?: HarborOptions): HarborAdapter
export declare function resolveUrl(url?: string | null, env?: Env): string
export declare function resolveTarget(url?: string | null, env?: Env): Target
export declare function socketFor(fs: { realpathSync(path: string): string }, runtime: string, db: string): string
export declare function toResult(env: Envelope | null | undefined, sql?: string | null): QueryResult
export declare function temporalKind(duckdbType: unknown): TemporalKind | null
export declare function decodeTemporal(value: unknown, kind: TemporalKind | null | undefined): unknown
export declare function cellKind(column: Column | null | undefined): TemporalKind | 'json' | null
export declare function decodeJson(value: unknown, column?: Column | null, row?: number | null): unknown
export declare function decodeRows(columns: Column[] | null | undefined, rows: unknown[][]): unknown[][]
export declare function encodeParam(v: unknown): unknown
export declare function encodeParams(params: unknown[]): unknown[]
export declare function parseNdjson(text: string): Envelope
export declare function parseBody(text: string | null | undefined): Record<string, unknown> | Envelope
export declare function isPlainObject(v: unknown): v is Record<string, unknown>
export declare function abortable<T>(signal: AbortSignal, promise: Promise<T>): Promise<T>
export declare const DEFAULT_URL: string
export declare const DEFAULT_TIMEOUT_MS: number
