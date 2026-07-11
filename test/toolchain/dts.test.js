// In-memory .d.ts generation (the canonical pipeline). compile()
// returns `declarations` — generated
// from the RECORDED annotation spans in the side tables, lazily on
// first access, never written
// to disk by the compiler. The zero-cost gate extends: a file with no
// types yields the trivial (empty) declaration, and requesting
// declarations never changes what the compile produced.
//
// src/dts.js is the reference for declaration SHAPES. The `declare`
// prefix on module bindings is the settled convention; the bare
// `let x: T` form serves a checker's merge pass.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { compile, CompileError } from '../../src/compile.js';

const dts = (src) => compile(src).declarations;

// ── The declaration surface, row by row ──────────────────────────────
const ROWS = [
  // typed declarations → declare let (the delivery shapes)
  ['x: number = 5', 'declare let x: number;\nexport {};\n'],
  ['export x: number = 5', 'export declare let x: number;\n'],
  ['flags: {a: number, b?: string} = {a: 1}', 'declare let flags: {a: number, b?: string};\nexport {};\n'],
  ['pick: (n: number) => number = (n: number) -> n + 1', 'declare let pick: (n: number) => number;\nexport {};\n'],
  ['y: "lit" = v', 'declare let y: "lit";\nexport {};\n'],
  // bare typed forward declarations
  ['r: number\nr = 5', 'declare let r: number;\nexport {};\n'],
  // a sibling RUN of bare forwards declares every member
  ['a: number\nb: string\na = 1\nb = "s"', 'declare let a: number;\ndeclare let b: string;\nexport {};\n'],
  // typed prototype members: an outside head declares the global
  // augmentation (the module patches the global, so its declaration
  // says so); a module-declared head declares nothing extra (the
  // face's same-module interface is the merge target); an untyped
  // write declares nothing
  ['String::cap: () => string = -> "x"', 'declare global { interface String { cap: () => string } }\nexport {};\n'],
  ['class Box\n  v: number\nBox::m: () => number = -> 1', 'declare class Box {\n  v: number;\n}\nexport {};\n'],
  ['A::m = -> 1', ''],
  // generic globals repeat their parameter list in the augmentation
  ['Array::second: () => T = -> @[1]', 'declare global { interface Array<T> { second: () => T } }\nexport {};\n'],
  // typed defs → declare function; defaulted params turn optional
  ['def clamp(v: number, lo: number = 0, hi: number = limit): number\n  v', 'declare function clamp(v: number, lo?: number, hi?: number): number;\nexport {};\n'],
  ['export def area(w: number, h: number): number\n  w * h', 'export declare function area(w: number, h: number): number;\n'],
  ['def g: number\n  5', 'declare function g(): number;\nexport {};\n'],
  // missing annotations render EXPLICIT any (implicit any is a tsc
  // error in declaration files)
  ['def f(a, b: number)\n  a', 'declare function f(a: any, b: number): any;\nexport {};\n'],
  // a rest parameter's annotation is the WHOLE rest type — every
  // array-shaped spelling passes through verbatim (the non-array
  // spelling rejects; see the negative block)
  ['scale = (factor: number, ...rest: number[]) -> factor + rest.length', 'declare function scale(factor: number, ...rest: number[]): any;\nexport {};\n'],
  ['def g(...xs: [number, string])\n  xs', 'declare function g(...xs: [number, string]): any;\nexport {};\n'],
  ['f = (...xs: Array<number>) -> xs', 'declare function f(...xs: Array<number>): any;\nexport {};\n'],
  ['f = (...xs: ReadonlyArray<string>) -> xs', 'declare function f(...xs: ReadonlyArray<string>): any;\nexport {};\n'],
  // typed arrow assignments; pattern params re-render without defaults
  ['double = (x: number): number -> x * 2', 'declare function double(x: number): number;\nexport {};\n'],
  ['pair = ({a, b}: Opts = {a: 2, b: 3}) -> a * b', 'declare function pair({a, b}?: Opts): any;\nexport {};\n'],
  ['f = ([a, b]: Pair) -> a', 'declare function f([a, b]: Pair): any;\nexport {};\n'],
  // an untyped pattern param beside a typed one re-renders with its
  // inner default dropped (TS1039: no initializers in ambient
  // contexts) and a reconstructed explicit-any structural type
  ['f = ({a, b = 1}, n: number) -> a', 'declare function f({a, b}: {a: any, b?: any}, n: number): any;\nexport {};\n'],
  ['f = ({a, b = 1}) -> a', ''],
  // the void-marker family declares `: void`
  ['def save!(x: number)\n  x', 'declare function save(x: number): void;\nexport {};\n'],
  ['def tick!\n  1', 'declare function tick(): void;\nexport {};\n'],
  ['save! = (x) -> x', 'declare function save(x: any): void;\nexport {};\n'],
  ['export save! = (x: number) -> x', 'export declare function save(x: number): void;\n'],
  // an explicit return type on a void def wins (the rule; the marker
  // still suppresses the implicit return at runtime)
  ['def typed!(x): Number\n  bump(x)', 'declare function typed(x: any): Number;\nexport {};\n'],
  // bodiless overload signatures
  ['def f(a: number): string\ndef f(a)\n  a', 'declare function f(a: number): string;\nexport {};\n'],
  [
    'def f(a: number): string\ndef f(a: string): string\ndef f(a)\n  String(a)',
    'declare function f(a: number): string;\ndeclare function f(a: string): string;\nexport {};\n',
  ],
  // type aliases and interfaces re-emit as TS declarations
  ['type ID = string\nx = 5', 'type ID = string;\nexport {};\n'],
  ['type Pair<A, B> = [A, B]\nz = 1', 'type Pair<A, B> = [A, B];\nexport {};\n'],
  ['export type ID = string\nz = 1', 'export type ID = string;\n'],
  ['type R =\n  | Ok\n  | Err\nz = 1', 'type R = Ok | Err;\nexport {};\n'],
  ['type R =\n  | Ok\n  # note between variants\n  | Err\nz = 1', 'type R = Ok | Err;\nexport {};\n'],
  ['type Shape =\n  kind: string\n  size: number\nz = 1', 'type Shape = {\n  kind: string;\n  size: number;\n};\nexport {};\n'],
  ['type T =\n  Map<K,\n  V>\ny = 2', 'type T = Map<K, V>;\nexport {};\n'],
  // the block-body OBJECT-MEMBER grammar: index signatures, call
  // signatures, quoted/numeric keys, readonly modifiers — each a
  // recognized member shape, braced like the interface path
  ['type M =\n  [key: string]: number\nz = 1', 'type M = {\n  [key: string]: number;\n};\nexport {};\n'],
  ['type C =\n  (x: number): string\nz = 1', 'type C = {\n  (x: number): string;\n};\nexport {};\n'],
  ['type Q =\n  "a-b": string\n  0: boolean\nz = 1', 'type Q = {\n  "a-b": string;\n  0: boolean;\n};\nexport {};\n'],
  // Single-quoted keys normalize to double (the TS display convention,
  // same rule as string-literal types — the Q row above shows the
  // double-quoted spelling passing through unchanged).
  ["type Q2 =\n  'k-2': number\nz = 1", 'type Q2 = {\n  "k-2": number;\n};\nexport {};\n'],
  ['type R2 =\n  readonly x: number\n  readonly [k: string]: number\nz = 1', 'type R2 = {\n  readonly x: number;\n  readonly [k: string]: number;\n};\nexport {};\n'],
  // union with a plain LEADING variant; wrapped parenthesized and
  // tuple types stay single wrapped types (their missing member
  // colon is what keeps them out of the object classification)
  ['type U2 =\n  Map<K, V>\n  | Other\nz = 1', 'type U2 = Map<K, V> | Other;\nexport {};\n'],
  ['type W2 =\n  (A | B)\nz = 1', 'type W2 = (A | B);\nexport {};\n'],
  ['type T2 =\n  [A, B]\nz = 1', 'type T2 = [A, B];\nexport {};\n'],
  // an index-signature KEY may nest its own brackets — the balanced
  // scan recognizes the member (the anchored regex once let it fall
  // through SINGLE and ship unbraced)
  ['type T =\n  [k: A[B]]: number\nz = 1', 'type T = {\n  [k: A[B]]: number;\n};\nexport {};\n'],
  // lexer-normalized union spellings re-space at the declaration
  // boundary (the token compaction eats the space before a top-level
  // bar); annotation spans keep the user's spelling as ever
  ['f = (a: number[] | string[]) -> a', 'declare function f(a: number[] | string[]): any;\nexport {};\n'],
  ['def f(a: T): A[] | B[]\ndef f(a)\n  a', 'declare function f(a: T): A[] | B[];\nexport {};\n'],
  ['f = (...xs: number[] | string[]) -> xs', 'declare function f(...xs: number[] | string[]): any;\nexport {};\n'],
  ['interface Point\n  x: number\n  y: number\nz = 1', 'interface Point {\n  x: number;\n  y: number;\n}\nexport {};\n'],
  ['interface Named extends Point\n  name: string\nz = 1', 'interface Named extends Point {\n  name: string;\n}\nexport {};\n'],
  ['export interface P\n  x: number\nz = 1', 'export interface P {\n  x: number;\n}\n'],
  ['interface P\n  m(x: number): void\nz = 1', 'interface P {\n  m(x: number): void;\n}\nexport {};\n'],
  ['interface P\n  x: Map<K,\n  V>\ny = 2', 'interface P {\n  x: Map<K, V>;\n}\nexport {};\n'],
  // classes: typed fields (instance, static, bodiless), typed methods,
  // void methods, typed constructors; untyped members stay out
  ['class Widget\n  width: number\n  height: string', 'declare class Widget {\n  width: number;\n  height: string;\n}\nexport {};\n'],
  ['class A\n  x: number = 5', 'declare class A {\n  x: number;\n}\nexport {};\n'],
  ['class A\n  @x: number = 2', 'declare class A {\n  static x: number;\n}\nexport {};\n'],
  ['class A\n  @x: number', 'declare class A {\n  static x: number;\n}\nexport {};\n'],
  ['class A\n  m: (x: number): string -> "s"', 'declare class A {\n  m(x: number): string;\n}\nexport {};\n'],
  ['class A\n  save!: (x: number) ->\n    x', 'declare class A {\n  save(x: number): void;\n}\nexport {};\n'],
  ['class A\n  constructor: (a: number) ->\n    @a = a', 'declare class A {\n  constructor(a: number);\n}\nexport {};\n'],
  ['class A extends B\n  x: number = 5', 'declare class A extends B {\n  x: number;\n}\nexport {};\n'],
  ['export class W\n  w: number = 1', 'export declare class W {\n  w: number;\n}\n'],
  ['class A\n  x: number = 5\n  m: -> @x', 'declare class A {\n  x: number;\n}\nexport {};\n'],
  // module-scope typed bindings inside control flow or function bodies
  // do NOT declare (a d.ts is a module boundary)
  ['f = ->\n  r: number = g()\n  r', ''],
  ['if c\n  x: number = 5\n  x', ''],
  // casts are expression-level and never declare
  ['y = x as MyType', ''],
  // untyped everything: the trivial declaration
  ['x = 5\ny = -> 1\nclass Plain\n  m: -> 1', ''],
  ['', ''],
];


describe('declarations: the typed surface, row by row', () => {
  for (const [src, expected] of ROWS) {
    test(JSON.stringify(src), () => {
      expect(dts(src)).toBe(expected);
    });
  }
});

describe('the compile() surface', () => {
  test('declarations is lazy and memoized; reading it changes nothing else', () => {
    const r = compile('x: number = 5');
    const codeBefore = r.code;
    expect(r.declarations).toBe('declare let x: number;\nexport {};\n');
    expect(r.declarations).toBe(r.declarations);
    expect(r.code).toBe(codeBefore);
  });

  test('zero-cost: an untyped file yields the trivial declaration', () => {
    expect(compile('f = (a) -> a + 1\nf(2)').declarations).toBe('');
  });

  test('declaration-emission rejections surface as CompileError on access, not at compile()', () => {
    const r = compile('class A extends (mix B)\n  x: number = 5', { path: 'm.rip' });
    expect(r.code).toContain('class A extends');
    expect(() => r.declarations).toThrow(CompileError);
    expect(() => r.declarations).toThrow(/extends an expression/);
  });

  test('the expansion parameter has no declaration form — loud', () => {
    const r = compile('f = (a: number, ..., last) -> last');
    expect(() => r.declarations).toThrow(/expansion parameter/);
  });

  test('a non-array rest annotation has no declaration form — loud with the accepted shapes named', () => {
    for (const src of ['f = (...xs: number) -> xs', 'def g(...xs: string)\n  xs']) {
      const r = compile(src);
      expect(() => r.declarations).toThrow(/rest parameter's annotation types the whole rest array/);
    }
  });

  test('a rest UNION is array-shaped only when EVERY arm is', () => {
    const bad = compile('f = (...xs: Array<number> | null) -> xs');
    expect(() => bad.declarations).toThrow(/needs an array type/);
    expect(compile('f = (...xs: number[] | string[]) -> xs').declarations)
      .toBe('declare function f(...xs: number[] | string[]): any;\nexport {};\n');
  });

  test('a block alias body mixing member and non-member lines rejects — never a space-join', () => {
    const r = compile('type Mixed =\n  kind: string\n  Wat\nz = 1');
    expect(() => r.declarations).toThrow(/unrecognized member 'Wat'/);
  });

  test('the offender diagnostic names the actual line — a variant mixed into an object body included', () => {
    const r = compile('type Bad =\n  kind: string\n  | Ok\nz = 1');
    expect(() => r.declarations).toThrow(/unrecognized member '\| Ok'/);
  });

  test('SINGLE is for types, never failed members: a lone member-shaped line that fails the grammar rejects', () => {
    const r = compile('type T =\n  ...k: number\nz = 1');
    expect(() => r.declarations).toThrow(/unrecognized member '\.\.\.k: number'/);
    // A lone wrapped TYPE keeps the escape: conditional-type colons
    // pair with their '?' and are no member colon.
    expect(compile('type C2 =\n  T extends U ? A : B\nz = 1').declarations)
      .toBe('type C2 = T extends U ? A : B;\nexport {};\n');
  });
});

describe('corpus declarations, pinned whole', () => {
  const corpus = (name) => readFileSync(join(import.meta.dir, '../corpus', name), 'utf8');

  test('types.rip', () => {
    expect(compile(corpus('types.rip')).declarations).toBe(
      'type Opts = {a: number, b: number};\n' +
      'declare let limit: number;\n' +
      'declare let appName: string;\n' +
      'declare let ratio: number;\n' +
      'declare let flags: {a: number, b?: string};\n' +
      'declare let pick: (n: number) => number;\n' +
      'declare function clamp(v: number, lo?: number, hi?: number): number;\n' +
      'declare function scale(factor: number, ...rest: number[]): any;\n' +
      'declare function pair({a, b}?: Opts): any;\n' +
      'declare function double(x: number): number;\n' +
      'declare let total: number;\n' +
      'declare let list: number[];\n' +
      'declare let sum: number;\n' +
      'export {};\n'
    );
  });

  test('typedecls.rip', () => {
    expect(compile(corpus('typedecls.rip')).declarations).toBe(
      'type ID = string;\n' +
      'type Pair<A, B> = [A, B];\n' +
      'type Handler = (e: Event) => void;\n' +
      'type Ok = {value: number};\n' +
      'type Err = {error: string};\n' +
      'type Result = Ok | Err;\n' +
      'type Shape = {\n  kind: string;\n  size: number;\n};\n' +
      'interface Point {\n  x: number;\n  y: number;\n}\n' +
      'interface Named extends Point {\n  name: string;\n}\n' +
      'declare class Widget {\n  width: number;\n  height: string;\n}\n' +
      'declare function area(w: number, h: number): number;\n' +
      'export {};\n'
    );
  });
});

describe('mapping: the source spans declarations consume round-trip (declaration text itself needs no mapping)', () => {
  test('the annotation span behind `declare let x: number` resolves through bestAtSource as a cover row', () => {
    const src = 'x: number = 5';
    const r = compile(src);
    expect(r.declarations).toBe('declare let x: number;\nexport {};\n');
    // Offset 4 sits inside `: number` — the exact span the declaration
    // text passed through.
    const row = r.mappings.bestAtSource(4);
    expect(row).not.toBeNull();
    expect(row.role).toBe('annotation');
    expect(row.mappingKind).toBe('cover');
    expect(r.code.slice(row.generatedStart, row.generatedEnd)).toBe('x = 5');
    // The declaration is a generated artifact: no mapping row points
    // INTO it, and none needs to — the consumed span above is the
    // round-trip that matters.
  });

  test('an overload signature erases to a zero-width cover and still declares', () => {
    const src = 'def f(a: number): string\ndef f(a)\n  a';
    const r = compile(src);
    expect(r.declarations).toBe('declare function f(a: number): string;\nexport {};\n');
    const row = r.mappings.bestAtSource(4); // inside the signature line
    expect(row).not.toBeNull();
    expect(row.mappingKind).toBe('cover');
    expect(row.generatedStart).toBe(row.generatedEnd); // emits NOTHING
  });
});

describe('coherence: declarations never change the compile', () => {
  test('typed/stripped twins still emit identical JS when declarations are read', () => {
    const typed = compile('x: number = 5');
    const plain = compile('x = 5');
    expect(typed.declarations).not.toBe('');
    expect(plain.declarations).toBe('');
    expect(typed.code).toBe(plain.code);
  });
});

describe('component declarations: the class shape, the props surface, the extends story', () => {
  test('a component binding declares its companion interface + the constructor type', () => {
    const d = compile([
      'Counter = component',
      '  count := 0',
      '  @title: string',
      '  @max?: number',
      '  total: number ~= count * 2',
      '  limit: number =! 100',
      '  accept theme',
      '  bump = (n: number): number -> count += n',
      '  mounted = -> 1',
      '',
    ].join('\n')).declarations;
    expect(d).toContain('interface Counter {');
    expect(d).toContain('  count: { value: number; read(): number };');
    expect(d).toContain('  title: { value: string; read(): string };');
    expect(d).toContain('  max: { value: number | undefined; read(): number | undefined };');
    expect(d).toContain('  total: { readonly value: number; read(): number };');
    expect(d).toContain('  readonly limit: number;');   // =! members surface readonly
    expect(d).toContain('  theme: any;');
    expect(d).toContain('  bump(n: number): number;');
    expect(d).toContain('  mounted(): any;');
    expect(d).toContain('  mount(target?: any): Counter;');
    expect(d).toContain('  unmount(options?: { removeDOM?: boolean }): void;');
    expect(d).toContain('  emit(name: string, detail?: any): void;');
    expect(d).toContain('declare let Counter: {');
    // The required prop's union arm and the bind slot.
    expect(d).toContain('& ({ title: string | { value: string; read(): string } } | { __bind_title__: { value: string; read(): string } })');
    expect(d).toContain('__bind_max__?: { value: number; read(): number }');
    // A REQUIRED prop suppresses the static mount mirror (the
    // runtime's static mount constructs with NO props — offering it
    // would be tsc-clean with a required container holding
    // undefined); the INSTANCE mount stays.
    expect(d).toContain('  mount(target?: any): Counter;\n  unmount');
    expect(d).not.toContain('  mount(target?: any): Counter;\n};');
    // The module-marker interplay: no emitted line self-scopes, so the
    // non-exported artifact carries the marker.
    expect(d.endsWith('export {};\n')).toBe(true);
  });

  test('an exported component exports interface and binding — self-scoped, no marker', () => {
    const d = compile('export Chip = component\n  @label := "c"\n').declarations;
    expect(d).toContain('export interface Chip {');
    expect(d).toContain('export declare let Chip: {');
    expect(d).toContain('new (props?: {');
    // All-optional props: the static mount mirror IS offered.
    expect(d).toContain('  mount(target?: any): Chip;\n};');
    expect(d.endsWith('export {};\n')).toBe(false);
  });

  test('the container brand: props and members carry the runtime detection shape, and a plain literal cannot satisfy it', () => {
    // The type story spells `read(): T` — the runtime's own container
    // predicate (`typeof x.read === 'function'`) — so anything the
    // type accepts is exactly what the runtime treats as a container
    // (a plain `{ value: 5 }` would DOUBLE-WRAP). The tsc rejection
    // cells live in dts-tsc/tsface-tsc.
    const d = compile('Chip = component\n  @size: number := 1\n').declarations;
    expect(d).toContain('size: { value: number; read(): number };');
    expect(d).toContain('size?: number | { value: number; read(): number }');
    expect(d).toContain('__bind_size__?: { value: number; read(): number }');
  });

  test('extends: the attribute surface for the extended tag, the index signature, the rest view', () => {
    const d = compile('Btn = component extends button\n  @label := "go"\n  render\n    button\n      = @label\n').declarations;
    expect(d).toContain('rest: { value: Record<string, any>; read(): Record<string, any> };');
    expect(d).toContain(`disabled?: HTMLElementTagNameMap["button"] extends Record<'disabled', infer T> ? T : any`); // per-tag, DOM-typed
    expect(d).toContain(`formaction?: HTMLElementTagNameMap["button"] extends Record<'formAction', infer T> ? T : any`); // camelCased DOM twin
    expect(d).toContain(`id?: HTMLElementTagNameMap["button"] extends Record<'id', infer T> ? T : any`); // global attr, DOM-typed
    expect(d).toContain('[key: string]: any');   // rest admits any key
  });

  test('a component with no annotations still declares — the props surface is structural (prop-name completions)', () => {
    const d = compile('Tag = component\n  @kind\n').declarations;
    expect(d).toContain('interface Tag {');
    expect(d).toContain('kind?: any');
    // An async method spells its Promise; a void method spells void.
    const d2 = compile('W = component\n  go = -> await 1\n  save! = -> 1\n').declarations;
    expect(d2).toContain('go(): Promise<any>;');
    expect(d2).toContain('save(): void;');
  });

  test('a declared @children prop owns the key in the .d.ts too', () => {
    const d = compile('export Child = component\n  @children: string\n  render\n    div "x"\n').declarations;
    expect(d).toContain('children: { value: string; read(): string };');
    expect(d).not.toContain('children?: any');
    // Exactly three manifestations: the interface member, the ctor's
    // optional entry, the required arm's plain slot (`__bind_children__`
    // keys don't match the shape) — no fallback duplicate anywhere.
    expect((d.match(/children\??:/g) || []).length).toBe(3);
  });

  test('extends an SVG tag carries the SVG attribute surface', () => {
    const d = compile('Chart = component extends svg\n  n := 1\n  render\n    svg viewBox: "0 0 10 10"\n      = n\n').declarations;
    expect(d).toContain('viewBox?: any');
    expect(d).toContain("'stroke-width'?: any");
  });

  test('non-binding components declare nothing (a d.ts is a module boundary)', () => {
    expect(compile('f = ->\n  C = component\n    n := 1\n  C\n').declarations).toBe('');
  });
});

describe('nested array types render in declarations', () => {
  test('T[][] reaches the .d.ts in declaration, alias, interface, and signature positions', () => {
    const src = 'type Grid = string[][]\ninterface I\n  rows: number[][]\ndef f(m: string[][]): number[][]\n  m\ng: Grid = []\nw: number[][]\nw = []';
    const d = compile(src).declarations;
    expect(d).toContain('type Grid = string[][];');
    expect(d).toContain('rows: number[][];');
    expect(d).toContain('declare function f(m: string[][]): number[][];');
    expect(d).toContain('declare let g: Grid;');
    expect(d).toContain('declare let w: number[][];');
  });
});
