// zig-lex.js
import { dlopen, FFIType, ptr } from "bun:ffi";

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
  const BYTES_PER_TOKEN = 8; // u16 kind + u32 start + u32 end -> 2+4+4=10 (but aligned). we'll store in JS as 12 bytes/struct
  // Use a 12-byte struct in JS via Uint32s for simplicity:
  const toks = new Uint32Array(n * 3);
  const outPtr = ptr(toks);
  const wrote = lib.symbols.lex_fill(p, buf.length, outPtr, n);
  if (wrote !== n) throw new Error("zig lex fill mismatch");
  // tokens[i*3+0] = kind (lower 16 bits), [i*3+1]=start, [i*3+2]=end
  return toks;
}
