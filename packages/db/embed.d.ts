// @rip-lang/db/embed — boot-time harbor reachability probe.

export type ReachOptions = {
  fetch?: typeof fetch;
};

export function assertReachable(url?: string | null, opts?: ReachOptions): Promise<'running'>;
export function ensureRunning(url?: string | null, opts?: ReachOptions): Promise<'running'>;
