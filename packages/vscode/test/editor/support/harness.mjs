// The ONE live-server harness for the editor suites: drive the REAL
// src/server.js over LSP stdio, exactly as VS Code's language client does
// (initialize → didOpen/didChange → publishDiagnostics). Talking to tsgo
// directly reimplements the server's document/project handling and
// diverges from it — a tsgo-direct harness can "resolve" cross-file where
// the real server does not (the false optimism the retired editor-gaps
// _broker.mjs produced) — so every suite drives the server, through here.
//
// One session per call: a fresh server (and its own tsgo) over one
// workspace directory. Sharing a server across tests is not viable —
// the server is rooted at rootUri and scans the workspace for auto-import
// candidates — so a test owns its workspace and its server, and the
// harness keeps the session cheap instead.
//
// api.open/change return once the server has SETTLED that buffer version:
// it announces `[rip] settled <uri> v<n>` (window/logMessage) after the
// last publish a refresh owes — the merged set, and the post-probe
// re-publish when a pin probe ran — so nothing here sleeps to let a burst
// finish. api.codes(p) / api.has(p, re) read the LAST published
// diagnostics for it (unused-var noise filtered); every feature request
// is wrapped in current-buffer coordinates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LspClient, tsgoBinaryPath, decodeSemanticTokens } from '../../../src/tsgo.js';

export { LspClient, decodeSemanticTokens };

export const SERVER = fileURLToPath(new URL('../../../src/server.js', import.meta.url));
const TSGO_TRACE_TAP = fileURLToPath(new URL('./tsgo-trace.mjs', import.meta.url));

// Same availability guard in every live suite: dependencies absent → skip;
// the package's `bun run test` preflight turns a missing tsgo into a hard
// failure first (tsgo-broker.test.js owns the loud skip notice).
export let tsgoAvailable = false;
try { tsgoBinaryPath(); tsgoAvailable = true; } catch { /* dependencies not installed */ }

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The server's keystroke debounce (RIP_LSP_DEBOUNCE_MS; 100 ms for an
// editor). Every open/change here pays it once before the refresh runs,
// and no test types inside it — settleDocument flushes a pending refresh
// for any request that arrives early — so the harness runs it short.
export const DEBOUNCE_MS = 10;

// "declared but never read" / "all variables are unused" — filtered from codes().
const NOISE = new Set([6133, 6199]);

// A fresh temp workspace laid out from `files` ({ 'app.rip': '…' }).
export function makeWorkspace(files, prefix = 'rip-ws-') {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(ws, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return ws;
}

// One live session rooted at `ws` (an existing directory, or a path the
// test only ever names — the server tolerates a root it cannot read).
// Torn down after `fn`; the directory is the caller's to remove.
//
//   capabilities  the client capabilities sent in `initialize`
//   traceTsgo     preload the test-only tap (support/tsgo-trace.mjs) so
//                 `api.tsgoNotifications()` reads back every tsgo-bound
//                 notification method the server sent
//   awaitReady    resolve only after the startup cache revalidation logged
//                 (`project cache:` — the persistent-cache suites read it)
// At most RIP_SESSION_SLOTS sessions (server + tsgo each) live at once per
// test process: the suites run their tests concurrently.
const SLOTS = Number(process.env.RIP_SESSION_SLOTS ?? 3);
let live = 0;
const queue = [];
const acquire = async () => { if (live >= SLOTS) await new Promise((r) => queue.push(r)); live++; };
const release = () => { live--; queue.shift()?.(); };

export async function inSession(ws, fn, {
  capabilities = { workspace: { configuration: true } },
  traceTsgo = false,
  awaitReady = false,
} = {}) {
  const published = [];
  const logs = [];
  // Event-driven waits: a waiter is { test, resolve } over one stream,
  // tried against each arrival and dropped once it matches.
  const logWaiters = new Set();
  const publishWaiters = new Set();
  const arrive = (waiters, item) => {
    for (const w of waiters) if (w.test(item)) { waiters.delete(w); w.resolve(item); }
  };
  const trace = traceTsgo ? path.join(os.tmpdir(), path.basename(ws) + '.tsgo-trace') : null;
  if (trace) fs.writeFileSync(trace, '');
  const client = new LspClient('bun', [...(trace ? ['--preload', TSGO_TRACE_TAP] : []), SERVER, '--stdio'], {
    env: { ...process.env, RIP_LSP_DEBOUNCE_MS: String(DEBOUNCE_MS), ...(trace ? { RIP_TSGO_TRACE: trace } : {}) },
    onNotification: (m, p) => {
      if (m === 'textDocument/publishDiagnostics') { published.push(p); arrive(publishWaiters, p); }
      if (m === 'window/logMessage') { logs.push(p.message); arrive(logWaiters, p.message); }
    },
  });
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));

  // Paths are workspace-relative, or absolute when a suite names its own;
  // a URI (any scheme — the __external__ path opens `untitled:`) passes through.
  const uriOf = (p) => (/^[a-z][a-z0-9+.-]*:/i.test(p) ? p : 'file://' + (path.isAbsolute(p) ? p : path.join(ws, p)));
  const latest = (p) => {
    const u = uriOf(p);
    for (let i = published.length - 1; i >= 0; i--) if (published[i].uri === u) return published[i];
    return null;
  };
  // The first item of `stream` (already arrived at or after index `since`,
  // or arriving later) that `test` accepts; rejects at the deadline so a
  // server that never answers reads as that, not as a hung test.
  const awaitFrom = (stream, waiters, since, test, what, timeoutMs) => {
    for (let i = since; i < stream.length; i++) if (test(stream[i])) return Promise.resolve(stream[i]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(w); reject(new Error(`${what} — nothing within ${timeoutMs} ms`)); }, timeoutMs);
      const w = { test, resolve: (item) => { clearTimeout(timer); resolve(item); } };
      waiters.add(w);
    });
  };
  const awaitLog = (since, test, what, timeoutMs = 15000) => awaitFrom(logs, logWaiters, since, test, what, timeoutMs);
  const awaitPublished = (since, test, what, timeoutMs = 15000) => awaitFrom(published, publishWaiters, since, test, what, timeoutMs);
  // The server's settle line for `u` at `version`, arriving at or after
  // logs index `since` (versions restart at 1 on every open, so an older
  // open's line never satisfies a newer one's wait).
  const awaitSettled = (u, version, since) => {
    const line = `[rip] settled ${u} v${version}`;
    return awaitLog(since, (l) => l === line, `no settle for ${u} v${version}`);
  };
  const versions = new Map();
  const at = (p, line, character) => ({ textDocument: { uri: uriOf(p) }, position: { line, character } });
  const didOpen = (p, text) => {
    versions.set(p, 1);
    client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(p), languageId: 'rip', version: 1, text } });
  };

  const api = {
    ws,
    client,
    logs,
    uriOf,
    sleep,
    capabilities: null,
    get publishedCount() { return published.length; },
    // Every publish for `p` at or after index `since` in arrival order.
    publishesSince(p, since) { return published.slice(since).filter((x) => x.uri === uriOf(p)); },

    async open(p, text) {
      const since = logs.length;
      didOpen(p, text);
      await awaitSettled(uriOf(p), 1, since);
    },
    // didOpen with NO wait for the first compile — the editor's own
    // cold-open ordering (a cached answer is the only answer), and the
    // sequences where the next notification must land before the
    // server's first refresh of this buffer.
    openNoWait(p, text) { didOpen(p, text); },
    // Open a document by RAW uri (non-file schemes — the __external__ path).
    async openUri(uri, text) {
      const since = logs.length;
      client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text } });
      await awaitSettled(uri, 1, since);
    },
    close(p) {
      client.notify('textDocument/didClose', { textDocument: { uri: uriOf(p) } });
    },
    async change(p, text) {
      const since = logs.length;
      const v = (versions.get(p) || 1) + 1;
      versions.set(p, v);
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(p), version: v }, contentChanges: [{ text }] });
      await awaitSettled(uriOf(p), v, since);
    },
    watched(changes) {
      client.notify('workspace/didChangeWatchedFiles', {
        changes: changes.map(([p, type]) => ({ uri: uriOf(p), type })),
      });
    },

    diagnostics(p) { return latest(p)?.diagnostics ?? []; },
    codes(p) { return (latest(p)?.diagnostics ?? []).map((d) => d.code).filter((c) => !NOISE.has(c)); },
    has(p, re) { return (latest(p)?.diagnostics ?? []).some((d) => re.test(d.message)); },

    // Poll until `fn()` is truthy (async prunes land off the request path).
    async poll(fn, what) {
      for (let i = 0; i < 60; i++) {
        if (fn()) return;
        await sleep(150);
      }
      throw new Error(`condition never held: ${what}`);
    },
    // Wait until `pred(codes)` holds for `p` — cross-file re-checks land
    // asynchronously after watched-file events. Read on every publish
    // for `p` as it lands, and at once when the latest already satisfies.
    async until(p, pred) {
      const u = uriOf(p);
      if (pred(api.codes(p))) return;
      await awaitPublished(published.length, (x) => x.uri === u && pred(api.codes(p)),
        `condition never held for ${p}; last codes ${JSON.stringify(api.codes(p))}`);
    },
    // The first log line matching `re`, however long ago it arrived.
    untilLog(re) { return awaitLog(0, (l) => re.test(l), `no log line matching ${re}`); },

    hover: (p, line, character) => client.request('textDocument/hover', at(p, line, character)),
    completion: (p, line, character, context) => client.request('textDocument/completion', {
      ...at(p, line, character), ...(context ? { context } : {}),
    }),
    resolve: (item) => client.request('completionItem/resolve', item),
    resolveItem: (item) => client.request('completionItem/resolve', item),
    definition: (p, line, character) => client.request('textDocument/definition', at(p, line, character)),
    typeDefinition: (p, line, character) => client.request('textDocument/typeDefinition', at(p, line, character)),
    references: (p, line, character, includeDeclaration = true) => client.request('textDocument/references', { ...at(p, line, character), context: { includeDeclaration } }),
    signatureHelp: (p, line, character) => client.request('textDocument/signatureHelp', at(p, line, character)),
    prepareRename: (p, line, character) => client.request('textDocument/prepareRename', at(p, line, character)),
    rename: (p, line, character, newName) => client.request('textDocument/rename', { ...at(p, line, character), newName }),
    documentSymbol: (p) => client.request('textDocument/documentSymbol', { textDocument: { uri: uriOf(p) } }),
    documentLink: (p) => client.request('textDocument/documentLink', { textDocument: { uri: uriOf(p) } }),
    workspaceSymbol: (query) => client.request('workspace/symbol', { query }),
    semanticTokens: (p) => client.request('textDocument/semanticTokens/full', { textDocument: { uri: uriOf(p) } }),
    semanticTokensRange: (p, range) => client.request('textDocument/semanticTokens/range', { textDocument: { uri: uriOf(p) }, range }),
    codeAction: (p, range, diagnostics, only) => client.request('textDocument/codeAction', {
      textDocument: { uri: uriOf(p) }, range, context: { diagnostics, ...(only ? { only } : {}) },
    }),
    tsgoNotifications: () => (trace ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean) : []),
  };

  await acquire();
  try {
    const init = await client.request('initialize', { processId: process.pid, rootUri: uriOf(ws), capabilities });
    api.capabilities = init.capabilities;
    client.notify('initialized', {});
    if (awaitReady) await api.untilLog(/project cache:/); // startup revalidation complete
    return await fn(api);
  } finally {
    await client.stop();
    release();
    if (trace) fs.rmSync(trace, { force: true });
  }
}

// One session over a fresh workspace laid out from `files`, torn down after.
export async function inWorkspace(files, fn, { prefix, ...options } = {}) {
  const ws = makeWorkspace(files, prefix);
  try {
    return await inSession(ws, fn, options);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}
