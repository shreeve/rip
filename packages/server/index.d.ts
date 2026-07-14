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
