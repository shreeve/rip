// @rip-lang/http — public type surface.

export type RetryConfig = {
  limit?: number;
  methods?: string[];
  statusCodes?: number[];
  backoffLimit?: number;
  delay?: (attempt: number) => number;
};

export type RetryOption = number | RetryConfig | false;

export type BeforeRetryInfo = {
  request: Request;
  options: HttpOptions;
  error: Error | null;
  retryCount: number;
};

export type BeforeRequestHook = (
  request: Request,
  options: HttpOptions,
) => Request | Response | void | Promise<Request | Response | void>;

export type AfterResponseHook = (
  request: Request,
  options: HttpOptions,
  response: Response,
) => Response | void | Promise<Response | void>;

export type BeforeRetryHook = (info: BeforeRetryInfo) => void | Promise<void>;

export type BeforeErrorHook = (error: HTTPError) => HTTPError | Promise<HTTPError>;

export type Hooks = {
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
};

export type HttpOptions = {
  method?: string;
  json?: unknown;
  body?: BodyInit | null;
  headers?: HeadersInit;
  prefixUrl?: string;
  searchParams?: URLSearchParams | string | Record<string, unknown>;
  timeout?: number | false;
  retry?: RetryOption;
  throwHttpErrors?: boolean;
  hooks?: Hooks;
  mode?: RequestMode;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  signal?: AbortSignal | null;
};

export class HTTPError extends Error {
  constructor(response: Response, request: Request, options: HttpOptions);
  response: Response;
  request: Request;
  options: HttpOptions;
}

export class TimeoutError extends Error {
  constructor(request: Request);
  request: Request;
}

type CallFn = (input: string | URL, opts?: HttpOptions) => Promise<Response>;

export type HttpInstance = CallFn & {
  get: CallFn;
  post: CallFn;
  put: CallFn;
  patch: CallFn;
  del: CallFn;
  head: CallFn;
  create: (opts?: HttpOptions) => HttpInstance;
  extend: (opts?: HttpOptions) => HttpInstance;
  HTTPError: typeof HTTPError;
  TimeoutError: typeof TimeoutError;
};

export const http: HttpInstance;
