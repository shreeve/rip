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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { compile, CompileError, classifyCompleteness } from './compile.js';
import { tokenize, makeParserLexer } from './lexer.js';
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

// Terminal background detection, once at startup (TTY only): OSC 11
// query with a short timeout — parse the `rgb:` reply and compute
// luminance — falling back to $COLORFGBG's background field, then
// dark.
export async function detectBackgroundTheme({ timeoutMs = 80 } = {}) {
  const fromColorFgBg = () => {
    const parts = (process.env.COLORFGBG ?? '').split(';');
    const bg = Number(parts[parts.length - 1]);
    if (!Number.isInteger(bg)) return null;
    return bg === 7 || bg >= 9 ? 'light' : 'dark';
  };
  if (!process.stdout.isTTY || !process.stdin.isTTY) return fromColorFgBg() ?? 'dark';
  const reply = await new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let data = '';
    const finish = (value) => {
      stdin.removeListener('data', onData);
      if (!wasRaw) stdin.setRawMode(false);
      stdin.pause();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onData = (chunk) => {
      data += chunk.toString('utf8');
      const m = /\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(data);
      if (m) {
        clearTimeout(timer);
        finish(m.slice(1, 4));
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    process.stdout.write('\x1b]11;?\x07');
  });
  if (reply === null) return fromColorFgBg() ?? 'dark';
  // Components arrive as 1–4 hex digits per channel; normalize to 0–1.
  const chan = (h) => parseInt(h, 16) / (16 ** h.length - 1);
  const [r, g, b] = reply.map(chan);
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
  for (const m of source.matchAll(/[A-Za-z_$][\w$]*/g)) used.add(m[0]);
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
// History — ~/.rip_history, 1000 entries, dedup. Multi-line entries
// store (and recall) as SINGLE entries: newlines encode as a visible
// return glyph, and an exact-match table decodes a recalled line back
// to its original source (never a substring guess).

export const HISTORY_LIMIT = 1000;
export const encodeEntry = (s) => s.replaceAll('\n', '⏎');

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
    this.decodeTable = new Map(); // encoded recall line → original source
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
    if (this.rlHistory !== undefined && this.rl.history !== undefined) {
      this.rl.history = this.rlHistory;
    }
    this.rlHistory = this.rl.history;
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
      // apply the key first; the guard keeps evaluation output clean.
      if (this.keypressListener !== undefined) this.input.removeListener('keypress', this.keypressListener);
      this.keypressListener = (_s, key) => {
        if (key && (key.name === 'return' || key.name === 'enter')) return;
        setImmediate(() => this.repaint());
      };
      this.input.on('keypress', this.keypressListener);
    }
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
    readline.cursorTo(this.output, stripAnsi(prompt).length + this.rl.cursor);
  }

  complete(line) {
    const m = /(\.?[A-Za-z_$][\w$]*|\.)$/.exec(line);
    const word = m === null ? '' : m[0];
    const pool = word.startsWith('.') && line.trimStart() === word
      ? DOT_COMMANDS
      : [...this.session.bindings.keys()].filter((n) => n !== '_');
    const hits = pool.filter((c) => c.startsWith(word)).sort();
    return [hits, word];
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
    const line = this.decodeTable.get(rawLine) ?? rawLine;
    if (this.editorMode) {
      this.editorLines.push(line);
      return;
    }
    if (this.buffer === '' && line.trimStart().startsWith('.') && /^\.[a-z]/.test(line.trimStart())) {
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

  recordEntry(source) {
    this.entries.push(source);
    if (source.includes('\n')) {
      const encoded = encodeEntry(source);
      this.decodeTable.set(encoded, source);
      if (this.rl.history !== undefined) {
        // readline recorded each physical line; replace the fragments
        // with ONE encoded entry so recall brings the whole thing back.
        const lineCount = source.split('\n').length;
        this.rl.history.splice(0, lineCount);
        this.rl.history.unshift(encoded);
      }
    }
  }

  loadHistory() {
    try {
      if (!existsSync(this.historyFile)) return;
      const lines = readFileSync(this.historyFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
      for (const encoded of lines) {
        if (encoded.includes('⏎')) this.decodeTable.set(encoded, encoded.replaceAll('⏎', '\n'));
      }
      this.rlHistory = [...lines].reverse();
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
      writeFileSync(this.historyFile, deduped.slice(-HISTORY_LIMIT).join('\n') + '\n');
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
