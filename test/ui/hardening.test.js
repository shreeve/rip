// Defensive hardening pins for the reactive + component runtimes. Each
// asserts the CORRECT behavior for a place where observed behavior
// diverged from the documented contract: it fails against the pre-fix
// code and passes once the fix lands. Uses the recording DOM — no real
// browser, no network.
import { test, expect, describe } from 'bun:test';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';

installRecordingDOM();

import * as reactive from '../../src/runtime/reactive.js';
import * as comp from '../../src/runtime/components.js';

const { __state, __computed, __effect } = reactive;
const { __Component, __transition } = comp;

describe('computed recomputes when a dependency changes during its own computation', () => {
  test('a dependency mutated inside the getter leaves the computed dirty, not stale', () => {
    const source = __state(1);
    let runs = 0;
    const derived = __computed(() => {
      runs++;
      const seen = source.value;
      if (seen === 1) source.value = 2; // mutate a dependency mid-compute
      return seen;
    });
    const first = derived.value;   // reads 1, bumps source to 2
    const second = derived.value;  // must recompute — the cached 1 is stale
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(runs).toBe(2);
  });
});

describe('a failed mount does not leak effects', () => {
  test('an effect created before _create throws stops reacting after the caught failure', () => {
    const trigger = __state(0);
    const log = [];
    class Broken extends __Component {
      _create() {
        __effect(() => log.push(trigger.value));
        throw new Error('create failed');
      }
    }
    Broken.__props = [];
    try { new Broken().mount({ appendChild() {} }); }
    catch { /* the mount failure is reported; the instance is inert */ }
    trigger.value = 1;
    // The pre-throw effect was disposed with the partial owner frame,
    // so the post-failure write reaches nothing.
    expect(log).toEqual([0]);
  });
});

describe('a live component cannot be mounted twice', () => {
  test('a second mount rejects instead of stranding the first tree', () => {
    class C extends __Component {
      _create() { return document.createElement('p'); }
    }
    C.__props = [];
    const a = document.createElement('main');
    const b = document.createElement('main');
    const c = new C();
    c.mount(a);
    expect(() => c.mount(b)).toThrow(/already mounted/i);
    // The first tree is intact; the second target was never touched.
    expect(serialize(a)).toBe('<main><p></p></main>');
    expect(serialize(b)).toBe('<main></main>');
  });
});

describe('a transition completes only on its OWN element\'s transitionend', () => {
  test('a bubbled descendant transitionend does not finish the parent transition', async () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    let done = 0;
    __transition(parent, 'fade', 'leave', () => done++);
    await new Promise((r) => setTimeout(r, 10));
    child.dispatchEvent({ type: 'transitionend', bubbles: true, target: child });
    // The descendant's event must not complete the parent's transition.
    expect(done).toBe(0);
    parent.dispatchEvent({ type: 'transitionend', bubbles: true, target: parent });
    expect(done).toBe(1);
  });
});
