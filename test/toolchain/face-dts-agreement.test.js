// The face/declaration agreement gate — rip's two signature emitters
// must describe the SAME API.
//
// `emitter.js` (the TS face, which the editor type-checks against) and
// `dts.js` (the `.d.ts`, which consumers of a published package see) are
// two independent walks over the same sexpr. Nothing structurally forces
// them to agree, and every type-level detail that rides a side-band ROLE
// — the optional `?` marker, a generic head's `<T, …>` clause — or that
// each emitter GENERATES for itself — the async `Promise<T>` wrap, a void
// definition's `void`, a generator's iterator — has to be decided
// separately by each. Forgetting is the failure mode, in both directions
// and on every axis:
//
//   · dts.js forgot the optionalMarker role → declarations emitted
//     `title: string` (or a malformed `title: `) where the face said
//     `title?: string`.
//   · emitter.js's overload rows (tsOverloadSigs) forgot it → the face
//     emitted `b: string` where the .d.ts said `b?: string`.
//   · dts.js had no async wrap → a `.d.ts` published `number` where the
//     face said `Promise<number>`, telling consumers a value comes back
//     where a promise does. That one type-checks and fails at RUNTIME.
//
// None is catchable downstream. `title?: string` degrading to
// `title: string` is PERFECTLY VALID TypeScript — both artifacts compile
// clean under `tsc --strict` in isolation, so no tsc gate, however
// thorough, can see it. The defect is only visible as a DISAGREEMENT
// between rip's own two outputs, which is what this gate compares.
//
// The converse is its standing limit: where BOTH emitters make the same
// mistake they agree, and this gate stays green. A generator declaring
// `: void` on both sides passed here until a tsc gate rejected the face
// (TS2505). Agreement is necessary, never sufficient.
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
// Captured per name: the type-param clause, the set of params carrying
// `?`, and the RETURN type. All three ride side-band roles or generated
// rules that each emitter applies for itself, and all three have drifted.
//
// A regex cannot find the end of a parameter list that contains its own
// parens (`cb: (x: number) => void`) or the end of a return type that is
// an object (`: { a: number }`), so the scan is BALANCED. `function*` is
// matched too: a generator's return type is exactly one of the rules
// that drifted, and a scan that skipped the star could not see it.
const HEAD = /(?:^|[\s;}])(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/g;

// The characters after which a `{` opens a TYPE rather than a body.
const TYPE_EXPECTED = ':|&,<(';

// The `>` of an arrow, which closes nothing. Both scans below count
// angle brackets, and a type spells `=>` wherever it names a callable —
// in a constraint (`<T extends (...a: any[]) => any>`) and as a return
// (`: (x: number) => void`). Read as a close, it ends the clause early:
// the generic scan then finds no `(` and DROPS the signature, and the
// return scan stops mid-type. Both failures are silent, and a gate that
// silently declines to compare is worse than one that never claimed to.
const arrowTail = (text, i) => text[i] === '>' && text[i - 1] === '=';

function signatures(text) {
  const out = new Map(); // name -> array of {generics, optionals, ret}
  for (const m of text.matchAll(HEAD)) {
    const name = m[1];
    let i = m.index + m[0].length;
    const skipSpace = () => { while (i < text.length && /\s/.test(text[i])) i++; };
    const balanced = (open, close) => {
      const start = i;
      let depth = 0;
      do {
        if (text[i] === open) depth++;
        else if (text[i] === close && !arrowTail(text, i)) depth--;
        i++;
      } while (i < text.length && depth > 0);
      return text.slice(start, i);
    };
    skipSpace();
    const generics = text[i] === '<' ? balanced('<', '>') : '';
    skipSpace();
    if (text[i] !== '(') continue; // not a callable head after all
    const params = balanced('(', ')').slice(1, -1);
    // The return type runs from `:` to the body's `{` or the row's `;`.
    let ret = null;
    skipSpace();
    if (text[i] === ':') {
      i++;
      const start = i;
      let depth = 0;
      while (i < text.length) {
        const c = text[i];
        if (depth === 0 && c === ';') break;
        if (depth === 0 && c === '{') {
          const before = text.slice(start, i).trimEnd();
          const prev = before.slice(-1);
          // An object TYPE opens where a type is expected; anywhere
          // else a `{` is the function body, and the type ended.
          if (!(before === '' || TYPE_EXPECTED.includes(prev) || before.endsWith('=>'))) break;
        }
        if (!arrowTail(text, i)) {
          if ('<([{'.includes(c)) depth++;
          else if ('>)]}'.includes(c)) { if (depth === 0) break; depth--; }
        }
        i++;
      }
      ret = text.slice(start, i).trim();
    }
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
    // A face with NO return annotation lets TypeScript infer from the
    // body; a declaration has no body, so its honest spelling of that
    // same signature is `any`. Normalizing both to `any` is what makes
    // "the face inferred it" and "the .d.ts widened it" one answer —
    // every OTHER difference between the two is a real divergence.
    rows.push({
      generics: generics.replace(/\s+/g, ' ').trim(),
      optionals: optionals.sort().join(','),
      ret: (ret ?? 'any').replace(/\s+/g, ' '),
    });
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

// Every name the .d.ts declares must carry the same optional-param set,
// the same generic head, and the same return type in the face. (The face
// may hold names the .d.ts does not — non-exported locals have no
// declaration form.)
//
// Returns how many rows it actually COMPARED. A scan that cannot parse a
// signature yields no rows to disagree, so every failure of the scanner
// itself reads as agreement — the callers that know a comparison was owed
// check the count, and the corpus sweep, where a file may legitimately
// declare no callable at all, does not.
function expectAgreement(src, path) {
  const { face, dts } = facts(src, path);
  let compared = 0;
  for (const [name, dtsRows] of dts) {
    const faceRows = face.get(name);
    if (!faceRows) continue; // not a callable the face spells as `function`
    // Compare as sets: overload rows may be ordered differently, but the
    // same signature must exist on both sides.
    const key = (r) => `${r.generics}|${r.optionals}|${r.ret}`;
    for (const row of dtsRows) {
      compared++;
      expect({ name, sig: key(row), seenInFace: faceRows.map(key) })
        .toEqual({ name, sig: key(row), seenInFace: expect.arrayContaining([key(row)]) });
    }
  }
  return compared;
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
    // The RETURN-type rules. Each emitter decides these for itself, so
    // each is a place the two can disagree — and `void`/`Promise<T>`
    // are GENERATED spellings no author can correct downstream.
    'an async def wraps its annotation': 'export def go(a: number): number\n  await a\n',
    'an async def keeps an author-spelled Promise': 'export def already(a: number): Promise<number>\n  await a\n',
    'an async VOID def': 'export def flush!(x: number)\n  await x\n',
    'a void GENERATOR takes no void spelling': 'export def pump!()\n  yield 1\n',
    'a generator keeps its author-spelled iterator': 'export def numbers(): Generator<number>\n  yield 1\n',
    'an async generator takes no Promise wrap': 'export def drain(s: number): AsyncGenerator<number>\n  yield await s\n',
    'a sync def is wrapped by neither': 'export def plain(a: number): number\n  a\n',
    // A type spells `=>` wherever it names a callable, and both places it
    // can appear in a signature sat in the angle-bracket scans' path.
    // These rows are here for the SCANNER: each was dropped or truncated
    // silently, which is the one failure a comparison gate cannot report.
    'a generic constrained by a function type': 'export def memo<T extends (...args: any[]) => any>(fn: T): T\n  await fn\n  fn\n',
    'a return type that is a function type': 'export def adder(n: number): (x: number) => number\n  (x) -> x + n\n',
  };

  for (const [label, src] of Object.entries(ROWS)) {
    test(`${label} — params, generic head, and return type survive into BOTH`, () => {
      // Every row here exports a def, so every row owes at least one
      // comparison. Asserting that is what keeps a row honest: a scanner
      // that stops parsing this shape would otherwise pass it in silence.
      expect(expectAgreement(src, `${label.replace(/\W+/g, '-')}.rip`)).toBeGreaterThan(0);
    });
  }

  // The SCANNER, on hand-written text. Both artifacts spell a type the
  // same way, so a scan that stops early stops early on both and the
  // comparison agrees — which is why neither of these can be pinned by
  // compiling a row and comparing. The scan is read directly instead.
  test('an `=>` in a type closes nothing: the return is whole, the constraint is scanned', () => {
    // The `>` of an arrow, read as a closing angle, ended this return
    // type at the `=` and made two different types one string.
    const face = 'export function make(a: number): (x: number) => void {\n  return () => {};\n}\n';
    const dts = 'export declare function make(a: number): (x: number) => string;\n';
    expect(signatures(face).get('make')[0].ret).toBe('(x: number) => void');
    expect(signatures(dts).get('make')[0].ret).toBe('(x: number) => string');
    // The same read ended this generic clause early, left the scan short
    // of the `(`, and DROPPED the signature — a name compared zero times
    // while the gate reported green.
    const generic = 'export declare function memo<T extends (...args: any[]) => any>(fn: T): Promise<T>;\n';
    const rows = signatures(generic).get('memo');
    expect(rows?.[0]).toEqual({
      generics: '<T extends (...args: any[]) => any>',
      optionals: '',
      ret: 'Promise<T>',
    });
  });

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
