//  tsc validation harness: the generated declarations must be
// VALID TypeScript, asserted by the real validator. `tsc` is an
// external TOOL, deliberately never a dependency: located by the
// RIP_TSC environment variable or PATH
// discovery, never a package in the dependency graph.
//
// The floor policy : with tsc absent these
// tests SKIP with a loud notice — casual local runs never fail on a
// missing external tool — but RIP_REQUIRE_TSC=1 turns absence into a
// FAILURE, and the extended-tier script (`bun run test:all`, the contract —
// this file's rows are extended-tier, the loop that spawns tsc) sets
// it, so the validation environment can never go quietly toothless.
// The floor test below is NEVER skipped.
//
// Corpus-driven: every corpus file whose compile yields declarations
// contributes its .d.ts — the artifact under validation — to ONE tsc
// program: each row is its own file, isolated from the others
// by module scope (the appended `export {}` is isolation idiom, not
// part of the artifact), and every diagnostic attributes back to its
// row through tsc's file-prefixed output. tsc's default CLI
// configuration is deliberate: it reports implicit-any in declaration
// files (TS7006/TS7010), which is exactly the defect class (#67) this
// harness guards against.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { compile } from '../../src/compile.js';
import { describeExtended, EXTENDED } from '../support/extended.js';
import { tscBatch } from '../support/tscbatch.js';

const TSC = process.env.RIP_TSC ?? Bun.which('tsc');

// The batch-spawning test carries its own timeout: a cold tsc start
// under machine load can exceed the suite's per-test default.
const TSC_TIMEOUT = 60_000;
if (!TSC && !process.env.RIP_REQUIRE_TSC) {
  console.warn(
    '\n⚠ RIP_TSC is not set and no `tsc` is on PATH — the declaration-validity ' +
    'gate is SKIPPED. Install TypeScript or point RIP_TSC at a tsc executable to run it.\n',
  );
}

describe('the tsc floor (never skipped)', () => {
  test('RIP_REQUIRE_TSC=1 makes a missing tsc a FAILURE — the extended-tier script sets it', () => {
    if (process.env.RIP_REQUIRE_TSC && !TSC) {
      throw new Error(
        'RIP_REQUIRE_TSC is set but no tsc was found (set RIP_TSC or put tsc on PATH) — ' +
        'the declaration-validity gate cannot run in a required-validation environment',
      );
    }
    // Absent the requirement, absence skips (the loud notice above) —
    // asserted so the policy itself cannot drift silently.
    expect(Boolean(TSC) || !process.env.RIP_REQUIRE_TSC).toBe(true);
  });
});

const corpusDir = join(import.meta.dir, '../corpus');
const corpusFiles = readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort();

// The rows run in the EXTENDED tier only ,
// and only with a tsc located; absence stays loud under
// RIP_REQUIRE_TSC through the floor test above.
const describeTscExtended = TSC ? describeExtended : describe.skipIf(true);

const HAND_ROWS = [
  // exported forms, overloads, classes with the full member mix
  'export x: number = 5\nexport def f(a: number): string\n  "s"',
  'def f(a: number): string\ndef f(a: string): string\ndef f(a)\n  String(a)',
  'type Opts = {a: number, b?: string}\npair = ({a, b}: Opts = {a: 2}) -> a',
  'interface P\n  m(x: number): void\n  y: number\nz = 1',
  'class A\n  x: number = 5\n  @k: string = "s"\n  m: (v: number): number -> v\n  save!: (v: number) ->\n    v\n  constructor: (a: number) ->\n    @a = a',
  'save! = (x) -> x\ntick! = -> 1',
  'r: number\nr = 5',
  // rest parameters: every accepted array-shaped annotation
  // spelling, unions of arrays included
  'f = (...xs: number[]) -> xs\ng = (...ys: [number, string]) -> ys\nh = (...zs: Array<boolean>) -> zs\nk = (...ws: ReadonlyArray<string>) -> ws\nu = (...vs: number[] | string[]) -> vs',
  // the block-alias object-member grammar, end to end under tsc
  'type M =\n  [key: string]: number\ntype C =\n  (x: number): string\ntype Q =\n  "a-b": string\n  0: boolean\ntype R2 =\n  readonly x: number\nm: M = {}\nz = 1',
  // enum declarations: numeric, string, negative, exported —
  // and the enum NAME usable in type position
  'enum Color\n  red = 0\n  green = 1\nexport enum Tier\n  free = "f"\nenum Dir\n  up = 1\n  down = -1\npick: Color = Color.red',
  // typed reactive declarations: the annotation types the
  // container's `.value` slot (state mutable, computed readonly) —
  // exported and module-internal
  'export count: number := 0\nexport total: number ~= count * 2\nlabel: string := "tag"',
];

// The whole gate's rows — corpus declarations and hand rows — as one
// tsc program, spawned ONCE on first use. Each row test then
// asserts ITS file's diagnostics, so failure attribution is exactly
// per-row invocation's. Row construction compiles the corpus, so it
// runs only when the extended tier will consume it — the fast loop
// pays nothing.
let batch = null;
const declared = [];
const files = {};
if (EXTENDED && TSC) {
  for (const file of corpusFiles) {
    const source = readFileSync(join(corpusDir, file), 'utf8');
    const result = compile(source, { path: file });
    if (result.declarations === '') continue;
    declared.push(file);
    files[file.replace(/\.rip$/, '.d.ts')] = `${result.declarations}export {};\n`;
  }
  for (const [i, src] of HAND_ROWS.entries()) {
    const result = compile(src);
    files[`row${i}.d.ts`] = `${result.declarations}export {};\n`;
  }
}
const runBatch = () => { batch ??= tscBatch(TSC, files); return batch; };

describeTscExtended('tsc validates every corpus file\'s declarations', () => {
  for (const file of declared) {
    test(file, () => {
      const errors = runBatch().byFile.get(file.replace(/\.rip$/, '.d.ts'));
      expect(errors, `tsc rejected ${file}'s declarations:\n${errors.join('\n')}\n---\n${files[file.replace(/\.rip$/, '.d.ts')]}`).toEqual([]);
    }, TSC_TIMEOUT);
  }

  test('the gate is not vacuous: typed corpus files exist and were validated', () => {
    expect(declared).toContain('types.rip');
    expect(declared).toContain('typedecls.rip');
    expect(declared).toContain('voidmarker.rip');
    expect(declared).toContain('enum.rip');
  });

  test('no diagnostic escapes row attribution — a global tsc error cannot vanish between rows', () => {
    expect(runBatch().unattributed).toEqual([]);
  }, TSC_TIMEOUT);
});

describeTscExtended('tsc validates the hand rows the corpus does not carry', () => {
  for (const [i, src] of HAND_ROWS.entries()) {
    test(JSON.stringify(src), () => {
      expect(files[`row${i}.d.ts`]).not.toBe('export {};\n');
      const errors = runBatch().byFile.get(`row${i}.d.ts`);
      expect(errors, `tsc rejected:\n${errors.join('\n')}\n---\n${files[`row${i}.d.ts`]}`).toEqual([]);
    }, TSC_TIMEOUT);
  }

  test('the harness itself catches invalid TypeScript (a known-invalid shape fails as it should)', () => {
    // the implicit-any spelling — the exact artifact class the gate
    // exists to reject, in the same module-scoped file shape the
    // batch checks. If this passes tsc, the gate proves nothing.
    const { status, byFile } = tscBatch(TSC, { 'bad.d.ts': 'declare function f(a);\nexport {};\n' });
    expect(status).not.toBe(0);
    expect(byFile.get('bad.d.ts')).not.toEqual([]);
  }, TSC_TIMEOUT);
});

describeTscExtended('component declarations: consumer programs check against the shipped .d.ts', () => {
  // The consumer story the .d.ts exists for: a TypeScript program
  // importing a compiled component module sees the class shape —
  // typed construction, the instance surface, the companion type.
  const componentDts = () => compile([
    'export Counter = component',
    '  count := 0',
    '  @title: string',
    '  @step: number := 1',
    '  bump = (n: number): number -> count += n',
    '',
  ].join('\n')).declarations;

  test('a consumer constructs, mounts, reads members, and annotates with the companion type — clean', () => {
    const consumer = [
      "import { Counter } from './counter';",
      "const c = new Counter({ title: 'hello', step: 2 });",
      "c.mount('#app');",
      'const n: number = c.bump(1);',
      'const t: Counter = c;',
      'console.log(n, t.count.value, c.title.value.length);',
      'export {};',
      '',
    ].join('\n');
    const { status, byFile, unattributed } = tscBatch(TSC, {
      'counter.d.ts': componentDts(),
      'consumer.ts': consumer,
    });
    expect(byFile.get('consumer.ts')).toEqual([]);
    expect(unattributed).toEqual([]);
    expect(status).toBe(0);
  }, TSC_TIMEOUT);

  test('the gate has teeth: a wrong-typed prop and a missing required prop both FAIL', () => {
    const bad = [
      "import { Counter } from './counter';",
      'new Counter({ title: 3 });',
      'new Counter({ step: 1 });',
      'export {};',
      '',
    ].join('\n');
    const { status, byFile } = tscBatch(TSC, {
      'counter.d.ts': componentDts(),
      'consumer.ts': bad,
    });
    expect(status).not.toBe(0);
    expect(byFile.get('consumer.ts').length).toBeGreaterThanOrEqual(2);
  }, TSC_TIMEOUT);

  test('the container brand (F1): plain { value } literals REJECT on both spellings; a real container passes', () => {
    // The double-wrap hole: the runtime's container detection is
    // `typeof x.read === 'function'` — a plain `{ value: 'x' }` is
    // not signal-shaped, so `__state(props.title ?? …)` would WRAP
    // it and `.value` becomes the object while the declared type
    // said string. The branded container type (`read(): T` — the
    // predicate itself) makes both literal spellings type errors,
    // while a REAL container (another module's exported reactive,
    // whose .d.ts carries the same brand) still passes.
    const reactiveDts = compile('export label: string := "x"').declarations;
    expect(reactiveDts).toContain('export declare const label: { value: string; read(): string };');
    const bad = [
      "import { Counter } from './counter';",
      "new Counter({ title: { value: 'x' } });",
      "new Counter({ title: 'ok', __bind_title__: { value: 'x' } });",
      'export {};',
      '',
    ].join('\n');
    const badRun = tscBatch(TSC, { 'counter.d.ts': componentDts(), 'consumer.ts': bad });
    expect(badRun.status).not.toBe(0);
    expect(badRun.byFile.get('consumer.ts').length).toBeGreaterThanOrEqual(2);
    const good = [
      "import { Counter } from './counter';",
      "import { label } from './labels';",
      'new Counter({ title: label });',
      'new Counter({ __bind_title__: label });',
      'export {};',
      '',
    ].join('\n');
    const goodRun = tscBatch(TSC, {
      'counter.d.ts': componentDts(),
      'labels.d.ts': reactiveDts,
      'consumer.ts': good,
    });
    expect(goodRun.byFile.get('consumer.ts')).toEqual([]);
    expect(goodRun.status).toBe(0);
  }, TSC_TIMEOUT);

  test('static mount under a required prop (F2): absent from the .d.ts — the call FAILS; the optional-props twin keeps it', () => {
    const requiredCall = [
      "import { Counter } from './counter';",
      "Counter.mount('#app');",
      'export {};',
      '',
    ].join('\n');
    const { status, byFile } = tscBatch(TSC, { 'counter.d.ts': componentDts(), 'consumer.ts': requiredCall });
    expect(status).not.toBe(0);
    expect(byFile.get('consumer.ts').length).toBeGreaterThanOrEqual(1);
    const optionalDts = compile('export Chip = component\n  @label := "c"\n').declarations;
    const optionalCall = [
      "import { Chip } from './chip';",
      "Chip.mount('#app');",
      'export {};',
      '',
    ].join('\n');
    const ok = tscBatch(TSC, { 'chip.d.ts': optionalDts, 'consumer.ts': optionalCall });
    expect(ok.byFile.get('consumer.ts')).toEqual([]);
    expect(ok.status).toBe(0);
  }, TSC_TIMEOUT);

  test('a declared @children prop checks in consumer programs — no duplicate keys (the GPT addendum, F1)', () => {
    const dts = compile('export Child = component\n  @children: string\n  render\n    div "x"\n').declarations;
    const consumer = [
      "import { Child } from './child';",
      "new Child({ children: 'hello' }).mount('#a');",
      'export {};',
      '',
    ].join('\n');
    const ok = tscBatch(TSC, { 'child.d.ts': dts, 'consumer.ts': consumer });
    expect(ok.byFile.get('child.d.ts')).toEqual([]);
    expect(ok.byFile.get('consumer.ts')).toEqual([]);
    expect(ok.status).toBe(0);
  }, TSC_TIMEOUT);

  test('an extends component accepts arbitrary rest keys in consumer programs', () => {
    const dts = compile('export Btn = component extends button\n  @label := "go"\n  render\n    button\n      = @label\n').declarations;
    const consumer = [
      "import { Btn } from './btn';",
      "new Btn({ label: 'x', disabled: true, 'data-k': 1, anything: 2 }).mount('#a');",
      'export {};',
      '',
    ].join('\n');
    const { status, byFile } = tscBatch(TSC, { 'btn.d.ts': dts, 'consumer.ts': consumer });
    expect(byFile.get('consumer.ts')).toEqual([]);
    expect(status).toBe(0);
  }, TSC_TIMEOUT);
});

describeTscExtended('the module marker: two non-module .d.ts artifacts coexist in one program VERBATIM', () => {
  // The .d.ts twin of the face's VERBATIM rows: artifacts check as
  // the compiler ships them — no harness-appended `export {}` —
  // because each program's .d.ts carries its OWN marker unless an
  // emitted line already scopes it. Without it both would be global
  // scripts and the shared `declare let` bindings would redeclare
  // (TS2451).
  const cleanPair = (a, b) => {
    const { status, byFile, unattributed } = tscBatch(TSC, { 'a.d.ts': a, 'b.d.ts': b });
    expect(byFile.get('a.d.ts')).toEqual([]);
    expect(byFile.get('b.d.ts')).toEqual([]);
    expect(unattributed).toEqual([]);
    expect(status).toBe(0);
  };

  test('no TS2451 between two plain typed declaration files sharing names', () => {
    const a = compile('count: number = 3\ntotal: number = 4').declarations;
    const b = compile('count: number = 10\ntotal: number = 20').declarations;
    expect(a.endsWith('export {};\n')).toBe(true);
    expect(b.endsWith('export {};\n')).toBe(true);
    cleanPair(a, b);
  }, TSC_TIMEOUT);

  // The ARTIFACT gate's reason to exist: source module shape whose
  // every indicator ERASES from the declaration artifact. A source-
  // shaped gate suppresses the marker on all three rows below and
  // ships colliding global scripts.
  test('import + typed binding: import lines never emit — the artifacts still carry the marker (no TS2451)', () => {
    const a = compile('import { k } from "./other.js"\ntotal: number = k\ntotal = 2').declarations;
    const b = compile('import { j } from "./another.js"\ntotal: number = j\ntotal = 3').declarations;
    expect(a).toBe('declare let total: number;\nexport {};\n');
    expect(b).toBe('declare let total: number;\nexport {};\n');
    cleanPair(a, b);
  }, TSC_TIMEOUT);

  test('untyped export + typed binding: the export contributes no declaration line — the marker still appends (no TS2451)', () => {
    const a = compile('export version = 1\ntotal: number = 5').declarations;
    const b = compile('export revision = 2\ntotal: number = 6').declarations;
    expect(a).toBe('declare let total: number;\nexport {};\n');
    expect(b).toBe('declare let total: number;\nexport {};\n');
    cleanPair(a, b);
  }, TSC_TIMEOUT);

  test('the silent-merge variant: same-named interfaces stay module-scoped — global scripts would merge them (TS2717 on conflict)', () => {
    const a = compile('import { k } from "./other.js"\ninterface P\n  x: number\nz = k\nconsole.log z').declarations;
    const b = compile('import { j } from "./another.js"\ninterface P\n  x: string\nw = j\nconsole.log w').declarations;
    expect(a.endsWith('export {};\n')).toBe(true);
    expect(b.endsWith('export {};\n')).toBe(true);
    // Module-scoped: the CONFLICTING members coexist cleanly. As
    // global scripts the same pair draws TS2717 (and identical
    // members would merge silently — no diagnostic, wrong types).
    cleanPair(a, b);
    const stripped = (t) => t.replace(/^export \{\};\n/m, '');
    const { status } = tscBatch(TSC, { 'a.d.ts': stripped(a), 'b.d.ts': stripped(b) });
    expect(status).not.toBe(0); // the script shape the marker prevents
  }, TSC_TIMEOUT);
});
