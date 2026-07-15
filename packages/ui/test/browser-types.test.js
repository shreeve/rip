// The browser primitives' TypeScript faces: every module compiles, and the
// hand-written browser.d.ts contract type-checks against a consumer that
// exercises the public surface (including the negatives it must reject).
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../../../src/compile.js';
import { tscBatch } from '../../../test/support/tscbatch.js';

const moduleNames = ['core', 'nav', 'dismiss', 'overlay', 'position', 'focus', 'scroll', 'browser'];

test('browser primitives compile and the .d.ts contract type-checks', () => {
  for (const name of moduleNames) {
    const source = readFileSync(new URL(`../browser/${name}.rip`, import.meta.url), 'utf8');
    const result = compile(source, { path: `${name}.rip`, face: 'ts', runtimeDelivery: 'none' });
    expect(result.code.length).toBeGreaterThan(0);
  }

  const files = {
    'browser.d.ts': readFileSync(new URL('../browser/browser.d.ts', import.meta.url), 'utf8'),
    'consumer.ts': [
      "import { listNav, rovingNav, navAction, rovingIndex, popupDismiss, popupGuard, outsideElements, bindPopover, bindDialog, position, positionBelow, parsePlacement, computePlacement, belowPosition, hasAnchor, focusTrapMove, trapFocus, wireAria, createScrollLock, lockScroll, unlockScroll, combine, getRef } from './browser';",
      "import type { AriaNavHandlers, AriaElRef, Disposer, ScrollLock, Rect, Viewport, NavAction } from './browser';",

      "const handlers: AriaNavHandlers = { next: () => {}, char: (k: string) => { void k; } };",
      "declare const kbd: KeyboardEvent;",
      "listNav(kbd, handlers);",
      "rovingNav(kbd, handlers, 'horizontal');",
      "const action: NavAction | null = navAction('ArrowDown');",
      "const idx: number = rovingIndex(0, 'next', 3);",
      "const idx2: number = rovingIndex(0, 'prev', 3, false);",
      "// @ts-expect-error 'tab' is not a NavAction",
      "rovingIndex(0, 'tab', 3);",

      "const outside: boolean = outsideElements(null, [null, { contains: (t: unknown) => t === null }]);",
      "const guard = popupGuard();",
      "guard.block();",
      "guard.block(100);",
      "const canOpen: boolean = guard.canOpen();",
      "// @ts-expect-error canOpen takes no argument",
      "guard.canOpen(1);",

      "declare const el: HTMLElement;",
      "const ref: AriaElRef = () => el;",
      "const d1: Disposer | undefined = popupDismiss(true, ref, () => {}, [ref], null);",
      "const d2: Disposer | undefined = bindPopover(true, ref, (o: boolean) => { void o; }, ref);",
      "const d3: Disposer | undefined = bindDialog(true, el, (o: boolean) => { void o; }, false);",

      "position(el, el, { placement: 'bottom start', offset: 4, matchWidth: true });",
      "positionBelow(el, el, 4, true);",
      "const parsed = parsePlacement('bottom start');",
      "const area: string = parsed.positionArea;",
      "const rect: Rect = { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };",
      "const vp: Viewport = { width: 0, height: 0 };",
      "const styles: Record<string, string> = computePlacement(rect, vp, { side: 'bottom', align: 'start' });",
      "const below = belowPosition(rect, rect, vp, 4);",
      "const bt: number = below.top;",
      "const anchor: boolean = hasAnchor();",

      "const move = focusTrapMove([el], el, false);",
      "const moveFocus: HTMLElement | null = move.focus;",
      "const prevent: boolean = move.prevent;",
      "declare const panel: Element;",
      "const d4: Disposer = trapFocus(panel);",
      "wireAria(el, 'dlg-1');",

      "const lock: ScrollLock = createScrollLock({ scrollY: () => 0, freeze: (y: number) => { void y; }, release: (y: number) => { void y; } });",
      "lock.lock({});",
      "lock.unlock({});",
      "const size: number = lock.size();",
      "lockScroll({});",
      "unlockScroll({});",

      "const d5: Disposer = combine(d1, d4, null, undefined);",
      "const resolved = getRef(ref);",
      "// @ts-expect-error orientation is a fixed union",
      "rovingNav(kbd, handlers, 'diagonal');",

      "void action; void idx; void idx2; void outside; void canOpen; void d1; void d2; void d3; void d4; void d5; void area; void styles; void bt; void anchor; void moveFocus; void prevent; void size; void resolved; void parsed;",
    ].join('\n'),
  };

  const checked = tscBatch(process.env.RIP_TSC ?? 'tsc', files, [
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--allowImportingTsExtensions',
    '--strict',
    '--noImplicitAny', 'false',
    '--skipLibCheck',
  ]);
  const diagnostics = [...checked.unattributed, ...[...checked.byFile.values()].flat()];
  if (checked.status !== 0) {
    throw new Error(`browser primitives type check failed:\n${diagnostics.join('\n')}`);
  }
  expect(checked.status).toBe(0);
  expect(checked.unattributed).toEqual([]);
  expect([...checked.byFile.values()].flat()).toEqual([]);
});
