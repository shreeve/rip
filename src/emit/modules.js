// Module edges: import and export statements, their specifiers and
// attributes, and the REPL's import lowering.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { bareSpecifier } from './runtimes.js';
import { isList, isNode, isNone, wordOf } from '../sexpr.js';
import { ASSIGNS, moduleSourceText } from './helpers.js';
import { Emitter } from './core.js';

export class ModuleMethods {
  // Module bindings that never ride the hoist line — exported value
  // declarations (`export const`), classes, defs — which the
  // child-component resolution consults beside the scope chain.
  // DESTRUCTURED export targets (`export [A, B] = pair`) are not
  // collected: a component class bound that way draws the resolution's
  // rejection, which is loud and names the working spellings (a plain
  // binding or import). A re-export specifier list (`export {A} from
  // './m.js'`) binds nothing locally, and a local `export {A}` list
  // re-exports a binding the scope chain already answers.
  static moduleBoundNames(stmts) {
    const names = new Set();
    for (const n of stmts) {
      const spec = isNode(n) && n[0] === 'export' ? n[2] : n;
      if (!isNode(spec)) continue;
      const binds = (ASSIGNS.has(spec[0]) && spec.length === 4) || spec[0] === 'class' || spec[0] === 'def';
      const name = binds ? wordOf(spec[2]) : undefined;
      if (name !== undefined) names.add(name);
    }
    return names;
  }

  // An import's attributes clause (`with { type: 'json' }`), the
  // ["with", {}, object] node before the source — or null.
  static importAttributes(node) {
    return isNone(node[4]) ? null : node[4];
  }

  // An import's specifiers: its default or namespace binding, or its
  // braced list (empty for `import {} from`), then the extra one after
  // a default. A side-effect import has none.
  static importSpecs(node) {
    return [node[2], node[3]].filter((s) => !isNone(s));
  }

  // The LOCAL name a named specifier binds — what the rest of the file
  // would have to reference for the import to be needed at runtime.
  static specifierLocal(s) {
    return isNode(s) && s[0] === 'as' ? wordOf(s[3]) : wordOf(s);
  }

  // A specifier list's entries: each a name, `default`, or ["as", {},
  // name, alias]. A multi-line list RE-FLOWS onto one line, so the
  // clause's cover stops being verbatim at the first newline and every
  // name past it loses its position: each name is a source read and
  // takes its own row, and an alias is a binding site and takes one too.
  emitSpecifiers(list, specifier = null) {
    // A type-only name stays in the FACE — it is a real type there, and
    // dropping it would strand every annotation that uses it — but never
    // reaches the JS, where importing a name the module does not export
    // is a module that fails to load. The region carries the separator
    // too, or stripping would leave a dangling comma.
    const kept = list.filter((s) => !this.typeOnlyImports.has(Emitter.specifierLocal(s)));
    let emitted = 0;
    let erased = 0;
    list.forEach((s) => {
      const gone = this.typeOnlyImports.has(Emitter.specifierLocal(s));
      // The declaration joins the imported-reference channel, marked as one:
      // the editor colors an import line uniformly, and a read by kind.
      const note = (start, imported) => {
        if (this.ts && specifier !== null) this.importedRefs.push([start, this.b.offset, imported, specifier, 'declaration']);
      };
      // The names are declarations, never reads: an import statement
      // emitted after other statements would otherwise record its local as
      // a reference to itself.
      const one = () => {
        const was = this.declaringName;
        this.declaringName = true;
        try {
          if (isNode(s) && s[0] === 'as') {
            this.emitLeaf(s[2], wordOf(s[2]), s);
            this.b.emit(' as ');
            const start = this.b.offset;
            this.emitLeaf(s[3], wordOf(s[3]), s);
            note(start, wordOf(s[2]));
          } else {
            const start = this.b.offset;
            this.emitLeaf(s, wordOf(s), list);
            note(start, wordOf(s));
          }
        } finally { this.declaringName = was; }
      };
      if (gone) {
        if (!this.ts) return;                  // the shipping emission: gone
        // The face keeps it, inside a region so stripping reproduces the
        // JS byte for byte. The separator rides along — lead with it when
        // something survives ahead, otherwise trail it — or a strip would
        // leave a dangling comma. When NOTHING survives, the clause is
        // all regions and no name trails a separator, so every name
        // past the first leads with one instead — else the names fuse.
        this.b.tsOnly(() => {
          if (emitted > 0 || (kept.length === 0 && erased > 0)) this.b.emit(', ');
          one();
          if (emitted === 0 && kept.length > 0) this.b.emit(', ');
        });
        erased++;
        return;
      }
      if (emitted > 0) this.b.emit(', ');
      one();
      emitted++;
    });
  }

  // The clause between `import` and its source — the spec arms every
  // import emission shares. A type-only statement's clause prints the
  // same bytes through it: its names never enter the elision set, so
  // emitSpecifiers takes only its plain path.
  // Each specifier emits under its role (`spec`, then `extra`), so a
  // bound name owns an exact row of its own even when the statement's
  // own row is a cover (an attributes clause re-renders its object).
  emitImportClause(specs, node = null) {
    const specifier = node === null ? null : bareSpecifier(wordOf(node[5]));
    specs.forEach((spec, i) => {
      if (i > 0) this.b.emit(', ');
      // The braces of a named list sit outside the mark: the role's
      // span is the names alone, and only then is the row exact.
      const role = node === null ? null : i === 0 ? 'spec' : 'extra';
      const emitSpec = (fn) => (role === null ? fn() : this.mark(node, role, fn));
      if (isList(spec) && spec.length === 0) this.b.emit('{}');
      else if (isList(spec)) {
        this.b.emit('{ ');
        emitSpec(() => this.emitSpecifiers(spec, specifier));
        this.b.emit(' }');
      } else if (spec[0] === 'as') {
        emitSpec(() => {
          this.b.emit('* as ');
          const start = this.b.offset;
          this.b.emit(wordOf(spec[3]));
          if (this.ts && node !== null) this.importedRefs.push([start, this.b.offset, '*', specifier, 'declaration']);
        });
      } else emitSpec(() => this.b.emit(wordOf(spec)));
    });
    this.b.emit(' from ');
  }

  // ["import", {}, spec, extra, attributes, source] — ESM passthrough:
  // `import { a, b as c } from 'src';` (spaced braces, single-quoted
  // source, a trailing newline that leaves a blank line before the code
  // that follows).
  importStatement(node) {
    if (this.script) {
      throw this.positionedError(node, 'emitter: module imports are not available in a script tag — script sources share one scope, and modules arrive with the package graph');
    }
    const source = wordOf(node[5]);
    const specs = Emitter.importSpecs(node);
    const attrs = Emitter.importAttributes(node);
    // A bare `default` inside braces names no binding — ES has no such
    // specifier. The default binding is the unbraced form, or the
    // aliased one inside braces.
    for (const spec of specs) {
      if (isList(spec) && spec.includes('default')) {
        throw this.positionedError(node,
          "emitter: `import { default }` binds nothing — spell the default import `import name from '…'`, or alias it: `import { default as name } from '…'`");
      }
    }
    // A TYPE-ONLY import (`import type … from …`, the side-band
    // typeOnly role): the author's declaration that the module carries
    // no side effect they need, so the WHOLE statement erases from the
    // JS — the one erasure a plain import can never earn (see the
    // allErased comment below). The TS face keeps the statement as
    // `import type …`, one region, so stripping it reproduces the JS
    // byte for byte. The repl has no type face, so the statement
    // erases there too — lowering it like a value import would await
    // a module the author said not to run.
    if (this.roleRow(node, 'typeOnly') !== null) {
      if (!this.ts) {
        this.eraseTypeOnly(node);
        return;
      }
      this.b.tsOnly(() => {
        this.mark(node, '$self', () => {
          this.b.emit('import ');
          this.mark(node, 'typeOnly', () => this.b.emit('type'));
          this.b.emit(' ');
          // The shared clause arms serve here because typeOnlyImports
          // keeps a type-only statement's bindings out of the elision set —
          // emitSpecifiers prints every name plainly, no separator
          // bookkeeping fires.
          this.emitImportClause(specs, node);
          this.emitModuleSource(node, source);
          this.emitImportAttributes(attrs);
        });
        this.b.emit(';\n');
      });
      return;
    }
    if (this.repl) return this.replImportStatement(node);
    this.mark(node, '$self', () => {
      this.b.emit('import ');
      // A SIDE-EFFECT import has no clause and gets none: `import {} from
      // …` is equivalent at runtime but states an empty NAMED list, which
      // a reader of the emission — TypeScript included — takes as a clause
      // waiting to be filled.
      // Every binding erased leaves the clause with nothing to say, and
      // the JS becomes a bare `import 'mod'` — which still RUNS the
      // module. Dropping the statement outright would silently discard
      // its side effects, so the clause and its `from` ride the region
      // and the specifier stays.
      const erased = (s) => this.typeOnlyImports.has(Emitter.specifierLocal(s));
      const allErased = specs.length > 0 && specs.every((spec) => (isList(spec) ? spec.length > 0 && spec.every(erased) : erased(spec)));
      if (specs.length > 0) {
        if (!allErased) this.emitImportClause(specs, node);
        else if (this.ts) this.b.tsOnly(() => this.emitImportClause(specs, node));
      }
      this.emitModuleSource(node, source);
      this.emitImportAttributes(attrs);
    });
    this.b.emit(';\n');
  }

  // A module specifier under the statement's `source` role, recorded as
  // an import span (returned).
  emitModuleSource(node, source) {
    const start = this.b.offset;
    const specifier = moduleSourceText(source);
    this.mark(node, 'source', () => this.b.emit(specifier));
    const span = { start, end: this.b.offset, specifier };
    this.importSpans.push(span);
    return span;
  }

  // A type-only statement leaves the JS nothing: its rows record the
  // erasure at the current offset.
  eraseTypeOnly(node) {
    this.mark(node, '$self', () => {});
    this.mark(node, 'source', () => {});
  }

  // The attributes clause after the source: `with { type: "json" }`.
  emitImportAttributes(attrs) {
    if (attrs === null) return;
    // The loader reads the attributes before any code runs: each is a
    // string-literal pair, or the import fails to parse.
    for (const pair of attrs[2].slice(2)) {
      const value = isNode(pair) && pair[0] === ':' && pair[1].void !== true ? wordOf(pair[3]) : undefined;
      const literal = value !== undefined && (value[0] === '"' || value[0] === "'");
      if (!literal) throw this.positionedError(pair, 'emitter: an import attribute is a string-literal pair (`with { type: "json" }`) — the module loader reads it before any code runs');
    }
    this.b.emit(' ');
    this.mark(attrs, '$self', () => {
      this.mark(attrs, 'keyword', () => this.b.emit('with'));
      this.b.emit(' ');
      this.mark(attrs, 'value', () => this.expr(attrs[2]));
    });
  }

  // repl mode's import lowering: a static import cannot live in a
  // function body (the REPL evaluates each line inside an async
  // function), so the statement emits as its awaited dynamic
  // equivalent, bindings preserved — named/default specifiers
  // destructure the namespace (`const { default: d, a, b: c } =
  // await import('m')`), `* as ns` binds the module object whole
  // (a mixed form destructures FROM the bound namespace, one await),
  // and a side-effect import awaits bare. The specifier routes
  // through the minted import resolver like every repl-mode dynamic
  // import, and its span still records exactly like the static
  // form's. No generated function scope is introduced; `await` sits
  // in the program's own context.
  replImportStatement(node) {
    const source = wordOf(node[5]);
    const specs = Emitter.importSpecs(node);
    const attrs = Emitter.importAttributes(node);
    const parts = [];
    let nsName = null;
    for (const spec of specs) {
      if (isList(spec)) for (const s of spec) parts.push(isNode(s) && s[0] === 'as' ? `${wordOf(s[2])}: ${wordOf(s[3])}` : wordOf(s));
      else if (spec[0] === 'as') nsName = wordOf(spec[3]);
      else parts.push(`default: ${wordOf(spec)}`);
    }
    this.mark(node, '$self', () => {
      if (nsName !== null) this.b.emit(`const ${nsName} = `);
      else if (parts.length > 0) this.b.emit(`const { ${parts.join(', ')} } = `);
      this.b.emit(`await import(${this.replResolver()}(`);
      this.emitModuleSource(node, source);
      this.b.emit(')');
      // Attributes ride the dynamic form's options argument.
      if (attrs !== null) {
        this.b.emit(', { with: ');
        this.mark(attrs, 'value', () => this.expr(attrs[2]));
        this.b.emit(' }');
      }
      this.b.emit(')');
      if (nsName !== null && parts.length > 0) {
        this.b.emit(`, { ${parts.join(', ')} } = ${nsName}`);
      }
    });
    this.b.emit(';\n');
  }

  exportStatement(node, ind) {
    if (this.script) {
      throw this.positionedError(node, 'emitter: exports are not available in a script tag — drop the export keyword; script sources share one scope');
    }
    // A REPL entry evaluates inside an async function body, where
    // `export` is a load-time SyntaxError with no position — reject
    // HERE, positioned (the script-mode precedent).
    if (this.repl) {
      throw this.positionedError(node, "emitter: 'export' has no meaning in a REPL entry — every top-level binding already persists to later lines; drop the export keyword");
    }
    // A module's exports are static: an export inside a block or under
    // a postfix guard has no JS form (`if (c) export …` is a syntax
    // error). The guard belongs on the VALUE — `export x = v if c` —
    // which the grammar already reads that way.
    if (ind > 0 || this.postfixGuardDepth > 0) {
      throw this.positionedError(node,
        "emitter: 'export' must be a top-level statement — a module's exports are static, so a guarded or block-nested export has no form; " +
        'move it to the top level, or guard the exported value instead (`export x = v if c`)');
    }
    const head = node[0];
    // A TYPE-ONLY re-export (`export type { … } from …`, the side-band
    // typeOnly role) is `import type`'s mirror: the whole statement
    // erases from the JS, so the module is never loaded for it, and the
    // TS face keeps it as one region whose stripping reproduces the JS
    // byte for byte.
    if (head === 'export-from' && this.roleRow(node, 'typeOnly') !== null) {
      if (!this.ts) {
        this.eraseTypeOnly(node);
        return;
      }
      this.b.tsOnly(() => {
        this.mark(node, '$self', () => {
          this.b.emit('export ');
          this.mark(node, 'typeOnly', () => this.b.emit('type'));
          const source = wordOf(node[3]);
          this.b.emit(' { ');
          this.emitSpecifiers(node[2], bareSpecifier(source));
          this.b.emit(' } from ');
          this.emitModuleSource(node, source);
        });
        this.b.emit(';');
      });
      return;
    }
    this.mark(node, '$self', () => {
      if (head === 'export-all') {
        const alias = wordOf(node[3]);
        if (alias !== undefined) {
          this.b.emit('export * as ');
          this.mark(node, 'alias', () => this.b.emit(alias));
          this.namespaceExports.push(alias);
          this.b.emit(' from ');
        } else {
          this.b.emit('export * from ');
        }
        const span = this.emitModuleSource(node, wordOf(node[2]));
        span.namespace = alias;
        this.b.emit(';');
      } else if (head === 'export-from') {
        const source = wordOf(node[3]);
        this.b.emit('export ');
        if (node[2].length === 0) this.b.emit('{}');
        else {
          this.b.emit('{ ');
          this.emitSpecifiers(node[2], bareSpecifier(source));
          this.b.emit(' }');
        }
        this.b.emit(' from ');
        this.emitModuleSource(node, source);
        this.b.emit(';');
      } else if (head === 'export-default') {
        this.b.emit('export default ');
        // `export default def name(…)` exports the function ITSELF —
        // a named function expression (the def statement's body
        // machinery, minus the declaration).
        const spec = node[2];
        if (isNode(spec) && spec[0] === 'def' && spec.length === 5) {
          this.mark(node, 'spec', () => this.defStatement(spec, ind));
        } else {
          this.mark(node, 'spec', () => this.expr(spec));
        }
        this.b.emit(';');
      } else {
        this.exportDeclaration(node, ind);
      }
    });
  }

  // `export` over a specifier list or a declaration.
  exportDeclaration(node, ind) {
    const spec = node[2];
    if (isList(spec) && spec.length === 0) {
      this.b.emit('export {};');
    } else if (isList(spec)) {
      this.b.emit('export { ');
      this.emitSpecifiers(spec);
      this.b.emit(' };');
    } else if (spec[0] === 'class') {
      // Exported declarations carry a trailing semicolon.
      this.b.emit('export ');
      this.classStatement(spec, ind);
      this.b.emit(';');
    } else if (spec[0] === 'def') {
      this.tsOverloadSigs(spec, ind, true);
      this.b.emit('export ');
      this.defStatement(spec, ind);
      this.b.emit(';');
    } else if (this.isReactiveDecl(spec)) {
      // `export count := 0` → `export const count = __state(0);`. The
      // declaration's own emission carries the roles and the trailing
      // semicolon.
      this.b.emit('export ');
      this.reactiveDecl(spec, ind);
    } else if (this.isReadonlyDecl(spec)) {
      // `export x =! 5` → `export const x = 5;`.
      this.b.emit('export ');
      this.readonlyDecl(spec, ind);
    } else if (this.isEffectDecl(spec)) {
      // Only the BOUND form exports (`export const h = __effect(…)`); a
      // bare effect binds nothing to export.
      if (isNone(spec[2])) {
        throw this.positionedError(node, "emitter: a bare effect ('export ~> …') binds nothing to export — bind a dispose handle (`export h ~> …`) or drop the export (`export __effect(…)` would be invalid JS)");
      }
      this.b.emit('export ');
      this.effectStatement(spec, ind);
    } else {
      this.exportAssign(spec);
    }
  }

  // ExportAssign: `=`, plain or void. Exported bindings are const
  // declarations, never hoisted. The assign node is real (ExportAssign
  // rows), so its roles mark: a typed export's annotation role covers the
  // whole emitted declaration; a void export's voidMarker role covers it
  // the same way.
  exportAssign(spec) {
    const name = wordOf(spec[2]);
    const value = spec[3];
    if (spec[1].void === true) this.registerVoidValue(value, spec);
    else {
      const values = Emitter.plainObjectValues(value);
      if (values !== null) this.exportedObjects.push([name, values]);
    }
    this.b.emit('export ');
    this.mark(spec, 'voidMarker', () => this.mark(spec, 'annotation', () => this.mark(spec, '$self', () => {
      this.b.emit('const ');
      this.mark(spec, 'target', () => this.b.emit(name));
      if (this.ts && this.annotationText(spec) !== null) {
        this.tsAnnotate(spec, 'annotation', this.annotationText(spec));
      }
      this.b.emit(' ');
      this.mark(spec, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      const prevSchemaName = this._schemaName;
      const prevComponentName = this._componentName;
      const prevComponentTypeParams = this._componentTypeParams;
      this._componentTypeParams = null;
      if (isNode(value) && value[0] === 'schema') this._schemaName = name;
      if (this.isComponentDecl(value)) {
        this._componentName = name;
        // Exported generic component: the ExportAssign's TYPE_PARAMS
        // role rides to the lowered class, same channel as the Assign
        // path.
        const text = this.annotationText(spec, 'typeParams');
        this._componentTypeParams = text === null ? null : { text, owner: spec };
      }
      this.mark(spec, 'value', () => this.withExpression(() => this.expr(value)));
      this._schemaName = prevSchemaName;
      this._componentName = prevComponentName;
      this._componentTypeParams = prevComponentTypeParams;
    })));
    this.b.emit(';');
    if (this.ts && this.componentInfo.has(value)) {
      this.tsComponentCompanion(value, name, true, this.annotationText(spec, 'typeParams'));
    }
    // The schema behavior object rides the EXPORT binding as it rides
    // the plain one — the alias lines name it either way.
    if (this.ts) this.tsSchemaBehavior(value);
  }
}
