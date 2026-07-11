// The Rip-native battery engine: loads a .rip battery
// file — a program of three-verb DSL calls — and executes its rows
// against the compiler. Verbs:
//
//   test name, src, expected   compile src, evaluate, JSON-compare
//   code name, src, want       compile src, compare NORMALIZED output
//   fail name, src, includes?  expect compile/eval to throw (message
//                              substring optional)
//   type name, src, want       compile src, compare declarations text
//
// Rows collect first (the battery file executes once with recording
// verbs), then run one at a time — evaluation rows share module-level
// runtime state (the schema registry, reactive scheduling), so order
// is the file's own and never concurrent.
//
// Snippets compile at runtime delivery 'none'; the feature runtimes
// load ONCE per process from the assembled build and their exports are
// in scope for every evaluation — one shared runtime, exactly the
// posture of a real module graph.
import { basename } from 'node:path';
import { collectInto } from './testing.js';

import { compile, CompileError } from '../../src/compile.js';
import * as reactiveRuntime from '../../src/runtime/reactive.js';
import * as schemaRuntime from '../../src/runtime/schema.js';
import * as ormRuntime from '../../src/runtime/schema-orm.js';
import * as componentsRuntime from '../../src/runtime/components.js';
import * as stdlibRuntime from '../../src/runtime/stdlib.js';

// Lazy: the code-verb parse gate's JavaScript parser.
let codeParser = null;

// The evaluation scope: every runtime export, visible to direct eval
// through destructured locals. Battery snippets that redeclare schema
// names across rows need the registry's replace semantics — the
// name-collision rejection is itself tested explicitly where wanted.
const ENV = {
  ...reactiveRuntime,
  ...schemaRuntime,
  ...ormRuntime,
  ...componentsRuntime,
};

// The stdlib names bind PER ROW, mirroring delivery's shadow rule: a
// name binds only when the compiled row references it and does not
// declare it itself (a row's `let p = Post.create(…)` must keep its
// own p — in delivered output a user binding suppresses the helper).
const stdlibEnv = (code) => {
  const out = {};
  for (const [k, v] of Object.entries(stdlibRuntime)) {
    if (new RegExp(`\\b${k}\\b`).test(code) &&
        !new RegExp(`\\b(?:let|const|var|function|class)\\s+${k}\\b`).test(code)) {
      out[k] = v;
    }
  }
  return out;
};

// Battery snippets arrive as heredoc bodies that may carry a uniform
// leading indentation (the heredoc's own layout) — a program does not
// start with INDENT, so the runner dedents by the common prefix of
// the non-blank lines before compiling.
export function dedent(src) {
  const lines = String(src).split('\n');
  let common = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.match(/^[ \t]*/)[0].length;
    common = common === null ? indent : Math.min(common, indent);
    if (common === 0) return src;
  }
  if (!common) return src;
  return lines.map((l) => l.slice(common)).join('\n');
}

// ── output normalization (the `code` verb's comparison) ─────────────
// Comparison is over a normalized skeleton: hoisted declarations,
// comments, semicolons, and whitespace are layout, not behavior — the
// verb pins STRUCTURE, and the byte-level pins live in the corpus
// expectations.
export function normalizeCode(code) {
  return code
    .trim()
    .replace(/^\/\/.*\n/gm, '')
    // Bare hoist DECLARATIONS are layout (`let a, b;`); initialized
    // declarations are statements — the declare-in-place tier spells
    // `let x = v` where older output hoisted, so only the `let` prefix
    // strips, never the statement.
    .replace(/^\s*let\s+[\w$]+(?:,\s*[\w$]+)*;\n?/gm, '')
    .replace(/^\s*var\s+[\w$]+(?:,\s*[\w$]+)*;\n?/gm, '')
    .replace(/^(\s*)(?:let|var)\s+(?=[\w$]+\s*=)/gm, '$1')
    .replace(/;\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}();,=])\s*/g, '$1')
    .replace(/;}/g, '}')
    // Quote STYLE is spelling, not structure: the engine emits string
    // values double-quoted; wants written single-quoted compare equal.
    .replace(/'([^'"\\]*)'/g, '"$1"')
    .trim();
}

// ── top-level-await detection ────────────────────────────────────────
// True when the compiled code has an `await` at module scope (outside
// any function body): such code must run in an AsyncFunction, not
// eval. The walker tracks brace depth while skipping comments,
// strings, template literals (with `${…}` re-entry), and regex
// literals (disambiguated from division by previous-token context). A
// `{` opens a function body when it follows `=>` or a `)` whose
// matching `(` is not preceded by a control keyword.
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'catch', 'switch', 'with']);
const REGEX_PUNCT = new Set('([{,;:?=!&|+-*%/<>~^'.split(''));
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'delete', 'void', 'throw', 'new', 'in', 'of', 'instanceof', 'await', 'yield',
]);

export function needsAsyncWrapper(code) {
  if (code.includes('for await')) return true;
  if (!/\bawait\b/.test(code)) return false;
  const stack = [];
  const tplStack = [];
  let braceDepth = 0;
  const isRegexHere = (pos) => {
    let p = pos - 1;
    while (p >= 0 && /\s/.test(code[p])) p--;
    if (p < 0) return true;
    const ch = code[p];
    if (REGEX_PUNCT.has(ch)) return true;
    if (!/[\w$]/.test(ch)) return false;
    let end = p + 1;
    while (p >= 0 && /[\w$]/.test(code[p])) p--;
    return REGEX_KEYWORDS.has(code.slice(p + 1, end));
  };
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '/' && isRegexHere(i)) {
      i++;
      while (i < code.length && code[i] !== '/') {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '[') {
          i++;
          while (i < code.length && code[i] !== ']') {
            if (code[i] === '\\') { i += 2; continue; }
            i++;
          }
        }
        i++;
      }
      i++;
      while (i < code.length && /[gimsuy]/.test(code[i])) i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') { i += 2; continue; }
        i++;
      }
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '$' && code[i + 1] === '{') {
          tplStack.push(braceDepth);
          braceDepth++;
          i += 2;
          break;
        }
        i++;
      }
      if (i < code.length && code[i] === '`') i++;
      continue;
    }
    if (c === '{') {
      braceDepth++;
      let k = i - 1;
      while (k >= 0 && /\s/.test(code[k])) k--;
      let isFunc = false;
      if (k >= 1 && code[k] === '>' && code[k - 1] === '=') {
        isFunc = true;
      } else if (code[k] === ')') {
        let d = 1, j = k - 1;
        while (j >= 0 && d > 0) {
          if (code[j] === ')') d++;
          else if (code[j] === '(') d--;
          if (d === 0) break;
          j--;
        }
        let m = j - 1;
        while (m >= 0 && /\s/.test(code[m])) m--;
        let end = m + 1;
        while (m >= 0 && /[\w$]/.test(code[m])) m--;
        const prevWord = code.slice(m + 1, end);
        isFunc = !CONTROL_KEYWORDS.has(prevWord);
      }
      if (isFunc) stack.push(braceDepth);
      i++;
      continue;
    }
    if (c === '}') {
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth - 1) {
        tplStack.pop();
        braceDepth--;
        i++;
        while (i < code.length && code[i] !== '`') {
          if (code[i] === '\\') { i += 2; continue; }
          if (code[i] === '$' && code[i + 1] === '{') {
            tplStack.push(braceDepth);
            braceDepth++;
            i += 2;
            break;
          }
          i++;
        }
        if (i < code.length && code[i] === '`') i++;
        continue;
      }
      if (stack.length && stack[stack.length - 1] === braceDepth) stack.pop();
      braceDepth--;
      i++;
      continue;
    }
    if (stack.length === 0 && c === 'a' && code.slice(i, i + 6) === 'await ' &&
        (i === 0 || !/[\w$]/.test(code[i - 1]))) {
      return true;
    }
    i++;
  }
  return false;
}

// AsyncFunction does not auto-return the last expression the way eval
// does — inject a `return` on the final top-level expression so the
// row receives the value.
const SKIP_INJECT = /^(if|for|while|do|class|function|async function|const|let|var|return|throw|try|switch|import|export|await\s*$)\b/;

export function injectReturn(code) {
  const lines = code.split('\n');
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx--;
  if (lastIdx < 0) return code;
  const stripped = lines[lastIdx].trim().replace(/;$/, '');
  const isCloserTail = /^[)\]}]/.test(stripped);
  if (!isCloserTail && !SKIP_INJECT.test(stripped) && !stripped.startsWith('{') && !stripped.endsWith('{') && !stripped.endsWith('}')) {
    lines[lastIdx] = lines[lastIdx].replace(stripped, 'return ' + stripped);
  } else if (/[)\]}]$/.test(stripped) && !stripped.endsWith('{')) {
    // The final expression spans multiple lines: walk back balancing
    // brackets to the line that opened it and inject there — unless
    // that line begins a statement (a block legitimately yields
    // undefined).
    let depth = 0, startIdx = lastIdx;
    for (let li = lastIdx; li >= 0; li--) {
      const ln = lines[li];
      for (let ci = ln.length - 1; ci >= 0; ci--) {
        const ch = ln[ci];
        if (ch === ')' || ch === ']' || ch === '}') depth++;
        else if (ch === '(' || ch === '[' || ch === '{') depth--;
      }
      if (depth <= 0) { startIdx = li; break; }
    }
    const startStripped = lines[startIdx].trim();
    if (!SKIP_INJECT.test(startStripped) && !startStripped.startsWith('{') && !startStripped.startsWith('}')) {
      lines[startIdx] = lines[startIdx].replace(/^\s*/, (m) => m + 'return ');
    }
  }
  return lines.join('\n');
}

// ── evaluation ───────────────────────────────────────────────────────

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Direct eval sees destructured locals — the runtime exports are in
// scope for the snippet without polluting globalThis.
function evalInScope(__code, __env) {
  // Every env name binds as a parameter, then a DIRECT eval inside
  // the function body sees them all — the binding set follows the
  // env instead of a hand-kept list (the per-row stdlib names ride
  // the same path as the fixed runtime names).
  const keys = Object.keys(__env);
  const fn = new Function('__code', ...keys, 'return eval(__code);');
  return fn(__code, ...keys.map((k) => __env[k]));
}

async function evaluate(compiled) {
  // Battery snippets redeclare the same schema names across hundreds
  // of rows in one process — replace semantics apply DURING a battery
  // evaluation only (the collision rejection itself is pinned by the
  // inherited suite, whose registry state this must never leak into).
  const registry = schemaRuntime.__SchemaRegistry;
  const prior = registry?.replace;
  if (registry) registry.replace = true;
  try {
    const env = { ...ENV, ...stdlibEnv(compiled) };
    if (needsAsyncWrapper(compiled)) {
      const fn = new AsyncFunction(...Object.keys(env), injectReturn(compiled));
      return await fn(...Object.values(env));
    }
    return await evalInScope(compiled, env);
  } finally {
    if (registry) registry.replace = prior;
  }
}

// ── rows ─────────────────────────────────────────────────────────────

// Load a battery file: compile it through the engine and execute it
// with RECORDING verbs — the result is the row list, in file order.
export async function loadBattery(path) {
  const rows = [];
  collectInto(rows, basename(path));
  try {
    await import(path);
  } finally {
    collectInto(null, 'battery');
  }
  return rows;
}

// Execute one row. Returns null on pass, or a loud failure message
// carrying the file, the case name, and the diff.
export async function runRow(row) {
  const where = `${row.file} › ${row.verb} "${row.name}"`;
  try {
    if (row.verb === 'test') {
      const { code: compiled } = compile(dedent(row.src), { path: `<${row.file}>`, runtimeDelivery: 'none' });
      const actual = await evaluate(compiled);
      const got = JSON.stringify(actual);
      const want = JSON.stringify(row.expected);
      if (got !== want) return `${where}\n  expected: ${want}\n  actual:   ${got}`;
      return null;
    }
    if (row.verb === 'code') {
      // Output-shaping options from the battery's origin whose effect
      // (no injected preamble, no delivered runtime) is ALREADY the
      // engine's posture at runtime delivery 'none' — no-ops here.
      const NOOP_OPTIONS = new Set(['skipPreamble', 'skipRuntimes', 'skipDataPart', 'bare']);
      codeParser ??= new Bun.Transpiler({ loader: 'js' });
      const unknown = Object.keys(row.options ?? {}).filter((k) => !NOOP_OPTIONS.has(k));
      if (unknown.length > 0) {
        return `${where}\n  carries compile options ${JSON.stringify(row.options)} — no equivalent surface`;
      }
      const { code: compiled } = compile(dedent(row.src), { path: `<${row.file}>`, runtimeDelivery: 'none' });
      const got = normalizeCode(compiled);
      const want = normalizeCode(row.expected);
      if (got !== want) {
        return `${where}\n  expected (normalized): ${want}\n  actual   (normalized): ${got}\n  actual (raw):\n${compiled.replace(/^/gm, '    ')}`;
      }
      // A byte match is not enough: the emitted output must BE
      // JavaScript. A pin can otherwise lock in unparseable bytes
      // (an unparenthesized unary base of `**` is a SyntaxError) and
      // stay green forever — the parse gate makes that impossible.
      try {
        codeParser.scan(compiled);
      } catch (err) {
        const msg = err?.errors?.[0]?.message ?? err.message;
        // The scanner also resolves module bindings; a fragment row
        // exporting names it never declares trips that resolution,
        // which PROVES the parse succeeded — only true syntax errors
        // fail the gate.
        if (!/is not declared in this file/.test(msg)) {
          return `${where}\n  emitted output is not parseable JavaScript: ${msg}\n  actual (raw):\n${compiled.replace(/^/gm, '    ')}`;
        }
      }
      return null;
    }
    if (row.verb === 'fail') {
      let compiled;
      try {
        ({ code: compiled } = compile(dedent(row.src), { path: `<${row.file}>`, runtimeDelivery: 'none' }));
      } catch (err) {
        if (row.expected == null || `${err.message}`.includes(row.expected)) return null;
        return `${where}\n  expected error to include: ${JSON.stringify(row.expected)}\n  got: ${err.message.split('\n')[0]}`;
      }
      try {
        await evaluate(compiled);
      } catch (err) {
        if (row.expected == null || `${err.message}`.includes(row.expected)) return null;
        return `${where}\n  expected error to include: ${JSON.stringify(row.expected)}\n  got: ${err.message.split('\n')[0]}`;
      }
      return `${where}\n  expected a failure; compiled and ran`;
    }
    if (row.verb === 'type') {
      const result = compile(dedent(row.src), { path: `<${row.file}>`, runtimeDelivery: 'none' });
      const got = (result.declarations ?? '').trim();
      const want = String(row.expected).trim();
      if (got !== want) return `${where}\n  expected declarations:\n${want.replace(/^/gm, '    ')}\n  actual:\n${got.replace(/^/gm, '    ')}`;
      return null;
    }
    return `${where}\n  unknown verb`;
  } catch (err) {
    const head = err instanceof CompileError ? err.message : (err?.message ?? String(err));
    return `${where}\n  threw: ${head.split('\n').slice(0, 3).join('\n  ')}`;
  }
}
