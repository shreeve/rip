// The extension's position-translation layer (packages/vscode/src/
// translate.js) against real compile() output: LSP position ↔ offset
// conversion, source → generated hover mapping, generated → source
// diagnostic mapping, and the synthetic-drop policy.
import { test, expect, describe } from 'bun:test';
import { compile } from '../../../src/compile.js';
import {
  lineStartsOf, offsetToPosition, positionToOffset,
  sourceOffsetToGenerated, sourceOffsetToGeneratedExact, sourceCursorToGenerated,
  generatedSpanToSource, generatedEditSpanToSource, generatedInsertionToSource,
  insertionAboveAttachedDirectives, wholeImportLinesEdit, generatedCursorToSource,
  exactSpanMapper, staleOffsetMap,
  isScaffoldingLabel, scrubFaceArtifacts, ripImportText,
  diagnosticTagsFor,
} from '../src/translate.js';

describe('offset ↔ LSP position', () => {
  const text = 'ab\ncde\n\nf';
  const ls = lineStartsOf(text);

  test('lineStartsOf marks every line start', () => {
    expect(ls).toEqual([0, 3, 7, 8]);
  });

  test('offsetToPosition round-trips positionToOffset at every offset', () => {
    for (let off = 0; off <= text.length; off++) {
      const pos = offsetToPosition(ls, off);
      expect(positionToOffset(ls, text.length, pos)).toBe(off);
    }
  });

  test('positionToOffset clamps character overruns to line end, lines to text bounds', () => {
    expect(positionToOffset(ls, text.length, { line: 0, character: 99 })).toBe(2);
    expect(positionToOffset(ls, text.length, { line: 99, character: 0 })).toBe(text.length);
    expect(positionToOffset(ls, text.length, { line: -1, character: 0 })).toBe(0);
  });

  test('astral-plane characters count as two UTF-16 units', () => {
    const emoji = 'x = "🎉"\ny = 1';
    const els = lineStartsOf(emoji);
    // The emoji is 2 code units; line 1 starts after them.
    expect(els).toEqual([0, 9]);
    expect(offsetToPosition(els, 9)).toEqual({ line: 1, character: 0 });
  });
});

describe('staleOffsetMap (the stale-hover alignment guard)', () => {
  const good = 'greeting = "hello"\ncount = 42\n';

  test('identical texts map identically both ways', () => {
    const m = staleOffsetMap(good, good);
    for (const off of [0, 5, good.length]) {
      expect(m.toGood(off)).toBe(off);
      expect(m.toCurrent(off)).toBe(off);
    }
  });

  test('a line inserted at file start: suffix offsets map with the exact delta', () => {
    const current = 'oops = (\n' + good;
    const m = staleOffsetMap(current, good);
    const delta = current.length - good.length;
    // `greeting` moved down a line; its current offset maps to its old one.
    const curGreeting = current.indexOf('greeting');
    expect(m.toGood(curGreeting)).toBe(good.indexOf('greeting'));
    expect(m.toCurrent(good.indexOf('count'))).toBe(good.indexOf('count') + delta);
    // A position ON the inserted line has no aligned twin.
    expect(m.toGood(current.indexOf('oops') + 1)).toBeNull();
  });

  test('an edit in the middle: prefix aligns, changed region answers null, suffix shifts', () => {
    const current = good.replace('= 42', '= (');
    const m = staleOffsetMap(current, good);
    // Before the edit: identity.
    expect(m.toGood(current.indexOf('greeting') + 3)).toBe(good.indexOf('greeting') + 3);
    // Inside the changed region: null.
    expect(m.toGood(current.indexOf('('))).toBeNull();
    // After the edit (the trailing newline): shifted by the delta.
    expect(m.toGood(current.length - 1)).toBe(good.length - 1);
  });

  test('an exclusive END exactly at the prefix boundary maps (its span covers only aligned units)', () => {
    // 'aaa bbb' → 'aaa ccc': prefix = 4, no common suffix.
    const m = staleOffsetMap('aaa ccc', 'aaa bbb');
    // As a POSITION, offset 4 sits on the first changed unit: null.
    expect(m.toCurrent(4)).toBeNull();
    expect(m.toGood(4)).toBeNull();
    // As an exclusive end, [_, 4) covers aligned units only: mapped.
    expect(m.toCurrent(4, { exclusiveEnd: true })).toBe(4);
    expect(m.toGood(4, { exclusiveEnd: true })).toBe(4);
  });
});

describe('source → generated (the hover direction)', () => {
  test('an identifier maps linearly inside its exact row', () => {
    const source = 'greeting = "hello"\ncount = greeting\n';
    const { code, mappings } = compile(source, { runtimeDelivery: 'none' });
    // Hover in the middle of the `greeting` REFERENCE on line 2.
    const srcOffset = source.indexOf('greeting', source.indexOf('\n')) + 3;
    const genOffset = sourceOffsetToGenerated(mappings, srcOffset);
    expect(genOffset).not.toBeNull();
    expect(code.slice(genOffset - 3, genOffset + 5)).toBe('greeting');
  });

  test('an unmapped position (whitespace between statements) answers null or a cover anchor, never throws', () => {
    const source = 'a = 1\n\n\nb = 2\n';
    const { mappings } = compile(source, { runtimeDelivery: 'none' });
    const blank = source.indexOf('\n\n') + 1;
    const got = sourceOffsetToGenerated(mappings, blank);
    expect(got === null || typeof got === 'number').toBe(true);
  });
});

describe('generated → source (the diagnostics direction)', () => {
  test('a generated identifier span maps back to its source span', () => {
    const source = 'total = 41\nnext = total + 1\n';
    const { code, mappings } = compile(source, { runtimeDelivery: 'none' });
    const genStart = code.indexOf('total', code.indexOf('next'));
    const span = generatedSpanToSource(mappings, genStart, genStart + 5);
    expect(span).not.toBeNull();
    expect(source.slice(span[0], span[1])).toBe('total');
  });

  test('a generated edit span maps only verbatim-verified; cover fallbacks refuse', () => {
    const source = 'import { answer } from "./util.rip"\nk = answer\n';
    const { code, mappings } = compile(source, { face: 'ts' });
    // `answer` inside the import CLAUSE: one cover row, but the bytes
    // correspond verbatim from the row's start through the name — the
    // edit span maps linearly.
    const genName = code.indexOf('answer');
    const span = generatedEditSpanToSource(mappings, genName, genName + 6, source, code);
    expect(span).toEqual([source.indexOf('answer'), source.indexOf('answer') + 6]);
    // A span crossing the RE-QUOTED specifier is not verbatim: refused.
    const genSpec = code.indexOf("'./util.rip'");
    expect(generatedEditSpanToSource(mappings, genSpec, genSpec + 5, source, code)).toBeNull();
  });

  test('a generated insertion point anchors per the three-tier rule', () => {
    const source = 'import { answer } from "./util.rip"\nk = answer\n';
    const { code, mappings } = compile(source, { face: 'ts' });
    // Tier 2 (verbatim cover): inside the import clause's braces —
    // right after `answer` — lands at the same spot in the source.
    const inBraces = code.indexOf('answer') + 6;
    expect(generatedInsertionToSource(mappings, inBraces, source, code)).toBe(source.indexOf('answer') + 6);
    // Tier 3 (between constructs): the start of the generated line
    // AFTER the import (the hoist line `let k;`) anchors at the source
    // line after the import — a whole-line import insertion lands there.
    const afterImport = code.indexOf('\n', code.indexOf('import')) + 1;
    expect(generatedInsertionToSource(mappings, afterImport, source, code)).toBe(source.indexOf('k = answer'));
    // A mid-line point with no verbatim anchor refuses.
    const midSpec = code.indexOf('util.rip') + 2;
    expect(generatedInsertionToSource(mappings, midSpec, source, code)).toBeNull();
  });

  test('an insertion anchor beneath a next-line-attached directive hoists ABOVE it (directive adjacency)', () => {
    // The directive governs the statement directly beneath; a
    // whole-line insertion between them would split the pair (TS2578 +
    // the suppressed error both resurface). The anchor hoists to the
    // directive's line start instead.
    const source = '# @ts-expect-error\ncount: number = "nope"\ny = shout\n';
    const { mappings } = compile(source, { face: 'ts' });
    const governed = source.indexOf('count:');
    expect(insertionAboveAttachedDirectives(mappings, governed, source)).toBe(0);
    // A stacked pair: only the ADJACENT directive attaches (the
    // next-line rule — the outer one declines, stays ordinary), so the
    // anchor hoists exactly one line, above the attached directive.
    const stacked = '# @ts-expect-error\n# @ts-ignore\ncount: number = "nope"\n';
    const two = compile(stacked, { face: 'ts' });
    expect(insertionAboveAttachedDirectives(two.mappings, stacked.indexOf('count:'), stacked)).toBe(stacked.indexOf('# @ts-ignore'));
    // A mid-line anchor never hoists, and an anchor NOT beneath a
    // directive line stays put.
    expect(insertionAboveAttachedDirectives(mappings, governed + 3, source)).toBe(governed + 3);
    expect(insertionAboveAttachedDirectives(mappings, source.indexOf('y = shout'), source)).toBe(source.indexOf('y = shout'));
    // A PLAIN comment first line is not a directive: no row, no hoist.
    const plain = '# just a note\ny = shout\n';
    const control = compile(plain, { face: 'ts' });
    expect(insertionAboveAttachedDirectives(control.mappings, plain.indexOf('y ='), plain)).toBe(plain.indexOf('y ='));
    // The file-level `# @ts-nocheck` row is excluded BY SPELLING —
    // nocheck must stay FIRST (the push, not the hoist).
    const nocheck = '# @ts-nocheck\ncount: number = 42\n';
    const nc = compile(nocheck, { face: 'ts' });
    expect(insertionAboveAttachedDirectives(nc.mappings, nocheck.indexOf('count:'), nocheck)).toBe(nocheck.indexOf('count:'));
    // A HOIST-FREE file puts an attached directive's row at generated
    // offset 0 (nothing emitted above it); it must still hoist — an
    // offset-based nocheck test would wrongly exempt exactly this
    // shape.
    const hoistFree = '# @ts-expect-error\nconsole.log("x".missing)\n';
    const hf = compile(hoistFree, { face: 'ts' });
    expect(hf.mappings.rows.find((r) => r.role === 'tsDirective').generatedStart).toBe(0);
    expect(insertionAboveAttachedDirectives(hf.mappings, hoistFree.indexOf('console'), hoistFree)).toBe(0);
  });

  test('wholeImportLinesEdit: statement-granular import rewrites map, everything else refuses', () => {
    const source = 'import { zz } from "./zed.rip"\nimport { answer } from "./util.rip"\nk = answer + 1\ny = shout\n';
    const { code, mappings, stores } = compile(source, { face: 'ts' });
    const face = { mappings, stores, source, code };
    const genLine = (n) => lineStartsOf(code)[n];

    // A pure keep-one-drop-one rewrite: the kept line substitutes the
    // statement's SOURCE bytes — the user's double quotes and missing
    // semicolon survive; the deletion maps to the whole source line.
    const kept = wholeImportLinesEdit(face, genLine(0), genLine(1), "import { answer } from './util.rip';\n");
    expect(kept).toEqual({ span: [0, 31], newText: 'import { answer } from "./util.rip"\n' });
    const dropped = wholeImportLinesEdit(face, genLine(1), genLine(2), '');
    expect(dropped).toEqual({ span: [31, 67], newText: '' });

    // A newText line with NO face twin (a NARROWED clause) falls back
    // to idiomatic Rip (no semicolon) with the specifier RE-QUOTED to
    // the user's own style — the specifier is semantically untouched,
    // so its bytes must not change.
    const narrowed = wholeImportLinesEdit(face, genLine(1), genLine(2), "import { answer } from './util.rip';\n");
    expect(narrowed.newText).toBe('import { answer } from "./util.rip"\n');

    // A COMBINED clause (two same-module imports merged) takes the
    // style of the FIRST source statement naming that module — the
    // deterministic first-statement rule.
    const twoSame = 'import { zz } from "./m.rip"\nimport { aa } from \'./m.rip\'\nk = zz + aa\n';
    const ts = compile(twoSame, { face: 'ts' });
    const tsFace = { ...ts, source: twoSame };
    const combined = wholeImportLinesEdit(tsFace, 0, lineStartsOf(ts.code)[2], "import { aa, zz } from './m.rip';\n");
    expect(combined.newText).toBe('import { aa, zz } from "./m.rip"\n');

    // A specifier with NO source statement to read the style from
    // refuses the whole edit (all-or-nothing).
    expect(wholeImportLinesEdit(face, genLine(0), genLine(2), "import { answer, zz } from './invented.rip';\n")).toBeNull();

    // The single-quote control: the user's style already matches the
    // face's — the fallback line passes through unchanged.
    const singles = "import { zz, yy } from './m.rip'\nk = zz\n";
    const sq = compile(singles, { face: 'ts' });
    const sqFace = { ...sq, source: singles };
    const sqNarrowed = wholeImportLinesEdit(sqFace, 0, lineStartsOf(sq.code)[1], "import { zz } from './m.rip';\n");
    expect(sqNarrowed.newText).toBe("import { zz } from './m.rip'\n");

    // Refusals: a non-line-start range, a range covering non-import
    // lines, a trailing comment on the import line (bytes tsgo never
    // saw), and a comment line inside the replaced block.
    expect(wholeImportLinesEdit(face, genLine(0) + 2, genLine(1), '')).toBeNull();
    expect(wholeImportLinesEdit(face, genLine(0), genLine(3), '')).toBeNull();
    const commented = 'import { zz } from "./zed.rip" # note\nk = zz\n';
    const c = compile(commented, { face: 'ts' });
    expect(wholeImportLinesEdit({ ...c, source: commented }, 0, lineStartsOf(c.code)[1], '')).toBeNull();
    const between = 'import { zz } from "./zed.rip"\n# between\nimport { answer } from "./util.rip"\nk = zz + answer\n';
    const b = compile(between, { face: 'ts' });
    expect(wholeImportLinesEdit({ ...b, source: between }, 0, lineStartsOf(b.code)[2], '')).toBeNull();

    // A whitespace-only gap line between imports rides along (the
    // organize rewrite owns the block, blanks included).
    const blank = 'import { zz } from "./zed.rip"\n\nimport { answer } from "./util.rip"\nk = zz + answer\n';
    const g = compile(blank, { face: 'ts' });
    expect(wholeImportLinesEdit({ ...g, source: blank }, 0, lineStartsOf(g.code)[2], '')).toEqual({ span: [0, 68], newText: '' });
  });

  test('cursor positions one past an exact row map one past its generated end', () => {
    const source = 'msg = "hi"\nk = msg.sub\n';
    const { code, mappings } = compile(source, { face: 'ts' });
    const cursor = source.indexOf('msg.sub') + 'msg.sub'.length; // msg.sub‸
    const gen = sourceCursorToGenerated(mappings, cursor);
    expect(gen).not.toBeNull();
    expect(code.slice(gen - 'msg.sub'.length, gen)).toBe('msg.sub');
  });

  test('generatedCursorToSource (inlay-hint anchors): inside/one-past exact rows map, synthetic bytes drop', () => {
    const source = 'k = add(1, 2)\n';
    const { code, mappings } = compile(source, { face: 'ts', runtimeDelivery: 'none' });
    // Inside an exact row: the position before an argument.
    const atArg = code.indexOf('1');
    expect(generatedCursorToSource(mappings, atArg, source, code)).toBe(source.indexOf('1'));
    // One past an exact row's end: right after the hoisted `k` on the
    // let line — the type-hint anchor — maps one past the source name.
    const afterK = code.indexOf('let k') + 'let k'.length;
    expect(generatedCursorToSource(mappings, afterK, source, code)).toBe(source.indexOf('k') + 1);
    // A generated-only position (inside the `let ` keyword) drops.
    expect(generatedCursorToSource(mappings, code.indexOf('let ') + 1, source, code)).toBeNull();
  });

  test('the exact flavor refuses positions with no verbatim twin (comments); the lenient flavor may still cover-land', () => {
    const source = '# about total\ntotal = 41\n';
    const { code, mappings } = compile(source, { face: 'ts' });
    const inComment = source.indexOf('about');
    expect(sourceOffsetToGeneratedExact(mappings, inComment, source, code)).toBeNull();
    const onName = source.indexOf('total', source.indexOf('\n'));
    expect(sourceOffsetToGeneratedExact(mappings, onName, source, code)).not.toBeNull();
  });

  test('exactSpanMapper answers ascending generated spans through exact rows only', () => {
    const source = 'total = 41\nnext = total + 1\n';
    const { code, mappings } = compile(source, { face: 'ts' });
    const mapSpan = exactSpanMapper(mappings);
    const g1 = code.indexOf('total', code.indexOf('next'));
    const g2 = code.indexOf('next =');
    // Ascending queries (the semantic-tokens order).
    expect(mapSpan(Math.min(g1, g2), Math.min(g1, g2) + 4)).not.toBeNull();
    const later = Math.max(g1, g2);
    const mapped = mapSpan(later, later + 4);
    expect(mapped).not.toBeNull();
    expect(source.slice(mapped, mapped + 4)).toBe(code.slice(later, later + 4));
  });

  test('a span inside injected runtime code is dropped (null), never pinned to unrelated source', () => {
    // Schema use triggers runtime delivery; under 'inline' the runtime
    // body occupies generated offsets with no source correspondence.
    const source = 'User = schema\n  name! string\nUser.parse({name: "x"})\n';
    const { code, mappings } = compile(source, { runtimeDelivery: 'inline' });
    const runtimeStart = code.indexOf('__schema');
    expect(runtimeStart).toBeGreaterThan(-1);
    // Probe every offset of the runtime prelude region before the first
    // user statement's emission: each either maps to a REAL source span
    // or drops — generatedSpanToSource never invents a position. The
    // prelude is the region before the user code's first mapped byte.
    const firstUser = code.indexOf('User.parse');
    let dropped = 0;
    for (let off = 0; off < firstUser; off += 50) {
      const span = generatedSpanToSource(mappings, off, off + 1);
      if (span === null) dropped++;
      else {
        expect(span[0]).toBeGreaterThanOrEqual(0);
        expect(span[1]).toBeLessThanOrEqual(source.length);
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });
});

describe('TS-face artifact filters', () => {
  test('scaffolding labels: the __ runtime namespace and the _ref temp family, nothing else', () => {
    expect(isScaffoldingLabel('__state')).toBe(true);
    expect(isScaffoldingLabel('__schemaTypes')).toBe(true);
    expect(isScaffoldingLabel('_ref')).toBe(true);
    expect(isScaffoldingLabel('_ref12')).toBe(true);
    expect(isScaffoldingLabel('_refx')).toBe(false);
    expect(isScaffoldingLabel('_private')).toBe(false);
    expect(isScaffoldingLabel('answer')).toBe(false);
  });

  test('scrubFaceArtifacts: the `!:` assertion and mirror .rip.ts specifiers leave user-visible strings', () => {
    expect(scrubFaceArtifacts('let y!: number')).toBe('let y: number');
    expect(scrubFaceArtifacts('Add import from "./util.rip.ts"')).toBe('Add import from "./util.rip"');
    // A genuine non-null assertion on a call result is not the pattern.
    expect(scrubFaceArtifacts('f()!: never happens')).toBe('f()!: never happens');
  });

  test('ripImportText: inserted import lines drop the semicolon and the mirror extension', () => {
    expect(ripImportText('import { shout } from "./util.rip.ts";\n'))
      .toBe('import { shout } from "./util.rip"\n');
    expect(ripImportText(', shout')).toBe(', shout'); // clause merges pass through
    expect(ripImportText('total')).toBe('total');     // rename texts pass through
  });
});

describe('diagnostic tag restoration (the rendering seam)', () => {
  test('the fallback table mirrors TypeScript\'s reportsUnnecessary/reportsDeprecated sets exactly', () => {
    // Source of truth: the typescript diagnostics table
    // (diagnosticMessages.json upstream; diagnostics_generated.go in
    // typescript-go) marks EXACTLY these nine codes reportsUnnecessary
    // and these two reportsDeprecated — verified against the table and
    // live against the pinned tsgo (pull diagnostics with
    // tagSupport declared deliver the same tags). 6205 (all type
    // parameters unused) is deliberately absent: TypeScript does not
    // flag it, and tsgo delivers it untagged.
    for (const code of [2695, 6133, 6138, 6192, 6196, 6198, 6199, 7027, 7028]) {
      expect(diagnosticTagsFor(code)).toEqual([1]);
    }
    for (const code of [6385, 6387]) {
      expect(diagnosticTagsFor(code)).toEqual([2]);
    }
    // Real errors, the suppressed implicit-any family, and the
    // unflagged 6205 never tag.
    for (const code of [2322, 2339, 2578, 7043, 6134, 6205]) {
      expect(diagnosticTagsFor(code)).toEqual([]);
    }
  });
});
