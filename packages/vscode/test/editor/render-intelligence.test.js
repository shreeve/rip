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
const TSGO_TRACE_TAP = path.resolve(import.meta.dir, 'support', 'tsgo-trace.mjs');

// `traceTsgo` preloads the test-only tap (support/tsgo-trace.mjs) into
// the server, and `api.tsgoNotifications()` reads back every
// tsgo-bound notification method it has sent — the face swaps a probe
// costs are otherwise invisible from this side of the stdio.
async function inWorkspace(files, fn, { traceTsgo = false } = {}) {
  const { LspClient } = await import('../../src/tsgo.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-render-intel-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(ws, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const published = [];
  const trace = traceTsgo ? path.join(os.tmpdir(), path.basename(ws) + '.tsgo-trace') : null;
  if (trace) { fs.writeFileSync(trace, ''); process.env.RIP_TSGO_TRACE = trace; }
  const client = new LspClient('bun', [...(trace ? ['--preload', TSGO_TRACE_TAP] : []), SERVER, '--stdio'], {
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') published.push(p); },
  });
  if (trace) delete process.env.RIP_TSGO_TRACE;
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
    resolve: (item) => client.request('completionItem/resolve', item),
    signatureHelp: (rel, line, character) => client.request('textDocument/signatureHelp', at(rel, line, character)),
    semanticTokens: (rel) => client.request('textDocument/semanticTokens/full', { textDocument: { uri: uriOf(rel) } }),
    tsgoNotifications: () => (trace ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean) : []),
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
    if (trace) fs.rmSync(trace, { force: true });
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
  test('hover: tag word, ref word, ref name, and both key roads answer', async () => {
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
      expect(valueKey?.contents?.value).toContain('(attribute) value: string');   // the attribute the author wrote, never the road's property

      // An attribute-road key's face position is a string literal — no
      // symbol — so it answers from the compiler's intrinsics record,
      // naming the value type its road admits (RULINGS.md).
      const attrKey = await api.hover('app.rip', 7, 12);     // inside `placeholder`
      expect(attrKey?.contents?.value).toContain('(attribute) placeholder:');

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

  test('hover: the positive model — symbols answer, everything else declines', async () => {
    // Hover answers only where the author wrote a symbol (RULINGS.md,
    // the hover model): keywords, string and comment interiors, and
    // numbers decline like the platform's own convention; a TYPE
    // annotation's words and an import specifier keep answering.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        "import { Button } from './button.rip'",  // 0
        '# a note about the panel',               // 1
        'export Panel = component',               // 2
        '  el: HTMLInputElement | null := null',  // 3
        '  render',                               // 4
        '    if true',                            // 5
        "      p 'hello world'",                  // 6
        '      Button label: 42',                 // 7 (the 42 draws its own diagnostic; positions still answer)
        '',
        "make = -> new.target?.name ?? 'plain'",  // 9
        '',
      ].join('\n');
      const btn = [
        'export Button = component',
        '  @label: string',
        "  @size?: 'big' | 'small' := 'big'",
        '  chosenEl:   HTMLElement | null := null',
        '  render',
        '    button @label.value',
        '',
      ].join('\n');
      await api.open('button.rip', btn);
      await api.open('panel.rip', src);
      expect(await api.hover('button.rip', 2, 12)).toBeNull();        // annotation literal `big` — a value, not a symbol
      // An ALIGNED annotation (padding after the colon) answers the
      // type itself — the builder's layout-twin segments keep the word
      // exact-mapped, never falling to the member container's slot.
      const aligned = await api.hover('button.rip', 3, 16);           // `HTMLElement` behind the padding
      expect(aligned?.contents?.value).toContain('interface HTMLElement');
      expect(aligned?.contents?.value).not.toContain('(property) value');
      expect(await api.hover('panel.rip', 1, 6)).toBeNull();          // comment word `note`
      expect(await api.hover('panel.rip', 5, 4)).toBeNull();          // the `if` keyword
      expect(await api.hover('panel.rip', 6, 10)).toBeNull();         // string interior `hello`
      expect(await api.hover('panel.rip', 7, 20)).toBeNull();         // the number 42
      expect(await api.hover('panel.rip', 9, 16)).toBeNull();         // `target` in new.target — the meta-property declines
      const typeWord = await api.hover('panel.rip', 3, 8);            // `HTMLInputElement` in the annotation
      expect(typeWord?.contents?.value).toContain('HTMLInputElement');
      const spec = await api.hover('panel.rip', 0, 28);               // inside the specifier
      expect(spec?.contents?.value).toContain('button.rip');
    });
  });

  test('hover: a forward-used extends component presents at its own declaration', async () => {
    // A use ABOVE the declaration makes tsgo print the RESOLVED
    // construct at the decl site instead of `typeof Name` — every
    // intrinsic passthrough row of the extends tag, far past tsgo's
    // default hover cap. The broker floors `maximumHoverLength` so the
    // whole construct arrives and the signature presenter fires; a
    // truncated construct would pass its raw machinery to the user.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'Teaser = component',           // 0
        '  render',                     // 1
        "    Anchor label: 'ahead'",    // 2
        '',
        'Anchor = component extends a', // 4
        '  @label: string',             // 5
        '  render',                     // 6
        '    a label',                  // 7
        '',
      ].join('\n');
      await api.open('nav.rip', src);
      const decl = await api.hover('nav.rip', 4, 0);
      expect(decl?.contents?.value).toContain('```rip\ncomponent Anchor extends a');
      expect(decl?.contents?.value).toContain('label: string');
      expect(decl?.contents?.value).not.toContain('__bind_');
      expect(decl?.contents?.value).not.toContain('HTMLElementTagNameMap["a"] extends');
    });
  });

  test('hover: an attribute key answers the value type its road admits', async () => {
    // The key's own face position is a string literal, so the answer
    // comes from the compiler's intrinsics record: it points at the
    // INSTANTIATED setAttribute beside the key, which is generic over
    // the key and so spells the one value type this attribute takes.
    // The presence road spells its type outright, because its reactive
    // and static lowerings would otherwise describe one key two ways.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'B = component',              // 0
        '  @busy?: boolean',          // 1
        '  render',                   // 2
        '    button',                 // 3
        '      aria-busy: @busy',     // 4
        "      role: 'button'",       // 5
        '      disabled: @busy',      // 6
        "      class: 'btn'",         // 7
        '',
      ].join('\n');
      await api.open('attrs.rip', src);
      // A data-/aria- suffix rides the surface's template row.
      expect((await api.hover('attrs.rip', 4, 6))?.contents?.value)
        .toContain('(attribute) aria-busy: string | number | boolean | undefined');
      // A named attribute answers its own road's admission.
      expect((await api.hover('attrs.rip', 5, 6))?.contents?.value).toContain('(attribute) role:');
      // The presence road spells presence.
      expect((await api.hover('attrs.rip', 6, 6))?.contents?.value)
        .toContain('(attribute) disabled: boolean | undefined');
      // A PROPERTY-road key keeps answering through its real property
      // access — it never needed the record.
      expect((await api.hover('attrs.rip', 7, 6))?.contents?.value)
        .toContain('(attribute) class: ClassValue | ClassValue[]');   // the property road, re-headed as the key the author wrote
    });
  });

  test('hover: a `<=>` target answers the channel, on both receivers', async () => {
    // The target word is a channel word the census spends, so it answers from
    // the compiler's record. One form for both receivers: an intrinsic bind
    // reads the CELL side (the element receiver is an untyped scaffold local,
    // and a `<=>` write is typed at the cell), a component bind reads the
    // minted props key's container — which arrives as a union when the prop
    // is optional, so the cell has to be found among the arms.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'Field = component',        // 0
        '  @label?: string',        // 1
        '  render',                 // 2
        '    span label',           // 3
        '',
        'T = component',            // 5
        "  q := ''",                // 6
        "  n := ''",                // 7
        '  render',                 // 8
        '    input',                // 9
        '      value <=> q',        // 10
        '    Field',                // 11
        '      label <=> n',        // 12
        '',
      ].join('\n');
      await api.open('bind.rip', src);
      expect((await api.hover('bind.rip', 10, 6))?.contents?.value)
        .toContain('(bind) value: string');
      const component = (await api.hover('bind.rip', 12, 6))?.contents?.value;
      expect(component).toContain('(bind) label: string');
      // never the container, and never the minted key
      expect(component).not.toContain('read()');
      expect(component).not.toContain('__bind_');
      // The bound NAME answers value-first on both receivers — the author's
      // own vocabulary, never the container the channel shares.
      const intrinsicName = (await api.hover('bind.rip', 10, 16))?.contents?.value;
      expect(intrinsicName).toContain(': string');
      expect(intrinsicName).not.toContain('read()');
      const componentName = (await api.hover('bind.rip', 12, 16))?.contents?.value;
      expect(componentName).toContain(': string');
      expect(componentName).not.toContain('read()');
    });
  });

  test('hover: a key whose VALUE repeats it still answers about the key', async () => {
    // The record carries the key's own CLAIMED span. Searching for the
    // spelling instead finds two occurrences on these rows and can name
    // neither, so the key would fall silent exactly where a passthrough
    // component spells its own prop — the commonest shape there is.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'L = component extends button',            // 0
        '  @busy?: boolean',                       // 1
        '  render',                                // 2
        '    button',                              // 3
        '      disabled: @busy or @rest.disabled', // 4
        "      aria-label: @rest['aria-label']",   // 5
        '',
      ].join('\n');
      await api.open('pass.rip', src);
      expect((await api.hover('pass.rip', 4, 6))?.contents?.value)
        .toContain('(attribute) disabled: boolean | undefined');
      expect((await api.hover('pass.rip', 5, 6))?.contents?.value)
        .toContain('(attribute) aria-label:');
    });
  });

  test('hover: a generic use site carries its instantiation, and a word-end cursor hovers the word', async () => {
    // The construct signature at a generic use prints the inferred
    // instantiation (`new <"alpha">(props?: …) => Chip<"alpha">`) —
    // the presenter carries it into the head and collapses cell arms
    // WHEREVER they sit in a row's union. And a cursor at a word's END
    // boundary hovers the word (VS Code's own semantics): the served
    // spans are end-exclusive, so without the bias the boundary byte
    // fell to whatever the cover held.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'export Chip<T extends string> = component',  // 0
        '  @label?: T',                                // 1
        '  render',                                    // 2
        "    span 'chip'",                             // 3
        '',
        'export Panel = component',                    // 5
        '  render',                                    // 6
        '    div',                                     // 7
        "      Chip label: 'alpha'",                   // 8
        '',
      ].join('\n');
      await api.open('chip.rip', src);
      const use = await api.hover('chip.rip', 8, 8);        // inside `Chip`
      expect(use?.contents?.value).toContain(`component Chip<'alpha'>`);
      expect(use?.contents?.value).toContain(`label?: 'alpha' | undefined`);
      expect(use?.contents?.value).not.toContain('__bind_');
      expect(use?.contents?.value).not.toContain('read()');
      const boundary = await api.hover('chip.rip', 7, 7);   // END of `div`
      expect(boundary?.contents?.value).toContain(`(element) div: HTMLElementTagNameMap['div']`);
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

  test('hover: `@rest` names the provided view, typed as the tag\'s passthrough', async () => {
    // Under `extends`, `rest` is provided, not declared: its read mints
    // `(rest)`, and its type is the per-tag passthrough object the editor
    // shows as `Rest<tag>` — so a member read through it types by the tag.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'export Btn = component extends button',   // 0
        '  render',                                // 1
        '    button disabled: @rest.disabled',     // 2
        "      'x'",                               // 3
        '',
      ].join('\n');
      await api.open('btn.rip', src);
      const rest = (await api.hover('btn.rip', 2, 24))?.contents?.value ?? '';     // inside `rest`
      expect(rest).toContain('(rest) rest: Rest<button>');
      expect(rest).not.toContain('__Rip');
      const member = (await api.hover('btn.rip', 2, 30))?.contents?.value ?? '';   // inside `disabled`
      expect(member).toContain('disabled?: boolean | undefined');
    });
  });

  test('hover: an `@member` read presents value-first — the container never leaks', async () => {
    // The sigil read (`@tone`) takes the property-access lowering, not
    // memberRead's bare-spelling path; both record the name's span into
    // the value-first channel, so the hover answers the VALUE type at
    // either spelling — under the minted kind, with the optional marker
    // the author wrote (the face declares the member required, so the
    // marker rides the kind record).
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
      expect(read?.contents?.value).toContain('(prop) tone?: "a" | "b"');
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

  test('a prop key\'s completion detail presents value-first; signature help declines on the use', async () => {
    // The props surface's slot admits the prop's value OR its container,
    // and mints a bind twin per prop; the hover collapses that (the
    // prop-name row). The completion item's detail column, resolved
    // lazily, presents the same slot: no container arm.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const button = [
        'export Button = component extends button',           // 0
        "  @variant?: 'primary' | 'secondary' := 'primary'",  // 1
        '  render',                                           // 2
        '    button class: [@variant]',                       // 3
        "      'x'",                                          // 4
        '',
      ].join('\n');
      const form = [
        "import { Button } from './button.rip'",  // 0
        'export Form = component',                // 1
        '  render',                               // 2
        '    div',                                // 3
        "      Button variant: 'primary'",        // 4
        "      Button variant: 'primary', 'label'", // 5
        '      Button',                            // 6
        "        variant: 'secondary'",            // 7
        '        ',                                // 8 — an indented blank line inside the props block
        '      div',                               // 9
        "      Button variant: 'primary', @click: (-> console.log(1)), 'x'",   // 10
        '',
      ].join('\n');
      await api.open('button.rip', button);
      await api.open('form.rip', form);
      const completion = await api.completion('form.rip', 4, 15);   // inside `variant`
      const item = (completion?.items ?? []).find((i) => i.label === 'variant?');
      expect(item).toBeDefined();
      const resolved = await api.resolve(item);
      expect(resolved.detail).toBe('(property) variant?: "primary" | "secondary" | undefined');

      // Signature help DECLINES on a component use: the props are named
      // keys, so there is no positional parameter to track, and the hover
      // on the name already answers the signature. Every position of the
      // use declines — the tag word, a prop key, a value, the separator, a
      // positional child, the end of the line — and so does the lowering's
      // own machinery around it: an element tag word (createElement), a
      // handler's arrow (the `__batch` wrapper). A call the author wrote
      // inside a handler answers as itself.
      const labelAt = async (line, ch) => (await api.signatureHelp('form.rip', line, ch))?.signatures?.[0]?.label ?? null;
      for (const [line, ch] of [[4, 8], [4, 15], [4, 24], [4, 31], [5, 32], [5, 35], [6, 12], [7, 29], [8, 8], [9, 8], [10, 35], [10, 43]]) {
        expect([line, ch, await labelAt(line, ch)]).toEqual([line, ch, null]);
      }
      expect(await labelAt(10, 57)).toContain('log('); // inside `console.log(` in the handler
    });
  });

  test('completion detail: a component reads as its signature, a member value-first, and a positional leak is dropped', async () => {
    // The detail column is a typed line and takes the hover's presenters:
    // a component item's construct signature reads as the rip signature
    // on one line, and a reactive member of the file's own component
    // reads value-first. tsgo's resolve, asked with the cursor inside a
    // callable symbol's own name, prints every item's detail with THAT
    // symbol's type; a detail that merely repeats it is dropped.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const button = [
        'export Button = component extends button',           // 0
        "  @variant?: 'primary' | 'secondary' := 'primary'",  // 1
        '  count := 0',                                       // 2
        '  render',                                           // 3
        "    button class: [@variant], @click: (-> count += 1)", // 4
        "      'x'",                                          // 5
        '      count',                                        // 6
        'export Tag = component',                             // 7
        '  @label?: string',                                  // 8
        '  render',                                           // 9
        '    span label',                                     // 10
        '',
      ].join('\n');
      const form = [
        "import { Button, Tag } from './button.rip'",  // 0
        'export Form = component',                     // 1
        '  render',                                    // 2
        '    div',                                     // 3
        "      Button variant: 'primary'",             // 4
        "      Tag label: 'x'",                        // 5
        '',
      ].join('\n');
      await api.open('button.rip', button);
      await api.open('form.rip', form);
      const atUse = await api.completion('form.rip', 4, 10);            // inside `Button`, a construct's callee
      const buttonItem = (atUse?.items ?? []).find((i) => i.label === 'Button');
      expect(buttonItem).toBeDefined();
      // An `extends` component's construct detail carries every passthrough
      // row, and tsgo may cut a resolved detail that long — whole, it
      // reads as the full signature; cut, the head still says what it
      // is and the item reads as the component alone. Never the rows.
      const resolvedButton = await api.resolve(buttonItem);
      expect(resolvedButton.detail).toMatch(/^component Button( extends button props: \{ variant\?: 'primary' \| 'secondary' \})?$/);
      // A construct detail tsgo delivers whole reads as the full signature
      // — asked at the item's own use, where its detail is its own.
      const atTag = await api.completion('form.rip', 5, 8);              // inside `Tag`
      const tagItem = (atTag?.items ?? []).find((i) => i.label === 'Tag');
      expect(tagItem).toBeDefined();
      expect((await api.resolve(tagItem)).detail).toBe('component Tag props: { label?: string }');
      // Any other item at this position carried Button's construct type
      // in its detail; it never shows.
      const other = (atUse?.items ?? []).find((i) => i.label === 'console');
      expect(other).toBeDefined();
      const resolvedOther = await api.resolve(other);
      expect(resolvedOther.detail ?? '').not.toContain('=> Button');
      expect(resolvedOther.detail ?? '').not.toContain('read()');
      // A FUNCTION item wears the leak as its parameter list —
      // `function structuredClone(props?: { variant?: … }): Button`.
      const fn = (atUse?.items ?? []).find((i) => i.label === 'structuredClone');
      expect(fn).toBeDefined();
      expect((await api.resolve(fn)).detail ?? '').not.toContain('props?: {');

      const inBody = await api.completion('button.rip', 6, 9);          // inside the `count` read
      const countItem = (inBody?.items ?? []).find((i) => i.label === 'count');
      expect(countItem).toBeDefined();
      const resolvedCount = await api.resolve(countItem);
      expect(resolvedCount.detail).toBe('(property) Button.count: number');
      // The lowering's own names are never offered.
      expect((inBody?.items ?? []).some((i) => /^_(?:el|t|inst)\d+$|^_init$|^create_block_/.test(i.label))).toBe(false);
    });
  });

  test('hover: a hyphenated key answers on every road — never the effect machinery', async () => {
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
      // A presence VALUE does not move the key's road: aria-busy is not
      // a boolean attribute, so its type is still the template row's.
      expect(presenceKey?.contents?.value).toContain('(attribute) aria-busy: string | number | boolean | undefined');
      expect(presenceKey?.contents?.value).not.toContain('__effect');
      const dataKey = await api.hover('chip.rip', 5, 9);       // inside `data-kind`
      expect(dataKey?.contents?.value).toContain('(attribute) data-kind: string | number | boolean | undefined');
      expect(dataKey?.contents?.value).not.toContain('__effect');
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

  test('where a pair\'s complaint lands: the value\'s own complaint keeps its bytes, the pair\'s relation lands on the key', async () => {
    // The editor half of the CLI row of the same name (RULINGS.md, the
    // render-pair section): one road per line, LSP positions.
    const source = [
      'Btn = component',               // 0
      '  @label: string',              // 1
      '  render',                      // 2
      "    button 'b'",                // 3
      '',                              // 4
      'export P = component',          // 5
      '  n := 0',                      // 6
      '  cell: HTMLInputElement | null := null', // 7
      '  render',                      // 8
      '    div',                       // 9
      '      input value: nope',       // 10: TS2304 on `nope`
      '      img alt: 42',             // 11: TS2345 on `alt`
      '      Btn anything: 2',         // 12: TS2353 on `anything`
      '      Btn label: nope',         // 13: TS2304 on `nope`
      '      input value <=> n',       // 14: TS2322 on `value`
      '      div innerHTML: n',        // 15: TS2322 on `innerHTML`
      '      div textContent: nope',   // 16: TS2304 on `nope`
      '      Btn label <=> n',         // 17: TS2322 on `label`
      '      button disabled: nope',   // 18: TS2304 on `nope`
      '      div ref: cell',           // 19: TS2345 on `ref`
      '      p class: n',              // 20: TS2345 on `class`
      '      div.card class: nope',    // 21: TS2304 on `nope`
      '',
    ].join('\n');
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', source);
      const rows = api.diagnostics('app.rip')
        .map((d) => [d.code, d.range.start.line, d.range.start.character])
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]);
      expect(rows).toEqual([
        [2304, 10, 19], [2345, 11, 10], [2353, 12, 10], [2304, 13, 17], [2322, 14, 12], [2322, 15, 10],
        [2304, 16, 23], [2322, 17, 10], [2304, 18, 23], [2345, 19, 10], [2345, 20, 8], [2304, 21, 22],
      ]);
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
  test('completions: the pair-splice probe fires only inside render content', async () => {
    // The probe is an attribute-key ask: it costs a tolerant compile and
    // two face swaps against tsgo (the probe face in, the last-good face
    // back). A completion outside render content — a string literal in
    // ordinary code — pays none of that, while an ask inside an element
    // body still pays for its answer.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      await api.open('app.rip', APP + "s = 'hello wor'\n");   // line 12
      const swaps = () => api.tsgoNotifications().filter((m) => m === 'textDocument/didChange').length;
      const before = swaps();
      await api.completion('app.rip', 12, 14);             // after `wor`, inside the literal
      expect(swaps() - before).toBe(0);
      const broken = APP.replace('      input ref: el', '      input pla');
      await api.change('app.rip', broken, { waitPublish: false });
      const settled = swaps();
      const labels = labelsOf(await api.completion('app.rip', 10, 15));   // after `pla`
      expect(labels).toContain('placeholder');
      expect(swaps() - settled).toBeGreaterThanOrEqual(2);  // the probe face and its restore
    }, { traceTsgo: true });
  });

  test('hover: a component held by another binding presents the construct it holds', async () => {
    // A module binding assigned a component hovers the same construct
    // under the binding's own name — `const Local: new (…) => Button` —
    // so the constructed name is read off the tail, and the served
    // signature names the construct (the thing Local IS), never the
    // raw machinery.
    await inWorkspace({
      'package.json': STRICT_PKG,
      'button.rip': [
        'export Button = component',
        '  @label: string',
        '  render',
        '    button @label.value',
        '',
      ].join('\n'),
    }, async (api) => {
      const src = [
        "import { Button } from './button.rip'",  // 0
        'Local = Button',                         // 1
        'export Panel = component',               // 2
        '  render',                               // 3
        "    Local label: 'b'",                   // 4
        '',
      ].join('\n');
      await api.open('app.rip', src);
      const use = await api.hover('app.rip', 4, 6);        // inside `Local`
      expect(use?.contents?.value).toContain('```rip\ncomponent Button');
      expect(use?.contents?.value).toContain('label: string');
      expect(use?.contents?.value).not.toContain('__bind_');
      expect(use?.contents?.value).not.toContain('new (');
    });
  });

  test('hover: a component whose name carries `$` presents wherever its construct prints', async () => {
    // `$` is legal in a component name and a regex anchor — the tail
    // check reads the constructed name rather than interpolating it.
    // A reference above the declaration makes tsgo print the resolved
    // construct at both sites, and the holder presents the construct
    // it holds.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'Local = Menu$',          // 0
        '',
        'Menu$ = component',      // 2
        '  @label: string',       // 3
        '  render',               // 4
        '    span label',         // 5
        '',
      ].join('\n');
      await api.open('menu.rip', src);
      for (const [line, character] of [[0, 9], [2, 2]]) {     // inside `Menu$`
        const hover = (await api.hover('menu.rip', line, character))?.contents?.value;
        expect(hover).toContain('```rip\ncomponent Menu$\nprops: {\n  label: string\n}');
        expect(hover).not.toContain('new (');
      }
    });
  });

  test('hover: a forward-used component with only optional props presents at its declaration', async () => {
    // With every prop optional the hoisted binding's published type
    // carries the static `mount` beside the construct signature, and
    // tsgo prints the object form — `{ new (props?: …): Name;
    // mount(target?: any): Name; }` — where a lone signature prints
    // as an arrow. Both forms are the one construct.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'Teaser = component',     // 0
        '  render',               // 1
        "    Menu label: 'm'",    // 2
        '',
        'Menu = component',       // 4
        '  @label?: string',      // 5
        '  render',               // 6
        '    span label',         // 7
        '',
      ].join('\n');
      await api.open('menu.rip', src);
      const decl = (await api.hover('menu.rip', 4, 2))?.contents?.value;
      expect(decl).toContain('```rip\ncomponent Menu\nprops: {\n  label?: string\n}');
      expect(decl).not.toContain('mount(');
      expect(decl).not.toContain('__bind_');
    });
  });

  test('hover: a `<=>` target whose cell holds a function answers the value type', async () => {
    // The container's own rows hold `=>` and nested braces; the arm
    // split honors both, so the cell among the arms gives up its value
    // type rather than the whole container.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'Field = component',                    // 0
        '  @label?: string',                    // 1
        '  @pick?: ((x: number) => any)',       // 2
        '  render',                             // 3
        '    span label',                       // 4
        '',
        'T = component',                        // 6
        "  n := ''",                            // 7
        '  f := (x: number) -> x',              // 8
        '  render',                             // 9
        '    Field',                            // 10
        '      label <=> n',                    // 11
        '      pick <=> f',                     // 12
        '',
      ].join('\n');
      await api.open('bind.rip', src);
      const control = (await api.hover('bind.rip', 11, 6))?.contents?.value;
      expect(control).toContain('(bind) label: string');
      expect(control).not.toContain('read()');
      const fn = (await api.hover('bind.rip', 12, 6))?.contents?.value;
      expect(fn).toContain('(bind) pick: ((x: number) => any) | undefined');
      expect(fn).not.toContain('read()');
      expect(fn).not.toContain('touch');
    });
  });

  test('hover: a component signature whose literals spell separators and brackets presents whole', async () => {
    // The construct's rows are split at depth-0 separators; a literal
    // holding `;`, `|`, `{`, or `[` belongs to its string and never
    // moves a split. Required and optional spellings both present.
    await inWorkspace({ 'package.json': STRICT_PKG }, async (api) => {
      const src = [
        'Sep = component',              // 0
        "  @sep?: ';' | ','",           // 1
        "  @open?: '{' | '['",          // 2
        '  render',                     // 3
        "    span 'x'",                 // 4
        '',
        'Panel = component',            // 6
        '  render',                     // 7
        "    Sep sep: ','",             // 8
        '',
      ].join('\n');
      await api.open('sep.rip', src);
      const optional = (await api.hover('sep.rip', 8, 5))?.contents?.value;   // inside `Sep`
      expect(optional).toContain('```rip\ncomponent Sep');
      expect(optional).toMatch(/^  sep\?: ';' \| ','(?: \| undefined)?$/m);
      expect(optional).toMatch(/^  open\?: '\{' \| '\['(?: \| undefined)?$/m);
      expect(optional).not.toContain('read()');
      expect(optional).not.toContain('new (');
      await api.change('sep.rip', src.replace("@sep?: ';' | ','", "@sep: ';' | ','"));
      const required = (await api.hover('sep.rip', 8, 5))?.contents?.value;
      expect(required).toContain('```rip\ncomponent Sep');
      expect(required).toMatch(/^  sep: ';' \| ','$/m);
      expect(required).not.toContain('read()');
      expect(required).not.toContain('new (');
    });
  });
});
