// zig-lex.js
// Bun FFI shim for the Zig lexer (mumps_lex.zig).
// Provides: tryLoadZigLexer(), zigLex(Uint8Array) -> Uint32Array|null, TokenKind.
//
// Build the Zig lib:
//   zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.dylib   // macOS
//   zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.so      // Linux
//
// Usage:
//   import { zigLex } from "./zig-lex.js";
//   const toks = zigLex(buf); // Uint32Array of [kind,start,end] triples, or null if lib not loaded

import { dlopen, FFIType, ptr } from "bun:ffi";

export const TokenKind = {
  Ident:1, Number:2, String:3, Space:4, Newline:5, Semi:6, LParen:7, RParen:8, Comma:9,
  Caret:10, Dollar:11, At:12, Colon:13, Plus:14, Minus:15, Star:16, Slash:17, BSlash:18,
  Hash:19, Und:20, Amp:21, Bang:22, Tick:23, Lt:24, Gt:25, Eq:26, QMark:27, LBr:28, RBr:29, Dot:30, Other:31
};

function defaultLibName() {
  if (process.platform === "darwin") return "./libmumps_lex.dylib";
  if (process.platform === "linux") return "./libmumps_lex.so";
  // Windows not supported in this example
  return "./libmumps_lex.so";
}

export function tryLoadZigLexer(customPath) {
  const libpath = customPath || process.env.ZIG_MUMPS_LEX_PATH || defaultLibName();
  try {
    const lib = dlopen(libpath, {
      lex_count: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
      lex_fill:  { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    });
    return lib;
  } catch (err) {
    return null;
  }
}

export function zigLex(buf /* Uint8Array */) {
  const lib = tryLoadZigLexer();
  if (!lib) return null;
  const p = ptr(buf);
  const n = lib.symbols.lex_count(p, buf.length);
  const toks = new Uint32Array(n * 3);
  const outPtr = ptr(toks);
  const wrote = lib.symbols.lex_fill(p, buf.length, outPtr, n);
  if (wrote !== n) throw new Error("zig lex fill mismatch");
  return toks;
}
