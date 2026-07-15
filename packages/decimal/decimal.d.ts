export type RoundingMode =
  | 'UP'
  | 'DOWN'
  | 'CEILING'
  | 'FLOOR'
  | 'HALF_UP'
  | 'HALF_DOWN'
  | 'HALF_EVEN'
  | 'UNNECESSARY';

export type DecimalLike = Decimal | string | bigint | number;

export declare class DecimalError extends Error {
  constructor(message: string);
}
export declare class DecimalParseError extends DecimalError {}
export declare class DecimalDivisionByZeroError extends DecimalError {}
export declare class DecimalNonTerminatingError extends DecimalError {}
export declare class DecimalInvalidOperationError extends DecimalError {}
export declare class DecimalRangeError extends DecimalError {}
export declare class DecimalResourceLimitError extends DecimalError {}
export declare class DecimalInexactError extends DecimalError {}
export declare class DecimalUnsafeConversionError extends DecimalError {}

export declare class Decimal {
  coef: bigint;
  exp: number;

  constructor(coef: bigint, exp: number);

  static isDecimal(v: unknown): boolean;
  static config(opts: {
    maxInputLength?: number;
    maxDigits?: number;
    maxAbsExponent?: number;
    maxOutputLength?: number;
  }): void;
  static parse(input: string): Decimal;
  static from(v: DecimalLike): Decimal;
  static fromParts(coef: bigint, exp: number): Decimal;
  static fromScaledInteger(units: bigint | number, scale: number): Decimal;

  signum(): number;
  isZero(): boolean;
  neg(): Decimal;
  abs(): Decimal;

  add(other: DecimalLike): Decimal;
  sub(other: DecimalLike): Decimal;
  mul(other: DecimalLike): Decimal;
  divToScale(other: DecimalLike, scale: number, mode: RoundingMode): Decimal;
  divExact(other: DecimalLike): Decimal;
  quantizeToScale(scale: number, mode: RoundingMode): Decimal;

  cmp(other: DecimalLike): number;
  eq(other: DecimalLike): boolean;
  lt(other: DecimalLike): boolean;
  lte(other: DecimalLike): boolean;
  gt(other: DecimalLike): boolean;
  gte(other: DecimalLike): boolean;

  fitsDecimal(precision: number, scale: number): boolean;

  toString(): string;
  toCanonicalString(): string;
  canonicalKey(): string;
  toJSON(): string;
  toFixed(scale: number, mode: RoundingMode): string;
  toNumber(): number;
  toScaledInteger(scale: number, mode: RoundingMode): bigint;
  toCentsNumber(mode: RoundingMode): number;
  valueOf(): never;
}

export declare function D(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Decimal;
