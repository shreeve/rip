// Patch-depth contract: `_hmrRerender` / `__hmrPatch` preserve
// instance identity and `:=` state containers, refresh `~=` bodies,
// and recreate component-body `~>` effects — without re-running `_init`.
import { describe, expect, test } from 'bun:test';
import { compile } from '../../src/compile.js';
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
