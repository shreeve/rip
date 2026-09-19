// `rip check` — intrinsic-element typing over the real server, and
// branch narrowing as the checker and the editor each see it. The
// runner and workspace builders live in ./support/check-harness.js.

import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { openSession } from '../../support/lsp-session.js';
import { TSCONFIG, workspace, check } from './support/check-harness.js';

describeExtended('rip check: intrinsic-element typing over the real server', () => {
  // The typed lowering (src/ts/dom-types.js + the receiver casts): the
  // EXISTING lowering's own byte positions check natively, so every
  // diagnostic here must anchor on the author's key/value/handler/cell
  // bytes — never on scaffold. Detection is posture-independent (the
  // gradual arm below); the strict arm carries the full matrix.
  const comp = (lines) => ['export P = component', "  q := ''", '  render', '    div', ...lines.map((l) => `      ${l}`), ''].join('\n');
  const diagsOf = (dir) => JSON.parse(check(dir, ['--json']).stdout).map((d) => [d.code, d.line, d.column]);

  test('a misspelled attribute key draws TS2345 anchored on the key\'s own bytes, both postures', () => {
    for (const strict of [true, false]) {
      const dir = workspace({ 'app.rip': comp(["input placeholdr: 'x'"]) }, strict ? { strict: true } : null);
      try {
        expect(diagsOf(dir), `strict=${strict}`).toEqual([[2345, 5, 13]]);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  }, 120_000);

  test('an unknown attribute name reports as a DIAGNOSTIC, on the word, naming the spelling that works', () => {
    // The vocabulary is one rule the typed surface already enforces, so
    // the emitter does not also reject it here: a fatal second voice
    // would cost the file every other diagnostic. Every road — the
    // inline bare word, the bare word on its own line under the
    // element, and the pair — answers at its own bytes, beside the rest.
    const dir = workspace({ 'app.rip': comp(['input readOnly', "input readOnly: true", 'img alt: 42', 'span countt', 'input', '  readOnly']) });
    try {
      expect(diagsOf(dir)).toEqual([[2345, 5, 13], [2345, 6, 13], [2345, 7, 11], [2345, 8, 12], [2345, 10, 9]]);
      const out = check(dir, ['--json']).stdout;
      expect(out.match(/did you mean 'readonly'\?/g)).toHaveLength(3);
      // Nothing near it: the reading it took, and the two ways out.
      expect(out).toContain('a bare word sets the boolean attribute it names');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('an unknown name on the absence road reports ONCE — the scratch const\'s own miss on the same name folds into the row', () => {
    // A nullable value lowers through a scratch const annotated with the
    // tag's value surface indexed by the key, so tsgo also reports
    // TS2339 there — the same fact the row already words, on the same
    // span. One claim, one diagnostic.
    const dir = workspace({
      'app.rip': ['export P = component', '  val: string | null := null', '  render', '    div', '      div notAnAttr: val', ''].join('\n'),
    });
    try {
      expect(diagsOf(dir)).toEqual([[2345, 5, 11]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('the value policy: property road strict, attribute road widened by | string', () => {
    const dir = workspace({
      'app.rip': comp([
        'input value: q',            // property road, string := string — clean
        'img width: \'400\'',        // number property, widened — clean
        'img alt: 42',               // string property — the number errors
        'input maxlength: 5',        // the attribute's own spelling — number | string
        "input maxLength: '5'",      // a DOM property's name is NOT an attribute name — TS2345
        "label for: 'q'",            // the spec spelling is legal (v3 rejected it)
        'div data-count: 5',         // templates admit serializable primitives
        "div aria-labl: 'z'",        // template admission — any suffix is legal
      ]),
    }, { strict: true });
    try {
      expect(diagsOf(dir)).toEqual([[2345, 7, 11], [2345, 9, 13]]);   // img alt: 42, then maxLength — anchored on the key, as in the editor
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('where a pair\'s complaint lands: the value\'s own complaint keeps its bytes, the pair\'s relation lands on the key', () => {
    // RULINGS.md, the render-pair section — every road, one file: the
    // scratch-const, direct, property, boolean, and clsx roads of an
    // intrinsic, the props-object road of a component use, a bind on
    // each, and the ref channel.
    const dir = workspace({
      'app.rip': [
        'Btn = component',
        '  @label: string',
        '  render',
        "    button 'b'",
        '',
        'export P = component',
        '  n := 0',
        '  cell: HTMLInputElement | null := null',
        '  render',
        '    div',
        '      input value: nope',        // 11: TS2304 on `nope` — the value's own
        '      img alt: 42',              // 12: TS2345 on `alt` — the relation
        '      Btn anything: 2',          // 13: TS2353 on `anything`
        '      Btn label: nope',          // 14: TS2304 on `nope`
        '      input value <=> n',        // 15: TS2322 on `value` — the bind's relation
        '      div innerHTML: n',         // 16: TS2322 on `innerHTML` — the property road
        '      div textContent: nope',    // 17: TS2304 on `nope`
        '      Btn label <=> n',          // 18: TS2322 on `label` — the props-object bind
        '      button disabled: nope',    // 19: TS2304 on `nope`
        '      div ref: cell',            // 20: TS2345 on `ref`
        '      p class: n',               // 21: TS2345 on `class` — the clsx argument
        '      div.card class: nope',     // 22: TS2304 on `nope` — the merge road's own name
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const rows = diagsOf(dir).sort((a, b) => a[1] - b[1] || a[2] - b[2]);
      expect(rows).toEqual([
        [2304, 11, 20], [2345, 12, 11], [2353, 13, 11], [2304, 14, 18], [2322, 15, 13], [2322, 16, 11],
        [2304, 17, 24], [2322, 18, 11], [2304, 19, 24], [2345, 20, 11], [2345, 21, 9], [2304, 22, 23],
      ]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('class values ride the clsx contract: number rejects, boolean passes', () => {
    const dir = workspace({
      'app.rip': ['export P = component', '  lit := true', '  render', '    div',
        '      span class: lit', '      p class: 42', ''].join('\n'),
    }, { strict: true });
    try {
      const rows = diagsOf(dir);
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe(2322);
      expect(rows[0][1]).toBe(6);                       // the `p class: 42` pair
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('event handlers: a mismatched named method draws the cast diagnostic; a custom event stays quiet', () => {
    const dir = workspace({
      'app.rip': ['export P = component', "  v := ''",
        '  onKey = (e: KeyboardEvent) ->', '    v = e.key',
        '  render', '    div',
        "      button @click: @onKey, 'x'",             // KeyboardEvent into a click — errors
        '      input @input: (e) -> v = e.target.value', // host-typed target — clean
        '      div @fancy: (e) -> v = String(e.detail)', // custom event — no claim, no TS7006
        ''].join('\n'),
    }, { strict: true });
    try {
      const rows = diagsOf(dir);
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe(2352);
      expect(rows[0][1]).toBe(7);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('refs: the blessed arms pass; a non-nullable or foreign-typed cell rejects on its own pair, static and dynamic', () => {
    const clean = workspace({
      'app.rip': ['export P = component', '  el := null', '  inp: HTMLInputElement | null := null', '  render',
        '    div ref: el', '      input ref: inp', ''].join('\n'),
    }, { strict: true });
    try {
      expect(diagsOf(clean)).toEqual([]);
    } finally { fs.rmSync(clean, { recursive: true, force: true }); }
    const bad = workspace({
      'app.rip': ['export P = component', '  vis := true', '  divCell: HTMLDivElement | null := null', '  render',
        '    div', '      if vis', '        input ref: divCell', ''].join('\n'),
    }, { strict: true });
    try {
      const rows = diagsOf(bad);
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe(2345);
      expect(rows[0][1]).toBe(7);                       // the dynamic ref's own line
    } finally { fs.rmSync(bad, { recursive: true, force: true }); }
  }, 120_000);

  test('SVG: case-sensitive names with string | number values; the dual-namespace anchor takes the SVG surface', () => {
    const dir = workspace({
      'app.rip': ['export P = component', '  r := 4', '  render',
        "    svg viewBox: '0 0 10 10'",
        '      circle cx: 5, r: r',
        "      circle viewbox: 'wrong-case'",
        "      a href: '#in-svg'",
        ''].join('\n'),
    }, { strict: true });
    try {
      const rows = diagsOf(dir);
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe(2345);
      expect(rows[0][1]).toBe(6);                       // the misspelled viewbox key
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('bare shorthand stays clean through the typed surface', () => {
    const dir = workspace({
      'app.rip': comp(['form novalidate', 'input required', 'button disabled', "  'go'"]),
    }, { strict: true });
    try {
      expect(diagsOf(dir)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});

describe('branch narrowing under the real checker', () => {
  // TS18047 is a strict-null-checks answer, so the workspace is strict.
  const strictWorkspace = (files) => {
    const dir = workspace(files);
    const base = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
    delete base.include;
    delete base.exclude;
    base.compilerOptions.strict = true;
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(base, null, 2));
    return dir;
  };
  const component = (cond) => [
    'C = component',
    '  @store: { user: { email: string } | null, other: boolean }',
    '  render',
    `    if ${cond}`,
    '      span @store.user.email',
    '',
  ].join('\n');

  test('the unnarrowed spelling under `if @store.user` checks clean', () => {
    const dir = strictWorkspace({ 'narrow.rip': component('@store.user') });
    try {
      const r = check(dir);
      expect(r.stdout).toContain('No type errors');
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a branch on a different expression does not narrow: TS18047 at the read', () => {
    const dir = strictWorkspace({ 'narrow.rip': component('@store.other') });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('TS18047');
      expect(r.stdout).toContain('narrow.rip:5:');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});

// The editor's half of branch narrowing: the face narrows by control
// flow (an assertion the block's effects open with), so the hover on a
// read inside the branch reports the narrowed type, while the condition's
// own read keeps the union. A postfix `!` would satisfy the checker and
// leave both hovers at the union, so this is the gate that separates the
// two spellings. Strict, because without strict null checks the union
// never exists and both hovers agree by accident.
describeExtended('branch narrowing — what the editor says', () => {
  test('the hover on a narrowed read drops null; the condition read keeps it', async () => {
    const base = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
    delete base.include;
    delete base.exclude;
    base.compilerOptions.strict = true;
    const session = await openSession({
      'tsconfig.json': JSON.stringify(base),
      'main.rip': [
        'C = component',
        '  @store: { user: { email: string } | null, other: boolean }',
        '  render',
        '    if @store.user',
        '      span @store.user.email',
        '',
      ].join('\n'),
    });
    try {
      session.open('main.rip');
      const read = await session.hover('main.rip', 4, 19);      // `user` in `span @store.user.email`
      const condition = await session.hover('main.rip', 3, 15); // `user` in `if @store.user`
      expect(read, 'the read serves a hover at all').toBeTruthy();
      expect(read).toBe('(property) user: { email: string; }');
      expect(condition).toBe('(property) user: { email: string; } | null');
    } finally {
      await session.close();
    }
  }, 60_000);
});
