// The generated-scope inventory: every emitter site that puts a
// FUNCTION SCOPE into generated output (an arrow, an IIFE) is listed
// here with its control-capability policy. A generated scope is a
// control-flow boundary — an unguarded one can capture a source
// `yield`/`await` and emit invalid JavaScript (the silent-miscompile
// class), so a new site must (a) preserve the source control context
// without a function boundary, (b) explicitly support async/generator
// behavior, or (c) reject positioned before emitting — and then add
// its row here. A count drift in an existing row means a site was
// added, removed, or reshaped: re-audit its policy before updating.
//
// This test scans COMPILER SOURCE (never generated output — the
// mapping doctrine's no-scanning rule applies to emitted code and its
// mapping facts, not to auditing the emitter itself).
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '../../src/emitter.js'), 'utf8');

// sig: a byte-exact slice of the emission line. count: how many times
// it appears. policy: how source control flow is kept legal.
const INVENTORY = [
  { sig: "? 'await (async () => {\\n' : '(() => {\\n'", count: 2,
    site: 'comprehension statement body; array/object comprehension',
    policy: 'await rides the async form; yield/return/bare break/continue reject via rejectYieldInIIFE' },
  { sig: "? 'await (async () => { ' : '(() => { '", count: 3,
    site: 'accumulator loops; comprehension value position; switch expression',
    policy: 'await rides the async form; yield/return/bare break/continue reject via rejectYieldInIIFE' },
  { sig: "? 'await (async () => { throw ' : '(() => { throw '", count: 1,
    site: 'value-position throw',
    policy: 'await rides the async form; yield/return/bare break/continue reject via rejectYieldInIIFE' },
  { sig: "this.b.emit('() => ');", count: 1,
    site: "computed ('~=') lowering",
    policy: 'the computed body rejects both yield and await with its own positioned errors (computeds evaluate synchronously)' },
  { sig: "isAsync ? '(async () => ' : '(() => '", count: 2,
    site: 'effectValue (the statement/expression/tail effect funnel); component-body effects',
    policy: 'await rides the async form; yield rejects — in effectValue for every effect position, and again at component collection (the one path that bypasses the funnel)' },
  { sig: "' = __computed(() => '", count: 1,
    site: 'component computed member',
    policy: 'computedBody applies the same yield/await rejections as the top-level computed lowering' },
  { sig: "'__effect(() => { '", count: 1,
    site: 'render updater effect',
    policy: 'render-wide: findRenderControl rejects await/yield in every render expression at collection; function values pass through with their own context' },
  { sig: '__effect(() => {\\n', count: 2,
    site: 'render if-block and for-block reconciler effects',
    policy: 'emitter-owned statements; embedded user expressions are covered by findRenderControl' },
  { sig: '__batch(() => {\\n', count: 2,
    site: 'render reconciler batch windows (if-block; detach path)',
    policy: 'emitter-owned statements; embedded user expressions are covered by findRenderControl' },
  { sig: "'__batch(() => '", count: 1,
    site: 'render for-block batch window',
    policy: 'emitter-owned statements; embedded user expressions are covered by findRenderControl' },
  { sig: '__ownerFrame().add(() =>', count: 2,
    site: 'render if/for cleanup registrations',
    policy: 'emitter-owned statements only — no user expression embeds' },
  { sig: '() => ${leaving}.d(true)', count: 1,
    site: 'render transition completion callback',
    policy: 'emitter-owned statement only — no user expression embeds' },
  { sig: '() => __detachRef', count: 1,
    site: 'render ref cleanup registration',
    policy: 'emitter-owned statement only — no user expression embeds' },
  { sig: '(${ev}) => __batch(() => (', count: 1,
    site: 'child-component event prop listener',
    policy: 'handler expressions are covered by findRenderControl; function handlers pass through with their own context' },
  { sig: '(${ev}) => __batch(() => `', count: 1,
    site: 'element event listener',
    policy: 'handler expressions are covered by findRenderControl; function handlers pass through with their own context' },
  { sig: '(${ev}) => { ', count: 1,
    site: 'two-way binding write-back listener',
    policy: 'binding targets are covered by findRenderControl' },
  { sig: '((${p}) =>', count: 2,
    site: 'pick with a single-evaluation source (plain and optional forms, one ternary)',
    policy: 'pick defaults reject both yield and await positioned when the source needs the arrow' },
];

describe('generated-scope inventory', () => {
  for (const row of INVENTORY) {
    test(`${row.site} — ${row.sig.slice(0, 40)}`, () => {
      expect(src.split(row.sig).length - 1).toBe(row.count);
    });
  }

  test('the inventory covers the whole population', () => {
    // The population total. A generated-scope site added, removed, or
    // reshaped moves its sig count above and this sum with it — both
    // failures say: re-audit the site's control policy first, then
    // update the row. (A brand-new site spelled unlike every existing
    // sig is caught by review and the lowering doctrine, which
    // requires registering here — string-counting compiler source
    // cannot distinguish emitted arrows from the emitter's own.)
    expect(INVENTORY.reduce((n, r) => n + r.count, 0)).toBe(25);
  });
});
