// The face seam, JS side. Each member is a point where a lowering shared
// by both faces lets the TS face add type syntax; here it does what the
// JS face does at that point (nothing, or the plain emission). TsEmitter
// (src/emit/face.js) overrides these members and no others, so the JS
// face carries none of the TS face's code and the browser build can
// leave face.js out.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

export class FaceHooks {
  // The file-level `@ts-nocheck` line, ahead of every injection.
  emitFaceHead() {}

  // A runtime delivery unit's TS-only alias declarations and the type
  // its injected destructure asserts: null when it asserts none.
  runtimeUnitTypes() {
    return null;
  }

  // The schema type story's module block, after runtime injection.
  emitSchemaStory() {}

  // Everything the face declares after the program; the names of the
  // globals it declares.
  emitFaceTail() {
    return [];
  }

  tsReturnAnnotation() {}

  emitTsTypeDecls() {}

  // The schema scope a statement list belongs to: schema scopes exist on
  // the TS face alone.
  schemaScopeOf() {
    return null;
  }

  placeSchemaScope() {}

  flushPendingTypeDecls() {}

  tsScaffoldAny() {}

  tsServedValue(name, fn) {
    fn();
    return null;
  }

  tsLoopItemTypeText() {
    return null;
  }

  tsIterThunkName() {
    return null;
  }

  // The receiver bytes, bare.
  tsElReceiver(el) {
    return { surfaced: false, emit: () => this.b.emit(el), valsName: null, hostText: null };
  }

  tsHandlerCast(fn) {
    fn();
    return null;
  }

  withTsDirectives(node, pad, fn) {
    fn();
  }

  tsOverloadSigs() {}

  // A component's render-handler methods and the events each serves.
  componentHandlerEvents() {
    return null;
  }

  // The type a component method's or hook's first parameter takes.
  callableParamType() {
    return null;
  }

  tsPrivate() {}
}
