// Component vocabulary shared by JS emission (rejection / categorization)
// and the component type story. Kept out of component-types.js so the
// browser compile graph can categorize members without the IDE type
// renderers.

// The exact-five lifecycle hooks — the single source (the emitter's
// categorization consumes this set too).
export const COMPONENT_HOOKS = new Set(['beforeMount', 'mounted', 'beforeUnmount', 'unmounted', 'onError']);
export const COMPONENT_RUNTIME_FIELDS = new Set([
  '_state', '_frame', '_parent', '_children', '_root', '_nodes', '_target',
  '_context', '_rest', '_restWriters', '_restHandlers', '_inheritedEl',
  '_refCleanups', '_initFailed',
]);
