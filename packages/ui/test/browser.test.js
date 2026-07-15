// Browser interaction primitives -- unit coverage for the pure logic and
// the DOM-free dispatchers. Real-browser behavior (native top layer, actual
// focus movement, scroll-lock body writes, anchor feature detection, and
// the document/window listener wiring) awaits the Playwright harness; see
// the module docs and the PR's "browser-harness coverage" note.
import { test, expect, describe } from 'bun:test';
import {
  navAction, rovingIndex, listNav, rovingNav,
  outsideElements, popupGuard,
  parsePlacement, computePlacement, belowPosition,
  focusTrapMove, createScrollLock,
  combine, getRef,
} from '../browser/browser.rip';
import * as browser from '../browser/browser.rip';

const key = (k, extra = {}) => {
  const e = {
    key: k, isComposing: false, shiftKey: false, _prevented: false, _stopped: false,
    preventDefault() { this._prevented = true; },
    stopPropagation() { this._stopped = true; },
  };
  return Object.assign(e, extra);
};

describe('barrel surface', () => {
  test('exports exactly the interaction primitive surface', () => {
    expect(Object.keys(browser).sort()).toEqual([
      'belowPosition', 'bindDialog', 'bindPopover', 'combine', 'computePlacement',
      'createScrollLock', 'focusTrapMove', 'getRef', 'hasAnchor', 'listNav',
      'lockScroll', 'navAction', 'outsideElements', 'parsePlacement', 'popupDismiss',
      'popupGuard', 'position', 'positionBelow', 'rovingIndex', 'rovingNav',
      'trapFocus', 'unlockScroll', 'wireAria',
    ]);
    expect('default' in browser).toBeFalse();
  });
});

describe('navAction', () => {
  test('vertical list maps arrows, edges, activation, dismissal, typeahead', () => {
    expect(navAction('ArrowDown')).toBe('next');
    expect(navAction('ArrowUp')).toBe('prev');
    expect(navAction('ArrowRight')).toBeNull();
    expect(navAction('ArrowLeft')).toBeNull();
    expect(navAction('Home')).toBe('first');
    expect(navAction('PageUp')).toBe('first');
    expect(navAction('End')).toBe('last');
    expect(navAction('PageDown')).toBe('last');
    expect(navAction('Enter')).toBe('select');
    expect(navAction(' ')).toBe('select');
    expect(navAction('Escape')).toBe('dismiss');
    expect(navAction('a')).toBe('char');
    expect(navAction('Tab')).toBeNull();
    expect(navAction('F2')).toBeNull();
  });

  test('orientation gates the arrow axis', () => {
    expect(navAction('ArrowRight', 'horizontal')).toBe('next');
    expect(navAction('ArrowLeft', 'horizontal')).toBe('prev');
    expect(navAction('ArrowDown', 'horizontal')).toBeNull();
    expect(navAction('ArrowDown', 'both')).toBe('next');
    expect(navAction('ArrowRight', 'both')).toBe('next');
  });
});

describe('rovingIndex', () => {
  test('wraps next/prev by default', () => {
    expect(rovingIndex(0, 'next', 3)).toBe(1);
    expect(rovingIndex(2, 'next', 3)).toBe(0);
    expect(rovingIndex(0, 'prev', 3)).toBe(2);
    expect(rovingIndex(-1, 'next', 3)).toBe(0);
  });
  test('clamps when wrap is off', () => {
    expect(rovingIndex(2, 'next', 3, false)).toBe(2);
    expect(rovingIndex(0, 'prev', 3, false)).toBe(0);
  });
  test('first/last jump and empty/other actions are inert', () => {
    expect(rovingIndex(5, 'first', 3)).toBe(0);
    expect(rovingIndex(0, 'last', 3)).toBe(2);
    expect(rovingIndex(1, 'next', 0)).toBe(1);
    expect(rovingIndex(1, 'select', 3)).toBe(1);
  });
});

describe('listNav / rovingNav dispatch', () => {
  test('handled key prevents default, stops propagation, invokes handler', () => {
    let hit = 0;
    const e = key('ArrowDown');
    listNav(e, { next: () => hit++ });
    expect(hit).toBe(1);
    expect(e._prevented).toBeTrue();
    expect(e._stopped).toBeTrue();
  });
  test('a key with no handler keeps its default behavior', () => {
    const e = key('ArrowDown');
    listNav(e, {});
    expect(e._prevented).toBeFalse();
  });
  test('IME composition is ignored', () => {
    let hit = 0;
    listNav(key('ArrowDown', { isComposing: true }), { next: () => hit++ });
    expect(hit).toBe(0);
  });
  test('Tab forwards to tab handler without preventing default', () => {
    let tabbed = 0;
    const e = key('Tab');
    listNav(e, { tab: () => tabbed++ });
    expect(tabbed).toBe(1);
    expect(e._prevented).toBeFalse();
  });
  test('printable key drives typeahead without preventing default', () => {
    const seen = [];
    const e = key('x');
    listNav(e, { char: (c) => seen.push(c) });
    expect(seen).toEqual(['x']);
    expect(e._prevented).toBeFalse();
  });
  test('rovingNav honors orientation and never touches Tab', () => {
    let next = 0, tabbed = 0;
    rovingNav(key('ArrowRight'), { next: () => next++ }, 'horizontal');
    rovingNav(key('ArrowDown'), { next: () => next++ }, 'horizontal');
    rovingNav(key('Tab'), { tab: () => tabbed++ }, 'horizontal');
    expect(next).toBe(1);
    expect(tabbed).toBe(0);
  });
});

describe('outsideElements', () => {
  const el = (contains) => ({ contains: (t) => contains.includes(t) });
  test('true only when no element contains the target', () => {
    const target = 'T';
    expect(outsideElements(target, [el([]), el(['other'])])).toBeTrue();
    expect(outsideElements(target, [el(['T'])])).toBeFalse();
    expect(outsideElements(target, [null, undefined])).toBeTrue();
    expect(outsideElements(target, [])).toBeTrue();
  });
});

describe('popupGuard', () => {
  test('block opens a suppression window canOpen respects', () => {
    const guard = popupGuard();
    expect(guard.canOpen()).toBeTrue();
    guard.block(10_000);
    expect(guard.canOpen()).toBeFalse();
    guard.block(0);
    expect(guard.canOpen()).toBeTrue();
  });
});

describe('parsePlacement', () => {
  test('translates side/align into a valid position-area keyword', () => {
    expect(parsePlacement('bottom start')).toMatchObject({ side: 'bottom', align: 'start', vertical: true, positionArea: 'bottom span-right' });
    expect(parsePlacement('bottom end').positionArea).toBe('bottom span-left');
    expect(parsePlacement('bottom center').positionArea).toBe('bottom center');
    expect(parsePlacement('top end').positionArea).toBe('top span-left');
    expect(parsePlacement('left start')).toMatchObject({ vertical: false, positionArea: 'left span-bottom' });
    expect(parsePlacement('right end').positionArea).toBe('right span-top');
    expect(parsePlacement().positionArea).toBe('bottom span-right');
    expect(parsePlacement('bottom')).toMatchObject({ align: 'start', positionArea: 'bottom span-right' });
  });
});

describe('computePlacement', () => {
  const trigger = { top: 100, right: 260, bottom: 130, left: 200, width: 60, height: 30 };
  const viewport = { width: 1000, height: 800 };
  test('bottom start pins top and left', () => {
    const s = computePlacement(trigger, viewport, { side: 'bottom', align: 'start', offset: 4 });
    expect(s).toMatchObject({ position: 'fixed', inset: 'auto', margin: '0', top: '134px', left: '200px' });
  });
  test('bottom center centers with a transform', () => {
    const s = computePlacement(trigger, viewport, { side: 'bottom', align: 'center' });
    expect(s.left).toBe('230px');
    expect(s.transform).toBe('translateX(-50%)');
  });
  test('bottom end anchors the right edge', () => {
    const s = computePlacement(trigger, viewport, { side: 'bottom', align: 'end' });
    expect(s.right).toBe('740px');
  });
  test('top side anchors the bottom edge', () => {
    const s = computePlacement(trigger, viewport, { side: 'top', align: 'start', offset: 4 });
    expect(s.bottom).toBe('704px');
  });
  test('right side and matchWidth', () => {
    const s = computePlacement(trigger, viewport, { side: 'right', align: 'start', matchWidth: true });
    expect(s.left).toBe('264px'); // trigger.right + offset
    expect(s.top).toBe('100px');
    expect(s.minWidth).toBe('60px');
  });
});

describe('belowPosition', () => {
  const trigger = { top: 100, bottom: 130, left: 200, right: 260, width: 60, height: 30 };
  const viewport = { width: 1000, height: 800 };
  test('places below when it fits', () => {
    const floating = { bottom: 300, right: 400, width: 200, height: 166 };
    expect(belowPosition(trigger, floating, viewport, 4)).toEqual({ left: 200, top: 134, minWidth: 60 });
  });
  test('flips above on bottom overflow', () => {
    const floating = { bottom: 900, right: 400, width: 200, height: 770 };
    expect(belowPosition(trigger, floating, viewport, 4).top).toBe(100 - 770 - 4);
  });
  test('shifts left on right overflow', () => {
    const floating = { bottom: 300, right: 1100, width: 200, height: 166 };
    expect(belowPosition(trigger, floating, viewport, 4).left).toBe(1000 - 200 - 4);
  });
});

describe('focusTrapMove', () => {
  const list = ['first', 'mid', 'last'];
  test('empty list never moves', () => {
    expect(focusTrapMove([], 'x', false)).toEqual({ focus: null, prevent: false });
  });
  test('Tab off the last wraps to the first', () => {
    expect(focusTrapMove(list, 'last', false)).toEqual({ focus: 'first', prevent: true });
  });
  test('Shift+Tab off the first wraps to the last', () => {
    expect(focusTrapMove(list, 'first', true)).toEqual({ focus: 'last', prevent: true });
  });
  test('interior moves are left to the browser', () => {
    expect(focusTrapMove(list, 'mid', false)).toEqual({ focus: null, prevent: false });
    expect(focusTrapMove(list, 'mid', true)).toEqual({ focus: null, prevent: false });
  });
});

describe('createScrollLock', () => {
  const spyIo = () => {
    const calls = [];
    let y = 0;
    return {
      calls, setY: (v) => { y = v; },
      scrollY: () => y,
      freeze: (v) => calls.push(['freeze', v]),
      release: (v) => calls.push(['release', v]),
    };
  };
  test('freezes on first lock only and releases on last unlock with the first position', () => {
    const io = spyIo();
    const lock = createScrollLock(io);
    io.setY(120);
    lock.lock('a');
    io.setY(0); // body is now fixed; a nested lock captures 0
    lock.lock('b');
    expect(io.calls).toEqual([['freeze', 120]]);
    expect(lock.size()).toBe(2);
    lock.unlock('b');
    expect(lock.size()).toBe(1);
    expect(io.calls).toEqual([['freeze', 120]]); // no release yet
    lock.unlock('a');
    expect(io.calls).toEqual([['freeze', 120], ['release', 120]]);
    expect(lock.size()).toBe(0);
  });
  test('unlocking an unknown instance is a no-op', () => {
    const io = spyIo();
    const lock = createScrollLock(io);
    lock.lock('a');
    lock.unlock('ghost');
    expect(lock.size()).toBe(1);
    expect(io.calls).toEqual([['freeze', 0]]);
  });
});

describe('combine', () => {
  test('disposes in registration order and swallows throws', () => {
    const order = [];
    const dispose = combine(
      () => order.push(1),
      null,
      () => { throw new Error('boom'); },
      () => order.push(3),
    );
    expect(() => dispose()).not.toThrow();
    expect(order).toEqual([1, 3]);
  });
});

describe('getRef', () => {
  test('resolves an element or a lazy getter', () => {
    const el = { tag: 'div' };
    expect(getRef(el)).toBe(el);
    expect(getRef(() => el)).toBe(el);
    expect(getRef(null)).toBeNull();
  });
});
