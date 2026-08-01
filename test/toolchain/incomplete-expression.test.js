// Completion and signature help on an INCOMPLETE expression: the broker
// builds its TypeScript face from a successful compile, so it can serve a
// request only where the source parses — and the two features whose trigger
// is an incomplete expression fire precisely where it does not. Type a
// member-access dot and pause (`items.`), or sit inside an open call
// (`add(`), and the buffer no longer parses: no face carries the context,
// and the request has nothing to map into. Completion falls back to the
// LAST GOOD face's statement context (a scope list, no members); signature
// help has no fallback at all and answers plain null. Both work only once
// the expression is complete enough to parse — backwards from how the
// features are used.
//
// This is an OPEN gap, so these tests assert the current, wrong behavior on
// purpose — and say so. The day the parse gap closes (an error-tolerant
// face, or a fixup at the cursor), the `not.toContain` and the null
// assertion go red: that is the cue to invert both tests and close the
// finding, not a regression. Deliberately NOT `test.failing`: under it any
// throw counts as a pass, so a dead server would read as fixed. Every gap
// assertion below is therefore preceded, in the same session, by the
// PARSEABLE form of the same request answering correctly — an empty or null
// answer can only ever follow a proven-live surface.
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

describeExtended('completion and signature help on an incomplete expression', () => {
  // The answer at the dot is whatever the LAST GOOD face held at that
  // position, not the current buffer's member-access context — which is the
  // gap. The sequence below is the interactive one: a good compile of the
  // dotless statement, then the dot typed. The stale face has plain
  // statement context there, so the server serves the in-scope identifier
  // list, no members. (Order matters: a prior good compile that already
  // carried `items.map` at the position would serve members off the STALE
  // face — same mechanism, luckier answer — so the liveness step runs
  // AFTER the gap probe, never before.)
  //
  // EVERY request follows a publication BARRIER — forget(), then edit, then
  // await diagnostics — because the server debounces didChange (100ms) and
  // then compiles and round-trips to tsgo, while onCompletion answers from
  // the last good face without compiling. Without it every answer here races
  // that refresh, and `completions()` returning the first NON-EMPTY list is
  // only a partial guard: it filters an empty answer, not a plausible stale
  // one. What keeps the stale answer empty in THIS sequence is arithmetic
  // rather than luck — typing a dot at end of line puts the cursor exactly
  // one character past the stale line's end, whatever the binding is named,
  // so the stale face cannot resolve it (driven: the same fixture renamed
  // and re-columned behaves identically). The barrier is what makes that
  // reasoning unnecessary: each answer below is the server's settled one,
  // which is what the assertions are about.
  test('member completion at a bare dot serves the stale scope list, not members (the open gap)', async () => {
    const s = await openSession({
      'app.rip': 'items: number[] = [1, 2, 3]\nx = items\n',
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');

      // The gap: the dot just typed, buffer unparseable — the stale scope
      // list answers, members absent. When member completion works here,
      // `not.toContain` goes red: invert it.
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\nx = items.\n');
      const broken = await s.diagnostics('app.rip');
      // The barrier doubles as the mechanism's premise, asserted rather than
      // assumed: the trigger byte is the byte that breaks the parse, which is
      // why no face carries the member-access context.
      expect(broken.some((d) => /Unexpected end of input/.test(d.message ?? ''))).toBe(true);

      const atDot = await s.completions('app.rip', 1, 10);      // right after the dot
      expect(atDot.length).toBeGreaterThan(0);   // live — an empty list would satisfy not.toContain for free
      expect(atDot).toContain('items');          // the statement-context scope list
      expect(atDot).not.toContain('map');

      // Liveness, and the target: complete the expression so it parses, and
      // the same position serves the real member list.
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\nx = items.map\n');
      await s.diagnostics('app.rip');
      const parseable = await s.completions('app.rip', 1, 10);
      expect(parseable).toContain('map');
      expect(parseable).toContain('filter');
    } finally { await s.close(); }
  }, 90_000);

  // Signature help is the harsher surface: no statement-context fallback, so
  // every open-paren state answers plain null — including the common
  // interactive case, a call that WAS valid and is now mid-edit. It answers
  // only on the closed call, exactly when it is no longer needed.
  test('signature help inside an open call serves null (the open gap)', async () => {
    const s = await openSession({
      'sig.rip': 'add = (a: number, b: number): number -> a + b\nr = add(1, 2)\nconsole.log r\n',
      'package.json': '{}\n',
    });
    try {
      s.open('sig.rip');
      await s.diagnostics('sig.rip');

      // Liveness: the closed call answers, with the right active parameter.
      const closed = await s.signatureHelp('sig.rip', 1, 11);    // inside the 2nd argument
      expect(closed?.signatures?.[0]?.label).toContain('add(a: number, b: number): number');
      expect(closed?.activeParameter ?? closed?.signatures?.[0]?.activeParameter).toBe(1);

      // The gap: backspaced to the open call — null, prior good compile or
      // not. When help resolves here, this assertion goes red: invert it.
      //
      // The publication BARRIER is what makes a short poll budget sound, and
      // it is load-bearing in the direction that matters: this assertion
      // expects NULL, and null is also what a server that has not finished
      // refreshing answers — so a bare short budget would report the gap
      // intact against a server that had just gained the staleness fallback
      // and needed a moment to resolve the call, a gate silently passing
      // after the behavior it watches changed. Awaiting the republication
      // first means the refresh is done and the answer below is the server's
      // final one, not a transient.
      s.forget('sig.rip');
      s.change('sig.rip', 'add = (a: number, b: number): number -> a + b\nr = add(1, \nconsole.log r\n');
      await s.diagnostics('sig.rip');
      const open = await s.signatureHelp('sig.rip', 1, 11, { tries: 2 });
      expect(open).toBeNull();
    } finally { await s.close(); }
  }, 90_000);
});
