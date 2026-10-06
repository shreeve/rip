// Patch-depth contract: `_hmrRerender` / `__hmrPatch` preserve
// instance identity and `:=` state containers, refresh `~=` bodies,
// and recreate component-body `~>` effects — without re-running `_init`.
import { describe, expect, test } from 'bun:test';
import { compile } from '../../src/compiler.js';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';
import * as reactiveRuntime from '../../src/runtime/reactive.js';
import * as componentRuntime from '../../src/runtime/components.js';

installRecordingDOM();
const RT = { ...reactiveRuntime, ...componentRuntime };

const load = (src, path = 'patch.rip') => {
  const { code } = compile(src, { path, runtimeDelivery: 'none', hmr: true });
  // `new Function` is not a module — strip export keywords for eval.
  const body = code.replace(/^export /gm, '');
  const names = Object.keys(RT);
  return {
    code,
    exports: new Function(...names, `${body}\nreturn { C };`)(...names.map((n) => RT[n])),
  };
};

const BASE = `export C = component
  count := 1
  hits := 0
  doubled ~= count * 2
  ~> hits += 1
  render
    div
      = doubled
`;

describe('HMR patch helpers emission', () => {
  test('hmr:true emits regenerable effect/computed helpers', () => {
    const { code } = load(BASE);
    expect(code).toContain('this._hmrBindEffects();');
    expect(code).toContain('_hmrBindEffects() {');
    expect(code).toContain('_hmrRefreshComputeds() {');
    expect(code).toContain('this.doubled?.kill?.();');
  });

  test('hmr:false keeps effects inline and omits helpers', () => {
    const { code } = compile(BASE, { path: 'patch.rip', runtimeDelivery: 'none', hmr: false });
    expect(code).not.toContain('_hmrBindEffects');
    expect(code).not.toContain('_hmrRefreshComputeds');
    expect(code).toContain('__effect(() => { return (this.hits.value += 1); });');
  });
});

describe('__hmrPatch preserve / destroy matrix', () => {
  test('preserves instance + state containers; refreshes computeds; recreates body effects', () => {
    const old = load(BASE);
    const next = load(BASE
      .replace('doubled ~= count * 2', 'doubled ~= count * 3')
      .replace("= doubled", "= doubled\n      span 'x'"));
    const { C: Old } = old.exports;
    const { C: Next } = next.exports;

    expect(componentRuntime.__hmrClassify(Old, Next)).toBe('patch');

    const target = document.createElement('main');
    const inst = new Old({});
    inst.mount(target);
    expect(inst.hits.value).toBe(1);
    expect(inst.doubled.value).toBe(2);

    const countBox = inst.count;
    const hitsBox = inst.hits;
    inst.count.value = 7;
    expect(inst.doubled.value).toBe(14);
    expect(serialize(target)).toContain('>14<');

    const before = componentRuntime.__hmrEvents().length;
    componentRuntime.__hmrPatch(inst, Next);

    // Identity + state containers survive.
    expect(inst).toBeInstanceOf(Next);
    expect(inst.count).toBe(countBox);
    expect(inst.hits).toBe(hitsBox);
    expect(inst.count.value).toBe(7);

    // Computed body refreshed (×3), old closure gone.
    expect(inst.doubled.value).toBe(21);
    expect(serialize(target)).toContain('>21<');
    expect(serialize(target)).toContain('<span>x</span>');

    // Body effect recreated on the new owner frame (ran once more).
    expect(inst.hits.value).toBe(2);

    const events = componentRuntime.__hmrEvents().slice(before);
    expect(events.some((e) => e.type === 'patch')).toBeTrue();

    inst.unmount();
  });

  test('patch does not re-run _init (no duplicate state containers)', () => {
    let inits = 0;
    const src = `export C = component
  count := 0
  render
    div
      = count
`;
    const { exports: { C: Old } } = load(src);
    const { exports: { C: Next } } = load(src.replace('= count', "= count\n      i 'n'"));
    const origInit = Old.prototype._init;
    Old.prototype._init = function (props) {
      inits += 1;
      return origInit.call(this, props);
    };
    const nextInit = Next.prototype._init;
    Next.prototype._init = function (props) {
      inits += 1;
      return nextInit.call(this, props);
    };

    const target = document.createElement('main');
    const inst = new Old({});
    expect(inits).toBe(1);
    inst.mount(target);
    inst.count.value = 9;
    componentRuntime.__hmrPatch(inst, Next);
    expect(inits).toBe(1);
    expect(inst.count.value).toBe(9);
    expect(serialize(target)).toContain('<i>n</i>');
    inst.unmount();
  });
});

// A swap re-points living instances at their next class one at a time, so
// within a round a part can be rebuilt under a provider whose instance is
// still the previous class. The read matches on the definition's
// `__hmrId`, not the class alone, so the order the round patches in does
// not decide whether the part finds its provider.
describe('a context read across a hot swap', () => {
  const SRC = `export Theme = component
  offer tone := 'dark'
  render
    slot

Leaf = component
  accept tone from Theme
  render
    span tone

export Card = component
  render
    div
      Leaf
      Leaf

export Page = component
  render
    div
      Theme
        Card
`;
  const loadAll = () => {
    const { code } = compile(SRC, { path: 'swap.rip', runtimeDelivery: 'none', hmr: true });
    const names = Object.keys(RT);
    return new Function(...names, `${code.replace(/^export /gm, '')}\nreturn { Theme, Card, Page };`)(...names.map((n) => RT[n]));
  };
  const kids = (c) => (c._children ?? []);
  const all = (c) => [c, ...kids(c).flatMap(all)];
  const named = (root, name) => all(root).find((c) => c.constructor.__hmrId === `swap.rip#${name}`);

  test('a part rebuilt before the provider above it is patched still finds it', () => {
    const v1 = loadAll();
    const target = document.createElement('main');
    const page = new v1.Page({});
    page.mount(target);
    expect(serialize(target)).toContain('<span data-part="Leaf">dark</span><span data-part="Leaf">dark</span>');
    const theme = named(page, 'Theme');
    const card = named(page, 'Card');
    const v2 = loadAll();
    expect(v2.Theme).not.toBe(v1.Theme);
    const errors = [];
    const realError = console.error;
    console.error = (...a) => errors.push(a.map(String).join(' ').split('\n')[0]);
    try {
      // The part's parent first: its two leaves are identical, so adoption
      // cannot tell them apart and both construct fresh, naming the NEW
      // Theme while the living instance above them is still the old one.
      RT.__hmrPatch(card, v2.Card);
      RT.__hmrPatch(theme, v2.Theme);
    } finally { console.error = realError; }
    expect(errors).toEqual([]);
    expect(serialize(target)).toContain('<span data-part="Leaf">dark</span><span data-part="Leaf">dark</span>');
    expect(theme.constructor).toBe(v2.Theme);
  });
});

// A changed `:=` initializer re-runs for that one slot on the living
// instance. Every other slot keeps its written value, `_init` members
// keep their identity, and the recreated effects observe the new value
// once. A public slot the construction site supplies is the parent's to
// set; its default is not applied.
describe('a changed `:=` initializer re-runs on the living instance', () => {
  const CELLS = `export C = component
  a := 1
  b := 2
  c := 3
  made = { tag: 'x' }
  ~> globalThis.__seenB.push(b)
  render
    div
      = "#{a}-#{b}-#{c}"
`;
  const mountCells = (src = CELLS) => {
    globalThis.__seenB = [];
    const { exports: { C } } = load(src);
    const target = document.createElement('main');
    const inst = new C({});
    inst.mount(target);
    inst.a.value = 10;
    inst.b.value = 20;
    inst.c.value = 30;
    return { C, target, inst };
  };

  test('one changed cell takes its new value; the other cells, and a plain member, keep theirs', () => {
    const { C: Old, target, inst } = mountCells();
    const { exports: { C: Next } } = load(CELLS.replace('b := 2', 'b := 200'));
    expect(componentRuntime.__hmrClassify(Old, Next)).toBe('patch');
    const boxes = [inst.a, inst.b, inst.c];
    const made = inst.made;
    expect(globalThis.__seenB).toEqual([2, 20]);

    componentRuntime.__hmrPatch(inst, Next);

    expect([inst.a, inst.b, inst.c]).toEqual(boxes);
    expect([inst.a.value, inst.b.value, inst.c.value]).toEqual([10, 200, 30]);
    expect(inst.made).toBe(made);
    expect(serialize(target)).toContain('>10-200-30<');
    // The recreated effect saw the new value exactly once.
    expect(globalThis.__seenB).toEqual([2, 20, 200]);
    expect(componentRuntime.__hmrEvents().at(-1)).toMatchObject({ type: 'patch', id: 'patch.rip#C', reset: ['b'] });
    expect(inst._hmrResetPending).toBeNull();
    inst.unmount();
  });

  test('a whitespace-only initializer edit resets nothing', () => {
    const { target, inst } = mountCells();
    const { exports: { C: Next } } = load(CELLS.replace('b := 2', 'b :=   2').replace('= "#{a}-#{b}-#{c}"', '= "#{a}-#{b}-#{c}"\n      span \'x\''));

    componentRuntime.__hmrPatch(inst, Next);

    expect([inst.a.value, inst.b.value, inst.c.value]).toEqual([10, 20, 30]);
    expect(serialize(target)).toContain('<span>x</span>');
    expect(globalThis.__seenB).toEqual([2, 20, 20]);
    expect(componentRuntime.__hmrEvents().at(-1)).toMatchObject({ type: 'patch', reset: [] });
    inst.unmount();
  });

  test('a slot that reads a computed above it reads the refreshed body', () => {
    const src = `export C = component
  base := 2
  twice ~= base * 2
  derived := twice + 1
  render
    div
      = derived
`;
    const { exports: { C: Old } } = load(src);
    const { exports: { C: Next } } = load(src.replace('base * 2', 'base * 3').replace('twice + 1', 'twice + 100'));
    const target = document.createElement('main');
    const inst = new Old({});
    inst.mount(target);
    inst.base.value = 5;
    expect(inst.derived.value).toBe(5);

    componentRuntime.__hmrPatch(inst, Next);

    expect(inst.derived.value).toBe(115);
    expect(serialize(target)).toContain('>115<');
    inst.unmount();
  });

  test('an offered slot resets in the container its acceptors share', () => {
    const src = `export Theme = component
  offer tone := 'dark'
  render
    div
      Leaf

Leaf = component
  accept tone from Theme
  render
    span tone

export C = component
  render
    Theme
`;
    const loadAll = (text) => {
      const { code } = compile(text, { path: 'patch.rip', runtimeDelivery: 'none', hmr: true });
      const names = Object.keys(RT);
      return new Function(...names, `${code.replace(/^export /gm, '')}\nreturn { C, Theme };`)(...names.map((n) => RT[n]));
    };
    const Old = loadAll(src);
    const target = document.createElement('main');
    const inst = new Old.C({});
    inst.mount(target);
    expect(serialize(target)).toContain('>dark</span>');
    const theme = inst._children[0];
    const tone = theme.tone;
    const Next = loadAll(src.replace("tone := 'dark'", "tone := 'light'"));

    componentRuntime.__hmrPatch(theme, Next.Theme);

    expect(theme.tone).toBe(tone);
    expect(tone.value).toBe('light');
    expect(serialize(target)).toContain('>light</span>');
    expect(componentRuntime.__hmrEvents().at(-1)).toMatchObject({ type: 'patch', reset: ['tone'] });
    inst.unmount();
  });

  test('a public slot\'s changed default applies only when the construction site passes nothing', () => {
    const src = `export C = component
  @side := 'left'
  render
    div side
`;
    const { exports: { C: Old } } = load(src);
    const { exports: { C: Next } } = load(src.replace("'left'", "'right'"));
    const mount = (props) => {
      const target = document.createElement('main');
      const inst = new Old(props);
      inst.mount(target);
      return { target, inst };
    };

    const bare = mount({});
    componentRuntime.__hmrPatch(bare.inst, Next);
    expect(bare.inst.side.value).toBe('right');
    expect(serialize(bare.target)).toContain('>right<');
    expect(componentRuntime.__hmrEvents().at(-1)).toMatchObject({ type: 'patch', reset: ['side'] });
    bare.inst.unmount();

    const given = mount({ side: 'top' });
    componentRuntime.__hmrPatch(given.inst, Next);
    expect(given.inst.side.value).toBe('top');
    expect(componentRuntime.__hmrEvents().at(-1)).toMatchObject({ type: 'patch', reset: [] });
    given.inst.unmount();

    const box = reactiveRuntime.__state('bound');
    const bound = mount({ __bind_side__: box });
    expect(bound.inst.side).toBe(box);
    componentRuntime.__hmrPatch(bound.inst, Next);
    expect(box.value).toBe('bound');
    expect(componentRuntime.__hmrEvents().at(-1)).toMatchObject({ type: 'patch', reset: [] });
    bound.inst.unmount();
  });

  // The failure leaves `__hmrPatch` as a throw, which is what sends the
  // app renderer to the remount floor.
  test('an initializer that yields a container fails the rebind instead of replacing the slot', () => {
    const src = `export C = component
  x := 1
  render
    div
      = x
`;
    globalThis.__box = reactiveRuntime.__state(4);
    const { exports: { C: Old } } = load(src);
    const { exports: { C: Next } } = load(src.replace('x := 1', 'x := globalThis.__box'));
    const target = document.createElement('main');
    const inst = new Old({});
    inst.mount(target);
    const box = inst.x;
    const errors = [];
    const realError = console.error;
    console.error = (...a) => errors.push(a.map(String).join(' '));
    try {
      expect(() => componentRuntime.__hmrPatch(inst, Next)).toThrow(/initializer of 'x' yields a reactive container/);
    } finally { console.error = realError; }
    expect(errors.some((e) => e.includes('hmr rebind') && e.includes('container'))).toBeTrue();
    expect(inst._state).toBe('failed');
    expect(inst.x).toBe(box);
    expect(box.value).toBe(1);
    delete globalThis.__box;
  });
});
