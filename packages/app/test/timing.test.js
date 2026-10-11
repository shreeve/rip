import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { delay, debounce, throttle, hold } from 'rip/app';
import { __state } from '../../../src/runtime/reactive.js';

// Every primitive schedules with setTimeout and throttle measures its
// window against Date.now(), so on the host clock a stall between steps
// or a timer answered late moves the edges. The fake clock advances only
// when a test advances it: every edge is asserted at its exact
// millisecond, and a timer that must not exist is counted.
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('delay', () => {
  test('truthy waits, falsy is immediate', () => {
    const flag = __state(false);
    const delayed = delay(20, flag);
    expect(delayed.value).toBeFalse();
    flag.value = true;
    expect(delayed.value).toBeFalse();
    jest.advanceTimersByTime(19);
    expect(delayed.value).toBeFalse();
    jest.advanceTimersByTime(1);
    expect(delayed.value).toBeTrue();
    flag.value = false;
    expect(delayed.value).toBeFalse();
    delayed.dispose();
  });

  test('a bounce inside the window never fires', () => {
    const flag = __state(false);
    const delayed = delay(25, flag);
    flag.value = true;
    jest.advanceTimersByTime(5);
    flag.value = false;
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(20);
    expect(delayed.value).toBeFalse();
    delayed.dispose();
  });

  test('the signal wrapper writes through to its source', () => {
    const flag = __state(false);
    const delayed = delay(10, flag);
    delayed.value = true;
    expect(flag.value).toBeTrue();
    delayed.dispose();
  });
});

describe('debounce', () => {
  test('only the last of a burst lands, after the window', () => {
    const query = __state('a');
    const settled = debounce(20, query);
    query.value = 'ab';
    jest.advanceTimersByTime(10);
    query.value = 'abc';
    expect(settled.value).toBe('a');
    jest.advanceTimersByTime(19);
    expect(settled.value).toBe('a');
    jest.advanceTimersByTime(1);
    expect(settled.value).toBe('abc');
    settled.dispose();
  });
});

describe('throttle', () => {
  test('changes inside the window coalesce; a quiet window restores the leading edge', () => {
    const y = __state(0);
    const smooth = throttle(30, y);
    y.value = 1;
    y.value = 2;
    y.value = 3;
    expect(smooth.value).toBe(0);
    jest.advanceTimersByTime(29);
    expect(smooth.value).toBe(0);
    jest.advanceTimersByTime(1);
    expect(smooth.value).toBe(3);
    jest.advanceTimersByTime(30);
    y.value = 4;
    expect(smooth.value).toBe(4);
    smooth.dispose();
  });
});

describe('hold', () => {
  test('rises immediately and outlives the fall by the window', () => {
    const saved = __state(false);
    const shown = hold(25, saved);
    saved.value = true;
    expect(shown.value).toBeTrue();
    saved.value = false;
    expect(shown.value).toBeTrue();
    jest.advanceTimersByTime(24);
    expect(shown.value).toBeTrue();
    jest.advanceTimersByTime(1);
    expect(shown.value).toBeFalse();
    shown.dispose();
  });
});

describe('disposal', () => {
  test('dispose clears the pending timer so no late write lands', () => {
    const flag = __state(false);
    const delayed = delay(15, flag);
    flag.value = true;
    delayed.dispose();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(15);
    expect(delayed.value).toBeFalse();
  });

  test('a function source returns the output signal itself with dispose', () => {
    const flag = __state(false);
    const delayed = delay(10, () => flag.value);
    expect(typeof delayed.read).toBe('function');
    expect(typeof delayed.dispose).toBe('function');
    flag.value = true;
    jest.advanceTimersByTime(9);
    expect(delayed.value).toBeFalse();
    jest.advanceTimersByTime(1);
    expect(delayed.value).toBeTrue();
    delayed.dispose();
  });
});

describe('timing reconciliation', () => {
  test('debounce and throttle timers die with dispose', () => {
    const q = __state('a');
    const settled = debounce(15, q);
    q.value = 'b';
    settled.dispose();
    const y = __state(0);
    const smooth = throttle(15, y);
    y.value = 1;
    y.value = 2;
    smooth.dispose();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(15);
    expect(settled.value).toBe('a');
    expect(smooth.value).toBe(0);
  });

  test('a function source is read-only and disposable for every primitive', async () => {
    const n = __state(0);
    const smooth = throttle(10, () => n.value);
    expect(() => { smooth.value = 9; }).toThrow();
    expect(smooth.value).toBe(0);
    smooth.dispose();
    const held = hold(10, () => n.value > 0);
    expect(() => { held.value = true; }).toThrow();
    held.dispose();
  });

  test('hold retriggers inside the fall window', () => {
    const saved = __state(false);
    const shown = hold(25, saved);
    saved.value = true;
    saved.value = false;
    jest.advanceTimersByTime(10);
    saved.value = true;
    jest.advanceTimersByTime(15);
    expect(shown.value).toBeTrue();
    saved.value = false;
    jest.advanceTimersByTime(24);
    expect(shown.value).toBeTrue();
    jest.advanceTimersByTime(1);
    expect(shown.value).toBeFalse();
    shown.dispose();
  });

  test('hold and debounce signal wrappers write through', () => {
    const flag = __state(false);
    const shown = hold(10, flag);
    shown.value = true;
    expect(flag.value).toBeTrue();
    shown.dispose();
    const q = __state('a');
    const settled = debounce(10, q);
    settled.value = 'b';
    expect(q.value).toBe('b');
    settled.dispose();
  });

  test('a risen delay ignores truthy churn', () => {
    const id = __state(0);
    const spinner = delay(15, id);
    id.value = 1;
    jest.advanceTimersByTime(14);
    expect(spinner.value).toBeFalse();
    jest.advanceTimersByTime(1);
    expect(spinner.value).toBeTrue();
    id.value = 2;
    expect(spinner.value).toBeTrue();
    expect(jest.getTimerCount()).toBe(0);
    spinner.dispose();
  });
});
