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
