// The TS face's TypeScript-validity gate: the INDEPENDENT
// verification that face output is real TypeScript — `tsc` is the
// repository's pinned TypeScript (test/support/tsc.js resolveTsc),
// exactly as test/toolchain/dts-tsc.test.js runs the declaration gate.
// These tsc-spawning tiers run under the extended-tier script
// (`bun run test:all`); a missing install throws (loud), never skips.
//
// Two tiers, because the corpus is a COMPILATION fixture set, not a
// type-correct program set (files reference undefined names, mix types
// deliberately — an editor surfaces those as ordinary diagnostics):
//
//   1. SYNTAX floor, whole corpus: every face must PARSE as
//      TypeScript — no TS1xxx (grammar) diagnostics anywhere. Faces
//      compile under runtimeDelivery 'none' with the feature-runtime
//      names ambient-declared, and each file gains `export {}` so it
//      checks in module scope (isolating fixture globals from each
//      other and from lib.dom; the appended line is isolation idiom,
//      not part of the artifact under test).
//   2. CLEAN rows: self-contained typed programs must check with ZERO
//      diagnostics — annotations engage the checker for real — and a
//      deliberate violation must FAIL, so the gate has teeth.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { compile } from '../../src/compile.js';
import { describeExtended, EXTENDED } from '../support/extended.js';
import { tscBatch } from '../support/tscbatch.js';
import { resolveTsc } from '../support/tsc.js';

// tsc is the repository's pinned TypeScript (resolveTsc), resolved only
// in the extended tier that spawns it. A missing install throws here —
// loud, a broken environment — never a silent skip.
const TSC = EXTENDED ? resolveTsc() : null;
const TSC_TIMEOUT = 120_000;

// The feature-runtime names (set — reactive, schema, and the
// M12 component family), ambient-declared: faces compile under
// runtimeDelivery 'none' so the artifact under validation is the
// FACE, not the runtime bodies.
const AMBIENT =
 'declare const __state: any, __computed: any, __effect: any, __batch: any, ' +
 '__readonly: any, __setErrorHandler: any, __handleError: any, __catchErrors: any, ' +
 'getEffectSignal: any, __schema: any, SchemaError: any, registerCoercer: any, ' +
 '__Component: any, __pushComponent: any, __popComponent: any, setContext: any, ' +
 'getContext: any, hasContext: any, __clsx: any, __lis: any, __reconcile: any, ' +
 '__transition: any, __handleComponentError: any, __detach: any, __ownerFrame: any, ' +
 '__pushOwner: any, __popOwner: any, __detachRef: any;\n';

// tsc over a set of {name: text} files in a fresh temp dir; returns
// the combined diagnostic output. noImplicitAny stays OFF — unannotated
// Rip is legal, and the editor path suppresses the implicit-any family
// per-code instead (the gradual-typing posture — `SUPPRESSED_TS_CODES`
// in packages/vscode/src/translate.js).
const tscRun = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-tsface-'));
  try {
    const names = [];
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
      names.push(name);
    }
    // noImplicitAny pinned OFF explicitly (TS 6 CLI defaults it on):
    // unannotated Rip is legal, and the editor path suppresses the
    // implicit-any family per-code instead (the gradual-typing posture).
    const r = spawnSync(TSC, ['--noEmit', '--target', 'es2022', '--lib', 'es2022,dom', '--module', 'esnext', '--noImplicitAny', 'false', ...names], {
      cwd: dir,
      encoding: 'utf8',
    });
    if (r.error) {
      throw new Error(`cannot run tsc at ${TSC} (${r.error.message}) — try re-running \`bun install\``);
    }
    return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const corpusDir = join(import.meta.dir, '../corpus');
const corpusFiles = readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort();

// The rows run in the EXTENDED tier only; tsc is the repo's pinned
// TypeScript, so absence is a loud install error (resolveTsc throws),
// never a silent skip.
const describeTscExtended = describeExtended;

describeTscExtended('tier 1: every corpus TS face parses as TypeScript (no TS1xxx diagnostics)', () => {
  test('the whole corpus, one tsc program', () => {
    const files = { 'ambient.d.ts': AMBIENT };
    for (const f of corpusFiles) {
      const source = readFileSync(join(corpusDir, f), 'utf8');
      const faced = compile(source, { path: f, runtimeDelivery: 'none', face: 'ts' });
      files[f.replace(/\.rip$/, '.ts')] = `${faced.code}\nexport {};\n`;
    }
    const { output } = tscRun(files);
    const syntaxErrors = output.split('\n').filter((line) => /error TS1\d{3}:/.test(line));
    expect(syntaxErrors, `TS-face syntax errors:\n${syntaxErrors.join('\n')}`).toEqual([]);
  }, TSC_TIMEOUT);
});

const CLEAN_ROWS = [
    // hoisted-let typing: annotation reaches the declaration
 'x: number = 5\nx = 7',
 'r: Map<string, number>\nr = new Map()',
    // the TS2454 class stays quiet (definite-assignment
    // assertion): read-before-assign and conditional-assign-then-read
    // are LEGAL Rip (hoisted reads yield undefined) — annotating must
    // not make them diagnostics
 'y: number\nz = y\ny = 1',
 'flag = true\ny: number\nif flag\n  y = 1\nz = y',
    // params/returns/defaults/rests, async Promise spelling
 'def f(a: string, b: number = 2): boolean\n  b > 1 and a.length > 0\nf("s", 3)',
 'def go(a: number): number\n  await a\ngo(1)',
 'sum = (...xs: number[]) -> xs.length\nsum(1, 2)',
    // structured aliases/interfaces, generics, member use
 'type Opts = {a: number, b?: string}\npair = ({a, b}: Opts = {a: 2}) -> a\npair({a: 1, b: "s"})',
 'interface P<T extends string>\n  x: T\n  m(v: T): number\nuse = (p: P<"k">) -> p.m(p.x)',
    // overloads through the face
 'def pick(a: number): string\ndef pick(a: string): string\ndef pick(a)\n  String(a)\npick(1).length',
    // class surface
 'class A\n  x: number = 5\n  m: (v: number): number -> v + @x\na = new A()\na.m(2)',
    // enum + its type companion
 'enum Color\n  red = 0\n  green = 1\npick: Color = Color.red',
    // reactive containers/readonly/effect handles
 'count: number := 0\ntotal: number ~= count * 2\nro: string =! "s"\ncount = total + ro.length',
    // void definitions
 'def save!(x: number)\n  x\nsave(1)',
    // casts: the assertion reaches the checker — `items`
    // evolves to string[] from the cast, so the member chain types
 'raw = JSON.parse("[]")\nitems = raw as string[]\nk = items[0].length\nk = 2',
    // TS directive comments: each row carries a REAL violation
    // beneath its directive, so a clean check proves the directive
    // landed on the diagnostic-bearing line (the self-checking
    // property's positive half; TS2578 teeth below). Operands are
    // annotated because this gate pins noImplicitAny OFF — evolving-
    // let inference is the editor posture, not the gate's.
 'count: number = 3\nratio: number = 1.5\n# @ts-expect-error totals mix\nbadTotal: string = count + ratio',
 'name = "world"\nn: number\n# @ts-expect-error interpolation is a string\nn = "hi #{name}"',
 'items: string[] = ["a", "b"]\nflag: boolean\n# @ts-expect-error element is a string\nflag = items[0]',
    // the callback spelled `=>` keeps the whole statement on one face
    // line, so the directive governs the error directly. Its `->` twin
    // lowers to a multi-line function body and is pinned in PLACED_ROWS
    // instead, where WHERE the error lands is the thing under test.
 'items: number[] = [1, 2, 3]\n# @ts-expect-error reduce yields a number\ntotal: string = items.reduce(((acc, n) => acc + n), 0)',
 'type Pair = [number, string]\np: Pair\np = [1, "a"]\n# @ts-expect-error index 1 is the string arm\nk: number = p[1]',
 '# @ts-ignore\nbroken: number = "s"\nbroken = 2',
    // hoist-line placement: single-name only — the forward's
    // unresolved type (TS2304) fires on `let q!: Missing`, the one
    // line the directive governs
 '# @ts-expect-error unresolved forward type\nq: Missing\nq = 1',
    // cluster placement: the single-line alias body's TS2304 fires on
    // the scope-top cluster line the directive follows it to
 '# @ts-expect-error unresolved alias body\ntype X = Missing\nz = 1\nz = 2',
    // class member placement (the review-round HIGH): the field row
    // carries the violation, the directive sits directly above it
 'class A\n  # @ts-expect-error field violation\n  x: number = "s"\na = new A()',
    // file-level @ts-nocheck: the whole file skips checking
 '# @ts-nocheck\nx: number = 5\nx = "not a number"',
    // types-gaps wave: type declarations in LOWERED value bodies —
    // the alias renders inside the IIFE (statement slots exist), so
    // the cast beneath it resolves; an erased alias would draw TS2304
 'x = try\n  type T = number\n  v = 1 as T\n  v\ncatch e\n  0\nx = 2',
 'q: number = 1\nx = switch q\n  when 1\n    type S = string\n    "a" as S\n  else "b"\nx = "c"',
    // the SLOTLESS twin: a ternary-lowered branch's alias flushes to
    // the enclosing list — TS hoists type declarations, so the
    // displaced line still governs the arm's cast
 'q: number = 1\nc = q > 0\ng = if c\n  type M = number\n  1 as M\nelse\n  0\ng = 2',
    //  schema type story: the parse result carries the field
    // types (a validation kind), and every behavior split types
 'S = schema :shape\n  name! string\n  size? integer\n  label: (p) -> p + @name\np = S.parse({})\nn: string = p.name\nn = "z"',
    // :model — statics through ModelSchema, the typed query chain
    // over declared columns, relation accessors between same-file
    // models, and callable `this` (hook + scope) typed per (ii)
 'Org = schema :model\n  title! string\nUser = schema :model\n  name!  string\n  active? boolean\n  @timestamps\n  @belongs_to Org\n  beforeSave: -> @name = @name.trim()\n  @scope :live, -> @where(active: true)\nrun = ->\n  u = await User.find(1)\n  if u\n    s: string = u.name\n    org = await u.org()\n    t: string = org.title if org\n    rows = await User.live().where(name: "a").all()\n    made = await User.create(name: "n", orgId: 1)\n    s = made.name',
    // :enum narrows through the bare-member type guard; :union types
    // the parse result as the constituent union
 'Role = schema :enum\n  :admin\n  :viewer\nv = JSON.parse("x")\nr: Role = "admin"\nr = Role.parse(v)\nif Role.ok(v)\n  r = v',
 'Click = schema :shape\n  kind! "click"\n  x! integer\nScroll = schema :shape\n  kind! "scroll"\n  dy! integer\nEvent = schema :union\n  @on :kind\n  Click\n  Scroll\ne = Event.parse(JSON.parse("x"))\nn: number = if e.kind is "click" then e.x else e.dy\nn = 2',
    // the algebra generics: a derived schema types through TS's own
    // Pick/Omit (the face needs no emission for it)
 'Base = schema :shape\n  a! string\n  b? integer\nView = Base.omit("b")\nw = View.parse({})\ns: string = w.a\ns = "z"',
    //  the component member model — every member kind's declare,
    // methods/hooks, the ctor and _init props annotations, the
    // companion interface used as an annotation type
 'Counter = component\n  count := 0\n  @title: string\n  @max?: number\n  @step: number := 1\n  total: number ~= count * 2\n  limit: number =! 100\n  note = "n"\n  bump = (n: number): number -> count += n\n  mounted = -> 1\nuse = (c: Counter) -> c.count.value\nconsole.log Counter, use',
    //  a two-component program — child props in all three prop
    // classes, a child event binding, children through slot, extends —
    // the composed face checks clean
 'Chip = component\n  @label := "c"\n  fire = ->\n    @emit "pick", @label\n  render\n    span.chip\n      = @label\nDeck = component extends section\n  name := "n"\n  onPick = (e) -> 1\n  render\n    section.deck\n      Chip label: name, @pick: @onPick\n        "projected"\nconsole.log Chip, Deck',
    //  offer/accept + the dynamic render layer (swap/reconcile
    // scaffolding, bind, ref) stay quiet through the face
 'App = component\n  offer theme := "dark"\n  items := [1]\n  vis := true\n  sel := ""\n  el := null\n  onClick = -> vis = !vis\n  render\n    div\n      button @click\n      if vis\n        p "on"\n      ul\n        for item in items\n          li key: item\n            = item\n      input type: "text", value <=> sel\n      div ref: el\nSub = component\n  accept theme\n  render\n    span\n      = @theme\nconsole.log App, Sub',
    // The GPT addendum F1: a declared @children prop owns the key —
    // the face carries NO duplicate `children` entries (was TS2300 ×4
    // + TS2717 ×2 on this five-line legal component)
 'Child = component\n  @children: string\n  render\n    div "x"\nHost = component\n  msg := "hi"\n  render\n    section\n      Child children: msg\nconsole.log Child, Host',
];

// The clean rows check as ONE tsc program: one file per row,
// module-isolated by their appended `export {}`, diagnostics
// attributed back per row by tsc's file-prefixed output. Row faces
// compile only when the extended tier will consume them.
let cleanBatch = null;
const cleanFiles = { 'ambient.d.ts': AMBIENT };
if (EXTENDED && TSC) {
  for (const [i, src] of CLEAN_ROWS.entries()) {
    const faced = compile(src, { runtimeDelivery: 'none', face: 'ts' });
    cleanFiles[`row${i}.ts`] = `${faced.code}\nexport {};\n`;
  }
}
const runCleanBatch = () => {
  cleanBatch ??= tscBatch(TSC, cleanFiles, ['--module', 'esnext', '--noImplicitAny', 'false']);
  return cleanBatch;
};

describeTscExtended('the module marker: two non-module faces coexist in one program VERBATIM', () => {
  // The VERBATIM rows: these faces check as the EDITOR serves them —
  // no harness-appended `export {}` — because each non-module face
  // carries its OWN marker. Without it both would be global
  // scripts: shared top-level names redeclare (TS2451) and schema
  // intrinsic aliases duplicate (TS2300).
  test('no TS2451 between two PLAIN typed script files sharing top-level names', () => {
    const a = compile('count: number = 3\nratio: number = 1.5\ntotal = count + ratio\nconsole.log(total)', { runtimeDelivery: 'none', face: 'ts' });
    const b = compile('count: number = 10\ntotal: number = count * 2\nconsole.log(total)', { runtimeDelivery: 'none', face: 'ts' });
    expect(a.code.endsWith('\nexport {};\n')).toBe(true);
    expect(b.code.endsWith('\nexport {};\n')).toBe(true);
    const { output } = tscRun({ 'a.ts': a.code, 'b.ts': b.code });
    const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
    expect(errors, `verbatim plain faces should coexist:\n${errors.join('\n')}`).toEqual([]);
  }, TSC_TIMEOUT);

  test('no TS2300 between two schema-declaring script files', () => {
    const a = compile('Alpha = schema :model\n  name! string\nrun = -> Alpha.count()', { runtimeDelivery: 'none', face: 'ts' });
    const b = compile('Beta = schema :shape\n  size! integer\np = Beta.parse({})', { runtimeDelivery: 'none', face: 'ts' });
    expect(a.code.endsWith('\nexport {};\n')).toBe(true);
    expect(b.code.endsWith('\nexport {};\n')).toBe(true);
    const { output } = tscRun({ 'ambient.d.ts': AMBIENT, 'a.ts': a.code, 'b.ts': b.code });
    const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
    expect(errors, `verbatim schema faces should coexist:\n${errors.join('\n')}`).toEqual([]);
  }, TSC_TIMEOUT);

  test('component faces VERBATIM: two files declaring same-named components coexist (M12-E)', () => {
    // Each face carries its own marker, so the class bindings AND
    // the companion interfaces stay module-scoped — as global scripts
    // the interfaces would silently merge and the lets redeclare.
    const a = compile('Counter = component\n  count := 0\n  @title: string\nconsole.log Counter', { runtimeDelivery: 'none', face: 'ts' });
    const b = compile('Counter = component\n  count := "s"\n  @title: number\nconsole.log Counter', { runtimeDelivery: 'none', face: 'ts' });
    expect(a.code.endsWith('\nexport {};\n')).toBe(true);
    expect(b.code.endsWith('\nexport {};\n')).toBe(true);
    const { output } = tscRun({ 'ambient.d.ts': AMBIENT, 'a.ts': a.code, 'b.ts': b.code });
    const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
    expect(errors, `verbatim component faces should coexist:\n${errors.join('\n')}`).toEqual([]);
  }, TSC_TIMEOUT);

  test('cross-file component import VERBATIM: the consumer face checks the child\'s props (M12-E)', () => {
    // The editor's cross-file shape: the child mirrors as chip.rip.ts
    // and the parent face imports './chip.rip' — the tsconfig's
    // allowImportingTsExtensions posture, mirrored here. The exported
    // const carries the class type, so prop CHECKING crosses files.
    const chip = compile('export Chip = component\n  @size: number := 1\n  render\n    span.chip\n      = @size\n', { runtimeDelivery: 'none', face: 'ts', path: 'chip.rip' });
    const clean = compile('import { Chip } from "./chip.rip"\nApp = component\n  n := 2\n  render\n    div\n      Chip size: n\nconsole.log App\n', { runtimeDelivery: 'none', face: 'ts', path: 'app.rip' });
    const cleanRun = tscRun({
 'ambient.d.ts': AMBIENT,
 'chip.rip.ts': chip.code,
 'app.rip.ts': clean.code.replace('from "./chip.rip"', 'from "./chip.rip.ts"'),
    });
    const cleanErrors = cleanRun.output.split('\n').filter((line) => /error TS\d+:/.test(line))
      // allowImportingTsExtensions is unavailable as a bare CLI flag
      // on every pinned tsc; the extension-rewrite above plus
      // tolerating ONLY the TS5097 advisory keeps the row's teeth on
      // the PROP surface.
      .filter((line) => !line.includes('TS5097'));
    expect(cleanErrors, `cross-file component face should check clean:\n${cleanErrors.join('\n')}`).toEqual([]);
    // Teeth: a wrong-typed prop at the call site FAILS across files.
    const bad = compile('import { Chip } from "./chip.rip"\nApp = component\n  render\n    div\n      Chip size: "wide"\nconsole.log App\n', { runtimeDelivery: 'none', face: 'ts', path: 'app.rip' });
    const badRun = tscRun({
 'ambient.d.ts': AMBIENT,
 'chip.rip.ts': chip.code,
 'app.rip.ts': bad.code.replace('from "./chip.rip"', 'from "./chip.rip.ts"'),
    });
    expect(badRun.output).toContain('TS2322');
    // The container brand (F1): a plain `{ value: … }` literal at the
    // call site FAILS too — the runtime would double-wrap it; only
    // real containers (which carry `read()`) pass, and the parent's
    // bare-member pass above is exactly that cell.
    const literal = compile('import { Chip } from "./chip.rip"\nApp = component\n  render\n    div\n      Chip size: { value: 3 }\nconsole.log App\n', { runtimeDelivery: 'none', face: 'ts', path: 'app.rip' });
    const literalRun = tscRun({
 'ambient.d.ts': AMBIENT,
 'chip.rip.ts': chip.code,
 'app.rip.ts': literal.code.replace('from "./chip.rip"', 'from "./chip.rip.ts"'),
    });
    expect(/error TS2(322|353)/.test(literalRun.output)).toBe(true);
  }, TSC_TIMEOUT);

  test('a user interface merging with the companion: conflicts are LOUD, augmentation is silent ', () => {
    // TS declaration merging governs a user-written `interface
    // Counter` beside `Counter = component`: a CONFLICTING member
    // draws TS2717 visibly; a compatible member AUGMENTS the
    // instance type silently (arguably typing an untyped member).
    // carries the disposition — the companion keeps the
    // component's own name (renaming it would break the `c: Counter`
    // ergonomics for everyone to guard this rare collision).
    const conflict = compile('interface Counter\n  count: string\nCounter = component\n  count := 0\nconsole.log Counter\n', { runtimeDelivery: 'none', face: 'ts' });
    const conflictRun = tscRun({ 'ambient.d.ts': AMBIENT, 'a.ts': conflict.code });
    expect(conflictRun.output).toContain('TS2717');
    const augment = compile('interface Counter\n  extra: number\nCounter = component\n  count := 0\nconsole.log Counter\n', { runtimeDelivery: 'none', face: 'ts' });
    const augmentRun = tscRun({ 'ambient.d.ts': AMBIENT, 'a.ts': augment.code });
    expect(augmentRun.output.split('\n').filter((l) => /error TS\d+:/.test(l))).toEqual([]);
  }, TSC_TIMEOUT);

  test('the marker also scopes the INLINE runtime bindings (the TS2451 redeclare class, closed structurally)', () => {
    // Two inline-delivery faces each bind `const { __schema, … }`;
    // as modules the bindings are file-scoped. (Full inline faces
    // carry runtime-body hints beyond this gate's flags, so the pin
    // here is the structural one: both carry the marker.)
    const a = compile('Alpha = schema :shape\n  a! string', { runtimeDelivery: 'inline', face: 'ts' });
    const b = compile('Beta = schema :shape\n  b! string', { runtimeDelivery: 'inline', face: 'ts' });
    expect(a.code.endsWith('\nexport {};\n')).toBe(true);
    expect(b.code.endsWith('\nexport {};\n')).toBe(true);
  });
});

describeTscExtended('tier 2: self-contained typed faces check CLEAN — annotations engage the checker', () => {
  for (const [i, src] of CLEAN_ROWS.entries()) {
    test(JSON.stringify(src), () => {
      const errors = runCleanBatch().byFile.get(`row${i}.ts`);
      expect(errors, `tsc rejected the TS face:\n${errors.join('\n')}\n---\n${cleanFiles[`row${i}.ts`]}`).toEqual([]);
    }, TSC_TIMEOUT);
  }

  test('no diagnostic escapes row attribution — a global tsc error cannot vanish between rows', () => {
    expect(runCleanBatch().unattributed).toEqual([]);
  }, TSC_TIMEOUT);

  test('the gate has teeth: an annotation violation FAILS the check (TS2322)', () => {
    const faced = compile('x: number = 5\nx = "not a number"\n', { runtimeDelivery: 'none', face: 'ts' });
    const { status, output } = tscRun({ 'mod.ts': `${faced.code}\nexport {};\n` });
    expect(status).not.toBe(0);
    expect(output).toContain('TS2322');
  }, TSC_TIMEOUT);

  test('casts have teeth: an `as` assertion the erased face would hide FAILS the check (TS2322)', () => {
    // `raw` is any (JSON.parse), so the ERASED face checks clean —
    // only the cast's face bytes make the string→number violation
    // visible to the checker.
    const faced = compile('raw = JSON.parse("x")\nn: number = raw as string\n', { runtimeDelivery: 'none', face: 'ts' });
    const { status, output } = tscRun({ 'mod.ts': `${faced.code}\nexport {};\n` });
    expect(status).not.toBe(0);
    expect(output).toContain('TS2322');
  }, TSC_TIMEOUT);

  test('the assertion does not blunt the checker: a violation against a FORWARD annotation still fails (TS2322)', () => {
    // `let y!: number` suppresses only definite-assignment analysis
    // (TS2454); the declared type keeps checking every write.
    const faced = compile('y: number\ny = "not a number"\n', { runtimeDelivery: 'none', face: 'ts' });
    const { status, output } = tscRun({ 'mod.ts': `${faced.code}\nexport {};\n` });
    expect(status).not.toBe(0);
    expect(output).toContain('TS2322');
  }, TSC_TIMEOUT);

  test('unused directive above a class FIELD draws TS2578 — the self-check reaches class bodies', () => {
    const faced = compile('class A\n  # @ts-expect-error\n  x: number = 5\na = new A()\n', { runtimeDelivery: 'none', face: 'ts' });
    const { status, output } = tscRun({ 'mod.ts': `${faced.code}\nexport {};\n` });
    expect(status).not.toBe(0);
    expect(output).toContain('TS2578');
  }, TSC_TIMEOUT);

  test('the directive self-check has teeth: an @ts-expect-error with NO error beneath it FAILS (TS2578)', () => {
    // The unused-directive report is the property that keeps stale
    // directives visible — placement drift in either direction turns
    // a clean file red (TS2578 here, the suppressed error's code in
    // the clean rows above).
    const faced = compile('x: number = 5\n# @ts-expect-error\nx = 7\n', { runtimeDelivery: 'none', face: 'ts' });
    const { status, output } = tscRun({ 'mod.ts': `${faced.code}\nexport {};\n` });
    expect(status).not.toBe(0);
    expect(output).toContain('TS2578');
  }, TSC_TIMEOUT);

  test('the erased-statement disposition: an unused directive above a CLEAN type alias surfaces TS2578, never a swallow', () => {
    const faced = compile('z = 1\n# @ts-expect-error\ntype X = number\nz = 2\n', { runtimeDelivery: 'none', face: 'ts' });
    const { status, output } = tscRun({ 'mod.ts': `${faced.code}\nexport {};\n` });
    expect(status).not.toBe(0);
    expect(output).toContain('TS2578');
  }, TSC_TIMEOUT);

  test('the JS emission never sees the violation — the erased face stays silent (the M10-A gap, closed by the face)', () => {
    const plain = compile('x: number = 5\nx = "not a number"\n', { runtimeDelivery: 'none' });
    const { status } = tscRun({ 'mod.js': plain.code, 'mod.d.ts': 'declare let x: number;\n' });
    // The JS pair alone cannot catch the write — that is exactly why
    // the editor consumes the TS face.
    expect(plain.code).toContain('x = "not a number"');
    expect(typeof status).toBe('number');
  }, TSC_TIMEOUT);
});

// The PLACED rows: every directive reaches the face, and these pin where
// the error lands relative to the ONE generated line a directive governs.
// On the governed line → suppressed, clean. INSIDE a multi-line lowering →
// the inner error stays VISIBLE and `@ts-expect-error` additionally draws
// TS2578 — loud on both counts, never a silent swallow.
// Rows: [src, visibleCodes, expect2578].
const PLACED_ROWS = [
  // comprehension-valued: the error lives INSIDE the lowered IIFE —
  // visible, plus the unused-directive report
  ['items: string[] = ["a"]\n# @ts-expect-error\nbad = (s.nope() for s in items)\nbad = []', ['TS2339'], true],
  // switch-as-value: same class, error inside a branch
  ['k = 1\n# @ts-expect-error\nv = switch k\n  when 1 then "a".nope()\n  else "b"\nv = "c"', ['TS2339'], true],
  // the @ts-ignore variant: same visibility, and ignore never
  // reports unused
  ['items: string[] = ["a"]\n# @ts-ignore\nbad = (s.nope() for s in items)\nbad = []', ['TS2339'], false],
  // block-bodied callback (`->`): the TS2322 sits on the governed
  // declaration line — suppressed, clean
  ['items: number[] = [1, 2]\n# @ts-expect-error\ntotal: string = items.reduce(((acc, n) -> acc + n), 0)\ntotal = "s"', [], false],
  // multi-name forwards: the governed forward suppresses; the
  // sibling forward's unrelated error stays visible
  ['# @ts-expect-error\na: Missing\nb: AlsoMissing\na = 1\nb = 2', ['TS2304'], false],
];

describeTscExtended('the placed rows: every directive PLACES — suppression lands, siblings stay visible', () => {
  let batch = null;
  const files = { 'ambient.d.ts': AMBIENT };
  if (EXTENDED && TSC) {
    for (const [i, [src]] of PLACED_ROWS.entries()) {
      const faced = compile(src, { runtimeDelivery: 'none', face: 'ts' });
      files[`placed${i}.ts`] = `${faced.code}\nexport {};\n`;
    }
  }
  const runBatch = () => {
    batch ??= tscBatch(TSC, files, ['--module', 'esnext', '--noImplicitAny', 'false']);
    return batch;
  };

  for (const [i, [src, visibleCodes, expect2578]] of PLACED_ROWS.entries()) {
    test(JSON.stringify(src), () => {
      // The directive reaches the face (the always-place posture).
      expect(files[`placed${i}.ts`]).toContain('@ts-');
      const errors = runBatch().byFile.get(`placed${i}.ts`) ?? [];
      if (visibleCodes.length === 0) {
        // The governed error is suppressed; nothing else fires.
        expect(errors,
          `expected a clean file:\n${errors.join('\n')}\n---\n${files[`placed${i}.ts`]}`).toEqual([]);
      }
      for (const code of visibleCodes) {
        expect(errors.some((e) => e.includes(code)),
          `expected ${code} to stay visible:\n${errors.join('\n')}\n---\n${files[`placed${i}.ts`]}`).toBe(true);
      }
      expect(errors.some((e) => e.includes('TS2578'))).toBe(expect2578);
    }, TSC_TIMEOUT);
  }

  test('no diagnostic escapes placed-row attribution', () => {
    expect(runBatch().unattributed).toEqual([]);
  }, TSC_TIMEOUT);
});
