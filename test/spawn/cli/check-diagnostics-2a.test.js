// `rip check` — type diagnostics over the real server, part 2a of 6
// (cases 1–25 of the former part 2; see check-diagnostics-1a.test.js for why the
// describe is split). The runner and workspace builders live in
// ./support/check-harness.js.

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
});
