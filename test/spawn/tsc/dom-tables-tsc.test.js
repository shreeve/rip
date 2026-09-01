// The DOM tables ↔ pinned-lib lockstep: src/dom.js's tag and event
// vocabularies ARE the pinned lib.dom.d.ts maps, name for name, in both
// directions.
//
// The sibling gate (dom-surfaces-tsc) compiles the surfaces our tables
// name, so it catches a name we carry that the lib dropped or renamed.
// It cannot catch the other direction: a lib that GAINS a tag or an
// event leaves our tables short, and the new element is simply rejected
// as unknown with nothing failing. This gate closes that direction, so a
// TypeScript upgrade that moves the DOM vocabulary fails here rather than
// in an app.
//
// The tables are hand-written data by design (the attribute vocabularies
// beside them are WHATWG content-attribute data, which lib.dom does not
// describe — it types properties). Equality is therefore asserted, never
// generated: a deliberate divergence stays possible and has to be spelled
// out here, in a diff a reviewer reads.
//
// Rides the EXTENDED tier: the oracle is the repo's pinned TypeScript.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import { describeExtended } from '../../support/extended.js';
import { resolveDomLib } from '../../support/tsc.js';
import { HTML_TAGS, SVG_TAGS, DOM_EVENTS } from '../../../src/dom.js';

// One interface's OWN member keys — quoted (`"animationend": Event;`) or
// bare, at the declaration's single indent level. Methods and index rows
// carry no key and fall out on their own.
function ownKeys(text, name) {
  const open = new RegExp(`^interface ${name}(?: extends [^{]*)? \\{$`, 'm').exec(text);
  expect(open, `interface ${name} is missing from the pinned lib.dom.d.ts`).toBeTruthy();
  const body = text.slice(open.index + open[0].length);
  const keys = new Set();
  for (const line of body.slice(0, body.indexOf('\n}')).split('\n')) {
    const key = /^ {4}"([^"]+)":/.exec(line) ?? /^ {4}([A-Za-z_][\w-]*)\??:/.exec(line);
    if (key) keys.add(key[1]);
  }
  return keys;
}

// An interface's keys INCLUDING everything it extends. The event map is a
// hierarchy (HTMLElementEventMap extends ElementEventMap and
// GlobalEventHandlersEventMap), and walking the `extends` clause rather
// than naming today's parents keeps a restructured hierarchy inside what
// this gate measures.
function allKeys(text, name, seen = new Set()) {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const keys = ownKeys(text, name);
  const open = new RegExp(`^interface ${name} extends ([^{]*) \\{$`, 'm').exec(text);
  for (const parent of open === null ? [] : open[1].split(',').map((s) => s.trim())) {
    for (const key of allKeys(text, parent, seen)) keys.add(key);
  }
  return keys;
}

describeExtended('dom tables ↔ pinned lib.dom', () => {
  const text = () => fs.readFileSync(resolveDomLib(), 'utf8');

  test('HTML_TAGS is HTMLElementTagNameMap', () => {
    expect([...HTML_TAGS].sort()).toEqual([...ownKeys(text(), 'HTMLElementTagNameMap')].sort());
  });

  test('SVG_TAGS is SVGElementTagNameMap', () => {
    expect([...SVG_TAGS].sort()).toEqual([...ownKeys(text(), 'SVGElementTagNameMap')].sort());
  });

  test('DOM_EVENTS is the HTMLElementEventMap closure', () => {
    expect([...DOM_EVENTS].sort()).toEqual([...allKeys(text(), 'HTMLElementEventMap')].sort());
  });
});
