// Lookahead correction: `parser.accepts(stack, symbol)` answers whether
// the configuration `stack` would shift `symbol` (or accept on it). The
// oracle is the real driver: a tape cut after `i` tokens with one candidate
// token appended. The driver asks the lexer for another token only after
// it has shifted the one it holds, so the candidate was consumed exactly
// when the lexer is asked again; end of input was accepted exactly when
// the parse returns a tree. The configuration comes from a states-only LR
// walk over the same tables, itself checked against the driver on every
// whole program.
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { parser, Parser } from '../../src/parser.js';
import { tokenize } from '../../src/lexer.js';
import { splitData } from '../../src/compiler.js';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';

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
// empty one, which the types entry reads as no type, and still shifts.
function driverConsumes(text, tokens, n, candidate, payloads) {
  const tape = tokens.slice(0, n);
  let handedOut = false, askedAgain = false;
  const p = Parser();
  p.lexer = {
    setInput() { this.index = 0; this.text = ''; this.loc = null; this.token = null; },
    lex() {
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
    payload() { return payloads.get(this.token) ?? []; },
  };
  let r = null;
  try { r = p.parse(text); } catch { /* a rule action choking on the stand-in value runs only after the shift */ }
  return candidate === EOF ? r?.sexpr != null : askedAgain;
}

const inputs = [...packageInputs(ROOT), ...(await rowInputs(ROOT))];
const tapes = inputs.filter((_, k) => k % 97 === 0).flatMap(({ src, path }) => {
  const { text } = splitData(src);
  try { const { tokens, payloads } = tokenize(text, path); return [{ path, text, tokens, payloads }]; } catch { return []; }
});
const terminals = Object.keys(tokenNames).map(Number).filter((s) => s > 2);

test('the states-only walk agrees with the driver on whole programs', () => {
  expect(tapes.length).toBeGreaterThan(30);
  for (const { text, tokens, path, payloads } of tapes) {
    const stk = configuration(tokens, tokens.length);
    const ok = stk !== null && parser.accepts(stk, EOF);
    expect([path, ok]).toEqual([path, driverConsumes(text, tokens, tokens.length, EOF, payloads)]);
  }
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
