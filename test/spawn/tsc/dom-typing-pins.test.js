// The TS mechanics the generated intrinsic-element surfaces stand on
// (src/ts/dom-types.js): each block pins one behavior of the pinned
// tsgo that the design's checking, anchoring, or quietness depends on.
// A pin failing on a TS upgrade means the surface's contract shifted —
// the emission must be revisited before the upgrade lands, which is
// why these run against the repo's own pinned compiler and no other.
//
// Rides the EXTENDED tier: it spawns the pinned tsc (resolveTsc — the
// native tsgo binary, the same engine the editor broker runs).

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from '../../support/spawn.js';
import { describeExtended } from '../../support/extended.js';
import { resolveTsc } from '../../support/tsc.js';

// Compile one source against the pinned tsc under the flags the check
// path uses; return the diagnostics as `{ line, code }` rows plus the
// raw text for message-shape assertions.
function check(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-dom-typing-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.ts'), source);
    const r = spawnSync(resolveTsc(), ['--noEmit', '--strict', '--target', 'esnext', '--lib', 'dom,esnext', 'probe.ts'], {
      cwd: dir, encoding: 'utf8', timeout: 60_000,
    });
    const rows = [];
    for (const l of (r.stdout ?? '').split('\n')) {
      const m = l.match(/probe\.ts\((\d+),(\d+)\): error TS(\d+)/);
      if (m) rows.push({ line: Number(m[1]), col: Number(m[2]), code: Number(m[3]), text: l.trim() });
    }
    return { rows, text: r.stdout ?? '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const VALS = `
type __RipAV<E, P extends PropertyKey, F = string> = E extends Record<P, infer V> ? V | string : F
interface __RipAttrVals_input {
  placeholder: __RipAV<HTMLInputElement, 'placeholder'>
  maxlength: __RipAV<HTMLInputElement, 'maxLength'>
  maxLength: __RipAV<HTMLInputElement, 'maxLength'>
  alt: __RipAV<HTMLInputElement, 'alt'>
  width: __RipAV<HTMLInputElement, 'width'>
  required: __RipAV<HTMLInputElement, 'required'>
  [k: \`data-\${string}\`]: string | number | boolean
  [k: \`aria-\${string}\`]: string | number | boolean
}
declare const el: {
  setAttribute<A extends keyof __RipAttrVals_input & string>(name: A, value: __RipAttrVals_input[A]): void
  toggleAttribute(name: keyof __RipAttrVals_input & string, force?: boolean): boolean
  removeAttribute(name: keyof __RipAttrVals_input & string): void
}
`;

describeExtended('tsgo pins: the generated intrinsic-surface mechanics', () => {
  test('generic setAttribute<A>: literal keys infer, values check per key, templates admit data-/aria-', () => {
    const { rows } = check(`${VALS}
el.setAttribute('placeholder', 'x')        // L19 ok
el.setAttribute('placeholder', 42)         // L20 value errors, on the value
el.setAttribute('placeholdr', 'x')         // L21 unknown key errors, on the key
el.setAttribute('maxlength', 5)            // L22 ok — widened road (number | string)
el.setAttribute('maxlength', '5')          // L23 ok
el.setAttribute('alt', 42)                 // L24 number into a string attribute errors
el.setAttribute('width', '400')            // L25 ok — the coercive-serialization admission
el.setAttribute('required', true)          // L26 ok — boolean property widened | string
el.setAttribute('data-x', 5)               // L27 ok via template
el.setAttribute('aria-labl', 'z')          // L28 ok — templates admit any suffix by design
el.toggleAttribute('required')             // L29 ok
el.toggleAttribute('requird')              // L30 unknown key errors
el.removeAttribute('valu')                 // L31 unknown key errors
`);
    expect(rows.map((r) => [r.line, r.code])).toEqual([
      [20, 2345], [21, 2345], [24, 2345], [30, 2345], [31, 2345],
    ]);
  });

  test('key errors spell the expanded union inline (no alias name), truncated but naming templates', () => {
    const { rows } = check(`${VALS}
el.setAttribute('placeholdr', 'x')
`);
    expect(rows).toHaveLength(1);
    // The constraint must render as the member-name union — the message
    // is the did-you-mean surface this road has — never as an opaque
    // alias spelling (which a named-alias constraint would produce).
    expect(rows[0].text).toContain(`"placeholder"`);
    expect(rows[0].text).not.toContain('keyof');
  });

  test('value errors resolve the guarded lookup to plain primitives, never the helper spelling', () => {
    const { rows, text } = check(`${VALS}
el.setAttribute('alt', 42)
`);
    expect(rows.map((r) => r.code)).toEqual([2345]);
    expect(text).toContain(`'number' is not assignable`);
    expect(text).toContain(`'string'`);
    expect(text).not.toContain('__RipAV');
  });

  test('addEventListener: map overload types known names; unknown names ride the string overload silently', () => {
    const { rows } = check(`
declare const el: {
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (e: HTMLElementEventMap[K] & { target: HTMLInputElement; currentTarget: HTMLInputElement }) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(type: string, listener: (e: any) => unknown, options?: boolean | AddEventListenerOptions): void
}
el.addEventListener('input', (ev: any) => 0)   // known name, wrapper-shaped listener
el.addEventListener('fancy', (ev: any) => 0)   // custom name — legal by design, no error
`);
    expect(rows).toEqual([]);
  });

  test('a contextual (e: any) cast quiets TS7006 where a bare `as any` cast does not', () => {
    const { rows } = check(`
const viaContextual = ((e) => e.whatever) as (e: any) => unknown
const viaBare = ((e) => e.whatever) as any
`);
    expect(rows.map((r) => [r.line, r.code])).toEqual([[3, 7006]]);
  });

  test('__ripRefCell arms: any/null/exact/base cells pass, a non-nullable cell rejects on the cell argument', () => {
    const { rows } = check(`
type __RipEqEl<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type __RipBaseEl<T> = __RipEqEl<T, EventTarget> extends true ? true : __RipEqEl<T, Node> extends true ? true : __RipEqEl<T, Element> extends true ? true : __RipEqEl<T, HTMLElement> extends true ? true : __RipEqEl<T, SVGElement> extends true ? true : __RipEqEl<T, HTMLMediaElement> extends true ? true : __RipEqEl<T, SVGGraphicsElement> extends true ? true : false
type __RipRefOk<V, E> =
  0 extends (1 & V) ? unknown
  : [V] extends [null] ? unknown
  : null extends V
    ? ([E] extends [Extract<NonNullable<V>, E>] ? unknown
       : __RipBaseEl<NonNullable<V>> extends true ? ([E] extends [NonNullable<V>] ? unknown : never) : never)
    : never
declare function __ripRefCell<K extends keyof HTMLElementTagNameMap, V>(
  tag: K,
  cell: { value: V } & __RipRefOk<V, HTMLElementTagNameMap[K]>,
): { value: HTMLElementTagNameMap[K] | null }
declare const anyCell: { value: any }
declare const nullCell: { value: null }
declare const inputCell: { value: HTMLInputElement | null }
declare const baseCell: { value: HTMLElement | null }
declare const nonNullCell: { value: HTMLInputElement }
declare const divCell: { value: HTMLDivElement | null }
declare const _el: any
__ripRefCell('input', anyCell).value = _el as HTMLInputElement | null    // L22 the V=any arm
__ripRefCell('input', nullCell).value = _el as HTMLInputElement | null   // L23 the \`el := null\` idiom arm
__ripRefCell('input', inputCell).value = _el as HTMLInputElement | null  // L24 exact element
__ripRefCell('input', baseCell).value = _el as HTMLInputElement | null   // L25 recognized base, tag derives
__ripRefCell('input', nonNullCell)                                       // L26 non-nullable cell rejects
__ripRefCell('input', divCell)                                           // L27 rich sibling rejects
`);
    expect(rows.map((r) => [r.line, r.code])).toEqual([[26, 2345], [27, 2345]]);
  });

  test('the ref admission boundary: featureless siblings ARE the HTMLElement base under the pinned lib', () => {
    // HTMLSpanElement declares no members of its own, and the pinned
    // lib makes it type-identical to HTMLElement — so a span-typed cell
    // is a BASE cell and every HTML tag's ref may write into it. The
    // admission is the base-widening arm working as specified (v3's
    // checker admits the same cell); a lib upgrade that gives the
    // interface own members flips this pin, and the divergence note in
    // docs/TYPES.md is what must be revisited with it.
    const { rows } = check(`
type __RipEqEl<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const identical: __RipEqEl<HTMLSpanElement, HTMLElement> = true
`);
    expect(rows).toEqual([]);
  });

  test('assignment through a call result\'s property is legal, and the write-back checks against the return', () => {
    const { rows } = check(`
declare function f(x: number): { value: HTMLInputElement | null }
declare const _el: any
f(1).value = _el as HTMLInputElement | null
f(2).value = 'not-an-element'   // L5 the return type still governs the write
`);
    expect(rows.map((r) => [r.line, r.code])).toEqual([[5, 2322]]);
  });

  test('the named-method handler cast: unrelated event params draw TS2352, subtypes and fewer params pass', () => {
    const { rows } = check(`
type Ev = PointerEvent & { target: HTMLButtonElement; currentTarget: HTMLButtonElement }
declare const onKey: (e: KeyboardEvent) => string
declare const onClick: (e: MouseEvent) => string
declare const zeroArg: () => void
declare const twoArg: (a: string, b: number) => void
const a = onKey as (e: Ev) => unknown     // L7 unrelated param — the mismatch this cast exists to catch
const b = onClick as (e: Ev) => unknown   // L8 PointerEvent extends MouseEvent — legal handler
const c = zeroArg as (e: Ev) => unknown   // L9 arity forgiveness holds through the cast
const d = twoArg as (e: Ev) => unknown    // L10 more params than the listener passes — rejected
`);
    expect(rows.map((r) => [r.line, r.code])).toEqual([[7, 2352], [10, 2352]]);
  });
});
