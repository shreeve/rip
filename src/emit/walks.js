// Whole-tree walks the lowerings share that read the Emitter's static
// predicates: which names a subtree references and which it binds.

import { isPlainCall, isList, isNode, isNone, isStruct, wordOf } from '../sexpr.js';
import { ASSIGNS, isHtmlTag } from './helpers.js';
import { atParamField, isBlock, isFunc, isIf, isSourceLoop } from './tree.js';
import { Emitter } from './core.js';

// Does the tree REFERENCE any of `names` as a free identifier?
// Identifier references are words in VALUE position; the walk skips
// the positions where a word is a NAME, not a reference: member
// property names, plain object/pair keys (dynamicKey nodes recurse —
// those ARE references), function/def names and their parameter
// binding names, class names, assignment targets, type strings
// (typed-var/cast annotations erase), and import statements (import bindings are program-scope bindings —
// the suppression set, not references). PATTERN contexts —
// function/def parameters, loop heads, pattern-assignment targets,
// catch bindings — are BINDING positions: shorthand elements there
// ({SchemaError}, [SchemaError]) are binding names, never
// references, while default-value expressions, computed keys, and
// member/index targets inside a pattern stay references (object
// SHORTHAND in expression position — x = {SchemaError} — remains a
// reference; only patterns bind). String/number literals keep
// their source spelling (quotes included), so they never equal a
// name. A function's parameters shadow the names they bind
// throughout its body, and a word in a render block's tag position
// names an element, never a value: a tag word that a render local,
// loop variable or member shadows is that component's own name, and
// any other is the element. Every other function-scope binding
// suppresses nothing: a reference under one still counts.
export const referencesNames = (sexpr, names, stores) => {
  if (names.size === 0) return false;
  // The names a parameter list binds: a bare name, the target of a
  // default, a rest, an annotation, or a destructuring pattern's leaves.
  const paramBindings = (params) => {
    const out = new Set();
    const bind = (p) => {
      const w = wordOf(p);
      if (w !== undefined) { out.add(w); return; }
      if (!isNode(p)) return;
      const h = p[0];
      if (h === 'object' || h === 'array') p.slice(2).forEach(bind);
      else if (h === ':' && p.length === 4) bind(p[3]);
      else if ((h === '=' || h === 'default' || h === 'typed-var') && p.length === 4) bind(p[2]);
      else if ((h === 'rest' || h === '...') && p.length === 3) bind(p[2]);
    };
    if (isList(params)) params.forEach(bind);
    return out;
  };
  const walkBody = (params, body) => {
    const shadowed = paramBindings(params);
    const live = [...names].filter((n) => !shadowed.has(n));
    if (live.length === names.size) return walk(body);
    return referencesNames(body, new Set(live), stores);
  };
  const semanticKind = (x) => {
    const id = stores.idOf(x);
    return id !== null ? stores.node(id)?.semanticKind : null;
  };
  const isTagWord = (w) => typeof w === 'string' && isHtmlTag(w.split('#')[0]);
  const tagOf = (head) => {
    if (isTagWord(wordOf(head))) return true;
    if (isNode(head) && head[0] === '.') return isTagWord(Emitter.collectTemplateClasses(head).tag);
    return false;
  };
  // A render statement: a tag word or a tag call names an element, and
  // a tag call's children block is render, as a branch's or a loop's
  // body is. Anything else is an expression.
  const walkRender = (x) => {
    const w = wordOf(x);
    if (w !== undefined) return !isTagWord(w) && names.has(w);
    if (isBlock(x)) return x.slice(2).some(walkRender);
    if (isPlainCall(x) && tagOf(x[2])) {
      return x.slice(3).some((a) => (isNode(a) && a[0] === 'children' && a.length === 3 ? walkRender(a[2]) : walk(a)));
    }
    if (isNode(x) && x[0] === '.' && tagOf(x)) return false;
    if (isIf(x)) return walk(x[2]) || walkRender(x[3]) || walkRender(x[4]);
    if (isSourceLoop(x)) return x[2].some(walkPattern) || walk(x[3]) || walk(x[4]) || walk(x[5]) || walkRender(x[6]);
    return walk(x);
  };
  const walkParams = (params) => isList(params) && params.some(walkPattern);
  // Binding-position walk: words are binding names (skipped); only the
  // expression slots inside a pattern can reference.
  const walkPattern = (p) => {
    if (!isNode(p) || wordOf(p) !== undefined) return false;
    const [h, a] = p;
    if (h === 'object' || h === 'array') return p.slice(2).some(walkPattern);
    if (h === ':' && a.shorthand === true) return false;
    if (h === ':' && a.void !== true && p.length === 4) return (isStruct(p[2]) && walk(p[2])) || walkPattern(p[3]);
    if (((h === '=' && a.void !== true) || h === 'default') && p.length === 4) return walkPattern(p[2]) || walk(p[3]);
    if ((h === 'rest' || h === '...') && p.length === 3) return walkPattern(p[2]);
    if (h === 'typed-var' && p.length === 4) return walkPattern(p[2]);
    return walk(p);
  };
  const walk = (x) => {
    const w = wordOf(x);
    if (w !== undefined) return names.has(w);
    if (isList(x)) return x.some(walk);
    if (!isNode(x)) return false;
    const h = x[0];
    // A schema's head is the construct's spelling and its body a
    // descriptor (its callable bodies are trees of their own), so a
    // declaration never reads as a reference to the persistence
    // namespace `schema`.
    if (h === 'schema') return false;
    if (h === '.' || h === '?.') return walk(x[2]);
    if (h === ':' && x.length === 4) return (isStruct(x[2]) && walk(x[2])) || walk(x[3]);
    // An immediately invoked arrow passes each parameter the enclosing
    // binding of its own name, so those names are reads out here.
    if (h === 'do-iife' && x.length === 3 && isFunc(x[2])) return [...paramBindings(x[2][2])].some((n) => names.has(n)) || walk(x[2]);
    if (isFunc(x)) return walkParams(x[2]) || walkBody(x[2], x[3]);
    if (h === 'def' && x.length === 5) return walkParams(x[3]) || walkBody(x[3], x[4]);
    if (h === 'render' && x.length === 3 && semanticKind(x) === 'render') return walkRender(x[2]);
    if (ASSIGNS.has(h) && x.length === 4) return (isStruct(x[2]) && walkPattern(x[2])) || walk(x[3]);
    // A source loop's variables are patterns, in the statement form and
    // in a comprehension's clause alike; its other slots are expressions.
    if (isSourceLoop(x)) return x[2].some(walkPattern) || x.slice(3).some(walk);
    if (h === 'try') {
      const handler = x[3];
      return walk(x[2]) || (!isNone(handler) && (walkPattern(handler[2]) || walk(handler[3]))) || walk(x[4]);
    }
    if (h === 'class') return walk(x[3]) || walk(x[4]);
    // A pick item's key and target are property names; only its
    // default is an expression.
    if (h === 'pickitem' && x.length === 5) return walk(x[4]);
    if (h === 'typed-var' && x.length === 4) return isStruct(x[2]) && walk(x[2]);
    if (Emitter.isPostfixTypeIn(stores, x)) return walk(x[2]);
    if (h === 'import' || h === 'type-decl') return false;
    // A call's head and attribute record are not references.
    for (let i = 2; i < x.length; i++) if (walk(x[i])) return true;
    return false;
  };
  return walk(sexpr);
};

// Every name a tree binds, at any depth and in any scope, plus the
// names `atoms` (patterns) bind: the declarations, parameters, loop
// variables, catch bindings and assignment targets.
export const boundNames = (emitter, tree, atoms) => {
  const isDecl = (x) => Emitter.isReactiveDeclIn(emitter.stores, x) || Emitter.isEffectDeclIn(emitter.stores, x) ||
    Emitter.isReadonlyDeclIn(emitter.stores, x) || Emitter.isGateDeclIn(emitter.stores, x);
  const names = new Set();
  const addPattern = (pattern) => {
    for (const name of emitter.patternNames(pattern, [], true)) names.add(name);
  };
  const addWord = (x) => {
    const w = wordOf(x);
    if (w !== undefined) names.add(w);
    return w !== undefined;
  };
  // A parameter binds its pattern's names (a promoted `@name` binds the
  // bare name), and its default values and computed keys are
  // expressions whose nested functions bind too.
  const addParams = (params) => {
    for (const param of params) {
      const promoted = atParamField(param);
      if (promoted !== null) names.add(promoted.name);
      else addPattern(param);
      walk(param);
    }
  };
  const walk = (x) => {
    if (isList(x)) { for (const el of x) walk(el); return; }
    if (!isStruct(x)) return;
    const head = x[0];
    if (emitter.isModuleImport(x)) {
      for (const name of Emitter.importedNames([x])) names.add(name);
      return;
    }
    if (isFunc(x)) {
      addParams(x[2]);
      walk(x[3]);
      return;
    }
    if (head === 'def' && x.length === 5) {
      addWord(x[2]);
      addParams(x[3]);
      walk(x[4]);
      return;
    }
    if (head === 'class') {
      addWord(x[2]);
      walk(x[3]);
      // A class-body `def` is a method: its name is a member, never a
      // binding of the module (its parameters and body still walk).
      const body = x[4];
      for (const st of isBlock(body) ? body.slice(2) : [body]) {
        if (isNode(st) && st[0] === 'def' && st.length === 5) {
          addParams(st[3]);
          walk(st[4]);
        } else {
          walk(st);
        }
      }
      return;
    }
    if (isDecl(x)) {
      if (!addWord(x[2]) && isStruct(x[2])) addPattern(x[2]);
      walk(x[3]);
      return;
    }
    if (ASSIGNS.has(head) && x.length === 4 && !addWord(x[2]) && Emitter.isPattern(x[2])) addPattern(x[2]);
    if (isSourceLoop(x)) for (const pattern of x[2]) addPattern(pattern);
    // A plain or annotated catch binding binds the handler's parameter,
    // a pattern its destructured names.
    if (head === 'try' && !isNone(x[3]) && !isNone(x[3][2])) addPattern(x[3][2]);
    for (let i = 2; i < x.length; i++) walk(x[i]);
  };
  walk(tree);
  for (const atom of atoms) addPattern(atom);
  return names;
};
