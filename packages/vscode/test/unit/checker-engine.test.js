// RIP_CHECKER selects the type-checking engine behind the one LSP client
// (src/tsgo.js). Every value either names an installed engine's binary
// or rejects with how to fix it; none falls back to a different engine,
// which would make a measurement or a CI run report on the wrong checker.

import { test, expect, describe } from 'bun:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { checkerBinaryPath, tsgoBinaryPath } from '../../src/tsgo.js';

const require = createRequire(import.meta.url);

describe('RIP_CHECKER', () => {
  test('unset or empty selects tsgo, the root typescript install', () => {
    const bin = checkerBinaryPath(undefined);
    expect(fs.existsSync(bin)).toBe(true);
    expect(bin).toContain(`${path.sep}typescript`);
    expect(checkerBinaryPath('')).toBe(bin);
    expect(checkerBinaryPath('tsgo')).toBe(bin);
  });

  test('tsgoBinaryPath reads the selection from the environment', () => {
    const saved = process.env.RIP_CHECKER;
    try {
      delete process.env.RIP_CHECKER;
      expect(tsgoBinaryPath()).toBe(checkerBinaryPath('tsgo'));
      process.env.RIP_CHECKER = 'not-an-engine';
      expect(() => tsgoBinaryPath()).toThrow('unknown engine "not-an-engine"');
    } finally {
      if (saved === undefined) delete process.env.RIP_CHECKER; else process.env.RIP_CHECKER = saved;
    }
  });

  test('an absolute path is used as given, and must exist', () => {
    const bin = checkerBinaryPath('tsgo');
    expect(checkerBinaryPath(bin)).toBe(bin);
    expect(() => checkerBinaryPath('/no/such/checker')).toThrow('RIP_CHECKER: /no/such/checker does not exist');
  });

  test('an unknown name rejects with the accepted values', () => {
    expect(() => checkerBinaryPath('tsc')).toThrow('use tsgo, tsrs, or an absolute path to a binary');
    expect(() => checkerBinaryPath('./relative/tsc')).toThrow('unknown engine');
  });

  test('tsrs resolves its native binary when installed, and says how to install it when not', () => {
    let installed = true;
    try { require.resolve('tsrs/package.json'); } catch { installed = false; }
    if (installed) expect(fs.existsSync(checkerBinaryPath('tsrs'))).toBe(true);
    else expect(() => checkerBinaryPath('tsrs')).toThrow('run `bun add -d tsrs` at the repository root');
  });
});
