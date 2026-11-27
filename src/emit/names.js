// Name vocabulary both emitters read, and the repeat-safety judgment
// of a spelled word. The emitter's repeatSafeValue and the analysis
// pass's planner both answer from wordSafety; only the environment that
// decides an identifier differs by engine.
import { isIdentifierName } from '../ident.js';

// Identifier-shaped spellings that are language literals, not
// bindings: reading them repeatedly is free of user code.
// (undefined/NaN/Infinity are non-configurable globals in ES.)
export const LITERAL_WORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

// A component's lifecycle hooks: methods the runtime calls, never
// members.
export const COMPONENT_HOOKS = new Set(['beforeMount', 'mounted', 'beforeUnmount', 'unmounted', 'onError', 'load']);

// Is re-reading the spelled word `w` free of user code? true for
// `this` and a literal spelling (a number, a quoted string, a literal
// word); false for a regex spelling, which is a match and assigns `_`;
// null for an identifier, which is repeat-safe exactly when the current
// lexical environment binds it (a name that resolves nowhere reads
// through globalThis, whose property may be an accessor).
export function wordSafety(w) {
  if (w === 'this') return true;
  if (w[0] === '/') return false;
  if (!isIdentifierName(w)) return true;
  if (LITERAL_WORDS.has(w)) return true;
  return null;
}
