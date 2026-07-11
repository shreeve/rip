// `rip --explain` / `--explain-generated` — the mapping-table diagnostic
// instrument. Fixtures with hand-computed span expectations pin the three
// mapping stories (an exact-mapped identifier, a typed declaration's
// annotation cover row, a lowered construct's IIFE scaffolding), the
// reverse direction, and the error surface (usage exit 2; out-of-range
// positions exit 1 with a positioned message). Alignment padding is the
// format's own business: assertions match rows with \s+ between cells,
// never exact padding.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { compile } from '../src/compile.js';
import { explainSource, explainGenerated, parseTarget, UsageError, PositionError } from '../src/explain.js';
import { Stores, Mappings } from '../src/stores.js';

const BIN = resolve(import.meta.dir, '../bin/rip');

let dir;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rip-explain-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, text) => {
  writeFileSync(join(dir, name), text);
  return name;
};

const rip = (args) => {
  const r = spawnSync('bun', [BIN, ...args], { cwd: dir, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

// One aligned output row: cells separated by runs of spaces.
const row = (...cells) =>
  new RegExp(cells.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));

describe('explain: target parsing', () => {
  test('offset form', () => {
    expect(parseTarget('app.rip:12')).toEqual({ path: 'app.rip', pos: { offset: 12 } });
  });

  test('line:col form (1-based)', () => {
    expect(parseTarget('app.rip:3:5')).toEqual({ path: 'app.rip', pos: { line: 3, col: 5 } });
  });

  test('a path containing colons keeps its colons', () => {
    expect(parseTarget('a:b.rip:3:5')).toEqual({ path: 'a:b.rip', pos: { line: 3, col: 5 } });
  });

  test('a target without a position rejects as usage', () => {
    expect(() => parseTarget('app.rip')).toThrow(UsageError);
  });
});

// `x = y + 1` — the canonical fixture; every span below is a
// hand-computed table. Generated (Tier 1
// declare-in-place): `let x = y + 1;`.
describe('explain: plain exact-mapped identifier (x = y + 1)', () => {
  const src = 'x = y + 1\n';
  const path = '<fixture>';

  test('source position on `y` tells the full innermost-first story', () => {
    const out = explainSource(src, { path, pos: { line: 1, col: 5 } });

    expect(out).toContain('<fixture>:1:5 (offset 4) — source position');
    // caret excerpt under `y`
    expect(out).toContain('  1 | x = y + 1\n    |     ^');
    expect(out).toContain('4 nodes contain this position (innermost first):');

    // innermost node first: binary before assign before program
    const binaryAt = out.indexOf('binary  $self [4,9) 1:5-1:10  `y + 1`');
    const assignAt = out.indexOf('assign  $self [0,9) 1:1-1:10  `x = y + 1`');
    const programAt = out.indexOf('program  $self [0,9)');
    expect(binaryAt).toBeGreaterThan(-1);
    expect(assignAt).toBeGreaterThan(binaryAt);
    expect(programAt).toBeGreaterThan(assignAt);

    // roles: refs carry spans + excerpts; literal-sourced operator carries
    // its static value and no span
    expect(out).toMatch(row('left', '[4,5) 1:5-1:6', '`y`'));
    expect(out).toMatch(row('right', '[8,9) 1:9-1:10', '`1`'));
    expect(out).toMatch(row('operator', '= "+"', '(literal-sourced; no source span)'));

    // mappings: exact rows serialize, the $self and synthetic rows do not
    expect(out).toMatch(row('left', 'exact', '[4,5) 1:5-1:6', '->', '[8,9) 1:9-1:10', '`y`', 'V3 map'));
    expect(out).toMatch(row('right', 'exact', '[8,9) 1:9-1:10', '->', '[12,13) 1:13-1:14', '`1`', 'V3 map'));
    expect(out).toMatch(row('operator', 'synthetic', '[4,4) 1:5-1:5', '->', '[10,11) 1:11-1:12', '`+`', 'reverse-only'));
    expect(out).toMatch(row('$self', 'exact', '[4,9) 1:5-1:10', '->', '[8,13) 1:9-1:14', '`y + 1`', 'reverse-only'));
  });

  test('one-to-many: a HOISTED target shows BOTH manifestations; declare-in-place shows ONE', () => {
    // Tier 1 declare-in-place: the straight-line binding's target has a
    // single manifestation — the declaring statement.
    const out = explainSource(src, { path, pos: { offset: 0 } });
    expect(out).toMatch(row('target', 'exact', '[0,1) 1:1-1:2', '->', '[4,5) 1:5-1:6', '`x`', 'V3 map'));
    expect(out.match(/target\s+exact/g)).toHaveLength(1);
    // A branch-first write stays hoisted (Tier 2): `if y\n  x = 1` emits
    // `let x;\n\nif (y) {\n  x = 1;\n}` — the §4.1 one-to-many contract
    // keeps BOTH manifestations (hoist line + branch assignment).
    const hoisted = explainSource('if y\n  x = 1\n', { path, pos: { offset: 7 } });
    expect(hoisted).toMatch(row('target', 'exact', '[7,8) 2:3-2:4', '->', '[4,5) 1:5-1:6', '`x`', 'V3 map'));
    expect(hoisted).toMatch(row('target', 'exact', '[7,8) 2:3-2:4', '->', '[19,20) 4:3-4:4', '`x`', 'V3 map'));
  });

  test('offset and line:col forms of the same position agree', () => {
    expect(explainSource(src, { path, pos: { offset: 4 } }))
      .toBe(explainSource(src, { path, pos: { line: 1, col: 5 } }));
  });

  test('a position on leading trivia reports no containing node', () => {
    // $self coverage is the NON-TRIVIA extent: a leading comment
    // sits before every node span, program's included.
    const withComment = '# lead\nx = 1\n';
    const out = explainSource(withComment, { path, pos: { line: 1, col: 3 } });
    expect(out).toContain('No node contains this position');
  });

  test('a mid-file comment is honestly inside the program accumulator span', () => {
    const withComment = 'x = 1\n# just a comment\ny = 2\n';
    const out = explainSource(withComment, { path, pos: { line: 2, col: 3 } });
    expect(out).toContain('program  $self [0,28) 1:1-3:6');
    expect(out).not.toMatch(/\bexact\b/);
  });
});

// `x: number = 42` — the annotation story: the annotation erases, so
// its role row spans `: number` in source and its mapping row is a COVER
// over the emitted `x = 42`, reverse-only (non-$self covers never
// serialize). Generated (Tier 1 declare-in-place): `let x = 42;`.
describe('explain: typed declaration (annotation cover row)', () => {
  const src = 'x: number = 42\n';
  const path = '<typed>';

  test('inside the annotation: the assign node owns the erased span', () => {
    const out = explainSource(src, { path, pos: { line: 1, col: 4 } });

    expect(out).toContain('assign  $self [0,14) 1:1-1:15  `x: number = 42`');
    expect(out).toMatch(row('annotation', '[1,9) 1:2-1:10', '`: number`'));

    // the annotation's mapping row: cover over the whole emitted
    // statement (inside `let x = 42;`, after the `let ` prefix),
    // reverse-only
    expect(out).toMatch(row('annotation', 'cover', '[1,9) 1:2-1:10', '->', '[4,10) 1:5-1:11', '`x = 42`', 'reverse-only'));
    // erasure makes the node's own $self a cover too (source != emitted)
    expect(out).toMatch(row('$self', 'cover', '[0,14) 1:1-1:15', '->', '[4,10) 1:5-1:11', '`x = 42`', 'reverse-only'));
    // while the untouched pieces stay exact
    expect(out).toMatch(row('value', 'exact', '[12,14) 1:13-1:15', '->', '[8,10) 1:9-1:11', '`42`', 'V3 map'));
  });

  test('face: "ts" — the same position gains the annotation\'s EXACT emitted manifestation', () => {
    const out = explainSource(src, { path, pos: { line: 1, col: 4 }, face: 'ts' });
    // The TS face declares `let x: number = 42;` (typed forwards inline
    // their annotation at the declaring write) — the annotation role now
    // owns an exact row on the emitted `: number` alongside the cover
    // over the assignment.
    expect(out).toMatch(row('annotation', 'exact', '[1,9) 1:2-1:10', '->'));
    expect(out).toMatch(row('annotation', 'cover', '[1,9) 1:2-1:10', '->'));
    expect(out).toContain('`: number`');
  });

  test('face: "ts" reverse direction — a generated position inside the inline annotation resolves to the source annotation', () => {
    // TS face line 1 is `let x: number = 42;` (typed forwards inline
    // their annotation at the declaring write) — column 8 sits inside
    // `number`.
    const out = explainGenerated(src, { path, pos: { line: 1, col: 8 }, face: 'ts' });
    expect(out).toContain('  1 | let x: number = 42;');
    expect(out).toMatch(/bestAtGenerated resolves to #\d+ assign\.annotation \(exact\) — source <typed>:1:2/);
  });
});

// `v = for i in [1, 2, 3]` + body — a lowered construct: the value is an
// accumulator IIFE, so scaffolding lines exist only under cover rows.
// Generated (Tier 1 declare-in-place):
//   let v = (() => {
//     const result = [];
//     for (let i of [1, 2, 3]) {
//       result.push((i * 2));
//     }
//     return result;
//   })();
describe('explain: lowered construct (IIFE scaffolding)', () => {
  const src = 'v = for i in [1, 2, 3]\n  i * 2\n';
  const path = '<lowered>';

  test('a generated position on scaffolding resolves through cover rows only', () => {
    // 2:3 = the `const result = [];` line
    const out = explainGenerated(src, { path, pos: { line: 2, col: 3 } });

    expect(out).toContain('— generated position');
    expect(out).toContain('  2 |   const result = [];');
    // every containing row is a cover (scaffolding has no exact source)
    const rows = out.split('\n').filter(l => /#\d+ /.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) expect(line).toMatch(/\bcover\b/);
    // the resolution: innermost cover, the assignment's value role
    expect(out).toMatch(/bestAtGenerated resolves to #\d+ assign\.value \(cover\) — source <lowered>:1:5/);
    // whose source excerpt carets the value's line-1 extent —
    // `for i in [1, 2, 3]`, 18 columns from column 5
    expect(out).toContain('  1 | v = for i in [1, 2, 3]\n    |     ' + '^'.repeat(18));
  });

  test('a generated position on a real operand resolves exactly', () => {
    // 4:18 = `i` inside `result.push((i * 2));`
    const out = explainGenerated(src, { path, pos: { line: 4, col: 18 } });
    expect(out).toMatch(/bestAtGenerated resolves to #\d+ binary\.left \(exact\) — source <lowered>:2:3/);
    expect(out).toMatch(row('binary.left', 'exact'));
    expect(out).toContain('  2 |   i * 2\n    |   ^');
  });
});

describe('explain: reverse direction (x = y + 1 generated side)', () => {
  const src = 'x = y + 1\n';
  const path = '<fixture>';

  test('a position inside the hoisted declaration resolves to the source target', () => {
    // Tier 1 declare-in-place removed this fixture's hoist line, so the
    // hoisted-declaration story moves to a legitimately hoisted binding
    // (branch-first write, Tier 2): `if y\n  x = 1` emits
    // `let x;\n\nif (y) {\n  x = 1;\n}` — generated 1:5 = `x` in
    // `let x;`, the target role's first manifestation.
    const hoistedSrc = 'if y\n  x = 1\n';
    const out = explainGenerated(hoistedSrc, { path, pos: { line: 1, col: 5 } });
    expect(out).toContain('  1 | let x;\n    |     ^');
    expect(out).toMatch(row('#1 assign.target', 'exact', '[4,5) 1:5-1:6', '<-', '[7,8) 2:3-2:4', '`x`', 'V3 map'));
    expect(out).toMatch(/bestAtGenerated resolves to #1 assign\.target \(exact\) — source <fixture>:2:3/);
    expect(out).toContain('  2 |   x = 1\n    |   ^');
  });

  test('a synthetic glyph is reachable from the generated side, reverse-only', () => {
    // generated 1:11 = the emitted `+` in `let x = y + 1;`
    const out = explainGenerated(src, { path, pos: { line: 1, col: 11 } });
    expect(out).toMatch(row('#1 binary.operator', 'synthetic', '[10,11) 1:11-1:12', '<-', '[4,4) 1:5-1:5', '`+`', 'reverse-only'));
    expect(out).toMatch(/bestAtGenerated resolves to #1 binary\.operator \(synthetic\)/);
  });

  test('rows print innermost first', () => {
    const out = explainGenerated(src, { path, pos: { offset: 8 } }); // `y` in `let x = y + 1;`
    const left = out.indexOf('binary.left');
    const self = out.indexOf('binary.$self');
    const program = out.indexOf('program.$self');
    expect(left).toBeGreaterThan(-1);
    expect(self).toBeGreaterThan(left);
    expect(program).toBeGreaterThan(self);
  });
});

// line:col addresses VISIBLE text only: the line terminator (`\n`, or
// `\r\n` as one terminator) is not a column; raw offsets stay raw and
// address any in-file UTF-16 code unit, terminator bytes included.
describe('explain: line:col boundary (visible text only)', () => {
  const path = '<bounds>';

  test('LF file: last visible column accepted, one past rejected, the newline reachable by offset', () => {
    const src = 'x = 1\ny = 2\n';
    // line 1 is `x = 1` — 5 columns; col 5 = the literal `1` at offset 4
    expect(explainSource(src, { path, pos: { line: 1, col: 5 } })).toContain('(offset 4)');
    expect(() => explainSource(src, { path, pos: { line: 1, col: 6 } }))
      .toThrow('<bounds>: source position 1:6 is out of range — line 1 has 5 columns');
    // the `\n` byte at offset 5 stays reachable through the raw form
    expect(explainSource(src, { path, pos: { offset: 5 } })).toContain('(offset 5)');
  });

  test('CRLF file: the CR and LF bytes are one terminator, zero columns', () => {
    const src = 'x = 1\r\ny = 2\r\n';
    expect(explainSource(src, { path, pos: { line: 1, col: 5 } })).toContain('(offset 4)');
    // 1:6 would be the CR, 1:7 the LF — both rejected
    for (const col of [6, 7]) {
      expect(() => explainSource(src, { path, pos: { line: 1, col } }))
        .toThrow(`<bounds>: source position 1:${col} is out of range — line 1 has 5 columns`);
    }
    // both bytes stay reachable through raw offsets
    expect(explainSource(src, { path, pos: { offset: 5 } })).toContain('(offset 5)');
    expect(explainSource(src, { path, pos: { offset: 6 } })).toContain('(offset 6)');
    // line 2 is unaffected: `y = 2` col 1 = offset 7
    expect(explainSource(src, { path, pos: { line: 2, col: 1 } })).toContain('(offset 7)');
  });

  test('an empty line has zero addressable columns', () => {
    const src = 'x = 1\n\ny = 2\n';
    expect(() => explainSource(src, { path, pos: { line: 2, col: 1 } }))
      .toThrow('<bounds>: source position 2:1 is out of range — line 2 has 0 columns');
    // the blank line's own newline byte stays reachable by offset
    expect(explainSource(src, { path, pos: { offset: 6 } })).toContain('(offset 6)');
  });

  test('columns count UTF-16 code units: an astral character is two columns', () => {
    // `x = "😀z"` — 9 UTF-16 units (the emoji is a surrogate pair)
    const src = 'x = "\u{1F600}z"\n';
    expect(explainSource(src, { path, pos: { line: 1, col: 9 } })).toContain('(offset 8)');
    expect(() => explainSource(src, { path, pos: { line: 1, col: 10 } }))
      .toThrow('<bounds>: source position 1:10 is out of range — line 1 has 9 columns');
  });

  test('the rejection names the escape hatch', () => {
    expect(() => explainSource('x = 1\n', { path, pos: { line: 1, col: 6 } }))
      .toThrow('line:col addresses visible text; use a raw offset to address terminator bytes');
  });
});

describe('explain: position errors', () => {
  const src = 'x = y + 1\n';
  const path = '<fixture>';

  test('source offset beyond the file', () => {
    expect(() => explainSource(src, { path, pos: { offset: 99 } }))
      .toThrow('<fixture>: source offset 99 is out of range — valid offsets are [0,10)');
  });

  test('source line beyond the file (the trailing newline is not a line)', () => {
    expect(() => explainSource(src, { path, pos: { line: 2, col: 1 } }))
      .toThrow('<fixture>: source line 2 is out of range — the file has 1 line');
  });

  test('source column beyond the line', () => {
    expect(() => explainSource(src, { path, pos: { line: 1, col: 99 } }))
      .toThrow(PositionError);
  });

  test('generated offset beyond the emitted code', () => {
    expect(() => explainGenerated(src, { path, pos: { offset: 9999 } }))
      .toThrow('<fixture>: generated offset 9999 is out of range');
  });
});

describe('explain: CLI wiring', () => {
  const name = 'wired.rip';
  beforeAll(() => { write(name, 'x = y + 1\n'); });

  test('--explain with line:col prints the story and exits 0', () => {
    const r = rip(['--explain', `${name}:1:5`]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('wired.rip:1:5 (offset 4) — source position');
    expect(r.stdout).toMatch(row('left', 'exact', '[4,5) 1:5-1:6', '->', '[8,9) 1:9-1:10', '`y`', 'V3 map'));
  });

  test('--explain with a bare offset', () => {
    const r = rip(['--explain', `${name}:4`]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('wired.rip:1:5 (offset 4) — source position');
  });

  test('--explain-generated resolves back to source', () => {
    // generated 1:9 = `y` in `let x = y + 1;` (Tier 1 declare-in-place)
    const r = rip(['--explain-generated', `${name}:1:9`]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/bestAtGenerated resolves to #\d+ binary\.left \(exact\) — source wired\.rip:1:5/);
  });

  test('usage errors exit 2: missing argument, missing position, extra options, extra file', () => {
    const noArg = rip(['--explain']);
    expect(noArg.status).toBe(2);
    expect(noArg.stderr).toContain('--explain requires a <file.rip>:<pos> argument');

    const noPos = rip(['--explain', name]);
    expect(noPos.status).toBe(2);
    expect(noPos.stderr).toContain('--explain expects <file.rip>:<offset> or <file.rip>:<line>:<col>');

    const mixed = rip(['--explain', '-c', `${name}:1:1`]);
    expect(mixed.status).toBe(2);
    expect(mixed.stderr).toContain('--explain cannot combine with other options: -c');

    const extra = rip(['--explain', `${name}:1:1`, 'other.rip']);
    expect(extra.status).toBe(2);
    expect(extra.stderr).toContain('takes its file inside the target argument');
  });

  test('out-of-range position exits 1 with the positioned message', () => {
    const r = rip(['--explain', `${name}:9:1`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('wired.rip: source line 9 is out of range — the file has 1 line');
  });

  test('missing file exits 1', () => {
    const r = rip(['--explain', 'nope.rip:1:1']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('rip: file not found: nope.rip');
  });

  test('a file that does not compile exits 1 with the compile diagnostic', () => {
    write('broken.rip', 'x = (\n');
    const r = rip(['--explain', 'broken.rip:1:1']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("broken.rip:1:5: unclosed '('");
  });

  test('--face ts reads the story against the editor face; explain-only', () => {
    write('faced.rip', 'x: number = 5\n');
    const r = rip(['--explain', 'faced.rip:1:4', '--face', 'ts']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(row('annotation', 'exact', '[1,9) 1:2-1:10', '->'));

    const badValue = rip(['--explain', 'faced.rip:1:4', '--face', 'wat']);
    expect(badValue.status).toBe(2);
    expect(badValue.stderr).toContain("--face takes 'js' or 'ts'");

    // Compile/run modes never take a face — the TS face is not a
    // shipping target.
    const shipping = rip(['--face', 'ts', '-c', 'faced.rip']);
    expect(shipping.status).toBe(2);
    expect(shipping.stderr).toContain('compile and run modes always ship JS');
  });
});

describe('compile() result carries the query layers', () => {
  test('stores and mappings are the live mapping surface', () => {
    const { code, map, stores, mappings } = compile('x = y + 1', { path: 'unit.rip' });
    expect(code).toBe('let x = y + 1;');
    expect(map.version).toBe(3);
    expect(stores).toBeInstanceOf(Stores);
    expect(mappings).toBeInstanceOf(Mappings);

    const [assign] = stores.nodesByKind('assign');
    expect(stores.role(assign.nodeId, 'target').sourceStart).toBe(0);
    // Tier 1 declare-in-place: ONE target row (the declaring statement).
    expect(mappings.of(assign.nodeId, 'target')).toHaveLength(1);
    expect(mappings.bestAtSource(4).role).toBe('left');
    expect(mappings.bestAtGenerated(8).role).toBe('left'); // `y` in `let x = y + 1;`
    expect(mappings.serializableRows().length).toBeGreaterThan(0);
  });
});
