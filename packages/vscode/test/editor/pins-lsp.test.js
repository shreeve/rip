// Tier 3 pin probe over real LSP stdio — a still-hoisted def-referenced
// binding gets probed, pinned, and a wrong-typed write inside the def
// surfaces as a REAL TS diagnostic on rip source — the case TS7034
// suppression hides today. Unit halves live in test/unit/pins.test.js.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed; tsgo-broker.test.js owns the loud notice */ }

const SERVER = path.resolve(import.meta.dir, '..', '..', 'src', 'server.js');

// The rip source: `items` is def-referenced (stays hoisted; evolving
// inference is dead — TS7034, suppressed today), and `breakIt` writes
// it wrong-typed. Without a pin the bug is invisible; with the probe
// round it must surface as a type error on the write line.
const SRC = `items = ['a', 'b', 'c']

def filterBy(query: string)
  items.filter (s) -> s.includes(query)

def breakIt()
  items = 42
`;

describe.skipIf(!tsgoAvailable)('pin probe over LSP stdio', () => {
  test('def-referenced hoisted binding gets pinned; wrong-typed write surfaces on rip source', async () => {
    const { LspClient } = await import('../../src/tsgo.js');
    const published = [];
    // A STRICT project: the wrong-write diagnostic is a pin giving the
    // implicit-any family PRECISION — strict is where that family
    // publishes, and gradual holds inference-with-certainty by design
    // (a pin is exactly materialized inference). The pin's other half,
    // truthful hover, is mode-independent and pinned elsewhere.
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-pin-'));
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ rip: { strict: true } }));
    const client = new LspClient('bun', [SERVER, '--stdio'], {
      onNotification: (method, params) => {
        if (method === 'textDocument/publishDiagnostics') published.push(params);
      },
    });
    try {
      await client.request('initialize', { processId: process.pid, rootUri: 'file://' + ws, capabilities: {} });
      client.notify('initialized', {});
      const uri = 'file://' + path.join(ws, 'app.rip');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: SRC },
      });
      // Two publishes expected: the unpinned pass, then the post-probe
      // re-refresh carrying the TS2322-class error. Poll for the error.
      let hit = null;
      for (let i = 0; i < 300 && !hit; i++) {
        await new Promise((r) => setTimeout(r, 100));
        for (const p of published) {
          hit = (p.diagnostics ?? []).find((d) => /not assignable|number/.test(d.message)) ?? hit;
        }
      }
      expect(hit).not.toBeNull();
      // Mapped to rip source: the wrong write sits on line 6 (0-based).
      expect(hit.range.start.line).toBe(6);
    } finally {
      await client.stop();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }, 45000);
});
