// Host ambient globals for the TS editor face.
//
// `process` and `Bun` are provided by the Bun runtime itself — unlike the
// RUNTIME_TABLE entries the compiler DELIVERS (an IIFE body plus a typed
// destructure), these carry no body, only an ambient `declare`. The
// editor face (emitter.js) injects the declaration for a global WHEN the
// program references its free name, so tsgo resolves it (the generated
// program has no @types/node or bun-types to read). The JS shipping
// emission never carries them, and the strip gate erases them as a
// tsOnly region.
//
// This is COMPILER DATA, not a `.d.ts`: it is emitted INTO the generated
// face, never read by tsgo as a type-input file — so it can never be
// picked up by a tsconfig `**/*.d.ts` glob and double-declare a global.
// To extend the surface, edit the structural type below (the members Rip
// code actually touches, plus an index-signature tail). Keep it a plain
// string map keyed by the global's name — emitter.js injects each value
// verbatim as one `declare var` on the face.

export const HOST_AMBIENTS = {
  process: [
    'declare var process: {',
    '  env: Record<string, string | undefined>;',
    '  argv: string[];',
    '  argv0: string;',
    '  execPath: string;',
    '  platform: string;',
    '  arch: string;',
    '  pid: number;',
    '  version: string;',
    '  versions: Record<string, string>;',
    '  exitCode: number | undefined;',
    '  cwd(): string;',
    '  chdir(directory: string): void;',
    '  exit(code?: number): never;',
    '  nextTick(callback: (...args: any[]) => void, ...args: any[]): void;',
    '  on(event: string, listener: (...args: any[]) => void): void;',
    '  hrtime: { (time?: [number, number]): [number, number]; bigint(): bigint };',
    '  stdout: { write(chunk: string | Uint8Array): boolean };',
    '  stderr: { write(chunk: string | Uint8Array): boolean };',
    '  stdin: { on(event: string, listener: (...args: any[]) => void): void };',
    '  [key: string]: any;',
    '}',
  ].join('\n'),
  Bun: [
    'declare var Bun: {',
    '  version: string;',
    '  revision: string;',
    '  main: string;',
    '  argv: string[];',
    '  env: Record<string, string | undefined>;',
    '  file(path: string | URL, options?: { type?: string }): any;',
    '  write(destination: any, input: any): Promise<number>;',
    '  spawn(command: string[], options?: any): any;',
    '  spawnSync(command: string[], options?: any): any;',
    '  serve(options: any): any;',
    '  listen(options: any): any;',
    '  connect(options: any): Promise<any>;',
    '  sleep(ms: number): Promise<void>;',
    '  sleepSync(ms: number): void;',
    '  which(command: string, options?: any): string | null;',
    '  hash(input: string | Uint8Array, seed?: number): number | bigint;',
    '  resolveSync(specifier: string, parent: string): string;',
    '  fileURLToPath(url: string | URL): string;',
    '  pathToFileURL(path: string): URL;',
    '  inspect(value: any, options?: any): string;',
    '  readableStreamToText(stream: any): Promise<string>;',
    '  readableStreamToJSON(stream: any): Promise<any>;',
    '  readableStreamToArrayBuffer(stream: any): Promise<ArrayBuffer>;',
    '  nanoseconds(): number;',
    '  $: any;',
    '  [key: string]: any;',
    '}',
  ].join('\n'),
};
