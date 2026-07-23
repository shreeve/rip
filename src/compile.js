// Compilation entry — one call from Rip source text to generated JS plus
// its Source Map V3 object. This is a serialization boundary:
// spans stay [start, end) offsets through the whole pipeline, and become
// file:line:col here, via SourceFile lineStarts, only when a diagnostic
// is formatted for a human.
//
// Every failure mode funnels into CompileError:
//   - lexer rejections (thrown with offset spans attached),
//   - parse diagnostics (offset spans in the parser's diagnostics array),
//   - emitter rejections (thrown through Emitter#positionedError with
//     the offending node's span attached; only the two emit() API
//     guards — failed-parse input, unknown runtimeDelivery — are
//     message-only, since no source node exists for either).
// The message carries the full human-readable form (path:line:col, the
// source line, a caret) so any consumer that just prints `err.message`
// shows a precise diagnostic; the structured fields (path, start, end,
// line, col — 1-based) remain available for tooling.

import { SourceFile } from './source.js';
import { makeParserLexer } from './lexer.js';
import { Parser } from './parser.js';
import { emit } from './emitter.js';
import { toSourceMap } from './sourcemap.js';
import { Mappings } from './stores.js';
import { emitDeclarations } from './dts.js';
import { foldDerivedSchemas } from './schema.js';

export class CompileError extends Error {
  constructor(message, { path, start = null, end = null, line = null, col = null } = {}) {
    super(message);
    this.name = 'CompileError';
    this.path = path;
    this.start = start;
    this.end = end;
    this.line = line;
    this.col = col;
  }
}

// The source line at `offset` with a caret under the offending column:
//
//   3 | f(a))
//     |     ^
const excerpt = (file, offset) => {
  const { line, col } = file.lineColAt(offset);
  const lineStart = file.lineStarts[line];
  const lineEnd = line + 1 < file.lineStarts.length ? file.lineStarts[line + 1] - 1 : file.text.length;
  const text = file.text.slice(lineStart, lineEnd).replace(/\r$/, '');
  const gutter = String(line + 1);
  // The caret pad mirrors the prefix's DISPLAY cells: tabs stay tabs
  // (the terminal aligns them identically), and an astral glyph — two
  // UTF-16 units, one cell — pads as one space (structured columns
  // stay UTF-16; only the human rendering adjusts).
  const pad = Array.from(text.slice(0, col)).map((ch) => (ch === '\t' ? '\t' : ' ')).join('');
  return `  ${gutter} | ${text}\n  ${' '.repeat(gutter.length)} | ${pad}^`;
};

const positioned = (file, path, reason, start, end) => {
  const { line, col } = file.lineColAt(start);
  const message = `${path}:${line + 1}:${col + 1}: ${reason}\n\n${excerpt(file, start)}`;
  return new CompileError(message, { path, start, end, line: line + 1, col: col + 1 });
};

// A parse diagnostic as a CompileError. The one grammar state whose
// FIRST expectation is the ternary's ':' is a two-operand `a ? b` —
// almost always a reach for the nullish default; the hint names the
// operator that means it.
const diagnosticError = (file, path, d) => {
  const message = d.expected?.[0] === ':'
    ? `${d.message}\n  (a two-operand '?' is incomplete — a default for null/undefined is spelled x ?? y)`
    : d.message;
  return positioned(file, path, message, d.start, d.end);
};

// source text → { code, map, stores, mappings, trivia, declarations }.
// `map` is the Source Map V3 object for `code` (serialize or inline as
// the consumer requires); `stores` is the Stores query layer over the
// parse's NodeStore/RoleStore rows and `mappings` the Mappings query
// layer over the emission's MappingStore rows — the bidirectional-mapping surface
// consumed by `rip --explain` and by declaration emission.
// `trivia` is the lexer's span-anchored comment/blank channel (deliberately —
// span-anchored only, no leading/trailing attachment).
// `declarations` is the module's .d.ts text,
// generated from the recorded annotation spans on first access and
// memoized — consumers that never read it (the loader, plain compiles)
// pay nothing, and the compiler never writes declaration files. Throws
// CompileError on any lexer, parser, or emitter rejection; declaration
// emission's own rejections surface as CompileError on access.
// `runtimeDelivery` selects how feature runtimes reach the
// output when the program uses one: 'inline' (the default — compiled
// output is assumed carried away, so it is self-contained, the
// runtime inlined once) or 'import' (toolchain paths — the loader —
// where resolution of the shared runtime module is guaranteed).
// Programs using no feature runtime are byte-identical under every
// mode (the zero-cost gate).
// `face` selects the emission surface: 'js' (default — the
// shipping emission, every byte as always) or 'ts' (the editor
// face — the same emission plus TypeScript type syntax, consumed by
// the editor/tooling path only, never a shipping target). A TS-face
// result additionally carries `tsRegions` — the recorded [start, end)
// generated spans of every TS-only byte, whose deletion reproduces
// the JS emission exactly (the byte-equality invariant).
// `foldProjections` statically folds derived-schema algebra
// (`V = User.pick("id")`) into self-contained schema literals — the
// browser-bundle extractor's option; OFF by default so every other
// path keeps the runtime algebra and its `_sourceModel` back-pointer.
// `ambientBindings` seeds the emitter's program scope with bindings
// from OUTSIDE this source (the REPL's prior lines): `[{name, kind}]`
// with kind plain / state / computed / effect / readonly / import /
// class / def / enum. A seeded name emits exactly as if its
// declaration were in-file — reactive reads/writes unwrap `.value`,
// readonly and computed writes reject positioned, the name never
// re-hoists, and minted temporaries dodge it.
// `repl: true` (off by default, zero effect when off) shapes the
// emission for REPL evaluation inside an async function body: the
// final top-level expression statement lands in a MINTED result slot
// (reported as `replResultName`; null when nothing captured), and
// top-level static imports lower to awaited dynamic imports.
export function compile(source, { path = '<anonymous>', runtimeDelivery = 'inline', face = 'js', pins = null, strict = false, script = false, foldProjections = false, ambientBindings = null, repl = false } = {}) {
  // One stable identifying error for a non-string source — without
  // it, malformed input fails in whichever subsystem dereferences it
  // first, with an incidental TypeError.
  if (typeof source !== 'string') {
    const kind = source === null ? 'null' : Array.isArray(source) ? 'an array' : `a ${typeof source}`;
    throw new CompileError(`compile: source must be a string; got ${kind}`, { path });
  }
  const file = new SourceFile(source, path);

  // The __DATA__ marker: everything after a line that is exactly
  // `__DATA__` is the program's DATA constant — raw text, never
  // parsed. The parse sees the truncated source; offsets before the
  // marker are unchanged, so every diagnostic and mapping span stays
  // exact against the full file.
  let dataPayload = null;
  let parseSource = source;
  {
    const lines = source.split('\n');
    const at = lines.findIndex((line) => line === '__DATA__');
    if (at !== -1) {
      const rest = lines.slice(at + 1);
      dataPayload = rest.length > 0 ? rest.join('\n') + '\n' : '';
      parseSource = lines.slice(0, at).join('\n');
    }
  }

  const parser = Parser();
  parser.lexer = makeParserLexer(path);

  let result;
  try {
    result = parser.parse(parseSource);
  } catch (err) {
    // Lexer rejections carry offset spans; anything else is a bug, not
    // a diagnostic — let it propagate.
    if (typeof err.start !== 'number') throw err;
    throw positioned(file, path, err.reason ?? err.message, err.start, err.end);
  }

  if (result.diagnostics.length > 0) {
    throw diagnosticError(file, path, result.diagnostics[0]);
  }

  if (foldProjections) foldDerivedSchemas(result.sexpr);

  let emitted;
  try {
    emitted = emit(result, { source, runtimeDelivery, face, pins, strict, script, dataPayload, ambientBindings, repl });
  } catch (err) {
    // Emitter rejections carry the offending node's offset span
    // (Emitter#positionedError) and format like every other
    // diagnostic — path:line:col, source line, caret. The path-
    // prefixed message-only form remains for errors with no source
    // position (the emit() API guards) and for spans the stores
    // cannot resolve.
    if (typeof err.start === 'number') {
      throw positioned(file, path, err.message, err.start, err.end);
    }
    // The nesting-bound backstop: any recursive descent that
    // exhausts the engine stack before reaching the emitter's own
    // depth counter still rejects as a named diagnostic, never a
    // bare RangeError.
    if (err instanceof RangeError) {
      throw new CompileError(
        `${path}: emitter: the program nests too deeply to emit (the engine stack was exhausted) — restructure the deepest expression or block`,
        { path },
      );
    }
    throw new CompileError(`${path}: ${err.message}`, { path });
  }

  const map = toSourceMap(emitted, { source, sourcePath: path, file: `${path}.js` });
  let declarations = null;
  return {
    code: emitted.code,
    map,
    stores: emitted.stores,
    mappings: new Mappings(emitted.mappings),
    runtimes: emitted.runtimes,
    // The program's top-level binding inventory: [{name, kind}] with
    // kind plain / state / computed / effect / readonly / import /
    // class / def / enum — the REPL's `.vars` data and the ambient
    // seed for its next line. Unconditional on every compile.
    bindings: emitted.bindings,
    // repl mode's minted result slot — the name the final expression,
    // assignment, or declaration echo landed in; null when nothing
    // captured (or when repl mode is off).
    replResultName: emitted.replResultName,
    // repl mode's minted import-resolver name — every dynamic-import
    // specifier routes through `<name>(spec)`, and the evaluation
    // environment binds it to a cwd-anchored resolver; null when the
    // program has no import (or repl mode is off).
    replImportResolver: emitted.replImportResolver,
    tsRegions: emitted.tsRegions,
    pinnables: emitted.pinnables,
    // Generated spans of `:=` state names — writable in rip, `const` in the
    // face. The editor clears TypeScript's `readonly` token modifier on these.
    mutables: emitted.mutables,
    // Emitted module-specifier spans, recorded at emission — the
    // browser module loader splices resolved specifiers by offset.
    imports: emitted.imports,
    // The lexer's span-anchored trivia channel : comments and
    // blank-line runs as {kind, start, end, text}, source order —
    // never fed to the parser, relayed for rewrite/LSP consumers
    // (span-based edits keep comment bytes untouched by construction).
    trivia: result.trivia ?? [],
    get declarations() {
      if (declarations === null) {
        try {
          declarations = emitDeclarations({ sexpr: result.sexpr, stores: emitted.stores, source });
        } catch (err) {
          throw new CompileError(`${path}: ${err.message}`, { path });
        }
      }
      return declarations;
    },
  };
}

// Is `source` a complete program, a legal prefix of one, or broken?
// The REPL's continue/report decision, owned by the lexer+parser —
// never a bracket-counting heuristic over text. Returns
//   { status: 'complete' }
//   { status: 'incomplete' }
//   { status: 'error', error: CompileError }  — positioned, exactly
//     what compile() would throw for the same source.
//
// The classification facts, in order:
//   1. A lexer rejection whose delimiter was still OPEN at end of
//      input (err.openAtEnd — unclosed bracket, unterminated
//      string/heredoc, open heregex) is incomplete; any other lexer
//      rejection is a hard error (a newline-broken single-line
//      string can never be closed by more input).
//   2. A parse diagnostic got 'end of input' is incomplete.
//   3. Any other diagnostic classifies by the classifier's single
//      owned probe: reparse with one INDENTED continuation line
//      appended (one level deeper than the last line). A bodiless
//      block header (`if x` retags to POST_IF without mentioning end
//      of input) parses clean under the probe — by definition a
//      legal prefix; a genuine mid-input error stays broken.
// A prefix-complete program (`class Foo`) parses clean and reports
// complete — deciding to WAIT on it is the caller's policy, not a
// language fact.
export function classifyCompleteness(source) {
  if (typeof source !== 'string') {
    const kind = source === null ? 'null' : Array.isArray(source) ? 'an array' : `a ${typeof source}`;
    throw new CompileError(`classifyCompleteness: source must be a string; got ${kind}`);
  }
  const path = '<repl>';
  const file = new SourceFile(source, path);
  const parse = (text) => {
    const parser = Parser();
    parser.lexer = makeParserLexer(path);
    return parser.parse(text);
  };
  let result;
  try {
    result = parse(source);
  } catch (err) {
    if (typeof err.start !== 'number') throw err; // a bug, not a diagnostic
    if (err.openAtEnd === true) return { status: 'incomplete' };
    return { status: 'error', error: positioned(file, path, err.reason ?? err.message, err.start, err.end) };
  }
  if (result.diagnostics.length === 0) return { status: 'complete' };
  const d = result.diagnostics[0];
  if (d.got === 'end of input') return { status: 'incomplete' };
  const lastLine = source.slice(source.lastIndexOf('\n') + 1);
  const probe = `${source}\n${/^[ \t]*/.exec(lastLine)[0]}  0`;
  try {
    if (parse(probe).diagnostics.length === 0) return { status: 'incomplete' };
  } catch {
    // The probe line broke tokenization — the original diagnostic stands.
  }
  return { status: 'error', error: diagnosticError(file, path, d) };
}
