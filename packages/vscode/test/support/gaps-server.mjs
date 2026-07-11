// Faithful harness (Philip Lindberg's editor-gaps bundle, relocated from
// editor-gaps/_server.mjs): drive the REAL src/server.js over LSP stdio,
// exactly as VS Code's language client does (initialize →
// didOpen/didChange → publishDiagnostics). This is the ONLY trustworthy
// way to characterize editor behavior: talking to tsgo directly
// reimplements the server's document/project handling and diverges from
// it — a tsgo-direct harness can "resolve" cross-file where the real
// server does not, which is exactly the false-optimism the bundle's
// retired _broker.mjs produced.
//
// api.open/change return after the server publishes diagnostics for that
// document. api.codes(path) / api.has(path, re) read the LAST published
// diagnostics for it (unused-var noise filtered).
import { fileURLToPath } from 'node:url';
import { LspClient, tsgoBinaryPath } from '../../src/tsgo.js';

const serverPath = fileURLToPath(new URL('../../src/server.js', import.meta.url));

export let tsgoAvailable = false;
try { tsgoBinaryPath(); tsgoAvailable = true; } catch { /* deps not installed */ }

const NOISE = new Set([6133, 6199]); // "declared but never read" / "all variables are unused"

// Run `fn(api)` against a live server rooted at `rootPath`, then tear down.
export async function session(rootPath, fn) {
  const published = [];
  const client = new LspClient('bun', [serverPath, '--stdio'], {
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') published.push(p); },
  });
  const uriOf = (p) => 'file://' + p;
  const latest = (p) => { const u = uriOf(p); for (let i = published.length - 1; i >= 0; i--) if (published[i].uri === u) return published[i]; return null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait for a publishDiagnostics for `p` that arrived after `sinceLen`.
  async function awaitPublish(p, sinceLen) {
    const u = uriOf(p);
    for (let i = 0; i < 40; i++) {
      for (let j = published.length - 1; j >= sinceLen; j--) if (published[j].uri === u) { await sleep(120); return; }
      await sleep(100);
    }
  }

  const versions = new Map();
  const api = {
    async open(p, text) {
      const before = published.length;
      versions.set(p, 1);
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(p), languageId: 'rip', version: 1, text } });
      await awaitPublish(p, before);
    },
    async change(p, text) {
      const before = published.length;
      const v = (versions.get(p) || 1) + 1;
      versions.set(p, v);
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(p), version: v }, contentChanges: [{ text }] });
      await awaitPublish(p, before);
    },
    codes(p) { return (latest(p)?.diagnostics ?? []).map((d) => d.code).filter((c) => !NOISE.has(c)); },
    has(p, re) { return (latest(p)?.diagnostics ?? []).some((d) => re.test(d.message)); },
  };

  try {
    await client.request('initialize', { processId: process.pid, rootUri: uriOf(rootPath), capabilities: {} });
    client.notify('initialized', {});
    return await fn(api);
  } finally {
    await client.stop();
  }
}
