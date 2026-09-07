// The owner-ordered flush, observed through a render branch: a binding
// under `if store.current` never runs against the null that dismissed
// its block, whatever else the same batch wrote and whatever the
// subscriber order had become. The branch narrowing the TS face emits
// (`current!.email`) is exactly this property, so these scenarios are
// its gate — each is a shape that would throw under an insertion-order
// flush. The last group pins the leave-transition freeze: the leaving
// block keeps its DOM and loses its effects.
import { test, expect, describe } from 'bun:test';
import { compile } from '../../src/compile.js';
import { installRecordingDOM } from '../support/recording-dom.js';
import * as R from '../../src/runtime/reactive.js';
import * as Cm from '../../src/runtime/components.js';
import { createStash } from '../../packages/app/stash.rip';

installRecordingDOM();
const RT = { ...R, ...Cm };
const NAMES = ['__Component', '__state', '__computed', '__effect', '__batch', '__ownerFrame', '__pushOwner', '__popOwner', '__detach', '__transition', '__detachRef'];

const load = (lines) => {
  const { code } = compile(lines.join('\n'), { runtimeDelivery: 'none' });
  return new Function(...NAMES, `${code}\nreturn C;`)(...NAMES.map((n) => RT[n]));
};

const mount = (Cls, props) => {
  const inst = new Cls(props);
  inst.__target = document.createElement('div');
  inst.mount(inst.__target);
  return inst;
};

// The branch's rendered element sits after the anchor comment.
const branchEl = (inst) => inst.__target.childNodes[1];
const text = (inst) => branchEl(inst).childNodes[0].childNodes[0].data;

describe('a binding under a branch never observes the state that dismissed it', () => {
  test('a batch that writes a second dependency of the binding before nulling the tested chain', () => {
    const C = load([
      'C = component',
      '  @store: any',
      '  render',
      '    if @store.user',
      '      div',
      '        span "#{@store.user.email} #{@store.label}"',
    ]);
    const stash = createStash({ p: { user: { email: 'a@x' }, label: 'a' } });
    const inst = mount(C, { store: stash.p });
    expect(text(inst)).toBe('a@x a');
    R.__batch(() => { stash.p.label = 'c'; stash.p.user = null; });
    expect(inst.__target.childNodes.length).toBe(1);
    stash.p.user = { email: 'b@x' };
    expect(text(inst)).toBe('b@x c');
    inst.unmount();
  });

  test('nested branches: a batch that nulls the inner tested chain before the outer', () => {
    const C = load([
      'C = component',
      '  @store: any',
      '  render',
      '    if @store.user',
      '      div',
      '        span @store.user.email',
      '        if @store.user.address',
      '          em @store.user.address.city',
    ]);
    const stash = createStash({ p: { user: { email: 'a@x', address: { city: 'Oslo' } } } });
    const inst = mount(C, { store: stash.p });
    R.__batch(() => { stash.p.user.address = null; stash.p.user = null; });
    expect(inst.__target.childNodes.length).toBe(1);
    inst.unmount();
  });

  test('a swap that re-ran alone (its condition reads a signal the binding does not) still runs first', () => {
    const C = load([
      'C = component',
      '  @store: any',
      '  render',
      '    if @store.user and @store.tick',
      '      div',
      '        span @store.user.email',
    ]);
    const stash = createStash({ p: { user: { email: 'a@x' }, tick: 1 } });
    const inst = mount(C, { store: stash.p });
    stash.p.tick = 2;
    stash.p.user = null;
    expect(inst.__target.childNodes.length).toBe(1);
    inst.unmount();
  });

  test('a sibling swap whose mount writes a ref mid-flush does not let the nested flush run the binding early', () => {
    const C = load([
      'C = component',
      '  @store: any',
      '  box: HTMLInputElement | null := null',
      '  render',
      '    if @store.flag',
      '      input ref: box',
      '    if @store.user',
      '      div',
      '        span "#{@store.user.email} #{@box?.tagName}"',
    ]);
    const stash = createStash({ p: { user: { email: 'a@x' }, flag: false } });
    const inst = mount(C, { store: stash.p });
    R.__batch(() => { stash.p.flag = true; stash.p.user = null; });
    expect(inst.__target.childNodes.length).toBe(3); // anchor, input, anchor
    inst.unmount();
  });

  test('CONTROL: a class-scope effect is not owned by the branch and does observe the null', () => {
    const C = load([
      'C = component',
      '  @store: any',
      '  ~> @store.user.email',
      '  render',
      '    if @store.user',
      '      div',
      '        span @store.user.email',
    ]);
    const stash = createStash({ p: { user: { email: 'a@x' } } });
    const inst = mount(C, { store: stash.p });
    expect(() => { stash.p.user = null; }).toThrow(TypeError);
    inst.unmount();
  });
});

describe('a block leaving through a transition freezes: its DOM lingers, its effects do not', () => {
  test('the binding keeps the value it was showing and never re-runs against the null', () => {
    const C = load([
      'C = component',
      '  @store: any',
      '  render',
      '    if @store.user',
      '      div ~fade',
      '        span @store.user.email',
    ]);
    const stash = createStash({ p: { user: { email: 'a@x' } } });
    const inst = mount(C, { store: stash.p });
    const card = branchEl(inst);
    stash.p.user = null;
    expect(card.parentNode).not.toBeNull();
    expect(card.childNodes[0].childNodes[0].data).toBe('a@x');
    inst.unmount();
  });
});

describe('the flush order, read off the runtime', () => {
  test('an owner runs before what it owns, however the batch queued them', () => {
    const a = R.__state(1), b = R.__state(1);
    const log = [];
    const frame = R.__ownerFrame({ nested: false });
    const tok = R.__pushOwner(frame);
    let inner = null;
    try {
      R.__effect(() => {
        b.value; log.push('owner');
        if (inner === null) {
          const child = R.__ownerFrame();
          const t = R.__pushOwner(child);
          try { inner = R.__effect(() => { a.value; b.value; log.push('owned'); }); } finally { R.__popOwner(t); }
        }
      });
    } finally { R.__popOwner(tok); }
    log.length = 0;
    R.__batch(() => { a.value = 2; b.value = 2; });
    expect(log).toEqual(['owner', 'owned']);
    frame.dispose();
  });

  test('within one owner depth the order is queue insertion', () => {
    const a = R.__state(1), b = R.__state(1);
    const log = [];
    const first = R.__effect(() => { b.value; log.push('first'); });
    const second = R.__effect(() => { a.value; b.value; log.push('second'); });
    log.length = 0;
    R.__batch(() => { a.value = 2; b.value = 2; });
    expect(log).toEqual(['second', 'first']);
    first(); second();
  });
});
