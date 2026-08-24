// Gates for the vendored Tailwind browser ship artifacts under dist/@rip.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from '../../support/spawn.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { describeExtended } from '../../support/extended.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const minPath = resolve(root, 'dist/@rip/tailwind.min.js');
const brPath = resolve(root, 'dist/@rip/tailwind.min.js.br');

describe('tailwind bundle artifact', () => {
  test('exists as min / brotli', () => {
    expect(existsSync(minPath)).toBeTrue();
    expect(existsSync(brPath)).toBeTrue();
    expect(existsSync(resolve(root, 'dist/@rip/tailwind.js'))).toBeFalse();
  });

  test('brotli decompresses to exact min bytes', () => {
    const minBytes = readFileSync(minPath);
    const brBytes = readFileSync(brPath);
    expect(brotliDecompressSync(brBytes).equals(minBytes)).toBeTrue();
  });

  test('ship copy is the Tailwind browser IIFE', () => {
    const code = readFileSync(minPath, 'utf8');
    expect(code.startsWith('"use strict"') || code.includes('(()=>{')).toBeTrue();
    expect(code).toContain('4.3.3');
  });
});

describeExtended('tailwind bundle freshness', () => {
  test('regeneration is byte-identical across tailwind.min.js / .min.js.br', () => {
    const beforeMin = readFileSync(minPath);
    const beforeBr = readFileSync(brPath);
    const run = spawnSync('bun', ['scripts/tailwind-bundle.mjs'], { cwd: root, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(readFileSync(minPath).equals(beforeMin)).toBeTrue();
    expect(readFileSync(brPath).equals(beforeBr)).toBeTrue();
    expect(brotliDecompressSync(readFileSync(brPath)).equals(readFileSync(minPath))).toBeTrue();
  });
});
