// The Rip REPL — built ENTIRELY on compiler-owned facts, never on
// heuristics over source or generated text:
//   - continuation is classifyCompleteness (lexer+parser verdicts),
//   - cross-line reactive correctness is the ambientBindings seed fed
//     from each line's result.bindings inventory,
//   - result capture and static-import lowering are the compiler's
//     repl:true emission (result.replResultName, result.imports),
//   - live highlighting re-tokenizes through the real lexer.
// Each line evaluates inside an AsyncFunction with a 'use strict'
// prologue (bodies are sloppy-mode otherwise); persisted bindings
// restore from a context object, user code runs in a nested block so
// redeclaration legally shadows, and a save epilogue writes bindings
// back. Every scaffold name is MINTED against the binding inventory
// and the entry's own identifiers — a user may legally bind any name.
//
// Started by `bin/rip` as `bun --preload=<loader> src/repl.js`, so
// .rip imports compile transitively through the loader.

import * as readline from 'node:readline';
import { inspect } from 'node:util';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { compile, CompileError, classifyCompleteness } from './compile.js';
import { tokenize, makeParserLexer, identifierRuns, isIdentifierName } from './lexer.js';
import { Parser } from './parser.js';
import { _runtimeTable } from './emitter.js';
import { readProjectConfig } from './config.js';
import packageJson from '../package.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Themes — ONE theme object owns every color decision; no ANSI
// literal appears outside this section. `mono` is the empty theme:
// every class paints as plain text (NO_COLOR / non-TTY force it).

const ANSI_NAMES = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35,
  cyan: 36, white: 37, gray: 90, grey: 90,
  brightred: 91, brightgreen: 92, brightyellow: 93, brightblue: 94,
  brightmagenta: 95, brightcyan: 96, brightwhite: 97,
  bold: 1, dim: 2,
};

// A color spec — an ANSI name above or a #rrggbb hex — as an SGR
// escape. Hex downconverts by $COLORTERM: truecolor terminals get the
// exact 24-bit color, everything else the nearest 256-color cube
// entry. An unknown spec paints as plain (never a crash mid-repaint).
export function ansiFor(spec, colorterm = process.env.COLORTERM ?? '') {
  if (typeof spec !== 'string') return '';
  const named = ANSI_NAMES[spec.toLowerCase().replace(/[^a-z]/g, '')];
  if (named !== undefined) return `\x1b[${named}m`;
  const hex = /^#?([0-9a-f]{6})$/i.exec(spec);
  if (hex === null) return '';
  const n = parseInt(hex[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (/truecolor|24bit/i.test(colorterm)) return `\x1b[38;2;${r};${g};${b}m`;
  const cube = (v) => Math.round((v / 255) * 5);
  return `\x1b[38;5;${16 + 36 * cube(r) + 6 * cube(g) + cube(b)}m`;
}

// The token-kind → color vocabulary aligns with the repository's
// other highlighting surfaces (packages/highlight/hljs-rip.js): the
// same classes, differently rendered.
const THEME_CLASSES = [
  'keyword', 'literal', 'builtin', 'string', 'regexp', 'number',
  'comment', 'className', 'property', 'variable', 'operator',
  'prompt', 'continuation', 'arrow', 'error', 'info', 'dim',
];

const THEME_TABLE = {
  dark: {
    keyword: 'magenta', literal: 'yellow', builtin: 'cyan',
    string: 'green', regexp: 'red', number: 'yellow',
    comment: 'gray', className: 'brightyellow', property: 'brightcyan',
    variable: 'brightmagenta', operator: 'brightwhite',
    prompt: 'cyan', continuation: 'dim', arrow: 'green',
    error: 'red', info: 'yellow', dim: 'dim',
  },
  light: {
    keyword: 'blue', literal: 'red', builtin: 'magenta',
    string: 'green', regexp: 'red', number: 'red',
    comment: 'gray', className: 'yellow', property: 'cyan',
    variable: 'magenta', operator: 'black',
    prompt: 'blue', continuation: 'dim', arrow: 'green',
    error: 'red', info: 'blue', dim: 'dim',
  },
  mono: {},
};

export const THEME_NAMES = Object.keys(THEME_TABLE);
const RESET = '\x1b[0m';

// Build the resolved theme: per-class SGR escapes plus a paint()
// helper. `overrides` is the config's repl.colors map (class → named
// ANSI or hex).
export function buildTheme(name, overrides = null, colorterm = undefined) {
  const base = THEME_TABLE[name] ?? THEME_TABLE.dark;
  const theme = { name: THEME_TABLE[name] ? name : 'dark', codes: {} };
  for (const cls of THEME_CLASSES) {
    const spec = overrides?.[cls] ?? base[cls];
    theme.codes[cls] = spec === undefined ? '' : ansiFor(spec, colorterm);
  }
  theme.paint = (cls, text) => {
    const code = theme.codes[cls] ?? '';
    return code === '' || text === '' ? text : `${code}${text}${RESET}`;
  };
  return theme;
}

// Theme choice, highest precedence first: NO_COLOR / non-TTY force
// mono; a session `.theme` override; the project config's repl.theme;
// the detected terminal background; dark.
export function resolveThemeName({ override = null, configTheme = null, detected = null, noColor = false, tty = true } = {}) {
  if (noColor || !tty) return 'mono';
  for (const pick of [override, configTheme, detected]) {
    if (pick !== null && THEME_TABLE[pick] !== undefined) return pick;
  }
  return 'dark';
}

// Stateful byte-level matcher for the OSC 11 background reply
// (ESC ] 11 ; <payload> terminated by BEL or ST = ESC \). It buffers
// raw stdin bytes across chunk boundaries, extracts EXACTLY ONE
// complete reply wherever it sits, and keeps every non-reply byte —
// type-ahead mixed into the same chunk, bytes before and after the
// reply — in original order for release back onto the stream. Bytes
// (never decoded strings) are the unit: a multibyte glyph split
// across chunks survives intact.
const OSC11_HEAD = Buffer.from('\x1b]11;', 'latin1');
const ST = Buffer.from('\x1b\\', 'latin1');

export class Osc11Matcher {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.reply = null; // the payload string once a complete reply extracted
  }

  // Feed one stdin chunk; true once a complete reply has been
  // extracted (its bytes leave the buffer; everything else stays).
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')]);
    if (this.reply === null) {
      const start = this.buffer.indexOf(OSC11_HEAD);
      if (start !== -1) {
        const payloadAt = start + OSC11_HEAD.length;
        const bel = this.buffer.indexOf(0x07, payloadAt);
        const st = this.buffer.indexOf(ST, payloadAt);
        const payloadEnd = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
        if (payloadEnd !== -1) {
          const end = payloadEnd + (payloadEnd === bel ? 1 : ST.length);
          this.reply = this.buffer.toString('utf8', payloadAt, payloadEnd);
          this.buffer = Buffer.concat([this.buffer.subarray(0, start), this.buffer.subarray(end)]);
        }
      }
    }
    return this.reply !== null;
  }

  // Is an INCOMPLETE reply still growable? True for a started reply
  // awaiting its terminator, and for a proper prefix of the header at
  // the buffer's end. Bytes that diverged from the header are plain
  // input and never count.
  hasPartial() {
    if (this.reply !== null) return false;
    if (this.buffer.indexOf(OSC11_HEAD) !== -1) return true;
    const max = Math.min(OSC11_HEAD.length - 1, this.buffer.length);
    for (let len = max; len > 0; len--) {
      if (this.buffer.subarray(this.buffer.length - len).equals(OSC11_HEAD.subarray(0, len))) return true;
    }
    return false;
  }

  // Every byte that is not the extracted reply, original order.
  residue() {
    return this.buffer;
  }
}

// Terminal background detection, once at startup (TTY only): OSC 11
// query with a short timeout — parse the `rgb:` reply and compute
// luminance — falling back to $COLORFGBG's background field, then
// dark. The matcher above owns reply recognition; on timeout with a
// PARTIAL reply pending, one grace window (same length) waits for the
// terminator, and a second timeout releases every buffered byte back
// onto stdin verbatim — detection may then miss, but a keystroke is
// never eaten.
export async function detectBackgroundTheme({ timeoutMs = 80 } = {}) {
  const fromColorFgBg = () => {
    const parts = (process.env.COLORFGBG ?? '').split(';');
    const bg = Number(parts[parts.length - 1]);
    if (!Number.isInteger(bg)) return null;
    return bg === 7 || bg >= 9 ? 'light' : 'dark';
  };
  if (!process.stdout.isTTY || !process.stdin.isTTY) return fromColorFgBg() ?? 'dark';
  const payload = await new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const matcher = new Osc11Matcher();
    let graced = false;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      stdin.removeListener('data', onData);
      if (!wasRaw) stdin.setRawMode(false);
      stdin.pause();
      const rest = matcher.residue();
      if (rest.length > 0) stdin.unshift(rest);
      resolve(matcher.reply);
    };
    const onTimeout = () => {
      if (matcher.hasPartial() && !graced) {
        graced = true;
        timer = setTimeout(finish, timeoutMs);
        return;
      }
      finish();
    };
    timer = setTimeout(onTimeout, timeoutMs);
    const onData = (chunk) => {
      if (matcher.feed(chunk)) finish();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    process.stdout.write('\x1b]11;?\x07');
  });
  const m = payload === null ? null : /rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(payload);
  if (m === null) return fromColorFgBg() ?? 'dark';
  // Components arrive as 1–4 hex digits per channel; normalize to 0–1.
  const chan = (h) => parseInt(h, 16) / (16 ** h.length - 1);
  const [r, g, b] = m.slice(1, 4).map(chan);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Live highlighting — the real lexer repaints the input line. The
// word lists mirror packages/highlight/hljs-rip.js (the vocabulary
// contract across highlighting surfaces).

const KEYWORD_WORDS = new Set([
  'if', 'else', 'unless', 'then', 'switch', 'when', 'for', 'while',
  'until', 'loop', 'do', 'return', 'break', 'continue', 'throw', 'try',
  'catch', 'finally', 'yield', 'await', 'import', 'export', 'from',
  'default', 'delete', 'typeof', 'instanceof', 'new', 'super', 'and',
  'or', 'not', 'is', 'isnt', 'class', 'def', 'enum', 'interface',
  'type', 'extends', 'own', 'schema', 'in', 'of', 'by', 'as',
  'component', 'render', 'slot', 'offer', 'accept', 'use', 'debugger', 'it',
]);
const LITERAL_WORDS = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'undefined',
  'NaN', 'Infinity', 'this',
]);
const BUILTIN_WORDS = new Set([
  'console', 'process', 'require', 'module', 'exports', 'setTimeout',
  'setInterval', 'clearTimeout', 'clearInterval', 'Promise', 'Array',
  'Object', 'String', 'Number', 'Boolean', 'Math', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'JSON', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'Buffer', 'Bun', 'fetch',
  'URL', 'URLSearchParams', 'FormData', 'globalThis',
  'p', 'pp', 'pj', 'pr', 'abort', 'assert', 'exit', 'kind', 'noop',
  'raise', 'rand', 'sleep', 'todo', 'warn', 'zip',
]);
const STRING_KINDS = new Set(['STRING', 'STRING_START', 'STRING_END']);
const REGEX_KINDS = new Set(['REGEX', 'HEREGEX_START', 'HEREGEX_END']);

// One token's theme class (null paints plain).
export function classifyToken(t) {
  if (STRING_KINDS.has(t.kind)) return 'string';
  if (REGEX_KINDS.has(t.kind)) return 'regexp';
  if (t.kind === 'NUMBER') return 'number';
  if (t.kind === 'BOOL' || t.kind === 'NULL' || t.kind === 'UNDEFINED') return 'literal';
  if (t.kind === 'PROPERTY') return 'property';
  if (t.kind === '@') return 'variable';
  if (t.kind === 'IDENTIFIER') {
    if (KEYWORD_WORDS.has(t.value)) return 'keyword';
    if (LITERAL_WORDS.has(t.value)) return 'literal';
    if (BUILTIN_WORDS.has(t.value)) return 'builtin';
    if (/^[A-Z]/.test(t.value)) return 'className';
    return null;
  }
  // Word-spelled token kinds (IF, EXTENDS, POST_IF…) are keywords —
  // the kind is an uppercase word and the source spelling a word.
  if (/^[A-Z_]+$/.test(t.kind) && /^[a-z]+$/.test(String(t.value))) return 'keyword';
  return 'operator';
}

// The repaint path's tolerant tokenizer: an open delimiter at end of
// input (the lexer's structured openAtEnd fact — exactly what a user
// mid-string or mid-bracket produces on every keystroke) repairs by
// appending the inferred closer and retrying, so live coloring keeps
// working INSIDE an open literal. Anything else re-throws to the
// caller's fallback.
const closerFor = (err, text) => {
  const reason = err.reason ?? '';
  if (reason.startsWith('unterminated string')) {
    for (const delim of ['"""', "'''", '"', "'", '`']) {
      if (text.startsWith(delim, err.start)) return delim;
    }
    return null;
  }
  if (reason.startsWith('missing ///')) return '///';
  const m = /unclosed '(.+?)'/.exec(reason);
  if (m) return { '(': ')', '[': ']', '{': '}', '#{': '}' }[m[1]] ?? null;
  const w = /never closed by '(.)'/.exec(reason);
  return w ? w[1] : null;
};

const tokenizeRepaired = (source) => {
  let text = source;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return tokenize(text);
    } catch (err) {
      const closer = err.openAtEnd === true ? closerFor(err, text) : null;
      if (closer === null) throw err;
      text += closer;
    }
  }
  return tokenize(text);
};

// Color the LAST line of `source` (earlier buffer lines were painted
// as they were typed). Returns null when tokenization cannot recover
// — the caller falls back to its last-good rendering; this path never
// throws into the terminal writer.
export function colorizeLastLine(source, theme) {
  let tape;
  try {
    tape = tokenizeRepaired(source);
  } catch {
    return null;
  }
  const lineStart = source.lastIndexOf('\n') + 1;
  const spans = [];
  for (const t of tape.tokens) {
    if (t.generated || t.end <= t.start) continue;
    const cls = classifyToken(t);
    if (cls !== null) spans.push([t.start, t.end, cls]);
  }
  for (const tr of tape.trivia) {
    if (tr.kind === 'comment') spans.push([tr.start, tr.end, 'comment']);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = lineStart;
  for (const [s, e, cls] of spans) {
    const from = Math.max(s, lineStart);
    const to = Math.min(e, source.length);
    if (to <= cursor) continue;
    out += source.slice(cursor, Math.max(cursor, from));
    out += theme.paint(cls, source.slice(Math.max(cursor, from), to));
    cursor = to;
  }
  return out + source.slice(cursor);
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s) => s.replace(ANSI_RE, '');

// ---------------------------------------------------------------------------
// The persistence wrapper — generated ONLY from reported binding
// names (the compile result's inventory), never from scanning
// emitted JS.

export function mintFresh(base, used) {
  let name = base;
  while (used.has(name)) name = `${name}_`;
  used.add(name);
  return name;
}

// Kinds whose in-file lowering binds `const` restore as const — a
// stray write throws JS's own TypeError, exactly as in-file. Plain,
// class, and def bindings are reassignable and restore as `let`.
const CONST_RESTORE = new Set(['state', 'computed', 'effect', 'readonly', 'import', 'enum']);

// Build the AsyncFunction body for one entry:
//
//   'use strict';
//   const { p, sleep } = <ctx>.rt;      // loaded runtime names, minus shadowed
//   let _ = <ctx>.vars['_'];            // the last-result binding
//   let a = <ctx>.vars['a'];            // prior bindings restore (const for reactive kinds)
//   let <last>;
//   {
//     <compiled code>                    // repl:true emission — redeclaration shadows legally
//     <ctx>.vars['a'] = a; …             // save epilogue: prior ∪ this line's bindings
//     <last> = <replResultName>;         // when the emission captured a result
//   }
//   return <last>;
//
// The ctx parameter and the outer result slot are minted against the
// inventory, the runtime names, the emission's own minted slot, and
// every identifier the entry spells.
export function buildWrapper({ code, source, replResultName = null, replImportResolver = null, priorKinds = new Map(), lineBindings = [], rtNames = [] }) {
  const used = new Set();
  // The lexer's identifier vocabulary — Unicode names dodge exactly
  // like ASCII ones (one identifier definition in the repository).
  for (const name of identifierRuns(source)) used.add(name);
  for (const name of priorKinds.keys()) used.add(name);
  for (const { name } of lineBindings) used.add(name);
  for (const name of rtNames) used.add(name);
  if (replResultName !== null) used.add(replResultName);
  if (replImportResolver !== null) used.add(replImportResolver);
  const ctxName = mintFresh('__rip', used);
  const lastName = mintFresh('__last', used);

  const lines = [`'use strict';`];
  // The emission routes every dynamic-import specifier through the
  // minted resolver name — bind it to the session's cwd-anchored
  // resolver.
  if (replImportResolver !== null) lines.push(`const ${replImportResolver} = ${ctxName}.resolveImport;`);
  const exposed = rtNames.filter((n) => n !== '_' && !priorKinds.has(n));
  if (exposed.length > 0) lines.push(`const { ${exposed.join(', ')} } = ${ctxName}.rt;`);
  // `_` is the REPL's last-result binding — excluded from the
  // inventory-driven save/restore below (the loop assigns it after
  // display); an entry's own match write (`=~`) hoists a fresh
  // block-scoped `let _` that shadows this restore, the language's
  // per-invocation rule.
  lines.push(`let _ = ${ctxName}.vars['_'];`);
  for (const [name, kind] of priorKinds) {
    if (name === '_') continue;
    lines.push(`${CONST_RESTORE.has(kind) ? 'const' : 'let'} ${name} = ${ctxName}.vars['${name}'];`);
  }
  lines.push(`let ${lastName};`);
  lines.push('{');
  lines.push(code);
  const toSave = new Set([...priorKinds.keys(), ...lineBindings.map(({ name }) => name)]);
  toSave.delete('_');
  for (const name of toSave) lines.push(`${ctxName}.vars['${name}'] = ${name};`);
  if (replResultName !== null) lines.push(`${lastName} = ${replResultName};`);
  lines.push('}');
  lines.push(`return ${lastName};`);
  return { body: lines.join('\n'), ctxName };
}

// ---------------------------------------------------------------------------
// The session — compile → wrap → evaluate, carrying the binding
// inventory forward as the next entry's ambient seed.

const AsyncFunction = (async () => {}).constructor;

// The cwd-anchored import resolver the wrapper binds to the emission's
// minted resolver name. Dynamic import inside an AsyncFunction anchors
// to THIS module, so every specifier — lowered static imports, literal
// AND computed `import(...)` arguments — maps through here at runtime.
// Absolute paths, URLs, and node:/bun: builtins pass through; relative
// and bare specifiers resolve against the session's cwd; an
// unresolvable one throws NAMING the specifier and the resolution base
// (never an opaque resolver object).
export function makeImportResolver(cwd) {
  return (spec) => {
    if (typeof spec !== 'string') return spec;
    if (spec.startsWith('node:') || spec.startsWith('bun:') || spec.startsWith('data:') ||
        spec.startsWith('/') || spec.includes('://')) {
      return spec;
    }
    try {
      return Bun.resolveSync(spec, cwd);
    } catch {
      throw new Error(`Cannot resolve import '${spec}' from '${cwd}' — check the specifier, or install the package there`);
    }
  };
}

export class Session {
  constructor({ cwd = process.cwd() } = {}) {
    this.cwd = cwd;
    this.bindings = new Map(); // name → kind (the persisted inventory)
    this.ctx = { vars: {}, rt: {}, resolveImport: makeImportResolver(cwd) };
    this.loadedRuntimes = new Set();
    this.runtimeTable = _runtimeTable();
  }

  ambientSeed() {
    // `_` never seeds: it is the REPL's own last-result binding, and
    // seeding it would suppress the language's per-entry `let _`.
    return [...this.bindings].filter(([name]) => name !== '_').map(([name, kind]) => ({ name, kind }));
  }

  compile(source) {
    return compile(source, {
      path: '<repl>',
      repl: true,
      runtimeDelivery: 'none',
      ambientBindings: this.ambientSeed(),
    });
  }

  // Import each feature runtime module once on first need — one copy
  // per process (the reactive runtime's own sentinel enforces it) —
  // and expose its names through the context object.
  async loadRuntimes(keys) {
    for (const key of keys) {
      if (this.loadedRuntimes.has(key)) continue;
      const rt = this.runtimeTable.find((r) => r.key === key);
      if (rt === undefined) continue;
      if (rt.requires) await this.loadRuntimes([rt.requires]);
      const mod = await import(rt.url.href);
      for (const name of rt.names) {
        if (!(name in this.ctx.rt)) this.ctx.rt[name] = mod[name];
      }
      this.loadedRuntimes.add(key);
    }
  }

  // Evaluate one complete entry. Returns { value, captured } —
  // `captured` false means the entry produced no result slot (a
  // declaration or statement) and nothing should display. Throws
  // CompileError for compile rejections and the user program's own
  // errors for evaluation failures; the binding inventory advances
  // only on success.
  async eval(source, { onCompiled = null } = {}) {
    const result = this.compile(source);
    if (onCompiled !== null) onCompiled(result);
    if (result.code.trim() === '') return { value: undefined, captured: false };
    await this.loadRuntimes(result.runtimes);
    const { body, ctxName } = buildWrapper({
      code: result.code,
      source,
      replResultName: result.replResultName,
      replImportResolver: result.replImportResolver,
      priorKinds: this.bindings,
      lineBindings: result.bindings,
      rtNames: Object.keys(this.ctx.rt),
    });
    const fn = new AsyncFunction(ctxName, body);
    let value = await fn(this.ctx);
    // Promise results flatten before display — the REPL shows values,
    // not pending handles.
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
      value = await value;
    }
    for (const { name, kind } of result.bindings) {
      if (name !== '_') this.bindings.set(name, kind);
    }
    const captured = result.replResultName !== null;
    if (captured && value !== undefined) this.ctx.vars['_'] = value;
    return { value, captured };
  }

  clear() {
    this.bindings.clear();
    this.ctx.vars = {};
  }
}

// ---------------------------------------------------------------------------
// Display

export function formatValue(value, theme, colorOn) {
  return inspect(value, { colors: colorOn, depth: 4, maxArrayLength: 100 });
}

// One error, one honest line. CompileError messages are already
// positioned and excerpted. Bun's ResolveMessage/BuildMessage are NOT
// Error instances and inspect to empty braces — their message,
// specifier, and referrer surface explicitly instead.
export function describeError(err) {
  if (err instanceof CompileError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (err !== null && typeof err === 'object' && typeof err.message === 'string') {
    const name = typeof err.name === 'string' && err.name !== '' ? err.name : 'Error';
    const spec = typeof err.specifier === 'string' && err.specifier !== '' ? err.specifier : null;
    const from = typeof err.referrer === 'string' && err.referrer !== '' ? err.referrer : null;
    const detail = spec === null ? '' : ` (importing '${spec}'${from === null ? '' : ` from '${from}'`})`;
    return `${name}: ${err.message}${detail}`;
  }
  return inspect(err);
}

// ---------------------------------------------------------------------------
// History — ~/.rip_history (mode 0600 — histories carry secrets),
// 1000 entries, dedup. Multi-line entries store (and recall) as
// SINGLE entries through an INJECTIVE escape: the ⏎ glyph is the
// escape character (⏎n = newline, ⏎e = a literal ⏎), so a legal
// single-line entry containing ⏎ round-trips exactly and can never
// be mistaken for a multi-line one. An exact-match table decodes a
// recalled line back to its original source (never a substring guess).

export const HISTORY_LIMIT = 1000;
export const encodeEntry = (s) => s.replaceAll('⏎', '⏎e').replaceAll('\n', '⏎n');
export const decodeEntry = (s) => s.replace(/⏎([ne])/g, (_, c) => (c === 'n' ? '\n' : '⏎'));

// Display-cell width for cursor math: zero for ANSI escapes, two for
// double-width (East Asian) glyphs — Bun.stringWidth owns the tables.
export const displayWidth = (s) => Bun.stringWidth(s);

// Recall bookkeeping: the decode table maps SUBMITTED text back to an
// entry's original source, but that mapping is legitimate ONLY for a
// line history navigation placed in the buffer and the user never
// edited — typed bytes that happen to equal an encoded entry must
// evaluate verbatim. The tracker holds at most one mark: the exact
// text the last navigation recalled. `fromHistory` is readline's own
// verdict (historyIndex ≥ 0) — navigating down past the newest entry
// restores the user's saved in-progress line, which is typed text,
// not a recall. Any key that changes the buffer clears the mark;
// cursor movement (buffer unchanged) keeps it. The submit-time
// decision consumes the mark either way.
export class RecallTracker {
  constructor() {
    this.recalled = null;
  }

  navigated(line, fromHistory) {
    this.recalled = fromHistory ? line : null;
  }

  touched(line) {
    if (this.recalled !== null && line !== this.recalled) this.recalled = null;
  }

  shouldDecode(submitted) {
    const hit = this.recalled !== null && submitted === this.recalled;
    this.recalled = null;
    return hit;
  }
}

// The keys readline treats as history navigation: plain up/down
// arrows and ctrl-p/ctrl-n. A misclassification fails SAFE: a missed
// navigation just skips the decode; a false positive defers to
// readline's historyIndex verdict.
export const isHistoryNavKey = (key) =>
  key != null && key.meta !== true && (
    ((key.name === 'up' || key.name === 'down') && key.ctrl !== true) ||
    ((key.name === 'p' || key.name === 'n') && key.ctrl === true));

// ---------------------------------------------------------------------------
// The interactive REPL

const KIND_INDICATOR = {
  state: ':=', computed: '~=', effect: '~>', readonly: '=!',
  plain: '=', import: 'import', class: 'class', def: 'def', enum: 'enum',
};

const DOT_COMMANDS = ['.help', '.clear', '.vars', '.history', '.editor', '.theme', '.color', '.tokens', '.sexp', '.js', '.exit'];

export class Repl {
  constructor({ input = process.stdin, output = process.stdout, cwd = process.cwd(), env = process.env } = {}) {
    this.input = input;
    this.output = output;
    this.env = env;
    this.session = new Session({ cwd });
    this.buffer = '';
    this.entries = [];          // evaluated entries, oldest first
    this.recall = [];           // encoded recall lines, newest first (rl.history's source of truth)
    this.decodeTable = new Map(); // encoded recall line → original source
    this.recallTracker = new RecallTracker(); // never marked without a terminal: piped input always passes through verbatim
    this.editorMode = false;
    this.editorLines = [];
    this.evaluating = false;
    this.queue = Promise.resolve();
    this.historyFile = join(homedir(), '.rip_history');
    this.show = { tokens: false, sexp: false, js: false };
    this.terminal = Boolean(input.isTTY && output.isTTY);
    this.stdinEnded = false;
    this.closing = false;

    const config = readProjectConfig(cwd);
    this.configRepl = config.repl ?? null;
    this.noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== '';
    this.themeOverride = null;
    this.detected = null;
    this.colorOn = true; // .color toggle; mono still wins below
    this.theme = this.makeTheme();
    this.lastGood = { raw: '', colored: '' };

    input.on('end', () => { this.stdinEnded = true; });
  }

  makeTheme() {
    const name = resolveThemeName({
      override: this.colorOn ? this.themeOverride : 'mono',
      configTheme: this.colorOn ? this.configRepl?.theme ?? null : 'mono',
      detected: this.colorOn ? this.detected : 'mono',
      noColor: this.noColor || !this.colorOn,
      tty: this.terminal,
    });
    return buildTheme(name, name === 'mono' ? null : this.configRepl?.colors ?? null, this.env.COLORTERM);
  }

  get colorsActive() {
    return this.theme.name !== 'mono';
  }

  promptText() {
    if (this.editorMode) return '';
    return this.buffer === ''
      ? this.theme.paint('prompt', 'rip>') + ' '
      : this.theme.paint('continuation', '....>') + ' ';
  }

  async start() {
    if (this.terminal && !this.noColor) {
      this.detected = await detectBackgroundTheme();
      this.theme = this.makeTheme();
    }
    if (this.terminal) {
      this.output.write(`${this.theme.paint('dim', `Rip ${packageJson.version} — type .help for commands, Ctrl+D to exit`)}\n`);
    }
    this.loadHistory();
    this.makeInterface();
    this.rl.prompt();
  }

  makeInterface() {
    this.rl = readline.createInterface({
      input: this.input,
      output: this.output,
      terminal: this.terminal,
      prompt: this.promptText(),
      historySize: HISTORY_LIMIT,
      removeHistoryDuplicates: true,
      completer: (line) => this.complete(line),
    });
    if (this.rl.history !== undefined) this.rl.history = [...this.recall];
    this.rl.on('line', (line) => {
      this.queue = this.queue.then(() => this.onLine(line)).catch((err) => this.printError(err));
    });
    this.rl.on('SIGINT', () => this.onInterrupt());
    this.rl.on('close', () => {
      this.queue = this.queue.then(() => this.onEOF()).catch(() => this.shutdown(1));
    });
    if (this.terminal) {
      // Live repaint: re-tokenize the buffer per keystroke and repaint
      // the input line with theme colors. setImmediate lets readline
      // apply the key first — runtimes differ on whether keypress
      // fires before or after readline mutates rl.line, so BOTH the
      // repaint and the recall bookkeeping sample state on the next
      // tick, when the mutation has landed either way. Return/enter
      // are excluded, so a recall mark survives to the 'line' event.
      if (this.keypressListener !== undefined) this.input.removeListener('keypress', this.keypressListener);
      this.keypressListener = (_s, key) => {
        if (key && (key.name === 'return' || key.name === 'enter')) return;
        setImmediate(() => {
          this.observeKeyEffect(key);
          this.repaint();
        });
      };
      this.input.on('keypress', this.keypressListener);
    }
  }

  // The recall-bookkeeping sampler (fix seam, called post-mutation):
  // a navigation key marks the buffer as recalled when readline's own
  // historyIndex says the line came from history; any other key runs
  // the edit check against the mark.
  observeKeyEffect(key) {
    if (this.rl === undefined || this.closing) return;
    const line = this.rl.line ?? '';
    if (isHistoryNavKey(key)) this.recallTracker.navigated(line, (this.rl.historyIndex ?? -1) >= 0);
    else this.recallTracker.touched(line);
  }

  // The submit-side decision: a line decodes back to its original
  // source ONLY when history navigation placed it and no edit
  // followed; typed text always evaluates verbatim.
  resolveSubmitted(raw) {
    return this.recallTracker.shouldDecode(raw) ? this.decodeTable.get(raw) ?? raw : raw;
  }

  repaint() {
    if (!this.terminal || !this.colorsActive || this.evaluating || this.closing || this.rl === undefined) return;
    const raw = this.rl.line ?? '';
    const full = (this.buffer === '' ? '' : this.buffer + '\n') + raw;
    let colored = colorizeLastLine(full, this.theme);
    if (colored === null) {
      // Tokenization could not recover (a hard lexer error mid-line):
      // fall back to the last good coloring extended plainly.
      colored = raw.startsWith(this.lastGood.raw)
        ? this.lastGood.colored + raw.slice(this.lastGood.raw.length)
        : raw;
    } else {
      this.lastGood = { raw, colored };
    }
    const prompt = this.promptText();
    readline.cursorTo(this.output, 0);
    this.output.write(prompt + colored);
    readline.clearLine(this.output, 1);
    // Cursor math in display CELLS: ANSI escapes are zero-width and
    // East Asian glyphs are double-width (displayWidth owns both), so
    // the cursor lands on the glyph rl.cursor points at.
    readline.cursorTo(this.output, displayWidth(prompt) + displayWidth(raw.slice(0, this.rl.cursor)));
  }

  complete(line) {
    // A line that IS a dot word ('.', '.he') completes dot commands.
    const trimmed = line.trimStart();
    if (trimmed === '.' || (trimmed.startsWith('.') && isIdentifierName(trimmed.slice(1)))) {
      return [DOT_COMMANDS.filter((c) => c.startsWith(trimmed)).sort(), trimmed];
    }
    // The trailing word comes from the lexer's ONE identifier
    // vocabulary (Unicode included): the last identifier run, only
    // when it reaches the line's end.
    const runs = identifierRuns(line);
    const last = runs.length > 0 ? runs[runs.length - 1] : '';
    const word = last !== '' && line.endsWith(last) ? last : '';
    // A member tail (`obj.π`) offers nothing — completion is
    // bindings-only, never members.
    if (word !== '' && line[line.length - word.length - 1] === '.') return [[], word];
    const pool = [...this.session.bindings.keys()].filter((n) => n !== '_');
    return [pool.filter((c) => c.startsWith(word)).sort(), word];
  }

  onInterrupt() {
    if (this.editorMode) {
      this.editorMode = false;
      this.editorLines = [];
      this.output.write(`\n${this.theme.paint('dim', '(editor cancelled)')}\n`);
      this.promptNext();
      return;
    }
    if (this.buffer !== '') {
      this.buffer = '';
      this.output.write('\n');
      this.promptNext();
      return;
    }
    this.output.write('\n');
    this.shutdown(0);
  }

  // Ctrl+D / end of input. In editor mode this RUNS the composed
  // buffer; the interface is recreated afterwards when the input
  // stream is still alive (a terminal), and shuts down when it ended
  // (a pipe).
  async onEOF() {
    if (this.closing) return;
    if (this.editorMode) {
      const source = this.editorLines.join('\n');
      this.editorMode = false;
      this.editorLines = [];
      if (source.trim() !== '') {
        this.recordEntry(source);
        await this.execute(source);
      }
      if (!this.stdinEnded && this.terminal) {
        this.makeInterface();
        this.promptNext();
        return;
      }
    }
    // A pending buffer the indented-continuation policy kept open
    // flushes at end of input — complete entries run; an incomplete
    // one has nothing runnable and drops.
    if (this.buffer.trim() !== '') {
      const source = this.buffer.trimEnd();
      this.buffer = '';
      const verdict = classifyCompleteness(source);
      this.recordEntry(source);
      if (verdict.status === 'error') this.printError(verdict.error);
      else if (verdict.status === 'complete') await this.execute(source);
    }
    this.shutdown(0);
  }

  shutdown(code) {
    if (this.closing) return;
    this.closing = true;
    this.saveHistory();
    if (this.terminal) this.output.write(`${this.theme.paint('dim', 'Goodbye!')}\n`);
    process.exit(code);
  }

  promptNext() {
    if (this.closing) return;
    this.rl.setPrompt(this.promptText());
    this.rl.prompt();
  }

  async onLine(rawLine) {
    const line = this.resolveSubmitted(rawLine);
    if (this.editorMode) {
      this.editorLines.push(line);
      return;
    }
    if (this.buffer === '' && line.trimStart().startsWith('.') && /^\.[a-z]/.test(line.trimStart())) {
      this.noteRecall(line.trim());
      await this.command(line.trim());
      this.promptNext();
      return;
    }
    this.buffer = this.buffer === '' ? line : `${this.buffer}\n${line}`;
    if (this.buffer.trim() === '') {
      this.buffer = '';
      this.promptNext();
      return;
    }
    const verdict = classifyCompleteness(this.buffer);
    if (verdict.status === 'incomplete') {
      this.promptNext();
      return;
    }
    // Inside a multi-line entry, an INDENTED line keeps the block
    // open even when the buffer is already a complete program — an
    // `else`/`catch` sibling may still be coming, and only the author
    // knows. An empty or non-indented line closes it (the
    // empty-line-continue policy; the classifier stays purely
    // syntactic).
    if (verdict.status === 'complete' && this.buffer.includes('\n') && /^[ \t]/.test(line) && line.trim() !== '') {
      this.promptNext();
      return;
    }
    const source = this.buffer.trimEnd();
    this.buffer = '';
    this.recordEntry(source);
    if (verdict.status === 'error') {
      this.printError(verdict.error);
    } else {
      await this.execute(source);
    }
    this.promptNext();
  }

  async execute(source) {
    this.evaluating = true;
    try {
      const { value, captured } = await this.session.eval(source, {
        onCompiled: (result) => this.showStages(source, result),
      });
      if (captured && value !== undefined) {
        this.output.write(`${this.theme.paint('arrow', '→')} ${formatValue(value, this.theme, this.colorsActive)}\n`);
      }
    } catch (err) {
      this.printError(err);
    } finally {
      this.evaluating = false;
    }
  }

  showStages(source, result) {
    if (this.show.tokens) {
      try {
        for (const t of tokenize(source, '<repl>').tokens) {
          this.output.write(`[${t.start},${t.end}) ${t.kind}${t.value === undefined ? '' : ' ' + JSON.stringify(t.value)}\n`);
        }
      } catch { /* the compile already reported the rejection */ }
    }
    if (this.show.sexp) {
      try {
        const parser = Parser();
        parser.lexer = makeParserLexer('<repl>');
        this.output.write(JSON.stringify(parser.parse(source).sexpr) + '\n');
      } catch { /* ditto */ }
    }
    if (this.show.js) {
      this.output.write(`${this.theme.paint('dim', result.code)}\n`);
    }
  }

  printError(err) {
    this.output.write(`${this.theme.paint('error', describeError(err))}\n`);
    if (this.env.RIP_DEBUG && err instanceof Error && err.stack) {
      this.output.write(`${this.theme.paint('dim', err.stack)}\n`);
    }
  }

  info(text) {
    this.output.write(`${this.theme.paint('info', text)}\n`);
  }

  // ---- history -----------------------------------------------------------

  // One recall record, session-owned: readline's own per-line history
  // additions are guesses (it skips empty lines and dedup reorders),
  // so rl.history is REBUILT from this record after every completed
  // entry or dot command — never spliced by counting. Mid-entry, the
  // physical-line fragments readline added stay recallable; the
  // rebuild replaces them when the entry lands.
  noteRecall(text) {
    const encoded = encodeEntry(text);
    if (encoded !== text) this.decodeTable.set(encoded, text);
    const at = this.recall.indexOf(encoded);
    if (at !== -1) this.recall.splice(at, 1);
    this.recall.unshift(encoded);
    if (this.recall.length > HISTORY_LIMIT) this.recall.length = HISTORY_LIMIT;
    if (this.rl?.history !== undefined) this.rl.history = [...this.recall];
  }

  recordEntry(source) {
    this.entries.push(source);
    this.noteRecall(source);
  }

  loadHistory() {
    try {
      if (!existsSync(this.historyFile)) return;
      const lines = readFileSync(this.historyFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
      for (const encoded of lines) {
        const decoded = decodeEntry(encoded);
        if (decoded !== encoded) this.decodeTable.set(encoded, decoded);
      }
      this.recall = [...lines].reverse();
    } catch { /* an unreadable history file never blocks startup */ }
  }

  saveHistory() {
    try {
      const encoded = this.entries.map(encodeEntry);
      const prior = existsSync(this.historyFile)
        ? readFileSync(this.historyFile, 'utf8').split('\n').filter((l) => l.trim() !== '')
        : [];
      const merged = [...prior, ...encoded];
      const deduped = [];
      const seen = new Set();
      for (let i = merged.length - 1; i >= 0; i--) {
        if (seen.has(merged[i])) continue;
        seen.add(merged[i]);
        deduped.unshift(merged[i]);
      }
      // Histories carry secrets: 0600 at creation, and an existing
      // looser file TIGHTENS (writeFileSync's mode applies only at
      // creation, so the chmod is load-bearing).
      writeFileSync(this.historyFile, deduped.slice(-HISTORY_LIMIT).join('\n') + '\n', { mode: 0o600 });
      chmodSync(this.historyFile, 0o600);
    } catch { /* a read-only home never blocks exit */ }
  }

  // ---- dot commands --------------------------------------------------------

  async command(cmd) {
    const [name, ...rest] = cmd.split(/\s+/);
    switch (name) {
      case '.help': return this.printHelp();
      case '.clear':
        this.session.clear();
        this.buffer = '';
        this.info('Session cleared');
        return;
      case '.vars': return this.printVars();
      case '.history': return this.printHistory();
      case '.exit': return this.shutdown(0);
      case '.editor':
        this.editorMode = true;
        this.editorLines = [];
        this.info('// editor mode — Ctrl+D runs, Ctrl+C cancels');
        return;
      case '.theme': {
        const pick = rest[0];
        if (pick === undefined) {
          this.info(`theme: ${this.theme.name} (available: ${THEME_NAMES.join(', ')})`);
          return;
        }
        if (!THEME_NAMES.includes(pick)) {
          this.printError(new Error(`unknown theme '${pick}' — available: ${THEME_NAMES.join(', ')}`));
          return;
        }
        this.themeOverride = pick;
        this.theme = this.makeTheme();
        this.info(`theme: ${this.theme.name}`);
        return;
      }
      case '.color':
        this.colorOn = !this.colorOn;
        this.theme = this.makeTheme();
        this.info(`colors: ${this.colorOn && this.colorsActive ? 'on' : 'off'}`);
        return;
      case '.tokens':
      case '.sexp':
      case '.js': {
        const key = name.slice(1);
        this.show[key] = !this.show[key];
        this.info(`${key} display: ${this.show[key] ? 'on' : 'off'}`);
        return;
      }
      default:
        this.printError(new Error(`unknown command ${name} — type .help for the list`));
    }
  }

  printHelp() {
    this.output.write(`
Commands
  .help            Show this help
  .clear           Reset the session (all bindings, reactive state included)
  .vars            List defined bindings with their kinds
  .history         Show recent entries
  .editor          Multi-line compose mode — Ctrl+D runs, Ctrl+C cancels
  .theme [name]    Show or switch the color theme (${THEME_NAMES.join(', ')})
  .color           Toggle colors on/off
  .tokens          Toggle token-stream display
  .sexp            Toggle s-expression display
  .js              Toggle compiled-JavaScript display
  .exit            Exit (also Ctrl+D at an empty prompt)

Keys
  Enter            Runs a complete entry; continues an incomplete one
  Ctrl+C           Clears a pending multi-line entry; at an empty prompt exits
  Ctrl+D           At an empty prompt, exits and saves history
  Tab              Completes binding names and dot commands

Notes
  _ holds the last printed result. Within one entry, a match write
  (\`=~\`) binds the language's own \`_\` for that entry — the entry's
  printed result then becomes the next \`_\`.
  Multi-line entries recall from history as single entries.
  import './file.rip' compiles through the loader, relative to your cwd.
`);
  }

  printVars() {
    if (this.session.bindings.size === 0) {
      this.info('No bindings defined');
      return;
    }
    for (const [name, kind] of this.session.bindings) {
      const indicator = KIND_INDICATOR[kind] ?? '=';
      const raw = this.session.ctx.vars[name];
      const value = (kind === 'state' || kind === 'computed') && raw !== null && typeof raw === 'object' && 'value' in raw
        ? raw.value
        : raw;
      const preview = kind === 'effect'
        ? this.theme.paint('dim', '[effect]')
        : inspect(value, { colors: this.colorsActive, depth: 0, maxArrayLength: 3 });
      this.output.write(`  ${this.theme.paint('property', name)} ${this.theme.paint('operator', indicator)} ${preview}\n`);
    }
    if (this.session.ctx.vars['_'] !== undefined) {
      this.output.write(`  ${this.theme.paint('dim', `_ = ${inspect(this.session.ctx.vars['_'], { colors: false, depth: 0 })}`)}\n`);
    }
  }

  printHistory() {
    if (this.entries.length === 0) {
      this.info('No history');
      return;
    }
    const recent = this.entries.slice(-20);
    const start = this.entries.length - recent.length;
    recent.forEach((entry, i) => {
      this.output.write(`  ${this.theme.paint('dim', `${start + i + 1}:`)} ${encodeEntry(entry)}\n`);
    });
  }
}

export function startRepl(options = {}) {
  const repl = new Repl(options);
  repl.queue = repl.queue.then(() => repl.start());
  return repl;
}

// ---------------------------------------------------------------------------
// Entry — `bin/rip` spawns this module under the loader preload.
// `--eval <code>` evaluates one entry and exits (the -e flag).

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const evalAt = argv.findIndex((a) => a === '--eval' || a === '-e');
  if (evalAt !== -1) {
    const code = argv[evalAt + 1];
    if (code === undefined) {
      console.error('rip: --eval requires a code argument');
      process.exit(2);
    }
    const session = new Session({ cwd: process.cwd() });
    const verdict = classifyCompleteness(code);
    if (verdict.status === 'incomplete') {
      console.error('rip: --eval input is incomplete');
      process.exit(1);
    }
    if (verdict.status === 'error') {
      console.error(verdict.error.message);
      process.exit(1);
    }
    try {
      const { value, captured } = await session.eval(code);
      if (captured && value !== undefined) {
        console.log(inspect(value, { colors: false, depth: 4, maxArrayLength: 100 }));
      }
      process.exit(0);
    } catch (err) {
      console.error(describeError(err));
      process.exit(1);
    }
  }
  startRepl();
}
