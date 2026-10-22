// Generated from RUNTIME_TABLE in src/emitter.js by `bun run decls`; change the table and regenerate.
export declare const abort: (msg?: string) => never;
export declare const assert: (v: unknown, msg?: string) => void;
export declare const exit: (code?: number) => never;
export declare const kind: (v: unknown) => string;
export declare const noop: () => void;
export declare const p: (...args: unknown[]) => void;
export declare const pp: <T>(v: T) => T;
export declare const pj: <T>(v: T) => T;
export declare const pr: <T>(v: T) => T;
export declare const raise: { (message: unknown): never; <A>(ctor: new (arg: A) => unknown, arg: A): never };
export declare const rand: (a?: number, b?: number) => number;
export declare const sleep: (ms: number) => Promise<void>;
export declare const toMatchable: (v: unknown) => string;
export declare const todo: (msg?: string) => never;
export declare const warn: (...args: unknown[]) => void;
export declare const zip: <T extends unknown[][]>(...arrays: T) => { [I in keyof T]: T[I] extends (infer E)[] ? E : never }[];
