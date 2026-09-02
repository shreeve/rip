// The extension's position-translation layer (packages/vscode/src/
// translate.js) against real compile() output: LSP position ↔ offset
// conversion, source → generated hover mapping, generated → source
// diagnostic mapping, and the synthetic-drop policy.
import { test, expect, describe } from 'bun:test';
import { compile } from '../../../../src/compile.js';
import { collapseCellArms, collapseTypedHead, presentType, presentOutgoing, isImportFixTitle,
  lineStartsOf, offsetToPosition, positionToOffset,
  sourceOffsetToGenerated, sourceOffsetToGeneratedExact, sourceCursorToGenerated, sourceSlotToGenerated,
  generatedSpanToSource, generatedEditSpanToSource, generatedInsertionToSource,
  insertionAboveAttachedDirectives, wholeImportLinesEdit,
  exactSpanMapper, staleOffsetMap,
  isScaffoldingLabel, scrubFaceArtifacts, ripImportText,
  diagnosticTagsFor, noUserSymbolSpans, inNoUserSymbolSpan, memberDeclKind,
  SCAFFOLD_FAMILIES, prettifyRouteUnion, hoverableSpans, SCHEMA_PAYLOADS, flattenHover,
} from '../../src/translate.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe('source → generated (a cursor in a slot the emission dropped)', () => {
  // `{ a: 1, ‸ }` emits `{a: 1}`: the trailing comma and the key slot
  // after it are gone, so no byte of the face stands where the cursor
  // is. The cursor mapper answers null; the slot mapper lands inside
  // the emitted literal, one past the property the cursor follows.
  const slotAfter = (source, marker) => {
    const { code, mappings } = compile(source, { runtimeDelivery: 'none' });
    const offset = source.indexOf(marker) + marker.length;
    return {
      code,
      cursor: sourceCursorToGenerated(mappings, offset),
      slot: sourceSlotToGenerated(mappings, offset, source, code),
    };
  };

  test('a key slot after a trailing comma lands inside the emitted literal', () => {
    const { code, cursor, slot } = slotAfter('f({ a: 1,  })\n', '{ a: 1, ');
    expect(cursor).toBeNull();
    expect(slot).not.toBeNull();
    // One past the emitted property, still within the braces.
    expect(code.slice(slot, slot + 1)).toBe('}');
    expect(code.slice(slot - 4, slot)).toBe('a: 1');
  });

  test('an empty literal lands just inside its opening brace', () => {
    const { code, slot } = slotAfter('f({  })\n', '{ ');
    expect(slot).not.toBeNull();
    expect(code.slice(slot - 1, slot + 1)).toBe('{}');
  });

  // The guard. A tolerant parse of an unclosed literal absorbs the
  // following statement into it, so the construct the cursor sits in is
  // one the parse invented — its cover ends on that statement rather
  // than on a brace. Landing a completion inside it would name a
  // context the author never wrote.
  test('an unclosed literal that swallowed the next statement refuses', () => {
    const source = 'f({ a: 1, \n\nb = 2\n';
    const { code, mappings } = compile(source, { runtimeDelivery: 'none', tolerant: true });
    // The premise: the emission really did absorb the statement.
    expect(code).toContain('b = 2');
    const offset = source.indexOf('{ a: 1, ') + '{ a: 1, '.length;
    expect(sourceSlotToGenerated(mappings, offset, source, code)).toBeNull();
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
    expect(isScaffoldingLabel('__schema')).toBe(true);
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
    // The class-vocabulary alias reads back under the clsx ecosystem's
    // own name — hover and diagnostic messages alike — in the
    // declaration's scalar-first order, undoing tsgo's display flip.
    expect(scrubFaceArtifacts("Type '42' is not assignable to type '__RipClassValue[] | __RipClassValue'."))
      .toBe("Type '42' is not assignable to type 'ClassValue | ClassValue[]'.");
    // A schema behavior member reads back under the schema's own name.
    expect(scrubFaceArtifacts('(property) slip: (...args: any[]) => ReturnType<typeof __Parcel__behavior.slip>'))
      .toBe('(property) slip: (...args: any[]) => ReturnType<typeof Parcel.slip>');
  });

  test('ripImportText: inserted import lines drop the semicolon and the mirror extension, and single-quote the specifier', () => {
    expect(ripImportText('import { shout } from "./util.rip.ts";\n'))
      .toBe("import { shout } from './util.rip'\n");
    // Every import form tsgo can mint, since each is a line a user reads.
    expect(ripImportText('import "./side.rip.ts";\n')).toBe("import './side.rip'\n");
    expect(ripImportText('import theme from "./theme.rip.ts";\n')).toBe("import theme from './theme.rip'\n");
    expect(ripImportText('export { total } from "./sum.rip.ts";\n')).toBe("export { total } from './sum.rip'\n");
    // Already idiomatic: unchanged, so the pass is not style-churning a
    // line the re-quoting path is about to hand back in the user's style.
    expect(ripImportText("import { a } from './x.rip'\n")).toBe("import { a } from './x.rip'\n");
    // A specifier carrying an apostrophe keeps its double quotes: re-quoting
    // would need escaping, and a broken literal is worse than a stray style.
    expect(ripImportText('import { a } from "./it\'s.rip.ts";\n'))
      .toBe('import { a } from "./it\'s.rip"\n');
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

// Spans the lowering owns whole — where hover declines rather than
// describing the machinery the face put there. The BOUNDARY is the
// whole content of this: a bare `~>` lowers into the `__effect` callee
// and tsgo describes the runtime's own symbol, while a NAMED effect's
// operator belongs to a construct that binds a user name. Today the
// named operator happens to answer null anyway, so no end-to-end probe
// can tell an over-wide list from a correct one — which is exactly why
// the list itself is asserted here, by identity, rather than through
// its current effect.
describe('spans with no user symbol (the hover declines)', () => {
  const src = [
    "label = 'x'",
    "named ~> console.log('named', label)",
    "~> console.log('bare', label)",
    '~>',
    "  console.log('bare block')",
  ].join('\n') + '\n';

  test('the bare effect operators, and only those', () => {
    const spans = noUserSymbolSpans(compile(src, { face: 'ts', runtimeDelivery: 'inline' }));
    // Identity, not count: each span must BE a `~>`, and the named
    // effect's own operator must not be among them.
    expect(spans.map(([a, b]) => src.slice(a, b))).toEqual(['~>', '~>']);
    const named = src.indexOf('~>');                       // the named effect's operator
    expect(spans.some(([a]) => a === named)).toBe(false);
    expect(spans.map(([a]) => a)).toEqual([src.indexOf('~>', named + 1), src.lastIndexOf('~>')]);
  });

  // The render channel and the reads it BINDS are two different
  // populations, and conflating them is the live hazard: the compiler's
  // `vocabulary` list feeds the mapping census, which nets every span in
  // it out of the read population. A ref cell's name and a bind's
  // right-hand name are real reads that reach a face entity — they must
  // stay counted there while still being silent HERE, which is why the
  // compiler reports them on a second channel.
  test('the render channel silences its own words; the names they bind answer', () => {
    const src = [
      'Panel = component',
      "  text := 'x'",
      '  inputEl: HTMLInputElement | null := null',
      '',
      '  render',
      '    input ref: inputEl',
      '      value <=> text',
      '',
    ].join('\n');
    const r = compile(src, { face: 'ts', runtimeDelivery: 'inline' });
    const at = (word, from = 0) => src.indexOf(word, from);
    const spans = noUserSymbolSpans(r);
    const silenced = (o) => inNoUserSymbolSpan(spans, o);

    const renderAt = src.indexOf('  render');
    expect(silenced(at('ref:', renderAt))).toBe(true);            // the channel word
    // The bind TARGET is a channel word the census spends — silenced here,
    // and answered from the compiler's record instead (RULINGS.md).
    expect(silenced(at('value', renderAt))).toBe(true);
    // The name BOUND to it is the author's own binding, so it answers
    // value-first through its own position — never silenced.
    expect(silenced(at('text', renderAt))).toBe(false);

    // The cell a ref names is NOT silenced: the `__ripRefCell` wrap
    // gives its bytes a real face position and the value-first channel
    // serves the binding's own element type there (RULINGS.md, the
    // ref-name row) — while the intrinsics record answers for the
    // channel word itself.
    const cellAt = at('inputEl', at('ref:', renderAt));
    expect(silenced(cellAt)).toBe(false);
    expect(r.memberDecls.some((m) => m.start === cellAt)).toBe(true);
    expect(r.intrinsics.some((i) => i.kind === 'ref' && i.name === 'inputEl' && i.tag === 'input')).toBe(true);

    // …and the census keeps the reads it must still count.
    const consumed = new Set(r.vocabulary.map((v) => v.start));
    expect(consumed.has(cellAt)).toBe(false);
    expect(consumed.has(at('text', renderAt))).toBe(false);
    expect(consumed.has(at('ref:', renderAt))).toBe(true);        // the word itself IS consumed
  });

  // A schema transform's `it` is the DSL's own word — the grammar fixes
  // the parameter list, so there is nothing to rename or annotate — and
  // it reaches the face as the minted parameter carrying the declared
  // `any` boundary. That boundary IS its answer (`(parameter) it: any`,
  // RULINGS.md), so nothing silences the word: neither the parameter, nor
  // a record FIELD the author happens to name `it`, nor any other name in
  // the body. This is the only fixture anywhere that spells both on one
  // line.
  test("a transform silences nothing — the `it` PARAMETER answers its boundary, and a field named `it` is a field", () => {
    const src = "S = schema\n  label! -> it.it\n  other! -> String(it.name)\n";
    const spans = noUserSymbolSpans(compile(src, { face: 'ts', runtimeDelivery: 'inline' }));
    const first = src.indexOf('it.it');
    expect(inNoUserSymbolSpan(spans, first)).toBe(false);         // the parameter read
    expect(inNoUserSymbolSpan(spans, first + 3)).toBe(false);     // the field it reaches
    expect(inNoUserSymbolSpan(spans, src.indexOf('it.name'))).toBe(false);
    expect(inNoUserSymbolSpan(spans, src.indexOf('String'))).toBe(false);
    expect(spans.length).toBe(0);                                 // a transform body owns no span whole
  });

  test('a DECLARATION outside render keeps its answer', () => {
    const src = [
      'Panel = component',
      "  text := 'x'",
      '',
      '  render',
      '    input',
      '      value <=> text',
      '',
    ].join('\n');
    const r = compile(src, { face: 'ts', runtimeDelivery: 'inline' });
    // `text` at its own declaration is not a channel position — only the
    // occurrence inside the render body is. A list that silenced the name
    // everywhere would swallow the declaration too, and the ruled gauge
    // probes the declaration under a different row.
    expect(inNoUserSymbolSpan(noUserSymbolSpans(r), src.indexOf('  text :='))).toBe(false);
  });

  test('the span is half-open: its first byte silences, the byte after it does not', () => {
    const spans = noUserSymbolSpans(compile(src, { face: 'ts', runtimeDelivery: 'inline' }));
    const [start, end] = spans[0];
    expect(inNoUserSymbolSpan(spans, start)).toBe(true);     // the hover probe lands here
    expect(inNoUserSymbolSpan(spans, end - 1)).toBe(true);
    expect(inNoUserSymbolSpan(spans, end)).toBe(false);      // the next construct answers for itself
    expect(inNoUserSymbolSpan(spans, start - 1)).toBe(false);
  });
});

// The compiler's record of component member DECLARATIONS — the one fact
// that separates the author's own vocabulary from a consumer's view of
// the same face symbol.
describe('memberDeclKind', () => {
  const src = [
    'Roster = component',                      // 0
    '  @label?: string',                       // 1
    '  people := []',                          // 2
    "  shade ~= 'hot'",                        // 3  unannotated computed — behavior-projected
    "  tint: string ~= 'cold'",                // 4  annotated computed — the author's own type
    '  cap =! 3',                              // 5  declares its VALUE type
    '  cell: { value: number, read(): number } = box',  // 6  the shape, BY HAND
    '  bump: (e) -> p(e)',                     // 7  a method: no declare line, no row
    '',
    '  render',                                // 9
    '    div people',                          // 10 a READ, not a declaration
    '',
  ].join('\n');
  const decls = compile(src, { face: 'ts', runtimeDelivery: 'inline' }).memberDecls;
  const at = (needle, word) => src.indexOf(word, src.indexOf(needle));

  test('container members are recorded at the name, and in-body reads join them', () => {
    // `cap` and `cell` are absent on purpose. A `=!` member's declared
    // type IS its value type, so there is nothing to see past; and a
    // member whose own annotation spells the container shape by hand
    // MEANT that shape — stripping it would answer with a type the
    // author never wrote. The trailing `people` is the RENDER READ —
    // a position where the lowering appended `.value` to the bare name
    // the author wrote, so it answers value-first like the declaration.
    expect(decls.map((d) => src.slice(d.start, d.end)))
      .toEqual(['label', 'people', 'shade', 'tint', 'people']);
  });

  test('no member reads through the lowering — the projected kind is retired', () => {
    // An unannotated computed once carried a `projected` flag: its face
    // type read through the lowering's behavior object, so every type
    // spellable for it named machinery and the editor declined. The face
    // now types that member from an INFERRED position — a declaration
    // with no type node, which TypeScript prints resolved — so there is
    // nothing to read through and no member needs the distinction. The
    // flag going missing is the point; a member reacquiring one would
    // mean the projection came back.
    expect(decls.some((d) => d.projected)).toBe(false);
  });

  test('declarations and in-body reads present value-first; the container stays for consumers', () => {
    // The consumer half of the ruling survives by OMISSION: a consumer
    // holding an instance (`inst.people.value`) never passes through the
    // member rewrite, so no consumer position is ever recorded. Inside
    // the component, both the declaration and every bare read answer
    // the value type — RULINGS.md's member-read row.
    expect(memberDeclKind(decls, at('people :=', 'people'))).toBe('value');
    expect(memberDeclKind(decls, at('div people', 'people'))).toBe('value');
    // The unannotated computed answers like every other declaration now.
    expect(memberDeclKind(decls, at('shade ~=', 'shade'))).toBe('value');
    expect(memberDeclKind(decls, at('cap =!', 'cap'))).toBeNull();
    expect(memberDeclKind(decls, at('cell:', 'cell'))).toBeNull();
  });

  test('the spans come from the role and the claimed occurrence, not a text search', () => {
    // `people := people` puts the name twice on one line. The
    // declaration's span is its own role and the read's is its claimed
    // occurrence — two exact spans, never one smeared match.
    const self = 'W = component\n  people := people\n';
    const d = compile(self, { face: 'ts', runtimeDelivery: 'inline' }).memberDecls;
    expect(d.map((x) => [x.start, x.end])).toEqual([[16, 22], [26, 32]]);
    expect(memberDeclKind(d, self.indexOf('people'))).toBe('value');
    expect(memberDeclKind(d, self.lastIndexOf('people'))).toBe('value');
  });

  test('the span is half-open, like every other', () => {
    const d = decls[0];
    expect(memberDeclKind(decls, d.start)).toBe('value');
    expect(memberDeclKind(decls, d.end - 1)).toBe('value');
    expect(memberDeclKind(decls, d.end)).toBeNull();
    expect(memberDeclKind(decls, d.start - 1)).toBeNull();
  });

  test('the JS emission records nothing — the channel is the face\'s', () => {
    expect(compile(src, { runtimeDelivery: 'inline' }).memberDecls).toEqual([]);
  });
});

describe('SCAFFOLD_FAMILIES', () => {
  test('every minted render-scaffold family the emitter spells is in the shared list', () => {
    // The list is a mirror of the emitter's minted-name scheme
    // (newRenderVar hints + newRenderText's `_t`); this scan is what
    // keeps the mirror honest — a new hint added in the emitter without
    // a family entry fails here, not as a silent hover leak.
    const emitterSrc = readFileSync(join(import.meta.dir, '../../../../src/emitter.js'), 'utf8');
    const hints = new Set(['el', 't']); // newRenderVar's default hint; newRenderText's family
    for (const m of emitterSrc.matchAll(/newRenderVar\('([a-z]+)'\)/g)) hints.add(m[1]);
    const families = new Set(SCAFFOLD_FAMILIES.split('|'));
    for (const hint of hints) expect(families.has(hint)).toBe(true);
  });
});

// Route-union prettifying is DISPLAY-ONLY rewriting: each dynamic
// member's checked form re-labels as its parameterized display; static
// members, unrelated text, and messages without entries pass untouched.
describe('prettifyRouteUnion', () => {
  const entries = [
    { shape: '/', text: '"/"', display: '/' },
    { shape: '/orders', text: '"/orders"', display: '/orders' },
    { shape: '/orders/${string}', text: '`/orders/${string}`', display: '/orders/:id' },
    { shape: '/profile', text: '"/profile"', display: '/profile' },
  ];

  test('a dynamic member re-labels; statics and the rest stay', () => {
    const msg = 'Argument of type \'"/orderz"\' is not assignable to parameter of type \'"/" | "/orders" | `/orders/:id`\'.';
    expect(prettifyRouteUnion(
      'Argument of type \'"/orderz"\' is not assignable to parameter of type \'"/" | "/orders" | `/orders/${string}`\'.',
      entries,
    )).toBe(msg);
  });

  test('a tsgo-normalized run (templates dumped last) rewrites back into walker order', () => {
    expect(prettifyRouteUnion('\'"/" | "/orders" | "/profile" | `/orders/${string}`\'.', entries))
      .toBe('\'"/" | "/orders" | `/orders/:id` | "/profile"\'.');
  });

  test('a run mixing in a non-member keeps that tail where TS put it', () => {
    expect(prettifyRouteUnion('\'"/orders" | "/profile" | `/orders/${string}` | undefined\'.', entries))
      .toBe('\'"/orders" | `/orders/:id` | "/profile" | undefined\'.');
  });

  test('every occurrence rewrites, not just the first', () => {
    expect(prettifyRouteUnion('`/orders/${string}` vs `/orders/${string}`', entries))
      .toBe('`/orders/:id` vs `/orders/:id`');
  });

  test('no entries, or a non-string, answers identity', () => {
    expect(prettifyRouteUnion('text', [])).toBe('text');
    expect(prettifyRouteUnion('text', undefined)).toBe('text');
    expect(prettifyRouteUnion(null, entries)).toBe(null);
  });
});

// A reactive cell is the lowering's container, never the author's type, so
// wherever a type text shows one it reads as its value type — the same
// collapse the prop-slot hover and a diagnostic's quoted types share.
describe('collapseCellArms: a cell reads as its value type', () => {
  test('a cell arm beside its value type folds into it, absence arm kept', () => {
    expect(collapseCellArms('boolean | { value: boolean | undefined; read(): boolean | undefined; touch?(): void; } | undefined'))
      .toBe('boolean | undefined');
  });
  test('a STANDALONE cell stays a cell — a reactive import is the cell the importer holds', () => {
    const cell = '{ value: number; read(): number; touch(): void; }';
    expect(collapseCellArms(cell)).toBe(cell);
  });
  test('the brand check: a literal whose value and read() disagree is left alone', () => {
    const literal = '{ value: string; read(): number; }';
    expect(collapseCellArms(literal)).toBe(literal);
  });
  test('a type with no cell is untouched', () => {
    expect(collapseCellArms('"/" | "/cart" | `/orders/${string}`')).toBe('"/" | "/cart" | `/orders/${string}`');
  });
  test('a ` | ` inside a literal arm belongs to that literal, never to the union', () => {
    expect(collapseCellArms('"a | b" | { value: "a | b"; read(): "a | b"; touch?(): void; } | undefined'))
      .toBe('"a | b" | undefined');
    expect(collapseCellArms('"{" | { value: "{"; read(): "{"; touch?(): void; } | undefined'))
      .toBe('"{" | undefined');
  });
  test('a cell arm inside a parenthesized group collapses within its parens — a required prop\'s slot', () => {
    // The group's own parens go once nothing in it needs them: `&` binds
    // tighter than `|`, so `A | (B | C) & D` reads as TypeScript prints it.
    expect(collapseCellArms('string | ((string | { value: string; read(): string; touch?(): void; } | undefined) & { x: 1 })'))
      .toBe('string | (string | undefined) & { x: 1 }');
    expect(collapseCellArms('((number | { value: number; read(): number; touch?(): void; }))')).toBe('number');
  });
  test('a quoted operator is not a union: the message text around it survives', () => {
    expect(collapseCellArms('|')).toBe('|');
    expect(collapseCellArms('||')).toBe('||');
  });
});

// Every type-bearing presentation — a completion's detail column, a
// symbol's detail, a signature row — prints through presentType: the
// face names scrubbed and a cell arm collapsed, with the head kept.
describe('presentType: a printed type on its way to the screen', () => {
  test('a completion detail with a multi-line cell arm reads value-first, head kept', () => {
    const detail = '(property) variant?: "primary" | "secondary" | {\n    value: "primary" | "secondary";\n    read(): "primary" | "secondary";\n    touch?(): void;\n} | undefined';
    expect(presentType(detail)).toBe('(property) variant?: "primary" | "secondary" | undefined');
  });
  test('the head splits off first — its literal never reappears as a second arm', () => {
    expect(collapseTypedHead('(property) variant?: "primary" | { value: "primary" | "secondary"; read(): "primary" | "secondary"; touch?(): void; }'))
      .toBe('(property) variant?: "primary" | "secondary"');
  });
  test('a text with no cell keeps its layout and only scrubs', () => {
    expect(presentType('(property) a: {\n  b: __RipChildren\n}')).toBe('(property) a: {\n  b: Children\n}');
  });
  test('a standalone cell stays a cell', () => {
    const cell = 'const c: { value: number; read(): number; touch(): void; }';
    expect(presentType(cell)).toBe(cell);
  });
});

// The quick-fix offer is the import family and nothing else — keyed on
// the title, since tsgo's rows carry no fix identity.
describe('isImportFixTitle: the quick fixes the editor offers', () => {
  test('the three import spellings pass', () => {
    expect(isImportFixTitle('Add import from "./util.rip"')).toBe(true);
    expect(isImportFixTitle('Update import from "./util.rip"')).toBe(true);
    expect(isImportFixTitle('Add all missing imports')).toBe(true);
  });
  test('every other fix is refused — its edit would be TypeScript syntax inside rip source', () => {
    for (const title of [
      "Change spelling to 'size'", "Remove unused declaration for: 'k'", "Prefix 'k' with an underscore",
      'Infer parameter types from usage', "Add 'await'", "Declare property 'sizee'", 'Add all missing imports to file',
    ]) expect([title, isImportFixTitle(title)]).toEqual([title, false]);
  });
});

// The boundary pass: display fields present once more on the way out,
// edit fields never, and a changed field is reported as a rescue.
describe('presentOutgoing: the boundary pass', () => {
  const cell = 'boolean | { value: boolean; read(): boolean; touch?(): void; } | undefined';
  test('a clean response passes through and reports nothing', () => {
    const calls = [];
    const res = { items: [{ label: 'x', detail: '(property) x: boolean | undefined', textEdit: { newText: '__RipChildren' } }] };
    expect(presentOutgoing('textDocument/completion', res, (m, f) => calls.push(f))).toEqual(res);
    expect(calls).toEqual([]);
  });
  test('a forgotten presenter is rescued and named — the edit payload beside it is untouched', () => {
    const calls = [];
    const out = presentOutgoing('textDocument/completion', { items: [{ label: 'x', detail: `(property) x: ${cell}`, insertText: '__RipRest_button', textEdit: { newText: '__RipChildren' } }] }, (m, f) => calls.push(`${m} ${f}`));
    expect(out.items[0].detail).toBe('(property) x: boolean | undefined');
    expect(out.items[0].insertText).toBe('__RipRest_button');
    expect(out.items[0].textEdit.newText).toBe('__RipChildren');
    expect(calls).toEqual(['textDocument/completion detail']);
  });
  test('hover contents, signature labels, symbol names, and action titles are display fields', () => {
    const calls = [];
    const on = (m, f) => calls.push(f);
    expect(presentOutgoing('textDocument/hover', { contents: { kind: 'markdown', value: 'x: __RipChildren' } }, on).contents.value).toBe('x: Children');
    expect(presentOutgoing('textDocument/signatureHelp', { signatures: [{ label: `f(a: ${cell}): void`, parameters: [{ label: 'a' }] }] }, on).signatures[0].label).toBe(`f(a: ${cell}): void`);
    expect(presentOutgoing('textDocument/documentSymbol', [{ name: '__RipEl_div', detail: 'x', children: [] }], on)[0].name).toBe('<div>');
    expect(presentOutgoing('textDocument/codeAction', [{ title: "Add import from './a.rip.ts'" }], on)[0].title).toBe("Add import from './a.rip'");
    expect(calls).toEqual(['contents', 'name', 'title']);
  });
});

describe('flattenHover', () => {
  test('strips the fences and collapses whitespace to the bare type text', () => {
    expect(flattenHover('```typescript\n(property) a: {\n  b: string\n}\n```')).toBe('(property) a: { b: string }');
    expect(flattenHover('  const x: number  ')).toBe('const x: number');
  });

  test('an empty or fence-only body flattens to the empty string, not null', () => {
    expect(flattenHover('')).toBe('');
    expect(flattenHover('```ts\n```')).toBe('');
  });
});

describe('SCHEMA_PAYLOADS', () => {
  test('names every token payload a schema entry captures, and hoverableSpans descends each one', () => {
    expect(SCHEMA_PAYLOADS).toEqual(['paramTokens', 'bodyTokens', 'transformTokens', 'argTokens']);
    for (const k of SCHEMA_PAYLOADS) {
      const entry = { [k]: [{ kind: 'IDENTIFIER', start: 5, end: 8 }] };
      const spans = hoverableSpans({ tokens: [{ kind: 'SCHEMA_BODY', start: 0, end: 20, value: { entries: [entry] } }] });
      expect(spans).toContainEqual([5, 8]);
    }
  });
});
