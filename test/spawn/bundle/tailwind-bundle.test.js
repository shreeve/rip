// Gates for the vendored Tailwind browser ship artifacts under dist/@rip.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from '../../support/spawn.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { describeExtended } from '../../support/extended.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifactPath = resolve(root, 'dist/@rip/tailwind.js');
const minPath = resolve(root, 'dist/@rip/tailwind.min.js');
const brPath = resolve(root, 'dist/@rip/tailwind.min.js.br');

describe('tailwind bundle artifact', () => {
  test('exists as js / min / brotli', () => {
    expect(existsSync(artifactPath)).toBeTrue();
    expect(existsSync(minPath)).toBeTrue();
    expect(existsSync(brPath)).toBeTrue();
  });

  test('brotli decompresses to exact min bytes', () => {
    const minBytes = readFileSync(minPath);
    const brBytes = readFileSync(brPath);
    expect(brotliDecompressSync(brBytes).equals(minBytes)).toBeTrue();
  });

  test('ship copy is the Tailwind browser IIFE', () => {
    const code = readFileSync(artifactPath, 'utf8');
    expect(code.startsWith('"use strict"') || code.includes('(()=>{')).toBeTrue();
    expect(code).toContain('4.3.2');
  });
});

describeExtended('tailwind bundle freshness', () => {
  test('regeneration is byte-identical across tailwind.js / .min.js / .min.js.br', () => {
    const beforeJs = readFileSync(artifactPath);
    const beforeMin = readFileSync(minPath);
    const beforeBr = readFileSync(brPath);
    const run = spawnSync('bun', ['scripts/tailwind-bundle.mjs'], { cwd: root, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(readFileSync(artifactPath).equals(beforeJs)).toBeTrue();
    expect(readFileSync(minPath).equals(beforeMin)).toBeTrue();
    expect(readFileSync(brPath).equals(beforeBr)).toBeTrue();
    expect(brotliDecompressSync(readFileSync(brPath)).equals(readFileSync(minPath))).toBeTrue();
  });
});
