// Generated from RUNTIME_TABLE in src/emitter.js and src/ts/runtime-exports.js by `bun run decls`; change the source and regenerate.
type __RipSchemaIssue = {
  field: string;
  error: string;
  message: string;
};

type __RipSchemaError = Error & {
  issues: __RipSchemaIssue[];
  schemaName: string | null;
  schemaKind: string | null;
};

type __RipSchemaVerdict = {
  ok: boolean;
  value: unknown;
  errors: __RipSchemaIssue[] | null;
};

type __RipArrayVerdict = {
  ok: boolean;
  value: unknown[] | null;
  errors: __RipSchemaIssue[] | null;
};

type __RipPersistence = {
  finishModelNorm: (def: SchemaDef, norm: unknown) => unknown;
  decorateDef: (def: SchemaDef, desc: unknown) => unknown;
  projectableFields: (def: SchemaDef) => unknown;
  jsonSchemaModelColumns: (def: SchemaDef, props: unknown) => unknown;
};

export declare const __schema: (descriptor: unknown) => unknown;

export declare const SchemaError: {
  new (issues: __RipSchemaIssue[], schemaName?: string | null, schemaKind?: string | null): __RipSchemaError;
  prototype: __RipSchemaError;
};

export declare const SchemaRegistry: {
  _entries: Map<string, {
    def: SchemaDef;
    kind: string;
  }>;
  replace: boolean;
  register(def: SchemaDef): void;
  get(name: string): SchemaDef | null;
  getKind(name: string, kind: string): SchemaDef | null;
  has(name: string): boolean;
  names(): string[];
  reset(): void;
  scope<T>(fn: () => T): T;
};

export declare const registerCoercer: {
  <F extends (value: string) => unknown>(name: string, fn: F, options?: {
    raw?: false;
  }): F;
  <F extends (value: unknown) => unknown>(name: string, fn: F, options: {
    raw: boolean;
  }): F;
};

export declare class SchemaDef {
  constructor(descriptor: unknown);
  kind: string;
  name: string | null;
  parse(data: unknown): unknown;
  safe(data: unknown): __RipSchemaVerdict;
  ok(data: unknown): boolean;
  parseAsync(data: unknown): Promise<unknown>;
  safeAsync(data: unknown): Promise<__RipSchemaVerdict>;
  okAsync(data: unknown): Promise<boolean>;
  readonly array: {
    parse(data: unknown): unknown[];
    safe(data: unknown): __RipArrayVerdict;
    ok(data: unknown): boolean;
    parseAsync(data: unknown): Promise<unknown[]>;
    safeAsync(data: unknown): Promise<__RipArrayVerdict>;
    okAsync(data: unknown): Promise<boolean>;
    toJSONSchema(): Record<string, unknown>;
  };
  pick(...keys: string[]): SchemaDef;
  omit(...keys: string[]): SchemaDef;
  partial(): SchemaDef;
  required(...keys: string[]): SchemaDef;
  extend(other: SchemaDef): SchemaDef;
  toJSONSchema(): Record<string, unknown>;
  _desc: unknown;
  _norm: unknown;
  _klass: unknown;
  _unionPlanCache: unknown;
  _sourceModel: unknown;
  _taCache: unknown;
  _taGen: unknown;
  _ftGen: unknown;
  _normalize(): unknown;
  _unionPlan(): unknown;
  _unionResolve(data: unknown): unknown;
  _applyEagerDerived(inst: unknown): void;
  _materializeValidatedValue(working: unknown, original: unknown, existing: unknown): unknown;
  _materializeNestedValues(working: unknown, original: unknown, existing: unknown): void;
  _materializeOwnValidatedValue(working: unknown, original: unknown, existing: unknown): unknown;
  _materializeResolvedValue(working: unknown, original: unknown, existing: unknown): unknown;
  _applyEnsures(data: unknown): unknown[];
  _syncEnsureVerdict(r: unknown, data: unknown): boolean;
  _applyEnsuresAsync(data: unknown): Promise<unknown[]>;
  _transitiveAsync(): boolean | undefined;
  _assertFieldTypes(): void;
  _assertSyncValidatable(api: string): void;
  _getClass(): new (data: unknown) => object;
  _coerceDates(working: unknown): void;
  _validateFields(data: unknown, collect: unknown, skip: unknown, opts: unknown): unknown;
  _applyDefaults(data: unknown): unknown;
  _applyTransforms(raw: unknown, working: unknown): unknown[];
  _applyCoercions(working: unknown, failed: unknown): unknown[];
  _orderFieldErrors(...groups: unknown[]): unknown[];
  _validateEnum(data: unknown, collect: unknown): unknown;
  _materializeEnum(data: unknown): unknown;
  _runSync(data: unknown, opts: unknown): unknown;
  _runAsync(data: unknown, opts: unknown): Promise<unknown>;
  _validateFieldsAsync(working: unknown, failed: unknown, opts: unknown): Promise<unknown[]>;
  _runExistingSync(data: unknown, opts: unknown): unknown;
  _runExistingAsync(data: unknown, opts: unknown): Promise<unknown>;
  _finishExistingValue(original: unknown, working: unknown, opts: unknown): unknown;
}

export declare const installPersistence: (impl: __RipPersistence) => void;
