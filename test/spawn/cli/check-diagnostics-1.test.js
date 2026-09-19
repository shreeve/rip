// `rip check` — type diagnostics over the real server, part 1 of 3.
// One describe of 130 cases is split by range across three files so
// `bun test --parallel` schedules the parts on separate workers: each
// `check()` is a synchronous spawn, so a file is one serial lane. The
// runner and workspace builders live in ./support/check-harness.js.

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
