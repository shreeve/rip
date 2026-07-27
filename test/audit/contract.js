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
    property: "every curated mint spelling is still minted by the lexer, driven by its own probe",
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
    property: 'every curated containment head is spelled by at least one fixture, so every cell the matrix can name is satisfiable',
    red: (s) => (s.gr.negatives?.headsUnseen ?? 0) > 0,
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
    property: 'every ruled CLAIMS.md row names a carrier that still exists in the corpus',
    red: (s) => ((s.gr.negatives?.claimsBroken ?? 0) + (s.gr.negatives?.cellsMissing ?? 0)) > 0,
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
    redBecause: "a tuple element's diagnostic is positioned on the whole element list rather than the offending element, so 11-types' wrong-element rows land wide — delete this when the span narrows to the element",
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
    redBecause: 'an enum name\'s token says `type` where its declaring form fixes `enum` — delete this when the server classifies enum declarations by their own form',
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
