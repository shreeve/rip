// An LSP client against the REAL rip editor server, for gates whose claim
// is about the SESSION rather than a compile: config reactivity, completion
// scope. (Hovers are settled by the type-audit runner — twin oracle, plus
// hover-pins.json for the rip-native remainder — not from here.)
//
// LSP is the whole protocol, so a session-shaped claim is expressible as a
// test. "The editor re-governs an open doc when config changes, with no
// reload" is: open ONCE, never re-open, write the file, notify, observe.
// Only what belongs to the VS Code CLIENT — activation, the rendered popup,
// "offered as you type" — needs a human in an editor.
//
// Everything here drives the real server over stdio. Nothing is mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LspClient, decodeSemanticTokens } from '../../packages/vscode/src/tsgo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const TSCONFIG = path.join(ROOT, 'test/type-audit/tsconfig.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start a server over a temp workspace laid out from `files`
// ({ 'app.rip': '…', 'package.json': '…' }). A tsconfig.json is copied in
// unless the caller supplies one, matching what the runner does.
export async function openSession(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-lsp-'));
  const diags = new Map();
  const versions = new Map();

  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  if (!files['tsconfig.json'] && fs.existsSync(TSCONFIG)) {
    fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
  }

  const client = new LspClient('bun', [SERVER, '--stdio'], {
    cwd: path.join(ROOT, 'packages/vscode'),
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') diags.set(p.uri, p.diagnostics); },
  });
  // Capture what the server asks the CLIENT to watch. This matters: a
  // didChangeWatchedFiles notification only ever arrives for a glob the
  // server registered, so a handler that reacts perfectly to a file it
  // never asked to watch is dead code in a real editor. A test client can
  // notify unconditionally and thus prove nothing about the registration —
  // so the registration is captured here and asserted separately.
  const watched = [];
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
  client.onServerRequest('client/registerCapability', (p) => {
    for (const r of p?.registrations ?? []) {
      for (const w of r.registerOptions?.watchers ?? []) watched.push(w.globPattern);
    }
    return null;
  });
  client.onServerRequest('client/unregisterCapability', () => null);
  client.onServerRequest('window/workDoneProgress/create', () => null);

  const init = await client.request('initialize', {
    processId: process.pid,
    rootUri: 'file://' + dir,
    capabilities: {
      workspace: { configuration: true, didChangeWatchedFiles: { dynamicRegistration: true } },
      textDocument: { semanticTokens: { formats: ['relative'], tokenTypes: [], tokenModifiers: [], requests: { full: true } } },
    },
  });
  client.notify('initialized', {});

  // The legend the SERVER advertised. Token indices mean nothing without it,
  // so a gate that reads tokens must fail loudly when it is absent rather than
  // decode against an empty legend and find nothing to assert.
  const legend = init?.capabilities?.semanticTokensProvider?.legend ?? null;

  const uri = (name) => 'file://' + path.join(dir, name);

  const session = {
    dir,
    uri,

    // The globs the server registered a file-watcher for. Real editors send
    // didChangeWatchedFiles for these and nothing else.
    //
    // Registration rides an async client/registerCapability request, so poll
    // for it rather than sleeping a fixed interval — a fixed sleep turns a
    // loaded machine into a false failure.
    async watchedGlobs({ tries = 40, every = 100 } = {}) {
      for (let i = 0; i < tries && !watched.length; i++) await sleep(every);
      return [...watched];
    },

    // didOpen. Call this ONCE per document in a reactivity gate — the whole
    // point of those is that nothing re-opens the doc.
    open(name) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      client.notify('textDocument/didOpen', {
        textDocument: { uri: uri(name), languageId: 'rip', version: 1, text },
      });
    },

    // Wait for a diagnostics publication for `name`, then settle, and return
    // what was published.
    //
    // THROWS if nothing is published within the window. This is the whole
    // point: an empty publication ("the server looked and found nothing") and
    // no publication at all ("the server never looked") are different facts,
    // and a helper that returned [] for both would let every `toEqual([])`
    // assertion pass against a server that had stopped publishing entirely —
    // the exact regression these gates exist to catch. A test that wants to
    // assert silence must first know the server spoke.
    async diagnostics(name, { settle = 600, tries = 80, every = 100 } = {}) {
      const u = uri(name);
      for (let i = 0; i < tries && !diags.has(u); i++) await sleep(every);
      if (!diags.has(u)) {
        throw new Error(
          `no diagnostics publication for ${name} within ${(tries * every) / 1000}s — ` +
          'the server never (re)published. An empty result is NOT the same as silence.',
        );
      }
      await sleep(settle);
      return diags.get(u) ?? [];
    },

    // An EDIT to an open document (didChange). Distinct from touch(): this
    // is the user typing, and it drives the server's refresh() for that
    // document — which in turn re-pulls diagnostics for every OTHER open
    // document. That cross-file re-pull is the only path to
    // repullDiagnostics(), so it is the only way to exercise the guard that
    // stops a re-pull from resurrecting a noCheck-silenced file.
    change(name, text) {
      versions.set(name, (versions.get(name) ?? 1) + 1);
      fs.writeFileSync(path.join(dir, name), text);
      client.notify('textDocument/didChange', {
        textDocument: { uri: uri(name), version: versions.get(name) },
        contentChanges: [{ text }],
      });
    },

    // Forget what was published, so the next `diagnostics()` waits for a
    // FRESH publication rather than reading a stale one. This is what makes
    // "the open doc was re-governed" observable.
    forget(name) { diags.delete(uri(name)); },

    codes: (ds) => ds.map((d) => d.code),

    // Rewrite a file on disk and tell the server, exactly as VS Code's file
    // watcher would. No didOpen, no didChange — the document is untouched.
    //
    // Synchronous on purpose: `notify` is fire-and-forget, so there is nothing
    // to await. An `async` signature here would promise callers that the server
    // had processed the change by the time it resolved — it has not. Waiting is
    // `diagnostics()`'s job, and it now throws rather than mistaking a server
    // that never answered for one that answered "clean".
    touch(name, text) {
      if (text !== undefined) fs.writeFileSync(path.join(dir, name), text);
      client.notify('workspace/didChangeWatchedFiles', {
        changes: [{ uri: uri(name), type: 2 /* Changed */ }],
      });
    },

    // Completion labels at a position.
    //
    // A completion issued while tsgo is still building the program answers
    // with an EMPTY list — which would silently satisfy any "X is not
    // offered" assertion and make a scope test pass for the wrong reason.
    // So poll until the list is live (non-empty), and only then let the
    // caller judge membership. An empty result after the full wait is
    // returned as-is: that is a real answer, and a test may assert on it.
    //
    // `poll: false` — single shot for probes where empty is a meaningful
    // wrong answer (do not spin waiting for members that never arrive).
    async completions(name, line, character, { tries = 20, every = 300, poll = true } = {}) {
      let labels = [];
      const limit = poll ? tries : 1;
      for (let i = 0; i < limit; i++) {
        const r = await client.request('textDocument/completion', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        const items = Array.isArray(r) ? r : (r?.items ?? []);
        labels = items.map((it) => it.label);
        if (labels.length) return labels;
        if (!poll) return labels;
        await sleep(every);
      }
      return labels;
    },

    // Full completion items (for additionalTextEdits / data assertions).
    async completionItems(name, line, character, { tries = 20, every = 300 } = {}) {
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/completion', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        const items = Array.isArray(r) ? r : (r?.items ?? []);
        if (items.length) return items;
        await sleep(every);
      }
      return [];
    },

    async completionItem(name, line, character, label, opts = {}) {
      for (let i = 0; i < (opts.tries ?? 20); i++) {
        const items = await this.completionItems(name, line, character, { tries: 1, every: 0 });
        const hit = items.find((it) => it.label === label);
        if (hit) return hit;
        await sleep(opts.every ?? 300);
      }
      return null;
    },

    async codeActions(name, range, diagnostics, { tries = 20, every = 300 } = {}) {
      let last = [];
      for (let i = 0; i < tries; i++) {
        last = await client.request('textDocument/codeAction', {
          textDocument: { uri: uri(name) },
          range,
          context: { diagnostics },
        }).catch(() => []);
        if (Array.isArray(last) && last.length) return last;
        await sleep(every);
      }
      return Array.isArray(last) ? last : [];
    },

    applyTextEdits(text, edits) {
      const sorted = [...(edits ?? [])].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
        return b.range.start.character - a.range.start.character;
      });
      const lines = text.split('\n');
      for (const edit of sorted) {
        const { start, end } = edit.range;
        if (start.line === end.line) {
          const line = lines[start.line] ?? '';
          lines[start.line] = line.slice(0, start.character) + edit.newText + line.slice(end.character);
        } else {
          const first = (lines[start.line] ?? '').slice(0, start.character);
          const last = (lines[end.line] ?? '').slice(end.character);
          const inserted = edit.newText.split('\n');
          inserted[0] = first + inserted[0];
          inserted[inserted.length - 1] = inserted[inserted.length - 1] + last;
          lines.splice(start.line, end.line - start.line + 1, ...inserted);
        }
      }
      return lines.join('\n');
    },

    // Signature help at a position, or null. Polls briefly while tsgo
    // settles; a persistent null is returned as-is.
    async signatureHelp(name, line, character, { tries = 20, every = 300 } = {}) {
      let last = null;
      for (let i = 0; i < tries; i++) {
        last = await client.request('textDocument/signatureHelp', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        if (last?.signatures?.length) return last;
        await sleep(every);
      }
      return last;
    },

    // Semantic tokens for an open doc, decoded against the server's own legend
    // into absolute rows on .rip source. Throws when the server advertised no
    // legend: an empty token list would satisfy any "modifier is absent"
    // assertion for free, so a gate must never reach that state quietly.
    //
    // Tokens ride the same async program build as hovers, so poll for a live
    // list rather than sleeping a fixed interval.
    async semanticTokens(name, { tries = 20, every = 300 } = {}) {
      if (!legend) throw new Error('server advertised no semanticTokens legend — cannot decode tokens');
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/semanticTokens/full', {
          textDocument: { uri: uri(name) },
        }).catch(() => null);
        const rows = decodeSemanticTokens(r?.data ?? [], legend);
        if (rows.length) return rows;
        await sleep(every);
      }
      return [];
    },

    async close() {
      await client.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };

  return session;
}
