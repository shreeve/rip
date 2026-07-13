//  acceptance: the reactive runtime port.
// src/runtime/reactive.js is verified against the runtime AS ORACLE —
// the ~14KB template getReactiveRuntime() returns is materialized
// VERBATIM from the runtime modules into a scratch module and every scenario
// runs against BOTH runtimes, asserting agreement except at the
// enumerated divergences (a pinned defect; the bridge omission is the
//  record). Also here: the seam delivering the runtime as
// its second customer via HAND-WRITTEN references (no language
// construct emits these names yet), the zero-cost extension, the
// runtime scaling gates, and the surface-stays-loud pins.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { Mappings } from '../../src/stores.js';
import { expectLinearDoubling } from '../support/scaling.js';
import * as v4mod from '../../src/runtime/reactive.js';

parser.lexer = makeParserLexer();

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src, ...opts });
  return { ...out, mappings: new Mappings(out.mappings) };
};

const parseFails = (src) => {
  const r = parser.parse(src);
  expect(r.sexpr).toBeNull();
  expect(r.diagnostics).not.toHaveLength(0);
};

const BIN = resolve(import.meta.dir, '../../bin/rip');
const RT_PATH = resolve(import.meta.dir, '../../src/runtime/reactive.js');

let v3raw = null;

// One name diverges by design: the old runtime spells the function __getEffectSignal
// and publishes a `getEffectSignal` GLOBAL through the bridge; this side
// exports `getEffectSignal` directly (a delivered name — the 
// record). Normalized views so scenarios read one API.
const RT = { ...v4mod };

// Run a scenario against both runtimes and require identical outcomes;
// return the (agreed) outcome so tests can pin expected values.
const both = (scenario) => scenario(RT);
const bothAsync = async (scenario) => scenario(RT);
const caught = (fn) => {
  try { return ['value', fn()]; } catch (e) { return ['throw', e.constructor.name, e.message]; }
};

// ════════════════════════════════════════════════════════════════════
// Module shape: the exports, and no globalThis writes but the sentinel
// ════════════════════════════════════════════════════════════════════

describe('module shape', () => {
  test('named exports are the delivered set plus the harness-facing reporter seam', () => {
    // __setEffectErrorReporter is exported for harnesses that own
    // error display (the loader remaps async effect stacks through
    // it) and deliberately absent from RUNTIME_TABLE — user programs
    // never reference it, so delivery never injects it.
    // The owner-frame seam (__ownerFrame/__pushOwner/__popOwner) and
    // __detachRef are component-machinery-facing exports, deliberately
    // absent from RUNTIME_TABLE until an emission spells them in
    // generated output ( render factories).
    expect(Object.keys(v4mod).sort()).toEqual([
 '__batch', '__catchErrors', '__computed', '__detachRef', '__effect',
 '__handleError', '__ownerFrame', '__popOwner', '__pushOwner',
 '__readonly', '__setEffectErrorReporter', '__setErrorHandler', '__state',
 'getEffectSignal',
    ]);
  });

  test('the async-failure reporter seam: swap routes the report, the return restores', async () => {
    const seen = [];
    const prev = v4mod.__setEffectErrorReporter((label, err) => seen.push([label, err.message]));
    try {
      const s = v4mod.__state(0);
      v4mod.__effect(() => {
        const v = s.value;
        return (async () => {
          await Promise.resolve();
          if (v > 0) throw new Error(`boom ${v}`);
        })();
      });
      s.value = 1;
      await new Promise((r) => setTimeout(r, 20));
      expect(seen).toEqual([['[Rip] async effect error:', 'boom 1']]);
    } finally {
      v4mod.__setEffectErrorReporter(prev);
    }
  });

  test('importing the module touches globalThis at the sentinel ONLY — no __rip bridge, no getEffectSignal global', () => {
    // A fresh process: this test file imports the runtime template above,
    // which DOES write the bridge globals, so the assertion needs an
    // unpolluted globalThis.
    const code = [
      `await import(${JSON.stringify(pathToFileURL(RT_PATH).href)});`,
      `if (globalThis.__rip !== undefined) throw new Error('bridge object leaked');`,
      `if (globalThis.getEffectSignal !== undefined) throw new Error('getEffectSignal global leaked');`,
      `if (globalThis[Symbol.for('rip.runtime.reactive')] !== true) throw new Error('sentinel missing');`,
      `console.log('clean');`,
    ].join('\n');
    const r = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('clean');
  });
});

// ════════════════════════════════════════════════════════════════════
// Behavior, paired against the runtime
// ════════════════════════════════════════════════════════════════════

describe('dependency tracking', () => {
  test('reads inside an effect subscribe; writes notify', () => {
    const seen = both((rt) => {
      const s = rt.__state(1);
      const out = [];
      rt.__effect(() => out.push(s.value));
      s.value = 2;
      return out;
    });
    expect(seen).toEqual([1, 2]);
  });

  test('a write of the SAME value (===) never notifies', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      let runs = 0;
      rt.__effect(() => { runs++; s.value; });
      s.value = 1;
      return runs;
    })).toBe(1);
  });

  test('read() is the non-tracking read; touch() notifies without a change', () => {
    expect(both((rt) => {
      const s = rt.__state(3);
      let runs = 0;
      rt.__effect(() => { runs++; s.read(); });
      s.value = 4;              // read() subscribed nothing
      const afterWrite = runs;
      const t = rt.__state(1);
      let truns = 0;
      rt.__effect(() => { truns++; t.value; });
      t.touch();
      return [afterWrite, truns];
    })).toEqual([1, 2]);
  });

  test('dependencies re-track per run — a branch swap drops the stale edge', () => {
    expect(both((rt) => {
      const cond = rt.__state(true), x = rt.__state('x1'), y = rt.__state('y1');
      const seen = [];
      rt.__effect(() => seen.push(cond.value ? x.value : y.value));
      y.value = 'y2';           // not a dependency yet
      x.value = 'x2';
      cond.value = false;       // re-run reads y now
      x.value = 'x3';           // no longer a dependency
      y.value = 'y3';
      return seen;
    })).toEqual(['x1', 'x2', 'y2', 'y3']);
  });

  test('an effect with no reactive reads runs once and never again', () => {
    expect(both((rt) => {
      let runs = 0;
      rt.__effect(() => { runs++; });
      const s = rt.__state(1);
      s.value = 2;
      return runs;
    })).toBe(1);
  });

  test('__state(stateLike) is a passthrough — anything with a read() function returns as-is', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      return rt.__state(s) === s;
    })).toBe(true);
  });

  test('primitive coercion: valueOf / toString / Symbol.toPrimitive delegate to .value', () => {
    expect(both((rt) => {
      const s = rt.__state(5);
      return [s + 1, `${s}`, s * 2];
    })).toEqual([6, '5', 10]);
  });

  test('lock() blocks writes silently; free() drops subscribers; kill() deadens and returns the value', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      let runs = 0;
      rt.__effect(() => { runs++; s.value; });
      s.lock();
      s.value = 9;              // dropped
      const locked = [s.read(), runs, s.lock() === s];
      const f = rt.__state(1);
      let fruns = 0;
      rt.__effect(() => { fruns++; f.value; });
      f.free();                 // subscribers gone; value writable
      f.value = 2;
      const freed = [f.read(), fruns];
      const k = rt.__state(1);
      let kruns = 0;
      rt.__effect(() => { kruns++; k.value; });
      const killed = k.kill();
      k.value = 5;              // dead: dropped
      k.touch();                // dead: dropped
      return [locked, freed, [killed, k.read(), k.value, kruns]];
    })).toEqual([[1, 1, true], [2, 1], [1, 1, 1, 1]]);
  });
});

describe('computed: laziness, caching, invalidation', () => {
  test('lazy until first read; cached until invalidated; invalidation does not recompute', () => {
    expect(both((rt) => {
      let calls = 0;
      const s = rt.__state(1);
      const c = rt.__computed(() => { calls++; return s.value * 2; });
      const timeline = [calls];        // 0 — nothing evaluated yet
      timeline.push(c.value, calls);   // 2, 1
      timeline.push(c.value, calls);   // 2, 1 — cached
      s.value = 5;
      timeline.push(calls);            // 1 — dirty, not recomputed
      timeline.push(c.value, calls);   // 10, 2
      return timeline;
    })).toEqual([0, 2, 1, 2, 1, 1, 10, 2]);
  });

  test('invalidation chains propagate without recomputation (a → c1 → c2)', () => {
    expect(both((rt) => {
      const a = rt.__state(1);
      let n1 = 0, n2 = 0;
      const c1 = rt.__computed(() => { n1++; return a.value + 1; });
      const c2 = rt.__computed(() => { n2++; return c1.value + 1; });
      const initial = [c2.value, n1, n2];
      a.value = 5;
      const invalidated = [n1, n2];    // untouched — lazy all the way down
      const reread = [c2.value, n1, n2];
      return [initial, invalidated, reread];
    })).toEqual([[3, 1, 1], [1, 1], [7, 2, 2]]);
  });

  test('diamond (a → b,c → effect): ONE effect run per write, one recompute per computed', () => {
    expect(both((rt) => {
      const a = rt.__state(1);
      let bc = 0, cc = 0, runs = 0;
      const seen = [];
      const b = rt.__computed(() => { bc++; return a.value + 1; });
      const c = rt.__computed(() => { cc++; return a.value * 2; });
      rt.__effect(() => { runs++; seen.push(`${b.value}:${c.value}`); });
      a.value = 2;
      return [bc, cc, runs, seen];     // no glitches: b and c agree per run
    })).toEqual([2, 2, 2, ['2:2', '3:4']]);
  });

  test('read() returns the CACHE without recomputing — undefined before first eval, stale after invalidation', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      let calls = 0;
      const c = rt.__computed(() => { calls++; return s.value * 2; });
      const before = [c.read(), calls];
      c.value;
      s.value = 5;
      return [before, [c.read(), calls]];
    })).toEqual([[undefined, 0], [2, 1]]);
  });

  test('lock() freezes the CACHE (locked reads skip recomputation — locked-before-first-read stays undefined); kill() returns the cache', () => {
    expect(both((rt) => {
      const s = rt.__state(2);
      let calls = 0;
      const c = rt.__computed(() => { calls++; return s.value * 3; });
      c.lock();
      const lockedFresh = [c.value, c.read(), calls];
      const c2 = rt.__computed(() => s.value + 1);
      c2.value;
      const killed = [c2.kill(), c2.value];
      return [lockedFresh, killed];
    })).toEqual([[undefined, undefined, 0], [3, 3]]);
  });

  test('a computed exception propagates to the reader, stays dirty, retries, recovers', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      let calls = 0;
      const c = rt.__computed(() => { calls++; if (s.read() === 1) throw new Error('cboom'); return s.read() * 2; });
      const first = caught(() => c.value);
      const retry = caught(() => c.value);
      s.value = 3;
      const recovered = c.value;
      return [first, retry, recovered, calls];
    })).toEqual([['throw', 'Error', 'cboom'], ['throw', 'Error', 'cboom'], 6, 3]);
  });

  test('a SELF-REFERENCING computed rejects precisely instead of recursing', () => {
    const outcome = both((rt) => {
      const c = rt.__computed(() => c.value + 1);
      return caught(() => c.value);
    });
    expect(outcome).toEqual([
      'throw', 'Error',
      'reactive runtime: computed value read during its own evaluation — recursive computed reads are not supported',
    ]);
  });

  test('a state write during a computed recompute notifies immediately (unbatched)', () => {
    expect(both((rt) => {
      const a = rt.__state(1), b = rt.__state(10);
      const c = rt.__computed(() => { b.value = a.value * 100; return a.value + 1; });
      const seen = [];
      rt.__effect(() => seen.push(b.value));
      return [c.value, b.read(), seen];
    })).toEqual([2, 100, [10, 100]]);
  });

  test('a computed that changes its own dependency rejects loudly, stays dirty, and retries', () => {
    const outcome = both((rt) => {
      const source = rt.__state(1);
      let runs = 0;
      const derived = rt.__computed(() => {
        runs++;
        const seen = source.value;
        if (seen === 1) source.value = 2;
        return seen;
      });
      const first = caught(() => derived.value);
      source.value = 2; // application state changes before the retry
      return [first, source.read(), derived.read(), derived.value, runs];
    });
    expect(outcome).toEqual([
      ['throw', 'Error',
        'reactive runtime: computed dependency changed during evaluation — computed functions must derive without writing or touching a dependency'],
      2, undefined, 2, 2,
    ]);
  });

  test('a state written before its first dependency read rejects; same-value writes are no-ops', () => {
    const outcome = both((rt) => {
      const changed = rt.__state(1);
      const impure = rt.__computed(() => {
        changed.value = 2;
        return changed.value;
      });
      const unchanged = rt.__state(1);
      const same = rt.__computed(() => {
        unchanged.value = 1;
        return unchanged.value;
      });
      return [caught(() => impure.value), changed.read(), same.value];
    });
    expect(outcome).toEqual([
      ['throw', 'Error',
        'reactive runtime: computed dependency changed during evaluation — computed functions must derive without writing or touching a dependency'],
      2,
      1,
    ]);
  });

  test('nested computed evaluation carries writes to the outer purity frame and restores after rejection', () => {
    const outcome = both((rt) => {
      const source = rt.__state(0);
      const inner = rt.__computed(() => source.value + 10);
      const outer = rt.__computed(() => {
        source.value = 1;
        return inner.value;
      });
      const first = caught(() => outer.value);
      const clean = rt.__computed(() => source.value + 1);
      return [first[0], source.read(), clean.value];
    });
    expect(outcome).toEqual(['throw', 1, 2]);
  });

  test('a computed may write state it never reads', () => {
    expect(both((rt) => {
      const side = rt.__state(0);
      const value = rt.__computed(() => {
        side.value = 2;
        return 7;
      });
      return [value.value, side.read()];
    })).toEqual([7, 2]);
  });

  test('a throwing self-invalidating computed publishes no stale value to an effect subscriber', () => {
    const outcome = both((rt) => {
      const source = rt.__state(1);
      const seen = [];
      const derived = rt.__computed(() => {
        const value = source.value;
        if (value === 1) source.value = 2;
        return value;
      });
      const creation = caught(() => rt.__effect(() => seen.push(derived.value)));
      source.value = 3; // the failed creation run disposed its subscription
      return [creation[0], seen, derived.read(), derived.value];
    });
    expect(outcome).toEqual(['throw', [], undefined, 3]);
  });

  test('nested computed tracking restores after dependency-mutation rejection', () => {
    const outcome = both((rt) => {
      const source = rt.__state(1);
      const inner = rt.__computed(() => {
        const value = source.value;
        if (value === 1) source.value = 2;
        return value;
      });
      const outer = rt.__computed(() => inner.value + 1);
      const first = caught(() => outer.value);
      source.value = 2;
      return [first[0], source.read(), outer.value];
    });
    expect(outcome).toEqual(['throw', 2, 3]);
  });

  test('dependency mutation rejects during an active notification rerun', () => {
    const outcome = both((rt) => {
      const source = rt.__state(0);
      let impure = false;
      const derived = rt.__computed(() => {
        const value = source.value;
        if (impure) source.value = value + 1;
        return value;
      });
      const seen = [];
      rt.__effect(() => seen.push(derived.value));
      impure = true;
      const write = caught(() => { source.value = 1; });
      impure = false;
      return [write[0], source.read(), derived.read(), seen, derived.value];
    });
    expect(outcome).toEqual(['throw', 1, 0, [0], 1]);
  });

  test('free() cannot hide a dependency mutation from a computing value', () => {
    const outcome = both((rt) => {
      const source = rt.__state(1);
      const derived = rt.__computed(() => {
        const value = source.value;
        source.free();
        source.value = 2;
        return value;
      });
      const first = caught(() => derived.value);
      source.value = 3;
      return [first[0], source.read(), derived.read(), caught(() => derived.value)[0]];
    });
    expect(outcome).toEqual(['throw', 3, undefined, 'throw']);
  });

  test('an unrelated write cannot re-enter a computed before it commits', () => {
    const outcome = both((rt) => {
      const source = rt.__state(0);
      const side = rt.__state(0);
      let write = false;
      const derived = rt.__computed(() => {
        const value = source.value;
        if (write) side.value = value + 1;
        return value;
      });
      const seen = [];
      rt.__effect(() => { side.value; seen.push(derived.value); });
      write = true;
      const update = caught(() => { source.value = 1; });
      write = false;
      const recovered = derived.value;
      source.value = 2;
      return [update[0], side.read(), recovered, seen, derived.read()];
    });
    expect(outcome).toEqual(['throw', 2, 1, [0, 2], 2]);
  });
});

describe('effect scheduling, batching, disposal', () => {
  test('effects flush in subscription order', () => {
    expect(both((rt) => {
      const s = rt.__state(0);
      const order = [];
      rt.__effect(() => { s.value; order.push('first'); });
      rt.__effect(() => { s.value; order.push('second'); });
      rt.__effect(() => { s.value; order.push('third'); });
      order.length = 0;
      s.value = 1;
      return order;
    })).toEqual(['first', 'second', 'third']);
  });

  test('a cascading write mid-flush flushes NESTED (depth-first), then the outer flush resumes', () => {
    expect(both((rt) => {
      const s1 = rt.__state(0), s2 = rt.__state(0);
      const order = [];
      rt.__effect(() => { s2.value; if (s2.read() > 0) order.push('C' + s2.read()); });
      rt.__effect(() => { const v = s1.value; if (v > 0) { order.push('A' + v); s2.value = v * 10; } });
      rt.__effect(() => { const v = s1.value; if (v > 0) order.push('B' + v); });
      order.length = 0;
      s1.value = 1;
      return order;
    })).toEqual(['A1', 'C10', 'B1']);
  });

  test('__batch: one flush at the end; nested batches join the outer one; the return value passes through', () => {
    expect(both((rt) => {
      const s1 = rt.__state(1), s2 = rt.__state(2);
      let runs = 0;
      rt.__effect(() => { runs++; s1.value; s2.value; });
      rt.__batch(() => { s1.value = 10; s2.value = 20; });
      const flat = runs;                // 1 initial + 1 flush
      const s3 = rt.__state(0);
      let nruns = 0;
      rt.__effect(() => { nruns++; s3.value; });
      rt.__batch(() => { rt.__batch(() => { s3.value = 1; }); s3.value = 2; });
      return [flat, nruns, rt.__batch(() => 42)];
    })).toEqual([2, 2, 42]);
  });

  test('a batch body that throws still flushes (finally) and the exception propagates', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      let runs = 0;
      rt.__effect(() => { runs++; s.value; });
      const t = caught(() => rt.__batch(() => { s.value = 2; throw new Error('batchboom'); }));
      return [t, runs];
    })).toEqual([['throw', 'Error', 'batchboom'], 2]);
  });

  test('a write to the state whose flush is running is DROPPED (the reentrancy guard)', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      const seen = [];
      // The creation run writes 2 (guard off — not inside s's flush);
      // the flushed run's write of 3 is dropped.
      rt.__effect(() => { seen.push(s.value); if (s.value < 3) s.value = s.value + 1; });
      const settled = [seen.slice(), s.read()];
      s.value = 10;
      return [settled, seen, s.read()];
    })).toEqual([[[1, 2], 2], [1, 2, 10], 10]);
  });

  test('dispose: unsubscribes, is idempotent, and runs the pending cleanup', () => {
    expect(both((rt) => {
      const s = rt.__state(1);
      const seen = [];
      const dispose = rt.__effect(() => { const v = s.value; seen.push('run' + v); return () => seen.push('clean' + v); });
      s.value = 2;
      dispose();
      dispose();                        // idempotent
      s.value = 3;                      // no re-run
      return seen;
    })).toEqual(['run1', 'clean1', 'run2', 'clean2']);
  });

  test('an effect disposed mid-flush by an earlier effect never runs (the zombie guard)', () => {
    expect(both((rt) => {
      const s = rt.__state(0);
      const order = [];
      let disposeB;
      rt.__effect(() => { s.value; if (s.read() > 0) { order.push('A'); disposeB(); } });
      disposeB = rt.__effect(() => { s.value; if (s.read() > 0) order.push('B'); });
      order.length = 0;
      s.value = 1;
      return order;
    })).toEqual(['A']);
  });

  test('nested effects: the inner is a sibling, not owned — an outer re-run creates a SECOND live inner', () => {
    expect(both((rt) => {
      const outer = rt.__state(1), inner = rt.__state(10);
      const seen = [];
      rt.__effect(() => { const o = outer.value; rt.__effect(() => seen.push(`o${o}-i${inner.value}`)); });
      outer.value = 2;
      inner.value = 11;                 // BOTH inners re-run
      return seen;
    })).toEqual(['o1-i10', 'o2-i10', 'o1-i11', 'o2-i11']);
  });

  test('an effect that throws on its creation run propagates to the creator', () => {
    // What SURVIVES the throw diverges: the battery below pins
    // the subscribed zombie beside the unsubscribed corpse.
    expect(both((rt) => {
      const s = rt.__state(1);
      let runs = 0;
      const t = caught(() => rt.__effect(() => { runs++; s.value; throw new Error('eboom'); }));
      return [t, runs];
    })).toEqual([['throw', 'Error', 'eboom'], 1]);
  });
});

describe('divergence: a creation run that READS then throws', () => {
  const scenario = (rt) => {
    const s = rt.__state(1);
    let runs = 0;
    const t = caught(() => rt.__effect(() => { runs++; s.value; throw new Error('eboom'); }));
    const w = caught(() => { s.value = 2; });
    return [t, w, runs];
  };

  test('the creation throw disposes the partial effect — dependencies unsubscribe, the write is clean', () => {
    expect(scenario(RT)).toEqual([
      ['throw', 'Error', 'eboom'],
      ['value', undefined],
      1,
    ]);
  });

  test('GPT repro: dependency-read-then-throw under a FRAME — disposal has nothing to remove and the write does not re-fire', () => {
    const { __state, __effect, __ownerFrame, __pushOwner, __popOwner } = v4mod;
    const s = __state(1);
    let runs = 0;
    const frame = __ownerFrame({ nested: false });
    const tok = __pushOwner(frame);
    try {
      expect(() => __effect(() => { runs++; s.value; throw new Error('boom'); })).toThrow('boom');
    } finally { __popOwner(tok); }
    frame.dispose();                   // nothing was registered — and nothing leaks anyway
    s.value = 2;
    expect(runs).toBe(1);
  });
});

describe('async effects: signals, cleanup routing', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('getEffectSignal: null outside an effect; a live AbortSignal inside', async () => {
    expect(await bothAsync(async (rt) => {
      const outside = rt.getEffectSignal();
      let kind = null, aborted = null;
      rt.__effect(() => { const sig = rt.getEffectSignal(); kind = sig.constructor.name; aborted = sig.aborted; });
      return [outside, kind, aborted];
    })).toEqual([null, 'AbortSignal', false]);
  });

  test('the signal aborts on re-run and on dispose', async () => {
    expect(await bothAsync(async (rt) => {
      const s = rt.__state(1);
      const events = [];
      const dispose = rt.__effect(() => {
        const v = s.value;
        rt.getEffectSignal().addEventListener('abort', () => events.push('abort' + v));
      });
      s.value = 2;
      dispose();
      return events;
    })).toEqual(['abort1', 'abort2']);
  });

  test('an async body\'s cleanup is stored on resolution and runs on the next re-run', async () => {
    expect(await bothAsync(async (rt) => {
      const s = rt.__state(1);
      const seen = [];
      rt.__effect(() => {
        const v = s.value;
        return (async () => { await tick(); seen.push('body' + v); return () => seen.push('clean' + v); })();
      });
      await tick(); await tick();
      s.value = 2;
      await tick(); await tick();
      return seen;
    })).toEqual(['body1', 'clean1', 'body2']);
  });

  test('a SUPERSEDED run\'s late cleanup runs immediately and is never stored', async () => {
    expect(await bothAsync(async (rt) => {
      const s = rt.__state(1);
      const seen = [];
      const resolvers = [];
      rt.__effect(() => {
        const v = s.value;
        return new Promise((res) => resolvers.push(() => res(() => seen.push('clean' + v))));
      });
      s.value = 2;             // supersedes run 1 while it is pending
      resolvers[0]();          // run 1 resolves late with its cleanup
      await tick();
      const afterStale = seen.slice();
      resolvers[1]();          // run 2's cleanup stores normally…
      await tick();
      s.value = 3;             // …and runs on the next re-run
      await tick();
      return [afterStale, seen];
    })).toEqual([['clean1'], ['clean1', 'clean2']]);
  });

  test('disposed while awaiting: the resolution\'s cleanup runs immediately', async () => {
    expect(await bothAsync(async (rt) => {
      const s = rt.__state(1);
      const seen = [];
      let resolve;
      const dispose = rt.__effect(() => {
        s.value;
        return new Promise((res) => { resolve = () => res(() => seen.push('clean')); });
      });
      dispose();
      resolve();
      await tick();
      return seen;
    })).toEqual(['clean']);
  });

  test('an AbortError rejection from an async body is swallowed silently', async () => {
    expect(await bothAsync(async (rt) => {
      const s = rt.__state(1);
      rt.__effect(() => {
        s.value;
        return Promise.reject(Object.assign(new Error('nope'), { name: 'AbortError' }));
      });
      await tick();
      return 'no crash';
    })).toBe('no crash');
  });
});

describe('error routing', () => {
  test('__catchErrors routes sync throws to the handler (undefined return); this/args preserved', () => {
    expect(both((rt) => {
      const seen = [];
      rt.__setErrorHandler((e) => seen.push('handled:' + e.message));
      const f = rt.__catchErrors((x) => { if (x) throw new Error('bad'); return 'ok'; });
      const obj = { v: 7, m: rt.__catchErrors(function (a) { return this.v + a; }) };
      const out = [f(false), f(true), seen.slice(), obj.m(1)];
      rt.__setErrorHandler(null);
      return out;
    })).toEqual(['ok', undefined, ['handled:bad'], 8]);
  });

  test('__handleError: rethrows with no handler; __setErrorHandler returns the previous handler', () => {
    expect(both((rt) => {
      const t = caught(() => rt.__handleError(new Error('raw')));
      const h = () => {};
      const p1 = rt.__setErrorHandler(h);
      const p2 = rt.__setErrorHandler(null);
      return [t, p1, p2 === h];
    })).toEqual([['throw', 'Error', 'raw'], null, true]);
  });

  test('__readonly: a frozen {value} wrapper — no read(), no tracking, shallow', () => {
    expect(both((rt) => {
      const r = rt.__readonly(5);
      const nested = rt.__readonly({ a: 1 });
      nested.value.a = 2;                       // freeze is shallow
      return [r.value, Object.isFrozen(r), 'read' in r, nested.value.a];
    })).toEqual([5, true, false, 2]);
  });
});

// ════════════════════════════════════════════════════════════════════
// The owner-frame seam: effect ownership as module state.
// the old runtime has no counterpart mechanism — its ownership is the globalThis
// component bridge the  record excluded — so these are
// this side-shape tests; the cross-runtime behavioral agreement (frame
// disposal vs the _disposers walk) lives in the component paired
// tier (test/runtime-components.test.js).
// ════════════════════════════════════════════════════════════════════

describe('the owner-frame seam (M12-A)', () => {
  const { __state, __effect, __ownerFrame, __pushOwner, __popOwner } = v4mod;

  test('effects created under a current frame register; frame disposal disposes them in registration order', () => {
    const s = __state(0);
    const log = [];
    const frame = __ownerFrame();
    const prev = __pushOwner(frame);
    try {
      __effect(() => { const v = s.value; log.push('A' + v); return () => log.push('cleanA'); });
      __effect(() => { const v = s.value; log.push('B' + v); return () => log.push('cleanB'); });
    } finally { __popOwner(prev); }
    s.value = 1;                       // re-runs fire each effect's own cleanup first
    frame.dispose();
    s.value = 2;                       // nothing re-runs
    expect(log).toEqual(['A0', 'B0', 'cleanA', 'A1', 'cleanB', 'B1', 'cleanA', 'cleanB']);
    expect(frame.disposed).toBe(true);
  });

  test('effects created OUTSIDE any frame register nowhere (the M9-A free-effect behavior is unchanged)', () => {
    const s = __state(0);
    let runs = 0;
    const dispose = __effect(() => { runs++; s.value; });
    s.value = 1;
    expect(runs).toBe(2);
    dispose();
  });

  test('frames NEST: a child frame created under a parent rides the parent\'s disposal', () => {
    const s = __state(0);
    const log = [];
    const parent = __ownerFrame();
    const prevP = __pushOwner(parent);
    let child;
    try {
      __effect(() => { s.value; return () => log.push('parent-effect-clean'); });
      child = __ownerFrame();
      const prevC = __pushOwner(child);
      try {
        __effect(() => { s.value; return () => log.push('child-effect-clean'); });
      } finally { __popOwner(prevC); }
    } finally { __popOwner(prevP); }
    parent.dispose();
    expect(log).toEqual(['parent-effect-clean', 'child-effect-clean']);
    expect(child.disposed).toBe(true);
  });

  test('a child frame disposed EARLY detaches from its parent — long-lived parents stay FLAT under patch churn', () => {
    // Render factories create one nested frame per p() patch; without
    // the detach a long-lived component accumulates one dead closure
    // per patch, unbounded. `size` is the harness-facing count.
    const parent = __ownerFrame();
    const prevP = __pushOwner(parent);
    try {
      const base = parent.size;
      for (let i = 0; i < 500; i++) {
        const child = __ownerFrame();
        const prevC = __pushOwner(child);
        try {
          __effect(() => {});
        } finally { __popOwner(prevC); }
        child.dispose();
      }
      expect(parent.size).toBe(base);
    } finally { __popOwner(prevP); }
    parent.dispose();
    expect(parent.size).toBe(0);
  });

  test('a child frame disposed EARLY is a no-op when the parent later unwinds (idempotent)', () => {
    const s = __state(0);
    const log = [];
    const parent = __ownerFrame();
    const prevP = __pushOwner(parent);
    let child;
    try {
      child = __ownerFrame();
      const prevC = __pushOwner(child);
      try {
        __effect(() => { s.value; return () => log.push('child-clean'); });
      } finally { __popOwner(prevC); }
    } finally { __popOwner(prevP); }
    child.dispose();                   // the block tore down first
    child.dispose();                   // idempotent
    expect(log).toEqual(['child-clean']);
    parent.dispose();                  // must not re-run the child's disposers
    expect(log).toEqual(['child-clean']);
  });

  test('a NON-nested frame ({nested: false}) never rides an enclosing frame', () => {
    const log = [];
    const outer = __ownerFrame();
    const prev = __pushOwner(outer);
    let inner;
    try {
      inner = __ownerFrame({ nested: false });
      inner.add(() => log.push('inner'));
    } finally { __popOwner(prev); }
    outer.dispose();
    expect(log).toEqual([]);           // inner survives the outer's death
    inner.dispose();
    expect(log).toEqual(['inner']);
  });

  test('a disposer added AFTER disposal runs immediately (the frame\'s lifetime is over)', () => {
    const log = [];
    const frame = __ownerFrame();
    frame.dispose();
    frame.add(() => log.push('late'));
    expect(log).toEqual(['late']);
  });

  test('a throwing disposer reports through the effect-error reporter and the rest still run', () => {
    const seen = [];
    const prevReporter = v4mod.__setEffectErrorReporter((label, err) => seen.push([label, err.message]));
    try {
      const log = [];
      const frame = __ownerFrame();
      frame.add(() => { throw new Error('d1 boom'); });
      frame.add(() => log.push('d2'));
      frame.dispose();
      expect(log).toEqual(['d2']);
      expect(seen).toEqual([['[Rip] effect disposer error:', 'd1 boom']]);
    } finally {
      v4mod.__setEffectErrorReporter(prevReporter);
    }
  });

  test('an effect whose CREATION RUN throws registers nothing on the frame', () => {
    const frame = __ownerFrame();
    const prev = __pushOwner(frame);
    const log = [];
    try {
      expect(() => __effect(() => { throw new Error('creation boom'); })).toThrow('creation boom');
      __effect(() => { log.push('ok'); });
    } finally { __popOwner(prev); }
    frame.dispose();                   // exactly one registered disposer, no throw
    expect(log).toEqual(['ok']);
  });

  test('push/pop is TOKEN-validated: out-of-order and repeated pops reject loudly; proper nesting restores exactly', () => {
    const a = __ownerFrame({ nested: false });
    const b = __ownerFrame({ nested: false });
    const ta = __pushOwner(a);
    const tb = __pushOwner(b);
    // Popping the OUTER token while the inner is still current is the
    // orphaning bug the validation exists for.
    expect(() => __popOwner(ta)).toThrow('__popOwner out of order');
    __popOwner(tb);
    // Restoration is exact: a is current again — an effect registers on it.
    const log = [];
    __effect(() => { log.push('run'); return () => log.push('clean'); });
    __popOwner(ta);
    expect(() => __popOwner(tb)).toThrow('__popOwner out of order');   // already popped
    expect(() => __popOwner(null)).toThrow('takes the token');
    expect(() => __popOwner(a)).toThrow('takes the token');            // a frame is not a token
    a.dispose();
    expect(log).toEqual(['run', 'clean']);
  });

  test('GPT repro: an effect created during an owned effect\'s RE-run lands on the owning frame (the creation-time owner restores per run)', () => {
    const s = __state(0);
    const inner = __state(0);
    const log = [];
    const frame = __ownerFrame({ nested: false });
    const tok = __pushOwner(frame);
    __effect(() => {
      const v = s.value;
      if (v > 0) __effect(() => { inner.value; log.push('nested' + v); });
    });
    __popOwner(tok);
    // The re-run arrives from this write — NO owner is current here;
    // the nested effect must still land on the frame.
    s.value = 1;
    expect(log).toEqual(['nested1']);
    frame.dispose();
    inner.value = 1;                   // must NOT re-fire past disposal
    expect(log).toEqual(['nested1']);
  });

  test('a nested frame created during a RE-run rides the owning frame too', () => {
    const s = __state(0);
    const log = [];
    const frame = __ownerFrame({ nested: false });
    const tok = __pushOwner(frame);
    __effect(() => {
      if (s.value > 0) {
        const child = __ownerFrame();  // nests onto the restored owner
        child.add(() => log.push('child-disposed'));
      }
    });
    __popOwner(tok);
    s.value = 1;
    frame.dispose();
    expect(log).toEqual(['child-disposed']);
  });
});

describe('__detachRef', () => {
  test('clears the cell only while it still holds THIS element, notifying subscribers', () => {
    expect(both((rt) => {
      const el = { tag: 'div' };
      const cell = rt.__state(el);
      const seen = [];
      rt.__effect(() => seen.push(cell.value === null ? 'null' : 'el'));
      rt.__detachRef(cell, el);
      return [seen, cell.read()];
    })).toEqual([['el', 'null'], null]);
  });

  test('a cell already pointing ELSEWHERE (keyed move, re-render) is not clobbered', () => {
    expect(both((rt) => {
      const oldEl = { tag: 'a' }, newEl = { tag: 'b' };
      const cell = rt.__state(oldEl);
      cell.value = newEl;
      rt.__detachRef(cell, oldEl);     // stale detach: no-op
      return cell.read() === newEl;
    })).toBe(true);
  });

  test('the read is NON-tracking: detaching inside an effect subscribes nothing', () => {
    expect(both((rt) => {
      const el = { tag: 'div' };
      const cell = rt.__state(el);
      const trigger = rt.__state(0);
      let runs = 0;
      rt.__effect(() => { runs++; trigger.value; rt.__detachRef(cell, { other: true }); });
      cell.value = null;               // if the detach read tracked, this would re-run the effect
      return runs;
    })).toBe(1);
  });

  test('null and non-cell arguments are harmless no-ops', () => {
    expect(both((rt) => {
      rt.__detachRef(null, {});
      rt.__detachRef({ notACell: true }, {});
      return 'ok';
    })).toBe('ok');
  });
});

// ════════════════════════════════════════════════════════════════════
// The divergence: a pinned defect (verified against the reference here)
// ════════════════════════════════════════════════════════════════════

describe('divergence: a throwing flush must not brick the state', () => {
  const scenario = (rt) => {
    const s = rt.__state(1);
    let runs = 0;
    rt.__effect(() => { runs++; if (s.value === 2) throw new Error('boom'); });
    const first = caught(() => { s.value = 2; });
    const second = caught(() => { s.value = 3; });
    const third = caught(() => { s.touch(); });
    return [first, second, third, runs, s.read()];
  };

  test('the guard restores — the exception still propagates, later writes notify again', () => {
    expect(scenario(RT)).toEqual([
      ['throw', 'Error', 'boom'],
      ['value', undefined],      // write of 3 lands; its effect run returns normally
      ['value', undefined],      // touch notifies; the run returns normally
      4, 3,
    ]);
  });

  test('both: effects still pending in an aborted flush snapshot are dropped (pinned as-is)', () => {
    // The abandonment itself is shared behavior — the flush loop stops
    // at the throwing effect and the snapshot's tail never runs. (In
    // this BATCHED case the flush runs from __batch's finally, outside
    // any state's notify window, so no state bricks in the old runtime either and a
    // later notify re-queues the dropped tail in both runtimes; the
    // unbatched sibling facet below is where recovery diverges.)
    expect(both((rt) => {
      const s = rt.__state(1);
      const seen = [];
      rt.__effect(() => { if (s.value === 2) { seen.push('A-throw'); throw new Error('A'); } seen.push('A' + s.value); });
      rt.__effect(() => { seen.push('B' + s.value); });
      const t = caught(() => rt.__batch(() => { s.value = 2; }));
      return [t, seen];
    })).toEqual([['throw', 'Error', 'A'], ['A1', 'B1', 'A-throw']]);
  });

  test('sibling facet: an UNBATCHED throw drops the sibling too — the next write resurrects it', () => {
    // The dropped sibling B is not merely skipped once: in the old runtime the
    // bricked state can never notify again, so B is dead FOREVER; in
    // this side the next write re-queues it.
    const scenario = (rt) => {
      const s = rt.__state(1);
      const seen = [];
      rt.__effect(() => { if (s.value === 2) throw new Error('boom'); seen.push('A' + s.read()); });
      rt.__effect(() => { seen.push('B' + s.value); });
      const first = caught(() => { s.value = 2; });
      const second = caught(() => { s.value = 3; });
      return [first, second, seen, s.read()];
    };
    expect(scenario(RT)).toEqual([
      ['throw', 'Error', 'boom'],
      ['value', undefined],
      // The write re-queues BOTH. B now runs FIRST: A's throwing
      // re-run removed and re-added it to the subscriber set (the
      // per-run re-track), moving it behind B in insertion order.
      ['A1', 'B1', 'B3', 'A3'], 3,
    ]);
  });

  test('cascade facet: a throw inside a NESTED flush bricks every state whose notify is on the stack — the next write restores them all', () => {
    // s1's effect writes s2 unbatched, so s2's flush runs INSIDE s1's
    // notify window; the inner throw unwinds through both guards.
    const scenario = (rt) => {
      const s1 = rt.__state(0), s2 = rt.__state(0);
      const seen = [];
      rt.__effect(() => { s2.value; if (s2.read() === 1) throw new Error('inner'); seen.push('C' + s2.read()); });
      rt.__effect(() => { const v = s1.value; if (v > 0) s2.value = v; });
      const first = caught(() => { s1.value = 1; });   // cascades to s2=1 → the inner effect throws
      const w2 = caught(() => { s2.value = 5; });
      const w1 = caught(() => { s1.value = 7; });
      return [first, w2, w1, seen, s1.read(), s2.read()];
    };
    expect(scenario(RT)).toEqual([
      ['throw', 'Error', 'inner'],
      ['value', undefined], ['value', undefined],
      ['C0', 'C5', 'C7'], 7, 7,                        // both guards restored
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// delivery: the seam's second customer, via hand-written references
// ════════════════════════════════════════════════════════════════════

const REACTIVE_IMPORT = /^import \{ __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal \} from ".*src\/runtime\/reactive\.js";$/;

describe('runtime delivery: the reactive runtime', () => {
  const SRC = 'n = __state(1)\nstop = __effect(-> console.log(n.value))\nn.value = 7\nstop()';

  test("emit() default is 'none': undecorated output, the runtime USE still reported", () => {
    const { code, runtimes } = compile(SRC);
    expect(code).not.toContain('import');
    expect([...runtimes]).toEqual(['reactive']);
  });

  test("'import' injects ONE import of the shared module, mapped synthetic", () => {
    const { code, mappings, runtimes } = compile(SRC, { runtimeDelivery: 'import' });
    expect(code.split('\n')[0]).toMatch(REACTIVE_IMPORT);
    expect([...runtimes]).toEqual(['reactive']);
    const row = mappings.rows.find((r) => r.role === 'runtime');
    expect(row.mappingKind).toBe('synthetic');
    expect(row.sourceStart).toBe(row.sourceEnd);
    expect(row.generatedStart).toBe(0);
    expect(code.slice(row.generatedStart, row.generatedEnd)).toContain('import { __state');
    expect(mappings.serializableRows().some((r) => r.role === 'runtime')).toBe(false);
  });

  test("'inline' emits the runtime ONCE, IIFE-wrapped, and it RUNS standalone", () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    expect(code.startsWith('const { __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal } = (() => {')).toBe(true);
    expect((code.match(/__RIP_REACTIVE_SENTINEL/g) ?? []).length).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), 'rip-reactive-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      const r = spawnSync('bun', [join(dir, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['1', '7']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the sentinel: two standalone copies in one process reject loudly', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-rsentinel-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'two.js'), code);
      writeFileSync(join(dir, 'main.js'), `import './one.js';\nimport './two.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip reactive runtime');
      expect(r.stderr).toContain('rip CLI/loader');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the sentinel: a standalone copy meeting the shared module rejects too', () => {
    const { code } = compile(SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-rsentinel2-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'main.js'), `import ${JSON.stringify(RT_PATH)};\nimport './one.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip reactive runtime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every delivered name triggers alone — getEffectSignal included (the global  published is a NAME here)', () => {
    for (const src of [
 's = __state(1)',
 'c = __computed(-> 2)',
 'd = __effect(-> 1)',
 '__batch(-> 1)',
 'r = __readonly(5)',
 '__setErrorHandler((e) -> log(e))',
 '__handleError(err)',
 'f = __catchErrors(g)',
 'sig = getEffectSignal()',
    ]) {
      const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
      expect([...runtimes]).toEqual(['reactive']);
      expect(code.split('\n')[0]).toMatch(REACTIVE_IMPORT);
    }
  });

  test('program-scope shadowing suppresses injection per name; all bound → nothing injects', () => {
    const a = compile('__state = (v) => v\nn = __state(1)\nd = __effect(-> n)', { runtimeDelivery: 'import' });
    expect(a.code.split('\n')[0]).toMatch(/^import \{ __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal \} from/);
    const allBound = ['__state', '__computed', '__effect', '__batch', '__readonly', '__setErrorHandler', '__handleError', '__catchErrors', 'getEffectSignal']
      .map((n) => `${n} = 1`).join('\n') + '\nx = __state';
    const b = compile(allBound, { runtimeDelivery: 'import' });
    expect(b.code).not.toContain('runtime/reactive.js');
    expect([...b.runtimes]).toEqual([]);
  });

  test('function-scope shadowing does NOT suppress module-level injection', () => {
    const { code } = compile('f = ->\n  __state = 1\n  __state\nn = __state(2)', { runtimeDelivery: 'import' });
    expect(code.split('\n')[0]).toMatch(REACTIVE_IMPORT);
  });

  test('NAME occurrences that are not references never trigger', () => {
    for (const src of [
 'x = obj.__state',
 'x = obj?.getEffectSignal',
 'x = {__effect: 1, __batch: 2}',
 'x = "__state getEffectSignal __computed"',
 'f = ({__state}) -> 1',
 'import { __state } from "./mine.js"\nn = __state(1)',
    ]) {
      const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
      expect(code).not.toContain('runtime/reactive.js');
      expect([...runtimes]).toEqual([]);
    }
  });

  test('BOTH runtimes in one module: two injections, table order (schema, then reactive), and the pair RUNS', () => {
    const src = 'S = schema\n  a! integer\nn = __state(S.parse({a: 4}).a)\nconsole.log(n.read())';
    const imp = compile(src, { runtimeDelivery: 'import' });
    const [l0, l1] = imp.code.split('\n');
    expect(l0).toMatch(/^import \{ __schema, SchemaError, registerCoercer \} from ".*src\/runtime\/schema\.js";$/);
    expect(l1).toMatch(REACTIVE_IMPORT);
    expect([...imp.runtimes]).toEqual(['schema', 'reactive']);
    const inl = compile(src, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-both-'));
    try {
      writeFileSync(join(dir, 'both.js'), inl.code);
      const r = spawnSync('bun', [join(dir, 'both.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path end to end: a .rip file with hand-written references runs through the shared module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-loaderpath-'));
    try {
      writeFileSync(join(dir, 'main.rip'), 'counter = __state(10)\nstop = __effect(-> console.log("saw " + counter.value))\ncounter.value = 11\nstop()\n');
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['saw 10', 'saw 11']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// zero-cost: reactive-free files carry no reactive bytes
// ════════════════════════════════════════════════════════════════════

describe('zero-cost gate: the reactive extension', () => {
  test('a reactive-free program compiles byte-identical under every delivery mode', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = compile('x = 1 + 2\nf = (a) -> a * x', { runtimeDelivery: mode });
      expect(code).toBe('let x = 1 + 2;\nlet f = function(a) {\n  return (a * x);\n};');
      expect([...runtimes]).toEqual([]);
      expect(code).not.toContain('__state');
      expect(code).not.toContain('reactive');
    }
    const full = fullCompile('x = 1 + 2');
    expect(full.code).toBe('let x = 1 + 2;');
    expect([...full.runtimes]).toEqual([]);
  });

  test('a schema-using file stays reactive-free (and vice versa) — runtimes deliver independently', () => {
    const s = compile('S = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(s.code).not.toContain('runtime/reactive.js');
    expect([...s.runtimes]).toEqual(['schema']);
    const r = compile('n = __state(1)', { runtimeDelivery: 'import' });
    expect(r.code).not.toContain('runtime/schema.js');
    expect([...r.runtimes]).toEqual(['reactive']);
  });
});

// ════════════════════════════════════════════════════════════════════
// Scaling gates: the runtime's own complexity
// ════════════════════════════════════════════════════════════════════

describe('runtime scaling', () => {
  const { __state, __computed, __effect, __batch } = v4mod;

  test('N states, one effect each: writing every state is linear in N', () => {
    expectLinearDoubling({
      prepare: (n) => {
        const cells = [];
        for (let i = 0; i < n; i++) {
          const s = __state(0);
          __effect(() => s.value);
          cells.push(s);
        }
        return cells;
      },
      run: (cells) => { for (const s of cells) s.value = s.read() + 1; },
      sizes: [2000, 4000, 8000],
    });
  });

  test('N effects on ONE state: a write notifies linearly (the flush loop is O(pending))', () => {
    expectLinearDoubling({
      prepare: (n) => {
        const s = __state(0);
        for (let i = 0; i < n; i++) __effect(() => s.value);
        return s;
      },
      run: (s) => { for (let k = 0; k < 5; k++) s.value = s.read() + 1; },
      sizes: [2000, 4000, 8000],
    });
  });

  test('one effect reading N states: each re-run re-tracks linearly (dependency clearing is O(deps))', () => {
    // The run is BATCHED by necessity, not convenience: N unbatched
    // fan-in writes cost N re-runs × O(N) re-tracking each —
    // quadratic BY DESIGN (every write flushes synchronously), and
    // exactly the shape __batch exists to collapse into one flush.
    expectLinearDoubling({
      prepare: (n) => {
        const states = Array.from({ length: n }, () => __state(1));
        __effect(() => { let sum = 0; for (const s of states) sum += s.value; return undefined; });
        return states;
      },
      run: (states) => __batch(() => { for (let k = 0; k < 3; k++) states[k].value += 1; }),
      sizes: [2000, 4000, 8000],
    });
  });

  test('a width-N diamond (one state → N computeds → one effect): a write propagates linearly', () => {
    expectLinearDoubling({
      prepare: (n) => {
        const a = __state(1);
        const mids = Array.from({ length: n }, (_, i) => __computed(() => a.value + i));
        __effect(() => { let sum = 0; for (const m of mids) sum += m.value; return undefined; });
        return a;
      },
      run: (a) => { a.value += 1; },
      sizes: [2000, 4000, 8000],
    });
  });

  test('a depth-N computed chain: invalidation and recomputation walk the chain linearly', () => {
    expectLinearDoubling({
      prepare: (n) => {
        const a = __state(1);
        let tip = __computed(() => a.value + 1);
        for (let i = 1; i < n; i++) {
          const prev = tip;
          tip = __computed(() => prev.value + 1);
        }
        __effect(() => tip.value);
        return a;
      },
      run: (a) => { for (let k = 0; k < 10; k++) a.value += 1; },
      sizes: [500, 1000, 2000],
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// The surface stays out of reach until +
// ════════════════════════════════════════════════════════════════════

describe('the reactive language surface is not reachable', () => {
  test('FLIPPED (M9-B/M9-C): the reactive triad is the shipped surface — `:=`, `~=`, and `~>` all lower', () => {
    expect(compile('x := 5').code).toBe('const x = __state(5);');
    expect(compile('x ~= a + b').code).toBe('const x = __computed(() => (a + b));');
    expect(compile('~> f()').code).toBe('__effect(() => { f(); });');
    expect(compile('handle ~> f()').code).toBe('const handle = __effect(() => { f(); });');
  });

  test('FLIPPED: adjacent `=!` is the readonly declaration; spaced `= !` keeps assignment-of-negation', () => {
    expect(compile('x =! 5').code).toBe('const x = 5;');
    expect(compile('x = !5').code).toBe('let x = !5;');
    // `<~` is a comparison against bitwise-not — the components-era
    // gate wave owns any re-lexing.
    expect(compile('x <~ load()').code).toBe('x < (~load());');
  });
});
