// The cast scanner's stop list, gated against the grammar.
//
// rewriteTypes collapses `expr as Type` by collecting tokens until a depth-0
// stop, and the stop list (CAST_STOPS) is hand-maintained while the grammar
// is not. A production that places a new terminal after an Expression — an
// inline `finally`, a `=~` — makes that terminal reachable directly behind a
// cast, and a terminal the list does not stop at is absorbed into the type
// string, which type erasure then deletes. That failure is SILENT: the file
// parses, runs, and is simply missing code. So the list is gated the way the
// audit gates its exclusion table — derived from the artifact, not recalled:
// every terminal the generated parser table can accept after an Expression
// must either end a cast's type run or sit in the named continuation list
// below. A new clause keyword or operator fails here at unit speed until the
// scanner is taught where its type text ends.
//
// The derivation walks the LALR table: each state's GOTO on Expression names
// the state the parser lands in after reducing one, and that target state's
// terminal actions are exactly the tokens legal in the next position.

import { expect, test } from 'bun:test';
import { CAST_STOPS, RUN_CLOSERS, RUN_STOPS } from '../../src/types.js';
import { parser } from '../../src/parser.js';

// Terminals that legitimately CONTINUE a cast's type run at depth 0, each
// with its reason. Anything else must stop the run — absorbing a terminal
// into type text is a decision made here, never a default.
const CONTINUATIONS = new Map([
  ['|', 'the union type operator — `x as A | B` reads `x as (A | B)`, as in TS'],
  ['&', 'the intersection type operator, same reading'],
  ['CAST', 'a chained cast (`x as A as B`) collapses one cast at a time'],
  ['$end', 'end of input — the collector stops by exhaustion'],
]);

// The type collapse runs before the rewriter's postfix retag, so the
// table's POST_* spellings answer for their pre-rewrite kinds.
const PRE_REWRITE = { POST_IF: 'IF', POST_UNLESS: 'UNLESS' };

// Literal-context closers end every run unconditionally in the collector:
// their openers cannot appear inside a type, so the closer belongs to the
// construct around the cast.
const LITERAL_ENDS = new Set(['INTERPOLATION_END', 'STRING_END', 'HEREGEX_END']);

test('every terminal the parser allows after an Expression ends a cast type run or is a named continuation', () => {
  const { symbolIds, tokenNames, parseTable } = parser;
  const follow = new Set();
  for (const state of parseTable) {
    const target = state?.[symbolIds.Expression];
    if (target === undefined || !parseTable[target]) continue;
    for (const id of Object.keys(parseTable[target])) {
      const name = tokenNames[id];
      if (name !== undefined) follow.add(PRE_REWRITE[name] ?? name);
    }
  }
  // Derivation sanity: an empty or shrunken walk gates nothing. The set held
  // 40+ terminals when this was written; a table restructure that breaks the
  // walk must fail here, not pass vacuously.
  expect(follow.size).toBeGreaterThan(20);

  const unhandled = [...follow]
    .filter((t) => !CAST_STOPS.has(t) && !RUN_STOPS.has(t) && !RUN_CLOSERS.has(t)
      && !LITERAL_ENDS.has(t) && !CONTINUATIONS.has(t))
    .sort();
  expect(unhandled).toEqual([]);
});
