// Typed routes at the editor surface, over real LSP stdio against the
// real server + tsgo:
//
//   COMPLETIONS inside an `href:` string literal are tsgo-native — the
//     `__ripRoute` wrap constrains the literal to the route union, so
//     the members arrive as ordinary string-literal completions with no
//     completion code of ours involved. BOTH quote styles: a
//     single-quoted rip string emits double-quoted in the face, and the
//     quote-twin interior mapping (translate.js) serves the cursor
//     linearly through the delimiter difference.
//   DIAGNOSTICS on a route typo land on the literal and read PRETTIFIED:
//     a dynamic member renders as its parameterized display
//     (`/orders/:id`), never as the checked `${string}` form.
//
// Same availability guard as the other live suites.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed */ }

const SERVER = path.resolve(import.meta.dir, '..', '..', 'src', 'server.js');

const STASH = [
  "import { source } from 'rip/app'",
  '',
  'export stash =',
  "  user: source fetch: -> Promise.resolve { name: 'Ada' }",
  '  count: 0',
  '',
].join('\n');

const FIXTURE = {
  'package.json': JSON.stringify({ rip: { strict: true } }),
  'index.rip': 'x = 1\n',
  'app/stash.rip': STASH,
  'app/routes/cart.rip': "export Cart = component\n  render\n    div 'cart'\n",
  'app/routes/orders/index.rip': "export Orders = component\n  render\n    div 'orders'\n",
  'app/routes/orders/[id].rip': 'export Order = component\n  render\n    div @params.id\n',
};

async function inWorkspace(fn) {
  const { LspClient } = await import('../../src/tsgo.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-routes-ed-'));
  for (const [rel, content] of Object.entries(FIXTURE)) {
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
  const api = {
    uriOf,
    async open(rel, text) {
      const before = published.length;
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(rel), languageId: 'rip', version: 1, text } });
      const u = uriOf(rel);
      for (let i = 0; i < 100; i++) {
        for (let j = published.length - 1; j >= before; j--) {
          if (published[j].uri === u) { await sleep(120); return; }
        }
        await sleep(100);
      }
      throw new Error(`no publishDiagnostics for ${rel} arrived`);
    },
    diagnostics(rel) {
      const u = uriOf(rel);
      for (let i = published.length - 1; i >= 0; i--) if (published[i].uri === u) return published[i].diagnostics;
      return [];
    },
    async change(rel, text, version) {
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(rel), version }, contentChanges: [{ text }] });
      await sleep(1500);
    },
    completion: (rel, line, character) => client.request('textDocument/completion', {
      textDocument: { uri: uriOf(rel) }, position: { line, character },
    }),
    hover: (rel, line, character) => client.request('textDocument/hover', {
      textDocument: { uri: uriOf(rel) }, position: { line, character },
    }),
  };
  try {
    await client.request('initialize', {
      processId: process.pid,
      rootUri: 'file://' + ws,
      // snippetSupport mirrors VS Code: a dynamic member's item inserts
      // its param slots as tabstops.
      capabilities: {
        workspace: { configuration: true },
        textDocument: { completion: { completionItem: { snippetSupport: true } } },
      },
    });
    client.notify('initialized', {});
    return await fn(api);
  } finally {
    await client.stop();
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

describe.skipIf(!tsgoAvailable)('typed routes in the editor', () => {
  test('a mid-file trailing dot still serves member completions (the dot probe)', async () => {
    await inWorkspace(async (api) => {
      // Legal-continuation territory: the trailing dot merges the NEXT
      // member into the expression (`x = a.` + `y = 2` is `x = a.y = 2`),
      // so recovery cannot hole it, the merged program will not emit
      // (the swallowed gate), and the mapped road has nothing to stand
      // on. The dot probe repairs the BUFFER instead and asks tsgo on
      // an overlay of the buffer's own face document.
      const valid = [
        'export Home = component',
        '  user <~ @app.data.user',
        '  render',
        "    div 'home'",
        '',
      ].join('\n');
      await api.open('app/routes/index.rip', valid);
      const broken = [
        'export Home = component',
        "  u ~= @app.data.source('user').",
        '',
        '  user <~ @app.data.user',
        '  render',
        "    div 'home'",
        '',
      ].join('\n');
      await api.change('app/routes/index.rip', broken, 2);
      const completion = await api.completion('app/routes/index.rip', 1, "  u ~= @app.data.source('user').".length);
      const labels = (completion?.items ?? []).map((i) => i.label);
      expect(labels).toEqual(expect.arrayContaining(['value', 'loading', 'error', 'refetch', 'reset']));

      // The NEAR-MISS face — the shape real typing leaves behind. The
      // buffer one keystroke ago (`@app.data`) compiled clean, so
      // lastGood is not missing the line, it is missing one CHARACTER,
      // and the alignment guard lands the fresh `.`'s cursor on the end
      // of `data` in the old face — where tsgo answers `data` among
      // `@app`'s members: non-empty, plausible, one segment wrong. The
      // stale gate must hand this ask to the probe too.
      const nearMiss = (tail) => [
        'export Home = component',
        `  p ~= @app.data${tail}`,
        '',
        '  user <~ @app.data.user',
        '  render',
        "    div 'home'",
        '',
      ].join('\n');
      await api.change('app/routes/index.rip', nearMiss(''), 3);
      await api.change('app/routes/index.rip', nearMiss('.'), 4);
      const stale = await api.completion('app/routes/index.rip', 1, '  p ~= @app.data.'.length);
      const staleLabels = (stale?.items ?? []).map((i) => i.label);
      expect(staleLabels).toEqual(expect.arrayContaining(['user', 'count']));
      expect(staleLabels).not.toContain('data');

      // The DANGLING dot that COMPILES: when the next member is not a
      // gate (`mounted:` here), the tolerant emit passes the trailing
      // dot through verbatim — `this.app.data.` in the face, current,
      // syntactically invalid TS. The cursor mapping again lands on the
      // end of `data`; the ask-fidelity gate (source prefix must equal
      // face prefix at the landing) is what hands THIS one to the probe
      // — staleness never enters, the face is the buffer's own.
      const dangling = [
        'export Home = component',
        '  p ~= @app.data.',
        '',
        "  mounted: -> document.title = 'home'",
        '  render',
        "    div 'home'",
        '',
      ].join('\n');
      await api.change('app/routes/index.rip', dangling, 5);
      const current = await api.completion('app/routes/index.rip', 1, '  p ~= @app.data.'.length);
      const currentLabels = (current?.items ?? []).map((i) => i.label);
      expect(currentLabels).toEqual(expect.arrayContaining(['user', 'count']));
      expect(currentLabels).not.toContain('data');
    });
  }, 90_000);

  test('href completions are tsgo-native and a typo diagnostic reads prettified', async () => {
    await inWorkspace(async (api) => {
      // The open buffer: one valid href to complete inside, one typo.
      const text = [
        'export Home = component',
        "  go: -> @router.push('/cartz')",
        "  peek: -> @app.data.source('user').value",
        '  render',
        '    a href: "/", "home"',
        "    a href: '/x', 'single'",
        "    a href: '/orderz', 'typo'",
        '',
      ].join('\n');
      await api.open('app/routes/index.rip', text);

      // The ROUTE-ARMED ambience must hover clean: the union-checked
      // router and the instantiated stash methods are named references,
      // so no `import(...)` splice and no minted `__` name may surface
      // (the editor-features no-leak sweep runs UNARMED and cannot see
      // these; this is the armed half of that gate).
      const LEAK = /__[A-Za-z]|import\s*\(/;
      for (const [line, ch] of [[1, 12], [1, 18], [2, 14], [2, 22]]) {
        const value = (await api.hover('app/routes/index.rip', line, ch))?.contents?.value;
        if (typeof value === 'string') expect(value).not.toMatch(LEAK);
      }

      // Inside the "/" literal (line 4, after the slash): the union's
      // members arrive as string-literal completions — tsgo's statics
      // plus our own item for each DYNAMIC member, labeled by display
      // and inserting its static prefix. Every item carries a textEdit
      // replacing the literal's INTERIOR, so accepting one replaces the
      // typed prefix instead of doubling it ('//cart').
      const completion = await api.completion('app/routes/index.rip', 4, 14);
      const labels = (completion?.items ?? []).map((i) => i.label);
      expect(labels).toEqual(expect.arrayContaining(['/cart', '/orders', '/orders/:id']));
      const cart = completion.items.find((i) => i.label === '/cart');
      expect(cart.textEdit).toEqual({
        range: { start: { line: 4, character: 13 }, end: { line: 4, character: 14 } },
        newText: '/cart',
      });
      const dynamic = completion.items.find((i) => i.label === '/orders/:id');
      expect(dynamic.textEdit.newText).toBe('/orders/${1:id}');
      expect(dynamic.insertTextFormat).toBe(2); // Snippet — the id slot lands pre-selected
      expect(dynamic.detail).toBe('id: string'); // the params the route captures

      // The single-quoted literal serves identically — the idiomatic
      // quote style, mapped through the quote-twin interior.
      const single = await api.completion('app/routes/index.rip', 5, 15);
      expect((single?.items ?? []).map((i) => i.label)).toEqual(expect.arrayContaining(['/cart', '/orders', '/orders/:id']));

      // A push ARGUMENT serves the same finished list: the emitter
      // records the router-call span, so the slot is a recorded fact —
      // the gate never infers route-ness from the labels tsgo happens
      // to return (a user union that subsets the statics stays
      // untouched by construction).
      const push = await api.completion('app/routes/index.rip', 1, "  go: -> @router.push('/".length);
      expect((push?.items ?? []).map((i) => i.label)).toEqual(expect.arrayContaining(['/cart', '/orders', '/orders/:id']));

      // A typo'd href anchors on the pair's KEY — the anchor every
      // other mistyped attribute reports on — and the dynamic member
      // reads as its display form; `${string}` never surfaces.
      const diags = api.diagnostics('app/routes/index.rip');
      const typo = diags.find((d) => d.message.includes('"/orderz"'));
      expect(typo).toBeDefined();
      expect(typo.range.start).toEqual({ line: 6, character: 6 });
      expect(typo.range.end).toEqual({ line: 6, character: 10 });
      expect(typo.message).toContain('`/orders/:id`');
      expect(typo.message).not.toContain('${string}');

      // A push typo anchors on the METHOD NAME — the other half of the
      // meaningful-token rule.
      const pushTypo = diags.find((d) => d.message.includes('"/cartz"'));
      expect(pushTypo).toBeDefined();
      expect(pushTypo.range.start).toEqual({ line: 1, character: 17 });
      expect(pushTypo.range.end).toEqual({ line: 1, character: 21 });
    });
  }, 60_000);
});
