// `rip check` — type diagnostics over the real server, part 1b of 6
// (cases 26–40 of the former part 1; see check-diagnostics-1a.test.js for why the
// describe is split). The runner and workspace builders live in
// ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { TSCONFIG, workspace, check } from './support/check-harness.js';

describeExtended('rip check: type diagnostics over the real server', () => {
  // `--public` is a mode, not a modifier: it replaces the type-checking
  // report, so a compile failure has no other way out and must leave
  // through this one. An entry that does not compile publishes nothing a
  // consumer can resolve, and nothing-to-report is not the same answer.
  // Q6 — what makes two findings the SAME position. Deduplicating is right:
  // one declaration reached by six paths is one edit. But the key has to be
  // the declaration, and the compiler puts every field a constructor
  // synthesizes on the constructor's line, so a key taken from the mapped
  // SOURCE position collapses distinct annotations into one.
  //
  // The shadow relation is the same question asked the other way: a field
  // synthesized from `@name = param` really is the parameter's shadow, but
  // sharing a name is not evidence of it. Both errors run in the
  // under-reporting direction.
  test('--public counts a position per declaration, and calls a field a shadow only when it is one', () => {
    // (a) Three fields, three annotations, one constructor line.
    const many = workspace({
      'package.json': JSON.stringify({ name: '@q6/many', exports: { '.': './index.rip' } }),
      'index.rip': ['export class Holder', '  constructor: ->', '    @alpha = {}', '    @beta = {}', '    @gamma = {}'].join('\n') + '\n',
    });
    // (b) A field that merely SHARES a name with a parameter it was never
    // assigned from. Annotating the parameter cannot fix it, so hiding it
    // walks the reader in a circle.
    const notShadow = workspace({
      'package.json': JSON.stringify({ name: '@q6/notshadow', exports: { '.': './index.rip' } }),
      'index.rip': 'export class Holder\n  constructor: (first) ->\n    @first = {}\n',
    });
    // (c) The genuine shadow: annotating the parameter answers both, so it
    // is one position, not two.
    const shadow = workspace({
      'package.json': JSON.stringify({ name: '@q6/shadow', exports: { '.': './index.rip' } }),
      'index.rip': 'export class Holder\n  constructor: (first) ->\n    @first = first\n',
    });
    try {
      const a = check(many, ['--public']).stdout;
      for (const f of ['alpha', 'beta', 'gamma']) expect(a).toContain(`Holder#${f}`);
      expect(a).toContain('3 positions need a type');

      const b = check(notShadow, ['--public']).stdout;
      expect(b).toMatch(/Holder\.new\(first\)/);   // the parameter
      expect(b).toMatch(/Holder#first/);            // AND the field it never fed
      expect(b).toContain('2 positions need a type');

      const c = check(shadow, ['--public']).stdout;
      expect(c).toMatch(/Holder\.new\(first\)/);
      expect(c).not.toMatch(/Holder#first/);        // one edit, one position
      expect(c).toContain('1 position needs a type');
    } finally {
      for (const w of [many, notShadow, shadow]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // The same question from the other side: what makes two positions ONE
  // piece of work. A declaration reached by several paths is one edit, and
  // deduplicating by declaration is what says so. A TYPE reached at several
  // positions is not: `any[]` at a parameter and `any[]` at a property are
  // one type and two annotations, in two places, and the second is never
  // named by a walk that only remembers which types it has opened. Every
  // way of losing that thread reports the position as clean surface.
  //
  // What counts as one position has to be read the same way the report
  // reads it, or the memory drops what the report would have placed
  // somewhere new: two call signatures returning the same type are two
  // returns to annotate, though the symbol exposing them is one.
  //
  // The remembering still has to bound the walk. A type that contains
  // itself arrives at itself, and must open a finite number of times.
  test('--public opens a repeated type once per position, and still ends on a type that contains itself', () => {
    // Three arrivals at one `any[]`: a parameter and two properties, each
    // its own annotation to write.
    const repeated = workspace({
      'package.json': JSON.stringify({ name: '@q6/repeated', exports: { '.': './index.rip' } }),
      'index.rip': [
        'type Opts =',
        '  first?: any[]',
        '  second?: any[]',
        '',
        'export def take(o: Opts, items: any[]): string',
        "  ''",
      ].join('\n') + '\n',
    });
    // `Node.next` is a `Node`, so the walk meets the type it is already
    // inside. One annotation, however many times it is reached.
    const cyclic = workspace({
      'package.json': JSON.stringify({ name: '@q6/cyclic', exports: { '.': './index.rip' } }),
      'index.rip': [
        'type Node =',
        '  next: Node',
        '  tag: any',
        '',
        'export def visit(n: Node): string',
        "  ''",
      ].join('\n') + '\n',
    });
    // Two signatures, one exposing symbol, one returned type — and two
    // return annotations to write.
    const overloaded = workspace({
      'package.json': JSON.stringify({ name: '@q6/overloaded', exports: { '.': './index.rip' } }),
      'index.rip': [
        'type F =',
        '  (a: string): any[]',
        '  (a: number): any[]',
        '',
        'export def use(f: F): string',
        "  ''",
      ].join('\n') + '\n',
    });
    try {
      const a = check(repeated, ['--public']).stdout;
      expect(a).toContain('any at: take(items)[]');
      expect(a).toContain('any at: take(o).first[]');
      expect(a).toContain('any at: take(o).second[]');
      expect(a).toContain('3 positions need a type');

      const b = check(cyclic, ['--public']).stdout;
      expect(b).toContain('any at: visit(n).tag');
      expect(b).toContain('1 position needs a type');

      const c = check(overloaded, ['--public']).stdout;
      expect(c).toContain('any at: use(f)()[]');
      expect(c).toContain('2 positions need a type');
    } finally {
      for (const w of [repeated, cyclic, overloaded]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // Q4 — a package publishes from inside itself. `npm pack` roots the
  // tarball at the package directory, so an entry named with `../` is not in
  // the shipped artifact at all: the shape resolves only inside a symlinked
  // workspace and breaks for the very consumer this audit speaks for. It is
  // reported rather than skipped, because a manifest that names an entry has
  // named it, and silence would read as a package with no surface.
  test('--public reports a manifest that publishes from outside the package', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ name: '@q4/outside', exports: { '.': '../shared/api.rip' } }),
      'inside.rip': 'export here: number = 1\n',
    });
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toMatch(/publishes from outside the package/);
      expect(out.stdout).toContain('../shared/api.rip');
      expect(out.stdout).not.toContain('no package publishes');
      expect(out.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A namespace import binds the whole module rather than any one name, so
  // nothing narrows what a file may resolve untyped — every export is
  // reachable through the alias. Reading only the braced list makes such an
  // import invisible, and the identical inherited `any` reports as a clean
  // project. Three spellings, because the star may be preceded by a default
  // binding and the space after it is optional.
  test('a received `any` is advised through a namespace import, however it is spelled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-ns-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      for (const p of ['lib', 'app']) fs.mkdirSync(path.join(dir, 'packages', p), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules', '@n'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'package.json'),
        JSON.stringify({ name: '@n/lib', exports: { '.': './lib.rip' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'lib.rip'), 'export class Session\n  run: (x) -> x\n');
      fs.symlinkSync(path.join('..', '..', 'packages', 'lib'), path.join(dir, 'node_modules', '@n', 'lib'));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@n/app', rip: { strict: true } }));
      const app = path.join(dir, 'packages', 'app', 'app.rip');
      const target = path.join('packages', 'app');

      // The braced form, as a control: this one already worked.
      fs.writeFileSync(app, "import { Session } from '@n/lib'\ns = new Session()\nconsole.log s\n");
      expect(check(dir, [target]).stdout).toContain('imported from `@n/lib`');

      // The same leak reached through an alias, in each legal spelling.
      for (const line of ["import * as lib from '@n/lib'", "import *as lib from '@n/lib'"]) {
        fs.writeFileSync(app, `${line}\ns = new lib.Session()\nconsole.log s\n`);
        const out = check(dir, [target]).stdout;
        expect(out).toContain('imported from `@n/lib`');
        expect(out).toContain('`Session`');
        expect(out).toMatch(/app\.rip:\d+:\d+\s+lib/);   // the alias is where it arrived
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A mode that prints a report has no JSON form to offer, and a run that
  // could not read what it was asked has not audited a clean surface. Both
  // are the same rule as the rest of this file's exit contract: 0 means
  // checked-and-clean, never couldn't-check.
  test('--public refuses --json, and will not exit 0 on a run it could not complete', () => {
    // `secret.rip` is in the ENTRY's closure — the audit reads only what
    // the manifest publishes and what that reaches, so an unreadable file
    // outside the closure is no part of this surface.
    const dir = workspace({
      'package.json': JSON.stringify({ name: 'exitpkg', exports: { '.': './index.rip' } }),
      'index.rip': "import { hidden } from './secret.rip'\nexport ok: number = 1\nconsole.log hidden\n",
      'secret.rip': 'export hidden: number = 2\n',
    });
    try {
      // A clean package is clean.
      expect(check(dir, ['--public']).status).toBe(0);
      // `--json` is not a form this mode has; say so rather than answer a
      // machine in prose.
      const json = check(dir, ['--public', '--json']);
      expect(json.stderr).toContain('--public has no --json form');
      expect(json.status).toBe(2);
      // A file the run cannot read leaves the surface unaudited.
      fs.chmodSync(path.join(dir, 'secret.rip'), 0o000);
      const blocked = check(dir, ['--public']);
      expect(blocked.status).toBe(2);
      fs.chmodSync(path.join(dir, 'secret.rip'), 0o644);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Q5 — the walk stops at a member whose type is another published export,
  // because that export has its own row and one edit fixes it there.
  // MEMBERSHIP is the whole question, and two shapes probe what the set is.
  test('--public stops at a sibling wherever one exists, and reads the set per package', () => {
    // (a) The sibling is a bare TYPE and the position reading it is a
    // value — different sides — and the stop fires all the same. Every row
    // applies one verdict, so `Bag`'s row reports what `Client`'s would;
    // descending anyway would bill one edit to two exports.
    const typeOnly = workspace({
      'package.json': JSON.stringify({ name: '@q5/type', exports: { '.': './index.rip' } }),
      'index.rip': ['export interface Bag', '  hole: any', '',
        'export class Client', '  bag: Bag = ({} as Bag)'].join('\n') + '\n',
    });
    // (b) A package publishes from every entry its manifest names, so what
    // it publishes — the set the stop consults — is a property of the
    // PACKAGE. Read per entry, one edit is blamed on every export that
    // happens to expose it.
    const twoEntry = workspace({
      'package.json': JSON.stringify({ name: '@q5/two', exports: { '.': './index.rip', './s': './s.rip' } }),
      's.rip': 'export class Session\n  run: (x) -> x\n',
      'index.rip': "import { Session } from './s.rip'\nexport class Client\n  session: Session = new Session()\n",
    });
    try {
      const a = check(typeOnly, ['--public']).stdout;
      expect(a).toMatch(/any at: Bag\.hole/);            // the row that owns the edit
      expect(a).not.toMatch(/at: Client#bag/);           // and only that row
      expect(a).toMatch(/\u21b7 Client/);                 // which is not a clean bill here
      expect(a).toMatch(/reaches `Bag`/);
      expect(a).toContain('0/2 exports fully typed');

      const b = check(twoEntry, ['--public']).stdout;
      expect(b).toContain('0/2 exports fully typed');   // Session owns the work
      expect(b).toMatch(/✗ Session/);
      expect(b).toMatch(/\u21b7 Client/);
      expect(b).toMatch(/reaches `Session`/);           // read across the two entries
      expect(b).not.toMatch(/at: Client#session\.run/);
    } finally {
      for (const w of [typeOnly, twoEntry]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // The stop is a fact about the POSITION, not about how the position was
  // reached: a signature's parameter and its return each name another
  // published export exactly as a property does, and a name is a name
  // however the type was spelled. Both shapes below put one declaration
  // under several rows, and every row but one has no edit to offer.
  test('--public stops at a sibling reached through a return, a parameter, or an alias', () => {
    // (a) One class, three arrivals: `holder` reads it as a property,
    // `makeThing` returns it, `useThing` takes it. Only one of the four may
    // keep the instance's defects, and it is `Thing`'s own row.
    const returned = workspace({
      'package.json': JSON.stringify({ name: '@sib/ret', exports: { '.': './index.rip' } }),
      'index.rip': ['export class Thing', '  constructor: (x) ->', '    @val = x', '',
        'export holder: { thing: Thing } = { thing: Thing.new(1) }', '',
        'export def makeThing(): Thing', '  Thing.new(1)', '',
        'export def useThing(t: Thing): string', "  'x'"].join('\n') + '\n',
    });
    // (b) A type alias and a class, side by side under one export. The
    // checker answers `getSymbol` on an alias-to-object-literal with the
    // anonymous object's symbol and carries the alias apart, so a stop that
    // asks only the one question sees `Box` as nothing the package
    // published — and re-reports what `Box`'s own row already owns.
    const aliased = workspace({
      'package.json': JSON.stringify({ name: '@sib/alias', exports: { '.': './index.rip' } }),
      'index.rip': ['export type Box =', '  val: any', '',
        'export class Thing', '  constructor: (x) ->', '    @val = x', '',
        'export both: { box: Box, thing: Thing } = { box: { val: 1 }, thing: Thing.new(1) }'].join('\n') + '\n',
    });
    // Every printed finding is a position the summary counted. The printer
    // prints one line per defect and the summary counts declarations, so
    // the two agree exactly when no declaration is reported twice — which
    // is the property the stop exists to hold.
    const printed = (out) => (out.match(/ at: /g) ?? []).length;
    const counted = (out) => Number(out.match(/(\d+) positions? needs? a type/)[1]);
    try {
      const a = check(returned, ['--public']).stdout;
      expect(a).toMatch(/any at: Thing#val/);            // the row that owns the edit
      expect(a).not.toMatch(/at: makeThing\(\)/);        // and only that row
      expect(a).not.toMatch(/at: useThing\(t\)/);
      expect(a).toMatch(/\u21b7 makeThing/);
      expect(a).toMatch(/\u21b7 useThing/);
      expect(a).toMatch(/\u21b7 holder/);                 // the property path, unchanged
      expect(a).toContain('0/4 exports fully typed');
      expect(printed(a)).toBe(counted(a));

      const b = check(aliased, ['--public']).stdout;
      expect(b).toMatch(/any at: Box\.val/);              // the alias's own row
      expect(b).not.toMatch(/at: both\./);                // neither member under `both`
      expect(b).toMatch(/\u21b7 both/);
      expect(b).toContain('0/3 exports fully typed');
      expect(printed(b)).toBe(counted(b));
    } finally {
      for (const w of [returned, aliased]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // The stop defers a position to a sibling's row, so it may only fire
  // where that row can ANSWER. Two of the three grounds for a verdict are
  // facts about the type and travel with it; the third is not, and a stop
  // that ignores the difference drops a defect no row will ever raise —
  // which is the direction of error that reads as a clean surface.
  test('--public defers to a sibling only where the sibling\'s row can answer', () => {
    // `Empty` carries nothing, and a published alias STATES itself: its own
    // row is clean and has nothing to say about anyone else. Every other
    // position here resolves to it, and each must answer for itself.
    const dir = workspace({
      'package.json': JSON.stringify({ name: '@sib/empty', exports: { '.': './index.rip' } }),
      'index.rip': ['export type Empty = {}', '',
        'export class Box', '  constructor: () ->', '    @slot = ({} as Empty)', '',
        'export def gives()', '  ({} as Empty)', '',
        'export holds: { e: Empty } = { e: ({} as Empty) }'].join('\n') + '\n',
    });
    try {
      const out = check(dir, ['--public']);
      // A property and a return, each unclaimed, each reached through a
      // sibling that reports nothing.
      expect(out.stdout).toContain('{} at: Box#slot');
      expect(out.stdout).toContain('{} at: gives()');
      // The sibling itself: an alias IS its own claim, so it leaks nothing
      // — which is precisely why it cannot cover the two above.
      expect(out.stdout).toMatch(/\u2713 Empty/);
      // And the control: a position that DOES claim its type is clean here
      // whether the walk stopped at `Empty` or not, so it isolates the
      // stated-ness of a position from the width of the type it names.
      expect(out.stdout).toMatch(/\u2713 holds/);
      expect(out.stdout).toContain('2/4 exports fully typed');
      expect(out.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A stop moves the EDIT, never the verdict. The row it defers to is the
  // one that has to change, and the row that stopped still hands a consumer
  // whatever the sibling hands it — so it counts as typed nowhere, and says
  // which row it is waiting on.
  //
  // Followed to a FIXPOINT: a deferral chain is as long as the types are
  // deep, and a row two hops from the edit is no cleaner than one hop from
  // it. The count stays a count of EDITS — a deferred row adds no position,
  // because there is nothing to fix there.
  test('--public counts a row deferring to a defective sibling as untyped, however deep', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ name: '@sib/chain', exports: { '.': './index.rip' } }),
      'index.rip': ['export interface Bag', '  hole: any', '',
        'export type Holder = { bag: Bag }', '',
        'export def take(h: Holder): string', "  'x'", '',
        'export def alone(n: number): string', "  'y'"].join('\n') + '\n',
    });
    try {
      const out = check(dir, ['--public']);
      // One edit, named once, under the row that has to make it.
      expect(out.stdout).toMatch(/any at: Bag\.hole/);
      expect(out.stdout).toContain('1 position needs a type');
      // One hop, and two: neither is a clean bill, and each names the row
      // it is waiting on rather than the edit it does not own.
      expect(out.stdout).toMatch(/\u21b7 Holder/);
      expect(out.stdout).toMatch(/reaches `Bag`/);
      expect(out.stdout).toMatch(/\u21b7 take/);
      expect(out.stdout).toMatch(/reaches `Holder`/);
      // A row that reaches none of it keeps its clean bill — the verdict
      // travels along the deferral edges and nowhere else.
      expect(out.stdout).toMatch(/\u2713 alone/);
      expect(out.stdout).toContain('1/4 exports fully typed');
      expect(out.stdout).toContain('2 more exports reach them');
      // A deferred row carries no position, so the printed findings still
      // number exactly what the summary counted.
      expect((out.stdout.match(/ at: /g) ?? []).length).toBe(1);
      expect(out.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A deferral edge names a SYMBOL. A package publishes from every entry its
  // manifest names, so one name can stand for two declarations, and reading
  // the edge back through the name answers for whichever row was seen last.
  test('--public resolves a deferral to the declaration it stopped at, not the name', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ name: '@sib/dup', exports: { '.': './index.rip', './other': './other.rip' } }),
      // `Bag` here leaks, and `Client` stops at THIS one.
      'index.rip': ['export interface Bag', '  hole: any', '',
        'export class Client', '  bag: Bag = ({} as Bag)'].join('\n') + '\n',
      // A second, unrelated `Bag` that is perfectly clean.
      'other.rip': ['export type Bag = { ok: string }', '',
        'export def fine(b: Bag): string', '  b.ok'].join('\n') + '\n',
    });
    try {
      const out = check(dir, ['--public']).stdout;
      expect(out).toMatch(/any at: Bag\.hole/);        // the edit, named once
      expect(out).toMatch(/\u21b7 Client/);             // and the row that waits on it
      expect(out).toMatch(/reaches `Bag`/);
      expect(out).toMatch(/\u2713 fine/);               // the clean Bag's reader is untouched
      expect(out).toContain('2/4 exports fully typed');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Q2a — what a package publishes is its MANIFEST's answer, and the mirror
  // already computes that answer to decide which faces to build. A second
  // reader is a second answer, and where they disagree `--public` audits
  // files no consumer can reach while the mirror never compiled them.
  //
  // A subpath PATTERN is a third thing: real surface, not enumerable from
  // the manifest alone. Under Q3 that is a floor — never "no entries", and
  // never a reason to audit some other file instead.
  test('--public resolves entries the way the mirror does, and floors what a manifest only patterns', () => {
    // (a) Conditions pick one target, the way an importing consumer does.
    const conditional = workspace({
      'package.json': JSON.stringify({ name: '@q2a/cond', exports: { '.': { import: './a.rip', require: './b.rip' } } }),
      'a.rip': 'export def fromImport(x)\n  x\n',
      'b.rip': 'export def fromRequire(x)\n  x\n',
    });
    // (b) A pattern names a shape. It is surface, and it is unenumerable.
    const patterned = workspace({
      'package.json': JSON.stringify({ name: '@q2a/glob', exports: { './*': './src/*.rip' } }),
      'src/thing.rip': 'export def thing(x)\n  x\n',
      'index.rip': 'export def notPublished(x)\n  x\n',
    });
    // (c) No manifest opinion at all — index.rip is the conventional entry.
    const bare = workspace({
      'package.json': JSON.stringify({ name: '@q2a/bare' }),
      'index.rip': 'export def only(x)\n  x\n',
    });
    try {
      const a = check(conditional, ['--public']).stdout;
      expect(a).toMatch(/fromImport/);
      expect(a).not.toMatch(/fromRequire/);   // the mirror builds a face for one

      const b = check(patterned, ['--public']);
      expect(b.stdout).toContain('every count below is a floor');
      expect(b.stdout).not.toMatch(/notPublished/);   // never audit an unpublished file
      expect(b.status).toBe(2);

      const c = check(bare, ['--public']);
      expect(c.stdout).toMatch(/only/);
      expect(c.status).toBe(1);
    } finally {
      for (const w of [conditional, patterned, bare]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // Q3 — a published name is in exactly one of three states, and the exit
  // status says which kinds occurred. Two of those states are facts about
  // the CODE (clean, leaking); the third is a fact about this AUDIT (it did
  // not see the surface). Mixing them is how "could not check" came to read
  // as "checked and clean".
  //
  // Every published name appears BY NAME whatever its state — a name that
  // vanishes takes the denominator with it, and a percentage whose
  // denominator moves is not a measure of progress.
  test('--public tells a clean name from a leaking one from one it never audited', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-q3-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      for (const p of ['lib', 'app']) fs.mkdirSync(path.join(dir, 'packages', p), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules', '@q3'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'package.json'),
        JSON.stringify({ name: '@q3/lib', exports: { '.': './lib.rip' } }));
      // One name that leaks and one that is clean, both declared HERE.
      fs.writeFileSync(path.join(dir, 'packages', 'lib', 'lib.rip'),
        'export class Session\n  run: (x) -> x\n\nexport def solid(n: number): number\n  n\n');
      fs.symlinkSync(path.join('..', '..', 'packages', 'lib'), path.join(dir, 'node_modules', '@q3', 'lib'));
      // `app` publishes one of its own plus two it only forwards.
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@q3/app', exports: { '.': './index.rip' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'index.rip'),
        "export { Session, solid } from '@q3/lib'\nexport def mine(n: number): number\n  n\n");

      const own = check(path.join(dir, 'packages', 'lib'), ['--public']);
      expect(own.stdout).toMatch(/✗ Session/);        // leaking, and it says where
      expect(own.stdout).toMatch(/✓ solid/);          // clean
      expect(own.stdout).toContain('1/2 exports fully typed');
      expect(own.status).toBe(1);

      const fwd = check(path.join(dir, 'packages', 'app'), ['--public']);
      // All three published names are LISTED, none silently dropped.
      for (const n of ['mine', 'Session', 'solid']) expect(fwd.stdout).toContain(n);
      // The two it cannot audit are marked as such, not scored clean.
      expect(fwd.stdout).toMatch(/not audited/);
      // The denominator counts only what was audited, and says so.
      expect(fwd.stdout).toContain('1/1 exports fully typed');
      // Could-not-audit is neither pass nor defect.
      expect(fwd.status).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Q2b — a module's own export table carries `export * from` as a single
  // opaque marker, so reading it alone reports a barrel as an empty surface.
  // The names ARE published, so each star is followed to its target module
  // and enumerated. What cannot be followed is a FLOOR: surface the audit
  // never saw, which is neither typed nor leaking.
  //
  // The five arms are one test because the failure modes are each other's
  // mirror image — a rule that floors correctly can invent floors, and a
  // rule that never invents one can miss a dead star hiding beside a live
  // one.
  test('--public follows each `export *` to its target, and floors only what it could not follow', () => {
    const live = workspace({
      'package.json': JSON.stringify({ name: '@q2/live', exports: { '.': './index.rip' } }),
      'a.rip': 'export def leaf(x)\n  x\n',
      'index.rip': "export * from './a.rip'\nexport def mine(n: number): number\n  n\n",
    });
    const dead = workspace({
      'package.json': JSON.stringify({ name: '@q2/dead', exports: { '.': './index.rip' } }),
      'index.rip': "export * from 'totally-not-installed-anywhere'\n",
    });
    const mixed = workspace({
      'package.json': JSON.stringify({ name: '@q2/mixed', exports: { '.': './index.rip' } }),
      'a.rip': 'export def good(n: number): number\n  n\n',
      'index.rip': "export * from './a.rip'\nexport * from 'totally-not-installed-anywhere'\n",
    });
    // A barrel whose target is itself a barrel. Skipping the inner star
    // loses everything behind it and reports an empty, perfect surface.
    const nestedBarrel = workspace({
      'package.json': JSON.stringify({ name: '@q2/nested', exports: { '.': './index.rip' } }),
      'c.rip': 'export def deep(x)\n  x\n',
      'b.rip': "export * from './c.rip'\n",
      'index.rip': "export * from './b.rip'\n",
    });
    const shadowed = workspace({
      'package.json': JSON.stringify({ name: '@q2/shadowed', exports: { '.': './index.rip' } }),
      'a.rip': 'export def one(n: number): number\n  n\n',
      'index.rip': "export * from './a.rip'\nexport def one(n: number): number\n  n\n",
    });
    try {
      // (a) followed: the forwarded name is a row, audited, positioned in
      // the file that declares it — and no floor, because nothing was missed.
      const a = check(live, ['--public']);
      expect(a.stdout).toMatch(/✗ leaf/);
      expect(a.stdout).toMatch(/a\.rip:\d+:\d+\s+any at: leaf\(x\)/);
      expect(a.stdout).toContain('1/2 exports fully typed');
      expect(a.stdout).not.toContain('every count below is a floor');
      expect(a.status).toBe(1);

      // (b) unfollowable: a floor, and never a clean bill.
      const b = check(dead, ['--public']);
      expect(b.stdout).toContain('every count below is a floor');
      expect(b.stdout).not.toContain('exports nothing');
      expect(b.status).toBe(2);

      // (c) a dead star does not hide behind a live one.
      const c = check(mixed, ['--public']);
      expect(c.stdout).toMatch(/✓ good/);            // the live star is enumerated
      expect(c.stdout).toContain('every count below is a floor');   // the dead one still counts
      expect(c.status).toBe(2);

      // (e) stars compose: the names behind a barrel-of-barrels are
      // published too, and are found by following through.
      const e = check(nestedBarrel, ['--public']);
      expect(e.stdout).toMatch(/✗ deep/);
      expect(e.stdout).toMatch(/c\.rip:\d+:\d+\s+any at: deep\(x\)/);
      expect(e.stdout).not.toContain('exports nothing');
      expect(e.status).toBe(1);

      // (d) a star whose names are shadowed by direct exports was followed
      // successfully — nothing was missed, so nothing is floored.
      const d = check(shadowed, ['--public']);
      expect(d.stdout).not.toContain('every count below is a floor');
      expect(d.status).toBe(0);
    } finally {
      for (const w of [live, dead, mixed, shadowed, nestedBarrel]) fs.rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  // Q1 — a declaration belongs to the package whose package.json is NEAREST
  // it, never to whichever directory the walk happened to start from.
  //
  // Ownership decides what the walk descends into, and a root that owns
  // nothing descends into nothing and comes back fully typed, so every way
  // of getting this wrong reads as a clean surface. Three shapes settle it
  // together, because a rule that handles one by special case fails another:
  // an entry BESIDE its package, an entry BELOW it, and a package NESTED
  // inside it. Only "nearest package.json" answers all three at once.
  test('--public owns a declaration by its nearest package.json, not by directory position', () => {
    // (a) The manifest lists a subdirectory entry FIRST. The root entry's
    // own members are still this package's.
    const first = workspace({
      'package.json': JSON.stringify({ name: '@q1/first', exports: { './sub': './sub/a.rip', '.': './index.rip' } }),
      'sub/a.rip': 'export other: number = 1\n',
      'index.rip': 'export lib = { helper: (x) -> x }\n',
    });
    // (b) The entry sits BELOW the package root while the implementation
    // sits BESIDE it. Both are the package's, though neither is under the
    // other — which a rule anchored on the entry's own directory misses.
    const spread = workspace({
      'package.json': JSON.stringify({ name: '@q1/spread', exports: { '.': './src/index.rip' } }),
      'lib/thing.rip': 'export class Thing\n  run: (x) -> x\n',
      'src/index.rip': "import { Thing } from '../lib/thing.rip'\nexport api = { t: Thing }\n",
    });
    // (c) A package NESTED inside the audited one. Its declarations are its
    // own, and the parent must not answer for them.
    const nested = workspace({
      'package.json': JSON.stringify({ name: '@q1/outer', exports: { '.': './index.rip' } }),
      'inner/package.json': JSON.stringify({ name: '@q1/inner', exports: { '.': './inner.rip' } }),
      'inner/inner.rip': 'export class Helper\n  work: (x) -> x\n',
      'index.rip': "import { Helper } from './inner/inner.rip'\nexport outer = { h: Helper }\n",
    });
    try {
      const a = check(first, ['--public']).stdout;
      expect(a).toContain('lib.helper(x)');           // descended into its own member
      expect(a).toContain('1/2 exports fully typed');

      const b = check(spread, ['--public']).stdout;
      expect(b).toContain('api.t');                   // reached a member declared beside the entry
      expect(b).toMatch(/lib\/thing\.rip:\d+:\d+/);  // and named its real position
      expect(b).toContain('0/1 exports fully typed');

      const c = check(nested, ['--public', 'index.rip']).stdout;
      // The nested package's positions are ITS work, not the parent's.
      expect(c).not.toMatch(/inner\/inner\.rip:\d+:\d+/);
    } finally {
      for (const d of [first, spread, nested]) fs.rmSync(d, { recursive: true, force: true });
    }
  }, 90_000);

  test('--public reports an entry it cannot compile and refuses to exit 0', () => {
    const dir = workspace({
      // The entry parses and is refused by the emitter; the sibling
      // compiles, so the run reaches the public pass with one readable file
      // and one unreadable entry.
      'index.rip': [
        'export type RoundingMode =',
        "  'UP' | 'DOWN' |",
        "  'HALF_UP'",
      ].join('\n') + '\n',
      'helper.rip': 'export def helper(n: number): number\n  n\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'broken-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('publishes nothing a consumer can resolve');
      expect(out.stdout).not.toContain('no package publishes a .rip entry here');
      expect(out.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
