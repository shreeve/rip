export type NonNullSourceValue =
  | object
  | string
  | number
  | boolean
  | symbol
  | bigint;

export type Duration = number | string;
export type SourceArgs = [] | [unknown];
export type SingletonSourceArgs = [] | [signal?: AbortSignal];
export type KeyedSourceArgs =
  | [key: unknown]
  | [key: unknown, signal?: AbortSignal];

export type SourceOpts<T extends NonNullSourceValue, A extends SourceArgs> = {
  kind?: never;
  fetch: (...args: A) => Promise<T>;
  staleTime?: Duration | 'forever';
};

export type SingletonSourceOpts<
  T extends NonNullSourceValue,
  A extends SingletonSourceArgs = SingletonSourceArgs,
> = {
  kind: 'singleton';
  fetch: (...args: A) => Promise<T>;
  staleTime?: Duration | 'forever';
};

export type KeyedSourceOpts<
  T extends NonNullSourceValue,
  A extends KeyedSourceArgs = KeyedSourceArgs,
> = {
  kind: 'keyed';
  fetch: (...args: A) => Promise<T>;
  staleTime?: Duration | 'forever';
};

export type SourceCell<T> = {
  readonly loading: boolean;
  readonly error: unknown;
  read(): T | null;
  peek(): T | null;
  ensure(): Promise<T | undefined>;
  write(value: T | null): T | null;
  reset(): void;
  refetch(): Promise<T | undefined>;
  preload(): Promise<T | null | undefined>;
};

export type SourceFamily<T, K> = {
  (key: K): T | null;
  cellFor(key: K): SourceCell<T>;
  reset(): void;
};

declare const sourceDeclaration: unique symbol;
declare const stashShape: unique symbol;

export type SourceDeclaration<
  T extends NonNullSourceValue,
  A extends SourceArgs,
> = {
  readonly [sourceDeclaration]: {
    value: T;
    args: A;
  };
};

type StashReadValue<V> =
  V extends SourceDeclaration<infer T, infer A>
    ? A extends []
      ? T | null
      : A extends [infer K]
        ? (key: K) => T | null
        : never
    : V extends (...args: any[]) => any
      ? V
      : V extends object
        ? { [K in keyof V]: StashReadValue<V[K]> }
        : V;

type StashRawValue<V> =
  V extends SourceDeclaration<infer T, infer A>
    ? A extends []
      ? SourceCell<T>
      : A extends [infer K]
        ? SourceFamily<T, K>
        : never
    : V extends (...args: any[]) => any
      ? V
      : V extends object
        ? { [K in keyof V]: StashRawValue<V[K]> }
        : V;

export type StashMethods = {
  peek(path?: string): unknown;
  reset(): void;
};

export type Stash<D extends Record<string, any>> = {
  [K in keyof D]: StashReadValue<D[K]>;
} & StashMethods & {
  readonly [stashShape]?: D;
};

export type RawStash<D extends Record<string, any>> = {
  [K in keyof D]: StashRawValue<D[K]>;
};

export function source<
  T extends NonNullSourceValue,
  A extends SourceArgs,
>(opts: SourceOpts<T, A>): SourceDeclaration<T, A>;

export function source<F extends (...args: any[]) => Promise<any>>(
  opts: {
    kind: 'singleton';
    fetch: F;
    staleTime?: Duration | 'forever';
  } & (
    Parameters<F> extends SingletonSourceArgs
      ? Awaited<ReturnType<F>> extends NonNullSourceValue
        ? unknown
        : never
      : never
  ),
): SourceDeclaration<Awaited<ReturnType<F>> & NonNullSourceValue, []>;

export function source<F extends (...args: any[]) => Promise<any>>(
  opts: {
    kind: 'keyed';
    fetch: F;
    staleTime?: Duration | 'forever';
  } & (
    Parameters<F> extends KeyedSourceArgs
      ? Awaited<ReturnType<F>> extends NonNullSourceValue
        ? unknown
        : never
      : never
  ),
): SourceDeclaration<
  Awaited<ReturnType<F>> & NonNullSourceValue,
  [Parameters<F>[0]]
>;

export function createStash<D extends Record<string, any>>(data?: D): Stash<D>;
export function unwrapStash<D extends Record<string, any>>(stash: Stash<D>): RawStash<D>;

export type ComponentEvent = 'create' | 'change' | 'delete';

export type ComponentsStore = {
  read(path: string): string | undefined;
  write(path: string, content: string): void;
  del(path: string): void;
  exists(path: string): boolean;
  size(): number;
  list(dir?: string): string[];
  listAll(dir?: string): string[];
  load(sources: Record<string, string>): void;
  watch(fn: (event: ComponentEvent, path: string) => void): () => void;
  getCompiled(path: string): Record<string, unknown> | undefined;
  setCompiled(path: string, module: Record<string, unknown>): void;
};

export function createComponents(): ComponentsStore;

export type Route = {
  readonly pattern: string;
  readonly file: string;
  readonly layouts: readonly string[];
};

export type RouteMatch = {
  route: Route;
  params: Record<string, string>;
};

export type RouteManifest = {
  readonly routes: readonly Route[];
  match(path: string): RouteMatch | null;
};

export function buildRoutes(
  files: readonly string[],
  root?: string,
): RouteManifest;

export function parseQuery(search: string): Record<string, string>;

export type Mutation<R> = {
  (...args: any[]): Promise<R | undefined>;
  readonly pending: boolean;
  readonly succeeded: boolean;
  readonly error: unknown;
};

export function createMutation<R>(
  fn: (...args: any[]) => Promise<R> | R,
  opts?: {
    onSuccess?: (r: R) => void | Promise<void>;
    onError?: (e: unknown) => unknown;
  },
): Mutation<R>;

export type TimingSource<T> = { value: T } | (() => T);

export type TimedSignal<T> = {
  value: T;
  read(): T;
  dispose(): void;
};

export type ReadonlyTimedSignal<T> = {
  readonly value: T;
  read(): T;
  dispose(): void;
};

export function delay(ms: number, source: () => unknown): ReadonlyTimedSignal<boolean>;
export function delay(ms: number, source: { value: unknown }): TimedSignal<boolean>;
export function debounce<T>(ms: number, source: () => T): ReadonlyTimedSignal<T>;
export function debounce<T>(ms: number, source: { value: T }): TimedSignal<T>;
export function throttle<T>(ms: number, source: () => T): ReadonlyTimedSignal<T>;
export function throttle<T>(ms: number, source: { value: T }): TimedSignal<T>;
export function hold(ms: number, source: () => unknown): ReadonlyTimedSignal<boolean>;
export function hold(ms: number, source: { value: unknown }): TimedSignal<boolean>;

export type RouterAdapter = {
  read(): string;
  readState?(): unknown;
  push(url: string, state: unknown): void;
  replace(url: string, state: unknown): void;
  go(delta: number): void;
  listen(fn: () => void): () => void;
  scroll?: {
    save?(): unknown;
    restore?(position: unknown): void;
    top?(): void;
    watch?(fn: () => void): () => void;
  };
};

export type RouteInfo = {
  route: Route;
  params: Record<string, string>;
  query: Record<string, string>;
  hash: string;
};

export type NavigationInfo = RouteInfo & { path: string };

export type ClaimedRoute = NavigationInfo & { url: string };

export type RouterCurrent = {
  route: Route;
  layouts: readonly string[];
  params: Record<string, string>;
  query: Record<string, string>;
};

export type NavOpts = { noScroll?: boolean };

export type Router = {
  init(): Router;
  push(url: string, opts?: NavOpts): boolean;
  replace(url: string, opts?: NavOpts): boolean;
  back(): void;
  forward(): void;
  match(url: string): RouteInfo | null;
  claims(url: string): ClaimedRoute | null;
  onNavigate(fn: (info: NavigationInfo) => void): () => void;
  rebuild(): void;
  destroy(): void;
  navigating: boolean;
  readonly current: RouterCurrent | null;
  readonly path: string | null;
  readonly hash: string;
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
};

export function createRouter(opts: {
  routes: RouteManifest | (() => RouteManifest);
  adapter: RouterAdapter;
  base?: string;
  hash?: boolean;
  onError?: (failure: { status: number; path: string }) => void;
}): Router;

export function browserAdapter(): RouterAdapter;

export function ownsAnchor(router: Router, anchor: unknown): boolean;

export function ariaCurrent(
  router: Router,
  host?: {
    anchors(): unknown[];
    observe?(fn: () => void): () => void;
  },
): () => void;

export type GateDescriptor =
  | string
  | {
      path: string;
      key: (params: Record<string, string>, query: Record<string, string>) => unknown;
    };

export type GateFailure = Error & {
  status: number;
  path: string;
  file: string;
  error: unknown;
};

export type RendererRouteState = {
  route: { file: string };
  layouts?: string[];
  params?: Record<string, string>;
  query?: Record<string, string>;
};

export type RendererRouter = {
  readonly current: RendererRouteState | null;
  navigating?: boolean;
  init?(): void;
};

export type RendererTarget = {
  appendChild(node: unknown): unknown;
};

export type RendererOptions = {
  router: RendererRouter;
  app: { data: object };
  components: ComponentsStore;
  target: RendererTarget;
  onError?: (failure: GateFailure) => void;
};

export type Renderer = {
  readonly current: unknown;
  mount(info: RendererRouteState): Promise<unknown>;
  preload(info: RendererRouteState): void;
  start(): Renderer;
  stop(): void;
};

export function createRenderer(options: RendererOptions): Renderer;

export type LinkHost = {
  listen(
    type: string,
    fn: (event: unknown) => void,
    opts?: Record<string, unknown>,
  ): () => void;
};

export function interceptClicks(router: Router, host?: LinkHost): () => void;

export function preloadLinks(
  router: Router,
  renderer: Renderer,
  host?: LinkHost,
): () => void;

export function persistStash(
  app: { data: Record<string, any> },
  opts?: {
    local?: boolean;
    key?: string;
    debounce?: number;
    storage?: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    };
  },
): () => void;

export type LaunchResult = {
  app: { data: Record<string, any> };
  components: ComponentsStore;
  router: Router;
  renderer: Renderer;
  destroy(): void;
};

export function launch(opts: {
  bundle: {
    modules?: Record<string, string>;
    compiled?: Record<string, Record<string, unknown>>;
    data?: Record<string, unknown>;
  };
  target?: RendererTarget;
  adapter?: RouterAdapter;
  base?: string;
  hash?: boolean;
  stash?: Record<string, unknown>;
  links?: LinkHost;
  persist?: boolean | 'local' | 'session';
  storage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  onError?: (failure: { status: number; path: string }) => void;
}): LaunchResult;
