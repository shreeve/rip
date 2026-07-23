// The TS-face drift-detection generator :
// seeded, deterministic random programs across the M8/M10-B annotated
// surface. The strip gate structurally prevents byte drift, but only
// for corpus-exercised features — this layer generates programs the
// corpus never spelled and asserts the three face properties per
// program (test/fuzz-tsface.test.js, the extended tier):
//   1. stripFace(tsFace) === JS-mode bytes (both runtime deliveries)
//   2. every annotated construct produces ≥1 TS-only region — the
//      DRIFT DETECTOR: an emission path that silently stops emitting
//      TS bytes for a construct class fails here by construct name
//   3. the composed faces are tsc-clean (one batched program)
//
// Standalone: `bun scripts/fuzz-tsface.mjs <seed>` prints the seed's
// program, its TS face, and the recorded regions — the reproduction
// path the test names on failure.
//
// Every construct is TYPE-CORRECT by construction (values match
// their annotations — tsc-cleanliness is a property, not luck) and
// programs separate constructs with plain assignment lines: adjacent
// `name:` statement lines form one sibling RUN deciding
// all-or-nothing, so the separators keep each construct's
// claim — and its face regions — attributable to that construct
// alone.
import { compile } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';

// mulberry32 — deterministic, seedable, good-enough dispersion for
// construct selection.
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];

// (typeText, valueText) pairs — the value INHABITS the type, so a
// declaration `x: T = v` checks clean.
const SCALARS = [
  ['number', '42'],
  ['string', '"s"'],
  ['boolean', 'true'],
  ['number[]', '[1, 2]'],
  ['string[]', '["a"]'],
  ['Array<boolean>', '[true]'],
  ['Map<string, number>', 'new Map()'],
  ['{a: number, b?: string}', '{a: 1}'],
];

const typedPair = (rng) => {
  if (rng() < 0.2) {
    // A union: the value inhabits the FIRST arm.
    const [t1, v1] = pick(rng, SCALARS);
    let [t2] = pick(rng, SCALARS);
    if (t2 === t1) t2 = t1 === 'number' ? 'string' : 'number';
    return [`${t1} | ${t2}`, v1];
  }
  return pick(rng, SCALARS);
};

// Construct generators: each returns { kind, source } — a
// self-contained, type-correct fragment whose annotations must
// surface in the TS face. `id` uniquifies every binding it mints.
const CONSTRUCTS = [
  (rng, id) => {
    const [t, v] = typedPair(rng);
    return { kind: 'typed declaration', source: `d${id}: ${t} = ${v}\nd${id} = ${v}\n` };
  },
  (rng, id) => {
    // A typed prototype member: the annotation surfaces as the
    // augmentation line (TS-only), and the write checks against it.
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'typed prototype member',
      source: `Array::pm${id}: () => ${t} = -> ${v}\n`,
    };
  },
  (rng, id) => {
    const [t, v] = typedPair(rng);
    return { kind: 'bare typed forward', source: `w${id}: ${t}\nw${id} = ${v}\n` };
  },
  (rng, id) => {
    // A sibling run: adjacent bare forwards claim as one unit —
    // every member type-shaped, every name assigned later.
    const [t, v] = typedPair(rng);
    const [t2, v2] = pick(rng, SCALARS);
    return {
      kind: 'sibling run of bare typed forwards',
      source: `u${id}: ${t}\nv${id}: ${t2}\nu${id} = ${v}\nv${id} = ${v2}\n`,
    };
  },
  (rng, id) => {
    const [t, v] = typedPair(rng);
    return { kind: 'exported typed declaration', source: `export e${id}: ${t} = ${v}\n` };
  },
  (rng, id) => {
    const [t, v] = typedPair(rng);
    const [t2, v2] = pick(rng, SCALARS);
    return {
      kind: 'def with typed params/default/return',
      source: `def f${id}(a: ${t}, b: ${t2} = ${v2}): ${t2}\n  ${v2}\nf${id}(${v})\n`,
    };
  },
  (rng, id) => ({
    kind: 'async def return (Promise spelling)',
    source: `def g${id}(a: number): number\n  await a\ng${id}(1)\n`,
  }),
  (rng, id) => ({
    kind: 'void def',
    source: `def s${id}!(x: number)\n  x\ns${id}(1)\n`,
  }),
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'arrow with typed param and return',
      source: `a${id} = (x: ${t}): ${t} -> ${v}\na${id}(${v})\n`,
    };
  },
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'typed rest params',
      source: `r${id} = (...xs: ${t}[]) -> xs.length\nr${id}(${v}, ${v})\n`,
    };
  },
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'class with typed field and method return',
      source: `class C${id}\n  x: ${t} = ${v}\n  m: (v: number): number -> v + 1\nc${id} = new C${id}()\nc${id}.m(2)\n`,
    };
  },
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'inline type alias + annotated use',
      source: `type A${id} = {k: ${t}}\nu${id}: A${id} = {k: ${v}}\nu${id} = {k: ${v}}\n`,
    };
  },
  (rng, id) => ({
    kind: 'block union alias + annotated use',
    source: `type B${id} =\n  | "on"\n  | "off"\nb${id}: B${id} = "on"\nb${id} = "off"\n`,
  }),
  (rng, id) => {
    const [t] = pick(rng, SCALARS);
    return {
      kind: 'interface + typed param use',
      source: `interface I${id}\n  x: ${t}\n  m(v: number): void\np${id} = (q: I${id}) -> q.x\n`,
    };
  },
  (rng, id) => ({
    kind: 'generic interface (constrained)',
    source: `interface G${id}<T extends string>\n  x: T\nh${id} = (q: G${id}<"k">) -> q.x\n`,
  }),
  (rng, id) => ({
    kind: 'enum + type companion use',
    source: `enum E${id}\n  red = 0\n  green = 1\nn${id}: E${id} = E${id}.red\nn${id} = E${id}.green\n`,
  }),
  (rng, id) => ({
    kind: 'def-sig overloads',
    source: `def o${id}(a: number): string\ndef o${id}(a: string): string\ndef o${id}(a)\n  String(a)\no${id}(1).length\n`,
  }),
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'typed reactive state + computed',
      source: `q${id}: number := 0\nt${id}: number ~= q${id} * 2\nq${id} = t${id} + 1\n`,
    };
  },
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'typed readonly',
      source: `y${id}: ${t} =! ${v}\n`,
    };
  },
  (rng, id) => {
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'cast (value form)',
      source: `j${id} = JSON.parse("[]")\nk${id} = j${id} as ${t}\n`,
    };
  },
  (rng, id) => ({
    kind: 'cast (member head)',
    source: `m${id} = JSON.parse("{}")\nl${id} = (m${id} as {name: string}).name\nl${id} = "z"\n`,
  }),
  (rng, id) => ({
    // The balance boundary: a comparison of a cast result spells its
    // parens (the cast run ends at the `)`); the face renders the
    // cast TS-only and the comparison survives the strip.
    kind: 'cast then comparison (parenthesized)',
    source: `z${id} = JSON.parse("1")\nv${id} = (z${id} as number) < 5\nv${id} = false\n`,
  }),
  (rng, id) => {
    // A directive above a violating typed declaration: the
    // value deliberately inhabits a DIFFERENT scalar, so the face
    // draws TS2322 on the assignment line without the directive and
    // checks clean with it — placement drift in either direction
    // fails the composed tsc batch (TS2322 or TS2578).
    const [t, v] = pick(rng, SCALARS);
    let [t2, v2] = pick(rng, SCALARS);
    if (t2 === t) [t2, v2] = t === 'number' ? ['string', '"s"'] : ['number', '42'];
    return {
      kind: 'ts-expect-error directive above a violating typed declaration',
      source: `# @ts-expect-error fuzz-planted violation\nx${id}: ${t} = ${v2}\nx${id} = ${v}\n`,
    };
  },
  (rng, id) => {
    // The @ts-ignore twin: same placement mechanics, and unlike
    // expect-error it can never draw TS2578 — the composed batch
    // fails only if the suppression itself stops landing (TS2322).
    const [t, v] = pick(rng, SCALARS);
    let [t2, v2] = pick(rng, SCALARS);
    if (t2 === t) [t2, v2] = t === 'number' ? ['string', '"s"'] : ['number', '42'];
    return {
      kind: 'ts-ignore directive above a violating typed declaration',
      source: `# @ts-ignore fuzz-planted violation\ny${id}: ${t} = ${v2}\ny${id} = ${v}\n`,
    };
  },
  (rng, id) => ({
    // Always-place: the directive emits above the
    // switch-valued declaration's multi-line lowering, so the code
    // beneath carries a REAL violation for it to suppress — the
    // composed batch stays clean, and a directive that failed to
    // place would surface the TS2322 instead.
    kind: 'placed directive above a switch-valued declaration',
    source: `k${id}: number = 1\n# @ts-expect-error fuzz-planted violation\ns${id}: number = switch k${id}\n  when 1 then "a"\n  else "b"\ns${id} = 42\n`,
  }),
  (rng, id) => ({
    // Single-name hoist placement, exercised composedly: the def
    // body is its own scope, so its hoist line carries exactly one
    // name and the directive places even inside a composed program —
    // suppressing the forward's TS2304.
    kind: 'directive above a single-name forward in a def scope',
    source: `def h${id}()\n  # @ts-expect-error fuzz-forward\n  w: Missing${id}\n  w = 1\n  w\nh${id}()\n`,
  }),
  (rng, id) => {
    // Types-gaps wave: a type alias inside a LOWERED value body — the
    // try-IIFE has real statement slots, so the alias renders as a
    // TS-only cluster line INSIDE the IIFE and the cast beneath it
    // resolves (an erased alias would draw TS2304 on the batch).
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'type alias in a lowered value body (IIFE)',
      source: `r${id} = try\n  type L${id} = ${t}\n  ${v} as L${id}\ncatch c${id}\n  ${v}\nr${id} = ${v}\n`,
    };
  },
  (rng, id) => {
    // The slotless twin: a ternary-lowered branch has no statement
    // slot, so the alias flushes to the enclosing statement list
    // (pendingTypeDecls) — TS hoists type declarations, so the
    // displaced line still governs the cast in the ternary arm.
    const [t, v] = pick(rng, SCALARS);
    return {
      kind: 'type alias in a ternary-lowered branch (hoisted flush)',
      source: `f${id}: number = 1\ng${id} = if f${id} == 1\n  type M${id} = ${t}\n  ${v} as M${id}\nelse\n  ${v}\ng${id} = ${v}\n`,
    };
  },
  (rng, id) => {
    // M11-D: a validation schema's type story — the intrinsic block,
    // the alias, the binding cast, and a typed use of the parse
    // result all ride TS-only regions (the drift detector's stake in
    // the schema surface).
    const req = pick(rng, ['string', 'integer', 'boolean']);
    const tsOf = { string: 'string', integer: 'number', boolean: 'boolean' };
    return {
      kind: 'schema validation type story (alias + cast + typed parse result)',
      source: `Sv${id} = schema :shape\n  val! ${req}\np${id} = Sv${id}.parse({})\nt${id}: ${tsOf[req]} = p${id}.val\nt${id} = p${id}.val\n`,
    };
  },
  (rng, id) => ({
    // M11-D: a :model's type story — ModelSchema statics, the typed
    // query chain over declared columns, and the hook's TS-only
    // `this` parameter.
    kind: 'schema :model type story (query chain + hook this-param)',
    source: `Mo${id} = schema :model\n  name! string\n  @timestamps\n  beforeSave: -> @name = @name.trim()\nq${id} = Mo${id}.where(name: "a").first()\n`,
  }),
  (rng, id) => {
    // M12-E: the component member-declare surface — every non-callable
    // member kind gains a TS-only `declare` line, methods annotate
    // through the shared machinery, and the companion interface types
    // an annotated use.
    const [t, v] = typedPair(rng);
    return {
      kind: 'component member declares (typed members through the face)',
      source: `Ca${id} = component\n  n${id}: ${t} := ${v}\n  d${id}: ${t} ~= n${id}\n  r${id}: ${t} =! ${v}\n  m${id} = (x: ${t}): ${t} -> x\nuse${id} = (c: Ca${id}) -> c.n${id}.value\nconsole.log Ca${id}, use${id}\n`,
    };
  },
  (rng, id) => {
    // M12-E: the props surface — optional/typed/required/defaulted
    // props render `name?: T | { value: T }` entries, bind slots, and
    // the required prop's union arm; a same-file child use composes
    // through the child protocol.
    const [t, v] = typedPair(rng);
    return {
      kind: 'component optional/required props (the props surface)',
      source: `Cb${id} = component\n  @req${id}: ${t}\n  @opt${id}?: ${t}\n  @def${id}: ${t} := ${v}\n  render\n    div.box\n      = @def${id}\nCc${id} = component\n  render\n    section\n      Cb${id} req${id}: ${v}\nconsole.log Cb${id}, Cc${id}\n`,
    };
  },
  (rng, id) => ({
    // M12-E: extends — the attribute surface for the extended tag, the
    // string index signature, and the runtime-root rest view.
    kind: 'component extends (attribute surface + rest)',
    source: `Cd${id} = component extends button\n  @label${id} := "go"\n  render\n    button.cta\n      = @label${id}\nconsole.log Cd${id}\n`,
  }),
];

// A seed's program: 3–7 constructs, plain-assignment separators
// between them (the sibling-guard constraint above).
export function generateProgram(seed) {
  const rng = mulberry32(seed);
  const count = 3 + Math.floor(rng() * 5);
  const constructs = [];
  const lines = [];
  for (let c = 0; c < count; c++) {
    const id = `${seed % 1000}x${c}`;
    const construct = pick(rng, CONSTRUCTS)(rng, id);
    constructs.push(construct);
    lines.push(construct.source);
    lines.push(`sep${id} = 0\n`);
  }
  return { seed, source: lines.join(''), constructs };
}

// The surface record: every construct kind the generator can emit —
// the test asserts a default run touches ALL of them, so the corpus
// size cannot quietly shrink below the surface it claims to cover.
export const CONSTRUCT_KINDS = CONSTRUCTS.map((g, i) => g(mulberry32(i + 1), `k${i}`).kind);

// Standalone reproduction: print a seed's program, face, and regions.
if (import.meta.main) {
  const seed = Number(process.argv[2] ?? 1);
  const { source, constructs } = generateProgram(seed);
  const faced = compile(source, { runtimeDelivery: 'none', face: 'ts' });
  const plain = compile(source, { runtimeDelivery: 'none' });
  console.log(`── seed ${seed}: ${constructs.length} constructs ──`);
  for (const c of constructs) console.log(`  • ${c.kind}`);
  console.log('── source ──');
  console.log(source);
  console.log('── TS face ──');
  console.log(faced.code);
  console.log('── regions ──');
  for (const [s, e] of faced.tsRegions) console.log(`  [${s}, ${e}) ${JSON.stringify(faced.code.slice(s, e))}`);
  console.log(`── strip === JS-mode bytes: ${stripFace(faced.code, faced.tsRegions) === plain.code} ──`);
}
