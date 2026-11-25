// The reactive runtime — fine-grained reactivity: the module
// every reactive lowering targets.
//
//   __state(value)          - reactive state container
//   __computed(fn)          - computed value (lazy, cached)
//   __effect(fn)            - side effect; re-runs when dependencies change
//   __batch(fn)             - group multiple updates into one flush
//   __readonly(value)       - immutable value wrapper
//   __setErrorHandler(fn)   - install the error handler; returns the previous one
//   __handleError(err)      - route an error to the handler (rethrows when none)
//   __catchErrors(fn)       - wrap a function to route its sync throws
//   getEffectSignal()       - AbortSignal of the currently-running effect
//
// Ownership (the owner-frame seam — component-machinery-facing;
// exported, deliberately absent from the delivered-name table until
// an emission spells them in generated output):
//   __ownerFrame()          - create a disposal frame; nests onto the
//                             current frame unless {nested: false}
//   __pushOwner(frame)      - make a frame current; returns a token
//   __popOwner(token)       - restore the frame the token's push
//                             displaced; rejects loudly on an
//                             out-of-order or repeated pop
//   __detachRef(cell, el)   - compare-and-clear a template ref cell on
//                             element detach (non-tracking read)
//
// Harness-facing (exported, never delivered — user programs do not
// reference it and delivery injects only referenced names):
//   __setEffectErrorReporter(fn) - swap the report-and-continue printer
//                                  for async effect failures; returns
//                                  the previous reporter
//
// How reactivity works: reading a state/computed inside an effect or a
// recomputing computed subscribes it as a dependency; writing to a
// state notifies subscribers (computeds mark dirty and propagate;
// effects queue); queued effects flush synchronously after the write,
// or once at the end of the enclosing __batch. The flush is owner-
// ordered: an effect never runs before an effect whose owner frame
// encloses its own, so a render swap disposes the block it owns
// before any binding inside that block re-runs. Within one owner
// depth the order is queue insertion.
//
// The equality cut: a computed's subscribers see a change only when
// its output changes (===). Invalidation is push (a dirty mark, no
// recomputation); evaluation is pull. A computed reached through
// another computed is marked CHECK rather than DIRTY, and an effect
// reached only through computeds pull-checks them before running:
// each is recomputed on demand and its version compared with the one
// the effect saw last run. No version moved — no run; the effect's
// edges, cleanup, and AbortSignal stay as the previous run left them.
// A state write reaching an effect or computed directly is always a
// change (state already refuses same-value writes). Identity is the
// rule: a computed that returns the same object after an in-place
// mutation reports no change — return a new value to signal one.
//
// Delivery: this file is BOTH the shared module toolchain paths
// import and the body standalone output inlines once (IIFE-wrapped;
// the emitter strips the export line below). It is plain JavaScript —
// the runtime compiles inject-free by construction (it cannot depend
// on its own injection). Dependency tracking, the pending-effect
// queue, the batch flag, and the error handler are module state:
// exactly one copy exists per process per path, so every consumer in
// the process shares one dependency graph.
//
// Process-wide sentinel: two standalone copies meeting in one process
// would hold separate dependency graphs — a write through one copy's
// state would never notify the other's effects. Loading a second copy
// therefore rejects LOUDLY with instructions. The shared module
// evaluates once per process (module cache), so toolchain-path
// programs never trip it.

const __RIP_REACTIVE_SENTINEL = Symbol.for('rip.runtime.reactive');
if (globalThis[__RIP_REACTIVE_SENTINEL]) {
  throw new Error(
    'two copies of the Rip reactive runtime loaded in one process — states from different copies ' +
    'cannot notify each other (separate dependency graphs, separate effect queues). Run .rip ' +
    'sources through the rip CLI/loader (one shared runtime module per process), or load only ' +
    'one standalone-compiled file per process.',
  );
}
globalThis[__RIP_REACTIVE_SENTINEL] = true;

let __currentEffect = null;        // the effect/computed currently evaluating
const __computingStack = [];       // active computeds, outermost to innermost
// Effects queued to run, drained shallowest owner depth first; within
// one depth, queue insertion order. `low` is the shallowest bucket
// that may hold an entry — a cursor, never a promise that it does.
// A bucket drains through ONE iterator held across shifts: a Set keeps
// a removed entry's slot until it rehashes, so a fresh iterator per
// shift walks every slot already drained and the drain goes quadratic.
// A Set iterator is live — it reaches entries added behind it and
// steps over entries removed ahead of it.
const __pendingEffects = {
  buckets: [], cursors: [], size: 0, low: 0,
  add(e) {
    const d = e.depth;
    let b = this.buckets[d];
    if (b === undefined) b = this.buckets[d] = new Set();
    if (b.has(e)) return;
    b.add(e); this.size++;
    if (d < this.low) this.low = d;
  },
  delete(e) {
    const b = this.buckets[e.depth];
    if (b !== undefined && b.delete(e)) this.size--;
  },
  clear() { this.buckets = []; this.cursors = []; this.size = 0; this.low = 0; },
  shift() {
    for (let d = this.low; d < this.buckets.length; d++) {
      const b = this.buckets[d];
      if (b === undefined || b.size === 0) continue;
      this.low = d;
      let step = (this.cursors[d] ??= b.values()).next();
      if (step.done) step = (this.cursors[d] = b.values()).next();
      const e = step.value;
      b.delete(e); this.size--;
      if (b.size === 0) this.cursors[d] = undefined;
      return e;
    }
    return null;
  },
};
let __batching = false;            // inside __batch()?
let __currentOwner = null;         // the owner frame effects register on

// The report-and-continue printer for async effect failures (a
// rejected async body, a superseded run's cleanup throwing). These
// are handled-by-design: an async rejection has no synchronous caller
// to propagate to, so the runtime reports and the program continues
// (the handle rule). The PRINTER is swappable so a harness that owns
// error display (src/cli/run.js remaps stack frames to .rip coordinates)
// can make the report tell the truth about source positions —
// swallow-don't-crash semantics stay the runtime's, only the printing
// changes. Harness-facing module state, deliberately NOT a delivered
// name (user programs never reference it; delivery would inject it).
let __effectErrorReporter = (label, err) => console.error(label, err);

function __setEffectErrorReporter(reporter) {
  const prev = __effectErrorReporter;
  __effectErrorReporter = reporter;
  return prev;
}

// Flush all pending effects (after a state write, or at the end of a
// batch). Disposed effects are skipped here as well as in run() —
// filtering avoids even calling run() on a known-dead effect. A write
// during the flush enqueues into the same queue and its nested flush
// drains that queue shallowest-first, so an owner queued by the outer
// write still runs before anything it owns. An effect that throws
// aborts the flush: the exception propagates to the writer, and the
// effects still queued do not run (they are no longer pending; a
// later write that re-notifies them re-queues them).
function __flushEffects() {
  try {
    while (__pendingEffects.size > 0) {
      const next = __pendingEffects.shift();
      if (!next._disposed) next.run();
    }
  } catch (e) {
    __pendingEffects.clear();
    throw e;
  }
}

// ── The dependency graph ─────────────────────────────────────────────
//
// One Link per edge, shared by both ends: it sits in its subscriber's
// dependency list (singly linked, in read order) and in its source's
// subscriber list (doubly linked, in notify order). A re-run walks its
// previous list in step with its reads and reuses each link whose source
// comes up again in the same place, so a run that reads what it read
// last time allocates nothing and touches no hash table. Links the run
// did not reach are unlinked when it ends.
//
// Two rules keep this observably identical to a graph that drops every
// edge at run start and re-adds each one on read:
//   - a reused link moves to the END of its source's subscriber list,
//     where re-adding would put it — notify order decides queue order,
//     and queue order decides flush order within an owner depth;
//   - while a subscriber runs, a link it has not yet re-read this run
//     is not followed by notification (a dropped edge would not be).
// A link carries the epoch of the run that last read it; the run's own
// epoch tells current links from not-yet-re-read ones.

class Link {
  constructor(dep, sub) {
    this.dep = dep;
    this.sub = sub;
    this.epoch = sub._epoch;
    this.version = -1;       // a computed source's version as this read saw it
    this.nextDep = null;
    this.prevSub = null;
    this.nextSub = null;
    this.attached = false;   // in dep's subscriber list (free()/kill() detach)
  }
}

function attachSub(dep, link) {
  const tail = dep._subsTail;
  link.prevSub = tail;
  link.nextSub = null;
  if (tail === null) dep._subsHead = link; else tail.nextSub = link;
  dep._subsTail = link;
  link.attached = true;
}

function detachSub(dep, link) {
  if (!link.attached) return;
  const p = link.prevSub, n = link.nextSub;
  if (p === null) dep._subsHead = n; else p.nextSub = n;
  if (n === null) dep._subsTail = p; else n.prevSub = p;
  link.prevSub = link.nextSub = null;
  link.attached = false;
}

// free()/kill(): the source forgets its subscribers. Their dependency
// lists keep the links (detached), exactly as they kept a stale edge to
// a cleared subscriber set: a later read re-attaches, a later run or
// dispose discards.
function detachAllSubs(dep) {
  let l = dep._subsHead;
  while (l !== null) {
    const n = l.nextSub;
    l.prevSub = l.nextSub = null;
    l.attached = false;
    l = n;
  }
  dep._subsHead = dep._subsTail = null;
}

// Record that sub read dep in its current run; returns the edge.
function track(dep, sub) {
  const cursor = sub._cursor;
  if (cursor !== null && cursor.dep === dep) return cursor;
  const next = cursor === null ? sub._depsHead : cursor.nextDep;
  if (next !== null && next.dep === dep) {
    next.epoch = sub._epoch;
    if (!next.attached || dep._subsTail !== next) { detachSub(dep, next); attachSub(dep, next); }
    sub._cursor = next;
    return next;
  }
  const link = new Link(dep, sub);
  if (cursor === null) { link.nextDep = sub._depsHead; sub._depsHead = link; }
  else { link.nextDep = cursor.nextDep; cursor.nextDep = link; }
  attachSub(dep, link);
  sub._cursor = link;
  return link;
}

function beginRun(sub) {
  sub._epoch++;
  sub._cursor = null;
  sub._running++;
}

// Everything past the cursor is what this run did not read.
function endRun(sub) {
  const cursor = sub._cursor;
  let l = cursor === null ? sub._depsHead : cursor.nextDep;
  while (l !== null) { detachSub(l.dep, l); l = l.nextDep; }
  if (cursor === null) sub._depsHead = null; else cursor.nextDep = null;
  sub._running--;
}

function dropAllDeps(sub) {
  for (let l = sub._depsHead; l !== null; l = l.nextDep) detachSub(l.dep, l);
  sub._depsHead = null;
  sub._cursor = null;
}

// Is this edge followed by notification right now?
function live(link) {
  const sub = link.sub;
  return sub._running === 0 || link.epoch === sub._epoch;
}

// Has the subscriber read dep during its current run so far?
function readThisRun(sub, dep) {
  const end = sub._cursor;
  if (end === null) return false;
  for (let l = sub._depsHead; l !== null; l = l.nextDep) {
    if (l.dep === dep) return true;
    if (l === end) break;
  }
  return false;
}

const DEPENDENCY_WRITE = 'reactive runtime: computed dependency changed during evaluation — ' +
  'computed functions must derive without writing or touching a dependency';

// Shared by state and computed: the subscriber list and primitive
// coercion. A container serializes as `{ value }`, its one public field.
class Source {
  valueOf() { return this.value; }
  toString() { return String(this.value); }
  [Symbol.toPrimitive](hint) { return hint === 'string' ? this.toString() : this.valueOf(); }
  toJSON() { return { value: this.value }; }
}

class State extends Source {
  constructor(value) {
    super();
    this._value = value;
    this._subsHead = null;
    this._subsTail = null;
    this._notifying = false;
    this._locked = false;
    this._dead = false;
  }

  get value() {
    const cur = __currentEffect;
    if (cur === null || this._dead) return this._value;
    if (cur._isComputed && writtenDuringComputation(this)) throw new Error(DEPENDENCY_WRITE);
    track(this, cur);
    return this._value;
  }

  set value(newValue) {
    if (this._dead || this._locked || newValue === this._value) return;
    this._rejectDependencyWrite();
    if (this._notifying) return;
    recordComputedMutation(this);
    this._value = newValue;
    this._notify();
  }

  read() { return this._value; }
  touch() {
    if (this._dead) return;
    this._rejectDependencyWrite();
    if (this._notifying) return;
    recordComputedMutation(this);
    this._notify();
  }
  lock() { this._locked = true; return this; }
  free() { detachAllSubs(this); return this; }
  kill() { this._dead = true; detachAllSubs(this); return this._value; }

  _rejectDependencyWrite() {
    const cur = __currentEffect;
    if (cur !== null && cur._isComputed && readThisRun(cur, this)) throw new Error(DEPENDENCY_WRITE);
  }

  // Computeds mark dirty (invalidation propagates without
  // recomputation), effects queue for the flush. `_notifying` is the
  // reentrancy guard — a write to THIS state from an effect running
  // inside this state's own flush is dropped (the self-feeding loop has
  // no terminating reading). The finally restores the guard even when a
  // flushed effect throws, so the state stays writable after an aborted
  // flush.
  _notify() {
    this._notifying = true;
    try {
      for (let l = this._subsHead; l !== null; l = l.nextSub) {
        if (!live(l)) continue;
        const sub = l.sub;
        if (sub._isComputed) sub.markDirty(true);
        else { sub._hard = true; __pendingEffects.add(sub); }
      }
      if (!__batching) __flushEffects();
    } finally {
      this._notifying = false;
    }
  }
}

// A state written during a computed's evaluation may not then be read
// by any computation still on the stack.
function writtenDuringComputation(state) {
  for (let i = 0; i < __computingStack.length; i++) {
    const w = __computingStack[i]._written;
    if (w !== null && w.has(state)) return true;
  }
  return false;
}

function recordComputedMutation(state) {
  for (let i = 0; i < __computingStack.length; i++) {
    const c = __computingStack[i];
    (c._written ??= new Set()).add(state);
  }
}

function __state(initialValue) {
  if (initialValue != null && typeof initialValue === 'object' && typeof initialValue.read === 'function') return initialValue;
  return new State(initialValue);
}

const CLEAN = 0, CHECK = 1, DIRTY = 2;

// Pull-check: did any computed this consumer read last run actually
// change its output since? Recomputes those computeds on demand
// (untracked — the consumer keeps its existing edges).
function __computedDepsChanged(consumer) {
  const prev = __currentEffect;
  __currentEffect = null;
  try {
    for (let l = consumer._depsHead; l !== null; l = l.nextDep) {
      const dep = l.dep;
      if (!dep._isComputed) continue;
      dep.value;
      if (dep.version !== l.version) return true;
    }
    return false;
  } finally {
    __currentEffect = prev;
  }
}

class Computed extends Source {
  constructor(fn) {
    super();
    this._fn = fn;
    this._value = undefined;
    this._dirty = DIRTY;
    this._subsHead = null;
    this._subsTail = null;
    this._depsHead = null;
    this._cursor = null;
    this._epoch = 0;
    this._running = 0;
    this._written = null;
    this._locked = false;
    this._dead = false;
    this._computing = false;
    this.version = 0;
  }

  // hard: a state dependency changed (must recompute). soft: an
  // upstream computed was invalidated (recompute only if it turns out
  // to have changed). Propagation happens once, on CLEAN → not.
  markDirty(hard) {
    if (this._dead || this._locked) return;
    if (this._computing) throw new Error(DEPENDENCY_WRITE);
    const was = this._dirty;
    if (hard) this._dirty = DIRTY; else if (was === CLEAN) this._dirty = CHECK;
    if (was !== CLEAN) return;
    for (let l = this._subsHead; l !== null; l = l.nextSub) {
      if (!live(l)) continue;
      const sub = l.sub;
      if (sub._isComputed) sub.markDirty(false);
      else __pendingEffects.add(sub);
    }
  }

  get value() {
    if (this._dead) return this._value;
    // A reentrant external reader must retain its dependency edge even
    // though the value cannot be read until this computation commits.
    // The computing value itself never subscribes to itself. The edge's
    // version starts at -1, which no version matches: a throw between
    // here and the bottom leaves the next pull-check treating this
    // computed as changed (conservative).
    const cur = __currentEffect;
    let link = null;
    if (cur !== null && cur !== this) { link = track(this, cur); link.version = -1; }
    if (this._computing) {
      throw new Error(
        'reactive runtime: computed value read during its own evaluation — ' +
        'recursive computed reads are not supported');
    }
    if (this._dirty === CHECK && !this._locked) {
      this._dirty = __computedDepsChanged(this) ? DIRTY : CLEAN;
    }
    if (this._dirty === DIRTY && !this._locked) {
      beginRun(this);
      this._written = null;
      __currentEffect = this;
      __computingStack.push(this);
      this._computing = true;
      try {
        const next = this._fn();
        if (next !== this._value) this.version++;
        this._value = next;
        this._dirty = CLEAN;
      } finally {
        this._computing = false;
        __computingStack.pop();
        this._written = null;
        __currentEffect = cur;
        endRun(this);
      }
    }
    if (link !== null) link.version = this.version;
    return this._value;
  }

  read() { return this._value; }
  // Freeze the CACHE, not the current answer: locking sets the flag
  // before the .value touch, so a computed locked before its first
  // read stays undefined forever (the touch subscribes a current
  // effect but never evaluates — locked reads skip recomputation).
  lock() { this._locked = true; this.value; return this; }
  free() {
    dropAllDeps(this);
    detachAllSubs(this);
    return this;
  }
  kill() {
    this._dead = true;
    const result = this._value;
    this.free();
    return result;
  }
}
Computed.prototype._isComputed = true;
State.prototype._isComputed = false;

function __computed(fn) {
  return new Computed(fn);
}

// Runs fn with no effect current, so a reactive read inside it
// subscribes nothing. Teardown runs under it, whatever reads during it:
// a cleanup, a lifecycle hook, a DOM listener the detach fires. Any of
// them subscribing the effect that disposed the view would re-run that
// effect on a later write in the same teardown, mid-swap.
function __untracked(fn) {
  const prev = __currentEffect;
  __currentEffect = null;
  try { return fn(); } finally { __currentEffect = prev; }
}

// A cleanup subscribes nothing: not the effect that disposed this one
// (a render swap disposing the block it owns), and not the effect whose
// write flushed this re-run. Either subscription would re-run that
// effect on the very write the teardown goes on to make (a ref cell
// clearing on detach), rebuilding what it just built. The slot clears
// only after the call returns; a cleanup that throws stays installed.
function __runCleanup(effect) {
  const cleanup = effect._cleanup;
  if (!cleanup) return;
  __untracked(cleanup);
  effect._cleanup = null;
}

class Effect {
  constructor(fn, owner) {
    this._fn = fn;
    // The creation-time owner, restored around EVERY run body —
    // symmetric with __currentEffect. A re-run arrives from whatever
    // context wrote the signal (usually no owner at all), so without
    // the restore, effects and frames created DURING a re-run (a
    // reconcile factory rebuilding blocks inside a loop effect) would
    // be ownerless and survive the owning frame's disposal. Free
    // effects capture null.
    this._owner = owner;
    this.depth = owner ? owner.depth + 1 : 0;
    this._depsHead = null;
    this._cursor = null;
    this._epoch = 0;
    this._running = 0;
    this._hard = true; // the creation run always runs; a state write sets it again
    this._disposed = false;
    this._cleanup = null;
    this._controller = null;
    this._runId = 0;   // increments per run; async resolutions check it to drop stale results
  }

  // AbortSignal for the current run; aborts on re-run / dispose. Made
  // on first read: most effects never ask, and a controller per run is
  // the larger part of a small effect's cost. Read after dispose, it
  // arrives already aborted.
  get signal() {
    if (!this._controller && typeof AbortController !== 'undefined') {
      this._controller = new AbortController();
      if (this._disposed) this._controller.abort();
    }
    return this._controller ? this._controller.signal : null;
  }

  run() {
    // Zombie-run guard. An effect can be queued in __pendingEffects and
    // then disposed before the flush reaches it — an earlier effect in
    // the same flush may have disposed it. Running it anyway would
    // re-subscribe it to every signal its body reads, leaking one
    // subscriber per flush cycle that hits the race.
    if (this._disposed) return;
    // Reached only through computeds? Pull-check them; if none changed
    // its output, this run is a no-op: edges, cleanup and the
    // AbortSignal all stay as the previous run left them.
    const hard = this._hard;
    this._hard = false;
    if (!hard && !__computedDepsChanged(this)) return;
    // Abort the previous run's signal, if that run asked for one: async
    // work still mid-flight from it (a fetch carrying the signal) sees
    // the abort and can bail, and 'abort' listeners user code attached
    // fire. This run gets its own on first read.
    if (this._controller) {
      try { this._controller.abort(); } catch {}
      this._controller = null;
    }
    // Per-run id captured by the closures below. When the effect re-runs
    // while a prior async body is still awaiting, the prior body's
    // eventual resolution sees myRun !== _runId and bails — stale
    // cleanup never overwrites the current run's cleanup.
    const myRun = ++this._runId;

    __runCleanup(this);
    beginRun(this);
    const prev = __currentEffect;
    __currentEffect = this;
    const prevOwner = __currentOwner;
    __currentOwner = this._owner;
    try {
      const result = this._fn();
      if (typeof result === 'function') {
        this._cleanup = result;
      } else if (result && typeof result.then === 'function') {
        // Async effect body. A pending await cannot be unwound, but the
        // eventual resolution can be intercepted to decide whether the
        // cleanup it returns is still wanted:
        //   - effect disposed while the body was awaiting: run the
        //     cleanup immediately so resources release, store nothing;
        //   - effect re-ran (a newer run superseded this one): same.
        // In both cases _cleanup is left alone — it belongs to a
        // different run.
        result.then(
          (cleanup) => {
            if (myRun !== this._runId || this._disposed) {
              if (typeof cleanup === 'function') {
                try { cleanup(); }
                catch (e) { __effectErrorReporter('[Rip] superseded async cleanup error:', e); }
              }
              return;
            }
            if (typeof cleanup === 'function') this._cleanup = cleanup;
          },
          (err) => {
            // AbortError from a dispose or supersede is expected (the
            // body passed our signal to fetch/etc. and it aborted).
            // Swallow silently.
            if (err && err.name === 'AbortError') return;
            // Stale rejection from a superseded run: the caller has
            // already moved on.
            if (myRun !== this._runId || this._disposed) return;
            __effectErrorReporter('[Rip] async effect error:', err);
          }
        );
      }
    } finally {
      __currentEffect = prev;
      __currentOwner = prevOwner;
      endRun(this);
    }
  }

  dispose() {
    // Idempotent: tangled cleanup paths may reach the same effect twice.
    // The quick exit avoids re-running cleanup and re-walking
    // already-empty dependencies.
    if (this._disposed) return;
    this._disposed = true;
    // Proactive pending-set eviction. The flush-time guard also handles
    // this, but evicting here keeps the set bounded across long batched
    // cycles and makes disposal semantics direct rather than dependent
    // on flush ordering.
    __pendingEffects.delete(this);
    // Abort the current signal so in-flight async work unwinds via
    // AbortError and the body can bail.
    if (this._controller) {
      try { this._controller.abort(); } catch {}
    }
    __runCleanup(this);
    dropAllDeps(this);
  }
}
Effect.prototype._isComputed = false;

function __effect(fn) {
  const effect = new Effect(fn, __currentOwner);
  // A throwing creation run propagates to the creator, but the read
  // subscriptions the body made before throwing must not survive it:
  // registration follows the run, so no disposer exists anywhere and the
  // effect would be an un-disposable zombie re-firing (and re-throwing)
  // on every write. Dispose before rethrowing so the dependencies
  // unsubscribe.
  try {
    effect.run();
  } catch (e) {
    effect.dispose();
    throw e;
  }
  const dispose = () => effect.dispose();
  // Ownership: the disposer registers on the creation-time owner frame,
  // so frame disposal (component unmount, render-block teardown) fires
  // it.
  if (__currentOwner) __currentOwner.add(dispose);
  return dispose;
}

function __batch(fn) {
  if (__batching) return fn();
  __batching = true;
  try {
    return fn();
  } finally {
    __batching = false;
    __flushEffects();
  }
}

// ── Ownership: the owner-frame seam ──────────────────────────────────
//
// A frame OWNS disposers: every __effect created while the frame is
// current appends its disposer, and frame.dispose() runs them all in
// registration order (report-and-continue per disposer — one failed
// cleanup must not strand the rest). Frames NEST: a frame created
// while another is current registers its own disposal on the parent,
// so disposing the parent disposes the child; disposal is idempotent,
// so a child torn down early (a render block re-rendering) is a no-op
// when the parent later unwinds. A component instance holds a
// NON-NESTED frame (cross-component teardown is the unmount cascade's
// job — a child component's lifetime is not its construction scope's);
// render-block factories hold nested frames, which is what makes a
// block's teardown ride its component structurally.
function __ownerFrame({ nested = true } = {}) {
  // Insertion-ordered: disposal runs in registration order, and a
  // disposer leaving early (a child frame, a replaced writer) is an O(1)
  // delete — an array's indexOf-and-splice made removing n children
  // quadratic.
  let disposers = new Set();
  let detach = null;
  // How many frames enclose this one — the flush's ordering key for
  // every effect the frame owns.
  const depth = __currentOwner ? __currentOwner.depth + 1 : 0;
  const frame = {
    depth,
    get disposed() { return disposers === null; },
    // The live disposer count — harness-facing (the accumulation
    // gate reads it); nothing emits or delivers it.
    get size() { return disposers === null ? 0 : disposers.size; },
    add(disposer) {
      // A disposer arriving after disposal runs immediately: the
      // frame's lifetime is over, so deferring it would mean never.
      if (disposers === null) disposer();
      else disposers.add(disposer);
    },
    remove(disposer) {
      if (disposers !== null) disposers.delete(disposer);
    },
    dispose() {
      if (disposers === null) return;
      const list = disposers;
      disposers = null;
      // Detach from the parent's list FIRST: a child disposed before
      // its parent must not leave a dead entry behind — render
      // factories create one nested frame per patch, so a long-lived
      // component would otherwise accumulate one dead closure per
      // patch, unbounded. When the PARENT
      // is mid-disposal the remove is a no-op (its list is already
      // detached into the disposal snapshot).
      if (detach !== null) {
        const d = detach;
        detach = null;
        d();
      }
      for (const d of list) {
        try { d(); } catch (e) { __effectErrorReporter('[Rip] effect disposer error:', e); }
      }
    },
  };
  if (nested && __currentOwner) {
    const parent = __currentOwner;
    parent.add(frame.dispose);
    detach = () => parent.remove(frame.dispose);
  }
  return frame;
}

// Push/pop is TOKEN-validated: a blind restore would let a mismatched
// pop (an inner push never popped, a token popped twice) silently
// leave the wrong frame current, orphaning every effect created after
// it — the failure the seam exists to prevent. The token pairs the
// pushed frame with the displaced one; popping verifies the pushed
// frame is still current and rejects loudly otherwise.
function __pushOwner(frame) {
  const token = { frame, prev: __currentOwner };
  __currentOwner = frame;
  return token;
}

function __popOwner(token) {
  if (!token || typeof token !== 'object' || !('frame' in token)) {
    throw new Error('reactive runtime: __popOwner takes the token the matching __pushOwner returned');
  }
  if (__currentOwner !== token.frame) {
    throw new Error(
      'reactive runtime: __popOwner out of order — the frame being popped is not the current owner ' +
      '(an inner push was not popped, or this token was already popped)',
    );
  }
  __currentOwner = token.prev;
}

// The AbortSignal of the currently-running effect, or null outside an
// effect (or where AbortController does not exist). For async-aware
// effect bodies — capture the signal BEFORE any await so it stays
// valid for the duration of the body; on effect re-run or dispose the
// signal aborts, the fetch rejects with AbortError, and the body
// unwinds.
function getEffectSignal() {
  return __currentEffect ? __currentEffect.signal : null;
}

function __readonly(value) {
  return Object.freeze({ value });
}

// Compare-and-clear a template ref cell on element detach. The
// NON-tracking read() means clearing never subscribes the teardown
// path to the cell, and the cell nulls only while it still holds THIS
// element — a keyed move or a re-render that already pointed the cell
// elsewhere is not clobbered. Writing null notifies subscribers (an
// effect reading the ref re-runs when the element disappears);
// callers wrap teardown in __batch where parent subscribers may be
// live. Consumers are render factories (render emission).
function __detachRef(cell, el) {
  if (cell && typeof cell.read === 'function' && cell.read() === el) cell.value = null;
}

// ── Error handling ────────────────────────────────────────────────────

let __errorHandler = null;

function __setErrorHandler(handler) {
  const prev = __errorHandler;
  __errorHandler = handler;
  return prev;
}

function __handleError(error) {
  if (__errorHandler) {
    try {
      __errorHandler(error);
    } catch (handlerError) {
      console.error('Error in error handler:', handlerError);
      console.error('Original error:', error);
    }
  } else {
    throw error;
  }
}

function __catchErrors(fn) {
  return function(...args) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      __handleError(error);
    }
  };
}

export { __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal, __setEffectErrorReporter, __ownerFrame, __pushOwner, __popOwner, __detachRef, __untracked };
