// THE CONTRACT — which of the audit's own findings GATE, and which are red by
// agreement.
//
// The audit is a scoreboard, and part of what it prints is a GAUGE: a number
// whose size is work remaining or texture, not a regression. The per-family
// negative fractions, the containment pair count, the header-length number,
// kinds held by open findings, claims rows parked on them — each is expected
// non-zero or unbounded and says so in its own line. None of them appear
// below, and that is the point: a gauge that gated would fail forever.
// A gauge whose queue DRAINS graduates: grammar coverage, the mapping census,
// and the token use-site clause each gated at zero the day their queue hit
// the bottom, and the family-negative, dark-spelling, census-kind,
// claims-carriage, and typed-hover queues followed when the corpus drained
// them, because from that day a nonzero count is a regression.
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
    red: (s) => s.gr.unparsed > 0,
  },
  {
    // Graduated from the queue the day the corpus drained it (every production
    // exercised) and the M3 manifest retired with its purpose served. From
    // that day a new production's forcing function is this invariant: the
    // fixture itself, not an ownership row. A production no fixture can carry
    // YET takes a `redBecause` on this row while its finding is open; one no
    // fixture should EVER reduce is a ruled row in the gate's exclusion table.
    name: 'grammar.coverage', lane: 'grammar',
    property: 'every production the parser defines is reduced by a fixture or excluded by ruling',
    red: (s) => s.gr.uncovered > 0,
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
    red: (s) => s.gr.negatives.staleMints > 0,
  },
  {
    // The alias table is read live, so it cannot rot — but the rulings netted
    // out of it can, in both directions: a spelling excluded as redundant that
    // the corpus nonetheless writes, and an exclusion naming a spelling the
    // lexer stopped rewriting.
    name: 'lexer.exclusions', lane: 'grammar',
    property: 'every excluded spelling is still rewritten by the lexer and still unwritten by the corpus',
    red: (s) => s.gr.negatives.badSpellingExclusions > 0,
  },
  {
    // The containment matrix is bounded by its curated head list, so an
    // entry nothing spells makes the matrix advertise cells no fixture could
    // ever satisfy. Invariant, not a queue: unreachable heads and untested
    // ones both resolve by a decision, and neither is drained by authoring
    // against the cell.
    name: 'containment.heads', lane: 'grammar',
    property: 'every curated containment construct is spelled by at least one fixture, so every pair a claim can name is satisfiable',
    red: (s) => s.gr.negatives.headsUnseen > 0,
  },
  {
    // A park is a claim that a defect — not an absence of effort — is why a
    // row is uncarried. It expires in one direction only: the row becomes
    // carried, at which point the park is the stale thing. Left unpoliced it
    // would quietly shrink the queue forever, which is the one way this
    // bookkeeping could lie about how much work is left.
    // Skipped when the claims registry was never read (`claimsAbsent` is set
    // only by a successful read): an unread registry judges nothing, the
    // same honesty the face oracle's skip buys below.
    name: 'claims.parks', lane: 'grammar',
    skip: (s) => s.gr.negatives?.claimsAbsent == null,
    red: (s) => s.gr.negatives.claimsBadParks > 0,
  },
  {
    // Graduated when the last ruled row got its carrier. Defect-blocked
    // rows are parked (and parks are policed above), so an uncarried,
    // unparked row is a ruling that landed without its fixture — or an
    // edit that evaporated a carrier the carriers row cannot see because
    // the registry text already says ABSENT.
    name: 'claims.carriage', lane: 'grammar',
    property: 'every ruled CLAIMS.md behavior row is carried by a fixture or parked on an open finding',
    skip: (s) => s.gr.negatives?.claimsAbsent == null,
    red: (s) => s.gr.negatives.claimsAbsent > 0,
  },
  {
    // The corpus's one comment rule, and the only half of it that is exactly
    // checkable: a `── … ──` divider opens and closes on the same line. No
    // threshold, no heuristic, and the fix is always joining the lines —
    // never deleting a note, which is why the header LENGTH beside it is
    // reported as a gauge instead of gated here.
    name: 'corpus.dividers', lane: 'grammar',
    property: 'every corpus section divider opens and closes on its own line, so no comment is a reflowed paragraph',
    red: (s) => s.gr.negatives.splitDividers > 0,
  },
  {
    name: 'grammar.census', lane: 'grammar',
    property: "every type text the corpus carries classifies against TypeScript's own type grammar",
    red: (s) => s.gr.negatives.kindBad > 0,
  },
  {
    // Graduated when the census queue drained. Kinds a finding blocks sit
    // in the hold table and stay a yellow queue — hold rot reds under
    // grammar.census — so what gates here is the writable remainder: a kind
    // nobody claimed, excluded, or parked behind a defect. The universe is
    // the pinned tsgo's own type grammar, so a pin bump that widens it
    // paints this row until each new kind is claimed or ruled.
    name: 'grammar.census.claimed', lane: 'grammar',
    property: 'every kind in the census universe is claimed by the corpus, excluded by ruling, or held by an open finding',
    red: (s) => (s.gr.negatives.kindQueued - s.gr.negatives.kindHeld) > 0,
  },
  {
    name: 'negatives.falsifiability', lane: 'grammar',
    property: 'every type-vocabulary class the positives claim carries at least one error-lane instance',
    red: (s) => s.gr.negatives.vocabUnfalsified > 0,
  },
  {
    // Graduated the day the error lane drained the family queue. From that
    // day a family with no negative — one that lost its last, or a NEW
    // family arriving behind a fresh production's positive fixture — is a
    // regression demanding its error pair. The per-family FRACTION stays a
    // gauge: a negative proves one rejection and has no target count.
    name: 'negatives.families', lane: 'grammar',
    property: 'every construct family the positive corpus exercises appears in at least one error-lane fixture',
    red: (s) => s.gr.negatives.famZero > 0,
  },
  {
    // Graduated when the corpus wrote the last dark spelling. The alias
    // table is read live from the lexer, so a NEW rewrite arrives already
    // counted — and reds here until a fixture writes it or a ruling
    // excludes it as redundant.
    name: 'lexer.written', lane: 'grammar',
    property: 'every spelling the lexer rewrites is written by the corpus or excluded by ruling',
    red: (s) => s.gr.negatives.darkSpellings > 0,
  },
  {
    name: 'claims.carriers', lane: 'grammar',
    property: 'every ruled CLAIMS.md row still points at a fixture and symbol that exist in the corpus',
    skip: (s) => s.gr.negatives?.claimsAbsent == null,
    red: (s) => (s.gr.negatives.claimsBroken + s.gr.negatives.cellsMissing) > 0,
  },
  {
    // The one thing byte-equality cannot check. `placed` and `text` both pass
    // for a read that resolves onto a DIFFERENT occurrence of its own name;
    // mapping back through the editor's own reverse direction is what
    // distinguishes them. Expected zero, so any count is a defect never
    // seen — the same footing its two neighbours reached when the mapping
    // gap closed and the census began gating at zero.
    name: 'mapping.identity', lane: 'map',
    property: 'every resolved read maps back to a source span containing the read it came from',
    red: (s) => s.mp.drifted > 0,
  },
  {
    name: 'mapping.spans', lane: 'map',
    property: 'every flagged read sits inside a mapping row the compiler emitted',
    red: (s) => s.mp.missing > 0,
  },
  {
    // The census narrows its own population, which is the one move that could
    // shrink it without fixing anything. Both directions, like the grammar
    // gate's exclusion table: a kind the compiler records but this gate does not
    // declare is an exclusion nobody reviewed, and a kind declared but no longer
    // occurring is a reason that has outlived its defect and would silently
    // excuse the next read that lands there.
    name: 'mapping.exclusions', lane: 'map',
    property: 'every census exclusion is declared with a reason, and every declared reason still occurs',
    red: (s) => s.mp.badExclusions > 0,
  },
  {
    // Held red by agreement while the identifier-read row was open, and it is
    // the reason that row could close: an invariant rather than a number the
    // summary prints, judged in both directions, so the day the census emptied
    // THIS failed and the stale agreement had to be retired rather than left to
    // mask the next break. Now an ordinary green invariant — a read losing its
    // own span again is a regression, not a queue.
    name: 'mapping.census', lane: 'map',
    property: 'every identifier read owns an exact row — its own span, never its cover’s',
    red: (s) => s.mp.census > 0,
  },
  {
    name: 'mapping.decomposition', lane: 'map',
    property: 'the mapping census equals the broken-today and by-luck populations it reports',
    red: (s) => s.mp.decompositionDrift > 0,
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
  // Position holds as THREE invariants, one general and two named by fixture.
  // A single row joined by `AND` can only recover as a whole, so while either
  // half was tolerated a fix to the other left the row red and half its reason
  // a lie — the exact failure the two-directional check exists to prevent. The
  // split also tightens the contract: a position violation in any fixture but
  // these two is a fresh red, never one absorbed by a blanket tolerance. Both
  // named rows now hold, and the partition is what keeps them independent —
  // each fails on its own fixture's evidence.
  {
    name: 'diagnostics.positions', lane: 'errors',
    property: 'every diagnostic lands on the span its twin puts it on, outside the two fixtures below',
    red: (s) => s.el.problems.some((p) => p.kind === 'position' && !/^(11-types|02-operations)\./.test(p.file)),
  },
  {
    name: 'diagnostics.positions.element', lane: 'errors',
    property: 'a wrong-element diagnostic lands on the offending element, not the whole list',
    red: (s) => s.el.problems.some((p) => p.kind === 'position' && /^11-types\./.test(p.file)),
  },
  {
    // The gradual pair's held side is TWO invariants in one predicate on
    // purpose: "publishes nothing in gradual" (leak) and "still publishes
    // under strict" (vacuous) are one property — a hold is only a hold
    // while the diagnostic it holds exists. A toolchain default flip
    // reds this row the day it lands.
    name: 'gradual.held', lane: 'errors',
    property: 'every family gradual holds publishes nothing in gradual and still publishes under strict',
    red: (s) => s.gl.problems.some((p) => p.file === 'held.rip' || p.kind === 'vacuous' || p.kind === 'leak'),
  },
  {
    name: 'gradual.published', lane: 'errors',
    property: 'gradual publishes exactly the pinned reach-and-defect set, and rip check answers like the editor',
    red: (s) => s.gl.problems.some((p) => p.file === 'published.rip' || p.kind === 'parity'),
  },
  {
    name: 'diagnostics.positions.arity', lane: 'errors',
    property: "a paren-injected call's arity error lands on the excess argument",
    red: (s) => s.el.problems.some((p) => p.kind === 'position' && /^02-operations\./.test(p.file)),
  },
  {
    // Three properties share this row — twin gaps, pin drift, and the
    // initialized-binding-`any` invariant. Fine while all three hold; before
    // this row ever takes a `redBecause`, SPLIT IT FIRST — the positions
    // rows above record what tolerating a composite costs (the un-tolerated
    // components ride under the reason, and `recovered` never fires while
    // any of them is red).
    name: 'hover.parity', lane: 'hover',
    property: 'hover answers what the twin answers, and every pinned answer is unchanged',
    red: (s) => s.hp.gap > 0 || s.hp.snapChanged > 0 || s.hp.violations.length > 0,
  },
  // The two rows below were PRINT-ONLY while their findings were open —
  // soft by agreement, since a gate that must stay red gates nothing.
  // Their findings closed, and a closure verified against a gauge that
  // cannot fail the run is not verified: promoted, so the next
  // divergence is an exit code, not a red fraction in a report.
  {
    name: 'hover.silence', lane: 'hover',
    property: 'ruled-silent bare ~> positions serve null (RULINGS.md, Reactive)',
    red: (s) => s.hp.silentLeaks > 0,
  },
  {
    name: 'hover.ruled', lane: 'hover',
    property: 'RULINGS-governed in-body positions serve their pinned answer',
    red: (s) => s.hp.ruledDiverging > 0,
  },
  {
    name: 'hover.pins', lane: 'hover',
    property: 'every hover-pins.json key names a live corpus fixture',
    red: (s) => s.hp.stalePinKeys.length > 0,
  },
  {
    // Graduated at full. Twin-covered positions are watched by parity and
    // rip-native initialized bindings by the `any` invariant; this row
    // holds the remainder — a twin-less probe has no oracle to disagree
    // with, so its falling to `any` reds here or nowhere. The cost is a
    // constraint on the corpus: a twin-less binding honestly annotated
    // `any` cannot enter without a ruling that re-shapes this row.
    name: 'hover.typed', lane: 'hover',
    property: 'every hover probe answers a real type — an `any` counts as typed only when the twin answers it too',
    red: (s) => s.hp.untyped > 0,
  },
  {
    name: 'hover.ruled.population', lane: 'hover',
    property: 'the ruled-hover gate carries at least one pinned position',
    red: (s) => s.hp.ruledPopulation === 0,
  },
  {
    name: 'token.delivery', lane: 'token',
    property: 'the server delivers a semantic token for every probed declaration',
    red: (s) => s.tk.missing.length > 0,
  },
  // Split so the enum classification carries its own agreement: `want.type`
  // separates it exactly, and every other wanted type — `function` among them —
  // is a fresh red here rather than one absorbed by a blanket tolerance.
  {
    name: 'token.type', lane: 'token',
    property: "each declaration's token type is the one its binding form fixes, outside the form agreed below",
    red: (s) => s.tk.badType.some((r) => r.want?.type !== 'enum'),
  },
  {
    name: 'token.type.enum', lane: 'token',
    property: 'an enum name is classified by its own declaring form',
    red: (s) => s.tk.badType.some((r) => r.want?.type === 'enum'),
  },
  {
    // USE SITES, the half `token.delivery` cannot reach: it enumerates probed
    // DECLARATIONS, so a name the editor colors at its declaration and drops at
    // every read satisfies it. The population here is positions where a token is
    // DUE — the face offset carries a tsgo token holding the same bytes — which
    // is why zero is assertable rather than a gauge. Skipped, never assumed
    // green, when the face oracle did not come up: `survDrops` is then absent,
    // and an absent measurement is not a passing one.
    name: 'token.delivery.use-site', lane: 'token',
    property: 'the server delivers a semantic token at every use site TypeScript classifies one',
    skip: (s) => !s.tk.facesAvailable,
    red: (s) => s.tk.survDrops.reduce((n, d) => n + d.count, 0) > 0,
  },
  {
    name: 'token.delivery.oracle', lane: 'token',
    property: 'the standalone face oracle and editor server classify the same use-site population',
    skip: (s) => !s.tk.facesAvailable,
    red: (s) => s.tk.survUnclassified > 0,
  },
  {
    // The use-site population is defined by the instrument's own inputs — an
    // occurrence enters only where the mapping resolves exactly AND the face
    // carries a tsgo token with the same bytes — so a compiler regression that
    // makes positions unclassifiable SHRINKS the gauge instead of failing it,
    // and `use-site` above greens on the survivors. So exclusion is an
    // obligation, not a default: every occurrence outside the population
    // must hold an excuse — source-anchored (a keyword, a primitive type
    // name, a specifier clause — spellings the source fixes and no
    // compiler edit can move) or a reviewed entry in
    // survival-exclusions.json for the exclusions only the compiler's own
    // behavior explains (a name lowered into a string, an `any` receiver's
    // member). A regression's vanished position holds neither and reds
    // here, named, the run it happens.
    name: 'token.delivery.explained', lane: 'token',
    property: 'every use-site position is served or excused — an exclusion no excuse claims is a hole, not a smaller gauge',
    skip: (s) => !s.tk.facesAvailable,
    red: (s) => s.tk.unexplained.length > 0,
  },
  {
    // The reviewed tier's own hygiene, and the migration guard: excuses
    // validate against what the compiler DID, so a regression that swells a
    // reviewed category (stringing-out real identifiers, say) would excuse
    // itself if membership were derived. It is pinned instead — a migrated
    // position arrives as an entry nobody wrote and reds above; an entry
    // whose position no longer needs excusing rots here, like a hover pin
    // the fixture moved under.
    name: 'token.delivery.excused', lane: 'token',
    property: 'every reviewed exclusion still excludes an excluded position — stale excuses leave with what they excused',
    skip: (s) => !s.tk.facesAvailable,
    red: (s) => s.tk.exclusionDrift.length > 0,
  },
  {
    name: 'token.readonly', lane: 'token',
    property: "the readonly modifier follows the binding form, at declarations and at writes",
    red: (s) => s.tk.badReadonly.length > 0,
  },
];

// Judge the run. `states` carries the lane summaries, `ran` answers whether a
// lane ran. Returns one verdict per invariant plus the failures, so the caller
// prints and the exit code follows from the same computation — no second site
// can disagree about whether the run passed. It also returns `drift`: field
// names a predicate read that no summary carries. A renamed summary field
// would otherwise turn its invariant vacuously green forever (`undefined > 0`
// is false), and the unit gate cannot see it — its synthetic states are built
// from the contract's own field names — so every `red` runs against a
// recording view of the real summaries, and the caller refuses on any miss.
// `skip` predicates stay unwatched: probing for an absent measurement is
// their whole job.
export const judge = ({ states, ran, table = CONTRACT }) => {
  const drift = new Set();
  const watch = (obj, path) => new Proxy(obj, {
    get(t, prop) {
      if (typeof prop === 'symbol') return t[prop];
      const v = t[prop];
      if (v === undefined && !(prop in t)) drift.add(`${path}${path ? '.' : ''}${prop}`);
      return v !== null && typeof v === 'object' ? watch(v, `${path}${path ? '.' : ''}${prop}`) : v;
    },
  });
  const watched = watch(states, '');
  const verdicts = table.map((c) => {
    if (!ran(c.lane)) return { ...c, state: 'skipped' };
    // A lane can run while one of its measurements is unavailable — an optional
    // oracle that did not come up. `skip` says so, and skipping is the only
    // honest verdict: the predicate would read a missing measurement as a
    // satisfied one.
    if (c.skip?.(states)) return { ...c, state: 'skipped' };
    let isRed;
    // A predicate that THROWS read something structurally missing (an absent
    // array's `.length`); the miss is already recorded, and the refusal
    // supersedes any verdict this row could give.
    try { isRed = c.red(watched); } catch { return { ...c, state: 'drift' }; }
    return {
      ...c,
      state: isRed
        ? (c.redBecause ? 'red-expected' : 'red-new')
        : (c.redBecause ? 'recovered' : 'green'),
    };
  });
  return {
    verdicts,
    drift,
    // `recovered` fails on purpose: the invariant holds again, so its
    // `redBecause` must go or it hides the next break in the same property.
    failures: verdicts.filter((v) => v.state === 'red-new' || v.state === 'recovered'),
  };
};
