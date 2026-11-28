// Whole-tree walks the lowerings share that read the Emitter's static
// predicates: which names a subtree references and which it binds.

import { isHeadless } from '../emitter-shape.js';
import { isCall, isPlainCall } from '../sexpr.js';
import { ASSIGNS, isShapedNode, atParamField, isFunc, isChildren, isCatchClause, isDefHead, isHtmlTag } from './helpers.js';
import { Emitter } from './core.js';

// Does the tree REFERENCE any of `names` as a free identifier?
// Identifier references are bare strings in VALUE position; the walk
// skips the positions where a bare string is a NAME, not a
// reference: member property names, plain object/pair keys
// (dynamicKey nodes recurse — those ARE references), function/def
// names and their parameter binding names, class names, assignment
// targets, type strings (typed-var/cast annotations erase), and
// import statements (import bindings are program-scope bindings —
// the suppression set, not references). PATTERN contexts —
// function/def parameters, loop heads, pattern-assignment targets,
// catch bindings — are BINDING positions: shorthand elements there
// ({SchemaError}, [SchemaError]) are binding names, never
// references, while default-value expressions, computed keys, and
// member/index targets inside a pattern stay references (object
// SHORTHAND in expression position — x = {SchemaError} — remains a
// reference; only patterns bind). String/number literals keep
// their source spelling (quotes included), so they never equal a
// bare name. A function's parameters shadow the names they bind
// throughout its body, and a word in a render block's tag position
// names an element, never a value: a tag word that a render local,
// loop variable or member shadows is that component's own name, and
// any other is the element. Every other function-scope binding
// suppresses nothing: a reference under one still counts.
export const referencesNames = (sexpr, names, stores) => {
  if (names.size === 0) return false;
  const ref = (x) => typeof x === 'string' && names.has(x);
  // The names a parameter list binds: a bare name, the target of a
  // default, a rest, an annotation, or a destructuring pattern's leaves.
  const paramBindings = (params) => {
    const out = new Set();
    const bind = (p) => {
      if (typeof p === 'string') { out.add(p); return; }
      if (!isShapedNode(p)) return;
      const [h] = p;
      if (h === 'object' || h === 'array') p.slice(1).forEach(bind);
      else if (h === null && p.length === 3) bind(p[2]);
      else if ((h === ':' || h === '=') && p.length === 3) bind(h === ':' ? p[2] : p[1]);
      else if (h === 'default' && p.length === 3) bind(p[1]);
      else if ((h === 'rest' || h === '...' || h === 'expansion') && p.length === 2) bind(p[1]);
      else if (h === 'typed-var' && p.length === 3) bind(p[1]);
    };
    if (isShapedNode(params)) params.forEach(bind);
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
    if (isTagWord(head)) return true;
    if (isShapedNode(head) && head[0] === '.') return isTagWord(Emitter.collectTemplateClasses(head).tag);
    return false;
  };
  // A render statement: a tag word or a tag call names an element, and
  // a tag call's children block is render, as a branch's or a loop's
  // body is. Anything else is an expression.
  const walkRender = (x) => {
    if (typeof x === 'string') return !isTagWord(x) && ref(x);
    if (!isShapedNode(x)) return false;
    const [h] = x;
    if (h === 'block' && !isHeadless(x)) return x.slice(1).some(walkRender);
    if (isPlainCall(x) && tagOf(x[2])) return x.slice(3).some((a) => (isChildren(a) ? walkRender(a[1]) : walk(a)));
    if (h === '.' && tagOf(x)) return false;
    if (h === 'if' && x.length >= 3 && x.length <= 4) return walk(x[1]) || walkRender(x[2]) || (x.length === 4 && walkRender(x[3]));
    if ((h === 'for-in' || h === 'for-of' || h === 'for-as') && x.length === 6) {
      return (isShapedNode(x[1]) && x[1].some(walkPattern)) || walk(x[2]) || walk(x[3]) || walk(x[4]) || walkRender(x[5]);
    }
    return walk(x);
  };
  const walkParams = (params) => isShapedNode(params) && params.some(walkPattern);
  // Binding-position walk: bare strings are binding names (skipped);
  // only the expression slots inside a pattern can reference.
  const walkPattern = (p) => {
    if (!isShapedNode(p)) return false;
    const [h] = p;
    if (h === 'object' || h === 'array') return p.slice(1).some(walkPattern);
    if (h === null && p.length === 3) return false;
    if (h === ':' && p.length === 3) return (isShapedNode(p[1]) && walk(p[1])) || walkPattern(p[2]);
    if ((h === '=' || h === 'default') && p.length === 3) return walkPattern(p[1]) || walk(p[2]);
    if ((h === 'rest' || h === '...' || h === 'expansion') && p.length === 2) return walkPattern(p[1]);
    if (h === 'typed-var' && p.length === 3) return walkPattern(p[1]);
    return walk(p);
  };
  const walk = (x) => {
    if (ref(x)) return true;
    if (!isShapedNode(x)) return false;
    if (isHeadless(x)) return x.some(walk);
    const [h] = x;
    // A schema DECLARATION node is not a reference to the name
    // 'schema' — its head is the construct's spelling and its body is
    // a descriptor, not a tree (its callable bodies are trees of their
    // own). Without this, every schema declaration
    // would read as a reference to the persistence namespace.
    if (h === 'schema' && x.length === 2 && x[1] && typeof x[1] === 'object' && Array.isArray(x[1].entries)) return false;
    if (h === '.' || h === '?.') return walk(x[1]);
    if ((h === ':' || h === 'void-pair') && x.length === 3) return (isShapedNode(x[1]) && walk(x[1])) || walk(x[2]);
    // An immediately invoked arrow passes each parameter the enclosing
    // binding of its own name, so those names are reads out here.
    if (h === 'do-iife' && x.length === 2 && isFunc(x[1])) return [...paramBindings(x[1][1])].some(ref) || walk(x[1]);
    if (isFunc(x)) return walkParams(x[1]) || walkBody(x[1], x[2]);
    if (isDefHead(h) && x.length === 4) return walkParams(x[2]) || walkBody(x[2], x[3]);
    if (h === 'render' && x.length === 2 && semanticKind(x) === 'render') return walkRender(x[1]);
    if (ASSIGNS.has(h) && x.length === 3) return (isShapedNode(x[1]) && walkPattern(x[1])) || walk(x[2]);
    // Loop heads at every arity: the 6-slot statement form and the
    // 4-slot comprehension clause (postfix-for lowers to a
    // comprehension) both carry the pattern list in slot 1; the
    // remaining slots (iterable, guard, step, own flag, body) are
    // expression territory.
    if (h === 'for-in' || h === 'for-of' || h === 'for-as') {
      return (isShapedNode(x[1]) && x[1].some(walkPattern)) || x.slice(2).some(walk);
    }
    // Slot 1 is the body — a block, or an inline expression or
    // statement (`try f()`, `try return x`). Later slots are a
    // ["catch", binding|null, body] handler and a block finalizer.
    if (h === 'try') {
      return walk(x[1]) || x.slice(2).some((part) => {
        if (isCatchClause(part)) return walkPattern(part[1]) || walk(part[2]);
        if (isShapedNode(part) && part[0] === 'block') return walk(part);
        throw new Error('emitter: a try slot after its body is a catch handler or a finally block');
      });
    }
    if (h === 'class' && x.length >= 2) return x.slice(2).some(walk);
    // A pick item's key and target are property names; only its
    // default is an expression.
    if (h === 'pickitem' && x.length === 4) return walk(x[3]);
    if (h === 'typed-var' && x.length === 3) return isShapedNode(x[1]) && walk(x[1]);
    if (Emitter.isPostfixTypeIn(stores, x)) return walk(x[1]);
    if (h === 'import' || h === 'type-decl') return false;
    // A call's head and attribute record are not references.
    if (isCall(x)) return x.slice(2).some(walk);
    return x.some(walk);
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
  // A parameter binds its pattern's names (a promoted `@name` binds the
  // bare name), and its default values and computed keys are
  // expressions whose nested functions bind too.
  const addParams = (params) => {
    if (!isShapedNode(params)) return;
    for (const param of params) {
      const promoted = atParamField(param);
      if (promoted !== null) names.add(promoted.name);
      else addPattern(param);
      walk(param);
    }
  };
  const walk = (x) => {
    if (!isShapedNode(x)) return;
    if (isHeadless(x)) { for (const el of x) walk(el); return; }
    const [head] = x;
    if (emitter.isModuleImport(x)) {
      for (const name of Emitter.importedNames([x])) names.add(name);
      return;
    }
    if (isFunc(x)) {
      addParams(x[1]);
      walk(x[2]);
      return;
    }
    if (isDefHead(head) && x.length === 4) {
      if (typeof x[1] === 'string') names.add(x[1]);
      addParams(x[2]);
      walk(x[3]);
      return;
    }
    if (head === 'class') {
      if (typeof x[1] === 'string') names.add(x[1]);
      // A class-body `def` is a method: its name is a member, never a
      // binding of the module (its parameters and body still walk).
      for (const part of x.slice(2)) {
        const stmts = emitter.isBlock(part) ? part.slice(1) : [part];
        for (const st of stmts) {
          if (isShapedNode(st) && isDefHead(st[0]) && st.length === 4) {
            addParams(st[2]);
            walk(st[3]);
          } else {
            walk(st);
          }
        }
      }
      return;
    }
    if (isDecl(x)) {
      if (typeof x[1] === 'string') names.add(x[1]);
      else if (isShapedNode(x[1])) addPattern(x[1]);
      walk(x[2]);
      return;
    }
    if ((ASSIGNS.has(head) || head === 'void-assign') && x.length >= 2) {
      if (typeof x[1] === 'string') names.add(x[1]);
      else if (Emitter.isPattern(x[1])) addPattern(x[1]);
    }
    if ((head === 'for-in' || head === 'for-of' || head === 'for-as') && isShapedNode(x[1])) {
      for (const pattern of x[1]) addPattern(pattern);
    }
    // A handler is ["catch", binding|null, body]: a plain or annotated
    // name binds the handler's parameter, a pattern its destructured names.
    if (head === 'try') {
      for (const part of x.slice(2)) {
        if (isCatchClause(part) && part[1] !== null) addPattern(part[1]);
      }
    }
    for (const part of x) walk(part);
  };
  walk(tree);
  for (const atom of atoms) addPattern(atom);
  return names;
};
