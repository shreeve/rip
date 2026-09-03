// The component runtime — the class components compile onto,
// the component stack, context, and the render-DSL helpers.
//
//   __Component               - the base class (props/mount/unmount/emit;
//                               `children` rides every constructor for
//                               slot projection, `__bind_x__` keys carry
//                               shared containers for declared props,
//                               and `static __extends` opens the rest
//                               seam — undeclared props collect into the
//                               reactive `rest` view and forward onto
//                               the inherited element)
//   __pushComponent(c)        - make c the current component; returns prev
//   __popComponent(prev)      - restore the previous component
//   setContext(key, value)    - provide a context value on the current
//                               component (init-time only)
//   getContext(key)           - read a context value from the nearest
//                               provider up the parent chain; a missing
//                               key REJECTS loudly (hasContext is the
//                               optional-use probe)
//   hasContext(key)           - is a provider in reach?
//   __gateBind(self, index)   - computed last-good app-data binding
//                               (resolves the renderer's captured
//                               source through __gateMetadata)
//   __hmrRegistry             - id → { definition, instances }
//   __hmrLookup(id)           - registry entry or undefined
//   __hmrRegisterDefinition(c)- record/replace a component definition
//   __hmrClassify(old, next)  - 'patch' | 'migrate' | 'remount'
//   __hmrPreserveState(a, b)  - copy intersecting __hmrSig.state .value
//   __hmrPatch(inst, NewCtor) - prototype swap + _hmrRerender
//   __hmrMigrateRemount(...)  - new instance + preserve (app remounts)
//   __hmrSnapshotUi()         - focus/selection/scroll snapshot
//   __hmrRestoreUi(snap)      - restore a snapshot
//   __clsx(...args)           - flatten strings/arrays/objects to a
//                               class string
//   __lis(arr)                - longest increasing subsequence indices
//   __reconcile(...)          - keyed-LIS list reconciliation over
//                               block handles
//
// The block-handle contract (what __reconcile drives and the render layer's
// render-factory emission produces):
//   c()                    - create the block's nodes, detached
//   m(parent, anchor)      - mount: insert the nodes before anchor
//   p(ctx, item, i, ...outer) - patch the block for a new item/index
//   d(detaching)           - destroy; remove the nodes from the DOM
//                            when detaching is true (false means an
//                            ancestor is coming down whole)
//   _first                 - the block's FIRST node: the anchor
//                            __reconcile inserts and moves against
//                            (phase 3a's insertion point, phase 4's
//                            LIS move walk)
//   _s                     - the static flag: a block with no
//                            item-dependent parts; __reconcile skips
//                            p() on it entirely
//   __transition(el, name, dir, done) - CSS enter/leave transition with
//                               injected presets
//   __handleComponentError(e, c) - walk the parent chain to the nearest
//                               onError boundary; rethrow past the root
//   __detach(node)            - remove a node from the DOM, tolerant of
//                               fragments and detached nodes
//
// Ownership: every instance holds a NON-NESTED owner frame from the
// reactive runtime's seam; __effect disposers created during _init /
// _create / _setup / hooks land on it, and unmount disposes it.
// Cross-component teardown is the _children unmount cascade, never
// frame nesting (a child component's lifetime is not its construction
// scope's). Render-block factories (render emission) hold NESTED
// frames instead, so block teardown rides the component structurally
// — on EVERY run: an effect restores its creation-time owner around
// each run body, so blocks a reconcile builds during a RE-run land on
// the owning frame with no explicit push at the factory site.
//
// The component stack is module state: exactly one copy exists per
// process per path, so parent chains and context walks span every
// consumer in the process. `document` is referenced only inside
// methods — importing this module DOM-free is legal; mounting without
// a DOM throws JavaScript's own ReferenceError.
//
// Delivery: this file is BOTH the shared module toolchain paths
// import and the body standalone output inlines once (IIFE-wrapped,
// fused into one IIFE with the reactive runtime's body — the import
// line below strips exactly as export lines do). It compiles
// inject-free by construction.
//
// Process-wide sentinel: two standalone copies meeting in one process
// would hold separate component stacks — a child constructed through
// one copy could never see a parent pushed through the other, so
// context and error boundaries would silently break. Loading a second
// copy therefore rejects LOUDLY with instructions.

import { __batch, __state, __computed, __effect, __ownerFrame, __pushOwner, __popOwner, __detachRef } from './reactive.js';

const __RIP_COMPONENTS_SENTINEL = Symbol.for('rip.runtime.components');
if (globalThis[__RIP_COMPONENTS_SENTINEL]) {
  throw new Error(
    'two copies of the Rip component runtime loaded in one process — components from different ' +
    'copies cannot see each other (separate component stacks: context, parent chains, and error ' +
    'boundaries silently break across copies). Run .rip sources through the rip CLI/loader (one ' +
    'shared runtime module per process), or load only one standalone-compiled file per process.',
  );
}
globalThis[__RIP_COMPONENTS_SENTINEL] = true;

let __currentComponent = null;
const __GATE_CONSTRUCTION_BRAND = {};
let __pendingGateConstruction = null;
const __gateMetadata = new WeakMap();
let __gateConstructorClaimed = false;

// Process-wide HMR registry: compiler-emitted __hmrId → living definition
// and instances. Entries exist only when a constructor carries __hmrId.
const __hmrRegistry = new Map();

function __hmrSameNames(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function __hmrLookup(id) {
  return __hmrRegistry.get(id);
}

function __hmrEntries() {
  return [...__hmrRegistry.entries()];
}

function __hmrRegisterDefinition(ctor) {
  const id = ctor?.__hmrId;
  if (typeof id !== 'string' || !id) return undefined;
  let entry = __hmrRegistry.get(id);
  if (!entry) {
    entry = { definition: ctor, instances: new Set() };
    __hmrRegistry.set(id, entry);
  } else {
    entry.definition = ctor;
  }
  return entry;
}

function __hmrRegisterInstance(instance) {
  const id = instance?.constructor?.__hmrId;
  if (typeof id !== 'string' || !id) return;
  const entry = __hmrRegisterDefinition(instance.constructor);
  entry.instances.add(instance);
}

function __hmrUnregisterInstance(instance) {
  const id = instance?.constructor?.__hmrId;
  if (typeof id !== 'string' || !id) return;
  const entry = __hmrRegistry.get(id);
  if (!entry) return;
  entry.instances.delete(instance);
}

// Signature tiers from compiler-emitted __hmrSig arrays (never from
// scanning generated method tables).
function __hmrClassify(oldCtor, newCtor) {
  const a = oldCtor?.__hmrSig;
  const b = newCtor?.__hmrSig;
  if (!a || !b) return 'remount';
  if (!__hmrSameNames(a.props, b.props) || a.gates !== b.gates || a.extends !== b.extends) {
    return 'remount';
  }
  if (!__hmrSameNames(a.state, b.state) || !__hmrSameNames(a.computed, b.computed)) {
    return 'migrate';
  }
  return 'patch';
}

// Named-state migrate diff — kept / added / removed (orphaned) slots.
function __hmrMigrateDiff(oldSig, newSig) {
  const prev = Array.isArray(oldSig?.state) ? oldSig.state : [];
  const next = Array.isArray(newSig?.state) ? newSig.state : [];
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const kept = next.filter(name => prevSet.has(name));
  const added = next.filter(name => !prevSet.has(name));
  const removed = prev.filter(name => !nextSet.has(name));
  return { kept, added, removed };
}

// Thin HMR tooling seam: CustomEvent on window + a ring buffer tests can
// read. Never required for correctness.
const __hmrEventLog = [];
const __HMR_EVENT_CAP = 64;

function __hmrEmit(type, detail = {}) {
  const event = { type, at: Date.now(), ...detail };
  __hmrEventLog.push(event);
  if (__hmrEventLog.length > __HMR_EVENT_CAP) __hmrEventLog.shift();
  // Event log + rip:hmr CustomEvent are the seams. No console traffic —
  // suite runs and headless boots must stay quiet; tooling reads __hmrEvents.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('rip:hmr', { detail: event }));
    } catch { /* non-DOM hosts */ }
  }
  return event;
}

function __hmrEvents() {
  return __hmrEventLog.slice();
}

function __hmrPreserveState(oldInstance, newInstance) {
  const oldSig = oldInstance?.constructor?.__hmrSig;
  const newSig = newInstance?.constructor?.__hmrSig;
  const retained = oldSig?.state;
  const nextNames = newSig?.state;
  const diff = __hmrMigrateDiff(oldSig, newSig);
  if (!Array.isArray(retained) || !Array.isArray(nextNames)) {
    __hmrEmit('migrate', { id: newInstance?.constructor?.__hmrId ?? null, ...diff, copied: [] });
    return diff;
  }
  const keep = new Set(retained);
  const copied = [];
  for (const name of nextNames) {
    if (!keep.has(name)) continue;
    const prev = oldInstance[name];
    const next = newInstance[name];
    if (
      prev != null && next != null &&
      typeof prev === 'object' && typeof next === 'object' &&
      'value' in prev && 'value' in next
    ) {
      next.value = prev.value;
      copied.push(name);
    }
  }
  const id = newInstance?.constructor?.__hmrId ?? oldInstance?.constructor?.__hmrId ?? null;
  __hmrEmit('migrate', { id, ...diff, copied });
  return { ...diff, copied };
}

// Focus survives a refresh by LOCATOR, never by node identity: the
// refresh replaces the focused element, so the snapshot records how to
// find its successor in the rebuilt tree — the element's id when it has
// one, else its element path down from document.body — together with
// the identity the successor must carry (tag, name, type, placeholder,
// aria-label, and the value the focused element held). Identity is what
// keeps a restore from landing on a different field of the same kind
// when the edit inserted or removed an element ahead of the focused one.
const __HMR_IDENTITY_PROPS = ['name', 'type', 'placeholder'];

function __hmrIdentityOf(el) {
  const prop = (key) => (typeof el[key] === 'string' && el[key] ? el[key] : null);
  const identity = { tag: el.tagName ?? null };
  for (const key of __HMR_IDENTITY_PROPS) identity[key] = prop(key);
  identity.label = typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : null;
  identity.value = typeof el.value === 'string' ? el.value : null;
  return identity;
}

function __hmrSameIdentity(el, identity, withValue) {
  if (!el || !identity) return false;
  const candidate = __hmrIdentityOf(el);
  for (const key of ['tag', ...__HMR_IDENTITY_PROPS, 'label']) {
    if (candidate[key] !== identity[key]) return false;
  }
  return !withValue || identity.value == null || candidate.value === identity.value;
}

function __hmrLocateActive(el) {
  const identity = __hmrIdentityOf(el);
  const id = typeof el.id === 'string' && el.id ? el.id : null;
  const path = [];
  let node = el;
  while (node && node !== document.body) {
    const parent = node.parentElement ?? node.parentNode ?? null;
    if (!parent || !parent.children) return { identity, id, path: null };
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return { identity, id, path: node === document.body ? path : null };
}

// The successor: the still-connected element itself; else the element
// with the same id when it carries the same identity; else the element
// at the recorded path when it carries the same identity and value; else
// the one sibling at that level that does — and nothing when that is
// ambiguous, because a wrong field is worse than a lost caret.
function __hmrResolveActive(snap) {
  const el = snap.active;
  if (el && el.isConnected !== false && typeof document.contains === 'function' && document.contains(el)) return el;
  const locator = snap.locator;
  if (!locator) return null;
  if (locator.id && typeof document.getElementById === 'function') {
    const byId = document.getElementById(locator.id);
    if (__hmrSameIdentity(byId, locator.identity, false)) return byId;
  }
  if (!Array.isArray(locator.path) || locator.path.length === 0) return null;
  let parent = document.body;
  for (const index of locator.path.slice(0, -1)) {
    parent = parent?.children?.[index] ?? null;
    if (!parent) return null;
  }
  const siblings = Array.from(parent.children ?? []);
  const atPath = siblings[locator.path[locator.path.length - 1]] ?? null;
  if (__hmrSameIdentity(atPath, locator.identity, true)) return atPath;
  const matching = siblings.filter((node) => __hmrSameIdentity(node, locator.identity, true));
  return matching.length === 1 ? matching[0] : null;
}

function __hmrSnapshotUi() {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  const focused = active && active !== document.body && active !== document.documentElement ? active : null;
  let selection = null;
  if (focused && typeof focused.selectionStart === 'number') {
    selection = { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection };
  }
  return {
    active: focused,
    locator: focused ? __hmrLocateActive(focused) : null,
    selection,
    scrollX: typeof window !== 'undefined' ? window.scrollX : 0,
    scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
  };
}

function __hmrRestoreUi(snap) {
  if (!snap || typeof document === 'undefined') return;
  if (typeof window !== 'undefined') window.scrollTo(snap.scrollX ?? 0, snap.scrollY ?? 0);
  const el = __hmrResolveActive(snap);
  if (!el || typeof el.focus !== 'function') return;
  try {
    // The scroll position was just restored; focusing must not move it.
    el.focus({ preventScroll: true });
    if (snap.selection && typeof el.setSelectionRange === 'function') {
      el.setSelectionRange(snap.selection.start, snap.selection.end, snap.selection.direction ?? 'none');
    }
  } catch { /* focus/selection can reject on non-focusable nodes */ }
}

function __hmrPatch(instance, NewCtor) {
  if (!instance || !NewCtor) {
    throw new Error('__hmrPatch requires a living instance and a replacement constructor');
  }
  const oldId = instance.constructor?.__hmrId;
  if (typeof oldId === 'string' && oldId) {
    __hmrRegistry.get(oldId)?.instances.delete(instance);
  }
  Object.setPrototypeOf(instance, NewCtor.prototype);
  Object.defineProperty(instance, 'constructor', {
    value: NewCtor, writable: true, configurable: true,
  });
  __hmrRegisterDefinition(NewCtor);
  __hmrRegistry.get(NewCtor.__hmrId)?.instances.add(instance);
  instance._hmrRerender();
  __hmrEmit('patch', { id: NewCtor.__hmrId ?? oldId ?? null });
  return instance;
}

// Migrate keeps intersecting state on a fresh instance; the app layer
// remounts that instance into the tree (replace the dirty subtree).
function __hmrMigrateRemount(oldInstance, NewCtor, props = {}) {
  const next = new NewCtor(props);
  __hmrPreserveState(oldInstance, next);
  return next;
}

// The private app renderer claims the construction capability exactly
// once at module initialization. The compiler never delivers this name,
// and no supported package surface re-exports the returned closure.
function __claimGateConstructor() {
  if (__gateConstructorClaimed) {
    throw new Error('[Rip] the render-gate construction capability is already claimed');
  }
  __gateConstructorClaimed = true;
  return (Component, metadata) => {
    const previous = __pendingGateConstruction;
    __pendingGateConstruction = {
      brand: __GATE_CONSTRUCTION_BRAND,
      component: Component,
      gates: metadata.gates,
      parent: metadata.parent ?? null,
      // Route fields the emitter lowers to `this.stash` / `this.router` /
      // `this.params` / `this.query` — assigned in the constructor
      // before `_init`, so member initializers can read them. This name
      // set is co-owned by AMBIENT_FIELDS in src/ts/components.js: the
      // face declares what is injected here, and a name added on one
      // side alone desyncs the type surface from the runtime.
      stash: metadata.stash ?? null,
      router: metadata.router ?? null,
      used: false,
    };
    try {
      return new Component({});
    } finally {
      __pendingGateConstruction = previous;
    }
  };
}

// Remove a node from the DOM, tolerant of what it actually is. A
// DocumentFragment (a multi-root component's _root) is skipped: it is
// emptied the moment it is inserted, so it owns nothing to remove —
// its real top-level nodes are tracked on the component instance
// (_nodes) and removed there. A detached node (parentNode null) is a
// harmless no-op.
function __detach(node) {
  if (!node || node.nodeType === 11) return;
  if (typeof node.remove === 'function') node.remove();
  else if (node.parentNode) node.parentNode.removeChild(node);
}

function __pushComponent(component) {
  // The component stack tracks the currently-active scope. Parent
  // assignment happens ONCE — on the first push that has a non-self
  // predecessor. Later pushes (mount, hooks, factory re-entry)
  // preserve the existing chain: without the set-once guard, a
  // re-push with no enclosing component would overwrite the
  // construction-time parent and silently break cross-layer context.
  const prev = __currentComponent;
  if (component && component._parent == null && prev && prev !== component) {
    component._parent = prev;
  }
  __currentComponent = component;
  return prev;
}

function __popComponent(prev) {
  __currentComponent = prev;
}

function setContext(key, value) {
  if (!__currentComponent) throw new Error('setContext must be called during component initialization');
  if (!__currentComponent._context) __currentComponent._context = new Map();
  __currentComponent._context.set(key, value);
}

// The context read is LOUD on a miss: the miss is
// detectable right here, and returning undefined manufactures a
// distant `.value` TypeError (or a silently rendered undefined) at
// the consumer. hasContext is the optional-use probe. The value
// comes back AS ITS CONTAINER — the signal a reactive member offered,
// the plain value a readonly offered — the accept container contract.
function getContext(key) {
  let component = __currentComponent;
  // Cycle guard: a corrupted _parent chain must not hang the lookup.
  const visited = new Set();
  while (component && !visited.has(component)) {
    visited.add(component);
    if (component._context && component._context.has(key)) return component._context.get(key);
    component = component._parent;
  }
  throw new Error(
    `getContext: no provider for context ${JSON.stringify(key)} in this component's parent chain — ` +
    'offer it from an ancestor, or probe with hasContext(key) where absence is legal',
  );
}

function hasContext(key) {
  let component = __currentComponent;
  const visited = new Set();
  while (component && !visited.has(component)) {
    visited.add(component);
    if (component._context && component._context.has(key)) return true;
    component = component._parent;
  }
  return false;
}

function __clsx(...args) {
  let out = '';
  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === 'string') { out && (out += ' '); out += arg; }
    else if (typeof arg === 'object') {
      if (Array.isArray(arg)) { const v = __clsx(...arg); v && (out && (out += ' '), out += v); }
      else for (const k in arg) if (arg[k]) { out && (out += ' '); out += k; }
    }
  }
  return out;
}

function __lis(arr) {
  const n = arr.length;
  if (n === 0) return [];
  const tails = [], indices = [], prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (arr[i] === -1) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < arr[i]) lo = mid + 1; else hi = mid;
    }
    tails[lo] = arr[i];
    indices[lo] = i;
    if (lo > 0) prev[i] = indices[lo - 1];
  }
  const result = [];
  let k = indices[tails.length - 1];
  for (let i = tails.length - 1; i >= 0; i--) { result.push(k); k = prev[k]; }
  result.reverse();
  return result;
}

function __reconcile(anchor, state, items, ctx, factory, keyFn, ...outer) {
  const parent = anchor.parentNode;
  if (!parent) return;

  const oldKeys = state.keys;
  const oldItems = state.items || [];
  const oldBlocks = state.blocks;
  const oldLen = oldKeys.length;
  const newLen = items.length;
  const newBlocks = new Array(newLen);
  const hasKeyFn = keyFn != null;
  const newKeys = hasKeyFn ? items.map((item, i) => keyFn(item, i)) : items;

  // Explicit keys are row identities: two rows sharing one is a
  // contradiction the reconciler cannot honor (which block is whose?)
  // — reject loudly rather than corrupt (the runtime
  // half: the plain key map silently overwrites, stranding the
  // overwritten block in the DOM). Identity keying (keyFn null) is
  // exempt: equal items ARE legal duplicate rows, handled by the
  // phase-4 index queues below.
  if (hasKeyFn) {
    const seen = new Set();
    for (const k of newKeys) {
      if (seen.has(k)) {
        throw new Error(
          `__reconcile: duplicate key ${JSON.stringify(String(k))} — keyed rows need unique keys ` +
          '(the key function must be injective over the items)',
        );
      }
      seen.add(k);
    }
  }

  // Phase 0: first render — batch create via DocumentFragment
  if (oldLen === 0) {
    if (newLen > 0) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < newLen; i++) {
        const block = factory(ctx, items[i], i, ...outer);
        block.c();
        block.m(frag, null);
        if (!block._s) block.p(ctx, items[i], i, ...outer);
        newBlocks[i] = block;
      }
      parent.insertBefore(frag, anchor);
    }
    state.keys = hasKeyFn ? newKeys : items.slice();
    state.items = items.slice();
    state.blocks = newBlocks;
    return;
  }

  // Phase 1: prefix scan — skip p() ONLY when key AND item identity
  // match. With a custom keyFn, a stable key can be reused across
  // different item references (the user replaced an item object with
  // a same-id, different-fields one); skipping p() there would leave
  // the block displaying stale data. Reference identity guards this.
  let start = 0;
  const minLen = oldLen < newLen ? oldLen : newLen;
  while (start < minLen && oldKeys[start] === newKeys[start]) {
    if (oldItems[start] !== items[start]) {
      const block = oldBlocks[start];
      if (!block._s) block.p(ctx, items[start], start, ...outer);
    }
    newBlocks[start] = oldBlocks[start];
    start++;
  }

  // Phase 2: suffix scan — call p() (index may differ)
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  while (oldEnd >= start && newEnd >= start && oldKeys[oldEnd] === newKeys[newEnd]) {
    const block = oldBlocks[oldEnd];
    if (!block._s) block.p(ctx, items[newEnd], newEnd, ...outer);
    newBlocks[newEnd] = block;
    oldEnd--;
    newEnd--;
  }

  // Remove old blocks in the middle that aren't in the new set
  if (start > newEnd) {
    for (let i = start; i <= oldEnd; i++) oldBlocks[i].d(true);
  } else if (start > oldEnd) {
    // Phase 3a: pure insertion — batch via DocumentFragment
    const next = newEnd + 1 < newLen ? newBlocks[newEnd + 1]._first : anchor;
    const frag = document.createDocumentFragment();
    for (let i = start; i <= newEnd; i++) {
      const block = factory(ctx, items[i], i, ...outer);
      block.c();
      block.m(frag, null);
      if (!block._s) block.p(ctx, items[i], i, ...outer);
      newBlocks[i] = block;
    }
    parent.insertBefore(frag, next);
  } else {
    // Phase 4: general case — temp map + LIS. Each key holds its
    // index QUEUE: identity keying admits duplicate keys (equal items
    // are distinct rows), and a plain map would overwrite — the
    // overwritten block neither reused nor destroyed, a stale node
    // stranded in the DOM. Queued, every old block is reused at most
    // once and the leftovers destroy.
    const oldKeyIdx = new Map();
    for (let i = start; i <= oldEnd; i++) {
      const k = oldKeys[i];
      const q = oldKeyIdx.get(k);
      if (q) q.push(i); else oldKeyIdx.set(k, [i]);
    }

    const seq = new Array(newEnd - start + 1);
    for (let i = start; i <= newEnd; i++) {
      const key = newKeys[i];
      const q = oldKeyIdx.get(key);
      if (q && q.length) {
        const oldIdx = q.shift();
        if (q.length === 0) oldKeyIdx.delete(key);
        seq[i - start] = oldIdx - start;
        const block = oldBlocks[oldIdx];
        if (!block._s) block.p(ctx, items[i], i, ...outer);
        newBlocks[i] = block;
      } else {
        seq[i - start] = -1;
        const block = factory(ctx, items[i], i, ...outer);
        block.c();
        if (!block._s) block.p(ctx, items[i], i, ...outer);
        newBlocks[i] = block;
      }
    }

    for (const q of oldKeyIdx.values()) {
      for (const idx of q) oldBlocks[idx].d(true);
    }

    const lis = __lis(seq);
    const lisSet = new Set(lis);
    let next = newEnd + 1 < newLen ? newBlocks[newEnd + 1]._first : anchor;
    for (let i = newEnd; i >= start; i--) {
      const block = newBlocks[i];
      if (!lisSet.has(i - start)) {
        block.m(parent, next);
      }
      next = block._first;
    }
  }

  state.keys = hasKeyFn ? newKeys : items.slice();
  state.items = items.slice();
  state.blocks = newBlocks;
}

let __cssInjected = false;
function __transitionCSS() {
  if (__cssInjected) return;
  __cssInjected = true;
  const s = document.createElement('style');
  s.textContent = [
    '.fade-enter-active,.fade-leave-active{transition:opacity .2s ease}',
    '.fade-enter-from,.fade-leave-to{opacity:0}',
    '.slide-enter-active,.slide-leave-active{transition:opacity .2s ease,transform .2s ease}',
    '.slide-enter-from{opacity:0;transform:translateY(-8px)}',
    '.slide-leave-to{opacity:0;transform:translateY(8px)}',
    '.scale-enter-active,.scale-leave-active{transition:opacity .2s ease,transform .2s ease}',
    '.scale-enter-from,.scale-leave-to{opacity:0;transform:scale(.95)}',
    '.blur-enter-active,.blur-leave-active{transition:opacity .2s ease,filter .2s ease}',
    '.blur-enter-from,.blur-leave-to{opacity:0;filter:blur(4px)}',
    '.fly-enter-active,.fly-leave-active{transition:opacity .2s ease,transform .2s ease}',
    '.fly-enter-from{opacity:0;transform:translateY(-20px)}',
    '.fly-leave-to{opacity:0;transform:translateY(20px)}',
  ].join('');
  document.head.appendChild(s);
}

function __transition(el, name, dir, done) {
  __transitionCSS();
  const cl = el.classList;
  const from = name + '-' + dir + '-from';
  const active = name + '-' + dir + '-active';
  const to = name + '-' + dir + '-to';
  let completed = false;
  let timer = null;
  cl.add(from, active);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cl.remove(from);
      cl.add(to);
      const end = (event) => {
        if (completed || (event && event.target !== el)) return;
        completed = true;
        clearTimeout(timer);
        el.removeEventListener('transitionend', end);
        el.removeEventListener('transitioncancel', end);
        cl.remove(active, to);
        if (done) done();
      };
      el.addEventListener('transitionend', end);
      // An interrupted transition fires transitioncancel, never
      // transitionend — without this, the leaving node strands in the
      // DOM and the listener leaks.
      el.addEventListener('transitioncancel', end);
      // And a name with no matching CSS fires neither: complete on a
      // computed-duration fallback (50ms grace past the longest
      // duration+delay; zero when styles are unreadable or absent).
      let ms = 0;
      try {
        const cs = getComputedStyle(el);
        const longest = (v) => Math.max(0, ...String(v).split(',')
          .map((s) => (parseFloat(s) || 0) * (/ms\s*$/.test(s.trim()) ? 1 : 1000)));
        ms = longest(cs.transitionDuration) + longest(cs.transitionDelay);
      } catch {}
      timer = setTimeout(() => end(), ms + 50);
    });
  });
}

// The failure ENVELOPE a boundary receives: `name`, `message`, and the
// raw thrown value always; `status` when the throw carried one; the
// route fields only when the route layer filled them (a GateFailure
// passes through untouched — it already is the richer envelope).
// Co-owned with COMPONENT_FAILURE_TYPE in src/ts/components.js: the
// face declares exactly what this wrapper delivers.
function __componentFailure(error) {
  const name = error != null && typeof error === 'object' ? error.name : null;
  if (name === 'GateFailure' || name === 'ComponentFailure') return error;
  const failure = new Error(error != null && error.message !== undefined ? error.message : String(error));
  failure.name = 'ComponentFailure';
  const status = error != null ? (error.status ?? error.response?.status) : undefined;
  if (status !== undefined) failure.status = status;
  failure.error = error;
  return failure;
}

function __handleComponentError(error, component) {
  const failure = __componentFailure(error);
  let current = component;
  // Cycle guard: a corrupted _parent chain must not hang the walk.
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current.onError) {
      const prevC = __pushComponent(current);
      const prevO = __pushOwner(current._frame);
      try {
        current.onError(failure, component);
        return;
      } catch (_) {
        // A throwing boundary declines this error; continue at its parent
        // with the original failure after restoring both ownership stacks.
      } finally {
        __popOwner(prevO);
        __popComponent(prevC);
      }
    }
    current = current._parent;
  }
  throw error;
}

// The declared-props contract: a class states its
// prop names (`static __props`, generated by the component
// declaration's member model); the constructor validates every
// incoming key against that set and rejects unknowns loudly. The
// declared list itself validates ONCE per class: an
// underscore-prefixed name would collide with instance internals
// (_children, _parent, _frame, …) and a name the prototype chain
// already answers (mount, unmount, emit, _init, a user method) would
// shadow machinery — both reject at first construction, naming the
// class and the name.
const __validatedProps = new WeakSet();
function __checkDeclaredProps(ctor, instance) {
  if (__validatedProps.has(ctor)) return;
  const declared = ctor.__props ?? [];
  if (!Array.isArray(declared)) {
    throw new Error(`${ctor.name || 'component'}: static __props must be an array of declared prop names`);
  }
  for (const name of declared) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${ctor.name || 'component'}: static __props entries must be non-empty strings`);
    }
    if (name.startsWith('_')) {
      throw new Error(
        `${ctor.name || 'component'}: declared prop '${name}' collides with component internals — ` +
        'underscore-prefixed names are reserved for the runtime',
      );
    }
    if (name in instance) {
      throw new Error(
        `${ctor.name || 'component'}: declared prop '${name}' collides with a component member ` +
        `(a method or lifecycle slot already answers '${name}')`,
      );
    }
  }
  __validatedProps.add(ctor);
}

// A gate is a computed container over route-prefetched app data. It
// retains the last non-null value for the mounted instance: a source
// reset invalidates ordinary stash readers without tearing loaded data
// out from under an already-constructed route component.
function __gateBind(self, index) {
  const metadata = __gateMetadata.get(self);
  const binding = metadata?.gates?.[index];
  if (!binding?.cell) {
    throw new Error(
      `[Rip] render gate ${index} has no renderer-resolved source binding — ` +
      'gated components may only be constructed by rip/app createRenderer()',
    );
  }
  let last = binding.value;
  let prefetched = true;
  return __computed(() => {
    if (prefetched) {
      prefetched = false;
      // Track the source cell without traversing the addressed tail a
      // second time: the renderer already validated/captured that value.
      binding.cell.read();
      return last;
    }
    let value = binding.cell.read();
    for (const segment of binding.tail) {
      if (value == null) break;
      value = value[segment];
    }
    if (value != null) last = value;
    return last;
  });
}

// Last-applied style-object keys per element (the replacement diff).
const __styleKeys = new WeakMap();

class __Component {
  constructor(props = {}) {
    this._state = 'new';
    // Validate BEFORE any injection: the ambient assignments below put
    // `app`/`router`/`params`/`query` on the instance, and a declared
    // prop of the same name is supported shadowing (the emitter and
    // the type face both spell it) — checked after injection, the
    // verdict depended on whether the first-constructed instance
    // happened to carry the ambients.
    __checkDeclaredProps(this.constructor, this);
    const gates = this.constructor.__gates;
    const mount = __pendingGateConstruction;
    const rendererAuthorized =
      mount?.brand === __GATE_CONSTRUCTION_BRAND &&
      mount.component === this.constructor &&
      mount.used !== true;
    if (rendererAuthorized) mount.used = true;
    if (gates?.length && !rendererAuthorized) {
      throw new Error(
        '[Rip] component declares render gates (<~) and cannot be constructed directly or as an ' +
        'embedded child; render gates are honored only by rip/app createRenderer()',
      );
    }
    if (rendererAuthorized) {
      __gateMetadata.set(this, mount);
      if (mount.parent) this._parent = mount.parent;
      // Inject before `_init`: gated/route members read `@stash`,
      // `@router`, `@params`, and `@query` during construction.
      if (mount.stash != null) this.stash = mount.stash;
      if (mount.router != null) {
        this.router = mount.router;
        Object.defineProperty(this, 'params', {
          get: () => mount.router.params,
          configurable: true,
        });
        Object.defineProperty(this, 'query', {
          get: () => mount.router.query,
          configurable: true,
        });
      }
    }
    // Ambience: `@stash` and `@router` are how everything works, so every
    // component reaches them by default. Route-chain components got the
    // renderer's injection above; everything else falls back to the
    // live launch globals. `@params`/`@query` stay route-only — they
    // are navigation state, not app state.
    if (this.stash == null && globalThis.__ripStash != null) this.stash = globalThis.__ripStash;
    if (this.router == null && globalThis.__ripRouter != null) this.router = globalThis.__ripRouter;
    const declared = this.constructor.__props ?? [];
    const extendsTag = this.constructor.__extends ?? null;
    let rest = null;
    for (const key of Object.keys(props)) {
      // `children` is the projection channel (the parent's emission
      // passes the built child DOM; `slot` reads it) — always legal.
      if (key === 'children') continue;
      // `__bind_x__` carries the shared container the `<=>` channel
      // passes for a DECLARED prop x (_init reads props.__bind_x__
      // first). An unknown bind name is loud even under `extends`:
      // __bind_ keys never ride rest.
      if (key.startsWith('__bind_') && key.endsWith('__')) {
        const bound = key.slice(7, -2);
        if (declared.includes(bound)) continue;
        throw new Error(
          `${this.constructor.name || 'component'}: cannot bind unknown prop '${bound}' — declared ` +
          `props are [${declared.join(', ')}]`,
        );
      }
      if (declared.includes(key)) continue;
      // Under `extends <tag>` an undeclared prop is a REST prop — it
      // forwards onto the inherited element (the declared-props seam
      // extended, per the runtime seam).
      if (extendsTag !== null) {
        (rest ??= {})[key] = props[key];
        continue;
      }
      throw new Error(
        `${this.constructor.name || 'component'}: unknown prop '${key}' — declared props are ` +
        `[${declared.join(', ')}]`,
      );
    }
    if ('children' in props) this.children = props.children;
    if (extendsTag !== null) {
      // The reactive rest view: reads (`@rest.disabled`) track through
      // `this.rest.value`; `_setRestProp` mutates and touches. Set
      // BEFORE _init so member initializers and effects can read it.
      this._rest = rest ?? {};
      this.rest = __state(this._rest);
    }
    // The instance's owner frame: NON-nested (cross-component
    // teardown is the _children cascade, never frame nesting), alive
    // from _init through unmount. Every __effect created inside
    // _init / _create / _setup / hooks registers its disposer here.
    this._frame = __ownerFrame({ nested: false });
    const prevC = __pushComponent(this);
    const prevO = __pushOwner(this._frame);
    try {
      this._init(props);
    } catch (e) {
      __popOwner(prevO);
      __popComponent(prevC);
      this._teardown({ state: 'failed', hooks: false, removeDOM: true });
      this._initFailed = true;
      __handleComponentError(e, this);
      return;
    }
    __popOwner(prevO);
    __popComponent(prevC);
    if (this.constructor.__hmrId) __hmrRegisterInstance(this);
  }
  // The base no-op takes the props the constructor passes (the
  // subclass override's signature — the face annotates it, and an
  // argument-less base would make every override an invalid
  // override, TS2416).
  _init(props) {}
  // The first-class prop updater: the child
  // emission's prop-updater effects call this instead of guessing at
  // member shapes. A signal-shaped member takes the .value write; a
  // non-reactive member is a declaration-level fact the parent's
  // update can never reach — loud, naming the fix. Rest routing under
  // `extends` extends this seam.
  _updateProp(name, value) {
    if (this._state === 'failed' || this._state === 'unmounted') return;
    const declared = this.constructor.__props ?? [];
    if (!declared.includes(name)) {
      // Rest routing under `extends`: an undeclared prop's updates
      // forward onto the inherited element through the same seam
      // (the emitted updater guesses at `_setRestProp` presence;
      // here the routing is the declaration-level fact).
      if (this.constructor.__extends) {
        this._setRestProp(name, value);
        return;
      }
      throw new Error(
        `${this.constructor.name || 'component'}: cannot update unknown prop '${name}' — declared ` +
        `props are [${declared.join(', ')}]`,
      );
    }
    const member = this[name];
    if (member && typeof member === 'object' && 'value' in member) {
      member.value = value;
      return;
    }
    throw new Error(
      `${this.constructor.name || 'component'}: prop '${name}' is non-reactive — parent updates ` +
      `cannot reach it (declare it with ':=' to receive updates)`,
    );
  }
  // The `extends <tag>` rest machinery (generated output spells these
  // into every extends class; here they are the runtime's — the
  // emitted class carries only `static __extends` and the
  // `_inheritedEl` binding lines in _create). Bodies keep the fixed
  // application forks; the container cell is fixed at this root
  _setRestProp(key, value) {
    if (key.startsWith('__bind_')) return;
    if (this._state === 'failed' || this._state === 'unmounted') return;
    this._rest || (this._rest = {});
    if (value == null) delete this._rest[key];
    else this._rest[key] = value;
    this.rest.touch();
    // The application runs under THIS instance's frame regardless of
    // the call path: an UPDATE-path call arrives from the parent's
    // updater effect with the PARENT's frame current, and a container
    // writer registered there would outlive the child and accumulate
    // one disposer per update on a long-lived parent. The push makes writer ownership a fact of the
    // instance, not of the caller.
    const tok = __pushOwner(this._frame);
    try {
      this._applyInheritedProp(this._inheritedEl, key, value);
    } finally { __popOwner(tok); }
  }
  _applyRestToInheritedEl() {
    if (this._state === 'failed' || this._state === 'unmounted') return;
    if (!this._inheritedEl || !this._rest) return;
    for (const key in this._rest) this._applyInheritedProp(this._inheritedEl, key, this._rest[key]);
  }
  _applyInheritedProp(el, key, value) {
    if (this._state === 'failed' || this._state === 'unmounted') return;
    if (!el || key === 'key' || key === 'ref' || key === 'children' || key.startsWith('__bind_')) return;
    // Each key holds at most ONE live writer: overwriting or deleting
    // a rest key disposes the previous container writer FIRST — and
    // removes its dead disposer from the instance frame's list, so a
    // hot prop stays FLAT instead of growing one entry per update —
    // so a replaced or removed key's old container can never re-apply
    // (without the disposal, `_updateProp('disabled', null)` deletes
    // the rest key and a later write to the old container resurrects
    // the attribute).
    const prevWriter = this._restWriters?.[key];
    if (prevWriter) {
      prevWriter();
      if (this._frame) this._frame.remove(prevWriter);
      delete this._restWriters[key];
    }
    // A shared CONTAINER in rest (a bare reactive member at the call
    // site, the #135 sharing rule over an undeclared prop): apply its
    // LIVE value through an effect owned by THIS instance's frame on
    // every path — _create runs under the child protocol's push,
    // _setRestProp pushes it around this call — so the writer dies on
    // the CHILD's unmount, never the caller's; its disposer joins the
    // per-key writer map above. Assigning the raw signal object to
    // the DOM property would drop every later update — a reactive
    // value forwards through an effect, never by reference.
    if (value != null && typeof value === 'object' && typeof value.read === 'function') {
      (this._restWriters ??= {})[key] = __effect(() => { this._applyPlainInheritedProp(el, key, value.value); });
      return;
    }
    this._applyPlainInheritedProp(el, key, value);
  }
  _applyPlainInheritedProp(el, key, value) {
    if (key[0] === '@') {
      const event = key.slice(1).split('.')[0];
      this._restHandlers || (this._restHandlers = {});
      const prev = this._restHandlers[key];
      if (prev) el.removeEventListener(event, prev);
      if (typeof value === 'function') {
        const next = (e) => __batch(() => value(e));
        this._restHandlers[key] = next;
        el.addEventListener(event, next);
      } else {
        delete this._restHandlers[key];
      }
      return;
    }
    if (key === 'class' || key === 'className') {
      if (el instanceof SVGElement) el.setAttribute('class', __clsx(value));
      else el.className = __clsx(value);
      return;
    }
    if (key === 'style') {
      // Replacing a style OBJECT clears the keys the new value omits —
      // an assign alone leaves the old declarations active. The keys
      // applied last are remembered per element.
      const prevKeys = __styleKeys.get(el);
      if (value == null) { el.removeAttribute('style'); __styleKeys.delete(el); return; }
      if (typeof value === 'string') { el.setAttribute('style', value); __styleKeys.delete(el); return; }
      if (typeof value === 'object') {
        if (prevKeys) for (const k of prevKeys) { if (!(k in value)) el.style[k] = ''; }
        __styleKeys.set(el, Object.keys(value));
        Object.assign(el.style, value);
        return;
      }
    }
    if (key === 'innerHTML' || key === 'textContent' || key === 'innerText') {
      el[key] = value ?? '';
      return;
    }
    if (key in el && !key.includes('-')) {
      el[key] = value;
      return;
    }
    if (value == null || value === false) {
      el.removeAttribute(key);
      return;
    }
    if (value === true) {
      el.setAttribute(key, '');
      return;
    }
    el.setAttribute(key, value);
  }
  _beginMount() {
    if (this._state === 'new') {
      this._state = 'mounting';
      return;
    }
    const name = this.constructor.name || 'component';
    if (this._state === 'mounting') {
      throw new Error(`${name}: cannot mount an instance whose mount is already in progress`);
    }
    if (this._state === 'mounted') {
      throw new Error(`${name}: cannot mount an already-mounted instance — construct a new instance for another target`);
    }
    if (this._state === 'failed') {
      throw new Error(`${name}: cannot mount a failed instance — its mount rolled back; construct a new instance`);
    }
    throw new Error(
      `${name}: cannot mount an unmounted instance — its effects were disposed on unmount; construct a new instance`,
    );
  }
  _mountCreate() {
    this._beginMount();
    const prevC = __pushComponent(this);
    const prevO = __pushOwner(this._frame);
    let failure = null;
    let failed = false;
    try {
      this._root = this._create();
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      __popOwner(prevO);
      __popComponent(prevC);
    }
    if (failed) {
      this._failMount(failure);
      return false;
    }
    return true;
  }
  _mountSetup(failurePlaceholder = null) {
    if (this._state !== 'mounting') return this._nodes?.[0] ?? this._root;
    const prevC = __pushComponent(this);
    const prevO = __pushOwner(this._frame);
    let failure = null;
    let failed = false;
    try {
      if (failurePlaceholder) {
        const first = this._nodes?.[0] ?? this._root;
        if (first?.parentNode) first.parentNode.insertBefore(failurePlaceholder, first);
      }
      if (this.beforeMount) this.beforeMount();
      if (this._setup) this._setup();
      if (this.mounted) this.mounted();
      this._state = 'mounted';
      __detach(failurePlaceholder);
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      __popOwner(prevO);
      __popComponent(prevC);
    }
    if (failed) {
      this._failMount(failure);
      return failurePlaceholder;
    }
    return this._nodes?.[0] ?? this._root;
  }
  _failMount(error) {
    this._teardown({ state: 'failed', hooks: false, removeDOM: true });
    __handleComponentError(error, this);
  }
  // The shared release body — owned children, the owner frame, rest
  // writers/handlers, ref cleanups — used by full teardown and the
  // HMR rebuild alike, so a cleanup step added here reaches both.
  // The differences (state, hooks, HMR unregistration, _target) stay
  // at the call sites; the DOM half is _detachDOM's, because
  // _teardown runs the unmounted hook between the two.
  _dispose(report, unmountChild) {
    if (this._children) {
      for (const child of this._children) {
        try { unmountChild(child); } catch (e) { report('child teardown', e); }
      }
      this._children = null;
    }
    try { this._frame?.dispose(); } catch (e) { report('owner disposal', e); }
    if (this._restWriters) {
      for (const writer of Object.values(this._restWriters)) {
        try { writer(); } catch (e) { report('rest writer cleanup', e); }
      }
      this._restWriters = null;
    }
    if (this._restHandlers) {
      if (this._inheritedEl) {
        for (const [key, handler] of Object.entries(this._restHandlers)) {
          try { this._inheritedEl.removeEventListener(key.slice(1).split('.')[0], handler); }
          catch (e) { report('rest handler cleanup', e); }
        }
      }
      this._restHandlers = null;
    }
    if (this._refCleanups) {
      const cleanups = this._refCleanups;
      this._refCleanups = null;
      try {
        __batch(() => {
          for (const c of cleanups) {
            try { c(); } catch (e) { report('ref cleanup', e); }
          }
        });
      } catch (e) { report('ref cleanup batch flush', e); }
    }
    // Unconditional: a slot the branches above never entered (e.g. a
    // component that minted no cleanups) still reads null afterwards.
    this._children = null;
    this._refCleanups = null;
    this._restWriters = null;
    this._restHandlers = null;
  }
  _detachDOM(report, removeDOM) {
    if (removeDOM) {
      if (this._nodes) {
        for (const n of this._nodes) {
          try { __detach(n); } catch (e) { report('DOM detach', e); }
        }
      } else {
        try { __detach(this._root); } catch (e) { report('DOM detach', e); }
      }
    }
    this._root = null;
    this._nodes = null;
    this._inheritedEl = null;
  }
  _teardown({ state, hooks, removeDOM }) {
    if (this._state === 'failed' || this._state === 'unmounted') return;
    if (this.constructor.__hmrId) __hmrUnregisterInstance(this);
    this._state = state;
    const report = (label, error) => console.error(`[Rip] ${label} error:`, error);
    if (hooks) {
      try {
        if (this.beforeUnmount) this.beforeUnmount();
      } catch (e) { report('beforeUnmount', e); }
    }
    this._dispose(report, (child) => {
      if (hooks) child.unmount({ removeDOM });
      else child._teardown({
        state: child._state === 'mounted' ? 'unmounted' : 'failed',
        hooks: false,
        removeDOM: true,
      });
    });
    if (hooks) {
      try {
        if (this.unmounted) this.unmounted();
      } catch (e) { report('unmounted', e); }
    }
    this._detachDOM(report, removeDOM);
    this._target = null;
  }
  // Patch refresh: dispose owned children and frame effects, keep
  // instance identity and `_init` state, then rebuild DOM via
  // `_create`/`_setup` without re-running `_init`. Emitter-minted
  // `_hmrRefreshComputeds` / `_hmrBindEffects` (hmr builds only)
  // refresh derived closures and recreate body effects on the new
  // owner frame — the silent-wrong-math / dead-effect defect class.
  _hmrRerender() {
    const name = this.constructor.name || 'component';
    if (this._state !== 'mounted') {
      throw new Error(`${name}: _hmrRerender requires a mounted instance`);
    }
    const report = (label, error) => console.error(`[Rip] ${label} error:`, error);
    const target = this._target;
    const nodes = this._nodes;
    const first = nodes?.[0] ?? this._root;
    const insertParent = first?.parentNode ?? null;
    const insertBefore = nodes?.length
      ? nodes[nodes.length - 1].nextSibling
      : (this._root ? this._root.nextSibling : null);

    try {
      if (this.beforeUnmount) this.beforeUnmount();
    } catch (e) { report('beforeUnmount', e); }

    this._dispose(report, (child) => child.unmount({ removeDOM: true }));
    this._detachDOM(report, true);
    this._frame = __ownerFrame({ nested: false });
    this._state = 'new';

    // Mirror constructor `_init` ownership: refresh computeds and
    // rebind body effects under the new owner before `_create`.
    {
      const prevC = __pushComponent(this);
      const prevO = __pushOwner(this._frame);
      try {
        if (typeof this._hmrRefreshComputeds === 'function') this._hmrRefreshComputeds();
        if (typeof this._hmrBindEffects === 'function') this._hmrBindEffects();
      } catch (e) {
        __popOwner(prevO);
        __popComponent(prevC);
        report('hmr rebind', e);
        this._failMount(e);
        return this;
      }
      __popOwner(prevO);
      __popComponent(prevC);
    }

    if (typeof this._create !== 'function') {
      this._state = 'mounted';
      return this;
    }
    if (!this._mountCreate()) return this;

    try {
      // Resolve a CONNECTED parent. `mount()` often records a staging
      // DocumentFragment as `_target`; after the renderer commits that
      // fragment into #content, the fragment is empty and must not be
      // reused — patching into it leaves the UI invisible and the old
      // page slot looking like a remounted empty state.
      let parent = insertParent && insertParent.nodeType !== 11 ? insertParent : null;
      if (parent && parent.isConnected === false) parent = null;
      if (!parent && typeof target === 'string' && typeof document !== 'undefined') {
        parent = document.querySelector(target);
      } else if (!parent && target && target.nodeType !== 11 && target.isConnected !== false) {
        parent = target;
      } else if (!parent && typeof document !== 'undefined') {
        parent = document.querySelector('#content') || document.querySelector('#app');
      }
      if (parent) {
        const before = insertBefore &&
          (typeof parent.contains !== 'function' || parent.contains(insertBefore))
          ? insertBefore
          : null;
        if (this._nodes) {
          for (const n of this._nodes) parent.insertBefore(n, before);
        } else if (this._root) {
          parent.insertBefore(this._root, before);
        }
        this._target = parent.nodeType === 11 ? null : parent;
      }
    } catch (error) {
      this._failMount(error);
      return this;
    }

    this._mountSetup();
    return this;
  }
  mount(target) {
    if (!this._mountCreate()) return this;
    try {
      if (typeof target === 'string') target = document.querySelector(target);
      this._target = target;
      if (this._root) target.appendChild(this._root);
    } catch (error) {
      this._failMount(error);
      return this;
    }
    this._mountSetup();
    return this;
  }
  unmount({ removeDOM = true } = {}) {
    if (this._state === 'failed' || this._state === 'unmounted') return;
    if (this._state === 'mounting') {
      throw new Error(`${this.constructor.name || 'component'}: cannot unmount while mounting`);
    }
    this._teardown({ state: 'unmounted', hooks: this._state === 'mounted', removeDOM });
  }
  // emit dispatches on the live root; outside that window the event
  // could only vanish (no root before mount) or dispatch into a
  // detached tree no listener observes (after unmount) — both reject
  // loudly instead. The window is _root's
  // lifetime, so the child protocol (a parent's create phase sets the
  // child's _root) opens it exactly like a direct mount() does.
  // A multi-root component's _root is the DocumentFragment, emptied
  // the moment it was inserted — dispatching there, bubbles: true
  // reaches nothing. The first tracked node is in the live tree, so
  // both the direct listener (attached there by the parent's create
  // phase) and every ancestor observe the event.
  emit(name, detail) {
    if (this._state !== 'mounted' || !this._root) {
      throw new Error(
        `${this.constructor.name || 'component'}: emit('${name}') outside the mounted window — ` +
        'emit dispatches on the live root; call after mount and before unmount',
      );
    }
    (this._nodes?.[0] ?? this._root).dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }
  static mount(target = 'body') {
    return new this().mount(target);
  }
}

// The owner-seam names re-export here (beside their reactive home):
// the render layer's factory emission spells them in generated component output,
// so they ride the COMPONENTS delivered-name table — the reactive
// table (and every reactive-only program's injected bytes) stays
// untouched.
export {
  __Component, __pushComponent, __popComponent, setContext, getContext, hasContext,
  __clsx, __lis, __reconcile, __transition, __handleComponentError, __gateBind, __detach,
  __ownerFrame, __pushOwner, __popOwner, __detachRef, __claimGateConstructor,
  __hmrRegistry, __hmrLookup, __hmrEntries, __hmrRegisterDefinition, __hmrClassify, __hmrMigrateDiff,
  __hmrPreserveState, __hmrEmit, __hmrEvents, __hmrPatch, __hmrMigrateRemount, __hmrSnapshotUi, __hmrRestoreUi,
};
