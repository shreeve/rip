// @rip-lang/swarm — public type surface.

/** The context handed to every worker: whatever object setup() returned
 *  (plain, structured-cloneable data only), plus the `safe` boolean that
 *  swarm() always sets from the -s/--safe CLI flag. */
export type Context = { safe: boolean } & Record<string, unknown>;

/** The per-task work function. Runs in worker threads; receives the
 *  absolute task-file path and the cloned context. A throw (or rejected
 *  promise) moves the task to died/. */
export type Perform = (taskPath: string, ctx: Context) => unknown;

export interface SwarmOptions {
  /** Runs once in the main thread before workers spawn; a returned
   *  object becomes the worker context. */
  setup?: () => unknown;
  /** Required. Runs in worker threads, once per task. */
  perform: Perform;
  /** Worker thread count (default: CPU count; -w/--workers overrides). */
  workers?: number;
  /** Progress bar width in characters (default: 20; -b/--bar overrides). */
  bar?: number;
  /** Progress bar character, first character used (default: `•`;
   *  -c/--char overrides). */
  char?: string;
}

/** Remove an old .swarm directory and create todo/, done/, and died/. */
export function init(): void;

/** Move .swarm/died/* back to .swarm/todo/ for reprocessing. Returns
 *  true when there is work queued (tasks were moved back, or todo/ was
 *  already non-empty); false when .swarm is absent or nothing remains. */
export function retry(): boolean;

/** Create a task file in .swarm/todo/. The filename is String(name);
 *  string data is written as-is, other data is JSON.stringify'd, and no
 *  data writes an empty file (the filename is the task). */
export function todo(name: string | number, data?: unknown): void;

/** Run the batch. In the main thread: runs setup(), spawns workers,
 *  dispatches every .swarm/todo/ task, renders progress, and resolves
 *  after the summary. In a worker thread: registers perform() and
 *  returns immediately. */
export function swarm(opts: SwarmOptions): Promise<void>;

/** process.argv with swarm's own CLI flags stripped — only your
 *  script's positional arguments remain. */
export function args(): string[];

/** Worker-bootstrap hook: the perform() registered by swarm() in worker
 *  mode (null in the main thread). Used by lib/worker.mjs. */
export function _getPerform(): Perform | null;
