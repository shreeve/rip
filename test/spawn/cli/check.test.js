// `rip check` — the headless type-checker. The editor
// server is the only place type diagnostics are computed; `rip check`
// drives that same server in batch, so this gate spawns the REAL CLI
// against real temp workspaces and asserts the mapped-back diagnostics,
// the exit status, and that config (rip.strict / rip.noCheck) and
// `@ts-expect-error` govern exactly as they do in the editor.
//
// The type cases need tsgo (they assert TS diagnostics), so they ride
// the EXTENDED tier alongside strict-modes.test.js. The argv/usage cases
// touch no server and stay always-on.

import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from '../../support/spawn.js';
import { describeExtended } from '../../support/extended.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../../..');
const BIN = path.join(ROOT, 'bin/rip');
const TSCONFIG = path.join(ROOT, 'test/audit/tsconfig.json');

// A fresh workspace: the fixtures' tsconfig (so tsgo runs the same
// posture the audit does — strictness riding tsgo's strict-by-default)
// plus whatever files/config the case needs.
function workspace(files, ripConfig = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-'));
  fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(ripConfig ? { rip: ripConfig } : {}, null, 2));
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return dir;
}

// A TWO-PACKAGE workspace: a loose root beside a nested project with its
// own `tsconfig.json`. Every other fixture here is single-package, where a
// flat mirror root is indistinguishable from a correct per-project one —
// which is exactly why the per-project gap went unseen. `strict` is the
// discriminator because it changes an ANSWER (TS2322 on `x: string = null`)
// rather than merely a setting, so the assertion cannot pass by accident.
function monorepo({ rootStrict = false, nestedStrict = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-mono-'));
  const base = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
  delete base.include;                       // the audit's own file set means nothing here
  delete base.exclude;
  base.compilerOptions.strict = rootStrict;
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(base, null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({}, null, 2));
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: nestedStrict } }, null, 2));
  fs.writeFileSync(path.join(dir, 'root.rip'), 'x: string = null\nconsole.log x\n');
  fs.writeFileSync(path.join(dir, 'pkg', 'a.rip'), 'y: string = null\nconsole.log y\n');
  return dir;
}

// A FRESH PROJECT: what a newcomer has after `bun init` plus a .rip
// file — a tsconfig, and @types/bun installed. `withTypes:false` is the
// same project before anything is installed, which is the posture the
// host floor exists for.
//
// The source is deliberately ordinary: the idioms rip encourages, not a
// minimal case. `(opts = {}) ->` is the shape that produced 329 of the
// 1,657 errors in a survey of packages/ (2026-07-31), and `import.meta.dir`
// another 143 — between them a fifth of everything a newcomer would see.
const FRESH = [
  'greet = (name, opts = {}) ->',
  "  suffix = opts.suffix ?? ''",
  '  name + suffix',
  '',
  'here = import.meta.dir',
  "console.log greet('world', { suffix: '!' }), here",
  '',
].join('\n');

function freshProject({ withTypes = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-fresh-'));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ESNext', module: 'preserve', moduleDetection: 'force', noEmit: true, skipLibCheck: true },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fresh', devDependencies: withTypes ? { '@types/bun': 'latest' } : {} }, null, 2));
  if (withTypes) {
    const t = path.join(dir, 'node_modules', '@types', 'bun');
    fs.mkdirSync(t, { recursive: true });
    fs.writeFileSync(path.join(t, 'package.json'), JSON.stringify({ name: '@types/bun', version: '1.0.0', types: 'index.d.ts' }));
    fs.writeFileSync(path.join(t, 'index.d.ts'),
      'declare var Bun: any;\ndeclare var process: any;\ninterface ImportMeta { dir: string; file: string; path: string }\n');
  }
  fs.writeFileSync(path.join(dir, 'app.rip'), FRESH);
  return dir;
}

function check(dir, args = []) {
  const r = spawnSync('bun', [BIN, 'check', ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// Mode-000 `file` for the duration of fn(). Returns false WITHOUT running
// fn on root/owner-override filesystems where the file stays readable
// anyway — callers bail, the scenario cannot exist there. The restore
// lives here so no failure path leaves an unreadable file for the
// caller's cleanup rmSync to trip on.
function withUnreadable(file, fn) {
  fs.chmodSync(file, 0o000);
  try {
    try { fs.readFileSync(file, 'utf8'); return false; } catch { /* unreadable, as intended */ }
    fn();
    return true;
  } finally {
    try { fs.chmodSync(file, 0o644); } catch { /* gone with the fixture */ }
  }
}

describe('rip check: usage surface (no server)', () => {
  test('--help prints usage and exits 0', () => {
    const r = spawnSync('bun', [BIN, 'check', '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('rip check');
    expect(r.stdout).toContain('Usage:');
  });

  test('a directory with no .rip files is clean (exit 0)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-empty-'));
    try {
      const r = check(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('no .rip files found');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // The build hash makes CLI-vs-editor skew diagnosable at a glance: the
  // editor logs the same identity in its ready line, computed over the
  // same two trees (compiler + server) by content, so an installed
  // extension and a worktree CLI agree exactly when their code does.
  test('--build prints the build identity and exits 0', () => {
    const r = spawnSync('bun', [BIN, 'check', '--build'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^rip check build [0-9a-f]+\n  compiler  .+\n  server    .+\n$/);
  });

  test('an unknown flag exits 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-flag-'));
    try {
      const r = check(dir, ['--nope']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('unknown option');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describeExtended('rip check: type diagnostics over the real server', () => {
  test('a clean file passes (exit 0)', () => {
    const dir = workspace({ 'clean.rip': 'add = (a: number, b: number): number -> a + b\nconsole.log add(1, 2)\n' });
    try {
      const r = check(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('No type errors');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The degenerate input every editor produces the moment a file is created.
  // It is a legal program — `Root → ε` — but the audit cannot hold it: a
  // corpus fixture spelling it declares nothing, so every audit dimension
  // passes by having nothing to check, and the production is excluded there
  // for exactly that reason. The guarantee itself is real and belongs here,
  // where it is asserted rather than assumed: an empty file compiles, checks
  // clean, and reports as a checked file rather than vanishing from the run.
  test('an empty file is a legal program: compiles, checks clean, and counts as checked', () => {
    const dir = workspace({ 'empty.rip': '' });
    try {
      const r = check(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('No type errors');
      expect(r.stdout).toContain('1 file checked');   // present in the run, not skipped
      const compiled = spawnSync('bun', [BIN, '-c', 'empty.rip'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
      expect(compiled.status).toBe(0);
      expect((compiled.stdout ?? '').trim()).toBe('');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a type error surfaces at the .rip position and exits 1', () => {
    const dir = workspace({ 'bad.rip': "n: number = 'oops'\nconsole.log n\n" });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      // Mapped back to the .rip source, not the generated face: 1:1 on `n`.
      expect(r.stdout).toContain('bad.rip:1:1 - error'); // tsc-style header
      expect(r.stdout).toContain('TS2322');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // A member NAMED `constructor` (or any other Object.prototype name) is
  // legal TS, and the face must spell it as written: a name-keyed table
  // that inherits from Object.prototype would print the inherited
  // function's source text in its place, and the face stops parsing. The
  // real checker is the only judge of whether the face is valid TS.
  test('a type member named `constructor` checks clean — the face keeps the name', () => {
    const dir = workspace({
      'ci.rip': 'type A = Record<string, any> & { constructor: Function & { __hmrId?: string } }\nx: A = {}\nconsole.log x, Object.keys({})\n',
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('No type errors');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('an unresolved Unicode type name maps to its exact identifier span', () => {
    const dir = workspace({ 'unicode.rip': 'type Ω = Ξ\nx: Ω = 1\n' });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.map((d) => [d.code, d.line, d.column, d.endColumn])).toEqual([
        [2304, 1, 10, 11],
      ]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the match operator and its regex-index sugar publish nothing', () => {
    // `text =~ /re/` lowers to `(_ = toMatchable(text).match(re))`, and the
    // face's prelude types toMatchable `(v: any) => string` — RULED: the
    // coercion always answers a string and carries no multi-line guard
    // (`^`/`$` across newlines are the regex's own /m business, exactly
    // as in hand-written JS), so no narrowing rides the lowering and no
    // match expression publishes on legal rip. The regex-index sugar
    // shares that spine (`regexIndex`, src/emitter.js).
    //
    // Every branch of both lowerings is here: `=~` plain and under a
    // literal /m, and the index in all four of its shapes (whole match /
    // nth capture × plain / /m).
    // The corpus carries these spellings too (02-operations, 04-assignments,
    // under the Type Audit's `verdict`); this case is the CLI's own check,
    // over a workspace with no rip config at all — permissive, no strict
    // flag, which is where the gap used to reach every user.
    // The liveness pair (a real TS2322 in the same workspace, asserted at
    // its own position) keeps a checker that reports nothing at all from
    // impersonating the clean run.
    const dir = workspace({
      'match.rip': "text = 'abc'\nlines = \"a\\nb\"\n"
        + 'found = text =~ /b+/\nspanned = lines =~ /^b/m\n'
        + 'grabbed = text[/b+/]\ncapture = text[/(b)(c)/, 2]\n'
        + 'wide = lines[/^b/m]\nwideCapture = lines[/^(b)/m, 1]\n'
        + 'console.log found, spanned, grabbed, capture, wide, wideCapture\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('live.rip:1:1 - error TS2322');       // liveness: the checker really reports
      // Nothing anywhere in the match file — not a code, not a line.
      expect(r.stdout).not.toContain('match.rip');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // Every component member form checks its initializer, and every wrong-typed
  // member WRITE inside a method reaches the source. Two mechanisms hold this
  // up and each has its own spelling below.
  //
  // The initializer half is the face's runtime destructure: a component-carrying
  // file fuses the components runtime into the reactive one, and the fused unit
  // states the union of their signatures, so `__state`/`__computed` stay generic
  // and every `_init` assignment checks against the member's declared type. The
  // `=!` member rides a second seam — its one legitimate constructor-seam write
  // casts `this` to the member's own type rather than to `any`, which would
  // swallow the value check along with TS2540.
  //
  // The write half is the mapping: an `@name` write lowers to `this.name…`, and
  // the emitted `this` maps back through the member's own cover, so a
  // diagnostic anchored there reaches `@name` instead of dropping in transit.
  // Exact lists both ways — a form that stops checking, or a span that stops
  // mapping, goes red here. The audit's components error pair holds the same
  // negatives by code and position; this is the CLI's own check, over a
  // workspace with no rip config, plus the strict posture the write half was
  // driven under.
  test('every component member form checks its initializer, and in-method writes reach the source', () => {
    const initDir = workspace({
      'member.rip': [
        'export Box = component',
        '  wrongPlain: string = 42',
        "  wrongMember: number := 'oops'",
        "  wrongComputed: string ~= 7 * 3",
        "  wrongReadonly: number =! 'nope'",
        '',
        '  render',
        '    div wrongPlain',
      ].join('\n') + '\n',
    });
    // The prop's declared type is NUMBER and the write is a string: an earlier
    // spelling of this fixture wrote `'nope'` into a `string` prop, which is a
    // correct write, so the row asserted nothing either way.
    const writeDir = workspace({
      'writes.rip': [
        'export Writer = component',
        '  @value: number := 0',
        '  count := 0',
        '  plainField: number = 1',
        '',
        '  bump: ->',
        "    @count = 'oops'",
        "    @value = 'nope'",
        "    @plainField = 'flat'",
        '    nonexistentHelper(1)',
        '',
        '  render',
        '    div count',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const init = JSON.parse(check(initDir, ['--json']).stdout);
      // All four member forms, each on its own declaration line, anchored on
      // the member name.
      expect(init.map((d) => [d.code, d.line, d.column])).toEqual([
        [2322, 2, 3], [2322, 3, 3], [2322, 4, 3], [2322, 5, 3],
      ]);

      const writes = JSON.parse(check(writeDir, ['--json']).stdout);
      // State, prop, and plain non-reactive member alike — each anchored on
      // the `@`, the first byte of the source the lowering's `this` stands
      // for. The method body's TS2304 is the liveness pair.
      expect(writes.map((d) => [d.code, d.line, d.column])).toEqual([
        [2322, 7, 5], [2322, 8, 5], [2322, 9, 5], [2304, 10, 5],
      ]);
    } finally {
      fs.rmSync(initDir, { recursive: true, force: true });
      fs.rmSync(writeDir, { recursive: true, force: true });
    }
  }, 90_000);

  // The two face-only BEHAVIOR OBJECTS (a component's computed members, a
  // schema's callables) are re-emissions of bodies the descriptor and _init
  // already carry, and each has a shape that the fixtures which drove them
  // did not: a computed body of more than one statement, and a schema bound
  // by `export`. Both produce a face that does not compile — the first
  // because a multi-statement body is already a BRACED BLOCK and cannot be
  // wrapped in `return …`, the second because the object is emitted at the
  // plain `=` statement and the export path binds elsewhere. Legal rip, so
  // the whole workspace must be silent; the liveness pair is a real error in
  // a third file, which also proves a broken face cannot masquerade as one.
  test('a multi-statement computed and an exported schema keep the face compiling', () => {
    const dir = workspace({
      'panel.rip': [
        'Panel = component',
        '  count := 3',
        '',
        '  summary ~=',
        '    doubled = count * 2',
        '    doubled + 1',
        '',
        '  render null',
        '',
        'panel = new Panel({})',
        'total: number = panel.summary.value',
        'console.log total',
      ].join('\n') + '\n',
      'cart.rip': [
        'export Cart = schema :shape',
        '  items! number[]',
        '  total: ~> @items.length',
        '',
        'sum: number = Cart.parse({ items: [3] }).total',
        'console.log sum',
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      expect(diags.filter((d) => d.file !== 'live.rip')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // TypeScript reads a class's properties from its DECLARATIONS alone,
  // never from what the constructor assigns — so a constructor body's
  // `@field = value` has to declare what it implies, exactly as a
  // promoted parameter does. Without it, legal rip that runs correctly
  // publishes TS2339 at every assignment AND every read, which is the
  // whole surface of the class. The annotated spelling carries its type
  // onto the declaration; the bare one declares the name alone, the
  // promoted-parameter precedent — except a field only a bound arrow
  // assigns, which spells `: any`: TypeScript's constructor inference
  // never descends into arrows, so its bare declaration would be an
  // implicit any. A body-level declaration of the same name still
  // wins — one declaration, or TypeScript reads the pair as duplicate
  // identifiers.
  test('a constructor body\'s @field assignment declares its field', () => {
    const dir = workspace({
      // Legal, correctly-running rip: every spelling must be silent.
      'box.rip': [
        'export class Box',
        '  tag: string = \'t\'',       // declared in the body — must not double
        '',
        '  constructor: ->',
        '    @size = 3',
        '    @label: string = \'b\'',
        '    @tag = \'u\'',
        '    if true',
        '      @flag = 1',            // reached THROUGH control flow
        '    bind = => @bound = 2',   // a BOUND arrow: its `this` IS the instance
        '    bind()',
        '',
        'b = new Box()',
        'console.log b.size, b.label, b.tag, b.flag, b.bound',
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    // The claims a clean run cannot hold on its own. Declaring the NAME
    // is most of the fix — TypeScript infers a bare property's type from
    // the constructor's own assignment — so the annotation is load-bearing
    // in exactly one place: where the author declares WIDER than the
    // assignment infers. `wide` takes null and `plain` refuses it, which
    // is the only pair that can tell the two apart.
    //
    // BOTH function forms are here, because the boundary is not "a nested
    // function" but WHOSE `this` it is. `->` emits a plain function whose
    // `this` is dynamic, so its assignment says nothing about the class;
    // `=>` emits an arrow whose `this` is lexically the instance, so its
    // assignment declares (the clean fixture's `bound`). The pairing that
    // proves the line is drawn correctly rather than merely drawn: an
    // arrow nested INSIDE a `->` still declares nothing, because by then
    // the `this` it captures is the function's.
    const negDir = workspace({
      'crate.rip': [
        'export class Crate',
        '  constructor: ->',
        '    @wide: string | null = \'b\'',
        '    @plain = \'b\'',
        '    later = -> @nested = 1',
        '    outer = ->',
        '      inner = => @deep = 1',   // an arrow under a `->`: captures the FUNCTION's this
        '      inner()',
        '    later',
        '    outer',
        '',
        'c = new Crate()',
        'c.wide = null',                // legal: the annotation rode onto the declaration
        'c.plain = null',               // rejects: inferred from the assignment alone
        'wrongNested = c.nested',
        'wrongDeep = c.deep',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      expect(diags.filter((d) => d.file !== 'live.rip')).toEqual([]);

      const neg = JSON.parse(check(negDir, ['--json']).stdout);
      expect(neg.map((d) => [d.code, d.line])).toEqual([
        // Asserted under rip.strict: a negatives fixture asks for every
        // diagnostic, and gradual suppresses the implicit-`this` class the
        // way it suppresses implicit-any — which would hide the two rows
        // this case exists to prove.
        [2683, 5],   // the `->`'s own untyped `this` — not this class's
        [2683, 7],   // and the arrow under it captures THAT one, not the instance
        [2322, 14],  // `plain` inferred `string`; line 13's write to `wide` stays silent
        [2339, 15],  // `nested` never declared: a plain function's `this` is another object
        [2339, 16],  // nor `deep`: an arrow inherits whatever `this` encloses it
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(negDir, { recursive: true, force: true });
    }
  }, 90_000);

  // A wrong-typed schema DEFAULT publishes: the face carries the descriptor's
  // default under a `satisfies` against the field's declared type, so the
  // relation the runtime enforces on every `.parse()` is stated where the
  // checker can read it.
  //
  // The wrong-typed TRANSFORM stays silent, and that is the ruling, not a
  // second gap: relating a transform's RETURN to its field needs its INPUT
  // related to the row shape, and `it` is the declared `any` boundary — the
  // wire shape is what a transform exists to absorb. The runtime rejects it
  // on `.parse()`. The two are asserted apart so that a later change to
  // either is visible on its own line.
  test('a wrong-typed schema default publishes; the transform half stays runtime-only', () => {
    const dir = workspace({
      'schema.rip': [
        'Person = schema',
        '  id!   number, -> it.name',      // transform returns string on a number field
        "  role  number, ['guest']",       // string default on a number field
        '',
        "person = Person.parse({ name: 'Ada' })",
        'console.log person.id, person.role',
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      // TS1360 is what `satisfies` publishes, anchored on the default LITERAL
      // — not on the entry list that encloses it, which is where it lands
      // without a span of its own. The transform's line (2) is absent: the
      // ruled runtime-only half.
      expect(diags.filter((d) => d.file === 'schema.rip')
        .map((d) => [d.code, d.line, d.column, d.endColumn])).toEqual([[1360, 3, 18, 25]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Mutually-recursive computeds deserve their error — the pattern
  // recurses forever on read — but the error must be usable: TS detects
  // the cycle in the companion interface's behavior projection and
  // names the reactive container's `value` across the whole component
  // span. The projection's anchored rows and the mapper's requote turn
  // that into one diagnostic PER computed, at the member the author
  // wrote, quoting the member's own name.
  test('a computed cycle anchors at each involved computed with its own name, not the whole component', () => {
    const dir = workspace({
      'cycle.rip': [
        'Badge = component',
        '  loop1 ~= @loop2 + 1',
        '  loop2 ~= @loop1 + 1',
        '  render',
        '    div "{@loop1}"',
        'console.log Badge',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.map((d) => [d.code, d.line, d.column, d.endColumn])).toEqual([
        [2502, 2, 3, 8],
        [2502, 3, 3, 8],
      ]);
      expect(diags[0].message).toContain("'loop1' is referenced");
      expect(diags[1].message).toContain("'loop2' is referenced");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The face emits computed/schema-callable bodies TWICE — the real
  // lowering, then the behavior object the companion types read
  // through. One mistake, one squiggle: the behavior copy is a face
  // ECHO (builder.echoSpans), and the mapper drops a non-exact-mapped
  // diagnostic born inside it — the real copy publishes the same claim
  // at its own position. Without the echo rule each error below
  // reported twice, the duplicate cover-mapped across the whole head.
  test('one error in a twice-emitted body publishes once — the echo copy is silent', () => {
    const dir = workspace({
      'comp.rip': [
        "items = ['a', 'b']",
        'def useItems()',
        "  items.join('-')",
        '',
        'Badge = component',
        "  x := 'a'",
        '  sum ~= ->',
        '    total = 0',
        '    total += @x',
        '    total',
        '  render',
        '    div "#{@sum}"',
      ].join('\n') + '\n',
      'sch.rip': [
        'Event = schema :model',
        '  name! string',
        '  shout: -> @name.length * "oops"',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // The component error reports from the REAL _init copy, exactly
      // mapped at the offending line — and only from it.
      expect(diags.filter((d) => d.file === 'comp.rip')
        .map((d) => [d.code, d.line, d.column, d.endColumn])).toEqual([[2322, 9, 5, 10]]);
      // The schema callable's real (descriptor) copy carries no interior
      // marks either, so its one report cover-maps onto the head — but
      // it is ONE report, not the pre-echo pair.
      expect(diags.filter((d) => d.file === 'sch.rip')
        .map((d) => [d.code, d.line])).toEqual([[2363, 1]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('repeated face manifestations publish one identical source diagnostic', () => {
    const dir = workspace({
      'list.rip': [
        'List = component',
        '  render',
        '    ul',
        '      for item in missingList',
        '        li item',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.map((d) => [d.code, d.line, d.column, d.message])).toEqual([
        [2304, 4, 19, "Cannot find name 'missingList'."],
      ]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The default-satisfies relation follows the runtime's ORDER of
  // operations, not just its vocabulary. Dates are the one exception
  // that earns an admission: `_coerceDates` runs AFTER `_applyDefaults`,
  // so an ISO-string default becomes a real Date on every parse and the
  // satisfies admits the string spelling. The `[null]` default under a
  // required `!` goes the other way: `_validate` runs after defaults and
  // rejects the substituted null on every default-taking parse, so the
  // face stops widening the field to `| null` and the satisfies flags
  // the literal — the checker saying first what the runtime says late.
  // The @ensure parameter follows the same discipline: the create path
  // runs ensures before id/timestamps exist, so the implicit columns
  // type Partial<> and an unguarded `m.id` is refused (TS18048) instead
  // of crashing the first create.
  //
  // Both landmines are NULL-assignability facts, so the project spells
  // `strictNullChecks` in its own tsconfig — which also pins the yield:
  // gradual supplies `strictNullChecks: false` only to a chain that says
  // nothing, and an author's own strictness wins (`nullPosture`,
  // mirror.js). Without it the checker cannot draw the distinction these
  // contracts ride on, in any mode.
  test('the schema face follows runtime ordering: date defaults admit strings, required [null] publishes, ensures see Partial implicits', () => {
    const audit = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
    const dir = workspace({
      'tsconfig.json': JSON.stringify({ ...audit, compilerOptions: { ...audit.compilerOptions, strictNullChecks: true } }),
      'ordering.rip': [
        'Ev = schema :shape',
        '  when! date, ["2024-01-01"]',
        '  at! datetime, ["2024-01-01T10:00:00Z"]',
        'M = schema :model',
        '  name! string',
        '  @times',
        '  @ensure "fresh", (m) -> not m.id? or m.id > 0',
        'd: Date = Ev.parse({}).when',
        'console.log d, M',
      ].join('\n') + '\n',
      'landmine.rip': [
        'Req = schema :shape',
        '  code! string, [null]',
        'unguarded = schema :model',
        '  name! string',
        '  @ensure "fresh", (m) -> m.id > 0',
        'console.log Req, unguarded',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'ordering.rip')).toEqual([]);
      expect(diags.filter((d) => d.file === 'landmine.rip').map((d) => d.code).sort()).toEqual([1360, 18048]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // TypeScript 7 defaults `strict` ON, which drags catch bindings to
  // `unknown` through `useUnknownInCatchVariables` — narrowing ceremony
  // on every member read of an unannotated `catch err`. Gradual's
  // posture subtracts that flag (nullPosture, mirror.js); a chain that
  // states its own strictness is yielded to whole and keeps the
  // unknown.
  test('gradual catch bindings are not unknown; an author strictness chain keeps them', () => {
    const catcher = [
      'export label: (job: () => void) => void = (job) ->',
      '  try',
      '    job()',
      '  catch err',
      '    console.log(err.message)',
    ].join('\n') + '\n';
    const gradual = workspace({ 'catcher.rip': catcher });
    const audit = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
    const strict = workspace({ 'catcher.rip': catcher });
    fs.writeFileSync(path.join(strict, 'tsconfig.json'),
      JSON.stringify({ ...audit, compilerOptions: { ...audit.compilerOptions, strictNullChecks: true } }));
    try {
      expect(JSON.parse(check(gradual, ['--json']).stdout)).toEqual([]);
      expect(JSON.parse(check(strict, ['--json']).stdout).map((d) => d.code)).toEqual([18046]);
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 90_000);

  // The mixin face promises exactly what the runtime serves, in both
  // directions. The projection algebra works on a mixin — derive
  // refuses only :union/:enum, and a mixin derivation is an instantiable
  // :shape — so every algebra call checks clean, INCLUDING Schema.extend
  // taking a mixin argument. The parse surface is refused on the mixin
  // itself: `parse` throws at runtime, so the checker says no first.
  test('mixin projection algebra checks clean; the mixin parse surface stays refused', () => {
    const dir = workspace({
      'algebra.rip': [
        'T = schema :mixin',
        '  createdAt! datetime',
        '  updatedAt! datetime',
        'U = schema :shape',
        '  name! string',
        'Stamps = T.pick("createdAt")',
        'stamped = Stamps.parse({ createdAt: "2024-01-01" })',
        'console.log stamped.createdAt, T.partial(), T.omit("updatedAt"),',
        '  T.required("createdAt"), U.extend(T), T.extend(U), T.toJSONSchema()',
      ].join('\n') + '\n',
      'refused.rip': [
        'T = schema :mixin',
        '  createdAt! datetime',
        'console.log T.parse({})',
      ].join('\n') + '\n',
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'algebra.rip')).toEqual([]);
      expect(diags.filter((d) => d.file === 'refused.rip').map((d) => d.code)).toEqual([2339]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A bare workspace specifier (`@rip/util`) is how packages import each
  // other: a node_modules symlink whose package.json `exports` lands on a
  // `.rip` file. bun resolves that at runtime; the mirror must resolve it
  // too — the target joins the closure and the generated tsconfig maps
  // the bare name onto the mirror face — or every cross-package import in
  // the workspace publishes TS2307. The check targets a SUBDIRECTORY on
  // purpose: the workspace root is the nearest ancestor declaring
  // `workspaces`, not the first package.json above the target, or the
  // sibling package sits outside the mirror and nothing resolves.
  // The gate's ACROSS rule rides the same resolution: the ANNOTATED
  // export carries into the importer, the inferred one stays held.
  test('a bare workspace .rip specifier resolves; its annotated exports carry, inferred ones stay held', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-ws-'));
    try {
      fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      fs.mkdirSync(path.join(dir, 'packages', 'app'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'packages', 'util'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'util', 'package.json'),
        JSON.stringify({ name: '@rip/util', exports: { '.': './util.rip' } }));
      fs.writeFileSync(path.join(dir, 'packages', 'util', 'util.rip'),
        'export answer: number = 42\nexport plain = 1\n');
      fs.writeFileSync(path.join(dir, 'packages', 'app', 'app.rip'), [
        "import { answer, plain } from '@rip/util'",
        "import * as mod from '@rip/util'",
        'bad = answer.toUpperCase()',
        'meh = plain.toUpperCase()',
        "import { nosuch } from '@rip/util'",   // a member that does not exist
        'console.log bad, meh, mod, nosuch',
      ].join('\n') + '\n');
      fs.mkdirSync(path.join(dir, 'node_modules', '@rip'), { recursive: true });
      fs.symlinkSync(path.join('..', '..', 'packages', 'util'), path.join(dir, 'node_modules', '@rip', 'util'));
      const diags = JSON.parse(check(dir, ['--json', path.join('packages', 'app')]).stdout);
      // Resolution: no cannot-find-module anywhere, on any of the three
      // import spellings (named, named-unannotated, namespace).
      expect(diags.map((d) => d.code)).not.toContain(2307);
      // ACROSS: `answer`'s annotation carries — the misuse reports at its
      // line; `plain` carries nothing and its misuse is held. Importing a
      // member the module does not export is a NAME that does not exist —
      // the cannot-find family spelled at the module boundary — and
      // publishes whatever is annotated.
      expect(diags.filter((d) => d.file === path.join('packages', 'app', 'app.rip')).map((d) => [d.code, d.line])).toEqual([[2339, 3], [2305, 5]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The escape-hatch advisories: an exact `any` annotation, an `as any`
  // cast, and a `# @ts-ignore` line in a gradual target each ask for
  // checking and withhold it, so the run names every site under its own
  // heading. Composites are shape decisions and a strict project's `any` is
  // a stated one — neither is counted. Advisories never move the exit
  // status.
  test('the escape-hatch advisories name each `any` annotation, `as any` cast, and `@ts-ignore` in gradual targets', () => {
    const src = [
      'x: any = 1',                 // annotation: counted
      'ys: any[] = []',             // composite: not counted
      'bag: Record<string, any> = {}',
      'go = (e: any) -> e',         // annotation: counted
      'z = (1 as any)',             // cast: counted
      '# @ts-ignore',               // directive: counted
      'w = 2',
      'console.log x, ys, bag, go, z, w',
    ].join('\n') + '\n';
    const gradual = workspace({ 'a.rip': src });
    const strict = workspace({ 'a.rip': src }, { strict: true });
    try {
      const r = check(gradual);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('2 `any` annotations');
      expect(r.stdout).toMatch(/\n  a\.rip:1\n  a\.rip:4\n/);
      expect(r.stdout).toContain('1 `as any` cast');
      expect(r.stdout).toMatch(/cast[^\n]*\n  a\.rip:5\n/);
      expect(r.stdout).toContain('1 `@ts-ignore` directive');
      expect(r.stdout).toMatch(/directive[^\n]*\n  a\.rip:6\n/);
      const s = check(strict).stdout;
      expect(s).not.toContain('`any` annotation'); expect(s).not.toContain('`as any` cast'); expect(s).not.toContain('`@ts-ignore`');
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 90_000);

  // The hidden-diagnostics summary is the mode's ledger: three lines,
  // one per family, because the remedies differ — annotate a
  // declaration, flip `rip.strict`, install declarations. The lines
  // spell the strict remedy IDENTICALLY (a summary that words the same
  // lever two ways reads as two levers), and the missing-types advisory
  // NAMES the declarations it is about — "install the @types package"
  // with no noun sends the user hunting through their own imports.
  test('the hidden-diagnostics summary: consistent remedies, and the missing declarations are named', () => {
    const dir = workspace({
      'app.rip': [
        'n = 42',
        'bad = n.toUpperCase()',      // real error, held → scope family
        'def shout(msg)',             // implicitly-any parameter → annotation family
        '  msg',
        "describe 'adds', ->",        // known-typings globals, no types installed —
        '  console.log bad, shout',
        "fsMod = require('fs')",      // …each advisory names ITS missing declaration
        'console.log fsMod',
      ].join('\n') + '\n',
    });
    try {
      const out = check(dir).stdout;
      expect(out).toMatch(/\d+ diagnostics? hidden in unannotated code — annotate a declaration to check its scope, or set `rip\.strict` in package\.json/);
      expect(out).toMatch(/\d+ annotation diagnostics? hidden — set `rip\.strict` in package\.json to see where annotations are missing/);
      // In the home project the line stays placeless; foreign projects (a
      // closure's dependencies) add `(dirs)` and point the remedy there.
      expect(out).toMatch(/\d+ missing-types advisor(y|ies) hidden — no declarations for `describe`, `require` \(try `bun add -d @types\/bun`\)/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Host types describe the RUNTIME's globals, so a version apart from
  // the running Bun describes a runtime the code will not meet. Two
  // properties, both load-bearing: the advisory is never gated on a
  // diagnostic (types NEWER than the runtime answer for APIs absent at
  // run time — precisely the case no check can see, so it must fire on a
  // wholly clean run), and it sits in the ADVISORY tier ABOVE the gray
  // ledger. The tier is the reader's cue to act: the package is theirs
  // and the remedy is one `bun add`, where a ledger line often counts a
  // dependency's diagnostics they cannot touch. Colour is TTY-only, so
  // the tier is pinned by ORDER, which is what it means on the page.
  test('host types apart from the running Bun advise above the ledger; a matching version is silent', () => {
    // The installed version is read from the package's own
    // node_modules — written directly here, so the row needs no network
    // and pins nothing about what npm happens to publish.
    const withTypes = (version) => ({
      // A held diagnostic, so a LEDGER line exists to sit below.
      'index.rip': 'n = 42\nbad = n.toUpperCase()\nconsole.log bad\n',
      'node_modules/@types/bun/package.json': JSON.stringify({ name: '@types/bun', version }) + '\n',
    });
    const stale = workspace(withTypes('0.0.1'));
    fs.writeFileSync(path.join(stale, 'package.json'),
      JSON.stringify({ name: 'stale', devDependencies: { '@types/bun': '0.0.1' } }, null, 2));
    const matched = workspace(withTypes(Bun.version));
    fs.writeFileSync(path.join(matched, 'package.json'),
      JSON.stringify({ name: 'matched', devDependencies: { '@types/bun': Bun.version } }, null, 2));
    try {
      const out = check(stale).stdout;
      expect(out).toContain('No type errors');          // fires with nothing else reported
      // Both versions named, and which is which — the line is read by
      // someone who does not yet know the two can differ.
      expect(out).toContain(`\`@types/bun\` 0.0.1 does not match the running Bun ${Bun.version}`);
      expect(out).toContain(`bun add -d @types/bun@${Bun.version}`);
      // Above the ledger, not among it.
      const ledger = out.indexOf('hidden in unannotated code');
      expect(ledger).toBeGreaterThan(-1);
      expect(out.indexOf('does not match the running Bun')).toBeLessThan(ledger);
      // The control: same shape, version agreeing, nothing said.
      expect(check(matched).stdout).not.toContain('match the running Bun');
    } finally {
      fs.rmSync(stale, { recursive: true, force: true });
      fs.rmSync(matched, { recursive: true, force: true });
    }
  }, 90_000);

  // Bun's default linker HOISTS: a member declares the dependency while
  // the copy lands in the workspace root. Naming one site alone
  // contradicts the other — point at the declaration and a stale root
  // install sends the reader to a package.json that already reads
  // correctly; point at the install and a stale member declaration sends
  // them somewhere that declares nothing. Both, whenever they differ.
  test('a hoisted install and the member that declared it are both named', () => {
    const dir = workspace({
      // The root holds the copy and declares nothing…
      'node_modules/@types/bun/package.json': JSON.stringify({ name: '@types/bun', version: '0.0.1' }) + '\n',
      // …while the member's own declaration is already correct.
      'app/package.json': JSON.stringify({ name: 'app', devDependencies: { '@types/bun': Bun.version } }, null, 2) + '\n',
      'app/index.rip': 'x: number = 1\nconsole.log x\n',
    });
    // The `workspaces` key is what makes this shape REAL rather than
    // contrived: it is what hoists the install to the root in the first
    // place, and it is what puts the workspace root above the member so
    // the walk can see both sites. Without it the root is not the
    // workspace, the walk stops at the member, and the split cannot arise.
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'mono', workspaces: ['app'] }, null, 2));
    try {
      const out = check(dir).stdout;
      expect(out).toContain(
        `\`@types/bun\` 0.0.1 (installed in ., declared in app) does not match the running Bun ${Bun.version}`,
      );
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // `--public` answers one question: what does a CONSUMER's checker
  // resolve for every name a package publishes? It asks the checker, not
  // the declarations — rip is inference-first, so an export with no
  // annotation whose value has a typed origin IS typed, and measuring
  // declarations would report failure exactly as a package gets better at
  // inferring. A hover names a type without opening it, so the walk
  // descends through members and reports the PATH to the first `any`.
  //
  // It stops at anything the package does not declare: a class extending
  // `Error` carries Error's whole surface, and a package cannot fix that.
  test('--public resolves types (inference included), finds nested any with its path, and stops at foreign members', () => {
    const clean = workspace({
      'index.rip': [
        'def build(): string',
        "  'x'",
        '',
        'export made = build()',            // NO annotation — inferred `string`
        '',
        'export class Boom extends Error',  // inherits Error's foreign surface
        '  tag: string = "b"',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(clean, 'package.json'),
      JSON.stringify({ name: 'clean-pkg', exports: { '.': './index.rip' } }, null, 2));
    // `Inner` is NOT published, so `Outer` is the only row that can report
    // it and the path is the whole finding. A published inner type is a row
    // of its own and stops the walk, which is a different case.
    const leaky = workspace({
      'index.rip': [
        'type Inner =',
        '  limit: number',
        '  extra: any',
        '',
        'export type Outer =',
        '  inner: Inner',
        '',
        'export def fine(n: number): string',
        '  "#{n}"',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(leaky, 'package.json'),
      JSON.stringify({ name: 'leaky-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const ok = check(clean, ['--public']);
      // The whole point: `made` carries no annotation and still counts.
      // A declaration-based audit calls this untyped, which is the answer
      // that gets WORSE as a package improves.
      expect(ok.stdout).toMatch(/\u2713 made/);
      // Error's inherited surface is not this package's to fix.
      expect(ok.stdout).toMatch(/\u2713 Boom/);
      expect(ok.stdout).toContain('2/2 exports fully typed (100.0%)');
      expect(ok.status).toBe(0);

      const bad = check(leaky, ['--public']);
      // The path names the member that leaks, through the type that owns it.
      expect(bad.stdout).toContain('any at: Outer.inner.extra');
      expect(bad.stdout).toMatch(/\u2713 fine/);      // foreign types stay opaque
      expect(bad.status).toBe(1);                       // gate-able
    } finally {
      fs.rmSync(clean, { recursive: true, force: true });
      fs.rmSync(leaky, { recursive: true, force: true });
    }
  }, 90_000);

  // A hover prints a signature only while the type is spelled inline. Give
  // the type a NAME — `typeof HTTPError` — and the parameters and the
  // constructed instance stop being printed, and enumerating members finds
  // statics, never the constructor. So an audit that reads hovers and walks
  // properties calls an unannotated constructor fully typed. Every case
  // here is one a consumer inherits and cannot fix from outside.
  test('--public opens signatures: constructor and call parameters, returns, and the instance a constructor yields', () => {
    const dir = workspace({
      'index.rip': [
        'type Opts =',                       // NOT published: no row but `run`'s
        '  extra: any',
        '',
        'export class Boom extends Error',   // no members: the .d.ts drops it entirely
        '  constructor: (payload) ->',
        "    super('boom')",
        '',
        'export class Chatty',
        '  constructor: (tag: string) ->',
        '    @tag = tag',
        '',
        '  describe: (detail) ->',
        '    "#{detail}"',
        '',
        'export class Solid',
        '  constructor: (tag: string) ->',
        '    @tag = tag',
        '',
        '  describe: (detail: string): string ->',
        '    "#{detail}"',
        '',
        'export def parse(text: string)',
        '  JSON.parse(text)',
        '',
        'export def run(o: Opts): string',
        "  'x'",
        '',
        'export def pick(cb: ((n: number) => string), tail): void',
        '  return',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'sig-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      // A construct signature's parameter, on a class that declares no
      // annotated member of its own — nothing about a class's own surface
      // decides whether its constructor is read.
      expect(out.stdout).toMatch(/any\s+at: Boom\.new\(payload\)/);
      // The instance a constructor RETURNS, then a parameter of its method.
      expect(out.stdout).toMatch(/any\s+at: Chatty#describe\(detail\)/);
      // And that method's own return, which no annotation claims.
      expect(out.stdout).toMatch(/inferred\s+at: Chatty#describe\(\)/);
      // A return type, named as the return and not as the function.
      expect(out.stdout).toMatch(/any\s+at: parse\(\)/);
      // A parameter is walked THROUGH: the leak is inside the type it names,
      // and no position on the way to it says so.
      expect(out.stdout).toMatch(/any\s+at: run\(o\)\.extra/);
      // The leak names the parameter that leaks. `cb` is fully typed and is
      // itself a function, which is the neighbor a parameter list is most
      // likely to be misattributed to.
      expect(out.stdout).toMatch(/any\s+at: pick\(tail\)/);
      // Annotating both positions answers it — no false leak on the way.
      expect(out.stdout).toMatch(/✓ Solid/);
      expect(out.stdout).toContain('1/6 exports fully typed (16.7%)');
      expect(out.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  // Ownership decides whether the walk enters a type at all, so getting it
  // wrong does not misreport a leak — it reports NONE, and the export comes
  // back clean. Neither spelling here carries `export` on the declaration
  // itself, and a class expression has no declared name to carry it on.
  test('--public treats a type as the package\'s however it is spelled: declared then exported, and a class expression', () => {
    const dir = workspace({
      'index.rip': [
        'class Late',                       // exported below, not here
        '  constructor: (seed) ->',
        '    @seed = seed',
        '',
        'export Anon = class',              // a class EXPRESSION, nameless
        '  constructor: (seed) ->',
        '    @seed = seed',
        '',
        'export { Late }',
      ].join('\n') + '\n',
    });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'own-pkg', exports: { '.': './index.rip' } }, null, 2));
    try {
      const out = check(dir, ['--public']);
      expect(out.stdout).toContain('any at: Late.new(seed)');
      expect(out.stdout).toContain('any at: Anon.new(seed)');
      expect(out.stdout).toContain('0/2 exports fully typed (0.0%)');
      expect(out.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

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
  // same auto boundary a globals-declaring package gets: floors are
  // per-PROGRAM, and without the boundary the root program's floor keeps
  // answering `any` for a package that asked for complaints.
  test('a nested rip.strict package refuses the floors: its own program, its own posture', () => {
    const dir = workspace({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/lib/package.json': JSON.stringify({ name: '@t/lib', rip: { strict: true } }),
      'packages/lib/lib.rip': "import { Database } from 'bun:sqlite'\nconsole.log Database\n",
      'packages/loose/package.json': JSON.stringify({ name: '@t/loose' }),
      'packages/loose/loose.rip': "import { Database } from 'bun:sqlite'\nconsole.log Database\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // The strict package: floor refused, the defect publishes.
      expect(diags.filter((d) => d.file.includes('lib')).map((d) => d.code)).toContain(2307);
      // The gradual sibling: floored `any`, still quiet.
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

  test('a yield read in an unannotated generator is permissive by default, strict under rip.strict', () => {
    // TS7057 fires on `yield` whose generator lacks a return-type annotation —
    // the same demands-an-annotation class as TS7006, discovered leaking as a
    // hard error on a two-line legal generator (the set is an enumeration, so
    // an omitted family member surfaces loudly rather than over-suppressing).
    const src = 'gen = ->\n  got = yield 1\n  console.log got\n';
    const loose = workspace({ 'g.rip': src }, null);
    const strict = workspace({ 'g.rip': src }, { strict: true });
    try {
      const l = check(loose);
      expect(l.status).toBe(0); // an unannotated generator is legal rip

      const s = check(strict);
      expect(s.status).toBe(1);
      expect(s.stdout).toContain('TS7057');
      expect(s.stdout).toContain('g.rip:2:9 - error'); // the `yield` expression
    } finally {
      fs.rmSync(loose, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 90_000);

  test('rip.noCheck silences matched paths but keeps them in the program', () => {
    const files = {
      'legacy/old.rip': "bad: number = 'oops'\nconsole.log bad\n",
    };
    const on = workspace(files, null);
    const off = workspace(files, { noCheck: ['legacy/**'] });
    try {
      expect(check(on).status).toBe(1);    // checked → the error surfaces
      expect(check(off).status).toBe(0);   // noCheck → silenced
    } finally {
      fs.rmSync(on, { recursive: true, force: true });
      fs.rmSync(off, { recursive: true, force: true });
    }
  }, 90_000);

  test('an acknowledged @ts-expect-error absorbs its error (exit 0)', () => {
    const dir = workspace({
      'ack.rip': '# @ts-expect-error — deliberately wrong, acknowledged\nbad: number = \'oops\'\nconsole.log bad\n',
    });
    try {
      expect(check(dir).status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The class the single-line cases above cannot reach: a statement whose FACE
  // emits as more than one line — any arrow assigned to a typed binding — where
  // the error lands on the head line the directive governs. An earlier rule
  // probed the emission and declined to place a directive on any multi-line
  // statement, which silently deleted the author's escape hatch and leaked an
  // acknowledged error. A statement directive now always places on the head
  // line, so this must absorb and exit 0. The negative control (same source, no
  // directive) proves the error is real, so a green run means "absorbed", not
  // "nothing fired".
  test('a used @ts-expect-error absorbs an error on a MULTI-LINE emission', () => {
    // The directive must sit DIRECTLY above the arrow assignment — it
    // governs the next statement, and the type alias is a statement too.
    const alias = 'type Comparator = (a: number, b: number) => number\n';
    const stmt = "badSorter: Comparator = (a, b) -> 'nope'\nconsole.log badSorter\n";
    const guarded = workspace({ 'm.rip': alias + '# @ts-expect-error — wrong return type, acknowledged\n' + stmt });
    const bare = workspace({ 'm.rip': alias + stmt });
    try {
      expect(check(guarded).status).toBe(0);   // directive survives the multi-line emit and absorbs

      const b = check(bare);                   // control: the error is genuinely there
      expect(b.status).toBe(1);
      expect(b.stdout).toContain('TS2322');
    } finally {
      fs.rmSync(guarded, { recursive: true, force: true });
      fs.rmSync(bare, { recursive: true, force: true });
    }
  }, 90_000);

  // The inverse of the pin-parity guard: a directive that absorbs NOTHING
  // must stay loud (TS2578), exactly tsc's contract — an unused escape
  // hatch that rots silently hides the bug it was meant to guard. The
  // trap: tsgo's TS2578 maps cleanly onto the directive comment, but the
  // governed statement here is a throwaway binding, so an unused-local
  // HINT (TS6133) lands in the directive's range. That hint must NOT mark
  // the directive "used" — only a real error does — or the TS2578 is
  // wrongly suppressed. `@ts-ignore` is exempt: tsc never flags it unused.
  test('an unused @ts-expect-error stays loud (TS2578); @ts-ignore is exempt', () => {
    const expectErr = workspace({ 'u.rip': "# @ts-expect-error — nothing wrong here\nbadCount = 'oops'\n" });
    const ignore = workspace({ 'i.rip': "# @ts-ignore — nothing wrong here\nbadCount = 'oops'\n" });
    try {
      const e = check(expectErr);
      expect(e.status).toBe(1);
      expect(e.stdout).toContain('TS2578');
      expect(e.stdout).toContain('u.rip:1:1 - error'); // on the directive itself

      const i = check(ignore);
      expect(i.status).toBe(0);              // an unused @ts-ignore is never flagged
      expect(i.stdout).not.toContain('TS2578');
    } finally {
      fs.rmSync(expectErr, { recursive: true, force: true });
      fs.rmSync(ignore, { recursive: true, force: true });
    }
  }, 90_000);

  // A directive governs its statement's HEAD line only — tsc's one-line
  // rule at rip's statement granularity (ripDirectiveLines). A directive
  // above a `def` or an `if` must NOT absorb a bug inside the indented
  // block: the bug stays loud and the directive reports unused (TS2578),
  // tsc's verdict for a marker that did nothing. The hatch for an error
  // interior to a render element is a directive on the offending line
  // itself (the inline component-prop and two-way-bind cases below). The
  // single-line file is the in-run control: suppression itself still
  // works, so the loud block bugs mean "not governed", not "broken".
  test('a directive governs the head line only — a bug inside the indented block surfaces, the directive reads unused', () => {
    const dir = workspace({
      'single.rip': "# @ts-expect-error — deliberately wrong, acknowledged\nbad: number = 'oops'\nconsole.log bad\n",
      'blocks.rip': [
        '# @ts-expect-error — governs `def f` only, never its body',
        'def f(x: number)',
        '  y: string = x',
        '  y',
        'flag = true',
        '# @ts-expect-error — governs `if flag` only, never its branch',
        'if flag',
        "  z: number = 'oops'",
        '# @ts-expect-error — a blank line beneath: the marker governs nothing',
        '',
        "w: number = 'oops'",
        'console.log f(1), flag, w',
      ].join('\n') + '\n',
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('single.rip');                 // the control: still absorbed
      expect(r.stdout).toContain('blocks.rip:1:1 - error TS2578');  // the def directive did nothing
      expect(r.stdout).toContain('blocks.rip:3:3 - error TS2322');  // the body bug is loud
      expect(r.stdout).toContain('blocks.rip:6:1 - error TS2578');  // the if directive did nothing
      expect(r.stdout).toContain('blocks.rip:8:3 - error TS2322');  // the branch bug is loud
      expect(r.stdout).toContain('blocks.rip:11:1 - error TS2322'); // no blank-skip: the gap kills governance
      // ...and the gapped marker is a DECLINED ordinary comment (the
      // emitter never places it), so no TS2578 points at line 9.
      expect(r.stdout).not.toContain('blocks.rip:9');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Interior directives on a child component: every prop lowers into ONE
  // ctor call, so the emitter switches the argument object to one pair
  // per line when any prop carries a directive — each marker then
  // governs exactly its own pair's face line. Two acknowledged props are
  // both absorbed with no TS2578 (a shared line would read every stacked
  // directive but the last as unused), and an UNACKNOWLEDGED sibling of
  // an acknowledged prop stays loud (a shared line would let one marker
  // blind every sibling).
  test('inline component-prop directives govern per pair — siblings neither blinded nor double-flagged', () => {
    const chip = [
      'export Chip = component',
      "  @label: string := ''",
      '  @size: number := 0',
      '',
      '  render',
      '    span label',
      '',
    ];
    const dir = workspace({
      'acked.rip': [...chip,
        'export BothAcked = component',
        '  render',
        '    div',
        '      Chip',
        '        # @ts-expect-error — label expects string',
        '        label: 123',
        '        # @ts-expect-error — size expects number',
        "        size: 'big'",
      ].join('\n') + '\n',
      'sibling.rip': [...chip,
        'export OneAcked = component',
        '  render',
        '    div',
        '      Chip',
        '        # @ts-expect-error — label expects string',
        '        label: 123',
        "        size: 'big'",
      ].join('\n') + '\n',
    });
    try {
      const r = check(dir, ['--json']);
      expect(r.status).toBe(1);
      const diags = JSON.parse(r.stdout);
      expect(diags.filter((d) => d.file.endsWith('acked.rip'))).toEqual([]);
      const sib = diags.filter((d) => d.file.endsWith('sibling.rip'));
      expect(sib.map((d) => [d.code, d.line])).toEqual([[2322, 14]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The two-way-bind spelling of the same interior-directive contract: a
  // marker above a `value <=> state` line governs exactly the bind's face
  // line — the acknowledged type mismatch is absorbed with no TS2578, and
  // the identical unacknowledged bind stays loud.
  test('an inline directive above a two-way bind governs the bind line', () => {
    const field = [
      'export Field = component',
      "  @value: string := ''",
      '',
      '  render',
      '    span value',
      '',
    ];
    const dir = workspace({
      'bound.rip': [...field,
        'export Bound = component',
        '  count := 0',
        '',
        '  render',
        '    div',
        '      Field',
        "        # @ts-expect-error — Type 'number' is not assignable to type 'string'",
        '        value <=> count',
      ].join('\n') + '\n',
      'loud.rip': [...field,
        'export Loud = component',
        '  count := 0',
        '',
        '  render',
        '    div',
        '      Field',
        '        value <=> count',
      ].join('\n') + '\n',
    });
    try {
      const r = check(dir, ['--json']);
      expect(r.status).toBe(1);
      const diags = JSON.parse(r.stdout);
      expect(diags.filter((d) => d.file.endsWith('bound.rip'))).toEqual([]);
      const loud = diags.filter((d) => d.file.endsWith('loud.rip'));
      expect(loud.map((d) => d.code)).toEqual([2322]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A directive above a first attribute line that never emits a replay
  // line of its own — a loop's extracted `key:` is consumed by the keyFn
  // — DECLINES (the comment stays an ordinary Rip comment) rather than
  // re-homing onto a sibling line the author never wrote it above: the
  // sibling's own error must stay loud.
  test('a directive above a loop `key:` declines — it never governs a sibling attribute line', () => {
    const dir = workspace({
      'k.rip': [
        'export List = component',
        '  items := [1, 2, 3]',
        '',
        '  render',
        '    ul',
        '      for item in items',
        '        li',
        '          # @ts-expect-error — key: is loop machinery, no line to govern',
        '          key: item',
        '          title: item.toUpperCasez()',
      ].join('\n') + '\n',
    });
    try {
      const r = check(dir, ['--json']);
      expect(r.status).toBe(1);
      const diags = JSON.parse(r.stdout);
      expect(diags.map((d) => [d.code, d.line])).toEqual([[2339, 10]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('cross-file: a misused typed export reports at the call site', () => {
    const dir = workspace({
      'util.rip': 'export shout = (s: string): string -> s.toUpperCase()\n',
      'app.rip': "import { shout } from './util.rip'\nconsole.log shout(42)\n",
    });
    try {
      const r = check(dir, ['app.rip', 'util.rip']);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('app.rip:2:'); // the call site in app.rip
      expect(r.stdout).toContain('TS2345');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('--json emits a structured array of diagnostics', () => {
    const dir = workspace({ 'bad.rip': "n: number = 'oops'\nconsole.log n\n" });
    try {
      const r = check(dir, ['--json']);
      expect(r.status).toBe(1);
      const parsed = JSON.parse(r.stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toMatchObject({ file: 'bad.rip', line: 1, column: 1, severity: 'error', code: 2322 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The pin pass reaches a DESTRUCTURED binding, and reaches it with the
  // binding's own type rather than the pattern's.
  //
  // Three failure modes, and one fixture each, because any one of them alone
  // is satisfiable by an accident:
  //   · unpinned      — `media` stays evolving `any`, and under rip.strict the
  //                     TS7034/TS7005 pair fires. This is the gap.
  //   · pinned WRONG  — the probe splices the assign's whole value span, so a
  //                     pattern binding takes `{ json: string }`. That silences
  //                     the pair, so a gap gate alone would call it fixed while
  //                     `media.toUpperCase()` reports TS2339.
  //   · pinned RIGHT  — `string`, so the call is clean AND a bogus member on it
  //                     still errors. `wrong.rip` is what proves the pin is a
  //                     real type and not `any`: under `any` the member is
  //                     accepted and the row would pass while pinning nothing.
  test('a destructured binding read by a hoisted def pins to its OWN type, not the pattern\'s', () => {
    const dir = workspace({
      'renamed.rip': [
        "{ json: media } = { json: 'application/json' }",
        'def mediaType()',
        '  media.toUpperCase()',    // defined on string, not on { json: string }
        'console.log mediaType()',
      ].join('\n') + '\n',
      'shorthand.rip': [
        "{ json } = { json: 'application/json' }",
        'def kind()',
        '  json.toUpperCase()',
        'console.log kind()',
      ].join('\n') + '\n',
      'wrong.rip': [
        "{ json: media } = { json: 'application/json' }",
        'def bad()',
        '  media.nope()',           // on `any` this is accepted — it must not be
        'console.log bad()',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'renamed.rip')).toEqual([]);
      expect(diags.filter((d) => d.file === 'shorthand.rip')).toEqual([]);
      expect(diags.filter((d) => d.file === 'wrong.rip').map((d) => d.code)).toEqual([2339]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // The parity guard for the pin pass: `items` is a hoisted binding read
  // ACROSS a closure (inside filterBy), which evolving-`let` alone leaves
  // `any[]` — so `matches` is `any[]`, `expectNum(matches)` does NOT error,
  // and the `# @ts-expect-error` would read as an unused directive (TS2578)
  // under a bare `tsc --noEmit` batch. The editor's Tier-3 pins resolve
  // `items` to `string[]`, so the mismatch DOES fire and the directive is
  // used → clean. This asserts the batch checker runs that pin pass.
  test('pin parity — an evolving-any closure read resolves like the editor (no spurious TS2578)', () => {
    const dir = workspace({
      'pins.rip': [
        "items = ['a', 'b', 'c']",
        'def filterBy(query: string)',
        '  items.filter((s) -> s.includes(query))',
        'def expectNum(x: number)',
        '  x',
        "matches = filterBy('a')",
        '# @ts-expect-error — matches is string[], not a number',
        'expectNum(matches)',
        'console.log(matches)',
      ].join('\n') + '\n',
    });
    try {
      const r = check(dir);
      // Clean: the directive is USED (the string[]→number mismatch fires),
      // which only happens if `items` was pinned to string[]. A pins-less
      // batch would report TS2578 here and exit 1.
      expect(r.stdout).not.toContain('TS2578');
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // relatedInformation ("x is declared here") rides the diagnostic pull
  // (the checker advertises the capability at handshake), and the checker
  // maps each secondary location back onto .rip source.
  test('relatedInformation ("declared here") is reported, mapped to .rip source', () => {
    const dir = workspace({ 'rel.rip': 'count: number = 0\ntotal = countz + count\nconsole.log total\n' });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('TS2552');                 // the primary
      expect(r.stdout).toContain("'count' is declared here"); // the secondary note
      expect(r.stdout).toContain('rel.rip:1:1');            // mapped to the .rip declaration

      const j = JSON.parse(check(dir, ['--json']).stdout);
      expect(j[0].related?.[0]).toMatchObject({ file: 'rel.rip', line: 1, column: 1 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The generated TS mirror is a persistent, regenerable cache (the peer
  // of the editor's .rip/editor): it stays at .rip/check after the run so
  // the exact TypeScript tsgo checked is inspectable, is self-gitignored,
  // and freshness comes from the start-of-run wipe — a stale face from an
  // earlier run never survives into the next program.
  test('the TS mirror persists after a run and is rebuilt fresh each run', () => {
    const dir = workspace({ 'a.rip': 'x: number = 0\nconsole.log x\n' });
    try {
      const mirror = path.join(dir, '.rip', 'check');
      check(dir);
      expect(fs.existsSync(path.join(mirror, 'a.rip.ts'))).toBe(true);           // the face is retained
      expect(fs.readFileSync(path.join(mirror, '.gitignore'), 'utf8')).toBe('*\n'); // and git never sees it
      expect(fs.readFileSync(path.join(mirror, '.build'), 'utf8').trim()).not.toBe(''); // stamped with the build that wrote it
      // A face whose source no longer exists is wiped by the next run,
      // not trusted from the cache.
      fs.writeFileSync(path.join(mirror, 'deleted.rip.ts'), 'const ghost: number = 0;\n');
      check(dir);
      expect(fs.existsSync(path.join(mirror, 'a.rip.ts'))).toBe(true);
      expect(fs.existsSync(path.join(mirror, 'deleted.rip.ts'))).toBe(false);
      // The wipe is unconditional: a run whose only target fails to PARSE
      // still clears the previous run's faces, so the tree never shows a
      // face for source that no longer compiles.
      fs.writeFileSync(path.join(dir, 'a.rip'), 'x = (\n');
      const r = check(dir);
      expect(r.status).toBe(1);                                          // the parse error still reports
      expect(fs.existsSync(path.join(mirror, 'a.rip.ts'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // An unwritable workspace still checks — rerouted to a temp mirror,
  // LOUDLY (fidelity degrades: per-project wrappers and @types resolution
  // change), and the temp root is removed by the exit handler.
  test('an unwritable workspace falls back to a temp mirror, loudly, and cleans it up', () => {
    const dir = workspace({ 'a.rip': 'x: number = 0\nconsole.log x\n' });
    try {
      fs.chmodSync(dir, 0o555);
      let writable = false;
      try { fs.mkdirSync(path.join(dir, '.probe')); writable = true; fs.rmdirSync(path.join(dir, '.probe')); } catch { /* expected EACCES */ }
      if (writable) return; // root / owner-override filesystem can't exercise this path
      const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rip-check-')));
      const r = check(dir);
      expect(r.stderr).toContain('temp fallback');                       // degraded, never silent
      expect(r.status).toBe(0);                                          // the clean file still checks clean
      expect(fs.existsSync(path.join(dir, '.rip'))).toBe(false);         // nothing forced into the workspace
      const leaked = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rip-check-') && !before.has(n));
      expect(leaked).toEqual([]);                                        // the exit handler reclaimed the temp root
    } finally {
      try { fs.chmodSync(dir, 0o755); } catch { /* restore for cleanup */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // A coexisting editor mirror (.rip/editor) must survive a batch check:
  // the two mirrors share the .rip parent but own disjoint subtrees.
  test('a coexisting .rip/editor is preserved', () => {
    const dir = workspace({ 'a.rip': 'x: number = 0\nconsole.log x\n' });
    try {
      const editorDir = path.join(dir, '.rip', 'editor');
      fs.mkdirSync(editorDir, { recursive: true });
      fs.writeFileSync(path.join(editorDir, 'marker'), 'keep me\n');
      check(dir);
      expect(fs.existsSync(path.join(editorDir, 'marker'))).toBe(true);          // editor mirror untouched
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // A dangling import is the IMPORTER's defect, not a coverage gap: the
  // absent module never marks the run incomplete — tsgo's TS2307 on the
  // importing line is the report, matching the editor's closure walk.
  test('a dangling .rip import earns TS2307 on the importer, not an incomplete run', () => {
    const dir = workspace({ 'a.rip': "p: import('./gone.rip').T = 5\nconsole.log p\n" });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('TS2307');
      expect(r.stdout).toContain('a.rip:1');
      expect(r.stderr).not.toContain('incomplete');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // @ts-nocheck's writ covers the file's imports too: a nocheck'd importer
  // with a dangling import checks clean and SILENT — the corpus's own
  // errors fixtures dangle an import on purpose, and a default `rip check`
  // over a repo containing them must not be permanently "incomplete".
  test('a dangling import under @ts-nocheck stays silent (exit 0)', () => {
    const dir = workspace({ 'a.rip': "# @ts-nocheck\np: import('./gone.rip').T = 5\nconsole.log p\n" });
    try {
      const r = check(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('No type errors');
      expect(r.stderr).not.toContain('incomplete');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // ENOENT is not the only "module does not exist as specified" errno: a
  // specifier whose path walks THROUGH a file (./lib.rip/T.rip, ENOTDIR)
  // is the same importer-side defect and gets the same report — TS2307 on
  // the importer, never a permanently incomplete run.
  test('a specifier through a file (ENOTDIR) is a TS2307, not an incomplete run', () => {
    const dir = workspace({
      'a.rip': "p: import('./lib.rip/T.rip').T = 5\nconsole.log p\n",
      'lib.rip': 'export x = 1\n',
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('TS2307');
      expect(r.stderr).not.toContain('incomplete');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // An import that EXISTS but cannot be read is a real coverage gap: the
  // run stays loud (the incomplete note beside whatever tsgo says about
  // the missing face), never a bare "cannot find module" that misstates
  // the problem. The exit is 1, not 2 — an error-severity diagnostic
  // outranks the incomplete posture in the exit-code ladder.
  test('an unreadable (existing) import still marks the run incomplete', () => {
    const dir = workspace({
      'a.rip': "p: import('./locked.rip').T = 5\nconsole.log p\n",
      'locked.rip': 'export helper = 42\n',
    });
    try {
      const exercised = withUnreadable(path.join(dir, 'locked.rip'), () => {
        // a.rip is the explicit target; locked.rip is reached only as its import.
        const r = check(dir, [path.join(dir, 'a.rip')]);
        expect(r.stderr).toContain('locked.rip (EACCES)');
        expect(r.stderr).toContain('the run is incomplete');
        expect(r.status).toBe(1); // tsgo's TS2307 on the missing face outranks exit 2
      });
      if (!exercised) return; // root / owner-override filesystem can't exercise this path
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // Coverage short of what was asked never exits 0: an explicit target —
  // named on the command line or swept up by the directory walk — that
  // cannot be read is skipped loudly (exit 2, a stderr note), and a clean
  // sibling does NOT rescue the exit code into a false 0.
  test('an unreadable file leaves the run incomplete (exit 2, no false clean)', () => {
    const dir = workspace({ 'ok.rip': 'x: number = 1\nconsole.log x\n', 'locked.rip': 'y: number = 2\nconsole.log y\n' });
    try {
      const exercised = withUnreadable(path.join(dir, 'locked.rip'), () => {
        const r = check(dir);
        expect(r.status).toBe(2);                          // incomplete coverage → never 0
        expect(r.stderr).toContain('the run is incomplete');
        expect(r.stdout).not.toContain('No type errors');  // ok.rip is clean, but the run isn't
      });
      if (!exercised) return; // root / owner-override filesystem can't exercise this path
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // tsgo emits relatedInformation locations as canonical (percent-encoded)
  // URIs; the mirror URI must match them (pathToFileURL, not `'file://' +
  // path`), or a workspace path with a space silently drops every
  // cross-file "declared here". The dir name here deliberately carries one.
  test('cross-file relatedInformation survives a space in the workspace path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip check ')); // ← space is the point
    fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ rip: { strict: true } }));
    fs.writeFileSync(path.join(dir, 'lib.rip'), 'export type Config =\n  name: string\n  port: number\n');
    fs.writeFileSync(path.join(dir, 'use.rip'), "import { Config } from './lib.rip'\nc: Config = { name: 'x', port: 'nope' }\nconsole.log(c)\n");
    try {
      const j = JSON.parse(check(dir, ['--json', 'use.rip', 'lib.rip']).stdout);
      const primary = j.find((d) => d.code === 2322);
      expect(primary).toBeDefined();
      // The secondary note maps into the OTHER file (lib.rip), not the error
      // site — and onto `port`'s own line, not the declaration head: a type
      // body's members carry their own spans, so "declared here" points at the
      // member that declared it.
      expect(primary.related?.[0]).toMatchObject({ file: 'lib.rip', line: 3, column: 3 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // A nested project's own tsconfig governs ITS files. Both polarities in
  // one workspace, so neither answer can be the whole run's posture: the
  // nested file rejects under its own `strict`, the root file stays loose
  // under the root's. A single-package fixture cannot tell a correct
  // per-project resolution from a flat one, which is why no gate saw this.
  test('a nested tsconfig governs its own files; the loose root governs the rest', () => {
    const dir = monorepo();
    try {
      const j = JSON.parse(check(dir, ['--json']).stdout);
      const at = (file) => j.filter((d) => d.file === file && d.code === 2322);
      expect(at('pkg/a.rip').length, 'the nested file rejects under its own strict config').toBe(1);
      expect(at('root.rip').length, 'the root file stays loose under the root config').toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The inverse posture, so the assertion above is not passing on a
  // hardcoded direction: strict at the root, loose in the nested project.
  // A flat mirror answers the same way in both, which is the whole defect.
  // THE ACCEPTANCE GATE for permissive mode: what a newcomer writes on
  // day one reports nothing. Permissive is the DEFAULT, so this is the
  // first thing anyone experiences; every error here is one they have to
  // interpret before they have any way to.
  test('a fresh project checks clean under permissive mode', () => {
    const dir = freshProject();
    try {
      const r = check(dir);
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The same project BEFORE `bun install` — no @types anywhere. The host
  // floor is what carries it, and it deactivates the moment the real
  // types arrive (the case above), so the two gates hold both sides of
  // that switch.
  // The floor stops the moment the real types arrive — asserted, because
  // an index signature that survived an install would make every typo on
  // `import.meta` legal forever. The read is annotated so the line is
  // gated ON: what this pins is the FLOOR yielding (a widened ImportMeta
  // would answer `any` and report nothing even on a checked line), not
  // where the gate reaches — an ambient global's type does not open the
  // lines that merely mention it (see scopes.js).
  test('the floor yields to @types/bun rather than widening it', () => {
    const dir = freshProject();                       // withTypes: the real declaration governs
    try {
      fs.writeFileSync(path.join(dir, 'app.rip'), 'x: unknown = import.meta.nosuchfield\nconsole.log x\n');
      expect(JSON.parse(check(dir, ['--json']).stdout).map((d) => d.code)).toEqual([2339]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // Bun's builtin MODULES ride the floor too: `import { Database } from
  // 'bun:sqlite'` is ordinary Bun code, and without installed host types
  // the import is a cannot-find DEFECT on a module that demonstrably
  // exists at runtime. One wildcard shorthand (`declare module "bun:*"`)
  // floors them as `any`, with the floor's own gates: installed types
  // outrank it, and strict refuses it — the defect returns until the
  // project declares real host types.
  test('bun:* builtin modules ride the host floor: `any` under gradual, the defect under strict', () => {
    const dir = freshProject({ withTypes: false });
    try {
      fs.writeFileSync(path.join(dir, 'app.rip'), "import { Database } from 'bun:sqlite'\ndb = new Database(':memory:')\nconsole.log db\n");
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fresh', rip: { strict: true } }));
      expect(JSON.parse(check(dir, ['--json']).stdout).map((d) => d.code)).toContain(2307);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the same project is quiet before anything is installed', () => {
    const dir = freshProject({ withTypes: false });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // An import TypeScript cannot type is `any` — it says so itself, and
  // says it TWICE: TS7016 for a .js module with no declarations, which
  // gradual has always suppressed, and TS2580 for a well-known @types
  // package that is not installed, which it did not. Same situation, same
  // posture. The binding is `any` either way, so nothing downstream
  // changes; what changes is whether the advisory is shouted at a project
  // that did not ask for it.
  test('a missing @types package is advisory in gradual mode, an error under strict', () => {
    const files = { 'app.rip': "import { readFileSync } from 'fs'\nconsole.log readFileSync('/x')\n" };
    const gradual = workspace(files);
    const strict = workspace(files, { strict: true });
    try {
      expect(JSON.parse(check(gradual, ['--json']).stdout)).toEqual([]);
      // Strict still says it, so the suppression is a MODE, not a deletion.
      expect(JSON.parse(check(strict, ['--json']).stdout).map((d) => d.code)).toEqual([2580]);
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 60_000);

  // `noImplicitThis` rides the strict umbrella, and TS2683's own message
  // is "'this' implicitly has type 'any'" — the same class the 7xxx family
  // covers, numbered outside it. `@req` in a handler is a receiver the
  // author never annotated and has no obvious spelling to annotate, so
  // demanding one is annotation pressure by another route.
  test("an unannotated `this` is quiet in gradual mode, an error under strict", () => {
    const files = { 'app.rip': 'handler = -> @req\nconsole.log handler\n' };
    const gradual = workspace(files);
    const strict = workspace(files, { strict: true });
    try {
      expect(JSON.parse(check(gradual, ['--json']).stdout)).toEqual([]);
      expect(JSON.parse(check(strict, ['--json']).stdout).map((d) => d.code)).toEqual([2683]);
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 60_000);

  // The line that must NOT move: a module nothing can resolve stays an
  // error. Typos, missing dependencies, and rip's own unresolved
  // workspace packages all live here, and TypeScript's own code is what
  // separates them from the advisory above.
  test('an unresolvable module is still an error in gradual mode', () => {
    const dir = workspace({ 'app.rip': "import { x } from 'totally-not-a-package'\nconsole.log x\n" });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout).map((d) => d.code)).toEqual([2307]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the polarity inverts with the configs — strict root, loose nested', () => {
    const dir = monorepo({ rootStrict: true, nestedStrict: false });
    try {
      const j = JSON.parse(check(dir, ['--json']).stdout);
      const at = (file) => j.filter((d) => d.file === file && d.code === 2322);
      expect(at('root.rip').length, 'the root file rejects under the strict root').toBe(1);
      expect(at('pkg/a.rip').length, 'the nested file stays loose under its own config').toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a file that does not parse reports its CompileError beside the type errors of the rest, exits 1, and says nothing on stderr', () => {
    const dir = workspace({
      'lib.rip': 'export ratio: number = 0.5\nexport def scale(n: number): number\n  n * ratio\n',
      'app.rip': "import { scale } from './lib.rip'\nlabel: string = scale(2)\nconsole.log label\n",
      'bad.rip': 'zz = (1\n',
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('app.rip:2:1 - error');
      expect(r.stdout).toContain("bad.rip:1:6 - error: unclosed '('");
      expect(r.stderr).toBe('');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a __DATA__ payload is not code: it seeds no binding, it is never lexed, and the advisories do not read it', () => {
    // The gate reads the compile's own token tape — the text before the
    // marker — so a payload the lexer would refuse still leaves the file
    // gated, and an annotation spelled inside the payload types nothing.
    const dir = workspace({
      'held.rip': "x = 1\ny = x.bar.baz\nconsole.log y\n__DATA__\nit's payload\nn: number = 1\n# @ts-ignore\n",
      'shown.rip': "z: number = 'oops'\nconsole.log z\n__DATA__\nit's payload\n",
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('shown.rip:1:1 - error');
      expect(r.stdout).not.toContain('held.rip:');
      expect(r.stdout).toContain('1 diagnostic hidden in unannotated code');
      expect(r.stdout).not.toContain('@ts-ignore');
      expect(r.stderr).toBe('');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a package that installs its own ambient types earns its own program: the install binds there and nowhere else', () => {
    // Ambient declarations bind per PROGRAM through typeRoots, which walk
    // up from the program root and never down into a member — so a nested
    // install is unread until the member has its own program. The global
    // resolves inside the installing package, and stays a defect outside
    // it (the cannot-find family reports under every mode).
    const dir = workspace({
      'root.rip': 'console.log FOO_MARK\n',
      'pkg/package.json': '{}',
      'pkg/node_modules/@types/foo/package.json': '{"name":"@types/foo","version":"1.0.0","types":"index.d.ts"}',
      'pkg/node_modules/@types/foo/index.d.ts': 'declare var FOO_MARK: number;\n',
      'pkg/a.rip': 'console.log FOO_MARK\n',
    });
    try {
      const r = check(dir, ['--json']);
      const rows = JSON.parse(r.stdout);
      expect(rows.map((d) => [d.file, d.code])).toEqual([['root.rip', 2304]]);
      expect(r.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the missing-types line names foreign projects, and sends the install "there" only when the count is wholly theirs', () => {
    const dep = {
      'pkg/package.json': '{}',
      'pkg/b.rip': "describe 'adds', ->\n  1\nexport ok = 1\n",
      'a.rip': "import { ok } from './pkg/b.rip'\nconsole.log ok\n",
    };
    const foreign = workspace(dep);
    const mixed = workspace({ ...dep, 'a.rip': "import { ok } from './pkg/b.rip'\nfsMod = require('fs')\nconsole.log ok, fsMod\n" });
    try {
      const f = check(foreign).stdout;
      expect(f).toMatch(/missing-types advisor(y|ies) hidden \(pkg\) — no declarations for `describe` \(try `bun add -d @types\/bun` there\)/);
      const m = check(mixed).stdout;
      expect(m).toMatch(/missing-types advisor(y|ies) hidden \(pkg\) — no declarations for `describe`, `require` \(try `bun add -d @types\/bun`\)/);
    } finally {
      fs.rmSync(foreign, { recursive: true, force: true });
      fs.rmSync(mixed, { recursive: true, force: true });
    }
  }, 90_000);

  test('the stash types the app: bare gates and computeds infer from app/stash.rip, in a directory check and a single-file one', () => {
    // The project anchor (index.rip + package.json) discovers the stash;
    // the face splices `import('<rel>').__RipStash` with no source
    // import, so the stash must ride the closure like an import — the
    // single-file run is the case that would leave it unmaterialized.
    const files = {
      'index.rip': "console.log 'serve'\n",
      'app/stash.rip': "export type Todo =\n  id: number\n  label: string\n\ntodos: Todo[] = []\n\nexport stash =\n  todos: todos\n",
      'app/routes/page.rip': "export Page = component\n  todos ~= @app.data.todos\n  labels ~= todos.map((t) -> t.label)\n  q ~= @router.query.q ?? ''\n  render null\n",
    };
    const dir = workspace(files, { strict: true });
    try {
      const whole = check(dir, ['--json']);
      expect(JSON.parse(whole.stdout)).toEqual([]);
      const single = check(dir, ['app/routes/page.rip', '--json']);
      expect(JSON.parse(single.stdout)).toEqual([]);
      // The face carries the splice; the stash face carries its type.
      const face = fs.readFileSync(path.join(dir, '.rip/check/app/routes/page.rip.ts'), 'utf8');
      expect(face).toContain("import('rip/app').AppData<import(\"../stash.rip\").__RipStash>");
      // The router rides the same discovery: the ambience carries the
      // runtime's Router — with a route tree present, the union-checked
      // construction (Omit keeps every non-navigation member, so the
      // bare `q ~= @router.query.q` above must survive the strict run).
      expect(face).toContain("router?: Omit<import('rip/app').Router, 'push' | 'replace'>");
      const stashFace = fs.readFileSync(path.join(dir, '.rip/check/app/stash.rip.ts'), 'utf8');
      expect(stashFace).toContain('export type __RipStash = typeof stash;');
      // A WRONG stash path squiggles, on the computed road (the class
      // ambience types the `_init` copy — the mapped one) AND on the
      // gate road (the face twin IS the read the author wrote) — instead
      // of collapsing to error-`any`.
      fs.writeFileSync(path.join(dir, 'app/routes/typo.rip'), "export Typo = component\n  bad ~= @app.data.missing\n  worse <~ @app.data.absent\n  render null\n");
      const typo = check(dir, ['app/routes/typo.rip', '--json']);
      const typoRows = JSON.parse(typo.stdout);
      expect(typoRows.some((d) => d.code === 2339 && /missing/.test(d.message))).toBe(true);
      expect(typoRows.some((d) => d.code === 2339 && /absent/.test(d.message))).toBe(true);
      // Without the anchor the same route types nothing and strict says so.
      const bare = workspace({ 'page.rip': files['app/routes/page.rip'] }, { strict: true });
      try {
        const r = check(bare, ['--json']);
        expect(JSON.parse(r.stdout).some((d) => d.code === 7006)).toBe(true);
      } finally { fs.rmSync(bare, { recursive: true, force: true }); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('--strict reports what rip.strict would: the same report as the same workspace with rip.strict set, nothing edited', () => {
    // Both postures are exercised: per file (an unannotated read the gate
    // would hold, an implicit-any parameter) and per program (a null the
    // loosened posture admits, a host name the floor would declare `any`),
    // and across a package boundary (a nested package with its own
    // rip.strict beside a gradual root — the mode flip that earns its own
    // program). Rows compare whole: file, position, severity, code,
    // message, related.
    const files = {
      'a.rip': "x = 1\ny = x.bar.baz\ndef f(n)\n  n\nz: string = null\nconsole.log y, f(1), z, process.argv\n",
      'pkg/b.rip': "w: string = null\nconsole.log w\n",
    };
    const gradual = workspace({ ...files, 'pkg/package.json': JSON.stringify({ rip: { strict: true } }) });
    const strict = workspace({ ...files, 'pkg/package.json': JSON.stringify({ rip: { strict: true } }) }, { strict: true });
    try {
      const plain = check(gradual, ['--json']);
      const forced = check(gradual, ['--strict', '--json']);
      const real = check(strict, ['--json']);
      const rows = (r) => JSON.parse(r.stdout);
      expect(plain.status).toBe(1);                       // the nested strict package reports on its own
      expect(rows(plain).map((d) => d.file)).toEqual(['pkg/b.rip']);
      expect(forced.status).toBe(1);
      expect(rows(forced)).toEqual(rows(real));           // --strict ≡ rip.strict, row for row
      expect(rows(forced).map((d) => d.code)).toEqual(expect.arrayContaining([2339, 7006, 2322, 2580]));
      expect(fs.readFileSync(path.join(gradual, 'package.json'), 'utf8')).toBe('{}');
      expect(forced.stderr).toBe('');
      // The text report says the posture was forced; the plain one does not.
      expect(check(gradual, ['--strict']).stdout).toContain('checked under --strict');
      expect(check(gradual).stdout).not.toContain('checked under --strict');
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 120_000);
});

// ── Typed routes ─────────────────────────────────────────────────────
//
// The route surfaces over the real server: the union discovered from
// `app/routes/**` checks `/`-leading LITERALS on three surfaces —
// intrinsic `<a href>`, a child component's `href:` prop, and
// `router.push`/`replace` — plus the ambient `RoutePath` and per-route
// `@params`. Everything dynamic or external passes BY CONSTRUCTION
// (never wrapped), the documented escape hatches hold, and checking
// stays unarmed without a route tree. The walker itself is pinned in
// packages/vscode/test/unit/routes-discovery.test.js and differentially
// against buildRoutes in packages/app/test/routes-discovery.test.js;
// these are the end-to-end diagnostics.
describeExtended('rip check: typed routes over the real server', () => {
  const STASH = [
    "import { source } from 'rip/app'",
    '',
    'export stash =',
    "  user: source fetch: -> Promise.resolve { name: 'Ada' }",
    '  order: source fetch: (id: string) -> Promise.resolve { id, total: 5 }',
    '  count: 0',
    '',
  ].join('\n');

  const LINKS = [
    'export ButtonLink = component extends a',
    '  render',
    '    a',
    '      slot',
    '',
    'export PlainLink = component',
    "  @href?: string := '/'",
    '  render',
    '    a href: @href',
    '      slot',
    '',
  ].join('\n');

  // The route tree: statics, a nested dynamic, an optional, a group, a
  // catch-all, and layouts — the same shapes cart and medlabs use.
  const ROUTE_FILES = {
    'index.rip': 'x = 1\n',
    'app/stash.rip': STASH,
    'app/components/link.rip': LINKS,
    'app/routes/_layout.rip': [
      'export Layout = component',
      '  ok: -> @params.anything',
      '  render',
      '    div',
      '      slot',
      '',
    ].join('\n'),
    'app/routes/docs/[[page]].rip': [
      'export Docs = component',
      "  ok: -> @params.page ?? 'default'",
      '  render',
      "    div 'docs'",
      '',
    ].join('\n'),
    'app/routes/files/[...rest].rip': [
      'export Files = component',
      '  ok: -> @params.rest',
      '  render',
      "    div 'files'",
      '',
    ].join('\n'),
    'app/routes/(admin)/settings.rip': [
      'export Settings = component',
      '  render',
      "    div 'settings'",
      '',
    ].join('\n'),
    'app/routes/orders/index.rip': [
      'export Orders = component',
      '  ok: -> @params.anything',
      '  render',
      "    div 'orders'",
      '',
    ].join('\n'),
    'app/routes/orders/[id].rip': [
      'export Order = component',
      '  ok: -> @params.id',
      '  render',
      '    div @params.id',
      '',
    ].join('\n'),
    'app/routes/cart.rip': [
      'export Cart = component',
      '  render',
      "    div 'cart'",
      '',
    ].join('\n'),
  };

  test('every legitimate spelling passes: literals, dynamics, externals, escape hatches, params, typed handles', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        "import { ButtonLink, PlainLink } from '../components/link.rip'",
        '',
        'export Home = component',
        "  nav: RoutePath = '/orders'",
        "  data: { href: string } = { href: '/docs/api.html' }",
        "  id := '7'",
        '  go: ->',
        "    @router.push '/cart'",
        "    @router.replace '/'",
        "    @router.push (@router.path ?? '/') + '?page=2'",
        '    @router.push @data.href',
        '    @router.back()',
        "    @app.data.source('user').reset()",
        "    @app.data.source('user.name').reset()",
        "    @app.data.source('order', 'o1').value?.total",
        '  render',
        "    a href: '/cart', 'literal'",
        "    a href: '/settings', 'grouped'",
        "    a href: '/docs', 'optional-absent'",
        '    a href: "/orders/#{@id}", \'interpolated\'',
        "    a href: 'https://example.com', 'external'",
        "    a href: 'mailto:x@y.z', 'mail'",
        "    a href: '#frag', 'fragment'",
        '    a href: @nav, \'dynamic\'',
        '    a href: @data.href, \'string-typed-data\'',
        "    a href: ('/nowhere' as string), 'cast-hatch'",
        "    div href: '/not-a-route'",
        "    ButtonLink href: '/cart', 'component'",
        '    ButtonLink href: @nav, \'component-dynamic\'',
        "    PlainLink href: '/orders', 'own-prop'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const r = check(dir);
      expect(r.stdout).toContain('No type errors');
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('every checked surface rejects a typo, anchored by its shape, naming the union', () => {
    const BAD = [
      "import { ButtonLink, PlainLink } from '../components/link.rip'",
      '',
      'export Home = component',
      "  bogus: RoutePath = '/orderz'",
      '  bad: ->',
      "    @router.push '/cartz'",
      "    @router.replace '/ordersz'",
      // A typo'd source key errors AT THE KEY — the `__ripSourceKey`
      // wrap checks syntactic literals against the stash's key union
      // (dotted paths under a real key stay legal on the template arm).
      "    @app.data.source('userz').reset()",
      '  render',
      "    a href: '/carts', 'typo'",
      '    a href: "/orderz/#{1}", \'template-typo\'',
      "    ButtonLink href: '/cartz', 'component-typo'",
      "    PlainLink href: '/ordersz', 'own-prop-typo'",
      '',
    ].join('\n');
    const dir = workspace({ ...ROUTE_FILES, 'app/routes/index.rip': BAD }, { strict: true });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      // One diagnostic per surface, none elsewhere: the RoutePath
      // annotation (2820 — assignability with a did-you-mean, this
      // union has a near miss to suggest) and the seven wrapped/checked
      // positions (2345 — the six route surfaces and the source key).
      expect(diags.length).toBe(8);
      expect(new Set(diags.map((d) => d.code))).toEqual(new Set([2820, 2345]));
      // Every route mismatch anchors on its surface's MEANINGFUL
      // TOKEN: the four attribute typos on the pair's KEY — the anchor
      // every other mistyped attribute in the DSL reports on — and the
      // router calls on the METHOD NAME (v3 parity on both).
      const lines = BAD.split('\n');
      const spanText = (d) => lines[d.line - 1].slice(d.column - 1, d.endColumn - 1);
      expect(diags.filter((d) => spanText(d) === 'href').map((d) => d.line)).toEqual([10, 11, 12, 13]);
      expect(diags.filter((d) => d.line === 6).map(spanText)).toEqual(['push']);
      expect(diags.filter((d) => d.line === 7).map(spanText)).toEqual(['replace']);
      // The source-key typo anchors at the literal (not a route
      // surface; v3 parity — v3 never snapped source()).
      expect(diags.filter((d) => d.line === 8).map(spanText)).toEqual(["'userz'"]);
      // The message carries the actual literal and the actual routes —
      // prettified (dynamic members as their parameterized display) and
      // in WALKER order (`/docs/:page` beside `/docs`), not tsgo's
      // statics-first normalization.
      const text = check(dir).stdout;
      expect(text).toContain('"/carts"');
      expect(text).toContain('"/" | "/cart" | "/docs" | `/docs/:page` | "/orders" | `/orders/:id` | "/settings"');
      // No ROUTE member ever reads as its checked form. The source-key
      // union's dotted arms (`user.${string}`) keep theirs — that is
      // the honest spelling of "any dotted path under this key".
      expect(text).not.toContain('/docs/${string}');
      expect(text).not.toContain('/orders/${string}');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('per-route params: dynamic, catch-all, and optional shapes; statics and layouts keep the baseline', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/orders/[id].rip': [
        'export Order = component',
        '  ok: -> @params.id',
        '  bad: -> @params.bogus',
        '  render',
        '    div @params.id',
        '',
      ].join('\n'),
      'app/routes/files/[...rest].rip': [
        'export Files = component',
        '  ok: -> @params.rest',
        '  bad: -> @params.id',
        '  render',
        "    div 'files'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      const at = (suffix) => diags.filter((d) => d.file.endsWith(suffix)).map((d) => d.code);
      expect(at('orders/[id].rip')).toEqual([2339]);
      expect(at('files/[...rest].rip')).toEqual([2339]);
      // Statics, layouts, and the optional route carry no params noise.
      expect(at('orders/index.rip')).toEqual([]);
      expect(at('_layout.rip')).toEqual([]);
      expect(at('docs/[[page]].rip')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('a defaulted-D stash handle answers unknown — a consumer narrows, never receives any', () => {
    // Bare `createStash()` types its handles off StashMethods' DEFAULT
    // `D`; the untyped arm of SourceHandleFor must answer the bare
    // handle (`value: unknown`) so an unnarrowed use is an error — the
    // defaulted surface must never silently widen to `any`.
    const dir = workspace({
      'stash-consumer.rip': [
        "import { createStash } from 'rip/app'",
        'stash = createStash()',
        "n: number = stash.source('x').value",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('stash-consumer.rip'));
      expect(diags.map((d) => d.code)).toEqual([2322]);
      expect(diags[0].message).toContain("'unknown'");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('a user-declared RoutePath wins over the ambient alias', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        'type RoutePath = string',
        '',
        'export Home = component',
        "  loose: RoutePath = '/definitely-not-a-route'",
        '  render',
        '    div',
        '      = @loose',
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      expect(check(dir).status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('arming: no route tree, or a catch-all-only tree, leaves every literal unchecked', () => {
    const bare = workspace({
      'index.rip': 'x = 1\n',
      'app/stash.rip': STASH,
      'page.rip': [
        'export Page = component',
        '  render',
        "    a href: '/no-routes-here', 'fine'",
        '',
      ].join('\n'),
    }, { strict: true });
    const fallbackOnly = workspace({
      'index.rip': 'x = 1\n',
      'app/stash.rip': STASH,
      'app/routes/[...rest].rip': [
        'export Fallback = component',
        '  ok: -> @params.rest',
        '  render',
        "    a href: '/anything-goes', 'fine'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      expect(check(bare).status).toBe(0);
      expect(check(fallbackOnly).status).toBe(0);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(fallbackOnly, { recursive: true, force: true });
    }
  }, 120_000);

  test('routes without a stash: hrefs check, the router stays untyped (v3 parity gate)', () => {
    const dir = workspace({
      'index.rip': 'x = 1\n',
      'app/routes/cart.rip': ROUTE_FILES['app/routes/cart.rip'],
      'app/routes/index.rip': [
        'export Home = component',
        '  bad: ->',
        "    @router.push '/cartz'",
        '  render',
        "    a href: '/carts', 'typo'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // Exactly the href typo: push rides the untyped router ambience.
      expect(diags.map((d) => [path.basename(d.file), d.code])).toEqual([['index.rip', 2345]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('gradual mode still surfaces route typos — real errors with cheap escapes', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        'export Home = component',
        '  render',
        "    a href: '/carts', 'typo'",
        '',
      ].join('\n'),
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      expect(diags.map((d) => d.code)).toEqual([2345]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('the pin pass carries the route options: a pinned file keeps its route diagnostic exact', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        // A hoisted binding read inside a nested function is the Tier-3
        // pinnable shape; the recompile it triggers must reproduce the
        // SAME face, route wraps included, or this diagnostic drifts.
        'config = { limit: 5 }',
        'readLimit = -> config.limit',
        '',
        'export Home = component',
        '  render',
        "    a href: '/carts', 'typo'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      expect(diags.length).toBe(1);
      expect(diags[0].code).toBe(2345);
      expect(diags[0].line).toBe(6);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
