// Incomplete-expression completion & signature help: the broker must
// serve member lists at a bare `items.` and signature help inside an
// unclosed `add(1, ` — the states users are in when they need help.
// Parseable controls (`items.length`, closed `add(1, 2)`) are not enough;
// those always had a face and are how the suite stayed green.
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';
import { startTsgo } from '../../packages/vscode/src/tsgo.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Twin oracle: identical incomplete TypeScript through raw tsgo — proves
// the answer is reachable on the same text the rip broker must serve.
async function withTsgo(tsText, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rip-inc-twin-'));
  const file = join(dir, 't.ts');
  writeFileSync(file, tsText);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', lib: ['ES2022'], noEmit: true },
  }));
  const { client } = await startTsgo(dir);
  const uri = 'file://' + file;
  try {
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text: tsText },
    });
    await sleep(1200);
    return await fn({ client }, uri);
  } finally {
    if (!client.dead) client.proc.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function twinCompletionLabels(tsText, line, character) {
  return withTsgo(tsText, async (tsgo, uri) => {
    const r = await tsgo.client.request('textDocument/completion', {
      textDocument: { uri }, position: { line, character },
    });
    const items = Array.isArray(r) ? r : (r?.items ?? []);
    return items.map((it) => it.label);
  });
}

async function twinSignatureHelp(tsText, line, character) {
  return withTsgo(tsText, async (tsgo, uri) => {
    return tsgo.client.request('textDocument/signatureHelp', {
      textDocument: { uri }, position: { line, character },
    });
  });
}

const activeParam = (help) => {
  if (!help?.signatures?.length) return null;
  const sig = help.signatures[help.activeSignature ?? 0];
  return sig.activeParameter ?? help.activeParameter ?? null;
};

describeExtended('incomplete expressions — completion & signature help', () => {
  test('member completion at a bare dot matches tsgo (fresh + after good compile)', async () => {
    const twinSrc = 'const items: number[] = [1, 2, 3];\nlet count = 0;\nlet x = items.\n';
    const twinLabels = await twinCompletionLabels(twinSrc, 2, 14);
    expect(twinLabels).toContain('map');
    expect(twinLabels).toContain('filter');

    const files = {
      'app.rip': 'items: number[] = [1, 2, 3]\ncount = 0\nx = items.\n',
      'package.json': '{}\n',
    };
    const s = await openSession(files);
    try {
      // Fresh incomplete buffer — never a successful compile of this text.
      s.open('app.rip');
      await s.diagnostics('app.rip').catch(() => {}); // parse diagnostic publication
      let labels = [];
      for (let i = 0; i < 15 && !labels.includes('map'); i++) {
        labels = await s.completions('app.rip', 2, 10, { poll: false });
        if (!labels.includes('map')) await sleep(300);
      }
      expect(labels).toContain('map');
      expect(labels).toContain('filter');

      // After a good compile, type the bare dot (stale-face trap).
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\ncount = 0\nx = items.map\n');
      await s.diagnostics('app.rip');
      s.forget('app.rip');
      s.change('app.rip', 'items: number[] = [1, 2, 3]\ncount = 0\nx = items.\n');
      await s.diagnostics('app.rip').catch(() => {});
      labels = [];
      for (let i = 0; i < 15 && !labels.includes('map'); i++) {
        labels = await s.completions('app.rip', 2, 10, { poll: false });
        if (!labels.includes('map')) await sleep(300);
      }
      expect(labels).toContain('map');
      expect(labels).toContain('filter');
    } finally {
      await s.close();
    }
  }, 120_000);

  test('signature help inside an unclosed call matches tsgo (fresh + mid-edit)', async () => {
    const twinSrc = 'function add(a: number, b: number): number { return a + b; }\nlet r = add(1, \n';
    const twin = await twinSignatureHelp(twinSrc, 1, 14);
    expect(twin?.signatures?.length).toBeGreaterThan(0);
    expect(twin.signatures[0].label).toMatch(/a:\s*number/);
    expect(activeParam(twin)).toBe(1);

    const def = 'def add(a: number, b: number): number\n  a + b\n\n';
    const s = await openSession({
      'app.rip': `${def}r = add(1, \n`,
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip').catch(() => {});
      let help = null;
      for (let i = 0; i < 15 && !help?.signatures?.length; i++) {
        help = await s.signatureHelp('app.rip', 3, 10);
        if (!help?.signatures?.length) await sleep(300);
      }
      expect(help?.signatures?.length).toBeGreaterThan(0);
      expect(help.signatures[0].label).toMatch(/a:\s*number/);
      expect(activeParam(help)).toBe(1);

      // Mid-edit regression: closed call → backspace into open args.
      s.forget('app.rip');
      s.change('app.rip', `${def}r = add(1, 2)\n`);
      await s.diagnostics('app.rip');
      const closed = await s.signatureHelp('app.rip', 3, 12);
      expect(closed?.signatures?.length).toBeGreaterThan(0);
      expect(activeParam(closed)).toBe(1);

      s.forget('app.rip');
      s.change('app.rip', `${def}r = add(1, \n`);
      await s.diagnostics('app.rip').catch(() => {});
      help = null;
      for (let i = 0; i < 15 && !help?.signatures?.length; i++) {
        help = await s.signatureHelp('app.rip', 3, 10);
        if (!help?.signatures?.length) await sleep(300);
      }
      expect(help?.signatures?.length).toBeGreaterThan(0);
      expect(activeParam(help)).toBe(1);
    } finally {
      await s.close();
    }
  }, 120_000);

  test('parseable controls still serve (anti-trap for complete-only gates)', async () => {
    const s = await openSession({
      'app.rip': [
        'items: number[] = [1, 2, 3]',
        'k = items.length',
        'def add(a: number, b: number): number',
        '  a + b',
        'r = add(1, 2)',
        '',
      ].join('\n'),
      'package.json': '{}\n',
    });
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      // `items.length` — complete member access (line 1, after the dot).
      const labels = await s.completions('app.rip', 1, 9);
      expect(labels).toContain('length');
      const help = await s.signatureHelp('app.rip', 4, 12);
      expect(help?.signatures?.length).toBeGreaterThan(0);
      expect(activeParam(help)).toBe(1);
    } finally {
      await s.close();
    }
  }, 90_000);
});
