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
import { spawnSync } from 'node:child_process';
import { describeExtended } from '../support/extended.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
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
        '  @timestamps',
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

  // The mixin face promises exactly what the runtime serves, in both
  // directions. The projection algebra works on a mixin — __schemaDerive
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
      expect(out).toMatch(/\d+ missing-types advisor(y|ies) hidden — no declarations for `describe`, `require` \(try `bun add -d @types\/bun`\)/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // Config is per FILE (nearest package.json), so a strict consumer's
  // check still hides its gradual DEPENDENCIES' diagnostics — and a
  // summary that says "set `rip.strict` in package.json" after the user
  // just did exactly that reads as broken. The lines name the projects
  // the hidden diagnostics belong to, so the remedy points at the right
  // package.json; the home project ('.') alone stays unnamed.
  test('hidden-diagnostics summary names the gradual projects when the target itself is strict', () => {
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
      const out = check(dir, [path.join('packages', 'app')]).stdout;
      expect(out).toMatch(/\d+ diagnostics? hidden in unannotated code \(packages\/util\) — annotate a declaration/);
      expect(out).toMatch(/\d+ annotation diagnostics? hidden \(packages\/util\) — set `rip\.strict`/);
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
      // A face whose source no longer exists is wiped by the next run,
      // not trusted from the cache.
      fs.writeFileSync(path.join(mirror, 'deleted.rip.ts'), 'const ghost: number = 0;\n');
      check(dir);
      expect(fs.existsSync(path.join(mirror, 'a.rip.ts'))).toBe(true);
      expect(fs.existsSync(path.join(mirror, 'deleted.rip.ts'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

  // Coverage short of what was asked never exits 0: a file readable at
  // collect time but not at read time is skipped loudly (exit 2, a stderr
  // note), and a clean sibling does NOT rescue the exit code into a false 0.
  test('an unreadable file leaves the run incomplete (exit 2, no false clean)', () => {
    const dir = workspace({ 'ok.rip': 'x: number = 1\nconsole.log x\n', 'locked.rip': 'y: number = 2\nconsole.log y\n' });
    const locked = path.join(dir, 'locked.rip');
    try {
      fs.chmodSync(locked, 0o000);
      let readable = false;
      try { fs.readFileSync(locked, 'utf8'); readable = true; } catch { /* expected EACCES */ }
      if (readable) return; // root / owner-override filesystem can't exercise this path
      const r = check(dir);
      expect(r.status).toBe(2);                          // incomplete coverage → never 0
      expect(r.stderr).toContain('the run is incomplete');
      expect(r.stdout).not.toContain('No type errors');  // ok.rip is clean, but the run isn't
    } finally {
      try { fs.chmodSync(locked, 0o644); } catch { /* already restored */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
});
