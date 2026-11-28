// Module edges: import and export statements, their specifiers and
// attributes, and the REPL's import lowering.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { bareSpecifier } from './runtimes.js';
import { ASSIGNS, isShapedNode, isDefHead, moduleSourceText } from './helpers.js';
import { Emitter } from './core.js';

export class ModuleMethods {
  // Module bindings that never ride the hoist line — exported value
  // declarations (`export const`), classes, defs. The child-
  // component resolution (#137's compile-knowable half) consults this
  // beside the scope chain; nothing else does (the hoist filtering
  // semantics stay untouched). NEGATIVE SPACE, deliberate (the PR
  // #78 Opus round): DESTRUCTURED export targets (`export [A, B] =
  // pair`) are not collected — a component class bound that way
  // draws the #137 rejection, which is LOUD and names the working
  // spellings (a plain binding or import); re-export specifier lists
  // (`export {A} from './m.js'`) bind nothing locally, so their
  // absence here is correct, and a local `export {A}` list
  // re-exports a binding the scope chain already answers.
  static moduleBoundNames(stmts) {
    const names = new Set();
    const noteSpec = (spec) => {
      if (!isShapedNode(spec)) return;
      if (ASSIGNS.has(spec[0]) && spec.length === 3 && typeof spec[1] === 'string') names.add(spec[1]);
      else if (spec[0] === 'class' && typeof spec[1] === 'string') names.add(spec[1]);
      else if (isDefHead(spec[0]) && typeof spec[1] === 'string') names.add(spec[1]);
    };
    for (const n of stmts) {
      if (!isShapedNode(n)) continue;
      if (n[0] === 'export') for (const spec of n.slice(1)) noteSpec(spec);
      else noteSpec(n);
    }
    return names;
  }

  // An import's attributes clause (`with { type: 'json' }`), the
  // ["with", object] element just before the source — or null.
  static importAttributes(node) {
    const a = node.length > 2 ? node[node.length - 2] : null;
    return isShapedNode(a) && a[0] === 'with' && a.length === 2 ? a : null;
  }

  // An import's specifiers: everything between the keyword and the
  // source, the attributes clause excluded.
  static importSpecs(node) {
    return node.slice(1, -1).filter((s) => !(isShapedNode(s) && s[0] === 'with'));
  }

  // Names an import statement binds in module scope.
  static importedNames(imports) {
    const names = [];
    for (const node of imports) {
      for (const spec of Emitter.importSpecs(node)) {
        if (spec === '{}') continue;
        if (typeof spec === 'string') names.push(spec);
        else if (spec[0] === '*') names.push(spec[1]);
        else for (const s of spec) names.push(isShapedNode(s) ? s[1] : s);
      }
    }
    return names;
  }

  moduleSource(s) {
    return moduleSourceText(s);
  }

  // A specifier list entry: a plain name, `default`, or [name, alias].
  // A multi-line specifier list RE-FLOWS onto one line, so the clause's cover
  // stops being verbatim at the first newline and every name past it loses its
  // position. Each name is a source read and takes its own row; the alias is a
  // binding site and takes one too.
  // The LOCAL name a named specifier binds — what the rest of the file
  // would have to reference for the import to be needed at runtime.
  static specifierLocal(s) { return isShapedNode(s) ? s[1] : s; }

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
          if (isShapedNode(s)) {
            this.emitPrimitive(s[0]);
            this.b.emit(' as ');
            const start = this.b.offset;
            this.emitPrimitive(s[1]);
            note(start, s[0]);
          } else {
            const start = this.b.offset;
            this.emitPrimitive(s);
            note(start, s);
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
    specs.forEach((spec, i) => {
      if (i > 0) this.b.emit(', ');
      // The braces of a named list sit outside the mark: the role's
      // span is the names alone, and only then is the row exact.
      const role = node === null ? null : i === 0 ? 'spec' : 'extra';
      const emitSpec = (fn) => (role === null ? fn() : this.mark(node, role, fn));
      if (spec === '{}') this.b.emit('{}');
      else if (typeof spec === 'string') emitSpec(() => this.b.emit(spec));
      else if (spec[0] === '*') {
        emitSpec(() => {
          this.b.emit('* as ');
          const start = this.b.offset;
          this.b.emit(spec[1]);
          if (this.ts && node !== null) this.importedRefs.push([start, this.b.offset, '*', bareSpecifier(node[node.length - 1]), 'declaration']);
        });
      }
      else {
        this.b.emit('{ ');
        emitSpec(() => this.emitSpecifiers(spec, node !== null ? bareSpecifier(node[node.length - 1]) : null));
        this.b.emit(' }');
      }
    });
    this.b.emit(' from ');
  }

  // ["import", spec, source] | ["import", default, extra, source] —
  // ESM passthrough: `import { a, b as c } from 'src';`
  // (spaced braces, single-quoted source, a trailing newline that
  // leaves a blank line before the code that follows).
  importStatement(node) {
    if (this.script) {
      throw this.positionedError(node, 'emitter: module imports are not available in a script tag — script sources share one scope, and modules arrive with the package graph');
    }
    const source = node[node.length - 1];
    const specs = Emitter.importSpecs(node);
    const attrs = Emitter.importAttributes(node);
    // A bare `default` inside braces names no binding — ES has no such
    // specifier. The default binding is the unbraced form, or the
    // aliased one inside braces.
    for (const spec of specs) {
      if (!Array.isArray(spec) || spec[0] === '*') continue;
      if (spec.includes('default')) {
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
    const nodeId = this.stores.idOf(node);
    if (nodeId !== null && this.stores.role(nodeId, 'typeOnly') !== null) {
      if (!this.ts) {
        this.mark(node, '$self', () => {});
        this.mark(node, 'source', () => {});
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
          const specStart = this.b.offset;
          this.mark(node, 'source', () => this.b.emit(this.moduleSource(source)));
          this.importSpans.push({ start: specStart, end: this.b.offset, specifier: moduleSourceText(source) });
          this.emitImportAttributes(attrs);
        });
        this.b.emit(';\n');
      });
      return;
    }
    if (this.repl) return this.replImportStatement(node);
    this.mark(node, '$self', () => {
      this.b.emit('import ');
      // A SIDE-EFFECT import has no clause and gets none. Both forms once
      // lowered to `import {} from …`, which is equivalent at runtime but
      // states something the author did not: an empty NAMED list. A reader
      // of the emission — TypeScript included — takes that as a clause
      // waiting to be filled, and an editor offering to add a name puts it
      // there instead of on a real import. The two are distinct nodes now,
      // so the emission can be what was written.
      // Every binding erased leaves the clause with nothing to say, and
      // the JS becomes a bare `import 'mod'` — which still RUNS the
      // module. Dropping the statement outright would silently discard
      // its side effects, so the clause and its `from` ride the region
      // and the specifier stays.
      const allErased = specs.length > 0 && specs.every((spec) => spec !== '{}'
        && (typeof spec === 'string' || spec[0] === '*'
          ? this.typeOnlyImports.has(typeof spec === 'string' ? spec : spec[1])
          : spec.every((s) => this.typeOnlyImports.has(Emitter.specifierLocal(s)))));
      if (specs.length > 0) {
        if (!allErased) this.emitImportClause(specs, node);
        else if (this.ts) this.b.tsOnly(() => this.emitImportClause(specs, node));
      }
      {
        const specStart = this.b.offset;
        this.mark(node, 'source', () => this.b.emit(this.moduleSource(source)));
        this.importSpans.push({ start: specStart, end: this.b.offset, specifier: moduleSourceText(source) });
      }
      this.emitImportAttributes(attrs);
    });
    this.b.emit(';\n');
  }

  // The attributes clause after the source: `with { type: "json" }`.
  emitImportAttributes(attrs) {
    if (attrs === null) return;
    // The loader reads the attributes before any code runs: each is a
    // string-literal pair, or the import fails to parse.
    for (const pair of attrs[1].slice(1)) {
      const literal = pair[0] === ':' && typeof pair[2] === 'string' && (pair[2][0] === '"' || pair[2][0] === "'");
      if (!literal) throw this.positionedError(pair, 'emitter: an import attribute is a string-literal pair (`with { type: "json" }`) — the module loader reads it before any code runs');
    }
    this.b.emit(' ');
    this.mark(attrs, '$self', () => {
      this.mark(attrs, 'keyword', () => this.b.emit('with'));
      this.b.emit(' ');
      this.mark(attrs, 'value', () => this.expr(attrs[1]));
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
    const source = node[node.length - 1];
    const specs = Emitter.importSpecs(node);
    const attrs = Emitter.importAttributes(node);
    const parts = [];
    let nsName = null;
    for (const spec of specs) {
      if (spec === '{}') continue;
      if (typeof spec === 'string') parts.push(`default: ${spec}`);
      else if (spec[0] === '*') nsName = spec[1];
      else for (const s of spec) parts.push(isShapedNode(s) ? `${s[0]}: ${s[1]}` : s);
    }
    this.mark(node, '$self', () => {
      if (nsName !== null) this.b.emit(`const ${nsName} = `);
      else if (parts.length > 0) this.b.emit(`const { ${parts.join(', ')} } = `);
      this.b.emit(`await import(${this.replResolver()}(`);
      {
        const specStart = this.b.offset;
        this.mark(node, 'source', () => this.b.emit(this.moduleSource(source)));
        this.importSpans.push({ start: specStart, end: this.b.offset, specifier: moduleSourceText(source) });
      }
      this.b.emit(')');
      // Attributes ride the dynamic form's options argument.
      if (attrs !== null) {
        this.b.emit(', { with: ');
        this.mark(attrs, 'value', () => this.expr(attrs[1]));
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
    const nodeId = this.stores.idOf(node);
    if (head === 'export-from' && nodeId !== null && this.stores.role(nodeId, 'typeOnly') !== null) {
      if (!this.ts) {
        this.mark(node, '$self', () => {});
        this.mark(node, 'source', () => {});
        return;
      }
      this.b.tsOnly(() => {
        this.mark(node, '$self', () => {
          this.b.emit('export ');
          this.mark(node, 'typeOnly', () => this.b.emit('type'));
          this.b.emit(' { ');
          this.emitSpecifiers(node[1], bareSpecifier(node[2]));
          this.b.emit(' } from ');
          const specStart = this.b.offset;
          this.mark(node, 'source', () => this.b.emit(this.moduleSource(node[2])));
          this.importSpans.push({ start: specStart, end: this.b.offset, specifier: moduleSourceText(node[2]) });
        });
        this.b.emit(';');
      });
      return;
    }
    this.mark(node, '$self', () => {
      if (head === 'export-all') {
        if (node.length === 3) {
          this.b.emit('export * as ');
          this.mark(node, 'alias', () => this.b.emit(node[2]));
          this.namespaceExports.push(node[2]);
          this.b.emit(' from ');
        } else {
          this.b.emit('export * from ');
        }
        {
          const specStart = this.b.offset;
          this.mark(node, 'source', () => this.b.emit(this.moduleSource(node[1])));
          this.importSpans.push({ start: specStart, end: this.b.offset, specifier: moduleSourceText(node[1]), namespace: node.length === 3 ? node[2] : undefined });
        }
        this.b.emit(';');
      } else if (head === 'export-from') {
        this.b.emit('export ');
        if (node[1] === '{}') this.b.emit('{}');
        else {
          this.b.emit('{ ');
          this.emitSpecifiers(node[1], bareSpecifier(node[2]));
          this.b.emit(' }');
        }
        this.b.emit(' from ');
        {
          const specStart = this.b.offset;
          this.mark(node, 'source', () => this.b.emit(this.moduleSource(node[2])));
          this.importSpans.push({ start: specStart, end: this.b.offset, specifier: moduleSourceText(node[2]) });
        }
        this.b.emit(';');
      } else if (head === 'export-default') {
        this.b.emit('export default ');
        // `export default def name(…)` exports the function ITSELF —
        // a named function expression (the def statement's body
        // machinery, minus the declaration).
        if (isShapedNode(node[1]) && isDefHead(node[1][0]) && node[1].length === 4) {
          this.mark(node, 'spec', () => this.defStatement(node[1], ind));
        } else {
          this.mark(node, 'spec', () => this.expr(node[1]));
        }
        this.b.emit(';');
      } else {
        const spec = node[1];
        if (spec === '{}') {
          this.b.emit('export {};');
        } else if (isShapedNode(spec) && spec[0] === 'class') {
          // Exported declarations carry a trailing semicolon.
          this.b.emit('export ');
          this.classStatement(spec, ind);
          this.b.emit(';');
        } else if (isShapedNode(spec) && isDefHead(spec[0])) {
          this.tsOverloadSigs(spec, ind, true);
          this.b.emit('export ');
          this.defStatement(spec, ind);
          this.b.emit(';');
        } else if (this.isReactiveDecl(spec)) {
          // `export count := 0` → `export const count = __state(0);`.
          // The declaration's own emission carries the
          // roles and the trailing semicolon.
          this.b.emit('export ');
          this.reactiveDecl(spec, ind);
        } else if (this.isReadonlyDecl(spec)) {
          // `export x =! 5` → `export const x = 5;`.
          this.b.emit('export ');
          this.readonlyDecl(spec, ind);
        } else if (this.isEffectDecl(spec)) {
          // Only the BOUND form exports (`export const h =
          // __effect(…)`); a bare effect binds nothing to export
          if (spec[1] === null) {
            throw this.positionedError(node, "emitter: a bare effect ('export ~> …') binds nothing to export — bind a dispose handle (`export h ~> …`) or drop the export (`export __effect(…)` would be invalid JS)");
          }
          this.b.emit('export ');
          this.effectStatement(spec, ind);
        } else if (isShapedNode(spec) && (spec[0] === '=' || spec[0] === 'void-assign')) {
          // Exported bindings are const declarations, never hoisted.
          // The assign node is real (ExportAssign rows),
          // so its roles mark: a typed export's annotation role covers
          // the whole emitted declaration; a void export's
          // voidMarker role covers it the same way.
          if (spec[0] === 'void-assign') this.registerVoidValue(spec[2], spec);
          if (spec[0] === '=' && typeof spec[1] === 'string') {
            const values = Emitter.plainObjectValues(spec[2]);
            if (values !== null) this.exportedObjects.push([spec[1], values]);
          }
          this.b.emit('export ');
          this.mark(spec, 'voidMarker', () => this.mark(spec, 'annotation', () => this.mark(spec, '$self', () => {
            this.b.emit('const ');
            this.mark(spec, 'target', () => this.b.emit(spec[1]));
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
            if (isShapedNode(spec[2]) && spec[2][0] === 'schema') this._schemaName = spec[1];
            if (this.isComponentDecl(spec[2]) && typeof spec[1] === 'string') {
              this._componentName = spec[1];
              // Exported generic component: the ExportAssign's
              // TYPE_PARAMS role rides to the lowered class, same
              // channel as the Assign path.
              const text = this.annotationText(spec, 'typeParams');
              this._componentTypeParams = text === null ? null : { text, owner: spec };
            }
            this.mark(spec, 'value', () => this.withExpression(() => this.expr(spec[2])));
            this._schemaName = prevSchemaName;
            this._componentName = prevComponentName;
            this._componentTypeParams = prevComponentTypeParams;
          })));
          this.b.emit(';');
          if (this.ts && typeof spec[1] === 'string' && this.componentInfo.has(spec[2])) {
            this.tsComponentCompanion(spec[2], spec[1], true, this.annotationText(spec, 'typeParams'));
          }
          // The schema behavior object rides the EXPORT binding as it
          // rides the plain one — the alias lines name it either way.
          if (this.ts) this.tsSchemaBehavior(spec[2]);
        } else {
          this.b.emit('export { ');
          this.emitSpecifiers(spec);
          this.b.emit(' };');
        }
      }
    });
  }
}
