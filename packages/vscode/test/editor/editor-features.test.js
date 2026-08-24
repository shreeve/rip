// The editor features driven over real LSP stdio against the
// real server + tsgo, per-feature acceptance plus the recorded
// negatives:
//
//   COMPLETIONS: member items land with resolve-lazy detail; scaffolding
//     labels (the __ runtime, _ref temps) never surface; auto-import
//     edits arrive on resolve as idiomatic Rip (no semicolon, .rip
//     specifier) in BOTH spellings — a new import line and a merge into
//     an existing clause; staleness respected (a broken buffer's changed
//     region answers null, aligned positions serve).
//   DEFINITION (+implementation): same-doc, cross-file into an UNOPENED
//     dependency (recompile-for-mappings), and pass-through into a
//     real .ts sibling.
//   SIGNATURE HELP: active parameter indices correct across the
//     bodiless overload rows.
//   SEMANTIC TOKENS: tokens land on Rip spans (annotation tokens map —
//     they have real Rip spans in the face), hoist-duplicated tokens
//     DEDUP to one source token, range requests answer the range.
//   REFERENCES: lists span three files, two of them never opened.
//   RENAME: the coincident-span dedup pinned (a hoisted declaration's let-line and
//     assignment are one source span → ONE edit), cross-file edits reach
//     unopened files, out-of-closure files stay untouched;
//     prepareRename refuses unmappable positions; a rename touching a
//     broken buffer refuses whole (never partial-applies).
//   CODE ACTIONS: the auto-import quickfix maps its edit onto Rip source.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeSemanticTokens } from '../../src/tsgo.js';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed */ }

const SERVER = path.resolve(import.meta.dir, '..', '..', 'src', 'server.js');

function makeWorkspace(files) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-feat-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(ws, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return ws;
}

// One live session over a fresh workspace; the api wraps every feature
// request in current-buffer coordinates.
async function inWorkspace(files, fn) {
  const { LspClient } = await import('../../src/tsgo.js');
  const ws = makeWorkspace(files);
  const published = [];
  const logs = [];
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (m, p) => {
      if (m === 'textDocument/publishDiagnostics') published.push(p);
      if (m === 'window/logMessage') logs.push(p.message);
    },
  });
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
  const uriOf = (rel) => 'file://' + path.join(ws, rel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function awaitPublish(rel, sinceLen) {
    const u = uriOf(rel);
    for (let i = 0; i < 60; i++) {
      for (let j = published.length - 1; j >= sinceLen; j--) {
        if (published[j].uri === u) { await sleep(120); return; }
      }
      await sleep(100);
    }
    throw new Error(`no publishDiagnostics for ${rel} arrived`);
  }
  const versions = new Map();
  const at = (rel, line, character) => ({
    textDocument: { uri: uriOf(rel) },
    position: { line, character },
  });
  const api = {
    ws,
    logs,
    uriOf,
    sleep,
    capabilities: null,
    async open(rel, text) {
      const before = published.length;
      versions.set(rel, 1);
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(rel), languageId: 'rip', version: 1, text } });
      await awaitPublish(rel, before);
    },
    // didOpen with NO wait for the first compile — the editor's own
    // cold-open ordering, where a cached answer is the only answer.
    openNoWait(rel, text) {
      versions.set(rel, 1);
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(rel), languageId: 'rip', version: 1, text } });
    },
    async change(rel, text) {
      const before = published.length;
      const v = (versions.get(rel) || 1) + 1;
      versions.set(rel, v);
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(rel), version: v }, contentChanges: [{ text }] });
      await awaitPublish(rel, before);
    },
    diagnostics(rel) {
      const u = uriOf(rel);
      for (let i = published.length - 1; i >= 0; i--) if (published[i].uri === u) return published[i].diagnostics;
      return [];
    },
    hover: (rel, line, character) => client.request('textDocument/hover', at(rel, line, character)),
    completion: (rel, line, character) => client.request('textDocument/completion', at(rel, line, character)),
    resolveItem: (item) => client.request('completionItem/resolve', item),
    definition: (rel, line, character) => client.request('textDocument/definition', at(rel, line, character)),
    typeDefinition: (rel, line, character) => client.request('textDocument/typeDefinition', at(rel, line, character)),
    implementation: (rel, line, character) => client.request('textDocument/implementation', at(rel, line, character)),
    references: (rel, line, character) => client.request('textDocument/references', { ...at(rel, line, character), context: { includeDeclaration: true } }),
    signatureHelp: (rel, line, character) => client.request('textDocument/signatureHelp', at(rel, line, character)),
    prepareRename: (rel, line, character) => client.request('textDocument/prepareRename', at(rel, line, character)),
    rename: (rel, line, character, newName) => client.request('textDocument/rename', { ...at(rel, line, character), newName }),
    documentSymbol: (rel) => client.request('textDocument/documentSymbol', { textDocument: { uri: uriOf(rel) } }),
    documentLink: (rel) => client.request('textDocument/documentLink', { textDocument: { uri: uriOf(rel) } }),
    workspaceSymbol: (query) => client.request('workspace/symbol', { query }),
    semanticTokens: (rel) => client.request('textDocument/semanticTokens/full', { textDocument: { uri: uriOf(rel) } }),
    semanticTokensRange: (rel, range) => client.request('textDocument/semanticTokens/range', { textDocument: { uri: uriOf(rel) }, range }),
    codeAction: (rel, range, diagnostics, only) => client.request('textDocument/codeAction', {
      textDocument: { uri: uriOf(rel) }, range, context: { diagnostics, ...(only ? { only } : {}) },
    }),
  };
  try {
    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri: 'file://' + ws,
      // linkSupport mirrors VS Code: a definition may answer LocationLink,
      // and the specifier-origin test below depends on it. Identifier
      // definitions still answer plain locations either way.
      capabilities: { workspace: { configuration: true }, textDocument: { definition: { linkSupport: true } } },
    });
    api.capabilities = init.capabilities;
    client.notify('initialized', {});
    return await fn(api);
  } finally {
    await client.stop();
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

// Apply LSP TextEdits to a text (bottom-up, so earlier offsets stay valid).
function applyEdits(text, edits) {
  const ls = (() => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
  })();
  const toOff = ({ line, character }) =>
    line >= ls.length ? text.length : Math.min(ls[line] + character, text.length);
  const ordered = [...edits].sort((a, b) => toOff(b.range.start) - toOff(a.range.start));
  let out = text;
  for (const e of ordered) {
    out = out.slice(0, toOff(e.range.start)) + e.newText + out.slice(toOff(e.range.end));
  }
  return out;
}

// Semantic-token decoding is LSP wire format, shared from the tsgo client
// (`decodeSemanticTokens`) rather than hand-rolled per consumer.
const decodeTokens = decodeSemanticTokens;

const UTIL = 'export def shout(s: string): string\n  s.toUpperCase()\nexport answer = 42\n';

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
});

describe.skipIf(!tsgoAvailable)('definition and implementation', () => {
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

      // Implementation crosses the same boundary (the def function).
      const impls = await api.implementation('app.rip', 0, 12);
      expect(impls.length).toBeGreaterThanOrEqual(1);
      expect(impls[0].uri).toBe(api.uriOf('util.rip'));
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

// Three files around one symbol: util defines `answer`; a and b import
// and use it; app imports a and b (so both join the program unopened).
const THREE_FILES = {
  'util.rip': 'export answer = 42\n',
  'a.rip': 'import { answer } from "./util.rip"\nexport aa = answer + 1\n',
  'b.rip': 'import { answer } from "./util.rip"\nexport bb = answer + 2\n',
};
const APP_AB = 'import { aa } from "./a.rip"\nimport { bb } from "./b.rip"\nk = aa + bb\n';

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

  test('sort imports is a pure reorder: both statements keep their source bytes', async () => {
    await inWorkspace({ 'util.rip': UTIL, 'zed.rip': 'export zz = 1\n' }, async (api) => {
      const SRC = 'import { zz } from "./zed.rip"\nimport { answer } from "./util.rip"\nexport k = answer + zz\n';
      await api.open('app.rip', SRC);
      const actions = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.sortImports']);
      expect(actions).toHaveLength(1);
      const applied = applyEdits(SRC, actions[0].edit.changes[api.uriOf('app.rip')]);
      expect(applied).toBe('import { answer } from "./util.rip"\nimport { zz } from "./zed.rip"\nexport k = answer + zz\n');
      await api.change('app.rip', applied);
      expect(api.diagnostics('app.rip')).toEqual([]);
    });
  }, 30000);

  test('fix-all lands its auto-import through the standing insertion rules', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      const SRC = 'import { answer } from "./util.rip"\nexport k = answer\nexport y = shout("hi")\n';
      await api.open('app.rip', SRC);
      const actions = await api.codeAction('app.rip', WHOLE_DOC, [], ['source.fixAll']);
      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe('source.fixAll');
      const applied = applyEdits(SRC, actions[0].edit.changes[api.uriOf('app.rip')]);
      expect(applied).toContain('import { answer, shout } from "./util.rip"');
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
      for (const kind of ['source.organizeImports', 'source.removeUnusedImports']) {
        const actions = await api.codeAction('app.rip', WHOLE_DOC, [], [kind]);
        expect(actions).toHaveLength(1);
        const applied = applyEdits(SRC, actions[0].edit.changes[api.uriOf('app.rip')]);
        expect(applied).toBe('import { answer } from "./util.rip"\nexport k = answer + 1\n');
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
      // pinned by check.test.js ('an unused @ts-expect-error stays loud').
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
