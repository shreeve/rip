// The TS emission face  — the editor face's
// compiler-side contract:
//
//   1. THE STRIP GATE :
//      TS-face output with the recorded TS-only regions deleted equals
//      JS-mode output BYTE-FOR-BYTE, across the whole corpus under
//      all three runtime deliveries. The face can never diverge from
//      shipped semantics.
//   2. REGION SHAPES: every recorded TS-only region looks like type
//      syntax (annotations, the arrow-param parens TS requires, whole
//      type/interface/overload/companion statements) — an emission
//      change cannot quietly reclassify code bytes as "TS-only".
//   3. EMISSION PINS per surface: annotations (hoist line, params,
//      returns, class fields, const lowerings), structured aliases/
//      interfaces (generics included), overload rows, hoisted-let
//      typing, the enum companion.
//   4. MAPPING PINS: TS-face rows ride the SAME CodeBuilder mark
//      protocol — annotations get exact rows when the emitted bytes
//      match their recorded store spans, cover rows otherwise; no
//      parallel mapping path exists to test.
//   5. NEGATIVE: malformed type forms reject loudly and POSITIONED
//      (rule 5); an unknown face rejects at the API boundary.
//
// The face's TypeScript VALIDITY is gated separately in
// test/tsface-tsc.test.js (the RIP_TSC external-tool pattern).
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { compile, CompileError } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';

const corpusDir = join(import.meta.dir, '../corpus');
const corpusFiles = readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort();

const ts = (source, opts = {}) => compile(source, { runtimeDelivery: 'none', face: 'ts', ...opts });
const js = (source, opts = {}) => compile(source, { runtimeDelivery: 'none', ...opts });

// The module marker: every non-module program's face ends with a
// TS-only `export {};` — the byte pins spell it through this constant
// (module-shaped fixtures carry their own import/export and no marker).
const MARKER = '\nexport {};\n';

// ── 1. the strip gate ────────────────────────────────────────────────

// Every TS-only region, trimmed, must take one of the type-syntax
// shapes the face emits. `(` and `)` are the parens TS requires
// around an annotated single arrow param (JS mode drops them); `!: T`
// is a bare typed forward's definite-assignment spelling.
// Names take the full TS/Rip identifier shape — unicode identifiers
// are legal in both (`type Ω = number`).
const ID = String.raw`[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*`;
const REGION_SHAPES = [
  /^!?: \S/u,                                             // annotation `: T` / forward `!: T`
  /^[()]$/u,                                              // arrow-param / cast parens
  /^as\s+\S/u,                                            // the cast's `as T` spelling
  /^this: \S/u,                                           // schema callable `this` param 
  /^export \{\};$/u,                                      // module marker
  new RegExp(String.raw`^declare (static |readonly )?${ID}: \S`, 'su'), // component member declare / static-mount narrowing / =! readonly 
  /^\[key: `_\$\{string\}`\]: any;$/u,                    // the component slot-namespace index signature (M12-E)
  /^constructor\(props\??: \{ .*\{ super\(props\); \}$/su, // the component props ctor (M12-E)
  /^as any\)?$/u,                                          // scaffold/handler quieting casts (M12-E)
  /^\) as any$/u,                                          // handler cast's TS-only close (arrow-safe grouping)
  /^satisfies \S/u,                                        // reactive value enforcement (finding #3): `v satisfies T`
  /^\($/u,                                                 // computed-lambda wrap opener for `) satisfies () => T`
  /^\) satisfies \(\) => \S/su,                            // computed return enforcement (finding #3)
  new RegExp(String.raw`^(export )?type ${ID}`, 'u'),      // alias / enum companion / schema alias
  new RegExp(String.raw`^(export )?interface ${ID}`, 'u'), // interface / schema intrinsic block
  new RegExp(String.raw`^function ${ID}\(.*\): [^;]+;$`, 'su'), // overload signature
  /^\/\/[ \t]*@ts-(expect-error|ignore|nocheck)(\s|$)/u,        // directive comment line
];

describe('the strip gate: TS face minus recorded regions === JS mode, byte-for-byte', () => {
  for (const file of corpusFiles) {
    test(file, () => {
      const source = readFileSync(join(corpusDir, file), 'utf8');
      for (const runtimeDelivery of ['none', 'inline', 'import']) {
        const faced = compile(source, { path: file, runtimeDelivery, face: 'ts' });
        const plain = compile(source, { path: file, runtimeDelivery });
        expect(stripFace(faced.code, faced.tsRegions)).toBe(plain.code);
        // Regions are ascending, disjoint, in-range — the splice
        // transform's preconditions.
        let prev = 0;
        for (const [start, end] of faced.tsRegions) {
          expect(start).toBeGreaterThanOrEqual(prev);
          expect(end).toBeGreaterThan(start);
          expect(end).toBeLessThanOrEqual(faced.code.length);
          prev = end;
          const text = faced.code.slice(start, end).trim();
          expect(
            REGION_SHAPES.some((re) => re.test(text)),
            `unrecognized TS-only region shape in ${file}: ${JSON.stringify(text)}`,
          ).toBe(true);
        }
        // JS mode records no regions — the strip gate is not vacuous
        // there, it is structural.
        expect(plain.tsRegions).toEqual([]);
      }
    });
  }

  test('the gate is not vacuous: typed corpus files produce TS-only regions', () => {
    const faced = compile(readFileSync(join(corpusDir, 'types.rip'), 'utf8'), {
      path: 'types.rip', runtimeDelivery: 'none', face: 'ts',
    });
    expect(faced.tsRegions.length).toBeGreaterThan(0);
  });
});

// ── 2/3. emission pins per surface ───────────────────────────────────

describe('TS-face emission pins', () => {
  test('typed declaration: the hoist line carries the annotation; the assignment stays bare', () => {
    expect(ts('x: number = 5\nx = 7\n').code).toBe('let x: number = 5;\nx = 7;' + MARKER);
  });

  test('bare typed forward: the annotation reaches the hoist line with the definite-assignment assertion', () => {
    // `!` because a forward has no declaration-site initializer: plain
    // `let r: T` would raise TS2454 on read-before-assign patterns
    // that are legal Rip (hoisted reads yield undefined) — noise the
    // unannotated twin never draws.
    // The bare `r` read before the write keeps `r` legitimately
    // hoisted (a straight-line forward would re-home inline).
    expect(ts('r: Map<string, number>\nr\nr = new Map()\n').code)
      .toBe('let r!: Map<string, number>;\n\nr;\nr = new Map();' + MARKER);
  });

  test('a forward\'s annotation re-homes inline at its declaring write', () => {
    // A straight-line forward's write qualifies for Tier 1
    // declare-in-place: the annotation moves onto the declaration
    // (no `!` — the initializer makes the assertion unnecessary),
    // and stripping restores the untyped twin's bytes.
    const faced = ts('r: number\nr = 5\n');
    expect(faced.code).toBe('let r: number = 5;' + MARKER);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js('r: number\nr = 5\n').code);
  });

  test('a use-before-write forward keeps the hoist-line manifestation', () => {
    // The bare `console.log r` read before the write disqualifies
    // declare-in-place, so the annotation keeps its `!` hoist-line
    // spelling exactly as before.
    const faced = ts('r: number\nconsole.log r\nr = 5\n');
    expect(faced.code).toBe('let r!: number;\n\nconsole.log(r);\nr = 5;' + MARKER);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js('r: number\nconsole.log r\nr = 5\n').code);
  });

  test('a sibling RUN of bare forwards (the sibling run): every member reaches the hoist line as `name!: T`, strip is the twin', () => {
    // The bare `a`/`b` reads before the writes keep both members
    // legitimately hoisted (straight-line forwards re-home inline).
    const src = 'a: number\nb: string\na\nb\na = 1\nb = "s"\n';
    const faced = ts(src);
    expect(faced.code).toBe('let a!: number, b!: string;\n\na;\nb;\na = 1;\nb = "s";' + MARKER);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
    // Generic members carry their full type text.
    expect(ts('a: Map<string, number>\nb: Set<number>\na\nb\na = new Map()\nb = new Set()\n').code)
      .toBe('let a!: Map<string, number>, b!: Set<number>;\n\na;\nb;\na = new Map();\nb = new Set();' + MARKER);
  });

  test('the TS2454 repros: forward read-before-assign and conditional-assign-then-read stay assertion-declared', () => {
    const bare = ts('y: number\nz = y\ny = 1\n');
    expect(bare.code).toBe('let y!: number;\n\nlet z = y;\ny = 1;' + MARKER);
    expect(stripFace(bare.code, bare.tsRegions)).toBe(js('y: number\nz = y\ny = 1\n').code);
    const conditional = ts('flag = true\ny: number\nif flag\n  y = 1\nz = y\n');
    expect(conditional.code).toContain('let y!: number;');
    expect(stripFace(conditional.code, conditional.tsRegions))
      .toBe(js('flag = true\ny: number\nif flag\n  y = 1\nz = y\n').code);
  });

  test('unannotated hoisted names stay bare — evolving-let, never an invented type', () => {
    expect(ts('y = 1\ny = "s"\n').code).toBe('let y = 1;\ny = "s";' + MARKER);
  });

  test('a LATER annotated assignment still types the hoist line (first annotation wins)', () => {
    // The leading bare `q` read keeps `q` legitimately hoisted (a
    // straight-line first write would declare in place instead).
    expect(ts('q\nq = null\nq: number = 5\n').code).toBe('let q: number;\n\nq;\nq = null;\nq = 5;' + MARKER);
  });

  test('a forward inside a def body types the def\'s own hoist line', () => {
    // The bare `r` read before the write keeps `r` legitimately
    // hoisted in the def's scope (straight-line re-homes inline).
    expect(ts('def f()\n  r: number\n  r\n  r = 5\n  r\n').code)
      .toBe('function f() {\n  let r!: number;\n  r;\n  r = 5;\n  return r;\n}' + MARKER);
    // The  erasure filter reaches def bodies — the def path
    // routes through liveStmts like every other function body.
    expect(js('def f()\n  r: number\n  r\n  r = 5\n  r\n').code)
      .toBe('function f() {\n  let r;\n  r;\n  r = 5;\n  return r;\n}');
  });

  test('an inner scope\'s annotation never leaks to a sibling scope\'s same-named hoist', () => {
    // The bare `m` read before the write keeps `m` legitimately
    // hoisted in its own scope (straight-line re-homes inline).
    const src = 'outer = ->\n  n = 1\n  inner = ->\n    n = 5\n  inner\nt = ->\n  m: string\n  m\n  m = "s"\n  m\n';
    const code = ts(src).code;
    expect(code).toContain('let m!: string;');
    expect(code).not.toContain('n: string');
  });

  test('params: plain, default, rest, pattern — annotations flow; defaults keep their values', () => {
    expect(ts('f = (a: string, b: number = 2, ...rest: boolean[]) -> a\n').code)
      .toBe('let f = function(a: string, b: number = 2, ...rest: boolean[]) {\n  return a;\n};' + MARKER);
    expect(ts('p = ({a, b}: {a: number, b: string}) -> a\n').code)
      .toBe('let p = function({a, b}: {a: number, b: string}) {\n  return a;\n};' + MARKER);
  });

  test('single typed arrow param gains TS-only parens (TS requires them; stripping restores the bare name)', () => {
    const r = ts('g = (v: number) => v\n');
    expect(r.code).toBe('let g = (v: number) => v;' + MARKER);
    expect(js('g = (v: number) => v\n').code).toBe('let g = v => v;');
    expect(stripFace(r.code, r.tsRegions)).toBe(js('g = (v: number) => v\n').code);
  });

  test('return types: def, arrow, parameterless def; async wraps as Promise<T> (TS1064)', () => {
    expect(ts('def f(a: number): string\n  String(a)\n').code)
      .toBe('function f(a: number): string {\n  return String(a);\n}' + MARKER);
    expect(ts('k = (x): number => x + 1\n').code).toBe('let k = (x): number => (x + 1);' + MARKER);
    expect(ts('def go(a: number): number\n  await a\n').code)
      .toBe('async function go(a: number): Promise<number> {\n  return await a;\n}' + MARKER);
    // A user-spelled Promise passes through unwrapped.
    expect(ts('def go2(a: number): Promise<number>\n  await a\n').code)
      .toBe('async function go2(a: number): Promise<number> {\n  return await a;\n}' + MARKER);
  });

  test('void definitions annotate `: void` (async: Promise<void>) under the voidMarker', () => {
    expect(ts('def save!(x)\n  x\n').code).toBe('function save(x): void {\n  x;\n  return;\n}' + MARKER);
    expect(ts('tick! = (x) =>\n  x\n').code).toBe('let tick;\n\ntick = (x): void => {\n  x;\n  return;\n};' + MARKER);
    expect(ts('def flush!(x)\n  await x\n').code)
      .toBe('async function flush(x): Promise<void> {\n  await x;\n  return;\n}' + MARKER);
  });

  test('structured aliases: one-line, generic, block union, block object, wrapped single', () => {
    expect(ts('type ID = string\nz = 1\n').code).toBe('type ID = string;\nlet z = 1;' + MARKER);
    expect(ts('type Pair<A, B> = [A, B]\nz = 1\n').code).toBe('type Pair<A, B> = [A, B];\nlet z = 1;' + MARKER);
    expect(ts('type R =\n  | Ok\n  | Err\nz = 1\n').code).toBe('type R = Ok | Err;\nlet z = 1;' + MARKER);
    expect(ts('type S =\n  x: number\n  y: string\nz = 1\n').code)
      .toBe('type S = {\n  x: number;\n  y: string;\n};\nlet z = 1;' + MARKER);
    expect(ts('type W =\n  Map<K,\n  V>\nz = 1\n').code).toBe('type W = Map<K, V>;\nlet z = 1;' + MARKER);
    // A type-only export erases from the JS emission (the shipped
    // program has no export statement), so the marker still
    // appends — redundant TS-wise (the exported alias already makes
    // the face a module) but honest about the value-level shape.
    expect(ts('export type Q = number\nz = 1\n').code).toBe('export type Q = number;\nlet z = 1;' + MARKER);
  });

  test('a unicode-named type declaration renders, strips, and passes the region-shape spec', () => {
    const src = 'type Ω = number\nω: Ω\nω = 1\n';
    const faced = ts(src);
    expect(faced.code).toBe('let ω!: Ω;\n\ntype Ω = number;\nω = 1;' + MARKER);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
    for (const [start, end] of faced.tsRegions) {
      const text = faced.code.slice(start, end).trim();
      expect(
        REGION_SHAPES.some((re) => re.test(text)),
        `unicode region failed the shape spec: ${JSON.stringify(text)}`,
      ).toBe(true);
    }
  });

  test('the `x =>` call parse stays a call in both faces (the marker is the only region, strip-equal)', () => {
    // Rip parses `f = x => x * 2` as a CALL of `x` with an arrow
    // argument — not an arrow with param x. Both faces agree, the
    // module marker is the face's ONLY TS-only region, and the
    // strip gate restores the JS bytes.
    const src = 'f = x => x * 2\n';
    const faced = ts(src);
    const jsBytes = 'let f = x(() => (x * 2));';
    expect(faced.code).toBe(jsBytes + MARKER);
    expect(faced.tsRegions).toEqual([[jsBytes.length, faced.code.length]]);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
  });

  test('structured interfaces: members, method shorthand, extends, generics (the delivered M8-B reservation)', () => {
    expect(ts('interface P\n  x: number\n  m(v: number): void\nz = 1\n').code)
      .toBe('interface P {\n  x: number;\n  m(v: number): void;\n}\nlet z = 1;' + MARKER);
    expect(ts('interface P<T extends string> extends Q<T>\n  x: T\nz = 1\n').code)
      .toBe('interface P<T extends string> extends Q<T> {\n  x: T;\n}\nlet z = 1;' + MARKER);
  });

  test('type declarations inside function bodies cluster at the body top (TS hoists types)', () => {
    expect(ts('fn = ->\n  type Local = number\n  v: Local\n  v = 3\n  v\n').code)
      .toBe('let fn = function() {\n  type Local = number;\n  let v: Local = 3;\n  return v;\n};' + MARKER);
  });

  test('overload signatures print adjacent to their implementation (TS2391)', () => {
    expect(ts('def f(a: number): string\ndef f(a: string): string\ndef f(a)\n  String(a)\n').code)
      .toBe('function f(a: number): string;\nfunction f(a: string): string;\nfunction f(a) {\n  return String(a);\n}' + MARKER);
  });

  test('typed class fields, methods, and void methods', () => {
    expect(ts('class A\n  x: number = 5\n  y: string\n  m: (v: number): number -> v\n  save!: (v) ->\n    v\n').code)
      .toBe('class A {\n  x: number = 5;\n  y: string;\n  m(v: number): number {\n    return v;\n  }\n  save(v): void {\n    v;\n    return;\n  }\n}' + MARKER);
  });

  test('exported typed declarations annotate the const', () => {
    expect(ts('export x: number = 5\n').code).toBe('export const x: number = 5;');
  });

  test('reactive containers type as the branded { value: T; read(): T } (computed readonly); readonly/effect handles as T', () => {
    const code = ts('count: number := 0\ntotal: number ~= count * 2\nro: string =! "s"\nh: Function ~> console.log(count)\n').code;
    // Annotated reactives also ENFORCE the value via face-only
    // `satisfies` (finding #3).
    expect(code).toContain('const count: { value: number; read(): number } = __state(0 satisfies number);');
    expect(code).toContain('const total: { readonly value: number; read(): number } = __computed((() => (count.value * 2)) satisfies () => number);');
    expect(code).toContain('const ro: string = "s";');
    expect(code).toContain('const h: Function = __effect(() => { console.log(count.value); });');
  });

  test('an enum gains its type companion — annotations naming the enum resolve', () => {
    expect(ts('enum Color\n  red = 0\n  green = 1\npick: Color = Color.red\n').code)
      .toBe('const Color = {red: 0, green: 1, 0: "red", 1: "green"};\ntype Color = (typeof Color)[keyof typeof Color];\nlet pick: Color = Color.red;' + MARKER);
    expect(ts('export enum Tier\n  free = "f"\n').code)
      .toBe('export const Tier = {free: "f", "f": "free"};\nexport type Tier = (typeof Tier)[keyof typeof Tier];');
  });

  test('casts spell into the face as TS-only `(value as T)` (M10-C); stripping restores the bare value', () => {
    const faced = ts('v = data as Widget\n');
    expect(faced.code).toBe('let v = (data as Widget);' + MARKER);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js('v = data as Widget\n').code);
  });

  test('member/call heads through a cast: the TS-only parens carry the accessor binding; JS mode reads through', () => {
    const member = ts('n = (data as Widget).name\n');
    expect(member.code).toBe('let n = (data as Widget).name;' + MARKER);
    expect(stripFace(member.code, member.tsRegions)).toBe('let n = data.name;');
    const call = ts('r = (f as Fn)(1)\n');
    expect(call.code).toBe('let r = (f as Fn)(1);' + MARKER);
    expect(stripFace(call.code, call.tsRegions)).toBe('let r = f(1);');
  });

  test('a non-primary cast value takes its own TS-only parens — TS `as` binds tighter than the bare JS bytes', () => {
    // `a && b as boolean` would parse in TS as `a && (b as boolean)`;
    // the face groups the value so the assertion covers what Rip cast.
    const logical = ts('q = (a && b) as boolean\n');
    expect(logical.code).toBe('let q = ((a && b) as boolean);' + MARKER);
    expect(stripFace(logical.code, logical.tsRegions)).toBe('let q = a && b;');
    const chained = ts('c = x as A as B\n');
    expect(chained.code).toBe('let c = ((x as A) as B);' + MARKER);
    expect(stripFace(chained.code, chained.tsRegions)).toBe('let c = x;');
  });

  test('Balance discipline: an unmatched `<` in a claimed type run rejects loudly from the `<`, in both faces', () => {
    // The balance discipline: a `<` claimed as a generic opener must
    // close inside the run. Rejection (not termination-as-comparison)
    // is the decided treatment — TypeScript's own grammar rejects a
    // type REFERENCE followed by an unclosed `<` (TS1005: the parser
    // commits to a type-argument list), the sibling rejects the
    // class-head `<` the same way, and Rip's chained-comparison
    // lowering would give a terminated `<` a meaning TS never has.
    const rejects = (src, at = src.lastIndexOf('<')) => {
      for (const face of [js, ts]) {
        let err = null;
        try { face(src); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(CompileError);
        expect(err.message).toMatch(/unclosed '<' in a type — the generic argument list never closes/);
        expect(err.start).toBe(at);
      }
    };
    rejects('x = a as T < b\n');                    // the cast form
    rejects('x: T < b = 1\n');                      // the annotation twin
    rejects('y = a as Map<string, number> < b\n');  // after a balanced generic
    rejects('f = (p: T < q) -> p\n');               // the param-annotation twin
    rejects('def h(a): T < b\n  a\n');              // the def-return twin (swallowed its own body)
    rejects('type X = Map<string\ny = 2\n');        // the one-line alias body (the same discipline)
    // A partial close leaves the OUTER `<` as the reported offender
    // (the inner one met the single `>`).
    rejects('x: Map<Map<K, V> = v\n', 'x: Map<Map<K, V> = v\n'.indexOf('<'));
    // The cast message spells the one legal spelling for a comparison
    // of a cast result.
    expect(() => js('x = a as T < b\n')).toThrow(/'\(x as T\) < y'/);
    // An OVER-close (`>>` with one `<` open) fails at the shift
    // token — the actual offender — not at a `<` that met its close.
    for (const src of ['x: Map<K>> 2 = v\n', 'x = a as Map<K>> 2\n']) {
      for (const face of [js, ts]) {
        let err = null;
        try { face(src); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(CompileError);
        expect(err.message).toMatch(/unbalanced '>>' in a type — no open '<' pairs with it/);
        expect(err.start).toBe(src.indexOf('>>'));
      }
    }
  });

  test('Balance boundary: balanced generics, relational/shift enders, and the parenthesized comparison all stay legal', () => {
    const pin = (src, jsBytes, tsBytes) => {
      expect(js(src).code).toBe(jsBytes);
      const faced = ts(src);
      expect(faced.code).toBe(tsBytes + MARKER);
      expect(stripFace(faced.code, faced.tsRegions)).toBe(jsBytes);
    };
    pin('z = a as Map<K, V>\n', 'let z = a;', 'let z = (a as Map<K, V>);');
    pin('c = x as Array<A> as B\n', 'let c = x;', 'let c = ((x as Array<A>) as B);');
    // A comparison of a cast result: the parens end the cast's run.
    pin('w = (a as T) < b\n', 'let w = a < b;', 'let w = (a as T) < b;');
    // `<=` and `<<` are cast stops, never generic openers.
    pin('v = a as T <= b\n', 'let v = a <= b;', 'let v = (a as T) <= b;');
    pin('s = a as T << 2\n', 'let s = a << 2;', 'let s = (a as T) << 2;');
    // The documented ASYMMETRY: a bare `>` never opens a claim, so it
    // ends the cast run and resumes as a comparison — `(a as T) > b`,
    // exactly TS's parse of the same spelling (a `>` cannot start a
    // type-argument list, so tsc terminates the type there too, while
    // the `<` twin rejects in both languages).
    pin('x = a as T > b\n', 'let x = a > b;', 'let x = (a as T) > b;');
    // The unclaimed sibling: `T < b` with no binding `=` fails the
    // complete-type gate, so no run is claimed and the balance
    // discipline never fires — the line keeps its implicit-object
    // reading (the context).
    pin('x: T < b\nx = 1\n', '({x: (T < b)});\nlet x = 1;', '({x: (T < b)});\nlet x = 1;');
  });

  test('the cast annotation row maps EXACT onto its `as T` face bytes; JS mode keeps the cover over the value', () => {
    const faced = ts('v = data as Widget\n');
    const row = faced.mappings.rows.find((m) => m.role === 'annotation');
    expect(faced.code.slice(row.generatedStart, row.generatedEnd)).toBe('as Widget');
    expect(row.mappingKind).toBe('exact');
    const plain = js('v = data as Widget\n');
    const cover = plain.mappings.rows.find((m) => m.role === 'annotation');
    expect(cover.mappingKind).toBe('cover');
    expect(plain.code.slice(cover.generatedStart, cover.generatedEnd)).toBe('data');
  });

  test('the JS face is the default and carries no regions', () => {
    const r = compile('x: number = 5\n');
    expect(r.code).toBe('let x = 5;');
    expect(r.tsRegions).toEqual([]);
  });
});

// ── TS directive comments ──────────────────────────────────────
//
// A whole-line `# @ts-expect-error` / `# @ts-ignore` / file-level
// `# @ts-nocheck` comment reaches the TS face as a TS-only
// `// @ts-…` line under PLACE-OR-DECLINE: it places only where its
// suppression is precise — a SINGLE-LINE statement emission (the
// builder probe decides), a SINGLE-NAME hoist line for a bare typed
// forward, a single-line cluster declaration, an overload row, a
// class member row. Everywhere else — multi-line lowered values
// (comprehension/switch IIFEs, block-bodied function values),
// multi-name hoist lines, multi-line alias/interface bodies — it
// DECLINES: no directive bytes emit, the error stays visible, no
// spurious TS2578. The face-cleanliness and TS2578 self-check rows
// live in test/tsface-tsc.test.js.

describe('TS directive comments', () => {
  const pin = (src, tsBytes) => {
    const faced = ts(src);
    expect(faced.code).toBe(tsBytes + MARKER);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
    // JS mode never sees a directive byte — comments never emit there.
    expect(js(src).code).not.toContain('@ts-');
    return faced;
  };

  test('the directive precedes the DIAGNOSTIC-BEARING line — the assignment, not the hoist line (the hoist split)', () => {
    pin(
 'count: number = 3\nratio: number = 1.5\n# @ts-expect-error totals mix\nbadTotal: string = count + ratio\n',
 'let count: number = 3;\nlet ratio: number = 1.5;\n// @ts-expect-error totals mix\nlet badTotal: string = count + ratio;',
    );
  });

  test('@ts-ignore takes the same placement', () => {
    pin(
 'x: number = 5\n# @ts-ignore\nx = "s"\n',
 'let x: number = 5;\n// @ts-ignore\nx = "s";',
    );
  });

  test('a directive above a bare typed forward precedes the HOIST line — its only manifestation', () => {
    // The bare `q` read before the write keeps `q` legitimately
    // hoisted (a straight-line forward re-homes inline and the
    // directive would re-anchor to the declaring statement).
    pin(
 '# @ts-expect-error\nq: Missing\nq\nq = 1\n',
 '// @ts-expect-error\nlet q!: Missing;\n\nq;\nq = 1;',
    );
  });

  test('a directive above an inlined forward re-anchors to the declaring statement', () => {
    // When the forward's annotation re-homes inline, the declaring
    // `let` becomes the diagnostic-bearing line — the directive
    // follows it (the same place-or-decline rule).
    pin(
 '# @ts-expect-error\nq: Missing\nq = 1\n',
 '// @ts-expect-error\nlet q: Missing = 1;',
    );
  });

  test('Sibling-run interaction: a multi-name hoist line DECLINES — one directive must not swallow sibling forwards\' errors', () => {
    // The bare `a`/`b` reads keep both forwards legitimately hoisted
    // (straight-line forwards re-home inline, leaving no multi-name
    // hoist line to exercise).
    pin(
 '# @ts-expect-error run head\na: Missing\nb: string\na\nb\na = 1\nb = "s"\n',
 'let a!: Missing, b!: string;\n\na;\nb;\na = 1;\nb = "s";',
    );
    // Any second hoisted name declines the same way — the rule is
    // single-name, not forwards-only. `z` is def-touched and `q` is
    // read before its write, so BOTH stay on the hoist line under
    // Tier 1 declare-in-place (a straight-line pair would inline,
    // leaving no hoist line — and the directive would re-anchor).
    pin(
 '# @ts-expect-error\nq: Missing\nq\nq = 1\nz = 2\ndef useZ()\n  z\n',
 'let q!: Missing, z;\n\nq;\nq = 1;\nz = 2;\nfunction useZ() {\n  return z;\n}',
    );
  });

  test('a directive above a SINGLE-LINE type declaration follows it to the scope-top cluster line', () => {
    pin(
 'z = 1\n# @ts-expect-error\ntype X = Missing\nz = 2\n',
 '// @ts-expect-error\ntype X = Missing;\nlet z = 1;\nz = 2;',
    );
  });

  test('multi-line rendered declarations DECLINE — object-alias and interface bodies own inner lines', () => {
    pin(
 'z = 1\n# @ts-expect-error\ntype S =\n  x: number\n  y: string\nz = 2\n',
 'type S = {\n  x: number;\n  y: string;\n};\nlet z = 1;\nz = 2;',
    );
    pin(
 'z = 1\n# @ts-expect-error\ninterface P\n  x: number\nz = 2\n',
 'interface P {\n  x: number;\n}\nlet z = 1;\nz = 2;',
    );
  });

  test('class members (the review-round HIGH): a directive above a field row places at the member, with class padding', () => {
    pin(
 'class A\n  # @ts-expect-error\n  x: number = "s"\na = new A()\n',
 'class A {\n  // @ts-expect-error\n  x: number = "s";\n}\nlet a = new A();',
    );
    // The typed bodiless field is a member row too — never the
    // enclosing scope's hoist line.
    pin(
 'class B\n  # @ts-expect-error\n  y: Missing\nb = new B()\n',
 'class B {\n  // @ts-expect-error\n  y: Missing;\n}\nlet b = new B();',
    );
  });

  test('multi-line lowered values PLACE — the directive governs the statement head line (finding #6: never silently dropped)', () => {
    // Comprehension value: the directive rides above the IIFE head.
    pin(
 'items = [1, 2]\n# @ts-expect-error\ndoubled = (x * 2 for x in items)\ndoubled = []\n',
 'let items = [1, 2];\n// @ts-expect-error\nlet doubled = (() => {\n  const result = [];\n  for (let x of items) {\n    result.push((x * 2));\n  }\n  return result;\n})();\ndoubled = [];',
    );
    // Switch-as-value: placed the same way, under @ts-ignore too.
    const sw = ts('k = 1\n# @ts-ignore\nv = switch k\n  when 1 then "a"\n  else "b"\nv = "c"\n');
    expect(sw.code).toContain('// @ts-ignore');
    // Block-bodied function values and class methods place above the
    // head line — the audit's dominant case (an arrow assigned to a
    // typed binding errors on the HEAD line, which the directive
    // governs; an inner-line error stays visible as TS2578,'s
    // behavior, never a silent drop).
    expect(ts('# @ts-expect-error\nf = (x) ->\n  y = x\n  y\nf(1)\n').code).toContain('// @ts-expect-error');
    expect(ts('class C\n  constructor: ->\n    @v = 1\n  # @ts-expect-error\n  m: (v) ->\n    v\nc = new C()\n').code)
      .toContain('// @ts-expect-error');
  });

  test('a directive above an overload signature follows it to the printed overload row', () => {
    pin(
 'def o(a: number): string\n# @ts-expect-error\ndef o(a: string): string\ndef o(a)\n  String(a)\n',
 'function o(a: number): string;\n// @ts-expect-error\nfunction o(a: string): string;\nfunction o(a) {\n  return String(a);\n}',
    );
  });

  test('file-level @ts-nocheck emits as the face\'s FIRST line', () => {
    pin(
 '# @ts-nocheck\nx: number = 5\nx = "s"\n',
 '// @ts-nocheck\nlet x: number = 5;\nx = "s";',
    );
  });

  test('inside a def body the directive line takes the body\'s own indentation', () => {
    pin(
 'def f()\n  # @ts-expect-error\n  r: number = "s"\n  r\n',
 'function f() {\n  // @ts-expect-error\n  let r: number = "s";\n  return r;\n}',
    );
  });

  test('a multi-statement source line: the directive governs the FIRST statement\'s face line only (TS next-line rule)', () => {
    pin(
 'n: number\n# @ts-expect-error next line only\nn = "a"; m = 2\n',
 '// @ts-expect-error next line only\nlet n: number = "a";\nlet m = 2;',
    );
  });

  test('boundaries: everything short of a whole-line adjacent known directive stays an ordinary comment', () => {
    // Unknown @ts-* spellings are just comments in Rip: no directive
    // bytes, no directive region — the marker is the only region.
    expect(ts('# @ts-fancy\nx = 1\n').code).toBe('let x = 1;' + MARKER);
    expect(ts('# @ts-fancy\nx = 1\n').tsRegions).toHaveLength(1);
    // A trailing directive comment has no next-line reading.
    expect(ts('x = 1 # @ts-expect-error\ny = 2\n').code).not.toContain('@ts-');
    // A blank line between directive and statement breaks adjacency —
    // TypeScript's own next-line rule.
    expect(ts('# @ts-expect-error\n\nx = 1\n').code).not.toContain('@ts-');
    // A directive with nothing beneath it governs nothing.
    expect(ts('x = 1\n# @ts-expect-error\n').code).not.toContain('@ts-');
    // @ts-nocheck below code is not file-level; TypeScript would
    // ignore it, so the face never emits it.
    expect(ts('x = 1\n# @ts-nocheck\ny = 2\n').code).not.toContain('@ts-');
    // The directive word must end at whitespace or end-of-comment.
    expect(ts('# @ts-expect-error-ish note\nx = 1\n').code).not.toContain('@ts-');
  });

  test('the directive row: cover by construction on the governed statement\'s node, real trivia span', () => {
    const src = 'x: number = 5\n# @ts-expect-error boom\nx = "s"\n';
    const r = ts(src);
    const row = r.mappings.rows.find((m) => m.role === 'tsDirective');
    expect(row).toBeDefined();
    expect(row.mappingKind).toBe('cover');
    expect(src.slice(row.sourceStart, row.sourceEnd)).toBe('# @ts-expect-error boom');
    expect(r.code.slice(row.generatedStart, row.generatedEnd)).toBe('// @ts-expect-error boom');
    // JS mode carries no directive rows — the channel is face-only.
    expect(js(src).mappings.rows.some((m) => m.role === 'tsDirective')).toBe(false);
  });
});

// ── 4. mapping pins ──────────────────────────────────────────────────

describe('TS-face mapping rows (the same mark protocol)', () => {
  test('a hoist-line annotation is an EXACT row on the annotation role (source bytes match)', () => {
    const src = 'x: number = 5\n';
    const r = ts(src);
    const rows = r.mappings.rows.filter((m) => m.role === 'annotation');
    // Two manifestations: the exact `: number` in the hoist line and
    // the cover over the whole assignment.
    const exact = rows.find((m) => m.mappingKind === 'exact');
    expect(exact).toBeDefined();
    expect(src.slice(exact.sourceStart, exact.sourceEnd)).toBe(': number');
    expect(r.code.slice(exact.generatedStart, exact.generatedEnd)).toBe(': number');
    expect(rows.some((m) => m.mappingKind === 'cover')).toBe(true);
  });

  test('a typed param annotation is an EXACT row; the param name stays exact too', () => {
    const src = 'f = (a: string) -> a\n';
    const r = ts(src);
    const exact = r.mappings.rows.find((m) => m.role === 'annotation' && m.mappingKind === 'exact');
    expect(exact).toBeDefined();
    expect(r.code.slice(exact.generatedStart, exact.generatedEnd)).toBe(': string');
  });

  test('a return-type annotation re-marks the returnType role', () => {
    const src = 'def f(a: number): string\n  String(a)\n';
    const r = ts(src);
    const rows = r.mappings.rows.filter((m) => m.role === 'returnType');
    const exact = rows.find((m) => m.mappingKind === 'exact');
    expect(exact).toBeDefined();
    expect(r.code.slice(exact.generatedStart, exact.generatedEnd)).toBe(': string');
  });

  test('a rendered type declaration owns real-width rows in the face (zero-width in JS mode)', () => {
    const src = 'type ID = string\nz = 1\n';
    const faced = ts(src);
    const rendered = faced.mappings.rows.filter((m) => m.role === 'declaration' && m.generatedEnd > m.generatedStart);
    expect(rendered).toHaveLength(1);
    expect(faced.code.slice(rendered[0].generatedStart, rendered[0].generatedEnd)).toBe('type ID = string;');
    // JS mode: the honest zero-width record, as always.
    const plain = js(src);
    for (const m of plain.mappings.rows.filter((r2) => r2.role === 'declaration')) {
      expect(m.generatedStart).toBe(m.generatedEnd);
    }
  });

  test('an overload row maps its def-sig roles onto the printed signature', () => {
    const src = 'def f(a: number): string\ndef f(a)\n  String(a)\n';
    const r = ts(src);
    const sigRows = r.mappings.rows.filter((m) => m.role === 'name' && m.generatedEnd > m.generatedStart);
    // Two name manifestations: the overload row's and the function's.
    expect(sigRows.length).toBe(2);
    const overloadSelf = r.mappings.rows.find(
      (m) => m.role === '$self' && r.code.slice(m.generatedStart, m.generatedEnd) === 'function f(a: number): string;',
    );
    expect(overloadSelf).toBeDefined();
    expect(src.slice(overloadSelf.sourceStart, overloadSelf.sourceEnd)).toBe('def f(a: number): string');
  });

  test('reverse queries resolve TS-face positions (bestAtGenerated inside an annotation)', () => {
    const src = 'x: number = 5\n';
    const r = ts(src);
    const at = r.code.indexOf(': number') + 3; // inside `number` in the hoist line
    const row = r.mappings.bestAtGenerated(at);
    expect(row).not.toBeNull();
    expect(src.slice(row.sourceStart, row.sourceEnd)).toBe(': number');
  });
});

// ── 4b. the component face ───────────────────────────────────
// Component classes carry TS-only member declares for every member
// kind, the props-surface constructor, the typed _init signature, the
// slot-namespace index signature, and the companion interface —
// src/component-types.js renders the story for this face and the
// .d.ts alike.

describe('the component face (M12-E): TS-only member declares, the props ctor, the companion interface', () => {
  const FIXTURE = [
 'Counter = component',
 '  count := 0',
 '  @label',
 '  @opt?',
 '  @max?: number',
 '  @title: string',
 '  @step: number := 1',
 '  total: number ~= count * 2',
 '  limit: number =! 100',
 '  note = "n"',
 '  accept theme',
 '  bump = (n: number): number -> count += n',
 '  mounted = -> console.log "hi"',
 '',
  ].join('\n');

  test('every member kind declares: state/prop containers, computed readonly, readonly/plain/accept raw', () => {
    const code = ts(FIXTURE).code;
    expect(code).toContain('declare count: { value: number; read(): number };');       // unannotated state: literal initializers infer syntactically 
    expect(code).toContain('declare label: { value: any; read(): any };');          // bare prop
    expect(code).toContain('declare opt: { value: any; read(): any };');            // optional bare prop
    expect(code).toContain('declare max: { value: number | undefined; read(): number | undefined };'); // @max?: number — the value may be absent
    expect(code).toContain('declare title: { value: string; read(): string };');       // required typed prop
    expect(code).toContain('declare step: { value: number; read(): number };');        // typed defaulted prop
    expect(code).toContain('declare total: { readonly value: number; read(): number };'); // computed
    expect(code).toContain('declare readonly limit: number;'); // =! members declare readonly                   // readonly: the raw value
    expect(code).toContain('declare note: string;');                   // plain field: literal initializer infers 
    expect(code).toContain('declare theme: any;');                     // accept: the cross-component boundary is honest any
    expect(code).toContain('declare children: any;');                  // the projection slot (slot reads this.children)
    expect(code).toContain('[key: `_${string}`]: any;');               // the minted/runtime slot namespace
  });

  test('methods and hooks are REAL class methods with annotations — never declares', () => {
    const code = ts(FIXTURE).code;
    expect(code).toContain('bump(n: number): number {');
    expect(code).not.toContain('declare bump');
    expect(code).not.toContain('declare mounted');
  });

  test('the props ctor: optional entries with container unions and bind slots; the REQUIRED prop is an arm', () => {
    const code = ts(FIXTURE).code;
    expect(code).toContain('max?: number | { value: number; read(): number }');
    expect(code).toContain('__bind_max__?: { value: number; read(): number }');
    expect(code).toContain('label?: any');
    expect(code).toContain('children?: any');
    // @title: string (annotated, no marker, no default) is REQUIRED —
    // passable as the plain slot or the `<=>` container slot.
    expect(code).toContain('& ({ title: string | { value: string; read(): string } } | { __bind_title__: { value: string; read(): string } })');
    // A required prop makes the ctor's props param required.
    expect(code).toContain('constructor(props: {');
    expect(code).toContain(') { super(props); }');
  });

  test('_init carries the same props annotation (TS-only)', () => {
    const code = ts(FIXTURE).code;
    const init = code.slice(code.indexOf('_init(props'));
    expect(init.slice(0, 200)).toContain('_init(props: {');
  });

  test('an all-optional props surface takes `props?:`', () => {
    const code = ts('Chip = component\n  @label := "c"\n').code;
    expect(code).toContain('constructor(props?: {');
    // Optional props keep the inherited static mount callable.
    expect(code).not.toContain('declare static mount');
  });

  test('a REQUIRED prop narrows the inherited static mount to never (F2)', () => {
    // Static mount constructs with NO props — offering it under a
    // required prop would be tsc-clean while the runtime yields a
    // required container holding undefined. Requiredness is a
    // type-story fact (annotations erase, ), so the gate is a
    // face/dts fact, never a runtime throw. `never` (not a
    // self-explaining literal type) because the override must stay
    // assignable to the REAL base's static side in the editor —
    // only bottom is both assignable and uncallable.
    const code = ts(FIXTURE).code;
    expect(code).toContain('declare static mount: never;');
  });

  test('the companion interface: the instance surface under the binding name (value/type pairing)', () => {
    const code = ts(FIXTURE).code;
    expect(code).toContain('interface Counter {');
    expect(code).toContain('  mount(target?: any): Counter;');
    expect(code).toContain('  unmount(options?: { removeDOM?: boolean }): void;');
    expect(code).toContain('  emit(name: string, detail?: any): void;');
    expect(code).toContain('  bump(n: number): number;');
    // An exported component exports its companion.
    expect(ts('export Chip = component\n  @label: string\n').code).toContain('export interface Chip {');
  });

  test('extends: the tag attribute surface + string index in the props type, the rest declare', () => {
    const code = ts('Deck = component extends section\n  name := "n"\n  render\n    section.deck\n      = name\n').code;
    expect(code).toContain('declare rest: { value: Record<string, any>; read(): Record<string, any> };');
    // Intrinsic attrs type through the tag's DOM interface with an
    // extends-Record guard; camelCased DOM twins get
    // their own entries (tabindex/tabIndex).
    expect(code).toContain(`id?: HTMLElementTagNameMap["section"] extends Record<'id', infer T> ? T : any`);
    expect(code).toContain(`class?: HTMLElementTagNameMap["section"] extends Record<'class', infer T> ? T : any`);
    expect(code).toContain(`tabIndex?: HTMLElementTagNameMap["section"] extends Record<'tabIndex', infer T> ? T : any`);
    expect(code).toContain('[key: string]: any');
  });

  test('render scaffold quiets TS-only: swap/reconcile state types any, handler calls cast', () => {
    const src = [
 'Roster = component',
 '  items := [1]',
 '  vis := true',
 '  onClick = -> vis = !vis',
 '  render',
 '    div',
 '      button @click',
 '      if vis',
 '        p "on"',
 '      ul',
 '        for item in items',
 '          li key: item',
 '            = item',
 '',
    ].join('\n');
    const faced = ts(src);
    expect(faced.code).toContain('let currentBlock: any = null;');
    expect(faced.code).toContain('let showing: any = null;');
    expect(faced.code).toContain('const __s: any = { blocks: [], keys: [] };');
    expect(faced.code).toContain('((this.onClick) as any)(e)');
    expect(faced.code).toContain('(this as any)._first = ');
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
  });

  test('strip identity holds for the component fixture under both runtime deliveries', () => {
    for (const runtimeDelivery of ['none', 'inline']) {
      const faced = compile(FIXTURE, { runtimeDelivery, face: 'ts' });
      const plain = compile(FIXTURE, { runtimeDelivery });
      expect(stripFace(faced.code, faced.tsRegions)).toBe(plain.code);
      expect(plain.tsRegions).toEqual([]);
      // JS mode carries none of the face bytes (the inline runtime
      // body has its own `constructor(`/prose — the pins stay
      // face-shaped).
      expect(plain.code).not.toContain('declare count');
      expect(plain.code).not.toContain('constructor(props?:');
      expect(plain.code).not.toContain('interface Counter');
    }
  });

  test('mapping: a member annotation re-marks EXACT on the declare line; the marker manifests in the props type', () => {
    const r = ts('Chip = component\n  @max?: number\n');
    const annRows = r.mappings.rows.filter((m) => m.role === 'annotation' && m.mappingKind === 'exact');
    expect(annRows.length).toBeGreaterThanOrEqual(1);
    for (const m of annRows) {
      expect(r.code.slice(m.generatedStart, m.generatedEnd)).toBe(': number');
      expect('Chip = component\n  @max?: number\n'.slice(m.sourceStart, m.sourceEnd)).toBe(': number');
    }
    // The optionalMarker role (the side-band `?` span) manifests
    // as the props-surface `?`.
    const opt = r.mappings.rows.filter((m) => m.role === 'optionalMarker' && m.generatedEnd > m.generatedStart);
    expect(opt.length).toBeGreaterThanOrEqual(1);
    for (const m of opt) {
      expect(r.code.slice(m.generatedStart, m.generatedEnd)).toBe('?');
    }
  });

  test('a declared @children prop owns the key — no duplicate `children?: any` in any artifact (the GPT addendum, F1)', () => {
    const src = 'Child = component\n  @children: string\n  render\n    div "x"\nconsole.log Child\n';
    const faced = ts(src);
    const ctorLine = faced.code.split('\n').find((l) => l.includes('constructor('));
    // The declared prop's entry (+ its bind slot and required arm)
    // carries the name; the projection-channel fallback suppresses —
    // a duplicate key is TS2300 on every artifact.
    expect(ctorLine).toContain('children?: string | { value: string; read(): string }');
    expect(ctorLine).not.toContain('children?: any');
    expect(faced.code.split('\n').filter((l) => l.includes('declare children')).length).toBe(1);
    expect(faced.code).toContain('declare children: { value: string; read(): string };');
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
  });

  test('extends an SVG tag: the props surface carries the SVG attribute set (the GPT addendum, F3)', () => {
    const code = ts('Chart = component extends svg\n  n := 1\n  render\n    svg viewBox: "0 0 10 10"\n      = n\n').code;
    expect(code).toContain('viewBox?: any');
    expect(code).toContain("'fill-opacity'?: any"); // hyphenated SVG names quote
    expect(code).toContain('stroke?: any');
    // HTML tags stay HTML-only.
    expect(ts('Btn = component extends button\n  render\n    button "x"\n').code).not.toContain('viewBox');
  });

  test('a boolean-shorthand prop key records an EXACT face row from its derived span (the GPT addendum, F4)', () => {
    const src = 'Chip = component\n  @label := "c"\n  @width := 1\n  render\n    span "s"\nApp = component\n  render\n    div\n      Chip label: "x", w\nconsole.log App\n';
    const r = ts(src);
    const at = src.indexOf(', w') + 2;
    const row = r.mappings.directAtSource(at);
    expect(row).not.toBeNull();
    expect(row.role).toBe('shorthandProp');
    expect(row.mappingKind).toBe('exact');
    expect(r.code.slice(row.generatedStart, row.generatedEnd)).toBe('w');
    // JS mode records no shorthand rows (face-only — the corpus map
    // artifacts stay untouched); bytes are identical either way.
    expect(js(src).mappings.rows.filter((m) => m.role === 'shorthandProp')).toEqual([]);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('member-held nested components carry their own declares; no companion (no module binding)', () => {
    const src = 'Outer = component\n  inner = component\n    n := 1\n  render\n    div "x"\n';
    const code = ts(src).code;
    expect(code).toContain('declare inner: any;');
    expect(code).toContain('declare n: { value: number; read(): number };');
    expect(code).not.toContain('interface inner');
  });
});

// ── 5. negative — loud, positioned rejections ────────────────────────

describe('TS-face negatives', () => {
  test('an unknown face rejects at the API boundary', () => {
    expect(() => compile('x = 1', { face: 'wat' })).toThrow(/unknown face 'wat'/);
  });

  test('a malformed block-alias body rejects POSITIONED in the TS face (the shared renderer, rule 5)', () => {
    const src = 'z = 1\ntype B =\n  | Ok\n  x: number\nw = 2\n';
    // JS mode erases the statement and never renders it — compiles.
    expect(js(src).code).toBe('let z = 1;\nlet w = 2;');
    let err = null;
    try {
      ts(src);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    // The offender is the variant mixed into the object reading — the
    // same selection the dts consumer reports for this body.
    expect(err.message).toMatch(/unrecognized member '\| Ok' in the block body of 'type B'/);
    // Positioned on the declaration's own line, not the file head.
    expect(err.line).toBe(2);
  });

  test('a non-array rest annotation passes through the face — the checker flags it ON SOURCE (TS2370), unlike the shipped dts which rejects', () => {
    const r = ts('f = (...xs: number) -> xs\n');
    expect(r.code).toContain('...xs: number');
    expect(() => js('f = (...xs: number) -> xs\n').declarations).toThrow(/rest parameter's annotation/);
  });
});

// ── Types-gaps wave: type declarations in LOWERED value bodies ──────
//
// The / remainder recorded expression-lowered type
// declarations as pure erasure. This wave closes the reachable
// surface: lowered bodies WITH statement slots (try/switch/if IIFEs,
// accumulator loop bodies, catch-pattern handlers) render their
// type/interface declarations as TS-only cluster lines inside the
// lowering; the one genuinely SLOTLESS position — a ternary-lowered
// value-if branch — flushes its declarations to the enclosing
// statement list (pendingTypeDecls; TS hoists type declarations, so
// the displaced line still governs the arm's uses).
describe('types-gaps wave: type declarations in lowered value bodies reach the face', () => {
  const stripIsTwin = (src) => {
    const faced = ts(src);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
    return faced;
  };

  test('try-IIFE body: the alias renders inside the IIFE; strip is the twin', () => {
    const faced = stripIsTwin('x = try\n  type T = number\n  v = 1 as T\n  v\ncatch e\n  0\n');
    expect(faced.code).toContain('type T = number;\n  v = (1 as T);');
  });

  test('switch-IIFE case body clusters the alias under its case line', () => {
    const faced = stripIsTwin('q = 1\nx = switch q\n  when 1\n    type T = number\n    5\n  else 0\n');
    expect(faced.code).toContain('case 1:\n    type T = number;');
  });

  test('value-if IIFE branch (non-simple) renders the alias in its branch', () => {
    const faced = stripIsTwin('c = true\nx = if c\n  type T = number\n  String(1)\n  1\nelse\n  0\n');
    expect(faced.code).toContain('if (c) {\n  type T = number;');
  });

  test('comprehension/accumulator loop body renders the alias inside the loop', () => {
    const faced = stripIsTwin('r = for i in [1, 2]\n  type T = number\n  i as T\n');
    expect(faced.code).toContain('for (let i of [1, 2]) {\n    type T = number;');
  });

  test('catch-pattern handler renders the alias after the destructure line', () => {
    const faced = stripIsTwin('x = try\n  1\ncatch {message}\n  type E = string\n  message as E\n');
    expect(faced.code).toContain('({message} = error);\n  type E = string;');
  });

  test('SLOTLESS: a ternary-lowered branch flushes its alias to the enclosing list (hoisted, TS-legal)', () => {
    const src = 'c = true\nx = if c\n  type T = number\n  1\nelse\n  0\n';
    const faced = stripIsTwin(src);
    // The ternary shape is untouched (byte parity with the stripped
    // twin demands it); the alias lands after the statement.
    expect(faced.code).toContain('x = c ? 1 : 0;\ntype T = number;');
    // JS mode never sees the declaration.
    expect(js(src).code).not.toContain('type T');
  });

  test('SLOTLESS at program end: the flush supplies its own newline, TS-only', () => {
    const src = 'c = true\nx = if c\n  type T = number\n  1\nelse\n  0';
    const faced = stripIsTwin(src);
    expect(faced.code).toContain('x = c ? 1 : 0;\ntype T = number;');
  });

  test('a lowered-body declaration owns real-width rows in the face, zero-width in JS mode', () => {
    const src = 'x = try\n  type T = number\n  1\ncatch e\n  0\n';
    const faced = ts(src);
    const rendered = faced.mappings.rows.filter((m) => m.role === 'declaration' && m.generatedEnd > m.generatedStart);
    expect(rendered).toHaveLength(1);
    expect(faced.code.slice(rendered[0].generatedStart, rendered[0].generatedEnd)).toBe('type T = number;');
    for (const m of js(src).mappings.rows.filter((r2) => r2.role === 'declaration')) {
      expect(m.generatedStart).toBe(m.generatedEnd);
    }
  });

  test('deliberate erasures stand: module-level @x: T = v keeps pure erasure in both faces', () => {
    const src = '@x: number = 5\n';
    const faced = stripIsTwin(src);
    expect(faced.code).toBe('this.x = 5;' + MARKER);
  });
});

// ── typed prototype members (`X::m: T = v`) ─────────────────────────

describe('typed prototype members', () => {
  // The typed write and its untyped twin ship the same JS: stripping
  // the face restores the twin's bytes exactly.
  const stripEqualsUntyped = (typed, untyped) => {
    const faced = ts(typed);
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js(untyped).code);
    return faced;
  };

  test('outside head: the annotation manifests as a `declare global` augmentation line', () => {
    const faced = stripEqualsUntyped('String::cap: () => string = -> "x"\n', 'String::cap = -> "x"\n');
    expect(faced.code).toBe(
      'declare global { interface String { cap: () => string } }\n' +
      'String.prototype.cap = function() {\n  return "x";\n};' + MARKER);
  });

  test('module class-declaration head: a same-module interface merges with the class', () => {
    const faced = stripEqualsUntyped('class Box\nBox::m: () => number = -> 1\n', 'class Box\nBox::m = -> 1\n');
    expect(faced.code).toContain('interface Box { m: () => number }\n');
    expect(faced.code).not.toContain('declare global');
  });

  test('expression-form class head: the annotation rejects — nothing merges with a let binding', () => {
    expect(() => ts('A = class\nA::m: () => number = -> 1\n'))
      .toThrow(/not a class declaration/);
    // The UNANNOTATED write stays legal anywhere.
    stripEqualsUntyped('A = class\nA::m = -> 1\n', 'A = class\nA::m = -> 1\n');
  });

  test('a nested annotated write rejects — augmentations are module-top-level TS', () => {
    for (const src of [
      'setup = ->\n  String::deep: () => string = -> "d"\n',
      'if c\n  String::deep: () => string = -> "d"\n',
    ]) {
      expect(() => ts(src)).toThrow(/module top-level statement/);
    }
    // The UNANNOTATED nested write stays legal.
    stripEqualsUntyped('if c\n  String::deep = -> "d"\n', 'if c\n  String::deep = -> "d"\n');
  });
});

// The generic globals repeat their parameter list in the
// augmentation — and the member's annotation may NAME the parameter.
describe('typed prototype members on generic globals', () => {
  test('Array repeats <T>, and the annotation can reference it', () => {
    const faced = ts('Array::second: () => T = -> @[1]\n');
    expect(faced.code).toContain('declare global { interface Array<T> { second: () => T } }\n');
    expect(stripFace(faced.code, faced.tsRegions)).toBe(js('Array::second = -> @[1]\n').code);
  });

  test('Map repeats <K, V>', () => {
    const faced = ts('Map::firstKey: () => K = -> @keys().next().value\n');
    expect(faced.code).toContain('declare global { interface Map<K, V> { firstKey: () => K } }\n');
  });
});

// The soak form: `a?::b` reads `a?.prototype.b`. No augmentation ever
// emits for it (an augmentation declares the member EXISTS — a
// conditional write cannot carry that), and the annotated spelling
// rejects shaped.
describe('soak prototype access', () => {
  test('reads and writes strip to their untyped twins; no augmentation anywhere', () => {
    for (const src of ['x = A?::m\n', 'A?::m = 9\n']) {
      const faced = ts(src);
      expect(stripFace(faced.code, faced.tsRegions)).toBe(js(src).code);
      expect(faced.code).not.toContain('interface');
    }
  });

  test('the annotated soak write rejects with the fix named', () => {
    expect(() => ts('String?::cap: () => string = -> "x"\n'))
      .toThrow(/soak form cannot carry the annotation/);
  });
});
