//  acceptance: the component-runtime port.
// src/runtime/components.js is verified against the component runtime
// — the runtime modules imported directly (so the runtime's own
// cross-template bridge wires: its __effect finds its component stack
// through the globalThis registration the templates perform) and every
// scenario runs against BOTH runtimes over the in-repo recording DOM
// (test/support/recording-dom.js, -clean), asserting agreement on
// DOM shape, lifecycle order, disposal, context, reconciliation, and
// events — except at the enumerated divergences, each a pinned
// entry pinned paired in the defect batteries below (#131, #132, #133,
// #134, #136, #138). Also here: the seam delivering the runtime as
// its fourth customer (requires: 'reactive', the fused inline IIFE),
// the zero-cost extension, and the surface-stays-loud pins for
//  to graduate.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { Mappings } from '../../src/stores.js';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';

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
const CRT_PATH = resolve(import.meta.dir, '../../src/runtime/components.js');
const RRT_PATH = resolve(import.meta.dir, '../../src/runtime/reactive.js');

// The recording DOM is the process's `document` for both runtimes
// (each resolves the bare global at call time).
installRecordingDOM();

import * as v4r from '../../src/runtime/reactive.js';
import * as v4c from '../../src/runtime/components.js';

const RT = { ...v4r, ...v4c, isLive: true };

// Run a scenario against both runtimes and require identical outcomes.
const both = (scenario) => scenario(RT);
const bothAsync = async (scenario) => scenario(RT);
const caught = (fn) => {
  try { return ['value', fn()]; } catch (e) { return ['throw', e.constructor.name]; }
};

// ── scenario helpers ─────────────────────────────────────────────────

// Define a component class against either runtime's API. spec.init /
// spec.create / spec.setup run with `this` bound to the instance and
// the api as argument; hooks attach as prototype methods.
const defineComponent = (api, spec = {}) => {
  const cls = class extends api.__Component {
    _init(props) { if (spec.init) spec.init.call(this, props, api); }
  };
  if (spec.create) cls.prototype._create = function () { return spec.create.call(this, api); };
  if (spec.setup) cls.prototype._setup = function () { return spec.setup.call(this, api); };
  for (const [k, fn] of Object.entries(spec.hooks ?? {})) cls.prototype[k] = fn;
  cls.__props = spec.props ?? [];
  Object.defineProperty(cls, 'name', { value: spec.name ?? 'C' });
  return cls;
};

// The child-instantiation protocol — the shape each side's emission
// wraps child construction in. the is replicated from its emitted
// code (parent push, _initFailed / construction-failure placeholders,
// _children registration); the is the same protocol over the owner
// seam (the child's frame pushed around _create, exactly what 
// emission does). Both report construction failures through
// console.error and continue — the pinned contract.
const childCreate = (api, parent, Cls, props = {}) => {
  let inst = null, el = null;
  const prev = api.__pushComponent(parent);
  try {
    try {
      inst = new Cls(props);
      if (inst && inst._initFailed) {
        try { inst.unmount({ removeDOM: false }); } catch (ue) { console.error('[Rip] partial-init unmount error:', ue); }
        inst = null;
        el = document.createComment(`rip:child-init-failed: ${Cls.name}`);
      } else {
        const cprev = api.__pushComponent(inst);
        const oprev = api.isLive ? api.__pushOwner(inst._frame) : null;
        try {
          el = inst._root = inst._create();
        } finally {
          if (api.isLive) api.__popOwner(oprev);
          api.__popComponent(cprev);
        }
        (parent._children || (parent._children = [])).push(inst);
      }
    } catch (childErr) {
      console.error(`[Rip] ${Cls.name} construction failed:`, childErr);
      if (inst) { try { inst.unmount({ removeDOM: false }); } catch (ue) { console.error('[Rip] partial-child unmount error:', ue); } }
      inst = null;
      el = document.createComment(`rip:child-error: ${Cls.name}`);
    }
  } finally { api.__popComponent(prev); }
  return { inst, el };
};

const childSetup = (api, inst) => {
  if (inst && !inst._isSetup) {
    inst._isSetup = true;
    const cprev = api.__pushComponent(inst);
    const oprev = api.isLive ? api.__pushOwner(inst._frame) : null;
    try {
      try {
        if (inst.beforeMount) inst.beforeMount();
        if (inst._setup) inst._setup();
        if (inst.mounted) inst.mounted();
      } catch (e) { api.__handleComponentError(e, inst); }
    } finally {
      if (api.isLive) api.__popOwner(oprev);
      api.__popComponent(cprev);
    }
  }
};

const tick = () => new Promise((r) => setTimeout(r, 0));

// ════════════════════════════════════════════════════════════════════
// Module shape: the exports, and no globalThis writes but the sentinels
// ════════════════════════════════════════════════════════════════════

describe('module shape', () => {
  test('named exports are exactly the delivered set', () => {
    expect(Object.keys(v4c).sort()).toEqual([
 '__Component', '__clsx', '__detach', '__detachRef', '__handleComponentError', '__lis',
 '__ownerFrame', '__popComponent', '__popOwner', '__pushComponent', '__pushOwner',
 '__reconcile', '__transition',
 'getContext', 'hasContext', 'setContext',
    ]);
  });

  test('importing the module touches globalThis at the two sentinels ONLY — no __ripComponent, no __rip bridge', () => {
    // A fresh process: this test file imports the runtime templates above,
    // which DO write the bridge globals, so the assertion needs an
    // unpolluted globalThis. Importing components.js evaluates
    // reactive.js too (the module import), so both sentinels land.
    const code = [
      `await import(${JSON.stringify(pathToFileURL(CRT_PATH).href)});`,
      `if (globalThis.__ripComponent !== undefined) throw new Error('component bridge leaked');`,
      `if (globalThis.__rip !== undefined) throw new Error('reactive bridge leaked');`,
      `if (globalThis.getEffectSignal !== undefined) throw new Error('getEffectSignal global leaked');`,
      `if (globalThis[Symbol.for('rip.runtime.components')] !== true) throw new Error('components sentinel missing');`,
      `if (globalThis[Symbol.for('rip.runtime.reactive')] !== true) throw new Error('reactive sentinel missing');`,
      `console.log('clean');`,
    ].join('\n');
    const r = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('clean');
  });

  test('importing the module without a DOM is legal (document is touched only inside methods)', () => {
    const code = [
      `const m = await import(${JSON.stringify(pathToFileURL(CRT_PATH).href)});`,
      `if (typeof m.__Component !== 'function') throw new Error('no class');`,
      `console.log(m.__clsx('a', { b: true }));`,
    ].join('\n');
    const r = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('a b');
  });
});

// ════════════════════════════════════════════════════════════════════
// Construction, props, lifecycle
// ════════════════════════════════════════════════════════════════════

describe('construction and mount lifecycle', () => {
  test('declared props wire through _init: incoming value, default fallback, reactive container', () => {
    expect(both((api) => {
      const Card = defineComponent(api, {
        name: 'Card', props: ['title', 'count'],
        init(props, a) {
          this.title = props.title ?? 'untitled';
          this.count = a.__state(props.count ?? 0);
        },
        create() {
          const el = document.createElement('div');
          el.setAttribute('data-title', this.title);
          return el;
        },
      });
      const target = document.createElement('main');
      const inst = new Card({ title: 'hello', count: 4 });
      inst.mount(target);
      const withDefaults = new Card({});
      return [serialize(inst._root), inst.count.read(), withDefaults.title, withDefaults.count.read()];
    })).toEqual(['<div data-title="hello"></div>', 4, 'untitled', 0]);
  });

  test('mount: create → setup → mounted, DOM appended; unmount: beforeUnmount → disposers → unmounted, DOM removed; idempotent', () => {
    expect(both((api) => {
      const log = [];
      const C = defineComponent(api, {
        name: 'C', props: [],
        init(props, a) { this.n = a.__state(1); },
        create() { log.push('create'); const el = document.createElement('p'); return el; },
        setup(a) {
          a.__effect(() => { this.n.value; log.push('effect'); return () => log.push('effect-clean'); });
        },
        hooks: {
          mounted() { log.push('mounted'); },
          beforeUnmount() { log.push('beforeUnmount'); },
          unmounted() { log.push('unmounted'); },
        },
      });
      const target = document.createElement('main');
      const inst = new C({});
      inst.mount(target);
      const mountedShape = serialize(target);
      inst.n.value = 2;                 // the setup effect is live
      inst.unmount();
      inst.unmount();                   // idempotent: nothing re-fires
      inst.n.value = 3;                 // disposed: no effect run
      return [log, mountedShape, serialize(target)];
    })).toEqual([
      ['create', 'effect', 'mounted', 'effect-clean', 'effect', 'beforeUnmount', 'effect-clean', 'unmounted'],
 '<main><p></p></main>', '<main></main>',
    ]);
  });

  test('mount(selector string) resolves through document.querySelector', () => {
    expect(both((api) => {
      const C = defineComponent(api, {
        name: 'C', props: [],
        create() { return document.createElement('section'); },
      });
      document.body.childNodes.length = 0;   // fresh body per side
      const inst = new C({});
      inst.mount('body');
      const out = serialize(document.body);
      inst.unmount();
      return out;
    })).toBe('<body><section></section></body>');
  });

  test('static mount constructs and mounts into body', () => {
    expect(both((api) => {
      const C = defineComponent(api, {
        name: 'C', props: [],
        create() { return document.createElement('aside'); },
      });
      document.body.childNodes.length = 0;
      const inst = C.mount();
      const out = serialize(document.body);
      inst.unmount();
      return out;
    })).toBe('<body><aside></aside></body>');
  });

  test('unmount(removeDOM: false) tears down but keeps the DOM visible', () => {
    expect(both((api) => {
      const log = [];
      const C = defineComponent(api, {
        name: 'C', props: [],
        init(props, a) { this.n = a.__state(0); },
        create() { return document.createElement('p'); },
        setup(a) { a.__effect(() => { this.n.value; return () => log.push('clean'); }); },
      });
      const target = document.createElement('main');
      const inst = new C({});
      inst.mount(target);
      inst.unmount({ removeDOM: false });
      return [log, serialize(target)];
    })).toEqual([['clean'], '<main><p></p></main>']);
  });

  test('a throwing hook during unmount reports and the teardown continues (console.error contract)', () => {
    expect(both((api) => {
      const log = [];
      const errs = [];
      const prevErr = console.error;
      console.error = (label) => errs.push(String(label));
      try {
        const C = defineComponent(api, {
          name: 'C', props: [],
          create() { return document.createElement('p'); },
          hooks: {
            beforeUnmount() { log.push('beforeUnmount'); throw new Error('hook boom'); },
            unmounted() { log.push('unmounted'); },
          },
        });
        const target = document.createElement('main');
        const inst = new C({});
        inst.mount(target);
        inst.unmount();
        return [log, errs, serialize(target)];
      } finally { console.error = prevErr; }
    })).toEqual([
      ['beforeUnmount', 'unmounted'],
      ['[Rip] beforeUnmount error:'],
 '<main></main>',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Composition: the child protocol, unmount cascade, error boundaries
// ════════════════════════════════════════════════════════════════════

describe('composition and error boundaries', () => {
  test('parent chains set ONCE at construction; later pushes preserve them', () => {
    expect(both((api) => {
      const P = defineComponent(api, { name: 'P', props: [] });
      const K = defineComponent(api, { name: 'K', props: [] });
      const parent = new P({});
      const prev = api.__pushComponent(parent);
      const kid = new K({});
      api.__popComponent(prev);
      // A re-push with no enclosing component must not clobber the
      // construction-time parent.
      const p2 = api.__pushComponent(kid);
      api.__popComponent(p2);
      return [kid._parent === parent, parent._parent ?? null];
    })).toEqual([true, null]);
  });

  test('the full composed lifecycle: child create/setup phases, cascade unmount order, DOM shape', () => {
    expect(both((api) => {
      const log = [];
      const Kid = defineComponent(api, {
        name: 'Kid', props: ['label'],
        init(props, a) {
          this.label = a.__state(props.label ?? 'kid');
        },
        create() {
          const el = document.createElement('span');
          el.appendChild(document.createTextNode(this.label.read()));
          return el;
        },
        setup(a) {
          a.__effect(() => { this.label.value; log.push('kid-effect'); return () => log.push('kid-clean'); });
        },
        hooks: {
          beforeMount() { log.push('kid-beforeMount'); },
          mounted() { log.push('kid-mounted'); },
          beforeUnmount() { log.push('kid-beforeUnmount'); },
          unmounted() { log.push('kid-unmounted'); },
        },
      });
      const Parent = defineComponent(api, {
        name: 'Parent', props: [],
        init(props, a) { this.n = a.__state(0); },
        create() {
          const el = document.createElement('div');
          const kid = childCreate(api, this, Kid, { label: 'one' });
          this._kid = kid.inst;
          el.appendChild(kid.el);
          return el;
        },
        setup(a) {
          childSetup(api, this._kid);
          a.__effect(() => { this.n.value; log.push('par-effect'); return () => log.push('par-clean'); });
        },
        hooks: {
          beforeUnmount() { log.push('par-beforeUnmount'); },
          unmounted() { log.push('par-unmounted'); },
        },
      });
      const target = document.createElement('main');
      const parent = new Parent({});
      parent.mount(target);
      const mountedShape = serialize(target);
      const chain = parent._kid._parent === parent;
      parent.unmount();
      return [log, mountedShape, serialize(target), chain];
    })).toEqual([
      ['kid-beforeMount', 'kid-effect', 'kid-mounted', 'par-effect',
 'par-beforeUnmount', 'kid-beforeUnmount', 'kid-clean', 'kid-unmounted', 'par-clean', 'par-unmounted'],
 '<main><div><span>one</span></div></main>',
 '<main></main>',
      true,
    ]);
  });

  test('the pinned contract: a child whose _init throws under a boundary degrades to a placeholder and the app continues', () => {
    expect(both((api) => {
      const log = [];
      const errs = [];
      const prevErr = console.error;
      console.error = (label) => errs.push(String(label));
      try {
        const Broken = defineComponent(api, {
          name: 'Broken', props: [],
          init() { throw new Error('init boom'); },
          create() { return document.createElement('em'); },
        });
        const Parent = defineComponent(api, {
          name: 'Parent', props: [],
          create() {
            const el = document.createElement('div');
            const kid = childCreate(api, this, Broken, {});
            this._kid = kid.inst;
            el.appendChild(kid.el);
            el.appendChild(document.createTextNode('still here'));
            return el;
          },
          hooks: { onError(err) { log.push('caught:' + err.message); } },
        });
        const target = document.createElement('main');
        new Parent({}).mount(target);
        return [log, errs, serialize(target)];
      } finally { console.error = prevErr; }
    })).toEqual([
      ['caught:init boom'],
      [],
 '<main><div><!--rip:child-init-failed: Broken-->still here</div></main>',
    ]);
  });

  test('the pinned contract: with NO boundary the construction failure logs and substitutes the error placeholder', () => {
    expect(both((api) => {
      const errs = [];
      const prevErr = console.error;
      console.error = (label) => errs.push(String(label));
      try {
        const Broken = defineComponent(api, {
          name: 'Broken', props: [],
          init() { throw new Error('init boom'); },
        });
        const Parent = defineComponent(api, {
          name: 'Parent', props: [],
          create() {
            const el = document.createElement('div');
            el.appendChild(childCreate(api, this, Broken, {}).el);
            return el;
          },
        });
        const target = document.createElement('main');
        new Parent({}).mount(target);
        return [errs, serialize(target)];
      } finally { console.error = prevErr; }
    })).toEqual([
      ['[Rip] Broken construction failed:'],
 '<main><div><!--rip:child-error: Broken--></div></main>',
    ]);
  });

  test('__handleComponentError walks to the NEAREST boundary; a throwing boundary passes to the next; the root rethrows', () => {
    expect(both((api) => {
      const log = [];
      const Top = defineComponent(api, {
        name: 'Top', props: [],
        hooks: { onError(err) { log.push('top:' + err.message); } },
      });
      const Mid = defineComponent(api, {
        name: 'Mid', props: [],
        hooks: { onError() { log.push('mid-throws'); throw new Error('boundary broke'); } },
      });
      const Leaf = defineComponent(api, { name: 'Leaf', props: [] });
      const top = new Top({});
      let mid, leaf;
      const p1 = api.__pushComponent(top);
      mid = new Mid({});
      const p2 = api.__pushComponent(mid);
      leaf = new Leaf({});
      api.__popComponent(p2);
      api.__popComponent(p1);
      api.__handleComponentError(new Error('boom'), leaf);
      const bare = new Leaf({});
      const rethrow = caught(() => api.__handleComponentError(new Error('unhandled'), bare));
      return [log, rethrow];
    })).toEqual([['mid-throws', 'top:boom'], ['throw', 'Error']]);
  });

  test('a corrupted (cyclic) parent chain terminates the boundary walk instead of hanging', () => {
    expect(both((api) => {
      const Leaf = defineComponent(api, { name: 'Leaf', props: [] });
      const a = new Leaf({});
      const b = new Leaf({});
      a._parent = b;
      b._parent = a;
      return caught(() => api.__handleComponentError(new Error('cycle boom'), a));
    })).toEqual(['throw', 'Error']);
  });
});

// ════════════════════════════════════════════════════════════════════
// Context
// ════════════════════════════════════════════════════════════════════

describe('context: offer/accept walks', () => {
  test('a provider\'s container comes back AS the container; the walk crosses generations; hasContext probes', () => {
    expect(both((api) => {
      const out = [];
      const Leaf = defineComponent(api, {
        name: 'Leaf', props: [],
        init(props, a) {
          this.theme = a.getContext('theme');       // the signal container
          out.push(a.getContext('version'));        // a readonly offer: the plain value
          out.push(a.hasContext('theme'), a.hasContext('nope'));
        },
        create() { return document.createComment('leaf'); },
      });
      const Mid = defineComponent(api, {
        name: 'Mid', props: [],
        create() {
          const el = document.createElement('div');
          const kid = childCreate(api, this, Leaf, {});
          this._kid = kid.inst;
          el.appendChild(kid.el);
          return el;
        },
      });
      const Root = defineComponent(api, {
        name: 'Root', props: [],
        init(props, a) {
          this.theme = a.__state('dark');
          a.setContext('theme', this.theme);
          a.setContext('version', 3);
        },
        create() {
          const el = document.createElement('main');
          const kid = childCreate(api, this, Mid, {});
          this._kid = kid.inst;
          el.appendChild(kid.el);
          return el;
        },
      });
      const target = document.createElement('body');
      const root = new Root({});
      root.mount(target);
      const leaf = root._kid._kid;
      out.push(leaf.theme === root.theme);          // container identity: the SHARED signal
      root.theme.value = 'light';
      out.push(leaf.theme.read());                  // the consumer sees the provider's write
      return out;
    })).toEqual([3, true, false, true, 'light']);
  });

  test('setContext outside component initialization rejects loudly (both runtimes)', () => {
    expect(both((api) => caught(() => api.setContext('k', 1))))
      .toEqual(['throw', 'Error']);
  });

  test('a nearer provider shadows a farther one', () => {
    expect(both((api) => {
      const out = [];
      const Leaf = defineComponent(api, {
        name: 'Leaf', props: [],
        init(props, a) { out.push(a.getContext('depth')); },
      });
      const Mid = defineComponent(api, {
        name: 'Mid', props: [],
        init(props, a) { a.setContext('depth', 'mid'); },
        create() {
          const el = document.createElement('div');
          el.appendChild(childCreate(api, this, Leaf, {}).el);
          return el;
        },
      });
      const Root = defineComponent(api, {
        name: 'Root', props: [],
        init(props, a) { a.setContext('depth', 'root'); },
        create() {
          const el = document.createElement('main');
          el.appendChild(childCreate(api, this, Mid, {}).el);
          return el;
        },
      });
      new Root({}).mount(document.createElement('body'));
      return out;
    })).toEqual(['mid']);
  });
});

// ════════════════════════════════════════════════════════════════════
// __clsx, __lis, __reconcile, __transition, emit
// ════════════════════════════════════════════════════════════════════

describe('render helpers', () => {
  test('__clsx flattens strings, objects, arrays, nesting; falsy drops', () => {
    expect(both((api) => [
      api.__clsx('a', 'b'),
      api.__clsx('a', null, undefined, false, 0, ''),
      api.__clsx({ on: true, off: false }, 'x'),
      api.__clsx(['a', { b: true }, ['c', { d: false }]]),
      api.__clsx(),
    ])).toEqual(['a b', 'a', 'on x', 'a b c', '']);
  });

  test('__lis finds a longest increasing subsequence, skipping -1 (new item) slots', () => {
    expect(both((api) => [
      api.__lis([0, 1, 2]),
      api.__lis([2, 0, 1]),
      api.__lis([-1, 0, -1, 1]),
      api.__lis([]),
      api.__lis([3, 2, 1, 0]),
    ])).toEqual([[0, 1, 2], [1, 2], [1, 3], [], [3]]);
  });

  test('emit dispatches a bubbling CustomEvent on the mounted root; detail carried; listeners up the tree fire', () => {
    expect(both((api) => {
      const log = [];
      const C = defineComponent(api, {
        name: 'C', props: [],
        create() { return document.createElement('button'); },
      });
      const target = document.createElement('main');
      const outer = document.createElement('body');
      outer.appendChild(target);
      target.addEventListener('save', (e) => log.push(['target', e.detail]));
      outer.addEventListener('save', (e) => log.push(['outer', e.detail]));
      const inst = new C({});
      inst.mount(target);
      inst.emit('save', { x: 1 });
      return log;
    })).toEqual([[ 'target', { x: 1 } ], [ 'outer', { x: 1 } ]]);
  });

  test('__transition drives the enter class sequence over rAF ticks and completes on transitionend', async () => {
    expect(await bothAsync(async (api) => {
      const el = document.createElement('div');
      const stages = [];
      let done = false;
      api.__transition(el, 'fade', 'enter', () => { done = true; });
      const cls = () => [...el.classList._set].sort().join(',');
      stages.push(cls());                       // from + active, synchronously
      await tick();                             // first rAF
      await tick();                             // second rAF
      stages.push(cls());                       // from swapped for to
      el.dispatchEvent({ type: 'transitionend', bubbles: false });
      stages.push(cls(), done);
      return stages;
    })).toEqual([
 'fade-enter-active,fade-enter-from',
 'fade-enter-active,fade-enter-to',
 '', true,
    ]);
  });

  test('the transition CSS presets inject into document.head once per runtime', async () => {
    await bothAsync(async (api) => {
      const el = document.createElement('div');
      api.__transition(el, 'slide', 'leave', null);
      await tick(); await tick();
      return true;
    });
    const styles = document.head.childNodes.filter((n) => n.tagName === 'style');
    expect(styles.length).toBeGreaterThan(0);
    for (const s of styles) {
      expect(s.textContent).toContain('.fade-enter-active');
      expect(s.textContent).toContain('.fly-leave-to');
    }
  });
});

// A hand-written block factory — the {c,m,p,d} handle shape the
// render-DSL loop emission produces; _first anchors moves.
const makeReconcileScenario = (api) => {
  const log = [];
  const container = document.createElement('ul');
  const anchor = document.createComment('anchor');
  container.appendChild(anchor);
  const state = { keys: [], items: [], blocks: [] };
  const factory = (ctx, item, i) => {
    let el;
    const label = (it) => (typeof it === 'object' && it !== null ? `${it.id}:${it.text}` : String(it));
    const block = {
      _s: false,
      _first: null,
      c() { el = document.createElement('li'); el.appendChild(document.createTextNode(label(item))); block._first = el; log.push('c:' + label(item)); },
      m(parent, ref) { parent.insertBefore(el, ref); },
      p(ctx2, item2, i2) { el.childNodes[0].data = label(item2); log.push(`p:${label(item2)}@${i2}`); },
      d(detaching) { if (detaching) el.remove(); log.push('d'); },
    };
    return block;
  };
  const run = (items, keyFn = null) => {
    api.__reconcile(anchor, state, items, null, factory, keyFn);
    return serialize(container);
  };
  return { log, run };
};

describe('__reconcile: the four phases', () => {
  test('phase 0 (first render), prefix/suffix reuse, pure insertion, removal', () => {
    expect(both((api) => {
      const { log, run } = makeReconcileScenario(api);
      const shapes = [];
      shapes.push(run(['a', 'b', 'c']));            // phase 0: batch create
      shapes.push(run(['a', 'b', 'c', 'd']));       // suffix append
      shapes.push(run(['a', 'x', 'y', 'b', 'c', 'd'])); // pure middle insertion
      shapes.push(run(['a', 'b', 'c', 'd']));       // middle removal
      shapes.push(run([]));                         // clear
      return [shapes, log];
    })).toEqual([
      [
 '<ul><li>a</li><li>b</li><li>c</li><!--anchor--></ul>',
 '<ul><li>a</li><li>b</li><li>c</li><li>d</li><!--anchor--></ul>',
 '<ul><li>a</li><li>x</li><li>y</li><li>b</li><li>c</li><li>d</li><!--anchor--></ul>',
 '<ul><li>a</li><li>b</li><li>c</li><li>d</li><!--anchor--></ul>',
 '<ul><!--anchor--></ul>',
      ],
      [
        // phase 0 runs c + p per block; suffix scans p() reused
        // blocks (their index moved); phase 3a runs c + p per insert.
 'c:a', 'p:a@0', 'c:b', 'p:b@1', 'c:c', 'p:c@2',
 'c:d', 'p:d@3',
 'p:d@5', 'p:c@4', 'p:b@3', 'c:x', 'p:x@1', 'c:y', 'p:y@2',
 'p:d@3', 'p:c@2', 'p:b@1', 'd', 'd',
 'd', 'd', 'd', 'd',
      ],
    ]);
  });

  test('phase 4 (LIS general case): permutations reuse blocks with minimal churn — no creates, no destroys', () => {
    expect(both((api) => {
      const { log, run } = makeReconcileScenario(api);
      run(['a', 'b', 'c', 'd']);
      log.length = 0;
      const shape = run(['c', 'a', 'b', 'd']);      // one move suffices
      const churn = log.filter((e) => e.startsWith('c:') || e === 'd');
      return [shape, churn];
    })).toEqual(['<ul><li>c</li><li>a</li><li>b</li><li>d</li><!--anchor--></ul>', []]);
  });

  test('the factory calling convention: OWN vars first, then ...outer — factory(ctx, item, i, ...outer) and p(ctx, item, i, ...outer) on every phase', () => {
    expect(both((api) => {
      const document = globalThis.document;
      const container = document.createElement('ul');
      const anchor = document.createComment('anchor');
      container.appendChild(anchor);
      const state = { blocks: [], keys: [] };
      const calls = [];
      const factory = (ctx, item, i, outerA, outerB) => {
        calls.push(`f:${item}@${i}|${outerA},${outerB}`);
        let el;
        return {
          _s: false, _first: null,
          c() { el = document.createElement('li'); this._first = el; },
          m(parent, ref) { parent.insertBefore(el, ref); },
          p(ctx2, item2, i2, oA, oB) { calls.push(`p:${item2}@${i2}|${oA},${oB}`); },
          d(detaching) { if (detaching) el.remove(); },
        };
      };
      api.__reconcile(anchor, state, ['a', 'b'], null, factory, null, 'ROW', 7);
      api.__reconcile(anchor, state, ['a', 'z', 'b'], null, factory, null, 'ROW', 7);
      return calls;
    })).toEqual([
 'f:a@0|ROW,7', 'p:a@0|ROW,7', 'f:b@1|ROW,7', 'p:b@1|ROW,7',
 'p:b@2|ROW,7', 'f:z@1|ROW,7', 'p:z@1|ROW,7',
    ]);
  });

  test('identity keying (keyFn null): same reference skips p(), new equal-position value patches', () => {
    expect(both((api) => {
      const { log, run } = makeReconcileScenario(api);
      run(['a', 'b']);
      log.length = 0;
      run(['a', 'z']);                              // 'a' reused silently, 'z' is a new key
      return log;
    })).toEqual(['c:z', 'p:z@1', 'd']);
  });

  test('keyed reconciliation: a stable key with a NEW item reference patches (the item-identity p() rule); the same reference skips', () => {
    expect(both((api) => {
      const { log, run } = makeReconcileScenario(api);
      const keyFn = (it) => it.id;
      const a1 = { id: 'a', text: 'one' };
      const b1 = { id: 'b', text: 'two' };
      run([a1, b1], keyFn);
      log.length = 0;
      const a2 = { id: 'a', text: 'ONE' };          // same key, new reference → p()
      const shape = run([a2, b1], keyFn);           // b1 identical reference → skipped
      return [shape, log];
    })).toEqual(['<ul><li>a:ONE</li><li>b:two</li><!--anchor--></ul>', ['p:a:ONE@0']]);
  });

  test('keyed move + insert + remove in one pass (phase 4 with a key map)', () => {
    expect(both((api) => {
      const { run } = makeReconcileScenario(api);
      const keyFn = (it) => it.id;
      const items = (ids) => ids.map((id) => ({ id, text: id.toUpperCase() }));
      run(items(['a', 'b', 'c']), keyFn);
      const shape = run(items(['c', 'x', 'a']), keyFn);
      return shape;
    })).toBe('<ul><li>c:C</li><li>x:X</li><li>a:A</li><!--anchor--></ul>');
  });

  test('a detached anchor makes the reconcile a no-op (both runtimes bail)', () => {
    expect(both((api) => {
      const anchor = document.createComment('floating');
      const state = { keys: [], items: [], blocks: [] };
      api.__reconcile(anchor, state, ['a'], null, () => { throw new Error('factory must not run'); }, null);
      return state.blocks;
    })).toEqual([]);
  });
});

describe('__reconcile duplicate keys (#126\'s runtime half)', () => {

  test('identity-keyed duplicates are legal rows — index queues reuse each old block once and destroy the leftover', () => {
    const { log, run } = makeReconcileScenario(RT);
    run(['x', 'a', 'a', 'b']);
    log.length = 0;
    expect(run(['x', 'b', 'a'])).toBe('<ul><li>x</li><li>b</li><li>a</li><!--anchor--></ul>');
    expect(log).toEqual(['p:b@1', 'p:a@2', 'd']);   // two reuses, ONE destroy — nothing stranded
  });

  test('duplicates SHRINKING keep the right count (identity queues, both directions)', () => {
    const { run } = makeReconcileScenario(RT);
    run(['a', 'a', 'a']);
    expect(run(['a', 'a'])).toBe('<ul><li>a</li><li>a</li><!--anchor--></ul>');
    expect(run(['a', 'a', 'a', 'a'])).toBe('<ul><li>a</li><li>a</li><li>a</li><li>a</li><!--anchor--></ul>');
  });

  test('EXPLICIT duplicate keyFn values reject loudly — keys are row identities (the doctrine)', () => {
    const { run } = makeReconcileScenario(RT);
    const keyFn = (it) => it.id;
    expect(() => run([{ id: 'a', text: '1' }, { id: 'a', text: '2' }], keyFn)).toThrow(
 '__reconcile: duplicate key "a" — keyed rows need unique keys (the key function must be injective over the items)',
    );
  });

});

describe('the owner restore on re-runs', () => {
  test('blocks created by a reconcile RE-run ride the owning frame — no explicit push at the factory site', () => {
    const { __state, __effect, __ownerFrame, __pushOwner, __popOwner, __reconcile } = RT;
    const items = __state(['a']);
    const probe = __state(0);
    const log = [];
    const container = document.createElement('ul');
    const anchor = document.createComment('anchor');
    container.appendChild(anchor);
    const state = { keys: [], items: [], blocks: [] };
    const factory = (ctx, item) => {
      let el;
      const block = {
        _s: false, _first: null,
        c() {
          el = document.createElement('li');
          block._first = el;
          // The per-block effect — created during whichever run of
          // the loop effect builds this block.
          __effect(() => { probe.value; log.push('block-effect:' + item); });
        },
        m(parent, ref) { parent.insertBefore(el, ref); },
        p() {},
        d(detaching) { if (detaching) el.remove(); },
      };
      return block;
    };
    const frame = __ownerFrame({ nested: false });
    const tok = __pushOwner(frame);
    __effect(() => { __reconcile(anchor, state, items.value, null, factory, null); });
    __popOwner(tok);
    // The RE-run arrives from this write, outside any owner context —
    // block b's effect must still land on the frame.
    items.value = ['a', 'b'];
    probe.value = 1;                   // both block effects are live
    frame.dispose();
    probe.value = 2;                   // nothing survives the frame
    expect(log).toEqual(['block-effect:a', 'block-effect:b', 'block-effect:a', 'block-effect:b']);
  });
});

describe('a throwing _init disposes the frame', () => {
  test('boundary-handled: the broken instance is INERT — its pre-throw effects are disposed, not leaked', () => {
    const { __state } = RT;
    const s = __state(0);
    const log = [];
    const Broken = defineComponent(RT, {
      name: 'Broken', props: [],
      init(props, a) {
        a.__effect(() => { s.value; log.push('run'); });
        throw new Error('init boom');
      },
    });
    const Boundary = defineComponent(RT, {
      name: 'B', props: [],
      hooks: { onError(e) { log.push('caught:' + e.message); } },
    });
    const b = new Boundary({});
    const prev = RT.__pushComponent(b);
    const kid = new Broken({});        // the boundary handles; the constructor returns
    RT.__popComponent(prev);
    expect(kid._initFailed).toBe(true);
    expect(kid._frame.disposed).toBe(true);
    s.value = 1;                       // the pre-throw effect must be dead
    expect(log).toEqual(['run', 'caught:init boom']);
  });

  test('unhandled: the constructor rethrows and leaks nothing', () => {
    const { __state } = RT;
    const s = __state(0);
    const log = [];
    const Broken = defineComponent(RT, {
      name: 'Broken', props: [],
      init(props, a) {
        a.__effect(() => { s.value; log.push('run'); });
        throw new Error('init boom');
      },
    });
    expect(() => new Broken({})).toThrow('init boom');
    s.value = 1;
    expect(log).toEqual(['run']);
  });
});

// ════════════════════════════════════════════════════════════════════
// The defect batteries: the silent shape pinned beside the loud one
// ════════════════════════════════════════════════════════════════════

describe('defect battery: constructor props are declared-only', () => {

  test('an unknown prop rejects naming the component and the declared set', () => {
    const K4 = defineComponent(RT, { name: 'Kid', props: ['title'] });
    expect(() => new K4({ titel: 'typo' })).toThrow("Kid: unknown prop 'titel' — declared props are [title]");
    expect(() => new K4({ mount: 5 })).toThrow("unknown prop 'mount'");
    expect(new K4({ title: 'ok' }).title).toBeUndefined(); // wiring is _init's job, not assignment
  });

  test('a DECLARED prop that shadows a prototype member or is underscore-prefixed rejects at first construction', () => {
    const Shadow = defineComponent(RT, { name: 'Shadow', props: ['mount'] });
    expect(() => new Shadow({})).toThrow("declared prop 'mount' collides with a component member");
    const Internal = defineComponent(RT, { name: 'Internal', props: ['_frame'] });
    expect(() => new Internal({})).toThrow("declared prop '_frame' collides with component internals");
    const Method = defineComponent(RT, { name: 'M', props: ['save'] });
    Method.prototype.save = function () {};
    expect(() => new Method({})).toThrow("declared prop 'save' collides with a component member");
  });
});

describe('defect battery: non-reactive prop updates are loud in ;  drops them silently', () => {
  const makeChild = (api) => defineComponent(api, {
    name: 'Kid', props: ['val', 'label'],
    init(props, a) {
      this.val = a.__state(props.val ?? 0);         // reactive prop
      this.label = props.label ?? 'plain';          // plain (`=`) prop
    },
  });

  test('_updateProp writes signal members and rejects non-reactive ones naming the fix', () => {
    const inst = new (makeChild(RT))({ val: 1, label: 'first' });
    inst._updateProp('val', 2);
    expect(inst.val.read()).toBe(2);
    expect(() => inst._updateProp('label', 'second')).toThrow(
      "Kid: prop 'label' is non-reactive — parent updates cannot reach it (declare it with ':=' to receive updates)",
    );
    expect(() => inst._updateProp('nope', 1)).toThrow("cannot update unknown prop 'nope'");
  });
});

describe('defect battery: beforeMount fires on every mount path in ;  skips it on root mount', () => {
  const makeC = (api, log) => defineComponent(api, {
    name: 'C', props: [],
    create() { log.push('create'); return document.createElement('p'); },
    setup() { log.push('setup'); },
    hooks: {
      beforeMount() { log.push('beforeMount'); },
      mounted() { log.push('mounted'); },
    },
  });

  test('the full contract holds — create → beforeMount → setup → mounted', () => {
    const log = [];
    new (makeC(RT, log))({}).mount(document.createElement('main'));
    expect(log).toEqual(['create', 'beforeMount', 'setup', 'mounted']);
  });

  test('both: the CHILD path fires beforeMount (the paired protocol above already relies on it)', () => {
    expect(both((api) => {
      const log = [];
      const Kid = defineComponent(api, {
        name: 'Kid', props: [],
        create() { return document.createElement('i'); },
        hooks: { beforeMount() { log.push('kid-beforeMount'); } },
      });
      const Parent = defineComponent(api, {
        name: 'Parent', props: [],
        create() {
          const el = document.createElement('div');
          const kid = childCreate(api, this, Kid, {});
          this._kid = kid.inst;
          el.appendChild(kid.el);
          return el;
        },
        setup() { childSetup(api, this._kid); },
      });
      new Parent({}).mount(document.createElement('main'));
      return log;
    })).toEqual(['kid-beforeMount']);
  });
});

describe('defect battery:  rejects remounting an unmounted instance;  remounts half-dead', () => {
  const makeC = (api, log) => defineComponent(api, {
    name: 'C', props: [],
    init(props, a) { this.n = a.__state(0); },
    create() { return document.createElement('p'); },
    setup(a) { a.__effect(() => { this.n.value; log.push('effect'); }); },
    hooks: {
      beforeUnmount() { log.push('beforeUnmount'); },
      unmounted() { log.push('unmounted'); },
    },
  });

  test('mount() on an unmounted instance rejects naming the fact and the fix', () => {
    const log = [];
    const target = document.createElement('main');
    const inst = new (makeC(RT, log))({});
    inst.mount(target);
    inst.unmount();
    expect(serialize(target)).toBe('<main></main>');
    expect(() => inst.mount(target)).toThrow(
 'C: cannot mount an unmounted instance — its effects were disposed on unmount; construct a new instance',
    );
  });
});

describe('defect battery: emit outside the mounted window is loud in ;  drops it silently', () => {
  const makeC = (api) => defineComponent(api, {
    name: 'C', props: [],
    create() { return document.createElement('button'); },
  });

  test('emit before mount and after unmount reject naming the window', () => {
    const inst = new (makeC(RT))({});
    expect(() => inst.emit('save')).toThrow("C: emit('save') outside the mounted window");
    const target = document.createElement('main');
    const mounted = new (makeC(RT))({});
    mounted.mount(target);
    const log = [];
    target.addEventListener('save', () => log.push('heard'));
    mounted.emit('save');
    expect(log).toEqual(['heard']);
    mounted.unmount();
    expect(() => mounted.emit('save')).toThrow('outside the mounted window');
  });
});

describe('defect battery: a context miss is loud in ;  returns undefined and dies downstream', () => {

  test('getContext on a missing key rejects naming the key and the probe', () => {
    const Kid = defineComponent(RT, {
      name: 'Kid', props: [],
      init(props, a) { this.theme = a.getContext('theme'); },
    });
    expect(() => new Kid({})).toThrow(
 'getContext: no provider for context "theme" in this component\'s parent chain — offer it from an ancestor, or probe with hasContext(key) where absence is legal',
    );
  });

});

// ════════════════════════════════════════════════════════════════════
// The composition seams: children, __bind_ keys, extends rest.
// this side-only units — the old runtime re-emits its rest machinery into every extends
// CLASS (no runtime twin exists to pair against); the compiled-level
// paired scenarios live in test/components.test.js.
// ════════════════════════════════════════════════════════════════════

describe('the M12-D constructor seams: children and __bind_ keys', () => {
  test('`children` rides every constructor (the projection channel) and lands on the instance', () => {
    const Kid = defineComponent(RT, { name: 'Kid', props: [] });
    const node = document.createElement('p');
    expect(new Kid({ children: node }).children).toBe(node);
    expect('children' in new Kid({})).toBe(false);
  });

  test('`__bind_x__` validates against the DECLARED set — an unknown bind name is loud, extends included', () => {
    const Kid = defineComponent(RT, {
      name: 'Kid', props: ['label'],
      init(p, a) { this.label = a.__state(p.__bind_label__ ?? p.label ?? 'k'); },
    });
    const shared = RT.__state('outside');
    const inst = new Kid({ __bind_label__: shared });
    expect(inst.label).toBe(shared); // the container passthrough
    expect(() => new Kid({ __bind_labell__: shared })).toThrow(
      "Kid: cannot bind unknown prop 'labell' — declared props are [label]",
    );
    const Ext = defineComponent(RT, { name: 'Ext', props: [] });
    Ext.__extends = 'button';
    // __bind_ keys never ride rest (the old runtime silently drops them there).
    expect(() => new Ext({ __bind_x__: shared })).toThrow("cannot bind unknown prop 'x'");
  });
});

describe('the extends rest seam (runtime-owned;  re-emits it per class — /#165)', () => {
  const makeBtn = (props = {}, spec = {}) => {
    const cls = defineComponent(RT, {
      name: 'Btn', props: ['label'],
      init(p, a) { this.label = a.__state(p.__bind_label__ ?? p.label ?? 'b'); },
      ...spec,
    });
    cls.__extends = 'button';
    return new cls(props);
  };

  test('undeclared constructor props collect into the reactive rest view; declared, children, and __bind_ stay out', () => {
    const shared = RT.__state('s');
    const inst = makeBtn({ label: 'x', title: 'tip', disabled: true, children: document.createElement('i'), __bind_label__: shared });
    expect(inst._rest).toEqual({ title: 'tip', disabled: true });
    expect(inst.rest.read()).toBe(inst._rest);
    expect(inst.label).toBe(shared);
  });

  test('_updateProp routes undeclared names to rest and applies onto the inherited element; declared props keep their contracts', () => {
    const inst = makeBtn({});
    const el = document.createElement('button');
    inst._inheritedEl = el;
    inst._updateProp('title', 'tip');
    expect(inst._rest.title).toBe('tip');
    expect(el.getAttribute('title')).toBe('tip');
    inst._updateProp('title', null); // null deletes and removes
    expect('title' in inst._rest).toBe(false);
    expect(el.getAttribute('title')).toBeNull();
    inst._updateProp('label', 'new');
    expect(inst.label.read()).toBe('new');
  });

  test('rest.touch() notifies @rest readers on _setRestProp', () => {
    const inst = makeBtn({ title: 'a' });
    const log = [];
    RT.__effect(() => { log.push(inst.rest.value.title); });
    inst._setRestProp('title', 'b');
    expect(log).toEqual(['a', 'b']);
  });

  test('_applyInheritedProp forks: events batch-wrap and replace, class merges through __clsx, style takes string/object/null, booleans toggle, attributes set/remove; key/ref/children/__bind_ skip', () => {
    const inst = makeBtn({});
    const el = document.createElement('button');
    // @event: listener add, replace (old removed), non-function clears.
    const calls = [];
    const h1 = () => calls.push('h1');
    const h2 = () => calls.push('h2');
    inst._applyInheritedProp(el, '@click', h1);
    el.dispatchEvent({ type: 'click', bubbles: false });
    inst._applyInheritedProp(el, '@click', h2);
    el.dispatchEvent({ type: 'click', bubbles: false });
    inst._applyInheritedProp(el, '@click', null);
    el.dispatchEvent({ type: 'click', bubbles: false });
    expect(calls).toEqual(['h1', 'h2']);
    // class routes through __clsx.
    inst._applyInheritedProp(el, 'class', ['big', { on: true, off: false }]);
    expect(el.className).toBe('big on');
    // style: string → attribute; object → assigned; null → removed.
    inst._applyInheritedProp(el, 'style', 'color: red');
    expect(el.getAttribute('style')).toBe('color: red');
    inst._applyInheritedProp(el, 'style', { color: 'blue' });
    expect(el.style.color).toBe('blue');
    inst._applyInheritedProp(el, 'style', null);
    expect(el.getAttribute('style')).toBeNull();
    // innerHTML family assigns directly.
    inst._applyInheritedProp(el, 'textContent', 'text');
    expect(el.textContent).toBe('text');
    // An existing PROPERTY takes the property write.
    el.value = '';
    inst._applyInheritedProp(el, 'value', 'v');
    expect(el.value).toBe('v');
    // Booleans: true → empty attribute, false → removed.
    inst._applyInheritedProp(el, 'disabled', true);
    expect(el.getAttribute('disabled')).toBe('');
    inst._applyInheritedProp(el, 'disabled', false);
    expect(el.getAttribute('disabled')).toBeNull();
    // Plain attribute values set; the skip list never lands.
    inst._applyInheritedProp(el, 'title', 'tip');
    expect(el.getAttribute('title')).toBe('tip');
    for (const key of ['key', 'ref', 'children', '__bind_x__']) {
      inst._applyInheritedProp(el, key, 'junk');
      expect(el.getAttribute(key)).toBeNull();
    }
  });

  test('per-key writer disposal: deleting or overwriting a rest key kills its container writer — the old container can never re-apply', () => {
    const frame = RT.__ownerFrame({ nested: false });
    const tok = RT.__pushOwner(frame);
    let inst, el, dis;
    try {
      dis = RT.__state(true);
      inst = makeBtn({ disabled: dis });
      el = document.createElement('button');
      inst._inheritedEl = el;
      inst._applyRestToInheritedEl();
    } finally { RT.__popOwner(tok); }
    expect(el.getAttribute('disabled')).toBe('');
    // DELETE the key, then mutate the OLD container: the attribute
    // must stay gone (the undisposed writer would resurrect it).
    inst._updateProp('disabled', null);
    expect(el.getAttribute('disabled')).toBeNull();
    dis.value = false;
    dis.value = true;
    expect(el.getAttribute('disabled')).toBeNull();
    // OVERWRITE with a new container, then mutate the old one: only
    // the new writer applies.
    const dis2 = RT.__state(false);
    inst._setRestProp('disabled', dis2);
    expect(el.getAttribute('disabled')).toBeNull();
    dis.value = false;
    dis.value = true;                       // the old container — inert
    expect(el.getAttribute('disabled')).toBeNull();
    dis2.value = true;                      // the live writer
    expect(el.getAttribute('disabled')).toBe('');
    frame.dispose();
  });

  test('update-path writer ownership: writers own to the CHILD\'s frame whatever frame the caller holds; both frames stay FLAT across hot updates; writers die on the child\'s unmount, never the parent\'s', () => {
    const parentFrame = RT.__ownerFrame({ nested: false });
    const inst = makeBtn({});
    const el = document.createElement('button');
    inst._inheritedEl = el;
    const parentBase = parentFrame.size;
    const childBase = inst._frame.size;
    // The update path arrives with the PARENT's frame current (the
    // class-scope updater effect's restored owner).
    const a = RT.__state('A');
    const b = RT.__state('B');
    const tok = RT.__pushOwner(parentFrame);
    try {
      for (let i = 0; i < 40; i++) inst._setRestProp('title', i % 2 === 0 ? a : b);
    } finally { RT.__popOwner(tok); }
    // FLAT: the parent frame never took a writer; the child frame
    // holds exactly ONE (dead disposers removed on overwrite).
    expect(parentFrame.size).toBe(parentBase);
    expect(inst._frame.size).toBe(childBase + 1);
    // The last writer (b) drives; the displaced container is dead.
    expect(el.getAttribute('title')).toBe('B');
    a.value = 'STALE';
    expect(el.getAttribute('title')).toBe('B');
    b.value = 'LIVE';
    expect(el.getAttribute('title')).toBe('LIVE');
    // The writer dies on the CHILD's unmount — the parent's frame
    // has nothing to do with it.
    inst.unmount({ removeDOM: false });
    b.value = 'AFTER';
    expect(el.getAttribute('title')).toBe('LIVE');
    parentFrame.dispose();
  });

  test('post-unmount updates are inert: _updateProp and _setRestProp on an unmounted instance write nothing and grow nothing', () => {
    const inst = makeBtn({});
    const el = document.createElement('button');
    inst._inheritedEl = el;
    inst._setRestProp('title', 'live');
    expect(el.getAttribute('title')).toBe('live');
    inst.unmount({ removeDOM: false });
    inst._updateProp('label', 'dead');       // declared reactive prop
    expect(inst.label.read()).toBe('b');     // never written
    inst._updateProp('title', 'dead');       // rest routing
    expect(el.getAttribute('title')).toBe('live');
    inst._setRestProp('other', RT.__state('x'));
    expect(el.getAttribute('other')).toBeNull();
    expect(inst._restWriters?.other).toBeUndefined();
  });

  test('#164: a shared CONTAINER in rest applies its LIVE value through an effect on the current owner frame ', () => {
    const dis = RT.__state(false);
    const inst = makeBtn({ disabled: dis });
    const el = document.createElement('button');
    inst._inheritedEl = el;
    const frame = RT.__ownerFrame({ nested: false });
    const tok = RT.__pushOwner(frame);
    try {
      inst._applyRestToInheritedEl();
    } finally { RT.__popOwner(tok); }
    // Applied UNWRAPPED (false → attribute removed), not the raw object.
    expect(el.getAttribute('disabled')).toBeNull();
    dis.value = true;
    expect(el.getAttribute('disabled')).toBe('');
    // The effect dies with the frame.
    frame.dispose();
    dis.value = false;
    expect(el.getAttribute('disabled')).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════
// delivery: the seam's fourth customer, via hand-written references
// ════════════════════════════════════════════════════════════════════

const REACTIVE_IMPORT = /^import \{ __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal \} from ".*src\/runtime\/reactive\.js";$/;
const COMPONENTS_IMPORT = /^import \{ setContext, getContext, hasContext, __Component, __pushComponent, __popComponent, __clsx, __lis, __reconcile, __transition, __handleComponentError, __detach, __ownerFrame, __pushOwner, __popOwner, __detachRef \} from ".*src\/runtime\/components\.js";$/;
const ALL_COMPONENT_NAMES = ['setContext', 'getContext', 'hasContext', '__Component', '__pushComponent',
 '__popComponent', '__clsx', '__lis', '__reconcile', '__transition', '__handleComponentError', '__detach',
 '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'];

// A program that exercises the runtime for real without the language
// surface: a hand-built component scope around the context API.
const RUN_SRC = [
 'c = {_parent: null}',
 'prev = __pushComponent(c)',
 'setContext("theme", "dark")',
 'console.log(getContext("theme"))',
 'console.log(__clsx("a", {b: true}, ["c"]))',
 '__popComponent(prev)',
].join('\n');

describe('runtime delivery: the components runtime', () => {
  test("emit() default is 'none': undecorated output, BOTH runtime uses reported (requires: 'reactive')", () => {
    const { code, runtimes } = compile(RUN_SRC);
    expect(code).not.toContain('import');
    expect([...runtimes].sort()).toEqual(['components', 'reactive']);
  });

  test("'import' injects TWO imports in table order (reactive, then components), each mapped synthetic and range-keyed", () => {
    const { code, mappings, runtimes } = compile(RUN_SRC, { runtimeDelivery: 'import' });
    const [l0, l1] = code.split('\n');
    expect(l0).toMatch(REACTIVE_IMPORT);
    expect(l1).toMatch(COMPONENTS_IMPORT);
    expect([...runtimes].sort()).toEqual(['components', 'reactive']);
    const rows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.mappingKind).toBe('synthetic');
      expect(row.sourceStart).toBe(row.sourceEnd);
    }
    // Range-keyed: the rows tile the two injected lines, disjoint.
    expect(rows[0].generatedStart).toBe(0);
    expect(rows[1].generatedStart).toBe(rows[0].generatedEnd);
    expect(code.slice(rows[0].generatedStart, rows[0].generatedEnd)).toContain('reactive.js');
    expect(code.slice(rows[1].generatedStart, rows[1].generatedEnd)).toContain('components.js');
    expect(mappings.serializableRows().some((r) => r.role === 'runtime')).toBe(false);
  });

  test("'inline' FUSES the two bodies into ONE IIFE binding the union, one synthetic row, and it RUNS standalone", () => {
    const { code, mappings } = compile(RUN_SRC, { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    expect(code.startsWith(
 'const { __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal, ' +
 'setContext, getContext, hasContext, __Component, __pushComponent, __popComponent, __clsx, __lis, __reconcile, __transition, __handleComponentError, __detach, __ownerFrame, __pushOwner, __popOwner, __detachRef } = (() => {',
    )).toBe(true);
    expect(code).toContain('__RIP_REACTIVE_SENTINEL');
    expect(code).toContain('__RIP_COMPONENTS_SENTINEL');
    // The module seams strip: no import of the sibling runtime, no export line.
    expect(code).not.toContain("from './reactive.js'");
    expect(code).not.toMatch(/^export/m);
    const rows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(rows).toHaveLength(1);
    const dir = mkdtempSync(join(tmpdir(), 'rip-crt-inline-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      const r = spawnSync('bun', [join(dir, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['dark', 'a b c']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every delivered name triggers alone — and drags the reactive runtime along (requires)', () => {
    for (const name of ALL_COMPONENT_NAMES) {
      const { code, runtimes } = compile(`x = ${name}`, { runtimeDelivery: 'import' });
      expect([...runtimes].sort()).toEqual(['components', 'reactive']);
      const [l0, l1] = code.split('\n');
      expect(l0).toMatch(REACTIVE_IMPORT);
      expect(l1).toMatch(COMPONENTS_IMPORT);
    }
  });

  test('program-scope shadowing suppresses injection per name; all bound → nothing injects', () => {
    const a = compile('setContext = (k, v) => v\nsetContext("a", 1)\nx = getContext("a")', { runtimeDelivery: 'import' });
    const compLine = a.code.split('\n').find((l) => l.includes('components.js'));
    expect(compLine).toMatch(/^import \{ getContext, hasContext, __Component/);
    expect(compLine).not.toContain('setContext,');
    const allBound = ALL_COMPONENT_NAMES.map((n) => `${n} = 1`).join('\n') + '\nx = setContext';
    const b = compile(allBound, { runtimeDelivery: 'import' });
    expect(b.code).not.toContain('runtime/components.js');
    expect([...b.runtimes]).toEqual([]);
  });

  test('function-scope shadowing does NOT suppress module-level injection', () => {
    const { code } = compile('f = ->\n  setContext = 1\n  setContext\nx = getContext("k")', { runtimeDelivery: 'import' });
    expect(code.split('\n')[1]).toMatch(COMPONENTS_IMPORT);
  });

  test('NAME occurrences that are not references never trigger', () => {
    for (const src of [
 'x = obj.setContext',
 'x = obj?.__Component',
 'x = {getContext: 1, __clsx: 2}',
 'x = "setContext __Component hasContext"',
 'f = ({setContext}) -> 1',
 'import { setContext } from "./mine.js"\nsetContext("a", 1)',
    ]) {
      const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
      expect(code).not.toContain('runtime/components.js');
      expect([...runtimes]).toEqual([]);
    }
  });

  test('the practical sentinel meeting: two standalone fused copies reject loudly (the reactive tripwire fires first — the fused body evaluates reactive first)', () => {
    const { code } = compile(RUN_SRC, { runtimeDelivery: 'inline' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-csentinel-'));
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

  test("the components sentinel itself: a second components body meeting the shared module rejects with the component message", () => {
    // The shared modules evaluate first (module cache absorbs the
    // copy's reactive import), so the copy's COMPONENTS sentinel is
    // the tripwire that fires.
    const copySource = readFileSync(CRT_PATH, 'utf8')
      .replace("from './reactive.js'", `from ${JSON.stringify(pathToFileURL(RRT_PATH).href)}`);
    const dir = mkdtempSync(join(tmpdir(), 'rip-csentinel2-'));
    try {
      writeFileSync(join(dir, 'copy.js'), copySource);
      writeFileSync(join(dir, 'main.js'),
        `import ${JSON.stringify(pathToFileURL(CRT_PATH).href)};\nimport './copy.js';\n`);
      const r = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two copies of the Rip component runtime');
      expect(r.stderr).toContain('rip CLI/loader');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path end to end: a .rip file with hand-written references runs through the shared modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-cloaderpath-'));
    try {
      writeFileSync(join(dir, 'main.rip'), RUN_SRC + '\n');
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['dark', 'a b c']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('import and inline modes are observably equivalent (the same program, the same output)', () => {
    const imp = compile(RUN_SRC, { runtimeDelivery: 'import' });
    const dir = mkdtempSync(join(tmpdir(), 'rip-cparity-'));
    try {
      writeFileSync(join(dir, 'imp.js'), imp.code);
      const r = spawnSync('bun', [join(dir, 'imp.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['dark', 'a b c']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('all FOUR runtimes in one module: table order, distinct units, every key reported', () => {
    const src = 'S = schema\n  a! integer\nn = __state(S.parse({a: 4}).a)\nsetContext2 = getContext\nx = __schemaSetAdapter';
    const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
    expect([...runtimes].sort()).toEqual(['components', 'reactive', 'schema', 'schema-orm']);
    const lines = code.split('\n').slice(0, 4);
    expect(lines[0]).toContain('runtime/schema.js');
    expect(lines[1]).toContain('runtime/schema-orm.js');
    expect(lines[2]).toContain('runtime/reactive.js');
    expect(lines[3]).toContain('runtime/components.js');
  });
});

// ════════════════════════════════════════════════════════════════════
// zero-cost: component-free files carry no component bytes
// ════════════════════════════════════════════════════════════════════

describe('zero-cost gate: the components extension', () => {
  test('a component-free program compiles byte-identical under every delivery mode', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = compile('x = 1 + 2\nf = (a) -> a * x', { runtimeDelivery: mode });
      expect(code).toBe('let x = 1 + 2;\nlet f = function(a) {\n  return (a * x);\n};');
      expect([...runtimes]).toEqual([]);
      expect(code).not.toContain('__Component');
      expect(code).not.toContain('components');
    }
    const full = fullCompile('x = 1 + 2');
    expect(full.code).toBe('let x = 1 + 2;');
    expect([...full.runtimes]).toEqual([]);
  });

  test('a reactive-only program carries NO component bytes under any mode (the M11-A (e) treatment for the revised reactive body)', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = compile('n := 1\nstop ~> console.log(n)', { runtimeDelivery: mode });
      expect([...runtimes]).toEqual(['reactive']);
      expect(code).not.toContain('components');
      expect(code).not.toContain('__Component');
      expect(code).not.toContain('setContext');
      expect(code).not.toContain('__reconcile');
    }
  });

  test('a schema-only program stays component-free (and vice versa) — runtimes deliver independently', () => {
    const s = compile('S = schema\n  a! integer', { runtimeDelivery: 'import' });
    expect(s.code).not.toContain('runtime/components.js');
    expect([...s.runtimes]).toEqual(['schema']);
    const c = compile('x = __clsx("a")', { runtimeDelivery: 'import' });
    expect(c.code).not.toContain('runtime/schema.js');
    expect([...c.runtimes].sort()).toEqual(['components', 'reactive']);
  });
});

// ════════════════════════════════════════════════════════════════════
// The language surface GRADUATED in  `component`/`render` are
// keywords (the old runtime parity), offer/accept are context-sensitive tokens.
// These pins hold the boundary the graduation left behind.
// ════════════════════════════════════════════════════════════════════

describe('the component language surface (M12-B graduated boundary)', () => {
  test('`component` and `render` are KEYWORDS: a bare value use rejects at parse ', () => {
    parseFails('Card = component');
    parseFails('x = render');
  });

  test('context-free `offer`/`accept` stay plain identifiers — the bare-call reading is pinned ', () => {
    expect(compile('accept theme').code).toBe('accept(theme);');
    expect(compile('offer console.log("hi")').code).toBe('offer(console.log("hi"));');
  });

  test('`x <~ e` keeps its comparison parse — the gate spelling is RESERVED', () => {
    expect(compile('x <~ load()').code).toBe('x < (~load());');
  });
});
