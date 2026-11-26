// The front-end corpus gate: every consumer-corpus program lexes, parses,
// parses tolerantly and classifies to the facts test/corpus/frontend.json
// pins (test/support/frontend-hashes.js says what each hash covers). A
// change that moves a token, a tree, a store row, a repair or a REPL verdict
// is accepted only by `bun run corpus`, after its diff is reviewed
// (`bun scripts/frontend-diff.mjs <ref>` shows each moved program against
// another revision's front end).
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';
import { hashFrontEnd, frontEndFacts, Exact, FRONTEND_FACTS, FRONTEND_MANIFEST } from '../support/frontend-hashes.js';

const ROOT = join(import.meta.dir, '../..');
const manifest = JSON.parse(readFileSync(join(ROOT, FRONTEND_MANIFEST), 'utf8'));

function report(got, prefix) {
  const pinned = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith(prefix)));
  const moved = [], missing = [], unpinned = [];
  for (const [k, v] of Object.entries(got)) {
    if (!(k in pinned)) { unpinned.push(k); continue; }
    const facts = FRONTEND_FACTS.filter((f) => v[f] !== pinned[k][f]);
    if (facts.length) moved.push(`${k} [${facts.join(', ')}]`);
  }
  for (const k of Object.keys(pinned)) if (!(k in got)) missing.push(k);
  return [
    moved.length && `front end moved (${moved.length}):\n  ${moved.slice(0, 40).join('\n  ')}`,
    unpinned.length && `not in the manifest (${unpinned.length}):\n  ${unpinned.slice(0, 20).join('\n  ')}`,
    missing.length && `in the manifest but gone (${missing.length}):\n  ${missing.slice(0, 20).join('\n  ')}`,
  ].filter(Boolean).join('\n');
}

const HINT = '\n\nReview the moved programs (bun scripts/frontend-diff.mjs <ref>), then accept them with bun run corpus.';

test('package modules keep the pinned front-end facts', () => {
  const r = report(hashFrontEnd(packageInputs(ROOT)), 'pkg ');
  expect(r, r + HINT).toBe('');
}, 120_000);

test('language-suite rows keep the pinned front-end facts', async () => {
  const r = report(hashFrontEnd(await rowInputs(ROOT)), 'row ');
  expect(r, r + HINT).toBe('');
}, 120_000);

// The facts must see what JSON would lose, or the gate passes changes it
// should catch. Each probe changes one thing JSON cannot see, and the facts
// must change with it.
test('the facts see what JSON serialization drops', () => {
  const facts = (src) => frontEndFacts(src, 'probe.rip');
  // A schema descriptor's own toJSON returns only its kind; the facts read
  // the fields.
  const a = facts('User = schema :model\n  name! string\n');
  const b = facts('User = schema :model\n  name? string\n');
  expect(a.tokens.join('\n')).not.toBe(b.tokens.join('\n'));
  // A RegExp constraint is a value, not {}.
  const c = facts('User = schema :model\n  name! string, /^a$/\n');
  const d = facts('User = schema :model\n  name! string, /^b$/\n');
  expect(c.tokens.join('\n')).not.toBe(d.tokens.join('\n'));
  // `.parenthesized` is an array property, invisible to JSON.
  const e = facts('x = (f 1)\n');
  const f = facts('x = f 1\n');
  expect(e.tree.at(-1)).toContain('parenthesized:true');
  expect(f.tree.at(-1)).not.toContain('parenthesized');
});

// Token ids are minting order: renumbering every id, tape or nested, prints
// the same text; moving a token does not.
test('token ids print as labels, never as numbers', () => {
  const tape = (base) => [
    { id: base + 1, kind: 'IDENTIFIER', value: 'f', start: 0, end: 1, origin: null },
    { id: base + 2, kind: 'CALL_START', value: '(', start: 1, end: 1, origin: base + 3 },
    { id: base + 3, kind: 'SCHEMA_BODY', value: { argTokens: [{ id: base + 9, kind: 'NUMBER', start: 2, origin: base + 1 }] }, start: 2, end: 3, origin: null },
  ];
  const print = (t) => { const x = new Exact({ tape: t }); return t.map((tok) => x.text(tok)).join('\n'); };
  expect(print(tape(0))).toBe(print(tape(1_000_000)));
  expect(print(tape(0))).not.toMatch(/id:\d/);
  const moved = tape(0);
  moved[1].origin = 1;
  expect(print(moved)).not.toBe(print(tape(0)));
});

// A value reached twice is pinned as shared: copying it instead changes the
// text, and so does sharing what was distinct.
test('shared references, -0 and cycles are exact', () => {
  const a = {};
  expect(new Exact().text([a, a])).not.toBe(new Exact().text([{}, {}]));
  expect(new Exact().text(-0)).not.toBe(new Exact().text(0));
  const loop = [];
  loop.push(loop);
  expect(() => new Exact().text(loop)).toThrow('cycle');
});

// Comments and blank-line runs are the lexer's trivia channel, which the
// emitter reads.
test('the tokens fact pins trivia', () => {
  const a = frontEndFacts('x = 1 # one\n', 'probe.rip');
  const b = frontEndFacts('x = 1 # two\n', 'probe.rip');
  expect(a.tokens.join('\n')).not.toBe(b.tokens.join('\n'));
});

// A program that lexes and then fails to parse keeps its tape: the parse
// error is the tree fact, and the tape is still watched.
test('a parse that throws keeps its tape', () => {
  const f = frontEndFacts('x unless c else y\n', 'probe.rip');
  expect(f.tokens[0]).not.toBe('<no tape>');
  expect(f.tree[0]).toMatch(/^js ERR /);
});

// Both faces parse: the JS face without PrimitiveStore rows (the shipping
// compile), the TS face with them.
test('the tree fact holds both faces', () => {
  const { tree } = frontEndFacts('x = f 1\n', 'probe.rip');
  expect(tree.some((l) => l.startsWith('js primitive '))).toBe(false);
  expect(tree.some((l) => l.startsWith('ts primitive '))).toBe(true);
  expect(tree.some((l) => l.startsWith('js sexpr '))).toBe(true);
  expect(tree.some((l) => l.startsWith('ts sexpr '))).toBe(true);
});
