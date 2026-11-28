// Declaration emission (the canonical pipeline): the typed
// surface of a compiled module rendered as TypeScript declaration text.
// In-memory ONLY — the compiler never writes declaration files;
// persistence is CLI packaging (bin/rip --dts / --dts-dir).
//
// This is the mapping tables' first big internal consumer: every type annotation's
// source span sits in the side tables (RoleStore rows recorded by
// pattern labels, typed-var wrapper nodes for params), and declaration
// text PASSES THOSE SPANS THROUGH — sliced from the source, whitespace-
// normalized, never re-derived from generated code and never scanned
// out of the emitted JS (the never-list). The text machinery itself
// (normalization, the block-body member grammar, parameter rendering)
// is shared with the TS-face emission through src/ts/types.js — one
// renderer, two consumers.
//
// What declares (the `declare`-prefix convention):
//   x: T = v                → declare let x: T;
//   export x: T = v         → export declare let x: T;
//   r: T (bare forward)     → declare let r: T;
//   def f(a: T): R          → declare function f(a: T): R;
//   def f(a: T): R (no body)→ declare function f(a: T): R;  (overload row)
//   def save!(x: T)         → declare function save(x: T): void;
//   name = (a: T): R ->     → declare function name(a: T): R;
//   save! = (x: T) ->       → declare function save(x: T): void;
//   type/interface          → re-emitted as TS declarations
//   class with typed members→ declare class N { x: T; m(a: T): R; }
// Untyped constructs declare NOTHING: a file with no types yields the
// trivial (empty) declaration — the zero-cost gate's dts face.
// Function-internal locals never declare — a d.ts is a MODULE
// boundary, and a local has no ambient address.
//
// Missing annotations inside a declared function render as EXPLICIT
// `any`: a declaration file reports implicit-any as an error under
// tsc's default CLI configuration (TS7006/TS7010), so a bare untyped
// parameter has no valid declaration spelling.

import { IDENT_PART } from '../ident.js';
import {
  TypeTextError, tidyType, normalizeTypeText, renderTypeDecl,
  renderParams, paramTyped, optionalReader,
} from './types.js';
import { buildSchemaTypeStory, SchemaTypeError } from './schema.js';
import { protoMemberTarget, PROTO_GENERIC_PARAMS, moduleSourceText, isModuleImportNode, ctorAtFields, containsYield, containsAwait } from '../emit/emitter.js';
import { isPlainCall, isList, isNode, isNone, isStruct, mkLeaf, mkNode, wordOf } from '../sexpr.js';
import {
  componentTypeInfo, componentCtorMembers, instanceTypeLines, containerType, MINTED, DOM_LIB_GLOBALS,
  segmentsText,
  selfArgsOf,
} from './components.js';

export class DtsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DtsError';
  }
}

const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 4;
const isTypedWrapper = (x) => isNode(x) && x[0] === 'typed-var' && x.length === 4;
// An annotation slot's text: a type value's raw text, '' when absent.
const typeText = (t) => (isNone(t) ? '' : wordOf(t));
// A class body statement's method pairs, every spelling read as the
// pair form the emitter reads it as: a pair object's pairs, a `def`
// (one pair, void when the def is), and a `get`/`set` accessor (a
// call of that word on a one-pair object). Each comes with its form
// and the node its type roles (return type, type parameters) hang on:
// a def's own statement, otherwise the pair's function.
const classMethodPairs = (stmt) => {
  if (!isNode(stmt)) return [];
  if (stmt[0] === 'object') return stmt.slice(2).map((pair) => ({ pair, form: null, typed: pair[3] }));
  if (stmt[0] === 'def' && stmt.length === 5) {
    return [{ pair: [':', stmt[1], stmt[2], mkNode('->', stmt[3], stmt[4])], form: 'def', typed: stmt }];
  }
  const form = isPlainCall(stmt) ? wordOf(stmt[2]) : undefined;
  if ((form === 'get' || form === 'set') && stmt.length === 4 && isNode(stmt[3]) && stmt[3][0] === 'object' && stmt[3].length === 3) {
    const pair = stmt[3][2];
    if (isMethodPair(pair) && pair[1].void !== true && isFunc(pair[3])) return [{ pair, form, typed: pair[3] }];
  }
  return [];
};
// A `key: value` pair, void or not; neither a shorthand, a default nor
// a spread.
const isMethodPair = (pair) => isNode(pair) && pair[0] === ':' && pair[1].shorthand !== true && pair.length === 4;
// `@name`, spelled `@name` or `this.name`.
const isStaticKey = (k) => isNode(k) && k[0] === '.' && k.length === 4 && wordOf(k[2]) === 'this' && wordOf(k[3]) !== undefined;
const memberName = (k) => (isStaticKey(k) ? wordOf(k[3]) : wordOf(k));
// An ["as", {}, name, alias] specifier's two words, or a bare one's word
// for both.
const specName = (s) => (isNode(s) && s[0] === 'as' ? wordOf(s[2]) : wordOf(s));
const specAlias = (s) => (isNode(s) && s[0] === 'as' ? wordOf(s[3]) : wordOf(s));

// ── declaration generation ───────────────────────────────────────────

// An import node's specifiers (its default or namespace binding, its
// braced list, and the extra one after a default), and the LOCAL names
// it binds.
const importSpecs = (node) => [node[2], node[3]].filter((s) => !isNone(s));
const importBoundNames = (node) => {
  const names = [];
  for (const spec of importSpecs(node)) {
    if (isList(spec)) for (const s of spec) names.push(specAlias(s));
    else names.push(specAlias(spec));
  }
  return names;
};

export function emitDeclarations({ sexpr, stores, source }) {
  if (!isNode(sexpr) || sexpr[0] !== 'program') return '';
  const program = sexpr.slice(2);

  // The schema type story: module-level named schema
  // declarations project their shapes — the intrinsic block prepends
  // once, each schema contributes its alias lines and a typed const
  // at its own program position. Collisions on the emitted type
  // names reject here; JS output never carries them.
  let schemaStory = null;
  try {
    schemaStory = buildSchemaTypeStory(sexpr, source,
      program.filter((s) => isModuleImportNode(stores, s)).flatMap(importBoundNames), null, sexpr);
  } catch (err) {
    if (err instanceof SchemaTypeError) throw new DtsError(`declaration emission: ${err.message}`);
    throw err;
  }
  const schemaByNode = new Map();
  const schemaDerivedByNode = new Map();
  if (schemaStory) {
    for (const s of schemaStory.stories) schemaByNode.set(s.decl.node, s);
    for (const d of schemaStory.derivations) schemaDerivedByNode.set(stores.idOf(d.decl.node), d);
  }

  // One schema declaration's lines: exported schemas export their
  // aliases (the instance TYPE is part of the module's surface) and
  // the const; a :mixin has no const (its runtime value is not a
  // user surface — parse/safe reject on it by design).
  const schemaDecl = (story, exported) => {
    const exp = exported ? 'export ' : '';
    for (const line of story.aliasLines) pass.lines.push(`${exp}${line}`);
    if (story.constType !== null) {
      pass.lines.push(`${exp}declare const ${story.decl.name}: ${story.constType};`);
    }
  };

  // Shared-renderer rejections gain this consumer's prefix.
  const rendered = (fn) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof TypeTextError) throw new DtsError(`declaration emission: ${err.message}`);
      throw err;
    }
  };

  // The recorded span for (node, role), stripped of its annotation
  // sigil (the leading ':' of a TYPE run) and layout-normalized.
  const roleType = (node, role) => {
    const id = stores.idOf(node);
    if (id === null) return null;
    const row = stores.role(id, role);
    if (!row || row.sourceStart == null) return null;
    return normalizeTypeText(source.slice(row.sourceStart, row.sourceEnd).replace(/^\s*:\s*/, ''));
  };

  // Whether a class member carries the `private` modifier (the
  // visibility side-band role). It declares as TypeScript's own emit
  // spells it — the name alone, no type: a private member shapes
  // assignability and is never a consumer's call.
  const isPrivate = (node) => {
    const id = stores.idOf(node);
    return id !== null && stores.role(id, 'visibility') !== null;
  };

  // The SHARED optionality reader — the same one the TS face uses, so
  // the declaration and the face cannot drift on `?` (see types.js).
  const isOptionalParam = optionalReader(stores);

  // ── declaring statements ───────────────────────────────────────────

  // A definition's generic parameter list (`def add<T>(…)`) rides the
  // typeParams role — the declaration repeats it verbatim.
  const typeParamsOf = (node) => {
    const id = stores.idOf(node);
    if (id === null) return '';
    const row = stores.role(id, 'typeParams');
    if (!row || row.sourceStart == null) return '';
    return source.slice(row.sourceStart, row.sourceEnd);
  };

  // A callable's declared return type, spelled the way the TS face
  // spells it (Emitter's tsReturnAnnotation). The two artifacts describe
  // ONE API, and every rule here is a rule there:
  //
  //   · async wraps as Promise<T> — a caller awaits what the annotation
  //     names, and a declaration carries no `async` keyword to imply it.
  //     An author who already spelled the Promise keeps their spelling.
  //   · a GENERATOR takes neither the wrap nor the void spelling: it
  //     returns its iterator, which a Promise and a `void` both misname.
  //     Unspelled, it publishes `any` — the face lets TS infer the exact
  //     iterator, which a declaration has no way to compute.
  //   · a void definition without an annotation declares `void`
  //     (`Promise<void>` when async).
  //
  // Returning null means "no return type to declare", which the callers
  // read as a reason to emit NO declaration at all — so every branch
  // that has something to say answers with a type, never null.
  const returnTypeOf = (fnNode, body, isVoid) => {
    const declared = roleType(fnNode, 'returnType');
    const isGen = containsYield(body);
    const isAsync = containsAwait(body, stores);
    if (declared !== null) {
      return isAsync && !isGen && !/^Promise\s*</.test(declared) ? `Promise<${declared}>` : declared;
    }
    if (!isVoid) return null;
    if (isGen) return 'any';
    return isAsync ? 'Promise<void>' : 'void';
  };

  const defDecl = (node, exported) => {
    const [, attrs, name, params, body] = node;
    const returnType = returnTypeOf(node, body, attrs.void === true);
    if (returnType === null && !params.some(paramTyped)) return;
    pass.lines.push(`${exported ? 'export ' : ''}declare function ${wordOf(name)}${typeParamsOf(node)}${rendered(() => renderParams(params, isOptionalParam))}: ${returnType ?? 'any'};`);
  };

  // An overload row is exported when its implementation is: TypeScript
  // refuses a merged declaration that is part exported, part local.
  const defSigDecl = (node) => {
    const [, , nameNode, params, returnType] = node;
    const name = wordOf(nameNode);
    const exp = exportedDefs.has(name) ? 'export ' : '';
    pass.lines.push(`${exp}declare function ${name}${typeParamsOf(node)}${rendered(() => renderParams(params, isOptionalParam))}: ${tidyType(wordOf(returnType))};`);
  };

  const assignDecl = (node, exported) => {
    const [, attrs, targetNode, value] = node;
    const target = wordOf(targetNode);
    if (target === undefined) return; // patterns/members declare nothing
    const exp = exported ? 'export ' : '';
    const annotation = roleType(node, 'annotation');
    if (annotation !== null) {
      pass.lines.push(`${exp}declare let ${target}: ${annotation};`);
      return;
    }
    if (!isFunc(value)) return;
    const returnType = returnTypeOf(value, value[3], attrs.void === true);
    const params = value[2];
    if (returnType === null && !params.some(paramTyped)) return;
    pass.lines.push(`${exp}declare function ${target}${typeParamsOf(value)}${rendered(() => renderParams(params, isOptionalParam))}: ${returnType ?? 'any'};`);
  };

  // A plain `=` (not the void definition) whose target is a name or an
  // `@name`.
  const isFieldAssign = (stmt) => isNode(stmt) && stmt[0] === '=' && stmt.length === 4 && stmt[1].void !== true &&
    (wordOf(stmt[2]) !== undefined || isStaticKey(stmt[2]));

  const classDecl = (node, exported) => {
    const [, , nameNode, parent, body] = node;
    const name = wordOf(nameNode);
    if (name === undefined) return;
    const members = [];
    const stmts = isNode(body) && body[0] === 'block' ? body.slice(2) : isNone(body) ? [] : [body];
    // Every field the BODY declares, scanned before any member is
    // pushed. A promoted parameter declares the field it implies unless
    // the body already does — and the body's declaration counts wherever
    // it sits, so asking `members` (which holds only what has been
    // pushed so far) sees one before the constructor and misses one
    // after it, shipping the name twice.
    const bodyFields = new Set();
    for (const stmt of stmts) {
      // The three shapes a field takes below: a bare typed forward, an
      // annotated initializer, and a pair inside a member object. Only
      // INSTANCE fields count — a static shares no name space with the
      // property a promotion assigns.
      if (isTypedWrapper(stmt) && wordOf(stmt[2]) !== undefined) bodyFields.add(wordOf(stmt[2]));
      else if (isFieldAssign(stmt) && !isStaticKey(stmt[2])) {
        bodyFields.add(wordOf(stmt[2]));
      } else {
        for (const { pair } of classMethodPairs(stmt)) {
          if (!isNode(pair) || isStaticKey(pair[2])) continue;
          const k = memberName(pair[2]);
          if (k !== undefined) bodyFields.add(k);
        }
      }
    }
    // Instance method bodies, for the `@field = …` walk below. A field a
    // helper establishes is the class's just as surely as one the
    // constructor inlines, and the declaration must say so or a consumer
    // publishes TS2339 cross-module on a property the runtime really has.
    // Statics are excluded — their `this` is the class.
    const instanceMethodBodies = [];
    for (const stmt of stmts) {
      for (const { pair } of classMethodPairs(stmt)) {
        if (!isMethodPair(pair)) continue;
        if (isStaticKey(pair[2]) || !isFunc(pair[3])) continue;
        if (memberName(pair[2]) === 'constructor') continue;
        instanceMethodBodies.push(pair[3][3]);
      }
    }
    for (const stmt of stmts) {
      const methodPairs = classMethodPairs(stmt);
      if (methodPairs.length > 0) {
        for (const { pair, form, typed } of methodPairs) {
          if (!isMethodPair(pair)) continue;
          const key = pair[2];
          const value = pair[3];
          if (!isFunc(value)) continue;
          const mName = memberName(key);
          if (mName === undefined) continue;
          if (isPrivate(form === 'def' ? typed : pair)) {
            members.push(`private ${isStaticKey(key) ? 'static ' : ''}${mName};`);
            continue;
          }
          let params = value[2];
          const returnType = returnTypeOf(typed, value[3], pair[1].void === true);
          if (mName === 'constructor') {
            // The fields the constructor implies, exactly as the TS
            // face declares them (the emitter's own walkers, not a
            // copy) — a consumer type-checks against this declaration,
            // and a property the face and the runtime really have must
            // not publish TS2339 cross-module. `declared` accumulates
            // so promotions, body declarations and `@field =` walks
            // yield ONE declaration per name.
            const declared = new Set(bodyFields);
            // Promoted parameters (`(@url: string)`) declare BOTH the
            // class field and a plain constructor parameter — the
            // strip mirrors the emitter's. An untyped promotion still
            // declares: the declaration pipeline has no constructor
            // body to infer from, so its honest spelling is `any`.
            params = params.map((pp) => {
              let x = pp;
              let dflt = null;
              if (isNode(x) && x[0] === 'default' && x.length === 4) { dflt = x; x = x[2]; }
              let typed = null;
              if (isTypedWrapper(x)) { typed = x; x = x[2]; }
              if (!isStaticKey(x)) return pp;
              const n = wordOf(x[3]);
              if (!declared.has(n)) {
                declared.add(n);
                members.push(`${n}: ${typed !== null ? tidyType(typeText(typed[3])) : 'any'};`);
              }
              const plain = typed !== null ? mkNode('typed-var', mkLeaf('name', n), typed[3]) : mkLeaf('name', n);
              return dflt !== null ? mkNode('default', plain, dflt[3]) : plain;
            });
            // Constructor-body `@field = value` assignments declare
            // the same way (bound arrows included — the emitter's
            // boundary doctrine rides in with the walker). The
            // author's annotation when there is one; `any` otherwise —
            // a declaration file cannot repeat the constructor
            // inference the face relies on.
            for (const at of ctorAtFields([value[3], ...instanceMethodBodies])) {
              if (declared.has(at.name)) continue;
              declared.add(at.name);
              // Any of the field's assignments can carry the author's
              // annotation — scan them all, exactly as the TS face does.
              const annotation = at.nodes.map((n) => roleType(n, 'annotation')).find((t) => t != null) ?? null;
              members.push(`${at.name}: ${annotation ?? 'any'};`);
            }
            if (params.some(paramTyped)) members.push(`constructor${rendered(() => renderParams(params, isOptionalParam))};`);
            continue;
          }
          if (returnType === null && !params.some(paramTyped)) continue;
          const staticPrefix = isStaticKey(key) ? 'static ' : '';
          // An accessor declares as one: `get x(): T;` / `set x(v: T);`
          // (a setter has no return type to declare).
          if (form === 'get') members.push(`${staticPrefix}get ${mName}(): ${returnType ?? 'any'};`);
          else if (form === 'set') members.push(`${staticPrefix}set ${mName}${rendered(() => renderParams(params, isOptionalParam))};`);
          else members.push(`${staticPrefix}${mName}${form === 'def' ? typeParamsOf(typed) : ''}${rendered(() => renderParams(params, isOptionalParam))}: ${returnType ?? 'any'};`);
        }
        continue;
      }
      if (isTypedWrapper(stmt) && (wordOf(stmt[2]) !== undefined || isStaticKey(stmt[2]))) {
        const staticPrefix = isStaticKey(stmt[2]) ? 'static ' : '';
        if (isPrivate(stmt)) members.push(`private ${staticPrefix}${memberName(stmt[2])};`);
        else members.push(`${staticPrefix}${memberName(stmt[2])}: ${tidyType(typeText(stmt[3]))};`);
        continue;
      }
      if (isFieldAssign(stmt)) {
        const staticPrefix = isStaticKey(stmt[2]) ? 'static ' : '';
        if (isPrivate(stmt)) {
          members.push(`private ${staticPrefix}${memberName(stmt[2])};`);
          continue;
        }
        const annotation = roleType(stmt, 'annotation');
        if (annotation === null) continue;
        members.push(`${staticPrefix}${memberName(stmt[2])}: ${annotation};`);
      }
    }
    if (members.length === 0) return;
    let ext = '';
    if (!isNone(parent)) {
      const parentName = wordOf(parent);
      if (parentName === undefined) {
        throw new DtsError(`declaration emission: class ${name} extends an expression — a declaration's heritage clause takes a type name`);
      }
      ext = ` extends ${parentName}`;
    }
    pass.lines.push(`${exported ? 'export ' : ''}declare class ${name}${ext} {`);
    for (const m of members) pass.lines.push(`  ${m}`);
    pass.lines.push('}');
  };

  // A typed reactive declaration declares its CONTAINER: the module's
  // export surface is the container object the lowering binds
  // (imported reactive names never auto-unwrap — the cross-module
  // contract), so the annotation types the `.value` slot, and the
  // container carries the `read(): T` structural brand (the runtime's
  // detection predicate — src/ts/components.js has the doctrine).
  // A computed's container is read-only from the outside; both bind
  // `const`.
  const reactiveDecl = (node, exported) => {
    const name = wordOf(node[2]);
    if (name === undefined) return;
    const annotation = roleType(node, 'annotation');
    if (annotation === null) return;
    const ro = node[0] === 'computed' ? 'readonly ' : '';
    pass.lines.push(`${exported ? 'export ' : ''}declare const ${name}: ${containerType(annotation, ro, MINTED)};`);
  };

  const isReactiveDecl = (stmt) => {
    if (!isNode(stmt) || (stmt[0] !== 'state' && stmt[0] !== 'computed') || stmt.length !== 4) return false;
    const id = stores.idOf(stmt);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'state' || kind === 'computed';
  };

  // Which module names a member's `typeof` spelling may root at — set by
  // the declaring pass below, read at each component declaration.
  let spellable = null;

  // A component declaration: the component is a STRUCTURAL
  // construct — it declares without carrying an annotation. The shape is the companion-interface pattern the face
  // uses: `interface Name { …instance surface… }` (TS's separate
  // type/value namespaces make the same-name pairing legal, and a
  // consumer's `c: Name` annotation finds a type) beside the binding's
  // constructor type — the props surface (src/ts/components.js, the
  // renderer the face marks through) plus the static mount mirror.
  const isComponentDecl = (x) => {
    if (!isNode(x) || x[0] !== 'component' || x.length !== 4) return false;
    const id = stores.idOf(x);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'component';
  };

  const componentDecl = (node, name, exported, stmt) => {
    const info = componentTypeInfo(stores, source, node, null, { spellable });
    const exp = exported ? 'export ' : '';
    // A GENERIC component: the members already reference the parameter,
    // so the list has to reach both shipped declarations or the file
    // does not compile at all. The interface header carries the list
    // with its constraints; every self-reference and the constructor
    // apply the bare NAMES, and the constructor restates the list
    // because the binding it sits on is a value, not a type — the
    // same split the face's own companion makes.
    const typeParams = typeParamsOf(stmt);
    const self = `${name}${selfArgsOf(typeParams)}`;
    pass.lines.push(`${exp}interface ${name}${typeParams} {`);
    for (const l of rendered(() => instanceTypeLines(info, self))) pass.lines.push(`  ${segmentsText(l.segs)}`);
    pass.lines.push('}');
    pass.lines.push(`${exp}declare let ${name}: {`);
    for (const m of componentCtorMembers(info, name, typeParams, self)) pass.lines.push(`  ${m}`);
    pass.lines.push('};');
  };

  // A typed BOUND effect (`h: T ~> body`) declares its dispose handle
  // AS the annotated type — the handle is a plain const, no container
  // wrapping (unlike the reactive declarations above).
  const isEffectDecl = (stmt) => {
    if (!isNode(stmt) || stmt[0] !== 'effect' || stmt.length !== 4) return false;
    const id = stores.idOf(stmt);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'effect';
  };

  const effectDecl = (node, exported) => {
    const name = wordOf(node[2]);
    if (name === undefined) return;
    const annotation = roleType(node, 'annotation');
    if (annotation === null) return;
    pass.lines.push(`${exported ? 'export ' : ''}declare const ${name}: ${annotation};`);
  };

  // A typed readonly declaration (`x: T =! e`) declares a plain
  // const of the annotated type — `declare const` already makes a
  // consumer reassignment a TS error, so no container or wrapper
  // exists to surface (the effect-handle shape, not the reactive
  // `{ value: T }` one).
  const isReadonlyDecl = (stmt) => {
    if (!isNode(stmt) || stmt[0] !== 'readonly' || stmt.length !== 4) return false;
    const id = stores.idOf(stmt);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'readonly';
  };

  // ── module edges ─────────────────────────────────────────────────
  // The declaration artifact must describe the SAME module surface as
  // the emitted JavaScript: imports whose names the declarations
  // reference, the default export, re-export lists, and star
  // re-exports all carry through. Dropping an edge makes a consumer's
  // type-check lie — a declaration referencing an unimported name
  // (TS2304), or a module face missing exports the runtime has.
  // Everything the declaring pass accumulates, created together: a
  // rerun starts from a fresh object, so nothing the first run
  // collected outlives it.
  let pass = null;
  const startPass = () => {
    pass = {
      lines: [],
      pendingImports: [],     // import nodes, source order
      pendingDefaults: [],    // identifier default exports
      pendingExportLists: [], // bare `export { … }` specifier lists
    };
  };

  const specListText = (list) =>
    list.map((s) => (isNode(s) && s[0] === 'as' ? `${specName(s)} as ${specAlias(s)}` : wordOf(s))).join(', ');

  // The attributes clause (`with { type: 'json' }`) is the import's
  // ["with", {}, object] node. The declaration keeps it after the source
  // — a JSON import without it does not resolve under NodeNext — printed
  // from the object's string-literal pairs.
  const importAttributesText = (node) => {
    const clause = node[4];
    if (isNone(clause)) return '';
    const pairs = clause[2].slice(2).map((pair) => {
      const key = wordOf(pair[2]) ?? '?';
      const value = wordOf(pair[3])?.replace(/^'(.*)'$/, '"$1"') ?? '?';
      return `${key}: ${value}`;
    });
    return ` with { ${pairs.join(', ')} }`;
  };

  const importText = (node) => {
    const specs = importSpecs(node).map((spec) => {
      if (isList(spec)) return spec.length === 0 ? '{}' : `{ ${specListText(spec)} }`;
      if (spec[0] === 'as') return `* as ${specAlias(spec)}`;
      return wordOf(spec);
    });
    return `import ${specs.join(', ')} from ${moduleSourceText(wordOf(node[5]))}${importAttributesText(node)};`;
  };

  // The names an import binds locally: the default name, the
  // namespace name, or each specifier's local (its alias when
  // renamed). A side-effect import binds nothing.
  // The emitter's own predicate, not a copy of it: shape cannot tell a
  // side-effect import from a dynamic one, and the copy that used to live
  // here fell out of step the day the two stopped sharing a node shape.
  const isModuleImport = (x) => isModuleImportNode(stores, x);

  const stmtDecl = (stmt, exported) => {
    if (!isStruct(stmt)) return;
    const head = stmt[0];
    if (head === 'export') {
      // An export's payload is a declaration, or its specifier list.
      if (isList(stmt[2])) pass.pendingExportLists.push(stmt[2]);
      else stmtDecl(stmt[2], true);
      return;
    }
    if (isModuleImport(stmt)) {
      pass.pendingImports.push(stmt);
      return;
    }
    if (head === 'export-all') {
      const alias = wordOf(stmt[3]);
      pass.lines.push(`export * ${alias !== undefined ? `as ${alias} ` : ''}from ${moduleSourceText(wordOf(stmt[2]))};`);
      return;
    }
    if (head === 'export-from') {
      const spec = stmt[2].length === 0 ? '{}' : `{ ${specListText(stmt[2])} }`;
      const id = stores.idOf(stmt);
      const typeOnly = id !== null && stores.role(id, 'typeOnly') !== null;
      pass.lines.push(`export ${typeOnly ? 'type ' : ''}${spec} from ${moduleSourceText(wordOf(stmt[3]))};`);
      return;
    }
    if (head === 'export-default') {
      const name = wordOf(stmt[2]);
      if (name !== undefined) pass.pendingDefaults.push(name);
      // A non-identifier default carries no annotation, so it
      // contributes no declaration (the untyped-export rule).
      return;
    }
    if (isReactiveDecl(stmt)) {
      reactiveDecl(stmt, exported);
      return;
    }
    if (isEffectDecl(stmt) || isReadonlyDecl(stmt)) {
      effectDecl(stmt, exported);
      return;
    }
    const plainAssign = head === '=' && stmt.length === 4 && stmt[1].void !== true;
    if (head === 'type-decl') pass.lines.push(...rendered(() => renderTypeDecl(stmt[2])));
    else if (head === 'typed-var' && wordOf(stmt[2]) !== undefined) {
      pass.lines.push(`declare let ${wordOf(stmt[2])}: ${tidyType(typeText(stmt[3]))};`);
    } else if (head === 'def-sig') defSigDecl(stmt);
    else if (head === 'def' && stmt.length === 5) defDecl(stmt, exported);
    else if (plainAssign && schemaByNode.has(stmt[3])) {
      schemaDecl(schemaByNode.get(stmt[3]), exported);
    } else if (plainAssign && schemaDerivedByNode.has(stores.idOf(stmt))) {
      schemaDecl(schemaDerivedByNode.get(stores.idOf(stmt)), exported);
    } else if (plainAssign && wordOf(stmt[2]) !== undefined && isComponentDecl(stmt[3])) {
      componentDecl(stmt[3], wordOf(stmt[2]), exported, stmt);
    } else if (plainAssign && protoMemberTarget(stmt) !== null) {
      // A typed prototype member on an OUTSIDE type (`String::m: T =
      // v`): the module's runtime patches the global, so its
      // declaration says so — `declare global` augmentation, the
      // face's twin. A module-declared head declares nothing here (its
      // own class declaration is the merge target, a face-only
      // concern); an untyped write declares nothing (no annotation, no
      // ambient spelling).
      const proto = protoMemberTarget(stmt);
      const t = roleType(stmt, 'annotation');
      if (t !== null && !moduleHeads.has(proto.head)) {
        pass.lines.push(`declare global { interface ${proto.head}${PROTO_GENERIC_PARAMS[proto.head] ?? ''} { ${proto.member}: ${t} } }`);
      }
    } else if (head === '=' && stmt.length === 4) assignDecl(stmt, exported);
    else if (head === 'class') classDecl(stmt, exported);
  };

  // A top-level statement, unwrapped from its `export`.
  const unexported = (s) => (isNode(s) && s[0] === 'export' && isNode(s[2]) ? s[2] : s);

  // Module-declared heads, for the prototype-augmentation split: a
  // name declared in this module is never `declare global` material.
  const moduleHeads = new Set();
  for (const s of program) {
    const t = unexported(s);
    if (!isNode(t)) continue;
    const name = wordOf(t[2]);
    if ((t[0] === 'class' || t[0] === 'typed-var' || t[0] === '=') && name !== undefined) moduleHeads.add(name);
  }

  // The module-scope names the source binds, a destructuring pattern
  // walked to its leaves.
  const BINDING_HEADS = new Set(['=', 'state', 'computed', 'readonly', 'effect', 'def', 'class', 'typed-var', 'def-sig']);
  const patternNames = (p, out) => {
    const w = wordOf(p);
    if (w !== undefined) { out.add(w); return; }
    if (!isNode(p)) return;
    if (p[0] === 'array') { for (const el of p.slice(2)) patternNames(el, out); return; }
    if (p[0] === '=' || p[0] === '...') { patternNames(p[2], out); return; }
    if (p[0] !== 'object') return;
    for (const pair of p.slice(2)) {
      if (!isNode(pair)) continue;
      if (pair[0] === ':' && pair[1].void !== true) patternNames(pair[3], out);
      else if (pair[0] === '=' || pair[0] === '...') patternNames(pair[2], out);
    }
  };
  const sourceBinds = new Set();
  for (const s of program) {
    const t = unexported(s);
    if (isNode(t) && BINDING_HEADS.has(t[0])) patternNames(t[2], sourceBinds);
  }

  const exportedDefs = new Set(program
    .filter((s) => isNode(s) && s[0] === 'export' && isNode(s[2]) && s[2][0] === 'def' && s[2].length === 5)
    .map((s) => wordOf(s[2][2])));

  // A member's `typeof` names a module binding, and this file declares
  // only its typed bindings: a root the source binds that no
  // declaration here spells is TS2304 for every consumer, so such a
  // member ships `any`. A root the source never binds is a global,
  // which the consumer's own lib resolves. Which names get declared is
  // known only once the pass has run and never depends on how a member
  // is typed, so the pass runs once recording the roots and, if any
  // fail to resolve, again with those roots refused.
  startPass();
  const roots = new Set();
  spellable = (name) => { roots.add(name); return true; };
  for (const stmt of program) stmtDecl(stmt, false);
  const passText = pass.lines.join('\n');
  const refused = new Set([...roots].filter((name) => sourceBinds.has(name) &&
    !new RegExp(`\\b(?:let|const|function|class) ${name.replace(/[$]/g, '\\$&')}\\b`).test(passText)));
  if (refused.size > 0) {
    startPass();
    spellable = (name) => !refused.has(name);
    for (const stmt of program) stmtDecl(stmt, false);
  }
  const lines = [...(schemaStory?.intrinsicLines ?? []), ...pass.lines];
  const { pendingImports, pendingDefaults, pendingExportLists } = pass;

  // Deferred edges resolve against the FULL declaration text: a
  // default export or bare export list names a binding whose
  // declaration may sit anywhere in the module (modules hoist), and
  // an untyped binding has no declaration to reference — its
  // specifier drops (the untyped-export rule), never a dangling name.
  const declaredName = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:let|const|function|class|interface|type) ${escaped}\\b`).test(lines.join('\n'));
  };
  for (const name of pendingDefaults) {
    if (declaredName(name)) lines.push(`export default ${name};`);
  }
  for (const list of pendingExportLists) {
    const kept = list.filter((s) => declaredName(specName(s)));
    if (kept.length > 0) lines.push(`export { ${specListText(kept)} };`);
  }
  // An import is retained when a declaration references one of its
  // bound names; text the declarations never mention imports nothing
  // (retention errs toward keeping — an unused import in a
  // declaration file is inert, a missing one breaks every consumer).
  const bodyText = lines.join('\n');
  const referenced = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<!${IDENT_PART.source}|\\.)${escaped}(?!${IDENT_PART.source})`).test(bodyText);
  };
  const keptImports = pendingImports
    .filter((node) => importBoundNames(node).some(referenced))
    .map(importText);
  if (keptImports.length > 0) lines.unshift(...keptImports);

  // The module marker (ARTIFACT-gated): declaration emission can
  // erase every module indicator the source carried when nothing
  // above retained one — and an untyped export contributes no declaration —
  // so the gate reads the EMITTED lines, not the source shape (the
  // face's gate; faces preserve import/export bytes). Unless some
  // emitted declaration is itself an import/export line, a non-empty
  // .d.ts appends `export {}`: without it the artifact is a global
  // script whose `declare` bindings — and, for schema files,
  // intrinsic aliases — collide across files in one consumer program
  // (TS2451/TS2300, and same-named interfaces MERGE silently),
  // misrepresenting the loader's ES-module runtime semantics. An
  // artifact with no declarations stays empty. Every emitted element
  // is a top-level declaration, so its first bytes decide.
  if (lines.length > 0 && !lines.some((l) => /^(export|import)\s/.test(l))) {
    lines.push('export {};');
  }
  // A DOM global the declarations name (the minted component surfaces —
  // DOM_LIB_GLOBALS) resolves only against the `dom` lib, so the file
  // declares that dependency itself: a consumer compiled with the
  // language lib alone still resolves every name the file uses. A
  // module naming none stays directive-free. The directive is a
  // file-head pragma, so it goes before the retained imports.
  // The surfaces spell some of these through globalThis (an author's own
  // `Node` must not capture them), and that spelling needs the lib too.
  const namesGlobal = (name) => referenced(name) || new RegExp(`(?<!${IDENT_PART.source})globalThis\\.${name}(?!${IDENT_PART.source})`).test(bodyText);
  if (DOM_LIB_GLOBALS.some(namesGlobal)) lines.unshift('/// <reference lib="dom" />');
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
