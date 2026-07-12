// The two-mode diagnostic gate — rip.strict off vs on.
//
// rip's diagnostic posture is DIFFERENTIAL by design: the implicit-any
// family (TS7005–7053) is suppressed for everyone, because unannotated
// code is legal rip (D39/D40) — and `rip.strict` in package.json#rip
// turns that suppression OFF so a strictly-typed project gets the
// enforcement. The same flag drops the `!` on typed forwards, so
// TS2454 (use-before-assign) is checked.
//
// Neither half of that claim can be tested in ONE mode. "Suppressed by
// default" and "surfaces under strict" are statements about the
// DIFFERENCE between two runs, so the gate below runs the same source
// through the real editor server twice — once with no rip config, once
// with `{"rip": {"strict": true}}` — and asserts the delta in BOTH
// directions. A regression that made TS7006 fire on unannotated code in
// the DEFAULT mode would break rip's permissive contract just as badly
// as one that kept it hidden under strict; a single-mode gate is blind
// to one of those, whichever mode it picks.
//
// This is the gate the type-audit runner cannot be: it copies only a
// tsconfig.json into its workspace and never writes a package.json, so
// rip.strict is always false there and the strict path never runs.

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LspClient } from '../../packages/vscode/src/tsgo.js';
import { describeExtended } from '../support/extended.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const TSCONFIG = path.join(ROOT, 'test/type-audit/tsconfig.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Both defects in one file: an unannotated parameter (the implicit-any
// family's headline case, TS7006) and a typed forward read before it is
// assigned (TS2454, which the emitted `!` suppresses).
const SRC = [
  'greet = (name) -> name.toUpperCase()',
  'greet "world"',
  '',
  'y: number',
  'console.log y',
  'y = 5',
].join('\n');

// Drive the REAL editor server over LSP against a workspace whose
// package.json carries `rip` verbatim. Returns the published
// diagnostics for the document.
async function diagnose(ripConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-strict-'));
  const diags = new Map();
  let client;
  try {
    fs.writeFileSync(path.join(dir, 'probe.rip'), SRC);
    if (fs.existsSync(TSCONFIG)) fs.copyFileSync(TSCONFIG, path.join(dir, 'tsconfig.json'));
    // The server reads package.json#rip from disk (readProjectConfig,
    // nearest wins) on every refresh — writing the file IS the config.
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(ripConfig ? { rip: ripConfig } : {}, null, 2));

    client = new LspClient('bun', [SERVER, '--stdio'], {
      cwd: path.join(ROOT, 'packages/vscode'),
      onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') diags.set(p.uri, p.diagnostics); },
    });
    client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
    client.onServerRequest('client/registerCapability', () => null);
    client.onServerRequest('client/unregisterCapability', () => null);
    client.onServerRequest('window/workDoneProgress/create', () => null);

    await client.request('initialize', {
      processId: process.pid,
      rootUri: 'file://' + dir,
      capabilities: { workspace: { configuration: true } },
    });
    client.notify('initialized', {});

    const uri = 'file://' + path.join(dir, 'probe.rip');
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: SRC } });
    for (let i = 0; i < 60 && !diags.has(uri); i++) await sleep(100);
    await sleep(500);
    return diags.get(uri) ?? [];
  } finally {
    await client?.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const codes = (ds) => ds.map((d) => d.code);
const has = (ds, code) => codes(ds).includes(code);
const at = (ds, code) => ds.find((d) => d.code === code)?.range?.start;

describeExtended('rip.strict: the diagnostic posture is differential', () => {
  test('DEFAULT — the implicit-any family is suppressed and the `!` hides use-before-assign', async () => {
    const ds = await diagnose(null);
    // The permissive contract: unannotated code is legal rip, so the
    // implicit-any family never fires. A regression here is as bad as a
    // regression in the strict direction — it would put noise on every
    // unannotated binding in a language that permits them.
    expect(has(ds, 7006)).toBe(false);
    // The typed forward emits `let y!: number`, whose definite-assignment
    // assertion suppresses TS2454. That is the documented cost of D39.
    expect(has(ds, 2454)).toBe(false);
  }, 30_000);

  test('STRICT — rip.strict surfaces implicit-any (#1) and checks use-before-assign (#2)', async () => {
    const ds = await diagnose({ strict: true });
    // #1: the suppression is gated on !good.strict, so the family fires.
    expect(has(ds, 7006)).toBe(true);
    // #2: the emitter drops the `!`, so TS2454 reaches the user. The
    // emitter half is pinned in tiers.test.js; THIS is the half that
    // proves the diagnostic actually surfaces.
    expect(has(ds, 2454)).toBe(true);

    // Surfacing at the WRONG place is its own defect: these diagnostics
    // are computed on the TS face and mapped back, so pin the .rip
    // positions — a broker mapping regression would otherwise slide
    // through a code-only assertion.
    expect(at(ds, 7006)).toEqual({ line: 0, character: 9 });   // the `name` param
    expect(at(ds, 2454)).toEqual({ line: 4, character: 12 });  // the `y` read
  }, 30_000);

  test('the DELTA is exactly the strict-gated families — strict adds, never removes', async () => {
    const [loose, strict] = [await diagnose(null), await diagnose({ strict: true })];
    // Strict is additive: every diagnostic visible by default must still
    // be visible under strict. Strict may only ADD. If a code ever
    // disappears under strict, the gate is filtering, not enforcing.
    for (const c of new Set(codes(loose))) expect(codes(strict)).toContain(c);
    // And it must actually add something — an empty delta would mean the
    // flag is inert, which is precisely the state finding #1 was in
    // (fix present in source, never exercised by any harness).
    const added = new Set(codes(strict).filter((c) => !codes(loose).includes(c)));
    expect(added.size).toBeGreaterThan(0);
  }, 60_000);
});
