// @rip-lang/x12 — public type surface.

/** Official fixed element widths for ISA elements 1-16. */
export const ISA_WIDTHS: number[];

/** The selector grammar: `seg(num)-fld(rep).com`, where each `(...)`
 *  slot is an occurrence number or one of `+` (new), `?` (count),
 *  `*` (all). `-` and `.` are interchangeable position separators. */
export const SELECTOR: RegExp;

/** One parsed segment: element 0 is the segment id, 1..n the fields. */
export type Segment = string[];

/** A path selector such as `"ISA-6"`, `"EB(3)-4(2).1"`, or `"NM1(?)"`. */
export type Selector = string;

/** Values accepted by set/update: scalars stringify; arrays join on the
 *  field, repetition, or component separator the selector targets. */
export type Value = string | number | Array<string | number>;

/** A get/find result: the addressed text, a count for `(?)` selectors,
 *  or one entry per occurrence for `(*)` selectors. */
export type Result = string | number | Array<string | number>;

export class X12 {
  /** Field separator (ISA position 4, default `*`). */
  fld: string;
  /** Repetition separator (ISA-11, default `^`; `U` maps to `^`). */
  rep: string;
  /** Component separator (ISA-16, default `:`). */
  com: string;
  /** Segment terminator (ISA position 106, default `~`). */
  seg: string;

  /** Parse a raw X12 string or clone another instance; an array of
   *  selector/value pairs or an object of selector entries edits the
   *  default fixed-width ISA template. No argument seeds the template. */
  constructor(obj?: string | X12 | Value[] | Record<Selector, Value | null | undefined>);

  /** Read a file and parse it; throws `unreadable file: <path>`. */
  static load(file: string): X12;

  /** The message as segment/field arrays (cached until the next set). */
  toArray(): Segment[];
  /** The message with one segment per line (cached until the next set). */
  toString(): string;
  /** Single-line uppercased wire format. */
  raw(): string;

  /** Pad/truncate a split ISA row to the official element widths. */
  isaWidths(row: Segment): Segment;

  /** Get one addressed value (selector with no value). */
  get(pos: Selector): Result;
  /** Set one addressed value; `(+)` appends a new occurrence. */
  set(pos: Selector, val?: Value | null): void;
  /** get/set/update dispatch: 0 args returns the string, 1 gets,
   *  2 sets, 3+ applies selector/value pairs. */
  data(...args: Array<Selector | Value | null | undefined>): unknown;
  /** Apply selector/value pairs (array) or entries (object); nullish
   *  values are skipped. Returns this. */
  update(etc: Array<Selector | Value | null | undefined> | Record<Selector, Value | null | undefined>): this;

  /** Iterate segments, optionally filtered by name or RegExp. */
  each(fn: (row: Segment) => void): this;
  each(seg: string | RegExp, fn: (row: Segment) => void): this;
  /** Segments whose id matches the name (case-insensitive) or RegExp. */
  grep(seg: string | RegExp): Segment[];

  /** Query several selectors at once: one selector returns its value,
   *  several return an array (nullish selectors yield null slots). */
  find(...ask: Array<Selector | null | undefined>): Result | Array<Result | null> | undefined;

  /** Render a field-per-line listing; `'list'` returns the lines,
   *  otherwise they print. Other flags: `full`, `deep`, `down`,
   *  `hide`, `only`, `ansi`. */
  show(...opts: string[]): string[] | void;

  /** Uppercase a value (arrays uppercase in place). */
  normalize(obj: unknown): unknown;
}
