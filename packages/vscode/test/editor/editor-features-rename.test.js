// The editor's RENAME driven over real LSP stdio against the real
// server + tsgo: the coincident-span dedup pinned (a hoisted declaration's
// let-line and assignment are one source span → ONE edit), cross-file
// edits reach unopened files, out-of-closure files stay untouched;
// prepareRename refuses unmappable positions; a rename touching a broken
// buffer refuses whole (never partial-applies). Plus the render loop
// variables — rename, references and hover over a loop binding.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/editor-features.mjs.
import { test, expect, describe } from 'bun:test';
import { tsgoAvailable, inWorkspace, THREE_FILES, APP_AB } from './support/editor-features.mjs';

describe.skipIf(!tsgoAvailable)('rename', () => {
  test('the coincident-span dedup: a hoisted declaration renames as ONE edit, never coincident duplicates', async () => {
    await inWorkspace({}, async (api) => {
      // `count: number = 42` emits a typed hoist line AND an assignment
      // — two generated manifestations of the IDENTICAL source span.
      await api.open('app.rip', 'count: number = 42\nz = count\n');
      const edit = await api.rename('app.rip', 0, 2, 'total');
      const edits = edit.changes[api.uriOf('app.rip')];
      // Exactly two: the declaration (deduped from its two generated
      // manifestations) and the read.
      expect(edits).toHaveLength(2);
      expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } });
      expect(edits[1].range).toEqual({ start: { line: 1, character: 4 }, end: { line: 1, character: 9 } });
      for (const e of edits) expect(e.newText).toBe('total');
    });
  }, 30000);

  test('renaming an imported name at its USE aliases the import locally (tsgo semantics, mapped onto Rip)', async () => {
    await inWorkspace(THREE_FILES, async (api) => {
      await api.open('a.rip', THREE_FILES['a.rip']);
      const edit = await api.rename('a.rip', 1, 15, 'total'); // answer at its use
      // TypeScript renames the LOCAL binding: the import clause gains
      // the alias form (legal Rip) and the use site renames; the
      // exporting file is untouched from a use site.
      expect(Object.keys(edit.changes)).toEqual([api.uriOf('a.rip')]);
      const aEdits = edit.changes[api.uriOf('a.rip')];
      expect(aEdits.some((e) => e.newText === 'answer as total' && e.range.start.line === 0)).toBe(true);
      expect(aEdits.some((e) => e.newText === 'total' && e.range.start.line === 1)).toBe(true);
    });
  }, 30000);

  test('renaming at the DECLARATION edits unopened importers; out-of-closure files stay untouched', async () => {
    await inWorkspace({
      ...THREE_FILES,
      // c.rip imports `answer` too, but nothing open reaches it — it is
      // OUTSIDE the program, so the active-program scope keeps the rename away from it.
      'c.rip': 'import { answer } from "./util.rip"\nexport cc = answer + 3\n',
    }, async (api) => {
      await api.open('app.rip', APP_AB); // pulls a, b, util into the program
      await api.open('util.rip', THREE_FILES['util.rip']);
      const edit = await api.rename('util.rip', 0, 10, 'total'); // answer at its declaration
      const uris = Object.keys(edit.changes).sort();
      expect(uris).toEqual([api.uriOf('a.rip'), api.uriOf('b.rip'), api.uriOf('util.rip')].sort());

      // The declaration edit, exact.
      const utilEdits = edit.changes[api.uriOf('util.rip')];
      expect(utilEdits).toHaveLength(1);
      expect(utilEdits[0].range).toEqual({ start: { line: 0, character: 7 }, end: { line: 0, character: 13 } });

      // The UNOPENED importers: the clause name and the use site, both
      // landing exactly on Rip source, no overlapping edits.
      for (const rel of ['a.rip', 'b.rip']) {
        const edits = edit.changes[api.uriOf(rel)];
        expect(edits).toHaveLength(2);
        expect(edits.some((e) => e.range.start.line === 0 && e.range.start.character === 9 && e.range.end.character === 15)).toBe(true);
        expect(edits.some((e) => e.range.start.line === 1 && e.range.start.character === 12 && e.range.end.character === 18)).toBe(true);
        for (const e of edits) expect(e.newText).toBe('total');
      }
    });
  }, 30000);

  test('prepareRename serves on identifiers and refuses unmappable positions', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', '# a comment about total\ntotal = 41\n');
      const onName = await api.prepareRename('app.rip', 1, 2);
      expect(onName).not.toBeNull();
      expect(onName.placeholder ?? '').toBe('total');
      expect(onName.range.start.line).toBe(1);

      // Comment bytes emit nothing — no verbatim generated twin, so the
      // position refuses (the exact flavor).
      expect(await api.prepareRename('app.rip', 0, 20)).toBeNull();
    });
  }, 30000);

  test('a declaration the face COPIES renames whole: a schema derivation, the names its companion spells, and a component prop\'s alias', async () => {
    // Every generated copy of a declared name is a copy the rename must
    // reach; ONE copy the face spells on its own refuses the whole
    // rename. The forms here are the ones a real app spells and the
    // fixture corpus does not: a derived schema's own alias head
    // (`UserPublic = User.pick(…)`), another schema named inside a
    // companion's body (`items: OrderItem[]`), the descriptor's own
    // registered `name:`, and a type alias annotating a component prop
    // (the constructor and `_init` both restate the props type).
    await inWorkspace({}, async (api) => {
      await api.open('models.rip', [
        'export Item = schema :shape',
        '  sku! string',
        '',
        'export Order = schema :model',
        '  total! integer, 0..',
        '  items! Item[]',
        '',
        'export OrderBrief = Order.pick(\'id\', \'total\')',
        '',
      ].join('\n'));

      // The derivation's own head — its span opens on its own name.
      // prepareRename is what the EDITOR gates on: it needs a verbatim
      // twin at the position, so an unmarked head shows "The element
      // can't be renamed" and rename is never sent.
      expect(await api.prepareRename('models.rip', 7, 8)).not.toBeNull();
      const brief = await api.rename('models.rip', 7, 8, 'OrderDigest');
      expect(Object.keys(brief.changes ?? {}).length).toBeGreaterThan(0);

      // A schema the companion body names, and the descriptor's `name:`.
      const item = await api.rename('models.rip', 0, 8, 'Sku');
      expect(Object.keys(item.changes ?? {}).length).toBeGreaterThan(0);

      const order = await api.rename('models.rip', 3, 8, 'Purchase');
      expect(Object.keys(order.changes ?? {}).length).toBeGreaterThan(0);
    });

    await inWorkspace({}, async (api) => {
      await api.open('button.rip', [
        "type Variant = 'primary' | 'secondary'",
        '',
        'export Button = component',
        "  @variant?: Variant := 'primary'",
        '  render',
        '    button variant',
        '',
      ].join('\n'));
      const edit = await api.rename('button.rip', 0, 5, 'Kind');
      const edits = Object.values(edit.changes ?? {}).flat();
      expect(edits.length).toBeGreaterThan(0);
      // Every edit names the alias itself, never a neighbour.
      for (const e of edits) expect(e.newText).toBe('Kind');
    });

    // An IMPORTED alias annotating a prop: its copies mark a USE, so the
    // rename agrees whichever end it starts from — the specifier's own
    // bytes take the alias form when the LOCAL binding is renamed, and a
    // copy marked there would demand two texts over one span.
    await inWorkspace({ 'tone.rip': "export type Tone = 'info' | 'warn'\n" }, async (api) => {
      await api.open('tone.rip', "export type Tone = 'info' | 'warn'\n");
      await api.open('tag.rip', [
        "import { Tone } from './tone.rip'",
        '',
        'export Tag = component',
        "  @tone?: Tone := 'info'",
        '  render',
        '    span tone',
        '',
      ].join('\n'));
      const atUse = await api.rename('tag.rip', 0, 9, 'Shade'); // the import specifier
      expect(Object.values(atUse.changes ?? {}).flat().length).toBeGreaterThan(0);
      const atDecl = await api.rename('tone.rip', 0, 12, 'Hue');
      expect(Object.keys(atDecl.changes ?? {}).length).toBe(2); // both files
    });
  }, 30000);

  test('a rename edit inside a face ECHO is dropped, not refused — the real copy carries the source', async () => {
    // A component's behavior object restates its computed bodies as a
    // TS-only echo. tsgo returns an edit in that restatement too; the
    // real copy's edit already carries the author's bytes, so the echo's
    // is redundant. Refusing it would lose a rename that is entirely
    // well-formed in the source.
    await inWorkspace({ 'lib.rip': 'export const scale = (n) => n * 2\n' }, async (api) => {
      await api.open('lib.rip', 'export scale = (n) -> n * 2\n');
      await api.open('app.rip', [
        'import { scale } from "./lib.rip"',
        '',
        'export Panel = component',
        '  count := 3',
        '  doubled ~= scale(count)',
        '  render',
        '    p doubled',
        '',
      ].join('\n'));
      const edit = await api.rename('lib.rip', 0, 7, 'twice');
      const edits = Object.values(edit.changes ?? {}).flat();
      expect(edits.length).toBeGreaterThan(0);
      for (const e of edits) expect(e.newText).toBe('twice');
    });
  }, 30000);

  test('a render loop renames whole: the iterable\'s names across plain, keyed, call, and nested loops, and the loop variable from any of its uses', async () => {
    // Every loop row's face type restates its iterable — a `typeof` over
    // a path, or a thunk over a call — and a restatement is no place a
    // rename may land or be refused over. The loop variable is a separate
    // TypeScript symbol in its keyed callback and in each nested block,
    // and renames as the one name the author wrote wherever it starts.
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', [
        "ROWS = [{ id: 1, tags: ['p'] }]",          // 0
        'export Panel = component',                 // 1
        '  render',                                 // 2
        '    ul',                                   // 3
        '      for row in ROWS',                    // 4
        '        li key: row.id, row.id',           // 5
        '      for row in ROWS.slice(0)',           // 6
        '        li row.id',                        // 7
        '      for row in ROWS',                    // 8
        '        for tag in row.tags.map((t) -> t)', // 9
        '          li tag',                         // 10
        '      for row in ROWS',                    // 11
        '        if row.id',                        // 12
        '          li row.id',                      // 13
        '',
      ].join('\n'));
      const spans = async (line, character) => {
        const edit = await api.rename('app.rip', line, character, 'renamed');
        const edits = edit.changes[api.uriOf('app.rip')];
        for (const e of edits) expect(e.newText).toBe('renamed');
        return edits.map((e) => [e.range.start.line, e.range.start.character, e.range.end.character])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      };
      expect(await spans(0, 1)).toEqual([[0, 0, 4], [4, 17, 21], [6, 17, 21], [8, 17, 21], [11, 17, 21]]);
      const keyed = [[4, 10, 13], [5, 16, 19], [5, 24, 27]];
      for (const [line, character] of [[4, 10], [5, 16], [5, 24]]) expect(await spans(line, character)).toEqual(keyed);
      expect(await spans(6, 10)).toEqual([[6, 10, 13], [7, 11, 14]]);
      expect(await spans(8, 10)).toEqual([[8, 10, 13], [9, 19, 22]]);
      const branched = [[11, 10, 13], [12, 11, 14], [13, 13, 16]];
      for (const [line, character] of [[11, 10], [12, 11], [13, 13]]) expect(await spans(line, character)).toEqual(branched);
    });
  }, 60000);

  test('the cursor at a name\'s END boundary renames it — double-click then F2 leaves the caret exactly there', async () => {
    // Mapping rows are end-exclusive, so the position one past a name's
    // last character sits in no row. Every editor gesture that selects a
    // word leaves the caret there, and a symbol request must resolve
    // through the identifier that ENDS at the position, not decline.
    await inWorkspace({}, async (api) => {
      const SRC = 'export total = 41\nnext = total + 1\n';
      await api.open('app.rip', SRC);
      const end = 'export total'.length; // one past the final 'l'
      expect(await api.prepareRename('app.rip', 0, end)).not.toBeNull();
      const edit = await api.rename('app.rip', 0, end, 'sum');
      const edits = Object.values(edit.changes ?? {}).flat();
      expect(edits.length).toBe(2);
      for (const e of edits) expect(e.newText).toBe('sum');
      // The relaxation is about end-exclusivity only: a comment's word
      // has no verbatim twin and still declines.
      await api.change('app.rip', `# a note here\n${SRC}`);
      expect(await api.prepareRename('app.rip', 0, '# a note'.length)).toBeNull();
    });
  }, 30000);

  test('a path with uri-reserved characters keeps its own answers: a route group and a dynamic route', async () => {
    // tsgo percent-encodes what a uri reserves, so a result in
    // `(app)/page.rip` returns as `%28app%29`. Attribution compares
    // PATHS, not uri strings — a string comparison misses exactly the
    // shapes a rip app routes with, and the buffer loses every answer
    // about itself: its own references vanish from its own list.
    await inWorkspace({
      'lib.rip': 'export shared = 1\n',
    }, async (api) => {
      await api.open('lib.rip', 'export shared = 1\n');
      await api.open('app/routes/(app)/page.rip', 'import { shared } from "../../../lib.rip"\ng = shared + 1\nh = shared + 2\n');
      await api.open('app/routes/[id].rip', 'import { shared } from "../../lib.rip"\nk = shared + 3\n');

      for (const rel of ['app/routes/(app)/page.rip', 'app/routes/[id].rip']) {
        const refs = await api.references(rel, 0, 9); // the import specifier
        const own = (refs ?? []).filter((l) => decodeURIComponent(l.uri).endsWith(rel));
        expect(own.length).toBeGreaterThan(0);
      }
      // The plain path is the control — it never depended on the fix.
      const plain = await api.references('lib.rip', 0, 7);
      expect((plain ?? []).length).toBeGreaterThan(0);
    });
  }, 30000);

  test('a rename in a broken buffer refuses whole with a clear message (fail-safe)', async () => {
    await inWorkspace({}, async (api) => {
      const GOOD = 'total = 41\nnext = total + 1\n';
      await api.open('app.rip', GOOD);
      await api.change('app.rip', GOOD + 'oops = (\n'); // parse breaks; lastGood stays
      expect(api.diagnostics('app.rip')[0].source).toBe('rip');
      expect(api.rename('app.rip', 0, 2, 'sum')).rejects.toThrow(/rename refused.*does not compile/);
    });
  }, 30000);

  test('a rename TOUCHING a broken buffer refuses whole — never a partial apply (fail-safe)', async () => {
    await inWorkspace({ 'util.rip': 'export answer = 42\n' }, async (api) => {
      const IMPORTER = 'import { answer } from "./util.rip"\nk = answer * 2\n';
      await api.open('util.rip', 'export answer = 42\n');
      await api.open('app.rip', IMPORTER);
      // Break the IMPORTER's buffer; its lastGood overlay keeps serving.
      await api.change('app.rip', IMPORTER + 'oops = (\n');
      expect(api.diagnostics('app.rip')[0].source).toBe('rip');
      // Rename at the DECLARATION (util is healthy) touches the broken
      // importer's edits too: the whole rename refuses, naming the
      // broken file — no file receives a partial application.
      expect(api.rename('util.rip', 0, 10, 'total')).rejects.toThrow(/rename refused.*app\.rip/);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('render loop variables', () => {
  test('references answer for the loop variable from any of its uses: a keyed callback and a nested block', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', [
        'ROWS = [{ id: 1 }]',           // 0
        'export Panel = component',     // 1
        '  render',                     // 2
        '    ul',                       // 3
        '      for row in ROWS',        // 4
        '        li key: row.id, row.id', // 5
        '      for item in ROWS',       // 6
        '        if item.id',           // 7
        '          li item.id',         // 8
        '',
      ].join('\n'));
      const spans = async (line, character, includeDeclaration) => (await api.references('app.rip', line, character, includeDeclaration))
        .map((l) => [l.range.start.line, l.range.start.character, l.range.end.character])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const keyed = [[4, 10, 13], [5, 16, 19], [5, 24, 27]];
      for (const [line, character] of [[4, 10], [5, 16], [5, 24]]) expect(await spans(line, character)).toEqual(keyed);
      expect(await spans(4, 10, false)).toEqual(keyed.slice(1));
      const branched = [[6, 10, 14], [7, 11, 15], [8, 13, 17]];
      for (const [line, character] of [[6, 10], [7, 11], [8, 13]]) expect(await spans(line, character)).toEqual(branched);
    });
  }, 60000);

  test('names the lowering spells into several places still answer exactly their own references and rename edits', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', [
        'export Field = component',                          // 0
        '  count := 0',                                      // 1
        "  value := ''",                                     // 2
        '  doubled ~= count * 2',                            // 3
        '  render',                                          // 4
        '    div',                                           // 5
        '      input value <=> value',                       // 6
        '      button @click: (-> count += 1), doubled',     // 7
        'total = 1',                                         // 8
        'total = total + 1',                                 // 9
        '',
      ].join('\n'));
      const order = (a, b) => a[0] - b[0] || a[1] - b[1];
      const refs = async (line, character) => (await api.references('app.rip', line, character))
        .map((l) => [l.range.start.line, l.range.start.character, l.range.end.character]).sort(order);
      const renames = async (line, character) => (await api.rename('app.rip', line, character, 'renamed')).changes[api.uriOf('app.rip')]
        .map((e) => [e.range.start.line, e.range.start.character, e.range.end.character]).sort(order);
      const names = {
        count: { at: [[1, 2], [7, 26]], spans: [[1, 2, 7], [3, 13, 18], [7, 25, 30]] },
        value: { at: [[2, 2], [6, 22]], spans: [[2, 2, 7], [6, 22, 27]] },
        doubled: { at: [[3, 2], [7, 39]], spans: [[3, 2, 9], [7, 38, 45]] },
        total: { at: [[8, 0], [9, 8]], spans: [[8, 0, 5], [9, 0, 5], [9, 8, 13]] },
      };
      for (const { at, spans } of Object.values(names)) {
        for (const [line, character] of at) {
          expect(await refs(line, character)).toEqual(spans);
          expect(await renames(line, character)).toEqual(spans);
        }
      }
    });
  }, 60000);

  test('the unused fade marks a loop variable the source never reads, never one a nested block merely receives', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', [
        'ROWS = [{ id: 1, tags: [\'p\'] }]', // 0
        "OTHER = ['x']",                  // 1
        'export Panel = component',       // 2
        '  render',                       // 3
        '    ul',                         // 4
        '      for row in ROWS',          // 5
        '        li row.id',              // 6
        '        for x in OTHER',         // 7
        '          li x',                 // 8
        '      for row in ROWS',          // 9
        '        picked = row.tags',      // 10
        '        for early in picked',    // 11
        '          li early',             // 12
        '      for row, k in ROWS',       // 13
        '        li key: k, row.id',      // 14
        '      for unused in ROWS',       // 15
        "        li 'flat'",              // 16
        '      for idle in ROWS',         // 17
        '        for y in OTHER',         // 18
        '          li y',                 // 19
        '      for shadowed in ROWS',     // 20
        "        button @click: ((shadowed) -> console.log(shadowed)), 'go'", // 21
        '        for z in OTHER',         // 22
        '          li z',                 // 23
        '',
      ].join('\n'));
      const faded = api.diagnostics('app.rip')
        .filter((d) => d.tags?.includes(1))
        .map((d) => [d.range.start.line, d.range.start.character, d.range.end.character])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect(faded).toEqual([[15, 10, 16], [17, 10, 14], [20, 10, 18]]);
    });
  }, 60000);
});
