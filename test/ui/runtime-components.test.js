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
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compiler.js';
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

// The child-instantiation protocol mirrors generated output: parent
// scope around construction, runtime-owned mount creation/setup, and
// the established placeholders on failure.
const childCreate = (api, parent, Cls, props = {}) => {
  let inst = null, el = null;
  const prev = api.__pushComponent(parent);
  try {
    try {
      inst = new Cls(props);
      if (inst && inst._initFailed) {
        inst = null;
        el = document.createComment(`rip:child-init-failed: ${Cls.name}`);
      } else if (inst._mountCreate()) {
        el = inst._root;
        (parent._children || (parent._children = [])).push(inst);
      } else {
        inst = null;
        el = document.createComment(`rip:child-error: ${Cls.name}`);
      }
    } catch (childErr) {
      api.__reportChildFailure(Cls.name, childErr);
      inst = null;
      el = document.createComment(`rip:child-error: ${Cls.name}`);
    }
  } finally { api.__popComponent(prev); }
  return { inst, el };
};

const childSetup = (api, inst) => {
  if (inst && inst._state === 'mounting') {
    inst._mountSetup(document.createComment(`rip:child-error: ${inst.constructor.name}`));
  }
};

const tick = () => new Promise((r) => setTimeout(r, 0));

// ════════════════════════════════════════════════════════════════════
// Module shape: the exports, and no globalThis writes but the sentinels
// ════════════════════════════════════════════════════════════════════

describe('module shape', () => {
  test('named exports are the delivered set plus the private renderer construction seam', () => {
    expect(Object.keys(v4c).sort()).toEqual([
 '__Component', '__claimGateConstructor', '__clsx', '__detach', '__detachRef', '__gateBind', '__handleComponentError',
 '__hmrClassify', '__hmrEmit', '__hmrEntries', '__hmrEvents', '__hmrLookup', '__hmrMigrateDiff',
 '__hmrMigrateRemount', '__hmrPatch', '__hmrPreserveState', '__hmrRegisterDefinition', '__hmrRegistry',
 '__hmrRestoreUi', '__hmrSnapshotUi',
 '__lis',
 '__ownerFrame', '__popComponent', '__popOwner', '__pushComponent', '__pushOwner',
 '__reconcile', '__reportChildFailure', '__setChildFailureReporter', '__style', '__transition',
 'getContext', 'hasContext', 'setContext',
    ]);
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

  test('mount state is single-use across the same and different targets', () => {
    const C = defineComponent(RT, {
      name: 'SingleMount',
      create() { return document.createElement('p'); },
    });
    const first = document.createElement('main');
    const second = document.createElement('aside');
    const inst = new C({});
    expect(inst._state).toBe('new');
    inst.mount(first);
    expect(inst._state).toBe('mounted');
    expect(() => inst.mount(first)).toThrow('cannot mount an already-mounted instance');
    expect(() => inst.mount(second)).toThrow('cannot mount an already-mounted instance');
    expect(serialize(first)).toBe('<main><p></p></main>');
    expect(serialize(second)).toBe('<aside></aside>');
    inst.unmount();
    expect(inst._state).toBe('unmounted');
    expect(() => inst.mount(first)).toThrow('cannot mount an unmounted instance');
  });

  test('root mount failure matrix rolls every phase to the same clean terminal state', () => {
    const phases = ['create', 'append', 'beforeMount', 'setup', 'mounted', 'ref', 'multi-root'];
    const run = (phase, handled) => {
      const source = RT.__state(0);
      const log = [];
      let refValue = null;
      const C = defineComponent(RT, {
        name: `Fail_${phase}_${handled}`,
        create(a) {
          if (phase === 'create') throw new Error(`boom:${phase}`);
          let root;
          if (phase === 'multi-root') {
            root = document.createDocumentFragment();
            const firstNode = document.createElement('i');
            const secondNode = document.createElement('b');
            root.appendChild(firstNode);
            root.appendChild(secondNode);
            this._nodes = [firstNode, secondNode];
          } else {
            root = document.createElement('section');
          }
          if (phase === 'ref') {
            refValue = root;
            this._refCleanups = [() => { refValue = null; }];
          }
          RT.__effect(() => { source.value; log.push('effect'); });
          return root;
        },
        setup() {
          if (phase === 'setup' || phase === 'ref') throw new Error(`boom:${phase}`);
        },
        hooks: {
          beforeMount() {
            if (phase === 'beforeMount') throw new Error(`boom:${phase}`);
          },
          mounted() {
            if (phase === 'mounted' || phase === 'multi-root') throw new Error(`boom:${phase}`);
          },
          beforeUnmount() { log.push('beforeUnmount'); },
          unmounted() { log.push('unmounted'); },
          ...(handled ? { onError(error) { log.push(error.message); } } : {}),
        },
      });
      const target = document.createElement('main');
      if (phase === 'append') {
        const append = target.appendChild;
        target.appendChild = function (node) {
          append.call(this, node);
          throw new Error('boom:append');
        };
      }
      const inst = new C({});
      let thrown = null;
      try { inst.mount(target); } catch (error) { thrown = error; }
      const runs = log.filter((x) => x === 'effect').length;
      source.value = 1;
      expect(log.filter((x) => x === 'effect')).toHaveLength(runs);
      expect(inst._state).toBe('failed');
      expect(inst._frame.disposed).toBe(true);
      expect(inst._target).toBeNull();
      expect(inst._root).toBeNull();
      expect(inst._nodes).toBeNull();
      expect(inst._children ?? null).toBeNull();
      expect(inst._refCleanups ?? null).toBeNull();
      expect(inst._restWriters ?? null).toBeNull();
      expect(inst._restHandlers ?? null).toBeNull();
      expect(refValue).toBeNull();
      expect(serialize(target)).toBe('<main></main>');
      expect(log).not.toContain('beforeUnmount');
      expect(log).not.toContain('unmounted');
      expect(Boolean(thrown)).toBe(!handled);
      if (thrown) expect(thrown.message).toBe(`boom:${phase}`);
      expect(() => inst.mount(target)).toThrow('cannot mount a failed instance');
    };
    for (const phase of phases) {
      run(phase, true);
      run(phase, false);
    }
  });

  test('rollback preserves the mount error when cleanup also fails', () => {
    const C = defineComponent(RT, {
      name: 'CleanupFailure',
      create() { return document.createElement('div'); },
      setup() { throw new Error('primary'); },
    });
    const inst = new C({});
    const dispose = inst._frame.dispose.bind(inst._frame);
    inst._frame.dispose = () => { dispose(); throw new Error('secondary'); };
    const prior = console.error;
    console.error = () => {};
    try {
      expect(() => inst.mount(document.createElement('main'))).toThrow('primary');
    } finally {
      console.error = prior;
    }
    expect(inst._state).toBe('failed');
  });

  test('setup rollback reports a throwing ref-subscriber flush, preserves the mount error, and finishes teardown', () => {
    const ref = RT.__state(null);
    let armed = false;
    const stop = RT.__effect(() => {
      const value = ref.value;
      if (armed && value === null) throw new Error('secondary ref subscriber');
    });
    const C = defineComponent(RT, {
      name: 'RefFlushFailure',
      create() {
        const root = document.createElement('div');
        ref.value = root;
        this._refCleanups = [() => RT.__detachRef(ref, root)];
        return root;
      },
      setup() {
        armed = true;
        throw new Error('primary mount failure');
      },
    });
    const target = document.createElement('main');
    const inst = new C({});
    const reports = [];
    const prior = console.error;
    console.error = (label, error) => reports.push([String(label), error?.message]);
    try {
      expect(() => inst.mount(target)).toThrow('primary mount failure');
    } finally {
      console.error = prior;
      stop();
    }
    expect(reports).toEqual([
      ['[Rip] ref cleanup batch flush error:', 'secondary ref subscriber'],
    ]);
    expect(ref.read()).toBeNull();
    expect(serialize(target)).toBe('<main></main>');
    expect(inst._state).toBe('failed');
    for (const field of [
      '_target', '_root', '_nodes', '_children', '_refCleanups',
      '_restWriters', '_restHandlers', '_inheritedEl',
    ]) expect(inst[field]).toBeNull();
  });

  test('unmount before mount terminally disposes init resources without mounted-only hooks', () => {
    const source = RT.__state(0);
    const log = [];
    const C = defineComponent(RT, {
      name: 'NeverMounted',
      init(props, api) {
        api.__effect(() => { source.value; log.push('effect'); });
      },
      hooks: {
        beforeUnmount() { log.push('beforeUnmount'); },
        unmounted() { log.push('unmounted'); },
      },
    });
    const inst = new C({});
    expect(log).toEqual(['effect']);
    inst.unmount();
    expect(inst._state).toBe('unmounted');
    expect(inst._frame.disposed).toBe(true);
    expect(log).toEqual(['effect']);
    source.value = 1;
    expect(log).toEqual(['effect']);
    expect(() => inst.mount(document.createElement('main'))).toThrow('cannot mount an unmounted instance');
  });

  test('failed rollback removes rest writers and handlers', () => {
    const value = RT.__state('live');
    const calls = [];
    let inherited = null;
    const C = defineComponent(RT, {
      name: 'RestFailure',
      create() {
        inherited = document.createElement('button');
        this._inheritedEl = inherited;
        this._applyInheritedProp(inherited, 'title', value);
        this._applyInheritedProp(inherited, '@click', () => calls.push('click'));
        return inherited;
      },
      setup() { throw new Error('rest failure'); },
      hooks: { onError() {} },
    });
    const target = document.createElement('main');
    const inst = new C({});
    inst.mount(target);
    expect(inst._state).toBe('failed');
    expect(inst._restWriters).toBeNull();
    expect(inst._restHandlers).toBeNull();
    inherited.dispatchEvent({ type: 'click', target: inherited, bubbles: false });
    value.value = 'dead';
    expect(calls).toEqual([]);
    expect(inherited.getAttribute('title')).toBe('live');
    expect(serialize(target)).toBe('<main></main>');
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

  test('a host swaps the child-failure reporter: a reporter that throws fails the enclosing mount, and the swap hands back the previous one', () => {
    expect(both((api) => {
      const seen = [];
      const prev = api.__setChildFailureReporter((name, error) => {
        seen.push(`${name}: ${error.message}`);
        throw error;
      });
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
        const outcome = caught(() => new Parent({}).mount(target));
        return [seen, outcome, serialize(target)];
      } finally {
        // The swap returns what it replaced, so a host restores it.
        expect(api.__setChildFailureReporter(prev)).not.toBe(prev);
      }
    })).toEqual([
      ['Broken: init boom'],
      ['throw', 'Error'],
      '<main></main>',
    ]);
  });

  test('child create and setup failures roll back nested resources and leave placeholders', () => {
    for (const phase of ['create', 'setup']) {
      const source = RT.__state(0);
      const log = [];
      let child = null;
      let grandchild = null;
      const Grandchild = defineComponent(RT, {
        name: 'Grandchild',
        create() { return document.createElement('small'); },
        setup() { RT.__effect(() => { source.value; log.push('grand-effect'); }); },
        hooks: {
          beforeUnmount() { log.push('grand-beforeUnmount'); },
          unmounted() { log.push('grand-unmounted'); },
        },
      });
      const Broken = defineComponent(RT, {
        name: `Broken_${phase}`,
        create() {
          const root = document.createElement('article');
          const nested = childCreate(RT, this, Grandchild, {});
          grandchild = nested.inst;
          root.appendChild(nested.el);
          if (phase === 'create') throw new Error(`child:${phase}`);
          return root;
        },
        setup() {
          childSetup(RT, grandchild);
          RT.__effect(() => { source.value; log.push('child-effect'); });
          if (phase === 'setup') throw new Error(`child:${phase}`);
        },
        hooks: {
          beforeUnmount() { log.push('child-beforeUnmount'); },
          unmounted() { log.push('child-unmounted'); },
        },
      });
      const Parent = defineComponent(RT, {
        name: 'BoundaryParent',
        create() {
          const root = document.createElement('div');
          const nested = childCreate(RT, this, Broken, {});
          child = nested.inst;
          root.appendChild(nested.el);
          return root;
        },
        setup() { childSetup(RT, child); },
        hooks: { onError(error) { log.push(`caught:${error.message}`); } },
      });
      const target = document.createElement('main');
      const parent = new Parent({});
      parent.mount(target);
      expect(parent._state).toBe('mounted');
      expect(serialize(target)).toBe(
        `<main><div><!--rip:child-error: Broken_${phase}--></div></main>`,
      );
      if (child) {
        expect(child._state).toBe('failed');
        expect(child._root).toBeNull();
        expect(child._children ?? null).toBeNull();
      }
      if (grandchild) expect(grandchild._state).toBe(phase === 'setup' ? 'unmounted' : 'failed');
      const runs = log.filter((x) => x.endsWith('effect')).length;
      source.value = 1;
      expect(log.filter((x) => x.endsWith('effect'))).toHaveLength(runs);
      expect(log).not.toContain('child-beforeUnmount');
      expect(log).not.toContain('child-unmounted');
      expect(log).not.toContain('grand-beforeUnmount');
      expect(log).not.toContain('grand-unmounted');
      expect(log).toContain(`caught:child:${phase}`);
    }
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

  test('mount failure dispatches after stack restoration so boundary-created children and effects stay parent-owned and live', () => {
    const source = RT.__state(0);
    const log = [];
    let failed = null;
    let rescue = null;
    const Rescue = defineComponent(RT, {
      name: 'Rescue',
      create() { return document.createElement('strong'); },
      setup(api) { api.__effect(() => { source.value; log.push('rescue-effect'); }); },
    });
    const Broken = defineComponent(RT, {
      name: 'Broken',
      create() { return document.createElement('i'); },
      setup(api) {
        api.__effect(() => { source.value; log.push('failed-effect'); });
        throw new Error('broken setup');
      },
    });
    const Boundary = defineComponent(RT, {
      name: 'Boundary',
      create() {
        const root = document.createElement('div');
        const child = childCreate(RT, this, Broken, {});
        failed = child.inst;
        root.appendChild(child.el);
        return root;
      },
      setup() { childSetup(RT, failed); },
      hooks: {
        onError(error, component) {
          log.push(`caught:${error.message}`);
          RT.__effect(() => { source.value; log.push('boundary-effect'); });
          rescue = new Rescue({});
          expect(rescue._parent).toBe(this);
          expect(rescue._mountCreate()).toBe(true);
          this._root.appendChild(rescue._root);
          (this._children || (this._children = [])).push(rescue);
          rescue._mountSetup();
          expect(component).toBe(failed);
        },
      },
    });
    const target = document.createElement('main');
    const boundary = new Boundary({});
    boundary.mount(target);
    expect(failed._state).toBe('failed');
    expect(failed._frame.disposed).toBe(true);
    expect(rescue._state).toBe('mounted');
    expect(serialize(target)).toBe('<main><div><!--rip:child-error: Broken--><strong></strong></div></main>');
    source.value = 1;
    expect(log).toEqual([
      'failed-effect', 'caught:broken setup', 'boundary-effect', 'rescue-effect',
      'boundary-effect', 'rescue-effect',
    ]);
    boundary.unmount();
    source.value = 2;
    expect(log).toHaveLength(6);
  });

  test('a delayed child failure invokes its parent-chain boundary under the boundary owner stacks', () => {
    const source = RT.__state(0);
    const log = [];
    let rescue = null;
    const Rescue = defineComponent(RT, {
      name: 'DelayedRescue',
      create() { return document.createElement('strong'); },
    });
    const Boundary = defineComponent(RT, {
      name: 'DelayedBoundary',
      create() { return document.createElement('div'); },
      hooks: {
        onError(error) {
          log.push(`caught:${error.message}`);
          RT.__effect(() => { source.value; log.push('boundary-effect'); });
          rescue = new Rescue({});
        },
      },
    });
    const Broken = defineComponent(RT, {
      name: 'DelayedBroken',
      create() { return document.createElement('i'); },
      setup() { throw new Error('delayed boom'); },
    });
    const boundary = new Boundary({});
    boundary.mount(document.createElement('main'));
    const prev = RT.__pushComponent(boundary);
    const child = new Broken({});
    RT.__popComponent(prev);

    expect(() => child.mount(document.createElement('aside'))).not.toThrow();
    expect(child._state).toBe('failed');
    expect(rescue._parent).toBe(boundary);
    expect(boundary._frame.size).toBeGreaterThan(0);
    source.value = 1;
    expect(log).toEqual([
      'caught:delayed boom', 'boundary-effect', 'boundary-effect',
    ]);
    boundary.unmount();
    source.value = 2;
    expect(log).toHaveLength(3);
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
          this.theme = a.getContext(Root, 'theme');       // the signal container
          out.push(a.getContext(Root, 'version'));        // a plain value comes back as it was set
          out.push(a.hasContext(Root, 'theme'), a.hasContext(Root, 'nope'));
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

  test('a read answers the provider it names, past a nearer one that set the same key', () => {
    expect(both((api) => {
      const out = [];
      const Leaf = defineComponent(api, {
        name: 'Leaf', props: [],
        init(props, a) { out.push(a.getContext(Mid, 'depth'), a.getContext(Root, 'depth')); },
        create() { return document.createComment('leaf'); },
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
    })).toEqual(['mid', 'root']);
  });
});

// ════════════════════════════════════════════════════════════════════
// Teardown ordering: descendants before ancestors
// ════════════════════════════════════════════════════════════════════

describe('teardown ordering: descendants tear down before ancestors release', () => {
  // The contract: _teardown unmounts _children BEFORE disposing the
  // component's own frame, recursively, so an unmount cascade runs
  // cleanups deepest-first — a consumer's cleanup executes while every
  // ancestor's offered container is still live and un-released.
  // Context values captured at init are the teardown-safe channel
  // (context is never re-resolved during teardown).
  test('a consumer cleanup still uses its captured provider container; cleanups run deepest-first', () => {
    expect(both((api) => {
      const log = [];
      const Leaf = defineComponent(api, {
        name: 'Leaf', props: [],
        init(props, a) {
          const pool = a.getContext(Root, 'pool');
          a.__effect(() => () => log.push(`leaf-cleanup pool=${pool.read()}`));
        },
        create() { return document.createComment('leaf'); },
      });
      const Mid = defineComponent(api, {
        name: 'Mid', props: [],
        init(props, a) {
          a.__effect(() => () => log.push('mid-cleanup'));
        },
        create() {
          const el = document.createElement('div');
          const kid = childCreate(api, this, Leaf, {});
          this._kid = kid.inst;
          el.appendChild(kid.el);
          return el;
        },
        setup(a) { childSetup(a, this._kid); },
      });
      const Root = defineComponent(api, {
        name: 'Root', props: [],
        init(props, a) {
          this.pool = a.__state('open');
          a.setContext('pool', this.pool);
          a.__effect(() => () => { log.push('root-cleanup'); this.pool.value = 'closed'; });
        },
        create() {
          const el = document.createElement('main');
          const kid = childCreate(api, this, Mid, {});
          this._kid = kid.inst;
          el.appendChild(kid.el);
          return el;
        },
        setup(a) { childSetup(a, this._kid); },
      });
      const root = new Root({});
      root.mount(document.createElement('body'));
      root.unmount();
      return log;
    })).toEqual(['leaf-cleanup pool=open', 'mid-cleanup', 'root-cleanup']);
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

  test("a multi-root component's emit dispatches on its first live node — bubbling reaches ancestors", () => {
    expect(both((api) => {
      const log = [];
      const C = defineComponent(api, {
        name: 'Multi', props: [],
        create() {
          const root = document.createDocumentFragment();
          const firstNode = document.createElement('i');
          const secondNode = document.createElement('b');
          root.appendChild(firstNode);
          root.appendChild(secondNode);
          this._nodes = [firstNode, secondNode];
          return root;
        },
      });
      const target = document.createElement('main');
      // Dispatched on the fragment, the event bubbles nowhere: the
      // fragment was emptied at insertion and sits outside the tree.
      target.addEventListener('save', (e) => log.push(['target', e.detail]));
      const inst = new C({});
      inst.mount(target);
      inst.emit('save', { x: 1 });
      return log;
    })).toEqual([[ 'target', { x: 1 } ]]);
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
      el.dispatchEvent({ type: 'transitionend', target: el, bubbles: false });
      stages.push(cls(), done);
      return stages;
    })).toEqual([
 'fade-enter-active,fade-enter-from',
 'fade-enter-active,fade-enter-to',
 '', true,
    ]);
  });

  test('__transition completes on transitioncancel — an interrupted leave cannot strand the node', async () => {
    const el = document.createElement('div');
    let done = 0;
    RT.__transition(el, 'fade', 'leave', () => { done++; });
    await tick();
    await tick();
    // A mid-flight interruption fires transitioncancel, never
    // transitionend — the completion must ride both.
    el.dispatchEvent({ type: 'transitioncancel', target: el, bubbles: false });
    expect(done).toBe(1);
    expect(el.classList.contains('fade-leave-active')).toBe(false);
    expect(el.classList.contains('fade-leave-to')).toBe(false);
  });

  test('__transition with no matching CSS completes on the duration fallback', async () => {
    const el = document.createElement('div');
    let done = 0;
    RT.__transition(el, 'no-such-name', 'enter', () => { done++; });
    await tick();
    await tick();
    // No CSS names this transition, so no event ever fires; the
    // computed duration reads zero and the grace timer completes it.
    await new Promise((r) => setTimeout(r, 80));
    expect(done).toBe(1);
    expect(el.classList.contains('no-such-name-enter-active')).toBe(false);
  });

  test('__transition accepts only the element own event and completes exactly once', async () => {
    const el = document.createElement('div');
    const child = document.createElement('span');
    el.appendChild(child);
    let done = 0;
    RT.__transition(el, 'fade', 'enter', () => { done++; });
    await tick();
    await tick();

    child.dispatchEvent({ type: 'transitionend', target: child, bubbles: true });
    el.dispatchEvent({ type: 'transitionend', bubbles: false });
    await tick();
    expect(done).toBe(0);
    expect(el.classList.contains('fade-enter-active')).toBe(true);
    expect(el.classList.contains('fade-enter-to')).toBe(true);

    el.dispatchEvent({ type: 'transitionend', target: el, bubbles: false });
    el.dispatchEvent({ type: 'transitionend', target: el, bubbles: false });
    expect(done).toBe(1);
    expect(el.classList.contains('fade-enter-active')).toBe(false);
    expect(el.classList.contains('fade-enter-to')).toBe(false);

    const absent = document.createElement('div');
    let absentDone = false;
    RT.__transition(absent, 'slide', 'leave', () => { absentDone = true; });
    await tick();
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(absentDone).toBe(false);
    absent.dispatchEvent({ type: 'transitionend', target: absent, bubbles: false });
    expect(absentDone).toBe(true);
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
    expect(kid._state).toBe('failed');
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

  test('a declared prop named after an ambient (stash/router) is supported shadowing, launch globals or not', () => {
    // The check runs before injection: with the launch globals live,
    // a `stash` prop must construct exactly as it does without them —
    // checked after, the first-constructed instance's ambients decided
    // the verdict and the per-class cache locked it in.
    const StashProp = defineComponent(RT, { name: 'StashProp', props: ['stash'] });
    const hadStash = Object.prototype.hasOwnProperty.call(globalThis, '__ripStash');
    const prevStash = globalThis.__ripStash;
    globalThis.__ripStash = { fake: true };
    try {
      expect(() => new StashProp({})).not.toThrow();
      const inst = new StashProp({});
      expect(inst.stash).toEqual({ fake: true }); // ambient still lands when the prop is unwired
    } finally {
      if (hadStash) globalThis.__ripStash = prevStash;
      else delete globalThis.__ripStash;
    }
    expect(() => new StashProp({})).not.toThrow();
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

  test('getContext with no such provider above rejects naming the provider, the key, and the probe', () => {
    const Theme = defineComponent(RT, { name: 'Theme', props: [] });
    const Kid = defineComponent(RT, {
      name: 'Kid', props: [],
      init(props, a) { this.theme = a.getContext(Theme, 'theme'); },
    });
    expect(() => new Kid({})).toThrow(
 'getContext: no Theme above this component — render one around it, or probe with hasContext(Theme, "theme") where absence is legal',
    );
  });

  test('a read that names no provider is refused, pointing at the spelling', () => {
    const Kid = defineComponent(RT, {
      name: 'Kid', props: [],
      init(props, a) { this.theme = a.getContext('theme'); },
    });
    expect(() => new Kid({})).toThrow('getContext: a context read names its provider — getContext(Provider, "theme")');
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
    expect(inst.rest.read()).toEqual(inst._rest);
    expect(inst.label).toBe(shared);
  });

  test('the rest view reads a shared container through: the read answers the value and tracks it; the map keeps the container', () => {
    const busy = RT.__state(false);
    const inst = makeBtn({ disabled: busy, title: 'tip' });
    expect(inst._rest.disabled).toBe(busy);
    expect(inst.rest.read().disabled).toBe(false);
    expect(inst.rest.read().title).toBe('tip');
    expect(Object.keys(inst.rest.read())).toEqual(['disabled', 'title']);
    const seen = [];
    const stop = RT.__effect(() => { seen.push(inst.rest.value.disabled); });
    busy.value = true;
    inst._updateProp('disabled', 'later');
    expect(seen).toEqual([false, true, 'later']);
    stop();
  });

  test("the runtime's boolean-attribute list is the compiler's, name for name", async () => {
    const { BOOLEAN_ATTRS } = await import('../../src/dom.js');
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../../src/runtime/components.js', import.meta.url), 'utf8');
    const literal = text.match(/const __BOOLEAN_ATTRS = new Set\(\[([^\]]*)\]\)/)[1];
    expect(literal.match(/'[^']+'/g).map((w) => w.slice(1, -1)).sort()).toEqual([...BOOLEAN_ATTRS].sort());
  });

  test("a forwarded key lands as the render line would write it: presence for a boolean attribute, the word for any other, absence for nullish", () => {
    const inst = makeBtn({});
    const el = document.createElement('button');
    inst._inheritedEl = el;
    // A boolean attribute is presence, whatever truthy value carries it.
    inst._applyInheritedProp(el, 'hidden', 'yes');
    expect(el.getAttribute('hidden')).toBe('');
    inst._applyInheritedProp(el, 'hidden', undefined);
    expect(el.getAttribute('hidden')).toBeNull();
    inst._applyInheritedProp(el, 'disabled', false);
    expect(el.getAttribute('disabled')).toBeNull();
    // Any other attribute takes the value's word: `false` is "false", never absence.
    for (const key of ['aria-pressed', 'data-on', 'draggable']) {
      inst._applyInheritedProp(el, key, false);
      expect(el.getAttribute(key)).toBe('false');
      inst._applyInheritedProp(el, key, true);
      expect(el.getAttribute(key)).toBe('true');
      inst._applyInheritedProp(el, key, null);
      expect(el.getAttribute(key)).toBeNull();
    }
    inst._applyInheritedProp(el, 'tabindex', 0);
    expect(el.getAttribute('tabindex')).toBe('0');
    inst._applyInheritedProp(el, 'title', 'tip');
    inst._applyInheritedProp(el, 'title', undefined);
    expect(el.getAttribute('title')).toBeNull();
    // `value` and `checked` are the two property roads.
    inst._applyInheritedProp(el, 'value', undefined);
    expect(el.value).toBe('');
    inst._applyInheritedProp(el, 'checked', 1);
    expect(el.checked).toBe(true);
    expect(el.getAttribute('checked')).toBeNull();
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

  test('a bound host INSTANCE takes rest writes through its own prop updater: declared props write the member, undeclared keys reach its rest, the line\'s own keys stop, containers unwrap through an owned effect, teardown releases', () => {
    const Host = defineComponent(RT, {
      name: 'Host', props: ['title'],
      init(p, a) { this.title = a.__state(p.__bind_title__ ?? p.title ?? ''); },
      create() { return document.createElement('div'); },
    });
    Host.__extends = 'div';
    const host = new Host({});
    host._inheritedEl = host._create();
    host._state = 'mounted';
    const Wrap = defineComponent(RT, { name: 'Wrap', props: ['side'], init(p, a) { this.side = a.__state(p.side ?? 'l'); } });
    Wrap.__extends = 'Host';
    const wrap = new Wrap({ title: 't0', 'data-x': 'x0', 'data-own': 'ignored' });
    wrap._inheritedInst = host;
    wrap._inheritedOwn = new Set(['data-own']);
    wrap._state = 'mounted';
    // A declared prop of the host writes its member; an undeclared one
    // reaches the host's rest and its element.
    wrap._updateProp('title', 't1');
    expect(host.title.read()).toBe('t1');
    wrap._updateProp('data-x', 'x1');
    expect(host._rest['data-x']).toBe('x1');
    expect(host._inheritedEl.getAttribute('data-x')).toBe('x1');
    // null deletes down the chain.
    wrap._updateProp('data-x', null);
    expect('data-x' in host._rest).toBe(false);
    expect(host._inheritedEl.getAttribute('data-x')).toBeNull();
    // A key the render's own line passes is the line's: the update stops.
    wrap._updateProp('data-own', 'later');
    expect('data-own' in host._rest).toBe(false);
    // A container unwraps through an effect the wrapper owns.
    const cell = RT.__state('c0');
    wrap._updateProp('title', cell);
    expect(host.title.read()).toBe('c0');
    cell.value = 'c1';
    expect(host.title.read()).toBe('c1');
    expect(Object.keys(wrap._restWriters)).toEqual(['title']);
    wrap._teardown({ state: 'unmounted', hooks: false, removeDOM: false });
    expect(wrap._inheritedInst).toBeNull();
    expect(wrap._inheritedOwn).toBeNull();
    expect(wrap._restWriters).toBeNull();
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
    // Replacing a style object CLEARS the keys the new one omits —
    // the old declarations must not stay active.
    inst._applyInheritedProp(el, 'style', { color: 'blue', fontWeight: 'bold' });
    inst._applyInheritedProp(el, 'style', { color: 'green' });
    expect(el.style.color).toBe('green');
    expect(el.style.fontWeight).toBe('');
    // A string or null write drops the replacement record: keys
    // set outside an object write are never wiped by a later one.
    inst._applyInheritedProp(el, 'style', 'color: red');
    el.style.margin = '1px';
    inst._applyInheritedProp(el, 'style', { color: 'blue' });
    expect(el.style.margin).toBe('1px');
    inst._applyInheritedProp(el, 'style', null);
    expect(el.getAttribute('style')).toBeNull();
    // A `--custom` property goes through setProperty where the style
    // object has one (a browser's CSSStyleDeclaration takes it no other
    // way), and its omission on the next write removes it; a plain bag
    // takes the key by assignment.
    const written = [];
    el.style = { setProperty: (k, v) => written.push(['set', k, v]), removeProperty: (k) => written.push(['remove', k]) };
    inst._applyInheritedProp(el, 'style', { '--brand': '#06a', color: 'red' });
    inst._applyInheritedProp(el, 'style', { color: 'blue' });
    expect(written).toEqual([['set', '--brand', '#06a'], ['remove', '--brand']]);
    expect(el.style.color).toBe('blue');
    el.style = {};
    inst._applyInheritedProp(el, 'style', { '--brand': '#06a' });
    expect(el.style['--brand']).toBe('#06a');
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
const COMPONENTS_IMPORT = /^import \{ setContext, getContext, hasContext, __Component, __pushComponent, __popComponent, __clsx, __style, __lis, __reconcile, __transition, __handleComponentError, __gateBind, __detach, __reportChildFailure, __ownerFrame, __pushOwner, __popOwner, __detachRef \} from ".*src\/runtime\/components\.js";$/;
const ALL_COMPONENT_NAMES = ['setContext', 'getContext', 'hasContext', '__Component', '__pushComponent',
 '__popComponent', '__clsx', '__style', '__lis', '__reconcile', '__transition', '__handleComponentError', '__gateBind', '__detach',
 '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'];

// A program that exercises the runtime for real without the language
// surface: a hand-built component scope around the context API.
const RUN_SRC = [
 'class Holder',
 'c = Holder.new()',
 'prev = __pushComponent(c)',
 'setContext("theme", "dark")',
 'console.log(getContext(Holder, "theme"))',
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
 'setContext, getContext, hasContext, __Component, __pushComponent, __popComponent, __clsx, __style, __lis, __reconcile, __transition, __handleComponentError, __gateBind, __detach, __reportChildFailure, __ownerFrame, __pushOwner, __popOwner, __detachRef } = (() => {',
    )).toBe(true);
    expect(code).toContain('__RIP_REACTIVE_SENTINEL');
    expect(code).toContain('__RIP_COMPONENTS_SENTINEL');
    // The module seams strip: no import of the sibling runtime, no export line.
    expect(code).not.toContain("from './reactive.js'");
    expect(code).not.toMatch(/^export/m);
    const rows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(rows).toHaveLength(1);
    // Value pin via none+binding against the shared modules.
    const valueSrc = [
      'class Holder',
      'c = Holder.new()',
      'prev = __pushComponent(c)',
      'setContext("theme", "dark")',
      'theme = getContext(Holder, "theme")',
      'cls = __clsx("a", {b: true}, ["c"])',
      '__popComponent(prev)',
    ].join('\n');
    const { code: none } = compile(valueSrc, { runtimeDelivery: 'none' });
    const names = ['__pushComponent', 'setContext', 'getContext', '__clsx', '__popComponent'];
    const out = new Function(...names, `${none}\nreturn [theme, cls];`)(
      ...names.map((n) => RT[n]),
    );
    expect(out).toEqual(['dark', 'a b c']);
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
    expect(compLine).toMatch(/^import \{ setContext as setContext_, getContext, hasContext, __Component/);
    expect(a.code).toContain('setContext("a", 1);');
    const allBound = ALL_COMPONENT_NAMES.map((n) => `${n} = 1`).join('\n') + '\nx = setContext';
    const b = compile(allBound, { runtimeDelivery: 'import' });
    expect(b.code).not.toContain('runtime/components.js');
    expect([...b.runtimes]).toEqual([]);
  });

  test('function-scope shadowing does NOT suppress module-level injection', () => {
    const { code } = compile('f = ->\n  setContext = 1\n  setContext\nx = getContext("k")', { runtimeDelivery: 'import' });
    expect(code.split('\n')[1]).toMatch(/^import \{ setContext as setContext_, getContext, hasContext, __Component/);
    expect(code).toContain('let x = getContext("k");');
  });

  test('component base, state, computed, and effect lowerings ignore same-named source bindings', () => {
    const source = [
      '__Component = null',
      '__state = -> "bad-state"',
      '__computed = -> "bad-computed"',
      '__effect = -> "bad-effect"',
      'App = component',
      '  count := 1',
      '  doubled ~= count * 2',
      '  log = []',
      '  ~> log.push("effect:" + doubled)',
      'app = App.new()',
    ].join('\n');
    const { code } = compile(source, { runtimeDelivery: 'none' });
    const env = {};
    for (const [name, value] of Object.entries(RT)) {
      const esc = name.replace(/\$/g, '\\$');
      for (const m of code.matchAll(new RegExp(`\\b${esc}_\\d*\\b`, 'g'))) env[m[0]] = value;
      const declared = new RegExp(`\\b(?:let|const|var|function|class)\\s+${esc}\\b`).test(code);
      if (!declared && new RegExp(`\\b${esc}\\b`).test(code)) env[name] = value;
    }
    const keys = Object.keys(env);
    const { app } = new Function(...keys, `${code}\nreturn { app };`)(...keys.map((k) => env[k]));
    expect(app.log).toEqual(['effect:2']);
    expect([app.count.read(), app.doubled.read()]).toEqual([1, 2]);
  });

  test('generated offer/accept and child-stack calls use aliases while source calls stay source-owned', () => {
    const source = [
      'setContext = null',
      'getContext = null',
      '__Component = null',
      '__pushComponent = null',
      '__popComponent = null',
      'Child = component',
      '  accept theme from Parent',
      '  render',
      '    span',
      '      = theme',
      'Parent = component',
      '  offer theme := "dark"',
      '  render',
      '    Child',
      'app = Parent.new()',
    ].join('\n');
    const { code } = compile(source, { runtimeDelivery: 'none' });
    const env = {};
    for (const [name, value] of Object.entries(RT)) {
      const esc = name.replace(/\$/g, '\\$');
      for (const m of code.matchAll(new RegExp(`\\b${esc}_\\d*\\b`, 'g'))) env[m[0]] = value;
      const declared = new RegExp(`\\b(?:let|const|var|function|class)\\s+${esc}\\b`).test(code);
      if (!declared && new RegExp(`\\b${esc}\\b`).test(code)) env[name] = value;
    }
    const keys = Object.keys(env);
    const { app } = new Function(...keys, `${code}\nreturn { app };`)(...keys.map((k) => env[k]));
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    app.mount(document.body);
    try {
      expect(serialize(document.body)).toContain('>dark</span>');
    } finally {
      app.unmount();
    }
  });

  test('render effects, events, reconciliation, transitions, refs, ownership, and teardown use aliases', () => {
    const generated = [
      '__effect', '__batch', '__clsx', '__reconcile', '__transition', '__detach',
      '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef',
    ];
    const source = [
      ...generated.map((name) => `${name} = null`),
      'App = component',
      '  items := ["a"]',
      '  shown := true',
      '  el := null',
      '  render',
      '    .("root", shown && "on")',
      '      button @click: -> items = ["b", "c"]',
      '        "change"',
      '      if shown',
      '        span ~fade ref: el',
      '          "shown"',
      '      for item in items',
      '        em item',
      'app = App.new()',
    ].join('\n');
    const { code } = compile(source, { runtimeDelivery: 'none' });
    const env = {};
    for (const [name, value] of Object.entries(RT)) {
      const esc = name.replace(/\$/g, '\\$');
      for (const m of code.matchAll(new RegExp(`\\b${esc}_\\d*\\b`, 'g'))) env[m[0]] = value;
      const declared = new RegExp(`\\b(?:let|const|var|function|class)\\s+${esc}\\b`).test(code);
      if (!declared && new RegExp(`\\b${esc}\\b`).test(code)) env[name] = value;
    }
    const keys = Object.keys(env);
    const { app } = new Function(...keys, `${code}\nreturn { app };`)(...keys.map((k) => env[k]));
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    app.mount(document.body);
    try {
      const before = serialize(document.body);
      document.querySelector('button').dispatchEvent({ type: 'click', bubbles: false });
      const after = serialize(document.body);
      app.unmount();
      expect(before).toContain('<em>a</em>');
      expect(after).toContain('<em>b</em><em>c</em>');
      expect(serialize(document.body)).toBe('<body></body>');
    } finally {
      try { app.unmount(); } catch { /* already unmounted */ }
    }
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

  test('import and inline modes are observably equivalent (the same program, the same output)', () => {
    // Byte-shape parity of the two deliveries is covered above; the
    // observable value is pinned once via none+binding.
    const valueSrc = [
      'class Holder',
      'c = Holder.new()',
      'prev = __pushComponent(c)',
      'setContext("theme", "dark")',
      'theme = getContext(Holder, "theme")',
      'cls = __clsx("a", {b: true}, ["c"])',
      '__popComponent(prev)',
    ].join('\n');
    const { code: none } = compile(valueSrc, { runtimeDelivery: 'none' });
    const names = ['__pushComponent', 'setContext', 'getContext', '__clsx', '__popComponent'];
    const out = new Function(...names, `${none}\nreturn [theme, cls];`)(
      ...names.map((n) => RT[n]),
    );
    expect(out).toEqual(['dark', 'a b c']);
    const imp = compile(RUN_SRC, { runtimeDelivery: 'import' });
    const inl = compile(RUN_SRC, { runtimeDelivery: 'inline' });
    expect(imp.code).toMatch(/^import /);
    expect(inl.code).toMatch(/^const \{/);
  });

  test('all FOUR runtimes in one module: table order, distinct units, every key reported', () => {
    const src = 'S = schema\n  a! integer\nn = __state(S.parse({a: 4}).a)\nsetContext2 = getContext\nx = __schemaSetAdapter';
    const { code, runtimes } = compile(src, { runtimeDelivery: 'import' });
    // `duckdb` rides along as orm's dependency but binds no user-facing
    // name, so it is reported yet emits no import line of its own —
    // under import delivery orm.js resolves it through the module graph.
    expect([...runtimes].sort()).toEqual(['components', 'duckdb', 'orm', 'reactive', 'schema', 'vocab']);
    const lines = code.split('\n').slice(0, 4);
    expect(lines[0]).toContain('runtime/schema.js');
    expect(lines[1]).toContain('runtime/orm.js');
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
    expect([...s.runtimes]).toEqual(['schema', 'vocab']);
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

  test('tight `<~` is the gate token while spaced `< ~` remains comparison', () => {
    expect(() => compile('x <~ @stash.x')).toThrow(/render gate.*direct component body line/);
    expect(compile('x < ~load()').code).toBe('x < (~load());');
  });
});

// `asChild` on an extends component: the projected element renders as
// the host. Compiled parts drive it, since the mode is the host line's
// fork; hmr builds, since the rebind is the patch machinery.
describe('asChild: the projected element is the host', () => {
  const load = (src, names) => {
    const { code } = fullCompile(src, { path: 'aschild.rip', runtimeDelivery: 'none', hmr: true });
    const body = code.replace(/^export /gm, '');
    const keys = Object.keys(RT);
    return new Function(...keys, `${body}\nreturn { ${names} };`)(...keys.map((n) => RT[n]));
  };
  const PART = `export Part = component extends button
  open := false
  el: HTMLElement | null := null
  render
    button
      ref: el
      type: 'button'
      aria-expanded: if open then 'true' else 'false'
      @click: (-> open = true)
      slot
`;
  const BUTTON = (cls) => `export Button = component extends button
  @variant := 'primary'
  render
    button class: '${cls}', data-variant: variant
      slot
`;
  const APP = (cls) => `${PART}
${BUTTON(cls)}
export App = component
  clicks := 0
  render
    div
      Part asChild, id: 'x', title: 't', @click: (-> clicks += 1)
        Button variant: 'ghost', 'Go'
`;
  const mountApp = (cls = 'a') => {
    const mod = load(APP(cls), 'App, Part, Button');
    const target = document.createElement('main');
    const app = new mod.App({});
    app.mount(target);
    const [button, part] = app._children;
    return { mod, target, app, button, part };
  };

  test('the host is the child component\'s root: the line\'s keys, its listener, the ref, the stamp, and rest all land there; the caller\'s listener adds; the bare word is the mode', () => {
    const { target, app, button, part } = mountApp();
    const host = part._inheritedEl;
    expect(host).toBe(button._root);
    expect(part._root).toBe(host);
    expect(part.el.value).toBe(host);
    expect(serialize(target)).toBe('<main><div data-part="App"><button class="a" data-part="Part" id="x" title="t" type="button" data-variant="ghost" aria-expanded="false">Go</button></div></main>');
    expect(host.childNodes.map((n) => n.nodeType)).toEqual([3]);
    host.dispatchEvent({ type: 'click', bubbles: false });
    expect(host.getAttribute('aria-expanded')).toBe('true');
    expect(app.clicks.value).toBe(1);
    expect(host.getAttribute('asChild')).toBeNull();
    expect(part._rest.asChild).toBe(true);
    expect(part._asChild).toBe(true);
  });

  test('the line\'s keys stay the line\'s under the mode: a rest value for one is refused at mount and on update', () => {
    const { Part } = load(PART, 'Part');
    const span = document.createElement('span');
    const part = new Part({ asChild: true, children: span, type: 'submit' });
    part.mount(document.createElement('main'));
    expect(span.getAttribute('type')).toBe('button');
    part._updateProp('type', 'reset');
    expect(span.getAttribute('type')).toBe('button');
    part._updateProp('title', 'later');
    expect(span.getAttribute('title')).toBe('later');
  });

  test('without the mode the same part builds its own tag and projects the child into it: byte-identical DOM to the rule before the mode', () => {
    const { App, Part } = load(`${PART}
${BUTTON('a')}
export App = component
  render
    div
      Part id: 'x'
        Button 'Go'
`, 'App, Part');
    const target = document.createElement('main');
    new App({}).mount(target);
    expect(serialize(target)).toBe('<main><div data-part="App"><button id="x" data-part="Part" type="button" aria-expanded="false"><button class="a" data-part="Button" data-variant="primary">Go</button></button></div></main>');
    expect(new Part({}).rest.value.asChild).toBeUndefined();
  });

  test('one element or a throw naming the part: a fragment, text, a comment, and no body are refused at mount', () => {
    const { Part } = load(PART, 'Part');
    const mount = (children) => () => new Part({ asChild: true, children }).mount(document.createElement('main'));
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createElement('i'));
    frag.appendChild(document.createElement('b'));
    expect(mount(frag)).toThrow('Part: asChild renders the projected element as the host, so the body must be exactly one element — got a fragment of 2 nodes');
    expect(mount(document.createTextNode('x'))).toThrow('got text');
    expect(mount(document.createComment('rip:child-error: Button'))).toThrow('got a comment');
    expect(mount(undefined)).toThrow('got nothing');
    // The failed mount rolled back: the instance is terminal.
    const failed = new Part({ asChild: true });
    expect(() => failed.mount(document.createElement('main'))).toThrow('got nothing');
    expect(failed._state).toBe('failed');
  });

  test('asChild is fixed at construction: a container or a non-boolean is refused there, an update is refused, and a declared prop of the name rejects at compile', () => {
    const { Part } = load(PART, 'Part');
    expect(() => new Part({ asChild: RT.__state(true) })).toThrow('Part: asChild takes true or nothing, fixed at construction — got a reactive value');
    expect(() => new Part({ asChild: 'yes' })).toThrow('got string yes');
    const part = new Part({ asChild: true, children: document.createElement('span') });
    part.mount(document.createElement('main'));
    expect(() => part._updateProp('asChild', false)).toThrow('Part: asChild is fixed at construction and takes no update');
    expect(() => fullCompile('P = component extends button\n  @asChild?: boolean\n  render\n    button\n      slot\n', { path: 'p.rip', runtimeDelivery: 'none' }))
      .toThrow("cannot declare a prop named 'asChild'");
  });

  test('a rebuilt child rebinds: the part\'s writers leave the old element and land on the new one, the ref follows, and the cascade reaches a part adopted above', () => {
    const { target, app, button, part } = mountApp('a');
    const host = part._inheritedEl;
    host.dispatchEvent({ type: 'click', bubbles: false });
    expect(host.getAttribute('aria-expanded')).toBe('true');
    const next = load(APP('b'), 'App, Part, Button');
    expect(RT.__hmrClassify(button.constructor, next.Button)).toBe('patch');
    RT.__hmrPatch(button, next.Button);
    const host2 = button._root;
    expect(host2).not.toBe(host);
    expect(part._inheritedEl).toBe(host2);
    expect(part._root).toBe(host2);
    expect(part.el.value).toBe(host2);
    expect(serialize(target)).toBe('<main><div data-part="App"><button class="b" data-part="Part" data-variant="ghost" id="x" title="t" type="button" aria-expanded="true">Go</button></div></main>');
    // The setup effect writes the new element only; the old one is inert.
    part.open.value = false;
    expect(host2.getAttribute('aria-expanded')).toBe('false');
    expect(host.getAttribute('aria-expanded')).toBe('true');
    // The line's listener moved with the view.
    host2.dispatchEvent({ type: 'click', bubbles: false });
    expect(host2.getAttribute('aria-expanded')).toBe('true');
    // One rest writer per key, none leaked on the old element: a later
    // rest update reaches the new host alone.
    part._updateProp('title', 'moved');
    expect(host2.getAttribute('title')).toBe('moved');
    expect(host.getAttribute('title')).toBe('t');
    expect(part._state).toBe('mounted');
    // Two parts on one element: the outer part adopted the inner's root,
    // and a rebuild of the child reaches both.
    const nested = load(`${PART}
${BUTTON('a')}
export Outer = component extends button
  render
    button data-outer: 'y'
      slot
export App = component
  render
    div
      Outer asChild: true
        Part asChild: true
          Button 'Go'
`, 'App, Part, Button, Outer');
    const target2 = document.createElement('main');
    const app2 = new nested.App({});
    app2.mount(target2);
    const [button2, part2, outer] = app2._children;
    expect(outer._inheritedEl).toBe(button2._root);
    expect(part2._inheritedEl).toBe(button2._root);
    RT.__hmrPatch(button2, next.Button);
    expect(part2._inheritedEl).toBe(button2._root);
    expect(outer._inheritedEl).toBe(button2._root);
    expect(serialize(target2)).toBe('<main><div data-part="App"><button class="b" data-part="Outer" data-variant="primary" type="button" aria-expanded="false" data-outer="y">Go</button></div></main>');
  });

  test('a patch of the adopting part itself keeps the host in place and adopts it again', () => {
    const { mod, target, button, part } = mountApp('a');
    const host = part._inheritedEl;
    const next = load(APP('a').replace("type: 'button'", "type: 'button'\n      data-v: '2'"), 'App, Part, Button');
    expect(RT.__hmrClassify(mod.Part, next.Part)).toBe('patch');
    RT.__hmrPatch(part, next.Part);
    expect(part._inheritedEl).toBe(host);
    expect(button._root).toBe(host);
    expect(host.parentNode).toBe(target.childNodes[0]);
    expect(host.getAttribute('data-v')).toBe('2');
    expect(target.childNodes[0].childNodes.length).toBe(1);
  });
});

// On the host line of a tag-extending component, `class` and `style`
// merge with the caller's: the emitted class effect ends with the rest
// view's `class` read, and the style effect merges by key through
// `_mergeRestStyle`, which refuses a key both sides set. Reading the
// key back through `@rest` hands it to the author.
describe('extends: the host line merges class and style with the caller\'s', () => {
  const load = (src, names) => {
    const { code } = fullCompile(src, { path: 'merge.rip', runtimeDelivery: 'none' });
    const body = code.replace(/^export /gm, '');
    const keys = Object.keys(RT);
    return new Function(...keys, `${body}\nreturn { ${names} };`)(...keys.map((n) => RT[n]));
  };
  const mount = (Cls, props) => {
    const inst = new Cls(props);
    const target = document.createElement('main');
    inst.mount(target);
    return { inst, el: inst._inheritedEl, target };
  };
  const BTN = `export Btn = component extends button
  @tone := 'plain'
  render
    button.base type: 'button', class: { loud: tone is 'loud' }, style: { color: 'red' }
      slot
`;

  test("a caller's class lands after the line's, static or reactive, and an update through _updateProp('class') applies", () => {
    const { Btn } = load(BTN, 'Btn');
    const fixed = mount(Btn, { class: 'mt-4' });
    expect(fixed.el.className).toBe('base mt-4');
    expect(fixed.inst._inheritedOwn.has('class')).toBe(true);
    fixed.inst.tone.value = 'loud';
    expect(fixed.el.className).toBe('base loud mt-4');
    fixed.inst._updateProp('class', ['mb-2', { hidden: false, shown: true }]);
    expect(fixed.el.className).toBe('base loud mb-2 shown');
    fixed.inst._updateProp('class', null);
    expect(fixed.el.className).toBe('base loud');
    const live = RT.__state('one');
    const reactive = mount(Btn, { class: live });
    expect(reactive.el.className).toBe('base one');
    live.value = 'two';
    expect(reactive.el.className).toBe('base two');
  });

  test("a style key from each side lands; a shared key against a literal line style throws naming the part and the key, at mount and on update", () => {
    const { Btn } = load(BTN, 'Btn');
    const { inst, el } = mount(Btn, { style: { margin: '1px' } });
    expect(el.style.color).toBe('red');
    expect(el.style.margin).toBe('1px');
    inst._updateProp('style', { padding: '2px' });
    expect(el.style.padding).toBe('2px');
    expect(el.style.margin).toBe('');
    expect(el.style.color).toBe('red');
    inst._updateProp('style', null);
    expect(el.style.padding).toBe('');
    expect(el.style.color).toBe('red');
    expect(() => mount(Btn, { style: { color: 'blue' } }))
      .toThrow("Btn: style key 'color' is set by the host line and by the caller — a shared key is refused, never resolved by precedence");
    expect(() => inst._updateProp('style', { color: 'blue' })).toThrow("Btn: style key 'color' is set by the host line and by the caller");
    expect(() => mount(Btn, { style: 'color: blue' })).toThrow('Btn: style merges by key, and a string style has none');
  });

  test('a shared key against a computed line style throws naming the part and the key; the rest of the object merges', () => {
    const { Anchor } = load(`export Anchor = component extends div
  place := { top: '1px' }
  render
    div style: place
      slot
`, 'Anchor');
    const { inst, el } = mount(Anchor, { style: { left: '2px' } });
    expect(el.style.top).toBe('1px');
    expect(el.style.left).toBe('2px');
    inst.place.value = { top: '3px', right: '0' };
    expect(el.style.top).toBe('3px');
    expect(el.style.right).toBe('0');
    expect(el.style.left).toBe('2px');
    expect(() => mount(Anchor, { style: { top: '9px' } }))
      .toThrow("Anchor: style key 'top' is set by the host line and by the caller — a shared key is refused, never resolved by precedence");
    const failed = new Anchor({ style: { top: '9px' } });
    expect(() => failed.mount(document.createElement('main'))).toThrow("style key 'top'");
    expect(failed._state).toBe('failed');
    // The line's computed value moving onto a caller's key is the same refusal.
    expect(() => { inst.place.value = { left: '4px' }; }).toThrow("Anchor: style key 'left' is set by the host line and by the caller");
  });

  test('a caller\'s class or style on a line that sets neither still rides the rest road', () => {
    const { Plain } = load(`export Plain = component extends span
  render
    span title: 't'
      slot
`, 'Plain');
    const { inst, el } = mount(Plain, { class: 'a', style: { color: 'red' } });
    expect(el.className).toBe('a');
    expect(el.style.color).toBe('red');
    inst._updateProp('class', 'b');
    inst._updateProp('style', { color: 'blue' });
    expect(el.className).toBe('b');
    expect(el.style.color).toBe('blue');
  });

  test("a wrapper's line merges the same keys on the value it passes down, and the host merges that with its own; a shared key is loud on either line", () => {
    const BASE = `export Base = component extends button
  render
    button.base style: { color: 'red' }
      slot
`;
    const { Wrap } = load(`${BASE}
export Wrap = component extends Base
  tone := 'plain'
  render
    Base class: ['wrap', { loud: tone is 'loud' }], style: { margin: '1px' }
      slot
`, 'Wrap');
    // `className` is the same key as `class` in the rest map.
    const { inst, target } = mount(Wrap, { className: 'mine', style: { padding: '2px' } });
    const host = inst._inheritedInst._inheritedEl;
    expect(host.className).toBe('base wrap mine');
    expect([host.style.color, host.style.margin, host.style.padding]).toEqual(['red', '1px', '2px']);
    inst.tone.value = 'loud';
    inst._updateProp('class', 'yours');
    inst._updateProp('style', { top: '1px' });
    expect(host.className).toBe('base wrap loud yours');
    expect([host.style.padding, host.style.top, host.style.margin]).toEqual(['', '1px', '1px']);
    expect(inst.rest.value.className).toBe('yours');
    // A key the wrapper's line sets: the wrapper's merge throws while its
    // construction evaluates, which the child road reports naming the part
    // and the key and leaves the failure comment in the host's place.
    const failures = [];
    const prev = RT.__setChildFailureReporter((name, e) => failures.push([name, e.message]));
    try {
      const t2 = document.createElement('main');
      new Wrap({ style: { margin: '9px' } }).mount(t2);
      expect(serialize(t2)).toBe('<main><!--rip:child-error: Base--></main>');
      expect(failures).toEqual([['Base', "Wrap: style key 'margin' is set by the host line and by the caller — a shared key is refused, never resolved by precedence"]]);
    } finally { RT.__setChildFailureReporter(prev); }
    // A key the host's line sets: the host's own merge throws at its write.
    expect(() => new Wrap({ style: { color: 'blue' } }).mount(document.createElement('main')))
      .toThrow("Base: style key 'color' is set by the host line and by the caller");
    expect(() => inst._updateProp('style', { margin: '3px' })).toThrow("Wrap: style key 'margin' is set by the host line and by the caller");
    // The wrapper's line owns both spellings whichever it uses: a caller's
    // `class` against a line `className` reaches the merge, never the rest road.
    const { Spelled } = load(`${BASE}
export Spelled = component extends Base
  render
    Base className: 'wrap'
      slot
`, 'Spelled');
    const s = mount(Spelled, { class: 'mine' });
    const shost = s.inst._inheritedInst._inheritedEl;
    expect(shost.className).toBe('base wrap mine');
    s.inst._updateProp('class', 'yours');
    expect(shost.className).toBe('base wrap yours');
    // Manual mode on a wrapper: the list and object pass exactly as spelled.
    const { Manual } = load(`${BASE}
export Manual = component extends Base
  render
    Base class: [@rest.class, 'last'], style: (@rest.style ?? { margin: '2px' })
      slot
`, 'Manual');
    const m = mount(Manual, { class: 'mine', style: { padding: '1px' } });
    const mhost = m.inst._inheritedInst._inheritedEl;
    expect(mhost.className).toBe('base mine last');
    expect(mhost.style.margin).toBeFalsy();
    expect(mhost.style.padding).toBe('1px');
    m.inst._updateProp('style', null);
    expect(mhost.style.margin).toBe('2px');
  });

  test('manual mode: a body that reads @rest.class or @rest.style owns that key — the author\'s list and object stand alone', () => {
    const { Btn } = load(`export Btn = component extends button
  own := { color: 'red' }
  render
    button.base class: [@rest.class, 'last'], style: (@rest.style ?? own)
      slot
`, 'Btn');
    const { inst, el } = mount(Btn, { class: 'mine', style: { color: 'blue' } });
    expect(el.className).toBe('base mine last');
    expect(el.style.color).toBe('blue');
    inst._updateProp('class', 'yours');
    expect(el.className).toBe('base yours last');
    inst._updateProp('style', null);
    expect(el.style.color).toBe('red');
    const bare = mount(Btn, {});
    expect(bare.el.className).toBe('base last');
    expect(bare.el.style.color).toBe('red');
  });
});
