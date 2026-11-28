// The emitter's input shape. src/emit/emitter.js (and the TS face and the
// declaration emitter beside it) read the tree in a shape of their own:
// nodes without an attribute record, booleans and nulls in slots, the
// `void-*` heads, one head per loop form, a catch handler as
// ["catch", binding|null, body], a pick item as
// ["pickitem", key, target, default|null], and headless specifier and
// shorthand-pair nodes, a type annotation as its
// normalized text, and a schema as ["schema", descriptor]. emitterShape
// rewrites the parser's tree (the shape grammar.rip's kind registry
// documents) into that shape.
//
// Every rebuilt array that carried a NodeStore row is registered under
// the original's node id, so marks and role lookups resolve to the same
// rows; arrays without a row (scaffolds) stay without one. The
// `.parenthesized` flag travels with its node. Calls keep their shape
// (["call", attrs, callee, ...args]), which the emitter reads directly,
// and every leaf ([kind, {}, raw]) is its raw string.
//
// Every array the shape builds WITHOUT a head — a parameter, specifier,
// loop-variable, condition or statement list, an interpolation hole, a
// comprehension's clause and guard lists, and the specifier and
// shorthand-pair tuples — is recorded as headless. Its first element is
// a child, and often a user's identifier, which can spell any head: a
// guard on a variable named `object` builds ["object"], and a postfix
// body `block if c` builds ["block"].
// A reader that dispatches on `x[0]` asks `isHeadless(x)` first, so it
// never mistakes such an array for the node its first element spells.

import { isAttrs, isCall, isLeaf, isNode, isNone, leafValue } from './sexpr.js';
import { schemaCodeSites, SCHEMA_TREES } from './schema.js';

const orNull = (x) => (isNone(x) ? null : x);
// The value of a TYPE, CAST or SATISFIES token: ["type", {}, raw, body].
const isTypeValue = (x) => x.length === 4 && x[0] === 'type' && isAttrs(x[1]) && typeof x[2] === 'string';

const headless = new WeakSet();
const bare = (out) => { headless.add(out); return out; };
export const isHeadless = (x) => headless.has(x);

// A lowering's copy of a shaped array keeps what the shape recorded about
// the original — that it is headless, and its `.parenthesized` flag — so
// every reader treats the copy exactly as it treats the original.
export const copyShape = (copy, original) => {
  if (headless.has(original)) headless.add(copy);
  if (original.parenthesized) copy.parenthesized = true;
  return copy;
};

// A schema's embedded code leaves its node: `schemaCode` receives each
// code site's statements keyed by the token array the descriptor holds
// for it (schemaCodeSites), so a projection folded from a schema reaches
// its transforms through the same arrays. The emitter compiles each body
// with a nested emitter, never as part of the enclosing tree.
//
// `shaped` receives each parser node's rebuilt array, which is how the
// emitter finds its own node for a fact analysis states about a parser
// node.
export function emitterShape(sexpr, nodeIds, schemaCode = new Map(), shaped = new Map()) {
  bridge = { shapedOf: new WeakMap(), parserOf: new WeakMap(), conv: null };
  bridge.conv = converter(nodeIds, schemaCode, shaped, bridge);
  return bridge.conv(sexpr);
}

// ── the bridge ──────────────────────────────────────────────────────
// While the emitter's methods move from this shape to the parser's tree
// one area at a time, a converted method reads the parser's tree and an
// unconverted one reads this shape. Each side hands the other its own
// dialect: `toParser` at a converted method's entry, `toShaped` around a
// call into an unconverted method. Every shaped array is registered
// against its parser node, so each function is the other's inverse, and
// both are idempotent. A lowering builds parser nodes (mkNode), which
// `toShaped` converts on first use. A shaped leaf is a string and an
// absent slot is null; neither maps back, so converted code reads both
// through wordOf and `absent`.
//
// The registry is the latest emitterShape call's: emit() reopens the
// one it found when it returns (`bridgeState`/`reopenBridge`), so a
// nested emission never leaves its tree in the enclosing one's.
let bridge = null;
export const bridgeState = () => bridge;
export const reopenBridge = (state) => { bridge = state; };

export const toParser = (x) => (Array.isArray(x) && bridge !== null ? bridge.parserOf.get(x) ?? x : x);

export const toShaped = (x) => {
  if (!Array.isArray(x)) return x;
  if (bridge === null) throw new Error('toShaped: no emitterShape conversion is open');
  if (isNone(x)) return null;
  if (bridge.parserOf.has(x) || !holdsParserNode(x)) return x;
  return bridge.conv(x);
};

// A parser node, or a plumbing list holding one: what toShaped converts.
// A shaped array never holds a parser node.
const holdsParserNode = (x) => isNode(x) || (Array.isArray(x) && x.some(holdsParserNode));

// An optional slot of either dialect: null in this shape, ["none", {}]
// in the parser's tree.
export const absent = (x) => x == null || isNone(x);

function converter(nodeIds, schemaCode, done, { shapedOf, parserOf }) {
  const conv = (x) => {
    if (!Array.isArray(x)) return x;
    const seen = shapedOf.get(x);
    if (seen !== undefined) return seen;
    if (parserOf.has(x)) return x;
    if (isLeaf(x)) return leafValue(x);
    if (isTypeValue(x)) return x[2];
    const out = isNode(x) ? node(x) : bare(x.map(conv));
    const id = nodeIds.get(x);
    if (id !== undefined) nodeIds.set(out, id);
    if (x.parenthesized) out.parenthesized = true;
    register(x, out);
    return out;
  };
  const register = (x, out) => {
    done.set(x, out);
    shapedOf.set(x, out);
    parserOf.set(out, x);
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
      case 'schema': {
        const [, , descriptor, dsl] = kids[0];
        // A projection folded from a schema carries no DSL of its own;
        // its code sites are the source schema's.
        if (!isNone(dsl)) {
          const trees = descriptor[SCHEMA_TREES];
          for (const site of schemaCodeSites(descriptor)) {
            const tree = trees?.get(site.tokens);
            if (tree === undefined) throw new Error(`emitterShape: a schema's code site has no tree (entry ${site.index})`);
            schemaCode.set(site.tokens, conv(tree[3]).slice(1));
          }
        }
        return ['schema', descriptor];
      }
      case 'loop': return loop(x, isNone(x[6]));
      case 'comprehension': {
        const clause = x[3];
        const old = loop(clause, true);
        const id = nodeIds.get(clause);
        if (id !== undefined) nodeIds.set(old, id);
        register(clause, old);
        return ['comprehension', c(0), bare([old]), bare(isNone(clause[5]) ? [] : [conv(clause[5])])];
      }
      case 'try': {
        const out = ['try', c(0)];
        if (!isNone(kids[1])) out.push(c(1));
        if (!isNone(kids[2])) out.push(c(2));
        return out;
      }
      case 'catch': return ['catch', conv(orNull(kids[0])), c(1)];
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
      case 'as': return bare([c(0), c(1)]);
      case 'pickitem': return ['pickitem', c(0), c(1), conv(orNull(kids[2]))];
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
        if (a.shorthand === true) return bare([null, c(0), c(1)]);
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

  return conv;
}
