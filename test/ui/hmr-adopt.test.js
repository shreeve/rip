// Child adoption across a parent's patch: the rebuilt view constructs
// its children again, and a construction that matches exactly one
// released child by definition and prop keys gets the living instance
// back — state, `_init` members, and its own children — wired to the
// new props. Ambiguous matches, changed prop shapes, and incompatible
// signatures construct fresh; released children the view does not
// claim are unmounted.
import { describe, expect, test } from 'bun:test';
import { compile } from '../../src/compile.js';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';
import * as reactiveRuntime from '../../src/runtime/reactive.js';
import * as componentRuntime from '../../src/runtime/components.js';

installRecordingDOM();
const RT = { ...reactiveRuntime, ...componentRuntime };

const load = (src, path = 'adopt.rip') => {
  const { code } = compile(src, { path, runtimeDelivery: 'none', hmr: true });
  const body = code.replace(/^export /gm, '');
  const names = Object.keys(RT);
  return new Function(...names, `${body}\nreturn { C, Kid, Grand };`)(...names.map((n) => RT[n]));
};

const GRAND = `Grand = component
  n := 0
  render
    i n
`;

const KID = `Kid = component
  @label: string
  @extra?: number
  count := 0
  render
    div class: 'kid'
      span label
      b count
      Grand
`;

const BASE = `${GRAND}
${KID}
export C = component
  show := true
  render
    div
      h1 'v1'
      Kid label: 'a'
`;

const mountParent = (src) => {
  const mod = load(src);
  const target = document.createElement('main');
  const parent = new mod.C({});
  parent.mount(target);
  return { mod, target, parent, kid: parent._children[0] };
};

describe('child adoption across a parent patch', () => {
  test('a render-only parent edit keeps the child instance, its state, and its own children', () => {
    const { mod: Old, target, parent, kid } = mountParent(BASE);
    const Next = load(BASE.replace("h1 'v1'", "h1 'v2'"));
    expect(componentRuntime.__hmrClassify(Old.C, Next.C)).toBe('patch');
    const grand = kid._children[0];
    kid.count.value = 3;
    grand.n.value = 5;
    const countBox = kid.count;

    componentRuntime.__hmrPatch(parent, Next.C);

    expect(serialize(target)).toContain('<h1>v2</h1>');
    expect(parent._children[0]).toBe(kid);
    expect(kid._state).toBe('mounted');
    expect(kid.count).toBe(countBox);
    expect(kid.count.value).toBe(3);
    expect(kid._children[0]).toBe(grand);
    expect(grand.n.value).toBe(5);
    expect(serialize(target)).toContain('<b>3</b>');
    expect(serialize(target)).toContain('>5</i>');
    expect(parent._hmrOrphans).toBeNull();
    parent.unmount();
  });

  test('the adopted child takes the new props', () => {
    const { target, parent, kid } = mountParent(BASE);
    const Next = load(BASE.replace("Kid label: 'a'", "Kid label: 'z'"));
    kid.count.value = 2;

    componentRuntime.__hmrPatch(parent, Next.C);

    expect(parent._children[0]).toBe(kid);
    expect(kid.label.value).toBe('z');
    expect(serialize(target)).toContain('<span>z</span>');
    expect(serialize(target)).toContain('<b>2</b>');
    parent.unmount();
  });

  test('a child whose module also changed is adopted onto its new definition', () => {
    const { parent, kid } = mountParent(BASE);
    const Next = load(BASE.replace("span label", "em label"));
    expect(componentRuntime.__hmrClassify(kid.constructor, Next.Kid)).toBe('patch');
    kid.count.value = 4;

    componentRuntime.__hmrPatch(parent, Next.C);

    expect(parent._children[0]).toBe(kid);
    expect(kid).toBeInstanceOf(Next.Kid);
    expect(kid.count.value).toBe(4);
    expect(componentRuntime.__hmrLookup(Next.Kid.__hmrId).instances.has(kid)).toBeTrue();
    parent.unmount();
  });

  test('a child inside a block is adopted too', () => {
    const src = BASE.replace("      Kid label: 'a'\n", "      if show\n        Kid label: 'a'\n");
    const mod = load(src);
    const target = document.createElement('main');
    const parent = new mod.C({});
    parent.mount(target);
    const kid = [...componentRuntime.__hmrLookup(mod.Kid.__hmrId).instances].find((i) => i._parent === parent);
    expect(kid).toBeDefined();
    kid.count.value = 7;

    componentRuntime.__hmrPatch(parent, load(src.replace("h1 'v1'", "h1 'v2'")).C);

    expect(kid._state).toBe('mounted');
    expect(kid.count.value).toBe(7);
    expect(serialize(target)).toContain('<b>7</b>');
    expect(parent._hmrOrphans).toBeNull();
    parent.unmount();
  });

  test('two released children of one shape are ambiguous: both construct fresh', () => {
    const src = BASE.replace("      Kid label: 'a'\n", "      Kid label: 'a'\n      Kid label: 'b'\n");
    const { target, parent } = mountParent(src);
    const [first, second] = parent._children;
    first.count.value = 1;
    second.count.value = 2;

    componentRuntime.__hmrPatch(parent, load(src.replace("h1 'v1'", "h1 'v2'")).C);

    expect(parent._children).toHaveLength(2);
    expect(parent._children).not.toContain(first);
    expect(parent._children).not.toContain(second);
    expect(first._state).toBe('unmounted');
    expect(second._state).toBe('unmounted');
    expect(serialize(target)).not.toContain('<b>1</b>');
    expect(serialize(target)).not.toContain('<b>2</b>');
    parent.unmount();
  });

  test('a construction whose prop keys changed constructs fresh', () => {
    const { parent, kid } = mountParent(BASE);
    kid.count.value = 3;

    componentRuntime.__hmrPatch(parent, load(BASE.replace("Kid label: 'a'", "Kid label: 'a', extra: 1")).C);

    expect(parent._children[0]).not.toBe(kid);
    expect(kid._state).toBe('unmounted');
    expect(parent._children[0].count.value).toBe(0);
    expect(parent._children[0].extra.value).toBe(1);
    parent.unmount();
  });

  test('a released child the rebuilt view does not claim is unmounted', () => {
    const { target, parent, kid } = mountParent(BASE);
    const grand = kid._children[0];

    componentRuntime.__hmrPatch(parent, load(BASE.replace("      Kid label: 'a'\n", '')).C);

    expect(parent._children).toBeNull();
    expect(kid._state).toBe('unmounted');
    expect(grand._state).toBe('unmounted');
    expect(parent._hmrOrphans).toBeNull();
    expect(componentRuntime.__hmrLookup(kid.constructor.__hmrId).instances.has(kid)).toBeFalse();
    expect(serialize(target)).not.toContain('kid');
    parent.unmount();
  });

  test('adoption does not re-run the child _init', () => {
    const { mod, parent, kid } = mountParent(BASE);
    const Next = load(BASE.replace("h1 'v1'", "h1 'v2'"));
    // The adoptee lands on the NEXT definition, so both classes count.
    let inits = 0;
    for (const Kid of [mod.Kid, Next.Kid]) {
      const origInit = Kid.prototype._init;
      Kid.prototype._init = function (props) {
        inits += 1;
        return origInit.call(this, props);
      };
    }

    componentRuntime.__hmrPatch(parent, Next.C);

    expect(parent._children[0]).toBe(kid);
    expect(kid).toBeInstanceOf(Next.Kid);
    expect(inits).toBe(0);
    parent.unmount();
  });

  test('an ordinary unmount outside a release tears the child down', () => {
    const { parent, kid } = mountParent(BASE);
    parent.unmount();
    expect(kid._state).toBe('unmounted');
    expect(parent._hmrOrphans).toBeUndefined();
  });
});
