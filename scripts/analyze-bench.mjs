// analyze.js against exactly the v1 walks it replaces, over the
// consumer corpus: every program both v1 emits and analyze.js accepts,
// per face. Run it under the timing lane:
//
//   cpuq drain --label rip:timing --max 10m -- bun scripts/analyze-bench.mjs [rounds]
//
// The v1 side is an instrumented copy of src/emitter.js (written to a
// temporary directory, its imports pointed back at src/) whose replaced
// walks are timed as one group, outermost call only, so a walk nested
// in another is counted once:
//   deliveryTrees, runtimeAliasBindings, programScopeNames,
//   inventoryBindings, the delivery decision's referencesNames call and
//   structural triggers (timed at their call sites, so their recursion
//   runs untimed), collectTypeOnlyImports, collectAppAccessors, every
//   pushReactiveFrame (the frame collectors, the redeclaration check,
//   declaredNames/declaredClassNames/importedSpecs/exportedConstNames),
//   the single-expression effect's checkScopeRedeclarations, and the
//   atom collection loop. emitterShape (the converter analyze.js makes
//   unnecessary) is timed on its own. programScopeNames and
//   inventoryBindings run hoistTargets, which also mints chain temps
//   and reference plans (4.1b's facts), so the group slightly favors
//   analyze.js.
//
// Rounds interleave the two sides (alternating which goes first) and
// each side reports its fastest round. Both sides read one Stores per
// program built outside the timing (v1 builds its own inside emit(),
// outside the group); Stores construction is reported on its own. The
// group's per-call timer cost is calibrated and subtracted. Retained
// size is each side's construction held for the whole population after
// a full collection: analyze.js's facts against emitterShape's trees.
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { heapStats } from 'bun:jsc';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { parseSource } from '../src/compiler.js';
import { analyze } from '../src/emit/analyze.js';
import { emitterShape } from '../src/emitter-shape.js';
import { Stores } from '../src/stores.js';

const root = join(import.meta.dir, '..');
const rounds = Number(process.argv[2] ?? 7);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`analyze-bench: rounds must be a whole number, got ${process.argv[2]}`);

const METHODS = ['collectTypeOnlyImports', 'collectAppAccessors', 'pushReactiveFrame', 'checkScopeRedeclarations'];
const FUNCS = ['deliveryTrees', 'runtimeAliasBindings', 'programScopeNames', 'inventoryBindings'];
const DELIVERY_REFS = 'referencesNames(tree, unboundSet, stores, isDecl)';
const ATOMS = `  for (const { tree, atoms } of trees) {
    collectAtoms(tree);
    collectAtoms(atoms);
  }`;

function instrument() {
  let t = readFileSync(join(root, 'src/emitter.js'), 'utf8');
  for (const f of FUNCS) {
    const re = new RegExp(`^const ${f} =`, 'm');
    if (!re.test(t)) throw new Error(`analyze-bench: src/emitter.js has no ${f}`);
    t = t.replace(re, `let ${f} =`);
  }
  if (!t.includes(ATOMS)) throw new Error('analyze-bench: src/emitter.js has no atom collection loop');
  t = t.replace(ATOMS, `  __time('walks', () => {\n${ATOMS}\n  }, null, []);`);
  t = t.replace(/^import \{ emitterShape \} from '\.\/emitter-shape\.js';/m,
    "import { emitterShape as __shape } from './emitter-shape.js';\nconst emitterShape = (...a) => __time('shape', __shape, null, a);");
  if (!t.includes(DELIVERY_REFS)) throw new Error('analyze-bench: src/emitter.js has no delivery reference walk');
  t = t.replace(DELIVERY_REFS, "__time('walks', referencesNames, null, [tree, unboundSet, stores, isDecl])");
  t = t.replace(/^class Emitter /m, 'export class Emitter ');
  const src = pathToFileURL(join(root, 'src')).href;
  t = t.replace(/ from '\.\//g, ` from '${src}/`);
  if (!t.includes("new URL('./runtime/', import.meta.url)")) throw new Error('analyze-bench: src/emitter.js locates its runtimes differently');
  t = t.replace("new URL('./runtime/', import.meta.url)", `new URL('${src}/runtime/')`);
  t += `
export const __T = new Map();
export let __calls = 0;
const __depth = new Map();
function __time(group, fn, self, args) {
  if (__depth.get(group)) return fn.apply(self, args);
  __depth.set(group, true);
  __calls++;
  const s = performance.now();
  try { return fn.apply(self, args); } finally {
    __T.set(group, (__T.get(group) ?? 0) + performance.now() - s);
    __depth.set(group, false);
  }
}
for (const m of ${JSON.stringify(METHODS)}) {
  const o = Emitter.prototype[m] ? Emitter.prototype : Emitter;
  const f = o[m];
  o[m] = function (...a) { return __time('walks', f, this, a); };
}
${FUNCS.map((f) => `{ const g = ${f}; ${f} = (...a) => __time('walks', g, null, a); }`).join('\n')}
for (const k of Object.keys(STRUCTURAL_TRIGGERS)) {
  const f = STRUCTURAL_TRIGGERS[k];
  STRUCTURAL_TRIGGERS[k] = (...a) => __time('walks', f, null, a);
}
export const __reset = () => { __T.clear(); __calls = 0; };
`;
  const dir = mkdtempSync(join(tmpdir(), 'analyze-bench-'));
  const file = join(dir, 'emitter-v1.js');
  writeFileSync(file, t);
  return dir;
}

const dir = instrument();
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const file = join(dir, 'emitter-v1.js');
const V1 = await import(file);

// The timer's own cost per outermost call, subtracted from the group.
function timerCost() {
  const n = 200000;
  let sink = 0;
  const s = performance.now();
  for (let i = 0; i < n; i++) { const a = performance.now(); sink += performance.now() - a; }
  const per = (performance.now() - s) / n;
  // The sum keeps the timed pair observable to the optimizer.
  if (sink < 0) throw new Error('analyze-bench: the clock ran backwards');
  return per;
}

const heap = () => { Bun.gc(true); return heapStats().heapSize; };
const inputs = [...packageInputs(root), ...(await rowInputs(root))];
const fmt = (ms) => `${ms.toFixed(1)} ms`;

for (const face of ['js', 'ts']) {
  const pop = [];
  for (const { src, path } of inputs) {
    let p;
    try { p = parseSource(src, { path, face }); } catch { continue; }
    try {
      V1.emit(p.result, { source: p.source, face, dataPayload: p.dataPayload, modulePath: path });
      analyze(p.result, { source: p.source, face });
    } catch { continue; }
    pop.push(p);
  }
  const t0 = performance.now();
  const stores = pop.map((p) => new Stores(p.result.stores));
  const storesMs = performance.now() - t0;

  const v1Pass = () => {
    V1.__reset();
    const s = performance.now();
    for (const p of pop) V1.emit(p.result, { source: p.source, face, dataPayload: p.dataPayload, modulePath: p.path });
    return { total: performance.now() - s, walks: V1.__T.get('walks') ?? 0, shape: V1.__T.get('shape') ?? 0, calls: V1.__calls };
  };
  const anPass = () => {
    const s = performance.now();
    for (let i = 0; i < pop.length; i++) analyze(pop[i].result, { source: pop[i].source, face, stores: stores[i] });
    return performance.now() - s;
  };
  v1Pass(); anPass();
  let best1 = null;
  let bestA = Infinity;
  const orders = [['v1', 'an'], ['an', 'v1']];
  for (let r = 0; r < rounds; r++) {
    for (const side of orders[r % orders.length]) {
      if (side === 'v1') {
        const x = v1Pass();
        if (best1 === null || x.walks + x.shape < best1.walks + best1.shape) best1 = x;
      } else {
        bestA = Math.min(bestA, anPass());
      }
    }
  }
  const cost = timerCost();
  const walks = best1.walks - best1.calls * cost;
  const base = walks + best1.shape;

  const h0 = heap();
  const held = pop.map((p, i) => analyze(p.result, { source: p.source, face, stores: stores[i] }));
  const h1 = heap();
  const shapes = pop.map((p) => emitterShape(p.result.sexpr, new WeakMap()));
  const h2 = heap();

  console.log(`\nface ${face}: ${pop.length} programs, best of ${rounds} interleaved rounds`);
  console.log(`  v1 replaced walks      ${fmt(walks)} (${best1.calls} timed calls, ${(cost * 1e6).toFixed(0)} ns each subtracted)`);
  console.log(`  v1 emitterShape        ${fmt(best1.shape)}`);
  console.log(`  analyze.js             ${fmt(bestA)}  = ${(100 * bestA / walks).toFixed(1)}% of the replaced walks, ${(100 * bestA / base).toFixed(1)}% of walks + emitterShape`);
  console.log(`  Stores construction    ${fmt(storesMs)} (shared by both sides, outside both timings)`);
  console.log(`  retained               analyze.js facts ${((h1 - h0) / 1e6).toFixed(1)} MB; emitterShape trees ${((h2 - h1) / 1e6).toFixed(1)} MB`);
  held.length = 0;
  shapes.length = 0;
}
