export type ForceArray = Set<string> | string[] | ((name: string) => boolean);

export interface ParseOptions {
  /** Strip namespace prefixes from tag and attribute names ('ns1:Foo' → 'Foo'). Default true. */
  stripNamespaces?: boolean;
  /** CDATA text is verbatim. Default true. */
  preserveCDATA?: boolean;
  /** Collapse whitespace in non-CDATA text. Default true. */
  trimText?: boolean;
  /** Never auto-coerce numbers from text. Default false. */
  coerceNumbers?: boolean;
  /** Never auto-coerce booleans from text. Default false. */
  coerceBooleans?: boolean;
  /** Grouped attributes key on each node. Default '@attrs'. */
  attrsKey?: string;
  /** Mixed-content text key. Default '#text'. */
  textKey?: string;
  /** Tag names that always collapse to arrays. Default null. */
  forceArray?: ForceArray | null;
  /** Emit '@children' in document order. Default false. */
  preserveChildren?: boolean;
  /** Allow (and skip) <!DOCTYPE ...> declarations. Default false. */
  allowDoctype?: boolean;
  /** Tolerate <?...?> processing instructions by skipping. Default true. */
  allowProcessingInstructions?: boolean;
  /** Hard input-size cap in UTF-16 code units. Default 5 * 1024 * 1024. */
  maxBytes?: number;
}

export interface StringifyOptions {
  /** Indent string, or a number of spaces. Default '' (single line). */
  indent?: string | number;
  /** Line separator. Defaults to '\n' when indent is set, '' otherwise. */
  newline?: string;
  /** Attributes key read from node objects. Default '@attrs'. */
  attrsKey?: string;
  /** Text key read from node objects. Default '#text'. */
  textKey?: string;
  /** Tag names whose text content is CDATA-wrapped. Default undefined. */
  cdata?: Set<string> | string[] | null;
}

/** An element value in the parsed tree: collapsed text, a node object, or a repeated-tag array. */
export type RsxValue = string | RsxNode | RsxValue[];

export interface RsxNode {
  [key: string]: RsxValue | Record<string, string> | undefined;
}

export class RsxError extends Error {
  name: string;
  /** UTF-16 offset into the source where scanning failed, when known. */
  offset?: number;
  constructor(msg: string, offset?: number);
}

/** Parse an XML string into a plain object tree. */
export function parse(xml: string, opts?: ParseOptions): RsxNode;

/** Serialize a value as XML under the given root tag name. */
export function stringify(rootName: string, value: unknown, opts?: StringifyOptions): string;
