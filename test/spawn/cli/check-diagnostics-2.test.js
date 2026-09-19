// `rip check` — type diagnostics over the real server, part 2 of 3
// (see check-diagnostics-1.test.js for why the describe is split). The
// runner and workspace builders live in ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { TSCONFIG, workspace, check } from './support/check-harness.js';

describeExtended('rip check: type diagnostics over the real server', () => {
  // The manifest is the audit's INPUT, not a filter over whatever else got
  // compiled: the published entries are read first and become the compile
  // targets. Each case here is a way the old direction — audit what the
  // ordinary check happened to cover — turned the mode's answer wrong.
  test('--public reads the manifest first: a named entry that is missing is the finding, not an empty run', () => {
    // No .rip file exists anywhere, so a file-first walk finds nothing to
    // check and calls the package clean — while its manifest publishes an
    // entry no consumer can resolve.
    const dir = workspace({});
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'dangling-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('publishes nothing a consumer can resolve');
      expect(out.stdout).not.toContain('no .rip files found');
      expect(out.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('--public audits the manifest\'s entries wherever the run was pointed', () => {
    // The named file does not import the entry. The audit still answers
    // for the entry, because the manifest is what publishes — an entry
    // outside some other target set is not a defect of the package.
    const dir = workspace({
      'index.rip': 'export def api(n: number): number\n  n\n',
      'util.rip': 'export def helper(n: number): number\n  n\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'aimed-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public', 'util.rip']);
      expect(out.stdout).not.toContain('publishes nothing a consumer can resolve');
      expect(out.stdout).toContain('1/1 exports fully typed');
      expect(out.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('--public prints its own report when no entry compiles', () => {
    // The sole entry fails to compile, so nothing reaches the checker.
    // The mode still answers its own question — in place of type-checking,
    // never silently degrading to it.
    const dir = workspace({
      'index.rip': [
        'export type RoundingMode =',
        "  'UP' | 'DOWN' |",
        "  'HALF_UP'",
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'solo-broken', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('publishes nothing a consumer can resolve');
      expect(out.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('--public floors only a pattern that names .rip surface — a null block is an opinion, not a floor', () => {
    // `"./internal/*": null` is the manifest BLOCKING subpaths, and a
    // non-.rip pattern publishes surface this audit was never for. Neither
    // hides a name a consumer could resolve, so neither may cost the
    // package its clean exit.
    const dir = workspace({
      'index.rip': 'export def api(n: number): number\n  n\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'blocked-pkg',
        exports: { '.': './index.rip', './internal/*': null, './styles/*': './styles/*.css' },
      }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).not.toContain('every count below is a floor');
      expect(out.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('--public counts a pattern floor once per package, not once per entry', () => {
    // The pattern is a fact about the MANIFEST; a count that rides each
    // entry's row multiplies it by however many entries the package has.
    const dir = workspace({
      'a.rip': 'export def one(n: number): number\n  n\n',
      'b.rip': 'export def two(n: number): number\n  n\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'floor-pkg',
        exports: { '.': './a.rip', './b': './b.rip', './*': './src/*.rip' },
      }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('1 `export *` re-export not enumerated');
      expect(out.status).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Depth costs the walk nothing it reports: it descends until the surface
  // runs out, so a leak's distance from the export changes where it is
  // NAMED and never whether it is found. An audit that stopped short would
  // read cleanest on the surfaces that type deepest, which are the ones a
  // silent stop hides most.
  test('--public walks a deep chain to its end, however far the any sits', () => {
    // A chain 14 links long with the `any` at the bottom. Only the head is
    // published: every link is a link of ONE walk that way, where a
    // published chain is a row per link and each stops at the next, which
    // reaches no depth at all.
    const depth = 14;
    const lines = [];
    for (let i = 0; i < depth; i++) {
      lines.push(`type L${i} =`, `  next: ${i + 1 === depth ? 'any' : `L${i + 1}`}`, '');
    }
    lines.push('export deep: L0 = ({} as L0)');
    const dir = workspace({ 'index.rip': lines.join('\n') + '\n' });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'deep-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Named at its full path, and counted as the leak it is — no floor
      // stands between the reader and it.
      expect(out.stdout).toContain(`any at: deep${'.next'.repeat(depth)}`);
      expect(out.stdout).toContain('0/1 exports fully typed (0.0%)');
      expect(out.stdout).not.toContain('every count below is a floor');
      expect(out.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);


  // A type can hold an `any` without being one and without exposing one as
  // a member: `any[]`, `Promise<any>` and `Record<string, any>` each hand a
  // consumer an `any`, while the type itself is an array or a promise or an
  // object, and every member it exposes belongs to the language. Checking
  // only flags and members passes all three.
  test('--public reaches an `any` held inside a type: element, type argument, and index value', () => {
    const dir = workspace({
      'index.rip': [
        'export def arr(): any[]',
        '  []',
        '',
        'export def prom(): Promise<any>',
        '  Promise.resolve(null)',
        '',
        'export def rec(): Record<string, any>',
        '  ({})',
        '',
        'export def clean(): string[]',
        '  []',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'held-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('any at: arr()[]');       // array element
      expect(out.stdout).toContain('any at: prom()<0>');     // type argument
      expect(out.stdout).toContain('any at: rec()[]');       // index value
      expect(out.stdout).toMatch(/✓ clean/);                 // a typed element stays typed
      expect(out.stdout).toContain('1/4 exports fully typed (25.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // A general index — `string` or `number` keyed — is part of the surface:
  // a consumer reaches it by ordinary indexing. (An index keyed by a
  // PATTERN is not, and is skipped. That case has no fixture here because
  // rip source cannot spell a template-literal type; it arises only in
  // generated component code, where the compiler keys its own slot
  // namespace `[key: `_${string}`]: any`.)
  test('--public reports the value type of a general index signature', () => {
    const dir = workspace({
      'index.rip': [
        'export type Open =',
        '  [key: string]: any',
        '',
        'export type Shut =',
        '  [key: string]: number',
        '',
        'export open: Open = ({} as Open)',
        'export shut: Shut = ({} as Shut)',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'idx-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('any at: open[]');
      expect(out.stdout).toContain('any at: Open[]');
      expect(out.stdout).toMatch(/✓ shut/);
      expect(out.stdout).toContain('2/4 exports fully typed (50.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Ownership of a union is asked of each MEMBER. A union does not reliably
  // remember the name it came from: under strictNullChecks an optional
  // property whose type is a foreign alias becomes `Alias | null |
  // undefined`, a new union with no alias at all. Reading that absence as
  // "written here" opens the foreign definition — `BodyInit` expands to
  // include `ReadableStream<any>` — and reports the language's `any` as
  // this package's defect.
  test('--public does not open a foreign alias that lost its name to strictNullChecks', () => {
    const dir = workspace({
      'index.rip': [
        'export type Opts =',
        '  body?: BodyInit | null',       // optional + foreign alias
        '',
        'export def send(o: Opts): void',
        '  return',
        '',
        'export def leaks(o: any[]): void',  // still finds a real one
        '  return',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'nullable-pkg', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toMatch(/✓ send/);
      expect(out.stdout).toMatch(/✓ Opts/);
      // The `any` this package actually wrote is still its own.
      expect(out.stdout).toMatch(/any\s+at: leaks\(o\)\[\]/);
      expect(out.stdout).toContain('2/3 exports fully typed (66.7%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // `any` and `Function` are the same defect in different clothes — both
  // take anything and hand back an unchecked value, so a consumer's misuse
  // of either goes unreported wherever it sits. `unknown`, `object` and
  // `{}` carry nothing either, but a written one SAYS SO: the consumer
  // meets a compile error until they narrow, which is a guardrail rather
  // than a hole. `never` is none of these: it is the honest return of a
  // function that throws.
  test('--public reports the unchecked shapes out of a signature, but not a stated width or `never`', () => {
    const dir = workspace({
      'index.rip': [
        'export def rAny(): any', '  return 1', '',
        'export def rUnknown(): unknown', '  return 1', '',
        'export def rObject(): object', '  return ({})', '',
        'export def rEmpty(): {}', '  return ({})', '',
        'export def rFunction(): Function', '  return (-> 1)', '',
        "export def rNever(): never", "  throw Error.new('x')",
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'wide-out', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toMatch(/any\s+at: rAny\(\)/);
      expect(out.stdout).toMatch(/Function\s+at: rFunction\(\)/);
      expect(out.stdout).toMatch(/✓ rUnknown/);
      expect(out.stdout).toMatch(/✓ rObject/);
      expect(out.stdout).toMatch(/✓ rEmpty/);
      expect(out.stdout).toMatch(/✓ rNever/);
      expect(out.stdout).toContain('4/6 exports fully typed (66.7%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Width is a decision rather than a defect wherever it is WRITTEN: the
  // annotation claims what belongs there, however wide, and the claim
  // stands whichever way the value travels — including at a parameter OF a
  // parameter, which is an argument the consumer's own callback receives.
  // What is reported is an absence of that claim: a type that fell out of
  // a default value decides nothing.
  test('--public trusts a stated width, and reports one that fell out of a default', () => {
    const dir = workspace({
      'index.rip': [
        'export def stated(value: unknown): number', '  return 1', '',
        'export def statedObj(value: object): number', '  return 1', '',
        'export def unstated(opts = {}): number', '  return 1', '',
        'export def inferred(n = 5): number', '  return n', '',
        'export def withCb(cb: (item: unknown) => void): void', '  return',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'wide-in', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Stated: a contract, and trusted.
      expect(out.stdout).toMatch(/✓ stated\b/);
      expect(out.stdout).toMatch(/✓ statedObj/);
      // Unstated AND wide: a missing annotation, one edit away.
      expect(out.stdout).toMatch(/\{\}\s+at: unstated\(opts\)/);
      // Unstated and inferred to something REAL: still an absence of a
      // claim. The type is a snapshot of today's default — change the
      // default and the published type moves with no consumer told.
      expect(out.stdout).toMatch(/inferred\s+at: inferred\(n\)/);
      // The callback's own argument is read by the consumer, and claimed.
      expect(out.stdout).toMatch(/✓ withCb/);
      expect(out.stdout).toContain('3/5 exports fully typed (60.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Width that SAYS SO is a contract on the way out too. `unknown`,
  // `object` and `{}` stop a consumer until they narrow, so a written one
  // is a guardrail rather than a hole — some values genuinely have no
  // knowable shape, and naming that is the complete answer. What the audit
  // is for is the position nobody claimed: the same width arriving by
  // inference tells a consumer nothing and says nothing either.
  test('--public trusts a stated width on the way out, and reports the same width inferred', () => {
    const dir = workspace({
      'index.rip': [
        'export type Bag =',
        '  hole: unknown',
        '  empty: {}',
        '  obj: object',
        '',
        'export def stated(): Bag',
        '  return ({ hole: 1, empty: {}, obj: {} })',
        '',
        // No annotation anywhere on the way to `hole`, which lands wide.
        'export def inferred()',
        "  return ({ hole: (JSON.parse('1') as unknown) })",
        '',
        // Unchecked in either direction, stated or not.
        'export def leaks(): any', '  return 1',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'wide-read', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Written, and read: a claim about what belongs there, and trusted.
      expect(out.stdout).toMatch(/\u2713 stated\b/);
      expect(out.stdout).not.toMatch(/at: stated\(\)/);
      // The same width, with nobody claiming it.
      expect(out.stdout).toMatch(/unknown\s+at: inferred\(\)\.hole/);
      expect(out.stdout).toMatch(/any\s+at: leaks\(\)/);
      expect(out.stdout).toContain('2/4 exports fully typed (50.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // The two positions that carry no symbol of their own, and so have to be
  // asked about their annotation rather than told. An EXPORT's type comes
  // from its declaration — a class or a type alias writes the shape out,
  // while a binding takes whatever its initializer produced unless it says
  // otherwise. A RETURN's comes from the function, reached through a
  // parameter where there is one and through the exposing symbol where
  // there is not, since a binding holds its function in an initializer.
  test('--public asks a root export and a return for an annotation of their own', () => {
    const dir = workspace({
      'index.rip': [
        // Bindings: one claimed, one taking what it was handed.
        'export rootBare = Proxy.new {}, get: (_, key) -> 1',
        'export rootAnn: unknown = (JSON.parse(\'1\') as unknown)',
        // `{}` WRITTEN is a claim — the author will take anything
        // non-nullish. `{}` PRODUCED by an empty class body claims
        // nothing, and accepts anything non-nullish just the same.
        'export type AliasEmpty = {}',
        'export class Empty',
        '',
        // Returns, with and without a parameter to reach the function by.
        'export def retBare()', "  return (JSON.parse('1') as unknown)", '',
        'export def retAnn(): unknown', '  return 1', '',
        'export def retBareP(a: number)', "  return (JSON.parse('1') as unknown)", '',
        'export def retAnnP(a: number): unknown', '  return 1', '',
        // The annotation rides the initializer, not the binding.
        'export arrowRetAnn = (): unknown -> 1',
        "export arrowRetBare = -> (JSON.parse('1') as unknown)",
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'own-claim', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toMatch(/\{\}\s+at: rootBare/);
      expect(out.stdout).toMatch(/✓ rootAnn/);
      expect(out.stdout).toMatch(/✓ AliasEmpty/);
      expect(out.stdout).toMatch(/\{\}\s+at: Empty#/);
      expect(out.stdout).toMatch(/unknown\s+at: retBare\(\)/);
      expect(out.stdout).toMatch(/✓ retAnn\b/);
      expect(out.stdout).toMatch(/unknown\s+at: retBareP\(\)/);
      expect(out.stdout).toMatch(/✓ retAnnP/);
      expect(out.stdout).toMatch(/✓ arrowRetAnn/);
      expect(out.stdout).toMatch(/unknown\s+at: arrowRetBare\(\)/);
      expect(out.stdout).toContain('5/10 exports fully typed (50.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Not every annotation in the face was written by the author. A binding
  // that stays hoisted and is read from inside a closure gets a PIN — the
  // type the compiler inferred for it, spelled into the face as an
  // ordinary annotation. Syntax cannot tell the two apart, so a position
  // inside a pin has to be read as what it is: never claimed, however
  // annotated it looks. Both bindings below land on the same hoist line,
  // which is why the answer has to be per-span and not per-declaration.
  test('--public does not read a pinned type as an annotation the author wrote', () => {
    const dir = workspace({
      'index.rip': [
        'type Bag = { hole: unknown }',
        '',
        'authored: () => Bag = -> ({ hole: 1 })',
        "guessed = -> ({ hole: (JSON.parse('1') as unknown) })",
        '',
        'export def fromAuthored(): Bag',
        '  return authored()',
        '',
        'export def fromGuessed()',
        '  return guessed()',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'pinned', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Written by hand, and trusted — the pin beside it changes nothing.
      expect(out.stdout).toMatch(/✓ fromAuthored/);
      // The compiler's own description of what it found.
      expect(out.stdout).toMatch(/unknown\s+at: fromGuessed\(\)\.hole/);
      expect(out.stdout).toContain('1/2 exports fully typed (50.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Two ways to mistake an absence of information for a lack of it. A
  // MAPPED type has no members until its parameter is bound, and a bare
  // TYPE export has no direction at all — it may be an options bag the
  // consumer builds or a result they inspect, and nothing says which, so
  // only the rules that hold either way apply to it.
  test('--public does not read a generic mapped type, or an undirected type export, as empty', () => {
    const dir = workspace({
      'index.rip': [
        'export type Wrap<S> = { [K in keyof S]: S[K] }',
        '',
        // A generic function's return is not instantiated, so a mapped type
        // reaches an OUTPUT position with its parameter still unbound and no
        // members yet. Reading that as `{}` condemns every generic alias.
        'export def make<S>(source: S): Wrap<S>',
        '  return (source as Wrap<S>)',
        '',
        'export type Options =',
        '  json?: unknown',                                     // written; direction unknown
        '',
        'export type Result =',
        '  payload: any',                                       // `any` holds either way
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'undirected', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toMatch(/✓ Wrap/);
      expect(out.stdout).toMatch(/✓ make/);
      expect(out.stdout).toMatch(/✓ Options/);
      expect(out.stdout).toMatch(/any\s+at: Result\.payload/);
      expect(out.stdout).toContain('3/4 exports fully typed (75.0%)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // The path names where a defect SURFACES in the type. That is not where
  // to edit: a value assembled through inner definitions surfaces its `any`
  // at the export, while the parameter carrying it belongs to a lambda
  // several definitions away — annotating the obvious candidate changes
  // nothing at all. The declaring symbol knows which position it was.
  test('--public names the source position that declared the defect, not where it surfaces', () => {
    const dir = workspace({
      'index.rip': [
        'def helper(input: string): string',     // line 1 — typed, and a red herring
        '  input',
        '',
        'def build()',
        '  call = (input, opts = {}) -> helper(input)',   // line 5 — the real one
        '  Object.assign call, { get: call }',
        '',
        'export thing = build()',                // line 8 — where it surfaces
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'origin-pkg', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Surfaces at the export…
      expect(out.stdout).toMatch(/any\s+at: thing\(input\)/);
      // …and carries the lambda's parameter position, column and all.
      expect(out.stdout).toMatch(/index\.rip:5:11\s+any\s+at: thing\(input\)/);
      // Not the typed helper it calls, nor the export it surfaced on.
      expect(out.stdout).not.toMatch(/index\.rip:1:\d+\s+any/);
      expect(out.stdout).not.toMatch(/index\.rip:8:\d+\s+any/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // An export is reported WHOLE: every position it leaves untyped, not the
  // first one found. Reporting one at a time turns a package into a series
  // of rounds and never says how much work is left. What deduplicates them
  // is the DECLARATION that would fix each — several members built from one
  // lambda are one edit, and naming it once per member reads as many.
  //
  // A parameter carries its own declaration and a return carries none, so
  // both halves of one lambda have to arrive at the lambda: the parameters
  // through the symbols that declare them, the return through the function
  // those symbols sit in. However many names expose that lambda, what is
  // left to write is the two parameters and the return it was declared
  // with, all on the one line it was declared on.
  test('--public reports every position an export leaves untyped, once per declaration', () => {
    const dir = workspace({
      'index.rip': [
        'def build()',
        '  call = (input, opts) -> input',      // ONE lambda, two parameters
        '  Object.assign call, { get: call, post: call, put: call }',
        '',
        'export thing = build()',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'whole-pkg', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      const found = out.stdout.split('\n').filter((l) => l.includes(' at: '));
      // Both parameters, not just the first.
      expect(found.some((l) => /at: thing\(input\)/.test(l))).toBe(true);
      expect(found.some((l) => /at: thing\(opts\)/.test(l))).toBe(true);
      // `get`, `post` and `put` are the SAME lambda, so its parameters are
      // named once — not once per member that exposes them.
      expect(found.filter((l) => /\(input\)/.test(l)).length).toBe(1);
      expect(found.filter((l) => /\(opts\)/.test(l)).length).toBe(1);
      // And the return once, though four names reach it: the export's own
      // call signature and the three members built from the same lambda.
      expect(found.filter((l) => /at: thing[.\w]*\(\)/.test(l)).length).toBe(1);
      expect(out.stdout).not.toMatch(/at: thing\./);
      // Every one of them on the lambda's own line, which is where the
      // annotation goes — not on the export, nor on the keys exposing it.
      for (const l of found) expect(l).toMatch(/index\.rip:2:/);
      expect(out.stdout).toContain('3 positions need a type');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // A defect INSIDE a return type belongs to the return annotation too, so
  // it arrives at the same one place however it was reached. What that
  // rule does NOT cover is a signature with no parameter at all: nothing
  // there points back at the function, and the position falls back to
  // whatever exposed it.
  test('--public attributes a return to the signature that declares it, and says so through the type it returns', () => {
    const inside = workspace({
      'package.json': JSON.stringify({ name: '@ret/inside', rip: { strict: true }, exports: { '.': './index.rip' } }),
      'index.rip': [
        'def build()',
        '  call = (input: string): Promise<any> -> Promise.resolve(null as any)',
        '  Object.assign call, { get: call, post: call }',
        '',
        'export thing = build()',
      ].join('\n') + '\n',
    });
    const noParams = workspace({
      'package.json': JSON.stringify({ name: '@ret/noparams', rip: { strict: true }, exports: { '.': './index.rip' } }),
      'index.rip': [
        'def build()',
        '  make = -> null as any',
        '  Object.assign make, { again: make }',
        '',
        'export thing = build()',
      ].join('\n') + '\n',
    });
    try {
      const a = check(inside, ['--public']).stdout;
      // The `any` inside `Promise<any>`, named once and placed on the
      // lambda, though three names reach that same return.
      expect(a).toContain('any at: thing()<0>');
      expect(a).toMatch(/index\.rip:2:\d+\s+any\s+at: thing\(\)<0>/);
      expect(a).toContain('1 position needs a type');

      // The stated limit, pinned so it cannot drift unnoticed: with no
      // parameter to reach the function through, each name that exposes
      // the lambda carries a return position of its own.
      const b = check(noParams, ['--public']).stdout;
      expect(b).toContain('any at: thing()');
      expect(b).toContain('any at: thing.again()');
      expect(b).toContain('2 positions need a type');
    } finally {
      for (const w of [inside, noParams]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // `@field = param` emits a field declaration that never existed in the
  // source, and its type follows the parameter. Annotating the parameter
  // answers both, so the parameter is the finding and the field is its
  // shadow — and several such fields all map back to the one constructor
  // line, which would read as several things to fix at one position.
  test('--public reports a constructor parameter, not the field that follows it', () => {
    const dir = workspace({
      'index.rip': [
        'export class Holder',
        '  constructor: (first, second) ->',
        '    @first = first',
        '    @second = second',
        '    @tally = {}',            // no parameter behind it: its own finding
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'shadow-pkg', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      const found = out.stdout.split('\n').filter((l) => l.includes(' at: '));
      expect(found.some((l) => /at: Holder\.new\(first\)/.test(l))).toBe(true);
      expect(found.some((l) => /at: Holder\.new\(second\)/.test(l))).toBe(true);
      // The fields those parameters feed are not separate work.
      expect(out.stdout).not.toMatch(/at: Holder#first/);
      expect(out.stdout).not.toMatch(/at: Holder#second/);
      // A field with no parameter behind it still is: nothing else names it.
      expect(found.some((l) => /at: Holder#tally/.test(l))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // A member that IS another published export has its own row, its own
  // verdict, and one edit fixes it there. Repeating its positions under
  // everything that happens to expose it reports one piece of work as
  // several, and inflates every count that follows.
  test('--public stops at a member that is another export of the same entry', () => {
    const dir = workspace({
      'index.rip': [
        'export class Boom extends Error',
        '  constructor: (payload) ->',
        "    super('x')",
        '',
        'def build()',
        '  call = (n: number): number -> n',
        '  Object.assign call, { Boom: Boom }',
        '',
        'export api = build()',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'sibling-pkg', rip: { strict: true }, exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Reported once, under the export that owns it.
      expect(out.stdout).toContain('at: Boom.new(payload)');
      expect(out.stdout).not.toContain('at: api.Boom.new(payload)');
      // `api` exposes it and carries no edit of its own, so the position
      // is `Boom`'s to fix — and `api` is clean only while `Boom` is.
      expect(out.stdout).toMatch(/\u21b7 api/);
      expect(out.stdout).toMatch(/reaches `Boom`/);
      expect(out.stdout).toContain('1 position needs a type');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // A type prints as it was WRITTEN. An annotation naming something that
  // does not resolve still prints that name while meaning `any`, so the
  // written form alone puts a rich-looking type beside a verdict of `any`
  // and reads as a tool error rather than as the finding it is.
  test('--public shows the resolved type when an annotation does not land', () => {
    const dir = workspace({
      'index.rip': [
        'export box: NotDeclaredAnywhere<string> = ({} as any)',
        '',
        "export fine: string = 'x'",
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'unres-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('any (written: NotDeclaredAnywhere<string>)');
      expect(out.stdout).toContain('any at: box');
      // A type that resolves is shown once, not doubled.
      expect(out.stdout).toMatch(/✓ fine\s+string/);
      expect(out.stdout).not.toContain('any (written: string)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // The type column is the published surface itself — what a consumer
  // resolves — and it is the one thing a reader checks a verdict against.
  // It is printed whole: long types continue onto further lines rather than
  // stopping, and the checker's own member elision is turned off.
  test('--public prints a published type in full, however long', () => {
    // Anonymous by construction: a NAMED type prints as its name, which is
    // both correct and short. A structural type is the one that prints long,
    // which is why `http`'s published intersection does.
    const members = Array.from({ length: 24 }, (_, i) => `  aRatherLongMemberName${i}: 'valueNumber${i}'`);
    const dir = workspace({
      'index.rip': ['export wide = ({', ...members, '})'].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'wide-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // Flattened, because a long type wraps across lines by design.
      const flat = out.stdout.replace(/\s+/g, ' ');
      expect(flat).toContain('aRatherLongMemberName0: string;');
      // The last member survives both the report's width and the checker's
      // default elision, which would otherwise cut in with `... N more ...`.
      expect(flat).toContain('aRatherLongMemberName23: string;');
      expect(out.stdout).not.toContain('more ...');
      expect(out.stdout).not.toContain('…');   // no ellipsis anywhere
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // What a project RECEIVES as `any` from another package. Nothing else in
  // the report covers it: the ledger counts diagnostics and missing
  // annotations INSIDE a dependency, which is a different claim, and no
  // checker complains at the use site because using an `any` is not an
  // error. The signal is scoped to the names actually imported — the whole
  // published surface would read the same for every consumer of a package.
  test('an `any` received from another package is advised, named, and never gates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-inh-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      fs.mkdirSync(path.join(dir, 'packages', 'app'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'packages', 'util'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'util', 'package.json'),
        JSON.stringify({ name: '@rip/util', exports: { '.': './util.rip' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'util', 'util.rip'), [
        'export def leaky(x)',            // unannotated parameter
        '  x',
        '',
        'export def alsoLeaky(w)',        // a second one, used in the same file
        '  w',
        '',
        'export def tidy(n: number): number',
        '  n',
        '',
        'export def unused(y)',           // leaks, but nobody imports it
        '  y',
      ].join('\n') + '\n');
      // A sibling in the SAME package: crossing no package boundary, so it
      // is this project's own business and never advised.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'local.rip'), 'export def near(z: number): number\n  z\n');
      // Strict, so the gradual scope gate is not also in play here — what
      // this case is about is which files are named and why.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@rip/app-under-test', rip: { strict: true } }));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'app.rip'), [
        "import { leaky, alsoLeaky, tidy } from '@rip/util'",
        "import { near } from './local.rip'",
        'console.log leaky(1), tidy(2), near(3)',
        'again = leaky(4)',
        'other = alsoLeaky(5)',
      ].join('\n') + '\n');
      // Imports a leaking name and never uses it: an import specifier is
      // where a name arrives, not a place it is consumed.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'idle.rip'), [
        "import { leaky } from '@rip/util'",
        'export def unrelated(n: number): number',
        '  n',
      ].join('\n') + '\n');
      fs.mkdirSync(path.join(dir, 'node_modules', '@rip'), { recursive: true });
      fs.symlinkSync(path.join('..', '..', 'packages', 'util'), path.join(dir, 'node_modules', '@rip', 'util'));

      const out = check(dir, [path.join('packages', 'app')]);
      expect(out.stdout).toContain('imported from `@rip/util`');
      expect(out.stdout).toContain('`leaky`');
      // Imported and clean: not named.
      expect(out.stdout).not.toContain('`tidy`');
      // Leaks, but this project never took it — the count is about what
      // THIS project receives, not what the package publishes.
      expect(out.stdout).not.toContain('`unused`');
      // Same package, so not inherited from anywhere.
      expect(out.stdout).not.toContain('`near`');
      // Every FILE that uses one, named once — complete at the level it
      // describes. `app.rip` uses `leaky` twice and is listed once.
      const files = out.stdout.split('\n').filter((l) => /^\s+packages\/app\/app\.rip[:\s]/.test(l));
      expect(files.length).toBe(1);                    // `leaky` used twice, listed once
      // The file opens where the value ARRIVED — its import, on line 1 —
      // not at one of the places it is used.
      expect(files[0]).toMatch(/app\.rip:1:\d+/);
      // Both leaking names it uses, on that one line.
      expect(files[0]).toContain('leaky');
      expect(files[0]).toContain('alsoLeaky');
      // The clean import is not why the file is listed.
      expect(files[0]).not.toContain('tidy');
      // Imports `leaky` but never uses it — the arrival is not a use, and
      // the summary above already reports the arrival.
      expect(out.stdout).not.toMatch(/idle\.rip/);
      // Same package: not inherited from anywhere.
      expect(out.stdout).not.toMatch(/local\.rip/);
      // An advisory, never a gate.
      expect(out.status).toBe(0);

      // `rip.noCheck` governs it too: a file excluded from checking is not
      // asked for diagnostics, and does not report what it inherits either.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@rip/app-under-test', rip: { strict: true, noCheck: ['*.rip'] } }));
      const excluded = check(dir, [path.join('packages', 'app')]);
      expect(excluded.stdout).not.toContain('imported from `@rip/util`');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // The walk stops at a member whose type is another export of the same
  // entry, deferring the defect to that export's own row. Narrowed to what
  // THIS project imported, the sibling has no row — so the deferral must
  // not swallow the defect with it.
  test('a leak deferred to an unimported sibling still reaches the advisory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-defer-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      for (const p of ['lib', 'app']) fs.mkdirSync(path.join(dir, 'packages', p), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules', '@d'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'package.json'),
        JSON.stringify({ name: '@d/lib', exports: { '.': './lib.rip' } }));
      // `api` is imported; `Session` — where the leak lives — is not.
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'lib.rip'), [
        'export class Session',
        '  run: (x) -> x',
        '',
        'export api = { session: new Session() }',
      ].join('\n') + '\n');
      fs.symlinkSync(path.join('..', '..', 'packages', 'lib'), path.join(dir, 'node_modules', '@d', 'lib'));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@d/app', rip: { strict: true } }));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'app.rip'),
        "import { api } from '@d/lib'\nconsole.log api.session.run(1)\n");
      const out = check(dir, [path.join('packages', 'app')]);
      expect(out.stdout).toContain('imported from `@d/lib`');
      expect(out.stdout).toContain('`api`');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // An `export { name }` clause forwards what came in untyped; nothing at
  // that position consumes it — the same rule as the import specifier one
  // node over.
  test('a re-export is a forward, not a use — the file is not listed as a use site', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-fwd-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      for (const p of ['lib', 'app']) fs.mkdirSync(path.join(dir, 'packages', p), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules', '@f'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'package.json'),
        JSON.stringify({ name: '@f/lib', exports: { '.': './lib.rip' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'lib.rip'), 'export def leaky(x)\n  x\n');
      fs.symlinkSync(path.join('..', '..', 'packages', 'lib'), path.join(dir, 'node_modules', '@f', 'lib'));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@f/app', rip: { strict: true } }));
      // A real use, so the advisory prints at all.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'app.rip'),
        "import { leaky } from '@f/lib'\nconsole.log leaky(1)\n");
      // Import and forward only — no consumption.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'forward.rip'),
        "import { leaky } from '@f/lib'\nexport { leaky }\n");
      const out = check(dir, [path.join('packages', 'app')]);
      expect(out.stdout).toContain('imported from `@f/lib`');
      expect(out.stdout).toMatch(/app\.rip/);
      expect(out.stdout).not.toMatch(/forward\.rip/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Several packages leaking at once is the ordinary case for an app, and
  // the advisories have to survive it as a READABLE unit: each package is
  // its own finding with its own remedy, so each is set off by a blank
  // line; the location column is sized across the whole family, so the
  // names read down one column instead of stepping in and out per package;
  // and the arrivals are named in full, never sampled.
  //
  // The column needs two packages whose paths are of DIFFERENT lengths —
  // sized per block, the short path's names sit far to the left of the
  // long one's, which is exactly what a single column must not do. The
  // sample needs a package leaking more than a handful.
  test('the received-`any` advisories read as one table: a blank line per package, one column of names, every arrival named', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-inh-table-'));
    const many = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      fs.mkdirSync(path.join(dir, 'node_modules', '@rip'), { recursive: true });
      for (const [pkg, fns] of [['aaa', many], ['bbb', ['zeta']]]) {
        fs.mkdirSync(path.join(dir, 'packages', pkg), { recursive: true });
        fs.writeFileSync(path.join(dir, 'packages', pkg, 'package.json'),
          JSON.stringify({ name: `@rip/${pkg}`, exports: { '.': `./${pkg}.rip` } }));
        fs.writeFileSync(path.join(dir, 'packages', pkg, `${pkg}.rip`),
          fns.map((fn) => `export def ${fn}(x)\n  x\n`).join('\n'));
        fs.symlinkSync(path.join('..', '..', 'packages', pkg), path.join(dir, 'node_modules', '@rip', pkg));
      }
      fs.mkdirSync(path.join(dir, 'packages', 'app'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@rip/app-under-test', rip: { strict: true } }));
      // The short path takes the FIRST package alphabetically, so a
      // per-block width would put its names left of the long path's.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'z.rip'),
        `import { ${many.join(', ')} } from '@rip/aaa'\n`
        + many.map((fn, i) => `export z${i} = ${fn}(${i})\n`).join(''));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'a-considerably-longer-file-name.rip'),
        "import { zeta } from '@rip/bbb'\nexport bb = zeta(2)\n");

      const lines = check(dir, [path.join('packages', 'app')]).stdout.split('\n');
      const headings = lines.map((l, i) => i).filter((i) => /values? imported from/.test(lines[i]));
      expect(headings.length).toBe(2);
      // Every package's finding is set off from the one above it.
      for (const i of headings) expect(lines[i - 1]).toBe('');
      // All five arrivals named, and nothing deferred to a "more".
      const head = lines[headings.find((i) => lines[i].includes('@rip/aaa'))];
      for (const fn of many) expect(head).toContain(`\`${fn}\``);
      expect(head).not.toContain('more');
      // One column of names, measured where the names actually START —
      // the location is one run of non-space, the padding follows it.
      const nameColumn = (file) => {
        const row = lines.find((l) => l.includes(`${file}:`) && !/imported from/.test(l));
        expect(row).toBeDefined();
        return /^(\s+\S+\s+)\S/.exec(row)[1].length;
      };
      expect(nameColumn('z.rip')).toBe(nameColumn('a-considerably-longer-file-name.rip'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Gradual accepts `any` — that is what it is for — and an inherited one
  // is not even a defect the project can answer by annotating its own code,
  // so it is not on the gradual path at all. It belongs to the posture that
  // refuses `any`, and a gradual project meets it the same way it meets
  // every other strict finding: under `--strict`.
  test('an inherited `any` is a strict-posture finding, previewed by --strict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-grad-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      fs.mkdirSync(path.join(dir, 'packages', 'app'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'packages', 'util'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'util', 'package.json'),
        JSON.stringify({ name: '@rip/util', exports: { '.': './util.rip' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'util', 'util.rip'), 'export def leaky(x)\n  x\n');
      fs.mkdirSync(path.join(dir, 'node_modules', '@rip'), { recursive: true });
      fs.symlinkSync(path.join('..', '..', 'packages', 'util'), path.join(dir, 'node_modules', '@rip', 'util'));
      // No `rip.strict`: gradual, and nothing in this file is annotated, so
      // no scope in it asks to be checked.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@rip/held' }));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'app.rip'), [
        "import { leaky } from '@rip/util'",
        'held = ->',
        '  leaky(1)',
      ].join('\n') + '\n');

      // Gradual: silent. Not the summary either — there is nothing here
      // for a posture that accepts `any` to do.
      const gradual = check(dir, [path.join('packages', 'app')]);
      expect(gradual.stdout).not.toContain('imported from `@rip/util`');

      // The same code, asked what strict would say.
      const preview = check(dir, ['--strict', path.join('packages', 'app')]);
      expect(preview.stdout).toContain('imported from `@rip/util`');
      expect(preview.stdout).toMatch(/app\.rip:\d+:\d+\s+leaky/);

      // And once the project actually flips, without asking.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@rip/held', rip: { strict: true } }));
      const strict = check(dir, [path.join('packages', 'app')]);
      expect(strict.stdout).toMatch(/app\.rip:\d+:\d+\s+leaky/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // The walk remembers types it has already been through, so a recursive
  // type ends instead of looping. What it remembers them BY decides
  // correctness: a name is not an identity — two files may each declare a
  // `Config` — and a declaration is not one either, since `typeof C` and
  // `C` share one. Collapse either way and a whole branch is skipped as
  // already-seen, which reads as clean.
  test('--public tells apart same-named types from different files, and a class from its own instance', () => {
    const dir = workspace({
      'clean.rip': 'export type Config =\n  size: number\n',
      'dirty.rip': 'export type Config =\n  leak: any\n',
      'index.rip': [
        "import { Config as CleanConfig } from './clean.rip'",
        "import { Config as DirtyConfig } from './dirty.rip'",
        '',
        'export type Pair =',
        '  first: CleanConfig',
        '  second: DirtyConfig',
        '',
        'export class Holder',
        '  constructor: (tag: string) ->',
        '    @tag = tag',
        '',
        '  reveal: (detail) ->',
        '    detail',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'ident-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // The SECOND `Config` is a different type than the first, and the
      // only one that leaks. Keyed by name, it never gets walked.
      expect(out.stdout).toContain('any at: Pair.second.leak');
      // `typeof Holder` is walked, and so is the instance it constructs —
      // keyed by declaration alone, the second is the first.
      expect(out.stdout).toContain('any at: Holder#reveal(detail)');
      expect(out.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // A top-level `globalThis.NAME ??= expr` DECLARES the global: the
  // spelling says "install unless someone already did", which is a
  // declaration in runtime clothes — stamp's sh/ok/run vocabulary is the
  // resident pattern ("handlers import nothing"). The declaration is
  // scoped to the declaring PACKAGE (its own program in the mirror), and
  // reaches importers the way the runtime does — importing the module
  // runs the installer. A non-importing neighbor keeps its TS2304, which
  // is the typo protection ambient-everywhere would have spent.
  test('a top-level `globalThis.NAME ??=` declares the global, scoped to its package', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/vocab/package.json': JSON.stringify({ name: '@t/vocab' }),
      'packages/vocab/vocab.rip': [
        'sh = (cmd: string): string -> cmd',
        'globalThis.sh ??= sh',
        'export ping = 1',
      ].join('\n') + '\n',
      'packages/vocab/handler.rip': [
        'out = sh("ls")',        // resolves: same package, declared vocabulary
        'bad = shh("ls")',       // typo protection survives: cannot-find still fires
        'console.log out, bad',
      ].join('\n') + '\n',
      'packages/other/package.json': JSON.stringify({ name: '@t/other' }),
      'packages/other/other.rip': [
        'oops = sh("ls")',       // different package, no import: the global does NOT reach
        'console.log oops',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      const names = diags.map((d) => [d.file, /'([^']+)'/.exec(d.message)?.[1]]);
      // vocab's own package: `sh` resolves everywhere; only the typo reports.
      expect(names.filter(([f]) => f.includes('vocab'))).toEqual([
        [path.join('packages', 'vocab', 'handler.rip'), 'shh'],
      ]);
      // the non-importing neighbor: `sh` is not its vocabulary.
      expect(names.filter(([f]) => f.includes('other'))).toEqual([
        [path.join('packages', 'other', 'other.rip'), 'sh'],
      ]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Emitter scaffolding (a bang-def's `: void`, arity `?`s, pin
  // annotations) never opens the gate: an unannotated file is a silent
  // file, whatever the face emits for its lowerings.
  test('an unannotated file with bang-defs stays silent — scaffolding never opens the gate', () => {
    const dir = workspace({
      'tool.rip': [
        'write! = (s) -> s',
        'n = 42',
        'bad = n.toUpperCase()',     // inference-only misuse: held
        'console.log write, bad',
      ].join('\n') + '\n',
    });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The gate reads BINDINGS, not text — the CLI's own check over a bare
  // workspace; the corpus carries the same shapes with their rationale
  // (test/audit/corpus/gradual/held.rip and published.rip, the `gate, …`
  // and `reach, …` sections).
  test('the gate reads bindings, not text: function bodies, member names, and object keys open nothing; calls and standing annotations flow', () => {
    const dir = workspace({
      'gate.rip': [
        'export ratio: number = 0.5',
        'scaled = (opts = {}) ->',
        '  factor = opts.factor',          // held: a body reading `ratio` types nothing
        '  factor * ratio',
        'bare = ->',
        '  opts = {}',
        '  amount = opts.amount',          // held: a paramless lambda is a function too
        '  amount * ratio',
        'memo = (fn) -> fn',
        'passed = memo((opts = {}) ->',
        '  depth = opts.depth',            // held: a body inside a call argument
        '  depth * ratio)',
        'handlers =',
        '  run: (opts = {}) ->',
        '    speed = opts.speed',          // held: a body inside an object literal
        '    speed * ratio',
        'registry: Map<string, number> = Map.new()',
        'failure = ->',
        "  err = Error.new 'nope'",
        '  err.status = 400',              // held: `new` is a member name, not a binding
        '  err',
        'export def position(el: string): void',
        '  console.log(el)',
        'layout = (side) ->',
        "  styles = { position: 'fixed' }",
        '  styles.top = side',             // held: the key `position` is not the function `position`
        '  styles',
        'sized = (n: number): number -> n * 2',
        'doubled = sized(21)',
        'console.log(doubled.length)',     // published: a call is a value
        'api =',
        '  fetch: (): number -> 42',
        'console.log(api.fetch().length)', // published: an annotation standing in the value types `api`
        'console.log scaled(), bare(), passed(), handlers.run(), registry, failure(), layout(1)',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.map((d) => [d.code, d.line])).toEqual([[2339, 30], [2339, 33]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A package that serves JAVASCRIPT has no face; its bare name resolves
  // to the declaration beside the entry through the mirror's `paths`, and
  // that declaration's types carry like an annotated export's. No
  // node_modules link here: the stdlib alias `rip/<name>` never has one, so
  // the resolution must come from the mirror, not from the filesystem walk.
  test('a bare specifier landing on a .js entry resolves through its sibling .d.ts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-jsdts-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      fs.mkdirSync(path.join(dir, 'packages', 'app'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'packages', 'gram'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'gram', 'package.json'),
        JSON.stringify({ name: '@rip/gram', exports: { '.': './gram.js' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'gram', 'gram.js'), 'export const answer = 42;\n');
      fs.writeFileSync(path.join(dir, 'packages', 'gram', 'gram.d.ts'), 'export declare const answer: number;\n');
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'app.rip'), [
        "import { answer } from '@rip/gram'",
        'bad: string = answer',        // the declaration's type reaches the annotated line
        'console.log bad',
      ].join('\n') + '\n');
      const diags = JSON.parse(check(dir, ['--json', path.join('packages', 'app')]).stdout);
      expect(diags.map((d) => d.code)).not.toContain(2307);
      expect(diags.map((d) => [d.code, d.line])).toEqual([[2322, 2]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // The stdlib case itself: `rip/highlight` serves hljs-rip.js with its
    // declaration beside it, resolved from any workspace — the alias has
    // no node_modules entry anywhere, so only the mirror's `paths` can
    // answer for it.
    const stdlib = workspace({ 'grammar.rip': "import ripLanguage from 'rip/highlight'\nbad: number = ripLanguage\nconsole.log bad\n" });
    try {
      const diags = JSON.parse(check(stdlib, ['--json']).stdout);
      expect(diags.map((d) => d.code)).not.toContain(2307);
      expect(diags.map((d) => [d.code, d.line])).toEqual([[2322, 2]]);
    } finally { fs.rmSync(stdlib, { recursive: true, force: true }); }
  }, 90_000);

  // A NESTED node_modules resolves through the mirror the way bun
  // resolves it at runtime: the face's ancestor walk lives in the mirror
  // tree, so a source-tree install (a quarantined bench dir with its own
  // manifest) was invisible — bun ran the imports that tsgo called
  // cannot-finds. The mirror plants a node_modules symlink at each dir
  // whose source twin has one.
  test('a nested source-tree node_modules resolves through the mirror', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/csvish/package.json': JSON.stringify({ name: '@t/csvish' }),
      'packages/csvish/bench/package.json': JSON.stringify({ name: 'bench', dependencies: { fakelib: '1.0.0' } }),
      'packages/csvish/bench/node_modules/fakelib/package.json': JSON.stringify({ name: 'fakelib', version: '1.0.0', types: 'index.d.ts', main: 'index.js' }),
      'packages/csvish/bench/node_modules/fakelib/index.d.ts': 'export declare function parse(s: string): string[];\n',
      'packages/csvish/bench/node_modules/fakelib/index.js': 'export const parse = (s) => s.split(",");\n',
      'packages/csvish/bench/compare.rip': [
        "import { parse } from 'fakelib'",       // resolves through the nested install
        "import { nope } from 'nolib'",          // liveness: a genuinely-missing module still 2307s
        "rows: string[] = parse('a,b')",
        'console.log rows, nope',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      const cannotFinds = diags.filter((d) => d.code === 2307).map((d) => /'([^']+)'/.exec(d.message)?.[1]);
      expect(cannotFinds).toEqual(['nolib']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Installation pressure is annotation pressure's cousin: a bare import
  // DECLARED in the governing package.json but not installed is the
  // manifest's stated intent, not a typo — gradual holds its 2307 and
  // the summary names the install dir; strict publishes it (complaints
  // mode, like the floors). Undeclared-and-uninstalled stays a published
  // defect everywhere. Keeps `rip check` green on a fresh clone whose
  // optional dirs (a quarantined bench) were never installed.
  test('a declared-but-uninstalled import is held in gradual with the install remedy; strict and undeclared publish', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/q/package.json': JSON.stringify({ name: '@t/q' }),
      'packages/q/bench/package.json': JSON.stringify({ name: 'q-bench', dependencies: { fakelib: '1.0.0' } }),
      'packages/q/bench/compare.rip': [
        "import { parse } from 'fakelib'",   // declared, not installed → held, advised
        "import { nope } from 'nolib'",      // undeclared → the defect publishes
        'console.log parse, nope',
      ].join('\n') + '\n',
      'packages/r/package.json': JSON.stringify({ name: '@t/r', rip: { strict: true }, dependencies: { fakelib: '1.0.0' } }),
      'packages/r/app.rip': "import { parse } from 'fakelib'\nconsole.log parse\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      const modOf = (d) => /'([^']+)'/.exec(d.message)?.[1];
      expect(diags.filter((d) => d.file.includes('q')).map(modOf)).toEqual(['nolib']);
      expect(diags.filter((d) => d.file.includes(path.join('r', 'app'))).map(modOf)).toEqual(['fakelib']);
      const text = check(dir).stdout;
      expect(text).toMatch(/1 uninstalled-dependency import hidden — run `bun install` in packages\/q\/bench/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A nested package that sets `rip.strict` becomes its own program, the
  // same auto boundary a globals-declaring package gets: the null
  // posture is per-PROGRAM, and without the boundary the root program's
  // loose base keeps admitting `null` for a package that asked for
  // complaints. Host modules are not the discriminator: `bun:sqlite`
  // resolves from the checkout's `@types/bun` in both programs.
  test('a nested rip.strict package is its own program, with its own posture', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/lib/package.json': JSON.stringify({ name: '@t/lib', rip: { strict: true } }),
      'packages/lib/lib.rip': "import { Database } from 'bun:sqlite'\nx: string = null\nconsole.log Database, x\n",
      'packages/loose/package.json': JSON.stringify({ name: '@t/loose' }),
      'packages/loose/loose.rip': "import { Database } from 'bun:sqlite'\nx: string = null\nconsole.log Database, x\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // The strict package: the null refused, and the host module resolved.
      expect(diags.filter((d) => d.file.includes('lib')).map((d) => d.code)).toEqual([2322]);
      // The gradual sibling: the loose base admits it, still quiet.
      expect(diags.filter((d) => d.file.includes('loose'))).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The INVERSE flip: a gradual package nested in a STRICT workspace earns
  // the same boundary — posture and floors are per-program, so without it
  // the package rides strict nulls, unknown catches, and refused floors it
  // never asked for. The tsconfig ABOVE the package must not swallow the
  // boundary either: a wrapper's posture is the wrapper's, not the
  // package's (the audit-tree shape, where corpus/gradual sits under
  // test/audit's tsconfig and strict package.json).
  test('a gradual package nested in a strict workspace keeps its loose posture and floors', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'], rip: { strict: true } }),
      'mid/tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true } }),
      'mid/loose/package.json': JSON.stringify({ name: '@t/loose' }),
      'mid/loose/loose.rip': [
        "import { Database } from 'bun:sqlite'",
        'greeting: string = null',
        'console.log(Database, greeting)',
      ].join('\n') + '\n',
      'strict.rip': 'flag: string = null\nconsole.log(flag)\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // The flipped package: floored bun:*, loose nulls — silent.
      expect(diags.filter((d) => d.file.includes('loose'))).toEqual([]);
      // The strict root still means strict.
      expect(diags.filter((d) => d.file === 'strict.rip').map((d) => d.code)).toEqual([2322]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A check answers for the paths it was ASKED about. The closure is
  // compiled and checked whole — types cannot resolve otherwise — but a
  // dependency's own diagnostics are its author's, not the caller's:
  // reporting them makes a package's exit code hostage to code its
  // author does not own, and surfaces defects the dependency's own
  // check cannot reproduce. Not counted either, for the second reason:
  // a tally the reader is told to go verify elsewhere is worse than
  // silence when the package's own check answers clean. The same file,
  // asked about directly, is answered in full.
  test('a check reports its targets, not its dependencies', () => {
    const dir = workspace({
      'app/app.rip': [
        "import { helper } from '../lib/lib.rip'",
        'label: string = helper',
        'console.log(label)',
      ].join('\n') + '\n',
      'lib/lib.rip': [
        'export helper: string = "x"',
        'broken: number = "not a number"',
        'console.log(broken)',
      ].join('\n') + '\n',
    });
    try {
      // Asked about app/ — the dependency's TS2322 is not the answer.
      const scoped = JSON.parse(check(dir, ['--json', 'app']).stdout);
      expect(scoped).toEqual([]);
      // And not tallied on the way past either.
      expect(check(dir, ['app']).stdout).not.toContain('in dependencies');
      // Asked about the whole tree — the same diagnostic IS the answer.
      const whole = JSON.parse(check(dir, ['--json']).stdout);
      expect(whole.map((d) => [d.file, d.code])).toEqual([['lib/lib.rip', 2322]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The ledger counts the code the run was ASKED about. A dependency is
  // compiled and checked so the target's types resolve, but its hidden
  // families are its own report to give — otherwise a strict consumer,
  // which by the per-file gate hides nothing of its own, gets a ledger
  // made entirely of other people's counts, offering a `rip.strict` it
  // already set in a package.json it did not open.
  //
  // Widening the SAME workspace to cover that project brings the counts
  // back, named: one check spans several package.jsons, and the remedy
  // has to say which one it means (the home project alone stays unnamed).
  // The two arms differ only in what the run was asked about.
  test('hidden diagnostics are the ledger of the code checked, not of the dependencies it reached', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),   // anchor the mirror at the monorepo root
      'packages/app/package.json': JSON.stringify({ rip: { strict: true } }),
      'packages/app/app.rip': "import { x } from '../util/util.rip'\nconsole.log x\n",
      'packages/util/package.json': JSON.stringify({}),
      'packages/util/util.rip': [
        'y = 42',
        'bad = y.toUpperCase()',      // held → scope family, charged to packages/util
        'def shout(msg)',             // implicitly-any parameter → annotation family
        '  msg',
        'export x = 1',
        'console.log bad, shout',
      ].join('\n') + '\n',
    });
    try {
      // Asked about the strict consumer: util is a dependency, and says
      // nothing here — no ledger at all, not merely an unnamed one.
      const consumer = check(dir, [path.join('packages', 'app')]).stdout;
      expect(consumer).toContain('No type errors');
      expect(consumer).not.toContain('hidden');
      // Asked about the workspace: util is covered, so it is counted —
      // and named, because the remedy belongs to ITS package.json.
      const both = check(dir).stdout;
      expect(both).toMatch(/\d+ diagnostics? hidden in unannotated code \(packages\/util\) — annotate a declaration/);
      expect(both).toMatch(/\d+ annotation diagnostics? hidden \(packages\/util\) — set `rip\.strict`/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A pattern catch mints its binding (`catch (_err) { ({message} = _err); … }`)
  // and annotates it, so the lowering's own destructure never publishes —
  // in EITHER try, statement or value, on EITHER pattern kind. The four
  // spellings ride together because the two tries are separate emissions:
  // annotating one leaves the other's destructure standing.
  //
  // The two guards below are what keep the annotation scoped to the minted
  // binding, which is the whole ruling. The identifier spelling's `unknown`
  // is honest and user-governable (`instanceof`, a cast), so its TS18046
  // must survive: that assertion goes red the day someone loosens the catch
  // type globally instead. And the handler BODY stays checked — a wrong
  // assignment beside the destructure still publishes — so the annotation
  // cannot have been spent on the whole clause. Codes bound to their lines,
  // columns free. Liveness-paired.
  // The identifier spelling's `unknown` was deliberate once — the author
  // can narrow it the ordinary ways, and `catch err: any` is spellable.
  // The gradual-annotations posture overrides that: `err.message` is the
  // commonest catch body there is, and requiring a narrowing the author
  // did not ask for is annotation pressure, which is the one thing this
  // mode governs. Under `rip.strict` the `unknown` is back — asserted
  // below, so the ruling is pinned in both directions rather than simply
  // relaxed.
  test('a pattern catch never publishes from its own lowering; an identifier catch follows the mode', () => {
    const dir = workspace({
      'catchpat.rip': [
        'try',
        "  JSON.parse('broken')",
        'catch {message}',
        '  console.log message',
        '',
        'try',
        "  JSON.parse('broken')",
        'catch [first]',
        '  console.log first',
        '',
        'label = try',
        "  JSON.parse('broken')",
        'catch {message}',
        '  message',
        '',
        'pair = try',
        "  JSON.parse('broken')",
        'catch [first]',
        '  first',
        '',
        'console.log label, pair',
      ].join('\n') + '\n',
      'scoped.rip': [
        'try',
        "  JSON.parse('broken')",
        'catch e',
        '  console.log e.message',
        '',
        'try',
        "  JSON.parse('broken')",
        'catch {message}',
        "  n: number = 'oops'",
        '  console.log message, n',
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      expect(diags.filter((d) => d.file === 'catchpat.rip')).toEqual([]);
      // Gradual: the `e.message` read is gone; the planted TS2322 stays,
      // so the file is still being checked rather than skipped.
      expect(diags.filter((d) => d.file === 'scoped.rip').map((d) => [d.code, d.line]))
        .toEqual([[2322, 9]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The other half of the same ruling: a project that asked for strict is
  // told about the unnarrowed catch read, exactly as TypeScript would.
  test('under rip.strict an identifier catch is `unknown` again', () => {
    const dir = workspace({
      'scoped.rip': [
        'try',
        "  JSON.parse('broken')",
        'catch e',
        '  console.log e.message',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.map((d) => [d.code, d.line])).toEqual([[18046, 4]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A forward reference forces the hoist split, which is what puts a binding
  // into the pin probe at all — a class declared before its uses takes
  // declare-in-place and never rounds. tsgo types an anonymous class by its
  // own binding, so the probe declaration answers `typeof __rip_probe_N_Box`,
  // and accepting that annotated the REAL binding with a name deleted along
  // with the probe file: TS2304 on legal code, spelled in vocabulary the
  // author could find nowhere. `parseProbeHover` now refuses any answer
  // naming a probe symbol, landing on the probe round's status quo.
  //
  // BOTH spellings, because the component is the shape that reaches real
  // code — mutual and forward references between components are ordinary
  // component-library structure, and a component lowers to a class
  // expression. Liveness-paired: `live.rip` proves the run type-checked at
  // all rather than reporting nothing because nothing ran.
  test('a forward-referenced class and a forward-rendered component both check clean — no minted symbol escapes the probe', () => {
    const dir = workspace({
      'fwd.rip': [
        'make = -> new Box()',    // reads Box above its declaration — forces the hoist split
        'Box = class',
        "  greet: -> 'hi'",
        'console.log make().greet()',
      ].join('\n') + '\n',
      'comp.rip': [
        'Parent = component',
        '  render',
        "    Child text: 'hi'",   // renders Child above its declaration
        '',
        'Child = component',
        '  @text: string',
        '  render',
        '    div',
        '      = @text',
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      expect(diags.filter((d) => d.file === 'fwd.rip')).toEqual([]);
      expect(diags.filter((d) => d.file === 'comp.rip')).toEqual([]);
      // No diagnostic anywhere may wear the minted vocabulary — the substantive
      // half of this row. A future pin shape that leaks the probe name through
      // some other message reds here rather than in a fixture nobody reads.
      expect(diags.filter((d) => /__rip_probe_/.test(d.message))).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The FLOOR's accepted cost, asserted so it cannot be mistaken for a fix.
  // Refusing the self-referential answer leaves the binding unpinned — an
  // evolving `any` — so a wrong call through it is NOT caught. That is the
  // status quo the probe round promises on every failure path, and it is
  // strictly better than a false error; it is not the ceiling. Substituting
  // the real name (`typeof Box`) is circular at the declaration site and
  // needs a shape that avoids self-annotation, which is a design step beyond
  // the filter. This assertion is that row's exit: it reds the day a pin
  // arrives, which is the cue to invert it.
  // The unpinned binding is STRICT WORKING, not a gap, and this is what says
  // so: a strict project is told the binding is implicitly `any`, and has two
  // ordinary spellings to answer with. Without this the residual reads like an
  // unreachable corner — the difference between "rip cannot express it" and
  // "rip asks you to", which is the whole of what `rip.strict` means.
  // Declare-first also documents the trigger: a class declared before its uses
  // takes declare-in-place and never enters the probe set at all.
  test('under rip.strict the unpinned forward reference is an ordinary missing annotation — reordering or annotating answers it', () => {
    const dir = workspace({
      'bare.rip': [
        'make = -> (new Box())',
        'Box = class',
        "  greet: -> 'hi'",
        'console.log make().greet()',
      ].join('\n') + '\n',
      'first.rip': [
        'class Box',                       // declared before its uses — never rounds
        "  greet: -> 'hi'",
        'make = -> (new Box())',
        'console.log make().greet()',
      ].join('\n') + '\n',
      'said.rip': [
        'interface BoxT',                  // the author states the shape
        '  greet(): string',
        'make = -> (new Box())',
        'Box: { new(): BoxT } = class',
        "  greet: -> 'hi'",
        'console.log make().greet()',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // The implicit-any family, which `rip.strict` exists to un-suppress —
      // and NOT a 2304: the minted symbol must not come back under any mode.
      expect(diags.filter((d) => d.file === 'bare.rip').map((d) => d.code).sort((a, b) => a - b))
        .toEqual([7005, 7034]);
      expect(diags.filter((d) => d.file === 'first.rip')).toEqual([]);
      expect(diags.filter((d) => d.file === 'said.rip')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('the refused answer leaves the binding unpinned — a wrong call through it is the floor\'s accepted cost', () => {
    const dir = workspace({
      'unpinned.rip': [
        'make = -> new Box()',
        'Box = class',
        "  greet: -> 'hi'",
        'console.log make().greet(1, 2, 3)',   // arity nobody declared — unpinned, so unchecked
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      expect(diags.filter((d) => d.file === 'unpinned.rip')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A forward-referenced COMPONENT is not on the floor above: it has a
  // published constructor type — the surface the shipped `.d.ts` already
  // declares — so the split declaration is annotated with it instead of
  // left evolving. That is the shape the class row calls "a design step
  // beyond the filter": self-annotation is not circular here, because the
  // type is CONSTRUCTED from the component's own members rather than read
  // back from the binding. A plain `class` still has no such surface and
  // keeps its floor, which is why the row above stays green.
  test('under rip.strict a forward-rendered component carries its published type — the implicit-any family is closed and its props are checked through it', () => {
    const dir = workspace({
      'ok.rip': [
        'Parent = component',
        '  render',
        "    Child text: 'hi'",           // renders Child above its declaration
        '',
        'Child = component',
        '  @text: string',
        '  render',
        '    div',
        '      = @text',
      ].join('\n') + '\n',
      'wrong.rip': [
        'Parent = component',
        '  render',
        "    Child txet: 'hi'",           // misspelled prop, ABOVE the declaration
        '',
        'Child = component',
        '  @text: string',
        '  render',
        '    div',
        '      = @text',
      ].join('\n') + '\n',
      'generic.rip': [
        "mk = -> new Box({ item: 'hi' })",
        'Box<T> = component',
        '  @item: T',
        '  render',
        '    div',
        '      = "#{@item}"',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // Neither 7005 nor 7034: the declaration is typed, so no read of it
      // is an evolving `any` — the family this row exists to close.
      expect(diags.filter((d) => d.file === 'ok.rip')).toEqual([]);
      // And the type is LOAD-BEARING, not merely present: a prop the
      // component never declared is caught through the forward binding,
      // which the evolving `any` accepted silently.
      const wrong = diags.filter((d) => d.file === 'wrong.rip');
      expect(wrong.map((d) => d.code)).toEqual([2353]);   // the excess-property refusal
      expect(wrong[0].message).toContain('txet');
      // A GENERIC component keeps the floor, and this is what says so.
      // Its class expression instantiates its parameter through the
      // optional props slot, so the published `Box<T>` return is one the
      // class cannot satisfy — annotating anyway trades this ordinary
      // implicit-any for a TS2322 that names only generated types. This
      // row reds the day the class road propagates its parameters
      // exactly, which is the cue to drop the decline.
      expect(diags.filter((d) => d.file === 'generic.rip').map((d) => d.code).sort((a, b) => a - b))
        .toEqual([7005, 7034]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('a promoted parameter declares its field — the field-less spelling checks clean', () => {
    // `constructor: (@owner: string) ->` assigns the instance property and
    // declares nothing, and TypeScript reads a class's properties from its
    // DECLARATIONS alone — so the field-less spelling drew TS2339 at the
    // promotion and again at every member use, on legal rip. The face now
    // declares what the promotion implies, TS-only.
    //
    // All four promoted spellings ride one constructor here (bare, typed,
    // defaulted, typed-and-defaulted): the annotation is what the field is
    // typed from, so a fix reaching only the annotated ones leaves the
    // others reporting. The DEDUPE is the second half — `Badge` and `Tag`
    // spell the declaration themselves, on either side of the constructor,
    // and a face that declares unconditionally reports them as duplicate
    // identifiers (TS2300) rather than accepting the redundancy.
    //
    // The construction's own argument types are asserted through the
    // liveness file's neighbours: `wrongPromoted` passes a number where the
    // typed promotion takes a string, so a face that dropped the parameter's
    // annotation while declaring the field would go red here.
    const dir = workspace({
      'promote.rip': [
        'class Crate',
        '  constructor: (@owner: string, @level: number = 1, @tag, @seal = false) ->',
        '  describe: -> "#{@owner}/#{@level}/#{@tag}/#{@seal}"',
        '',
        '# A defaulted promotion whose annotation is NARROWER than the',
        '# default infers: `\'on\'` alone widens to string, so the annotation',
        '# has to ride the default wrapper or the field is declared string',
        '# and the promotion publishes a spurious TS2322. `@level: number = 1`',
        '# cannot see that — number is exactly what 1 infers to.',
        'class Toggle',
        "  constructor: (@mode: 'on' | 'off' = 'on') ->",
        '  read: -> @mode',
        '',
        'class Badge',
        '  owner: string',
        '  constructor: (@owner: string) ->',
        '  who: -> @owner',
        '',
        'class Tag',
        '  constructor: (@name: string) ->',
        '  name: string',
        '  read: -> @name',
        '',
        "crate = new Crate('ada', 2, 'blue')",
        "console.log(new Toggle().read(), new Toggle('off').read())",
        "console.log(crate.owner, crate.describe(), new Badge('b').who(), new Tag('t').read())",
        '',
      ].join('\n'),
      'live.rip': [
        "n: number = 'oops'",
        'console.log n',
        '',
        'class Vault',
        '  constructor: (@holder: string) ->',
        '',
        'wrongPromoted = new Vault(7)',
        'console.log wrongPromoted',
        '',
      ].join('\n'),
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // The liveness file's two, and ONLY those — an exact list over the
      // whole workspace, so a spelling that started reporting cannot hide
      // behind a `toContain` on a different file.
      expect(diags.map((d) => [d.file, d.code]))
        .toEqual([['live.rip', 2322], ['live.rip', 2345]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a write to a computed is an emitter decline, bound to the write line', () => {
    // `doubled = 5` off `doubled ~= …` is REJECTED at compile — a real
    // message, never broken output (the for-range-ban model). This is the
    // decline's home: the spelling cannot enter the Diagnostics Audit, whose
    // error pairs need a face to publish from, and an emitter decline aborts
    // the compile before any face exists. The readonly-write beside it
    // (`limit = 7` off `limit =! 100`) is NOT this class — it compiles and
    // publishes TS2588, which the lane derives from the reactive pair's twin.
    const dir = workspace({
      'writecomp.rip': 'doubled ~= 2 * 2\ndoubled = 5\nconsole.log(doubled)\n',
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/writecomp\.rip:2:\d+ - error: emitter: cannot assign to computed 'doubled'/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a render branch body and a loop row are type-checked through the typed factory params', () => {
    // A branch/loop body lowers to a block factory; the face types the
    // factory's self param `: this` (carried into the handle's p() by
    // a face-only alias) and the loop item from the iterable's element
    // type, so a bad member access INSIDE the branch or row reports
    // exactly like one at render top level — in PERMISSIVE mode, on
    // the user's own expression. The errors drive BARE, no directive:
    // a directive-covered fixture would pin rip's suppression, not
    // the checking.
    const src = [
      'type TOption = { id: number, label: string }',
      '',
      'export Gotcha = component',
      '  @options?: TOption[]',
      "  label := ''",
      '  count := 42',
      '',
      '  render',
      '    div',
      '      if label',
      '        span count.toUpperCase()',
      '      for opt in options',
      '        li opt.label.bogusMethod()',
      '',
    ].join('\n');
    const dir = workspace({ 'c.rip': src });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('c.rip:11:20 - error'); // `toUpperCase`, inside the branch body
      expect(r.stdout).toContain("Property 'toUpperCase' does not exist on type 'number'");
      expect(r.stdout).toContain('c.rip:13:22 - error'); // `bogusMethod`, through the typed loop item
      expect(r.stdout).toContain("Property 'bogusMethod' does not exist on type 'string'");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('a loop over a call types its row from the call\'s element type — top level, keyed, and nested', () => {
    // `typeof` takes only an entity path, so a call iterable reaches the
    // row through the loop's face-only thunk. The misspelled call reports
    // once, at the loop head. A render local — declared before the loop
    // or after it — is out of the thunk's reach, so those rows stay bare.
    const src = [
      "ROWS = [{ id: 1, tags: ['p', 'q'] }]",
      '',
      'export Rows = component',
      '  render',
      '    ul',
      '      for row in ROWS.slice(0, 1)',
      '        li row.bogusRow',
      '      for row in ROWS.filter((r) -> r.id > 0)',
      '        li key: row.id, row.bogusKeyed',
      '      for row in ROWS',
      '        for tag in row.tags.map((t) -> t.trim())',
      '          li tag.bogusTag()',
      '      for row in ROWS.slize(0)',
      '        li row',
      '      for row in ROWS',
      '        picked = row.tags',
      '        for early in picked.slice(0)',
      '          li early',
      '        for late in later.slice(0)',
      '          li late',
      '        later = row.tags',
      '',
    ].join('\n');
    const dir = workspace({ 'c.rip': src });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      const strict = check(dir, ['--strict']).stdout;
      expect(strict.match(/TS7006/g)).toHaveLength(2);
      expect(strict).toContain("c.rip:17:13 - error TS7006: Parameter 'early'");
      expect(strict).toContain("c.rip:19:13 - error TS7006: Parameter 'late'");
      expect(r.stdout).not.toContain('TS2304');
      expect(r.stdout).toContain("c.rip:7:16 - error TS2339: Property 'bogusRow' does not exist on type '{ id: number; tags: string[]; }'");
      expect(r.stdout).toContain("c.rip:9:29 - error TS2339: Property 'bogusKeyed' does not exist on type '{ id: number; tags: string[]; }'");
      expect(r.stdout).toContain("c.rip:12:18 - error TS2339: Property 'bogusTag' does not exist on type 'string'");
      expect(r.stdout.match(/'slize'/g)).toHaveLength(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('event handler params carry the event type — inline and named-method refs alike', () => {
    // The face types both handler shapes from HTMLElementEventMap: a
    // literal ≤1-param handler through the typed cast on the handler
    // expression, and a `@event: @method` ref by annotating the
    // METHOD's first bare param (the render tree is pre-scanned for
    // the bindings). A garbage member through `e` reports in
    // PERMISSIVE mode; the real event surface stays clean, `e.target`
    // reads stay deliberately unchecked (`target: any` — the event
    // may have bubbled from any descendant), and an author-annotated
    // param is never overridden.
    const src = [
      'export Handlers = component',
      '  count := 0',
      '',
      '  handleSubmit: (e) -> e.preventDefault()',
      '  badNamed: (e) -> e.notAnEventProperty.deeper()',
      '',
      '  render',
      '    form @submit: @handleSubmit',
      "      button @click: @badNamed, 'bad'",
      "      button @click: (e) -> console.log e.clientX, 'ok'",
      '      input @input: (e) -> console.log e.target.value',
      "      button @click: (e) -> e.alsoNotAnEventProperty, 'bad inline'",
      "      button @click: (e: MouseEvent) -> console.log e.button, 'annotated'",
      '',
    ].join('\n');
    const dir = workspace({ 'h.rip': src });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('h.rip:5:22 - error'); // named ref: at the method definition
      expect(r.stdout).toContain("Property 'notAnEventProperty' does not exist");
      expect(r.stdout).toContain('h.rip:12:31 - error'); // inline: on the handler body
      expect(r.stdout).toContain("Property 'alsoNotAnEventProperty' does not exist");
      // Exactly the two planted errors — preventDefault/clientX/
      // target.value/annotated-param lines raise nothing.
      expect(r.stdout).toContain('Found 2 errors');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('the implicit-any family is permissive by default, strict under rip.strict', () => {
    const src = 'greet = (name) -> name.toUpperCase()\nconsole.log greet("hi")\n';
    const loose = workspace({ 'a.rip': src }, null);
    const strict = workspace({ 'a.rip': src }, { strict: true });
    try {
      const l = check(loose);
      expect(l.status).toBe(0); // unannotated code is legal rip

      const s = check(strict);
      expect(s.status).toBe(1);
      expect(s.stdout).toContain('TS7006');
      expect(s.stdout).toContain('a.rip:1:10 - error'); // the `name` parameter
    } finally {
      fs.rmSync(loose, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 90_000);
});
