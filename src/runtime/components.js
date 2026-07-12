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

import { __batch, __state, __effect, __ownerFrame, __pushOwner, __popOwner, __detachRef } from './reactive.js';

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
  cl.add(from, active);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cl.remove(from);
      cl.add(to);
      // Only THIS element's own transitionend completes the transition:
      // a `transitionend` bubbling up from a descendant must not finish
      // (or, with { once }, prematurely consume) the parent's animation.
      const end = (e) => {
        // Skip only a bubbled event whose target is a DIFFERENT element
        // (a descendant). A direct dispatch on this element (target ===
        // el, or an event with no target) completes the transition.
        if (e && e.target && e.target !== el) return;
        el.removeEventListener('transitionend', end);
        cl.remove(active, to);
        if (done) done();
      };
      el.addEventListener('transitionend', end);
    });
  });
}

function __handleComponentError(error, component) {
  let current = component;
  // Cycle guard: a corrupted _parent chain must not hang the walk.
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current.onError) {
      try { current.onError(error, component); return; } catch (_) {}
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

// Last-applied style-object keys per element (the replacement diff).
const __styleKeys = new WeakMap();

class __Component {
  constructor(props = {}) {
    __checkDeclaredProps(this.constructor, this);
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
      // Effects _init created BEFORE the throw are live and
      // subscribed; nothing will ever mount or unmount this broken
      // instance, so the frame is their only way out — dispose it on
      // BOTH failure paths (boundary-handled and rethrow) so the
      // instance is inert, never a subscription leak.
      this._frame.dispose();
      // Mark the instance as failed so parent emit-sites substitute a
      // placeholder instead of running _create / _setup on a broken
      // instance (the report-and-continue
      // contract). If a boundary handles the error, control returns
      // here; if none exists, __handleComponentError rethrows.
      this._initFailed = true;
      __handleComponentError(e, this);
      return;
    }
    __popOwner(prevO);
    __popComponent(prevC);
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
    // Inert after unmount: a parent's updater effect can outlive a
    // manually-unmounted child instance — its writes must neither
    // reach the disposed tree nor grow writers.
    if (this._unmounted) return;
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
    // Post-unmount updates are inert: the instance's frame is
    // disposed, its DOM detached — a parent updater still holding the
    // instance must not grow dead writers or drive a detached tree.
    if (this._unmounted) return;
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
    if (!this._inheritedEl || !this._rest) return;
    for (const key in this._rest) this._applyInheritedProp(this._inheritedEl, key, this._rest[key]);
  }
  _applyInheritedProp(el, key, value) {
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
    // per-key writer map above — assigning the raw signal object to
    // the DOM property would drop every later update (the
    // #164).
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
  mount(target) {
    // Remount of an unmounted instance rejects:
    // its _init-time effects were disposed in the first life and
    // cannot be revived without re-running _init whole.
    if (this._unmounted) {
      throw new Error(
        `${this.constructor.name || 'component'}: cannot mount an unmounted instance — its effects ` +
        'were disposed on unmount; construct a new instance',
      );
    }
    // A second live mount would overwrite _root and strand the first
    // tree (unmount would then only tear down the second). Reject it.
    if (this._mounted) {
      throw new Error(
        `${this.constructor.name || 'component'}: already mounted — unmount it before mounting again, ` +
        'or construct a new instance',
      );
    }
    if (typeof target === 'string') target = document.querySelector(target);
    this._target = target;
    // _create / _setup / hooks run with this component current on
    // BOTH stacks: the component stack (context reads, parent
    // chains) and the owner frame (effect disposers register here
    // and fire on unmount).
    const prevC = __pushComponent(this);
    const prevO = __pushOwner(this._frame);
    try {
      this._root = this._create();
      if (this._root) target.appendChild(this._root);
      // The full lifecycle contract on EVERY mount path
      //: create → beforeMount → setup → mounted.
      if (this.beforeMount) this.beforeMount();
      if (this._setup) this._setup();
      if (this.mounted) this.mounted();
      this._mounted = true;
    } catch (error) {
      // The mount failed partway: effects created before the throw are
      // live in the owner frame with nothing to ever unmount them.
      // Dispose the frame and mark the instance inert (a failed mount
      // is like a failed _init — the instance is not reusable).
      try { this._frame.dispose(); } catch { /* dispose is best-effort */ }
      this._unmounted = true;
      __handleComponentError(error, this);
    } finally {
      __popOwner(prevO);
      __popComponent(prevC);
    }
    return this;
  }
  unmount({ removeDOM = true } = {}) {
    // Symmetric to mount: lifecycle hooks, the owner frame's effect
    // disposers, child components, and (optionally) the DOM.
    //
    //   beforeUnmount  - user hook; runs while signals/effects are
    //                    still live, so user code can read final state.
    //   children       - cascade BEFORE this instance's disposers so
    //                    children can react to parent state during
    //                    their own teardown.
    //   _frame         - effect disposers registered by __effect
    //                    through the owner seam.
    //   unmounted      - user hook; final notification.
    //   DOM removal    - skipped when the caller wants the old DOM
    //                    visible until replacement.
    //
    // Idempotent: a child can be unmounted by its enclosing factory's
    // d(detaching) AND later by the parent's unmount cascade.
    if (this._unmounted) return;
    this._unmounted = true;
    try {
      if (this.beforeUnmount) this.beforeUnmount();
    } catch (e) { console.error('[Rip] beforeUnmount error:', e); }
    if (this._children) {
      for (const child of this._children) {
        try { child.unmount({ removeDOM }); }
        catch (e) { console.error('[Rip] child unmount error:', e); }
      }
      this._children = null;
    }
    this._frame.dispose();
    // Static template-ref cleanups run AFTER this component's own
    // effects are disposed (nulling a ref before disposing the
    // effects that read it could re-run them mid-teardown under the
    // synchronous scheduler) but before the DOM detaches. Batched so
    // a forwarded ref notifies still-live parent subscribers exactly
    // once.
    if (this._refCleanups) {
      const cleanups = this._refCleanups;
      this._refCleanups = null;
      __batch(() => {
        for (const c of cleanups) {
          try { c(); } catch (e) { console.error('[Rip] ref cleanup error:', e); }
        }
      });
    }
    try {
      if (this.unmounted) this.unmounted();
    } catch (e) { console.error('[Rip] unmounted error:', e); }
    if (removeDOM) {
      if (this._nodes) {
        // Multi-root: detach each captured top-level node (the _root
        // fragment is empty and owns nothing).
        for (const n of this._nodes) __detach(n);
      } else if (this._root && this._root.parentNode) {
        this._root.parentNode.removeChild(this._root);
      }
    }
    this._nodes = null;
  }
  // emit dispatches on the live root; outside that window the event
  // could only vanish (no root before mount) or dispatch into a
  // detached tree no listener observes (after unmount) — both reject
  // loudly instead. The window is _root's
  // lifetime, so the child protocol (a parent's create phase sets the
  // child's _root) opens it exactly like a direct mount() does.
  emit(name, detail) {
    if (!this._root || this._unmounted) {
      throw new Error(
        `${this.constructor.name || 'component'}: emit('${name}') outside the mounted window — ` +
        'emit dispatches on the live root; call after mount and before unmount',
      );
    }
    this._root.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
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
export { __Component, __pushComponent, __popComponent, setContext, getContext, hasContext, __clsx, __lis, __reconcile, __transition, __handleComponentError, __detach, __ownerFrame, __pushOwner, __popOwner, __detachRef };
