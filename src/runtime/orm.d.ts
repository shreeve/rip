// Generated from RUNTIME_TABLE in src/emitter.js and src/ts/runtime-exports.js by `bun run decls`; change the source and regenerate.
import type { SchemaDef } from './schema.js';
type __RipAdapterResult = {
  columns: {
    name: string;
    type?: string;
    duckdbType?: string;
    encoding?: string;
  }[];
  data: unknown[][];
  rowCount?: number;
  rows?: number;
};

type __RipAdapterQuery = (sql: string, params?: unknown[] | null, options?: {
  signal?: AbortSignal | null;
  timeoutMs?: number | null;
}) => __RipAdapterResult | Promise<__RipAdapterResult>;

type __RipAdapter = {
  query: __RipAdapterQuery;
  begin?: (options?: unknown) => Promise<{
    query: __RipAdapterQuery;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
  }>;
  catalog?: (options?: {
    signal?: AbortSignal | null;
    timeoutMs?: number | null;
  }) => Promise<Record<string, unknown>>;
  capabilities?: {
    tx?: boolean;
    ddlTransactional?: boolean;
  };
};

type __RipSequence = {
  name: string;
  start: number;
};

type __RipTxHandle = {
  query: __RipAdapterQuery;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

type __RipColumnSpec = {
  name: string;
  type: string;
  primary?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: string | null;
};

type __RipIndexSpec = {
  name: string;
  columns: string[];
  unique?: boolean;
};

type __RipTableSpec = {
  name: string;
  columns: __RipColumnSpec[];
  indexes: __RipIndexSpec[];
  sequence?: {
    name: string;
    start: number;
    shared?: boolean;
  } | null;
  compositeUniques?: string[][];
};

export declare const schema: {
  transaction: {
    <T>(fn: () => T): Promise<Awaited<T>>;
    <T>(options: {
      on?: __RipAdapter;
      [option: string]: unknown;
    }, fn: () => T): Promise<Awaited<T>>;
  };
  connect: (options: string | {
    url: string;
    timeoutMs?: number | null;
  }) => __RipAdapter;
  setAdapter: (adapter: __RipAdapter) => void;
  sequence: {
    (): __RipSequence | null;
    (name: null): null;
    (name: string, options?: {
      start?: number;
    }): __RipSequence;
  };
  registerCoercer: {
    <F extends (value: string) => unknown>(name: string, fn: F, options?: {
      raw?: false;
    }): F;
    <F extends (value: unknown) => unknown>(name: string, fn: F, options: {
      raw: boolean;
    }): F;
  };
  plan: () => never;
  status: () => never;
  make: () => never;
  migrate: () => never;
  introspect: () => never;
};

export declare const __schemaSetAdapter: (adapter: __RipAdapter) => void;

export declare const transaction: {
  <T>(fn: () => T): Promise<Awaited<T>>;
  <T>(options: {
    on?: __RipAdapter;
    [option: string]: unknown;
  }, fn: () => T): Promise<Awaited<T>>;
};

export declare const adoptTransaction: <T>(adapter: __RipAdapter, handle: __RipTxHandle, fn: (settle: (outcome: 'afterCommit' | 'afterRollback') => Promise<void>) => T) => Promise<Awaited<T>>;
export declare const txHandle: (adapter: __RipAdapter) => __RipTxHandle | null;

export declare const connect: (options: string | {
  url: string;
  timeoutMs?: number | null;
}) => __RipAdapter;

export declare const runSQL: (def: SchemaDef | null | undefined, sql: string, params?: unknown[] | null, options?: {
  signal?: AbortSignal | null;
  timeoutMs?: number | null;
}) => Promise<__RipAdapterResult>;

export declare const adapterFor: (def: SchemaDef | null | undefined) => __RipAdapter;
export declare const adapterConfigured: () => boolean;
export declare const quoteIdent: (name: string, allowed: ReadonlySet<string> | null, what: string) => string;
export declare const renderCreate: (spec: __RipTableSpec) => string[];
export declare const renderIndex: (spec: __RipTableSpec, index: __RipIndexSpec) => string;
export declare const isAutoUniqueIndex: (spec: __RipTableSpec, index: __RipIndexSpec) => boolean;

export declare const normalizePersistenceInput: (def: SchemaDef, data: Record<string, unknown>, options?: {
  api?: string;
  skipEnsures?: boolean;
}) => Promise<Record<string, unknown>>;

export declare const constructInputInstance: (def: SchemaDef, canonical: Record<string, unknown>) => object;
export declare const sqlEnumType: (values: readonly unknown[]) => string;
export declare const sqlEnumMembers: (type: unknown) => string[] | null;

export declare const sequenceSetting: {
  (): __RipSequence | null;
  (name: null): null;
  (name: string, options?: {
    start?: number;
  }): __RipSequence;
};
