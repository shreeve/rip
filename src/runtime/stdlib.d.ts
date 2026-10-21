// Generated from RUNTIME_TABLE in src/emitter.js by `bun run decls`; change the table and regenerate.
export declare const abort: (msg?: string) => never;
export declare const assert: (v: any, msg?: string) => void;
export declare const exit: (code?: number) => never;
export declare const kind: (v: any) => string;
export declare const noop: () => void;
export declare const p: (...args: any[]) => void;
export declare const pp: <T>(v: T) => T;
export declare const pj: <T>(v: T) => T;
export declare const pr: <T>(v: T) => T;
export declare const raise: (a: any, b?: any) => never;
export declare const rand: (a?: number, b?: number) => number;
export declare const sleep: (ms: number) => Promise<void>;
export declare const toMatchable: (v: any) => string;
export declare const todo: (msg?: string) => never;
export declare const warn: (...args: any[]) => void;
export declare const zip: (...arrays: any[][]) => any[][];
