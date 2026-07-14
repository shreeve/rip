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
import { LspClient } from '../../packages/vscode/src/tsgo.js';

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

  await client.request('initialize', {
    processId: process.pid,
    rootUri: 'file://' + dir,
    capabilities: {
      workspace: { configuration: true, didChangeWatchedFiles: { dynamicRegistration: true } },
    },
  });
  client.notify('initialized', {});

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
    async completions(name, line, character, { tries = 20, every = 300 } = {}) {
      let labels = [];
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/completion', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        const items = Array.isArray(r) ? r : (r?.items ?? []);
        labels = items.map((it) => it.label);
        if (labels.length) return labels;
        await sleep(every);
      }
      return labels;
    },

    async close() {
      await client.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };

  return session;
}
