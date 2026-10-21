// Generated from RUNTIME_TABLE in src/emitter.js by `bun run decls`; change the table and regenerate.
export declare const __state: <T>(value: T | { value: T; read(): T }) => { value: T; read(): T; touch(): void };
export declare const __computed: <T>(fn: () => T) => { readonly value: T; read(): T };
export declare const __effect: (fn: () => void | (() => void)) => () => void;
export declare const __batch: <T>(fn: () => T) => T;
export declare const __readonly: <T>(value: T) => Readonly<{ value: T }>;
export declare const __setErrorHandler: (handler: ((error: any, source?: string) => void) | null) => void;
export declare const __handleError: (error: any, source?: string) => void;
export declare const __catchErrors: <F extends (...args: any[]) => unknown>(fn: F) => (this: ThisParameterType<F>, ...args: Parameters<F>) => ReturnType<F> | undefined;
export declare const getEffectSignal: () => AbortSignal | null;
export declare const __setEffectErrorReporter: any;
export declare const __ownerFrame: any;
export declare const __pushOwner: any;
export declare const __popOwner: any;
export declare const __detachRef: any;
export declare const __untracked: any;
