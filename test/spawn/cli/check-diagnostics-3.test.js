// `rip check` — type diagnostics over the real server, part 3 of 3
// (see check-diagnostics-1.test.js for why the describe is split). The
// runner and workspace builders live in ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { TSCONFIG, workspace, monorepo, freshProject, check, withUnreadable } from './support/check-harness.js';

describeExtended('rip check: type diagnostics over the real server', () => {
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

  // Under rip.strict a pinned first write reports its implicit-any
  // parameters exactly as an unpinned one does. `later` is read across a
  // closure above its definition, so it stays hoisted and the pin pass
  // types its hoist line from the definition itself; `first` declares in
  // place. Both definitions are the same unannotated function.
  test('strict: a pinned forward definition reports TS7006 like a declare-in-place one', () => {
    const dir = workspace({
      'forward.rip': [
        'export before = -> later(1, 2)',
        'later = (a, b) -> a + b',
        '',
        'first = (a, b) -> a + b',
        'export after = -> first(1, 2)',
      ].join('\n') + '\n',
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      expect(diags.map((d) => [d.code, d.line, d.column])).toEqual([
        [7006, 2, 10], [7006, 2, 13], [7006, 4, 10], [7006, 4, 13],
      ]);
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
      // The fallback root's own prefix, not the fixtures' `rip-check-`: sibling
      // check-*.test.js files build workspaces concurrently on other workers.
      const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rip-check-fallback-')));
      const r = check(dir);
      expect(r.stderr).toContain('temp fallback');                       // degraded, never silent
      expect(r.status).toBe(0);                                          // the clean file still checks clean
      expect(fs.existsSync(path.join(dir, '.rip'))).toBe(false);         // nothing forced into the workspace
      const leaked = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rip-check-fallback-') && !before.has(n));
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

  // A pin is hover text, and hover spells a type by the short name its
  // declaration file uses: `Stats` for a statSync result, visible inside
  // @types/node's `fs` module and nowhere else. Written onto the hoist
  // line, that spelling is a cannot-find on a line the author never
  // wrote. The probe verifies each answer where the pin will live and
  // refuses the ones that do not resolve there — the binding stays an
  // evolving `any`, the round's status quo.
  test('a pin spelled in vocabulary the face cannot resolve is refused, not written', () => {
    const dir = workspace({
      // Written in two scopes, so the binding stays hoisted at the outer
      // one and is read from the inner — the pinnable shape.
      'walk.rip': "import { statSync } from 'fs'\nexport scan = (paths) ->\n  walk = (p) ->\n    stat = statSync p\n    stat.size\n  for p in paths\n    stat = statSync p\n    walk p if stat.isDirectory()\n",
    });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // Bun's builtin MODULES are typed from the checkout's `@types/bun` in
  // every program: `import { Database } from 'bun:sqlite'` is ordinary Bun
  // code, and a project that installs nothing gets the real declaration
  // — under gradual and strict alike — never a floored `any` (which
  // would let the misassignment below through) and never a cannot-find
  // defect on a module that demonstrably exists at runtime.
  test('bun:* builtin modules are typed from the checkout\'s host types in every mode', () => {
    const dir = freshProject({ withTypes: false });
    try {
      fs.writeFileSync(path.join(dir, 'app.rip'), "import { Database } from 'bun:sqlite'\ndb: number = new Database(':memory:')\nconsole.log db\n");
      expect(JSON.parse(check(dir, ['--json']).stdout).map((d) => d.code)).toEqual([2322]);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fresh', rip: { strict: true } }));
      expect(JSON.parse(check(dir, ['--json']).stdout).map((d) => d.code)).toEqual([2322]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the same project is quiet before anything is installed', () => {
    const dir = freshProject({ withTypes: false });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // A name TypeScript cannot type is `any` — it says so itself, and
  // says it TWICE: TS7016 for a .js module with no declarations, which
  // gradual has always suppressed, and TS2582 for a test-runner global
  // used bare, which it did not. Same situation, same posture. The
  // binding is `any` either way, so nothing downstream changes; what
  // changes is whether the advisory is shouted at a project that did not
  // ask for it. (Node's modules are not a case here any more: `fs` is
  // typed from the checkout's `@types/bun`.)
  test('a missing test-runner declaration is advisory in gradual mode, an error under strict', () => {
    const files = { 'app.rip': "describe 'adds', ->\n  1\n" };
    const gradual = workspace(files);
    const strict = workspace(files, { strict: true });
    try {
      expect(JSON.parse(check(gradual, ['--json']).stdout)).toEqual([]);
      // Strict still says it, so the suppression is a MODE, not a deletion.
      expect(JSON.parse(check(strict, ['--json']).stdout).map((d) => d.code)).toEqual([2582]);
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

  // Foreign projects (a closure's dependencies) are named on the line;
  // the home project stays unnamed. The remedy is an import wherever the
  // name is used, so it never points anywhere.
  test('the missing-types line names foreign projects, and the remedy is the import', () => {
    const dep = {
      'pkg/package.json': '{}',
      'pkg/b.rip': "describe 'adds', ->\n  1\nexport ok = 1\n",
      'a.rip': "import { ok } from './pkg/b.rip'\nconsole.log ok\n",
    };
    const foreign = workspace(dep);
    const mixed = workspace({ ...dep, 'a.rip': "import { ok } from './pkg/b.rip'\nit 'runs', ->\n  1\nconsole.log ok\n" });
    try {
      const f = check(foreign).stdout;
      expect(f).toMatch(/missing-types advisor(y|ies) hidden \(pkg\) — no declarations for `describe` \(import it from `bun:test`\)/);
      const m = check(mixed).stdout;
      expect(m).toMatch(/missing-types advisor(y|ies) hidden \(pkg\) — no declarations for `describe`, `it` \(import them from `bun:test`\)/);
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
      'app/routes/page.rip': "export Page = component\n  todos ~= @stash.todos\n  labels ~= todos.map((t) -> t.label)\n  q ~= @router.query.q ?? ''\n  render null\n",
    };
    const dir = workspace(files, { strict: true });
    try {
      const whole = check(dir, ['--json']);
      expect(JSON.parse(whole.stdout)).toEqual([]);
      const single = check(dir, ['app/routes/page.rip', '--json']);
      expect(JSON.parse(single.stdout)).toEqual([]);
      // The face carries the splice; the stash face carries its type.
      const face = fs.readFileSync(path.join(dir, '.rip/check/app/routes/page.rip.ts'), 'utf8');
      expect(face).toContain("import('rip/app').StashData<import(\"../stash.rip\").__RipStash>");
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
      fs.writeFileSync(path.join(dir, 'app/routes/typo.rip'), "export Typo = component\n  bad ~= @stash.missing\n  worse <~ @stash.absent\n  render null\n");
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
    // loosened posture admits, a host name typed from the checkout's
    // `@types/bun` in both),
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
      expect(rows(forced).map((d) => d.code)).toEqual(expect.arrayContaining([2339, 7006, 2322]));
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
