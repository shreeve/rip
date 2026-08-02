// An LSP client against the REAL rip editor server, for gates whose claim
// is about the SESSION rather than a compile: config reactivity, completion
// scope. (Hovers are settled by the audit runner — twin oracle, plus
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
const TSCONFIG = path.join(ROOT, 'test/audit/tsconfig.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start a server over a temp workspace laid out from `files`
// ({ 'app.rip': '…', 'package.json': '…' }). A tsconfig.json is copied in
// unless the caller supplies one, matching what the runner does.
export async function openSession(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-lsp-'));
  const diags = new Map();
  // Publications are COUNTED, not just stored: "the server answered again"
  // is the thing a config-change test is waiting for, and the payload alone
  // cannot distinguish a fresh answer from the previous one.
  const pubs = new Map();
  const seen = new Map();
  const versions = new Map();

  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  if (!files['tsconfig.json'] && fs.existsSync(TSCONFIG)) {
    fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
  }

  const logs = [];
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    cwd: path.join(ROOT, 'packages/vscode'),
    onNotification: (m, p) => {
      // The server's own log stream. It is where a brokered surface says
      // WHY it declined — a dropped code action names itself and its
      // reason — so a test that only sees the empty result cannot tell a
      // refusal from an absence.
      if (m === 'window/logMessage') { logs.push(p.message ?? ''); return; }
      if (m !== 'textDocument/publishDiagnostics') return;
      diags.set(p.uri, p.diagnostics);
      pubs.set(p.uri, (pubs.get(p.uri) ?? 0) + 1);
    },
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

    // A raw LSP request, for surfaces with no helper of their own yet. The
    // helpers above exist because their surfaces need POLLING; anything that
    // answers once and correctly can go straight through here.
    request: (method, params) => client.request(method, params),

    // Everything the server has logged so far, oldest first.
    logs: () => [...logs],

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
    // Waits for a publication NEWER than the one the previous call
    // returned. A wait that ends when a publication merely EXISTS is
    // satisfied forever after the first one, leaving nothing but the
    // settle-sleep between a config change and reading the PREVIOUS
    // answer as if it were the response — and a fixed sleep is a bet
    // that the server is faster than whatever else the machine is doing.
    async diagnostics(name, { settle = 600, tries = 80, every = 100 } = {}) {
      const u = uri(name);
      const want = (seen.get(u) ?? 0) + 1;
      const deadline = Date.now() + tries * every;
      while ((pubs.get(u) ?? 0) < want && Date.now() < deadline) await sleep(every);
      if (!diags.has(u)) {
        throw new Error(
          `no diagnostics publication for ${name} within ${(tries * every) / 1000}s — ` +
          'the server never (re)published. An empty result is NOT the same as silence.',
        );
      }
      // Then let a burst finish: return once the count has held still for
      // `settle`, rather than after `settle` regardless of what is in
      // flight — an intermediate publication must not decide the answer.
      let quiet = 0;
      while (quiet < settle && Date.now() < deadline + settle) {
        const at = pubs.get(u);
        await sleep(every);
        quiet = pubs.get(u) === at ? quiet + every : 0;
      }
      seen.set(u, pubs.get(u) ?? 0);
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
    // Drops the counters with the payload: a later read then waits for the
    // first publication AFTER this point, which is what forgetting means.
    forget(name) { const u = uri(name); diags.delete(u); pubs.delete(u); seen.delete(u); },

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

    // A file DELETED from disk, announced exactly as VS Code's watcher
    // would. The counterpart to touch(): the document is never opened,
    // and only the watcher tells the server it is gone.
    remove(name) {
      try { fs.rmSync(path.join(dir, name)); } catch { /* already gone */ }
      client.notify('workspace/didChangeWatchedFiles', {
        changes: [{ uri: uri(name), type: 3 /* Deleted */ }],
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

    // The completion ITEM for one label, resolved. An auto-import's inserted
    // line arrives only through `completionItem/resolve` — the server
    // advertises `additionalTextEdits` as a resolve property, so the first
    // response carries the label and nothing to apply. A test that asserts
    // what LANDS IN THE BUFFER has to take this second step; asking only the
    // first answers what was offered, which is a different claim.
    // Polls for the same reason completions() does.
    async completionItem(name, line, character, label, { tries = 20, every = 300 } = {}) {
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/completion', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        const items = Array.isArray(r) ? r : (r?.items ?? []);
        const hit = items.find((it) => it.label === label);
        if (hit) return await client.request('completionItem/resolve', hit).catch(() => null);
        if (items.length) return null;   // live list, name absent — a real answer
        await sleep(every);
      }
      return null;
    },

    // Signature help at a position. Polls for a LIVE (non-null) answer the
    // same way completions() polls for a non-empty list, and for the same
    // reason: a request issued while tsgo is still building answers null,
    // which would silently satisfy any "help is absent" assertion. A null
    // after the full wait is returned as-is — that is a real answer, and a
    // test asserting it must first have proven the surface live at a
    // position that answers (the liveness-pair discipline).
    async signatureHelp(name, line, character, { tries = 20, every = 300 } = {}) {
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/signatureHelp', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        if (r?.signatures?.length) return r;
        await sleep(every);
      }
      return null;
    },

    // Go-to-definition targets at a position, as `name.rip:line` strings
    // relative to the session dir — what the editor would navigate to.
    // Polls for a non-empty answer for the same reason completions() polls
    // for a non-empty list: a request issued while tsgo is still building
    // answers EMPTY, and an empty answer is exactly what a broken mirror
    // produces, so the two must not be confusable. An empty result after
    // the full wait is returned as-is — a caller asserting it must have
    // proven the surface live somewhere that answers.
    async definitions(name, line, character, { tries = 20, every = 300 } = {}) {
      let targets = [];
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/definition', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        const items = Array.isArray(r) ? r : (r ? [r] : []);
        targets = items.map((it) => {
          const target = it.uri ?? it.targetUri;
          const range = it.range ?? it.targetSelectionRange ?? it.targetRange;
          return path.relative(dir, fileURLToPath(target)) + ':' + range.start.line;
        });
        if (targets.length) return targets;
        await sleep(every);
      }
      return targets;
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

    // Hover text at a .rip position, as the editor renders it — the fenced
    // signature with the markdown stripped. Polls for the same reason tokens
    // do: the answer rides an async program build, and a request issued while
    // tsgo is still building answers null. Returns null when the position
    // genuinely serves nothing, so a caller asserting SILENCE gets a real
    // answer rather than a timing artifact — the two are indistinguishable
    // without the poll, which is why one exists here.
    async hover(name, line, character, { tries = 20, every = 300 } = {}) {
      let last = null;
      for (let i = 0; i < tries; i++) {
        const r = await client.request('textDocument/hover', {
          textDocument: { uri: uri(name) }, position: { line, character },
        }).catch(() => null);
        const value = r?.contents?.value;
        if (typeof value === 'string' && value.trim()) {
          last = value;
          const fence = /```(?:typescript|ts)\n([^]*?)\n?```/.exec(value);
          if (fence) return fence[1].replace(/\s+/g, ' ').trim();
        }
        await sleep(every);
      }
      return last;
    },

    async close() {
      await client.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };

  return session;
}
