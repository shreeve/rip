// `rip check` — type diagnostics over the real server, part 1a of 6
// (cases 1–25 of the former part 1). One describe of 130 cases is split by
// range across six files (1a/1b, 2a/2b, 3a/3b) so `bun test --parallel`
// schedules the parts on separate workers: each `check()` is a
// synchronous spawn, so a file is one serial lane, and the lane ends
// when its LONGEST file does. The halves are balanced by measured
// serial seconds, not by case count. The runner and workspace builders
// live in ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from '../../support/spawn.js';
import { describeExtended } from '../../support/extended.js';
import { BIN, TSCONFIG, workspace, check } from './support/check-harness.js';

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

  test('a satisfies is author type information: its mismatch publishes under gradual, at TypeScript\'s own anchor', () => {
    // The line carries no annotation token, so only the satisfies opens
    // it; tsc anchors a whole-shape miss on the `satisfies` keyword.
    const dir = workspace({ 'sat.rip': 'type Entry = { href: string, name: string }\nx = { href: "/a" } satisfies Entry\nconsole.log x\n' });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('sat.rip:2:20 - error TS2741');
      expect(r.stdout).not.toContain('hidden in unannotated code');
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
  // declaration, flip `rip.strict`, import the test runner's
  // declarations. The lines spell the strict remedy IDENTICALLY (a
  // summary that words the same lever two ways reads as two levers), and
  // the missing-types advisory NAMES the declarations it is about — a
  // remedy with no noun sends the user hunting through their own code.
  // Host names (`require`, `process`) are typed by the checkout's
  // `@types/bun` and never reach the advisory.
  test('the hidden-diagnostics summary: consistent remedies, and the missing declarations are named', () => {
    const dir = workspace({
      'app.rip': [
        'n = 42',
        'bad = n.toUpperCase()',      // real error, held → scope family
        'def shout(msg)',             // implicitly-any parameter → annotation family
        '  msg',
        "describe 'adds', ->",        // a test-runner global used bare — the advisory names it
        '  console.log bad, shout',
        "fsMod = require('fs')",      // a host name, typed from the checkout — nothing to name
        'console.log fsMod',
      ].join('\n') + '\n',
    });
    try {
      const out = check(dir).stdout;
      expect(out).toMatch(/\d+ diagnostics? hidden in unannotated code — annotate a declaration to check its scope, or set `rip\.strict` in package\.json/);
      expect(out).toMatch(/\d+ annotation diagnostics? hidden — set `rip\.strict` in package\.json to see where annotations are missing/);
      // In the home project the line stays placeless; foreign projects (a
      // closure's dependencies) add `(dirs)` and point the remedy there.
      expect(out).toMatch(/\d+ missing-types advisor(y|ies) hidden — no declarations for `describe` \(import it from `bun:test`\)/);
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
});
