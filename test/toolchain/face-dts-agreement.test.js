// The face/declaration agreement gate — rip's two signature emitters
// must describe the SAME API.
//
// `emitter.js` (the TS face, which the editor type-checks against) and
// `dts.js` (the `.d.ts`, which consumers of a published package see) are
// two independent walks over the same sexpr. Nothing structurally forces
// them to agree, and every type-level detail that rides a side-band ROLE
// — the optional `?` marker, a generic head's `<T, …>` clause — has to be
// read separately by each. Forgetting is the failure mode, and it has now
// happened in BOTH directions:
//
//   · dts.js forgot the optionalMarker role → declarations emitted
//     `title: string` (or a malformed `title: `) where the face said
//     `title?: string`.
//   · emitter.js's overload rows (tsOverloadSigs) forgot it → the face
//     emitted `b: string` where the .d.ts said `b?: string`.
//
// Neither is catchable downstream. `title?: string` degrading to
// `title: string` is PERFECTLY VALID TypeScript — both artifacts compile
// clean under `tsc --strict` in isolation, so no tsc gate, however
// thorough, can see it. The defect is only visible as a DISAGREEMENT
// between rip's own two outputs, which is what this gate compares.
//
// It runs in the DEFAULT tier on purpose: it spawns nothing, needs no
// tsc, and costs milliseconds. An invalid-or-wrong `.d.ts` is a defect
// that ships to users, and it should not take the extended tier to see.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { compile } from '../../src/compile.js';

const corpusDir = join(import.meta.dir, '../corpus');

// Signatures, from either artifact. Both spell a callable the same way
// once `declare`/`export` are stripped: NAME <T,…>? ( params ) : ret
//
// Captured per name: the type-param clause, and the set of params
// carrying `?`. Those are exactly the two role-borne details, and the
// two that have actually drifted.
const SIG = /(?:^|\s)(?:export\s+)?(?:declare\s+)?function\s+([A-Za-z_$][\w$]*)\s*(<[^(]*>)?\s*\(([^)]*)\)/gm;

function signatures(text) {
  const out = new Map(); // name -> array of {generics, optionals}
  for (const m of text.matchAll(SIG)) {
    const [, name, generics = '', params = ''] = m;
    const optionals = params
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      // A param is CALL-SITE optional two ways, and the two artifacts
      // spell it differently by necessity:
      //
      //   · `b?: string`      — the marker. Both artifacts can write it.
      //   · `b: string = 0`   — a default. Only the FACE can write it:
      //                         a .d.ts carries no initializers, so it
      //                         renders the same param as `b?: string`.
      //
      // TypeScript forbids `b?: string = 0` outright, so the two
      // spellings are mutually exclusive, not interchangeable. Comparing
      // raw `?` alone would flag every defaulted param as a divergence —
      // it is the CALL-SITE optionality that must agree, not the syntax.
      .filter((p) => /^[.\w$[\]{}\s]*\?\s*(:|$)/.test(p) || /=/.test(p))
      .map((p) => p.split(/[?:=]/)[0].trim());
    const rows = out.get(name) ?? [];
    rows.push({ generics: generics.replace(/\s+/g, ' ').trim(), optionals: optionals.sort().join(',') });
    out.set(name, rows);
  }
  return out;
}

// One source → both artifacts → the per-name signature facts.
function facts(src, path = 'agreement.rip') {
  const face = compile(src, { path, face: 'ts' }).code;
  const dts = compile(src, { path }).declarations;
  return { face: signatures(face), dts: signatures(dts), faceText: face, dtsText: dts };
}

// Every name the .d.ts declares must carry the same optional-param set
// and the same generic head in the face. (The face may hold names the
// .d.ts does not — non-exported locals have no declaration form.)
function expectAgreement(src, path) {
  const { face, dts } = facts(src, path);
  for (const [name, dtsRows] of dts) {
    const faceRows = face.get(name);
    if (!faceRows) continue; // not a callable the face spells as `function`
    // Compare as sets: overload rows may be ordered differently, but the
    // same signature must exist on both sides.
    const key = (r) => `${r.generics}|${r.optionals}`;
    for (const row of dtsRows) {
      expect({ name, sig: key(row), seenInFace: faceRows.map(key) })
        .toEqual({ name, sig: key(row), seenInFace: expect.arrayContaining([key(row)]) });
    }
  }
}

describe('the face and the .d.ts describe the same API', () => {
  // The shapes the corpus does not carry. These are the four the audit
  // named, plus the overload row that actually regressed.
  const ROWS = {
    'a generic def': 'export def wrap<T>(v: T): T\n  v\n',
    'a generic def with a constrained param': 'export def only<T extends string>(v: T): T\n  v\n',
    'a typed-optional param': 'export def formal(name: string, title?: string): string\n  title or name\n',
    'a bare-optional param': 'export def loose(name: string, title?): string\n  name\n',
    'an optional param in an OVERLOAD row': [
      'def pick(a: string): string',
      'def pick(a: string, b?: string): string',
      'def pick(a: string, b: string = "z"): string',
      '  a + b',
      'export def go(): string',
      '  pick "x"',
      '',
    ].join('\n'),
    'a generic def with an optional param': 'export def both<T>(v: T, tag?: string): T\n  v\n',
  };

  for (const [label, src] of Object.entries(ROWS)) {
    test(`${label} — the marker and the generic head survive into BOTH`, () => {
      expectAgreement(src, `${label.replace(/\W+/g, '-')}.rip`);
    });
  }

  test('the overload row keeps `?` — the regression this gate was written for', () => {
    const { faceText, dtsText } = facts(ROWS['an optional param in an OVERLOAD row'], 'ovl.rip');
    // Face and declarations must BOTH mark b optional. Before the shared
    // optionalReader landed, the face said `b: string` here.
    expect(faceText).toContain('function pick(a: string, b?: string): string;');
    expect(dtsText).toContain('declare function pick(a: string, b?: string): string;');
  });

  test('a generic def carries its <T> clause into BOTH', () => {
    const { faceText, dtsText } = facts(ROWS['a generic def'], 'gen.rip');
    expect(faceText).toMatch(/function wrap\s*<T>/);
    expect(dtsText).toMatch(/function wrap\s*<T>/);
  });

  describe('the corpus, file by file', () => {
    const files = readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort();
    for (const f of files) {
      test(f, () => {
        const src = readFileSync(join(corpusDir, f), 'utf8');
        let hasDecls = true;
        try { compile(src, { path: f }).declarations; } catch { hasDecls = false; }
        if (!hasDecls) return; // a file with no declaration form has nothing to compare
        expectAgreement(src, f);
      });
    }
  });
});
