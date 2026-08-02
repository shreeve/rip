// The audit's exit code, gated.
//
// `bun run audit` runs standalone — outside `test` and `test:all` — so nothing
// watches its exit code today. An exit code nobody observes is one that can
// stop working silently, which is exactly the failure this file exists to make
// impossible: it drives the contract's judgment directly, both directions, at
// unit speed. Driving the whole runner would cost the full probe pass and pull
// tsgo and the editor server into `bun test`, which is the arrangement the audit
// deliberately stays out of.
//
// What this does NOT test is whether each invariant reads its lane correctly —
// that is the runner's own wiring, and the audit run itself exercises it.

import { describe, expect, test } from 'bun:test';
import { CONTRACT, judge } from '../audit/contract.js';

// A red-by-agreement invariant carries its own reason, so the table under test
// IS the declaration — there is no second file to fall out of step with it.
// Both helpers start from a table tolerating NOTHING, so a case says exactly
// which reds are tolerated. Layering onto the shipped table instead would leave
// its real reasons in place, and a clean state would then report every one of
// them as recovered.
const withoutReds = () => CONTRACT.map(({ redBecause, ...c }) => c);
const withRed = (name, why) => withoutReds().map((c) => (c.name === name ? { ...c, redBecause: why } : c));

// Every predicate reads its lane's summary, so a clean state must carry every
// shape the predicates touch. Built fresh per test: a shared object mutated by
// one case would leak into the next.
const cleanStates = () => ({
  gr: { unallocated: 0, badExclusions: 0, negatives: { kindBad: 0, vocabUnfalsified: 0, claimsBroken: 0, cellsMissing: 0, staleMints: 0, headsUnseen: 0, badSpellingExclusions: 0, claimsBadParks: 0, splitDividers: 0 } },
  mp: { missing: 0, drifted: 0, census: 0, badExclusions: 0 },
  fails: 0,
  el: { problems: [] },
  hp: { gap: 0, snapChanged: 0, violations: [] },
  tk: { missing: [], badType: [], badReadonly: [], survDrops: [], facesAvailable: true },
});
const allRan = () => true;

describe('the audit contract judges in both directions', () => {
  test('a clean run with nothing tolerated passes, and judges every invariant', () => {
    const { verdicts, failures } = judge({ states: cleanStates(), ran: allRan, table: withoutReds() });
    expect(failures).toEqual([]);
    expect(verdicts).toHaveLength(CONTRACT.length);
    expect(verdicts.every((v) => v.state === 'green')).toBe(true);
  });

  test('an untolerated red FAILS — the regression signal', () => {
    const states = cleanStates();
    states.tk.badType = [{ name: 'Direction' }];
    const { failures } = judge({ states, ran: allRan, table: withoutReds() });
    expect(failures.map((f) => [f.name, f.state])).toEqual([['token.type', 'red-new']]);
  });

  test('a red carrying its reason PASSES, and reports that reason', () => {
    const states = cleanStates();
    states.tk.badType = [{ name: 'Direction' }];
    const { failures, verdicts } = judge({ states, ran: allRan, table: withRed('token.type', 'the server says type where the form fixes enum') });
    expect(failures).toEqual([]);
    const v = verdicts.find((x) => x.name === 'token.type');
    expect(v.state).toBe('red-expected');
    expect(v.redBecause).toBe('the server says type where the form fixes enum');
  });

  // The direction a one-directional baseline swallows, and the reason this is
  // not a baseline: the defect is FIXED, and the stale declaration would now
  // hide the next break in the same invariant.
  test('a tolerated red that now holds FAILS — the recovered signal', () => {
    const { failures } = judge({ states: cleanStates(), ran: allRan, table: withRed('token.type', 'fixed upstream, reason not yet deleted') });
    expect(failures.map((f) => [f.name, f.state])).toEqual([['token.type', 'recovered']]);
  });

  test('a lane that did not run is skipped, never assumed green', () => {
    const states = cleanStates();
    states.tk.badType = [{ name: 'Direction' }];
    const { verdicts, failures } = judge({ states, ran: (lane) => lane !== 'token', table: withoutReds() });
    expect(failures).toEqual([]);
    expect(verdicts.filter((v) => v.lane === 'token').every((v) => v.state === 'skipped')).toBe(true);
    expect(verdicts.find((v) => v.name === 'type.dimensions').state).toBe('green');
  });

  test('every red the contract can report is distinct and reachable', () => {
    // One predicate per invariant, each fired alone: a row whose predicate can
    // never fire is a contract clause that gates nothing, and a row that fires
    // when another's input changes would mask its neighbour.
    const fire = {
      'grammar.parses': (s) => { s.gr.unparsed = 1; },
      'grammar.allocation': (s) => { s.gr.unallocated = 1; },
      'grammar.exclusions': (s) => { s.gr.badExclusions = 1; },
      'lexer.mints': (s) => { s.gr.negatives.staleMints = 1; },
      'lexer.exclusions': (s) => { s.gr.negatives.badSpellingExclusions = 1; },
      'containment.heads': (s) => { s.gr.negatives.headsUnseen = 1; },
      'grammar.census': (s) => { s.gr.negatives.kindBad = 1; },
      'negatives.falsifiability': (s) => { s.gr.negatives.vocabUnfalsified = 1; },
      'claims.carriers': (s) => { s.gr.negatives.claimsBroken = 1; },
      'claims.parks': (s) => { s.gr.negatives.claimsBadParks = 1; },
      'corpus.dividers': (s) => { s.gr.negatives.splitDividers = 1; },
      'mapping.identity': (s) => { s.mp.drifted = 1; },
      'mapping.spans': (s) => { s.mp.missing = 1; },
      'mapping.census': (s) => { s.mp.census = 1; },
      'mapping.exclusions': (s) => { s.mp.badExclusions = 1; },
      'type.dimensions': (s) => { s.fails = 1; },
      'diagnostics.codes': (s) => { s.el.problems = [{ kind: 'missing' }]; },
      'diagnostics.positions': (s) => { s.el.problems = [{ kind: 'position', file: '09-classes.errors.rip' }]; },
      'diagnostics.positions.element': (s) => { s.el.problems = [{ kind: 'position', file: '11-types.errors.rip' }]; },
      'diagnostics.positions.arity': (s) => { s.el.problems = [{ kind: 'position', file: '02-operations.errors.rip' }]; },
      'hover.parity': (s) => { s.hp.gap = 1; },
      'token.delivery': (s) => { s.tk.missing = [{}]; },
      'token.type': (s) => { s.tk.badType = [{ want: { type: 'variable' } }]; },
      'token.type.enum': (s) => { s.tk.badType = [{ want: { type: 'enum' } }]; },
      'token.readonly': (s) => { s.tk.badReadonly = [{}]; },
      'token.delivery.use-site': (s) => { s.tk.survDrops = [{ name: 'x', count: 1 }]; },
    };
    expect(Object.keys(fire).sort()).toEqual(CONTRACT.map((c) => c.name).sort());
    for (const [name, seed] of Object.entries(fire)) {
      const states = cleanStates();
      seed(states);
      const { failures } = judge({ states, ran: allRan, table: withoutReds() });
      expect(failures.map((f) => f.name), `${name} alone must redden ${name} and nothing else`).toEqual([name]);
    }
  });
});

// Every tolerated red must say WHY, in prose. A row number dangles the day the
// row closes; the prose does not. The set is allowed to be EMPTY, and is today
// — every invariant holds — so this asserts the SHAPE of whatever is in it
// rather than that anything is: the next agreement still has to arrive with a
// reason a reader can act on, and the check has to be here when it does.
test('every red the contract tolerates carries a prose reason, not a row number', () => {
  for (const { name, redBecause } of CONTRACT.filter((c) => c.redBecause)) {
    expect(redBecause.length > 40, `"${name}" needs a reason a reader can act on`).toBe(true);
    expect(/(finding|findings)\s*#\d+/i.test(redBecause), `"${name}" cites a ledger row by number — state the reason instead`).toBe(false);
  }
});
