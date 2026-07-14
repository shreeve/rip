// @rip-lang/server — public type surface.

export type Handler = unknown;

export type Route = {
  method: string;
  pattern: string;
  handler: Handler;
};

export type RouteMatch = {
  handler: Handler;
  params: Record<string, string>;
  route: Route;
};

export type Matcher = {
  add(method: string, pattern: string, handler: Handler): void;
  match(method: string, pathname: string): RouteMatch | null;
  routes(): Route[];
};

export function createMatcher(): Matcher;

export function parseQuery(search?: string): Record<string, string>;

export type CtxReq = {
  raw: Request;
  method: string;
  url: string;
  path: string;
  param(key: string): string | undefined;
  param(): Record<string, string>;
  query(key: string): string | undefined;
  query(): Record<string, string>;
  header(key: string): string | undefined;
  header(): Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
  parseBody(): Promise<unknown>;
};

export type Ctx = {
  req: CtxReq;
  json(data: unknown, status?: number, headers?: Record<string, string>): Response;
  text(body: string, status?: number, headers?: Record<string, string>): Response;
  html(body: string, status?: number, headers?: Record<string, string>): Response;
  body(data: BodyInit | null, status?: number, headers?: Record<string, string>): Response;
  redirect(location: string, status?: number): Response;
  send(path: string, type?: string): Response;
  header(name: string): string | undefined;
  header(name: string, value: string, opts?: { append?: boolean }): void;
  cache(duration: number | string): void;
};

export type FileMeta = {
  body?: BodyInit;
  size?: number;
  lastModified?: number;
  type?: string;
  exists: boolean;
};

export type FilesHost = (path: string) => FileMeta;

export type ApiError = { message?: string; notice?: string; issues?: unknown[] };

export function createContext(
  request: Request,
  opts?: { params?: Record<string, string>; files?: FilesHost | null },
): Ctx;

export function errorEnvelope(err: unknown): { status: number; error: ApiError };

export function respond(
  handler: (this: Ctx, c: Ctx) => unknown,
  ctx: Ctx,
): Promise<Response>;

export type Middleware = (c: Ctx, next: () => Promise<Response>) => unknown;
export type BeforeFilter = (c: Ctx) => unknown;
export type AfterFilter = (c: Ctx, response: Response) => unknown;

export type Stack = {
  use?: Middleware[];
  before?: BeforeFilter[];
  after?: AfterFilter[];
  handler: (this: Ctx, c: Ctx) => unknown;
};

export function compose(stack: Stack): (c: Ctx) => Promise<Response>;

export type CorsOpts = {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string | string[];
  headers?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  exposeHeaders?: string | string[];
};

export function cors(opts?: CorsOpts): Middleware;

export type LogInfo = {
  method: string;
  path: string;
  status: number;
  ms: number;
  time: string;
};

export type LoggerOpts = {
  format?: 'tiny' | 'dev' | 'full' | ((info: LogInfo) => string);
  skip?: (c: Ctx) => boolean;
  stream?: { write: (line: string) => unknown };
};

export function logger(opts?: LoggerOpts): Middleware;

export type ReadType = string | RegExp | Array<string | number | null>;

export type ReadingCtx = Ctx & {
  read(name?: string, type?: ReadType, miss?: unknown): unknown;
};

export function reading(): Middleware;

export type InputSchema = {
  name?: string | null;
  safeAsync(data: unknown): Promise<{ ok: boolean; value?: unknown; errors?: unknown[] }>;
  toJSONSchema(): Record<string, unknown>;
};

export type InputHandler = ((this: Ctx, c: Ctx & { input: unknown }) => unknown) & {
  inputSchema?: InputSchema;
};

export function withInput(
  schema: InputSchema,
  handler: (this: Ctx, c: Ctx & { input: unknown }) => unknown,
): InputHandler;

export function openapi(
  routes: Route[],
  info?: Record<string, unknown>,
): Record<string, unknown>;

export type SessionOpts = {
  secret?: string;
  encrypt?: boolean;
  insecure?: boolean;
  name?: string;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export function sessions(opts?: SessionOpts): Middleware;

export type CsrfOpts = {
  secret?: string;
  insecure?: boolean;
  cookieName?: string;
  headerName?: string;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  exempt?: (c: Ctx) => boolean;
};

export function csrf(opts?: CsrfOpts): Middleware;

export type SecureHeaderOpts = {
  frameOptions?: string;
  referrerPolicy?: string;
  contentSecurityPolicy?: string;
  hsts?: boolean;
  hstsMaxAge?: number;
};

export function secureHeaders(opts?: SecureHeaderOpts): Middleware;

export type TrustProxyOpts = {
  trust?: boolean;
  hops?: number;
};

export type ClientInfo = {
  ip: string | null;
  proto: string;
  host: string;
};

export function trustProxy(opts?: TrustProxyOpts): Middleware;

export type HardenOpts = {
  maxUrl?: number;
  methods?: string[];
};

export function harden(opts?: HardenOpts): Middleware;
