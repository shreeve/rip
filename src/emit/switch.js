// The emitter switch. compile() emits through one of two engines:
// 'v1' (src/emit/emitter.js) or 'v2' (src/emit/index.js). The `emitter` compile
// option chooses; when a caller passes none, the RIP_EMITTER
// environment variable supplies the default, so a whole test run or
// process goes through v2 without plumbing an option into every caller.
// That variable is read here and nowhere else, and the cacher folds the
// resolved default into its key, so a cached emission from one engine
// never answers a compile meant for the other.

export const EMITTERS = ['v1', 'v2'];

const DEFAULT = 'v1';

// The engine an `emitter` option value selects, given the environment's
// default spelling (null when unset). Both reject anything that names
// no engine; an empty variable counts as unset.
export function resolveEmitter(option, envValue) {
  if (option !== undefined) {
    if (!EMITTERS.includes(option)) {
      throw new Error(`compile: unknown emitter ${JSON.stringify(option)} — expected 'v1' or 'v2'`);
    }
    return option;
  }
  if (envValue == null || envValue === '') return DEFAULT;
  if (!EMITTERS.includes(envValue)) {
    throw new Error(`RIP_EMITTER: unknown emitter ${JSON.stringify(envValue)} — expected 'v1' or 'v2'`);
  }
  return envValue;
}

// The browser has no process, so there the default is always DEFAULT.
const envValue = () => globalThis.process?.env?.RIP_EMITTER ?? null;

export const emitterDefault = () => resolveEmitter(undefined, envValue());
