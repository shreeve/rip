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

      // The event WORD serves the handler signature from the compiler's
      // record — the word's face position is a string literal.
      const evWord = await api.hover('app.rip', 9, 10);      // inside `@input`
      expect(evWord?.contents?.value).toContain(`(event) @input: HTMLElementEventMap['input'] & { target: <input>; currentTarget: <input> }`);
    });
  });

  test('hover: a component name at a use site answers the component signature', async () => {
    // The lowered construct signature (`new (props?: {…}) => Button`)
    // re-dresses in the author's vocabulary: bind twins and the minted
    // children slot out, container unions collapsed value-first, a
    // required prop's intersection group folded back as a required
    // row. Works identically for an import-bound name (tsgo's alias
    // dress) and renders a props-less component as the bare head.
    await inWorkspace({
      'package.json': STRICT_PKG,
      'button.rip': [
        'export Button = component',
        '  @label: string',
        '  @kind?: number',
        '  render',
        '    button @label.value',
        '',
      ].join('\n'),
    }, async (api) => {
      const src = [
        "import { Button } from './button.rip'", // 0
        '',
        'export Chip = component',               // 2
        '  render',                              // 3
        "    span 'hi'",                         // 4
        '',
        'export Panel = component',              // 6
        '  render',                              // 7
        '    div',                               // 8
        "      Button label: 'Add'",             // 9
        '      Chip',                            // 10
        '',
      ].join('\n');
      await api.open('app.rip', src);
      const use = await api.hover('app.rip', 9, 8);       // inside `Button`
      expect(use?.contents?.value).toContain('```rip\ncomponent Button');
      expect(use?.contents?.value).toContain('label: string');    // required stays required
      expect(use?.contents?.value).toContain('kind?: number');
      expect(use?.contents?.value).not.toContain('__bind_');
      expect(use?.contents?.value).not.toContain('read()');
      const bare = await api.hover('app.rip', 10, 8);     // inside `Chip`
      expect(bare?.contents?.value).toContain('component Chip');
      expect(bare?.contents?.value).not.toContain('props');
      // The prop KEY hovers the prop's type value-first — the bind-slot
      // container arm never reaches the author, and a REQUIRED prop
      // carries no undefined arm to keep.
      const propKey = await api.hover('app.rip', 9, 15);  // inside `label:`
      expect(propKey?.contents?.value).toContain('(property) label: string');
      expect(propKey?.contents?.value).not.toContain('read()');
      expect(propKey?.contents?.value).not.toContain('undefined');

      // A component's EVENT word answers against the child's root —
      // a runtime fact, so the known map entry carries no host claim.
      const withEvent = src.replace("      Chip", '      Chip @click: (-> 0)');
      await api.change('app.rip', withEvent);
      const childEvent = await api.hover('app.rip', 10, 13);  // inside `@click`
      expect(childEvent?.contents?.value).toContain(`(event) @click: HTMLElementEventMap['click']`);
      expect(childEvent?.contents?.value).not.toContain('target:');
    });
  });

  test('hover: a dual-namespace extends component collapses its quoted passthrough rows', async () => {
    // `a` lives in both tag namespaces, so its extends surface carries
    // the SVG presentation attributes — QUOTED hyphenated keys, spelled
    // single-quoted by the face and echoed that way by tsgo. They are
    // passthrough like the bare rows and collapse into the head.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'export Pin = component extends a',  // 0
        '  @label: string',                  // 1
        '  render',                          // 2
        '    a @label.value',                // 3
        '',
        'export Panel = component',          // 5
        '  render',                          // 6
        "    Pin label: 'x'",                // 7
        '',
      ].join('\n');
      await api.open('pin.rip', src);
      const use = await api.hover('pin.rip', 7, 5);   // inside `Pin`
      expect(use?.contents?.value).toContain('component Pin extends a');
      expect(use?.contents?.value).toContain('label: string');
      expect(use?.contents?.value).not.toContain('stroke-width');
      expect(use?.contents?.value).not.toContain('fill-opacity');
    });
  });

  test('hover: an `@member` read presents value-first — the container never leaks', async () => {
    // The sigil read (`@tone`) takes the property-access lowering, not
    // memberRead's bare-spelling path; both record the name's span into
    // the value-first channel, so the hover answers the VALUE type at
    // either spelling.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'export Tone = component extends span',  // 0
        "  @tone?: 'a' | 'b' := 'a'",             // 1
        '  render',                               // 2
        '    span class: [@tone]',                // 3
        "      'x'",                              // 4
        '',
      ].join('\n');
      await api.open('tone.rip', src);
      const read = await api.hover('tone.rip', 3, 20);   // inside `@tone`
      expect(read?.contents?.value).toContain('tone: "a" | "b"');
      expect(read?.contents?.value).not.toContain('read()');

      // The head's grammar words decline — their bytes must never fall
      // to the class expression's cover row (a hover there described,
      // and highlighted, the whole lowered class). The extends TAG is
      // a real element reference and serves the element row.
      expect(await api.hover('tone.rip', 0, 17)).toBeNull();          // `component`
      expect(await api.hover('tone.rip', 0, 26)).toBeNull();          // `extends`
      const exTag = await api.hover('tone.rip', 0, 33);               // `span`
      expect(exTag?.contents?.value).toContain(`(element) span: HTMLElementTagNameMap['span']`);

      // A position with no landing of its own falls to a render cover
      // sitting on the lowered receiver — the cover-`this` answer
      // (`this: this`) declines rather than describing machinery.
      expect(await api.hover('tone.rip', 2, 4)).toBeNull();           // the `render` word
    });
  });

  test('hover: a hyphenated key declines on every road — never the effect machinery', async () => {
    // A hyphenated key's stored primitive keeps the lexer's quotes, so
    // its claim must go through the stored spelling; without the exact
    // row the presence road's key bytes fall to the pair's cover row,
    // whose generated start is the `__effect` helper — the machinery
    // hover this pin holds out.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'export Chip = component',    // 0
        '  busy := false',            // 1
        '  render',                   // 2
        '    button',                 // 3
        '      aria-busy: @busy?!',   // 4 — the presence road
        "      data-kind: 'primary'", // 5 — the template attr road
        '',
      ].join('\n');
      await api.open('chip.rip', src);
      expect(api.diagnostics('chip.rip').filter((d) => d.severity <= 2)).toEqual([]);
      const presenceKey = await api.hover('chip.rip', 4, 9);   // inside `aria-busy`
      expect(presenceKey).toBeNull();
      const dataKey = await api.hover('chip.rip', 5, 9);       // inside `data-kind`
      expect(dataKey).toBeNull();
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
