// The face seam, JS side. A lowering both faces share reaches TS-only
// behavior in one of two ways, by one rule:
//
//   - A whole step, one the JS face skips or answers with a fixed value
//     (nothing, null, false, an empty list, the plain emission), is a
//     HOOK: the shared module calls it unconditionally, the member below
//     is the JS face's answer, and TsEmitter (src/emit/face.js)
//     overrides it. Every hook is named `ts…`, and no other emitter
//     member is.
//   - TS bytes or records interleaved with shared bytes inside one
//     emission (a `(` … ` as T)` around a shared value, a span pushed
//     between two shared emits) stay inline under a `this.ts` test,
//     where a hook would split one emission across two files. Such a
//     block may call TsEmitter's own members.
//
// TsEmitter overrides these members and no others (src/emit/emitter.js
// checks at load). The shared modules still carry the inline sites: the
// JS face includes their code and never runs it. The browser build
// leaves face.js and everything it imports from src/ts/ out.
//
// A member carrier: src/emit/emitter.js lends its members to Emitter;
// its instance holds no state.

// Each comment says what a TS override owes at that point.
export class FaceHooks {
  // The file-level `@ts-nocheck` line, ahead of every injection.
  tsHead() {}

  // An inline runtime unit's alias declarations, emitted; returns the
  // type its injected destructure asserts, or null for none.
  tsRuntimeUnitTypes() {
    return null;
  }

  // The schema type story's module block, after runtime injection.
  tsSchemaStory() {}

  // Everything declared after the program; returns the names of the
  // globals it declares.
  tsTail() {
    return [];
  }

  // A binding statement's companions after it: component interface,
  // schema behavior object.
  tsStatementTail() {}

  // A tail-returned schema binding's behavior object, after the return.
  tsReturnTail() {}

  // An exported binding's companions, after the export statement.
  tsExportTail() {}

  // A function's return annotation, emitted after its parameter list.
  tsReturnAnnotation() {}

  // A generic def's type parameters, emitted after its name.
  tsTypeParams() {}

  // A component binding's type parameters, emitted on its class.
  tsComponentTypeParams() {}

  // The module's typed validator registrations, collected.
  tsCollectValidatorRegistrations() {}

  // A scope's hoist entries' annotations and forward directives, attached.
  tsHoistEntries() {}

  // A bodiless def-sig, queued for its implementation.
  tsQueueOverloadSig() {}

  // A slotless branch's type declarations, queued for the next flush.
  tsQueueTypeDecls() {}

  // An annotated prototype member's interface augmentation, emitted.
  tsAugment() {}

  // A member initializer's name and lowered target, recorded.
  tsMemberInitSite() {}

  // A type-only import: erased; the override keeps it as `import type`.
  tsTypeOnlyImport(node) {
    this.eraseTypeOnly(node);
  }

  // A type-only re-export: erased; the override keeps it as `export type`.
  tsTypeOnlyExport(node) {
    this.eraseTypeOnly(node);
  }

  // A statement list's type and interface declarations, emitted as lines.
  tsTypeDecls() {}

  // The type declarations queued by slotless lowerings, flushed as lines.
  tsFlushTypeDecls() {}

  // The schema scope a statement list belongs to, or null.
  tsSchemaScopeOf() {
    return null;
  }

  // A statement list's schema scope, placed ahead of its statements.
  tsPlaceSchemaScope() {}

  // The statement's attached directive lines, then the statement (`fn`).
  tsWithDirectives(node, pad, fn) {
    fn();
  }

  // A def's overload signatures, emitted above its implementation.
  tsOverloadSigs() {}

  // A scaffold binding's `: any` (or the given type), emitted.
  tsScaffoldAny() {}

  // A member's `private ` modifier, emitted.
  tsPrivate() {}

  // A cast or `satisfies`: the value under the node's marks; the
  // override adds the assertion around it.
  tsPostfixType(node) {
    this.mark(node, '$self', () =>
      this.mark(node, 'annotation', () =>
        this.mark(node, 'value', () => this.expr(node[2]))));
  }

  // The source span a leaf's word maps to, or null.
  tsMappedLeafSpan() {
    return null;
  }

  // A name, emitted; the override also records its correction channels.
  tsNoteNameSpan(value) {
    this.b.emit(value);
  }

  // A node's head keyword, recorded as consumed vocabulary.
  tsNoteHeadKeyword() {}

  // The source spans of the leaves under a node spelling a word, sorted.
  tsLeafSpansIn() {
    return [];
  }

  // The one leaf span under a node spelling a word, or null.
  tsWordSpanIn() {
    return null;
  }

  // A declaration's minted kind, recorded at its role's source span.
  tsNoteKind() {}

  // A reactive declaration's type annotation, emitted after its name.
  tsReactiveAnnotation() {}

  // A scope's hoisted component bindings' types, recorded on its entries.
  tsHoistComponentTypes() {}

  // A class's promoted constructor parameters, declared as fields.
  tsDeclarePromotedFields() {}

  // A class's `@field` assignments, declared as fields.
  tsDeclareAssignedFields() {}

  // Does a function value take its parameter types from its context?
  tsContextuallyTyped() {
    return false;
  }

  // A schema declaration's pinned field types, or null.
  tsSchemaDeclarationPins() {
    return null;
  }

  // A provided name's read (`@stash`, `@router`), recorded with its kind.
  tsNoteProvidedRead() {}

  // A call's checked-ask argument, registered for callArg's wrap.
  tsRegisterCheckedArgs() {}

  // A component head's host span and node, recorded; returns them.
  tsComponentHeadSpans() {
    return null;
  }

  // A component's type story, walked and kept; returns it, or null.
  tsComponentTypeInfo() {
    return null;
  }

  // A component gate's stash projection type, or null.
  tsGateProjectionText() {
    return null;
  }

  // A lookup from a component method's name to its first parameter's
  // type, or null for none.
  tsCallableParamTypes() {
    return null;
  }

  // A render statement's attached directive lines, emitted.
  tsRenderDirectives() {}

  // The container's emission, wrapped where a branch narrowed it.
  tsNarrowedContainer(name, emitRef) {
    return emitRef;
  }

  // A render pair's diagnostics record, or null.
  tsPairRelationRecord() {
    return null;
  }

  // The type a listener's handler is cast to, or null.
  tsHandlerCastType() {
    return null;
  }

  // The handler (`fn`), cast; returns the cast's generated span, or null.
  tsHandlerCast(fn) {
    fn();
    return null;
  }

  // The event parameter type for a set of events on a host, or null.
  tsEventTypeText() {
    return null;
  }

  // An element receiver: its bytes, and whether a typed surface backs it.
  tsElReceiver(el) {
    return { surfaced: false, emit: () => this.b.emit(el), valsName: null, hostText: null };
  }

  // A served value (`fn`), emitted; returns its record, or null.
  tsServedValue(name, fn) {
    fn();
    return null;
  }

  // A render loop's item type text, or null.
  tsLoopItemTypeText() {
    return null;
  }

  // A render loop's iterable thunk name, or null.
  tsIterThunkName() {
    return null;
  }

  // Does the current render record carry narrowing claims?
  tsHasNarrow() {
    return false;
  }

  // The bare member names the active narrowing claims cover, or null.
  tsNarrowedReadNames() {
    return null;
  }

  // The narrowing assertions a block's function body opens with;
  // returns whether it emitted any.
  tsNarrowGuard() {
    return false;
  }

  // The closing parens of an expression-form narrowing guard.
  tsNarrowGuardClose() {}

  // The source span of a bare identifier child, or null.
  tsBareChildSpan() {
    return null;
  }

  // A render element's tag word, recorded in the intrinsics channel.
  tsNoteIntrinsicTag() {}

  // A property-road key (`fn`), emitted; the override records its span.
  tsPropertyRoadKey(fn) {
    fn();
  }
}
