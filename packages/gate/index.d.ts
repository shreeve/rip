// @rip-lang/gate — public type surface.

/** What gate reads from the request context (@rip-lang/server's Ctx shape). */
export type GateRequest = {
  method: string;
  url: string;
  path: string;
  query: (key?: string) => unknown;
  header: (key?: string) => unknown;
  parseBody: () => Promise<unknown>;
};

export type GateContext = {
  req: GateRequest;
  redirect: (location: string, status?: number) => Response;
};

/** The state handed to a custom login-page template. */
export type LoginTemplateState = {
  csrfToken: string;
  error: string | null;
  returnTo: string;
  host: string;
};

/**
 * Custom credential check. A falsy return rejects the login; a truthy
 * non-object accepts as the submitted username; an object accepts and its
 * `user` field (a non-empty printable-ASCII string) becomes the identity.
 */
export type VerifyHook = (
  user: string,
  password: string,
) => unknown | Promise<unknown>;

export type GateOptions = {
  /** Required. HMAC key for the CSRF token (32+ characters). */
  secret: string;
  /** `{ username: argon2id-hash }` map. Required unless `verify` is set. */
  users?: Record<string, string>;
  /** Custom credential backend; overrides `users`. */
  verify?: VerifyHook;
  /** Bring your own login page. */
  template?: (state: LoginTemplateState) => string;
  /** Session idle lifetime in seconds (default 28800 = 8h, sliding). */
  ttl?: number;
  /** Force Secure cookies. Defaults to NODE_ENV=production. */
  secure?: boolean;
  /** 'all' (default): guard every non-/_gate/* request. 'none': endpoints only. */
  protect?: 'all' | 'none';
  /** Override the session cookie name. */
  cookieName?: string;
  /** Where session token files live. Created 0700; must be owned. */
  sessionDir?: string;
};

export type GateMiddleware = (
  c: GateContext,
  next: () => Promise<Response>,
) => Promise<Response>;

/**
 * Build the auth gate: one middleware for compose() that answers the
 * /_gate/{check,login,logout} endpoints itself and guards everything else.
 */
export function gate(opts: GateOptions): GateMiddleware;
