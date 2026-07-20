// Precision regression gate: per corpus file, the
// number of distinct mapped generated positions may only GROW or HOLD as
// coverage widens — never shrink. When a change legitimately adds mapped
// positions, raise the floor to the new verified count in the same
// commit. A drop is a regression, never an expectation to lower.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { toSourceMap, decodeMappings } from '../../src/sourcemap.js';

parser.lexer = makeParserLexer();

// Committed floors — verified counts at the time each file landed.
//
// Recalibrated for Tier 1 declare-in-place (evolving-let-tiers): the
// emitter now declares straight-line locals at their first assignment
// (`let x = <value>;`) instead of a hoisted `let a, b, x;` line, so the
// hoist line's mapped positions (its cover row and one target position
// per moved name) legitimately DISAPPEAR from the generated output —
// the drops below were spot-verified to match each file's count of
// declare-in-place conversions (plus removed hoist-line cover
// positions). This is a change in the generated code itself, not a
// coverage regression; files whose verified counts sat above their old
// floors were raised at the same time, and the grow-or-hold rule
// resumes from these counts.
const FLOORS = {
  'types.rip': 96,
  'typedecls.rip': 18,
  'foras.rip': 84,
  'loops3.rip': 132,
  'doiife.rip': 46,
  'objspread.rip': 197,
  'heredocs2.rip': 15,
  'multiline.rip': 205,
  'optchain.rip': 71,
  'dynkeys.rip': 64,
  'mathops.rip': 56,
  'implicitcalls.rip': 182,
  'implicitobjects.rip': 177,
  'classes.rip': 143,
  'destructuring.rip': 232,
  'lowerings.rip': 177,
  'closeout.rip': 189,
  'async.rip': 119,
  'tabs.rip': 58,
  'singleline.rip': 100,
  'strings2.rip': 31,
  'regexes.rip': 32,
  'compose5.rip': 59,
  'loops2.rip': 84,
  // compose4/postfix floors reflect the single-evaluation membership
  // helper: the container and key map ONCE each (the inline dispatch
  // re-emitted them, and every duplicate counted as a mapped position).
  'compose4.rip': 67,
  'control.rip': 68,
  'postfix.rip': 46,
  'switchtry.rip': 63,
  'compose3.rip': 56,
  'functions.rip': 35,
  'thisops.rip': 54,
  'arrays.rip': 39,
  'compose2.rip': 83,
  'objects.rip': 55,
  'ranges.rip': 42,
  'assignment.rip': 21,
  'binary.rip': 60,
  'call.rip': 22,
  'compose.rip': 139,
  'compound.rip': 33,
  'def.rip': 34,
  'if.rip': 34,
  'literals.rip': 17,
  'logical.rip': 32,
  'member.rip': 20,
  'mixed.rip': 31,
  'parens.rip': 38,
  'unicode.rip': 12,
  'voidmarker.rip': 83,
  'while.rip': 31,
  'enum.rip': 74,
  'schema.rip': 31,
  'reactive.rip': 163,
  'effects.rip': 120,
  'readonly.rip': 66,
  'pick.rip': 203,
  'chains.rip': 114,
  'presence.rip': 62,
  'whileguard.rip': 96,
  'model.rip': 15,
  'components.rip': 399,
  'match.rip': 100,
};

const corpusDir = join(import.meta.dir, '../corpus');
const files = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();

describe('precision regression gate', () => {
  test('every corpus file has a committed floor', () => {
    expect(files.sort()).toEqual(Object.keys(FLOORS).sort());
  });

  for (const file of files) {
    test(`${file}: mapped positions >= ${FLOORS[file] ?? 0}`, () => {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const r = parser.parse(src);
      expect(r.diagnostics).toEqual([]);
      const out = emit(r, { source: src });
      const map = toSourceMap(out, { source: src });
      const positions = new Set(
        decodeMappings(map.mappings)
          .filter(s => 'srcLine' in s)
          .map(s => `${s.genLine}:${s.genCol}`),
      );
      expect(positions.size).toBeGreaterThanOrEqual(FLOORS[file] ?? 0);
    });
  }
});
