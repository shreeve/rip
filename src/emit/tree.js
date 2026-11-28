// The emitter's shape predicates over the parser's tree (src/grammar/
// grammar.rip `kinds`): a node is [head, attrs, ...children], so child k
// sits at index k + 2. The heads and head sets are helpers.js's; the
// predicates of the same names there read emitterShape's tree, for the
// methods not yet converted to this one.

import { isNode, wordOf } from '../sexpr.js';
import { BINOPS, ASSIGNS, COMPARISONS, SPINE_HEADS } from './helpers.js';

export const isBinary = (x) => isNode(x) && BINOPS.has(x[0]) && x.length === 4;
export const isUnary = (x) => isNode(x) && x.length === 3 &&
  (x[0] === '-' || x[0] === '+' || x[0] === '!' || x[0] === '~' || x[0] === 'typeof' || x[0] === 'delete');
// A plain or compound assignment; the void definition (`save! = ->`) is
// an `=` with the `void` flag.
export const isAssign = (x) => isNode(x) && ASSIGNS.has(x[0]) && x.length === 4;
export const isRelation = (x) => isNode(x) && x.length === 4 && (x[0] === 'in' || x[0] === 'of' || x[0] === 'instanceof' ||
  x[0] === '!in' || x[0] === '!of' || x[0] === '!instanceof');
export const isIf = (x) => isNode(x) && x[0] === 'if' && x.length === 5;
export const isRange = (x) => isNode(x) && (x[0] === '..' || x[0] === '...') && x.length === 4;
export const isSpread = (x) => isNode(x) && x[0] === '...' && x.length === 3;
export const isObjectShape = (x) => isNode(x) && x[0] === 'object';
export const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 4;
export const isUpdate = (x) => isNode(x) && (x[0] === '++' || x[0] === '--') && x.length === 3;
export const isTernary = (x) => isNode(x) && x[0] === '?:' && x.length === 5;
export const isBlock = (x) => isNode(x) && x[0] === 'block';
// A loop over a source (`in`, `of`, `as`): its vars, iterable, step,
// guard and body sit at 2–6; a comprehension's clause has no body.
export const isSourceLoop = (x) => isNode(x) && x[0] === 'loop' && x.length === 7 &&
  (x[1].over === 'in' || x[1].over === 'of' || x[1].over === 'as');
export const isLoopNode = (x) => isNode(x) && ((x[0] === 'loop' && x.length === 7) || (x[0] === 'while' && x.length === 5));
export const isComprehensionNode = (x) => isNode(x) && x[0] === 'comprehension' && x.length === 4 && isSourceLoop(x[3]);
export const isSpine = (x) => isNode(x) && SPINE_HEADS.has(x[0]) && x.length === 4;
// `X.new` as a callee is the construction sugar, never a property read.
export const isRubyNew = (x) => isNode(x) && x[0] === '.' && x.length === 4 && wordOf(x[3]) === 'new';
// A comparison whose left operand is a comparison the source did not
// parenthesize: the pair is a chain link (`a < b < c`).
export const isChainLink = (x) => isNode(x) && COMPARISONS.has(x[0]) && x.length === 4 &&
  isNode(x[2]) && COMPARISONS.has(x[2][0]) && x[2].length === 4 && !x[2].parenthesized;
// The postfix spelling of `?:` (`x if c else y`, or the unkinded
// ternary a `return x if c else y` lifts) chains and hoists; the
// operator spelling (`c ? x : y`, kind `ternary`) emits as it parsed.
export function isPostfixTernary(stores, x) {
  if (!isTernary(x)) return false;
  const id = stores.idOf(x);
  return (id !== null ? stores.node(id)?.semanticKind : null) !== 'ternary';
}
