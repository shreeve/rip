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
// or once at the end of the enclosing __batch.
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
const __pendingEffects = new Set(); // effects queued to run
let __batching = false;            // inside __batch()?
let __currentOwner = null;         // the owner frame effects register on

// The report-and-continue printer for async effect failures (a
// rejected async body, a superseded run's cleanup throwing). These
// are handled-by-design: an async rejection has no synchronous caller
// to propagate to, so the runtime reports and the program continues
// (the handle rule). The PRINTER is swappable so a harness that owns
// error display (src/run.js remaps stack frames to .rip coordinates)
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
// filtering avoids even calling run() on a known-dead effect. An
// effect that throws aborts the flush: the exception propagates to
// the writer, and effects still in this snapshot do not run (they are
// no longer pending; a later write that re-notifies them re-queues
// them).
function __flushEffects() {
  const effects = [...__pendingEffects];
  __pendingEffects.clear();
  for (const effect of effects) {
    if (!effect._disposed) effect.run();
  }
}

// Shared primitive coercion (used by state and computed)
const __primitiveCoercion = {
  valueOf() { return this.value; },
  toString() { return String(this.value); },
  [Symbol.toPrimitive](hint) { return hint === 'string' ? this.toString() : this.valueOf(); }
};

function __state(initialValue) {
  if (initialValue != null && typeof initialValue === 'object' && typeof initialValue.read === 'function') return initialValue;
  let value = initialValue;
  const subscribers = new Set();
  let notifying = false;
  let locked = false;
  let dead = false;
  const rejectComputedDependencyMutation = () => {
    if (__currentEffect && typeof __currentEffect.markDirty === 'function' &&
        __currentEffect.dependencies.has(subscribers)) {
      throw new Error(
        'reactive runtime: computed dependency changed during evaluation — ' +
        'computed functions must derive without writing or touching a dependency');
    }
  };
  const recordComputedMutation = () => {
    for (const computed of __computingStack) computed.writtenSignals.add(subscribers);
  };

  // Notify subscribers of a change: computeds mark dirty (invalidation
  // propagates without recomputation), effects queue for the flush.
  // `notifying` is the reentrancy guard — a write to THIS state from
  // an effect running inside this state's own flush is dropped (the
  // self-feeding loop has no terminating reading). The finally
  // restores the guard even when a flushed effect throws, so the
  // state stays writable after an aborted flush.
  const notify = () => {
    notifying = true;
    try {
      for (const sub of subscribers) {
        if (sub.markDirty) sub.markDirty();
        else __pendingEffects.add(sub);
      }
      if (!__batching) __flushEffects();
    } finally {
      notifying = false;
    }
  };

  const state = {
    get value() {
      if (dead) return value;
      if (__currentEffect?.writtenSignals &&
          __computingStack.some((computed) => computed.writtenSignals.has(subscribers))) {
        throw new Error(
          'reactive runtime: computed dependency changed during evaluation — ' +
          'computed functions must derive without writing or touching a dependency');
      }
      if (__currentEffect) {
        subscribers.add(__currentEffect);
        __currentEffect.dependencies.add(subscribers);
      }
      return value;
    },

    set value(newValue) {
      if (dead || locked || newValue === value) return;
      rejectComputedDependencyMutation();
      if (notifying) return;
      recordComputedMutation();
      value = newValue;
      notify();
    },

    read() { return value; },
    touch() {
      if (dead) return;
      rejectComputedDependencyMutation();
      if (notifying) return;
      recordComputedMutation();
      notify();
    },
    lock() { locked = true; return state; },
    free() { subscribers.clear(); return state; },
    kill() { dead = true; subscribers.clear(); return value; },

    ...__primitiveCoercion
  };
  return state;
}

function __computed(fn) {
  let value;
  let dirty = true;
  const subscribers = new Set();
  let locked = false;
  let dead = false;
  let computing = false;

  const computed = {
    dependencies: new Set(),
    writtenSignals: new Set(),

    markDirty() {
      if (dead || locked) return;
      if (computing) {
        throw new Error(
          'reactive runtime: computed dependency changed during evaluation — ' +
          'computed functions must derive without writing or touching a dependency');
      }
      if (dirty) return;
      dirty = true;
      for (const sub of subscribers) {
        if (sub.markDirty) sub.markDirty();
        else __pendingEffects.add(sub);
      }
    },

    get value() {
      if (dead) return value;
      // A reentrant external reader must retain its dependency edge even
      // though the value cannot be read until this computation commits.
      // The computing value itself never subscribes to itself.
      if (__currentEffect && __currentEffect !== computed) {
        subscribers.add(__currentEffect);
        __currentEffect.dependencies.add(subscribers);
      }
      if (computing) {
        throw new Error(
          'reactive runtime: computed value read during its own evaluation — ' +
          'recursive computed reads are not supported');
      }
      if (dirty && !locked) {
        for (const dep of computed.dependencies) dep.delete(computed);
        computed.dependencies.clear();
        const prev = __currentEffect;
        computed.writtenSignals.clear();
        __currentEffect = computed;
        __computingStack.push(computed);
        computing = true;
        try {
          value = fn();
          dirty = false;
        } finally {
          computing = false;
          __computingStack.pop();
          computed.writtenSignals.clear();
          __currentEffect = prev;
        }
      }
      return value;
    },

    read() { return value; },
    // Freeze the CACHE, not the current answer: locking sets the flag
    // before the .value touch, so a computed locked before its first
    // read stays undefined forever (the touch subscribes a current
    // effect but never evaluates — locked reads skip recomputation).
    lock() { locked = true; computed.value; return computed; },
    free() {
      for (const dep of computed.dependencies) dep.delete(computed);
      computed.dependencies.clear();
      subscribers.clear();
      return computed;
    },
    kill() {
      dead = true;
      const result = value;
      computed.free();
      return result;
    },

    ...__primitiveCoercion
  };
  return computed;
}

function __effect(fn) {
  let controller = null;
  let runId = 0; // increments per run; async resolutions check it to drop stale results
  // The creation-time owner, restored around EVERY run body —
  // symmetric with __currentEffect. A re-run arrives from whatever
  // context wrote the signal (usually no owner at all), so without
  // the restore, effects and frames created DURING a re-run (a
  // reconcile factory rebuilding blocks inside a loop effect) would
  // be ownerless and survive the owning frame's disposal. Free
  // effects capture null.
  const owner = __currentOwner;
  const effect = {
    dependencies: new Set(),
    _disposed: false,
    signal: null, // AbortSignal for the current run; aborts on re-run / dispose

    run() {
      // Zombie-run guard. An effect can be queued in __pendingEffects
      // and then disposed before the flush reaches it — an earlier
      // effect in the same flush may have disposed it. Running it
      // anyway would re-subscribe it to every signal its body reads,
      // leaking one subscriber per flush cycle that hits the race.
      if (effect._disposed) return;
      // Abort the previous run's signal before allocating a new one:
      // async work still mid-flight from the previous run (a fetch
      // carrying the signal) sees the abort and can bail, and 'abort'
      // listeners user code attached to the previous signal fire.
      if (controller) {
        try { controller.abort(); } catch {}
      }
      controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      effect.signal = controller ? controller.signal : null;
      // Per-run id captured by the closures below. When the effect
      // re-runs while a prior async body is still awaiting, the prior
      // body's eventual resolution sees myRun !== runId and bails —
      // stale cleanup never overwrites the current run's cleanup.
      const myRun = ++runId;

      if (effect._cleanup) { effect._cleanup(); effect._cleanup = null; }
      for (const dep of effect.dependencies) dep.delete(effect);
      effect.dependencies.clear();
      const prev = __currentEffect;
      __currentEffect = effect;
      const prevOwner = __currentOwner;
      __currentOwner = owner;
      try {
        const result = fn();
        if (typeof result === 'function') {
          effect._cleanup = result;
        } else if (result && typeof result.then === 'function') {
          // Async effect body. A pending await cannot be unwound, but
          // the eventual resolution can be intercepted to decide
          // whether the cleanup it returns is still wanted:
          //   - effect disposed while the body was awaiting: run the
          //     cleanup immediately so resources release, store nothing;
          //   - effect re-ran (a newer run superseded this one): same.
          // In both cases effect._cleanup is left alone — it belongs
          // to a different run.
          result.then(
            (cleanup) => {
              if (myRun !== runId || effect._disposed) {
                if (typeof cleanup === 'function') {
                  try { cleanup(); }
                  catch (e) { __effectErrorReporter('[Rip] superseded async cleanup error:', e); }
                }
                return;
              }
              if (typeof cleanup === 'function') effect._cleanup = cleanup;
            },
            (err) => {
              // AbortError from a dispose or supersede is expected
              // (the body passed our signal to fetch/etc. and it
              // aborted). Swallow silently.
              if (err && err.name === 'AbortError') return;
              // Stale rejection from a superseded run: the caller has
              // already moved on.
              if (myRun !== runId || effect._disposed) return;
              __effectErrorReporter('[Rip] async effect error:', err);
            }
          );
        }
      } finally { __currentEffect = prev; __currentOwner = prevOwner; }
    },

    dispose() {
      // Idempotent: tangled cleanup paths may reach the same effect
      // twice. The quick exit avoids re-running cleanup and re-walking
      // already-empty dependencies.
      if (effect._disposed) return;
      effect._disposed = true;
      // Proactive pending-set eviction. The flush-time guard also
      // handles this, but evicting here keeps the set bounded across
      // long batched cycles and makes disposal semantics direct
      // rather than dependent on flush ordering.
      __pendingEffects.delete(effect);
      // Abort the current signal so in-flight async work unwinds via
      // AbortError and the body can bail.
      if (controller) {
        try { controller.abort(); } catch {}
      }
      if (effect._cleanup) { effect._cleanup(); effect._cleanup = null; }
      for (const dep of effect.dependencies) dep.delete(effect);
      effect.dependencies.clear();
    }
  };

  // A throwing creation run propagates to the creator, but the read
  // subscriptions the body made before throwing must not survive it:
  // registration follows the run, so no disposer exists anywhere and
  // the effect would be an un-disposable zombie re-firing (and
  // re-throwing) on every write.
  // Dispose before rethrowing so the dependencies unsubscribe.
  try {
    effect.run();
  } catch (e) {
    effect.dispose();
    throw e;
  }
  const dispose = () => effect.dispose();
  // Ownership: the disposer registers on the creation-time owner
  // frame, so frame disposal (component unmount, render-block
  // teardown) fires it.
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
  let disposers = [];
  let detach = null;
  const frame = {
    get disposed() { return disposers === null; },
    // The live disposer count — harness-facing (the accumulation
    // gate reads it); nothing emits or delivers it.
    get size() { return disposers === null ? 0 : disposers.length; },
    add(disposer) {
      // A disposer arriving after disposal runs immediately: the
      // frame's lifetime is over, so deferring it would mean never.
      if (disposers === null) disposer();
      else disposers.push(disposer);
    },
    remove(disposer) {
      if (disposers === null) return;
      const i = disposers.indexOf(disposer);
      if (i >= 0) disposers.splice(i, 1);
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

export { __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal, __setEffectErrorReporter, __ownerFrame, __pushOwner, __popOwner, __detachRef };
