// THE CONTRACT — which of the audit's own findings GATE, and which are red by
// agreement.
//
// The audit is a scoreboard, and most of what it prints is a GAUGE: a queue
// whose non-zero size is work remaining, not a regression. Uncovered
// productions, unclaimed census kinds, ruled-uncarried claims rows, the mapping
// census, the token member and use-site clauses — every one of those is
// expected non-zero today and says so in its own line. None of them appear
// below, and that is the point: a gauge that gated would fail forever.
//
// What DOES gate is an INVARIANT: a property that holds, or else something
// broke. Each row below names one, states it as the property (never as its
// failure), and reads it off the lane's own summary object. A lane that did not
// run cannot judge its rows, so those are skipped rather than assumed green — a
// `--type` run knows nothing about hover.
//
// An invariant carrying `redBecause` is RED BY AGREEMENT: the toolchain is
// wrong, the wrongness is filed and understood, and the audit is not permitted
// to be green about it. The reason sits on the invariant itself — the same shape
// as the gate's EXCLUDED tables, and for the same reason: a declaration in a
// separate file can name an invariant that no longer exists, while a field
// cannot. It is PROSE, never a ledger row's number, which would dangle the day
// the row closes.
//
// The check runs in BOTH directions. A red invariant with no `redBecause` is a
// regression. An invariant WITH one that has gone green is equally a failure,
// and the more valuable signal: the defect is fixed, and the reason is now a lie
// that would mask the next regression in the same invariant. A one-directional
// baseline swallows exactly that, which is why this is not a baseline.
//
// Note what is NOT here: counts. `redBecause` says THAT an invariant is red,
// never by how much — a count would need updating whenever the corpus grew, and
// a stale one reads as certified. The lane's own line reports the magnitude.

export const CONTRACT = [
  {
    // The gate's floor, and the one thing every number above it assumes. A
    // parse error is RETURNED by the generated parser rather than thrown, so
    // an unparsable fixture is not a loud crash — it is a quiet row, and its
    // partial reductions would otherwise stand as coverage.
    name: 'grammar.parses', lane: 'grammar',
    property: 'every fixture in the corpus parses — coverage is measured only over programs the parser accepts',
    red: (s) => (s.gr.unparsed ?? 0) > 0,
  },
  {
    name: 'grammar.allocation', lane: 'grammar',
    property: 'every construct and production the grammar defines is allocated by the manifest',
    red: (s) => s.gr.unallocated > 0,
  },
  {
    name: 'grammar.exclusions', lane: 'grammar',
    property: "the gate's exclusion tables name only live spellings that remain unreachable",
    red: (s) => s.gr.badExclusions > 0,
  },
  {
    // The alias half of the spelling census needs no invariant: it is read from
    // the lexer's own table, so it cannot fall out of step. The curated mints
    // can, and a row that no longer describes the lexer measures nothing.
    name: 'lexer.mints', lane: 'grammar',
    property: "every hand-listed spelling is still produced by the lexer, driven by its own probe",
    red: (s) => (s.gr.negatives?.staleMints ?? 0) > 0,
  },
  {
    // The alias table is read live, so it cannot rot — but the rulings netted
    // out of it can, in both directions: a spelling excluded as redundant that
    // the corpus nonetheless writes, and an exclusion naming a spelling the
    // lexer stopped rewriting.
    name: 'lexer.exclusions', lane: 'grammar',
    property: 'every excluded spelling is still rewritten by the lexer and still unwritten by the corpus',
    red: (s) => (s.gr.negatives?.badSpellingExclusions ?? 0) > 0,
  },
  {
    // The containment matrix is bounded by its curated head list, so an
    // entry nothing spells makes the matrix advertise cells no fixture could
    // ever satisfy. Invariant, not a queue: unreachable heads and untested
    // ones both resolve by a decision, and neither is drained by authoring
    // against the cell.
    name: 'containment.heads', lane: 'grammar',
    property: 'every curated containment construct is spelled by at least one fixture, so every pair a claim can name is satisfiable',
    red: (s) => (s.gr.negatives?.headsUnseen ?? 0) > 0,
  },
  {
    // A park is a claim that a defect — not an absence of effort — is why a
    // row is uncarried. It expires in one direction only: the row becomes
    // carried, at which point the park is the stale thing. Left unpoliced it
    // would quietly shrink the queue forever, which is the one way this
    // bookkeeping could lie about how much work is left.
    name: 'claims.parks', lane: 'grammar',
    property: 'every parked claim names a live Behaviors row that is still uncarried',
    red: (s) => (s.gr.negatives?.claimsBadParks ?? 0) > 0,
  },
  {
    // The corpus's one comment rule, and the only half of it that is exactly
    // checkable: a `── … ──` divider opens and closes on the same line. No
    // threshold, no heuristic, and the fix is always joining the lines —
    // never deleting a note, which is why the header LENGTH beside it is
    // reported as a gauge instead of gated here.
    name: 'corpus.dividers', lane: 'grammar',
    property: 'every corpus section divider opens and closes on its own line, so no comment is a reflowed paragraph',
    red: (s) => (s.gr.negatives?.splitDividers ?? 0) > 0,
  },
  {
    name: 'grammar.census', lane: 'grammar',
    property: "every type text the corpus carries classifies against TypeScript's own type grammar",
    red: (s) => (s.gr.negatives?.kindBad ?? 0) > 0,
  },
  {
    name: 'negatives.falsifiability', lane: 'grammar',
    property: 'every type-vocabulary class the positives claim carries at least one error-lane instance',
    red: (s) => (s.gr.negatives?.vocabUnfalsified ?? 0) > 0,
  },
  {
    name: 'claims.carriers', lane: 'grammar',
    property: 'every ruled CLAIMS.md row still points at a fixture and symbol that exist in the corpus',
    red: (s) => ((s.gr.negatives?.claimsBroken ?? 0) + (s.gr.negatives?.cellsMissing ?? 0)) > 0,
  },
  {
    // The one thing byte-equality cannot check. `placed` and `text` both pass
    // for a read that resolves onto a DIFFERENT occurrence of its own name;
    // mapping back through the editor's own reverse direction is what
    // distinguishes them. Expected zero — unlike its two neighbours, which
    // count the open mapping gap — so any count is a defect never seen.
    name: 'mapping.identity', lane: 'map',
    property: 'every resolved read maps back to a source span containing the read it came from',
    red: (s) => (s.mp.drifted ?? 0) > 0,
  },
  {
    name: 'mapping.spans', lane: 'map',
    property: 'every flagged read sits inside a mapping row the compiler emitted',
    red: (s) => s.mp.missing > 0,
  },
  {
    name: 'type.dimensions', lane: 'main',
    property: 'every dimension check passes — compiles, verdict, runtime, twin, strict',
    red: (s) => s.fails > 0,
  },
  {
    name: 'diagnostics.codes', lane: 'errors',
    property: 'every diagnostic the twin publishes is published by the fixture, and none besides',
    red: (s) => s.el.problems.some((p) => p.kind !== 'position'),
  },
  {
    name: 'diagnostics.positions', lane: 'errors',
    property: 'every diagnostic lands on the span its twin puts it on',
    // TWO open causes share this red, and it does not clear until both do —
    // naming only one would strand the other the day that one closes, leaving
    // a red nothing explains. Both are the same root (a read inside a cover
    // row resolves to the cover's edge, not its own span) on two list shapes.
    redBecause: "a rewritten literal earlier in an element list widens its neighbours' diagnostics to the whole list rather than the offending element, so 11-types' wrong-element rows land wide — their single-quoted leading literal is load-bearing, and double-quoting them would narrow the span without fixing anything; AND a paren-injected call's arity error lands on the first argument rather than the excess one, so 02-operations' paren-less arity row lands early — its paren-less spelling is load-bearing, and parenthesizing it would position correctly while testing nothing. Delete each clause only when its span lands on the offending element/argument",
    red: (s) => s.el.problems.some((p) => p.kind === 'position'),
  },
  {
    name: 'hover.parity', lane: 'hover',
    property: 'hover answers what the twin answers, and every pinned answer is unchanged',
    red: (s) => s.hp.gap > 0 || s.hp.snapChanged > 0 || s.hp.violations.length > 0,
  },
  {
    name: 'token.delivery', lane: 'token',
    property: 'the server delivers a semantic token for every probed declaration',
    red: (s) => s.tk.missing.length > 0,
  },
  {
    name: 'token.type', lane: 'token',
    property: "each declaration's token type is the one its binding form fixes",
    // TWO open rows share this red, and it does not clear until both do:
    // the enum names, and the void-marked binding whose hoist-split declaration
    // hides its function value. Naming only one would strand the other the day
    // that one closes — the shape the ledger warns about, since a reader
    // deleting a satisfied reason would leave a red nothing explains.
    redBecause: 'an enum name\'s token says `type` where its declaring form fixes `enum`, and a void-marked binding says `variable` where its arrow fixes `function` — delete this when the server classifies enum declarations by their own form AND the void lowering stops splitting its declaration',
    red: (s) => s.tk.badType.length > 0,
  },
  {
    name: 'token.readonly', lane: 'token',
    property: "the readonly modifier follows the binding form, at declarations and at writes",
    redBecause: 'a state write site keeps the readonly modifier its declaration carries, so writes to reactive state paint unwritable — delete this when the correction reaches use-site spans',
    red: (s) => s.tk.badReadonly.length > 0,
  },
];

// Judge the run. `states` carries the lane summaries, `ran` answers whether a
// lane ran. Returns one verdict per invariant plus the failures, so the caller
// prints and the exit code follows from the same computation — no second site
// can disagree about whether the run passed.
export const judge = ({ states, ran, table = CONTRACT }) => {
  const verdicts = table.map((c) => {
    if (!ran(c.lane)) return { ...c, state: 'skipped' };
    const isRed = c.red(states);
    return {
      ...c,
      state: isRed
        ? (c.redBecause ? 'red-expected' : 'red-new')
        : (c.redBecause ? 'recovered' : 'green'),
    };
  });
  return {
    verdicts,
    // `recovered` fails on purpose: the invariant holds again, so its
    // `redBecause` must go or it hides the next break in the same property.
    failures: verdicts.filter((v) => v.state === 'red-new' || v.state === 'recovered'),
  };
};
