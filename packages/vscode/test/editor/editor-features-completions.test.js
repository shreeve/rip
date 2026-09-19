// The editor's COMPLETIONS driven over real LSP stdio against the real
// server + tsgo, per-feature acceptance plus the recorded negatives:
// member items land with resolve-lazy detail; scaffolding labels (the __
// runtime, _ref temps) never surface; auto-import edits arrive on resolve
// as idiomatic Rip (no semicolon, .rip specifier) in BOTH spellings — a
// new import line and a merge into an existing clause; staleness
// respected (a broken buffer's changed region answers null, aligned
// positions serve).
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/editor-features.mjs.
import { test, expect, describe } from 'bun:test';
import path from 'node:path';
import { tsgoAvailable, inWorkspace, CompletionItemKind, UTIL } from './support/editor-features.mjs';

describe.skipIf(!tsgoAvailable)('completions', () => {
  test('member completion serves with resolve-lazy detail; scaffolding labels never surface', async () => {
    await inWorkspace({}, async (api) => {
      // A reactive declaration inlines the __ runtime into the face —
      // its exports (and the _ref temp family) are compiler territory
      // and must never appear as completion items.
      await api.open('app.rip', 'count := 0\nmsg = "hi"\nk = msg.sub\n');
      const completion = await api.completion('app.rip', 2, 11); // msg.sub‸
      expect(completion.items.length).toBeGreaterThan(0);
      const substring = completion.items.find((i) => i.label === 'substring');
      expect(substring).toBeDefined();
      expect(substring.detail).toBeUndefined(); // detail is resolve-lazy
      const resolved = await api.resolveItem(substring);
      expect(resolved.detail).toContain('substring');

      expect(completion.items.some((i) => i.label.startsWith('__'))).toBe(false);
      expect(completion.items.some((i) => /^_ref\d*$/.test(i.label))).toBe(false);
    });
  }, 30000);

  test('auto-import inserts a NEW idiomatic Rip import line at the top (no semicolon, .rip specifier)', async () => {
    // Auto-import candidates come from the ACTIVE PROGRAM (the demand-driven
    // corollary): util.rip is in the program because a.rip imports it —
    // app.rip itself has no import line yet, which is the point.
    await inWorkspace({
      'util.rip': UTIL,
      'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
    }, async (api) => {
      await api.open('app.rip', 'import { aa } from "./a.rip"\ny = shout\n');
      const completion = await api.completion('app.rip', 1, 9); // shout‸
      const candidate = completion.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate).toBeDefined();
      expect(candidate.labelDetails.description).toBe('./util.rip'); // never the mirror's .rip.ts
      const resolved = await api.resolveItem(candidate);
      expect(resolved.additionalTextEdits).toHaveLength(1);
      const edit = resolved.additionalTextEdits[0];
      // A whole new import line, after the existing import block — the
      // between-constructs insertion anchor.
      expect(edit.range.start).toEqual({ line: 1, character: 0 });
      expect(edit.range.end).toEqual({ line: 1, character: 0 });
      expect(edit.newText).toMatch(/^import \{ shout \} from ['"]\.\/util\.rip['"]\n$/);
      expect(edit.newText).not.toContain(';');
      expect(edit.newText).not.toContain('.rip.ts');
    });
  }, 30000);

  test('auto-import MERGES into an existing import clause at the exact brace position', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      const src = 'import { answer } from "./util.rip"\ny = shout\n';
      await api.open('app.rip', src);
      const completion = await api.completion('app.rip', 1, 9);
      const candidate = completion.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate).toBeDefined();
      const resolved = await api.resolveItem(candidate);
      expect(resolved.additionalTextEdits).toHaveLength(1);
      const edit = resolved.additionalTextEdits[0];
      // Inside the source import clause, right after `answer` — the
      // verbatim-verified cover-row insertion.
      expect(edit.range.start).toEqual({ line: 0, character: 15 });
      expect(edit.range.end).toEqual({ line: 0, character: 15 });
      expect(edit.newText).toBe(', shout');
    });
  }, 30000);

  test('auto-import never demotes a file-level directive: `# @ts-nocheck` stays first; shebangs pinned alongside', async () => {
    await inWorkspace({
      'util.rip': UTIL,
      'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
    }, async (api) => {
      // The directive suppresses everything (the deliberate violation
      // AND the unresolved `shout` draw nothing).
      const SRC = '# @ts-nocheck\ncount: number = 42\ncount = "nope"\ny = shout\n';
      await api.open('helper.rip', 'import { aa } from "./a.rip"\nk = aa\n'); // pulls util into the program
      await api.open('app.rip', SRC);
      expect(api.diagnostics('app.rip')).toEqual([]);

      const completion = await api.completion('app.rip', 3, 9); // shout‸
      const candidate = completion.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate).toBeDefined();
      const resolved = await api.resolveItem(candidate);
      expect(resolved.additionalTextEdits).toHaveLength(1);
      const edit = resolved.additionalTextEdits[0];
      // AFTER the directive line, never at (0,0) — inserting above
      // `# @ts-nocheck` would demote it and resurrect every suppressed
      // error.
      expect(edit.range.start).toEqual({ line: 1, character: 0 });
      expect(edit.range.end).toEqual({ line: 1, character: 0 });

      // Apply the edit: the directive stays first and still governs —
      // the violation stays suppressed with the import in place.
      const lines = SRC.split('\n');
      lines.splice(1, 0, edit.newText.replace(/\n+$/, ''));
      await api.change('app.rip', lines.join('\n'));
      expect(api.diagnostics('app.rip')).toEqual([]);

      // The shebang twin: no directive row, but the insertion anchor
      // must land after the shebang line the same way.
      const SHEBANG = '#!/usr/bin/env bun\ny = shout\n';
      await api.open('run.rip', SHEBANG);
      const completion2 = await api.completion('run.rip', 1, 9);
      const candidate2 = completion2.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate2).toBeDefined();
      const resolved2 = await api.resolveItem(candidate2);
      expect(resolved2.additionalTextEdits[0].range.start).toEqual({ line: 1, character: 0 });
    });
  }, 30000);

  test('auto-import never splits a next-line-attached directive: the insertion hoists ABOVE `# @ts-expect-error` (the attached-directive neighbor rule)', async () => {
    await inWorkspace({
      'util.rip': UTIL,
      'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
    }, async (api) => {
      // The file's FIRST LINE is a next-line-attached directive: it
      // governs the deliberate violation directly beneath. Inserting a
      // new import BETWEEN them would split the pair — TS2578 and the
      // suppressed TS2322 both resurface. The fix inserts ABOVE the
      // directive (the opposite of the nocheck push).
      const SRC = '# @ts-expect-error\ncount: number = "nope"\ny = shout\nconsole.log count, y\n';
      await api.open('helper.rip', 'import { aa } from "./a.rip"\nk = aa\n'); // pulls util into the program
      await api.open('app.rip', SRC);
      // Only the unresolved `shout` reports; the violation is suppressed.
      expect(api.diagnostics('app.rip').map((d) => d.code)).toEqual([2304]);

      const completion = await api.completion('app.rip', 2, 9); // shout‸
      const candidate = completion.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate).toBeDefined();
      const resolved = await api.resolveItem(candidate);
      expect(resolved.additionalTextEdits).toHaveLength(1);
      const edit = resolved.additionalTextEdits[0];
      // ABOVE the directive line — never between it and its statement.
      expect(edit.range.start).toEqual({ line: 0, character: 0 });
      expect(edit.range.end).toEqual({ line: 0, character: 0 });

      // Apply it: the directive stays attached to its governed line —
      // the violation stays suppressed, no TS2578, shout resolves.
      // (The split would be visible as errors: 2578 and 2322.)
      await api.change('app.rip', edit.newText + SRC);
      expect(api.diagnostics('app.rip').filter((d) => d.severity === 1)).toEqual([]);
    });
  }, 30000);

  test('the HOIST-FREE flavor: an attached directive whose face row opens the face still hoists (the #67 review round)', async () => {
    await inWorkspace({
      'util.rip': UTIL,
      'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
    }, async (api) => {
      // No declarations anywhere: nothing hoists, so the attached
      // directive's row sits at GENERATED OFFSET 0 — the shape a
      // nocheck test keyed on offset would wrongly exempt. tsgo
      // anchors the import insertion AFTER a leading comment line,
      // exactly between the pair.
      const SRC = '# @ts-expect-error\nconsole.log("x".missing)\nconsole.log(shout("hi"))\n';
      await api.open('helper.rip', 'import { aa } from "./a.rip"\nk = aa\n'); // pulls util into the program
      await api.open('app.rip', SRC);
      expect(api.diagnostics('app.rip').map((d) => d.code)).toEqual([2304]); // only the unresolved shout

      const completion = await api.completion('app.rip', 2, 17); // shout‸
      const candidate = completion.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate).toBeDefined();
      const resolved = await api.resolveItem(candidate);
      const edit = resolved.additionalTextEdits[0];
      expect(edit.range.start).toEqual({ line: 0, character: 0 });

      await api.change('app.rip', edit.newText + SRC);
      expect(api.diagnostics('app.rip')).toEqual([]);
    });
  }, 30000);

  test('auto-import never names a module under the mirror\'s __external__ tree: the app runtime\'s internals stay unoffered, its entry stays offered', async () => {
    // A route's gate pulls the app runtime into the program; tsgo then
    // offers every exported type it can reach as an auto-import, the
    // runtime's internal files included — under the mirror's own path.
    await inWorkspace({
      'index.rip': "console.log 'serve'\n",
      'package.json': '{}',
      'app/stash.rip': "export type Todo =\n  id: number\n  label: string\n\ntodos: Todo[] = []\n\nexport stash =\n  todos: todos\n",
    }, async (api) => {
      await api.open('app/routes/page.rip', "export Page = component\n  todos <~ @stash.todos\n  q ~= @router.query.q ?? ''\n  shout ~= q.toUpperCase()\n  n = Number.parseInt('4')\n  render null\n");
      await api.open('app/stash.rip', "export type Todo =\n  id: number\n  label: string\n\ntodos: Todo[] = []\n\nexport stash =\n  todos: todos\n");
      let items = [];
      for (let i = 0; i < 20; i++) {
        const c = await api.completion('app/stash.rip', 1, 13); // id: number‸
        items = Array.isArray(c) ? c : c?.items ?? [];
        if (items.some((it) => it.labelDetails?.description === 'rip/app')) break;
        await api.sleep(200);
      }
      expect(items.some((it) => it.labelDetails?.description === 'rip/app')).toBe(true);
      const leaked = items.filter((it) => /__external__/.test(`${it.labelDetails?.description ?? ''} ${it.detail ?? ''}`));
      expect(leaked.map((it) => it.label)).toEqual([]);
    });
  }, 30000);

  test('the plain-comment control: a first-line ordinary comment does not hoist the insertion anchor', async () => {
    await inWorkspace({
      'util.rip': UTIL,
      'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
    }, async (api) => {
      const SRC = '# just a note about shout\ny = shout\n';
      await api.open('helper.rip', 'import { aa } from "./a.rip"\nk = aa\n');
      await api.open('app.rip', SRC);
      const completion = await api.completion('app.rip', 1, 9); // shout‸
      const candidate = completion.items.find((i) => i.label === 'shout' && i.labelDetails?.description);
      expect(candidate).toBeDefined();
      const resolved = await api.resolveItem(candidate);
      expect(resolved.additionalTextEdits).toHaveLength(1);
      // Comments do not emit and are not directives: the standing
      // between-constructs anchor (below the comment) holds, and the
      // applied edit resolves shout with no new diagnostics.
      expect(resolved.additionalTextEdits[0].range.start).toEqual({ line: 1, character: 0 });
      const lines = SRC.split('\n');
      lines.splice(1, 0, resolved.additionalTextEdits[0].newText.replace(/\n+$/, ''));
      await api.change('app.rip', lines.join('\n'));
      expect(api.diagnostics('app.rip').filter((d) => d.severity === 1)).toEqual([]);
    });
  }, 30000);

  test('staleness: a broken buffer answers null in the changed region, serves at aligned positions', async () => {
    await inWorkspace({}, async (api) => {
      const GOOD = 'msg = "hi"\nk = msg.sub\n';
      await api.open('app.rip', GOOD);
      // Break the compile by INSERTING a line at file start. The breakage
      // must be one the TOLERANT face compile cannot recover — a
      // newline-broken string can never be completed by more input — or
      // the buffer compiles, the face is CURRENT, and the staleness
      // protocol this test guards never engages (an unclosed bracket no
      // longer qualifies: tolerance closes it).
      await api.change('app.rip', 'oops = "broken\n' + GOOD);
      expect(api.diagnostics('app.rip')[0].source).toBe('rip');

      // The inserted (changed) line has no aligned twin: null.
      expect(await api.completion('app.rip', 0, 6)).toBeNull();
      // msg.sub moved down one line; its position aligns and serves.
      const completion = await api.completion('app.rip', 2, 11);
      expect(completion.items.some((i) => i.label === 'substring')).toBe(true);
    });
  }, 30000);

  // An object-literal key completes from the CONTEXTUAL type, whatever
  // context the ask carries. What a declined ask costs here is the
  // whole session, not one answer: the editor opens a suggest session
  // on a trigger character, and one that opens with nothing from this
  // server lives on the editor's own word matches for the rest of the
  // word, every later keystroke refiltering it rather than asking
  // again. The space before an option name is exactly that moment. So
  // `retry` reaching the list is not the contract — reaching it as a
  // PROPERTY, beside its siblings and with no identifier of the
  // surrounding scope for company, is.
  test('an object-literal key completes from the contextual type whatever context the ask carries', async () => {
    const DEP = [
      // Module-private, never exported: no completion in a consumer can
      // legally name these, so their presence would prove an identifier
      // scrape rather than a member request.
      "RETRY_METHODS =! ['GET', 'PUT']",
      'RETRY_LIMIT   =! 2',
      '',
      'type Options =',
      '  prefixUrl?: string',
      '  retry?: number | false | { limit?: number }',
      '  referrer?: string',
      '  referrerPolicy?: string',
      '  redirect?: string',
      '',
      'export def create(options: Options): string',
      '  return options.prefixUrl ?? RETRY_METHODS[RETRY_LIMIT] ?? \'\'',
      '',
    ].join('\n');
    await inWorkspace({ 'dep.rip': DEP }, async (api) => {
      const HEAD = 'import { create } from \'./dep.rip\'\n\n';
      // ‸ marks the cursor; the whole call line varies, because what
      // the face carries at the key depends on what follows it.
      const SPACE = { triggerKind: 2, triggerCharacter: ' ' };
      const INVOKED = { triggerKind: 1 };
      const asks = [
        // Typing the key: bytes sit at or before the cursor.
        ["export api = create({ prefixUrl: '/api', ‸retry: 0 })", SPACE],
        ["export api = create({ prefixUrl: '/api', ret‸retry: 0 })", INVOKED],
        // Asking at an EMPTY key slot — an explicit invoke, the
        // editor's ctrl+space. The emission drops the trailing comma
        // and the slot with it, so no byte of the face stands where
        // the cursor is; the landing comes from the construct instead.
        ["export api = create({ prefixUrl: '/api', ‸ })", INVOKED],
        ["export api = create({ prefixUrl: '/api',‸ })", INVOKED],
        ["export api = create({ prefixUrl: '/api', ‸})", INVOKED],
        // The same slot in a literal with nothing in it yet.
        ['export api = create({ ‸ })', INVOKED],
      ];

      await api.open('use.rip', HEAD + asks[0][0].replace('‸', '') + '\n');
      for (const [marked, context] of asks) {
        const what = marked.slice('export api = create('.length);
        await api.change('use.rip', HEAD + marked.replace('‸', '') + '\n');
        const result = await api.completion('use.rip', 2, marked.indexOf('‸'), context);
        const items = result?.items ?? result ?? [];
        const labels = items.map((i) => i.label.replace(/\?$/, ''));

        // The option the user is reaching for, as a member of the
        // parameter's type — Field or Property, never a Variable the
        // scope happened to offer.
        const retry = items.find((i) => i.label.replace(/\?$/, '') === 'retry');
        expect(retry, `${what}: 'retry' must be offered`).toBeDefined();
        expect([CompletionItemKind.Field, CompletionItemKind.Property],
          `${what}: 'retry' must arrive as a property of the contextual type`).toContain(retry.kind);

        // Its siblings come with it — one lucky label could be a
        // coincidence, a set of them cannot.
        for (const sibling of ['referrer', 'referrerPolicy', 'redirect']) {
          expect(labels, `${what}: '${sibling}' belongs to the same option set`).toContain(sibling);
        }

        // And nothing from the surrounding scope: a member request
        // answers members only.
        expect(items.filter((i) => i.kind !== CompletionItemKind.Field && i.kind !== CompletionItemKind.Property),
          `${what}: an object-literal key answers members only`).toEqual([]);
        for (const secret of ['RETRY_METHODS', 'RETRY_LIMIT']) {
          expect(labels, `${what}: '${secret}' is module-private to the dependency`).not.toContain(secret);
        }
      }

      // The other side of the same rule: the editor is never invited to
      // open a session on the space at all. The space-triggered ask
      // above is the defensive twin — a trigger this server does not
      // advertise is served on its position, never relayed.
      expect(api.capabilities.completionProvider.triggerCharacters).not.toContain(' ');
    });
  }, 30000);
});
