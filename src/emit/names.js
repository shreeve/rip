// Name vocabulary both emitters read, and the repeat-safety judgment
// of a spelled word. The emitter's repeatSafeValue and the analysis
// pass's planner both answer from wordSafety; only the environment that
// decides an identifier differs by engine.
import { isIdentifierName } from '../ident.js';
import { SPINE_HEADS } from './helpers.js';

// Identifier-shaped spellings that are language literals, not
// bindings: reading them repeatedly is free of user code.
// (undefined/NaN/Infinity are non-configurable globals in ES.)
export const LITERAL_WORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

// A component's lifecycle hooks: methods the runtime calls, never
// members.
export const COMPONENT_HOOKS = new Set(['beforeMount', 'mounted', 'beforeUnmount', 'unmounted', 'onError', 'load']);

// Only a parameterless function value binds an implicit `it`, so a
// bare `it` anywhere else must read a binding some scope declares.
export const UNBOUND_IT =
  'emitter: bare `it` has no binding here — only a parameterless function value binds an implicit `it` (a def, a method, an effect, a computed, a render body and a function that takes parameters bind none); ' +
  'name a parameter `it`, or read the value by its own name';

// A render local read inside a dynamic block below the one that declares
// it: each block is its own factory function, which the local never
// reaches.
export const RENDER_LOCAL_HIDDEN = (name) =>
  `emitter: render local '${name}' is not visible here — each dynamic block (a conditional branch, a loop body) is its own factory function, and render locals never cross that boundary; declare the local inside this block, or use a member`;

// An update (`x++`) ahead of its scope's own declaration of the name:
// the declaration binds the name across the whole scope, so the update
// reaches it (a hoisted def, a const in its temporal dead zone).
export const UPDATE_BEFORE_DECLARATION = (name, line, kind) => {
  const what = kind === 'plain' ? 'const declaration' : kind;
  return `emitter: '${name}' is updated${line !== null ? ` on line ${line}` : ''} before its ${what} — the ${what} binds the name ` +
    'across the whole scope, so the update would reach it; declare it first, or choose a different name';
};

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

// A schema code site's source span, from its written tokens: where a
// bare `it` with no node above it (a body that is the word alone)
// rejects. null for a site with no written token.
export function islandSpan(tokens) {
  let start = null;
  let end = null;
  for (const t of tokens) {
    if (t.generated) continue;
    if (start === null) start = t.start;
    end = t.end;
  }
  return start === null ? null : [start, end];
}

// A promoted `@name` binds a field, which only a whole parameter can:
// inside a rest or a destructuring pattern JavaScript has no binding form.
export const PROMOTED_IN_PATTERN = (name) =>
  `emitter: a promoted parameter ('@${name}') cannot sit inside a rest or a destructuring pattern — ` +
  `JavaScript binds no \`this.${name}\` there; bind a plain name and assign '@${name} = ${name}' in the body`;

// The heads of a member or index target: a pattern element that writes
// a property rather than binding a name. The spine links themselves.
export const MEMBER_HEADS = SPINE_HEADS;

// A parameter list and a loop head declare their names, and a member is
// no name: JavaScript has no declaring form for it.
export const MEMBER_IN_PARAMETER = 'emitter: a parameter pattern binds names only — a member or index target cannot sit inside it, ' +
  'since JavaScript declares no property in a parameter list; bind a plain name and assign the member in the body';
export const MEMBER_LOOP_VARIABLE = 'emitter: a loop variable binds names only — a member or index target cannot be one, ' +
  'since JavaScript declares loop variables with `let`; loop over a plain name and assign the member in the body';

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
