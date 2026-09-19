// The editor's NAVIGATION surfaces driven over real LSP stdio against the
// real server + tsgo:
//
//   DEFINITION: same-doc, cross-file into an UNOPENED dependency
//     (recompile-for-mappings), and pass-through into a real .ts sibling.
//   SIGNATURE HELP: active parameter indices correct across the bodiless
//     overload rows.
//   SEMANTIC TOKENS: tokens land on Rip spans (annotation tokens map —
//     they have real Rip spans in the face), hoist-duplicated tokens
//     DEDUP to one source token, range requests answer the range.
//   DOCUMENT / WORKSPACE SYMBOLS and DOCUMENT LINKS (the trivia channel).
//   REFERENCES: lists span three files, two of them never opened.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/editor-features.mjs.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsgoAvailable, inWorkspace, decodeTokens, UTIL, THREE_FILES, APP_AB } from './support/editor-features.mjs';

describe.skipIf(!tsgoAvailable)('definition', () => {
  test('same-doc definition lands on the Rip declaration', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', 'total = 41\nnext = total + 1\n');
      const defs = await api.definition('app.rip', 1, 9); // total at its read
      expect(defs).toHaveLength(1);
      expect(defs[0].uri).toBe(api.uriOf('app.rip'));
      expect(defs[0].range).toEqual({
        start: { line: 0, character: 0 }, end: { line: 0, character: 5 },
      });
    });
  }, 30000);

  test('cross-file definition reaches an UNOPENED dependency with an exact Rip range', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', 'import { answer } from "./util.rip"\ndouble = answer * 2\n');
      const defs = await api.definition('app.rip', 1, 12); // answer at its use
      expect(defs).toHaveLength(1);
      expect(defs[0].uri).toBe(api.uriOf('util.rip')); // the SOURCE, not the mirror
      // `export answer = 42` — line 2, `answer` at chars 7..13.
      expect(defs[0].range).toEqual({
        start: { line: 2, character: 7 }, end: { line: 2, character: 13 },
      });
    });
  }, 30000);

  // The stdlib sits OUTSIDE the workspace, so its face mirrors under
  // __external__ — and a definition answer is only as good as the
  // inverse that spells the mirror back as a source. The stdlib's rel
  // IS its source path, so both the symbol and the specifier must land
  // on the real `.rip`; the sanitized (non-file uri) __external__
  // spellings are the ones with no inverse.
  test('definition crosses into the stdlib, naming the real .rip source', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', 'import { check } from "rip/validate"\nk = check("1", "int")\n');

      const defs = await api.definition('app.rip', 1, 6); // check at its use
      expect(defs).toHaveLength(1);
      expect(defs[0].uri.endsWith('/packages/validate/validate.rip')).toBe(true);
      // The SOURCE, not the mirror face it resolved through.
      expect(defs[0].uri).not.toContain('__external__');
      // An exact Rip range: the answer names the declaration's own span.
      const source = fs.readFileSync(fileURLToPath(defs[0].uri), 'utf8').split('\n');
      const { start, end } = defs[0].range;
      expect(start.line).toBe(end.line);
      expect(source[start.line].slice(start.character, end.character)).toBe('check');

      // The specifier answers the same file, at its start.
      const spec = await api.definition('app.rip', 0, 28);
      expect(spec.length).toBeGreaterThanOrEqual(1);
      expect(spec[0].targetUri.endsWith('/packages/validate/validate.rip')).toBe(true);
    });
  }, 30000);

  // Cmd-hover underlines what the definition answer names as its origin.
  // Left to the editor's word pattern, a specifier like './util.rip'
  // underlines one path segment at a time (words break at '/', '-', '.');
  // TypeScript underlines the whole path. The answer is a LocationLink
  // whose originSelectionRange spans the whole string literal, quotes
  // included — what TypeScript underlines.
  test('definition from inside an import specifier names the whole path as its origin', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', 'import { answer } from "./util.rip"\nconsole.log answer\n');
      const defs = await api.definition('app.rip', 0, 28); // inside 'util' — one word of the path
      expect(defs.length).toBeGreaterThanOrEqual(1);
      expect(defs[0].targetUri).toBe(api.uriOf('util.rip'));
      // Quotes included — TypeScript underlines the whole string literal.
      expect(defs[0].originSelectionRange).toEqual({
        start: { line: 0, character: 23 }, end: { line: 0, character: 35 },
      });

      // Both quote spellings answer, through different mappings: the
      // single-quoted specifier is the face's own quote style and maps
      // EXACTLY; the double-quoted one above has no verbatim twin (the
      // face normalizes quotes) and rides the specifier-scoped lenient
      // fallback. Same origin either way.
      await api.change('app.rip', "import { answer } from './util.rip'\nconsole.log answer\n");
      const single = await api.definition('app.rip', 0, 28);
      expect(single.length).toBeGreaterThanOrEqual(1);
      expect(single[0].originSelectionRange).toEqual({
        start: { line: 0, character: 23 }, end: { line: 0, character: 35 },
      });
    });
  }, 30000);

  // A specifier answer names the MODULE — by URI, pinned to file start.
  // tsgo reports the target in face coordinates (an empty range at
  // offset 0, or the whole file); a target whose face opens with a
  // synthetic runtime preamble has no source twin for either shape, so
  // a range-mapped answer drops exactly those targets. UTIL above dodges
  // the trap by accident (no helper references, so its face starts with
  // authored bytes) — this target references `p` and does not. Both
  // target states answer: unopened (mirror inversion) and open (the
  // buffer's own uri).
  test('specifier definition reaches a target whose face opens with the runtime preamble — unopened and open', async () => {
    const HELPERS = "export def loud(s: string): string\n  p(s)\n  s.toUpperCase()\n";
    await inWorkspace({ 'helpers.rip': HELPERS }, async (api) => {
      await api.open('app.rip', "import { loud } from './helpers.rip'\nconsole.log(loud('hi'))\n");
      const fileStart = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
      const cold = await api.definition('app.rip', 0, 25); // inside the specifier
      expect(cold.length).toBeGreaterThanOrEqual(1);
      expect(cold[0].targetUri).toBe(api.uriOf('helpers.rip'));
      expect(cold[0].targetSelectionRange).toEqual(fileStart);

      // The open-target branch: the same ask answers the buffer's uri.
      await api.open('helpers.rip', HELPERS);
      const open = await api.definition('app.rip', 0, 25);
      expect(open.length).toBeGreaterThanOrEqual(1);
      expect(open[0].targetUri).toBe(api.uriOf('helpers.rip'));
      expect(open[0].targetSelectionRange).toEqual(fileStart);

      // Type definition at a specifier takes the same module treatment
      // (tsgo answers the module file whole — a span the range map-back
      // cannot serve).
      const typeDef = await api.typeDefinition('app.rip', 0, 25);
      expect(typeDef.length).toBeGreaterThanOrEqual(1);
      expect(typeDef[0].uri).toBe(api.uriOf('helpers.rip'));
      expect(typeDef[0].range).toEqual(fileStart);
    });
  }, 30000);

  // A specifier answer into a REAL TypeScript file keeps tsgo's own
  // range: an ambient `declare module` answer points mid-file at the
  // declaration, which a file-start pin would erase.
  test('specifier definition into an ambient declare module keeps the declaration position', async () => {
    const TYPES = "// ambient module declarations\ndeclare module 'virt' {\n  export const v: number\n}\n";
    await inWorkspace({ 'types.d.ts': TYPES }, async (api) => {
      await api.open('app.rip', "import { v } from 'virt'\nconsole.log(v)\n");
      const defs = await api.definition('app.rip', 0, 20); // inside 'virt'
      expect(defs.length).toBeGreaterThanOrEqual(1);
      expect(defs[0].targetUri).toBe(api.uriOf('types.d.ts'));
      expect(defs[0].targetSelectionRange.start.line).toBe(1);
    });
  }, 30000);

  // The byte verification runs on EVERY ask, cache hits included — and a
  // mismatch HEALS rather than stranding: the canonical face of a closed
  // file is exactly what a re-materialization writes, so the mirror is
  // rewritten and the ask answers. The two real drift sources are a
  // crash-partial write and a PINNED face outliving its session (an open
  // buffer's refresh writes its pin-annotated face for importers; pins
  // are per-session probe answers, so the pin-less recompile can never
  // reproduce those bytes).
  test('a mirror drifted AFTER the face warmed heals: re-materialized and answering on the next ask', async () => {
    await inWorkspace(THREE_FILES, async (api) => {
      await api.open('app.rip', APP_AB); // pulls a, b, util into the program
      // WARM the mirror face: a cross-file definition into unopened a.rip.
      const defs = await api.definition('app.rip', 2, 5); // aa at its use
      expect(defs).toHaveLength(1);
      expect(defs[0].uri).toBe(api.uriOf('a.rip'));

      // Drift the MIRROR with the source unchanged — a source-hash memo
      // alone would keep serving the stale face.
      const mirror = path.join(api.ws, '.rip', 'editor', 'a.rip.ts');
      const good = fs.readFileSync(mirror, 'utf8');
      fs.writeFileSync(mirror, good + '\n// drifted\n');

      // The next ask detects the drift, re-materializes, and answers —
      // and the mirror on disk is the canonical face again.
      const healed = await api.definition('app.rip', 2, 5);
      expect(healed).toHaveLength(1);
      expect(healed[0].uri).toBe(api.uriOf('a.rip'));
      expect(fs.readFileSync(mirror, 'utf8')).toBe(good);
      expect(api.logs.some((l) => /re-materialized/.test(l))).toBe(true);

      // References and rename serve across the healed file too.
      await api.open('util.rip', THREE_FILES['util.rip']);
      const refs = await api.references('util.rip', 0, 10); // answer at its declaration
      expect(refs.some((r) => r.uri === api.uriOf('a.rip'))).toBe(true);
      expect(refs.some((r) => r.uri === api.uriOf('b.rip'))).toBe(true);
    });
  }, 30000);

  test('typeDefinition resolves class- and interface-typed values to their Rip declarations', async () => {
    await inWorkspace({
      'shapes.rip': 'export class Point\n  x: number = 0\n  move: (dx: number) ->\n    @x = @x + dx\n',
    }, async (api) => {
      const SRC = [
        'import { Point } from "./shapes.rip"',
        'interface Config',
        '  depth: number',
        'p = new Point()',
        'cfg: Config = { depth: 1 }',
        'k = cfg',
        'w = p.x',
        '',
      ].join('\n');
      await api.open('app.rip', SRC);

      // A class-typed value at a READ site: its type declaration lives
      // in the UNOPENED shapes.rip (recompile-for-mappings maps it back).
      const classTargets = await api.typeDefinition('app.rip', 6, 4); // p in p.x
      expect(classTargets).toHaveLength(1);
      expect(classTargets[0].uri).toBe(api.uriOf('shapes.rip'));
      expect(classTargets[0].range).toEqual({
        start: { line: 0, character: 13 }, end: { line: 0, character: 18 },
      });

      // An interface-typed value resolves same-doc onto the Rip
      // interface head.
      const ifaceTargets = await api.typeDefinition('app.rip', 5, 4); // cfg at its read
      expect(ifaceTargets).toHaveLength(1);
      expect(ifaceTargets[0].uri).toBe(api.uriOf('app.rip'));
      expect(ifaceTargets[0].range.start.line).toBe(1);

      // A primitive-typed value has no type-declaration site: empty is
      // the honest answer.
      await api.change('app.rip', SRC + 'n = 42\nm = n\n');
      expect(await api.typeDefinition('app.rip', 8, 4)).toEqual([]);
    });
  }, 30000);

  test('a real .ts sibling target passes through untouched', async () => {
    await inWorkspace({ 'helper.ts': 'export const helper = (n: number) => n * 2;\n' }, async (api) => {
      await api.open('app.rip', 'import { helper } from "./helper.ts"\nk = helper(2)\n');
      const defs = await api.definition('app.rip', 1, 6);
      expect(defs).toHaveLength(1);
      expect(defs[0].uri).toBe(api.uriOf('helper.ts')); // the real file, never a mirror
      expect(defs[0].range.start.line).toBe(0);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('signature help', () => {
  test('active parameter indices hold across bodiless overload rows', async () => {
    await inWorkspace({}, async (api) => {
      const src = [
        'def pick(a: number, b: number): number',
        'def pick(a: string, b: string): string',
        'def pick(a, b)',
        '  a',
        'k = pick(1, 2)',
        '',
      ].join('\n');
      await api.open('app.rip', src);
      const help = await api.signatureHelp('app.rip', 4, 12); // inside the second argument
      expect(help).not.toBeNull();
      // Both overload rows arrive (tsgo numbers the list itself).
      expect(help.signatures.length).toBeGreaterThanOrEqual(2);
      const labels = help.signatures.map((s) => s.label);
      expect(labels.some((l) => l.includes('a: number, b: number'))).toBe(true);
      expect(labels.some((l) => l.includes('a: string, b: string'))).toBe(true);
      // The number overload is active (the call passes numbers), on
      // parameter 1 (the cursor sits in the second argument).
      const active = help.signatures[help.activeSignature ?? 0];
      expect(active.label).toContain('a: number');
      expect(active.activeParameter ?? help.activeParameter).toBe(1);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('semantic tokens', () => {
  const SRC = [
    'interface Point',
    '  x: number',
    'p: Point = { x: 1 }',
    'k = p.x',
    '',
  ].join('\n');

  test('tokens land on Rip spans — annotation tokens map, hoist duplicates dedup', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', SRC);
      const legend = api.capabilities.semanticTokensProvider.legend;
      const result = await api.semanticTokens('app.rip');
      const tokens = decodeTokens(result.data, legend);
      expect(tokens.length).toBeGreaterThan(0);

      // The interface declaration's name token, on Rip source.
      expect(tokens.some((t) => t.line === 0 && t.character === 10 && t.length === 5 && t.type === 'interface')).toBe(true);
      // The ANNOTATION's type token (`p: Point`) — the face marks
      // annotation bytes exact, so the token has a real Rip span.
      expect(tokens.some((t) => t.line === 2 && t.character === 3 && t.length === 5 && t.type === 'interface')).toBe(true);
      // The hoist line duplicates `p` and `k` in generated space; the
      // mapped tokens DEDUP — no two tokens share a source position.
      const seen = new Set();
      for (const t of tokens) {
        const key = `${t.line}:${t.character}:${t.length}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  }, 30000);

  test('an aliased imported enum receives the direct import token correction', async () => {
    await inWorkspace({
      'colors.rip': 'export enum Color\n  red = 0\n',
    }, async (api) => {
      const cases = {
        direct: ['import { Color } from "./colors.rip"', 'x = Color.red', 'Color'],
        aliased: ['import { Color as Shade } from "./colors.rip"', 'x = Shade.red', 'Shade'],
      };
      for (const [file, [clause, use, name]] of Object.entries(cases)) {
        await api.open(`${file}.rip`, `${clause}\n${use}\n`);
        const result = await api.semanticTokens(`${file}.rip`);
        const tokens = decodeTokens(result.data, api.capabilities.semanticTokensProvider.legend);
        expect(tokens).toContainEqual({
          line: 1,
          character: 4,
          length: name.length,
          type: 'enum',
          modifiers: [],
          modifierBits: 0,
        });
      }
    });
  }, 30000);

  test('range requests answer exactly the requested Rip range', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', SRC);
      const legend = api.capabilities.semanticTokensProvider.legend;
      const range = { start: { line: 3, character: 0 }, end: { line: 4, character: 0 } };
      const result = await api.semanticTokensRange('app.rip', range);
      const tokens = decodeTokens(result.data, legend);
      expect(tokens.length).toBeGreaterThan(0);
      for (const t of tokens) expect(t.line).toBe(3);
      // And strictly fewer than the full document's tokens.
      const full = decodeTokens((await api.semanticTokens('app.rip')).data, legend);
      expect(tokens.length).toBeLessThan(full.length);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('document and workspace symbols', () => {
  test('the outline lands on Rip spans: hierarchy kept, hoist manifestations deduped, scaffolding dropped', async () => {
    await inWorkspace({}, async (api) => {
      const SRC = [
        'class Greeter',                    // 0
        '  name: string = "hi"',            // 1
        '  greet: (who: string): string ->', // 2
        '    who',                           // 3
        'enum Color',                        // 4
        '  red = 0',                         // 5
        '  green = 1',                       // 6
        'count: number = 42',                // 7
        'tick := 0',                         // 8 (reactive: injects __ runtime scaffolding)
        '',
      ].join('\n');
      await api.open('app.rip', SRC);
      const symbols = await api.documentSymbol('app.rip');
      const names = symbols.map((s) => s.name);

      // The class, at its Rip site, with its members as children.
      const greeter = symbols.find((s) => s.name === 'Greeter');
      expect(greeter).toBeDefined();
      expect(greeter.selectionRange).toEqual({
        start: { line: 0, character: 6 }, end: { line: 0, character: 13 },
      });
      expect(greeter.range.start.line).toBe(0);
      const memberNames = greeter.children.map((c) => c.name);
      expect(memberNames).toContain('name');
      expect(memberNames).toContain('greet');
      const nameField = greeter.children.find((c) => c.name === 'name');
      expect(nameField.selectionRange.start).toEqual({ line: 1, character: 2 });

      // The enum emits a const object AND a same-name type companion —
      // two generated manifestations of ONE Rip declaration: one symbol.
      expect(names.filter((n) => n === 'Color')).toHaveLength(1);
      const color = symbols.find((s) => s.name === 'Color');
      expect(color.selectionRange.start.line).toBe(4);

      // The typed declaration hoists (let line + assignment): one
      // symbol, positioned at the Rip declaration.
      expect(names.filter((n) => n === 'count')).toHaveLength(1);
      const count = symbols.find((s) => s.name === 'count');
      expect(count.selectionRange).toEqual({
        start: { line: 7, character: 0 }, end: { line: 7, character: 5 },
      });

      // The reactive's injected __ runtime never surfaces as symbols.
      expect(names.some((n) => n.startsWith('__'))).toBe(false);
      for (const s of symbols) {
        expect(s.children.every((c) => !c.name.startsWith('__'))).toBe(true);
      }
    });
  }, 30000);

  test('the outline answers the request that arrives before the first compile', async () => {
    await inWorkspace({}, async (api) => {
      api.openNoWait('cold.rip', 'class Greeter\n  greet: (who: string): string ->\n    who\ncount: number = 42\n');
      // The editor asks once on open and caches; a null here is an
      // outline that stays empty for the life of the buffer version.
      const symbols = await api.documentSymbol('cold.rip');
      expect(symbols).not.toBeNull();
      expect(symbols.map((s) => s.name).sort()).toEqual(['Greeter', 'count']);
    });
  }, 30000);

  test('document links answer the request that arrives before the first compile', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      api.openNoWait('cold-links.rip', '# see ./util.rip for the answer\nx = 1\n');
      const links = await api.documentLink('cold-links.rip');
      expect(links).not.toBeNull();
      expect(links).toHaveLength(1);
      expect(links[0].target).toBe(api.uriOf('util.rip'));
    });
  }, 30000);

  test('workspace symbols reach unopened closure members with Rip positions', async () => {
    await inWorkspace({
      'util.rip': UTIL,
      'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
    }, async (api) => {
      await api.open('app.rip', 'import { aa } from "./a.rip"\nk = aa\n');
      const symbols = await api.workspaceSymbol('shout');
      // `shout` is declared in util.rip — in the program via a.rip,
      // never opened; the location lands on the Rip declaration.
      const shout = symbols.find((s) => s.name === 'shout' && s.location.uri === api.uriOf('util.rip'));
      expect(shout).toBeDefined();
      expect(shout.location.range.start).toEqual({ line: 0, character: 11 }); // export def shout(
      expect(symbols.every((s) => !s.location.uri.includes('.rip.ts'))).toBe(true);
    });
  }, 30000);
});

describe.skipIf(!tsgoAvailable)('document links (the trivia channel serves)', () => {
  test('relative paths in COMMENTS linkify; strings that look like paths and missing files do not', async () => {
    await inWorkspace({
      'NOTES.md': '# notes\n<a id="setup"></a>\nsetup here\n',
      'docs/guide.md': '## 1. intro\n',
    }, async (api) => {
      const SRC = [
        '# see ./NOTES.md#setup for the walkthrough',   // 0: links, with anchor
        'p = "./NOTES.md"',                              // 1: a STRING, not a comment — no link
        'k = p',                                         // 2
        '# ./docs/guide.md and ./missing.md',            // 3: one real, one absent
        '',
      ].join('\n');
      await api.open('app.rip', SRC);
      const links = await api.documentLink('app.rip');
      expect(links).toHaveLength(2);

      // The anchored link: range on the comment's path bytes, target
      // carrying the resolved line fragment (the id="setup" anchor
      // sits on line 2 of NOTES.md).
      expect(links[0].range).toEqual({
        start: { line: 0, character: 6 }, end: { line: 0, character: 22 },
      });
      expect(links[0].target).toBe(api.uriOf('NOTES.md') + '#L2');
      expect(links[0].tooltip).toBe('Open ./NOTES.md#setup');

      // The second comment: only the existing file linkifies.
      expect(links[1].range.start.line).toBe(3);
      expect(links[1].target).toBe(api.uriOf('docs/guide.md'));

      // The string on line 1 produced nothing — links come from the
      // compiler's trivia channel, never from scanning code lines.
      expect(links.some((l) => l.range.start.line === 1)).toBe(false);
    });
  }, 30000);
});


describe.skipIf(!tsgoAvailable)('references', () => {
  test('a reference list spans three files, two of them never opened', async () => {
    await inWorkspace(THREE_FILES, async (api) => {
      await api.open('app.rip', APP_AB); // pulls a, b, util into the program
      await api.open('util.rip', THREE_FILES['util.rip']);
      const refs = await api.references('util.rip', 0, 10); // `answer` at its declaration
      const byUri = new Map();
      for (const r of refs) byUri.set(r.uri, [...(byUri.get(r.uri) ?? []), r]);

      expect(byUri.has(api.uriOf('util.rip'))).toBe(true);
      expect(byUri.has(api.uriOf('a.rip'))).toBe(true); // never opened
      expect(byUri.has(api.uriOf('b.rip'))).toBe(true); // never opened

      // The unopened file's USE site lands exactly on `answer`
      // (line 1: `export aa = answer + 1`, chars 12..18) — the broker mapped
      // it through the recompiled face.
      const aRefs = byUri.get(api.uriOf('a.rip'));
      expect(aRefs.some((r) =>
        r.range.start.line === 1 && r.range.start.character === 12 && r.range.end.character === 18,
      )).toBe(true);
    });
  }, 30000);
});
