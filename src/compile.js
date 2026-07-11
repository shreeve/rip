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
  return `  ${gutter} | ${text}\n  ${' '.repeat(gutter.length)} | ${' '.repeat(col)}^`;
};

const positioned = (file, path, reason, start, end) => {
  const { line, col } = file.lineColAt(start);
  const message = `${path}:${line + 1}:${col + 1}: ${reason}\n\n${excerpt(file, start)}`;
  return new CompileError(message, { path, start, end, line: line + 1, col: col + 1 });
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
export function compile(source, { path = '<anonymous>', runtimeDelivery = 'inline', face = 'js', pins = null, strict = false } = {}) {
  const file = new SourceFile(source, path);

  const parser = Parser();
  parser.lexer = makeParserLexer(path);

  let result;
  try {
    result = parser.parse(source);
  } catch (err) {
    // Lexer rejections carry offset spans; anything else is a bug, not
    // a diagnostic — let it propagate.
    if (typeof err.start !== 'number') throw err;
    throw positioned(file, path, err.reason ?? err.message, err.start, err.end);
  }

  if (result.diagnostics.length > 0) {
    const d = result.diagnostics[0];
    throw positioned(file, path, d.message, d.start, d.end);
  }

  let emitted;
  try {
    emitted = emit(result, { source, runtimeDelivery, face, pins, strict });
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
    tsRegions: emitted.tsRegions,
    pinnables: emitted.pinnables,
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
