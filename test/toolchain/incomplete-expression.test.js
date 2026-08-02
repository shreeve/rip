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
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

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

  // THE ONE TEST IN THIS FILE WITH NO BARRIER, and it is deliberate.
  // Every other request here waits for a diagnostics publication first,
  // which is what makes those tests about the FACE. An editor does not
  // wait: the popup fires on the keystroke. The server coalesces
  // didChange for 100ms, and inside that window completion used to
  // answer from the face of the PREVIOUS text.
  //
  // Retyping a member dot is the case that exposes it, because deleting
  // the dot leaves a buffer that compiles CLEAN — so the stale face is
  // not merely old, it has plain statement context at the cursor and
  // answers with the entire global scope. A thousand-item list where
  // thirty-four members belong is the original finding's symptom, and it
  // survived the tolerant face by hiding in the debounce.
  //
  // The assertion is deliberately made at zero delay. Sleeping first
  // would restore the barrier by another name and the gate would pass
  // against the bug.
  test('completion answers the CURRENT buffer inside the debounce window', async () => {
    const s = await openSession({
      'race.rip': 'items: number[] = [1, 2, 3]\na = items.\n',
      'package.json': '{}\n',
    });
    try {
      s.open('race.rip');
      await s.diagnostics('race.rip');

      // Delete the dot: this buffer is VALID, so the face that lands has
      // no member access at the cursor at all.
      s.change('race.rip', 'items: number[] = [1, 2, 3]\na = items\n');
      await s.diagnostics('race.rip');

      // Retype it and ask AT ONCE — no forget(), no diagnostics await.
      s.change('race.rip', 'items: number[] = [1, 2, 3]\na = items.\n');
      const r = await s.request('textDocument/completion', {
        textDocument: { uri: s.uri('race.rip') },
        position: { line: 1, character: 10 },
      });
      const labels = (r?.items ?? r ?? []).map((i) => i.label);

      expect(labels.length, 'the list is live').toBeGreaterThan(0);
      expect(labels).toContain('map');
      expect(labels).toContain('filter');
      // The stale answer was the global scope — a thousand-odd names. Any
      // list that large is the wrong one however many members it contains.
      expect(labels.length, 'the receiver\'s members, not the global scope').toBeLessThan(100);
    } finally { await s.close(); }
  }, 90_000);
});
