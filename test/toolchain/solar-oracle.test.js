// An independent LALR(1) oracle for Solar: rebuild the LR(0) automaton
// from the rule set with a textbook closure/goto, compute LALR(1)
// lookaheads by propagation (Aho, Sethi, Ullman 4.63), and compare with
// what Solar produced — every state, every transition, every reduction's
// lookahead set. Solar's own construction is DeRemer–Pennello; two
// different algorithms agreeing on the real grammar is what makes a
// generator change safe to land.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

const gen = new Generator(structuredClone(grammar));
const rules = gen.rules;
const NT = gen.nonterminals;
const isNT = (s) => Object.hasOwn(NT, s);
const rhs = (r) => r.symbols.filter((s) => s !== '');

// ---- nullable and FIRST ----
const nullable = new Set();
for (let changed = true; changed;) {
  changed = false;
  for (const r of rules) {
    if (!nullable.has(r.lhs) && rhs(r).every((s) => nullable.has(s))) { nullable.add(r.lhs); changed = true; }
  }
}
const FIRST = new Map(Object.keys(NT).map((n) => [n, new Set()]));
for (let changed = true; changed;) {
  changed = false;
  for (const r of rules) {
    const f = FIRST.get(r.lhs);
    for (const s of rhs(r)) {
      if (isNT(s)) {
        for (const t of FIRST.get(s)) if (!f.has(t)) { f.add(t); changed = true; }
        if (!nullable.has(s)) break;
      } else {
        if (!f.has(s)) { f.add(s); changed = true; }
        break;
      }
    }
  }
}
// FIRST of the suffix after an item's dot, and whether that suffix is
// nullable (in which case the item's own lookaheads pass through).
const suffixCache = new Map();
const suffixOf = (it) => {
  let hit = suffixCache.get(it);
  if (hit) return hit;
  const rs = rhsOf[ruleOf(it)];
  const first = new Set();
  let through = true;
  for (let i = dotOf(it) + 1; i < rs.length; i++) {
    const s = rs[i];
    if (isNT(s)) { for (const t of FIRST.get(s)) first.add(t); if (!nullable.has(s)) { through = false; break; } }
    else { first.add(s); through = false; break; }
  }
  hit = { first, through };
  suffixCache.set(it, hit);
  return hit;
};

// ---- LR(0) automaton (items are numeric: ruleId * STRIDE + dot) ----
const STRIDE = 32;
const rhsOf = [];
for (const r of rules) rhsOf[r.id] = rhs(r);
const ruleOf = (it) => (it / STRIDE) | 0;
const dotOf = (it) => it % STRIDE;
const closure0 = (kernel) => {
  const items = new Set(kernel);
  const stack = [...kernel];
  while (stack.length) {
    const it = stack.pop();
    const X = rhsOf[ruleOf(it)][dotOf(it)];
    if (X && isNT(X)) {
      for (const p of NT[X].rules) {
        const k = p.id * STRIDE;
        if (!items.has(k)) { items.add(k); stack.push(k); }
      }
    }
  }
  return items;
};
const kernels = [];
const index = new Map();
const trans = [];
const addState = (kernel) => {
  const sig = [...kernel].sort((a, b) => a - b).join('|');
  if (index.has(sig)) return index.get(sig);
  const id = kernels.length;
  index.set(sig, id);
  kernels.push(kernel);
  trans.push(new Map());
  return id;
};
addState(new Set([0]));
for (let k = 0; k < kernels.length; k++) {
  const bySym = new Map();
  for (const it of closure0(kernels[k])) {
    const X = rhsOf[ruleOf(it)][dotOf(it)];
    if (!X || X === '$end') continue;
    if (!bySym.has(X)) bySym.set(X, new Set());
    bySym.get(X).add(it + 1);
  }
  for (const [X, kernel] of bySym) trans[k].set(X, addState(kernel));
}

// Solar's state → oracle state, by kernel signature.
const solarSig = (st) => [...st.items]
  .filter((i) => i.dot > 0 || i.rule.id === 0)
  .map((i) => i.rule.id * STRIDE + i.dot).sort((a, b) => a - b).join('|');

test('LR(0): the same states and transitions', () => {
  expect(gen.states.length).toBe(kernels.length);
  let mismatched = 0;
  for (const st of gen.states) {
    const id = index.get(solarSig(st));
    if (id == null) { mismatched++; continue; }
    for (const [X, to] of st.transitions) {
      if (index.get(solarSig(gen.states[to])) !== trans[id].get(X)) mismatched++;
    }
  }
  expect(mismatched).toBe(0);
});

// ---- LALR(1) lookaheads by propagation ----
const closure1 = (seed) => {
  const items = new Map([...seed].map(([k, v]) => [k, new Set(v)]));
  const work = [...seed.keys()];
  while (work.length) {
    const it = work.pop();
    const X = rhsOf[ruleOf(it)][dotOf(it)];
    if (!X || !isNT(X)) continue;
    const { first, through } = suffixOf(it);
    const add = through ? new Set([...first, ...items.get(it)]) : first;
    for (const p of NT[X].rules) {
      const k = p.id * STRIDE;
      let s = items.get(k);
      let grew = false;
      if (!s) { s = new Set(); items.set(k, s); grew = true; }
      for (const t of add) if (!s.has(t)) { s.add(t); grew = true; }
      if (grew) work.push(k);
    }
  }
  return items;
};

test('LALR(1): the same lookahead set on every reduction', () => {
  const LA = kernels.map((k) => new Map([...k].map((it) => [it, new Set()])));
  LA[0].get(0).add('$end');
  const prop = kernels.map(() => []);
  for (let k = 0; k < kernels.length; k++) {
    for (const it of kernels[k]) {
      const J = closure1(new Map([[it, new Set(['#'])]]));
      for (const [jt, las] of J) {
        const X = rhsOf[ruleOf(jt)][dotOf(jt)];
        if (!X || X === '$end') continue;
        const to = trans[k].get(X);
        const target = jt + 1;
        for (const a of las) {
          if (a === '#') prop[k].push([it, to, target]);
          else LA[to].get(target).add(a);
        }
      }
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 0; k < kernels.length; k++) {
      for (const [from, to, target] of prop[k]) {
        const src = LA[k].get(from), dst = LA[to].get(target);
        for (const a of src) if (!dst.has(a)) { dst.add(a); changed = true; }
      }
    }
  }
  const oracleReductions = kernels.map((k, i) => {
    const out = new Map();
    for (const [jt, las] of closure1(LA[i])) {
      const rid = ruleOf(jt);
      if (rid !== 0 && dotOf(jt) === rhsOf[rid].length) out.set(rid, las);
    }
    return out;
  });
  const diffs = [];
  let compared = 0;
  for (const st of gen.states) {
    const want = oracleReductions[index.get(solarSig(st))];
    for (const item of st.reductions) {
      if (item.rule.id === 0) continue;
      compared++;
      const expected = [...(want.get(item.rule.id) ?? [])].sort();
      const actual = [...item.lookaheads].sort();
      if (expected.join(' ') !== actual.join(' ')) diffs.push({ state: st.id, rule: item.rule.id, expected, actual });
    }
  }
  expect(compared).toBeGreaterThan(500);
  expect(diffs).toEqual([]);
});
