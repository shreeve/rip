// The editor's CODE ACTIONS and cross-file enrichment driven over real
// LSP stdio against the real server + tsgo: the source.* actions
// (organize imports, add missing imports) map their edits onto Rip
// source; TS directives reach the editor (directive inheritance);
// write-site hover enrichment crosses files; the auto-import quickfix
// maps its edit onto Rip source.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/editor-features.mjs.
import { test, expect, describe } from 'bun:test';
import { SCAFFOLD_FAMILIES } from '../../src/translate.js';
import { tsgoAvailable, inWorkspace, applyEdits, UTIL } from './support/editor-features.mjs';

describe.skipIf(!tsgoAvailable)('source.* code actions', () => {
  const WHOLE_DOC = { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } };

  // The tolerant face made READ surfaces work on an incomplete buffer,
  // and the first cut of the edit guard refused the whole FILE whenever
  // one existed — which silently removed every quick fix for as long as
  // the user was mid-expression, the editor's most-used edit surface,
  // for an incompleteness that cannot reach the edit. An import inserted
  // at offset 0 is settled text; the unclosed call three lines below it
  // is not. The boundary is positional, so both halves are asserted in
  // one session: offered before the incompleteness, refused at it.
  test('a quick fix before an incomplete expression still applies; one at it is refused', async () => {
    await inWorkspace({ 'zed.rip': 'export zz = 1\n' }, async (api) => {
      const SRC = "console.log 'x'\nv = zz\nr = zz(1,\n";
      await api.open('app.rip', SRC);
      // An incomplete buffer publishes TWICE: rip's own rejection lands first,
      // ahead of the tsgo pull so it survives tsgo being dead, and the mapped TS
      // set follows. `open()` resolves on the first, so the 2304 the quick fix
      // is keyed to is not there yet — poll for it rather than reading whichever
      // publication happened to arrive.
      let diags = [];
      for (let i = 0; i < 60; i++) {
        diags = api.diagnostics('app.rip');
        if (diags.some((d) => d.code === 2304)) break;
        await api.sleep(100);
      }
      expect(diags.some((d) => /unclosed '\('/.test(d.message ?? ''))).toBe(true);
      expect(diags.some((d) => d.code === 2304), 'the unresolved name is reported').toBe(true);

      const at = { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } };
      const actions = await api.codeAction('app.rip', at, diags.filter((d) => d.code === 2304));
      const add = (actions ?? []).find((a) => /Add import/.test(a.title ?? ''));
      expect(add, 'the import quick fix survives an incompleteness below it').toBeTruthy();

      // And it lands where it should — at the top, not beside the hole.
      const edits = add.edit.changes[api.uriOf('app.rip')];
      expect(edits).toHaveLength(1);
      expect(edits[0].range.start.line).toBe(0);
      expect(edits[0].newText).toContain("from './zed.rip'");

      // Rename is the reference for the other half: it refuses outright
      // on a recovered face, and must keep refusing.
      const renamed = await api.rename('app.rip', 1, 4, 'zzz')
        .catch((e) => ({ error: String(e.message ?? e) }));
      expect(JSON.stringify(renamed)).toMatch(/does not compile|error/i);
    });
  }, 30000);

  test('organize imports drops the unused import and keeps the survivor in the USER\'s spelling', async () => {
    await inWorkspace({ 'util.rip': UTIL, 'zed.rip': 'export zz = 1\n' }, async (api) => {
      // zz is unused; the kept import spells with DOUBLE quotes and no
      // semicolon — the applied rewrite must preserve those bytes.
      const SRC = 'import { zz } from "./zed.rip"\nimport { answer } from "./util.rip"\nexport k = answer + 1\n';
      await api.open('app.rip', SRC);
      const actions = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.organizeImports']);
      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe('source.organizeImports');
      const edits = actions[0].edit.changes[api.uriOf('app.rip')];
      expect(edits.length).toBeGreaterThan(0);
      // Apply bottom-up; the result keeps the user's own import bytes.
      const applied = applyEdits(SRC, edits);
      expect(applied).toBe('import { answer } from "./util.rip"\nexport k = answer + 1\n');
      await api.change('app.rip', applied);
      expect(api.diagnostics('app.rip')).toEqual([]);
    });
  }, 30000);

  test('clause NARROWING keeps the user\'s quote style: only the removed specifier changes bytes (the #67 review MAJOR)', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      // `shout` is unused; narrowing rewrites the clause, and the
      // rewritten line has no whole-line face twin — the fallback must
      // re-quote the specifier to the user's DOUBLE quotes instead of
      // shipping the face's single-quote spelling.
      const SRC = 'import { answer, shout } from "./util.rip"\nexport k = answer + 1\n';
      await api.open('app.rip', SRC);
      const actions0 = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.organizeImports']);
      expect(actions0).toHaveLength(1);
      expect(applyEdits(SRC, actions0[0].edit.changes[api.uriOf('app.rip')]))
        .toBe('import { answer } from "./util.rip"\nexport k = answer + 1\n');
      // The subsets of organize and the fix-all batch are not offered:
      // an ask for those kinds alone answers nothing, though tsgo would
      // rewrite for each of them.
      for (const kind of ['source.removeUnusedImports', 'source.sortImports', 'source.fixAll']) {
        expect(await api.codeAction('app.rip', WHOLE_DOC, [], [kind])).toEqual([]);
      }
      // The single-quote control: the user's style already matches the
      // face's spelling and survives identically.
      const SINGLE = "import { answer, shout } from './util.rip'\nexport k = answer + 1\n";
      await api.change('app.rip', SINGLE);
      const actions = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.organizeImports']);
      expect(applyEdits(SINGLE, actions[0].edit.changes[api.uriOf('app.rip')]))
        .toBe("import { answer } from './util.rip'\nexport k = answer + 1\n");
      // Backtick specifiers are not the third style to cover: the
      // lexer rejects them (`cannot tokenize '\u0060'`) — '/" are the
      // only import spellings Rip has.
    });
  }, 30000);

  test('import COMBINING takes the FIRST source statement\'s quote style (the deterministic first-statement rule)', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      // Two same-module imports, both used: organize merges them into
      // one clause — a line with no face twin. The merged specifier
      // takes the FIRST source import's double quotes.
      const SRC = 'import { answer } from "./util.rip"\nimport { shout } from \'./util.rip\'\nexport k = shout("x") + answer\n';
      await api.open('app.rip', SRC);
      const actions = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.organizeImports']);
      expect(actions).toHaveLength(1);
      const applied = applyEdits(SRC, actions[0].edit.changes[api.uriOf('app.rip')]);
      expect(applied).toBe('import { answer, shout } from "./util.rip"\nexport k = shout("x") + answer\n');
      await api.change('app.rip', applied);
      expect(api.diagnostics('app.rip')).toEqual([]);
    });
  }, 30000);

  test('an import line carrying a trailing comment refuses the rewrite: the action drops, never deletes comment bytes', async () => {
    await inWorkspace({ 'util.rip': UTIL, 'zed.rip': 'export zz = 1\n' }, async (api) => {
      // The unused import carries a comment tsgo never saw; deleting
      // the whole source line would take the comment with it — the
      // whole-line-edit shape refuses and the action drops.
      const SRC = 'import { zz } from "./zed.rip" # keep me\nimport { answer } from "./util.rip"\nexport k = answer + 1\n';
      await api.open('app.rip', SRC);
      const actions = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.organizeImports']);
      expect(actions ?? []).toEqual([]);
      expect(api.logs.some((l) => l.includes("'Organize Imports' dropped"))).toBe(true);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('TS directives reach the editor (directive inheritance)', () => {
  test('# @ts-expect-error suppresses the next line; an unused one lands TS2578 on the Rip comment', async () => {
    await inWorkspace({}, async (api) => {
      // The directive places in the face, so the deliberate
      // violation draws NO diagnostic in the editor.
      await api.open('app.rip', 'count: number = 42\n# @ts-expect-error\ncount = "nope"\nconsole.log count\n');
      expect(api.diagnostics('app.rip')).toEqual([]);

      // Remove the violation: the directive is now unused — TS2578
      // arrives, and its range maps onto the Rip COMMENT line (the
      // tsDirective cover row carries the comment's real span).
      await api.change('app.rip', 'count: number = 42\n# @ts-expect-error\ncount = 43\nconsole.log count\n');
      const diags = api.diagnostics('app.rip');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe(2578);
      expect(diags[0].range.start.line).toBe(1);
    });
  }, 30000);

  // tsc's directives govern ERRORS, never the suggestion classes: a
  // suppressed line still dims its unused binding (driven against tsgo on a
  // plain .ts module — the TS2322 goes, the TS6133 stays, for BOTH directive
  // spellings). Rip must not be stronger than the thing it emulates.
  //
  // The two cases below differ in WHERE the error is absorbed, which is the
  // whole reason both exist:
  //
  //   · single-line — the face directive sits directly above the one emitted
  //     statement, so TSGO absorbs the error at the face. applyRipDirectives
  //     never sees it; only the hint reaches the governed-line check.
  //   · multi-line lowering — the face directive governs only its next FACE
  //     line, so an error landing on a LATER line of the same statement's
  //     lowering LEAKS past it and reaches applyRipDirectives over rip
  //     positions, mapped back onto the head line the directive governs.
  //     That is the only path on which the governed-line check absorbs a
  //     real error, marks the directive used, and drops tsgo's now-spurious
  //     TS2578 — so it is the only case that exercises those branches.
  test('a directive absorbs the ERROR, never the unused-local fade (TS6133 survives, tagged)', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', '# @ts-expect-error\nbadCount: number = "oops"\n');
      const diags = api.diagnostics('app.rip');

      // The TS2322 is gone (tsgo absorbed it at the face); the fade is not.
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe(6133);
      expect(diags[0].severity).toBe(4);
      expect(diags[0].tags).toEqual([1]);      // Unnecessary — VS Code fades it
      expect(diags[0].range.start.line).toBe(1);

      // Negative control: read the binding and the fade goes. A green run
      // above therefore means the hint SURVIVED the directive, not that
      // TS6133 fires unconditionally.
      await api.change('app.rip', '# @ts-expect-error\nbadCount: number = "oops"\nconsole.log badCount\n');
      expect(api.diagnostics('app.rip')).toEqual([]);

      // `@ts-ignore` takes the SAME range path (ripDirectiveLines matches
      // both spellings), and tsc treats it the same way — so the fade must
      // survive it too. Nothing else pins this.
      await api.change('app.rip', '# @ts-ignore\nbadCount: number = "oops"\n');
      const ignored = api.diagnostics('app.rip');
      expect(ignored).toHaveLength(1);
      expect(ignored[0].code).toBe(6133);
      expect(ignored[0].tags).toEqual([1]);
    });
  }, 30000);

  test('a LEAKED error (multi-line lowering) is absorbed over rip positions and marks the directive used', async () => {
    await inWorkspace({}, async (api) => {
      // A child component's prop errors land on the CTOR face line, but a
      // directive above the ELEMENT emits above the mount scaffold's first
      // line — a face line with no error — so tsgo reports the TS2322 live
      // plus a spurious TS2578. Both map back onto rip positions: the
      // TS2322 onto the `Chip label: 123` head line the directive governs —
      // absorbed, and absorbing it marked the directive USED, so the TS2578
      // drops. A hint alone would NOT have marked it used: that guard is
      // pinned by check-diagnostics-3a.test.js ('an unused @ts-expect-error stays loud').
      const chip = 'export Chip = component\n  @label: string := ""\n\n  render\n    span label\n\n';
      await api.open('app.rip',
        chip + 'export App = component\n  render\n    div\n      # @ts-expect-error — label expects string\n      Chip label: 123\n');
      expect(api.diagnostics('app.rip')).toEqual([]);

      // Control: drop the directive and the leaked error is REAL and loud —
      // so the green assertion above means "absorbed", not "nothing fired".
      await api.change('app.rip',
        chip + 'export App = component\n  render\n    div\n      Chip label: 123\n');
      expect(api.diagnostics('app.rip').map((d) => d.code)).toContain(2322);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('write-site hover enrichment across files', () => {
  test('an EXPORTED unannotated binding hovers its inferred type at the write site (Tier 1 declare-in-place)', async () => {
    // Formerly this pinned a limitation: the hoisted shape left an
    // exported let un-evolved (TypeScript's own rule), so the write
    // site hovered `any` and no enrichment could help. Tier 1 emits
    // `let total = 1 + 2;` — a real initializer — so the exported
    // binding types natively, cross-file readers included. Plain-TS
    // parity, still never invented narrowing.
    await inWorkspace({
      'lib.rip': 'total = 1 + 2\nexport { total }\n',
    }, async (api) => {
      await api.open('app.rip', 'import { total } from "./lib.rip"\nout = total\n');
      await api.open('lib.rip', 'total = 1 + 2\nexport { total }\n');
      const atWrite = await api.hover('lib.rip', 0, 1);
      expect(atWrite.contents.value).toContain('let total: number');

      // The same shape UNEXPORTED evolves: the module-local twin's
      // write site enriches from its same-file read.
      await api.change('lib.rip', 'total = 1 + 2\nout = total.toFixed(2)\nexport { out }\n');
      const local = await api.hover('lib.rip', 0, 1);
      expect(local.contents.value).toContain('let total: number');
    });
  }, 30000);

  test('a bare gate at its declaration hovers the RESOLVED stash type, never the projection formula', async () => {
    // The face carries the projection as an inferred position (the class
    // declare rides `__computed`), so quickinfo prints the resolved type;
    // a written node would echo the `StashData<...>` machinery verbatim.
    await inWorkspace({
      'index.rip': "console.log 'serve'\n",
      'package.json': '{}',
      'app/stash.rip': "export type Todo =\n  id: number\n  label: string\n\ntodos: Todo[] = []\n\nexport stash =\n  todos: todos\n",
    }, async (api) => {
      await api.open('app/routes/page.rip', "export Page = component\n  todos <~ @stash.todos\n  q ~= @router.query.q ?? ''\n  shout ~= q.toUpperCase()\n  n = Number.parseInt('4')\n  render null\n");
      let h;
      for (let i = 0; i < 20; i++) {
        h = await api.hover('app/routes/page.rip', 1, 3);
        if (h?.contents?.value?.includes('Todo[]')) break;
        await api.sleep(200);
      }
      expect(h.contents.value).toContain('Todo[]');
      expect(h.contents.value).not.toContain('StashData');
      // The typed router ambience rides the same discovery: a bare
      // computed over `@router.query` infers string, no annotation.
      const rq = await api.hover('app/routes/page.rip', 2, 2);
      expect(rq.contents.value).toContain('q: string');
      // The class road declares the ambience too, so the `@router`
      // REFERENCE (the `_init` copy, where `this` is the class) hovers
      // the runtime's Router instead of error-`any`.
      const rr = await api.hover('app/routes/page.rip', 2, 10);
      expect(rr.contents.value).toContain('Router');
      expect(rr.contents.value).not.toContain('any');
      // The gate's face twin (the read the author wrote, as a ts-only
      // expression) gives every path segment a typed span — the same
      // answers a computed line serves, v3's construction.
      const gd = await api.hover('app/routes/page.rip', 1, 17);
      expect(gd.contents.value).toContain('StashData');
      const gt = await api.hover('app/routes/page.rip', 1, 22);
      expect(gt.contents.value).toContain('todos: Todo[]');
      // An IN-BODY read answers value-first like the declaration — the
      // author wrote a bare name; the container the lowering wrapped it
      // in is a consumer-position answer (RULINGS.md's member-read row).
      const rd = await api.hover('app/routes/page.rip', 3, 11);
      expect(rd.contents.value).toContain('q: string');
      expect(rd.contents.value).not.toContain('readonly value');
      // A PLAIN member with a call initializer infers through the
      // behavior thunk instead of the form table's `any`.
      const pl = await api.hover('app/routes/page.rip', 4, 2);
      expect(pl.contents.value).toContain('n: number');
    });
  }, 30000);

  test('no hover leaks rip internals anywhere in a stash-anchored component', async () => {
    // The standing property: at EVERY position, a hover either answers
    // in the author's vocabulary (framework type NAMES like StashData or
    // Router included) or declines — never a minted `__` name, an
    // import() splice, or lowering scaffold. Swept position by position
    // over a component exercising every member kind and a full render.
    const ROUTE = [
      "export Page = component",
      "  todos <~ @stash.todos",
      "  pick <~ @stash.pick(params.id)",
      "  q ~= @router.query.q ?? ''",
      "  count := 0",
      "  label?: string := undefined",
      "  @variant: string = 'primary'",
      "  first ~= todos[0]",
      "  mounted: -> @router.onNavigate(-> count = 0)",
      "  onError: (err) -> console.error(err)",
      "  bump: (step: number) -> count = count + step",
      "  render",
      "    h1 \"#{q}\"",
      "    ul",
      "      for t in todos",
      "        li key: t.id, t.label",
      "    button @click: (-> bump(1)), \"#{count} #{first.label} #{pick.label}\"",
      "",
    ].join('\n');
    await inWorkspace({
      'index.rip': "console.log 'serve'\n",
      'package.json': '{}',
      'app/stash.rip': "export type Todo =\n  id: number\n  label: string\n\ntodos: Todo[] = []\n\nexport stash =\n  todos: todos\n  pick: (id: string) -> todos[0]\n",
    }, async (api) => {
      await api.open('app/routes/page.rip', ROUTE);
      // Liveness canary: the sweep is meaningless if every hover
      // declines (a dead program answers nothing and leaks nothing) —
      // one known position must answer with a real type first.
      let canary;
      for (let i = 0; i < 30; i++) {
        canary = await api.hover('app/routes/page.rip', 1, 3);
        if (canary?.contents?.value?.includes('Todo[]')) break;
        await api.sleep(200);
      }
      expect(canary.contents.value).toContain('Todo[]');
      // Minted `__` names, import() splices, the `_`-slot index
      // signature, AND the single-underscore render scaffold families —
      // read from the same SCAFFOLD_FAMILIES list the server's guard
      // consumes, so the gate and the guard cannot drift.
      const LEAK = new RegExp(`__[A-Za-z]|import\\s*\\(|\`_\\$\\{string\\}\`|\\b_(?:${SCAFFOLD_FAMILIES})\\d+\\b`);
      const lines = ROUTE.split('\n');
      const leaks = [];
      for (let ln = 0; ln < lines.length; ln++) {
        for (let ch = 0; ch <= lines[ln].length; ch++) {
          const h = await api.hover('app/routes/page.rip', ln, ch).catch(() => null);
          const v = h?.contents?.value;
          if (typeof v === 'string' && LEAK.test(v)) leaks.push(`${ln + 1}:${ch} → ${v.slice(0, 120)}`);
        }
      }
      expect(leaks).toEqual([]);
    });
  }, 120000);
});

describe.skipIf(!tsgoAvailable)('code actions', () => {
  test('the auto-import quickfix maps its edit into the existing Rip import clause', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', 'import { answer } from "./util.rip"\nk = answer\ny = shout\n');
      const missing = api.diagnostics('app.rip').find((d) => d.code === 2304);
      expect(missing).toBeDefined();
      const actions = await api.codeAction('app.rip', missing.range, [missing]);
      const fix = actions.find((a) => /import/i.test(a.title));
      expect(fix).toBeDefined();
      expect(fix.kind).toBe('quickfix');
      expect(fix.title).not.toContain('.rip.ts');
      const edits = fix.edit.changes[api.uriOf('app.rip')];
      expect(edits).toHaveLength(1);
      expect(edits[0].range.start).toEqual({ line: 0, character: 15 }); // inside the clause, after `answer`
      expect(edits[0].newText).toBe(', shout');
    });
  }, 30000);

  // THE SPAN. A quickfix is keyed to its diagnostic's range: tsgo looks for
  // its own diagnostic where it is told to, and answers NOTHING when none
  // sits there. Mapping the request with the lenient source→generated
  // flavor lands on the innermost cover row's start, which turns a
  // four-byte name into the whole statement — so a name inside a call
  // argument list got zero fixes while the identical name alone got one.
  // The exact flavor is the rule translate.js already states for anything
  // that identifies or MUTATES a symbol; a code action mutates.
  test('a name buried in a call argument list still gets its quickfix', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', [
        'import { answer } from "./util.rip"',
        "console.log('n:', answer, Math.max(1, 2), shout, answer + 1)",
        '',
      ].join('\n'));
      const missing = api.diagnostics('app.rip').find((d) => d.code === 2304);
      expect(missing, 'the unresolved name is reported').toBeDefined();
      const actions = await api.codeAction('app.rip', missing.range, [missing]);
      expect(actions.some((a) => /import/i.test(a.title)), 'a fix survives the span mapping').toBe(true);
    });
  }, 30000);

  // EVERY IMPORT SPELLING takes an added name. The face's clause is not
  // always the author's — `import { }` emits as `import {}` (the space is
  // not carried) and a bare `import './x.rip'` grows minted braces nobody
  // wrote — so tsgo rewrites bytes the user has never seen and the verbatim
  // check refuses. Driven before the fix: those two offered ZERO fixes
  // where the other two offered one each.
  //
  // The two that CAN map keep their minimal edit; only the two that cannot
  // widen to a whole-line rewrite. That asymmetry is asserted, because a
  // fix that widened everything would pass this suite while needlessly
  // rewriting lines the user did not ask to have rewritten.
  const SPELLINGS = [
    // A whole-line rewrite replaces the line INCLUDING its newline, so the
    // expected text carries one; a clause-only edit does not.
    ["import { } from './util.rip'", "import { shout } from './util.rip'\n", 'whole line'],
    ["import {} from './util.rip'", '{ shout }', 'clause only'],
    ["import { answer } from './util.rip'", ', shout', 'clause only'],
    // A SIDE-EFFECT import is left ALONE, and the name arrives on a new line —
    // TypeScript's own answer, and the reason the grammar had to distinguish
    // the two forms. While `import './x.rip'` and `import {} from './x.rip'`
    // shared a parse tree, the emitter wrote the empty-clause form for both,
    // tsgo saw a named list waiting to be filled, and the fix rewrote a
    // statement the author never asked to change.
    ["import './util.rip'", "import { shout } from './util.rip'\n", 'new line'],
  ];
  for (const [spelling, expected, shape] of SPELLINGS) {
    test(`\`${spelling}\` takes an added name (${shape})`, async () => {
      await inWorkspace({ 'util.rip': UTIL }, async (api) => {
        await api.open('app.rip', `${spelling}\nk = shout('x')\n`);
        const missing = api.diagnostics('app.rip').find((d) => d.code === 2304);
        expect(missing, 'the unresolved name is reported').toBeDefined();
        const actions = await api.codeAction('app.rip', missing.range, [missing]);
        const fix = actions.find((a) => /^Update import|^Add import/i.test(a.title));
        expect(fix, 'the add-to-existing-import fix is offered').toBeDefined();
        const edits = fix.edit.changes[api.uriOf('app.rip')];
        expect(edits).toHaveLength(1);
        // WHICH LINE the edit touches is the claim. The import under test is
        // line 0; a clause the name can join is edited there, and a
        // side-effect import must not be — its name arrives below it,
        // leaving the statement the author wrote intact. Asserting only the
        // text would pass either way, since both spell the same line.
        if (shape === 'new line') {
          expect(edits[0].range.start.line, 'the side-effect import is untouched').toBeGreaterThan(0);
        } else {
          expect(edits[0].range.start.line, 'the existing clause is edited in place').toBe(0);
        }
        // Rip spelling throughout: the author's single quotes survive, and
        // no semicolon is minted. `.rip.ts` is the mirror's extension and
        // must never reach the buffer.
        expect(edits[0].newText).toBe(expected);
        expect(edits[0].newText).not.toContain('.rip.ts');
        expect(edits[0].newText).not.toContain(';');
        expect(edits[0].newText).not.toContain('"');
      });
    }, 30000);
  }
});
