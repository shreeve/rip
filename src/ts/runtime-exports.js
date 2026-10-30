// The declared types of the exports the runtime table does not inject:
// a runtime module's helpers, seams, and classes that only a direct
// importer of its JavaScript names. Per runtime key: `types`, one entry
// per export — a signature string, or `{ class, extends? }` for a class
// body — `decls`, alias text the signatures reference, and `imports`,
// the names a signature takes from a sibling declaration. The generator
// (src/ts/runtime-decls.js) merges these with the table's `types`; an
// export typed by both, or by neither, refuses there. Internal state a
// consumer has no contract on is `unknown`; a parameter the body only
// tests and forwards is `unknown` too.

// src/runtime/reactive.js — the owner-frame seam the render layer and the
// components runtime share.
export const OWNER_FRAME_DECLS = [
  'type __RipOwnerFrame = { readonly depth: number; readonly disposed: boolean; readonly size: number; add(disposer: () => void): void; remove(disposer: () => void): void; dispose(): void };',
  'type __RipOwnerToken = { frame: __RipOwnerFrame; prev: __RipOwnerFrame | null };',
].join('\n');
const OWNER_FRAME_TYPES = {
  __ownerFrame: '(options?: { nested?: boolean }) => __RipOwnerFrame',
  __pushOwner: '(frame: __RipOwnerFrame) => __RipOwnerToken',
  __popOwner: '(token: __RipOwnerToken) => void',
  __detachRef: '(cell: { read(): unknown; value: unknown } | null | undefined, el: unknown) => void',
};

// src/runtime/orm.js — the transaction and adapter seams, the DDL
// renderers, and the persistence helpers rip/fake builds on. The `schema`
// namespace's own members (`transaction`, `connect`, `sequence`) are these
// module exports, so their signatures are read off the table's namespace
// type rather than spelled twice.
const ORM_DECLS = [
  'type __RipTxHandle = { query: __RipAdapterQuery; commit: () => Promise<void>; rollback: () => Promise<void> };',
  'type __RipColumnSpec = { name: string; type: string; primary?: boolean; notNull?: boolean; unique?: boolean; default?: string | null };',
  'type __RipIndexSpec = { name: string; columns: string[]; unique?: boolean };',
  'type __RipTableSpec = { name: string; columns: __RipColumnSpec[]; indexes: __RipIndexSpec[]; sequence?: { name: string; start: number; shared?: boolean } | null; compositeUniques?: string[][] };',
].join('\n');

// src/runtime/components.js — the component base class, the render
// layer's helpers, and the HMR seam rip/app drives. A definition is what
// the registry reads statics off — any function stamped with an HMR
// identity — and a registered instance is a component whose constructor
// carries one; a component class is a definition that constructs.
export const TEARDOWN_DECL = 'type __RipTeardown = { state: string; hooks: boolean; removeDOM: boolean };';
const COMPONENTS_DECLS = [
  'type __RipHmrSignature = { shape?: unknown; impl?: unknown; state?: readonly string[]; computed?: readonly string[]; props?: readonly string[]; gates?: unknown; extends?: unknown; inits?: Record<string, string> };',
  'type __RipHmrDefinition = Function & { __hmrId?: string; __hmrSig?: __RipHmrSignature };',
  'type __RipHmrInstance = __Component & { constructor: __RipHmrDefinition };',
  'type __RipComponentClass = (new (props?: Record<string, unknown>) => __Component) & __RipHmrDefinition;',
  'type __RipHmrEntry = { definition: __RipHmrDefinition; instances: Set<__RipHmrInstance> };',
  'type __RipHmrEvent = { type: string; at: number; [detail: string]: unknown };',
  'type __RipStateDiff = { kept: string[]; added: string[]; removed: string[] };',
  'type __RipUiSnapshot = { active: Element | null; locator: { identity: Record<string, string | null>; id: string | null; path: number[] | null } | null; selection: { start: number; end: number; direction: string } | null; scrollX: number; scrollY: number };',
  'type __RipGateBinding = { cell: { read(): unknown }; value: unknown };',
  'type __RipGateMetadata = { gates: readonly __RipGateBinding[]; parent?: __Component | null; stash?: unknown; router?: unknown };',
  'type __RipListBlock = { c(): void; m(parent: Node, anchor: Node | null): void; p(ctx: unknown, item: unknown, index: number, ...outer: unknown[]): void; d(): void; _s?: boolean; _first?: Node | null };',
  'type __RipListState = { keys: unknown[]; items?: unknown[]; blocks: __RipListBlock[] };',
  TEARDOWN_DECL,
].join('\n');

// The base class: the public surface is construction, `mount`, and
// `unmount`; every other member is the runtime's own, declared so a
// subclass meets the member set the base carries.
export const COMPONENT_CLASS = '{ '
  + 'constructor(props?: Record<string, unknown>); '
  + 'mount(target?: Node | string): this; '
  + 'unmount(options?: { removeDOM?: boolean }): void; '
  + 'static mount(target?: Node | string): __Component; '
  + '_state: string | undefined; _owner: __Component | null | undefined; _parent: __Component | null | undefined; '
  + 'stash?: unknown; router?: unknown; children?: unknown; rest?: unknown; '
  + '_hmrPropKeys: string | undefined; _rest: Record<string, unknown> | undefined; _asChild: boolean | undefined; '
  + '_frame: __RipOwnerFrame | undefined; _initFailed: boolean | undefined; _projectionOwner: __Component | null | undefined; '
  + '_restHandlers: unknown; _hmrRebindPending: boolean | undefined; _root: unknown; _children: __Component[] | null | undefined; _restWriters: unknown; '
  + '_refCleanups: (() => void)[] | null | undefined; _nodes: unknown; _inheritedEl: unknown; _inheritedInst: unknown; _inheritedOwn: unknown; _target: unknown; '
  + '_hmrOrphans: __Component[] | null | undefined; _hmrReleasing: boolean | undefined; _hmrReset: string[] | undefined; _hmrResetPending: unknown; '
  + '_bound(name: string): (...args: unknown[]) => unknown; '
  + '_init(props: Record<string, unknown>): void; '
  + '_beginProjection(owner: __Component | null): { prev: __Component | null; owner: __Component | null }; '
  + '_endProjection(token: { prev: __Component | null; owner: __Component | null }): void; '
  + '_setChildren(value: unknown): void; _adoptChild(): unknown; _rehost(): void; _rehostAbove(prev: unknown): void; '
  + '_updateProp(name: string, value: unknown): void; _setRestProp(key: string, value: unknown): void; '
  + '_applyRestToInheritedEl(): void; _mergeRestStyle<S extends __RipCSSProperties | string | null | undefined>(own: S): S | (this extends { rest?: { value: { style?: infer T } } } ? NonNullable<T> : never); '
  + '_applyInheritedProp(host: unknown, key: string, value: unknown): void; _applyPlainInheritedProp(host: unknown, key: string, value: unknown): void; '
  + '_beginMount(): void; _mountCreate(): boolean; _mountSetup(failurePlaceholder?: unknown): unknown; _failMount(error: unknown): void; '
  + '_dispose(report: unknown, unmountChild: unknown): void; _detachDOM(report: unknown, removeDOM: unknown): void; '
  + '_teardown(options: __RipTeardown): void; _teardownUntracked(options: __RipTeardown): void; '
  + '_hmrRelease(removeDOM?: boolean): void; _hmrReleaseUntracked(removeDOM: boolean): void; _hmrRebind(): boolean; '
  + '_hmrApplyResets(): void; _hmrApplyProps(props: Record<string, unknown>): void; _hmrDrainOrphans(report: unknown): void; _hmrRerender(): this'
  + ' }';

// src/runtime/schema.js — the registry, the definition class, and the
// persistence seam orm.js installs into.
const SCHEMA_DECLS = [
  'type __RipSchemaVerdict = { ok: boolean; value: unknown; errors: __RipSchemaIssue[] | null };',
  'type __RipArrayVerdict = { ok: boolean; value: unknown[] | null; errors: __RipSchemaIssue[] | null };',
  'type __RipPersistence = { finishModelNorm: (def: SchemaDef, norm: unknown) => unknown; decorateDef: (def: SchemaDef, desc: unknown) => unknown; projectableFields: (def: SchemaDef) => unknown; jsonSchemaModelColumns: (def: SchemaDef, props: unknown) => unknown };',
].join('\n');

// The definition class: `kind`, `name`, and the validation and algebra
// surface are the contract; the underscore members are the runtime's own,
// declared so the member set is the class's.
const SCHEMA_DEF_CLASS = '{ '
  + 'constructor(descriptor: unknown); '
  + 'kind: string; name: string | null; '
  + 'parse(data: unknown): unknown; safe(data: unknown): __RipSchemaVerdict; ok(data: unknown): boolean; '
  + 'parseAsync(data: unknown): Promise<unknown>; safeAsync(data: unknown): Promise<__RipSchemaVerdict>; okAsync(data: unknown): Promise<boolean>; '
  + 'readonly array: { parse(data: unknown): unknown[]; safe(data: unknown): __RipArrayVerdict; ok(data: unknown): boolean; parseAsync(data: unknown): Promise<unknown[]>; safeAsync(data: unknown): Promise<__RipArrayVerdict>; okAsync(data: unknown): Promise<boolean>; toJSONSchema(): Record<string, unknown> }; '
  + 'pick(...keys: string[]): SchemaDef; omit(...keys: string[]): SchemaDef; partial(): SchemaDef; required(...keys: string[]): SchemaDef; extend(other: SchemaDef): SchemaDef; '
  + 'toJSONSchema(): Record<string, unknown>; '
  + '_desc: unknown; _norm: unknown; _klass: unknown; _unionPlanCache: unknown; _sourceModel: unknown; _taCache: unknown; _taGen: unknown; _ftGen: unknown; '
  + '_normalize(): unknown; _unionPlan(): unknown; _unionResolve(data: unknown): unknown; _applyEagerDerived(inst: unknown): void; '
  + '_materializeValidatedValue(working: unknown, original: unknown, existing: unknown): unknown; _materializeNestedValues(working: unknown, original: unknown, existing: unknown): void; '
  + '_materializeOwnValidatedValue(working: unknown, original: unknown, existing: unknown): unknown; _materializeResolvedValue(working: unknown, original: unknown, existing: unknown): unknown; '
  + '_applyEnsures(data: unknown): unknown[]; _syncEnsureVerdict(r: unknown, data: unknown): boolean; _applyEnsuresAsync(data: unknown): Promise<unknown[]>; _transitiveAsync(): boolean | undefined; '
  + '_assertFieldTypes(): void; _assertSyncValidatable(api: string): void; _getClass(): new (data: unknown) => object; _coerceDates(working: unknown): void; '
  + '_validateFields(data: unknown, collect: unknown, skip: unknown, opts: unknown): unknown; _applyDefaults(data: unknown): unknown; _applyTransforms(raw: unknown, working: unknown): unknown[]; '
  + '_applyCoercions(working: unknown, failed: unknown): unknown[]; _orderFieldErrors(...groups: unknown[]): unknown[]; _validateEnum(data: unknown, collect: unknown): unknown; _materializeEnum(data: unknown): unknown; '
  + '_runSync(data: unknown, opts: unknown): unknown; _runAsync(data: unknown, opts: unknown): Promise<unknown>; _validateFieldsAsync(working: unknown, failed: unknown, opts: unknown): Promise<unknown[]>; '
  + '_runExistingSync(data: unknown, opts: unknown): unknown; _runExistingAsync(data: unknown, opts: unknown): Promise<unknown>; _finishExistingValue(original: unknown, working: unknown, opts: unknown): unknown'
  + ' }';

export const RUNTIME_EXPORT_TYPES = {
  schema: {
    decls: SCHEMA_DECLS,
    types: {
      SchemaRegistry: '{ _entries: Map<string, { def: SchemaDef; kind: string }>; replace: boolean; register(def: SchemaDef): void; get(name: string): SchemaDef | null; getKind(name: string, kind: string): SchemaDef | null; has(name: string): boolean; names(): string[]; reset(): void; scope<T>(fn: () => T): T }',
      SchemaDef: { class: SCHEMA_DEF_CLASS },
      installPersistence: '(impl: __RipPersistence) => void',
    },
  },
  orm: {
    imports: { './schema.js': ['SchemaDef'] },
    decls: ORM_DECLS,
    types: {
      transaction: { namespace: 'schema', member: 'transaction' },
      adoptTransaction: '<T>(adapter: __RipAdapter, handle: __RipTxHandle, fn: (settle: (outcome: \'afterCommit\' | \'afterRollback\') => Promise<void>) => T) => Promise<Awaited<T>>',
      txHandle: '(adapter: __RipAdapter) => __RipTxHandle | null',
      connect: { namespace: 'schema', member: 'connect' },
      runSQL: '(def: SchemaDef | null | undefined, sql: string, params?: unknown[] | null, options?: { signal?: AbortSignal | null; timeoutMs?: number | null }) => Promise<__RipAdapterResult>',
      adapterFor: '(def: SchemaDef | null | undefined) => __RipAdapter',
      adapterConfigured: '() => boolean',
      quoteIdent: '(name: string, allowed: ReadonlySet<string> | null, what: string) => string',
      renderCreate: '(spec: __RipTableSpec) => string[]',
      renderIndex: '(spec: __RipTableSpec, index: __RipIndexSpec) => string',
      isAutoUniqueIndex: '(spec: __RipTableSpec, index: __RipIndexSpec) => boolean',
      normalizePersistenceInput: '(def: SchemaDef, data: Record<string, unknown>, options?: { api?: string; skipEnsures?: boolean }) => Promise<Record<string, unknown>>',
      constructInputInstance: '(def: SchemaDef, canonical: Record<string, unknown>) => object',
      sqlEnumType: '(values: readonly unknown[]) => string',
      sqlEnumMembers: '(type: unknown) => string[] | null',
      sequenceSetting: { namespace: 'schema', member: 'sequence' },
    },
  },
  reactive: {
    decls: OWNER_FRAME_DECLS,
    types: {
      __setEffectErrorReporter: '(reporter: (label: string, error: unknown) => void) => (label: string, error: unknown) => void',
      __untracked: '<T>(fn: () => T) => T',
      ...OWNER_FRAME_TYPES,
    },
  },
  components: {
    decls: `${OWNER_FRAME_DECLS}\n${COMPONENTS_DECLS}`,
    types: {
      __pushComponent: '(component: __Component | null) => __Component | null',
      __popComponent: '(prev: __Component | null) => void',
      __lis: '(arr: readonly number[]) => number[]',
      __reconcile: '(anchor: Node | null | undefined, state: __RipListState, items: readonly unknown[], ctx: unknown, factory: (ctx: unknown, item: unknown, index: number, ...outer: unknown[]) => __RipListBlock, keyFn: ((item: unknown, index: number) => unknown) | null | undefined, ...outer: unknown[]) => void',
      __transition: '(el: Element, name: string, dir: string, done?: (() => void) | null) => void',
      __handleComponentError: '(error: unknown, component: __Component | null | undefined) => void',
      __gateBind: '(self: __Component, index: number) => { readonly value: unknown; read(): unknown }',
      __detach: '(node: Node | null | undefined) => void',
      __reportChildFailure: '(name: string, error: unknown) => void',
      __setChildFailureReporter: '(reporter: (name: string, error: unknown) => void) => (name: string, error: unknown) => void',
      __hostOf: '(inst: __Component, event: string) => Element',
      ...OWNER_FRAME_TYPES,
      __claimGateConstructor: '() => (Component: __RipComponentClass, metadata: __RipGateMetadata) => __Component',
      __hmrRegistry: 'Map<string, __RipHmrEntry>',
      __hmrLookup: '(id: string) => __RipHmrEntry | undefined',
      __hmrEntries: '() => [string, __RipHmrEntry][]',
      __hmrRegisterDefinition: '(ctor: __RipHmrDefinition | null | undefined) => __RipHmrEntry | undefined',
      __hmrClassify: '(oldCtor: __RipHmrDefinition | null | undefined, newCtor: __RipHmrDefinition | null | undefined) => \'migrate\' | \'patch\' | \'remount\'',
      __hmrMigrateDiff: '(oldSig: __RipHmrSignature | null | undefined, newSig: __RipHmrSignature | null | undefined) => __RipStateDiff',
      __hmrInitDiff: '(oldSig: __RipHmrSignature | null | undefined, newSig: __RipHmrSignature | null | undefined) => string[]',
      __hmrPreserveState: '(oldInstance: __RipHmrInstance | null | undefined, newInstance: __RipHmrInstance | null | undefined) => __RipStateDiff & { copied: string[]; reset: string[] }',
      __hmrEmit: '(type: string, detail?: Record<string, unknown>) => __RipHmrEvent',
      __hmrEvents: '() => __RipHmrEvent[]',
      __hmrPatch: '(instance: __Component, NewCtor: __RipHmrDefinition) => __Component',
      __hmrMigrateRemount: '(oldInstance: __Component, NewCtor: __RipComponentClass, props?: Record<string, unknown>) => __Component',
      __hmrSnapshotUi: '() => __RipUiSnapshot | null',
      __hmrRestoreUi: '(snapshot: __RipUiSnapshot | null | undefined) => void',
    },
  },
};
