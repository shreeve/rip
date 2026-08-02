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
});
