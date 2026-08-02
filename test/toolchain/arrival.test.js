// ARRIVAL, not content: does a read surface answer about the buffer as it
// is RIGHT NOW, or about the text of a moment ago?
//
// Every other LSP gate in this repo waits for a diagnostics publication
// before it asks. That barrier is deliberate and correct — it is what makes
// those tests assertions about what a FACE CONTAINS. It also makes the whole
// suite blind to a second failure mode, because the server coalesces
// didChange for 100ms and a barriered request always lands after the window:
// a surface can answer correctly about the previous text and no barriered
// test can tell.
//
// That blindness was not theoretical. Every gap in the incomplete-expression
// work was found by driving the editor by hand, and the last of them —
// completion serving the entire global scope after a member dot was retyped —
// was that work's original symptom, fixed in the face and still reaching the
// user through the delay.
//
// So this file exists to hold the OTHER half of the contract, and its rule is
// one line: no barriers. Each test settles once, edits, and asks in the same
// tick through `askWhileTyping`. Adding a sleep or a diagnostics() call to
// anything here silently converts it back into a content test.
//
// A surface belongs here when a stale answer is WRONG rather than merely
// old. Position-identifying surfaces (definition, references) are absent on
// purpose: `staleOffsetMap` re-aligns coordinates against the last good face,
// so those answer correctly from a stale face by design. A TYPE cannot be
// re-aligned, and a completion list computed for different text is not a list
// of anything.
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

describeExtended('a read surface answers the buffer being typed', () => {
  // Retyping a member dot: the buffer WITHOUT the dot compiles clean, so the
  // stale face does not merely lag — it has plain statement context at the
  // cursor and answers with every name in scope.
  test('completion, after a member dot is retyped', async () => {
    const s = await openSession({
      'app.rip': 'items: number[] = [1, 2, 3]\na = items.\n',
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\na = items\n');
      await s.diagnostics('app.rip');

      const r = await s.askWhileTyping(
        'app.rip', 'items: number[] = [1, 2, 3]\na = items.\n',
        'textDocument/completion', { position: { line: 1, character: 10 } },
      );
      const labels = (r?.items ?? r ?? []).map((i) => i.label);
      expect(labels.length, 'the list is live').toBeGreaterThan(0);
      expect(labels).toContain('map');
      expect(labels.length, 'the receiver\'s members, not the global scope').toBeLessThan(100);
    } finally { await s.close(); }
  }, 90_000);

  // A type cannot be re-aligned the way a position can, so a stale hover is
  // simply the wrong type stated without hedging — the worst shape a wrong
  // answer takes, per this repo's own ordering of harm.
  test('hover, after the annotation changes', async () => {
    const s = await openSession({
      'app.rip': 'alpha: number = 1\nk = alpha\n',
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');

      const h = await s.askWhileTyping(
        'app.rip', 'alpha: string = "s"\nk = alpha\n',
        'textDocument/hover', { position: { line: 1, character: 5 } },
      );
      const text = JSON.stringify(h?.contents ?? null);
      expect(text, 'hover answered at all').not.toBe('null');
      expect(text, 'the CURRENT annotation').toContain('string');
      expect(text, 'not the previous one').not.toContain('number');
    } finally { await s.close(); }
  }, 90_000);

  // Signature help has no statement-context fallback, so a stale face here
  // shows up as plain null rather than a wrong list — quieter, and just as
  // wrong at the moment the popup is wanted.
  test('signature help, after the call is reopened', async () => {
    const s = await openSession({
      'app.rip': 'add = (a: number, b: number): number -> a + b\nr = add(1, 2)\n',
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');

      const r = await s.askWhileTyping(
        'app.rip', 'add = (a: number, b: number): number -> a + b\nr = add(1, \n',
        'textDocument/signatureHelp', { position: { line: 1, character: 11 } },
      );
      expect(r?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');
      expect(r?.activeParameter ?? r?.signatures?.[0]?.activeParameter).toBe(1);
    } finally { await s.close(); }
  }, 90_000);
});
