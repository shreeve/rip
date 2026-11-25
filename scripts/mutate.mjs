#!/usr/bin/env bun
// Mutation audit — CLEANROOM's precondition. A surviving mutant is engine
// behavior no test constrains, so a rewrite could change it silently.
//
//   bun scripts/mutate.mjs gen  --lcov <lcov.info> --out <mutants.json> <src files…>
//   bun scripts/mutate.mjs gen-table --out <mutants.json>
//   bun scripts/mutate.mjs run  --in <mutants.json> --out <results.jsonl>
//                               [--stage 1|2|3] [--workers N] [--only <ids file>]
//                               [--workdir <dir>] [--cap [--mem SIZE]]
//   bun scripts/mutate.mjs report --in <mutants.json> --results <r1.jsonl,r2.jsonl>
//                               [--out <survivor ids>] [--killed <killed ids>]
//                               [--md <report.md>]
//   bun scripts/mutate.mjs try    --in <mutants.json> --ids <id,…|ids file> -- <command…>
//   bun scripts/mutate.mjs observe --in <mutants.json> --ids <ids file> --out <observe.jsonl>
//                               [--workers N] [--workdir <dir>] [--cap [--mem SIZE]]
//
// `gen` mutates only lines the lcov file marks executed: an unexecuted
// line survives every mutant by construction, and the coverage report
// already names it. Mutants are token-level, so the tokenizer below needs
// only to find token boundaries, not to parse; every mutant is
// syntax-checked by Bun's transpiler, and one that fails is dropped
// rather than counted as killed.
//
// `run` executes each mutant in a private APFS clone of this checkout
// (one per worker), so mutants never touch the working tree. Stage 1 is
// the language suite plus the corpus byte gate (about 1.4 s, --bail);
// stage 2 is the in-process fast loop minus the package style gate, which
// judges authored packages rather than the engine, run only on stage-1
// survivors; stage 3 reruns the killed mutants against behavior rows
// alone, to find engine behavior held only by emitted-byte pins.
// Results append as
// JSONL, so an interrupted run resumes where it stopped.

import { spawn } from 'bun';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync } from 'fs';
import { join, resolve, relative } from 'path';
import { tmpdir } from 'os';

const ROOT = resolve(import.meta.dir, '..');

// ── tokenizer ────────────────────────────────────────────────────────────
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '**', '<<', '>>'];
// After these, a `/` divides; after anything else it opens a regex.
const VALUE_END = new Set([')', ']', '}']);
const VALUE_WORDS = new Set(['this', 'super', 'null', 'true', 'false', 'undefined']);
const KEYWORDS_BEFORE_EXPR = new Set(['return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'else', 'do', 'yield', 'await']);
const NUM = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/;
const IDENT = /^#?[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/;

export function tokenize(src) {
  const out = [];
  const braces = []; // template nesting: brace depth at each `${`
  let depth = 0, i = 0;
  const prevSig = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prevSig();
    if (!p) return true;
    // A template piece that opens a substitution (`${`) starts an expression.
    if (p.kind === 'tmpl') return p.text.endsWith('${');
    if (p.kind === 'num' || p.kind === 'str' || p.kind === 'regex') return false;
    if (p.kind === 'ident') return KEYWORDS_BEFORE_EXPR.has(p.text);
    return !VALUE_END.has(p.text);
  };
  const readTemplate = (start) => {
    // i is just past the opening ` or the closing } of a substitution
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; out.push({ kind: 'tmpl', start, end: i, text: src.slice(start, i) }); return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; out.push({ kind: 'tmpl', start, end: i, text: src.slice(start, i) }); braces.push(depth); return; }
      i++;
    }
    throw new Error(`unterminated template at ${start}`);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    const start = i;
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++;
      out.push({ kind: 'str', start, end: i, text: src.slice(start, i) });
      continue;
    }
    if (c === '`') { i++; readTemplate(start); continue; }
    if (c === '}' && braces.length && braces[braces.length - 1] === depth) { braces.pop(); i++; readTemplate(start); continue; }
    if (c === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        else if (d === '\n') throw new Error(`unterminated regex at ${start}`);
        i++;
      }
      i++;
      while (/[a-z]/.test(src[i] ?? '')) i++;
      out.push({ kind: 'regex', start, end: i, text: src.slice(start, i) });
      continue;
    }
    let m;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      m = NUM.exec(src.slice(i, i + 64));
      i += m[0].length;
      out.push({ kind: 'num', start, end: i, text: m[0] });
      continue;
    }
    if ((m = IDENT.exec(src.slice(i, i + 256)))) {
      i += m[0].length;
      out.push({ kind: 'ident', start, end: i, text: m[0] });
      continue;
    }
    const p = PUNCT.find((q) => src.startsWith(q, i)) ?? c;
    i += p.length;
    if (p === '{') depth++;
    else if (p === '}') depth--;
    out.push({ kind: 'punct', start, end: i, text: p });
  }
  return out;
}

// ── mutants ──────────────────────────────────────────────────────────────
const SWAP = {
  '===': '!==', '!==': '===', '==': '!=', '!=': '==',
  '<': '<=', '<=': '<', '>': '>=', '>=': '>',
  '&&': '||', '||': '&&', '??': '&&',
  '++': '--', '--': '++',
};
const isValueToken = (t) => t && (t.kind === 'num' || t.kind === 'str' || t.kind === 'tmpl' || t.kind === 'regex'
  || (t.kind === 'ident' && !KEYWORDS_BEFORE_EXPR.has(t.text)) || VALUE_END.has(t.text));

function matchParen(toks, open) {
  let d = 0;
  for (let j = open; j < toks.length; j++) {
    if (toks[j].text === '(') d++;
    else if (toks[j].text === ')' && --d === 0) return j;
  }
  return -1;
}

function mutantsFor(src, covered) {
  const toks = tokenize(src);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (off) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const out = [];
  const srcLines = src.split('\n');
  const add = (op, start, end, to) => {
    const line = lineOf(start);
    if (covered && !covered.has(line)) return;
    // The scaling gates' operation counter observes the engine and steers
    // nothing; its mutants are equivalent by design.
    if (/\bcounter\.(on|n)\b/.test(srcLines[line - 1])) return;
    out.push({ op, line, start, end, from: src.slice(start, end), to });
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], prev = toks[k - 1], next = toks[k + 1];
    if (t.kind === 'punct') {
      if (SWAP[t.text]) {
        // `<`/`>` only as comparisons; `++`/`--` either side of an operand.
        add(t.text === '&&' || t.text === '||' || t.text === '??' ? 'logic' : t.text.length === 2 && t.text[0] === t.text[1] && (t.text === '++' || t.text === '--') ? 'update' : 'relation', t.start, t.end, SWAP[t.text]);
      } else if (t.text === '!' ) {
        add('negation', t.start, t.end, '');
      } else if ((t.text === '+' || t.text === '-') && isValueToken(prev)) {
        add('arith', t.start, t.end, t.text === '+' ? '-' : '+');
      }
    } else if (t.kind === 'ident') {
      if (t.text === 'true' || t.text === 'false') add('boolean', t.start, t.end, t.text === 'true' ? 'false' : 'true');
      else if ((t.text === 'if' || t.text === 'while') && next?.text === '(') {
        const close = matchParen(toks, k + 1);
        if (close > 0) {
          const inner = src.slice(toks[k + 1].end, toks[close].start);
          add('branch', toks[k + 1].start, toks[close].end, `(!(${inner}))`);
        }
      } else if ((t.text === 'continue' || t.text === 'break') && next?.text === ';') {
        add('statement', t.start, next.end, '');
      }
    } else if (t.kind === 'num' && /^\d+$/.test(t.text) && prev?.text !== '[' ) {
      const n = Number(t.text);
      add('number', t.start, t.end, String(n === 1 ? 0 : n + 1));
    }
  }
  // Expression-statement deletion: a whole line that is one call or
  // assignment statement. Declarations are skipped — deleting one only
  // proves a ReferenceError is noticed.
  const lines = src.split('\n');
  for (let l = 0; l < lines.length; l++) {
    const s = lines[l], tr = s.trim();
    if (!tr.endsWith(';') || /[{}]/.test(tr) || /^(const|let|var|return|throw|import|export|case|default|break|continue)\b/.test(tr) || tr.startsWith('//')) continue;
    if (!/^[A-Za-z_$@(.\[]/.test(tr) && !/^(\+\+|--)/.test(tr)) continue;
    const start = lineStarts[l] + s.indexOf(tr);
    add('statement', start, start + tr.length, '');
  }
  return out;
}

function coverageFrom(lcovPath) {
  const map = new Map();
  for (const rec of readFileSync(lcovPath, 'utf8').split('end_of_record')) {
    const sf = /SF:(.*)/.exec(rec)?.[1];
    if (!sf) continue;
    const hit = new Set();
    for (const m of rec.matchAll(/DA:(\d+),(\d+)/g)) if (+m[2] > 0) hit.add(+m[1]);
    map.set(relative(ROOT, resolve(sf)), hit);
    map.set(sf.replace(/^.*?\/(src\/)/, '$1'), hit);
  }
  return map;
}

function gen(args) {
  const cov = args.lcov ? coverageFrom(args.lcov) : null;
  const transpiler = new Bun.Transpiler({ loader: 'js' });
  const all = [];
  let dropped = 0;
  for (const file of args._) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const covered = cov ? cov.get(file) ?? new Set() : null;
    for (const m of mutantsFor(src, covered)) {
      const code = src.slice(0, m.start) + m.to + src.slice(m.end);
      try { transpiler.transformSync(code); } catch { dropped++; continue; }
      all.push({ id: `${file}:${m.line}:${m.start}:${m.op}`, file, ...m });
    }
  }
  writeFileSync(args.out, JSON.stringify(all));
  const byOp = {};
  for (const m of all) byOp[m.op] = (byOp[m.op] ?? 0) + 1;
  console.log(`${all.length} mutants (${dropped} dropped as invalid syntax)`, byOp);
}

// ── parser-table mutants ────────────────────────────────────────────────
// One mutant inverts one precedence decision — a rule against one
// lookahead token, in every state where they meet — and regenerates the
// table. Defaults (no operator on either side) are the manifest's
// business and stay put; only declared precedence is mutated.
let solar = null;
async function loadSolar() {
  if (solar) return solar;
  const { Generator } = await import(join(ROOT, 'src/grammar/solar.rip'));
  const grammar = (await import(join(ROOT, 'src/grammar/grammar.rip'))).default;
  return (solar = { Generator, grammar });
}

function generateTable({ Generator, grammar }, flip, seen) {
  const orig = Generator.prototype._resolveConflict;
  Generator.prototype._resolveConflict = function (rule, op, reduce, shift) {
    const sol = orig.call(this, rule, op, reduce, shift);
    if (!op || sol.bydefault) return sol;
    this._opSym ??= new Map(Object.entries(this.operators).map(([k, v]) => [v, k]));
    const sym = this._opSym.get(op);
    const action = sol.action === 0 ? 'nonassoc' : sol.action === shift ? 'shift' : 'reduce';
    if (seen) seen.set(`${rule.id}\t${sym}`, { rule: rule.id, sym, action, ruleText: `${rule.lhs} → ${rule.symbols.join(' ')}` });
    if (flip && flip.rule === rule.id && flip.sym === sym) sol.action = flip.to === 'shift' ? shift : flip.to === 'reduce' ? reduce : 0;
    return sol;
  };
  try {
    return new Generator(grammar, {}).generate();
  } finally {
    Generator.prototype._resolveConflict = orig;
  }
}

async function genTable(args) {
  const s = await loadSolar();
  const seen = new Map();
  const code = generateTable(s, null, seen);
  const committed = readFileSync(join(ROOT, 'src/parser.js'), 'utf8');
  if (code !== committed) throw new Error('an unmutated regeneration differs from src/parser.js — regenerate first');
  const all = [];
  for (const d of seen.values()) {
    for (const to of ['shift', 'reduce', 'nonassoc']) {
      if (to === d.action || (to === 'nonassoc' && d.action !== 'nonassoc')) continue;
      all.push({ id: `table:${d.rule}:${d.sym}:${to}`, file: 'src/parser.js', op: 'table', rule: d.rule, sym: d.sym, from: d.action, to, ruleText: d.ruleText });
    }
  }
  writeFileSync(args.out, JSON.stringify(all));
  console.log(`${all.length} table mutants over ${seen.size} precedence decisions`);
}

// ── runner ───────────────────────────────────────────────────────────────
const STAGES = {
  1: ['test', '--isolate', '--bail', '--timeout', '15000', 'test/rip.test.js', 'test/toolchain/corpus-expected.test.js'],
  // Serial with --bail, cheapest killers first: several mutants in
  // parallel use the machine better than one mutant with --parallel.
  // --isolate gives each file the fresh global `bun run test` gives it
  // (--parallel implies it): files that share one global see each
  // other's once-per-runtime state, and then file order decides verdicts.
  // A table mutant IS a parser.js that differs from what the grammar
  // generates, so the regeneration gate would kill every one of them
  // without consulting behavior.
  2: (m) => ['test', '--isolate', '--bail', '--timeout', '30000', 'test/rip.test.js', 'test/toolchain/corpus-expected.test.js', 'test/mapping', 'test/lang', 'test/ui', 'test/schema',
    ...readdirSync(join(ROOT, 'test/toolchain')).filter((f) => f.endsWith('.test.js') && f !== 'package-rip-style.test.js' && f !== 'corpus-expected.test.js' && !(m.op === 'table' && f === 'generated.test.js')).map((f) => `test/toolchain/${f}`)],
  // The language suite's `test` and `fail` rows alone: values and
  // positioned rejections, no emitted-byte comparison. Run on mutants
  // stages 1–2 killed; one that survives here is held only by byte pins,
  // which the rebuild may renegotiate. Mixed suites (ui, schema, lang,
  // mapping) assert bytes beside behavior, so they stay out rather than
  // vouch for behavior they may only be spelling.
  3: ['test', '--isolate', '--bail', '--timeout', '15000', 'test/rip.test.js', '-t', '^rip: \\S+ (test|fail) '],
};

// With --cap, `cpuq cap` holds each test process to a memory and time
// limit in a cgroup of its own, so a mutant that allocates without bound
// dies alone instead of pressing on every process sharing the machine.
// The suite peaks near 1.2 GB unmutated; the default cap leaves room above
// that, and --mem trades headroom for more workers in the same memory.
const MEM_CAP = '3G';
const CAP_MEMORY = 122, CAP_TIME = 124;

async function runOne(dir, stage, timeoutMs, m, cap, mem = MEM_CAP) {
  const argv = typeof STAGES[stage] === 'function' ? STAGES[stage](m) : STAGES[stage];
  const cmd = cap ? ['cpuq', 'cap', '--mem', mem, '--time', `${timeoutMs / 1000}s`, '--', 'bun', ...argv] : ['bun', ...argv];
  const proc = spawn(cmd, { cwd: dir, env: { ...process.env, RIP_NO_CACHE: '1', FORCE_COLOR: '0' }, stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  // Under a cap this is only a backstop: cpuq stops the whole cgroup first,
  // where a kill here would reach the wrapper and not its test process.
  const timer = setTimeout(() => { timedOut = true; proc.kill(9); }, cap ? timeoutMs + 30_000 : timeoutMs);
  const [, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  if (timedOut) return { verdict: 'killed', by: 'timeout' };
  if (cap && code === CAP_MEMORY) return { verdict: 'killed', by: 'memory cap' };
  if (cap && code === CAP_TIME) return { verdict: 'killed', by: 'timeout' };
  if (code === 0) return { verdict: 'survived' };
  const failName = /\(fail\) (.*?)(?: \[[\d.]+ms\])?$/m.exec(err)?.[1] ?? /error: (.*)$/m.exec(err)?.[1] ?? `exit ${code}`;
  return { verdict: 'killed', by: failName.slice(0, 160) };
}

async function run(args) {
  const mutants = JSON.parse(readFileSync(args.in, 'utf8'));
  const stage = Number(args.stage ?? 1);
  const workers = Number(args.workers ?? 6);
  const done = new Set();
  if (existsSync(args.out)) for (const l of readFileSync(args.out, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).id);
  let only = null;
  if (args.only) only = new Set(readFileSync(args.only, 'utf8').split('\n').filter(Boolean));
  const queue = mutants.filter((m) => !done.has(m.id) && (!only || only.has(m.id)));
  console.log(`stage ${stage}: ${queue.length} to run (${done.size} already recorded), ${workers} workers`);
  const base = join(args.workdir ?? join(tmpdir(), 'rip-mutate'), `s${stage}`);
  mkdirSync(base, { recursive: true });
  const dirs = [];
  for (let w = 0; w < workers; w++) {
    const d = join(base, `w${w}`);
    // .git stays: repository gates list files with `git ls-files`, and a
    // copy without an index fails them for every mutant alike.
    if (!existsSync(d)) cpSync(ROOT, d, { recursive: true, filter: (p) => !p.includes('/.rip/') });
    dirs.push(d);
  }
  // A run killed mid-mutant leaves that mutant in its worker's copy;
  // every file this list can mutate starts pristine in every copy.
  const pristine = new Map();
  for (const f of new Set(mutants.map((m) => m.file))) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    pristine.set(f, src);
    for (const d of dirs) writeFileSync(join(d, f), src);
  }
  const timeoutMs = stage === 2 ? 180_000 : 60_000;
  let n = 0, killed = 0;
  const started = Date.now();
  const worker = async (dir) => {
    while (queue.length) {
      const m = queue.shift();
      const src = pristine.get(m.file) ?? readFileSync(join(ROOT, m.file), 'utf8');
      pristine.set(m.file, src);
      const target = join(dir, m.file);
      let mutated;
      if (m.op === 'table') {
        try { mutated = generateTable(await loadSolar(), m); } catch (e) {
          appendFileSync(args.out, JSON.stringify({ id: m.id, stage, verdict: 'invalid', by: String(e.message).split('\n')[0].slice(0, 160) }) + '\n');
          continue;
        }
        if (mutated === src) {
          appendFileSync(args.out, JSON.stringify({ id: m.id, stage, verdict: 'equivalent', by: 'identical table' }) + '\n');
          continue;
        }
      } else if (src.slice(m.start, m.end) !== m.from) {
        // The file moved under the mutant since it was generated: its
        // offset no longer holds the token it names.
        appendFileSync(args.out, JSON.stringify({ id: m.id, stage, verdict: 'moved' }) + '\n');
        continue;
      } else mutated = src.slice(0, m.start) + m.to + src.slice(m.end);
      writeFileSync(target, mutated);
      let r;
      try { r = await runOne(dir, stage, timeoutMs, m, Boolean(args.cap), args.mem ?? MEM_CAP); } finally { writeFileSync(target, src); }
      appendFileSync(args.out, JSON.stringify({ id: m.id, stage, ...r }) + '\n');
      n++; if (r.verdict === 'killed') killed++;
      if (n % 50 === 0) {
        const rate = n / ((Date.now() - started) / 1000);
        console.log(`  ${n} run, ${killed} killed, ${n - killed} survived — ${rate.toFixed(1)}/s, ~${Math.round(queue.length / rate / 60)} min left`);
      }
    }
  };
  await Promise.all(dirs.map(worker));
  console.log(`stage ${stage} done: ${n} run, ${killed} killed, ${n - killed} survived`);
  if (args.clean) rmSync(base, { recursive: true, force: true });
}

// The enclosing function of each line: declaration-shaped lines open a
// candidate, and the tokenizer's brace matching gives each candidate its
// exact body, so a line belongs to the innermost body that contains it —
// not to whichever declaration happened to precede it. A report label,
// not an analysis: the shapes below are the ones this engine uses.
const DECL = /^\s*(?:export\s+)?(?:async\s+)?function\*?\s+([\w$]+)|^\s*(?:static\s+|async\s+|get\s+|set\s+)*\*?(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$|^\s*(?:export\s+)?(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[\w$]+\s*=>)/;
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'with', 'function']);
const fnCache = new Map();
function functionsOf(file) {
  if (fnCache.has(file)) return fnCache.get(file);
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split('\n');
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
  const toks = tokenize(src);
  const close = new Map(); // index of '{' -> line of its matching '}'
  const lastOpenOnLine = new Map();
  const stack = [];
  toks.forEach((t, i) => {
    if (t.kind !== 'punct') return;
    if (t.text === '{') { stack.push(i); lastOpenOnLine.set(lineOf(t.start), i); }
    else if (t.text === '}' && stack.length) close.set(stack.pop(), lineOf(t.start));
  });
  const ranges = [];
  lines.forEach((l, i) => {
    const m = DECL.exec(l); const nm = m && (m[1] ?? m[2] ?? m[3]);
    if (!nm || NOT_NAMES.has(nm)) return;
    const open = lastOpenOnLine.get(i + 1);
    ranges.push({ name: nm, from: i + 1, to: open !== undefined && close.has(open) ? close.get(open) : i + 1 });
  });
  const at = [null];
  for (let ln = 1; ln <= lines.length; ln++) {
    let best = null;
    for (const r of ranges) if (r.from <= ln && ln <= r.to && (!best || r.to - r.from < best.to - best.from)) best = r;
    at.push(best ? best.name : '<top>');
  }
  const r = { at, lines };
  fnCache.set(file, r);
  return r;
}

// Stage 3 answers a different question (is a kill backed by behavior?),
// so it never overrides a stage 1–2 verdict; `byteOnly` collects its
// survivors.
function finalVerdicts(paths, byteOnly = new Set()) {
  const final = new Map();
  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, 'utf8').split('\n')) {
      if (!l) continue;
      const r = JSON.parse(l);
      if (r.stage === 3) { if (r.verdict === 'survived') byteOnly.add(r.id); continue; }
      const prior = final.get(r.id);
      if (!prior || r.stage >= prior.stage) final.set(r.id, r);
    }
  }
  return final;
}

function report(args) {
  const mutants = new Map(JSON.parse(readFileSync(args.in, 'utf8')).map((m) => [m.id, m]));
  const byteOnlyIds = new Set();
  const final = finalVerdicts(String(args.results).split(','), byteOnlyIds);
  const survivors = [...final.values()].filter((r) => r.verdict === 'survived').map((r) => mutants.get(r.id)).filter(Boolean);
  if (args.out) writeFileSync(args.out, survivors.map((m) => m.id).join('\n') + '\n');
  if (args.killed) writeFileSync(args.killed, [...final.values()].filter((r) => r.verdict === 'killed').map((r) => r.id).join('\n') + '\n');
  if (!args.md) return;
  const byteOnly = [...byteOnlyIds].filter((id) => final.get(id)?.verdict === 'killed').map((id) => mutants.get(id)).filter(Boolean);
  const tally = {};
  for (const r of final.values()) {
    const m = mutants.get(r.id); if (!m) continue;
    const t = (tally[m.file] ??= { run: 0, killed: 0, survived: 0, other: 0 });
    t.run++; t[r.verdict === 'killed' || r.verdict === 'survived' ? r.verdict : 'other']++;
  }
  let md = `| file | run | killed | survived | invalid/equivalent | survival % |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const [f, t] of Object.entries(tally)) md += `| ${f} | ${t.run} | ${t.killed} | ${t.survived} | ${t.other} | ${(100 * t.survived / Math.max(1, t.killed + t.survived)).toFixed(1)} |\n`;
  md += section(`Survivors by function`, survivors);
  if (byteOnlyIds.size) md += section(`Held only by byte pins, by function`, byteOnly);
  writeFileSync(args.md, md);
  console.log(`${survivors.length} survivors, ${byteOnly.length} held only by byte pins → ${args.md}`);
}

function section(title, list) {
  let md = '';
  const groups = new Map();
  for (const m of list) {
    const key = m.op === 'table' ? `parser table — ${m.ruleText}` : `${m.file} — ${functionsOf(m.file).at[m.line]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  md += `\n## ${title} (${list.length} in ${groups.size} groups, largest first)\n`;
  for (const [key, ms] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    md += `\n### ${key} — ${ms.length}\n\n`;
    for (const m of ms.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      if (m.op === 'table') { md += `- \`${m.sym}\`: ${m.from} → ${m.to}\n`; continue; }
      const text = functionsOf(m.file).lines[m.line - 1].trim().slice(0, 110);
      md += `- ${m.file}:${m.line} [${m.op}] \`${JSON.stringify(m.from).slice(1, -1).slice(0, 50)}\` → \`${JSON.stringify(m.to).slice(1, -1).slice(0, 50)}\` — \`${text}\`\n`;
    }
  }
  return md;
}

// Applies each named mutant to THIS checkout in turn, runs the given
// command, and restores the file: the triage loop's proof that a new test
// kills the mutant it was written for. A mutant whose `from` text no longer
// stands at its offset is refused, since the file has moved under it.
async function tryMutants(args, cmd) {
  const mutants = new Map(JSON.parse(readFileSync(args.in, 'utf8')).map((m) => [m.id, m]));
  const ids = existsSync(String(args.ids)) ? readFileSync(args.ids, 'utf8').split('\n').filter(Boolean) : String(args.ids).split(',');
  if (!cmd.length) { console.error('try: give the command after --'); process.exit(2); }
  let survived = 0;
  for (const id of ids) {
    const m = mutants.get(id);
    if (!m) { console.log(`unknown  ${id}`); continue; }
    if (m.op === 'table') { console.log(`skipped  ${id} (table mutants regenerate the parser; use run)`); continue; }
    const target = join(ROOT, m.file);
    const src = readFileSync(target, 'utf8');
    if (src.slice(m.start, m.end) !== m.from) { console.log(`moved    ${id}`); continue; }
    writeFileSync(target, src.slice(0, m.start) + m.to + src.slice(m.end));
    let code;
    try {
      const proc = spawn(cmd, { cwd: ROOT, env: { ...process.env, RIP_NO_CACHE: '1', FORCE_COLOR: '0' }, stdout: 'ignore', stderr: 'ignore' });
      code = await proc.exited;
    } finally { writeFileSync(target, src); }
    if (code === 0) survived++;
    console.log(`${code === 0 ? 'SURVIVED' : 'killed  '} ${id}`);
  }
  if (survived) process.exitCode = 1;
}

// ── corpus observation ──────────────────────────────────────────────
// A survivor's other question: can any program the repository holds tell
// the mutant apart? The child mode compiles every corpus input with the
// checkout it runs in — each tracked package module and each language-
// suite row's source, on the JS face and the TS face — and prints one
// hash per input; `observe` runs it once pristine, then once per mutant in
// a private copy, and records the inputs whose output moved.
async function corpusHashes() {
  const { compile } = await import(join(ROOT, 'src/compiler.js'));
  const { loadBattery } = await import(join(ROOT, 'test/support/battery.js'));
  const { ripFiles } = await import(join(ROOT, 'test/support/rip-files.js'));
  const proc = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'packages/*.rip', 'packages/**/*.rip'], { cwd: ROOT });
  const inputs = [];
  for (const f of new TextDecoder().decode(proc.stdout).split('\0').filter(Boolean)) {
    inputs.push([f, readFileSync(join(ROOT, f), 'utf8'), f]);
  }
  for (const file of ripFiles(join(ROOT, 'test/rip'))) {
    const rows = await loadBattery(join(ROOT, 'test/rip', file));
    rows.forEach((row, n) => { if (typeof row.src === 'string') inputs.push([`test/rip/${file}#${n} ${row.verb} ${row.name}`, row.src, `<${file}>`]); });
  }
  const out = {};
  for (const [name, src, path] of inputs) {
    for (const face of ['js', 'ts']) {
      let text;
      try {
        const r = compile(src, { path, runtimeDelivery: 'none', ...(face === 'ts' ? { face: 'ts' } : {}) });
        text = r.code;
      } catch (e) { text = `ERR ${String(e?.message ?? e).split('\n')[0]}`; }
      out[`${face} ${name}`] = Bun.hash(text).toString(36);
    }
  }
  process.stdout.write(JSON.stringify(out));
}

async function observe(args) {
  const mutants = new Map(JSON.parse(readFileSync(args.in, 'utf8')).map((m) => [m.id, m]));
  const ids = readFileSync(args.ids, 'utf8').split('\n').filter(Boolean);
  const done = new Set();
  if (existsSync(args.out)) for (const l of readFileSync(args.out, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).id);
  const queue = ids.filter((id) => !done.has(id) && mutants.has(id)).map((id) => mutants.get(id));
  const workers = Number(args.workers ?? 4);
  const base = join(args.workdir ?? join(tmpdir(), 'rip-mutate'), 'observe');
  mkdirSync(base, { recursive: true });
  const dirs = [];
  for (let w = 0; w < workers; w++) {
    const d = join(base, `w${w}`);
    if (!existsSync(d)) cpSync(ROOT, d, { recursive: true, filter: (p) => !p.includes('/.rip/') });
    dirs.push(d);
  }
  const pristine = new Map();
  for (const f of new Set(queue.map((m) => m.file))) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    pristine.set(f, src);
    for (const d of dirs) writeFileSync(join(d, f), src);
  }
  const hashesIn = async (dir) => {
    const cmd = ['bun', 'scripts/mutate.mjs', 'corpus-hashes'];
    const proc = spawn(args.cap ? ['cpuq', 'cap', '--mem', args.mem ?? MEM_CAP, '--time', '300s', '--', ...cmd] : cmd,
      { cwd: dir, env: { ...process.env, RIP_NO_CACHE: '1', FORCE_COLOR: '0' }, stdout: 'pipe', stderr: 'pipe' });
    const [out] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    if (code !== 0) return { failed: code };
    try { return { hashes: JSON.parse(out) }; } catch { return { failed: 'unparsable' }; }
  };
  const baseline = await hashesIn(dirs[0]);
  if (!baseline.hashes) { console.error(`observe: the pristine corpus run failed (${baseline.failed})`); process.exit(1); }
  console.log(`observe: ${Object.keys(baseline.hashes).length} corpus outputs; ${queue.length} mutants, ${workers} workers`);
  let n = 0, seen = 0;
  const started = Date.now();
  const worker = async (dir) => {
    while (queue.length) {
      const m = queue.shift();
      const src = pristine.get(m.file);
      const target = join(dir, m.file);
      let mutated;
      if (m.op === 'table') {
        try { mutated = generateTable(await loadSolar(), m); } catch (e) {
          appendFileSync(args.out, JSON.stringify({ id: m.id, verdict: 'invalid' }) + '\n');
          continue;
        }
      } else if (src.slice(m.start, m.end) !== m.from) {
        appendFileSync(args.out, JSON.stringify({ id: m.id, verdict: 'moved' }) + '\n');
        continue;
      } else mutated = src.slice(0, m.start) + m.to + src.slice(m.end);
      writeFileSync(target, mutated);
      let r;
      try { r = await hashesIn(dir); } finally { writeFileSync(target, src); }
      let rec;
      if (!r.hashes) rec = { id: m.id, verdict: 'observed', by: [`corpus run failed: ${r.failed}`] };
      else {
        const moved = Object.keys(baseline.hashes).filter((k) => r.hashes[k] !== baseline.hashes[k]);
        rec = moved.length ? { id: m.id, verdict: 'observed', count: moved.length, by: moved.slice(0, 5) } : { id: m.id, verdict: 'unobserved' };
      }
      appendFileSync(args.out, JSON.stringify(rec) + '\n');
      n++; if (rec.verdict === 'observed') seen++;
      if (n % 50 === 0) {
        const rate = n / ((Date.now() - started) / 1000);
        console.log(`  ${n} run, ${seen} observed — ${rate.toFixed(2)}/s, ~${Math.round(queue.length / rate / 60)} min left`);
      }
    }
  };
  await Promise.all(dirs.map(worker));
  console.log(`observe done: ${n} run, ${seen} observed, ${n - seen} unobserved`);
}

// ── cli ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) a[k] = true; else { a[k] = v; i++; } }
    else a._.push(argv[i]);
  }
  return a;
}

if (import.meta.main) {
  const [cmd, ...all] = process.argv.slice(2);
  const dash = all.indexOf('--');
  const rest = dash < 0 ? all : all.slice(0, dash);
  const args = parseArgs(rest);
  if (cmd === 'gen') gen(args);
  else if (cmd === 'gen-table') await genTable(args);
  else if (cmd === 'run') await run(args);
  else if (cmd === 'report') report(args);
  else if (cmd === 'try') await tryMutants(args, dash < 0 ? [] : all.slice(dash + 1));
  else if (cmd === 'observe') await observe(args);
  else if (cmd === 'corpus-hashes') await corpusHashes();
  else { console.error('usage: bun scripts/mutate.mjs gen|run|report …'); process.exit(2); }
}
