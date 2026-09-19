// `rip check` — type diagnostics over the real server, part 2b of 6
// (cases 26–50 of the former part 2; see check-diagnostics-1a.test.js for why the
// describe is split). The runner and workspace builders live in
// ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { TSCONFIG, workspace, monorepo, check } from './support/check-harness.js';

describeExtended('rip check: type diagnostics over the real server', () => {
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
