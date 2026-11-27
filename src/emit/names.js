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

// A function that takes parameters binds no implicit `it`, so a bare
// `it` there must read a binding some scope declares.
export const UNBOUND_IT = 'emitter: bare `it` has no binding here — a function that takes parameters binds no implicit `it` ' +
  '(only a parameterless one does); name a parameter `it`, or read the parameter by its own name';

// The span a bare `it` rejects at, from the nearest node with a NodeStore
// row above it: the one role span of that node spelled `it`, or the
// node's own span when its roles spell `it` nowhere or more than once.
export function bareItSpan(stores, source, nodeId) {
  let hit = null;
  for (const r of stores.rolesOf(nodeId)) {
    if (r.sourceEnd - r.sourceStart !== 2 || source.slice(r.sourceStart, r.sourceEnd) !== 'it') continue;
    if (hit !== null && hit[0] !== r.sourceStart) return stores.selfSpan(nodeId);
    hit = [r.sourceStart, r.sourceEnd];
  }
  return hit ?? stores.selfSpan(nodeId);
}

// A promoted `@name` binds a field, which only a whole parameter can:
// inside a rest or a destructuring pattern JavaScript has no binding form.
export const PROMOTED_IN_PATTERN = (name) =>
  `emitter: a promoted parameter ('@${name}') cannot sit inside a rest or a destructuring pattern — ` +
  `JavaScript binds no \`this.${name}\` there; bind a plain name and assign '@${name} = ${name}' in the body`;

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
