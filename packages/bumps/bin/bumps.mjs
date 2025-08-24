#!/usr/bin/env bun
// bumps: tiny CLI around mumps-parser-pro + zig-lex
// Commands: format | parse | tokens | bench
// Flags for `format`:
//   --abbr                abbreviate commands (SET->S)
//   --uppercase[=bool]    default true
//   --col=<n>             comment column (default 48)
//   --comma-gap=<n>       spaces after commas (default 0)
//   --align               align '=' in SET (default off)
//   --align-mode=<m>      "beforeEq" | "padLhs" (default beforeEq)
//   -w, --write           write files in-place (format only)
// Zig control:
//   --zig=auto|on|off     default auto

import { parseMumps, parseMumpsWithTokens, formatMumps, TokenKind } from "../mumps-parser-pro.js";

// optional zig path; import lazily so CLI runs even if not present
let zigLex = null;
try {
  const mod = await import("../zig-lex.js");
  zigLex = mod.zigLex ?? null;
} catch (_) {
  // no zig lex available — that's fine
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function usage() {
  console.error(`bumps <cmd> [flags] [files...]

Commands:
  format [files]     Format and print to stdout (or -w to write)
  parse  <file>      Parse and print a compact AST summary (JSON)
  tokens <file>      Print Zig/JS tokens with slices
  bench  [files]     Time lex/parse/format

Examples:
  bumps format sample.m
  bumps format -w --abbr --col=60 src/*.m
  bumps parse sample.m
  bumps tokens sample.m
  bumps bench sample.m
`);
}

function parseFlags(argv) {
  const flags = Object.create(null);
  const args = [];
  for (const a of argv) {
    if (a === "-w" || a === "--write") flags.write = true;
    else if (a === "--abbr") flags.abbr = true;
    else if (a.startsWith("--uppercase")) {
      const eq = a.indexOf("=");
      flags.uppercase = eq === -1 ? true : a.slice(eq + 1) !== "false";
    }
    else if (a.startsWith("--col=")) flags.col = +a.slice(6);
    else if (a.startsWith("--comma-gap=")) flags.commaGap = +a.slice(12);
    else if (a === "--align") flags.align = true;
    else if (a.startsWith("--align-mode=")) flags.alignMode = a.slice(13);
    else if (a.startsWith("--zig=")) flags.zig = a.slice(6); // auto|on|off
    else if (a.startsWith("-")) { /* ignore unknown for now */ }
    else args.push(a);
  }
  return { flags, args };
}

async function readFile(path) {
  const buf = await Bun.file(path).arrayBuffer();
  return new Uint8Array(buf);
}

function maybeZigLex(buf, mode) {
  if (mode === "off") return null;
  if (!zigLex && mode === "on") {
    console.error("error: --zig=on but zig-lex not available"); process.exit(2);
  }
  if (!zigLex) return null;
  try { return zigLex(buf); } catch { return null; }
}

function fmtOpts(flags) {
  return {
    abbreviateCommands: !!flags.abbr,
    uppercaseCommands: flags.uppercase !== false,
    commentColumn: Number.isFinite(flags.col) ? flags.col : 48,
    commaGap: Number.isFinite(flags.commaGap) ? flags.commaGap : 0,
    alignSetEquals: !!flags.align,
    alignSetMode: flags.alignMode === "padLhs" ? "padLhs" : "beforeEq",
  };
}

async function cmdFormat(files, flags) {
  if (files.length === 0) { usage(); process.exit(1); }
  const opts = fmtOpts(flags);
  const zigMode = flags.zig ?? "auto";
  for (const f of files) {
    const buf = await readFile(f);
    const toks = maybeZigLex(buf, zigMode);
    const ast = toks ? parseMumpsWithTokens(buf, toks) : parseMumps(buf);
    const out = formatMumps(ast, opts);
    if (flags.write) {
      await Bun.write(f, out);
    } else {
      process.stdout.write(out);
    }
  }
}

async function cmdParse(file, flags) {
  if (!file) { usage(); process.exit(1); }
  const buf = await readFile(file);
  const toks = maybeZigLex(buf, flags.zig ?? "auto");
  const t0 = performance.now();
  const ast = toks ? parseMumpsWithTokens(buf, toks) : parseMumps(buf);
  const t1 = performance.now();
  const summary = {
    mode: toks ? "zig+js" : "pure-js",
    lines: ast.lines.length,
    nodes: ast.nodes.length,
    ms: +(t1 - t0).toFixed(3),
  };
  console.log(JSON.stringify(summary, null, 2));
}

function tokenName(kind) {
  for (const k in TokenKind) if (TokenKind[k] === kind) return k;
  return String(kind);
}

async function cmdTokens(file, flags) {
  if (!file) { usage(); process.exit(1); }
  const buf = await readFile(file);
  const t = maybeZigLex(buf, flags.zig ?? "auto");
  if (!t) {
    console.error("No Zig tokens available (zig=off or no dylib)."); process.exit(2);
  }
  for (let i = 0; i < t.length; i += 3) {
    const kind = t[i] & 0xFFFF;
    const s = t[i + 1], e = t[i + 2];
    console.log(`${tokenName(kind)}\t${JSON.stringify(dec.decode(buf.subarray(s, e)))}`);
  }
}

async function cmdBench(files, flags) {
  if (files.length === 0) { usage(); process.exit(1); }
  const zigMode = flags.zig ?? "auto";
  const opts = fmtOpts(flags);
  for (const f of files) {
    const buf = await readFile(f);
    const t0 = performance.now();
    const toks = maybeZigLex(buf, zigMode);
    const t1 = performance.now();
    const ast = toks ? parseMumpsWithTokens(buf, toks) : parseMumps(buf);
    const t2 = performance.now();
    const out = formatMumps(ast, opts); // eslint-disable-line no-unused-vars
    const t3 = performance.now();
    console.log(`${f}\tlexer ${+(t1 - t0).toFixed(3)} ms\tparse ${+(t2 - t1).toFixed(3)} ms\tformat ${+(t3 - t2).toFixed(3)} ms\tmode ${toks ? "zig+js" : "pure-js"}`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, args } = parseFlags(rest);
  switch ((cmd || "").toLowerCase()) {
    case "format": await cmdFormat(args, flags); break;
    case "parse": await cmdParse(args[0], flags); break;
    case "tokens": await cmdTokens(args[0], flags); break;
    case "bench": await cmdBench(args, flags); break;
    default: usage(); process.exit(cmd ? 2 : 1);
  }
}
await main();
