// Tier 3 pin probe (the evolving-let tiers' editor half) — the probe
// builder and hover parser as units, then the full loop over real LSP
// stdio: a still-hoisted def-referenced binding gets probed, pinned,
// and a wrong-typed write inside the def surfaces as a REAL TS
// diagnostic on rip source — the case TS7034 suppression hides today.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProbe, parseProbeHover } from '../src/pins.js';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed; tsgo-broker.test.js owns the loud notice */ }

const SERVER = path.resolve(import.meta.dir, '..', 'src', 'server.js');

describe('buildProbe', () => {
  test('splices a probe declaration above the first write, same indent', () => {
    const face = 'let items;\n\nitems = [1, 2];\nrest();\n';
    const stmt = face.indexOf('items = [1, 2];');
    const value = face.indexOf('[1, 2]');
    const { text, positions } = buildProbe(face, [
      { name: 'items', key: 'items@x', stmtGen: [stmt, stmt + 15], valueGen: [value, value + 6] },
    ]);
    expect(text).toContain('let __rip_probe_0_items = [1, 2];\nitems = [1, 2];');
    const p = positions[0];
    expect(text.split('\n')[p.line].slice(p.character)).toStartWith('__rip_probe_0_items');
  });

  test('multiple pinnables splice bottom-up and never collide, even same-named', () => {
    const face = 'a = f();\nfunction g() {\n  a = h();\n}\n';
    const s1 = 0, s2 = face.indexOf('a = h()');
    const { text, positions } = buildProbe(face, [
      { name: 'a', key: 'k1', stmtGen: [s1, s1 + 7], valueGen: [s1 + 4, s1 + 7] },
      { name: 'a', key: 'k2', stmtGen: [s2, s2 + 7], valueGen: [s2 + 4, s2 + 7] },
    ]);
    expect(text).toContain('let __rip_probe_0_a = f();\na = f();');
    expect(text).toContain('  let __rip_probe_1_a = h();\n  a = h();'); // indent copied
    expect(positions[0]).not.toBeNull();
    expect(positions[1]).not.toBeNull();
    expect(positions[0].line).toBeLessThan(positions[1].line);
  });
});

describe('parseProbeHover', () => {
  const hover = (sig) => ({ contents: { value: '```typescript\n' + sig + '\n```' } });
  test('extracts the declared type', () => {
    expect(parseProbeHover(hover('let __rip_probe_0_items: string[]'))).toBe('string[]');
  });
  test('collapses multi-line object types', () => {
    expect(parseProbeHover(hover('let __rip_probe_2_api: {\n  run(): number;\n}'))).toBe('{ run(): number; }');
  });
  test('rejects any, truncation, and junk', () => {
    expect(parseProbeHover(hover('let __rip_probe_0_x: any'))).toBeNull();
    expect(parseProbeHover(hover('let __rip_probe_0_x: { a: 1; ... 24 more }'))).toBeNull();
    expect(parseProbeHover({ contents: { value: 'no fence here' } })).toBeNull();
    expect(parseProbeHover(null)).toBeNull();
  });
  // An answer naming a probe symbol cannot outlive the probe file. tsgo types
  // an anonymous class by its own binding, so a class-expression RHS answers
  // `typeof __rip_probe_N_<name>` — accepted, that annotates the REAL binding
  // with a name deleted along with the probe, and tsgo then publishes TS2304
  // on legal code, spelled in vocabulary the author can find nowhere. The
  // probe round's doctrine is that every failure path lands on the status
  // quo, so this caches null and the binding stays an unpinned evolving
  // `any`. Not only SELF-reference: a sibling probe's symbol dangles the same
  // way once the file is gone.
  test('rejects an answer naming a probe symbol — it cannot outlive the probe file', () => {
    expect(parseProbeHover(hover('let __rip_probe_0_Box: typeof __rip_probe_0_Box'))).toBeNull();
    expect(parseProbeHover(hover('let __rip_probe_1_make: () => __rip_probe_0_Box'))).toBeNull();
    // The ordinary answer is unaffected — the clause reads the TYPE, never the
    // declaration's own minted name, which every probe answer carries.
    expect(parseProbeHover(hover('let __rip_probe_0_items: string[]'))).toBe('string[]');
  });
});

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
    const { LspClient } = await import('../src/tsgo.js');
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
