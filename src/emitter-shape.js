// The emitter's input shape. src/emitter.js (and the TS face and the
// declaration emitter beside it) read the tree in a shape of their own:
// nodes without an attribute record, booleans and nulls in slots, the
// `void-*` heads, one head per loop form, and headless catch, specifier,
// pick-item and shorthand-pair nodes. emitterShape rewrites the
// parser's tree (the shape grammar.rip's kind registry documents) into
// that shape.
//
// Every rebuilt array that carried a NodeStore row is registered under
// the original's node id, so marks and role lookups resolve to the same
// rows; arrays without a row (scaffolds) stay without one. The
// `.parenthesized` flag travels with its node. Calls keep their shape
// (["call", attrs, callee, ...args]), which the emitter reads directly.

import { isAttrs, isCall } from './sexpr.js';

const isNone = (x) => Array.isArray(x) && x.length === 2 && x[0] === 'none' && isAttrs(x[1]);
const orNull = (x) => (isNone(x) ? null : x);
const isNode = (x) => Array.isArray(x) && typeof x[0] === 'string' && isAttrs(x[1]);

export function emitterShape(sexpr, nodeIds) {
  const done = new Map();
  const conv = (x) => {
    if (!Array.isArray(x)) return x;
    const seen = done.get(x);
    if (seen !== undefined) return seen;
    const out = isNode(x) ? node(x) : x.map(conv);
    const id = nodeIds.get(x);
    if (id !== undefined) nodeIds.set(out, id);
    if (x.parenthesized) out.parenthesized = true;
    done.set(x, out);
    return out;
  };

  // A loop clause in a comprehension carries no body; its guard belongs
  // to the comprehension.
  const loop = (x, clause) => {
    const [, a, vars, source, step, guard, body] = x;
    const v = conv(vars), s = conv(source);
    switch (a.over) {
      case 'in': return clause ? ['for-in', v, s, conv(orNull(step))] : ['for-in', v, s, conv(orNull(step)), conv(orNull(guard)), conv(body)];
      case 'of': return clause ? ['for-of', v, s, a.own === true] : ['for-of', v, s, a.own === true, conv(orNull(guard)), conv(body)];
      case 'as': return clause ? ['for-as', v, s, a.await === true, null] : ['for-as', v, s, a.await === true, conv(orNull(guard)), conv(body)];
      case 'forever': return ['loop', conv(body)];
      case 'times': return ['loop-n', s, conv(body)];
    }
    throw new Error(`emitterShape: a loop over '${a.over}' has no emitter shape`);
  };

  const node = (x) => {
    const head = x[0];
    const a = x[1];
    const kids = x.slice(2);
    const c = (k) => conv(kids[k]);
    if (isCall(x)) return ['call', a, ...kids.map(conv)];
    switch (head) {
      case 'loop': return loop(x, isNone(x[6]));
      case 'comprehension': {
        const clause = x[3];
        const old = loop(clause, true);
        const id = nodeIds.get(clause);
        if (id !== undefined) nodeIds.set(old, id);
        return ['comprehension', c(0), [old], isNone(clause[5]) ? [] : [conv(clause[5])]];
      }
      case 'try': {
        const out = ['try', c(0)];
        if (!isNone(kids[1])) out.push(c(1));
        if (!isNone(kids[2])) out.push(c(2));
        return out;
      }
      case 'catch': return [conv(orNull(kids[0])), c(1)];
      case 'if': return isNone(kids[2]) ? ['if', c(0), c(1)] : ['if', c(0), c(1), c(2)];
      case 'while': return isNone(kids[1]) ? ['while', c(0), c(2)] : ['while', c(0), c(1), c(2)];
      case 'class': return isNone(kids[2])
        ? ['class', conv(orNull(kids[0])), conv(orNull(kids[1]))]
        : ['class', conv(orNull(kids[0])), conv(orNull(kids[1])), c(2)];
      case 'switch': return ['switch', conv(orNull(kids[0])), c(1), conv(orNull(kids[2]))];
      case 'effect': return ['effect', conv(orNull(kids[0])), c(1)];
      case 'component': return ['component', conv(orNull(kids[0])), c(1)];
      case '..': case '...':
        if (kids.length === 2) return [head, conv(orNull(kids[0])), conv(orNull(kids[1]))];
        break;
      case '++': case '--': return [head, c(0), a.postfix === true];
      case 'return': case 'yield': return isNone(kids[0]) ? [head] : [head, c(0)];
      case 'accept': return isNone(kids[1]) ? ['accept', c(0)] : ['accept', c(0), c(1)];
      case 'as': return [c(0), c(1)];
      case 'pickitem': return [c(0), c(1), conv(orNull(kids[2]))];
      case 'import': {
        const out = ['import'];
        const spec = kids[0];
        if (Array.isArray(spec) && spec.length === 0) out.push('{}');
        else if (!isNone(spec)) out.push(conv(spec));
        if (!isNone(kids[1])) out.push(c(1));
        if (!isNone(kids[2])) out.push(c(2));
        out.push(c(3));
        return out;
      }
      case 'export': case 'export-from': {
        const spec = kids[0];
        const s = Array.isArray(spec) && spec.length === 0 ? '{}' : conv(spec);
        return head === 'export' ? ['export', s] : ['export-from', s, c(1)];
      }
      case 'export-all': return isNone(kids[1]) ? ['export-all', c(0)] : ['export-all', c(0), c(1)];
      case 'typed-var': return ['typed-var', c(0), isNone(kids[1]) ? '' : c(1)];
      case 'array': return ['array', ...kids.map((k) => (isNone(k) ? ',' : conv(k)))];
      case 'str': return ['str', ...kids.map((k) => (isNone(k) ? '' : conv(k)))];
      case 'here-regex': return ['here-regex', c(0), ...kids.slice(1).map((k) => (isNone(k) ? '' : conv(k)))];
      case ':':
        if (a.void === true) return ['void-pair', c(0), c(1)];
        if (a.shorthand === true) return [null, c(0), c(1)];
        break;
      case '=':
        if (a.void === true) return ['void-assign', c(0), c(1)];
        break;
      case 'readonly':
        if (a.void === true) return ['void-readonly', c(0), c(1)];
        break;
      case 'def':
        if (a.void === true) return ['void-def', c(0), c(1), c(2)];
        break;
    }
    return [head, ...kids.map(conv)];
  };

  return conv(sexpr);
}
