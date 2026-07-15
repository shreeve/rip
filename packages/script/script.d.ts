// @rip-lang/script — public type surface.

/** One step in a conversation script. Dispatch is by runtime type:
 *  string/number match (listen) or send (talk); RegExp matches with
 *  captures; null toggles listen/talk; true continues; false and
 *  symbols are control signals (`:redo`, `:skip`, `:this`, `:pure`);
 *  Object/Map multiplex (first matching key wins, `:else`/`'else'` is
 *  the fallback); arrays nest sub-scripts (`[boolean, ...]` runs
 *  conditionally, `[:pure, ...]` sends raw); functions run and their
 *  return value becomes the next item. */
export type ChatItem =
  | string
  | number
  | RegExp
  | boolean
  | symbol
  | null
  | undefined
  | ChatItem[]
  | Map<unknown, unknown>
  | { [key: string]: unknown }
  | ((...back: unknown[]) => unknown);

/** The awaited result of a script run: the last matched value — a
 *  matched string, `[matchedText, ...captures]` for a regex, a control
 *  symbol, a boolean, or null. */
export type ChatResult = unknown;

/** The callable returned by every factory: run a script, or use the
 *  attached engine surfaces directly. */
export interface Chat {
  (list: ChatItem[]): Promise<ChatResult>;
  /** Send text (plus the configured line terminator). Resolves to the
   *  text sent, or undefined when passed a nullish value. */
  send(text: string | number): Promise<string | undefined>;
  /** Pull one chunk from the transport into the buffer. Resolves to
   *  the grown buffer, or `'fast'`/`'slow'` on a timeout. */
  read(fast?: boolean): Promise<string>;
  /** Close the transport. */
  disconnect(): void;
  /** Unconsumed received data. */
  readonly buffer: string;
  /** The most recent matched text or first capture group. */
  readonly last: string | null;
}

export interface ScriptOptions {
  /** Print received data to stdout in real time (default true). */
  live?: boolean;
  /** Print matched/consumed text to stdout (default false). */
  show?: boolean;
  /** Print sent data to stdout (default false). */
  echo?: boolean;
  /** Strip carriage returns from received data (default true). */
  nocr?: boolean;
  /** Keep ANSI escape sequences (default false = strip). */
  ansi?: boolean;
  /** Throw on timeout (default true; false keeps waiting). */
  bomb?: boolean;
  /** Seconds to wait for output before timing out (default 10). */
  slow?: number;
  /** Seconds for the "is there more data?" check (default 0.25). */
  fast?: number;
  /** Line terminator appended to every send (default "\r"). */
  line?: string;
  /** [min, max] random delay in seconds before each send. */
  wait?: [number, number] | null;
  /** PTY columns for spawn/ssh transports (default 80). */
  cols?: number;
  /** PTY rows for spawn/ssh transports (default 24). */
  rows?: number;
  /** Script run on connect (authentication). */
  auth?: ChatItem[] | null;
  /** Script run after auth (initialization). */
  init?: ChatItem[] | null;
  /** Hook called after each send. */
  onSend?: (text: string) => void;
  /** Hook called after each received chunk. */
  onRecv?: (data: string) => void;
  /** Hook called after each match. */
  onMatch?: (pattern: string | number | RegExp, matched: ChatResult) => void;
}

export class Script {
  /** Spawn a local process on a PTY (via Bun.Terminal). */
  static spawn(cmd: string, args?: string[] | ScriptOptions, opts?: ScriptOptions): Promise<Chat>;
  /** Connect through the `ssh` binary; `url` is a host alias, a
   *  `user@host` form, or a full `ssh://user:pass@host:port` URL
   *  (credentials percent-decoded; a password answers the prompt). */
  static ssh(url: string, opts?: ScriptOptions): Promise<Chat>;
  /** Connect to a raw TCP socket (telnet-style). */
  static tcp(host: string, port: number, opts?: ScriptOptions): Promise<Chat>;
  /** Dispatch on a URL scheme: `spawn://cmd`, `ssh://...`, `tcp://host:port`. */
  static connect(url: string, opts?: ScriptOptions): Promise<Chat>;
  /** Dry-run mode: log EXPECT/SEND/BRANCH lines, no connection. */
  static trace(opts?: ScriptOptions): Chat;
}

/** Sugar for common prompt/response objects (string keys only). */
export function prompts<T extends { [key: string]: unknown }>(obj: T): T;

/** Multiplexer for the "Replace ... With ..." editing dance. */
export function replace(value: unknown): Map<unknown, unknown>;

/** Wrap in double quotes to force an exact match. */
export function quote(value: unknown): string;

/** Multiplexer answering an "Are you adding?" confirmation with Y,
 *  merged with the extra entries when given. (The `value` argument is
 *  unused — a v3 behavior kept as-is.) */
export function enter(
  value: unknown,
  extra?: Map<unknown, unknown> | { [key: string]: unknown },
): Map<unknown, unknown>;

export default Script;
