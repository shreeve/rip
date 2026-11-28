// The emitter's shared vocabulary: head sets, name classes and the
// module-edge text helpers the declaration pipeline also reads. The tree
// readers are src/emit/tree.js.

import { identifierRunAt, isCustomElementName } from '../ident.js';
import { TEMPLATE_TAGS } from '../dom.js';

// Component member vocabulary. The hooks (src/emit/names.js) are the
// type story's too. The runtime fields are the instance slots
// src/runtime/components.js owns: a member of that name would be
// overwritten by the runtime.
export const COMPONENT_RUNTIME_FIELDS = new Set([
  '_state', '_frame', '_parent', '_children', '_root', '_nodes', '_target',
  '_context', '_rest', '_restWriters', '_restHandlers', '_inheritedEl', '_inheritedInst', '_inheritedOwn',
  '_refCleanups', '_initFailed', '_hmrOrphans', '_hmrReleasing', '_hmrPropKeys', '_hmrResetPending', '_hmrReset', '_asChild',
  '_boundCache',
]);

export const BINOPS = new Set(['+', '-', '*', '/', '%', '**', '<', '>', '<=', '>=', '==', '!=', '&&', '||', '??', '<<', '>>', '>>>', '&', '^', '|']);
// The void definition (`save! = ->`) is an '=' with the `void` flag:
// assignment shape throughout (hoisting, grouping tier, class-body
// walks); its own emission validates the function value and suppresses
// the implicit return.
export const ASSIGNS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '^=', '|=']);
// Every assignment head, the two synthesized compounds included
// (`//=` and `%%=` lower through a helper call and sit outside ASSIGNS).
export const isAssignHead = (h) => ASSIGNS.has(h) || h === '//=' || h === '%%=';
// Assignment heads that declare or mutate a RENDER LOCAL at a render
// child position: `=` declares, the compound forms mutate. Other
// assignment heads have no render reading and reject.
export const RENDER_BINDING_HEADS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=']);
export const JS_OP = { '==': '===', '!=': '!==' };

// The keyword literals as the tree spells them. The scanner's table
// (types.js VALUE_WORDS) maps the SOURCE spellings — `yes`/`no` and the
// literal keywords — onto these; only the lowered side survives into
// the tree. None is a binding: never a destructuring target, never a
// value `typeof` can name.
export const PATTERN_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this']);
// The heads that shape a destructuring pattern rather than stand as one
// of its write targets.
export const PATTERN_HEADS = new Set(['array', 'object', 'rest', '...', 'default', '=', 'cast', 'satisfies', 'typed-var']);
// Identifier tokens inside opaque type text. Strings and comments are skipped:
// their word-shaped contents are values, not type-name occurrences. The caller
// supplies the source-base offset when these become MappingStore spans.
export const typeIdentifierTokens = (text, base = 0) => {
  const out = [];
  let quote = null;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 2;
      else { if (ch === quote) quote = null; i++; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    const identifier = identifierRunAt(text, i);
    if (identifier !== null) {
      out.push({
        value: identifier.value,
        start: base + identifier.start,
        end: base + identifier.end,
      });
      i = identifier.end;
      continue;
    }
    i++;
  }
  return out;
};

// The four links a member/index spine is built from. A spine carrying
// an optional link anywhere along it cannot be constructed THROUGH —
// `new a?.b()` is a syntax error, not a runtime one — so it seals first;
// tree.js `optionalGuard` is the walk that finds the link, and it
// already descends every one of these.
export const SPINE_HEADS = new Set(['.', '?.', '[]', 'optindex']);
// Every row whose evaluation invokes a function, whatever the callee
// spells: `f!` is the awaited call, a tagged template calls its tag.
export const CALL_KINDS = new Set(['call', 'optcall', 'super', 'dammit', 'maybe-dammit', 'tagged', 'dynimport']);
// The standard generic globals' type parameters: augmenting a generic
// interface must repeat its parameter list (`interface Array<T>`), and
// repeating it lets a member's annotation NAME the parameter
// (`Array::second: () => T`). Heads outside this table augment bare.
// Null-prototype: the head is USER identifier text, so an inherited
// Object.prototype member (`constructor::m`) must never satisfy the
// lookup.
export const PROTO_GENERIC_PARAMS = {
  __proto__: null,
  Array: '<T>', ReadonlyArray: '<T>', Map: '<K, V>', Set: '<T>',
  WeakMap: '<K, V>', WeakSet: '<T>', Promise: '<T>', WeakRef: '<T>',
};

// The comparison family — every COMPARE-level operator chains,
// equality included (otherwise `a == b < c` silently compares a
// boolean against c).
export const COMPARISONS = new Set(['<', '>', '<=', '>=', '==', '!=']);
export const RENDER_FUNC_CHILD = 'emitter: a function is not a render child — an element takes its children as the indented lines ' +
  'under it, or after a `->` that follows its head or arguments';
// What findCapturedCtrl looks for.
export const CTRL_ALL = new Set(['break', 'continue', 'return']);
export const CTRL_BREAK = new Set(['break']);
// The frame of a scope whose statements are words alone.
export const NONE = new Map();
export const EMPTY_FRAME = { reactive: NONE, computed: NONE, readonly: NONE, handles: NONE, own: NONE, classes: NONE, importSpecs: NONE, exportedConst: NONE };

// Render-DSL name classes: template tags come from the
// spec-derived vocabulary; PascalCase names (an interior lowercase
// letter distinguishes `Counter` from ALLCAPS constants) are
// component references.
export const isHtmlTag = (name) => { const tag = String(name).split('#')[0]; return TEMPLATE_TAGS.has(tag) || isCustomElementName(tag); };
// Module source strings emit single-quoted; the token value carries
// normalized double quotes, so embedded single quotes (and
// backslashes) must escape or the emitted specifier breaks the
// string it sits in. Shared with declaration emission — the two
// renderings of one module edge must never drift.
export function moduleSourceText(s) {
  const inner = String(s).slice(1, -1).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${inner}'`;
}
