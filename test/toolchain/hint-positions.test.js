// Hint-severity positions over LSP — the lane no other gate watches.
//
// Every audit dimension and `rip check` gate on `severity <= 2` by
// design (the fade classes are not type errors), so a Hint-severity
// diagnostic's POSITION is asserted nowhere else. TS80007 ("'await' has
// no effect …") is the resident: tsgo puts it on the `await` keyword,
// and every dammit spelling lowers to an `await` the source never
// spells, so the keyword's mapping decides what the author sees light
// up. The keyword's own row maps it to the `!` — the one character that
// means await — for the sugar spellings, and to the keyword itself for
// the author-spelled one.
//
// The controls carry the weight, in both directions. `fetchReal!` on a
// Promise-returning callee must publish NO 80007 — the hint is precise
// and the fix must never suppress it, so the positive hints beside it
// are the liveness that keeps that emptiness honest. And the
// author-spelled `await` must keep its own keyword span: a correction
// that bang-hunted every 80007 would satisfy the sugar rows and fail
// there.
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

const SRC = [
  'class Ticket',                                                    // line 0
  '  serial: number = 0',                                            // line 1
  '  constructor: (serial: number = 1) ->',                          // line 2
  '    @serial = serial',                                            // line 3
  '',                                                                // line 4
  'instant = new Ticket!',                                           // line 5  bang at col 20
  'numbered = new Ticket!(7)',                                       // line 6  bang at col 21
  'syncFn: () => number = -> 42',                                    // line 7 annotated: types line 8's read
  'got = syncFn!',                                                   // line 8  bang at col 12
  'fetchReal = -> Promise.resolve(7)',                               // line 9
  'good = fetchReal!',                                               // line 10 a real await — silent
  'plain: number = await 5',                                         // line 11 author-spelled, cols 16-21
  'console.log(instant.serial, numbered.serial, got, good, plain)',  // line 12
  '',
].join('\n');

describeExtended('hint positions — the await hint lands on the operator the author wrote', () => {
  test('every 80007 sits on its `!` or its `await`, and a real await draws none', async () => {
    const session = await openSession({ 'app.rip': SRC });
    try {
      session.open('app.rip');
      const ds = await session.diagnostics('app.rip', { settle: 600, timeout: 20000 });
      const hints = ds.filter((d) => d.code === 80007);
      expect(hints.length, 'the four synchronous awaits each draw the hint').toBe(4);
      // No Error-severity strays: the fixture is a legal program, so a
      // compile or type error here means the fixture drifted, not the hint.
      expect(ds.filter((d) => (d.severity ?? 1) <= 2)).toEqual([]);

      const spanOf = (line) => {
        const h = hints.find((d) => d.range.start.line === line);
        expect(h, `an 80007 on line ${line}`).toBeDefined();
        return [h.range.start.character, h.range.end.line, h.range.end.character];
      };
      // The three sugar spellings: exactly the bang, one character.
      expect(spanOf(5), 'new Ticket! — the bang').toEqual([20, 5, 21]);
      expect(spanOf(6), 'new Ticket!(7) — the bang').toEqual([21, 6, 22]);
      expect(spanOf(8), 'syncFn! — the bang').toEqual([12, 8, 13]);
      // The author-spelled control: the keyword itself, never bang-hunted.
      expect(spanOf(11), 'await 5 — the keyword').toEqual([16, 11, 21]);
      // The discriminating silence: awaiting a real Promise draws nothing.
      expect(hints.some((d) => d.range.start.line === 10), 'fetchReal! stays silent').toBe(false);
    } finally {
      await session.close();
    }
  }, 60000);
});
