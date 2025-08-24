// zig-lex.js
import { dlopen, FFIType, ptr } from "bun:ffi";

export const TokenKind = {
  Ident:1, Number:2, String:3, Space:4, Newline:5, Semi:6, LParen:7, RParen:8, Comma:9,
  Caret:10, Dollar:11, At:12, Colon:13, Plus:14, Minus:15, Star:16, Slash:17, BSlash:18,
  Hash:19, Und:20, Amp:21, Bang:22, Tick:23, Lt:24, Gt:25, Eq:26, QMark:27, LBr:28, RBr:29, Dot:30, Other:31
};

const libname = process.platform === "darwin" ? "./libmumps_lex.dylib" : "./libmumps_lex.so";

export function tryLoadZigLexer() {
  try {
    const lib = dlopen(libname, {
      lex_count: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
      lex_fill:  { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    });
    return lib;
  } catch (_) {
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

/** Example:
import { zigLex } from "./zig-lex.js";
import { parseMumpsWithTokens } from "./mumps-parser-pro.js";

const src = Bun.file("example.m").arrayBuffer();
const buf = new Uint8Array(await src);
const toks = zigLex(buf); // may be null if dylib not present
const ast = toks ? parseMumpsWithTokens(buf, toks) : parseMumps(buf);
console.log(ast.format({ abbreviateCommands: true, alignSetEquals: true, commentColumn: 40 }));
*/
