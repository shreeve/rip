// HMR metadata emission and signature classification.
// Compiler-owned __hmrId/__hmrSig when hmr:true; absent when off.
import { describe, expect, test } from 'bun:test';
import { compile } from '../../src/compile.js';
import {
  __Component,
  __hmrClassify,
  __hmrEmit,
  __hmrEvents,
  __hmrLookup,
  __hmrMigrateDiff,
  __hmrPreserveState,
  __hmrRegisterDefinition,
  __hmrRegistry,
} from '../../src/runtime/components.js';
import { __state } from '../../src/runtime/reactive.js';

const SRC = `export Counter = component
  @label: string
  count := 0
  doubled ~= count * 2
  bump = -> count += 1
  render
    div
      = count
`;

const compileHmr = (src, path = 'routes/counter.rip') =>
  compile(src, { path, runtimeDelivery: 'none', hmr: true });

describe('HMR metadata emission', () => {
  test('hmr:true emits __hmrId and __hmrSig for module-scope named components', () => {
    const { code } = compileHmr(SRC);
    expect(code).toContain(`static __hmrId = "routes/counter.rip#Counter"`);
    expect(code).toContain('static __hmrSig = ');
    expect(code).toMatch(/"shape":"[0-9a-f]{8}"/);
    expect(code).toMatch(/"impl":"[0-9a-f]{8}"/);
    expect(code).toContain('"state":["count","label"]');
    expect(code).toContain('"computed":["doubled"]');
    expect(code).toContain('"props":["label"]');
    expect(code).toContain('"gates":0');
    expect(code).toContain('"extends":null');
  });

  test('hmr:false (default) emits no __hmrId or __hmrSig', () => {
    const off = compile(SRC, { path: 'routes/counter.rip', runtimeDelivery: 'none' });
    const explicit = compile(SRC, { path: 'routes/counter.rip', runtimeDelivery: 'none', hmr: false });
    expect(off.code).not.toContain('__hmrId');
    expect(off.code).not.toContain('__hmrSig');
    expect(explicit.code).not.toContain('__hmrId');
    expect(explicit.code).toBe(off.code);
  });

  test('nested member-held components do not receive HMR metadata', () => {
    const src = `export Host = component
  Inner = component
    n := 0
    render
      span
        = n
  render
    div
`;
    const { code } = compileHmr(src, 'host.rip');
    expect(code).toContain('static __hmrId = "host.rip#Host"');
    expect(code).not.toContain('#Inner');
    expect((code.match(/static __hmrId/g) || []).length).toBe(1);
  });

  test('extends and gates appear in the signature', () => {
    const src = `export Button = component extends button
  items <~ @app.data.catalog
  @disabled?: boolean
  render
    button
`;
    const { code } = compileHmr(src, 'ui/button.rip');
    expect(code).toContain(`static __hmrId = "ui/button.rip#Button"`);
    expect(code).toContain('"extends":"button"');
    expect(code).toContain('"gates":1');
    expect(code).toContain('"props":["disabled"]');
  });

  test('impl fingerprint changes when methods change; shape stays when state stays', () => {
    const a = compileHmr(SRC, 'c.rip').code;
    const b = compileHmr(SRC.replace('bump = -> count += 1', 'bump = -> count += 2\n  reset = -> count = 0'), 'c.rip').code;
    const sigA = JSON.parse(a.match(/static __hmrSig = ({.*?});/)[1]);
    const sigB = JSON.parse(b.match(/static __hmrSig = ({.*?});/)[1]);
    expect(sigA.shape).toBe(sigB.shape);
    expect(sigA.impl).not.toBe(sigB.impl);
  });
});

describe('__hmrClassify', () => {
  const sig = (partial) => ({
    shape: 's',
    impl: 'i',
    state: ['count'],
    computed: [],
    props: ['label'],
    gates: 0,
    extends: null,
    ...partial,
  });
  const ctor = (s) => {
    class C extends __Component {}
    C.__hmrSig = sig(s);
    return C;
  };

  test('identical signatures classify as patch', () => {
    const C = ctor({});
    expect(__hmrClassify(C, C)).toBe('patch');
  });

  test('impl-only change classifies as patch', () => {
    expect(__hmrClassify(ctor({ impl: 'a' }), ctor({ impl: 'b' }))).toBe('patch');
  });

  test('state or computed set change classifies as migrate', () => {
    expect(__hmrClassify(
      ctor({ state: ['count'] }),
      ctor({ state: ['count', 'extra'] }),
    )).toBe('migrate');
    expect(__hmrClassify(
      ctor({ computed: [] }),
      ctor({ computed: ['total'] }),
    )).toBe('migrate');
  });

  test('props, gates, or extends change classifies as remount', () => {
    expect(__hmrClassify(
      ctor({ props: ['label'] }),
      ctor({ props: ['label', 'step'] }),
    )).toBe('remount');
    expect(__hmrClassify(ctor({ gates: 0 }), ctor({ gates: 1 }))).toBe('remount');
    expect(__hmrClassify(ctor({ extends: null }), ctor({ extends: 'div' }))).toBe('remount');
  });

  test('missing signatures classify as remount', () => {
    class Bare extends __Component {}
    expect(__hmrClassify(Bare, ctor({}))).toBe('remount');
    expect(__hmrClassify(ctor({}), Bare)).toBe('remount');
  });
});

describe('__hmrMigrateDiff / __hmrPreserveState', () => {
  test('reports kept, added, and removed named state slots', () => {
    expect(__hmrMigrateDiff(
      { state: ['count', 'gone'] },
      { state: ['count', 'extra'] },
    )).toEqual({
      kept: ['count'],
      added: ['extra'],
      removed: ['gone'],
    });
  });

  test('copies intersecting signal .value slots and emits a migrate event', () => {
    class Old extends __Component {
      _init() {
        this.count = __state(7);
        this.gone = __state(1);
      }
    }
    Old.__hmrId = 'test/migrate.rip#Old';
    Old.__hmrSig = { state: ['count', 'gone'], computed: [], props: [], gates: 0, extends: null };
    class Next extends __Component {
      _init() {
        this.count = __state(0);
        this.extra = __state(9);
      }
    }
    Next.__hmrId = 'test/migrate.rip#Old';
    Next.__hmrSig = { state: ['count', 'extra'], computed: [], props: [], gates: 0, extends: null };
    const prev = new Old({});
    const next = new Next({});
    const before = __hmrEvents().length;
    const report = __hmrPreserveState(prev, next);
    expect(next.count.value).toBe(7);
    expect(next.extra.value).toBe(9);
    expect(report.kept).toEqual(['count']);
    expect(report.added).toEqual(['extra']);
    expect(report.removed).toEqual(['gone']);
    expect(report.copied).toEqual(['count']);
    const events = __hmrEvents().slice(before);
    expect(events.some(e => e.type === 'migrate' && e.removed?.includes('gone'))).toBeTrue();
  });
});

describe('__hmrEmit', () => {
  test('records events for tooling and tests', () => {
    const before = __hmrEvents().length;
    __hmrEmit('patch', { id: 'demo.rip#X' });
    const last = __hmrEvents().at(-1);
    expect(__hmrEvents().length).toBe(before + 1);
    expect(last.type).toBe('patch');
    expect(last.id).toBe('demo.rip#X');
  });
});

describe('__hmrRegisterDefinition', () => {
  test('records definition under __hmrId', () => {
    class Demo extends __Component {}
    Demo.__hmrId = 'test/hmr-metadata.rip#Demo';
    Demo.__hmrSig = { shape: 'x', impl: 'y', state: [], computed: [], props: [], gates: 0, extends: null };
    __hmrRegisterDefinition(Demo);
    const entry = __hmrLookup(Demo.__hmrId);
    expect(entry?.definition).toBe(Demo);
    expect(entry?.instances).toBeInstanceOf(Set);
    __hmrRegistry.delete(Demo.__hmrId);
  });
});
