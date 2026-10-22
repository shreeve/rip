// Generated from RUNTIME_TABLE in src/emitter.js and src/ts/runtime-exports.js by `bun run decls`; change the source and regenerate.
type __RipOwnerFrame = {
  readonly depth: number;
  readonly disposed: boolean;
  readonly size: number;
  add(disposer: () => void): void;
  remove(disposer: () => void): void;
  dispose(): void;
};

type __RipOwnerToken = {
  frame: __RipOwnerFrame;
  prev: __RipOwnerFrame | null;
};

export declare const __state: <T>(value: T | {
  value: T;
  read(): T;
}) => {
  value: T;
  read(): T;
  touch(): void;
};

export declare const __computed: <T>(fn: () => T) => {
  readonly value: T;
  read(): T;
};

export declare const __effect: (fn: () => void | (() => void)) => () => void;
export declare const __batch: <T>(fn: () => T) => T;

export declare const __readonly: <T>(value: T) => Readonly<{
  value: T;
}>;

export declare const __setErrorHandler: (handler: ((error: unknown) => void) | null) => ((error: unknown) => void) | null;
export declare const __handleError: (error: unknown) => void;
export declare const __catchErrors: <F extends (...args: never[]) => unknown>(fn: F) => (this: ThisParameterType<F>, ...args: Parameters<F>) => ReturnType<F> | undefined;
export declare const getEffectSignal: () => AbortSignal | null;
export declare const __setEffectErrorReporter: (reporter: (label: string, error: unknown) => void) => (label: string, error: unknown) => void;

export declare const __ownerFrame: (options?: {
  nested?: boolean;
}) => __RipOwnerFrame;

export declare const __pushOwner: (frame: __RipOwnerFrame) => __RipOwnerToken;
export declare const __popOwner: (token: __RipOwnerToken) => void;

export declare const __detachRef: (cell: {
  read(): unknown;
  value: unknown;
} | null | undefined, el: unknown) => void;

export declare const __untracked: <T>(fn: () => T) => T;
