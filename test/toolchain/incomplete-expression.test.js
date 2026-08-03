// Completion and signature help on an INCOMPLETE expression — the
// INVERTED gate for the finding this file used to assert as a gap. The
// editor's face compile is tolerant: an incomplete buffer (a trailing
// member dot, an open call) still yields a CURRENT face, with zero-width
// holes at the incompleteness, so both features answer from the buffer
// being typed. This suite asserts the CORRECT answers where its previous
// self pinned the wrong ones:
//   • member completion at a bare dot serves the receiver's member list —
//     fresh buffer or mid-edit, no prior good compile required;
//   • signature help inside an open call serves the signature and the
//     RIGHT activeParameter — mid-file (the backspaced call) and at end
//     of file (the argument-slot hole's zero-width mapping row is what
//     makes the cursor resolvable there).
// Tolerance is never acceptance: every recovered request below is paired
// with the assertion that rip still PUBLISHES the buffer's own rejection
// — a server that silently accepted the incomplete program would fail
// this file before any completion assertion runs.
//
// EVERY request follows a publication BARRIER — forget(), then edit, then
// await diagnostics — because the server debounces didChange (100ms) and
// then compiles and round-trips to tsgo. Without it every answer here
// races that refresh; awaiting the republication means each answer is the
// server's settled one.
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';
import { compile } from '../../src/compile.js';

// The REPAIR DRIVER's compile-level gates — no server, no debounce. These
// shapes died at the parser before the driver learned two generic
// lessons: a deletion is progress (the guard must clear), and a repair
// guard blind to stack depth spends a candidate on the first of two
// nested blocks and starves the second.
describe('tolerant repair at the parser level', () => {
  const tolerant = (src) => compile(src, { runtimeDelivery: 'none', tolerant: true, face: 'ts' });

  test('a dangling if/unless header keeps a face — the condition still parses', () => {
    for (const [src, kept] of [['x = 1\nif x\n', 'x;'], ['unless ready\n', 'ready;']]) {
      const r = tolerant(src);
      expect(r.parseDiagnostics.length).toBeGreaterThan(0);   // tolerance is never acceptance
      expect(r.code).toContain(kept);
    }
  });

  test('typing a new class method keeps the class\'s face', () => {
    for (const src of ['class A\n  m: (\n', 'class A\n  m: (x,\n']) {
      const r = tolerant(src);
      expect(r.parseDiagnostics.length).toBeGreaterThan(0);
      expect(r.code).toContain('class A');
    }
  });

  test('a trailing dot repairs at near-constant cost, however deep the statement nesting', () => {
    // One incompleteness, one hole: the error state's own repairTable
    // candidate (PROPERTY at a trailing dot) is tried BEFORE the
    // scaffolding-delete rule. Deleting first flattened the block
    // structure and re-fabricated it level by level (~5 repairs per
    // nesting level), so a single trailing dot inside
    // class/method/if/callback/if nesting exhausted the 24-repair
    // budget at depth 5 and the face died at the exact keystroke
    // tolerance exists for — with the recorded rejection degrading to
    // an unhinted 'Unexpected OUTDENT' along the way.
    const depth5 = 'class A\n  m: ->\n    if x\n      y = (z) ->\n        if w\n          z.';
    const r = tolerant(depth5);
    expect(r.parseDiagnostics.length).toBeGreaterThan(0);   // tolerance is never acceptance
    expect(r.parseDiagnostics[0].expected).toContain('PROPERTY'); // the what-to-type hint survives nesting
    expect(r.code).toContain('class A');
  });

  test('a deleted real token leaves its marker even when the lexer already complained', () => {
    // The first-rejection rule is the PARSER's own: a lexer diagnostic
    // (here the unclosed call) must not suppress the record of a panic
    // deletion — the user's second '.' is eaten mid-buffer, and without
    // its own diagnostic the deletion is invisible exactly where the
    // buffer needs the marker.
    const r = tolerant('a . . b\nadd(1, ');
    expect(r.parseDiagnostics.some((d) => /unclosed '\('/.test(d.message))).toBe(true);
    expect(r.parseDiagnostics.some((d) => /Unexpected '\.'/.test(d.message) && d.start === 4)).toBe(true);
  });

  test('a stray-indented line consumes real input once and keeps the surrounding face', () => {
    for (const src of [
      'x = 1\n  y = 2\n',
      'x = 1\n  y = 2\nz = 3\n',
      'class A\n  m: ->\n    1\nx = 1\n  y\n',
    ]) {
      const r = tolerant(src);
      expect(r.code).toContain('x = 1');
      expect(r.parseDiagnostics.some((d) =>
        /Unexpected 'INDENT'/.test(d.message) && d.expected.includes('TERMINATOR'))).toBe(true);
    }
  });

  test('a half-typed schema member keeps the schema\'s face — the line is the repair unit', () => {
    // Typing a schema method passes through `greet: ` and `greet: str`,
    // shapes schema validation rejects loudly. A strict compile still
    // throws; the TOLERANT one records the rejection and drops the
    // line, so the rest of the schema keeps serving its face for the
    // whole keystroke run between ':' and a completed '->'.
    for (const src of [
      'User = schema :model\n  name! string\n  greet: \n',
      'User = schema :model\n  name! string\n  greet: str\n',
    ]) {
      const r = tolerant(src);
      expect(r.parseDiagnostics.length).toBeGreaterThan(0);   // tolerance is never acceptance
      expect(r.code).toContain('{tag: "field", name: "name"'); // the completed field survives the keystroke
      expect(() => compile(src, { runtimeDelivery: 'none' })).toThrow(/greet/); // strict stays loud
    }
  });

  test('keyword-continuation dead ends stay dead — the accepted limit, pinned', () => {
    // Buffers pausing where the only legal continuation is a keyword
    // outside the fabricable alphabet (FROM after an import list, a
    // name/'=' after 'export', ':' in a ternary) still hard-fail the
    // tolerant parse, and the editor rides the last-good face for those
    // keystrokes. Keywords are excluded from fabrication on principle
    // (solar.rip: a fabricated keyword invents MEANING, not
    // scaffolding); the upgrade path, should these shapes ever earn
    // repair, is the grammar declaring its own fabricable tokens — the
    // genericity boundary. This pin records the limit as chosen, not
    // overlooked.
    for (const src of ['import {a,\n', 'export \n', 'x = a ? \n']) {
      expect(() => tolerant(src)).toThrow(/Unexpected|unclosed/);
    }
  });

  test('a class-body `def` rejects exactly as its complete program does', () => {
    // `def` is not a class-member form in rip, complete or not — the
    // tolerant compile must not invent a face for a program no
    // completion makes valid, and the strict twin fixes the message.
    let strict = null;
    let tol = null;
    try { compile('class A\n  def m()\n    1\n', { runtimeDelivery: 'none' }); } catch (e) { strict = e.message; }
    try { tolerant('class A\n  def m(\n'); } catch (e) { tol = e.message; }
    expect(strict).toContain('unsupported class member');
    expect(tol).toContain('unsupported class member');
  });
});

describeExtended('completion and signature help on an incomplete expression', () => {
  test('member completion at a bare dot serves the member list (fresh and mid-edit)', async () => {
    const s = await openSession({
      'app.rip': 'items: number[] = [1, 2, 3]\nx = items.\n',
      'package.json': '{}\n',
    });
    try {
      // FRESH: the buffer has never compiled without the dot — the answer
      // cannot be coming from any earlier face.
      s.open('app.rip');
      const fresh = await s.diagnostics('app.rip');
      // Honesty: the recovered buffer still reports its own incompleteness.
      expect(fresh.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);
      const freshDot = await s.completions('app.rip', 1, 10);   // right after the dot
      expect(freshDot).toContain('map');
      expect(freshDot).toContain('filter');

      // MID-EDIT: a good compile of the dotless statement, then the dot
      // typed — the interactive sequence, and the one whose STALE face
      // used to serve the in-scope identifier list instead of members.
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\nx = items\n');
      await s.diagnostics('app.rip');
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\nx = items.\n');
      const broken = await s.diagnostics('app.rip');
      expect(broken.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);
      const atDot = await s.completions('app.rip', 1, 10);
      expect(atDot).toContain('map');
      expect(atDot).toContain('filter');
      // The stale statement-context list is gone: members, not scope names.
      expect(atDot).not.toContain('items');

      // The complete expression still serves — the surface that always
      // worked keeps working.
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\nx = items.map\n');
      await s.diagnostics('app.rip');
      const parseable = await s.completions('app.rip', 1, 10);
      expect(parseable).toContain('map');
      expect(parseable).toContain('filter');
    } finally { await s.close(); }
  }, 90_000);

  test('signature help inside an open call serves the signature and activeParameter', async () => {
    const s = await openSession({
      'sig.rip': 'add = (a: number, b: number): number -> a + b\nr = add(1, 2)\nconsole.log r\n',
      'package.json': '{}\n',
    });
    try {
      s.open('sig.rip');
      await s.diagnostics('sig.rip');

      // The closed call answers, with the right active parameter — the
      // already-working surface, kept as the reference answer.
      const closed = await s.signatureHelp('sig.rip', 1, 11);    // inside the 2nd argument
      expect(closed?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');
      expect(closed?.activeParameter ?? closed?.signatures?.[0]?.activeParameter).toBe(1);

      // MID-FILE: the call WAS valid, now backspaced open — the common
      // interactive case, and the one that used to answer plain null.
      s.forget('sig.rip');
      s.change('sig.rip', 'add = (a: number, b: number): number -> a + b\nr = add(1, \nconsole.log r\n');
      const broken = await s.diagnostics('sig.rip');
      expect(broken.some((d) => /unclosed '\('/.test(d.message ?? ''))).toBe(true);
      const open = await s.signatureHelp('sig.rip', 1, 11, { tries: 2 });
      expect(open?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');
      expect(open?.activeParameter ?? open?.signatures?.[0]?.activeParameter).toBe(1);
    } finally { await s.close(); }
  }, 90_000);

  test('signature help at an open call ending the file resolves through the hole row', async () => {
    // The harsher position: nothing follows the open call, so the cursor
    // sits past every real byte. The lexer's argument-slot hole (minted
    // when a synthetic closer would land directly after a comma) carries
    // the zero-width mapping row the cursor resolver answers from — and
    // the trailing comma survives into the face, which is what keeps
    // activeParameter at 1 rather than collapsing to a one-argument call.
    const s = await openSession({
      'eof.rip': 'add = (a: number, b: number): number -> a + b\nr = add(1, 2)\n',
      'package.json': '{}\n',
    });
    try {
      s.open('eof.rip');
      await s.diagnostics('eof.rip');
      s.forget('eof.rip');
      s.change('eof.rip', 'add = (a: number, b: number): number -> a + b\nr = add(1, \n');
      const broken = await s.diagnostics('eof.rip');
      expect(broken.some((d) => /unclosed '\('/.test(d.message ?? ''))).toBe(true);
      const open = await s.signatureHelp('eof.rip', 1, 11, { tries: 2 });
      expect(open?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');
      expect(open?.activeParameter ?? open?.signatures?.[0]?.activeParameter).toBe(1);
    } finally { await s.close(); }
  }, 90_000);

  test('a MULTILINE call with a trailing comma keeps the in-progress slot', async () => {
    // The shape the single-line gates above cannot see: the lexer mints
    // an OUTDENT between the trailing comma and end of input when the
    // arguments sit on their own lines, and a tail probe that read only
    // the last token saw structure instead of the comma — no hole, and
    // the face completed the call one argument short. The hole must
    // splice INSIDE the argument block, where the next argument would
    // sit, for the cursor to resolve to slot 2.
    const s = await openSession({
      'ml.rip': 'pick = (a: number, b: number, c: number): number -> a + b + c\nr = pick(1, 2, 3)\n',
      'package.json': '{}\n',
    });
    try {
      s.open('ml.rip');
      await s.diagnostics('ml.rip');
      s.forget('ml.rip');
      s.change('ml.rip', 'pick = (a: number, b: number, c: number): number -> a + b + c\nr = pick(1,\n  2,\n');
      const broken = await s.diagnostics('ml.rip');
      expect(broken.some((d) => /unclosed '\('/.test(d.message ?? ''))).toBe(true);
      const open = await s.signatureHelp('ml.rip', 2, 4, { tries: 2 });   // after `  2,`
      expect(open?.signatures?.[0]?.label).toContain('pick(a: number, b: number, c: number): number');
      expect(open?.activeParameter ?? open?.signatures?.[0]?.activeParameter).toBe(2);
    } finally { await s.close(); }
  }, 90_000);

  // THE FIRST KEYSTROKE, which the two tests above both miss: they type a
  // comma before they ask, and the argument-slot hole was minted ONLY
  // after a comma. An empty bracket closed straight away emits `add()` —
  // a complete zero-argument call with no position between the parens —
  // so the cursor resolved to nothing and the answer was plain null, at
  // the exact moment the popup is most wanted. `items[` is the same
  // shape one bracket over.
  test('signature help at an EMPTY open call, and completion in an empty index', async () => {
    const s = await openSession({
      'first.rip': 'add = (a: number, b: number): number -> a + b\nitems: number[] = [1, 2]\n',
      'package.json': '{}\n',
    });
    try {
      s.open('first.rip');
      await s.diagnostics('first.rip');

      // Nothing typed yet between the parens.
      s.forget('first.rip');
      s.change('first.rip', 'add = (a: number, b: number): number -> a + b\nitems: number[] = [1, 2]\nr = add(\n');
      const broken = await s.diagnostics('first.rip');
      expect(broken.some((d) => /unclosed '\('/.test(d.message ?? ''))).toBe(true);
      const empty = await s.signatureHelp('first.rip', 2, 8, { tries: 2 });
      expect(empty?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');

      // A trailing space must not change the answer — the hole anchors
      // past intraline whitespace, so the cursor still lands on it.
      s.forget('first.rip');
      s.change('first.rip', 'add = (a: number, b: number): number -> a + b\nitems: number[] = [1, 2]\nr = add( \n');
      await s.diagnostics('first.rip');
      const spaced = await s.signatureHelp('first.rip', 2, 9, { tries: 2 });
      expect(spaced?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');

      // The index bracket takes the same hole, so a subscript being typed
      // still has a live position to complete from.
      s.forget('first.rip');
      s.change('first.rip', 'add = (a: number, b: number): number -> a + b\nitems: number[] = [1, 2]\nq = items[\n');
      const idx = await s.diagnostics('first.rip');
      expect(idx.some((d) => /unclosed '\['/.test(d.message ?? ''))).toBe(true);
      const labels = await s.completions('first.rip', 2, 10, { tries: 4 });
      expect(labels.length, 'the list is live').toBeGreaterThan(0);
    } finally { await s.close(); }
  }, 90_000);

  // A recovered face holds bytes the user never typed — the synthetic
  // closers and the zero-width holes. TypeScript reads them as ordinary
  // text and reports on them: `items.` becomes `items.;` and TS1003
  // "Identifier expected" lands on the `;`. That span maps to no exact
  // row, so the cover fallback used to widen it over the whole enclosing
  // construct and turn an untouched import statement red.
  //
  // Both halves are asserted together, because each is the other's
  // failure mode: silencing the invented error must not silence a REAL
  // one that happens to share the buffer. The type error below is on the
  // user's own bytes and maps exactly, so it survives; the TS1003 about
  // rip's synthesized semicolon does not.
  test('a recovered face drops TS errors about its own synthesized bytes, and keeps the real ones', async () => {
    const s = await openSession({
      'mix.rip': "items: number[] = [1, 2]\nbad: number = 'nope'\nk = 1\n",
      'package.json': '{}\n',
    });
    try {
      s.open('mix.rip');
      const settled = await s.diagnostics('mix.rip');
      // The real error is present BEFORE the incompleteness exists, so a
      // later absence can only be the recovery hiding it.
      expect(settled.some((d) => d.code === 2322), 'the type error is live to begin with').toBe(true);

      s.forget('mix.rip');
      s.change('mix.rip', "items: number[] = [1, 2]\nbad: number = 'nope'\nk = items.\n");
      const broken = await s.diagnostics('mix.rip');

      // Half one: rip still says the buffer is incomplete.
      expect(broken.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);

      // Half two: the REAL type error survives, on its own line.
      const real = broken.find((d) => d.code === 2322);
      expect(real, 'a real type error must outlive the incompleteness').toBeTruthy();
      expect(real.range.start.line).toBe(1);

      // Half three: nothing is painted over bytes the user did not touch.
      // The invented TS1003 covered line 0 through the incompleteness; no
      // diagnostic may span from the first line to the last any more.
      for (const d of broken) {
        expect(
          d.range.start.line === 0 && d.range.end.line >= 2,
          `a diagnostic spans the whole file: ${d.code ?? '-'} ${d.message}`,
        ).toBe(false);
      }
      expect(broken.some((d) => d.code === 1003), 'TS1003 is about rip\'s own synthesized byte').toBe(false);
    } finally { await s.close(); }
  }, 90_000);

  // NO BARRIER-FREE TEST LIVES HERE, and that is deliberate. Every
  // request in this file waits for a diagnostics publication first, which
  // is what makes these tests about the FACE. The other half of the
  // contract — a surface answering the buffer AS TYPED, inside the 100ms
  // didChange debounce — is arrival.test.js's charter, whose
  // `askWhileTyping` helper structurally prevents a barrier from sneaking
  // between the edit and the ask. The retyped-member-dot probe this file
  // once duplicated inline lives there ('completion, after a member dot
  // is retyped'); one enforcement point, so the no-barrier discipline
  // cannot drift in two places independently.

  test('a cross-file re-pull cannot wipe an incomplete buffer\'s own rejection', async () => {
    // sendDiagnostics REPLACES the set per URI, and editing doc B
    // re-pulls every OTHER open doc (repullOpenDocuments) — the only
    // path into repullDiagnostics. A tolerant lastGood satisfies every
    // repull guard (its source IS the incomplete buffer text), so a
    // repull publish that dropped the rip prefix would wipe A's
    // incompleteness squiggle while A is still incomplete.
    const s = await openSession({
      'a.rip': 'items: number[] = [1, 2, 3]\nx = items.\n',
      'b.rip': 'y = 1\nconsole.log y\n',
      'package.json': '{}\n',
    });
    try {
      s.open('a.rip');
      const before = await s.diagnostics('a.rip');
      expect(before.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);
      s.open('b.rip');
      await s.diagnostics('b.rip');
      // The trigger must be a didChange on another OPEN doc — a
      // watched-file touch never reaches the re-pull.
      s.forget('a.rip');
      s.change('b.rip', 'y = 2\nconsole.log y\n');
      const after = await s.diagnostics('a.rip');
      expect(after.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);
    } finally { await s.close(); }
  }, 90_000);

  test('a tolerant refresh never records a manifest entry for the holed face', async () => {
    // The mirror keeps the last good face during incompleteness — and the
    // manifest entry must describe THOSE bytes. An entry taken from the
    // recovered face names a codeHash the disk does not hold and persists
    // a keystroke in flight as sourceHash, so mirrorIntact would fail
    // for a perfectly good mirror.
    const s = await openSession({
      'app.rip': 'items: number[] = [1, 2, 3]\nx = items\n',
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      const manifestAt = path.join(s.dir, '.rip', 'editor', '.cache.json');
      const mirrorAt = path.join(s.dir, '.rip', 'editor', 'app.rip.ts');
      // The clean compile's entry lands after the debounced save — wait
      // for the state, not an interval.
      let cleanEntry = null;
      for (let i = 0; i < 200 && cleanEntry === null; i++) {
        try {
          const m = JSON.parse(fs.readFileSync(manifestAt, 'utf8'));
          const key = Object.keys(m.entries).find((k) => k.endsWith('app.rip'));
          if (key) cleanEntry = JSON.stringify(m.entries[key]);
        } catch { /* not saved yet */ }
        if (cleanEntry === null) await new Promise((r) => setTimeout(r, 25));
      }
      expect(cleanEntry, 'the clean compile recorded its entry').not.toBeNull();
      const cleanMirror = fs.readFileSync(mirrorAt, 'utf8');

      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\nx = items.\n');
      const broken = await s.diagnostics('app.rip');
      expect(broken.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);
      // Past the save debounce (500ms): anything the tolerant refresh
      // scheduled would be on disk by now. A bounded wait is the only
      // way to assert an absence of change.
      await new Promise((r) => setTimeout(r, 900));
      const m = JSON.parse(fs.readFileSync(manifestAt, 'utf8'));
      const key = Object.keys(m.entries).find((k) => k.endsWith('app.rip'));
      expect(JSON.stringify(m.entries[key])).toBe(cleanEntry);
      expect(fs.readFileSync(mirrorAt, 'utf8')).toBe(cleanMirror);
    } finally { await s.close(); }
  }, 90_000);
});
