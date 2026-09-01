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
  gr: { unparsed: 0, uncovered: 0, badExclusions: 0, negatives: { kindBad: 0, vocabUnfalsified: 0, famZero: 0, darkSpellings: 0, kindQueued: 0, kindHeld: 0, claimsAbsent: 0, claimsBroken: 0, cellsMissing: 0, staleMints: 0, headsUnseen: 0, badSpellingExclusions: 0, claimsBadParks: 0, splitDividers: 0 } },
  mp: { missing: 0, drifted: 0, census: 0, decompositionDrift: 0, badExclusions: 0 },
  fails: 0,
  el: { problems: [] },
  gl: { held: 1, published: 1, problems: [] },
  hp: { gap: 0, snapChanged: 0, violations: [], silentLeaks: 0, ruledDiverging: 0, stalePinKeys: [], ruledPopulation: 1, untyped: 0 },
  tk: { missing: [], badType: [], badReadonly: [], survDrops: [], survUnclassified: 0, unexplained: [], exclusionDrift: [], facesAvailable: true },
  sw: { machinery: 0, census: 0, misdirection: 0 },
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

  // The claims registry is the one grammar-lane input that can be ABSENT
  // (CLAIMS.md is a file); `claimsAbsent` is set only by a successful read, so
  // its absence must SKIP the claims rows — an unread registry judging its
  // rows green is exactly the vacuous pass the face-oracle skip exists to
  // prevent.
  test('an unread claims registry skips the claims rows, never greens them', () => {
    const states = cleanStates();
    delete states.gr.negatives.claimsAbsent;
    delete states.gr.negatives.claimsBroken;
    delete states.gr.negatives.cellsMissing;
    delete states.gr.negatives.claimsBadParks;
    const { verdicts, failures, drift } = judge({ states, ran: allRan, table: withoutReds() });
    expect(failures).toEqual([]);
    expect(drift.size).toBe(0);
    for (const name of ['claims.carriers', 'claims.parks', 'claims.carriage']) {
      expect(verdicts.find((v) => v.name === name).state).toBe('skipped');
    }
  });

  // The seam the synthetic states cannot police by construction: a summary
  // field renamed in the runner turns its invariant vacuously green, and this
  // suite would stay green with it — both sides here are built from the
  // contract's own names. So judge() itself records every read of a field no
  // summary carries, and the caller refuses on any.
  test('a predicate reading a field no summary carries reports drift, never a vacuous green', () => {
    const states = cleanStates();
    delete states.tk.survUnclassified;
    const { drift } = judge({ states, ran: allRan, table: withoutReds() });
    expect([...drift]).toEqual(['tk.survUnclassified']);
  });

  test('a clean run reports no drift', () => {
    const { drift } = judge({ states: cleanStates(), ran: allRan, table: withoutReds() });
    expect(drift.size).toBe(0);
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
      'grammar.coverage': (s) => { s.gr.uncovered = 1; },
      'grammar.exclusions': (s) => { s.gr.badExclusions = 1; },
      'lexer.mints': (s) => { s.gr.negatives.staleMints = 1; },
      'lexer.exclusions': (s) => { s.gr.negatives.badSpellingExclusions = 1; },
      'containment.heads': (s) => { s.gr.negatives.headsUnseen = 1; },
      'grammar.census': (s) => { s.gr.negatives.kindBad = 1; },
      'grammar.census.claimed': (s) => { s.gr.negatives.kindQueued = 1; },
      'negatives.falsifiability': (s) => { s.gr.negatives.vocabUnfalsified = 1; },
      'negatives.families': (s) => { s.gr.negatives.famZero = 1; },
      'lexer.written': (s) => { s.gr.negatives.darkSpellings = 1; },
      'claims.carriers': (s) => { s.gr.negatives.claimsBroken = 1; },
      'claims.parks': (s) => { s.gr.negatives.claimsBadParks = 1; },
      'claims.carriage': (s) => { s.gr.negatives.claimsAbsent = 1; },
      'corpus.dividers': (s) => { s.gr.negatives.splitDividers = 1; },
      'mapping.identity': (s) => { s.mp.drifted = 1; },
      'mapping.spans': (s) => { s.mp.missing = 1; },
      'mapping.census': (s) => { s.mp.census = 1; },
      'mapping.decomposition': (s) => { s.mp.decompositionDrift = 1; },
      'mapping.exclusions': (s) => { s.mp.badExclusions = 1; },
      'type.dimensions': (s) => { s.fails = 1; },
      'diagnostics.codes': (s) => { s.el.problems = [{ kind: 'missing' }]; },
      'diagnostics.positions': (s) => { s.el.problems = [{ kind: 'position', file: '09-classes.errors.rip' }]; },
      'diagnostics.positions.element': (s) => { s.el.problems = [{ kind: 'position', file: '11-types.errors.rip' }]; },
      'diagnostics.positions.arity': (s) => { s.el.problems = [{ kind: 'position', file: '02-operations.errors.rip' }]; },
      'gradual.held': (s) => { s.gl.problems = [{ kind: 'leak', file: 'held.rip' }]; },
      'gradual.published': (s) => { s.gl.problems = [{ kind: 'missing', file: 'published.rip' }]; },
      'hover.parity': (s) => { s.hp.gap = 1; },
      'hover.typed': (s) => { s.hp.untyped = 1; },
      'hover.silence': (s) => { s.hp.silentLeaks = 1; },
      'hover.ruled': (s) => { s.hp.ruledDiverging = 1; },
      'hover.pins': (s) => { s.hp.stalePinKeys = ['gone.rip']; },
      'hover.ruled.population': (s) => { s.hp.ruledPopulation = 0; },
      'token.delivery': (s) => { s.tk.missing = [{}]; },
      'token.type': (s) => { s.tk.badType = [{ want: { type: 'variable' } }]; },
      'token.type.enum': (s) => { s.tk.badType = [{ want: { type: 'enum' } }]; },
      'token.readonly': (s) => { s.tk.badReadonly = [{}]; },
      'token.delivery.use-site': (s) => { s.tk.survDrops = [{ name: 'x', count: 1 }]; },
      'token.delivery.oracle': (s) => { s.tk.survUnclassified = 1; },
      'token.delivery.explained': (s) => { s.tk.unexplained = [{ file: 'x.rip', line: 1, character: 0, name: 'x' }]; },
      'token.delivery.excused': (s) => { s.tk.exclusionDrift = [{ file: 'x.rip', key: '1:0:x' }]; },
      'sweep.machinery': (s) => { s.sw.machinery = 1; },
      'sweep.census': (s) => { s.sw.census = 1; },
      'sweep.misdirection': (s) => { s.sw.misdirection = 1; },
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
