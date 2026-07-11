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
// is shared with the TS-face emission through src/typetext.js — one
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
//   enum N           → declare enum N { a = 0, b = 1 }
//     (an enum IS a type declaration — the one construct that
//     declares without carrying an annotation; TS's enum view lacks
//     the reverse index for STRING-valued members, a documented
//     usability gap, never a soundness hole)
// Untyped constructs declare NOTHING: a file with no types yields the
// trivial (empty) declaration — the zero-cost gate's dts face.
// Function-internal locals never declare — a d.ts is a MODULE
// boundary, and a local has no ambient address.
//
// Missing annotations inside a declared function render as EXPLICIT
// `any`: a declaration file reports implicit-any as an error under
// tsc's default CLI configuration (TS7006/TS7010), so a bare untyped
// parameter has no valid declaration spelling.

import {
  TypeTextError, tidyType, normalizeTypeText, renderTypeDecl,
  renderParams, paramTyped,
} from './typetext.js';
import { buildSchemaTypeStory, SchemaTypeError } from './schema-types.js';
import { protoMemberTarget, PROTO_GENERIC_PARAMS, moduleSourceText } from './emitter.js';
import {
  componentTypeInfo, propsTypeText, propsParamOptional, instanceTypeLines, containerType,
} from './component-types.js';

export class DtsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DtsError';
  }
}

const isNode = (x) => Array.isArray(x);
const isDefHead = (h) => h === 'def' || h === 'void-def';
const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 3;
const isTypedWrapper = (x) => isNode(x) && x[0] === 'typed-var' && x.length === 3;
const isStaticKey = (k) => isNode(k) && k[0] === '.' && k[1] === 'this' && k.length === 3 && typeof k[2] === 'string';
const memberName = (k) => (isStaticKey(k) ? k[2] : k);

// ── declaration generation ───────────────────────────────────────────

export function emitDeclarations({ sexpr, stores, source }) {
  if (!isNode(sexpr) || sexpr[0] !== 'program') return '';
  const lines = [];

  // The schema type story: module-level named schema
  // declarations project their shapes — the intrinsic block prepends
  // once, each schema contributes its alias lines and a typed const
  // at its own program position. Collisions on the emitted type
  // names reject here; JS output never carries them.
  let schemaStory = null;
  try {
    schemaStory = buildSchemaTypeStory(sexpr);
  } catch (err) {
    if (err instanceof SchemaTypeError) throw new DtsError(`declaration emission: ${err.message}`);
    throw err;
  }
  const schemaByNode = new Map();
  if (schemaStory) {
    lines.push(...schemaStory.intrinsicLines);
    for (const s of schemaStory.stories) schemaByNode.set(s.decl.node, s);
  }

  // One schema declaration's lines: exported schemas export their
  // aliases (the instance TYPE is part of the module's surface) and
  // the const; a :mixin has no const (its runtime value is not a
  // user surface — parse/safe reject on it by design).
  const schemaDecl = (story, exported) => {
    const exp = exported ? 'export ' : '';
    for (const line of story.aliasLines) lines.push(`${exp}${line}`);
    if (story.constType !== null) {
      lines.push(`${exp}declare const ${story.decl.name}: ${story.constType};`);
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

  // ── declaring statements ───────────────────────────────────────────

  const defDecl = (node, exported) => {
    const [head, name, params] = node;
    const returnType = roleType(node, 'returnType') ?? (head === 'void-def' ? 'void' : null);
    if (returnType === null && !params.some(paramTyped)) return;
    lines.push(`${exported ? 'export ' : ''}declare function ${name}${rendered(() => renderParams(params))}: ${returnType ?? 'any'};`);
  };

  const defSigDecl = (node) => {
    const [, name, params, returnType] = node;
    lines.push(`declare function ${name}${rendered(() => renderParams(params))}: ${tidyType(returnType)};`);
  };

  const assignDecl = (node, exported) => {
    const [head, target, value] = node;
    if (typeof target !== 'string') return; // patterns/members declare nothing
    const exp = exported ? 'export ' : '';
    const annotation = roleType(node, 'annotation');
    if (annotation !== null) {
      lines.push(`${exp}declare let ${target}: ${annotation};`);
      return;
    }
    if (!isFunc(value)) return;
    const returnType = roleType(value, 'returnType') ?? (head === 'void-assign' ? 'void' : null);
    if (returnType === null && !value[1].some(paramTyped)) return;
    lines.push(`${exp}declare function ${target}${rendered(() => renderParams(value[1]))}: ${returnType ?? 'any'};`);
  };

  const classDecl = (node, exported) => {
    const [, name, parent, body] = node;
    if (typeof name !== 'string') return;
    const members = [];
    const stmts = isNode(body) && body[0] === 'block' ? body.slice(1) : body != null ? [body] : [];
    for (const stmt of stmts) {
      if (isNode(stmt) && stmt[0] === 'object') {
        for (const pair of stmt.slice(1)) {
          if (pair[0] !== ':' && pair[0] !== 'void-pair') continue;
          const key = pair[1];
          const value = pair[2];
          if (!isFunc(value)) continue;
          const mName = memberName(key);
          if (typeof mName !== 'string') continue;
          const params = value[1];
          const returnType = roleType(value, 'returnType') ?? (pair[0] === 'void-pair' ? 'void' : null);
          if (mName === 'constructor') {
            if (params.some(paramTyped)) members.push(`constructor${rendered(() => renderParams(params))};`);
            continue;
          }
          if (returnType === null && !params.some(paramTyped)) continue;
          const staticPrefix = isStaticKey(key) ? 'static ' : '';
          members.push(`${staticPrefix}${mName}${rendered(() => renderParams(params))}: ${returnType ?? 'any'};`);
        }
        continue;
      }
      if (isTypedWrapper(stmt) && (typeof stmt[1] === 'string' || isStaticKey(stmt[1]))) {
        const staticPrefix = isStaticKey(stmt[1]) ? 'static ' : '';
        members.push(`${staticPrefix}${memberName(stmt[1])}: ${tidyType(stmt[2])};`);
        continue;
      }
      if (isNode(stmt) && stmt[0] === '=' && stmt.length === 3 &&
          (typeof stmt[1] === 'string' || isStaticKey(stmt[1]))) {
        const annotation = roleType(stmt, 'annotation');
        if (annotation === null) continue;
        const staticPrefix = isStaticKey(stmt[1]) ? 'static ' : '';
        members.push(`${staticPrefix}${memberName(stmt[1])}: ${annotation};`);
      }
    }
    if (members.length === 0) return;
    let ext = '';
    if (parent != null) {
      if (typeof parent !== 'string') {
        throw new DtsError(`declaration emission: class ${name} extends an expression — a declaration's heritage clause takes a type name`);
      }
      ext = ` extends ${parent}`;
    }
    lines.push(`${exported ? 'export ' : ''}declare class ${name}${ext} {`);
    for (const m of members) lines.push(`  ${m}`);
    lines.push('}');
  };

  // Enum members re-render from the tree (the emitter already
  // validated literal-only values); TS enum declarations take the
  // same `name = literal` rows.
  const enumDecl = (node, exported) => {
    const [, name, body] = node;
    const items = isNode(body) && body[0] === 'block' ? body.slice(1) : [body];
    const memberText = (v) => (isNode(v) && v[0] === '-' ? `-${v[1]}` : v);
    lines.push(`${exported ? 'export ' : ''}declare enum ${name} {`);
    items.forEach((item, i) => {
      lines.push(`  ${item[1]} = ${memberText(item[2])}${i < items.length - 1 ? ',' : ''}`);
    });
    lines.push('}');
  };

  // A typed reactive declaration declares its CONTAINER: the module's
  // export surface is the container object the lowering binds
  // (imported reactive names never auto-unwrap — the cross-module
  // contract), so the annotation types the `.value` slot, and the
  // container carries the `read(): T` structural brand (the runtime's
  // detection predicate — src/component-types.js has the doctrine).
  // A computed's container is read-only from the outside; both bind
  // `const`.
  const reactiveDecl = (node, exported) => {
    if (typeof node[1] !== 'string') return;
    const annotation = roleType(node, 'annotation');
    if (annotation === null) return;
    const ro = node[0] === 'computed' ? 'readonly ' : '';
    lines.push(`${exported ? 'export ' : ''}declare const ${node[1]}: ${containerType(annotation, ro)};`);
  };

  const isReactiveDecl = (stmt) => {
    if (!isNode(stmt) || (stmt[0] !== 'state' && stmt[0] !== 'computed') || stmt.length !== 3) return false;
    const id = stores.idOf(stmt);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'state' || kind === 'computed';
  };

  // A component declaration: the component is a STRUCTURAL
  // construct — like an enum it declares without carrying an
  // annotation. The shape is the companion-interface pattern the face
  // uses: `interface Name { …instance surface… }` (TS's separate
  // type/value namespaces make the same-name pairing legal, and a
  // consumer's `c: Name` annotation finds a type) beside the binding's
  // constructor type — the props surface (src/component-types.js, the
  // renderer the face marks through) plus the static mount mirror.
  const isComponentDecl = (x) => {
    if (!isNode(x) || x[0] !== 'component' || x.length !== 3) return false;
    const id = stores.idOf(x);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'component';
  };

  const componentDecl = (node, name, exported) => {
    const info = componentTypeInfo(stores, source, node);
    const optional = propsParamOptional(info);
    const exp = exported ? 'export ' : '';
    lines.push(`${exp}interface ${name} {`);
    for (const l of rendered(() => instanceTypeLines(info, name))) lines.push(`  ${l}`);
    lines.push('}');
    lines.push(`${exp}declare let ${name}: {`);
    lines.push(`  new (props${optional ? '?' : ''}: ${propsTypeText(info)}): ${name};`);
    // The static mount mirror constructs with NO props (`new this()`
    // in the runtime), so a component with a REQUIRED prop must not
    // offer it — the call would be tsc-clean while the runtime yields
    // a required container holding undefined. Requiredness is a TYPE-story fact (annotations
    // erase — the runtime never sees it), so the gate lives
    // here, never as a runtime throw.
    if (optional) lines.push(`  mount(target?: any): ${name};`);
    lines.push('};');
  };

  // A typed BOUND effect (`h: T ~> body`) declares its dispose handle
  // AS the annotated type — the handle is a plain const, no container
  // wrapping (unlike the reactive declarations above).
  const isEffectDecl = (stmt) => {
    if (!isNode(stmt) || stmt[0] !== 'effect' || stmt.length !== 3) return false;
    const id = stores.idOf(stmt);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'effect';
  };

  const effectDecl = (node, exported) => {
    if (typeof node[1] !== 'string') return;
    const annotation = roleType(node, 'annotation');
    if (annotation === null) return;
    lines.push(`${exported ? 'export ' : ''}declare const ${node[1]}: ${annotation};`);
  };

  // A typed readonly declaration (`x: T =! e`) declares a plain
  // const of the annotated type — `declare const` already makes a
  // consumer reassignment a TS error, so no container or wrapper
  // exists to surface (the effect-handle shape, not the reactive
  // `{ value: T }` one).
  const isReadonlyDecl = (stmt) => {
    if (!isNode(stmt) || stmt[0] !== 'readonly' || stmt.length !== 3) return false;
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
  const pendingImports = [];     // import nodes, source order
  const pendingDefaults = [];    // identifier default exports
  const pendingExportLists = []; // bare `export { … }` specifier lists

  const specListText = (list) =>
    list.map((s) => (isNode(s) ? `${s[0]} as ${s[1]}` : s)).join(', ');

  const importText = (node) => {
    const source = node[node.length - 1];
    const specs = node.slice(1, -1).map((spec) => {
      if (typeof spec === 'string') return spec;
      if (spec[0] === '*') return `* as ${spec[1]}`;
      return `{ ${specListText(spec)} }`;
    });
    return `import ${specs.join(', ')} from ${moduleSourceText(source)};`;
  };

  // The names an import binds locally: the default name, the
  // namespace name, or each specifier's local (its alias when
  // renamed). A side-effect import binds nothing.
  const importBoundNames = (node) => {
    const names = [];
    for (const spec of node.slice(1, -1)) {
      if (spec === '{}') continue;
      if (typeof spec === 'string') names.push(spec);
      else if (spec[0] === '*') names.push(spec[1]);
      else for (const s of spec) names.push(isNode(s) ? s[1] : s);
    }
    return names;
  };

  const isModuleImport = (x) => {
    if (!isNode(x) || x[0] !== 'import' || x.length < 3) return false;
    const id = stores.idOf(x);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'import';
  };

  // An export payload that is a specifier LIST, not a declaration.
  // Three tests, all required: no structural statement head, no
  // store-verified declaration kind (a `state` node's elements can
  // all be identifier strings — the stores, not the shape, are the
  // authority), and every element a plain identifier or an
  // identifier pair.
  const STMT_HEADS = new Set([
    '=', 'void-assign', 'class', 'enum', 'type-decl', 'typed-var',
    'def', 'void-def', 'def-sig', 'state', 'computed', 'effect',
    'readonly', 'component', 'schema',
  ]);
  const isIdent = (s) => typeof s === 'string' && /^[A-Za-z_$][\w$]*$/.test(s);
  const isExportList = (x) =>
    isNode(x) && !STMT_HEADS.has(x[0]) &&
    !isReactiveDecl(x) && !isEffectDecl(x) && !isReadonlyDecl(x) &&
    x.every((s) => isIdent(s) || (isNode(s) && s.length === 2 && isIdent(s[0]) && isIdent(s[1])));

  const stmtDecl = (stmt, exported) => {
    if (!isNode(stmt)) return;
    const head = stmt[0];
    if (head === 'export') {
      if (stmt[1] !== '{}' && isExportList(stmt[1])) pendingExportLists.push(stmt[1]);
      else stmtDecl(stmt[1], true);
      return;
    }
    if (isModuleImport(stmt)) {
      pendingImports.push(stmt);
      return;
    }
    if (head === 'export-all') {
      lines.push(`export * from ${moduleSourceText(stmt[1])};`);
      return;
    }
    if (head === 'export-from') {
      const spec = stmt[1] === '{}' ? '{}' : `{ ${specListText(stmt[1])} }`;
      lines.push(`export ${spec} from ${moduleSourceText(stmt[2])};`);
      return;
    }
    if (head === 'export-default') {
      if (typeof stmt[1] === 'string') pendingDefaults.push(stmt[1]);
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
    if (head === 'type-decl') lines.push(...rendered(() => renderTypeDecl(stmt[1])));
    else if (head === 'typed-var' && typeof stmt[1] === 'string') {
      lines.push(`declare let ${stmt[1]}: ${tidyType(stmt[2])};`);
    }     else if (head === 'def-sig') defSigDecl(stmt);
    else if (isDefHead(head) && stmt.length === 4) defDecl(stmt, exported);
    else if (head === '=' && stmt.length === 3 && schemaByNode.has(stmt[2])) {
      schemaDecl(schemaByNode.get(stmt[2]), exported);
    } else if (head === '=' && stmt.length === 3 && typeof stmt[1] === 'string' && isComponentDecl(stmt[2])) {
      componentDecl(stmt[2], stmt[1], exported);
    } else if (head === '=' && stmt.length === 3 && protoMemberTarget(stmt) !== null) {
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
        lines.push(`declare global { interface ${proto.head}${PROTO_GENERIC_PARAMS[proto.head] ?? ''} { ${proto.member}: ${t} } }`);
      }
    } else if ((head === '=' || head === 'void-assign') && stmt.length === 3) assignDecl(stmt, exported);
    else if (head === 'class') classDecl(stmt, exported);
    else if (head === 'enum') enumDecl(stmt, exported);
  };

  // Module-declared heads, for the prototype-augmentation split: a
  // name declared in this module is never `declare global` material.
  const moduleHeads = new Set();
  for (const s of sexpr.slice(1)) {
    const t = isNode(s) && s[0] === 'export' && isNode(s[1]) ? s[1] : s;
    if (!isNode(t)) continue;
    if ((t[0] === 'class' || t[0] === 'enum' || t[0] === 'typed-var' ||
         t[0] === '=' || t[0] === 'void-assign') && typeof t[1] === 'string') moduleHeads.add(t[1]);
  }

  for (const stmt of sexpr.slice(1)) stmtDecl(stmt, false);

  // Deferred edges resolve against the FULL declaration text: a
  // default export or bare export list names a binding whose
  // declaration may sit anywhere in the module (modules hoist), and
  // an untyped binding has no declaration to reference — its
  // specifier drops (the untyped-export rule), never a dangling name.
  const declaredName = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:let|const|function|class|interface|enum|type) ${escaped}\\b`).test(lines.join('\n'));
  };
  for (const name of pendingDefaults) {
    if (declaredName(name)) lines.push(`export default ${name};`);
  }
  for (const list of pendingExportLists) {
    const kept = list.filter((s) => declaredName(isNode(s) ? s[0] : s));
    if (kept.length > 0) lines.push(`export { ${specListText(kept)} };`);
  }
  // An import is retained when a declaration references one of its
  // bound names; text the declarations never mention imports nothing
  // (retention errs toward keeping — an unused import in a
  // declaration file is inert, a missing one breaks every consumer).
  const bodyText = lines.join('\n');
  const referenced = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\w$.])${escaped}(?![\\w$])`).test(bodyText);
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
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
