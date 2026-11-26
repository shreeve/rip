// The front-end corpus: the consumer corpus's programs (every tracked package
// module and language-suite row), seen at the front end instead of in
// compiled output. The manifest (test/corpus/frontend.json) pins four hashes
// per program:
//
//   tokens    the tape the parser receives (every token field, origins as
//             tape positions) and the lexer's trivia channel
//   tree      the strict parse on both faces (the JS face without the
//             PrimitiveStore, the TS face with it): the tree with each
//             array's node id, `.parenthesized` flag and shared references,
//             the NodeStore, RoleStore and PrimitiveStore rows, and the
//             diagnostics or the thrown error
//   tolerant  the tape, trivia and tree of the editor's tolerant parse, so
//             repair behavior is pinned on the rows that do not parse
//   complete  the REPL's completeness verdict for the whole source
//
// A front-end change that must leave the tree alone (a faster driver, a
// re-encoded table, a factored grammar, fused rewriter passes) proves it
// against this manifest. A change that moves a tree is accepted only by
// `bun run corpus`, after `bun scripts/frontend-diff.mjs <ref>` shows every
// moved program.
import { Parser } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { classifyCompleteness, splitData } from '../../src/compiler.js';

// This checkout's front end. The diff script passes another revision's.
const OWN = { Parser, makeParserLexer, classifyCompleteness, splitData };

export const FRONTEND_MANIFEST = 'test/corpus/frontend.json';
export const FRONTEND_FACTS = ['tokens', 'tree', 'tolerant', 'complete'];

const isToken = (v) => typeof v.id === 'number' && typeof v.kind === 'string' && typeof v.start === 'number';

// An exact serialization of everything one parse produced. JSON loses what
// a tree or token holds: a schema descriptor's own toJSON returns only its
// kind, `undefined` and functions drop out, a RegExp prints as {}, -0 prints
// as 0, and a value reached twice prints twice. This walk ignores toJSON,
// spells every value, labels class instances, and prints a second reach of
// an object as `*n`, the n-th object first reached, so sharing is pinned.
//
// Token ids are minting order, not meaning: a token anywhere (the tape, or
// nested in a schema or render value) prints its id, and every `origin`
// prints its target, as a label. A tape token's label is its tape position
// (`t12`); any other id takes the next `n` label in first-reach order. So
// renumbering ids changes nothing, and moving a token changes the label
// every reference to it prints.
//
// With `nodeIds` (the WeakMap join every consumer uses), each array also
// prints its node id, and any own non-index property, `.parenthesized`
// included.
export class Exact {
  constructor({ tape = null, nodeIds = null } = {}) {
    this.nodeIds = nodeIds;
    this.labels = new Map((tape ?? []).map((t, i) => [t.id, `t${i}`]));
    this.reached = new Map();
    this.path = new Set();
  }

  label(id) {
    if (!this.labels.has(id)) this.labels.set(id, `n${this.labels.size}`);
    return this.labels.get(id);
  }

  text(v) {
    if (v === undefined) return 'undefined';
    if (typeof v === 'function') return `fn ${v.name}`;
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (this.path.has(v)) throw new Error('front-end facts: a cycle in a token value or tree');
    if (this.reached.has(v)) return `*${this.reached.get(v)}`;
    this.reached.set(v, this.reached.size);
    this.path.add(v);
    try {
      return this.#body(v);
    } finally {
      this.path.delete(v);
    }
  }

  #body(v) {
    if (v instanceof RegExp) return `re ${v}`;
    if (v instanceof Map) return `Map{${[...v].map(([k, x]) => `${this.text(k)}=>${this.text(x)}`).join(',')}}`;
    if (v instanceof Set) return `Set{${[...v].map((x) => this.text(x)).join(',')}}`;
    if (Array.isArray(v)) {
      const items = v.map((x) => this.text(x));
      const extra = Object.keys(v).filter((k) => !/^\d+$/.test(k)).map((k) => `${k}:${this.text(v[k])}`);
      const id = this.nodeIds ? `#${this.nodeIds.get(v) ?? '-'}` : '';
      return `${id}[${items.join(',')}]${extra.length ? `{${extra.join(',')}}` : ''}`;
    }
    const proto = Object.getPrototypeOf(v);
    const name = proto === Object.prototype || proto === null ? '' : (proto?.constructor?.name ?? '?');
    const token = isToken(v);
    const fields = Object.keys(v).map((k) => {
      if (token && k === 'id') return `id:${this.label(v.id)}`;
      if (token && k === 'origin' && v.origin != null) return `origin:${this.label(v.origin)}`;
      return `${JSON.stringify(k)}:${this.text(v[k])}`;
    });
    return `${name}{${fields.join(',')}}`;
  }
}

// One parse's facts, one item per line, so the diff script can show
// exactly which token or row moved. The lexer is wrapped so the tape
// survives a parse that throws: the driver lexes into a child of
// `parser.lexer`, and setInput is where that child holds the tape.
function parseLines(engine, text, path, { primitives, tolerant }) {
  const parser = engine.Parser();
  const lexer = engine.makeParserLexer(path, { tolerant });
  let lexed = null;
  const setInput = lexer.setInput;
  lexer.setInput = function (input) {
    setInput.call(this, input);
    lexed = this;
  };
  parser.lexer = lexer;
  let r = null, error = null;
  try {
    r = parser.parse(text, { primitives, tolerant });
  } catch (e) {
    if (typeof e?.start !== 'number') throw e;
    error = e;
  }
  const tape = r?.tokens ?? lexed?.tokens ?? null;
  const exact = new Exact({ tape, nodeIds: r?.stores?.nodeIds ?? new WeakMap() });
  const tokens = tape ? tape.map((t) => `token ${exact.text(t)}`) : ['<no tape>'];
  for (const t of r?.trivia ?? lexed?.trivia ?? []) tokens.push(`trivia ${exact.text(t)}`);
  const tree = [];
  if (error) {
    const fields = { message: error.message };
    for (const k of Object.keys(error)) fields[k] = error[k];
    tree.push(`ERR ${exact.text(fields)}`);
  } else {
    for (const d of r.diagnostics) tree.push(`diagnostic ${exact.text(d)}`);
    if (r.stores) {
      for (const row of r.stores.nodes) tree.push(`node ${exact.text(row)}`);
      for (const row of r.stores.roles) tree.push(`role ${exact.text(row)}`);
      for (const row of r.stores.primitives ?? []) tree.push(`primitive ${exact.text(row)}`);
    }
    tree.push(`sexpr ${exact.text(r.sexpr)}`);
  }
  return { tokens, tree };
}

// `engine` is a front end's {Parser, makeParserLexer, classifyCompleteness,
// splitData}; a revision that predates splitData borrows this checkout's.
// The strict parses use the options compile uses per face (primitives on
// the TS face only); the tolerant parse is the editor's, which compiles
// the TS face.
export function frontEndFacts(src, path, engine = OWN) {
  const { text } = (engine.splitData ?? splitData)(src);
  const js = parseLines(engine, text, path, { primitives: false, tolerant: false });
  const ts = parseLines(engine, text, path, { primitives: true, tolerant: false });
  const tolerant = parseLines(engine, text, path, { primitives: true, tolerant: true });
  let verdict;
  try {
    const c = engine.classifyCompleteness(src);
    verdict = c.status === 'error' ? `error ${c.error.message.split('\n')[0]}` : c.status;
  } catch (e) {
    verdict = `ERR ${String(e?.message ?? e).split('\n')[0]}`;
  }
  return {
    tokens: js.tokens,
    tree: [...js.tree.map((l) => `js ${l}`), ...ts.tree.map((l) => `ts ${l}`)],
    tolerant: [...tolerant.tokens, ...tolerant.tree],
    complete: [verdict],
  };
}

export function hashFrontEnd(inputs) {
  const out = {};
  for (const { key, src, path } of inputs) {
    const facts = frontEndFacts(src, path);
    out[key] = Object.fromEntries(FRONTEND_FACTS.map((f) => [f, Bun.hash(facts[f].join('\n')).toString(36)]));
  }
  return out;
}
