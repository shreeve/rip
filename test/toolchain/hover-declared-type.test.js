// An annotated declaration hovers its DECLARED type, even under a wrong initializer.
//
// This lives here rather than in the corpus because of what the corpus can and
// cannot hold. A wrong initializer publishes a diagnostic, and a positive
// fixture must publish none (the `verdict` dimension), so the shape can only
// exist in `corpus/errors/` — which sits outside every fixture walk, hover
// included. Extending that walk was considered and rejected: driven over all 32
// annotated declarations in `corpus/errors/11-types.errors.rip`, rip's hover
// matched the tsgo twin's answer EXACTLY, every one. There is no population
// question left to measure, and the audit exists to measure populations against
// a denominator, not to hold a behavior with a known-correct answer — CLAIMS.md
// says as much in its own charter.
//
// What is worth a gate is the one rip-specific way this could break. rip runs an
// enrichment pass that infers types for bindings the checker would leave bare
// (the pin pass, `patchUninitializedTypes`). If it ever reached a binding that
// already carries an annotation, the span would map perfectly and the answer
// would still be wrong — the mapping census watches whether spans resolve to the
// right bytes, not whether the server prefers a declared type over an inferred
// one. So the assertion is narrow and deliberate: the declared type wins.

import { describe, expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each line is `name: DeclaredType = <wrong value>`, so every hover has a
// declared answer AND a competing initializer. The alias case is the sharpest:
// TS resolves `Code` and answers `number`, so "the declared type" means the type
// the annotation denotes, not the spelling it was written with.
const CASES = [
  { name: 'plainNumber', src: "plainNumber: number = 'text'", expect: 'number' },
  { name: 'plainString', src: 'plainString: string = 42', expect: 'string' },
  { name: 'viaAlias', src: "viaAlias: Code = 'zero'", expect: 'number' },
  { name: 'viaShape', src: 'viaShape: Chart = { mode: 7 }', expect: 'Chart' },
  { name: 'viaUnion', src: "viaUnion: Mode = 'sideways'", expect: 'Mode' },
];

const SRC = [
  '# @ts-nocheck',
  'type Code = number',
  'type Chart = { mode: string }',
  "type Mode = 'on' | 'off'",
  '',
  ...CASES.map((c) => c.src),
].join('\n');

const norm = (h) => String(h?.contents?.value ?? h?.contents ?? '')
  .replace(/```[a-z]*\n?/g, '').replace(/\s+/g, ' ').trim();

// One server, one document, every position — the answers are independent, so
// paying the startup cost per case would only make the suite slower.
async function hoverAll() {
  const session = await openSession({ 'probe.rip': SRC, 'package.json': '{}' });
  try {
    session.open('probe.rip');
    // Wait for the program, not a fixed interval: an `any` here would otherwise
    // be indistinguishable from a hover taken before the build finished.
    await session.diagnostics('probe.rip');

    const lines = SRC.split('\n');
    const out = new Map();
    for (const c of CASES) {
      const line = lines.findIndex((l) => l.startsWith(`${c.name}:`));
      let text = '';
      for (let i = 0; i < 10; i++) {
        text = norm(await session.request('textDocument/hover', {
          textDocument: { uri: session.uri('probe.rip') }, position: { line, character: 0 },
        }).catch(() => null));
        if (text && !/:\s*any$/.test(text)) break;
        await sleep(200);
      }
      out.set(c.name, text);
    }
    return out;
  } finally {
    await session.close();
  }
}

describeExtended('hover answers the declared type, not the initializer\'s', () => {
  test('every annotated declaration under a wrong initializer hovers what it declared', async () => {
    const got = await hoverAll();
    // Asserted as one object so a failure names every case at once, and so a
    // hover that regressed to `any` cannot hide behind a passing neighbour.
    expect(Object.fromEntries([...got].map(([k, v]) => [k, v.replace(/^let\s+/, '')])))
      .toEqual(Object.fromEntries(CASES.map((c) => [c.name, `${c.name}: ${c.expect}`])));
  });
});
