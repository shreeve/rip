/// <reference lib="dom" />
// Generated from RUNTIME_TABLE in src/emitter.js and src/ts/runtime-exports.js by `bun run decls`; change the source and regenerate.
type __RipClassValue = string | boolean | null | undefined | Record<string, boolean | null | undefined> | __RipClassValue[];
type __RipUnitless = 'animationIterationCount' | 'aspectRatio' | 'borderImageOutset' | 'borderImageSlice' | 'borderImageWidth' | 'columnCount' | 'columns' | 'flex' | 'flexGrow' | 'flexShrink' | 'fontWeight' | 'gridArea' | 'gridColumn' | 'gridColumnEnd' | 'gridColumnStart' | 'gridRow' | 'gridRowEnd' | 'gridRowStart' | 'lineHeight' | 'opacity' | 'order' | 'orphans' | 'scale' | 'tabSize' | 'widows' | 'zIndex' | 'zoom' | 'fillOpacity' | 'floodOpacity' | 'stopOpacity' | 'strokeDasharray' | 'strokeDashoffset' | 'strokeMiterlimit' | 'strokeOpacity' | 'strokeWidth' | 'webkitLineClamp';

/** An inline style as an object: CSS property names, camelCased, plus `--custom` properties. Values are written as given — no unit is appended — so a number is admitted only where CSS reads one bare: the unitless properties, and 0 anywhere. */
type __RipCSSProperties = {
  [K in Exclude<keyof CSSStyleProperties, keyof CSSStyleDeclarationBase>]?: K extends __RipUnitless ? string | number : string | 0;
} & {
  [k: `--${string}`]: string | number;
};

type __RipProvider = abstract new (...args: never[]) => {
  __offers?: object;
};

type __RipOffers<P extends __RipProvider> = NonNullable<InstanceType<P>['__offers']>;

type __RipOwnerFrame = {
  readonly depth: number;
  readonly disposed: boolean;
  readonly size: number;
  add(disposer: () => void): void;
  remove(disposer: () => void): void;
  dispose(): void;
};

type __RipOwnerToken = {
  frame: __RipOwnerFrame;
  prev: __RipOwnerFrame | null;
};

type __RipHmrSignature = {
  shape?: unknown;
  impl?: unknown;
  state?: readonly string[];
  computed?: readonly string[];
  props?: readonly string[];
  gates?: unknown;
  extends?: unknown;
  inits?: Record<string, string>;
};

type __RipHmrDefinition = Function & {
  __hmrId?: string;
  __hmrSig?: __RipHmrSignature;
};

type __RipHmrInstance = __Component & {
  constructor: __RipHmrDefinition;
};

type __RipComponentClass = (new (props?: Record<string, unknown>) => __Component) & __RipHmrDefinition;

type __RipHmrEntry = {
  definition: __RipHmrDefinition;
  instances: Set<__RipHmrInstance>;
};

type __RipHmrEvent = {
  type: string;
  at: number;
  [detail: string]: unknown;
};

type __RipStateDiff = {
  kept: string[];
  added: string[];
  removed: string[];
};

type __RipUiSnapshot = {
  active: Element | null;
  locator: {
    identity: Record<string, string | null>;
    id: string | null;
    path: number[] | null;
  } | null;
  selection: {
    start: number;
    end: number;
    direction: string;
  } | null;
  scrollX: number;
  scrollY: number;
};

type __RipGateBinding = {
  cell: {
    read(): unknown;
  };
  value: unknown;
};

type __RipGateMetadata = {
  gates: readonly __RipGateBinding[];
  parent?: __Component | null;
  stash?: unknown;
  router?: unknown;
};

type __RipListBlock = {
  c(): void;
  m(parent: Node, anchor: Node | null): void;
  p(ctx: unknown, item: unknown, index: number, ...outer: unknown[]): void;
  d(): void;
  _s?: boolean;
  _first?: Node | null;
};

type __RipListState = {
  keys: unknown[];
  items?: unknown[];
  blocks: __RipListBlock[];
};

type __RipTeardown = {
  state: string;
  hooks: boolean;
  removeDOM: boolean;
};

export declare class __Component {
  constructor(props?: Record<string, unknown>);
  mount(target?: Node | string): this;
  unmount(options?: {
    removeDOM?: boolean;
  }): void;
  static mount(target?: Node | string): __Component;
  _state: string | undefined;
  _owner: __Component | null | undefined;
  _parent: __Component | null | undefined;
  stash?: unknown;
  router?: unknown;
  children?: unknown;
  rest?: unknown;
  _hmrPropKeys: string | undefined;
  _rest: Record<string, unknown> | undefined;
  _asChild: boolean | undefined;
  _frame: __RipOwnerFrame | undefined;
  _initFailed: boolean | undefined;
  _projectionOwner: __Component | null | undefined;
  _restHandlers: unknown;
  _hmrRebindPending: boolean | undefined;
  _root: unknown;
  _children: __Component[] | null | undefined;
  _restWriters: unknown;
  _refCleanups: (() => void)[] | null | undefined;
  _nodes: unknown;
  _inheritedEl: unknown;
  _inheritedInst: unknown;
  _inheritedOwn: unknown;
  _target: unknown;
  _hmrOrphans: __Component[] | null | undefined;
  _hmrReleasing: boolean | undefined;
  _hmrReset: string[] | undefined;
  _hmrResetPending: unknown;
  _bound(name: string): (...args: unknown[]) => unknown;
  _init(props: Record<string, unknown>): void;
  _beginProjection(owner: __Component | null): {
    prev: __Component | null;
    owner: __Component | null;
  };
  _endProjection(token: {
    prev: __Component | null;
    owner: __Component | null;
  }): void;
  _setChildren(value: unknown): void;
  _adoptChild(): unknown;
  _rehost(): void;
  _rehostAbove(prev: unknown): void;
  _updateProp(name: string, value: unknown): void;
  _setRestProp(key: string, value: unknown): void;
  _applyRestToInheritedEl(): void;
  _mergeRestStyle<S extends __RipCSSProperties | string | null | undefined>(own: S): S | (this extends {
    rest?: {
      value: {
        style?: infer T;
      };
    };
  } ? NonNullable<T> : never);
  _applyInheritedProp(host: unknown, key: string, value: unknown): void;
  _applyPlainInheritedProp(host: unknown, key: string, value: unknown): void;
  _beginMount(): void;
  _mountCreate(): boolean;
  _mountSetup(failurePlaceholder?: unknown): unknown;
  _failMount(error: unknown): void;
  _dispose(report: unknown, unmountChild: unknown): void;
  _detachDOM(report: unknown, removeDOM: unknown): void;
  _teardown(options: __RipTeardown): void;
  _teardownUntracked(options: __RipTeardown): void;
  _hmrRelease(removeDOM?: boolean): void;
  _hmrReleaseUntracked(removeDOM: boolean): void;
  _hmrRebind(): boolean;
  _hmrApplyResets(): void;
  _hmrApplyProps(props: Record<string, unknown>): void;
  _hmrDrainOrphans(report: unknown): void;
  _hmrRerender(): this;
}

export declare const __pushComponent: (component: __Component | null) => __Component | null;
export declare const __popComponent: (prev: __Component | null) => void;
export declare const setContext: (key: string, value: unknown) => void;
export declare const getContext: <P extends __RipProvider, K extends keyof __RipOffers<P>>(provider: '__offers' extends keyof InstanceType<P> ? P : never, key: K) => __RipOffers<P>[K];
export declare const hasContext: <P extends __RipProvider>(provider: '__offers' extends keyof InstanceType<P> ? P : never, key: keyof __RipOffers<P>) => boolean;
export declare const __clsx: (...args: (__RipClassValue | __RipClassValue[])[]) => string;
export declare const __style: (el: object, value: __RipCSSProperties | string | null | undefined) => void;
export declare const __lis: (arr: readonly number[]) => number[];
export declare const __reconcile: (anchor: Node | null | undefined, state: __RipListState, items: readonly unknown[], ctx: unknown, factory: (ctx: unknown, item: unknown, index: number, ...outer: unknown[]) => __RipListBlock, keyFn: ((item: unknown, index: number) => unknown) | null | undefined, ...outer: unknown[]) => void;
export declare const __transition: (el: Element, name: string, dir: string, done?: (() => void) | null) => void;
export declare const __handleComponentError: (error: unknown, component: __Component | null | undefined) => void;

export declare const __gateBind: (self: __Component, index: number) => {
  readonly value: unknown;
  read(): unknown;
};

export declare const __detach: (node: Node | null | undefined) => void;
export declare const __reportChildFailure: (name: string, error: unknown) => void;
export declare const __setChildFailureReporter: (reporter: (name: string, error: unknown) => void) => (name: string, error: unknown) => void;
export declare const __hostOf: (inst: __Component, event: string) => Element;

export declare const __ownerFrame: (options?: {
  nested?: boolean;
}) => __RipOwnerFrame;

export declare const __pushOwner: (frame: __RipOwnerFrame) => __RipOwnerToken;
export declare const __popOwner: (token: __RipOwnerToken) => void;

export declare const __detachRef: (cell: {
  read(): unknown;
  value: unknown;
} | null | undefined, el: unknown) => void;

export declare const __claimGateConstructor: () => (Component: __RipComponentClass, metadata: __RipGateMetadata) => __Component;
export declare const __hmrRegistry: Map<string, __RipHmrEntry>;
export declare const __hmrLookup: (id: string) => __RipHmrEntry | undefined;
export declare const __hmrEntries: () => [string, __RipHmrEntry][];
export declare const __hmrRegisterDefinition: (ctor: __RipHmrDefinition | null | undefined) => __RipHmrEntry | undefined;
export declare const __hmrClassify: (oldCtor: __RipHmrDefinition | null | undefined, newCtor: __RipHmrDefinition | null | undefined) => 'migrate' | 'patch' | 'remount';
export declare const __hmrMigrateDiff: (oldSig: __RipHmrSignature | null | undefined, newSig: __RipHmrSignature | null | undefined) => __RipStateDiff;
export declare const __hmrInitDiff: (oldSig: __RipHmrSignature | null | undefined, newSig: __RipHmrSignature | null | undefined) => string[];

export declare const __hmrPreserveState: (oldInstance: __RipHmrInstance | null | undefined, newInstance: __RipHmrInstance | null | undefined) => __RipStateDiff & {
  copied: string[];
  reset: string[];
};

export declare const __hmrEmit: (type: string, detail?: Record<string, unknown>) => __RipHmrEvent;
export declare const __hmrEvents: () => __RipHmrEvent[];
export declare const __hmrPatch: (instance: __Component, NewCtor: __RipHmrDefinition) => __Component;
export declare const __hmrMigrateRemount: (oldInstance: __Component, NewCtor: __RipComponentClass, props?: Record<string, unknown>) => __Component;
export declare const __hmrSnapshotUi: () => __RipUiSnapshot | null;
export declare const __hmrRestoreUi: (snapshot: __RipUiSnapshot | null | undefined) => void;
