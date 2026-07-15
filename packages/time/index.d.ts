// Public surface of @rip-lang/time. The implementation is time.rip; this
// file is the TypeScript face consumers see through the package exports.

/** A unit is either a registered symbol (`Symbol.for('year')`, Rip `:year`)
 * or a string alias (`'year'`, `'years'`, `'y'`). */
export type UnitInput = string | symbol;

export type TimeInput = string | number | Date | Time | null | undefined;

export interface TimeOptions {
  utc?: boolean;
  format?: string;
}

export interface TimeConfig {
  utc?: boolean;
  zone?: string | null;
  fromInstance?: Date;
  input?: TimeInput;
  format?: string;
}

/** Per-bucket calendar() overrides — a literal format string or a function
 * that receives the current instant and returns the formatted string. */
export type CalendarFormats = Record<
  string,
  string | ((this: Time, now: Time) => string)
>;

export interface DurationComponents {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

export type DurationInput =
  | number
  | string
  | DurationComponents
  | Duration
  | undefined;

export function isTime(x: unknown): boolean;

export function isDuration(x: unknown): boolean;

/** Completed years from `dob` to `asOf` (default: now), birthday-aware.
 * Returns null for a blank or invalid input. */
export function age(dob: TimeInput, asOf?: TimeInput): number | null;

/** The callable factory — parse/construct an immutable Time. */
export function time(input?: TimeInput, opts?: TimeOptions): Time;

export class Time {
  constructor(cfg?: TimeConfig);

  /** UTC mode flag. */
  $u: boolean;
  /** IANA zone name, or null for local/UTC. */
  $z: string | null;
  /** The backing native Date. */
  $d: Date;
  /** Explicit parse format, when constructed via time.parse(). */
  $fmt: string | undefined;
  $y: number;
  $M: number;
  $D: number;
  $W: number;
  $H: number;
  $m: number;
  $s: number;
  $ms: number;

  isValid(): boolean;
  clone(): Time;

  year(): number;
  month(): number;
  date(): number;
  day(): number;
  hour(): number;
  minute(): number;
  second(): number;
  millisecond(): number;
  quarter(): number;

  daysInMonth(): number;
  isLeapYear(): boolean;
  dayOfYear(): number;
  weekOfYear(startDow?: number): number;

  get(u: UnitInput): number | undefined;
  set(u: UnitInput, v: number): Time;

  add(amount: number | Duration, u?: UnitInput): Time;
  subtract(n: number | Duration, u?: UnitInput): Time;

  startOf(u: UnitInput, isStartOf?: boolean): Time;
  endOf(u: UnitInput): Time;

  isSame(that: TimeInput, u?: UnitInput): boolean;
  isBefore(that: TimeInput, u?: UnitInput): boolean;
  isAfter(that: TimeInput, u?: UnitInput): boolean;
  isSameOrBefore(that: TimeInput, u?: UnitInput): boolean;
  isSameOrAfter(that: TimeInput, u?: UnitInput): boolean;
  isToday(): boolean;
  isYesterday(): boolean;
  isTomorrow(): boolean;

  /** Day of week relative to Sunday (US week start). With an argument,
   * returns a new instance moved to that day within the current week. */
  weekday(): number;
  weekday(input: number): Time;

  calendar(reference?: TimeInput, formats?: CalendarFormats): string;

  /** inclusivity: '()' exclusive, '[]' inclusive, '[)' / '(]' mixed */
  isBetween(from: TimeInput, to: TimeInput, u?: UnitInput, inc?: string): boolean;

  diff(input: TimeInput, u?: UnitInput, float?: boolean): number;

  utc(keepLocalTime?: boolean): Time;
  local(): Time;
  isUTC(): boolean;

  /** Convert this instant into `zone` for display. With keepLocalTime, the
   * wall-clock numbers are preserved and the instant shifts. */
  tz(zone: string, keepLocalTime?: boolean): Time;
  /** CONVERT: same instant, shown in `zone` (the wall-clock changes). */
  toZone(zone: string): Time;
  /** REINTERPRET: same wall-clock numbers, now in `zone` (the instant changes). */
  asZone(zone: string): Time;
  /** Reinterpret this instance's wall-clock as UTC (the instant shifts). */
  asUTC(): Time;
  /** The IANA zone name this instance is anchored to, or null for local/UTC. */
  timezone(): string | null;
  utcOffset(): number;

  valueOf(): number;
  unix(): number;
  toDate(): Date;
  toJSON(): string | null;
  toISOString(): string;
  toString(): string;

  fromNow(withoutSuffix?: boolean): string;
  toNow(withoutSuffix?: boolean): string;
  from(input: TimeInput, withoutSuffix?: boolean): string;
  to(input: TimeInput, withoutSuffix?: boolean): string;

  format(fmtStr?: string): string;
}

export class Duration {
  constructor(input?: DurationInput, unit?: UnitInput);

  /** Total signed magnitude in milliseconds. */
  $ms: number;
  /** Normalized component map (years…milliseconds). */
  $d: Record<string, number | undefined>;

  clone(): Duration;

  /** Component getter — `.get(:hour)` is the hour component after
   * normalization; use `.as(:hour)` for the total in hours. */
  get(unit: UnitInput): number;
  as(unit: UnitInput): number;

  add(input: DurationInput, unit?: UnitInput): Duration;
  subtract(input: DurationInput, unit?: UnitInput): Duration;
  negated(): Duration;
  abs(): Duration;

  valueOf(): number;

  milliseconds(): number;
  seconds(): number;
  minutes(): number;
  hours(): number;
  days(): number;
  weeks(): number;
  months(): number;
  years(): number;

  asMilliseconds(): number;
  asSeconds(): number;
  asMinutes(): number;
  asHours(): number;
  asDays(): number;
  asWeeks(): number;
  asMonths(): number;
  asYears(): number;

  toISOString(): string;
  toJSON(): string;
  format(fmtStr?: string): string;
  humanize(withSuffix?: boolean): string;
}

export type TzFn = ((input: TimeInput, zone: string) => Time) & {
  guess(): string;
  aliases: Record<string, string>;
};

export interface TimeFactoryMembers {
  utc(input?: TimeInput): Time;
  parse(input: string, fmt: string, utc?: boolean): Time;
  tz: TzFn;
  unix(secs: number): Time;
  isTime(x: unknown): boolean;
  isDuration(x: unknown): boolean;
  duration(input?: DurationInput, unit?: UnitInput): Duration;
  Duration: typeof Duration;
  Time: typeof Time;
  min(...args: Array<Time | Time[]>): Time;
  max(...args: Array<Time | Time[]>): Time;
  version: string;
}

export type TimeFactory = typeof time & TimeFactoryMembers;

declare const timeFactory: TimeFactory;
export default timeFactory;
