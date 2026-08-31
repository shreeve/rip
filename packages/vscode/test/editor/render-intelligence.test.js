// The intrinsic-element intelligence, driven over real LSP stdio
// against the real server + tsgo — the editor half of the typed
// lowering (src/ts/dom-types.js):
//
//   COMPLETIONS at a key: the receiver surface's string-literal union
//     answers at the key's own bytes — an existing key's word, a bare
//     prefix on a broken line (the pair-splice probe), and an empty
//     slot inside an element body.
//   HOVER: the tag word and the `ref` channel word answer from the
//     compiler's intrinsics record; the ref'd cell name answers its
//     element type value-first; a property-road key answers the
//     prop's type with the surface name scrubbed to the element.
//   DIAGNOSTICS: a misspelled key anchors on the key's own bytes.
//   SEMANTIC TOKENS: a property-road key mints no `property` token —
//     the TextMate attribute scope keeps the color.
//
// Same availability guard as the other live suites.
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

async function inWorkspace(files, fn) {
  const { LspClient } = await import('../../src/tsgo.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-render-intel-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(ws, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const published = [];
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') published.push(p); },
  });
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
  const uriOf = (rel) => 'file://' + path.join(ws, rel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const versions = new Map();
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
  const at = (rel, line, character) => ({ textDocument: { uri: uriOf(rel) }, position: { line, character } });
  const api = {
    async open(rel, text) {
      const before = published.length;
      versions.set(rel, 1);
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(rel), languageId: 'rip', version: 1, text } });
      await awaitPublish(rel, before);
    },
    async change(rel, text, { waitPublish = true } = {}) {
      const before = published.length;
      const v = (versions.get(rel) || 1) + 1;
      versions.set(rel, v);
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(rel), version: v }, contentChanges: [{ text }] });
      if (waitPublish) await awaitPublish(rel, before);
      else await sleep(400);
    },
    diagnostics(rel) {
      const u = uriOf(rel);
      for (let i = published.length - 1; i >= 0; i--) if (published[i].uri === u) return published[i].diagnostics;
      return [];
    },
    hover: (rel, line, character) => client.request('textDocument/hover', at(rel, line, character)),
    completion: (rel, line, character) => client.request('textDocument/completion', at(rel, line, character)),
    semanticTokens: (rel) => client.request('textDocument/semanticTokens/full', { textDocument: { uri: uriOf(rel) } }),
  };
  try {
    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri: 'file://' + ws,
      capabilities: { workspace: { configuration: true } },
    });
    api.capabilities = init.capabilities;
    client.notify('initialized', {});
    return await fn(api);
  } finally {
    await client.stop();
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

const STRICT_PKG = JSON.stringify({ name: 'render-intel', rip: { strict: true } });

const APP = [
  'export Panel = component',     // 0
  "  q := ''",                    // 1
  '  el: HTMLInputElement | null := null', // 2
  '  render',                     // 3
  '    div',                      // 4
  '      input',                  // 5
  "        type: 'search'",       // 6
  "        placeholder: 'find'",  // 7
  '        value: q',             // 8
  '        @input: (e) -> q = e.target.value', // 9
  '      input ref: el',          // 10
  '',
].join('\n');

const labelsOf = (completion) => (completion?.items ?? completion ?? []).map((i) => i.label);

describe.skipIf(!tsgoAvailable)('intrinsic-element intelligence', () => {
  test('hover: tag word, ref word, ref name, and a property-road key answer; an attribute-road key declines', async () => {
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP);
      expect(api.diagnostics('app.rip').filter((d) => d.severity <= 2)).toEqual([]);

      const tag = await api.hover('app.rip', 5, 8);          // inside `input`
      expect(tag?.contents?.value).toContain(`(element) input: HTMLElementTagNameMap['input']`);

      const refWord = await api.hover('app.rip', 10, 13);    // inside `ref:`
      expect(refWord?.contents?.value).toContain(`ref — writes HTMLElementTagNameMap['input'] into el`);

      const refName = await api.hover('app.rip', 10, 18);    // inside `el`
      expect(refName?.contents?.value).toContain('HTMLInputElement | null');
      expect(refName?.contents?.value).not.toContain('read()');   // value-first, never the container

      const valueKey = await api.hover('app.rip', 8, 10);    // inside `value`
      expect(valueKey?.contents?.value).toContain('<input>.value: string');

      // An attribute-road key's face position is a string literal — no
      // symbol, so hover declines (RULINGS.md: the served half is the
      // property roads; completions and diagnostics answer here).
      const attrKey = await api.hover('app.rip', 7, 12);     // inside `placeholder`
      expect(attrKey).toBeNull();

      // The handler param carries the host-element claim (the target
      // re-ruling): e.target reads as the input.
      const param = await api.hover('app.rip', 9, 17);       // the `e` param
      expect(param?.contents?.value).toContain('InputEvent');
      expect(param?.contents?.value).toContain(`target: HTMLElementTagNameMap['input']`);
    });
  });

  test('completions: an existing key word answers the tag\'s attribute vocabulary at its own bytes', async () => {
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP);
      const completion = await api.completion('app.rip', 7, 15);   // inside `placeholder`
      const labels = labelsOf(completion);
      expect(labels).toContain('placeholder');
      expect(labels).toContain('pattern');
      expect(labels).toContain('maxlength');
      expect(labels).not.toContain('__RipGlobalAttrVals');
    });
  });

  test('completions: a bare prefix on a broken attribute line rides the pair-splice probe', async () => {
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP);
      // `input pla` rejects at compile (bare-identifier validation), so
      // the buffer's own face cannot answer — the probe splices
      // `pla` into a well-formed pair and asks inside the key.
      const broken = APP.replace('      input ref: el', '      input pla');
      await api.change('app.rip', broken, { waitPublish: false });
      const completion = await api.completion('app.rip', 10, 15);  // after `pla`
      const labels = labelsOf(completion);
      expect(labels).toContain('placeholder');
      expect(labels).toContain('pattern');
    });
  });

  test('completions: an empty slot inside an element body offers the attribute vocabulary', async () => {
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP);
      const withSlot = APP.replace("        value: q", "        value: q\n        ");
      await api.change('app.rip', withSlot, { waitPublish: false });
      const completion = await api.completion('app.rip', 9, 8);    // the blank slot line
      const labels = labelsOf(completion);
      expect(labels).toContain('placeholder');
      expect(labels).toContain('required');
    });
  });

  test('a misspelled key\'s diagnostic anchors on the key\'s own bytes', async () => {
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP);
      const typo = APP.replace("placeholder: 'find'", "placeholdr: 'find'");
      await api.change('app.rip', typo);
      const diags = api.diagnostics('app.rip');
      const hit = diags.find((d) => d.code === 2345);
      expect(hit).toBeTruthy();
      expect(hit.range.start).toEqual({ line: 7, character: 8 });
      expect(hit.message).toContain(`'"placeholdr"'`);
    });
  });

  test('a property-road key keeps the TextMate attribute color — no `property` semantic token lands on it', async () => {
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP);
      const tokens = await api.semanticTokens('app.rip');
      const legend = api.capabilities.semanticTokensProvider.legend;
      const rows = decodeSemanticTokens(tokens?.data ?? [], legend);
      // line 8 `        value: q` — the key spans characters 8-13.
      const onKey = rows.filter((t) => t.line === 8 && t.character < 13 && t.character + t.length > 8);
      expect(onKey).toEqual([]);
    });
  });
});
