// Emission never changes the parse it reads (src/compiler.js, parseSource):
// across the whole consumer corpus — every tracked package module and every
// language-suite row, on both faces — a second emission of one parse equals
// the first, and a rejection rejects again with the same message.
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { parseSource, emitSource } from '../../src/compiler.js';
import { packageInputs, rowInputs } from '../support/consumer-hashes.js';

const ROOT = join(import.meta.dir, '../..');

const emitted = (parsed, opts) => {
  try {
    const r = emitSource(parsed, opts);
    return JSON.stringify({ code: r.code, map: r.map, mappings: r.mappings, pinnables: r.pinnables });
  } catch (e) {
    return `ERR ${String(e?.message ?? e)}`;
  }
};

test('every consumer-corpus parse emits twice to identical output', async () => {
  const inputs = [...packageInputs(ROOT), ...await rowInputs(ROOT)];
  const drifted = [];
  for (const { key, src, path } of inputs) {
    for (const face of ['js', 'ts']) {
      const opts = { path, face, runtimeDelivery: 'none' };
      let parsed;
      try { parsed = parseSource(src, opts); } catch { continue; }
      const first = emitted(parsed, opts);
      const second = emitted(parsed, opts);
      if (second !== first) drifted.push(`${key} [${face}]${second.startsWith('ERR ') ? `: ${second.split('\n')[0]}` : ''}`);
    }
  }
  expect(drifted.join('\n')).toBe('');
}, 120_000);
