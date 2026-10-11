// The render-block rewrite pass. Inside `render` blocks it rewrites the template
// surface into ordinary call/object syntax the grammar already
// parses, so the LR tables never grow for the DSL:
//
//   .card            → div.card          (implicit div for class-only)
//   .                → div               (bare dot with children)
//   . foo: bar       → div foo: bar      (dot + attribute line)
//   data-lucide: "x" → "data-lucide": "x" (hyphenated keys re-join)
//   ~fade            → __transition__: "fade"
//   value <=> name   → __bind_value__: name  (two-way binding)
//   .('a', b)        → div.__clsx('a', b) / tag.__clsx(...) /
//                      class: __clsx(...)  (dynamic classes)
//   = expr           → __text__(expr)    (expression text child)
//   <tag> INDENT …   → <tag>(-> INDENT …) (implicit child nesting; the
//                      matching CALL_END lands after the OUTDENT)
//   <tag> p INDENT … → <tag> p, -> INDENT … (a trailing word the
//                      program binds is a value, whatever tag it
//                      spells; the block stays the line's element's)
//   Counter          → Counter()         (bare PascalCase reference)
//
// Runs BEFORE implicitBlocks (so every INDENT it sees is a real
// scanner block, never a synthesized single-liner wrapper) and before
// implicitObjects/implicitCalls (the injected CALL_START/arrow tokens
// participate in those passes like user-written ones). One walk
// building a fresh array — insertions append, forward retags mutate
// kinds ahead of the cursor, and the `= expr` close rides a pending
// frame (never a splice-in-loop). ACCEPTED BOUND, documented not
// rejected (the same bound tagPostfixConditionals carries): the tag-context
// probes (startsWithTag / explicitDepthAt / isClsxCallEnd) each scan
// back to the current LINE/BLOCK boundary, so the pass is O(line
// length) per probing token — quadratic only on a single line packed
// with directive/nesting triggers (valid input), linear for every
// program with normal lines. The
// extended-tier scaling gate holds the line-count dimension linear.
//
// A listener has one spelling, `@event: handler`: a bare `@event` and
// the event-modifier spelling (`@click.prevent: h`) reject, positioned,
// naming that form.

const OPENERS = new Set(['(', '[', '{', 'CALL_START', 'INDEX_START', 'PARAM_START',
  'PICK_START', 'OPTPICK_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START']);
const CLOSERS = new Set([')', ']', '}', 'CALL_END', 'INDEX_END', 'PARAM_END',
  'PICK_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END']);
// The opener each bracket closer pairs with, for skipping a whole group.
const GROUP_OPENER = { __proto__: null, ')': '(', 'CALL_END': 'CALL_START', ']': '[', 'INDEX_END': 'INDEX_START', '}': '{' };

// PascalCase component names (an interior lowercase letter
// distinguishes `Counter` from ALLCAPS constants).
const COMPONENT_RE = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/;

// Token kinds that START a same-line element argument after a
// transition directive (`p ~fade "x"` — the text child); the
// separator/closer kinds stay untouched.
const INLINE_CONTENT = new Set(['STRING', 'STRING_START', 'NUMBER', 'BOOL', 'IDENTIFIER', 'PROPERTY', '@', '(', '[', '{']);

// The token shapes the value-name tracker reads: what ends a line, the
// operators that declare a name, the line heads whose block is a render
// factory of its own, and what ends a `for` line's variable list.
// Tokens that begin an expression — after a spaced word, a juxtaposed call.
const VALUE_STARTS = new Set(['IDENTIFIER', 'NUMBER', 'STRING', 'STRING_START', 'BOOL', 'NULL', 'UNDEFINED',
  'REGEX', 'REGEX_START', '@', 'THIS', '[', '{', '(', 'PARAM_START', '->', '=>']);
// The event-modifier names other template languages put after a dot.
const MODIFIERS = new Set(['prevent', 'stop', 'once', 'self', 'capture', 'passive']);
const isHyphen = (t) => t?.kind === '-' || (t?.kind === 'MATH' && t.value === '-');
// A line that continues the statement above it at the same indent.
const VALUE_CONTINUATIONS = new Set(['ELSE', 'CATCH', 'FINALLY']);
// Heads whose block a later `else`/`catch`/`finally` line continues.
const BLOCK_VALUE_HEADS = new Set(['IF', 'UNLESS', 'TRY', 'SWITCH']);
const LINE_BREAKS = new Set(['INDENT', 'OUTDENT', 'TERMINATOR']);
const REACTIVE_DECLS = new Set(['REACTIVE_ASSIGN', 'COMPUTED_ASSIGN']);
const PLAIN_ASSIGN = new Set(['=']);
const CONTROL_HEADS = new Set(['IF', 'UNLESS', 'ELSE', 'FOR', 'SWITCH', 'LEADING_WHEN']);
const FOR_SOURCES = new Set(['FORIN', 'FOROF', 'FORAS', 'FORASAWAIT']);

import { TEMPLATE_TAGS } from './dom.js';
import { counter } from './counter.js';
import { isIdentifierName, isCustomElementName } from './ident.js';

const isHtmlTag = (name) => { const tag = String(name).split('#')[0]; return TEMPLATE_TAGS.has(tag) || isCustomElementName(tag); };
export const isComponentName = (name) => typeof name === 'string' && COMPONENT_RE.test(name);
const isTemplateTag = (name) => isHtmlTag(name) || isComponentName(name);

// A plain member path as its dotted text: property access only, rooted at
// an identifier; null for any other node. `this` never roots one.
export function memberPathText(node) {
  if (!Array.isArray(node) || node[0] !== '.' || node.length !== 3 || typeof node[2] !== 'string') return null;
  const segs = [node[2]];
  let cur = node[1];
  while (Array.isArray(cur)) {
    if (cur[0] !== '.' || cur.length !== 3 || typeof cur[2] !== 'string') return null;
    segs.push(cur[2]);
    cur = cur[1];
  }
  if (typeof cur !== 'string' || cur === 'this' || !isIdentifierName(cur)) return null;
  segs.push(cur);
  return segs.reverse().join('.');
}
// A member path whose leaf is a component name; a lowercase leaf is a
// member read, never a tag.
export const componentPathText = (node) => Array.isArray(node) && isComponentName(node[2]) ? memberPathText(node) : null;
export const componentPathRoot = (text) => text.split('.')[0];

export function rewriteRender(tokens, mintId, fail) {
  let has = false;
  for (const t of tokens) {
    if (t.kind === 'RENDER') { has = true; break; }
  }
  if (!has) return tokens;

  const out = [];
  // Zero-width synthetic tokens anchor INSIDE the construct's extent:
  // by default at the origin token's end; `at` overrides (the
  // nesting arrows anchor at the child block's content start so the
  // arrow-body span never opens on layout whitespace).
  const gen = (kind, value, origin, extra = {}) => {
    const { at, ...rest } = extra;
    const pos = at ?? origin.end;
    return {
      id: mintId(),
      kind, value,
      start: pos, end: pos,
      spaced: false, newLine: false, generated: true, origin: origin.id,
      ...rest,
    };
  };

  let inRender = false;
  let inlineRender = false;   // `render div "x"`: the region is that line
  let renderIndentLevel = 0;
  let currentIndent = 0;
  const pendingCallEnds = [];
  // Indent levels at which an element's attribute/child block is
  // directly open — a bare `@event` line at one of these levels is a
  // continuation directive of that element.
  const elementBodyLevels = [];
  // Open `__text__(` frames from `= expr`: each closes with a
  // CALL_END at its first depth-0 TERMINATOR / OUTDENT / closer.
  const textFrames = [];

  // Read a context position: already-emitted tokens live in `out`;
  // position out.length is the token currently being processed.
  const tokAt = (arr, j, current) => (j < arr.length ? arr[j] : current);

  const skipBalancedPair = (arr, from, closer, opener, current) => {
    let depth = 1;
    let k = from;
    while (k >= 0 && depth > 0) {
      if (counter.on) counter.n++;
      const kt = tokAt(arr, k, current)?.kind;
      if (kt === closer) depth++;
      else if (kt === opener) depth--;
      if (depth > 0) k--;
    }
    return k;
  };

  // Is the `;` at out[k] inside a one-line arrow body? An arrow's body
  // runs to the end of its physical line, `;`-separated statements
  // included (`-> a(); b()` is one function), so a `->`/`=>` earlier on
  // the line at the same bracket depth owns the `;`.
  const semicolonInArrowBody = (k) => {
    let depth = 0;
    for (let i = k - 1; i >= 0; i--) {
      if (counter.on) counter.n++;
      const t = out[i];
      if (CLOSERS.has(t.kind)) depth++;
      else if (OPENERS.has(t.kind)) {
        if (depth === 0) return false;
        depth--;
      } else if ((t.kind === '->' || t.kind === '=>') && depth === 0) {
        return true;
      } else if (t.kind === 'INDENT' || t.kind === 'OUTDENT' || t.kind === 'RENDER' ||
                 (t.kind === 'TERMINATOR' && t.value !== ';')) {
        return false;
      }
    }
    return false;
  };

  // Does the current logical construct start with a template tag —
  // i.e. is the walk inside a tag-head argument list?
  const startsWithTag = (current) => {
    let j = out.length;
    while (j > 0 && tokAt(out, j, current)?.kind === 'OUTDENT') {
      j = skipBalancedPair(out, j - 1, 'OUTDENT', 'INDENT', current);
    }
    // A closer probes from before its opener: the group's insides — a
    // `;` within `(-> a(); @b())` among them — never stand for the line.
    const opener = GROUP_OPENER[current?.kind];
    if (opener && j === out.length) j = skipBalancedPair(out, j - 1, current.kind, opener, current);
    while (j > 0) {
      if (counter.on) counter.n++;
      const pt = out[j - 1].kind;
      if (pt === 'TERMINATOR' && out[j - 1].value === ';' && semicolonInArrowBody(j - 1)) {
        j--;
        continue;
      }
      // An inline branch (`if x then button …`, `else span …`) starts
      // its element after the `then`/`else`.
      if (pt === 'TERMINATOR' || pt === 'RENDER' || pt === 'THEN' || pt === 'ELSE') break;
      if (pt === 'OUTDENT') {
        j = skipBalancedPair(out, j - 2, 'OUTDENT', 'INDENT', current);
        continue;
      }
      if (pt === 'INDENT') {
        const jt = tokAt(out, j, current)?.kind;
        if (jt === 'CALL_END' || jt === ')') {
          j = skipBalancedPair(out, j - 1, jt, jt === 'CALL_END' ? 'CALL_START' : '(', current);
          continue;
        }
        break;
      }
      if (pt === 'CALL_END' || pt === ')') {
        j = skipBalancedPair(out, j - 2, pt, pt === 'CALL_END' ? 'CALL_START' : '(', current);
        continue;
      }
      if (pt === 'INTERPOLATION_END') {
        j = skipBalancedPair(out, j - 2, 'INTERPOLATION_END', 'INTERPOLATION_START', current);
        continue;
      }
      if (pt === 'STRING_END') {
        j = skipBalancedPair(out, j - 2, 'STRING_END', 'STRING_START', current);
        continue;
      }
      j--;
    }
    const head = tokAt(out, j, current);
    return head?.kind === 'IDENTIFIER' &&
      (isTemplateTag(head.value) ||
       (j === 0 || ['INDENT', 'TERMINATOR', 'RENDER', 'THEN', 'ELSE'].includes(out[j - 1]?.kind)));
  };

  // Net unmatched-opener test: is the CURRENT position nested inside
  // an explicit bracket group (1) or directly at the element-head
  // level (0)? Walks the emitted context back to the line/block
  // boundary.
  const explicitDepthAt = () => {
    let depth = 0;
    for (let k = out.length - 1; k >= 0; k--) {
      if (counter.on) counter.n++;
      const t = out[k].kind;
      if (CLOSERS.has(t)) depth++;
      else if (OPENERS.has(t)) {
        // An element's own argument list (`p(~fade, "x")`) is the same
        // template position as its paren-less arguments.
        if (depth === 0 && !(t === 'CALL_START' && isHeadCall(k))) return 1;
        if (depth > 0) depth--;
      } else if (t === 'TERMINATOR' && out[k].value === ';') {
        // A `;` separates statements on one physical line; it ends no
        // bracket group, so an opener before it still encloses the
        // cursor — and a one-line arrow body that owns it does too.
        if (depth === 0 && semicolonInArrowBody(k)) return 1;
        continue;
      } else if (t === 'TERMINATOR' || t === 'RENDER' || t === 'INDENT' || t === 'OUTDENT') {
        break;
      }
    }
    return 0;
  };

  // Does out[j] start a template line — after a line break, or after the
  // `then`/`else` of a line an inline branch heads?
  const atTemplateLineStart = (j) => {
    const p = out[j - 1];
    if (!p || p.kind === 'INDENT' || p.kind === 'OUTDENT' || p.kind === 'RENDER' || p.kind === 'TERMINATOR') return true;
    if (p.kind !== 'THEN' && p.kind !== 'ELSE') return false;
    let k = j - 1;
    while (k > 0 && !['INDENT', 'OUTDENT', 'RENDER', 'TERMINATOR'].includes(out[k - 1].kind)) k--;
    return ['IF', 'UNLESS', 'ELSE', 'LEADING_WHEN'].includes(out[k].kind);
  };

  // Is the CALL_START at out[k] an element's own argument list
  // (`p(...)`, `div.card(...)`)? A line-start call of any other word
  // (`basename(@dir) + '/'`) is a text expression.
  const isHeadCall = (k) => {
    let j = k - 1;
    while (j >= 2 && out[j]?.kind === 'PROPERTY' && out[j - 1].kind === '.') j -= 2;
    const head = out[j];
    return head?.kind === 'IDENTIFIER' && !head.generated && isTemplateTag(head.value) &&
      !readsAsValue(head.value) && atTemplateLineStart(j);
  };

  // Is the cursor on a line of an element's argument list that spans
  // lines (`p(` / `~fade` / `"x"` / `)`)?
  const inHeadCallBlock = () => {
    let depth = 0;
    for (let k = out.length - 1; k > 0; k--) {
      if (counter.on) counter.n++;
      const kind = out[k].kind;
      if (CLOSERS.has(kind) || kind === 'OUTDENT') depth++;
      else if (OPENERS.has(kind) || kind === 'INDENT') {
        if (depth > 0) { depth--; continue; }
        return kind === 'INDENT' && out[k - 1].kind === 'CALL_START' && isHeadCall(k - 1);
      } else if (kind === 'RENDER') return false;
    }
    return false;
  };

  // Walk back from out[j] over one comma-separated argument, skipping
  // bracket groups; the index of what bounds it: a top-level `,`, `:`
  // or `=`, or -1 at the line start.
  const argumentStart = (j) => {
    let depth = 0;
    for (let k = j; k >= 0; k--) {
      const kind = out[k].kind;
      if (CLOSERS.has(kind)) depth++;
      else if (OPENERS.has(kind)) { if (depth === 0) return -1; depth--; }
      else if (depth > 0) continue;
      else if (kind === ',' || kind === ':' || kind === '=') return k;
      else if (['INDENT', 'OUTDENT', 'RENDER', 'TERMINATOR'].includes(kind)) return -1;
    }
    return -1;
  };

  // Does out[from..to] hold a juxtaposed call (`wrap go`), whose
  // arguments then run on past a following comma?
  const hasJuxtaposedCall = (from, to) => {
    for (let k = from; k < to; k++) {
      const a = out[k];
      const b = out[k + 1];
      if ((a.kind === 'IDENTIFIER' || a.kind === 'PROPERTY') && a.spaced && VALUE_STARTS.has(b.kind)) return true;
    }
    return false;
  };

  // ── The template gate ──
  // Is an arrow at out[k] a FUNCTION (its body is code) or an element's
  // children arrow (its body is template)? An arrow right after an
  // element's head or argument list (`div ->`, `div title: 't', ->`,
  // a nesting arrow this pass mints) opens children; after `@ev:`, a
  // parameter list, `=`, or inside brackets it opens a function.
  const isCodeArrow = (k) => {
    const a = out[k];
    if (a.generated) return false;
    const prev = out[k - 1];
    if (!prev || prev.generated) return true;
    // An arrow ending a value (`@click: debounce ->`, `x = wrap ->`) is
    // a function argument; one ending the head or a bare word
    // (`div ->`, `div hidden ->`) opens children.
    if (prev.kind === 'IDENTIFIER' || prev.kind === 'PROPERTY') {
      const s = argumentStart(k - 1);
      return s >= 0 && out[s].kind !== ',';
    }
    // After a comma the arrow is the next argument: an element's
    // children, unless a juxtaposed call in a value owns the comma
    // (`@click: wrap go, ->`).
    if (prev.kind === ',') {
      const s = argumentStart(k - 2);
      return s >= 0 && out[s].kind !== ',' && hasJuxtaposedCall(s + 1, k - 1);
    }
    return true;
  };

  // Does a function arrow earlier on this physical line own the rest of
  // it (`@click: -> a(); b`)? Brackets opened after the arrow stay its.
  const inArrowBodyOnLine = () => {
    let depth = 0;
    for (let k = out.length - 1; k >= 0; k--) {
      if (counter.on) counter.n++;
      const t = out[k];
      if (CLOSERS.has(t.kind)) depth++;
      else if (OPENERS.has(t.kind)) { if (depth === 0) return false; depth--; }
      else if ((t.kind === '->' || t.kind === '=>') && depth === 0) return isCodeArrow(k);
      else if (t.kind === 'INDENT' || t.kind === 'OUTDENT' || t.kind === 'RENDER' ||
               (t.kind === 'TERMINATOR' && t.value !== ';')) return false;
    }
    return false;
  };

  // The one question every template rewrite asks: is the current token
  // in CODE — a function body, the rest of a line after a function
  // arrow, an `= expr` text body, or a bracket group opened inside the
  // template? Template rewrites apply only where this answers false.
  const inCode = () =>
    frames[frames.length - 1] === true || valueLine !== null || codeLevels.length > 0 || textFrames.length > 0 ||
    explicitDepthAt() !== 0 || inArrowBodyOnLine();

  // Does the `else`/`catch`/`finally` about to be emitted continue a
  // value's `if`/`try` (`title: if ok` / `1` / `else 2`)? Its owner opens
  // the block just closed; a markup branch heads its line, while a value's
  // follows a `:`, `=` or other operand on it.
  const continuesValue = () => {
    let k = out.length - 1;
    if (out[k]?.kind !== 'OUTDENT') return false;
    for (let depth = 0; k >= 0; k--) {
      if (out[k].kind === 'OUTDENT') depth++;
      else if (out[k].kind === 'INDENT' && --depth === 0) break;
    }
    let owner = -1;
    for (let j = k - 1; j >= 0 && !['INDENT', 'OUTDENT', 'RENDER', 'TERMINATOR'].includes(out[j].kind); j--) {
      if (BLOCK_VALUE_HEADS.has(out[j].kind)) owner = j;
    }
    if (owner <= 0) return false;
    const before = out[owner - 1].kind;
    return !['INDENT', 'OUTDENT', 'RENDER', 'TERMINATOR', 'ELSE'].includes(before);
  };

  // Is the block about to open the body of an `if`/`unless`/`switch`/`try`
  // in a value on its line (`span title: if ok`), not a markup branch? A
  // `key:` or `=` before the branch makes everything after it a value
  // (`title: if a then "x" else if b`, `title: fmt "x", if b`); with none,
  // a branch is markup heading its line or after `then`/`else`/`,`, and a
  // value's after anything else (`"p" + if ok`).
  const opensValueBlock = () => {
    let depth = 0;
    let head = -1;
    for (let k = out.length - 1; k >= 0; k--) {
      const kind = out[k].kind;
      if (CLOSERS.has(kind)) { depth++; continue; }
      if (OPENERS.has(kind)) { if (depth === 0) return head >= 0 ? valueHead(head) : false; depth--; continue; }
      if (LINE_BREAKS.has(kind) || kind === 'RENDER') break;
      if (depth !== 0) continue;
      if (head < 0 && BLOCK_VALUE_HEADS.has(kind)) head = k;
      else if (head >= 0 && (kind === ':' || kind === '=' || kind === 'COMPOUND_ASSIGN')) return true;
    }
    return head >= 0 && valueHead(head);
  };
  const valueHead = (k) => {
    const before = out[k - 1]?.kind;
    return !(before === undefined || LINE_BREAKS.has(before) || before === 'RENDER' ||
      before === 'THEN' || before === 'ELSE' || before === ',');
  };

  // Does the bracket or block tokens[i] opens hold code? Inside code,
  // everything is code. A block holds code after a function arrow, after
  // `key:` or `=` (a value spanning lines), or on a render local's
  // line; a bracket holds code unless it is an element's own argument
  // list. Element children and markup control-flow blocks are template.
  const opensCode = (i, t) => {
    if (frames[frames.length - 1] === true || valueLine !== null || textFrames.length > 0) return true;
    if (t.kind === 'INDENT') {
      const p = tokens[i - 1];
      if (p && (p.kind === '->' || p.kind === '=>')) return out[out.length - 1] === p && isCodeArrow(out.length - 1);
      return p?.kind === ':' || p?.kind === '=' || p?.kind === 'COMPOUND_ASSIGN' || opensValueBlock();
    }
    return !(t.kind === 'CALL_START' && isHeadCall(out.length));
  };

  // Does a block opening after the current token belong to code? Asked
  // AFTER the token, since a closer that ends a bracket group
  // (`class: [...]`, `@click: (-> a(); b())`) leaves its line in template
  // position. A one-line arrow body ends with its line, so it never owns
  // the block below (`form @submit: -> e.preventDefault(); save()` keeps
  // its children).
  const blockInCode = (t) => {
    if (codeLevels.length > 0 || textFrames.length > 0) return true;
    // Plain bracket depth, the current token included: a `;` inside a
    // one-line arrow body opens nothing the block could belong to.
    let depth = CLOSERS.has(t.kind) ? 1 : OPENERS.has(t.kind) ? -1 : 0;
    for (let k = out.length - 1; k >= 0; k--) {
      if (counter.on) counter.n++;
      const kind = out[k].kind;
      if (CLOSERS.has(kind)) depth++;
      else if (OPENERS.has(kind)) { if (depth === 0) return true; depth--; }
      else if (kind === 'INDENT' || kind === 'OUTDENT' || kind === 'RENDER' ||
               (kind === 'TERMINATOR' && out[k].value !== ';')) break;
    }
    return depth < 0;
  };

  // Is the `@` about to be emitted at an element-argument position — a
  // new tag-head argument or an element-body statement — rather than a
  // `@member` inside an attribute value or in code?
  const isBareEventAttr = (current) => {
    const prev = out[out.length - 1];
    if (!prev) return false;
    if (inCode()) return false;
    const pt = prev.kind;
    if ((pt === ',' || pt === 'IDENTIFIER' || pt === 'PROPERTY') && startsWithTag(current)) return true;
    if (pt === 'CALL_START' && isHeadCall(out.length - 1)) return true;
    if ((pt === 'INDENT' || pt === 'TERMINATOR') && inHeadCallBlock()) return true;
    if ((pt === 'INDENT' || pt === 'TERMINATOR') && elementBodyLevels.includes(currentIndent)) return true;
    return false;
  };

  // Retag the ')' matching tokens[from] (a '(' just retagged to
  // CALL_START) to CALL_END — forward, ahead of the cursor.
  const retagMatchingParen = (from) => {
    let depth = 1;
    for (let j = from + 1; j < tokens.length && depth > 0; j++) {
      if (counter.on) counter.n++;
      const k = tokens[j].kind;
      if (k === '(' || k === 'CALL_START') depth++;
      else if (k === ')') {
        depth--;
        if (depth === 0) tokens[j].kind = 'CALL_END';
      } else if (k === 'CALL_END') depth--;
    }
  };

  // Is a CALL_END the close of a `__clsx(` call? (OUTDENTs inside
  // multiline `.()` args blind startsWithTag, so clsx ownership is
  // checked first, by balance.)
  const isClsxCallEnd = (current) => {
    let depth = 1;
    for (let j = out.length - 1; j >= 0 && depth > 0; j--) {
      if (counter.on) counter.n++;
      if (out[j].kind === 'CALL_END') depth++;
      else if (out[j].kind === 'CALL_START') {
        depth--;
        if (depth === 0 && j > 0 && out[j - 1].kind === 'PROPERTY' && out[j - 1].value === '__clsx') {
          return true;
        }
      }
    }
    return false;
  };

  const closeTextFrames = (t) => {
    while (textFrames.length > 0) {
      const top = textFrames[textFrames.length - 1];
      if (t.kind === 'INDENT' || OPENERS.has(t.kind)) {
        top.depth++;
        return;
      }
      if (t.kind === 'OUTDENT' || CLOSERS.has(t.kind)) {
        if (top.depth === 0) {
          out.push(gen('CALL_END', ')', out[out.length - 1] ?? t));
          textFrames.pop();
          continue;
        }
        top.depth--;
        return;
      }
      if (t.kind === 'TERMINATOR' && top.depth === 0) {
        out.push(gen('CALL_END', ')', out[out.length - 1] ?? t));
        textFrames.pop();
        continue;
      }
      return;
    }
  };

  // ── Words that read as values ──
  // A word that spells a tag name is a VALUE wherever the program
  // binds it — a render loop variable, a render local, a member of the
  // enclosing component, a module-level reactive name: the names the
  // emitter reads as text in a child position. The nesting rule asks
  // here before it hands a trailing word the block beneath its line,
  // so a bound word keeps its value reading and the block belongs to
  // the element the line starts. Every binding form is a line-start
  // token shape, read off the tape:
  //   module   `name :=` / `name ~=` at depth 0, anywhere in the file
  //   member   the first name of each component-body line, anywhere
  //            in the body (every body line declares a member)
  //   loop     `for item, index in …` — bound for the loop's block
  //   local    `name = …` at a render line start — bound from there
  //            to the end of its control-flow block (a read from a
  //            nested block is the emitter's positioned rejection)
  // A function body inside render binds nothing here: its names are
  // plain JavaScript locals, never render names.
  const startsLine = (j) => j === 0 || LINE_BREAKS.has(tokens[j - 1].kind);
  const declares = (j, kinds) => {
    const after = tokens[j + 1]?.kind === 'TYPE' ? tokens[j + 2] : tokens[j + 1];
    return after !== undefined && kinds.has(after.kind);
  };

  const moduleValues = new Set();
  for (let j = 0, depth = 0; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    const k = tokens[j].kind;
    if (k === 'INDENT') depth++;
    else if (k === 'OUTDENT') depth--;
    else if (depth === 0 && k === 'IDENTIFIER' && (startsLine(j) || tokens[j - 1].kind === 'EXPORT') &&
             declares(j, REACTIVE_DECLS)) {
      moduleValues.add(tokens[j].value);
    }
  }

  // The members of the component whose body opens after tokens[from].
  const memberNames = (from) => {
    const names = new Set();
    let j = from + 1;
    while (j < tokens.length && !LINE_BREAKS.has(tokens[j].kind)) j++;
    if (tokens[j]?.kind !== 'INDENT') return names;
    for (let depth = 0; j < tokens.length; j++) {
      if (counter.on) counter.n++;
      const k = tokens[j].kind;
      if (k === 'INDENT') depth++;
      else if (k === 'OUTDENT' && --depth === 0) break;
      if (depth !== 1 || !LINE_BREAKS.has(k)) continue;
      let h = j + 1;
      if (tokens[h]?.kind === 'OFFER' || tokens[h]?.kind === 'ACCEPT') h++;
      if (tokens[h]?.kind === '@') h++;
      if (tokens[h]?.kind === 'IDENTIFIER' || tokens[h]?.kind === 'PROPERTY') names.add(tokens[h].value);
    }
    return names;
  };

  const memberFrames = [];   // { level, names } per open component body
  const renderScopes = [];   // { level, names } per open render control-flow block
  const codeLevels = [];     // indent levels of open function bodies inside render
  const frames = [];         // per open input bracket or block in render: true when it holds code
  let pendingFrame;          // the frame the previous token opens (a boolean) or closes (null)
  let lineHead = null;       // kind of the current line's first token
  let valueLine = null;      // indent of an open render-local line (`x = …`): its value, blocks and
                             // `else`/`catch`/`finally` continuations included, is code
  let loopVars = null;       // the variables of the `for` line being read

  const readsAsValue = (name) =>
    renderScopes.some((s) => s.names.has(name)) ||
    (memberFrames.length > 0 && memberFrames[memberFrames.length - 1].names.has(name)) ||
    moduleValues.has(name);

  // Module-level names a template line head may read as a value: plain
  // and reactive declarations and import bindings (readsAsValue keeps its
  // own, narrower set for block attachment).
  const moduleBindings = new Set(moduleValues);
  for (let j = 0, depth = 0, importLine = false; j < tokens.length; j++) {
    const k = tokens[j].kind;
    if (k === 'INDENT') depth++;
    else if (k === 'OUTDENT') depth--;
    if (LINE_BREAKS.has(k)) { importLine = false; continue; }
    if (depth !== 0) continue;
    if (k === 'IMPORT' && startsLine(j)) importLine = true;
    else if (importLine && k === 'IDENTIFIER') moduleBindings.add(tokens[j].value);
    else if ((k === 'DEF' || k === 'CLASS') && tokens[j + 1]?.kind === 'IDENTIFIER') moduleBindings.add(tokens[j + 1].value);
    else if ((k === '{' || k === '[') && startsLine(j)) {
      // A destructuring declaration (`{a} = …`, `[a, b] = …`).
      let m = j;
      for (let d = 0; m < tokens.length; m++) {
        if (OPENERS.has(tokens[m].kind)) d++;
        else if (CLOSERS.has(tokens[m].kind) && --d === 0) break;
      }
      if (/ASSIGN$|^=$/.test(tokens[m + 1]?.kind ?? '')) {
        for (let n = j; n < m; n++) if (tokens[n].kind === 'IDENTIFIER') moduleBindings.add(tokens[n].value);
      }
    }
    else if (k === 'IDENTIFIER' && (startsLine(j) || tokens[j - 1]?.kind === 'EXPORT') && /ASSIGN$|^=$/.test(tokens[j + 1]?.kind ?? '')) {
      moduleBindings.add(tokens[j].value);
    }
  }
  const boundHere = (name) => readsAsValue(name) || moduleBindings.has(name);

  // The `.class` chain of an element heading its line, from the `.` at j:
  // each class joins its tight `-` runs (a digit run, or a word after a
  // digit run, too) into one name; anything else glued on rejects.
  // Glued in the source: one token ends where the next begins (a line
  // break or a space between them is not).
  const touches = (x, y) => x && y && !y.generated && y.start === x.end;

  const joinSelectorClasses = (j) => {
    while (tokens[j]?.kind === '.' && !tokens[j].spaced && tokens[j + 1]?.kind === 'PROPERTY' && touches(tokens[j], tokens[j + 1])) {
      const cls = tokens[j + 1];
      let name = String(cls.value);
      let k = j + 2;
      let ok = true;
      while (!name.includes('#')) {
        const a = tokens[k];
        const b = tokens[k + 1];
        if (isHyphen(a) && touches(tokens[k - 1], a) && touches(a, b) && (b.kind === 'NUMBER' || b.kind === 'IDENTIFIER' || b.kind === 'PROPERTY')) {
          // A digit run, which may carry the element's id (`p-4#x`).
          if (b.kind === 'NUMBER' && !/^[0-9]+(?:#.+)?$/.test(String(b.value))) ok = false;
          name += '-' + String(b.value);
          k += 2;
        } else if ((a?.kind === 'IDENTIFIER' || a?.kind === 'PROPERTY') && tokens[k - 1].kind === 'NUMBER' && touches(tokens[k - 1], a)) {
          name += String(a.value);
          k += 1;
        } else break;
      }
      const next = tokens[k];
      if (touches(tokens[k - 1], next) && (next.kind === 'STRING' || next.kind === 'STRING_START')) {
        fail("a space goes between an element's selector and its text", next.start);
      }
      const glued = touches(tokens[k - 1], next) && !LINE_BREAKS.has(next.kind) &&
        next.kind !== '.' && next.kind !== 'CALL_START' && next.kind !== '(' && next.kind !== ',';
      if (glued && next.kind === ':' && !touches(next, tokens[k + 1])) {
        fail("an element's `.class` takes no `:` — an attribute goes after a space (`div.card title: …`)", next.start);
      }
      if (!ok || glued) {
        let written = name;
        for (let m = k; touches(tokens[m - 1], tokens[m]) && !LINE_BREAKS.has(tokens[m].kind) && tokens[m].kind !== 'STRING'; m++) {
          written += String(tokens[m].value);
        }
        fail(`a class shorthand is letters, digits, \`-\` and \`_\` — write \`class: '${written}'\``, cls.start);
      }
      if (k > j + 2) tokens.splice(j + 1, k - (j + 1), { ...cls, value: name, end: tokens[k - 1].end });
      j += 2;
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    let t = tokens[i];
    let next = tokens[i + 1] ?? null;

    // A bracket or block takes effect after the token that opens it, so
    // the opener itself is judged in its parent's context.
    if (pendingFrame === null) frames.pop();
    else if (pendingFrame !== undefined) frames.push(pendingFrame);
    pendingFrame = undefined;
    if (inRender) {
      if (OPENERS.has(t.kind) || t.kind === 'INDENT') pendingFrame = opensCode(i, t);
      else if ((CLOSERS.has(t.kind) || t.kind === 'OUTDENT') && frames.length > 0) pendingFrame = null;
    }

    if (textFrames.length > 0) closeTextFrames(t);

    if (!LINE_BREAKS.has(t.kind) && startsLine(i)) {
      lineHead = t.kind;
      if (valueLine !== null && (currentIndent < valueLine ||
          (currentIndent === valueLine && !VALUE_CONTINUATIONS.has(t.kind)))) valueLine = null;
      if (inRender && valueLine === null && !inCode() &&
          ((t.kind === 'IDENTIFIER' && next?.kind === '=') || (VALUE_CONTINUATIONS.has(t.kind) && continuesValue()))) {
        valueLine = currentIndent;
      }
    }
    if (t.kind === 'COMPONENT') memberFrames.push({ level: currentIndent + 1, names: memberNames(i) });

    if (t.kind === 'RENDER') {
      inRender = true;
      frames.length = 0;
      inlineRender = next !== null && next.kind !== 'INDENT';
      renderIndentLevel = currentIndent + 1;
      renderScopes.push({ level: renderIndentLevel, names: new Set() });
      out.push(t);
      continue;
    }
    if (t.kind === 'INDENT') {
      currentIndent++;
      if (inRender) {
        const opener = tokens[i - 1]?.kind;
        if (valueLine !== null) {
          codeLevels.push(currentIndent);
        } else if ((opener === '->' || opener === '=>') && out[out.length - 1] === tokens[i - 1]) {
          if (isCodeArrow(out.length - 1)) codeLevels.push(currentIndent);
          else elementBodyLevels.push(currentIndent);
        } else if (codeLevels.length === 0 && CONTROL_HEADS.has(lineHead)) {
          renderScopes.push({ level: currentIndent, names: new Set(lineHead === 'FOR' ? loopVars ?? [] : []) });
        }
      }
      loopVars = null;
      out.push(t);
      continue;
    }
    if (t.kind === 'OUTDENT') {
      currentIndent--;
      for (const frames of [memberFrames, renderScopes]) {
        while (frames.length > 0 && frames[frames.length - 1].level > currentIndent) frames.pop();
      }
      while (codeLevels.length > 0 && codeLevels[codeLevels.length - 1] > currentIndent) codeLevels.pop();
      while (elementBodyLevels.length > 0 && elementBodyLevels[elementBodyLevels.length - 1] > currentIndent) {
        elementBodyLevels.pop();
      }
      out.push(t);
      while (pendingCallEnds.length > 0 && pendingCallEnds[pendingCallEnds.length - 1] > currentIndent) {
        out.push(gen('CALL_END', ')', t));
        pendingCallEnds.pop();
      }
      if (inRender && currentIndent < renderIndentLevel) {
        inRender = false;
        valueLine = null;
      }
      continue;
    }
    // An inline render's region is its line and the block under it: the
    // first line break back at the render's own level, outside any
    // bracket, ends it, so later members are code.
    if (inRender && inlineRender && (t.kind === 'TERMINATOR' && t.value !== ';') &&
        currentIndent < renderIndentLevel && explicitDepthAt() === 0) {
      inRender = false;
      inlineRender = false;
      valueLine = null;
    }
    if (!inRender) {
      out.push(t);
      continue;
    }

    // The lexer joins a tight hyphen run at a block's first word into one
    // custom-element name; in code that name would be raw JavaScript.
    if (t.kind === 'IDENTIFIER' && !t.generated && String(t.value).includes('-') && inCode()) {
      fail(`\`${String(t.value).split('#')[0]}\` here is a value, not an element — write it with spaces (\`${String(t.value).split('#')[0].split('-').join(' - ')}\`) for subtraction`, t.start);
    }

    // A template line headed by an element's selector — a tag word no
    // binding shadows, or a bare `.` with a glued class. The scanner joins
    // letter runs into class names; the gate, which knows this line is an
    // element, joins the rest (`p-4`, `col-span-2`, `w-2xl`) and rejects a
    // class the shorthand cannot hold, pointing at `class: '…'`. A bound
    // name heading a line is a value, and its chain stays code.
    if (atTemplateLineStart(out.length) && !inCode()) {
      const head = String(t.value ?? '').split('#')[0];
      if (t.kind === 'IDENTIFIER' && !t.generated && isHtmlTag(head) && !boundHere(head)) joinSelectorClasses(i + 1);
      else if (t.kind === '.' && tokens[i + 1]?.kind === 'PROPERTY' && !tokens[i + 1].spaced) joinSelectorClasses(i);
    }

    // An `#id` the scanner glued onto a digit run (`p-4#x`) belongs to an
    // element's class, which the line-head join consumed; anywhere else it
    // is no id, and no JavaScript either.
    if (t.kind === 'NUMBER' && String(t.value).includes('#')) {
      const id = String(t.value).slice(String(t.value).indexOf('#'));
      fail(`\`${id}\` is no element id here: an id follows the HTML tag or \`.class\` that starts its line, and a comment needs a space before \`#\``, t.start);
    }

    // An inline branch's element may be a custom element
    // (`if x then sl-icon …`): in markup its tight hyphen run is one tag
    // name, as at a line start. In a value it stays subtraction.
    if (t.kind === 'IDENTIFIER' && (out[out.length - 1]?.kind === 'THEN' || out[out.length - 1]?.kind === 'ELSE') &&
        isHyphen(tokens[i + 1]) && !tokens[i + 1].spaced && tokens[i + 2]?.kind === 'IDENTIFIER' && !tokens[i + 2].spaced &&
        atTemplateLineStart(out.length) && !inCode()) {
      let j = i + 1;
      let name = String(t.value);
      while (isHyphen(tokens[j]) && !tokens[j].spaced &&
             (tokens[j + 1]?.kind === 'IDENTIFIER' || tokens[j + 1]?.kind === 'PROPERTY') && !tokens[j + 1].spaced) {
        name += '-' + String(tokens[j + 1].value);
        j += 2;
      }
      if (tokens[j]?.kind !== ':') {
        tokens.splice(i, j - i, { ...t, value: name, end: tokens[j - 1].end });
        t = tokens[i];
        next = tokens[i + 1] ?? null;
      }
    }

    if (codeLevels.length === 0 && startsLine(i)) {
      if (t.kind === 'FOR') {
        loopVars = [];
        for (let j = i + 1; j < tokens.length && !FOR_SOURCES.has(tokens[j].kind) && !LINE_BREAKS.has(tokens[j].kind); j++) {
          if (tokens[j].kind === 'IDENTIFIER') loopVars.push(tokens[j].value);
        }
      } else if (t.kind === 'IDENTIFIER' && declares(i, PLAIN_ASSIGN)) {
        renderScopes[renderScopes.length - 1]?.names.add(t.value);
      }
    }

    // ── `= expr` at a child position → __text__(expr) ──
    if (t.kind === '=' && out.length > 0 && !inCode()) {
      const pt = out[out.length - 1].kind;
      if (pt === 'TERMINATOR' || pt === 'INDENT' || pt === 'RENDER') {
        out.push(gen('IDENTIFIER', '__text__', t, { at: t.start, spaced: t.spaced, newLine: t.newLine }));
        out.push(gen('CALL_START', '(', t, { at: t.start }));
        textFrames.push({ depth: 0 });
        continue;
      }
    }

    // ── Transition directive: `~fade` → __transition__: "fade" ──
    if (t.kind === 'UNARY_MATH' && t.value === '~' && next?.kind === 'IDENTIFIER' && isBareEventAttr(t)) {
      out.push(gen('PROPERTY', '__transition__', t, { spaced: t.spaced, newLine: t.newLine }));
      out.push(gen(':', ':', t));
      // The name token mutates to the STRING value IN PLACE (not
      // consumed), so a following INDENT still sees a completed value
      // and the nesting rule runs for it. The marker lets the STRING's
      // own iteration separate same-line content with a comma.
      next.kind = 'STRING';
      next.value = `"${next.value}"`;
      next.transitionValue = true;
      continue;
    }

    // Same-line content directly after a transition directive is the
    // NEXT element argument (`span ~fade "hi"` means transition pair
    // plus inline text child — the bare-directive inline-text rule).
    // Without the comma the minted STRING and the content fuse into
    // a tagged template, which emits invalid JS.
    if (t.transitionValue && next !== null && INLINE_CONTENT.has(next.kind)) {
      out.push(t);
      out.push(gen(',', ',', t, { at: next.start }));
      continue;
    }

    // ── Two-way binding: `value <=> name` → `__bind_value__: name` ──
    // The attribute key renames IN PLACE (already emitted) and the
    // BIND token becomes the pair colon. The `@` right-hand spelling
    // (`value <=> @name`) binds the same member.
    // A BIND whose neighbors match no attribute-pair shape survives
    // untouched — a loud parse rejection (no grammar home).
    if (t.kind === 'BIND' && !inCode()) {
      const prev = out[out.length - 1];
      if (prev !== undefined && (prev.kind === 'IDENTIFIER' || prev.kind === 'PROPERTY') &&
          next !== null && (next.kind === 'IDENTIFIER' || next.kind === '@')) {
        prev.value = `__bind_${prev.value}__`;
        out.push(gen(':', ':', t));
        continue;
      }
    }

    // ── Hyphenated attribute keys: `data-lucide:` / `aria-x:` →
    // one STRING key (re-joined from the '-' operator split) ──
    if (t.kind === 'IDENTIFIER' && next?.kind === '-' && !next.spaced && !inCode()) {
      const parts = [t.value];
      let j = i + 1;
      let end = t.end;
      while (j + 1 < tokens.length && tokens[j].kind === '-' && !tokens[j].spaced &&
             (tokens[j + 1].kind === 'IDENTIFIER' || tokens[j + 1].kind === 'PROPERTY') &&
             !tokens[j + 1].spaced) {
        parts.push(tokens[j + 1].value);
        end = tokens[j + 1].end;
        const wasProperty = tokens[j + 1].kind === 'PROPERTY';
        j += 2;
        if (wasProperty) break;
      }
      if (parts.length > 1 && tokens[j - 1].kind === 'PROPERTY') {
        const joined = parts.join('-');
        out.push({ ...t, kind: 'STRING', value: `"${joined}"`, end });
        i = j - 1;
        continue;
      }
    }

    // A line-leading `.` inside an `= expr` body would continue the
    // expression in code, but the scanner splits the line in render, so
    // the continuation has no reading here yet; it rejects, positioned.
    if (t.kind === '.' && textFrames.length > 0 && (out[out.length - 1]?.kind === 'INDENT' || out[out.length - 1]?.kind === 'TERMINATOR')) {
      fail('the `= expr` text form takes ONE expression — an indented continuation under the `=` line has no ' +
        'render reading (inside render a leading `.` starts a NEW element, so the continuation cannot be a method ' +
        'chain; put the whole expression on the `=` line, or bind it in a method)', t.start);
    }

    // ── Implicit div for class-only and bare-dot selectors ──
    if (t.kind === '.' && !inCode()) {
      const pt = out[out.length - 1]?.kind;
      if (pt === 'INDENT' || pt === 'TERMINATOR' || pt === 'RENDER') {
        if (next?.kind === 'PROPERTY') {
          const nn = tokens[i + 2];
          if (!nn || nn.kind !== ':') {
            // `.card` → div.card (the dot survives as the chain link).
            out.push(gen('IDENTIFIER', 'div', t, { spaced: t.spaced, newLine: t.newLine }));
            out.push(t);
            continue;
          }
          // `. foo: bar` → div with attributes: the dot IS the div.
          t = { ...t, kind: 'IDENTIFIER', value: 'div' };
          // falls through (an IDENTIFIER now — nesting below applies)
        } else if (!next || next.kind !== '(') {
          // Bare `.` (with children) → div.
          t = { ...t, kind: 'IDENTIFIER', value: 'div' };
        }
      }
    }

    // ── Dynamic classes: `.( … )` → __clsx call ──
    if (t.kind === '.' && next?.kind === '(' && !inCode()) {
      const pt = out[out.length - 1]?.kind;
      const atLineStart = pt === 'INDENT' || pt === 'TERMINATOR' || pt === 'RENDER';
      next.kind = 'CALL_START';
      retagMatchingParen(i + 1);
      if (atLineStart) {
        out.push(gen('IDENTIFIER', 'div', t, { spaced: t.spaced, newLine: t.newLine }));
        out.push(t);
        out.push(gen('PROPERTY', '__clsx', t));
      } else if (pt === ':') {
        // `class: .('active', …)` → class: __clsx('active', …)
        out.push(gen('IDENTIFIER', '__clsx', t, { spaced: t.spaced, newLine: t.newLine }));
      } else {
        out.push(t);
        out.push(gen('PROPERTY', '__clsx', t));
      }
      continue;
    }

    // A quoted event name would listen for the quotes too; the
    // unquoted name is the one spelling, hyphens included.
    if (t.kind === '@' && next?.kind === 'STRING' && !next.spaced && tokens[i + 2]?.kind === ':' && isBareEventAttr(t)) {
      const ev = String(next.value).slice(1, -1);
      fail(`an event name is written unquoted — \`@${ev}: handler\``, next.start);
    }

    // ── A listener is `@event: handler` — the one spelling (RFC 3) ──
    // At an element-argument position, `@word` with no `:` would be a
    // listener without a handler; it rejects, naming the explicit form.
    // A member chain there (`p @user.name`) stays text, and an event
    // modifier (`@click.prevent:`) rejects with the handler form.
    if (t.kind === '@' && next?.kind === 'PROPERTY' && !next.spaced) {
      // A listener key's event name runs through tight hyphens
      // (`@sl-change: go` listens for `sl-change`; custom elements name
      // their events so). The run joins into the one PROPERTY only when
      // a `:` ends it — anywhere else a hyphen keeps its meaning.
      let j = i + 2;
      let name = String(next.value);
      while (isHyphen(tokens[j]) && !tokens[j].spaced &&
             (tokens[j + 1]?.kind === 'IDENTIFIER' || tokens[j + 1]?.kind === 'PROPERTY') && !tokens[j + 1].spaced) {
        name += '-' + String(tokens[j + 1].value);
        j += 2;
      }
      if (j > i + 2 && tokens[j]?.kind === ':' && isBareEventAttr(t)) {
        tokens.splice(i + 1, j - (i + 1), { ...next, value: name, end: tokens[j - 1].end });
        next = tokens[i + 1];
      }
      const after = tokens[i + 2];
      if (after?.kind !== ':' && isBareEventAttr(t)) {
        const ev = String(next.value);
        if (after?.kind === '.' && tokens[i + 3]?.kind === 'PROPERTY' && tokens[i + 4]?.kind === ':') {
          const call = { prevent: 'e.preventDefault(); ', stop: 'e.stopPropagation(); ' }[tokens[i + 3].value] ?? '';
          fail(`event modifiers are not supported — handle it in the listener: \`@${ev}: (e) -> ${call}…\``, after.start);
        }
        // `@click.prevent` with no `:` reads as the member chain
        // `this.click.prevent` — unless `click` is no member and the
        // property is a modifier, where it is a listener written wrong.
        if (after?.kind === '.' && MODIFIERS.has(tokens[i + 3]?.value) && !readsAsValue(ev)) {
          const call = { prevent: 'e.preventDefault(); ', stop: 'e.stopPropagation(); ' }[tokens[i + 3].value] ?? '';
          fail(`\`@${ev}.${tokens[i + 3].value}\` reads \`${ev}\`, which is no member here; event modifiers are not supported — handle it in the listener: \`@${ev}: (e) -> ${call}…\``, after.start);
        }
        if (j === i + 2 && isHyphen(after)) {
          fail('an event name after `@` is words joined by tight hyphens, like `@sl-change: handler`', t.start);
        }
        if (after?.kind !== '.') {
          const text = j > i + 2 ? '' : `, or \`= @${ev}\` on its own line to show the member as text`;
          fail(`\`@${j > i + 2 ? name : ev}\` needs a handler — write \`@${j > i + 2 ? name : ev}: handler\` for a listener${text}`, t.start);
        }
      }
    }

    // ── Implicit child nesting: a template element directly before a
    // block INDENT takes its block as children through an injected
    // `(-> …)` (bare tags) or `, -> …` (tags already in a call) ──
    if (next?.kind === 'INDENT' && !blockInCode(t) &&
        t.kind !== '->' && t.kind !== '=>' && t.kind !== 'CALL_START' && t.kind !== '(') {
      const pt = out[out.length - 1]?.kind;
      const isAfterControlFlow = ['IF', 'UNLESS', 'WHILE', 'UNTIL', 'WHEN', 'FORIN', 'FOROF', 'FORAS', 'FORASAWAIT', 'BY'].includes(pt);
      const atLineStart = t.kind === 'IDENTIFIER' && (pt === 'INDENT' || pt === 'TERMINATOR' || pt === 'RENDER');

      // A word after the line's head names an element only while the
      // program binds no value to it; a line-starting word is the head
      // whatever it names.
      const isTagWord = t.kind === 'IDENTIFIER' && isTemplateTag(t.value) && (atLineStart || !readsAsValue(t.value));

      let isTemplateElement = false;
      let clsxEnd = false;
      if (t.kind === 'CALL_END') clsxEnd = isClsxCallEnd(t);
      if (clsxEnd) {
        isTemplateElement = true;
      } else if (isTagWord && !isAfterControlFlow) {
        isTemplateElement = true;
      } else if (t.kind === 'IDENTIFIER' && !isAfterControlFlow) {
        isTemplateElement = atLineStart || startsWithTag(t);
      } else if (['PROPERTY', 'STRING', 'STRING_END', 'NUMBER', 'BOOL', 'CALL_END', ')', ']', 'INDEX_END', '}', 'MAYBE_DAMMIT'].includes(t.kind)) {
        isTemplateElement = startsWithTag(t);
      }

      if (isTemplateElement) {
        // A `.class`/`#id` tail PROPERTY of a line-starting template
        // tag counts as the bare tag itself, and so does the component
        // leaf of a line-starting member path (`UI.Menu.Popup`).
        let isClassOrIdTail = false;
        if (t.kind === 'PROPERTY' && out[out.length - 1]?.kind === '.') {
          let j = out.length;
          while (j >= 2 && out[j - 1].kind === '.' && out[j - 2].kind === 'PROPERTY') j -= 2;
          if (j >= 2 && out[j - 1].kind === '.' && out[j - 2].kind === 'IDENTIFIER' &&
              (isTemplateTag(out[j - 2].value) || isComponentName(t.value))) {
            const before = out[j - 3]?.kind ?? null;
            if (before === null || ['INDENT', 'OUTDENT', 'TERMINATOR', 'RENDER'].includes(before)) {
              isClassOrIdTail = true;
            }
          }
        }
        const isBareTag = clsxEnd || isTagWord || atLineStart || isClassOrIdTail;
        out.push(t);
        if (isBareTag) {
          out.push(gen('CALL_START', '(', t, { at: next.start }));
          out.push(gen('->', '->', t, { at: next.start, newLine: true }));
          pendingCallEnds.push(currentIndent + 1);
        } else {
          out.push(gen(',', ',', t, { at: next.start }));
          out.push(gen('->', '->', t, { at: next.start, newLine: true }));
        }
        elementBodyLevels.push(currentIndent + 1);
        continue;
      }
    }

    // ── Bare PascalCase reference: `Counter` → `Counter()` ──
    if (t.kind === 'IDENTIFIER' && isComponentName(t.value) && !inCode() &&
        (next?.kind === 'OUTDENT' || next?.kind === 'TERMINATOR')) {
      out.push(t);
      out.push(gen('CALL_START', '(', t));
      out.push(gen('CALL_END', ')', t));
      continue;
    }

    out.push(t);
  }

  // Same array identity — callers hold the reference (indexed copy,
  // never a spread; the lexer's own convention).
  tokens.length = out.length;
  for (let i = 0; i < out.length; i++) tokens[i] = out[i];
  return tokens;
}

// The keys a component body reads back through the rest view:
// `@rest.<key>`, `@rest['key']`, and a `{ key } = @rest` pattern.
// `class` and `className` are one attribute and count as each other.
// Both roads read this set: the emitter's host-line merge, where a read
// of `class` or `style` puts that key in the author's hands, and the
// type face's props surface, where a read of any other key keeps it
// passable though the line sets it.
// The forms that destructure a pattern from a value: `=`, `:=`, and
// `=!`. A call or an array carrying an object beside `@rest` is not a
// read of the object's keys.
const PATTERN_OPS = new Set(['=', 'state', 'readonly']);
export function restReadKeys(stmts) {
  const reads = new Set();
  const isNode = Array.isArray;
  const isRestView = (n) => isNode(n) && n[0] === '.' && n[1] === 'this' && n[2] === 'rest';
  const unquote = (k) => k.replace(/^"|"$/g, '');
  const scan = (n) => {
    if (!isNode(n)) return;
    if (n[0] === '.' && isRestView(n[1]) && typeof n[2] === 'string') reads.add(n[2]);
    else if (n[0] === '[]' && isRestView(n[1]) && typeof n[2] === 'string' && /^".*"$/.test(n[2])) reads.add(unquote(n[2]));
    else if (PATTERN_OPS.has(n[0]) && n.length === 3 && isNode(n[1]) && n[1][0] === 'object' && isRestView(n[2])) {
      for (const pair of n[1].slice(1)) if (isNode(pair) && typeof pair[1] === 'string') reads.add(unquote(pair[1]));
    }
    for (const c of n) scan(c);
  };
  for (const st of stmts) scan(st);
  if (reads.has('class') || reads.has('className')) { reads.add('class'); reads.add('className'); }
  return reads;
}
