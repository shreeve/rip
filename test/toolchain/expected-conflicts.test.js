// The declared-ambiguity gate: grammar.rip ships an expectedConflicts
// manifest naming every reduce-reduce and ambiguous default the parse
// table may contain, and Solar fails generation on any drift. These
// tests drive the gate through each drift shape against the real
// grammar; the manifest-matches-table case rides generated.test.js
// (a full Generator construction that must not throw).
import { describe, test, expect, beforeAll } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';
import { join } from 'node:path';
import { parser, Parser } from '../../src/parser.js';
import { tokenize } from '../../src/lexer.js';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';

const withManifest = (expectedConflicts) => ({ ...grammar, expectedConflicts });

test('an undeclared conflict fails generation and names the rule', () => {
  const pair = 'Operation → Expression && Return over Statement → Return';
  const short = grammar.expectedConflicts.filter(([, rule]) => rule !== pair);
  expect(() => new Generator(withManifest(short))).toThrow(/undeclared: \[reduce-reduce\] Operation → Expression && Return over Statement → Return/);
});

test('a resolution-count drift fails generation with both counts', () => {
  const declared = grammar.expectedConflicts.find(([, rule]) => rule === 'Try → TRY Expression')[2];
  const bumped = grammar.expectedConflicts.map(([category, rule, count]) =>
    [category, rule, rule === 'Try → TRY Expression' ? count + 1 : count]);
  expect(() => new Generator(withManifest(bumped))).toThrow(new RegExp(`count drift: \\[ambiguous\\] Try → TRY Expression — declared ${declared + 1}, actual ${declared}`));
});

test('a declared conflict the table no longer has fails generation', () => {
  const extra = [...grammar.expectedConflicts, ['reduce-reduce', 'Phantom → GHOST', 3]];
  expect(() => new Generator(withManifest(extra))).toThrow(/declared but absent: \[reduce-reduce\] Phantom → GHOST/);
});

test('a duplicate manifest entry fails generation', () => {
  const doubled = [...grammar.expectedConflicts, grammar.expectedConflicts[0]];
  expect(() => new Generator(withManifest(doubled))).toThrow(/duplicate entry/);
});

test('the drift failure prints the actual manifest for review-and-paste', () => {
  let message = '';
  try {
    new Generator(withManifest([]));
  } catch (e) {
    message = e.message;
  }
  expect(message).toContain('Actual manifest:');
  for (const [category, rule, count] of grammar.expectedConflicts) {
    expect(message).toContain(`['${category}', '${rule}', ${count}]`);
  }
});

test('a grammar without a manifest is not gated', () => {
  const { expectedConflicts, ...ungated } = grammar;
  expect(() => new Generator(ungated)).not.toThrow();
});

// Lookahead correction: `parser.accepts(stack, symbol)` answers whether
// the configuration `stack` would shift `symbol` (or accept on it). The
// oracle is the real driver: a tape cut after `i` tokens with one candidate
// token appended. The driver asks the lexer for another token only after
// it has shifted the one it holds, so the candidate was consumed exactly
// when the lexer is asked again; end of input was accepted exactly when
// the parse returns a tree. The configuration comes from a states-only LR
// walk over the same tables, itself checked against the driver on every
// whole program.
describe('lookahead correction', () => {
  const ROOT = join(import.meta.dir, '../..');
  const EOF = 1;
  const { parseTable, ruleTable, symbolIds, tokenNames } = parser;
  const id = (kind) => symbolIds[kind];

  // The state stack after shifting tokens[0..n), or null when the walk
  // errors first.
  function configuration(tokens, n) {
    const stk = [0];
    for (let i = 0; i < n; i++) {
      const sym = id(tokens[i].kind);
      for (;;) {
        const act = parseTable[stk.at(-1)][sym];
        if (act === undefined) return null;
        if (act > 0) { stk.push(act); break; }
        if (act === 0) return null;
        stk.length -= ruleTable[-act * 2 + 1];
        stk.push(parseTable[stk.at(-1)][ruleTable[-act * 2]]);
      }
    }
    return stk;
  }

  // Whether the real driver consumes `candidate` after tokens[0..n). A
  // type annotation token's payload is the tape's own; the stand-in has an
  // empty one, which the types entry reads as no type, and still shifts. A
  // schema body's stand-in is the smallest body the schema entry reads,
  // one inline field.
  //
  // Two answers say the table's verdict cannot be observed, because the
  // driver rejects for a reason the table does not hold:
  // - UNREACHED: the driver rejects inside the prefix and never asks for
  //   token n. The states-only walk shifts an entry token as one terminal,
  //   but a schema body's payload is parsed, and its rejection is loud (a
  //   `fail` row's malformed body).
  // - ACTION: a grammar rule action rejects the reduction (it throws a
  //   positioned error: `postfix 'unless' has no else form`), in the
  //   prefix or on the reduction the candidate triggers before its shift.
  const UNREACHED = 'unreached', ACTION = 'action';
  const STAND_IN_BODY = [
    { kind: 'TERMINATOR', value: ';', start: 1e9, end: 1e9 },
    { kind: 'S_WORD', value: 'x', start: 1e9, end: 1e9 },
  ];
  function driverConsumes(text, tokens, n, candidate, payloads) {
    const tape = tokens.slice(0, n);
    let handedOut = false, askedAgain = false, reached = false;
    const p = Parser();
    p.lexer = {
      setInput() { this.index = 0; this.text = ''; this.loc = null; this.token = null; },
      lex() {
        if (this.index === tape.length) reached = true;
        if (this.index < tape.length) {
          const t = tape[this.index++];
          this.text = t.value; this.loc = { start: t.start, end: t.end }; this.token = t;
          return t.kind;
        }
        if (candidate !== EOF && !handedOut) {
          handedOut = true;
          this.text = 'x'; this.loc = { start: 1e9, end: 1e9 }; this.token = { kind: candidate, generated: true };
          return candidate;
        }
        if (handedOut) askedAgain = true;
        return null;
      },
      payload() { return payloads.get(this.token) ?? (this.token?.kind === parser.symbolIds.SCHEMA_BODY ? STAND_IN_BODY : []); },
    };
    let r = null;
    let thrown = null;
    // A rule action choking on the stand-in value runs only after the
    // shift, so askedAgain already holds the answer.
    try { r = p.parse(text); } catch (err) { thrown = err; }
    const actionRejected = thrown !== null && typeof thrown.start === 'number';
    if (!reached) return actionRejected ? ACTION : UNREACHED;
    if (actionRejected && (candidate === EOF || !askedAgain)) return ACTION;
    return candidate === EOF ? r?.sexpr != null : askedAgain;
  }

  // A prefix the driver rejects without a rule action must hold a schema
  // body, the one entry whose payload rejection is loud; any other
  // unreachable prefix is a disagreement between the walk and the driver.
  const unreached = (path, tokens, n) => {
    if (!tokens.slice(0, n).some((t) => t.kind === 'SCHEMA_BODY')) {
      throw new Error(`${path} cut ${n}: the walk shifts the prefix, the driver rejects it, and it holds no schema body`);
    }
  };

  // The sample, plus rows that always hold both unobservable kinds: a
  // malformed schema body (UNREACHED) and a rule action's rejection
  // (ACTION).
  const PINNED = new Set([
    "row schema.rip › fail field name '1stPlace' (leading digit) is rejected",
    'row schema.rip › fail :symbol with trailing-colon separator is rejected',
    'row control.rip › fail postfix unless else rejects',
  ]);
  let tapes = [];
  beforeAll(async () => {
    const inputs = [...packageInputs(ROOT), ...(await rowInputs(ROOT))];
    tapes = inputs.filter(({ key }, k) => k % 97 === 0 || PINNED.has(key)).flatMap(({ src, path }) => {
      try { const { tokens, payloads } = tokenize(src, path); return [{ path, text: src, tokens, payloads }]; } catch { return []; }
    });
  });
  const terminals = Object.keys(tokenNames).map(Number).filter((s) => s > 2);

  test('the states-only walk agrees with the driver on whole programs', () => {
    expect(tapes.length).toBeGreaterThan(30);
    const unobservable = { [UNREACHED]: 0, [ACTION]: 0 };
    for (const { text, tokens, path, payloads } of tapes) {
      const stk = configuration(tokens, tokens.length);
      const ok = stk !== null && parser.accepts(stk, EOF);
      const want = stk === null ? false : driverConsumes(text, tokens, tokens.length, EOF, payloads);
      if (want === UNREACHED) { unreached(path, tokens, tokens.length); unobservable[UNREACHED]++; continue; }
      if (want === ACTION) { unobservable[ACTION]++; continue; }
      expect([path, ok]).toEqual([path, want]);
    }
    // The pinned rows reach both kinds the oracle sets aside.
    expect(unobservable[UNREACHED]).toBeGreaterThan(0);
    expect(unobservable[ACTION]).toBeGreaterThan(0);
  });

  test('accepts matches the driver for every terminal at sampled cut points', () => {
    let yes = 0, no = 0;
    for (const { text, tokens, path, payloads } of tapes) {
      const cuts = [0, 1, tokens.length >> 2, tokens.length >> 1, tokens.length - 1].filter((n, k, a) => n >= 0 && n < tokens.length && a.indexOf(n) === k);
      for (const n of cuts) {
        const stk = configuration(tokens, n);
        if (!stk) continue;
        for (const s of [EOF, ...terminals]) {
          const before = stk.join();
          const got = parser.accepts(stk, s);
          expect(stk.join()).toBe(before);
          const want = driverConsumes(text, tokens, n, s, payloads);
          if (want === UNREACHED) { unreached(path, tokens, n); break; }
          if (want === ACTION) continue;
          if (got !== want) throw new Error(`${path} cut ${n}: accepts(${tokenNames[s] ?? s}) is ${got}, the driver says ${want}`);
          got ? yes++ : no++;
        }
      }
    }
    // Both answers occur, and some rejected symbol had a (reducing) action in
    // the top state: the cases where LAC differs from a table-row lookup.
    expect(yes).toBeGreaterThan(100);
    expect(no).toBeGreaterThan(1000);
  }, 120_000);

  // `advance` is the states-only walk's own shift, on a copy. The driver's
  // parse-error(t) rule chains it: a closer, then the token.
  test('advance yields the configuration after the shift', () => {
    let shifted = 0;
    for (const { tokens } of tapes) {
      for (const n of [0, tokens.length >> 1, tokens.length - 1]) {
        const stk = configuration(tokens, n);
        if (!stk) continue;
        for (const s of terminals) {
          const before = stk.join();
          const next = parser.advance(stk, s);
          expect(stk.join()).toBe(before);
          if (next === null) continue;
          const walk = [...stk];
          for (;;) {
            const act = parseTable[walk.at(-1)][s];
            if (act > 0) { walk.push(act); break; }
            walk.length -= ruleTable[-act * 2 + 1];
            walk.push(parseTable[walk.at(-1)][ruleTable[-act * 2]]);
          }
          expect(next).toEqual(walk);
          shifted++;
        }
      }
    }
    expect(shifted).toBeGreaterThan(100);
  });

  test('an LALR reduce on a token it then rejects is answered false', () => {
    let found = 0;
    for (const { tokens } of tapes) {
      for (const n of [tokens.length >> 1, tokens.length - 1]) {
        const stk = configuration(tokens, n);
        if (!stk) continue;
        for (const s of terminals) {
          const act = parseTable[stk.at(-1)][s];
          if (act !== undefined && act < 0 && !parser.accepts(stk, s)) found++;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
