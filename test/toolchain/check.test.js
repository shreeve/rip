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

  test('the match operator and its regex-index sugar publish nothing', () => {
    // `text =~ /re/` lowers to `(_ = toMatchable(text).match(re))`, and the
    // face's prelude types toMatchable `(v: any, allowNewlines?: boolean) =>
    // string | null` — the null return is the deliberate loud-throw path for
    // a multi-line receiver without /m, so the SIGNATURE stays as it is and
    // the LOWERING carries the narrowing: the emitted spine asserts its own
    // intermediate (a TS-only region — the JS bytes are untouched), so no
    // match expression publishes on legal rip. The regex-index sugar shares
    // that spine (`regexIndex`, src/emitter.js).
    //
    // Every branch of both lowerings is here, because the assertion is
    // emitted per-branch: `=~` plain and under a literal /m, and the index
    // in all four of its shapes (whole match / nth capture × plain / /m).
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

  // Three of the four component member forms silently accept a wrong-typed
  // initializer: in a component-carrying file the face's runtime destructure
  // is UNTYPED (the reactive table's generic signatures are lost), so
  // `__state`/`__computed` return effectively-any and the _init assignments
  // never check; the `=!` member's constructor-seam write is cast
  // `(this as any)`, which swallows the value check with it. Wrong-typed
  // WRITES inside a method are a second root in the same hole: tsgo reports
  // them on the mirror, and the `@name` lowering's `this.`-prefix carries no
  // source row, so mapTsDiagnostic drops them in transit — state, prop, and
  // plain non-reactive member alike.
  //
  // Both halves are OPEN gaps, so this test asserts the SILENCE on purpose —
  // the exact-list assertions are the gap. The day either half is fixed
  // (typing the destructure, or an honest mapping for the `@` write's span),
  // new diagnostics appear and the lists below go red: that is the cue to
  // invert this test and move the member negatives into the audit's
  // components error pair, not a regression. The liveness signals are
  // IN-FILE: the plain member's own TS2322 proves member initializers reach
  // the checker, and the method-body TS2304 proves method bodies do — so a
  // checker that stopped reporting cannot impersonate the fix.
  test('a component member initializer and in-method writes are never type-checked — an open gap, asserted as-is', () => {
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
    // The write half was driven under rip.strict; the drop is mode-independent
    // (mapTsDiagnostic discards any diagnostic whose generated span has no
    // honest source mapping), but the gate re-drives the driven posture.
    const writeDir = workspace({
      'writes.rip': [
        'export Writer = component',
        "  @value: string := ''",
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
      // The plain member's TS2322 alone — the `:=`, `~=`, and `=!` member
      // lines (3–5) publish NOTHING. Exact list: a fix on any form goes red.
      expect(init.map((d) => [d.code, d.line])).toEqual([[2322, 2]]);

      const writes = JSON.parse(check(writeDir, ['--json']).stdout);
      // The method body's TS2304 alone — the three wrong-typed member writes
      // (lines 7–9) publish NOTHING, though tsgo reports all three on the
      // mirror.
      expect(writes.map((d) => [d.code, d.line])).toEqual([[2304, 10]]);
    } finally {
      fs.rmSync(initDir, { recursive: true, force: true });
      fs.rmSync(writeDir, { recursive: true, force: true });
    }
  }, 90_000);

  // A wrong-typed schema DEFAULT and a wrong-typed TRANSFORM both publish
  // nothing: the face carries the schema body as an untyped runtime
  // descriptor (`__schema({ … })`), where a default is a bare JS value and a
  // transform a bare JS function, related to the field's declared type by
  // nothing tsgo can see. The runtime rejects both on every `.parse()` — the
  // declaration is a program that cannot parse successfully, silent until
  // run.
  //
  // An OPEN gap, asserted as the SILENCE on purpose: the day the descriptor
  // types its defaults (or transforms), schema.rip publishes and the empty
  // list goes red — the cue to invert this test and move the misdeclaration
  // negatives into the audit's schema error pair, not a regression. The
  // liveness pair (a real TS2322 in the same workspace) keeps an empty run
  // loud.
  test('a wrong-typed schema default or transform is never type-checked — an open gap, asserted as-is', () => {
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
      expect(diags.filter((d) => d.file === 'schema.rip')).toEqual([]);                      // the gap
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
  test('a pattern catch never publishes from its own lowering, and the identifier spelling keeps unknown', () => {
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
      expect(diags.filter((d) => d.file === 'scoped.rip').map((d) => [d.code, d.line]))
        .toEqual([[18046, 4], [2322, 9]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  // A forward-referenced class-expression binding breaks the pin probe:
  // tsgo types an anonymous class by its own binding, so the probe
  // declaration's hover answers `typeof __rip_probe_N_<name>` —
  // self-referential — and parseProbeHover's unusable-answer filter has no
  // self-reference clause, so the answer feeds back through compile() as a
  // pin naming a symbol from a probe file already deleted. The published
  // error is doubly wrong: false, and spelled in minted vocabulary the user
  // can find nowhere.
  //
  // An OPEN gap, asserted as-is: the day the filter (or a substitution
  // shape) lands, the TS2304 vanishes and this goes red — the cue to invert
  // this test and move the forward-reference spelling into the corpus, not
  // a regression. Liveness-paired.
  test('a forward-referenced class pins the probe\'s own symbol — TS2304 on legal code, an open gap, asserted as-is', () => {
    const dir = workspace({
      'fwd.rip': [
        'make = -> new Box()',    // reads Box above its declaration — forces the hoist split
        'Box = class',
        "  greet: -> 'hi'",
        'console.log make().greet()',
      ].join('\n') + '\n',
      'live.rip': "n: number = 'oops'\nconsole.log n\n",
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.filter((d) => d.file === 'live.rip').map((d) => d.code)).toEqual([2322]); // liveness
      const fwd = diags.filter((d) => d.file === 'fwd.rip');
      // Code bound to its line, column left free — the diagnostic is anchored
      // at the hoist line, whose mapped column is a property of the hoist
      // emission rather than of this root, so pinning it would redden on an
      // unrelated remap. The minted symbol in the message is the substantive
      // assertion: that vocabulary IS the defect.
      expect(fwd.map((d) => [d.code, d.line])).toEqual([[2304, 1]]);
      expect(fwd[0].message).toContain('__rip_probe_');
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

  // The generated TS mirror is scratch, removed on exit by default so a
  // repeatedly-run check never litters .rip/check — retained only under
  // --keep-mirror, for inspecting the exact TypeScript tsgo checked.
  test('the TS mirror is removed after a run, kept only with --keep-mirror', () => {
    const dir = workspace({ 'a.rip': 'x: number = 0\nconsole.log x\n' });
    try {
      const dotRip = path.join(dir, '.rip');
      const mirror = path.join(dotRip, 'check');
      check(dir);
      // The whole .rip parent goes when the check created it (nothing
      // else lives there) — not just .rip/check.
      expect(fs.existsSync(dotRip)).toBe(false);
      const r = check(dir, ['--keep-mirror']);
      expect(fs.existsSync(path.join(mirror, 'a.rip.ts'))).toBe(true);  // the face is retained
      expect(r.stderr).toContain('keeping TS mirror');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // The .rip parent is pruned only when empty: a coexisting editor mirror
  // (.rip/editor) must survive a batch check.
  test('a coexisting .rip/editor is preserved (only the empty parent is pruned)', () => {
    const dir = workspace({ 'a.rip': 'x: number = 0\nconsole.log x\n' });
    try {
      const editorDir = path.join(dir, '.rip', 'editor');
      fs.mkdirSync(editorDir, { recursive: true });
      fs.writeFileSync(path.join(editorDir, 'marker'), 'keep me\n');
      check(dir);
      expect(fs.existsSync(path.join(editorDir, 'marker'))).toBe(true);          // editor mirror untouched
      expect(fs.existsSync(path.join(dir, '.rip', 'check'))).toBe(false);        // batch mirror cleaned
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
});
