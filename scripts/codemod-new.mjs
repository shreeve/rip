#!/usr/bin/env bun
// Rewrite prefix construction to Rip's one spelling:
//
//   bun scripts/codemod-new.mjs [--check] [--rows] <files…>
//
// `new X(a)` becomes `X.new(a)`, `new X a` becomes `X.new a`, a bare
// `new X` becomes `X.new()` (a bare `X.new` reads the property), and the
// construction dammit `new X!(a)` becomes `X.new!(a)`. Qualified and
// computed constructors keep their spine (`new a.b[k](x)` →
// `a.b[k].new(x)`); a parenthesized constructor keeps its parens.
//
// Every edit sits at an offset the compile recorded: the NEW token's own
// span, the constructor's last real token, the construction node's end,
// or the dammit operator. No text is searched. A NEW token whose
// construction the tree does not show is refused, naming its position.
//
// A language-suite file (any file under a `test/rip/` directory, or every
// file with --rows) also has the Rip program inside each row's source
// string rewritten, in place and in its own quoting. A row source is the
// second argument of a `test`/`code`/`fail`/`type` call.
//
// A JavaScript or TypeScript file (`.js`, `.mjs`, `.cjs`, `.ts`, …) is a
// host: each string literal that holds a compiling Rip program with a
// `new` is rewritten the same way. A test's name and an assertion's
// expected text (`.toBe(…)`, `.toContain(…)`, …) are skipped. A literal
// that only parses as Rip by accident (prose, a JavaScript expectation
// elsewhere) is rewritten too, so review a host's diff before keeping it.
//
// The proof: every rewritten program — a whole file, or one row's source
// as the battery compiles it — is compiled before and after on the JS face
// and the TS face, and the outputs must be byte-identical (a program that
// rejects must reject with the same message). A program that fails the
// proof is reported and none of its edits are written. --check reports
// without writing anything. The exit code is 1 when anything was refused.
//
// Refused, each named by file and position, for a person to rewrite: an
// embedded program that does not compile on its own (its `new` has no
// span), a row source assembled from an expression (`header + '''…'''`),
// and an interpolated source or substituted template literal.
//
// The proof needs a compiler that still parses `new X`, so every compile
// here runs on the engine as of PINNED — the last revision with both
// spellings and with `.new` lowering a pure spine bare — extracted once
// from this script's own repository into the temp directory. The script
// therefore runs against files anywhere, from any revision that holds
// PINNED. At PINNED the two spellings type a component member differently
// on the TS face (`X.new()` reaches InstanceType only later), so such a
// member is refused rather than proven; convert it by hand.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const PINNED = '7d29b1967454b6ccb22b2ed74f95805721e8ef0b';

async function pinnedCompiler() {
  const dir = join(tmpdir(), `rip-codemod-new-${PINNED.slice(0, 12)}`);
  if (!existsSync(join(dir, 'src/compiler.js'))) {
    const staging = `${dir}.${process.pid}`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const repo = resolve(import.meta.dir, '..');
    const archive = Bun.spawnSync(['git', '-C', repo, 'archive', PINNED, 'src']);
    if (archive.exitCode !== 0) {
      throw new Error(`codemod-new: cannot read the pinned engine ${PINNED} from ${repo}: ${archive.stderr.toString().trim()}`);
    }
    const untar = Bun.spawnSync(['tar', '-x', '-C', staging], { stdin: archive.stdout });
    if (untar.exitCode !== 0) throw new Error(`codemod-new: cannot extract the pinned engine: ${untar.stderr.toString().trim()}`);
    if (!existsSync(dir)) renameSync(staging, dir);
    else rmSync(staging, { recursive: true, force: true });
  }
  return {
    ...await import(join(dir, 'src/compiler.js')),
    ...await import(join(dir, 'src/types.js')),
    ...await import(join(dir, 'src/implicit.js')),
    ...await import(join(dir, 'src/lexer.js')),
    ...await import(join(dir, 'src/parser.js')),
    ...await import(join(dir, 'src/stores.js')),
  };
}

const engine = await pinnedCompiler();
const { compile } = engine;

// A schema body is captured whole by the lexer, and each function body in
// it (a transform, a hook, a method) is parsed on its own when the schema
// emits; the module's tokens and stores never hold it. Each captured token
// list is a parse context of its own, sub-parsed here exactly as the
// engine's schemaSubParse does, so its constructions have spans too.
function capturedBodies(tokens) {
  const out = [];
  const isTokenList = (x) => Array.isArray(x) && x.length > 0 &&
    x.every((t) => t && typeof t === 'object' && typeof t.kind === 'string' && typeof t.start === 'number');
  const walk = (x, seen) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (isTokenList(x)) { out.push(x); return; }
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, seen);
  };
  for (const t of tokens) if (t.kind === 'SCHEMA_BODY') walk(t.value?.entries, new Set());
  return out;
}

function subParse(bodyTokens, source) {
  let toks = bodyTokens.map((t) => ({ ...t }));
  if (toks[0]?.kind === 'INDENT') {
    let d = 0;
    let lastOutdent = -1;
    for (let k = 0; k < toks.length; k++) {
      if (toks[k].kind === 'INDENT') d++;
      else if (toks[k].kind === 'OUTDENT' && --d === 0) { lastOutdent = k; break; }
    }
    if (lastOutdent === toks.length - 1) toks = toks.slice(1, -1);
  }
  let nextId = 1e9;
  const mintId = () => nextId++;
  const fail = (message, at) => { throw Object.assign(new Error(`schema: ${message}`), { start: at, end: at }); };
  engine.rewriteTypes(toks, mintId, source, fail);
  engine.implicitBlocks(toks, mintId);
  engine.tagPostfixConditionals(toks);
  engine.implicitObjects(toks, mintId);
  engine.implicitCalls(toks, mintId);
  const parser = engine.Parser();
  parser.lexer = {
    tokens: toks, index: 0, text: '', loc: null,
    setInput() { this.index = 0; },
    lex() {
      const t = this.tokens[this.index];
      if (!t) return null;
      this.index++;
      this.text = t.value;
      this.loc = { start: t.start, end: t.end };
      return t.kind;
    },
  };
  const result = parser.parse('');
  if (result.diagnostics.length > 0) throw new Error(`schema body does not parse: ${result.diagnostics[0].message}`);
  return { tokens: toks, stores: new engine.Stores(result.stores) };
}

function parseContexts(source, path) {
  const result = compile(source, { path, runtimeDelivery: 'none' });
  const contexts = [{ tokens: result.tokens, stores: result.stores }];
  // Captured bodies come from a fresh lex: emission sub-parses each body
  // and its passes retag the captured tokens in place.
  const pristine = engine.tokenize(source, path).tokens;
  for (let i = 0; i < contexts.length; i++) {
    for (const body of capturedBodies(i === 0 ? pristine : contexts[i].tokens)) {
      if (body.some((t) => t.kind === 'NEW' || t.kind === 'SCHEMA_BODY')) contexts.push(subParse(body, source));
    }
  }
  return contexts;
}

const VERBS = new Set(['test', 'code', 'fail', 'type']);

// The battery's dedent (test/support/battery.js): a row's source compiles
// with the common leading indentation of its non-blank lines removed.
function dedentOf(src) {
  const lines = src.split('\n');
  let common = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.match(/^[ \t]*/)[0].length;
    common = common === null ? indent : Math.min(common, indent);
    if (common === 0) break;
  }
  return common ?? 0;
}
const dedent = (src, common) => common ? src.split('\n').map((l) => l.slice(common)).join('\n') : src;

const lineCol = (source, offset) => {
  const before = source.slice(0, offset).split('\n');
  return `${before.length}:${before[before.length - 1].length + 1}`;
};

// One compile per face, as the consumer corpus compiles: delivery off. A
// rejection compares by its message with the position prefix removed —
// the rewrite moves columns, never meaning.
function outputsOf(source, path) {
  const out = {};
  for (const face of ['js', 'ts']) {
    try {
      out[face] = compile(source, { path, runtimeDelivery: 'none', face }).code;
    } catch (e) {
      out[face] = `ERR ${String(e?.message ?? e).split('\n')[0].replace(/^.*?:\d+:\d+: /, '')}`;
    }
  }
  return out;
}

// The construction edits for one program: [{ start, end, text, depth }].
// Throws (with every refusal) when a NEW token has no construction the
// tree can place.
export function constructionEdits(source, path) {
  const edits = [];
  const refusals = [];
  for (const context of parseContexts(source, path)) contextEdits(source, path, context, edits, refusals);
  if (refusals.length > 0) throw Object.assign(new Error(refusals.join('\n')), { refusals });
  return { edits, count: edits.length / 2 };
}

function contextEdits(source, path, { tokens, stores }, edits, refusals) {
  const real = tokens.filter((t) => !t.generated && typeof t.start === 'number');
  const parents = new Map();
  for (const n of stores.nodes) {
    for (const r of stores.rolesOf(n.nodeId) ?? []) if (r.childNodeId != null) parents.set(r.childNodeId, n.nodeId);
  }
  const depthOf = (id) => { let d = 0; for (let p = parents.get(id); p !== undefined; p = parents.get(p)) d++; return d; };
  const lastRealEndBefore = (offset) => {
    let end = null;
    for (const t of real) { if (t.end > offset) break; end = t.end; }
    return end;
  };
  const endsRealToken = (offset) => real.some((t) => t.end === offset);
  const child = (id, name) => {
    const r = stores.role(id, name);
    return r?.childNodeId == null ? null : stores.node(r.childNodeId);
  };

  real.forEach((t, i) => {
    if (t.kind !== 'NEW') return;
    const next = real[i + 1];
    const refuse = (why) => refusals.push(`${path}:${lineCol(source, t.start)}: ${why}`);
    if (!next) return refuse('`new` ends the program');
    const unary = stores.nodes.find((n) => n.semanticKind === 'unary' && n.sourceStart === t.start &&
      stores.role(n.nodeId, 'operator')?.sourceStart === t.start);
    const awaited = unary ? null : stores.nodes.find((n) => n.semanticKind === 'await' && n.sourceStart === t.start &&
      child(n.nodeId, 'value')?.semanticKind === 'unary');
    let insert;
    if (unary) {
      const operand = child(unary.nodeId, 'operand');
      // A call whose callee is itself `.new` (`new Outer.new(1)`) is a
      // construction value, so the outer `new` is a bare construction of
      // what it returns.
      const callee = operand?.semanticKind === 'call' ? child(operand.nodeId, 'callee') : null;
      const property = callee?.semanticKind === 'member' ? stores.role(callee.nodeId, 'property') : null;
      const rubyNew = property != null && stores.role(callee.nodeId, 'operator')?.literal === '.' &&
        source.slice(property.sourceStart, property.sourceEnd) === 'new';
      if (operand?.semanticKind === 'call' && !rubyNew && operand.sourceStart === next.start && operand.sourceEnd === unary.sourceEnd) {
        // `new X(a)` / `new X a`: `.new` lands after the constructor's
        // last real token, ahead of the argument list (an implicit list
        // opens at its first argument).
        const args = stores.role(operand.nodeId, 'args');
        const at = args ? lastRealEndBefore(args.sourceStart) : null;
        if (at === null || at <= t.end) return refuse('the construction\'s argument list has no constructor before it');
        insert = { start: at, text: '.new' };
      } else {
        // A bare construction: `.new()` after the whole constructor.
        if (!endsRealToken(unary.sourceEnd)) return refuse('the construction does not end on a token');
        insert = { start: unary.sourceEnd, text: '.new()' };
      }
      insert.depth = depthOf(unary.nodeId);
    } else if (awaited) {
      // The construction dammit: `.new` goes ahead of the `!`.
      const bang = stores.role(awaited.nodeId, 'operator');
      if (typeof bang?.sourceStart !== 'number' || source[bang.sourceStart] !== '!') return refuse('the construction dammit has no `!` on record');
      insert = { start: bang.sourceStart, text: '.new', depth: depthOf(awaited.nodeId) };
    } else {
      return refuse('no construction starts at this `new`');
    }
    edits.push({ start: t.start, end: next.start, text: '', depth: insert.depth });
    edits.push({ start: insert.start, end: insert.start, text: insert.text, depth: insert.depth });
  });
}

// Edits apply in offset order; insertions at one offset apply innermost
// first, so `new new X` reads `X.new().new()`.
export function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start) || b.depth - a.depth);
  let out = '';
  let at = 0;
  for (const e of sorted) {
    if (e.start < at) throw new Error(`overlapping edits at ${e.start}`);
    out += source.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + source.slice(at);
}

// Rewrite one program and prove it. Returns { output, count } or throws.
export function rewriteProgram(source, path) {
  const { edits, count } = constructionEdits(source, path);
  if (count === 0) return { output: source, count: 0, edits };
  const output = applyEdits(source, edits);
  const before = outputsOf(source, path);
  const after = outputsOf(output, path);
  for (const face of ['js', 'ts']) {
    if (before[face] !== after[face]) {
      throw new Error(`${path}: proof failed on the ${face} face — the rewritten program compiles differently\n` +
        `--- program ---\n${source}\n--- rewritten ---\n${output}\n--- before (${face}) ---\n${before[face]}\n--- after (${face}) ---\n${after[face]}`);
    }
  }
  const left = parseContexts(output, path).flatMap((c) => c.tokens).filter((t) => t.kind === 'NEW' && !t.generated).length;
  if (left !== 0) throw new Error(`${path}: ${left} \`new\` token(s) survive the rewrite`);
  return { output, count, edits };
}

// ── language-suite rows ─────────────────────────────────────────────

// The row-source string tokens of a suite file: the second argument of
// each verb call, when it is one plain string token (no interpolation).
function rowLiterals(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'IDENTIFIER' || !VERBS.has(t.value) || tokens[i + 1]?.kind !== 'CALL_START') continue;
    const prev = tokens[i - 1];
    if (prev && !['TERMINATOR', 'INDENT', 'OUTDENT'].includes(prev.kind)) continue;
    // Walk the first argument at depth 0 to its comma.
    let j = i + 2;
    let depth = 0;
    for (; j < tokens.length; j++) {
      const k = tokens[j].kind;
      if (depth === 0 && (k === ',' || k === 'CALL_END')) break;
      if (/_START$|^[([{]$|^INDENT$/.test(k)) depth++;
      else if (/_END$|^[)\]}]$|^OUTDENT$/.test(k)) depth--;
    }
    if (tokens[j]?.kind !== ',') continue;
    const src = tokens[j + 1];
    // The second argument's extent, to its depth-0 comma or the call's end.
    let k2 = j + 1;
    for (let d = 0; k2 < tokens.length; k2++) {
      const k = tokens[k2].kind;
      if (d === 0 && (k === ',' || k === 'CALL_END')) break;
      if (/_START$|^[([{]$|^INDENT$/.test(k)) d++;
      else if (/_END$|^[)\]}]$|^OUTDENT$/.test(k)) d--;
    }
    const pieces = tokens.slice(j + 1, k2);
    if (pieces.length > 1 && src?.kind !== 'STRING_START') {
      out.push({ verb: t.value, compound: true, strings: pieces.filter((p) => p.kind === 'STRING'), nameAt: t.start });
      continue;
    }
    if (src?.kind === 'STRING_START') {
      let k = j + 1;
      for (let d = 0; k < tokens.length; k++) {
        if (tokens[k].kind === 'STRING_START') d++;
        else if (tokens[k].kind === 'STRING_END' && --d === 0) break;
      }
      out.push({ verb: t.value, interpolated: true, start: src.start, end: tokens[k]?.end ?? src.end, nameAt: t.start });
    }
    else if (src?.kind === 'STRING') out.push({ verb: t.value, token: src, start: src.start, end: src.end, nameAt: t.start });
  }
  return out;
}

const OPENERS = ['"""', "'''", '"', "'"];

// Decode a string literal's raw text, recording for each decoded
// character the raw offsets it came from. The mapping is an alignment of
// the raw text against the compiler's own decoded value (`value`), so the
// language's heredoc rules are never re-implemented: escapes decode, and
// any raw character the value does not hold (heredoc indentation, the
// opening and closing newlines) is skipped. The caller re-decodes the
// edited literal and checks it, so a wrong alignment cannot be written.
function alignLiteral(raw, value) {
  const open = OPENERS.find((q) => raw.startsWith(q) && raw.endsWith(q) && raw.length >= 2 * q.length);
  if (!open) return null;
  const end = raw.length - open.length;
  const starts = [];
  const ends = [];
  let p = open.length;
  for (let i = 0; i < value.length; i++) {
    let matched = false;
    while (p < end) {
      if (raw[p] === '\\') {
        const decoded = decodeEscape(raw, p);
        if (decoded && decoded.text === value[i]) { starts.push(p); ends.push(decoded.next); p = decoded.next; matched = true; break; }
        if (decoded && decoded.text === '') { p = decoded.next; continue; }
        return null;
      }
      if (raw[p] === value[i]) { starts.push(p); ends.push(p + 1); p++; matched = true; break; }
      if (raw[p] !== ' ' && raw[p] !== '\t' && raw[p] !== '\n' && raw[p] !== '\r') return null;
      p++;
    }
    if (!matched) return null;
  }
  return { starts, ends, open };
}

function decodeEscape(raw, p) {
  const c = raw[p + 1];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  if (c in simple) return { text: simple[c], next: p + 2 };
  if (c === '\n') return { text: '', next: p + 2 };
  if (c === 'x') return { text: String.fromCharCode(parseInt(raw.slice(p + 2, p + 4), 16)), next: p + 4 };
  if (c === 'u' && raw[p + 2] === '{') {
    const close = raw.indexOf('}', p);
    return { text: String.fromCodePoint(parseInt(raw.slice(p + 3, close), 16)), next: close + 1 };
  }
  if (c === 'u') return { text: String.fromCharCode(parseInt(raw.slice(p + 2, p + 6), 16)), next: p + 6 };
  return c === undefined ? null : { text: c, next: p + 2 };
}

// A string token's decoded value: its token value is a JavaScript string
// literal (quoted or a backtick template with no substitutions).
const valueOf = (token) => new Function(`return ${token.value};`)();

function rewriteRows(source, path, report) {
  const result = compile(source, { path, runtimeDelivery: 'none' });
  const edits = [];
  let count = 0;
  for (const lit of rowLiterals(result.tokens)) {
    const where = `${path}:${lineCol(source, lit.nameAt)}`;
    if (lit.interpolated) {
      // An interpolated source is assembled at run time; the codemod
      // cannot see the program. Refuse when the raw text spells `new`
      // at all, so a person reviews that row.
      if (/(^|[^\w$.@])new\b(?!\s*:)/.test(source.slice(lit.start, lit.end))) {
        report.refused.push(`${where}: the row source is interpolated, so its program is assembled at run time — rewrite it by hand`);
      }
      continue;
    }
    if (lit.compound) {
      // A source assembled from an expression (`header + '''…'''`) is a
      // program no single literal holds. Refuse when any literal piece
      // spells a construction, so a person rewrites that row.
      if (lit.strings.some((s) => hasNewToken(dedent(valueOf(s), dedentOf(valueOf(s)))))) {
        report.refused.push(`${where}: the row source is assembled from an expression, so no single literal holds its program — rewrite it by hand`);
      }
      continue;
    }
    const result = rewriteLiteral({
      raw: source.slice(lit.start, lit.end), value: valueOf(lit.token), start: lit.start, where,
      dedented: true, decode: (raw) => valueOf(compile(`x = ${raw}`, { runtimeDelivery: 'none' }).tokens.find((t) => t.kind === 'STRING')),
    }, report);
    if (result) { edits.push(...result.edits); count += result.count; report.rows++; }
  }
  return { edits, count };
}

// Rewrite the Rip program one string literal holds, in place. `value` is
// the literal's decoded text; the program is that text, dedented first
// when `dedented` (a language-suite row). `decode` re-reads an edited raw
// literal, so the written bytes are checked to decode to exactly the
// proven program. Returns { edits, count } in file offsets, or null.
function rewriteLiteral({ raw, value, start, where, dedented, decode }, report) {
  const common = dedented ? dedentOf(value) : 0;
  const program = dedent(value, common);
  let rewritten;
  try {
    rewritten = rewriteProgram(program, `${where} (embedded program)`);
  } catch (e) {
    // A program that does not compile carries no spans; if it holds a
    // NEW token it needs a person.
    if (e.refusals || /proof failed|survive/.test(e.message)) { report.refused.push(e.message); return null; }
    if (hasNewToken(program)) report.refused.push(`${where}: the embedded program does not compile, so its \`new\` has no span — ${String(e.message).split('\n')[0]}`);
    return null;
  }
  if (rewritten.count === 0) return null;
  // Map each program edit back through the dedent and the literal.
  const align = alignLiteral(raw, value);
  if (!align) { report.refused.push(`${where}: the literal could not be aligned with its value`); return null; }
  const lineStarts = [0];
  for (let i = 0; i < value.length; i++) if (value[i] === '\n') lineStarts.push(i + 1);
  const programLineStarts = [0];
  for (let i = 0; i < program.length; i++) if (program[i] === '\n') programLineStarts.push(i + 1);
  const toValue = (offset) => {
    let line = 0;
    while (line + 1 < programLineStarts.length && programLineStarts[line + 1] <= offset) line++;
    return lineStarts[line] + common + (offset - programLineStarts[line]);
  };
  const edits = [];
  for (const e of rewritten.edits) {
    // A deletion starts and ends on real characters (`n` of `new`, the
    // next token's first character); an insertion lands right after the
    // real character before it.
    if (e.start === e.end) {
      const v = toValue(e.start) - 1;
      if (v < 0 || v >= align.ends.length) { report.refused.push(`${where}: an edit falls outside the literal`); return null; }
      edits.push({ ...e, start: start + align.ends[v], end: start + align.ends[v] });
    } else {
      const a = toValue(e.start);
      const b = toValue(e.end);
      if (b >= align.starts.length) { report.refused.push(`${where}: an edit falls outside the literal`); return null; }
      edits.push({ ...e, start: start + align.starts[a], end: start + align.starts[b] });
    }
  }
  const newRaw = applyEdits(raw, edits.map((e) => ({ ...e, start: e.start - start, end: e.end - start })));
  let check;
  try {
    const decoded = decode(newRaw);
    check = dedent(decoded, dedented ? dedentOf(decoded) : 0);
  } catch {
    check = null;
  }
  if (check !== rewritten.output) { report.refused.push(`${where}: the edited literal does not decode to the proven program`); return null; }
  return { edits, count: rewritten.count };
}

// ── programs embedded in JavaScript ─────────────────────────────────

// The string literals of a JavaScript (or TypeScript) file: quoted
// strings and substitution-free template literals, with their raw spans.
// A template with substitutions is assembled at run time; one whose
// static text spells `new` is reported for a person. Comments are
// skipped; a regex literal is not recognized, so a quote inside one can
// misalign the scan, which the per-literal proof and decode check catch.
function jsLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const close = text.indexOf('*/', i + 2); i = close < 0 ? text.length : close + 2; continue; }
    if (c === "'" || c === '"') {
      const st = i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') { if (text[i] === '\\') i++; i++; }
      i++;
      out.push({ start: st, end: i });
      continue;
    }
    if (c === '`') {
      const st = i++;
      let substituted = false;
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '$' && text[i + 1] === '{') {
          substituted = true;
          let d = 1;
          i += 2;
          while (i < text.length && d) { if (text[i] === '{') d++; else if (text[i] === '}') d--; i++; }
          continue;
        }
        i++;
      }
      i++;
      out.push({ start: st, end: i, substituted });
      continue;
    }
    i++;
  }
  return out;
}

const jsValueOf = (raw) => new Function(`return ${raw};`)();
const NOT_A_PROGRAM = /(?:\b(?:test|it|describe)(?:\.\w+)*\(|\.(?:toBe|toContain|toEqual|toStrictEqual|toMatch|toThrow)\()\s*$/;

function rewriteJsHost(source, path, report) {
  const edits = [];
  let count = 0;
  for (const lit of jsLiterals(source)) {
    const raw = source.slice(lit.start, lit.end);
    const where = `${path}:${lineCol(source, lit.start)}`;
    if (lit.substituted) {
      if (hasNewToken(raw.slice(1, -1).replace(/\$\{[^}]*\}/g, '0'))) {
        report.refused.push(`${where}: a template literal with substitutions is assembled at run time — rewrite it by hand if it is Rip`);
      }
      continue;
    }
    // A test's name and an assertion's expected text are not programs,
    // however much prose or JavaScript happens to parse as Rip.
    if (NOT_A_PROGRAM.test(source.slice(Math.max(0, lit.start - 40), lit.start))) continue;
    let value;
    try { value = jsValueOf(raw); } catch { continue; }
    if (typeof value !== 'string' || !hasNewToken(value)) continue;
    const result = rewriteLiteral({ raw, value, start: lit.start, where, dedented: false, decode: jsValueOf }, report);
    if (result) { edits.push(...result.edits); count += result.count; report.rows++; }
  }
  return { edits, count };
}

function hasNewToken(program) {
  // The lexer alone: a program that does not parse still tokenizes. One
  // that does not even tokenize is judged by its text, conservatively.
  try {
    const { tokens } = engine.tokenize(program);
    return [tokens, ...capturedBodies(tokens)].some((list) => list.some((t) => t.kind === 'NEW' && !t.generated));
  } catch {
    return /(^|[^\w$.])new\s/.test(program);
  }
}

// ── driver ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const rowsAll = args.includes('--rows');
  const files = args.filter((a) => !a.startsWith('--')).map((f) => resolve(f));
  if (files.length === 0) {
    console.error('usage: bun scripts/codemod-new.mjs [--check] [--rows] <files…>');
    process.exit(2);
  }
  let refusedAny = false;
  let total = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const report = { refused: [], rows: 0 };
    let edits = [];
    let count = 0;
    if (/\.(?:[cm]?js|[cm]?ts)$/.test(file)) {
      const host = rewriteJsHost(source, file, report);
      edits.push(...host.edits);
      count += host.count;
    } else {
      try {
        const own = rewriteProgram(source, file);
        edits.push(...own.edits);
        count += own.count;
      } catch (e) {
        report.refused.push(e.message);
      }
    }
    if (rowsAll || file.includes(`${sep}test${sep}rip${sep}`)) {
      try {
        const rows = rewriteRows(source, file, report);
        edits.push(...rows.edits);
        count += rows.count;
      } catch (e) {
        report.refused.push(e.message);
      }
    }
    for (const r of report.refused) console.error(`REFUSED ${r}`);
    refusedAny ||= report.refused.length > 0;
    if (count === 0) continue;
    total += count;
    console.log(`${check ? 'would rewrite' : 'rewrote'} ${count} construction(s)${report.rows ? ` in ${report.rows} embedded program(s)` : ''}: ${file}`);
    if (!check) writeFileSync(file, applyEdits(source, edits));
  }
  console.log(`${total} construction(s) ${check ? 'to rewrite' : 'rewritten'}${refusedAny ? '; some programs were refused' : ''}`);
  process.exit(refusedAny ? 1 : 0);
}
