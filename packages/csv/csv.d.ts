export interface ReadOptions {
  /** Field delimiter; auto-detected from `,` `\t` `|` `;` when omitted. */
  sep?: string;
  /** Quote character (default `"`). */
  quote?: string;
  /** Escape character: the quote itself for doubling, or `\` (auto-detected). */
  escape?: string;
  /** Line ending override: `\n`, `\r\n`, or `\r` (auto-detected). */
  row?: string;
  /** Handle Excel `="01"` literals. */
  excel?: boolean;
  /** Recover from stray/malformed quotes instead of throwing. */
  relax?: boolean;
  /** Trim whitespace from every field. */
  strip?: boolean;
  /** First row becomes object keys; rows come back as objects. */
  headers?: boolean;
  /** Skip lines starting with this character. */
  comments?: string | null;
  /** Skip blank lines (default true). */
  skipBlanks?: boolean;
  /** Per-row callback; return `false` to halt. */
  each?: (row: string[] | Record<string, string>, index: number) => unknown;
}

export interface WriteOptions {
  /** Field delimiter (default `,`). */
  sep?: string;
  /** Quote character (default `"`). */
  quote?: string;
  /** Escape character (default: the quote, for doubling). */
  escape?: string;
  /** `compact` quotes only when necessary; `full` quotes every field. */
  mode?: 'compact' | 'full';
  /** Protect leading zeros with `="0123"`. */
  zeros?: boolean;
  /** Drop trailing empty columns. */
  drop?: boolean;
  /** Row separator (default `\n`). */
  rowsep?: string;
}

export interface Writer {
  /** Format a single row as a CSV line (no trailing row separator). */
  row(data: readonly unknown[]): string;
  /** Format multiple rows as a complete CSV string. */
  rows(data: readonly (readonly unknown[])[] | null | undefined): string;
}

export const CSV: {
  read(str: string | null | undefined, opts: ReadOptions & { each: NonNullable<ReadOptions['each']> }): number;
  read(str: string | null | undefined, opts: ReadOptions & { headers: true }): Array<Record<string, string>>;
  read(str: string | null | undefined, opts?: ReadOptions): string[][];
  write(rows: readonly (readonly unknown[])[] | null | undefined, opts?: WriteOptions): string;
  load(path: string, opts: ReadOptions & { each: NonNullable<ReadOptions['each']> }): Promise<number>;
  load(path: string, opts: ReadOptions & { headers: true }): Promise<Array<Record<string, string>>>;
  load(path: string, opts?: ReadOptions): Promise<string[][]>;
  save(path: string, rows: readonly (readonly unknown[])[] | null | undefined, opts?: WriteOptions): Promise<number>;
  writer(opts?: WriteOptions): Writer;
  formatRow(row: readonly unknown[], opts?: WriteOptions): string;
};
