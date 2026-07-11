// The render-block rewrite pass. Inside `render` blocks it rewrites the template
// surface into ordinary call/object syntax the grammar already
// parses, so the LR tables never grow for the DSL:
//
//   .card            → div.card          (implicit div for class-only)
//   .                → div               (bare dot with children)
//   . foo: bar       → div foo: bar      (dot + attribute line)
//   $open: true      → "data-open": true (data-attribute sigil)
//   data-lucide: "x" → "data-lucide": "x" (hyphenated keys re-join)
//   ~fade            → __transition__: "fade"
//   value <=> name   → __bind_value__: name  (two-way binding)
//   .('a', b)        → div.__clsx('a', b) / tag.__clsx(...) /
//                      class: __clsx(...)  (dynamic classes)
//   = expr           → __text__(expr)    (expression text child)
//   button @click    → button @click: @onClick (bare event directive;
//                      the minted handler tokens are ZERO-WIDTH — the
//                      emitter's generated-vs-user discriminator)
//   <tag> INDENT …   → <tag>(-> INDENT …) (implicit child nesting; the
//                      matching CALL_END lands after the OUTDENT)
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
// The event-MODIFIER spelling (`@click.prevent: h`) is deliberately
// unsupported — it stays a loud parse rejection.

const OPENERS = new Set(['(', '[', '{', 'CALL_START', 'INDEX_START', 'PARAM_START',
  'PICK_START', 'OPTPICK_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START']);
const CLOSERS = new Set([')', ']', '}', 'CALL_END', 'INDEX_END', 'PARAM_END',
  'PICK_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END']);

// PascalCase component names (an interior lowercase letter
// distinguishes `Counter` from ALLCAPS constants).
const COMPONENT_RE = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/;

// Token kinds that START a same-line element argument after a bare
// event directive (`button @click "go"` — the text child); the
// separator/closer kinds stay untouched.
const INLINE_CONTENT = new Set(['STRING', 'STRING_START', 'NUMBER', 'BOOL', 'IDENTIFIER', 'PROPERTY', '@', '(', '[', '{']);

import { TEMPLATE_TAGS } from './dom-vocab.js';
import { ops } from './ops.js';

const isHtmlTag = (name) => TEMPLATE_TAGS.has(String(name).split('#')[0]);
const isComponentName = (name) => typeof name === 'string' && COMPONENT_RE.test(name);
const isTemplateTag = (name) => isHtmlTag(name) || isComponentName(name);

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
      if (ops.on) ops.n++;
      const kt = tokAt(arr, k, current)?.kind;
      if (kt === closer) depth++;
      else if (kt === opener) depth--;
      if (depth > 0) k--;
    }
    return k;
  };

  // Does the current logical construct start with a template tag —
  // i.e. is the walk inside a tag-head argument list?
  const startsWithTag = (current) => {
    let j = out.length;
    while (j > 0 && tokAt(out, j, current)?.kind === 'OUTDENT') {
      j = skipBalancedPair(out, j - 1, 'OUTDENT', 'INDENT', current);
    }
    while (j > 0) {
      if (ops.on) ops.n++;
      const pt = out[j - 1].kind;
      if (pt === 'TERMINATOR' || pt === 'RENDER') break;
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
       (j === 0 || ['INDENT', 'TERMINATOR', 'RENDER'].includes(out[j - 1]?.kind)));
  };

  // Net unmatched-opener test: is the CURRENT position nested inside
  // an explicit bracket group (1) or directly at the element-head
  // level (0)? Walks the emitted context back to the line/block
  // boundary.
  const explicitDepthAt = () => {
    let depth = 0;
    for (let k = out.length - 1; k >= 0; k--) {
      if (ops.on) ops.n++;
      const t = out[k].kind;
      if (CLOSERS.has(t)) depth++;
      else if (OPENERS.has(t)) {
        if (depth === 0) return 1;
        depth--;
      } else if (t === 'TERMINATOR' || t === 'RENDER' || t === 'INDENT' || t === 'OUTDENT') {
        break;
      }
    }
    return 0;
  };

  // Is the `@` about to be emitted a bare event DIRECTIVE — a new
  // tag-head argument or an element-body statement — rather than a
  // `@member` inside an attribute value?
  const isBareEventAttr = (current) => {
    const prev = out[out.length - 1];
    if (!prev) return false;
    if (explicitDepthAt() !== 0) return false;
    const pt = prev.kind;
    if ((pt === ',' || pt === 'IDENTIFIER' || pt === 'PROPERTY') && startsWithTag(current)) return true;
    if ((pt === 'INDENT' || pt === 'TERMINATOR') && elementBodyLevels.includes(currentIndent)) return true;
    return false;
  };

  // Retag the ')' matching tokens[from] (a '(' just retagged to
  // CALL_START) to CALL_END — forward, ahead of the cursor.
  const retagMatchingParen = (from) => {
    let depth = 1;
    for (let j = from + 1; j < tokens.length && depth > 0; j++) {
      if (ops.on) ops.n++;
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
      if (ops.on) ops.n++;
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

  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    let t = tokens[i];
    const next = tokens[i + 1] ?? null;

    if (textFrames.length > 0) closeTextFrames(t);

    if (t.kind === 'RENDER') {
      inRender = true;
      renderIndentLevel = currentIndent + 1;
      out.push(t);
      continue;
    }
    if (t.kind === 'INDENT') {
      currentIndent++;
      out.push(t);
      continue;
    }
    if (t.kind === 'OUTDENT') {
      currentIndent--;
      while (elementBodyLevels.length > 0 && elementBodyLevels[elementBodyLevels.length - 1] > currentIndent) {
        elementBodyLevels.pop();
      }
      out.push(t);
      while (pendingCallEnds.length > 0 && pendingCallEnds[pendingCallEnds.length - 1] > currentIndent) {
        out.push(gen('CALL_END', ')', t));
        pendingCallEnds.pop();
      }
      if (inRender && currentIndent < renderIndentLevel) inRender = false;
      continue;
    }
    if (!inRender) {
      out.push(t);
      continue;
    }

    // ── `= expr` at a child position → __text__(expr) ──
    if (t.kind === '=' && out.length > 0) {
      const pt = out[out.length - 1].kind;
      if (pt === 'TERMINATOR' || pt === 'INDENT' || pt === 'RENDER') {
        out.push(gen('IDENTIFIER', '__text__', t, { at: t.start, spaced: t.spaced, newLine: t.newLine }));
        out.push(gen('CALL_START', '(', t, { at: t.start }));
        textFrames.push({ depth: 0 });
        continue;
      }
    }

    // ── Transition directive: `~fade` → __transition__: "fade" ──
    if (t.kind === 'UNARY_MATH' && t.value === '~' && next?.kind === 'IDENTIFIER') {
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
    if (t.kind === 'BIND') {
      const prev = out[out.length - 1];
      if (prev !== undefined && (prev.kind === 'IDENTIFIER' || prev.kind === 'PROPERTY') &&
          next !== null && (next.kind === 'IDENTIFIER' || next.kind === '@')) {
        prev.value = `__bind_${prev.value}__`;
        out.push(gen(':', ':', t));
        continue;
      }
    }

    // ── Data-attribute sigil: `$open:` → "data-open": ── (never on a
    // member/property chain — `obj.$key` stays member access).
    if (t.kind === 'PROPERTY' && t.value[0] === '$' && t.value.length > 1 &&
        !['.', '?.', '@'].includes(out[out.length - 1]?.kind)) {
      out.push({ ...t, kind: 'STRING', value: `"data-${t.value.slice(1)}"` });
      continue;
    }

    // ── Hyphenated attribute keys: `data-lucide:` / `aria-x:` →
    // one STRING key (re-joined from the '-' operator split) ──
    if (t.kind === 'IDENTIFIER' && next?.kind === '-' && !next.spaced) {
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
        let joined = parts.join('-');
        if (joined[0] === '$') joined = `data-${joined.slice(1)}`;
        out.push({ ...t, kind: 'STRING', value: `"${joined}"`, end });
        i = j - 1;
        continue;
      }
    }

    // ── Implicit div for class-only and bare-dot selectors ──
    if (t.kind === '.') {
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
    if (t.kind === '.' && next?.kind === '(') {
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

    // ── Bare event shorthand: `button @click` → `@click: @onClick` ──
    // The minted handler tokens are zero-width (generated) — the
    // emitter validates ONLY these against the DOM-event set and the
    // method's existence; explicit `@name:` bindings stay unvalidated
    // (custom events are legal DOM).
    if (t.kind === '@' && next?.kind === 'PROPERTY' && !next.spaced) {
      const after = tokens[i + 2];
      const isChain = after?.kind === '.';
      const isPair = after?.kind === ':';
      if (!isChain && !isPair && isBareEventAttr(t)) {
        const ev = String(next.value);
        const handler = `on${ev[0].toUpperCase()}${ev.slice(1)}`;
        // A `=` directly after the directive has no sensible reading:
        // the minted handler would become the assignment's target and
        // the assignment's value the invoked listener.
        if (after?.kind === '=') {
          fail(`a \`=\` cannot follow a bare event directive on one line — \`@${ev} = expr\` would assign to the ` +
            `minted handler and invoke the assignment as the listener; bind explicitly (\`@${ev}: handler\`), ` +
            `or keep the bare \`@${ev}\` and put the ` +
            'text on its own `= expr` line', after.start);
        }
        out.push(t);
        out.push(next);
        out.push(gen(':', ':', next));
        out.push(gen('@', '@', next));
        out.push(gen('PROPERTY', handler, next));
        i++;
        // A block INDENT directly after the directive takes the
        // element's children: the minted handler PROPERTY never rides
        // the main loop, so the implicit-nesting rule runs here for
        // it (the in-a-call comma path — `button @click` + block
        // parses as `button({click: onClick}, -> …)`).
        if (tokens[i + 1]?.kind === 'INDENT') {
          out.push(gen(',', ',', next, { at: tokens[i + 1].start }));
          out.push(gen('->', '->', next, { at: tokens[i + 1].start, newLine: true }));
          elementBodyLevels.push(currentIndent + 1);
        } else if (tokens[i + 1] !== undefined && INLINE_CONTENT.has(tokens[i + 1].kind)) {
          // Same-line content directly after the directive is the
          // NEXT element argument (`button @click "go"` means handler
          // plus inline text child — the comma-list spelling's
          // meaning; a value here is never a handler argument).
          // Without the comma the minted handler and the content fuse
          // into one expression (the handler called WITH the text).
          out.push(gen(',', ',', next, { at: tokens[i + 1].start }));
        }
        continue;
      }
    }

    // ── Implicit child nesting: a template element directly before a
    // block INDENT takes its block as children through an injected
    // `(-> …)` (bare tags) or `, -> …` (tags already in a call) ──
    if (next?.kind === 'INDENT' &&
        t.kind !== '->' && t.kind !== '=>' && t.kind !== 'CALL_START' && t.kind !== '(') {
      const pt = out[out.length - 1]?.kind;
      const isAfterControlFlow = ['IF', 'UNLESS', 'WHILE', 'UNTIL', 'WHEN', 'FORIN', 'FOROF', 'FORAS', 'FORASAWAIT', 'BY'].includes(pt);
      const atLineStart = t.kind === 'IDENTIFIER' && (pt === 'INDENT' || pt === 'TERMINATOR' || pt === 'RENDER');

      let isTemplateElement = false;
      let clsxEnd = false;
      if (t.kind === 'CALL_END') clsxEnd = isClsxCallEnd(t);
      if (clsxEnd) {
        isTemplateElement = true;
      } else if (t.kind === 'IDENTIFIER' && isTemplateTag(t.value) && !isAfterControlFlow) {
        isTemplateElement = true;
      } else if (t.kind === 'IDENTIFIER' && !isAfterControlFlow) {
        isTemplateElement = atLineStart || startsWithTag(t);
      } else if (['PROPERTY', 'STRING', 'STRING_END', 'NUMBER', 'BOOL', 'CALL_END', ')', ']', 'INDEX_END', '}', 'PRESENCE'].includes(t.kind)) {
        isTemplateElement = startsWithTag(t);
      }

      if (isTemplateElement) {
        // A `.class`/`#id` tail PROPERTY of a line-starting template
        // tag counts as the bare tag itself.
        let isClassOrIdTail = false;
        if (t.kind === 'PROPERTY' && out[out.length - 1]?.kind === '.') {
          let j = out.length;
          while (j >= 2 && out[j - 1].kind === '.' && out[j - 2].kind === 'PROPERTY') j -= 2;
          if (j >= 2 && out[j - 1].kind === '.' && out[j - 2].kind === 'IDENTIFIER' && isTemplateTag(out[j - 2].value)) {
            const before = out[j - 3]?.kind ?? null;
            if (before === null || ['INDENT', 'OUTDENT', 'TERMINATOR', 'RENDER'].includes(before)) {
              isClassOrIdTail = true;
            }
          }
        }
        const isBareTag = clsxEnd || (t.kind === 'IDENTIFIER' && (isTemplateTag(t.value) || atLineStart)) || isClassOrIdTail;
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
    if (t.kind === 'IDENTIFIER' && isComponentName(t.value) &&
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
