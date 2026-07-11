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
import { pathToFileURL } from 'url';
import { compile, CompileError } from '../../src/compile.js';

const dts = (src) => compile(src).declarations;

// ── The declaration surface, row by row ──────────────────────────────
const ROWS = [
  // typed declarations → declare let (the §6- delivery shapes)
  ['x: number = 5', 'declare let x: number;\nexport {};\n'],
  ['export x: number = 5', 'export declare let x: number;\n'],
  ['flags: {a: number, b?: string} = {a: 1}', 'declare let flags: {a: number, b?: string};\nexport {};\n'],
  ['pick: (n: number) => number = (n: number) -> n + 1', 'declare let pick: (n: number) => number;\nexport {};\n'],
  ['y: "lit" = v', 'declare let y: "lit";\nexport {};\n'],
  // bare typed forward declarations (the old lowering emits nothing — #68c)
  ['r: number\nr = 5', 'declare let r: number;\nexport {};\n'],
  // a sibling RUN of bare forwards declares every member
  ['a: number\nb: string\na = 1\nb = "s"', 'declare let a: number;\ndeclare let b: string;\nexport {};\n'],
  // typed defs → declare function; defaulted params turn optional
  ['def clamp(v: number, lo: number = 0, hi: number = limit): number\n  v', 'declare function clamp(v: number, lo?: number, hi?: number): number;\nexport {};\n'],
  ['export def area(w: number, h: number): number\n  w * h', 'export declare function area(w: number, h: number): number;\n'],
  ['def g: number\n  5', 'declare function g(): number;\nexport {};\n'],
  // missing annotations render EXPLICIT any (#67 — implicit any is a
  // tsc error in declaration files)
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

